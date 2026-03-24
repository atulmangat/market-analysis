"""
Web Research Module — fetches real-time news via Tavily Search API.

All market research is delegated to Tavily (topic=news), which returns clean
plain-text snippets from authoritative sources. No RSS parsing needed.

Results are cached in the WebResearch table for CACHE_COOLDOWN_MINUTES.
Deduplication: articles already seen (by title_key) are filtered out via
the seen_articles table (30-day expiry) so the KG only ingests new events.
"""
import os
import httpx
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from core.database import SessionLocal
import core.models as models
import re
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed as _as_completed
from dotenv import load_dotenv

load_dotenv()

CACHE_COOLDOWN_MINUTES = 30
NEWS_MAX_AGE_HOURS     = 168  # 7 days — Tavily results can be up to a week old for niche tickers
SEEN_ARTICLE_TTL_DAYS  = 30


# ── Helpers ───────────────────────────────────────────────────────────────

def _title_key(title: str) -> str:
    words = title.lower().split()
    return " ".join(words[:20])


def _source_domain(url: str) -> str:
    try:
        return urllib.parse.urlparse(url).netloc.lstrip("www.") or "unknown"
    except Exception:
        return "unknown"


# ── Tavily fetcher ─────────────────────────────────────────────────────────

def _tavily_search(query: str, max_results: int = 5, search_depth: str = "basic", topic: str = "news") -> list[dict]:
    """
    Search via Tavily SDK.
    topic="news"    → recent news articles (use days=7 filter)
    topic="general" → broad web search (no days filter, good for stock discovery)
    Returns normalised {title, snippet, source_url, query, published} dicts.
    Falls back gracefully on any error.
    """
    api_key = os.getenv("TAVILY_API_KEY", "")
    if not api_key:
        print("[WebResearch] TAVILY_API_KEY not set — skipping Tavily search")
        return []
    try:
        from tavily import TavilyClient
        client = TavilyClient(api_key=api_key)
        params = dict(
            query=query,
            topic=topic,
            search_depth=search_depth,
            max_results=max_results,
            include_answer=True,
        )
        if topic == "news":
            params["days"] = 7      # last 7 days — Tavily filters server-side
        response = client.search(**params)
        results = []
        # Include the AI answer as a synthetic first result if present
        answer = (response.get("answer") or "").strip()
        if answer:
            results.append({
                "title":      f"[Summary] {query}",
                "snippet":    answer[:500],
                "source_url": "",
                "query":      f"tavily:{query}",
                "published":  "",
            })
        for r in response.get("results", []):
            title = (r.get("title") or "").strip()
            if not title:
                continue
            results.append({
                "title":      title,
                "snippet":    (r.get("content") or "")[:500].strip(),
                "source_url": r.get("url", ""),
                "query":      f"tavily:{query}",
                "published":  r.get("published_date", ""),
            })
        return results
    except Exception as e:
        print(f"[WebResearch] Tavily search failed for '{query}': {e}")
        return []


# ── Dedup / staleness helpers ──────────────────────────────────────────────

def _expire_seen_articles(db: Session) -> None:
    try:
        db.query(models.SeenArticle).filter(
            models.SeenArticle.expires_at < datetime.utcnow()
        ).delete(synchronize_session=False)
        db.commit()
    except Exception:
        db.rollback()


def filter_and_record_new_articles(db: Session, articles: list[dict]) -> list[dict]:
    if not articles:
        return []

    _expire_seen_articles(db)

    candidate_keys = [_title_key(a.get("title", "")) for a in articles]
    candidate_keys = [k for k in candidate_keys if k]

    existing_keys: set[str] = set()
    try:
        rows = db.query(models.SeenArticle.title_key).filter(
            models.SeenArticle.title_key.in_(candidate_keys)
        ).all()
        existing_keys = {r.title_key for r in rows}
    except Exception:
        pass

    new_articles: list[dict] = []
    to_insert: list[dict] = []
    expires = datetime.utcnow() + timedelta(days=SEEN_ARTICLE_TTL_DAYS)

    for article in articles:
        key = _title_key(article.get("title", ""))
        if not key or key in existing_keys:
            continue
        existing_keys.add(key)
        new_articles.append(article)
        to_insert.append({
            "title_key":     key,
            "source_domain": _source_domain(article.get("source_url", "")),
            "first_seen_at": datetime.utcnow(),
            "expires_at":    expires,
        })

    if to_insert:
        try:
            db.bulk_insert_mappings(models.SeenArticle, to_insert)
            db.commit()
        except Exception:
            db.rollback()
            for row in to_insert:
                try:
                    db.add(models.SeenArticle(**row))
                    db.commit()
                except Exception:
                    db.rollback()

    return new_articles


def _filter_stale(items: list[dict], max_age_hours: int = NEWS_MAX_AGE_HOURS) -> list[dict]:
    """Drop items with a published_date older than max_age_hours. Items with no date are kept."""
    if max_age_hours <= 0:
        return items

    cutoff = datetime.utcnow() - timedelta(hours=max_age_hours)
    kept = []
    for item in items:
        published = item.get("published", "")
        if not published:
            kept.append(item)
            continue
        try:
            from email.utils import parsedate_to_datetime
            import datetime as _dt_mod
            pub_dt = parsedate_to_datetime(published)
            if pub_dt.tzinfo is not None:
                pub_dt = pub_dt.astimezone(_dt_mod.timezone.utc).replace(tzinfo=None)
            if pub_dt >= cutoff:
                kept.append(item)
        except Exception:
            kept.append(item)

    dropped = len(items) - len(kept)
    if dropped:
        print(f"[WebResearch] Staleness filter: dropped {dropped} items older than {max_age_hours}h")
    return kept


# ── Public API ────────────────────────────────────────────────────────────

def fetch_web_research(
    topics: list[str] = None,
    use_cache: bool = False,
    enabled_tickers: dict = None,
    focus_tickers: list[str] = None,
) -> list[dict]:
    """
    Fetch market news via Tavily Search API.
    Returns list of {title, snippet, source_url, query}.

    Builds queries from enabled markets and tickers, runs them in parallel,
    then deduplicates and filters stale results.
    """
    if not os.getenv("TAVILY_API_KEY", ""):
        print("[WebResearch] WARNING: TAVILY_API_KEY not set — no research will be fetched")
        return []

    db = SessionLocal()

    # ── Cache check ────────────────────────────────────────────────────────
    if use_cache:
        cutoff = datetime.utcnow() - timedelta(minutes=CACHE_COOLDOWN_MINUTES)
        cached = db.query(models.WebResearch).filter(
            models.WebResearch.fetched_at >= cutoff
        ).all()
        if cached:
            print(f"[WebResearch] Using {len(cached)} cached results (< {CACHE_COOLDOWN_MINUTES}min old)")
            db.close()
            return [
                {"title": r.title, "snippet": r.snippet, "source_url": r.source_url, "query": r.query}
                for r in cached
            ]

    print("[WebResearch] Fetching research via Tavily...")

    active_markets = list(enabled_tickers.keys()) if enabled_tickers else ["US"]
    ticker_pool: list[str] = []
    if enabled_tickers:
        for tickers in enabled_tickers.values():
            ticker_pool.extend(tickers)

    # ── Build query list ───────────────────────────────────────────────────
    queries: list[str] = []

    if focus_tickers:
        # Focused run: only search for the specific tickers
        for sym in focus_tickers:
            clean = sym.replace(".NS", "").replace(".BO", "").replace("-USD", "").replace("=F", "")
            queries.append(f"{clean} stock news")
            queries.append(f"{clean} price forecast analysis")
    else:
        # Broad run: macro + per-market + per-ticker queries
        queries += ["stock market news today", "global economy outlook"]
        if "Crypto" in active_markets:
            queries.append("Bitcoin Ethereum crypto market")
        if "India" in active_markets:
            queries.append("Nifty Sensex Indian stock market")
        if "MCX" in active_markets:
            queries.append("gold oil commodity prices")
        if "US" in active_markets:
            queries.append("Federal Reserve interest rates")
        # Add individual ticker queries (sample to stay within rate limits)
        import random
        sample = random.sample(ticker_pool, min(8, len(ticker_pool))) if ticker_pool else []
        for sym in sample:
            clean = sym.replace(".NS", "").replace(".BO", "").replace("-USD", "").replace("=F", "")
            queries.append(f"{clean} stock news")

    # ── Parallel Tavily calls ──────────────────────────────────────────────
    all_results: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(len(queries), 10)) as pool:
        futures = {pool.submit(_tavily_search, q, 5): q for q in queries}
        for future in _as_completed(futures):
            try:
                all_results.extend(future.result())
            except Exception:
                pass

    # ── URL dedup — same article often appears across parallel queries ──────
    seen_urls: set[str] = set()
    url_deduped: list[dict] = []
    for r in all_results:
        url = r.get("source_url", "")
        if url and url in seen_urls:
            continue
        if url:
            seen_urls.add(url)
        url_deduped.append(r)
    all_results = url_deduped

    # ── Title dedup — catches same story at different URLs ──────────────────
    seen_titles: set[str] = set()
    unique_results: list[dict] = []
    for r in all_results:
        key = _title_key(r.get("title", ""))
        if key and key not in seen_titles:
            seen_titles.add(key)
            unique_results.append(r)

    # ── Persistent dedup — mark new vs already-seen, but return ALL articles
    # Articles are marked is_new=True only on first appearance (for KG ingest).
    # The full list is always returned so agents always have context.
    new_articles = filter_and_record_new_articles(db, unique_results)
    new_keys = {_title_key(a.get("title", "")) for a in new_articles}
    for r in unique_results:
        r["is_new"] = _title_key(r.get("title", "")) in new_keys

    already_seen = len(unique_results) - len(new_articles)
    if already_seen:
        print(f"[WebResearch] {len(unique_results)} articles ({len(new_articles)} new, {already_seen} already seen — all passed to agents)")
    else:
        print(f"[WebResearch] {len(unique_results)} new articles fetched via Tavily")

    db.close()
    return unique_results


def format_research_for_context(research: list[dict], max_items: int = 20) -> str:
    """Format research results into a string suitable for LLM context."""
    if not research:
        return "No recent web research available."

    lines = ["## Latest Market News & Research\n"]
    for i, r in enumerate(research[:max_items], 1):
        title   = r.get("title", "Unknown")
        snippet = r.get("snippet", "")
        source  = r.get("source_url", "")
        lines.append(f"{i}. **{title}**")
        if snippet and snippet != title:
            lines.append(f"   {snippet}")
        if source:
            lines.append(f"   Source: {source}")
        lines.append("")

    return "\n".join(lines)
