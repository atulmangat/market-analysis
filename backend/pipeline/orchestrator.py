from sqlalchemy.orm import Session
from core.database import SessionLocal
import core.models as models
from agents.llm import query_agent
from data.market import fetch_market_data, fetch_news
from data.research import fetch_web_research, format_research_for_context
from agents.memory import (
    get_agent_memory,
    get_agent_memory_tiered,
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
    "India":  ["RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS", "ICICIBANK.NS", "WIPRO.NS", "SBIN.NS", "BAJFINANCE.NS"],
    "Crypto": ["BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD", "XRP-USD", "DOGE-USD", "ADA-USD"],
    "MCX":    ["GC=F", "SI=F", "CL=F", "NG=F", "HG=F"],
}


FOCUS_EXTRACTOR_PROMPT = """You are a financial data analyst. The user wants to find stocks matching their query.
You have been given web search results about this query.

Step 1 — Extract company names mentioned in the search results that match the user's query.
Step 2 — For each company, output a line: SEARCH: <company name as it would appear on a stock exchange>

Rules:
- Only extract real publicly traded companies directly relevant to the query
- Output 3 to 8 SEARCH lines, one per company
- Use the most recognisable English name (e.g. "Infosys" not "Infosys Limited BDR")
- If the query names a specific company (e.g. "Atlassian"), output just that one
- If no relevant companies are found in the results, output SEARCH: lines based on your knowledge
- Output ONLY the SEARCH: lines, nothing else"""

FOCUS_PICKER_PROMPT = """You are a financial data analyst. Given a user query and a list of verified stock symbols with their details, select the most relevant tickers.

Rules:
- Return ONLY a JSON array of ticker symbols. Example: ["NVDA", "INFY.NS", "TEAM"]
- Pick between 1 and 8 tickers — the most directly relevant to the user's query
- Prefer the primary exchange listing (NASDAQ/NYSE for US, .NS for India, -USD for crypto)
- Do not include ETFs unless explicitly requested
- Do not include any explanation or text outside the JSON array"""


def _yf_search(company_name: str) -> list[dict]:
    """Search yfinance for a company name, return top equity quotes."""
    try:
        import yfinance as yf
        results = yf.Search(company_name, max_results=3).quotes
        # Only keep primary exchange equities (filter out foreign ADRs and OTC pink sheets)
        preferred = [
            q for q in results
            if q.get("quoteType") == "EQUITY"
            and q.get("exchange", "") in ("NMS", "NYQ", "NGM", "NSI", "BSE", "CCC", "CMC")
        ]
        return preferred or [q for q in results if q.get("quoteType") == "EQUITY"]
    except Exception:
        return []


def resolve_focus_from_candidates(investment_focus: str, candidates: list[dict], run_id: str | None = None) -> list[str]:
    """
    Fast path: skip web search + extraction, go straight to picker LLM call.
    `candidates` is a list of dicts with keys: symbol, name, exchange, sector.
    """
    if not investment_focus or not candidates:
        return []
    try:
        candidates_text = "\n".join(
            f"  {c.get('symbol', '')} — {c.get('name', '')} ({c.get('exchange', '')}, {c.get('sector', '')})"
            for c in candidates[:20]
        )
        picker_context = (
            f'User query: "{investment_focus}"\n\n'
            f"Verified stock candidates (from yfinance):\n{candidates_text}"
        )
        pick_response = query_agent(
            FOCUS_PICKER_PROMPT,
            picker_context,
            caller="focus_resolver",
            run_id=run_id,
        )
        if not pick_response:
            return [c["symbol"] for c in candidates[:8] if c.get("symbol")]

        match = re.search(r'\[.*?\]', pick_response.strip(), re.DOTALL)
        if not match:
            return [c["symbol"] for c in candidates[:8] if c.get("symbol")]

        picked = json.loads(match.group(0))
        valid = [
            t.strip().upper() for t in picked
            if isinstance(t, str) and re.match(r'^[A-Z0-9]{1,10}([.\-=][A-Z0-9]{1,5})?$', t.strip().upper())
        ]
        print(f"[focus_resolver] Fast-path tickers: {valid}")
        return valid[:8]
    except Exception as e:
        print(f"[focus_resolver] Fast-path failed: {e}")
        return [c["symbol"] for c in candidates[:8] if c.get("symbol")]


def resolve_focus_to_tickers(investment_focus: str, run_id: str | None = None) -> list[str]:
    """
    Resolve a free-text investment focus into verified ticker symbols.

    Flow:
      1. Search Google News for the query to get real-world context
      2. LLM extracts company names from the search results
      3. yfinance Search verifies each company name → real ticker symbols
      4. LLM picks the best tickers from the verified candidates
    """
    if not investment_focus or not investment_focus.strip():
        return []

    # Strip common noise words so bare company names are extracted correctly
    _NOISE_RE = re.compile(r'\b(stock|stocks|share|shares|price|equity|ticker|invest(?:ing|ment)?|buy|sell|trade)\b', re.IGNORECASE)
    focus = _NOISE_RE.sub('', investment_focus.strip()).strip()
    if not focus:
        focus = investment_focus.strip()
    print(f"[focus_resolver] Resolving: '{focus}'")

    try:
        # ── Fast path: if query is short (≤3 words), try direct yfinance lookup first ──
        words = focus.split()
        if len(words) <= 3:
            direct = _yf_search(focus)
            if direct:
                print(f"[focus_resolver] Direct yfinance hit for '{focus}': {[q.get('symbol') for q in direct]}")
                verified_candidates = []
                seen_symbols: set[str] = set()
                for q in direct[:5]:
                    sym = q.get("symbol", "")
                    if sym and sym not in seen_symbols:
                        seen_symbols.add(sym)
                        verified_candidates.append({
                            "symbol": sym,
                            "name": q.get("longname") or q.get("shortname", sym),
                            "exchange": q.get("exchDisp", ""),
                            "sector": q.get("sectorDisp", ""),
                        })
                if verified_candidates:
                    return resolve_focus_from_candidates(investment_focus.strip(), verified_candidates, run_id)

        # ── Step 1: Web search for real-world context ─────────────────────
        from data.research import _tavily_search
        search_results = _tavily_search(f"{focus} stocks", max_results=10, topic="general")

        search_text = "\n".join(
            f"- {r['title']}: {r['snippet'][:150]}"
            for r in search_results
        ) or "(no search results)"

        # ── Step 2: LLM extracts company names from search results ────────
        extractor_context = (
            f'User query: "{focus}"\n\n'
            f"Web search results:\n{search_text}"
        )
        extraction = query_agent(
            FOCUS_EXTRACTOR_PROMPT,
            extractor_context,
            caller="focus_resolver",
            run_id=run_id,
        )
        if not extraction:
            return []

        # Parse SEARCH: lines
        company_names = []
        for line in extraction.strip().splitlines():
            m = re.match(r"SEARCH:\s*(.+)", line.strip(), re.IGNORECASE)
            if m:
                company_names.append(m.group(1).strip())

        print(f"[focus_resolver] Companies to search: {company_names}")

        if not company_names:
            return []

        # ── Step 3: yfinance verifies each company → real symbols ─────────
        verified_candidates = []
        seen_symbols: set[str] = set()
        for name in company_names[:10]:
            quotes = _yf_search(name)
            for q in quotes[:2]:
                sym = q.get("symbol", "")
                if sym and sym not in seen_symbols:
                    seen_symbols.add(sym)
                    verified_candidates.append({
                        "symbol": sym,
                        "name": q.get("longname") or q.get("shortname", sym),
                        "exchange": q.get("exchDisp", ""),
                        "sector": q.get("sectorDisp", ""),
                    })

        print(f"[focus_resolver] Verified candidates: {[c['symbol'] for c in verified_candidates]}")

        if not verified_candidates:
            return []

        # ── Step 4: LLM picks best tickers from verified list ─────────────
        candidates_text = "\n".join(
            f"  {c['symbol']} — {c['name']} ({c['exchange']}, {c['sector']})"
            for c in verified_candidates
        )
        picker_context = (
            f'User query: "{focus}"\n\n'
            f"Verified stock candidates (from yfinance):\n{candidates_text}"
        )
        pick_response = query_agent(
            FOCUS_PICKER_PROMPT,
            picker_context,
            caller="focus_resolver",
            run_id=run_id,
        )
        if not pick_response:
            # Fallback: return all verified candidates up to 8
            return [c["symbol"] for c in verified_candidates[:8]]

        match = re.search(r'\[.*?\]', pick_response.strip(), re.DOTALL)
        if not match:
            return [c["symbol"] for c in verified_candidates[:8]]

        picked = json.loads(match.group(0))
        valid = [
            t.strip().upper() for t in picked
            if isinstance(t, str) and re.match(r'^[A-Z0-9]{1,10}([.\-=][A-Z0-9]{1,5})?$', t.strip().upper())
        ]
        print(f"[focus_resolver] Final tickers: {valid}")
        return valid[:8]

    except Exception as e:
        print(f"[focus_resolver] Failed: {e}")
        return []


def get_enabled_markets(db: Session) -> dict:
    configs = db.query(models.MarketConfig).all()
    if not configs:
        for market in MARKET_TICKERS:
            db.add(models.MarketConfig(market_name=market, is_enabled=1))
        db.commit()
        configs = db.query(models.MarketConfig).all()
    result = {}
    for c in configs:
        if not c.is_enabled or c.market_name not in MARKET_TICKERS:
            continue
        base = list(MARKET_TICKERS[c.market_name])
        if c.custom_tickers:
            try:
                extra = json.loads(c.custom_tickers)
                for t in extra:
                    if t not in base:
                        base.append(t)
            except Exception:
                pass
        result[c.market_name] = base
    return result


def build_market_constraint(enabled_markets: dict) -> str:
    if not enabled_markets:
        return "No markets are currently enabled. Default to US market tickers like AAPL, MSFT."
    is_focused = list(enabled_markets.keys()) == ["Focused"]
    if is_focused:
        tickers = enabled_markets["Focused"]
        return (
            "⚠️  FOCUSED RUN — You MUST analyse and propose a trade for ONLY the following ticker(s). "
            "Do NOT recommend any other asset:\n"
            + "\n".join(f"  - {t}" for t in tickers)
        )
    parts = [f"  - **{m}**: {', '.join(t)}" for m, t in enabled_markets.items()]
    return "You MUST pick your ticker from ONLY the following enabled markets:\n" + "\n".join(parts)


# ── Agent default prompts ─────────────────────────────────────────────────────

DEFAULT_AGENTS = {
    "Value Investor": (
        "=== IDENTITY ===\n"
        "You are a senior fundamental analyst at a long/short equity hedge fund with 20 years experience. "
        "Your edge is identifying mis-priced assets relative to intrinsic value and upcoming catalysts that the market has not yet priced in.\n\n"
        "=== CONSTITUTION ===\n"
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
        "Write your full analysis using EXACTLY this structure:\n\n"
        "## INVESTMENT THESIS\n"
        "<2-3 sentences: the core mispricing or catalyst argument>\n\n"
        "## VALUATION ANCHOR\n"
        "Current P/E: X | Sector median P/E: Y | Forward P/E: Z | EV/EBITDA: W\n"
        "Price vs analyst consensus target: X% upside/downside\n"
        "Intrinsic value estimate: $X (method: DCF / comps / asset-based)\n\n"
        "## CATALYST\n"
        "Primary catalyst: <specific event + expected date within 2 weeks>\n"
        "Secondary catalyst: <optional>\n\n"
        "## SCENARIOS\n"
        "Bull (30%): <what happens, price target>\n"
        "Base (50%): <what happens, price target>\n"
        "Bear (20%): <what happens, price level>\n\n"
        "## RISK FACTORS\n"
        "1. <specific risk>\n"
        "2. <specific risk>\n\n"
        "## INVALIDATION\n"
        "Thesis breaks if: <specific condition — price level, event, or data point>\n\n"
        "Then on a new line:\n"
        "TICKER: SYMBOL\n"
        "ACTION: LONG or SHORT\n\n"
        "=== EVOLVED_GUIDELINES ===\n"
        "No evolved guidelines yet. Perform balanced fundamental analysis across all enabled markets."
    ),
    "Technical Analyst": (
        "=== IDENTITY ===\n"
        "You are a quantitative technical analyst at a prop trading firm. You trade price action, volume patterns, and momentum signals. "
        "You ignore noise and focus on high-probability setups with clear risk/reward.\n\n"
        "=== CONSTITUTION ===\n"
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
        "Write your full analysis using EXACTLY this structure:\n\n"
        "## INVESTMENT THESIS\n"
        "<2-3 sentences: the setup and why now>\n\n"
        "## TECHNICAL LEVELS\n"
        "Support: $X | Resistance: $Y\n"
        "MA position: price vs 50d ($X) and 200d ($Y)\n"
        "Volume trend: <accumulation / distribution / neutral>\n"
        "RSI / momentum: <overbought / oversold / neutral>\n\n"
        "## CATALYST\n"
        "Setup trigger: <specific price event, pattern completion, or news catalyst>\n"
        "Expected timing: <hours / days / this week>\n\n"
        "## SCENARIOS\n"
        "Bull (35%): breaks resistance at $X → target $Y\n"
        "Base (45%): consolidates between $X–$Y, gradual trend\n"
        "Bear (20%): breaks support at $X → stop at $Y\n\n"
        "## INVALIDATION\n"
        "Setup fails if: <price level or volume condition>\n\n"
        "Then on a new line:\n"
        "TICKER: SYMBOL\n"
        "ACTION: LONG or SHORT\n\n"
        "=== EVOLVED_GUIDELINES ===\n"
        "No evolved guidelines yet. Perform balanced technical analysis across all enabled markets."
    ),
    "Macro Economist": (
        "=== IDENTITY ===\n"
        "You are the chief macro strategist at a global macro fund. You connect central bank policy, geopolitical events, and capital flows "
        "to asset price implications with 15+ years of cross-market experience.\n\n"
        "=== CONSTITUTION ===\n"
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
        "Write your full analysis using EXACTLY this structure:\n\n"
        "## INVESTMENT THESIS\n"
        "<2-3 sentences: macro regime + asset transmission mechanism>\n\n"
        "## MACRO REGIME\n"
        "Current regime: <RISK-ON / RISK-OFF / STAGFLATION / REFLATION>\n"
        "Key driver: <Fed policy / geopolitics / growth data / inflation>\n"
        "Regime age: <days since regime shift — younger = more tradeable>\n\n"
        "## ASSET TRANSMISSION\n"
        "Driver → impact chain: <e.g. Fed pause → lower real yields → gold LONG>\n"
        "Cross-asset confirmation: <what other assets confirm this regime>\n\n"
        "## CATALYST\n"
        "Macro event: <specific release, decision, or speech + date>\n"
        "Expected market reaction: <direction + magnitude>\n\n"
        "## SCENARIOS\n"
        "Bull (X%): <macro condition + asset target>\n"
        "Base (X%): <macro condition + asset target>\n"
        "Bear (X%): <regime reversal trigger + impact>\n\n"
        "## INVALIDATION\n"
        "Thesis breaks if: <specific macro data or event contradicts the regime>\n\n"
        "Then on a new line:\n"
        "TICKER: SYMBOL\n"
        "ACTION: LONG or SHORT\n\n"
        "=== EVOLVED_GUIDELINES ===\n"
        "No evolved guidelines yet. Perform balanced macro analysis considering all asset classes."
    ),
    "Sentiment Analyst": (
        "=== IDENTITY ===\n"
        "You are a sentiment and flow analyst at a high-frequency trading desk. You specialise in identifying crowd psychology inflection points — "
        "where retail sentiment peaks or troughs, and institutional money quietly takes the other side.\n\n"
        "=== CONSTITUTION ===\n"
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
        "Write your full analysis using EXACTLY this structure:\n\n"
        "## INVESTMENT THESIS\n"
        "<2-3 sentences: the sentiment signal and expected crowd behaviour>\n\n"
        "## SENTIMENT SNAPSHOT\n"
        "Signal: <PEAK GREED / PEAK FEAR / DIVERGENCE / QUIET ACCUMULATION>\n"
        "Price move (5d): <+/- X%>\n"
        "News volume: <high / normal / low>\n"
        "Retail vs smart money: <who is buying, who is selling>\n\n"
        "## CATALYST\n"
        "Sentiment trigger: <specific headline, social signal, or flow data>\n"
        "Expected mean-reversion window: <hours / 1-3 days / this week>\n\n"
        "## SCENARIOS\n"
        "Bull (X%): <crowd capitulates / sentiment reverses → target>\n"
        "Base (X%): <sentiment fades gradually → modest move>\n"
        "Bear (X%): <sentiment continues in current direction → stop>\n\n"
        "## INVALIDATION\n"
        "Thesis breaks if: <fundamental news overrides sentiment / price action>\n\n"
        "Then on a new line:\n"
        "TICKER: SYMBOL\n"
        "ACTION: LONG or SHORT\n\n"
        "=== EVOLVED_GUIDELINES ===\n"
        "No evolved guidelines yet. Perform balanced sentiment analysis across all enabled markets."
    ),
}

# ── Specialist agents: invoked only when their market is in the enabled set ───
SPECIALIST_AGENTS = {
    "Crypto Specialist": (
        "=== IDENTITY ===\n"
        "You are a veteran crypto-native analyst who has traded through multiple bull and bear cycles since 2013. "
        "You deeply understand on-chain data, DeFi mechanics, tokenomics, and how narrative shifts drive crypto prices. "
        "You are equally comfortable with Bitcoin macro and micro-cap altcoin catalysts.\n\n"
        "=== CONSTITUTION ===\n"
        "ANALYSIS FRAMEWORK:\n"
        "1. ON-CHAIN SIGNALS: Look for unusual wallet activity, exchange outflows (bullish), inflows (bearish), "
        "large OTC block deals, miner selling patterns, and stablecoin supply growth (fresh liquidity = bullish).\n"
        "2. NARRATIVE MOMENTUM: Crypto is driven by rotating narratives (L2 season, RWA, AI tokens, BTC dominance). "
        "Identify the dominant narrative RIGHT NOW from the news feed. Which tokens are the primary beneficiaries?\n"
        "3. CATALYST CALENDAR: ETF approval/rejection dates, protocol upgrades (hard forks, mainnet launches), "
        "token unlocks (bearish overhang), halving cycles, and SEC actions are high-impact events. "
        "Only trade catalysts in the next 7–14 days — not speculative future events.\n"
        "4. TECHNICAL CONFLUENCE: Is the token above or below its 200d MA? At a key Fibonacci level? "
        "Volume profile: is it confirming the move? BTC dominance rising = altcoin headwinds.\n"
        "5. FUNDING RATES & LEVERAGE: If funding is extremely positive, longs are overleveraged = short squeeze risk. "
        "Negative funding = shorts are paying = potential for long squeeze on any positive catalyst.\n"
        "6. MEMORY REVIEW: Which crypto trades worked? Which narratives you tracked played out? Apply pattern recognition.\n\n"
        "RULES: Never trade a token with < $500M market cap unless there is an extraordinary specific catalyst. "
        "Always account for BTC market regime — most altcoins fail when BTC is in a downtrend. "
        "DO NOT recommend tokens not in the enabled markets list.\n\n"
        "Write your analysis using EXACTLY this structure:\n\n"
        "## INVESTMENT THESIS\n<2-3 sentences>\n\n"
        "## ON-CHAIN / MARKET STRUCTURE\nKey signal: <metric + value>\nBTC regime: <bullish / bearish / neutral>\n\n"
        "## CATALYST\nEvent: <specific catalyst + date>\n\n"
        "## SCENARIOS\nBull (X%): <condition + target>\nBase (X%): <condition + target>\nBear (X%): <condition + stop>\n\n"
        "## INVALIDATION\nThesis breaks if: <condition>\n\n"
        "TICKER: SYMBOL\nACTION: LONG or SHORT\n\n"
        "=== EVOLVED_GUIDELINES ===\n"
        "No evolved guidelines yet. Specialise in Crypto market analysis only."
    ),
    "India Market Specialist": (
        "=== IDENTITY ===\n"
        "You are a veteran Indian equity strategist at a top domestic AMC with 15 years experience trading NSE and BSE. "
        "You deeply understand RBI policy transmission, FII/DII flows, domestic consumption cycles, and how "
        "global macro themes are filtered through India's unique political-economic context.\n\n"
        "=== CONSTITUTION ===\n"
        "ANALYSIS FRAMEWORK:\n"
        "1. FII/DII FLOW WATCH: Foreign Institutional Investor selling = near-term headwind; DII buying = domestic support. "
        "Net FII outflows > ₹5,000 Cr in a week = bearish signal. Buying reversal = rally catalyst.\n"
        "2. RBI POLICY REGIME: Is RBI cutting, holding, or hiking? "
        "Rate cuts → NBFCs and housing stocks outperform. Hikes → IT (earns USD) and export stocks outperform.\n"
        "3. SECTOR ROTATION: India has predictable rotations:\n"
        "   - Pre-budget (Jan–Feb): PSU, infrastructure, defence outperform\n"
        "   - Monsoon season (Jun–Sep): FMCG, rural consumption, agrochemicals benefit from good rains\n"
        "   - Q3 (Oct–Dec): IT deal wins, banking NPA cycle, auto festive season\n"
        "4. RUPEE IMPACT: USD/INR above 84 = pain for importers (OMCs, airlines); "
        "stable/appreciating rupee = relief rally for IT majors.\n"
        "5. RESULTS SEASON: Indian companies report quarterly. An earnings beat with management guidance raise = strong LONG signal. "
        "Disappointment + guidance cut = immediate SHORT opportunity.\n"
        "6. NSE-SPECIFIC TECHNICALS: Nifty 50 and Sensex provide index-level context. "
        "Stocks breaking above 52-week highs on volume in a rising Nifty = highest-conviction setup.\n"
        "7. MEMORY INTEGRATION: Which India calls played out? Which sector bets were right?\n\n"
        "RULES: Only trade .NS suffix tickers. Never recommend a stock based solely on index movement without a stock-specific thesis. "
        "Verify the stock is in the enabled India market list.\n\n"
        "Write your analysis using EXACTLY this structure:\n\n"
        "## INVESTMENT THESIS\n<2-3 sentences>\n\n"
        "## VALUATION ANCHOR\nP/E: X | Sector median: Y | Analyst target: ₹Z (X% upside)\n\n"
        "## CATALYST\nEvent: <FII flow / earnings / RBI decision / sector trigger + date>\n\n"
        "## SCENARIOS\nBull (X%): <condition + target>\nBase (X%): <condition + target>\nBear (X%): <condition + stop>\n\n"
        "## INVALIDATION\nThesis breaks if: <condition>\n\n"
        "TICKER: SYMBOL\nACTION: LONG or SHORT\n\n"
        "=== EVOLVED_GUIDELINES ===\n"
        "No evolved guidelines yet. Specialise in India (NSE) market analysis only."
    ),
    "Commodities Specialist": (
        "=== IDENTITY ===\n"
        "You are a physical commodities trader turned analyst with deep expertise in gold, silver, crude oil, "
        "natural gas, and base metals. You understand supply/demand fundamentals, geopolitical supply risks, "
        "seasonal patterns, and how macro factors (USD strength, real yields, China demand) drive commodity prices.\n\n"
        "=== CONSTITUTION ===\n"
        "ANALYSIS FRAMEWORK:\n"
        "1. GOLD & SILVER (GC=F, SI=F): Key drivers: real yields (inverse), USD index (inverse), "
        "central bank buying, inflation expectations, and geopolitical risk premium. "
        "Rising real yields = gold headwind. Fed pivot expectations = gold tailwind. Gold:Silver ratio extremes signal mean-reversion.\n"
        "2. CRUDE OIL (CL=F): OPEC+ production decisions, US EIA inventory surprises, "
        "geopolitical supply disruption risk (Middle East, Russia), China demand signals, and US strategic reserve levels. "
        "Inventory draw = bullish; build = bearish.\n"
        "3. NATURAL GAS (NG=F): Highly seasonal — winter heating demand (Nov–Feb = bullish), summer AC demand (Jul–Aug). "
        "LNG export capacity, weather forecasts, and EU storage levels are key signals. "
        "Storage > 5-year average = bearish; below = bullish.\n"
        "4. COPPER (HG=F): The 'Doctor of Economics' — rising copper = global growth confidence. "
        "Key drivers: China PMI (biggest consumer), mine supply disruptions, EV/grid buildout demand.\n"
        "5. SEASONAL PATTERNS: These are reliable annual patterns — use them to confirm or challenge other signals.\n"
        "6. DOLLAR REGIME: DXY above 104 = broad commodity headwind. DXY falling = commodity tailwind, especially gold.\n"
        "7. MEMORY REVIEW: Which commodity calls worked? What seasonal patterns held?\n\n"
        "RULES: Only trade =F suffix futures tickers in the enabled MCX/Commodities list. "
        "Always state the supply/demand driver clearly — do not trade on sentiment alone for commodities.\n\n"
        "Write your analysis using EXACTLY this structure:\n\n"
        "## INVESTMENT THESIS\n<2-3 sentences: supply/demand or macro driver>\n\n"
        "## SUPPLY/DEMAND PICTURE\nInventory: <draw / build / neutral>\nKey driver: <OPEC / Fed / China / weather / geopolitics>\nDXY impact: <tailwind / headwind>\n\n"
        "## CATALYST\nEvent: <EIA report / OPEC meeting / macro release + date>\n\n"
        "## SCENARIOS\nBull (X%): <condition + target>\nBase (X%): <condition + target>\nBear (X%): <condition + stop>\n\n"
        "## INVALIDATION\nThesis breaks if: <condition>\n\n"
        "TICKER: SYMBOL\nACTION: LONG or SHORT\n\n"
        "=== EVOLVED_GUIDELINES ===\n"
        "No evolved guidelines yet. Specialise in MCX/Commodities analysis only."
    ),
    "Semiconductor Specialist": (
        "=== IDENTITY ===\n"
        "You are a seasoned semiconductor and hardware analyst. You track cyclical supply chain constraints, TSMC nodes, wafer capacities, and AI-driven data center demand. "
        "You understand that semis are highly cyclical and heavily rely on forward-looking CapEx guidance.\n\n"
        "=== CONSTITUTION ===\n"
        "ANALYSIS FRAMEWORK:\n"
        "1. EARNINGS & GUIDANCE: Semiconductor stocks live and die by future guidance. Has a major player like NVDA or TSM just reported? Interpret read-throughs for the rest of the sector.\n"
        "2. SUPPLY/DEMAND DYNAMICS: Are lead times stretching (bullish) or shortening (bearish)? Are inventory levels rising at customers? Find the bottleneck.\n"
        "3. TECHNOLOGY SHIFTS: Are we moving to a new node? Is Advanced Packaging a bottleneck? Pick the companies that supply the picks and shovels.\n"
        "4. GEOPOLITICS: US/China export restrictions can immediately impact revenue. Assess any recent trade actions.\n"
        "5. RULE: Only trade Semiconductor stocks, primarily in the US market.\n\n"
        "Write your analysis using EXACTLY this structure:\n\n"
        "## INVESTMENT THESIS\n<2-3 sentences>\n\n"
        "## VALUATION ANCHOR\nP/E: X | EV/EBITDA: Y | Forward estimates vs consensus: <beat / miss / in-line>\n\n"
        "## CATALYST\nEvent: <earnings / guidance / product launch / export ruling + date>\n\n"
        "## SCENARIOS\nBull (X%): <condition + target>\nBase (X%): <condition + target>\nBear (X%): <condition + stop>\n\n"
        "## INVALIDATION\nThesis breaks if: <condition>\n\n"
        "TICKER: SYMBOL\nACTION: LONG or SHORT\n\n"
        "=== EVOLVED_GUIDELINES ===\n"
        "No evolved guidelines yet. Specialise in Semiconductor analysis only."
    ),
    "AI & Robotics Specialist": (
        "=== IDENTITY ===\n"
        "You are a specialist in AI software, LLM platforms, and industrial robotics. You track software deployment cycles, enterprise AI adoption, and automation trends.\n\n"
        "=== CONSTITUTION ===\n"
        "ANALYSIS FRAMEWORK:\n"
        "1. ADOPTION METRICS: Is the company showing tangible revenue from AI, or just talk? Real adoption = LONG, pure hype = SHORT.\n"
        "2. CAPEX vs ROI: Are hyperscalers seeing ROI on their AI capex? If yes, buy the software layer. If no, short the software layer.\n"
        "3. AUTOMATION TRENDS: Look for industrial companies deploying robotics to offset labor shortages.\n"
        "4. RULE: Only trade AI, Software, and Robotics companies, primarily in the US market.\n\n"
        "Write your analysis using EXACTLY this structure:\n\n"
        "## INVESTMENT THESIS\n<2-3 sentences>\n\n"
        "## VALUATION ANCHOR\nP/E: X | P/S: Y | Rule of 40 score: Z | Analyst target: $W (X% upside)\n\n"
        "## CATALYST\nEvent: <product launch / earnings / enterprise deal + date>\n\n"
        "## SCENARIOS\nBull (X%): <condition + target>\nBase (X%): <condition + target>\nBear (X%): <condition + stop>\n\n"
        "## INVALIDATION\nThesis breaks if: <condition>\n\n"
        "TICKER: SYMBOL\nACTION: LONG or SHORT\n\n"
        "=== EVOLVED_GUIDELINES ===\n"
        "No evolved guidelines yet. Specialise in AI & Robotics analysis only."
    ),
    "Real Estate Specialist": (
        "=== IDENTITY ===\n"
        "You are a Real Estate Investment Trust (REIT) and housing market specialist. You closely watch interest rates, occupancy levels, and demographic migrations.\n\n"
        "=== CONSTITUTION ===\n"
        "ANALYSIS FRAMEWORK:\n"
        "1. RATE SENSITIVITY: REITs are highly sensitive to the 10-year yield. Falling yields = tailwind for real estate.\n"
        "2. SECULAR THEMES: Are people moving to suburbs? Are offices empty? Pick winners (Data Center REITs, Residential) and losers (Commercial Office).\n"
        "3. RULE: Only trade Real Estate and REIT stocks.\n\n"
        "Write your analysis using EXACTLY this structure:\n\n"
        "## INVESTMENT THESIS\n<2-3 sentences>\n\n"
        "## VALUATION ANCHOR\nP/FFO: X | Dividend yield: Y% | NAV discount/premium: Z%\n\n"
        "## CATALYST\nEvent: <rate decision / earnings / occupancy data + date>\n\n"
        "## SCENARIOS\nBull (X%): <condition + target>\nBase (X%): <condition + target>\nBear (X%): <condition + stop>\n\n"
        "## INVALIDATION\nThesis breaks if: <condition>\n\n"
        "TICKER: SYMBOL\nACTION: LONG or SHORT\n\n"
        "=== EVOLVED_GUIDELINES ===\n"
        "No evolved guidelines yet. Specialise in Real Estate analysis only."
    ),
    "Biotech & Pharma Specialist": (
        "=== IDENTITY ===\n"
        "You are a biotech and pharmaceutical analyst with a background in molecular biology. You trade FDA approvals, clinical trial data, and drug pricing policies.\n\n"
        "=== CONSTITUTION ===\n"
        "ANALYSIS FRAMEWORK:\n"
        "1. CLINICAL CATALYSTS: Is there a Phase 2 or Phase 3 readout coming? Is an FDA PDUFA date near?\n"
        "2. RISK REWARD: Biotech is binary. Base trades on the probability of success vs the implied market move.\n"
        "3. RULE: Only trade Healthcare, Biotech, and Pharmaceutical stocks.\n\n"
        "Write your analysis using EXACTLY this structure:\n\n"
        "## INVESTMENT THESIS\n<2-3 sentences: the binary event or thesis>\n\n"
        "## VALUATION ANCHOR\nMarket cap: $X | Cash runway: Y months | Peak sales estimate: $Z\n\n"
        "## CATALYST\nEvent: <FDA PDUFA date / Phase trial readout / earnings + exact date>\n\n"
        "## SCENARIOS\nBull (X%): <approval / positive data + price target>\nBase (X%): <partial success + price>\nBear (X%): <failure + stop>\n\n"
        "## INVALIDATION\nThesis breaks if: <condition>\n\n"
        "TICKER: SYMBOL\nACTION: LONG or SHORT\n\n"
        "=== EVOLVED_GUIDELINES ===\n"
        "No evolved guidelines yet. Specialise in Biotech & Pharma analysis only."
    ),
}

# SPECIALIST_MARKET_MAP removed — dispatcher LLM now selects agents dynamically based on context.


_OLD_OUTPUT_MARKER = "TICKER:SYMBOL, ACTION:LONG or ACTION:SHORT"
_NEW_OUTPUT_MARKER = "TICKER: SYMBOL\nACTION: LONG or SHORT"


def setup_agent_prompts(db: Session):
    """Seed default agent prompts — update if the prompt has changed (e.g. after a version bump)."""
    all_agents = {**DEFAULT_AGENTS, **SPECIALIST_AGENTS}
    for name, prompt in all_agents.items():
        existing = db.query(models.AgentPrompt).filter(models.AgentPrompt.agent_name == name).first()
        desc = AGENT_DESCRIPTIONS.get(name)
        if not existing:
            db.add(models.AgentPrompt(agent_name=name, system_prompt=prompt, description=desc))
        else:
            if existing.description != desc and desc:
                existing.description = desc

            if existing.system_prompt != prompt:
                history_count = db.query(models.AgentPromptHistory).filter(
                    models.AgentPromptHistory.agent_name == name
                ).count()
                if history_count == 0:
                    # Not yet evolved — reset to new seed
                    existing.system_prompt = prompt
                elif _OLD_OUTPUT_MARKER in existing.system_prompt:
                    # Evolved prompt still uses old unstructured output format — upgrade it
                    # Replace old output instruction with new structured sections format
                    existing.system_prompt = existing.system_prompt.replace(
                        "Write your full structured analysis, then output on a new line:\n"
                        "TICKER:SYMBOL, ACTION:LONG or ACTION:SHORT",
                        "Write your analysis using the structured sections format "
                        "(INVESTMENT THESIS / VALUATION ANCHOR or relevant sections / CATALYST / SCENARIOS / INVALIDATION), "
                        "then on new lines:\nTICKER: SYMBOL\nACTION: LONG or SHORT"
                    )
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
        rec      = info.get("recommendationKey", "") or ""
        if not isinstance(rec, str): rec = ""
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
    for i, r in enumerate(research_items[:100], 1):
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
    """
    Extract TICKER and ACTION from agent response.

    Tries multiple patterns in priority order:
      1. Explicit TICKER: / ACTION: labels
      2. Inline "LONG AAPL" or "SHORT BTC-USD" phrases
      3. Bold/markdown variants like **LONG** **AAPL**
    Falls back to AAPL/LONG only as a last resort.
    """
    VALID_ACTIONS = {"LONG", "SHORT", "UPDATE_LONG", "UPDATE_SHORT"}
    TICKER_RE = r"[A-Z]{1,6}(?:[.\-=][A-Z0-9]{1,4})?"

    ticker: str | None = None
    action: str | None = None

    # Pattern 1: explicit labels
    tm = re.search(r"TICKER:\s*\*{0,2}([A-Za-z0-9.\-=]+)\*{0,2}", text, re.IGNORECASE)
    am = re.search(r"ACTION:\s*\*{0,2}([A-Za-z_]+)\*{0,2}", text, re.IGNORECASE)
    if tm:
        ticker = tm.group(1).upper().strip("*,. ")
    if am:
        action = am.group(1).upper().strip("*,. ")

    # Pattern 2: inline phrases "LONG AAPL" / "SHORT BTC-USD"
    if not ticker or not action:
        inline = re.search(
            rf"\b(LONG|SHORT|UPDATE_LONG|UPDATE_SHORT)\s+({TICKER_RE})\b",
            text, re.IGNORECASE
        )
        if inline:
            if not action:
                action = inline.group(1).upper()
            if not ticker:
                ticker = inline.group(2).upper()

    # Pattern 3: reversed "AAPL LONG"
    if not ticker or not action:
        rev = re.search(
            rf"\b({TICKER_RE})\s+(LONG|SHORT|UPDATE_LONG|UPDATE_SHORT)\b",
            text, re.IGNORECASE
        )
        if rev:
            if not ticker:
                ticker = rev.group(1).upper()
            if not action:
                action = rev.group(2).upper()

    # Validate action
    if action and action not in VALID_ACTIONS:
        action = None

    if not ticker:
        print("[Extraction] Failed to find TICKER — falling back to AAPL.")
        ticker = "AAPL"
    if not action:
        print("[Extraction] Failed to find ACTION — falling back to LONG.")
        action = "LONG"

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



def fetch_research_items(db, run_id: str, enabled_markets: dict,
                          investment_focus: str = "") -> list:
    """
    Fetch raw research articles for the given markets/focus.
    Returns research_items list. Called before KG ingest so the graph is built first.

    When a focused ticker set is passed (enabled_markets has a single "Focused" key),
    all topics are scoped to those tickers only — no broad market-wide queries.
    """
    all_tickers = [sym for tickers in enabled_markets.values() for sym in tickers]
    is_focused = list(enabled_markets.keys()) == ["Focused"]

    if is_focused:
        # Focused run: only fetch news for the specific tickers/entity selected
        dynamic_topics = []
        for sym in all_tickers:
            clean = sym.replace(".NS", "").replace("-USD", "").replace("=F", "")
            dynamic_topics.append(f"{clean} stock news analysis today")
            dynamic_topics.append(f"{clean} price forecast catalyst")
        if investment_focus:
            dynamic_topics.append(investment_focus[:120])
    else:
        # Normal run: broad market context + per-ticker queries
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

    focus_tickers_list = all_tickers if is_focused else None
    return fetch_web_research(topics=dynamic_topics, enabled_tickers=enabled_markets, focus_tickers=focus_tickers_list)


def build_shared_retrieval_context(db, run_id: str, enabled_markets: dict,
                                    investment_focus: str = "",
                                    research_items: list = None) -> tuple[str, list, list]:
    """
    Build the full shared context string for agents from pre-fetched research items.
    If research_items is None, fetches them internally (backward-compat).
    Returns (context_string, research_log, research_items).

    When enabled_markets has a single "Focused" key, the context is scoped tightly
    to only those tickers — broad market headlines are omitted.
    """
    all_tickers = [sym for tickers in enabled_markets.values() for sym in tickers]
    is_focused = list(enabled_markets.keys()) == ["Focused"]

    now = datetime.utcnow()

    # ── 1. Macro indicators — always included for price context ──────────────
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

    # News headlines — skip for focused runs (would pull unrelated market noise)
    news = []
    news_context = ""
    if not is_focused:
        news = fetch_news()
        news_context = "## Additional Market Headlines\n" + "".join(f"- {n}\n" for n in news)
        for n in news:
            research_log.append({"title": n, "url": "N/A"})

    # ── 3 & 4. Per-ticker: price + fundamentals (parallelised) ───────────────
    price_lines = []
    fundamentals_blocks = []

    def _fetch_one_ticker(sym: str):
        price_line = None
        fund_block = None
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
        return sym, price_line, fund_block

    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(_fetch_one_ticker, sym): sym for sym in all_tickers}
        for fut in as_completed(futs, timeout=60):
            try:
                sym, price_line, fund_block = fut.result()
                if price_line:
                    price_lines.append(price_line)
                if fund_block:
                    fundamentals_blocks.append(fund_block)
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


    # ── 6. Enriched macro context: FRED yield curve + Finnhub calendars ─────
    enriched_macro_context = ""
    try:
        from data.macro import build_macro_context_block
        enriched_macro_context = build_macro_context_block(all_tickers)
    except Exception as _mc_err:
        print(f"[orchestrator] Macro context enrichment failed (non-fatal): {_mc_err}")

    # ── 7. Per-ticker deep enrichment: options PCR, insiders, ratings ────────
    enrichment_blocks = []
    try:
        from data.fundamentals import enrich_tickers_parallel
        # Only enrich US + India equities (options/insiders not available for crypto/futures)
        if is_focused:
            # Focused run: enrich all focused tickers regardless of market key
            equity_tickers = [
                sym for sym in all_tickers
                if not sym.endswith("-USD") and not sym.endswith("=F")
            ]
        else:
            equity_tickers = [
                sym for market, tickers in enabled_markets.items()
                if market in ("US", "India")
                for sym in tickers
            ]
        if equity_tickers:
            enrichments = enrich_tickers_parallel(equity_tickers[:8])  # cap at 8 to stay fast
            for sym, block in enrichments.items():
                if block.strip():
                    enrichment_blocks.append(f"**{sym} — Options/Insider/Catalyst:**\n{block}")
    except Exception as _fe_err:
        print(f"[orchestrator] Fundamental enrichment failed (non-fatal): {_fe_err}")

    enrichment_context = ""
    if enrichment_blocks:
        enrichment_context = "\n## Per-Ticker Deep Intelligence (Options · Insiders · Catalysts)\n" + "\n\n".join(enrichment_blocks) + "\n"

    full_context = (
        f"# Market Intelligence Report — {now.strftime('%A, %B %d, %Y %H:%M UTC')}\n\n"
        f"{macro_context}\n\n"
        + (f"{enriched_macro_context}\n\n" if enriched_macro_context else "")
        + f"{research_context}\n\n"
        f"{news_context}\n"
        f"{price_context}\n"
        f"{fundamentals_context}"
        + (f"\n{enrichment_context}" if enrichment_context else "")
    )

    _log(db, run_id, "WEB_RESEARCH", "DONE",
         f"Research complete — {len(research_items)} articles, "
         f"{len(price_lines)} prices, {len(fundamentals_blocks)} fundamentals"
         + (f", {len(enrichment_blocks)} enrichment blocks" if enrichment_blocks else ""))

    return full_context, research_log, research_items


# ── Layer 2: 4-Agent Debate Panel ────────────────────────────────────────────


def _agent_web_search(agent_name: str, run_id: str, queries: list[str]) -> str:
    """
    Execute targeted web searches on behalf of an agent.
    Returns formatted search results as a context block.
    """
    from data.research import _tavily_search
    results = []
    for q in queries[:2]:  # max 2 searches per agent
        try:
            items = _tavily_search(q.strip(), max_results=4, search_depth="advanced")
            for item in items:
                results.append(f"[Search: {q}] {item.get('title', '')} — {item.get('snippet', '')[:150]}")
        except Exception:
            pass
    if not results:
        return ""
    return "## Agent Web Search Results\n" + "\n".join(f"- {r}" for r in results)


AGENT_SEARCH_REQUEST_PROMPT = """You are about to analyse the knowledge graph and form an investment proposal.

Your PRIMARY source of truth is the knowledge graph provided above — reason from the events, relationships, and signals in the graph first.

OPTIONAL: You may request up to 2 targeted web searches ONLY if there is a specific factual gap in the knowledge graph that you need to fill (e.g. a breaking event from the last few hours, exact earnings figures, a Fed statement not yet in the graph).

Do NOT search for general market news — the knowledge graph already contains that. Only search if you need to verify or expand on a SPECIFIC node or event already in the graph.

If you want to search, output your queries in this EXACT format (nothing else on these lines):
SEARCH_QUERY_1: <specific search query targeting a gap in the KG>
SEARCH_QUERY_2: <specific search query>  (optional)

Or if the knowledge graph already has sufficient context:
NO_SEARCH_NEEDED

Be specific — e.g. "NVIDIA Q1 2026 earnings guidance revenue beat" not "NVDA news".
Then stop. Do NOT write your analysis yet."""


def _build_leaderboard_context(db, agent_name: str, fitness_map: dict) -> str:
    """
    Build a compact leaderboard block to inject into each agent's context so they
    know where they stand vs their peers — creates competitive pressure.
    """
    if not fitness_map:
        return ""

    # Sort by fitness descending; agents without scores go last
    ranked = sorted(
        fitness_map.items(),
        key=lambda x: x[1]["fitness_score"] if x[1]["fitness_score"] is not None else -999,
        reverse=True
    )
    total = len(ranked)
    lines = ["## Agent Leaderboard — Your Standing vs Peers"]
    for pos, (name, f) in enumerate(ranked):
        rank = pos + 1
        score = f["fitness_score"]
        win_pct = f"{f['win_rate']*100:.0f}%" if f["win_rate"] is not None else "—"
        scored = f["total_scored"]
        marker = " ← YOU" if name == agent_name else ""
        score_str = f"{score:.1f}" if score is not None else "unscored"
        lines.append(f"  #{rank}/{total} {name}: fitness={score_str}, win={win_pct}, trades={scored}{marker}")

    own_rank = next((pos + 1 for pos, (n, _) in enumerate(ranked) if n == agent_name), None)
    if own_rank is not None:
        if own_rank == 1:
            lines.append("\n🏆 YOU ARE #1 — defend your position with disciplined, high-conviction calls.")
        elif own_rank <= max(2, total // 3):
            lines.append(f"\n✅ You are in the top third (#{own_rank}). Stay consistent — one bad call can drop your rank.")
        else:
            lines.append(f"\n⚠️  You are ranked #{own_rank}/{total}. Underperformers face prompt evolution. Raise your game.")
    return "\n".join(lines)


def _query_single_agent(agent_name: str, system_prompt: str, run_id: str,
                        shared_context: str, market_constraint: str,
                        investment_focus: str = "",
                        portfolio_context: str = "",
                        kg_context: str = "",
                        fitness_map: dict | None = None,
                        run_lessons: list | None = None) -> dict:
    """
    Two-pass agent query:
    Pass 1: Agent sees portfolio + KG + interesting stocks → requests web searches
    Pass 2: Agent sees search results → forms full structured proposal

    Returns a proposal dict on success, or None on error.
    """
    db = SessionLocal()
    try:
        _log(db, run_id, "AGENT_QUERY", "IN_PROGRESS",
             f"Pass 1: scanning KG + portfolio context for search queries…", agent_name=agent_name)

        # Extract tickers from market constraint for ticker-specific memory recall
        context_tickers = re.findall(r'\b([A-Z]{1,5}(?:[.\-=][A-Z0-9]{1,4})?)\b', market_constraint)
        memories = get_agent_memory_tiered(db, agent_name, context_tickers=context_tickers)
        memory_context = format_memory_for_context(memories)
        performance_context = get_agent_performance_summary(db, agent_name)

        # Leaderboard context — shows each agent where they rank vs peers
        leaderboard_context = ""
        if fitness_map:
            leaderboard_context = _build_leaderboard_context(db, agent_name, fitness_map) + "\n\n"

        focus_block = ""
        if investment_focus:
            focus_block = (
                f"## Investment Focus Directive\n"
                f"The user has specified: \"{investment_focus}\"\n"
                f"Prioritise assets aligned with this focus.\n\n"
            )

        # ── Intra-run lesson overlay (from earlier pipeline stages this run) ─
        lessons_block = ""
        if run_lessons:
            lessons_block = "## This-Run Pipeline Observations\n" + "\n".join(f"- {l}" for l in run_lessons) + "\n\n"

        # ── Pass 1: Request targeted searches ────────────────────────────────
        pass1_context = (
            f"{lessons_block}"
            f"{focus_block}"
            f"{leaderboard_context}"
            f"{portfolio_context}\n\n"
            f"{kg_context}\n\n"
            f"ALLOWED MARKETS:\n{market_constraint}\n\n"
            f"---\n{memory_context}\n---\n{performance_context}\n"
        )
        search_response = query_agent(
            AGENT_SEARCH_REQUEST_PROMPT,
            pass1_context,
            caller=f"agent:{agent_name}:search",
            run_id=run_id,
        )

        # Parse search queries
        search_results_block = ""
        queries = []
        if search_response and isinstance(search_response, str) and "NO_SEARCH_NEEDED" not in search_response.upper():
            for line in search_response.strip().splitlines():
                m = re.search(r"SEARCH_QUERY_\d+:\s*(.+)", line, re.IGNORECASE)
                if m:
                    queries.append(m.group(1).strip())
            if queries:
                _log(db, run_id, "AGENT_QUERY", "IN_PROGRESS",
                     f"Searching: {'; '.join(queries[:3])}", agent_name=agent_name)
                search_results_block = _agent_web_search(agent_name, run_id, queries)

        # ── Pass 2: Full analysis with search results ────────────────────────
        _log(db, run_id, "AGENT_QUERY", "IN_PROGRESS",
             f"Pass 2: forming proposal with {len(queries)} search result{'s' if len(queries) != 1 else ''}…", agent_name=agent_name)
        web_supplement = (
            f"## Supplementary Web Research (use only to fill gaps in the KG)\n{shared_context}"
            if shared_context.strip() else ""
        )
        agent_search_supplement = (
            f"## Your Targeted Web Searches\n{search_results_block}"
            if search_results_block.strip() else ""
        )
        pass2_context = (
            f"{lessons_block}"
            f"{focus_block}"
            f"{leaderboard_context}"
            f"{portfolio_context}\n\n"
            f"## Knowledge Graph (PRIMARY — reason from this first)\n{kg_context}\n\n"
            f"{web_supplement}\n\n"
            f"{agent_search_supplement}\n\n"
            f"ALLOWED MARKETS:\n{market_constraint}\n\n"
            f"---\n{memory_context}\n---\n{performance_context}\n"
        )
        response = query_agent(system_prompt, pass2_context,
                               caller=f"agent:{agent_name}", run_id=run_id)
        if not response:
            raise Exception("LLM returned no response after all retries")
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
        # Extract a brief reasoning snippet for the pipeline viewer
        reasoning_snippet = ""
        lines = [l.strip() for l in response.splitlines() if l.strip() and not l.strip().startswith("TICKER") and not l.strip().startswith("ACTION")]
        if lines:
            reasoning_snippet = " ".join(lines[:3])[:200]
        _log(db, run_id, "AGENT_QUERY", "DONE",
             f"Proposed {action} {ticker} — {reasoning_snippet}", agent_name=agent_name)

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
        lines.append("- Open positions (DO NOT duplicate these. Use UPDATE actions instead):")
        for s in active:
            ret = f"  ({s.current_return:+.1f}%)" if s.current_return is not None else ""
            lines.append(
                f"  • {s.strategy_type} {s.symbol} @ ${s.entry_price:.4f}{ret} | Size: ${s.position_size or 0:,.2f} — status: {s.status}"
            )
        lines.append(
            "⚠️  RULE: If you recommend a trade for a ticker already in the open positions above, "
            "you MUST output the action as UPDATE_LONG or UPDATE_SHORT rather than LONG/SHORT. "
            "Use the UPDATE action to suggest changes to the target, stop loss, or position size."
        )
    else:
        lines.append("- No open positions. Full budget available.")

    return "\n".join(lines)


AGENT_DESCRIPTIONS = {
    # Core agents — always available
    "Value Investor":             "Fundamental analysis: P/E mispricing, catalysts, intrinsic value divergence. Best for stocks with upcoming earnings or valuation anomalies.",
    "Technical Analyst":          "Price action, breakouts, momentum signals, volume patterns. Best for any asset with clear chart setups.",
    "Macro Economist":            "Cross-asset macro: Fed policy, rates, geopolitics, regime identification. Best when macro themes are dominant.",
    "Sentiment Analyst":          "Crowd psychology, retail vs smart-money flows, social sentiment inflection. Best when sentiment is at an extreme.",
    # Specialist agents — invoked when relevant to current market context
    "Crypto Specialist":          "On-chain metrics, DeFi, tokenomics, crypto narrative cycles, BTC dominance. Invoke when crypto assets are in scope.",
    "India Market Specialist":    "NSE/BSE dynamics, RBI policy, FII/DII flows, Indian sector rotation. Invoke when Indian equities (.NS) are in scope.",
    "Commodities Specialist":     "Gold, silver, crude oil, natgas, copper supply/demand fundamentals. Invoke when commodity futures (=F) are in scope.",
    "Semiconductor Specialist":   "TSMC nodes, chip supply chains, AI CapEx read-throughs, export restrictions. Invoke when semiconductor stocks are relevant.",
    "AI & Robotics Specialist":   "Enterprise AI adoption, LLM ROI, automation trends, software layer plays. Invoke when AI/software companies are relevant.",
    "Real Estate Specialist":     "REITs, rate sensitivity, occupancy trends, commercial vs residential. Invoke when real-estate or rate-sensitive assets are relevant.",
    "Biotech & Pharma Specialist":"FDA catalysts, clinical trial binary events, drug pricing policy. Invoke when healthcare/biotech stocks are in scope.",
}

DISPATCHER_PROMPT = """You are the Chief of Research at a multi-agent hedge fund. Your job is to select which specialist analysts to activate for this trading session based on the current market context and available tickers.

You have the following analysts available:

{agent_list}

Based on the market context below, select which specialists to activate. Always activate ALL four core agents. For specialists, only activate those whose domain is directly relevant to the tickers and market environment described.

Respond with ONLY a comma-separated list of agent names to activate, exactly as written above. Nothing else.

Example response:
Value Investor, Technical Analyst, Macro Economist, Sentiment Analyst, Crypto Specialist"""


def _dispatch_agents(run_id: str, shared_context: str, market_constraint: str,
                     all_agents: list[models.AgentPrompt]) -> list[str]:
    """Ask the LLM which agents to invoke based on current market context."""
    agent_list = "\n".join(
        f"- {a.agent_name}: {a.description or 'Specialist analyst.'}"
        for a in all_agents
    )
    all_agent_names = [a.agent_name for a in all_agents]
    prompt = DISPATCHER_PROMPT.format(agent_list=agent_list)
    context = f"MARKET CONTEXT:\n{market_constraint}\n\nSUMMARY OF RESEARCH:\n{shared_context[:2000]}"

    try:
        response = query_agent(prompt, context, caller="dispatcher", run_id=run_id)
        if not response:
            raise ValueError("empty response")
        selected = [n.strip() for n in response.strip().split(",")]
        # Validate — only keep names that actually exist
        valid = [n for n in selected if n in all_agent_names]
        # Always ensure all core agents are included
        for core in DEFAULT_AGENTS:
            if core in all_agent_names and core not in valid:
                valid.append(core)
        return valid
    except Exception as e:
        print(f"[Dispatcher] LLM dispatch failed ({e}), falling back to core agents only")
        return [n for n in all_agent_names if n in DEFAULT_AGENTS]


def run_debate_panel(db, run_id: str, shared_context: str, market_constraint: str,
                     investment_focus: str = "", enabled_markets: dict | None = None,
                     run_lessons: list | None = None) -> list:
    """
    Dispatcher → LLM selects which specialist agents to invoke based on context.
    Core agents always run. Specialist selection is decided by the LLM.
    Returns proposals_log: [{agent_name, ticker, action, reasoning}]
    """
    from graph.knowledge import llm_traverse_graph

    agent_prompts = db.query(models.AgentPrompt).all()
    all_agent_names = [ap.agent_name for ap in agent_prompts]

    # LLM dispatcher picks which agents to run
    _log(db, run_id, "DEBATE_PANEL", "IN_PROGRESS", "Dispatcher: selecting agents for this session…")
    selected_names = _dispatch_agents(run_id, shared_context, market_constraint, agent_prompts)
    _log(db, run_id, "DEBATE_PANEL", "IN_PROGRESS",
         f"Dispatcher selected {len(selected_names)} agents: {', '.join(selected_names)}")

    # Snapshot only selected agents
    agents_snapshot = [
        (ap.agent_name, ap.system_prompt) for ap in agent_prompts
        if ap.agent_name in selected_names
    ]

    # Build portfolio context once — all agents see the same open positions
    portfolio_context = _build_portfolio_context(db)

    # LLM-driven graph traversal: iteratively expand the most relevant nodes
    all_tickers = [sym for tickers in (enabled_markets or {}).values() for sym in tickers]
    _log(db, run_id, "DEBATE_PANEL", "IN_PROGRESS", "Traversing knowledge graph…")
    ranked_tickers, kg_context = llm_traverse_graph(db, all_tickers, run_id=run_id)
    if kg_context:
        _log(db, run_id, "DEBATE_PANEL", "IN_PROGRESS",
             f"Graph traversal complete — top signals: {', '.join(ranked_tickers[:5])}")

    # Build fitness_map for all selected agents (for leaderboard injection into each agent's context)
    from pipeline.validator import _compute_fitness as _cv_fitness
    fitness_map = {}
    for name, _ in agents_snapshot:
        try:
            fitness_map[name] = _cv_fitness(db, name)
        except Exception:
            pass

    proposals_log = []
    with ThreadPoolExecutor(max_workers=min(len(agents_snapshot), 8)) as executor:
        futures = {
            executor.submit(
                _query_single_agent,
                name, prompt, run_id, shared_context, market_constraint,
                investment_focus, portfolio_context, kg_context, fitness_map,
                run_lessons or [],
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

    return proposals_log, fitness_map


# ── Layer 3: Judge ────────────────────────────────────────────────────────────

JUDGE_SYSTEM_PROMPT = """You are the Chief Investment Officer of a quantitative hedge fund, acting as the final decision-maker in a multi-agent trading committee. You write analyst-grade research reports and have reviewed thousands of trade proposals.

You will receive:
- A full market intelligence report (macro environment, news, live prices, fundamentals)
- Structured proposals from specialist agents — each proposal now includes Investment Thesis, Valuation Anchor, Catalyst, Bull/Base/Bear Scenarios, and Invalidation conditions
- The current portfolio budget and open positions

## YOUR SCORING FRAMEWORK

For each agent proposal, score on 6 dimensions (1–10 each, max 60):

1. **THESIS QUALITY** — Specific, data-backed, non-obvious? ("NVDA P/E contracted 30% while estimates held" = 9; "bullish on AI" = 2)
2. **VALUATION ANCHOR** — Does the agent cite actual multiples (P/E, EV/EBITDA, P/S) vs sector or consensus? (No numbers = 1; explicit mispricing vs peers = 9)
3. **CATALYST SPECIFICITY** — Named near-term catalyst with a date (< 2 weeks)? (No catalyst = 2; named event + date = 9)
4. **NEWS FRESHNESS** — Supported by news from last 48h? (Only stale news = 2; fresh headlines supporting thesis = 9)
5. **RISK/REWARD STRUCTURE** — Are bull/base/bear scenarios stated with probabilities? Is invalidation condition explicit? (Vague = 2; full scenario matrix = 9)
6. **CROSS-AGENT CONFIRMATION** — Other agents corroborate directionally? (All disagree = 1; 2+ aligned = 8; unanimous = 10)

## DECISION RULES

- **DO NOT** pick a trade with composite score below 30/60
- **DO NOT** duplicate an open position — use UPDATE_LONG / UPDATE_SHORT instead
- **DO** size positions explicitly in dollars based on available capital
- **DO** prefer high-conviction single picks over weak consensus
- **DO** output HOLD if nothing meets the quality bar

## OUTPUT FORMAT (exact format — do not deviate)

PROPOSAL_SCORES:
- [Agent Name]: [score]/60 — [1 sentence rationale]
(repeat for each agent)

Output up to 3 positions ranked by conviction (score ≥ 30/60 only):

POSITION_1_TICKER: <SYMBOL or HOLD>
POSITION_1_ACTION: LONG or SHORT or UPDATE_LONG or UPDATE_SHORT (omit if HOLD)
POSITION_1_HORIZON: <intraday / swing-1-3d / positional-1-2w / trend-1-3m>
POSITION_1_SIZE: <dollar amount, e.g. $2500>
POSITION_1_TARGET: <price target with % upside>
POSITION_1_STOP: <stop-loss price or % from entry>
POSITION_1_BULL_CASE: <what happens + probability, e.g. "Earnings beat drives +15% — 35% probability">
POSITION_1_BASE_CASE: <expected outcome + probability>
POSITION_1_BEAR_CASE: <downside scenario + probability>
POSITION_1_REASONING: <3-4 sentences: valuation edge, catalyst, cross-agent confirmation, key risk>

POSITION_2_TICKER: <SYMBOL> (omit entire block if no second qualifying position)
POSITION_2_ACTION: LONG or SHORT or UPDATE_LONG or UPDATE_SHORT
POSITION_2_HORIZON: <time horizon>
POSITION_2_SIZE: <dollar value>
POSITION_2_TARGET: <price target with % upside>
POSITION_2_STOP: <stop-loss price or %>
POSITION_2_BULL_CASE: <outcome + probability>
POSITION_2_BASE_CASE: <outcome + probability>
POSITION_2_BEAR_CASE: <outcome + probability>
POSITION_2_REASONING: <3-4 sentences: valuation edge, catalyst, confirmation, key risk>

POSITION_3_TICKER: <SYMBOL> (omit entire block if no third qualifying position)
POSITION_3_ACTION: LONG or SHORT or UPDATE_LONG or UPDATE_SHORT
POSITION_3_HORIZON: <time horizon>
POSITION_3_SIZE: <dollar value>
POSITION_3_TARGET: <price target with % upside>
POSITION_3_STOP: <stop-loss price or %>
POSITION_3_BULL_CASE: <outcome + probability>
POSITION_3_BASE_CASE: <outcome + probability>
POSITION_3_BEAR_CASE: <outcome + probability>
POSITION_3_REASONING: <3-4 sentences: valuation edge, catalyst, confirmation, key risk>

Be decisive. Rank by conviction. No duplicate tickers across positions."""


def run_judge(db, run_id: str, proposals_log: list, shared_context: str,
              budget_context: str = "", market_constraint: str = "",
              fitness_map: dict | None = None) -> list[dict]:
    """
    The Judge reviews all proposals + shared market context and picks up to 3 positions.
    Returns a list of dicts: [{"ticker": ..., "action": ..., "reasoning": ...}, ...]
    Falls back to single plurality vote if the judge LLM fails.
    """
    proposals_summary = " | ".join(f"{p['agent_name'].split()[0]}: {p['action']} {p['ticker']}" for p in proposals_log)
    _log(db, run_id, "JUDGE", "IN_PROGRESS",
         f"Evaluating {len(proposals_log)} proposals → {proposals_summary}")

    # Build agent fitness context for the judge
    fitness_block = ""
    if fitness_map:
        ranked = sorted(
            fitness_map.items(),
            key=lambda x: x[1]["fitness_score"] if x[1]["fitness_score"] is not None else -999,
            reverse=True
        )
        lines = ["## Agent Track Record (historical fitness — use as prior on proposal quality)"]
        for pos, (name, f) in enumerate(ranked):
            score = f["fitness_score"]
            win_pct = f"{f['win_rate']*100:.0f}%" if f["win_rate"] is not None else "—"
            scored = f["total_scored"]
            score_str = f"{score:.1f}/100" if score is not None else "unscored"
            lines.append(f"  #{pos+1} {name}: fitness={score_str}, historical win rate={win_pct} over {scored} trades")
        lines.append("NOTE: Agents with higher historical fitness have demonstrated better prediction accuracy.")
        lines.append("Give a modest upward weight (+2 on your quality score) to proposals from agents with fitness ≥ 65/100.")
        fitness_block = "\n".join(lines) + "\n\n"

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
        f"{fitness_block}"
        f"{market_block}"
        f"## Agent Proposals (Full Analysis)\n"
        f"{proposals_text}\n\n"
        f"Now score each proposal and deliver your verdict."
    )

    response = query_agent(JUDGE_SYSTEM_PROMPT, judge_input,
                           caller="judge", run_id=run_id)
    if not response:
        response = ""  # fall through to plurality vote fallback

    # Determine enabled tickers for validation
    proposed_tickers = {p["ticker"] for p in proposals_log}
    # Open-position tickers are always valid (judge may issue UPDATE actions for them)
    open_position_tickers = {
        s.symbol for s in db.query(models.DeployedStrategy)
        .filter(models.DeployedStrategy.status.in_(["ACTIVE", "PENDING"])).all()
    }
    all_enabled_tickers: set[str] = set()
    if market_constraint:
        for tickers in MARKET_TICKERS.values():
            for t in tickers:
                if t in market_constraint:
                    all_enabled_tickers.add(t)

    def _validate_ticker(ticker: str | None, action: str | None = None) -> str | None:
        if not ticker or ticker == "HOLD":
            return None
        ticker = ticker.upper().strip()
        is_update = action and action.upper().startswith("UPDATE_")
        # UPDATE actions are valid for any existing open-position ticker
        if is_update and ticker in open_position_tickers:
            return ticker
        if ticker not in proposed_tickers:
            return None
        if all_enabled_tickers and ticker not in all_enabled_tickers:
            return None
        return ticker

    # Parse up to 3 POSITION_N blocks
    verdicts: list[dict] = []
    seen_tickers: set[str] = set()
    for n in range(1, 4):
        ticker_m  = re.search(rf"POSITION_{n}_TICKER:\s*([A-Za-z0-9.\-=]+)", response, re.IGNORECASE)
        action_m  = re.search(rf"POSITION_{n}_ACTION:\s*(LONG|SHORT|UPDATE_LONG|UPDATE_SHORT)", response, re.IGNORECASE)
        horizon_m = re.search(rf"POSITION_{n}_HORIZON:\s*([^\n]+)", response, re.IGNORECASE)
        size_m    = re.search(rf"POSITION_{n}_SIZE:\s*([^\n]+)", response, re.IGNORECASE)
        target_m  = re.search(rf"POSITION_{n}_TARGET:\s*([^\n]+)", response, re.IGNORECASE)
        stop_m    = re.search(rf"POSITION_{n}_STOP:\s*([^\n]+)", response, re.IGNORECASE)
        bull_m    = re.search(rf"POSITION_{n}_BULL_CASE:\s*([^\n]+)", response, re.IGNORECASE)
        base_m    = re.search(rf"POSITION_{n}_BASE_CASE:\s*([^\n]+)", response, re.IGNORECASE)
        bear_m    = re.search(rf"POSITION_{n}_BEAR_CASE:\s*([^\n]+)", response, re.IGNORECASE)
        reason_m  = re.search(rf"POSITION_{n}_REASONING:\s*(.+?)(?=POSITION_\d|$)", response, re.IGNORECASE | re.DOTALL)
        if not ticker_m:
            break
        action = action_m.group(1).upper() if action_m else None
        ticker = _validate_ticker(ticker_m.group(1) if ticker_m else None, action)
        if ticker and action and ticker not in seen_tickers:
            verdicts.append({
                "ticker":     ticker,
                "action":     action,
                "horizon":    horizon_m.group(1).strip() if horizon_m else "",
                "size":       size_m.group(1).strip() if size_m else "",
                "target":     target_m.group(1).strip() if target_m else "",
                "stop":       stop_m.group(1).strip() if stop_m else "",
                "bull_case":  bull_m.group(1).strip() if bull_m else "",
                "base_case":  base_m.group(1).strip() if base_m else "",
                "bear_case":  bear_m.group(1).strip() if bear_m else "",
                "reasoning":  reason_m.group(1).strip()[:1000] if reason_m else "",
            })
            seen_tickers.add(ticker)

    if verdicts:
        summary = " | ".join(f"{v['action']} {v['ticker']}" for v in verdicts)
        print(f"[Judge] Verdicts: {summary}")
        _log(db, run_id, "JUDGE", "DONE", f"{len(verdicts)} position(s): {summary}")
        return verdicts

    # Fallback: plurality vote → single position
    print("[Judge] LLM parse failed — using plurality vote as fallback.")
    vote_counts: dict[str, int] = {}
    for p in proposals_log:
        if all_enabled_tickers and p["ticker"] not in all_enabled_tickers:
            continue
        key = f"{p['ticker']}_{p['action']}"
        vote_counts[key] = vote_counts.get(key, 0) + 1
    if not vote_counts:
        for p in proposals_log:
            key = f"{p['ticker']}_{p['action']}"
            vote_counts[key] = vote_counts.get(key, 0) + 1
    best_key = max(vote_counts, key=vote_counts.get)
    ft, fa = best_key.split("_", 1)
    fallback_reason = f"Plurality vote fallback ({vote_counts[best_key]}/{len(proposals_log)} votes). Judge output could not be parsed."
    _log(db, run_id, "JUDGE", "DONE", f"Plurality fallback: {fa} {ft}")
    return [{"ticker": ft, "action": fa, "reasoning": fallback_reason}]

