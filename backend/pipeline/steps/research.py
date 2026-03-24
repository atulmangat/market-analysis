import json
from datetime import datetime
from pipeline.steps.base import BaseStep
from pipeline.engine import PipelineContext
from pipeline.sources.web import WebResearchSource
from pipeline.sources.graph import GraphDataSource
from pipeline.orchestrator import setup_agent_prompts, get_enabled_markets, _log
import core.models as models

class WebResearchStep(BaseStep):
    def __init__(self):
        self.web_source = WebResearchSource()
        self.graph_source = GraphDataSource()

    @property
    def name(self) -> str:
        return "research"

    def get_log_step(self) -> str:
        return "WEB_RESEARCH"

    def execute(self, context: PipelineContext) -> None:
        db = context.db
        run_id = context.run_id

        # Setup agents
        setup_agent_prompts(db)

        # Determine markets
        if context.focus_tickers:
            context.enabled_markets = {"Focused": context.focus_tickers}
            _log(db, run_id, "START", "IN_PROGRESS", f"Pipeline started — focused on {', '.join(context.focus_tickers)}")
        else:
            context.enabled_markets = get_enabled_markets(db)
            _log(db, run_id, "START", "IN_PROGRESS", "Pipeline started — setting up agents & markets")

        context.save_to_db()
        _log(db, run_id, "START", "DONE", f"Initialised — {len([sym for tickers in context.enabled_markets.values() for sym in tickers])} tickers across {', '.join(context.enabled_markets.keys())}")

        all_tickers = [sym for tickers in context.enabled_markets.values() for sym in tickers]

        # 1: Fetch raw research
        if context.focus_tickers:
            _log(db, run_id, self.get_log_step(), "IN_PROGRESS", f"Fetching research focused on: {', '.join(context.focus_tickers)}")
        else:
            _log(db, run_id, self.get_log_step(), "IN_PROGRESS", f"Fetching research for {len(all_tickers)} tickers across {', '.join(context.enabled_markets.keys())}")
            
        research_items = self.web_source.fetch(db, run_id, context.enabled_markets, context.investment_focus)

        new_items = [r for r in research_items if r.get("is_new", True)]
        seen_count = len(research_items) - len(new_items)

        if not research_items:
            _log(db, run_id, self.get_log_step(), "IN_PROGRESS", "Research fetch returned 0 articles — Tavily returned no results")
            context.lessons.append("LESSON: No fresh articles were fetched this run — rely on existing knowledge graph context and historical memory.")
        elif not new_items:
            _log(db, run_id, self.get_log_step(), "IN_PROGRESS",
                 f"No new articles found ({seen_count} already seen) — agents will use existing KG context")
            context.lessons.append(f"LESSON: All {seen_count} fetched articles were already seen in a prior run — no new events have emerged since the last pipeline cycle. Weight recent KG data and agent memory more heavily.")
        else:
            seen_note = f" ({seen_count} already seen)" if seen_count else ""
            _log(db, run_id, self.get_log_step(), "IN_PROGRESS",
                 f"{len(new_items)} new articles ready for KG ingest{seen_note}")
            if seen_count:
                context.lessons.append(f"LESSON: {len(new_items)} new articles ingested this run ({seen_count} were repeats from prior cycles — not re-ingested).")
            # Persist only new articles to WebResearch table
            self._save_to_web_research(db, new_items)

        # 2: Ingest to Graph — only new articles (non-fatal)
        try:
            self.graph_source.ingest_research(db, run_id, all_tickers, new_items)
        except Exception as kg_err:
            # Rollback any broken transaction before logging or continuing
            try:
                db.rollback()
            except Exception:
                pass
            _log(db, run_id, "KG_INGEST", "WARN", f"KG ingest skipped (non-fatal): {str(kg_err)[:200]}")

        # 3: Fetch Shared Context from Graph — pass all articles (new + seen) for agent context
        _log(db, run_id, "WEB_RESEARCH", "IN_PROGRESS", "Building retrieval context from knowledge graph…")
        shared_context, research_log = self.graph_source.fetch_shared_context(
            db, run_id, context.enabled_markets, context.investment_focus, research_items  # all, not just new_items
        )

        # Save context
        context.shared_data = {
            "context": shared_context,
            "research_log": research_log,
        }
        context.save_to_db()

    def _save_to_web_research(self, db, research_items: list[dict]) -> None:
        """Persist fetched articles to WebResearch table (replaces previous batch)."""
        try:
            # Keep last 500 rows total — delete oldest to stay lean
            total = db.query(models.WebResearch).count()
            if total > 400:
                oldest = db.query(models.WebResearch).order_by(models.WebResearch.fetched_at.asc()).limit(total - 300).all()
                for row in oldest:
                    db.delete(row)
            now = datetime.utcnow()
            for item in research_items:
                row = models.WebResearch(
                    query=item.get("query", ""),
                    source_url=item.get("source_url", ""),
                    title=item.get("title", ""),
                    snippet=item.get("snippet", ""),
                    fetched_at=now,
                )
                db.add(row)
            db.commit()
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass
