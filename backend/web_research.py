"""
Web Research Module — fetches real-time news via Google News RSS + Yahoo Finance.
Results are cached in the WebResearch table with a 30-minute cooldown.
"""
import feedparser
import yfinance as yf
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from database import SessionLocal
import models
import random
import re
import urllib.parse


# ── Google News RSS ──────────────────────────────────────────────────────────

GOOGLE_NEWS_RSS = "https://news.google.com/rss/search?q={query}&hl=en&gl=US&ceid=US:en"

DEFAULT_TOPICS = [
    "stock market today",
    "cryptocurrency news",
    "commodities gold oil",
    "global economy",
    "Federal Reserve interest rates",
]

CACHE_COOLDOWN_MINUTES = 30


def _strip_html(text: str) -> str:
    """Remove HTML tags and decode HTML entities from a string."""
    import html
    text = re.sub(r'<[^>]+>', ' ', text)
    text = html.unescape(text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def _extract_google_url(entry) -> str:
    """
    Google News RSS wraps real URLs in a redirect. Try to extract the real URL
    from the entry source or fall back to the redirect link.
    """
    # feedparser sometimes puts the real source in entry.source.href
    src = getattr(entry, 'source', None)
    if src:
        href = getattr(src, 'href', None) or src.get('href', '')
        if href and 'news.google.com' not in href:
            return href

    # Try to pull from the summary HTML: <a href="REAL_URL">
    summary = entry.get('summary', '')
    match = re.search(r'<a href="([^"]+)"', summary)
    if match:
        url = match.group(1)
        if 'news.google.com' not in url:
            return url

    # Fall back to the Google redirect link (still works, just ugly)
    return entry.get('link', '')


def _fetch_google_news(query: str, max_items: int = 5) -> list[dict]:
    """Fetch headlines from Google News RSS for a given query."""
    url = GOOGLE_NEWS_RSS.format(query=query.replace(" ", "+"))
    try:
        feed = feedparser.parse(url)
        results = []
        for entry in feed.entries[:max_items]:
            title = _strip_html(entry.get("title", ""))
            snippet = _strip_html(entry.get("summary", ""))[:300]
            source_url = _extract_google_url(entry)
            results.append({
                "title": title,
                "snippet": snippet,
                "source_url": source_url,
                "published": entry.get("published", ""),
                "query": query,
            })
        return results
    except Exception as e:
        print(f"[WebResearch] Google News fetch failed for '{query}': {e}")
        return []


def _fetch_yfinance_news(tickers: list[str] = None, max_items: int = 5) -> list[dict]:
    """Fetch news from Yahoo Finance for trending/specified tickers."""
    if not tickers:
        tickers = ["SPY", "BTC-USD", "GC=F"]  # Market, Crypto, Gold as defaults
    else:
        # Shuffle to get fresh news for different assets every time
        random.shuffle(tickers)
    
    results = []
    for symbol in tickers[:4]:  # Limit to 4 random enabled tickers to avoid slow fetches
        try:
            ticker = yf.Ticker(symbol)
            news = getattr(ticker, 'news', None)
            if news:
                for item in news[:max_items]:
                    results.append({
                        "title": item.get("title", ""),
                        "snippet": item.get("summary", item.get("title", ""))[:300],
                        "source_url": item.get("link", ""),
                        "published": item.get("providerPublishTime", ""),
                        "query": f"yfinance:{symbol}",
                    })
        except Exception as e:
            print(f"[WebResearch] YFinance news failed for {symbol}: {e}")
    return results


# ── Public API ───────────────────────────────────────────────────────────────

def fetch_web_research(topics: list[str] = None, use_cache: bool = True, enabled_tickers: dict = None) -> list[dict]:
    """
    Fetch web research from multiple sources.
    Returns list of {title, snippet, source_url, published, query}.
    Results are cached in the DB for CACHE_COOLDOWN_MINUTES.
    """
    if topics is None:
        topics = DEFAULT_TOPICS

    db = SessionLocal()
    all_results = []

    # Check cache freshness
    if use_cache:
        cutoff = datetime.utcnow() - timedelta(minutes=CACHE_COOLDOWN_MINUTES)
        cached = db.query(models.WebResearch).filter(
            models.WebResearch.fetched_at >= cutoff
        ).all()

        if cached:
            print(f"[WebResearch] Using {len(cached)} cached results (< {CACHE_COOLDOWN_MINUTES}min old)")
            db.close()
            return [
                {
                    "title": r.title,
                    "snippet": r.snippet,
                    "source_url": r.source_url,
                    "query": r.query,
                }
                for r in cached
            ]

    # Fetch fresh results
    print("[WebResearch] Fetching fresh research from web sources...")
    
    # Google News RSS
    for topic in topics[:5]: # Ensure we don't query Google RSS too many times
        results = _fetch_google_news(topic, max_items=2)
        all_results.extend(results)

    # Compile pool of all uniquely enabled tickers to fetch news for
    ticker_pool = []
    if enabled_tickers:
        for market_tickers in enabled_tickers.values():
            ticker_pool.extend(market_tickers)

    # Yahoo Finance news (picks 4 random tickers from pool)
    yf_results = _fetch_yfinance_news(tickers=ticker_pool if ticker_pool else None, max_items=3)
    all_results.extend(yf_results)

    # De-duplicate by title
    seen_titles = set()
    unique_results = []
    for r in all_results:
        if r["title"] not in seen_titles and r["title"]:
            seen_titles.add(r["title"])
            unique_results.append(r)

    # Cache results in DB
    for r in unique_results:
        record = models.WebResearch(
            query=r.get("query", ""),
            source_url=r.get("source_url", ""),
            title=r.get("title", ""),
            snippet=r.get("snippet", ""),
        )
        db.add(record)

    try:
        db.commit()
        print(f"[WebResearch] Cached {len(unique_results)} fresh research items")
    except Exception as e:
        print(f"[WebResearch] DB cache write failed: {e}")
        db.rollback()
    finally:
        db.close()

    return unique_results


def format_research_for_context(research: list[dict], max_items: int = 15) -> str:
    """Format research results into a string suitable for LLM context."""
    if not research:
        return "No recent web research available."

    lines = ["## Latest Web Research & News\n"]
    for i, r in enumerate(research[:max_items], 1):
        title = r.get("title", "Unknown")
        snippet = r.get("snippet", "")
        source = r.get("source_url", "")
        lines.append(f"{i}. **{title}**")
        if snippet:
            lines.append(f"   {snippet}")
        if source:
            lines.append(f"   Source: {source}")
        lines.append("")

    return "\n".join(lines)
