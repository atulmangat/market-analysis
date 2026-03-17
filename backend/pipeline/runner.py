"""
Lambda chain pipeline — each function is an independent Vercel serverless function.

Chain:
  /api/pipeline/research  → fetches web research, fires → /api/pipeline/agents
  /api/pipeline/agents    → runs all agent LLMs in parallel, fires → /api/pipeline/consensus
  /api/pipeline/consensus → runs judge LLM, fires → /api/pipeline/deploy
  /api/pipeline/deploy    → saves strategy + writes agent memory, marks done
"""

import os
import json
from core.database import SessionLocal, engine, ensure_tables
import core.models as models

# Ensure all tables exist on every invocation (critical for serverless cold starts)
ensure_tables(engine)
from pipeline.orchestrator import (
    _log,
    get_enabled_markets,
    build_market_constraint,
    fetch_research_items,
    build_shared_retrieval_context,
    run_debate_panel,
    run_judge,
    setup_agent_prompts,
)
from data.market import fetch_market_data
from agents.memory import write_agent_memory, prune_old_memory
from graph.knowledge import upsert_asset_nodes, ingest_retrieval_to_graph


def _get_base_url() -> str:
    """Resolve the internal base URL for firing the next lambda."""
    # On Vercel, VERCEL_URL is set automatically (no scheme)
    vercel_url = os.getenv("VERCEL_URL", "")
    if vercel_url:
        return f"https://{vercel_url}"
    # Local dev
    return "http://localhost:8000"


STEP_ORDER = ["research", "agents", "consensus", "deploy", "done"]


def run_full_pipeline(run_id: str):
    """Run all pipeline steps sequentially in a single call."""
    pipeline_research(run_id)
    pipeline_agents(run_id)
    pipeline_consensus(run_id)
    pipeline_deploy(run_id)


def resume_pipeline(run_id: str):
    """
    Resume a pipeline from its last completed checkpoint.
    Safe to call even if the pipeline already finished — it will no-op.
    """
    db = SessionLocal()
    try:
        run = _get_run(db, run_id)
        if not run:
            print(f"[resume_pipeline] run_id {run_id} not found")
            return
        step = run.step
    finally:
        db.close()

    print(f"[resume_pipeline] Resuming run {run_id} from step={step!r}")

    if step in ("pending", "research", "error"):
        # error on research step = restart from research
        pipeline_research(run_id)
        pipeline_agents(run_id)
        pipeline_consensus(run_id)
        pipeline_deploy(run_id)
    elif step == "agents":
        pipeline_agents(run_id)
        pipeline_consensus(run_id)
        pipeline_deploy(run_id)
    elif step == "consensus":
        pipeline_consensus(run_id)
        pipeline_deploy(run_id)
    elif step == "deploy":
        pipeline_deploy(run_id)
    else:
        print(f"[resume_pipeline] run {run_id} already in terminal state {step!r} — nothing to do")


def _get_run(db, run_id: str) -> models.PipelineRun | None:
    return db.query(models.PipelineRun).filter(models.PipelineRun.run_id == run_id).first()


def _set_step(db, run: models.PipelineRun, step: str):
    run.step = step
    db.commit()


def _fail_run(db, run_id: str):
    """Mark run as error and release the concurrency lock in a single commit."""
    run = _get_run(db, run_id)
    lock = db.query(models.AppConfig).filter(models.AppConfig.key == "debate_running").first()
    if run:
        run.step = "error"
    if lock:
        lock.value = "0"
    db.commit()


# ── Step 1: Research ──────────────────────────────────────────────────────────

def pipeline_research(run_id: str):
    """
    Fetch web research + news + live prices.
    Saves shared_context to PipelineRun, fires /api/pipeline/agents.
    """
    db = SessionLocal()
    try:
        run = _get_run(db, run_id)
        if not run:
            print(f"[pipeline_research] run_id {run_id} not found")
            return
        # Skip if already past this step (checkpoint resume)
        if run.step in ("agents", "consensus", "deploy", "done"):
            print(f"[pipeline_research] Skipping — run {run_id} already at step={run.step!r}")
            return
        _set_step(db, run, "research")
        _log(db, run_id, "START", "IN_PROGRESS", "Pipeline started — setting up agents & markets")

        setup_agent_prompts(db)

        focus_tickers = json.loads(run.focus_tickers) if run.focus_tickers else None
        if focus_tickers:
            enabled_markets = {"Focused": focus_tickers}
        else:
            enabled_markets = get_enabled_markets(db)

        # Snapshot for next steps
        run.enabled_markets_json = json.dumps(enabled_markets)
        db.commit()

        investment_focus = run.investment_focus or ""
        all_tickers = [sym for tickers in enabled_markets.values() for sym in tickers]

        # ── Step 1: Fetch raw research articles ───────────────────────────────
        _log(db, run_id, "WEB_RESEARCH", "IN_PROGRESS",
             f"Fetching research for {len(all_tickers)} tickers across {', '.join(enabled_markets.keys())}")
        research_items = fetch_research_items(
            db, run_id, enabled_markets, investment_focus=investment_focus
        )

        # Fallback: if fresh fetch returned nothing, use any cached articles from DB
        if not research_items:
            from datetime import timedelta
            cutoff = __import__('datetime').datetime.utcnow() - timedelta(hours=6)
            cached_rows = db.query(models.WebResearch).filter(
                models.WebResearch.fetched_at >= cutoff
            ).all()
            if cached_rows:
                research_items = [
                    {"title": r.title, "snippet": r.snippet, "source_url": r.source_url, "query": r.query}
                    for r in cached_rows
                ]
                _log(db, run_id, "WEB_RESEARCH", "IN_PROGRESS",
                     f"Fresh fetch returned 0 — using {len(research_items)} cached articles from DB (< 6h old)")

        _log(db, run_id, "WEB_RESEARCH", "IN_PROGRESS",
             f"Research fetched — {len(research_items)} articles ready for KG ingest")

        # ── Step 2: Build Knowledge Graph from those articles ─────────────────
        # Hard timeout: KG ingest involves multiple LLM calls; cap at 45s so it
        # never stalls the pipeline on Vercel's serverless timeout boundary.
        try:
            import traceback as _tb
            from concurrent.futures import ThreadPoolExecutor, TimeoutError as _FutureTimeout
            upsert_asset_nodes(db, all_tickers)
            _log(db, run_id, "KG_INGEST", "IN_PROGRESS",
                 f"Extracting structured events from {len(research_items)} articles (title + content) → updating graph with net-new facts…")
            with ThreadPoolExecutor(max_workers=1) as _kg_pool:
                _kg_future = _kg_pool.submit(ingest_retrieval_to_graph, db, research_items, run_id)
                try:
                    edges_added = _kg_future.result(timeout=150)
                    # Query relation type breakdown for the log
                    try:
                        from sqlalchemy import func as _func
                        rel_counts = db.query(models.KGEdge.relation, _func.count(models.KGEdge.id))\
                            .filter(models.KGEdge.source_run_id == run_id)\
                            .group_by(models.KGEdge.relation).all()
                        rel_summary = ", ".join(f"{r}×{c}" for r, c in sorted(rel_counts, key=lambda x: -x[1])[:5]) if rel_counts else "none"
                    except Exception:
                        rel_summary = f"{edges_added} edges"
                    _log(db, run_id, "KG_INGEST", "DONE",
                         f"{edges_added} new edges added after semantic dedup — relation types: {rel_summary}")
                except _FutureTimeout:
                    _log(db, run_id, "KG_INGEST", "WARN",
                         "KG ingest timed out after 150s — pipeline continuing without full graph update")
        except Exception as kg_err:
            _log(db, run_id, "KG_INGEST", "ERROR",
                 f"KG ingest failed: {str(kg_err)[:300]} | {_tb.format_exc()[-300:]}")

        # ── Step 3: Build shared context (now uses fresh graph data) ──────────
        shared_context, research_log, _ = build_shared_retrieval_context(
            db, run_id, enabled_markets, investment_focus=investment_focus,
            research_items=research_items,
        )

        # Save context to DB for the next lambda to pick up
        run.shared_context = json.dumps({
            "context": shared_context,
            "research_log": research_log,
        })
        _set_step(db, run, "agents")
        _log(db, run_id, "WEB_RESEARCH", "DONE",
             f"Research complete — {len(research_items)} articles ingested into KG, context built for agents")

    except Exception as e:
        _log(db, run_id, "WEB_RESEARCH", "ERROR", str(e)[:300])
        _fail_run(db, run_id)
    finally:
        db.close()


# ── Step 2: Agents ────────────────────────────────────────────────────────────

def pipeline_agents(run_id: str):
    """
    Query all agents in parallel using cached research context.
    Saves proposals to PipelineRun, fires /api/pipeline/consensus.
    """
    db = SessionLocal()
    try:
        run = _get_run(db, run_id)
        if not run or not run.shared_context:
            print(f"[pipeline_agents] run_id {run_id} missing or no context")
            return
        # Skip if already past this step (checkpoint resume)
        if run.step in ("consensus", "deploy", "done"):
            print(f"[pipeline_agents] Skipping — run {run_id} already at step={run.step!r}")
            return
        _log(db, run_id, "DEBATE_PANEL", "IN_PROGRESS", "Lambda: agents step started")

        ctx_data = json.loads(run.shared_context)
        shared_context = ctx_data["context"]
        enabled_markets = json.loads(run.enabled_markets_json)
        market_constraint = build_market_constraint(enabled_markets)
        investment_focus = run.investment_focus or ""

        result = run_debate_panel(
            db, run_id, shared_context, market_constraint,
            investment_focus=investment_focus, enabled_markets=enabled_markets
        )
        # run_debate_panel returns (proposals_log, fitness_map)
        proposals_log, fitness_map = result if isinstance(result, tuple) else (result, {})

        if not proposals_log:
            _log(db, run_id, "DEBATE_PANEL", "ERROR", "No proposals — aborting")
            _fail_run(db, run_id)
            return

        run.proposals_json = json.dumps({"proposals": proposals_log, "fitness_map": fitness_map})
        _set_step(db, run, "consensus")
        _log(db, run_id, "DEBATE_PANEL", "DONE",
             f"{len(proposals_log)} proposals — consensus step next")

    except Exception as e:
        _log(db, run_id, "DEBATE_PANEL", "ERROR", str(e)[:300])
        run = _get_run(db, run_id)
        if run:
            _set_step(db, run, "error")
    finally:
        db.close()


# ── Step 3: Consensus (Judge) ─────────────────────────────────────────────────

def pipeline_consensus(run_id: str):
    """
    Run the judge LLM over all proposals.
    Saves verdict to PipelineRun, fires /api/pipeline/deploy.
    """
    db = SessionLocal()
    try:
        run = _get_run(db, run_id)
        if not run or not run.proposals_json:
            print(f"[pipeline_consensus] run_id {run_id} missing proposals")
            return
        # Skip if already past this step (checkpoint resume)
        if run.step in ("deploy", "done"):
            print(f"[pipeline_consensus] Skipping — run {run_id} already at step={run.step!r}")
            return
        _log(db, run_id, "JUDGE", "IN_PROGRESS", "Lambda: consensus step started")

        proposals_data = json.loads(run.proposals_json)
        # Support both old (list) and new (dict with proposals + fitness_map) formats
        if isinstance(proposals_data, list):
            proposals_log = proposals_data
            fitness_map = {}
        else:
            proposals_log = proposals_data.get("proposals", [])
            fitness_map = proposals_data.get("fitness_map", {})

        ctx_data = json.loads(run.shared_context)
        shared_context = ctx_data["context"]

        # Budget context for judge
        budget_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "trading_budget").first()
        total_budget = float(budget_conf.value) if budget_conf else 10000.0
        active_strats = db.query(models.DeployedStrategy).filter(models.DeployedStrategy.status == "ACTIVE").all()
        allocated = sum(s.position_size or 0.0 for s in active_strats)
        available = total_budget - allocated
        open_positions = ", ".join(f"{s.strategy_type} {s.symbol}" for s in active_strats) or "none"
        budget_context = (
            f"## Portfolio Budget Context\n"
            f"- Total budget: ${total_budget:,.2f}\n"
            f"- Allocated to open positions: ${allocated:,.2f}\n"
            f"- Available capital: ${available:,.2f}\n"
            f"- Open positions: {open_positions}\n"
            f"Only recommend a new trade if sufficient capital is available."
        )

        market_constraint = build_market_constraint(json.loads(run.enabled_markets_json))
        verdicts = run_judge(
            db, run_id, proposals_log, shared_context, budget_context, market_constraint,
            fitness_map=fitness_map
        )

        run.proposals_json = json.dumps({
            "proposals": proposals_log,
            "verdicts": verdicts,
        })
        _set_step(db, run, "deploy")
        summary = " | ".join(f"{v['action']} {v['ticker']}" for v in verdicts)
        _log(db, run_id, "JUDGE", "DONE", f"{len(verdicts)} position(s): {summary} — deploy step next")

    except Exception as e:
        _log(db, run_id, "JUDGE", "ERROR", str(e)[:300])
        run = _get_run(db, run_id)
        if run:
            _set_step(db, run, "error")
    finally:
        db.close()


# ── Step 4: Deploy ────────────────────────────────────────────────────────────

def pipeline_deploy(run_id: str):
    """
    Deploy the strategy and write agent memories.
    Marks the run as done. Final step — no further chaining.
    """
    db = SessionLocal()
    try:
        run = _get_run(db, run_id)
        if not run or not run.proposals_json:
            print(f"[pipeline_deploy] run_id {run_id} missing data")
            return
        _log(db, run_id, "DEPLOY", "IN_PROGRESS", "Lambda: deploy step started")

        data = json.loads(run.proposals_json)
        proposals_log = data["proposals"]
        verdicts = data.get("verdicts") or []
        # Back-compat: old runs stored a single "verdict" key
        if not verdicts and data.get("verdict"):
            verdicts = [data["verdict"]]
        enabled_markets = json.loads(run.enabled_markets_json)
        ctx_data = json.loads(run.shared_context)
        research_log = ctx_data.get("research_log", [])

        approval_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "approval_mode").first()
        approval_mode = approval_conf.value if approval_conf else "auto"
        initial_status = "ACTIVE" if approval_mode == "auto" else "PENDING"

        from datetime import datetime as _dt

        deployed_strategies = []
        for verdict in verdicts:
            best_ticker = verdict["ticker"]
            best_action = verdict["action"]
            judge_reasoning = verdict["reasoning"]

            signal = fetch_market_data(best_ticker)
            entry_price = signal.price if signal else 0.0

            agreeing = sum(1 for p in proposals_log
                           if p["ticker"] == best_ticker and p["action"] == best_action)
            votes_str = f"{agreeing}/{len(proposals_log)}"

            summary_text = (
                f"Judge selected {best_action} {best_ticker} at ${entry_price:.4f}. "
                f"{agreeing}/{len(proposals_log)} agents agreed. "
                f"Rationale: {judge_reasoning[:200]}"
            )

            # Enforce 1 strategy per ticker
            existing = (
                db.query(models.DeployedStrategy)
                .filter(
                    models.DeployedStrategy.symbol == best_ticker,
                    models.DeployedStrategy.status.in_(["ACTIVE", "PENDING"]),
                )
                .order_by(models.DeployedStrategy.id.desc())
                .first()
            )
            if existing:
                action_changed = existing.strategy_type != best_action
                existing.strategy_type     = best_action
                existing.entry_price       = entry_price
                existing.reasoning_summary = summary_text
                existing.status            = initial_status
                existing.notes = (
                    f"{'Direction reversed to ' + best_action + ' — ' if action_changed else 'Reaffirmed '}"
                    f"{votes_str} agents agreed."
                )
                existing.exit_price   = None
                existing.close_reason = None
                existing.closed_at    = None
                strategy = existing
            else:
                strategy = models.DeployedStrategy(
                    symbol=best_ticker,
                    strategy_type=best_action,
                    entry_price=entry_price,
                    reasoning_summary=summary_text,
                    status=initial_status,
                )
                db.add(strategy)
            deployed_strategies.append((strategy, best_ticker, best_action, judge_reasoning, entry_price, votes_str))

        # Use first verdict as the debate round's primary consensus fields
        primary = verdicts[0] if verdicts else {"ticker": "HOLD", "action": "HOLD", "reasoning": ""}
        first_ticker = primary["ticker"]
        first_action = primary["action"]
        first_reasoning = primary["reasoning"]
        first_agreeing = sum(1 for p in proposals_log if p["ticker"] == first_ticker and p["action"] == first_action)
        first_votes = f"{first_agreeing}/{len(proposals_log)}"

        debate_round = models.DebateRound(
            consensus_ticker=first_ticker,
            consensus_action=first_action,
            consensus_votes=first_votes,
            proposals_json=json.dumps(proposals_log),
            enabled_markets=", ".join(enabled_markets.keys()),
            research_context=json.dumps(research_log),
            judge_reasoning=json.dumps(verdicts),  # store all verdicts as JSON
        )
        db.add(debate_round)
        db.commit()
        db.refresh(debate_round)

        # Link all strategies back to this debate round
        for (strategy, *_) in deployed_strategies:
            strategy.debate_round_id = debate_round.id
        db.commit()

        positions_summary = " | ".join(f"{a} {t}" for (_, t, a, *_) in deployed_strategies)
        _log(db, run_id, "DEPLOY", "DONE",
             f"{len(deployed_strategies)} position(s) saved (status={initial_status}): {positions_summary} — Debate round #{debate_round.id}")

        # Memory write
        _log(db, run_id, "MEMORY_WRITE", "IN_PROGRESS",
             f"Writing memory notes for {len(proposals_log)} agents…")
        # Build set of deployed (ticker, action) for quick lookup
        deployed_set = {(t, a) for (_, t, a, *_) in deployed_strategies}
        for proposal in proposals_log:
            agent_name = proposal["agent_name"]
            prop_key = (proposal["ticker"], proposal["action"])
            if prop_key in deployed_set:
                # Find the matching deployed strategy's entry price
                ep = next((ep for (_, t, a, _, ep, _) in deployed_strategies if t == proposal["ticker"] and a == proposal["action"]), 0.0)
                note = (
                    f"Round {debate_round.id}: Your {proposal['action']} {proposal['ticker']} call was selected "
                    f"at ${ep:.4f}. Watch this position — you'll get a P&L update when it closes."
                )
                note_type = "INSIGHT"
            else:
                deployed_str = ", ".join(f"{a} {t}" for (_, t, a, *_) in deployed_strategies)
                note = (
                    f"Round {debate_round.id}: You proposed {proposal['action']} {proposal['ticker']} but judge "
                    f"deployed: {deployed_str}. Track how these positions perform vs your pick."
                )
                note_type = "OBSERVATION"
            write_agent_memory(db, agent_name, note_type, note, debate_round.id)
            prune_old_memory(db, agent_name, keep=200)

        db.commit()

        # Generate report for the first/primary position
        try:
            from api.routes import _build_chart, _build_fundamentals
            _log(db, run_id, "MEMORY_WRITE", "IN_PROGRESS", f"Generating report for {first_ticker}…")
            first_ep = next((ep for (_, t, _, _, ep, _) in deployed_strategies if t == first_ticker), 0.0)
            report = {
                "chart":        _build_chart(first_ticker, first_ep, debate_round.timestamp),
                "fundamentals": _build_fundamentals(first_ticker),
            }
            debate_round.report_json = json.dumps(report)
            db.commit()
        except Exception as re_err:
            print(f"[pipeline_deploy] Report generation failed (non-fatal): {re_err}")

        # Release concurrency lock and mark done atomically in one commit
        lock = db.query(models.AppConfig).filter(models.AppConfig.key == "debate_running").first()
        if lock:
            lock.value = "0"
        run.step = "done"
        db.commit()
        _log(db, run_id, "MEMORY_WRITE", "DONE", "Pipeline complete")

        # Invalidate runs list cache so frontend sees new run immediately
        from core.cache import cache_invalidate
        cache_invalidate("pipeline_runs")

    except Exception as e:
        _log(db, run_id, "DEPLOY", "ERROR", str(e)[:300])
        run = _get_run(db, run_id)
        lock = db.query(models.AppConfig).filter(models.AppConfig.key == "debate_running").first()
        if run:
            run.step = "error"
        if lock:
            lock.value = "0"
        db.commit()
        from core.cache import cache_invalidate
        cache_invalidate("pipeline_runs")
    finally:
        db.close()
