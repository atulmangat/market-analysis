from pipeline.sources import BaseDataSource
from pipeline.orchestrator import fetch_research_items, _log

class WebResearchSource(BaseDataSource):
    """Fetches raw web research, news, and prices for tickers."""
    
    def fetch(self, db, run_id: str, enabled_markets: dict, investment_focus: str) -> list[dict]:
        from concurrent.futures import ThreadPoolExecutor as _ResearchPool, TimeoutError as _ResearchTimeout
        
        try:
            with _ResearchPool(max_workers=1) as _rpool:
                _rf = _rpool.submit(fetch_research_items, db, run_id, enabled_markets, investment_focus)
                research_items = _rf.result(timeout=240)  # 4-minute soft cap on research fetch
        except _ResearchTimeout:
            _log(db, run_id, "WEB_RESEARCH", "IN_PROGRESS", "Research fetch timed out after 4 minutes — falling back to cached articles")
            research_items = []
        
        return research_items
