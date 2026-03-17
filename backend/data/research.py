"""
Web Research Module — fetches real-time news from curated reliable sources.

Sources by market:
  Global / Macro : Reuters, CNBC, MarketWatch, Benzinga, Nasdaq
  Crypto         : CoinDesk, CoinTelegraph, CryptoSlate
  India          : Economic Times Markets, Moneycontrol, Livemint
  Commodities    : Investing.com metals/oil, CNBC commodities
  Social signals : Stocktwits trending (X/Twitter proxy, no auth needed)
  Sentiment      : Alpha Vantage News Sentiment (scored, ticker-aware)
  Social         : Reddit WallStreetBets JSON (unauthenticated)

Results are cached in the WebResearch table for CACHE_COOLDOWN_MINUTES.
Staleness filter: items older than NEWS_MAX_AGE_HOURS are excluded.
"""
import os
import feedparser
import httpx
import yfinance as yf
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from core.database import SessionLocal
import core.models as models
import random
import re
import urllib.parse


CACHE_COOLDOWN_MINUTES = 30
NEWS_MAX_AGE_HOURS     = 48   # drop news older than this to avoid stale signals

ALPHA_VANTAGE_API_KEY  = os.getenv("ALPHA_VANTAGE_API_KEY", "")


# ── Curated RSS feed registry ──────────────────────────────────────────────

RSS_GLOBAL = [
    # MarketWatch (confirmed working)
    ("https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines", "MarketWatch Real-Time"),
    ("https://feeds.marketwatch.com/marketwatch/topstories/", "MarketWatch Top Stories"),
    ("https://feeds.marketwatch.com/marketwatch/marketpulse/", "MarketWatch Pulse"),
    # WSJ (confirmed working)
    ("https://feeds.a.dj.com/rss/RSSMarketsMain.xml", "WSJ Markets"),
    # FT (confirmed working)
    ("https://www.ft.com/rss/home", "Financial Times"),
    # NYT Business (confirmed working)
    ("https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", "NYT Business"),
    # Washington Post (confirmed working)
    ("https://feeds.washingtonpost.com/rss/business", "Washington Post Business"),
    # Seeking Alpha (confirmed working)
    ("https://seekingalpha.com/market_currents.xml", "Seeking Alpha"),
    # Investing.com (confirmed working)
    ("https://www.investing.com/rss/news.rss", "Investing.com"),
]

RSS_CRYPTO = [
    ("https://cointelegraph.com/feed", "CoinTelegraph"),
    ("https://cryptoslate.com/feed/", "CryptoSlate"),
    ("https://bitcoinmagazine.com/.rss/full/", "Bitcoin Magazine"),
    ("https://decrypt.co/feed", "Decrypt"),
]

RSS_INDIA = [
    ("https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms", "Economic Times Markets"),
    ("https://www.moneycontrol.com/rss/MCtopnews.xml", "Moneycontrol"),
    ("https://www.livemint.com/rss/markets", "Livemint Markets"),
    ("https://www.thehindu.com/business/feeder/default.rss", "The Hindu Business"),
]

RSS_COMMODITIES = [
    ("https://www.investing.com/rss/news.rss", "Investing.com"),
    ("https://feeds.marketwatch.com/marketwatch/marketpulse/", "MarketWatch Pulse"),
    ("https://feeds.a.dj.com/rss/RSSMarketsMain.xml", "WSJ Markets"),
]

# Google News RSS — used for targeted ticker / topic queries only
GOOGLE_NEWS_RSS = "https://news.google.com/rss/search?q={query}&hl=en&gl=US&ceid=US:en"

# Map market name → which RSS groups to include
MARKET_RSS_MAP = {
    "US":          RSS_GLOBAL,
    "Crypto":      RSS_CRYPTO + RSS_GLOBAL[:2],   # crypto feeds + Reuters macro
    "India":       RSS_INDIA + RSS_GLOBAL[:2],
    "MCX":         RSS_COMMODITIES + RSS_GLOBAL[:2],
    "Focused":     RSS_GLOBAL,
}

# Stocktwits trending — free JSON, no auth, acts as X/social signal proxy
STOCKTWITS_TRENDING_URL = "https://api.stocktwits.com/api/2/trending/symbols.json"
STOCKTWITS_STREAM_URL   = "https://api.stocktwits.com/api/2/streams/symbol/{symbol}.json?limit=10"


# ── Helpers ───────────────────────────────────────────────────────────────

def _strip_html(text: str) -> str:
    import html
    text = re.sub(r'<[^>]+>', ' ', text)
    text = html.unescape(text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def _extract_google_url(entry) -> str:
    src = getattr(entry, 'source', None)
    if src:
        href = getattr(src, 'href', None) or src.get('href', '')
        if href and 'news.google.com' not in href:
            return href
    summary = entry.get('summary', '')
    match = re.search(r'<a href="([^"]+)"', summary)
    if match:
        url = match.group(1)
        if 'news.google.com' not in url:
            return url
    return entry.get('link', '')


# ── Fetchers ──────────────────────────────────────────────────────────────

def _fetch_rss(url: str, label: str, max_items: int = 4) -> list[dict]:
    """Parse an RSS/Atom feed and return normalised article dicts."""
    try:
        feed = feedparser.parse(url)
        results = []
        for entry in feed.entries[:max_items]:
            title = _strip_html(entry.get("title", ""))
            snippet = _strip_html(entry.get("summary", ""))[:300]
            source_url = entry.get("link", "")
            if title:
                results.append({
                    "title": title,
                    "snippet": snippet,
                    "source_url": source_url,
                    "query": label,
                })
        return results
    except Exception as e:
        print(f"[WebResearch] RSS fetch failed ({label}): {e}")
        return []


def _fetch_google_news(query: str, max_items: int = 3) -> list[dict]:
    """Fetch headlines from Google News RSS for a targeted query."""
    url = GOOGLE_NEWS_RSS.format(query=urllib.parse.quote(query))
    try:
        feed = feedparser.parse(url)
        results = []
        for entry in feed.entries[:max_items]:
            title = _strip_html(entry.get("title", ""))
            snippet = _strip_html(entry.get("summary", ""))[:300]
            source_url = _extract_google_url(entry)
            if title:
                results.append({
                    "title": title,
                    "snippet": snippet,
                    "source_url": source_url,
                    "query": f"google:{query}",
                })
        return results
    except Exception as e:
        print(f"[WebResearch] Google News fetch failed for '{query}': {e}")
        return []


def _fetch_stocktwits(tickers: list[str], max_items: int = 2) -> list[dict]:
    """
    Fetch recent Stocktwits messages for given tickers.
    Stocktwits is the best free X/social signal proxy — aggregates
    bullish/bearish sentiment from traders (many of whom cross-post from X).
    No API key required.
    """
    results = []
    sample = random.sample(tickers, min(3, len(tickers))) if tickers else []
    for symbol in sample:
        # Stocktwits uses ticker without exchange suffix (e.g. RELIANCE.NS → RELIANCE)
        clean = symbol.split('.')[0].replace('-USD', '').replace('=F', '')
        try:
            with httpx.Client(timeout=10) as client:
                resp = client.get(
                    STOCKTWITS_STREAM_URL.format(symbol=clean),
                    headers={"User-Agent": "MarketAnalysis/1.0"},
                )
                if resp.status_code != 200:
                    continue
                data = resp.json()
                messages = data.get("messages", [])
                for msg in messages[:max_items]:
                    body = msg.get("body", "")[:300]
                    sentiment = msg.get("entities", {}).get("sentiment", {})
                    sentiment_label = sentiment.get("basic", "") if sentiment else ""
                    title = f"[Stocktwits/{clean}] {sentiment_label}: {body[:80]}..." if len(body) > 80 else f"[Stocktwits/{clean}] {body}"
                    results.append({
                        "title": title,
                        "snippet": body,
                        "source_url": f"https://stocktwits.com/symbol/{clean}",
                        "query": f"stocktwits:{clean}",
                    })
        except Exception as e:
            print(f"[WebResearch] Stocktwits fetch failed for {clean}: {e}")
    return results


def _fetch_yfinance_news(tickers: list[str], max_items: int = 3) -> list[dict]:
    """Fetch ticker-specific news from Yahoo Finance (yfinance)."""
    results = []
    random.shuffle(tickers)
    for symbol in tickers[:4]:
        try:
            ticker = yf.Ticker(symbol)
            news = getattr(ticker, 'news', None)
            if news:
                for item in news[:max_items]:
                    title = item.get("title", "")
                    if title:
                        results.append({
                            "title": title,
                            "snippet": item.get("summary", title)[:300],
                            "source_url": item.get("link", ""),
                            "query": f"yfinance:{symbol}",
                        })
        except Exception as e:
            print(f"[WebResearch] YFinance news failed for {symbol}: {e}")
    return results


def _fetch_alpha_vantage_sentiment(tickers: list[str], max_items: int = 5) -> list[dict]:
    """
    Fetch pre-scored news sentiment from Alpha Vantage News Sentiment API.
    Each article comes with an overall sentiment label + per-ticker relevance/sentiment scores.
    Requires ALPHA_VANTAGE_API_KEY env var — degrades gracefully if missing.
    """
    if not ALPHA_VANTAGE_API_KEY:
        return []

    results = []
    clean_tickers = [
        t.replace(".NS", "").replace("-USD", "").replace("=F", "")
        for t in tickers[:5]
    ]
    tickers_str = ",".join(clean_tickers)

    try:
        with httpx.Client(timeout=15) as client:
            resp = client.get(
                "https://www.alphavantage.co/query",
                params={
                    "function": "NEWS_SENTIMENT",
                    "tickers":  tickers_str,
                    "limit":    max_items * 2,
                    "sort":     "LATEST",
                    "apikey":   ALPHA_VANTAGE_API_KEY,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        feed = data.get("feed", [])
        for item in feed[:max_items]:
            title         = item.get("title", "")
            summary       = item.get("summary", "")[:300]
            url           = item.get("url", "")
            overall_sent  = item.get("overall_sentiment_label", "")

            ticker_sentiments = []
            for ts in item.get("ticker_sentiment", []):
                sym = ts.get("ticker", "")
                rel = float(ts.get("relevance_score", 0))
                label = ts.get("ticker_sentiment_label", "")
                if rel >= 0.3 and label:
                    ticker_sentiments.append(f"{sym}: {label}")

            sentiment_tag = ""
            if overall_sent:
                sentiment_tag = f" [{overall_sent}"
                if ticker_sentiments:
                    sentiment_tag += " | " + ", ".join(ticker_sentiments[:3])
                sentiment_tag += "]"

            if title:
                results.append({
                    "title":      f"{title}{sentiment_tag}",
                    "snippet":    summary,
                    "source_url": url,
                    "query":      f"alphavantage:{tickers_str}",
                })
    except Exception as e:
        print(f"[WebResearch] Alpha Vantage sentiment failed: {e}")

    return results


def _fetch_reddit_wsb(max_items: int = 5) -> list[dict]:
    """
    Fetch top posts from r/WallStreetBets using the unauthenticated JSON API.
    No API key required. Acts as a retail sentiment signal.
    """
    results = []
    try:
        with httpx.Client(
            timeout=10,
            headers={"User-Agent": "MarketAnalysis/1.0 (research bot)"},
            follow_redirects=True,
        ) as client:
            resp = client.get(
                "https://www.reddit.com/r/wallstreetbets/hot.json",
                params={"limit": max_items * 2},
            )
            if resp.status_code != 200:
                return []
            data = resp.json()

        posts = data.get("data", {}).get("children", [])
        for post in posts[:max_items]:
            p = post.get("data", {})
            title = p.get("title", "")
            score = p.get("score", 0)
            if not title or p.get("stickied") or score < 50:
                continue
            selftext = (p.get("selftext", "") or "")[:200]
            results.append({
                "title":      f"[WSB] {title} ({score:,} upvotes)",
                "snippet":    selftext,
                "source_url": f"https://reddit.com{p.get('permalink', '')}",
                "query":      "reddit:wsb",
            })
    except Exception as e:
        print(f"[WebResearch] Reddit WSB fetch failed: {e}")

    return results


def _filter_stale(items: list[dict], max_age_hours: int = NEWS_MAX_AGE_HOURS) -> list[dict]:
    """
    Remove news items older than max_age_hours.
    Items without a 'published' field are kept (can't determine their age).
    """
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
            import email.utils
            pub_dt = email.utils.parsedate_to_datetime(published)
            if pub_dt.tzinfo is not None:
                import datetime as _dt_mod
                pub_dt = pub_dt.astimezone(_dt_mod.timezone.utc).replace(tzinfo=None)
            if pub_dt >= cutoff:
                kept.append(item)
        except Exception:
            kept.append(item)

    filtered_count = len(items) - len(kept)
    if filtered_count > 0:
        print(f"[WebResearch] Staleness filter: dropped {filtered_count} items older than {max_age_hours}h")
    return kept


# ── Public API ────────────────────────────────────────────────────────────

def fetch_web_research(
    topics: list[str] = None,
    use_cache: bool = True,
    enabled_tickers: dict = None,
) -> list[dict]:
    """
    Fetch web research from curated reliable sources.
    Returns list of {title, snippet, source_url, query}.
    Results are cached in the DB for CACHE_COOLDOWN_MINUTES.

    Source priority:
      1. Curated RSS by market (Reuters, CNBC, CoinDesk, ET, etc.)
      2. Google News RSS for specific ticker / macro queries
      3. Stocktwits social sentiment (X proxy, no auth)
      4. Yahoo Finance ticker news
    """
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

    print("[WebResearch] Fetching fresh research from curated sources...")
    from concurrent.futures import ThreadPoolExecutor, as_completed as _as_completed

    if enabled_tickers:
        active_markets = list(enabled_tickers.keys())
    else:
        active_markets = ["US"]

    ticker_pool = []
    if enabled_tickers:
        for market_tickers in enabled_tickers.values():
            ticker_pool.extend(market_tickers)

    macro_queries = ["Federal Reserve interest rates", "global economy outlook"]
    if "Crypto" in active_markets:
        macro_queries.append("Bitcoin Ethereum price")
    if "India" in active_markets:
        macro_queries.append("Nifty Sensex today")
    if "MCX" in active_markets:
        macro_queries.append("gold oil prices today")

    # Build all fetch tasks upfront
    fetch_tasks = []

    # RSS feeds — merge hardcoded + user-managed DB feeds (deduplicated)
    seen_rss: set[str] = set()

    # Load enabled DB feeds
    try:
        db_feeds = db.query(models.RssFeed).filter(models.RssFeed.is_enabled == 1).all()
        db_feed_map: dict[str, list[tuple[str, str]]] = {}
        for f in db_feeds:
            db_feed_map.setdefault(f.market, []).append((f.url, f.label))
    except Exception:
        db_feed_map = {}

    # Collect feeds per active market from DB (replaces hardcoded lists)
    for market in active_markets:
        feeds_for_market = db_feed_map.get(market, []) or MARKET_RSS_MAP.get(market, RSS_GLOBAL)
        for feed_url, label in feeds_for_market:
            if feed_url not in seen_rss:
                seen_rss.add(feed_url)
                fetch_tasks.append(("rss", feed_url, label))

    # Also include any "All" market feeds
    for feed_url, label in db_feed_map.get("All", []):
        if feed_url not in seen_rss:
            seen_rss.add(feed_url)
            fetch_tasks.append(("rss", feed_url, label))

    # Google News macro queries
    for q in macro_queries[:4]:
        fetch_tasks.append(("gnews", q, None))

    # Run all HTTP fetches in parallel
    all_results = []
    def _run_task(task):
        kind, arg, label = task
        if kind == "rss":
            return _fetch_rss(arg, label, max_items=10)
        else:
            return _fetch_google_news(arg, max_items=5)

    with ThreadPoolExecutor(max_workers=min(len(fetch_tasks), 12)) as pool:
        futures = [pool.submit(_run_task, t) for t in fetch_tasks]
        for f in _as_completed(futures):
            try:
                all_results.extend(f.result())
            except Exception:
                pass

    # Stocktwits and YFinance (batch calls, already fast)
    if ticker_pool:
        all_results.extend(_fetch_stocktwits(ticker_pool, max_items=5))
    yf_tickers = ticker_pool if ticker_pool else ["SPY", "BTC-USD", "GC=F"]
    all_results.extend(_fetch_yfinance_news(yf_tickers, max_items=8))

    # Alpha Vantage scored sentiment (if API key available)
    if ticker_pool:
        all_results.extend(_fetch_alpha_vantage_sentiment(ticker_pool[:5], max_items=10))

    # Reddit WallStreetBets retail sentiment (unauthenticated)
    if "US" in active_markets or "Crypto" in active_markets:
        all_results.extend(_fetch_reddit_wsb(max_items=8))

    # ── Staleness filter — drop items older than NEWS_MAX_AGE_HOURS ────────
    all_results = _filter_stale(all_results)

    # ── De-duplicate by title (fuzzy: first 60 chars) ──────────────────────
    seen_titles: set[str] = set()
    unique_results: list[dict] = []
    for r in all_results:
        t = r.get("title", "")
        key = t[:60].lower().strip()
        if t and key not in seen_titles:
            seen_titles.add(key)
            unique_results.append(r)

    # ── Cache to DB ────────────────────────────────────────────────────────
    for r in unique_results:
        db.add(models.WebResearch(
            query=r.get("query", ""),
            source_url=r.get("source_url", ""),
            title=r.get("title", ""),
            snippet=r.get("snippet", ""),
        ))
    try:
        db.commit()
        print(f"[WebResearch] Cached {len(unique_results)} fresh research items")
    except Exception as e:
        print(f"[WebResearch] DB cache write failed: {e}")
        db.rollback()
    finally:
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
