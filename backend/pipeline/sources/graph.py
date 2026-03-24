from pipeline.sources import BaseDataSource
from graph.knowledge import upsert_asset_nodes, ingest_retrieval_to_graph
from pipeline.orchestrator import build_shared_retrieval_context, _log
import traceback as _tb
import sqlalchemy as sa
import core.models as models

class GraphDataSource(BaseDataSource):
    """Handles graph insertions and queries for debate steps."""
    
    def ingest_research(self, db, run_id: str, all_tickers: list[str], research_items: list[dict]):
        _log(db, run_id, "KG_INGEST", "IN_PROGRESS", f"Stage 1: compressing {len(research_items)} articles into facts…")
        try:
            upsert_asset_nodes(db, all_tickers)
            result = ingest_retrieval_to_graph(db, research_items, run_id)
            edges_added, nodes_added = result if isinstance(result, tuple) else (result, 0)

            try:
                rel_counts = db.query(models.KGEdge.relation, sa.func.count(models.KGEdge.id))\
                    .filter(models.KGEdge.source_run_id == run_id)\
                    .group_by(models.KGEdge.relation).all()
                rel_summary = ", ".join(f"{r}×{c}" for r, c in sorted(rel_counts, key=lambda x: -x[1])[:5]) if rel_counts else "none"
            except Exception:
                rel_summary = f"{edges_added} edges"

            _log(db, run_id, "KG_INGEST", "DONE",
                 f"{nodes_added} new nodes · {edges_added} edges added — relation types: {rel_summary}")
        except Exception as kg_err:
            err_msg = f"KG ingest failed [{type(kg_err).__name__}]: {str(kg_err)[:250]} | traceback: {_tb.format_exc()[-350:]}"
            # Session may be broken after a rollback — reset it before logging
            try:
                db.rollback()
            except Exception:
                pass
            try:
                _log(db, run_id, "KG_INGEST", "ERROR", err_msg)
            except Exception:
                # Last resort: use a fresh session for the error log
                from core.database import SessionLocal
                _db2 = SessionLocal()
                try:
                    _log(_db2, run_id, "KG_INGEST", "ERROR", err_msg)
                    _db2.commit()
                finally:
                    _db2.close()
            raise kg_err
            
    def fetch_shared_context(self, db, run_id: str, enabled_markets: dict, investment_focus: str, research_items: list[dict]):
        shared_context, research_log, _ = build_shared_retrieval_context(
            db, run_id, enabled_markets, investment_focus=investment_focus, research_items=research_items
        )
        return shared_context, research_log
