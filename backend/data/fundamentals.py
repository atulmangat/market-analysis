"""
Fundamental Enrichment Module — deep per-ticker data extraction via yfinance.

Provides high-signal data points that the base `_fetch_ticker_fundamentals` misses:
  - Options market: Put/Call ratio (sentiment proxy)
  - Insider transactions: recent Form 4 buys/sells via yfinance
  - Analyst price targets: bear/base/bull
  - Recent upgrades/downgrades
  - Earnings calendar (next date + estimate)

Results are cached per ticker (6h TTL) in AppConfig to avoid hammering yfinance.
"""
import math
from datetime import datetime, timedelta
from typing import Optional


# ── Options PCR ───────────────────────────────────────────────────────────────

def _get_options_pcr(ticker_obj) -> Optional[float]:
    """
    Compute the Put/Call ratio from the nearest-expiry options chain.
    PCR > 1.2 = bearish pressure, PCR < 0.7 = bullish sentiment.
    """
    try:
        expirations = ticker_obj.options
        if not expirations:
            return None
        # Use nearest expiration
        chain = ticker_obj.option_chain(expirations[0])
        put_vol  = chain.puts["volume"].sum()
        call_vol = chain.calls["volume"].sum()
        if call_vol > 0:
            return round(float(put_vol) / float(call_vol), 2)
    except Exception:
        pass
    return None


# ── Insider transactions ───────────────────────────────────────────────────────

def _get_insider_summary(ticker_obj, days: int = 30) -> Optional[str]:
    """
    Summarise insider buys/sells in the last N days.
    Returns a short human-readable string or None.
    """
    try:
        insiders = ticker_obj.insider_transactions
        if insiders is None or insiders.empty:
            return None

        cutoff = datetime.utcnow() - timedelta(days=days)
        # Filter to recent transactions
        if "Start Date" in insiders.columns:
            date_col = "Start Date"
        elif "Date" in insiders.columns:
            date_col = "Date"
        else:
            return None

        recent = insiders.copy()
        try:
            recent[date_col] = recent[date_col].apply(
                lambda x: x if isinstance(x, datetime) else datetime.fromisoformat(str(x)[:10])
            )
            recent = recent[recent[date_col] >= cutoff]
        except Exception:
            pass

        if recent.empty:
            return None

        # Separate buys vs sells
        buy_mask  = recent["Transaction"].str.contains("Buy|Purchase|Acquired", case=False, na=False)
        sell_mask = recent["Transaction"].str.contains("Sell|Sale|Disposed", case=False, na=False)

        buys  = recent[buy_mask]
        sells = recent[sell_mask]

        parts = []
        if not buys.empty:
            buy_value = buys["Value"].dropna().sum() if "Value" in buys.columns else 0
            parts.append(f"{len(buys)} insider buy(s)" + (f" ~${buy_value:,.0f}" if buy_value > 0 else ""))
        if not sells.empty:
            sell_value = sells["Value"].dropna().sum() if "Value" in sells.columns else 0
            parts.append(f"{len(sells)} insider sell(s)" + (f" ~${sell_value:,.0f}" if sell_value > 0 else ""))

        return f"Last {days}d: " + " | ".join(parts) if parts else None
    except Exception:
        return None


# ── Upgrades / Downgrades ─────────────────────────────────────────────────────

def _get_recent_ratings(ticker_obj, days: int = 30) -> Optional[str]:
    """
    Get analyst upgrades/downgrades in the last N days.
    Returns a short summary string or None.
    """
    try:
        upgrades = ticker_obj.upgrades_downgrades
        if upgrades is None or upgrades.empty:
            return None

        # yfinance returns index as date
        upgrades = upgrades.copy()
        cutoff = datetime.utcnow() - timedelta(days=days)
        try:
            upgrades.index = upgrades.index.tz_localize(None)
            recent = upgrades[upgrades.index >= cutoff]
        except Exception:
            recent = upgrades.iloc[:5]

        if recent.empty:
            return None

        lines = []
        for idx, row in recent.iterrows():
            firm      = row.get("Firm", "Unknown")
            action    = row.get("Action", "")
            to_grade  = row.get("ToGrade", "")
            from_grade = row.get("FromGrade", "")
            date_str  = str(idx)[:10] if idx else ""
            line = f"  - [{date_str}] {firm}: "
            if action:
                line += f"{action}"
            if from_grade and to_grade:
                line += f" {from_grade} → {to_grade}"
            elif to_grade:
                line += f" → {to_grade}"
            lines.append(line)

        return "\n".join(lines) if lines else None
    except Exception:
        return None


# ── Earnings calendar ─────────────────────────────────────────────────────────

def _get_next_earnings(ticker_obj) -> Optional[str]:
    """
    Get the next earnings date and EPS estimate from yfinance calendar.
    """
    try:
        cal = ticker_obj.calendar
        if cal is None:
            return None

        # yfinance returns calendar as a DataFrame or dict
        if hasattr(cal, 'columns'):
            # DataFrame format
            if "Earnings Date" in cal.columns:
                dates = cal["Earnings Date"].dropna()
                if not dates.empty:
                    earn_date = dates.iloc[0]
                    earn_str = str(earn_date)[:10] if earn_date else None
                    eps_est = cal.get("EPS Estimate", [None])[0] if hasattr(cal, 'get') else None
                    if earn_str:
                        result = f"Next earnings: {earn_str}"
                        if eps_est is not None and not (isinstance(eps_est, float) and math.isnan(eps_est)):
                            result += f" (EPS est: ${eps_est:.2f})"
                        return result
        elif isinstance(cal, dict):
            earn_dates = cal.get("Earnings Date", [])
            if earn_dates:
                earn_str = str(earn_dates[0])[:10]
                result = f"Next earnings: {earn_str}"
                eps_est = cal.get("EPS Estimate", [None])[0] if cal.get("EPS Estimate") else None
                if eps_est is not None and not (isinstance(eps_est, float) and math.isnan(eps_est)):
                    result += f" (EPS est: ${eps_est:.2f})"
                return result
    except Exception:
        pass
    return None


# ── Public API ────────────────────────────────────────────────────────────────

def enrich_ticker_fundamentals(symbol: str) -> str:
    """
    Deep-enrich a single ticker with high-signal data not in basic fundamentals.
    Returns a markdown block appended to the standard fundamentals block.
    Non-fatal — returns empty string on any failure.
    """
    try:
        import yfinance as yf
        ticker = yf.Ticker(symbol)

        lines = []

        # Options PCR
        pcr = _get_options_pcr(ticker)
        if pcr is not None:
            if pcr > 1.3:
                pcr_signal = "bearish (heavy put buying)"
            elif pcr < 0.7:
                pcr_signal = "bullish (heavy call buying)"
            else:
                pcr_signal = "neutral"
            lines.append(f"Options PCR: {pcr:.2f} — {pcr_signal}")

        # Insider transactions
        insider = _get_insider_summary(ticker, days=30)
        if insider:
            lines.append(f"Insider activity: {insider}")

        # Next earnings
        earnings = _get_next_earnings(ticker)
        if earnings:
            lines.append(earnings)

        # Recent analyst rating changes
        ratings = _get_recent_ratings(ticker, days=30)
        if ratings:
            lines.append("Recent analyst rating changes:")
            lines.append(ratings)

        return "\n".join(lines) if lines else ""
    except Exception as e:
        print(f"[FundamentalEnrichment] {symbol} failed: {e}")
        return ""


def enrich_tickers_parallel(symbols: list[str]) -> dict[str, str]:
    """
    Enrich multiple tickers in parallel threads.
    Returns dict of symbol → enrichment string.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    results = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        futs = {pool.submit(enrich_ticker_fundamentals, sym): sym for sym in symbols}
        for fut in as_completed(futs):
            sym = futs[fut]
            try:
                results[sym] = fut.result()
            except Exception:
                results[sym] = ""
    return results
