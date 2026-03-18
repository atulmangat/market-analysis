"""
Pipeline runner — thin wrappers over LangGraph graphs.

Public API (unchanged — api/routes.py calls these directly):
  run_research_pipeline(run_id)
  run_trade_pipeline(run_id)
  run_full_pipeline(run_id)     # legacy: research + trade
  run_evaluation(run_id)        # delegates to validator (unchanged)
"""

import json
from core.database import SessionLocal, engine, ensure_tables
import core.models as models

ensure_tables(engine)

from pipeline.graphs.research_graph import build_research_graph
from pipeline.graphs.trade_graph import build_trade_graph
from pipeline.graphs.state import ResearchState, TradeState

_research_graph = build_research_graph()
_trade_graph    = build_trade_graph()


def _tag_run_events(run_id: str, run_type: str):
    """Backfill run_type on all PipelineEvents and the PipelineRun row."""
    db = SessionLocal()
    try:
        db.query(models.PipelineEvent).filter(
            models.PipelineEvent.run_id == run_id
        ).update({"run_type": run_type})
        db.query(models.PipelineRun).filter(
            models.PipelineRun.run_id == run_id
        ).update({"run_type": run_type})
        db.commit()
    finally:
        db.close()


def run_research_pipeline(run_id: str):
    """Research-only pipeline: fetch news → KG ingest → save context."""
    db = SessionLocal()
    try:
        run = db.query(models.PipelineRun).filter(
            models.PipelineRun.run_id == run_id
        ).first()
        focus_tickers = json.loads(run.focus_tickers) if run and run.focus_tickers else None
        investment_focus = run.investment_focus or "" if run else ""
    finally:
        db.close()

    initial_state: ResearchState = {
        "run_id":           run_id,
        "enabled_markets":  {},
        "investment_focus": investment_focus,
        "focus_tickers":    focus_tickers,
        "research_items":   [],
        "shared_context":   "",
        "research_log":     [],
        "kg_edges_added":   0,
        "error":            None,
    }
    _research_graph.invoke(initial_state)
    _tag_run_events(run_id, "research")

    from core.cache import cache_invalidate
    cache_invalidate("pipeline_runs")


def run_trade_pipeline(run_id: str):
    """Trade-only pipeline: load context → agents (parallel) → judge → deploy."""
    db = SessionLocal()
    try:
        run = db.query(models.PipelineRun).filter(
            models.PipelineRun.run_id == run_id
        ).first()
        investment_focus = run.investment_focus or "" if run else ""
        # If the run already has shared_context (set by run_research_pipeline
        # in the same process), pass it through so node_load_context skips the
        # AppConfig lookup.
        shared_context = ""
        research_log: list = []
        enabled_markets: dict = {}
        if run and run.shared_context:
            try:
                ctx = json.loads(run.shared_context)
                shared_context = ctx.get("context", "")
                research_log   = ctx.get("research_log", [])
            except Exception:
                pass
        if run and run.enabled_markets_json:
            try:
                enabled_markets = json.loads(run.enabled_markets_json)
            except Exception:
                pass
    finally:
        db.close()

    initial_state: TradeState = {
        "run_id":           run_id,
        "enabled_markets":  enabled_markets,
        "investment_focus": investment_focus,
        "shared_context":   shared_context,
        "research_log":     research_log,
        "proposals":        [],
        "fitness_map":      {},
        "verdicts":         [],
        "error":            None,
    }
    _trade_graph.invoke(initial_state)
    _tag_run_events(run_id, "trade")


def run_full_pipeline(run_id: str):
    """Legacy full pipeline — research + trade combined."""
    run_research_pipeline(run_id)
    run_trade_pipeline(run_id)
    _tag_run_events(run_id, "debate")


def run_evaluation(run_id: str = None):
    """Evaluation pipeline — delegates to validator (unchanged)."""
    from pipeline.validator import evaluate_predictions
    evaluate_predictions(run_id)
