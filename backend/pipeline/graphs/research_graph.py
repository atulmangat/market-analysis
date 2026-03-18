"""
LangGraph research pipeline graph.

Nodes:
  setup → web_research → kg_ingest → build_context → save_research → END
                ↓ (error)
              error → END
"""
import json
from langgraph.graph import StateGraph, END

from core.database import SessionLocal
import core.models as models
from pipeline.graphs.state import ResearchState
from pipeline.orchestrator import (
    _log,
    get_enabled_markets,
    setup_agent_prompts,
    fetch_research_items,
    build_shared_retrieval_context,
)
from graph.knowledge import upsert_asset_nodes, ingest_retrieval_to_graph


# ── Nodes ─────────────────────────────────────────────────────────────────────

def node_setup(state: ResearchState) -> dict:
    """Resolve enabled markets and set up agent prompts."""
    run_id = state["run_id"]
    db = SessionLocal()
    try:
        run = db.query(models.PipelineRun).filter(
            models.PipelineRun.run_id == run_id
        ).first()
        if not run:
            return {"error": f"PipelineRun {run_id} not found"}

        run.step = "research"
        db.commit()

        _log(db, run_id, "START", "IN_PROGRESS", "Pipeline started — setting up agents & markets")
        setup_agent_prompts(db)

        focus_tickers = state.get("focus_tickers")
        if focus_tickers:
            enabled_markets = {"Focused": focus_tickers}
        else:
            enabled_markets = get_enabled_markets(db)

        run.enabled_markets_json = json.dumps(enabled_markets)
        db.commit()

        return {"enabled_markets": enabled_markets}
    except Exception as e:
        try:
            _log(db, run_id, "START", "ERROR", str(e)[:300])
        except Exception:
            pass
        return {"error": str(e)}
    finally:
        db.close()


def node_web_research(state: ResearchState) -> dict:
    """Fetch web research articles."""
    run_id = state["run_id"]
    enabled_markets = state["enabled_markets"]
    investment_focus = state.get("investment_focus", "")
    db = SessionLocal()
    try:
        all_tickers = [sym for tickers in enabled_markets.values() for sym in tickers]
        _log(db, run_id, "WEB_RESEARCH", "IN_PROGRESS",
             f"Fetching research for {len(all_tickers)} tickers across {', '.join(enabled_markets.keys())}")

        research_items = fetch_research_items(
            db, run_id, enabled_markets, investment_focus=investment_focus
        )

        # Fallback: use cached articles if fresh fetch returned nothing
        if not research_items:
            from datetime import timedelta, datetime as _dt
            cutoff = _dt.utcnow() - timedelta(hours=6)
            cached_rows = db.query(models.WebResearch).filter(
                models.WebResearch.fetched_at >= cutoff
            ).all()
            if cached_rows:
                research_items = [
                    {"title": r.title, "snippet": r.snippet,
                     "source_url": r.source_url, "query": r.query}
                    for r in cached_rows
                ]
                _log(db, run_id, "WEB_RESEARCH", "IN_PROGRESS",
                     f"Fresh fetch returned 0 — using {len(research_items)} cached articles (< 6h old)")

        _log(db, run_id, "WEB_RESEARCH", "IN_PROGRESS",
             f"Research fetched — {len(research_items)} articles ready for KG ingest")

        return {"research_items": research_items}
    except Exception as e:
        try:
            _log(db, run_id, "WEB_RESEARCH", "ERROR", str(e)[:300])
        except Exception:
            pass
        return {"error": str(e)}
    finally:
        db.close()


def node_kg_ingest(state: ResearchState) -> dict:
    """Ingest research into knowledge graph (non-fatal — errors are swallowed)."""
    run_id = state["run_id"]
    enabled_markets = state["enabled_markets"]
    research_items = state["research_items"]
    db = SessionLocal()
    try:
        from concurrent.futures import ThreadPoolExecutor, TimeoutError as _FutureTimeout
        from sqlalchemy import func as _func
        import traceback as _tb

        all_tickers = [sym for tickers in enabled_markets.values() for sym in tickers]
        upsert_asset_nodes(db, all_tickers)
        _log(db, run_id, "KG_INGEST", "IN_PROGRESS",
             f"Extracting structured events from {len(research_items)} articles → updating graph…")

        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(ingest_retrieval_to_graph, db, research_items, run_id)
            try:
                edges_added = future.result(timeout=150)
                try:
                    rel_counts = db.query(models.KGEdge.relation, _func.count(models.KGEdge.id))\
                        .filter(models.KGEdge.source_run_id == run_id)\
                        .group_by(models.KGEdge.relation).all()
                    rel_summary = ", ".join(
                        f"{r}×{c}" for r, c in sorted(rel_counts, key=lambda x: -x[1])[:5]
                    ) if rel_counts else "none"
                except Exception:
                    rel_summary = f"{edges_added} edges"
                _log(db, run_id, "KG_INGEST", "DONE",
                     f"{edges_added} new edges added — relation types: {rel_summary}")
                return {"kg_edges_added": edges_added}
            except _FutureTimeout:
                _log(db, run_id, "KG_INGEST", "WARN",
                     "KG ingest timed out after 150s — continuing without full graph update")
                return {"kg_edges_added": 0}
    except Exception as kg_err:
        import traceback as _tb
        try:
            _log(db, run_id, "KG_INGEST", "ERROR",
                 f"KG ingest failed: {str(kg_err)[:300]} | {_tb.format_exc()[-300:]}")
        except Exception:
            pass
        # Non-fatal — don't set error, let pipeline continue
        return {"kg_edges_added": 0}
    finally:
        db.close()


def node_build_context(state: ResearchState) -> dict:
    """Build the shared context string from research + KG."""
    run_id = state["run_id"]
    enabled_markets = state["enabled_markets"]
    research_items = state["research_items"]
    investment_focus = state.get("investment_focus", "")
    db = SessionLocal()
    try:
        shared_context, research_log, _ = build_shared_retrieval_context(
            db, run_id, enabled_markets,
            investment_focus=investment_focus,
            research_items=research_items,
        )
        _log(db, run_id, "WEB_RESEARCH", "DONE",
             f"Research complete — {len(research_items)} articles ingested, context built for agents")
        return {"shared_context": shared_context, "research_log": research_log}
    except Exception as e:
        try:
            _log(db, run_id, "WEB_RESEARCH", "ERROR", str(e)[:300])
        except Exception:
            pass
        return {"error": str(e)}
    finally:
        db.close()


def node_save_research(state: ResearchState) -> dict:
    """Persist context to AppConfig for the trade pipeline and mark run done."""
    run_id = state["run_id"]
    shared_context = state["shared_context"]
    research_log = state.get("research_log", [])
    enabled_markets = state["enabled_markets"]
    db = SessionLocal()
    try:
        run = db.query(models.PipelineRun).filter(
            models.PipelineRun.run_id == run_id
        ).first()

        context_payload = json.dumps({"context": shared_context, "research_log": research_log})
        if run:
            run.shared_context = context_payload

        for key, val in [
            ("last_research_context", shared_context),
            ("last_research_markets", json.dumps(enabled_markets)),
            ("last_research_run_id",  run_id),
        ]:
            conf = db.query(models.AppConfig).filter(models.AppConfig.key == key).first()
            if conf:
                conf.value = val
            else:
                db.add(models.AppConfig(key=key, value=val))

        if run:
            run.step = "done"
            _release_lock(db, "research_running")
        db.commit()
        _log(db, run_id, "MEMORY_WRITE", "DONE",
             "Research pipeline complete — context saved for trade pipeline")
        return {}
    except Exception as e:
        try:
            db.rollback()
            _log(db, run_id, "MEMORY_WRITE", "ERROR", str(e)[:300])
        except Exception:
            pass
        return {"error": str(e)}
    finally:
        db.close()


def node_error(state: ResearchState) -> dict:
    """Terminal error handler — marks run as failed and releases lock."""
    run_id = state["run_id"]
    error_msg = state.get("error", "Unknown error")
    db = SessionLocal()
    try:
        run = db.query(models.PipelineRun).filter(
            models.PipelineRun.run_id == run_id
        ).first()
        if run:
            run.step = "error"
            _release_lock(db, "research_running")
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()
    return {}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _release_lock(db, lock_key: str):
    conf = db.query(models.AppConfig).filter(models.AppConfig.key == lock_key).first()
    if conf:
        conf.value = "0"


def _route(state: ResearchState) -> str:
    return "error" if state.get("error") else "__continue__"


# ── Graph ─────────────────────────────────────────────────────────────────────

def build_research_graph():
    g = StateGraph(ResearchState)

    g.add_node("setup",          node_setup)
    g.add_node("web_research",   node_web_research)
    g.add_node("kg_ingest",      node_kg_ingest)
    g.add_node("build_context",  node_build_context)
    g.add_node("save_research",  node_save_research)
    g.add_node("error",          node_error)

    g.set_entry_point("setup")

    g.add_conditional_edges("setup", _route,
                            {"error": "error", "__continue__": "web_research"})
    g.add_conditional_edges("web_research", _route,
                            {"error": "error", "__continue__": "kg_ingest"})
    # KG ingest is non-fatal — always continues
    g.add_edge("kg_ingest",     "build_context")
    g.add_conditional_edges("build_context", _route,
                            {"error": "error", "__continue__": "save_research"})
    g.add_edge("save_research", END)
    g.add_edge("error",         END)

    return g.compile()
