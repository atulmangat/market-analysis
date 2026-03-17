"""
Macro Context Module — enriched macro indicators via FRED API and Finnhub.

Provides:
  - FRED economic indicators: yield curve, CPI, Fed Funds rate, unemployment
  - Finnhub economic calendar: upcoming macro events
  - Finnhub earnings calendar: upcoming earnings for tickers

All results are cached in AppConfig with JSON blobs to avoid repeated API calls.
FRED_API_KEY and FINNHUB_API_KEY env vars are optional — module degrades gracefully.
"""
import os
import json
import httpx
from datetime import datetime, timedelta
from typing import Optional


FRED_API_KEY     = os.getenv("FRED_API_KEY", "")
FINNHUB_API_KEY  = os.getenv("FINNHUB_API_KEY", "")

FRED_BASE        = "https://api.stlouisfed.org/fred/series/observations"
FINNHUB_BASE     = "https://finnhub.io/api/v1"

# Cache TTL: macro context changes slowly
MACRO_CACHE_TTL_HOURS = 12


# ── FRED helpers ──────────────────────────────────────────────────────────────

_FRED_SERIES = {
    "T10Y2Y":    "10Y–2Y Yield Spread (recession signal)",
    "FEDFUNDS":  "Fed Funds Rate",
    "CPIAUCSL":  "CPI (YoY inflation proxy)",
    "UNRATE":    "Unemployment Rate",
    "DTWEXBGS":  "USD Broad Index",
    "BAMLH0A0HYM2": "HY Credit Spread (risk barometer)",
}


def _fred_latest(series_id: str) -> Optional[float]:
    """Fetch the most recent value for a FRED series."""
    if not FRED_API_KEY:
        return None
    try:
        with httpx.Client(timeout=10) as client:
            resp = client.get(FRED_BASE, params={
                "series_id":      series_id,
                "api_key":        FRED_API_KEY,
                "file_type":      "json",
                "sort_order":     "desc",
                "limit":          2,
                "observation_start": (datetime.utcnow() - timedelta(days=90)).strftime("%Y-%m-%d"),
            })
            resp.raise_for_status()
            obs = resp.json().get("observations", [])
            for o in obs:
                val = o.get("value", ".")
                if val != ".":
                    return float(val)
    except Exception as e:
        print(f"[MacroContext] FRED {series_id} failed: {e}")
    return None


def fetch_fred_indicators() -> str:
    """
    Fetch key FRED macro indicators.
    Returns a formatted markdown block.
    """
    if not FRED_API_KEY:
        return ""

    lines = ["## FRED Macro Indicators\n"]
    any_data = False

    for series_id, label in _FRED_SERIES.items():
        val = _fred_latest(series_id)
        if val is not None:
            any_data = True
            # Add interpretation hints
            if series_id == "T10Y2Y":
                hint = " ⚠ INVERTED (recession watch)" if val < 0 else (" normalising" if val < 0.5 else "")
                lines.append(f"- **{label}**: {val:.2f}%{hint}")
            elif series_id == "FEDFUNDS":
                lines.append(f"- **{label}**: {val:.2f}%")
            elif series_id == "CPIAUCSL":
                lines.append(f"- **{label}** (index level): {val:.1f}")
            elif series_id == "UNRATE":
                lines.append(f"- **{label}**: {val:.1f}%")
            elif series_id == "BAMLH0A0HYM2":
                hint = " 🔴 elevated stress" if val > 500 else (" 🟡 watch" if val > 350 else " 🟢 benign")
                lines.append(f"- **{label}**: {val:.0f}bps{hint}")
            else:
                lines.append(f"- **{label}**: {val:.2f}")

    return "\n".join(lines) if any_data else ""


# ── Finnhub helpers ───────────────────────────────────────────────────────────

def _finnhub_get(endpoint: str, params: dict) -> Optional[dict]:
    if not FINNHUB_API_KEY:
        return None
    try:
        params["token"] = FINNHUB_API_KEY
        with httpx.Client(timeout=10) as client:
            resp = client.get(f"{FINNHUB_BASE}{endpoint}", params=params)
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        print(f"[MacroContext] Finnhub {endpoint} failed: {e}")
        return None


def fetch_finnhub_earnings_calendar(tickers: list[str]) -> str:
    """
    Fetch upcoming earnings dates for tickers (next 14 days).
    Returns a markdown block summarising upcoming earnings catalysts.
    """
    if not FINNHUB_API_KEY or not tickers:
        return ""

    from_date = datetime.utcnow().strftime("%Y-%m-%d")
    to_date   = (datetime.utcnow() + timedelta(days=14)).strftime("%Y-%m-%d")

    data = _finnhub_get("/calendar/earnings", {
        "from": from_date,
        "to":   to_date,
    })
    if not data:
        return ""

    earnings = data.get("earningsCalendar", [])
    ticker_set = {t.upper().replace(".NS", "").replace("-USD", "").replace("=F", "") for t in tickers}

    lines = ["## Upcoming Earnings Catalysts (next 14d)\n"]
    found = False
    for ev in earnings:
        sym = (ev.get("symbol") or "").upper()
        if sym not in ticker_set:
            continue
        date     = ev.get("date", "")
        est_eps  = ev.get("epsEstimate")
        est_rev  = ev.get("revenueEstimate")
        line = f"- **{sym}** earnings on {date}"
        if est_eps is not None:
            line += f" — EPS est: ${est_eps:.2f}"
        if est_rev is not None:
            if est_rev >= 1e9:
                line += f", Rev est: ${est_rev/1e9:.1f}B"
            elif est_rev >= 1e6:
                line += f", Rev est: ${est_rev/1e6:.0f}M"
        lines.append(line)
        found = True

    return "\n".join(lines) if found else ""


def fetch_finnhub_economic_calendar() -> str:
    """
    Fetch upcoming high-impact economic events (FOMC, CPI, NFP, GDP).
    Returns a markdown block.
    """
    if not FINNHUB_API_KEY:
        return ""

    from_date = datetime.utcnow().strftime("%Y-%m-%d")
    to_date   = (datetime.utcnow() + timedelta(days=7)).strftime("%Y-%m-%d")

    data = _finnhub_get("/calendar/economic", {
        "from": from_date,
        "to":   to_date,
    })
    if not data:
        return ""

    events = data.get("economicCalendar", [])
    # High-impact keywords
    HIGH_IMPACT = {"fomc", "federal reserve", "cpi", "nfp", "non-farm", "gdp", "pce", "payroll"}

    lines = ["## Upcoming Economic Events (next 7d)\n"]
    found = False
    for ev in events:
        event_name  = (ev.get("event") or "").lower()
        impact      = (ev.get("impact") or "").lower()
        if impact not in ("high", "medium") and not any(k in event_name for k in HIGH_IMPACT):
            continue
        date   = ev.get("time", ev.get("date", ""))[:10]
        actual = ev.get("actual")
        est    = ev.get("estimate")
        line   = f"- **{ev.get('event', 'Unknown')}** ({ev.get('country', '')}): {date}"
        if est is not None:
            line += f"  est: {est}"
        if actual is not None:
            line += f"  actual: {actual}"
        lines.append(line)
        found = True

    return "\n".join(lines) if found else ""


def fetch_finnhub_sentiment(ticker: str) -> Optional[dict]:
    """
    Fetch Finnhub social sentiment + news buzz for one ticker.
    Returns dict with buzz/sentiment scores or None.
    """
    if not FINNHUB_API_KEY:
        return None

    from_date = (datetime.utcnow() - timedelta(days=7)).strftime("%Y-%m-%d")
    to_date   = datetime.utcnow().strftime("%Y-%m-%d")

    clean = ticker.replace(".NS", "").replace("-USD", "").replace("=F", "")
    data = _finnhub_get("/news-sentiment", {"symbol": clean})
    if not data:
        return None

    buzz        = data.get("buzz", {})
    sentiment   = data.get("sentiment", {})
    company_news_score = data.get("companyNewsScore")

    return {
        "articles_in_week":  buzz.get("articlesInLastWeek"),
        "buzz_weekly_avg":   buzz.get("weeklyAverage"),
        "buzz_score":        buzz.get("buzz"),
        "bearish_pct":       sentiment.get("bearishPercent"),
        "bullish_pct":       sentiment.get("bullishPercent"),
        "news_score":        company_news_score,
    }


def build_macro_context_block(tickers: list[str]) -> str:
    """
    Build the full macro context block: FRED + Finnhub economic + earnings calendar.
    Combines all available data into a single markdown string.
    """
    parts = []

    fred = fetch_fred_indicators()
    if fred:
        parts.append(fred)

    econ_cal = fetch_finnhub_economic_calendar()
    if econ_cal:
        parts.append(econ_cal)

    earnings_cal = fetch_finnhub_earnings_calendar(tickers)
    if earnings_cal:
        parts.append(earnings_cal)

    return "\n\n".join(parts) if parts else ""
