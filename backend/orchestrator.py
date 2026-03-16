from sqlalchemy.orm import Session
from database import SessionLocal
import models
from agents import query_agent
from data_ingestion import fetch_market_data, fetch_news
from web_research import fetch_web_research, format_research_for_context
from memory_manager import (
    get_agent_memory,
    format_memory_for_context,
    write_agent_memory,
    prune_old_memory,
    get_agent_performance_summary,
)
import json
import re
import math
import uuid as _uuid
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed


def _log(db, run_id: str, step: str, status: str, detail: str = None, agent_name: str = None):
    """Write a PipelineEvent and immediately commit so the frontend poller sees it."""
    ev = models.PipelineEvent(
        run_id=run_id,
        step=step,
        agent_name=agent_name,
        status=status,
        detail=detail,
    )
    db.add(ev)
    db.commit()


# ── Market config ─────────────────────────────────────────────────────────────

MARKET_TICKERS = {
    "US":     ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "TSLA", "META", "AMD"],
    "India":  ["RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS", "ICICIBANK.NS", "WIPRO.NS", "SBIN.NS", "TATAMOTORS.NS"],
    "Crypto": ["BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD", "XRP-USD", "DOGE-USD", "ADA-USD"],
    "MCX":    ["GC=F", "SI=F", "CL=F", "NG=F", "HG=F"],
}


def get_enabled_markets(db: Session) -> dict:
    configs = db.query(models.MarketConfig).all()
    if not configs:
        for market in MARKET_TICKERS:
            db.add(models.MarketConfig(market_name=market, is_enabled=1))
        db.commit()
        configs = db.query(models.MarketConfig).all()
    return {c.market_name: MARKET_TICKERS[c.market_name]
            for c in configs if c.is_enabled and c.market_name in MARKET_TICKERS}


def build_market_constraint(enabled_markets: dict) -> str:
    if not enabled_markets:
        return "No markets are currently enabled. Default to US market tickers like AAPL, MSFT."
    parts = [f"  - **{m}**: {', '.join(t)}" for m, t in enabled_markets.items()]
    return "You MUST pick your ticker from ONLY the following enabled markets:\n" + "\n".join(parts)


# ── Agent default prompts ─────────────────────────────────────────────────────

DEFAULT_AGENTS = {
    "Value Investor": (
        "You are a senior fundamental analyst at a long/short equity hedge fund with 20 years experience. "
        "Your edge is identifying mis-priced assets relative to intrinsic value and upcoming catalysts that the market has not yet priced in.\n\n"
        "ANALYSIS FRAMEWORK:\n"
        "1. DATE FILTER: Review current date. Classify each news item: [< 6h] = breaking, [6–48h] = fresh, [2–7d] = recent, [> 7d] = stale/priced-in. "
        "Only breaking or fresh news creates an exploitable edge. Dismiss stale news.\n"
        "2. FUNDAMENTAL SCREEN: For each ticker, check P/E vs sector median, price vs 52w range (is it near lows = potential value, near highs = potential short), market cap, and 5d price move. "
        "A stock down 15%+ on no fundamental change is a buying opportunity. A stock up 30%+ on hype with no earnings support is a short candidate.\n"
        "3. CATALYST IDENTIFICATION: Is there an earnings announcement, product launch, regulatory decision, or leadership change in the next 2 weeks? Catalysts compress the time to realisation.\n"
        "4. MEMORY REVIEW: Check your notes for past trades on these assets. If a previous long/short thesis played out as expected, update conviction. If it failed, identify why.\n"
        "5. POSITION THESIS: State the exact mispricing: 'Asset X is trading at P/E Y, sector median is Z, implying X% upside to fair value.' "
        "State the specific catalyst and expected timeframe. State what would invalidate your thesis.\n\n"
        "RULES: Never recommend SPY/QQQ (too broad). Never recommend an asset purely on momentum without a fundamental anchor. "
        "Prefer assets where price has diverged from fundamentals due to short-term panic or irrational exuberance.\n\n"
        "Write your full structured analysis, then output on a new line:\n"
        "TICKER:SYMBOL, ACTION:LONG or ACTION:SHORT"
    ),
    "Technical Analyst": (
        "You are a quantitative technical analyst at a prop trading firm. You trade price action, volume patterns, and momentum signals. "
        "You ignore noise and focus on high-probability setups with clear risk/reward.\n\n"
        "ANALYSIS FRAMEWORK:\n"
        "1. NEWS STALENESS CHECK: Today's date is given. News older than 48h is already priced into price action — do not trade on it. "
        "Only news from the last 24h can create fresh momentum setups.\n"
        "2. PRICE STRUCTURE: For each ticker, examine the 5-day close sequence. Identify:\n"
        "   - BREAKOUT: 3+ consecutive higher closes, especially above a round number or prior range high → LONG\n"
        "   - BREAKDOWN: 3+ consecutive lower closes, breaking support → SHORT\n"
        "   - COMPRESSION: narrow range for 3–4 days then sudden expansion → trade the direction of expansion\n"
        "   - MEAN REVERSION: 20%+ move in 3 days with no volume follow-through → fading candidate\n"
        "3. RELATIVE STRENGTH: Which ticker is showing the strongest uptrend vs. others in its asset class? The leader gets bought, the laggard gets shorted.\n"
        "4. PATTERN MEMORY: Review your notes. Which setups have had high win-rates? Apply them now. Which have failed repeatedly? Avoid them.\n"
        "5. TRADE SETUP: State entry rationale (e.g. 'BTC closed above $95k after 3d consolidation, volume expanding — breakout LONG'), "
        "the price level that would invalidate the setup, and expected holding period (hours / days / week).\n\n"
        "RULES: Do not recommend assets with < 3 days of price data. Do not go against a strong trend without a reversal signal. "
        "If no clean setup exists, say so explicitly — but still pick the highest-probability trade available.\n\n"
        "Write your full structured analysis, then output on a new line:\n"
        "TICKER:SYMBOL, ACTION:LONG or ACTION:SHORT"
    ),
    "Macro Economist": (
        "You are the chief macro strategist at a global macro fund. You connect central bank policy, geopolitical events, and capital flows "
        "to asset price implications with 15+ years of cross-market experience.\n\n"
        "ANALYSIS FRAMEWORK:\n"
        "1. MACRO REGIME IDENTIFICATION: From the news feed, identify the dominant regime:\n"
        "   - RISK-ON: falling VIX, Fed dovish, strong GDP → favour equities, crypto, cyclicals\n"
        "   - RISK-OFF: rising rates, recession signals, geopolitical crisis → favour gold, USD, defensive sectors\n"
        "   - STAGFLATION: high CPI + slowing growth → favour commodities, short growth stocks\n"
        "   - REFLATION: recovering growth + managed inflation → favour EM, energy, industrials\n"
        "2. EVENT IMPACT TIMING: Only news from the last 48h creates new macro positioning opportunities. "
        "Assess: is this a regime-changing event (Fed rate decision, war escalation) or a minor data point?\n"
        "3. SECOND-ORDER EFFECTS: Think beyond the obvious. A rate hike hurts bonds — but also strong USD hurts EM equities and gold. "
        "A China growth surprise lifts metals AND Indian IT exports. Map the transmission mechanism.\n"
        "4. CROSS-ASSET SIGNAL CHECK: Are crypto, gold, and equities moving in the same direction (risk-on/off rotation) "
        "or diverging (sector-specific story)? Divergence is often more tradeable.\n"
        "5. MEMORY INTEGRATION: Review past macro calls. Which regime calls were right? Which macro themes you tracked led to profitable trades?\n"
        "6. TRADE THESIS: State the specific macro driver, asset transmission, and expected duration. "
        "E.g. 'Fed signalled pause → risk-on → BTC and tech outperform → LONG BTC-USD for 1–2 weeks.'\n\n"
        "RULES: Never trade a macro theme that is more than 1 week old without fresh confirmation. "
        "Always specify which asset class the macro driver most directly benefits/hurts.\n\n"
        "Write your full structured analysis, then output on a new line:\n"
        "TICKER:SYMBOL, ACTION:LONG or ACTION:SHORT"
    ),
    "Sentiment Analyst": (
        "You are a sentiment and flow analyst at a high-frequency trading desk. You specialise in identifying crowd psychology inflection points — "
        "where retail sentiment peaks or troughs, and institutional money quietly takes the other side.\n\n"
        "ANALYSIS FRAMEWORK:\n"
        "1. SENTIMENT DECAY: Today's date is given. Social buzz decays fast — a story from 3+ days ago is cold. "
        "Fresh fear or greed (< 6h) can last 1–3 days. Identify which assets have HOT sentiment RIGHT NOW.\n"
        "2. SENTIMENT DIRECTION MAPPING:\n"
        "   - PEAK GREED SIGNAL: Asset up 20%+ in 5 days, Stocktwits bullish >80%, mainstream news covers it → often a SHORT setup (sell the hype)\n"
        "   - PEAK FEAR SIGNAL: Asset down 15%+ in 5 days, Stocktwits bearish >75%, panic headlines → often a LONG setup (buy the panic)\n"
        "   - SENTIMENT DIVERGENCE: Price falling but bullish Stocktwits rising → accumulation by smart money → LONG\n"
        "   - QUIET ACCUMULATION: Asset flat with low buzz but consistent insider/whale buying signals → LONG before the crowd arrives\n"
        "3. HEADLINE QUALITY CHECK: Is the headline driven by real fundamentals (earnings miss, regulatory ban) "
        "or pure narrative/rumour? Pure narrative-driven moves revert faster.\n"
        "4. RETAIL VS SMART MONEY: Are Stocktwits/social messages euphoric while price starts stalling? "
        "That's distribution — institutions are selling into retail buying. SHORT signal.\n"
        "5. MEMORY LEARNING: Which sentiment calls worked? Did you correctly fade euphoria or catch panic bottoms? Apply those lessons.\n"
        "6. TRADE SETUP: State the specific sentiment signal, expected mean-reversion or momentum duration, "
        "and the price level that would prove the sentiment thesis wrong.\n\n"
        "RULES: Never trade sentiment alone on a stock with upcoming earnings — fundamentals override sentiment near catalysts. "
        "Always ask: 'who is on the wrong side of this trade and when will they capitulate?'\n\n"
        "Write your full structured analysis, then output on a new line:\n"
        "TICKER:SYMBOL, ACTION:LONG or ACTION:SHORT"
    ),
}


def setup_agent_prompts(db: Session):
    """Seed default agent prompts — update if the prompt has changed (e.g. after a version bump)."""
    for name, prompt in DEFAULT_AGENTS.items():
        existing = db.query(models.AgentPrompt).filter(models.AgentPrompt.agent_name == name).first()
        if not existing:
            db.add(models.AgentPrompt(agent_name=name, system_prompt=prompt))
        elif existing.system_prompt != prompt:
            # Only reset to default if NOT already evolved (generation 1 = seed prompt)
            history_count = db.query(models.AgentPromptHistory).filter(
                models.AgentPromptHistory.agent_name == name
            ).count()
            if history_count == 0:
                existing.system_prompt = prompt
    db.commit()


# ── Ticker fundamentals for agent context ────────────────────────────────────

def _fetch_ticker_fundamentals(symbol: str) -> str:
    """
    Fetch rich fundamentals + price history + momentum signals for a ticker.
    Uses yfinance .info for full data, fast_info as fallback.
    Returns a structured markdown block for agent context injection.
    """
    import yfinance as yf
    import math as _math
    try:
        ticker = yf.Ticker(symbol)

        # Try full .info first, fall back to fast_info
        try:
            info = ticker.info
        except Exception:
            info = {}
        fi = ticker.fast_info

        hist_20d = ticker.history(period="1mo", interval="1d", auto_adjust=True)
        hist_5d  = hist_20d.tail(5) if not hist_20d.empty else hist_20d

        lines = [f"### {symbol}"]

        # ── Identity
        name = info.get("longName") or info.get("shortName", symbol)
        sector   = info.get("sector", "")
        industry = info.get("industry", "")
        currency = info.get("currency", "USD")
        qtype    = info.get("quoteType", "")
        if name != symbol: lines.append(f"**{name}** ({qtype}) · {currency}")
        if sector:         lines.append(f"Sector: {sector}" + (f" › {industry}" if industry else ""))

        # ── Valuation
        def _safe(d, *keys, fmt=None):
            for k in keys:
                v = d.get(k)
                if v is not None and not (isinstance(v, float) and _math.isnan(v)):
                    return fmt(v) if fmt else v
            return None

        try:
            mc = fi.market_cap
            if mc:
                if mc >= 1e12:   lines.append(f"Market Cap: ${mc/1e12:.2f}T")
                elif mc >= 1e9:  lines.append(f"Market Cap: ${mc/1e9:.1f}B")
                else:            lines.append(f"Market Cap: ${mc/1e6:.0f}M")
        except Exception: pass

        pe   = _safe(info, "trailingPE", "forwardPE")
        fpe  = _safe(info, "forwardPE")
        pb   = _safe(info, "priceToBook")
        ps   = _safe(info, "priceToSalesTrailing12Months")
        ev_e = _safe(info, "enterpriseToEbitda")
        if pe:   lines.append(f"P/E (trailing): {pe:.1f}" + (f"  |  Forward P/E: {fpe:.1f}" if fpe else ""))
        if pb:   lines.append(f"P/B: {pb:.2f}" + (f"  |  P/S: {ps:.2f}" if ps else ""))
        if ev_e: lines.append(f"EV/EBITDA: {ev_e:.1f}")

        # ── Growth & Profitability
        rev_g = _safe(info, "revenueGrowth")
        earn_g = _safe(info, "earningsGrowth")
        margins = _safe(info, "profitMargins")
        roe    = _safe(info, "returnOnEquity")
        debt_eq = _safe(info, "debtToEquity")
        if rev_g is not None:   lines.append(f"Revenue Growth (YoY): {rev_g*100:+.1f}%" + (f"  |  Earnings Growth: {earn_g*100:+.1f}%" if earn_g else ""))
        if margins is not None: lines.append(f"Profit Margin: {margins*100:.1f}%" + (f"  |  ROE: {roe*100:.1f}%" if roe else ""))
        if debt_eq is not None: lines.append(f"Debt/Equity: {debt_eq:.2f}")

        # ── Analyst consensus
        target   = _safe(info, "targetMeanPrice")
        rec      = info.get("recommendationKey", "")
        analysts = _safe(info, "numberOfAnalystOpinions")
        try:
            lp = fi.last_price or info.get("currentPrice") or info.get("regularMarketPrice")
        except Exception:
            lp = info.get("currentPrice") or info.get("regularMarketPrice")
        if lp and target:
            upside = (target - lp) / lp * 100
            lines.append(f"Analyst Target: ${target:.2f} ({upside:+.1f}% vs current)" +
                         (f"  |  Consensus: {rec.upper()}" if rec else "") +
                         (f"  |  {int(analysts)} analysts" if analysts else ""))
        elif rec:
            lines.append(f"Analyst Consensus: {rec.upper()}")

        # ── Short interest
        short_pct = _safe(info, "shortPercentOfFloat")
        if short_pct:
            lines.append(f"Short Interest: {short_pct*100:.1f}% of float")

        # ── 52-week range & position
        try:
            hi52 = fi.fifty_two_week_high
            lo52 = fi.fifty_two_week_low
            if hi52 and lo52 and lp:
                pct_from_low  = (lp - lo52) / (hi52 - lo52) * 100 if hi52 != lo52 else 50
                lines.append(f"52w Range: ${lo52:.2f} – ${hi52:.2f}  |  Current at {pct_from_low:.0f}% of range")
        except Exception: pass

        # ── Price momentum (20d)
        if not hist_20d.empty:
            closes = hist_20d["Close"].dropna()
            vols   = hist_20d["Volume"].dropna()
            if len(closes) >= 2:
                chg_5d  = (float(closes.iloc[-1]) - float(closes.iloc[-min(5, len(closes))])) / float(closes.iloc[-min(5, len(closes))]) * 100
                chg_20d = (float(closes.iloc[-1]) - float(closes.iloc[0])) / float(closes.iloc[0]) * 100
                lines.append(f"Price momentum: 5d {chg_5d:+.2f}%  |  20d {chg_20d:+.2f}%")
            # Average volume vs recent volume
            if len(vols) >= 5:
                avg_vol = float(vols.iloc[:-1].mean())
                last_vol = float(vols.iloc[-1])
                if avg_vol > 0:
                    vol_ratio = last_vol / avg_vol
                    lines.append(f"Volume: {last_vol:,.0f}  ({vol_ratio:.1f}x avg) — {'surge' if vol_ratio > 1.5 else 'below avg' if vol_ratio < 0.7 else 'normal'}")
            # Recent daily closes
            price_row = "  ".join(
                f"{ts.strftime('%m-%d')}: ${float(c):.2f}"
                for ts, c in zip(closes.index[-5:], closes.values[-5:])
            )
            lines.append(f"Recent closes: {price_row}")

            # RSI (14-period approximation)
            if len(closes) >= 14:
                deltas = closes.diff().dropna()
                gains  = deltas.clip(lower=0)
                losses = (-deltas).clip(lower=0)
                avg_gain = gains.rolling(14).mean().iloc[-1]
                avg_loss = losses.rolling(14).mean().iloc[-1]
                if avg_loss > 0:
                    rs  = avg_gain / avg_loss
                    rsi = 100 - (100 / (1 + rs))
                    lines.append(f"RSI(14): {rsi:.0f} — {'overbought' if rsi > 70 else 'oversold' if rsi < 30 else 'neutral'}")

        # ── Upcoming earnings
        try:
            cal = ticker.calendar
            if cal is not None and not cal.empty:
                earn_date = cal.get("Earnings Date", [None])[0] if hasattr(cal, 'get') else None
                if earn_date:
                    lines.append(f"Next Earnings: {earn_date}")
        except Exception: pass

        return "\n".join(lines)
    except Exception as e:
        return f"### {symbol}\n- Data unavailable: {e}"


def _annotate_research_with_dates(research_items: list[dict], now: datetime) -> str:
    """
    Format research with news age labels so agents can judge relevance.
    E.g. '[2h ago] Bitcoin surges...' or '[3d ago] Fed hikes rates...'
    """
    lines = [f"## Latest Market News & Research\n(Current date/time: {now.strftime('%Y-%m-%d %H:%M UTC')})\n"]
    for i, r in enumerate(research_items[:40], 1):
        title   = r.get("title", "Unknown")
        snippet = r.get("snippet", "")
        source  = r.get("source_url", "")
        published = r.get("published", "")

        age_label = ""
        if published:
            try:
                import email.utils
                pub_dt = email.utils.parsedate_to_datetime(published)
                pub_dt = pub_dt.replace(tzinfo=timezone.utc) if pub_dt.tzinfo is None else pub_dt.astimezone(timezone.utc)
                now_utc = now.replace(tzinfo=timezone.utc) if now.tzinfo is None else now.astimezone(timezone.utc)
                diff = now_utc - pub_dt
                hours = diff.total_seconds() / 3600
                if hours < 1:
                    age_label = f"[{int(diff.total_seconds()/60)}m ago] "
                elif hours < 24:
                    age_label = f"[{int(hours)}h ago] "
                elif hours < 168:
                    age_label = f"[{int(hours/24)}d ago] "
                else:
                    age_label = f"[{int(hours/168)}w ago] "
            except Exception:
                pass

        lines.append(f"{i}. {age_label}**{title}**")
        if snippet and snippet != title:
            lines.append(f"   {snippet[:200]}")
        if source:
            lines.append(f"   Source: {source}")
        lines.append("")

    return "\n".join(lines)


# ── Extraction helpers ────────────────────────────────────────────────────────

def extract_proposal(text: str):
    """Regex extraction of TICKER and ACTION from agent response."""
    ticker_match = re.search(r"TICKER:\s*([A-Za-z0-9.\-=]+)", text, re.IGNORECASE)
    action_match = re.search(r"ACTION:\s*([A-Za-z]+)", text, re.IGNORECASE)

    ticker = ticker_match.group(1).upper().replace('*', '').replace(',', '').strip() if ticker_match else None
    action = action_match.group(1).upper().replace('*', '').replace(',', '').strip() if action_match else None

    if not ticker:
        ticker = "AAPL"
        print("[Extraction] Failed to find TICKER — falling back to AAPL.")
    if not action or action not in ("LONG", "SHORT"):
        action = "LONG"
        print("[Extraction] Failed to find ACTION — falling back to LONG.")

    return ticker, action


# ── Layer 1: Shared Retrieval ─────────────────────────────────────────────────

def _fetch_macro_indicators() -> str:
    """
    Fetch key macro indicators via yfinance: VIX, DXY, US 10Y yield, Gold, Oil.
    Returns a formatted markdown block. Non-fatal on failure.
    """
    import yfinance as yf
    import math as _math
    MACRO_TICKERS = {
        "VIX (Fear Index)":     "^VIX",
        "DXY (Dollar Index)":   "DX-Y.NYB",
        "US 10Y Yield":         "^TNX",
        "Gold (GC=F)":          "GC=F",
        "Crude Oil (CL=F)":     "CL=F",
        "S&P 500 (SPY)":        "SPY",
        "Nasdaq (QQQ)":         "QQQ",
        "Bitcoin (BTC-USD)":    "BTC-USD",
    }
    lines = ["## Macro Indicators (Live)\n"]
    for label, sym in MACRO_TICKERS.items():
        try:
            fi = yf.Ticker(sym).fast_info
            price = fi.last_price
            if price is None or (isinstance(price, float) and _math.isnan(price)):
                continue
            # 5d change
            hist = yf.Ticker(sym).history(period="5d", interval="1d", auto_adjust=True)
            if not hist.empty and len(hist) >= 2:
                closes = hist["Close"].dropna()
                chg = (float(closes.iloc[-1]) - float(closes.iloc[0])) / float(closes.iloc[0]) * 100
                lines.append(f"- **{label}**: {price:.2f}  ({chg:+.2f}% 5d)")
            else:
                lines.append(f"- **{label}**: {price:.2f}")
        except Exception:
            pass
    return "\n".join(lines)


def _fetch_per_ticker_news(symbol: str, max_items: int = 5) -> str:
    """
    Fetch recent news specifically for one ticker via yfinance.
    Returns a short markdown block. Non-fatal.
    """
    try:
        import yfinance as yf
        ticker = yf.Ticker(symbol)
        news = ticker.news
        if not news:
            return ""
        lines = [f"**{symbol} Recent News:**"]
        for item in news[:max_items]:
            title = item.get("title", "")
            pub = item.get("providerPublishTime", 0)
            if pub:
                from datetime import datetime as _dt
                age_h = (datetime.utcnow() - _dt.utcfromtimestamp(pub)).total_seconds() / 3600
                if age_h < 1:
                    age = f"{int(age_h*60)}m ago"
                elif age_h < 24:
                    age = f"{int(age_h)}h ago"
                elif age_h < 168:
                    age = f"{int(age_h/24)}d ago"
                else:
                    age = f"{int(age_h/168)}w ago"
                lines.append(f"  - [{age}] {title}")
            else:
                lines.append(f"  - {title}")
        return "\n".join(lines)
    except Exception:
        return ""


def fetch_research_items(db, run_id: str, enabled_markets: dict,
                          investment_focus: str = "") -> list:
    """
    Fetch raw research articles for the given markets/focus.
    Returns research_items list. Called before KG ingest so the graph is built first.
    """
    markets_str = ", ".join(enabled_markets.keys()) if enabled_markets else "none"
    focus_str = f" | focus: {investment_focus[:60]}" if investment_focus else ""
    all_tickers = [sym for tickers in enabled_markets.values() for sym in tickers]
    _log(db, run_id, "WEB_RESEARCH", "IN_PROGRESS",
         f"Fetching research for {len(all_tickers)} tickers across {markets_str}{focus_str}")

    dynamic_topics = [
        "global stock market outlook today",
        "top market movers gainers losers",
        "Federal Reserve interest rates policy",
        "earnings season results surprises",
        "geopolitical risk markets",
    ]
    for market, tickers in enabled_markets.items():
        dynamic_topics.append(f"{market} market news today")
        for sym in tickers[:2]:
            clean = sym.replace(".NS", "").replace("-USD", "").replace("=F", "")
            dynamic_topics.append(f"{clean} stock news analysis")

    if investment_focus:
        focus_lower = investment_focus.lower()
        dynamic_topics.append(investment_focus[:120])
        for keyword in ["tech", "ai", "semiconductor", "ev", "electric vehicle",
                        "healthcare", "pharma", "biotech", "energy", "oil", "renewable",
                        "banking", "finance", "crypto", "bitcoin", "india", "emerging market",
                        "small cap", "growth", "dividend"]:
            if keyword in focus_lower:
                dynamic_topics.append(f"{keyword} sector news catalyst today")

    return fetch_web_research(topics=dynamic_topics, enabled_tickers=enabled_markets)


def build_shared_retrieval_context(db, run_id: str, enabled_markets: dict,
                                    investment_focus: str = "",
                                    research_items: list = None) -> tuple[str, list, list]:
    """
    Build the full shared context string for agents from pre-fetched research items.
    If research_items is None, fetches them internally (backward-compat).
    Returns (context_string, research_log, research_items).
    """
    all_tickers = [sym for tickers in enabled_markets.values() for sym in tickers]

    now = datetime.utcnow()

    # ── 1. Macro indicators ───────────────────────────────────────────────────
    macro_context = _fetch_macro_indicators()

    # ── 2. Web research articles ──────────────────────────────────────────────
    if research_items is None:
        research_items = fetch_research_items(db, run_id, enabled_markets, investment_focus)

    research_context = _annotate_research_with_dates(research_items, now)

    research_log = [
        {"title": r.get("title", "") if isinstance(r, dict) else r.title,
         "url":   r.get("source_url", "") if isinstance(r, dict) else r.source_url}
        for r in research_items
    ]

    # News headlines
    news = fetch_news()
    news_context = "## Additional Market Headlines\n" + "".join(f"- {n}\n" for n in news)
    for n in news:
        research_log.append({"title": n, "url": "N/A"})

    # ── 3 & 4 & 5. Per-ticker: price + fundamentals + news (parallelised) ────
    price_lines = []
    fundamentals_blocks = []
    per_ticker_news_blocks = []

    def _fetch_one_ticker(sym: str):
        price_line = None
        fund_block = None
        news_block = None
        try:
            sig = fetch_market_data(sym)
            if sig:
                price_line = f"  {sym}: ${sig.price:.4f}"
        except Exception:
            pass
        try:
            fund_block = _fetch_ticker_fundamentals(sym)
        except Exception:
            pass
        try:
            news_block = _fetch_per_ticker_news(sym)
        except Exception:
            pass
        return sym, price_line, fund_block, news_block

    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(_fetch_one_ticker, sym): sym for sym in all_tickers}
        for fut in as_completed(futs):
            try:
                sym, price_line, fund_block, news_block = fut.result()
                if price_line:
                    price_lines.append(price_line)
                if fund_block:
                    fundamentals_blocks.append(fund_block)
                if news_block:
                    per_ticker_news_blocks.append(news_block)
            except Exception:
                pass

    price_context = ""
    if price_lines:
        # Sort for consistent ordering
        price_lines.sort()
        price_context = f"## Live Price Snapshot ({now.strftime('%Y-%m-%d %H:%M UTC')})\n" + "\n".join(price_lines) + "\n"

    fundamentals_context = ""
    if fundamentals_blocks:
        fundamentals_context = "\n## Per-Ticker Deep Fundamentals\n" + "\n\n".join(fundamentals_blocks) + "\n"

    per_ticker_news_context = ""
    if per_ticker_news_blocks:
        per_ticker_news_context = "\n## Per-Ticker Recent News\n" + "\n\n".join(per_ticker_news_blocks) + "\n"

    full_context = (
        f"# Market Intelligence Report — {now.strftime('%A, %B %d, %Y %H:%M UTC')}\n\n"
        f"{macro_context}\n\n"
        f"{research_context}\n\n"
        f"{news_context}\n"
        f"{price_context}\n"
        f"{per_ticker_news_context}\n"
        f"{fundamentals_context}"
    )

    _log(db, run_id, "WEB_RESEARCH", "DONE",
         f"Research complete — {len(research_items)} articles, {len(news)} headlines, "
         f"{len(price_lines)} prices, {len(fundamentals_blocks)} fundamentals, "
         f"{len(per_ticker_news_blocks)} ticker news blocks")

    return full_context, research_log, research_items


# ── Layer 2: 4-Agent Debate Panel ────────────────────────────────────────────

def _get_interesting_stocks_from_graph(db) -> tuple[list[str], str]:
    """
    Query the knowledge graph for the most "interesting" ASSET nodes:
    - Most edges (highly connected = most events affecting this asset)
    - Most recently seen
    Returns (list_of_symbols, formatted_context_string).
    """
    try:
        from sqlalchemy import func, or_
        # Count edges per asset node
        edge_counts = {}
        asset_nodes = db.query(models.KGNode).filter(
            models.KGNode.node_type == "ASSET"
        ).order_by(models.KGNode.last_seen_at.desc()).all()

        if not asset_nodes:
            return [], ""

        now = datetime.utcnow()
        for node in asset_nodes:
            cnt = db.query(models.KGEdge).filter(
                or_(
                    models.KGEdge.source_node_id == node.node_id,
                    models.KGEdge.target_node_id == node.node_id,
                ),
                or_(
                    models.KGEdge.expires_at.is_(None),
                    models.KGEdge.expires_at > now,
                )
            ).count()
            edge_counts[node.node_id] = cnt

        # Sort by edge count desc, take top 8
        top_nodes = sorted(asset_nodes, key=lambda n: edge_counts.get(n.node_id, 0), reverse=True)[:8]
        symbols = [n.symbol or n.node_id.replace("asset:", "") for n in top_nodes]

        lines = ["## Most Active Assets in Knowledge Graph (by market event connections)"]
        for node in top_nodes:
            sym = node.symbol or node.node_id.replace("asset:", "")
            cnt = edge_counts.get(node.node_id, 0)
            lines.append(f"  - **{sym}** ({node.label}): {cnt} active event connections")
        return symbols, "\n".join(lines)
    except Exception as e:
        print(f"[KG] interesting stocks query failed: {e}")
        return [], ""


def _agent_web_search(agent_name: str, run_id: str, queries: list[str]) -> str:
    """
    Execute targeted web searches on behalf of an agent.
    Returns formatted search results as a context block.
    """
    from web_research import _fetch_google_news
    results = []
    for q in queries[:2]:  # max 2 searches per agent
        try:
            items = _fetch_google_news(q.strip(), max_items=4)
            for item in items:
                results.append(f"[Search: {q}] {item.get('title', '')} — {item.get('snippet', '')[:150]}")
        except Exception:
            pass
    if not results:
        return ""
    return "## Agent Web Search Results\n" + "\n".join(f"- {r}" for r in results)


AGENT_SEARCH_REQUEST_PROMPT = """Before forming your final investment proposal, you may request up to 2 targeted web searches to gather additional details on events or assets you see in the knowledge graph or market data.

If you want to search, output your queries in this EXACT format (nothing else on these lines):
SEARCH_QUERY_1: <specific search query>
SEARCH_QUERY_2: <specific search query>  (optional)

Or if no additional research is needed, output:
NO_SEARCH_NEEDED

Be specific — e.g. "NVIDIA Q1 2026 earnings guidance revenue" not "NVDA news".
Then stop. Do NOT write your analysis yet."""


def _query_single_agent(agent_name: str, system_prompt: str, run_id: str,
                        shared_context: str, market_constraint: str,
                        investment_focus: str = "",
                        portfolio_context: str = "",
                        kg_context: str = "") -> dict:
    """
    Two-pass agent query:
    Pass 1: Agent sees portfolio + KG + interesting stocks → requests web searches
    Pass 2: Agent sees search results → forms full structured proposal

    Returns a proposal dict on success, or None on error.
    """
    db = SessionLocal()
    try:
        _log(db, run_id, "AGENT_QUERY", "IN_PROGRESS",
             f"Querying {agent_name}…", agent_name=agent_name)

        memories = get_agent_memory(db, agent_name, limit=10)
        memory_context = format_memory_for_context(memories)
        performance_context = get_agent_performance_summary(db, agent_name)

        focus_block = ""
        if investment_focus:
            focus_block = (
                f"## Investment Focus Directive\n"
                f"The user has specified: \"{investment_focus}\"\n"
                f"Prioritise assets aligned with this focus.\n\n"
            )

        # ── Pass 1: Request targeted searches ────────────────────────────────
        pass1_context = (
            f"{focus_block}"
            f"{portfolio_context}\n\n"
            f"{kg_context}\n\n"
            f"ALLOWED MARKETS:\n{market_constraint}\n\n"
            f"---\n{memory_context}\n---\n{performance_context}\n"
        )
        search_response = query_agent(
            AGENT_SEARCH_REQUEST_PROMPT,
            pass1_context
        )

        # Parse search queries
        search_results_block = ""
        if "NO_SEARCH_NEEDED" not in search_response.upper():
            queries = []
            for line in search_response.strip().splitlines():
                m = re.search(r"SEARCH_QUERY_\d+:\s*(.+)", line, re.IGNORECASE)
                if m:
                    queries.append(m.group(1).strip())
            if queries:
                _log(db, run_id, "AGENT_QUERY", "IN_PROGRESS",
                     f"{agent_name} searching: {'; '.join(queries[:2])}", agent_name=agent_name)
                search_results_block = _agent_web_search(agent_name, run_id, queries)

        # ── Pass 2: Full analysis with search results ────────────────────────
        pass2_context = (
            f"{focus_block}"
            f"{portfolio_context}\n\n"
            f"{kg_context}\n\n"
            f"{shared_context}\n\n"
            f"{search_results_block}\n\n"
            f"ALLOWED MARKETS:\n{market_constraint}\n\n"
            f"---\n{memory_context}\n---\n{performance_context}\n"
        )
        response = query_agent(system_prompt, pass2_context)
        ticker, action = extract_proposal(response)

        pred = models.AgentPrediction(
            symbol=ticker,
            agent_name=agent_name,
            prediction=action,
            reasoning=response,
            confidence=0.8,
        )
        db.add(pred)
        db.commit()

        print(f"{agent_name} proposes: {action} {ticker}")
        _log(db, run_id, "AGENT_QUERY", "DONE",
             f"Proposed {action} {ticker}", agent_name=agent_name)

        return {
            "agent_name": agent_name,
            "ticker":     ticker,
            "action":     action,
            "reasoning":  response,
        }
    except Exception as e:
        print(f"[Debate] Agent {agent_name} error: {e}")
        _log(db, run_id, "AGENT_QUERY", "ERROR",
             f"{agent_name} failed: {str(e)[:200]}", agent_name=agent_name)
        return None
    finally:
        db.close()


def _build_portfolio_context(db) -> str:
    """
    Build a portfolio snapshot block injected into every agent's context.
    Agents must be aware of existing positions to avoid redundant proposals
    and to consider position sizing / risk concentration.
    """
    active = (
        db.query(models.DeployedStrategy)
        .filter(models.DeployedStrategy.status.in_(["ACTIVE", "PENDING"]))
        .all()
    )
    budget_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "trading_budget").first()
    total_budget = float(budget_conf.value) if budget_conf else 10000.0
    allocated = sum(s.position_size or 0.0 for s in active)
    available = total_budget - allocated

    lines = [
        "## Current Portfolio — MUST READ BEFORE PROPOSING",
        f"- Total budget: ${total_budget:,.2f}  |  Allocated: ${allocated:,.2f}  |  Available: ${available:,.2f}",
    ]
    if active:
        lines.append("- Open positions (DO NOT duplicate these):")
        for s in active:
            ret = f"  ({s.current_return:+.1f}%)" if s.current_return is not None else ""
            lines.append(
                f"  • {s.strategy_type} {s.symbol} @ ${s.entry_price:.4f}{ret} — status: {s.status}"
            )
        lines.append(
            "⚠️  RULE: Do NOT propose a ticker already in the open positions above. "
            "Look for a DIFFERENT opportunity. If you believe an existing position needs a direction change, "
            "state that explicitly instead of proposing it as a new trade."
        )
    else:
        lines.append("- No open positions. Full budget available.")

    return "\n".join(lines)


def run_debate_panel(db, run_id: str, shared_context: str, market_constraint: str,
                     investment_focus: str = "") -> list:
    """
    Queries all 4 agents IN PARALLEL — each in its own thread with its own DB session.
    Returns proposals_log: [{agent_name, ticker, action, reasoning}]
    """
    from knowledge_graph import build_kg_context_for_ticker

    agent_prompts = db.query(models.AgentPrompt).all()

    # Snapshot agent data before handing off to threads (avoid sharing the session)
    agents_snapshot = [(ap.agent_name, ap.system_prompt) for ap in agent_prompts]

    # Build portfolio context once — all agents see the same open positions
    portfolio_context = _build_portfolio_context(db)

    # Build KG context: interesting stocks + their subgraphs
    interesting_symbols, interesting_summary = _get_interesting_stocks_from_graph(db)
    kg_parts = []
    if interesting_summary:
        kg_parts.append(interesting_summary)
    for sym in interesting_symbols[:6]:  # cap at 6 subgraphs to keep context manageable
        subgraph_ctx = build_kg_context_for_ticker(db, sym)
        if subgraph_ctx:
            kg_parts.append(subgraph_ctx)
    kg_context = "\n\n".join(kg_parts) if kg_parts else ""
    if kg_context:
        _log(db, run_id, "DEBATE_PANEL", "IN_PROGRESS",
             f"KG context built for {len(interesting_symbols)} assets — passing to agents")

    proposals_log = []
    with ThreadPoolExecutor(max_workers=len(agents_snapshot)) as executor:
        futures = {
            executor.submit(
                _query_single_agent,
                name, prompt, run_id, shared_context, market_constraint,
                investment_focus, portfolio_context, kg_context
            ): name
            for name, prompt in agents_snapshot
        }
        for future in as_completed(futures):
            result = future.result()
            if result:
                proposals_log.append(result)

    # Sort to keep a consistent order in the debate log
    order = {name: i for i, (name, _) in enumerate(agents_snapshot)}
    proposals_log.sort(key=lambda p: order.get(p["agent_name"], 99))

    return proposals_log


# ── Layer 3: Judge ────────────────────────────────────────────────────────────

JUDGE_SYSTEM_PROMPT = """You are the Chief Investment Officer of a quantitative hedge fund, acting as the final decision-maker in a multi-agent trading committee. You have reviewed thousands of trade proposals over your career and you know exactly how to separate signal from noise.

You will receive:
- A full market intelligence report (macro environment, news, live prices, fundamentals)
- Structured proposals from 4 specialist agents (Value Investor, Technical Analyst, Macro Economist, Sentiment Analyst)
- The current portfolio budget and open positions

## YOUR SCORING FRAMEWORK

For each agent proposal, evaluate it on these 5 dimensions (score each 1–10):

1. **THESIS QUALITY** — Is the core argument specific, data-backed, and non-obvious? (Generic "bullish on AI" = 2; Specific "NVDA P/E contracted 30% while forward estimates held — mispricing" = 9)
2. **CATALYST SPECIFICITY** — Is there a clear, near-term (< 2 weeks) catalyst? Earnings, product launch, regulatory event, macro release? (No catalyst = 2; Named catalyst with date = 9)
3. **NEWS FRESHNESS** — Is the thesis supported by news from the last 48 hours? (Only stale news = 2; Multiple fresh headlines directly supporting the thesis = 9)
4. **RISK/REWARD CLARITY** — Does the agent define what would invalidate the thesis? Is there a stated stop level or timeframe? (Vague = 2; Clear invalidation + timeframe = 9)
5. **CROSS-AGENT CONFIRMATION** — Do other agents' analyses corroborate this pick directionally? (All disagree = 1; 2+ agents aligned = 8; unanimous = 10)

## DECISION RULES

- **DO NOT** pick a trade with a composite score below 25/50
- **DO NOT** duplicate an existing open position (check open_positions in budget context)
- **DO** prefer high-conviction single-agent picks over weak consensus if the thesis is tight
- **DO** consider macro regime: in risk-off environments, short candidates score higher
- **DO** flag if no proposal meets the quality bar — output HOLD instead

## OUTPUT FORMAT (exact format required)

PROPOSAL_SCORES:
- Value Investor: [score]/50 — [1 sentence rationale]
- Technical Analyst: [score]/50 — [1 sentence rationale]
- Macro Economist: [score]/50 — [1 sentence rationale]
- Sentiment Analyst: [score]/50 — [1 sentence rationale]

WINNER_TICKER: <SYMBOL or HOLD>
WINNER_ACTION: LONG or SHORT (omit if HOLD)
JUDGE_REASONING: <3-5 sentences: why this is the best proposal, the specific edge it has, the key risk to watch, and what would trigger an early exit>

Be decisive. One winner per committee session."""


def run_judge(db, run_id: str, proposals_log: list, shared_context: str,
              budget_context: str = "", market_constraint: str = "") -> tuple[str, str, str]:
    """
    The Judge reviews all 4 proposals + shared market context and picks the best one.
    Returns (winner_ticker, winner_action, judge_reasoning).
    Falls back to plurality vote if the judge LLM fails.
    """
    _log(db, run_id, "JUDGE", "IN_PROGRESS",
         f"Judge evaluating {len(proposals_log)} proposals…")

    # Build the judge's input — pass full reasoning (no truncation)
    proposals_text = "\n\n".join(
        f"--- {p['agent_name']} ---\n"
        f"Proposal: {p['action']} {p['ticker']}\n"
        f"Full Analysis:\n{p['reasoning']}"
        for p in proposals_log
    )

    market_block = (
        f"## Enabled Markets (HARD CONSTRAINT)\n"
        f"{market_constraint}\n"
        f"**You MUST only select a WINNER_TICKER from the enabled markets above. "
        f"Any proposal from a disabled market must be rejected regardless of quality.**\n\n"
    ) if market_constraint else ""

    judge_input = (
        f"## Current Market Intelligence Report (shared by all agents)\n"
        f"{shared_context[:6000]}\n\n"
        f"{budget_context}\n\n"
        f"{market_block}"
        f"## Agent Proposals (Full Analysis)\n"
        f"{proposals_text}\n\n"
        f"Now score each proposal and deliver your verdict."
    )

    response = query_agent(JUDGE_SYSTEM_PROMPT, judge_input)

    # Parse judge output
    ticker_match  = re.search(r"WINNER_TICKER:\s*([A-Za-z0-9.\-=]+)", response, re.IGNORECASE)
    action_match  = re.search(r"WINNER_ACTION:\s*(LONG|SHORT)", response, re.IGNORECASE)
    reason_match  = re.search(r"JUDGE_REASONING:\s*(.+)", response, re.IGNORECASE | re.DOTALL)

    winner_ticker  = ticker_match.group(1).upper().strip() if ticker_match else None
    winner_action  = action_match.group(1).upper().strip() if action_match else None
    judge_reasoning = reason_match.group(1).strip()[:2000] if reason_match else response[:1000]

    # HOLD case — judge decided no proposal meets the quality bar
    if winner_ticker == "HOLD":
        print("[Judge] Verdict: HOLD — no proposal met quality threshold. Falling back to plurality vote.")
        _log(db, run_id, "JUDGE", "DONE", "Judge issued HOLD — using plurality fallback")
        winner_ticker = None

    # Validate the judge picked a ticker that was actually proposed
    proposed_tickers = {p["ticker"] for p in proposals_log}
    if winner_ticker and winner_ticker not in proposed_tickers:
        print(f"[Judge] Picked {winner_ticker} which wasn't proposed — falling back to plurality vote.")
        winner_ticker = None

    # Validate the winner is from an enabled market
    if winner_ticker and market_constraint:
        all_enabled_tickers = set()
        for tickers in MARKET_TICKERS.values():
            # check if this market appears in the constraint
            for t in tickers:
                if t in market_constraint:
                    all_enabled_tickers.add(t)
        if all_enabled_tickers and winner_ticker not in all_enabled_tickers:
            print(f"[Judge] Picked {winner_ticker} from a disabled market — falling back to plurality vote.")
            _log(db, run_id, "JUDGE", "IN_PROGRESS",
                 f"Judge picked {winner_ticker} from disabled market — using plurality fallback")
            winner_ticker = None

    if winner_ticker and winner_action:
        print(f"[Judge] Verdict: {winner_action} {winner_ticker}")
        _log(db, run_id, "JUDGE", "DONE",
             f"Judge verdict: {winner_action} {winner_ticker} — {judge_reasoning[:120]}…")
        return winner_ticker, winner_action, judge_reasoning

    # Fallback: plurality vote (only from enabled tickers)
    print("[Judge] LLM parse failed or disabled market — using plurality vote as fallback.")
    vote_counts: dict[str, int] = {}
    for p in proposals_log:
        # Skip proposals from disabled markets if constraint is set
        if market_constraint:
            all_enabled = [t for tickers in MARKET_TICKERS.values() for t in tickers if t in market_constraint]
            if all_enabled and p["ticker"] not in all_enabled:
                continue
        key = f"{p['ticker']}_{p['action']}"
        vote_counts[key] = vote_counts.get(key, 0) + 1
    if not vote_counts:
        # All proposals were from disabled markets — use unfiltered
        for p in proposals_log:
            key = f"{p['ticker']}_{p['action']}"
            vote_counts[key] = vote_counts.get(key, 0) + 1
    best_key = max(vote_counts, key=vote_counts.get)
    ft, fa = best_key.split("_")
    fallback_reason = f"Plurality vote fallback ({vote_counts[best_key]}/{len(proposals_log)} votes). Judge output could not be parsed."
    _log(db, run_id, "JUDGE", "DONE",
         f"Plurality fallback: {fa} {ft}")
    return ft, fa, fallback_reason


# ── Main entry point ──────────────────────────────────────────────────────────

def run_debate(focus_tickers: list[str] | None = None):
    """
    Full pipeline:
      1. Shared Retrieval Layer  — fetch market data + news once
      2. 4-Agent Debate Panel    — each agent gets shared context + own memory
      3. Judge                   — independent LLM picks the best proposal
      4. Deploy                  — save strategy with judge reasoning
      5. Memory Write            — update all agent memories

    focus_tickers: if provided, agents are constrained to only these tickers
                   (ignores market enable/disable settings for this run).
    """
    db = SessionLocal()

    # Concurrency lock
    is_running_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "debate_running").first()
    if is_running_conf and is_running_conf.value == "1":
        print("[Debate] Already running. Skipping.")
        db.close()
        return None

    run_id = str(_uuid.uuid4())
    run_id_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "current_run_id").first()
    if run_id_conf:
        run_id_conf.value = run_id
    else:
        db.add(models.AppConfig(key="current_run_id", value=run_id))

    if not is_running_conf:
        db.add(models.AppConfig(key="debate_running", value="1"))
    else:
        is_running_conf.value = "1"
    db.commit()

    print(f"--- Starting Debate Pipeline (run_id={run_id}) ---")
    _log(db, run_id, "START", "DONE", "Pipeline initialised — lock acquired")

    try:
        setup_agent_prompts(db)

        if focus_tickers:
            # Override: build a synthetic single-bucket market from the pinned tickers
            enabled_markets = {"Focused": focus_tickers}
            _log(db, run_id, "START", "DONE",
                 f"Focused run on: {', '.join(focus_tickers)}")
        else:
            enabled_markets = get_enabled_markets(db)

        market_constraint = build_market_constraint(enabled_markets)

        # Load investment focus directive
        focus_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "investment_focus").first()
        investment_focus = focus_conf.value.strip() if focus_conf and focus_conf.value else ""
        if investment_focus:
            _log(db, run_id, "START", "DONE", f"Investment focus: {investment_focus[:100]}")

        # ── 1a. Fetch raw research articles ──────────────────────────────────
        all_tickers = [sym for tickers in enabled_markets.values() for sym in tickers]
        research_items = fetch_research_items(db, run_id, enabled_markets, investment_focus)

        # ── 1b. Build Knowledge Graph from those articles ─────────────────────
        try:
            from knowledge_graph import upsert_asset_nodes, ingest_retrieval_to_graph
            upsert_asset_nodes(db, all_tickers)
            _log(db, run_id, "KG_INGEST", "IN_PROGRESS",
                 f"Extracting graph facts from {len(research_items)} research items…")
            edges_added = ingest_retrieval_to_graph(db, research_items, run_id)
            _log(db, run_id, "KG_INGEST", "DONE",
                 f"Knowledge graph updated — {edges_added} new edges (semantic dedup applied)")
        except Exception as kg_err:
            import traceback as _tb
            _log(db, run_id, "KG_INGEST", "ERROR",
                 f"KG ingest failed: {str(kg_err)[:300]} | {_tb.format_exc()[-300:]}")

        # ── 1c. Build shared context using fresh graph ────────────────────────
        shared_context, research_log, _ = build_shared_retrieval_context(
            db, run_id, enabled_markets, investment_focus=investment_focus,
            research_items=research_items)

        # ── 2. 4-Agent Debate Panel ───────────────────────────────────────────
        _log(db, run_id, "DEBATE_PANEL", "IN_PROGRESS",
             f"Starting debate panel with {len(DEFAULT_AGENTS)} agents…")
        proposals_log = run_debate_panel(db, run_id, shared_context, market_constraint,
                                         investment_focus=investment_focus)

        if not proposals_log:
            _log(db, run_id, "DEBATE_PANEL", "ERROR", "No proposals — aborting")
            return None
        _log(db, run_id, "DEBATE_PANEL", "DONE",
             f"{len(proposals_log)} proposals received: " +
             ", ".join(f"{p['action']} {p['ticker']}" for p in proposals_log))

        # ── 3. Judge ──────────────────────────────────────────────────────────
        # Build budget context for the judge
        budget_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "trading_budget").first()
        total_budget = float(budget_conf.value) if budget_conf else 10000.0
        active_strats = db.query(models.DeployedStrategy).filter(models.DeployedStrategy.status == "ACTIVE").all()
        allocated = sum(s.position_size or 0.0 for s in active_strats)
        available = total_budget - allocated
        open_positions = ", ".join(f"{s.strategy_type} {s.symbol}" for s in active_strats) or "none"
        budget_context = (
            f"## Portfolio Budget Context\n"
            f"- Total budget: ${total_budget:,.2f}\n"
            f"- Allocated to open positions: ${allocated:,.2f}\n"
            f"- Available capital: ${available:,.2f}\n"
            f"- Open positions: {open_positions}\n"
            f"Only recommend a new trade if sufficient capital is available. "
            f"If budget is low, prefer closing an underperforming position over opening a new one."
        )
        best_ticker, best_action, judge_reasoning = run_judge(
            db, run_id, proposals_log, shared_context, budget_context,
            market_constraint=market_constraint
        )

        # ── 4. Deploy ─────────────────────────────────────────────────────────
        signal = fetch_market_data(best_ticker)
        entry_price = signal.price if signal else 0.0

        # Count how many agents agreed with the judge's pick
        agreeing = sum(1 for p in proposals_log
                       if p["ticker"] == best_ticker and p["action"] == best_action)
        votes_str = f"{agreeing}/{len(proposals_log)}"

        approval_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "approval_mode").first()
        approval_mode = approval_conf.value if approval_conf else "auto"
        initial_status = "ACTIVE" if approval_mode == "auto" else "PENDING"

        summary_text = (
            f"Judge selected {best_action} {best_ticker} at ${entry_price:.4f}. "
            f"{agreeing}/{len(proposals_log)} agents agreed. "
            f"Rationale: {judge_reasoning[:200]}"
        )

        _log(db, run_id, "DEPLOY", "IN_PROGRESS",
             f"Creating {initial_status} strategy: {best_action} {best_ticker} @ ${entry_price:.2f}")

        strategy = models.DeployedStrategy(
            symbol=best_ticker,
            strategy_type=best_action,
            entry_price=entry_price,
            reasoning_summary=summary_text,
            status=initial_status,
        )
        db.add(strategy)

        debate_round = models.DebateRound(
            consensus_ticker=best_ticker,
            consensus_action=best_action,
            consensus_votes=votes_str,
            proposals_json=json.dumps(proposals_log),
            enabled_markets=", ".join(enabled_markets.keys()) if enabled_markets else "None",
            research_context=json.dumps(research_log),
            judge_reasoning=judge_reasoning,
        )
        db.add(debate_round)
        db.commit()
        db.refresh(debate_round)

        _log(db, run_id, "DEPLOY", "DONE",
             f"Strategy saved (status={initial_status}) — Debate round #{debate_round.id}")

        # ── 5. Memory Write ───────────────────────────────────────────────────
        _log(db, run_id, "MEMORY_WRITE", "IN_PROGRESS",
             f"Writing memory notes for {len(proposals_log)} agents…")

        for proposal in proposals_log:
            agent_name   = proposal["agent_name"]
            their_ticker = proposal["ticker"]
            their_action = proposal["action"]
            agreed       = (their_ticker == best_ticker and their_action == best_action)

            if agreed:
                note = (
                    f"Round {debate_round.id}: Your {their_action} {their_ticker} call was selected "
                    f"at ${entry_price:.4f}. Watch this position — you'll get a P&L update when it closes. "
                    f"Reflect on why this analysis was strong."
                )
                note_type = "INSIGHT"
            else:
                note = (
                    f"Round {debate_round.id}: You proposed {their_action} {their_ticker} but judge "
                    f"deployed {best_action} {best_ticker} @ ${entry_price:.4f}. "
                    f"Track how {best_ticker} performs vs your pick {their_ticker} — "
                    f"compare outcomes to sharpen your edge."
                )
                note_type = "OBSERVATION"

            write_agent_memory(db, agent_name, note_type, note, debate_round.id)
            pruned = prune_old_memory(db, agent_name, keep=50)
            if pruned:
                print(f"[Memory] Pruned {pruned} old notes for {agent_name}")

        db.commit()
        _log(db, run_id, "MEMORY_WRITE", "DONE", "Agent memories updated — pipeline complete")

        print(summary_text)
        return strategy

    except Exception as e:
        print(f"[Debate] Critical error: {e}")
        try:
            _log(db, run_id, "ERROR", "ERROR", str(e)[:300])
        except Exception:
            pass
        db.rollback()
        return None

    finally:
        lock = db.query(models.AppConfig).filter(models.AppConfig.key == "debate_running").first()
        if lock:
            lock.value = "0"
            db.commit()
        print("[Debate] Lock released.")
        db.close()


if __name__ == "__main__":
    run_debate()
