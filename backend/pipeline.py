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
from database import SessionLocal, engine, ensure_tables
import models

# Ensure all tables exist on every invocation (critical for serverless cold starts)
ensure_tables(engine)
from orchestrator import (
    _log,
    get_enabled_markets,
    build_market_constraint,
    fetch_research_items,
    build_shared_retrieval_context,
    run_debate_panel,
    run_judge,
    setup_agent_prompts,
)
from data_ingestion import fetch_market_data
from memory_manager import write_agent_memory, prune_old_memory
from knowledge_graph import upsert_asset_nodes, ingest_retrieval_to_graph


def _get_base_url() -> str:
    """Resolve the internal base URL for firing the next lambda."""
    # On Vercel, VERCEL_URL is set automatically (no scheme)
    vercel_url = os.getenv("VERCEL_URL", "")
    if vercel_url:
        return f"https://{vercel_url}"
    # Local dev
    return "http://localhost:8000"


def run_full_pipeline(run_id: str):
    """Run all pipeline steps sequentially in a single call."""
    pipeline_research(run_id)
    pipeline_agents(run_id)
    pipeline_consensus(run_id)
    pipeline_deploy(run_id)


def _get_run(db, run_id: str) -> models.PipelineRun | None:
    return db.query(models.PipelineRun).filter(models.PipelineRun.run_id == run_id).first()


def _set_step(db, run: models.PipelineRun, step: str):
    run.step = step
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
        _set_step(db, run, "research")
        _log(db, run_id, "WEB_RESEARCH", "IN_PROGRESS", "Lambda: research step started")

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
        research_items = fetch_research_items(
            db, run_id, enabled_markets, investment_focus=investment_focus
        )

        # ── Step 2: Build Knowledge Graph from those articles ─────────────────
        # Hard timeout: KG ingest involves multiple LLM calls; cap at 45s so it
        # never stalls the pipeline on Vercel's serverless timeout boundary.
        try:
            import traceback as _tb
            from concurrent.futures import ThreadPoolExecutor, TimeoutError as _FutureTimeout
            upsert_asset_nodes(db, all_tickers)
            _log(db, run_id, "KG_INGEST", "IN_PROGRESS",
                 f"Extracting graph facts from {len(research_items)} research items…")
            with ThreadPoolExecutor(max_workers=1) as _kg_pool:
                _kg_future = _kg_pool.submit(ingest_retrieval_to_graph, db, research_items, run_id)
                try:
                    edges_added = _kg_future.result(timeout=45)
                    _log(db, run_id, "KG_INGEST", "DONE",
                         f"Knowledge graph updated — {edges_added} new edges (semantic dedup applied)")
                except _FutureTimeout:
                    _log(db, run_id, "KG_INGEST", "WARN",
                         "KG ingest timed out after 45s — pipeline continuing without full graph update")
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
        _log(db, run_id, "WEB_RESEARCH", "DONE", "Research cached — agents step next")

    except Exception as e:
        _log(db, run_id, "WEB_RESEARCH", "ERROR", str(e)[:300])
        run = _get_run(db, run_id)
        if run:
            _set_step(db, run, "error")
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
        _log(db, run_id, "DEBATE_PANEL", "IN_PROGRESS", "Lambda: agents step started")

        ctx_data = json.loads(run.shared_context)
        shared_context = ctx_data["context"]
        enabled_markets = json.loads(run.enabled_markets_json)
        market_constraint = build_market_constraint(enabled_markets)
        investment_focus = run.investment_focus or ""

        proposals_log = run_debate_panel(
            db, run_id, shared_context, market_constraint, investment_focus=investment_focus
        )

        if not proposals_log:
            _log(db, run_id, "DEBATE_PANEL", "ERROR", "No proposals — aborting")
            _set_step(db, run, "error")
            return

        run.proposals_json = json.dumps(proposals_log)
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
        _log(db, run_id, "JUDGE", "IN_PROGRESS", "Lambda: consensus step started")

        proposals_log = json.loads(run.proposals_json)
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
        best_ticker, best_action, judge_reasoning = run_judge(
            db, run_id, proposals_log, shared_context, budget_context, market_constraint
        )

        # Persist verdict back into proposals_json field as an extra key
        verdict = {"ticker": best_ticker, "action": best_action, "reasoning": judge_reasoning}
        run.proposals_json = json.dumps({
            "proposals": proposals_log,
            "verdict": verdict,
        })
        _set_step(db, run, "deploy")
        _log(db, run_id, "JUDGE", "DONE", f"Verdict: {best_action} {best_ticker} — deploy step next")

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
        verdict = data["verdict"]
        best_ticker = verdict["ticker"]
        best_action = verdict["action"]
        judge_reasoning = verdict["reasoning"]
        enabled_markets = json.loads(run.enabled_markets_json)
        ctx_data = json.loads(run.shared_context)
        research_log = ctx_data.get("research_log", [])

        signal = fetch_market_data(best_ticker)
        entry_price = signal.price if signal else 0.0

        agreeing = sum(1 for p in proposals_log
                       if p["ticker"] == best_ticker and p["action"] == best_action)
        votes_str = f"{agreeing}/{len(proposals_log)}"

        approval_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "approval_mode").first()
        approval_mode = approval_conf.value if approval_conf else "auto"
        initial_status = "ACTIVE" if approval_mode == "auto" else "PENDING"

        summary_text = (
            f"Judge selected {best_action} {best_ticker} at ${entry_price:.4f}. "
            f"{agreeing}/{len(proposals_log)} agents agreed. "
            f"Rationale: {judge_reasoning[:200]}"
        )

        # Enforce 1 strategy per ticker: find any active/pending strategy for this ticker
        from datetime import datetime as _dt
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
            existing.strategy_type    = best_action
            existing.entry_price      = entry_price
            existing.reasoning_summary = summary_text
            existing.status           = initial_status
            existing.notes = (
                f"{'Direction reversed to ' + best_action + ' — ' if action_changed else 'Reaffirmed '}"
                f"{votes_str} agents agreed."
            )
            # Reset any prior close fields
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

        debate_round = models.DebateRound(
            consensus_ticker=best_ticker,
            consensus_action=best_action,
            consensus_votes=votes_str,
            proposals_json=json.dumps(proposals_log),
            enabled_markets=", ".join(enabled_markets.keys()),
            research_context=json.dumps(research_log),
            judge_reasoning=judge_reasoning,
        )
        db.add(debate_round)
        db.commit()
        db.refresh(debate_round)

        # Link strategy back to its debate round
        strategy.debate_round_id = debate_round.id
        db.commit()

        _log(db, run_id, "DEPLOY", "DONE",
             f"Strategy saved (status={initial_status}) — Debate round #{debate_round.id}")

        # Memory write
        _log(db, run_id, "MEMORY_WRITE", "IN_PROGRESS",
             f"Writing memory for {len(proposals_log)} agents")
        for proposal in proposals_log:
            agent_name = proposal["agent_name"]
            agreed = (proposal["ticker"] == best_ticker and proposal["action"] == best_action)
            if agreed:
                note = (
                    f"Round {debate_round.id}: Your {proposal['action']} {proposal['ticker']} call was selected "
                    f"at ${entry_price:.4f}. Watch this position — you'll get a P&L update when it closes."
                )
                note_type = "INSIGHT"
            else:
                note = (
                    f"Round {debate_round.id}: You proposed {proposal['action']} {proposal['ticker']} but judge "
                    f"deployed {best_action} {best_ticker} @ ${entry_price:.4f}. "
                    f"Track how {best_ticker} performs vs your pick {proposal['ticker']}."
                )
                note_type = "OBSERVATION"
            write_agent_memory(db, agent_name, note_type, note, debate_round.id)
            prune_old_memory(db, agent_name, keep=50)

        db.commit()

        # Generate and store the full strategy report (chart + fundamentals) so the
        # frontend can load it instantly without calling yfinance on-demand.
        try:
            from api import _build_chart, _build_fundamentals
            _log(db, run_id, "MEMORY_WRITE", "IN_PROGRESS", f"Generating report for {best_ticker}…")
            report = {
                "chart":        _build_chart(best_ticker, entry_price, debate_round.timestamp),
                "fundamentals": _build_fundamentals(best_ticker),
            }
            debate_round.report_json = json.dumps(report)
            db.commit()
        except Exception as re_err:
            print(f"[pipeline_deploy] Report generation failed (non-fatal): {re_err}")

        _set_step(db, run, "done")
        _log(db, run_id, "MEMORY_WRITE", "DONE", "Pipeline complete")

        # Release concurrency lock
        lock = db.query(models.AppConfig).filter(models.AppConfig.key == "debate_running").first()
        if lock:
            lock.value = "0"
            db.commit()

    except Exception as e:
        _log(db, run_id, "DEPLOY", "ERROR", str(e)[:300])
        run = _get_run(db, run_id)
        if run:
            _set_step(db, run, "error")
        lock = db.query(models.AppConfig).filter(models.AppConfig.key == "debate_running").first()
        if lock:
            lock.value = "0"
            db.commit()
    finally:
        db.close()
