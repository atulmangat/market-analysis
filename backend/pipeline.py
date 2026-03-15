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
import threading
from database import SessionLocal
import models
from orchestrator import (
    _log,
    get_enabled_markets,
    build_market_constraint,
    build_shared_retrieval_context,
    run_debate_panel,
    run_judge,
    setup_agent_prompts,
)
from data_ingestion import fetch_market_data
from memory_manager import write_agent_memory, prune_old_memory


def _get_base_url() -> str:
    """Resolve the internal base URL for firing the next lambda."""
    # On Vercel, VERCEL_URL is set automatically (no scheme)
    vercel_url = os.getenv("VERCEL_URL", "")
    if vercel_url:
        return f"https://{vercel_url}"
    # Local dev
    return "http://localhost:8000"


def _fire_next(path: str, payload: dict, cron_secret: str):
    """Fire-and-forget POST to the next pipeline step in a background thread."""
    import httpx

    base = _get_base_url()
    url = f"{base}{path}"
    headers = {"x-vercel-cron-signature": cron_secret, "Content-Type": "application/json"}

    def _post():
        try:
            # Short timeout — we don't wait for the response, just trigger it
            httpx.post(url, json=payload, headers=headers, timeout=5)
        except Exception as e:
            print(f"[Pipeline] Fire-and-forget to {url} failed: {e}")

    t = threading.Thread(target=_post, daemon=True)
    t.start()


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
        shared_context, research_log = build_shared_retrieval_context(
            db, run_id, enabled_markets, investment_focus=investment_focus
        )

        # Save context to DB for the next lambda to pick up
        run.shared_context = json.dumps({
            "context": shared_context,
            "research_log": research_log,
        })
        _set_step(db, run, "agents")
        _log(db, run_id, "WEB_RESEARCH", "DONE", "Research cached — firing agents step")

        cron_secret = os.getenv("CRON_SECRET", "")
        _fire_next("/api/pipeline/agents", {"run_id": run_id}, cron_secret)

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
             f"{len(proposals_log)} proposals — firing consensus step")

        cron_secret = os.getenv("CRON_SECRET", "")
        _fire_next("/api/pipeline/consensus", {"run_id": run_id}, cron_secret)

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

        best_ticker, best_action, judge_reasoning = run_judge(
            db, run_id, proposals_log, shared_context, budget_context
        )

        # Persist verdict back into proposals_json field as an extra key
        verdict = {"ticker": best_ticker, "action": best_action, "reasoning": judge_reasoning}
        run.proposals_json = json.dumps({
            "proposals": proposals_log,
            "verdict": verdict,
        })
        _set_step(db, run, "deploy")
        _log(db, run_id, "JUDGE", "DONE", f"Verdict: {best_action} {best_ticker} — firing deploy step")

        cron_secret = os.getenv("CRON_SECRET", "")
        _fire_next("/api/pipeline/deploy", {"run_id": run_id}, cron_secret)

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
