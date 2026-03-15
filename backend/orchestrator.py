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
    Fetch key fundamentals + 5-day price history for a ticker.
    Returns a compact markdown block for agent context injection.
    Designed to be fast — uses only fields yfinance returns without a full .info call on slow endpoints.
    """
    import yfinance as yf
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.fast_info  # fast_info is much quicker than .info
        hist = ticker.history(period="5d", interval="1d", auto_adjust=True)

        lines = [f"### {symbol} Key Metrics"]

        # fast_info fields
        fi = info
        try:
            mktcap = fi.market_cap
            if mktcap:
                if mktcap >= 1e12: lines.append(f"- Market Cap: ${mktcap/1e12:.2f}T")
                elif mktcap >= 1e9: lines.append(f"- Market Cap: ${mktcap/1e9:.1f}B")
                else: lines.append(f"- Market Cap: ${mktcap/1e6:.0f}M")
        except Exception: pass
        try:
            if fi.fifty_two_week_high and fi.fifty_two_week_low:
                lines.append(f"- 52w Range: ${fi.fifty_two_week_low:.2f} – ${fi.fifty_two_week_high:.2f}")
        except Exception: pass
        try:
            if fi.last_price:
                lines.append(f"- Last Price: ${fi.last_price:.4f}")
        except Exception: pass

        # 5-day price history
        if not hist.empty:
            closes = hist["Close"].dropna()
            if len(closes) >= 2:
                chg = ((float(closes.iloc[-1]) - float(closes.iloc[0])) / float(closes.iloc[0])) * 100
                lines.append(f"- 5-day price change: {chg:+.2f}%")
            price_row = " | ".join(
                f"{ts.strftime('%m-%d')}: ${float(c):.2f}"
                for ts, c in zip(hist.index[-5:], closes.values[-5:])
            )
            lines.append(f"- Recent closes: {price_row}")

        return "\n".join(lines)
    except Exception as e:
        return f"### {symbol} Key Metrics\n- Data unavailable: {e}"


def _annotate_research_with_dates(research_items: list[dict], now: datetime) -> str:
    """
    Format research with news age labels so agents can judge relevance.
    E.g. '[2h ago] Bitcoin surges...' or '[3d ago] Fed hikes rates...'
    """
    lines = [f"## Latest Market News & Research\n(Current date/time: {now.strftime('%Y-%m-%d %H:%M UTC')})\n"]
    for i, r in enumerate(research_items[:25], 1):
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

def build_shared_retrieval_context(db, run_id: str, enabled_markets: dict,
                                    investment_focus: str = "") -> tuple[str, list]:
    """
    Fetches web research + news + live price snapshot ONCE.
    Returns (context_string, research_log).
    All 4 agents receive the exact same retrieval context — no duplicated fetches.
    """
    markets_str = ", ".join(enabled_markets.keys()) if enabled_markets else "none"
    focus_str = f" | focus: {investment_focus[:60]}" if investment_focus else ""
    _log(db, run_id, "WEB_RESEARCH", "IN_PROGRESS",
         f"Fetching shared research for: {markets_str}{focus_str}")

    # Web research — seed topics from markets + investment focus
    dynamic_topics = ["global stock market updates", "top market gainers and losers today"]
    for market, tickers in enabled_markets.items():
        if tickers:
            dynamic_topics.append(f"{market} market news {tickers[0]}")

    # Add investment-focus-derived topics so research is targeted
    if investment_focus:
        focus_lower = investment_focus.lower()
        # Break the prompt into meaningful search phrases (up to 3 extra topics)
        words = [w.strip(".,;:") for w in focus_lower.split() if len(w) > 3]
        # Build topic from full focus text (trimmed)
        dynamic_topics.append(investment_focus[:120])
        # Add sector/theme sub-queries derived from the focus text
        for keyword in ["tech", "ai", "semiconductor", "ev", "electric vehicle",
                        "healthcare", "pharma", "biotech", "energy", "oil", "renewable",
                        "banking", "finance", "crypto", "bitcoin", "india", "emerging market",
                        "small cap", "growth", "dividend", "etf"]:
            if keyword in focus_lower:
                dynamic_topics.append(f"{keyword} stocks news today")

    now = datetime.utcnow()
    research_items = fetch_web_research(topics=dynamic_topics, enabled_tickers=enabled_markets)

    # Use date-annotated format so agents can judge news recency
    research_context = _annotate_research_with_dates(research_items, now)

    research_log = [
        {"title": r.get("title", "") if isinstance(r, dict) else r.title,
         "url":   r.get("source_url", "") if isinstance(r, dict) else r.source_url}
        for r in research_items
    ]

    # News headlines
    news = fetch_news()
    news_context = "## Additional News Headlines\n" + "".join(f"- {n}\n" for n in news)
    for n in news:
        research_log.append({"title": n, "url": "N/A"})

    # Live price snapshot + 5-day fundamentals for all enabled tickers
    price_lines = []
    fundamentals_blocks = []
    for market, tickers in enabled_markets.items():
        for sym in tickers[:4]:  # sample up to 4 per market
            sig = fetch_market_data(sym)
            if sig:
                price_lines.append(f"  {sym}: ${sig.price:.4f}")
            # Fetch compact fundamentals for each sampled ticker
            fund_block = _fetch_ticker_fundamentals(sym)
            if fund_block:
                fundamentals_blocks.append(fund_block)

    price_context = ""
    if price_lines:
        price_context = f"## Live Price Snapshot (as of {now.strftime('%Y-%m-%d %H:%M UTC')})\n" + "\n".join(price_lines) + "\n"

    fundamentals_context = ""
    if fundamentals_blocks:
        fundamentals_context = "\n## Per-Ticker Fundamentals & Recent Performance\n" + "\n\n".join(fundamentals_blocks) + "\n"

    full_context = f"# Market Context — {now.strftime('%A, %B %d, %Y %H:%M UTC')}\n\n{research_context}\n\n{news_context}\n{price_context}\n{fundamentals_context}"
    _log(db, run_id, "WEB_RESEARCH", "DONE",
         f"Shared context ready — {len(research_items)} articles, {len(news)} headlines, {len(price_lines)} live prices, {len(fundamentals_blocks)} ticker fundamentals")

    return full_context, research_log


# ── Layer 2: 4-Agent Debate Panel ────────────────────────────────────────────

def _query_single_agent(agent_name: str, system_prompt: str, run_id: str,
                        shared_context: str, market_constraint: str,
                        investment_focus: str = "") -> dict:
    """
    Run one agent in its own thread with its own DB session.
    Returns a proposal dict on success, or None on error.
    """
    db = SessionLocal()
    try:
        _log(db, run_id, "AGENT_QUERY", "IN_PROGRESS",
             f"Querying {agent_name} with shared context + memory…", agent_name=agent_name)

        memories = get_agent_memory(db, agent_name, limit=10)
        memory_context = format_memory_for_context(memories)
        performance_context = get_agent_performance_summary(db, agent_name)

        focus_block = ""
        if investment_focus:
            focus_block = (
                f"## Investment Focus Directive\n"
                f"The user has specified the following investment interest for this run:\n"
                f"\"{investment_focus}\"\n"
                f"Prioritise assets and sectors that align with this focus when making your proposal.\n\n"
            )

        agent_context = (
            f"{focus_block}"
            f"{shared_context}\n\n"
            f"ALLOWED MARKETS:\n{market_constraint}\n\n"
            f"---\n\n"
            f"{memory_context}\n\n"
            f"---\n\n"
            f"{performance_context}\n"
        )

        response = query_agent(system_prompt, agent_context)
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
            "reasoning":  response[:600],
        }
    except Exception as e:
        print(f"[Debate] Agent {agent_name} error: {e}")
        _log(db, run_id, "AGENT_QUERY", "ERROR",
             f"{agent_name} failed: {str(e)[:200]}", agent_name=agent_name)
        return None
    finally:
        db.close()


def run_debate_panel(db, run_id: str, shared_context: str, market_constraint: str,
                     investment_focus: str = "") -> list:
    """
    Queries all 4 agents IN PARALLEL — each in its own thread with its own DB session.
    Returns proposals_log: [{agent_name, ticker, action, reasoning}]
    """
    agent_prompts = db.query(models.AgentPrompt).all()

    # Snapshot agent data before handing off to threads (avoid sharing the session)
    agents_snapshot = [(ap.agent_name, ap.system_prompt) for ap in agent_prompts]

    proposals_log = []
    with ThreadPoolExecutor(max_workers=len(agents_snapshot)) as executor:
        futures = {
            executor.submit(
                _query_single_agent,
                name, prompt, run_id, shared_context, market_constraint, investment_focus
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

JUDGE_SYSTEM_PROMPT = """You are an independent trading committee judge with deep expertise in global markets.

You will receive proposals from 4 specialist agents, plus the current portfolio budget context.
Your job is to:
1. Evaluate each proposal on its merits: quality of reasoning, alignment with market data, risk/reward
2. Consider the available budget — do NOT recommend a trade if the portfolio has insufficient capital
3. Identify the strongest proposal — not necessarily the most popular one
4. Output your verdict in this EXACT format:

WINNER_TICKER: <SYMBOL>
WINNER_ACTION: LONG or SHORT
JUDGE_REASONING: <2-4 sentences explaining why this is the best trade and what risks to watch>

Be decisive. Do not hedge. Pick exactly one winner."""


def run_judge(db, run_id: str, proposals_log: list, shared_context: str, budget_context: str = "") -> tuple[str, str, str]:
    """
    The Judge reviews all 4 proposals + shared market context and picks the best one.
    Returns (winner_ticker, winner_action, judge_reasoning).
    Falls back to plurality vote if the judge LLM fails.
    """
    _log(db, run_id, "JUDGE", "IN_PROGRESS",
         f"Judge evaluating {len(proposals_log)} proposals…")

    # Build the judge's input
    proposals_text = "\n\n".join(
        f"--- {p['agent_name']} ---\n"
        f"Proposal: {p['action']} {p['ticker']}\n"
        f"Reasoning: {p['reasoning']}"
        for p in proposals_log
    )

    judge_input = (
        f"## Current Market Context (shared by all agents)\n"
        f"{shared_context[:3000]}\n\n"
        f"{budget_context}\n\n"
        f"## Agent Proposals\n"
        f"{proposals_text}\n\n"
        f"Now deliver your verdict."
    )

    response = query_agent(JUDGE_SYSTEM_PROMPT, judge_input)

    # Parse judge output
    ticker_match  = re.search(r"WINNER_TICKER:\s*([A-Za-z0-9.\-=]+)", response, re.IGNORECASE)
    action_match  = re.search(r"WINNER_ACTION:\s*(LONG|SHORT)", response, re.IGNORECASE)
    reason_match  = re.search(r"JUDGE_REASONING:\s*(.+)", response, re.IGNORECASE | re.DOTALL)

    winner_ticker  = ticker_match.group(1).upper().strip() if ticker_match else None
    winner_action  = action_match.group(1).upper().strip() if action_match else None
    judge_reasoning = reason_match.group(1).strip()[:1000] if reason_match else response[:500]

    # Validate the judge picked a ticker that was actually proposed
    proposed_tickers = {p["ticker"] for p in proposals_log}
    if winner_ticker not in proposed_tickers:
        print(f"[Judge] Picked {winner_ticker} which wasn't proposed — falling back to plurality vote.")
        winner_ticker = None

    if winner_ticker and winner_action:
        print(f"[Judge] Verdict: {winner_action} {winner_ticker}")
        _log(db, run_id, "JUDGE", "DONE",
             f"Judge verdict: {winner_action} {winner_ticker} — {judge_reasoning[:120]}…")
        return winner_ticker, winner_action, judge_reasoning

    # Fallback: plurality vote
    print("[Judge] LLM parse failed — using plurality vote as fallback.")
    vote_counts: dict[str, int] = {}
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

        # ── 1. Shared Retrieval ───────────────────────────────────────────────
        shared_context, research_log = build_shared_retrieval_context(
            db, run_id, enabled_markets, investment_focus=investment_focus)

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
            db, run_id, proposals_log, shared_context, budget_context
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
