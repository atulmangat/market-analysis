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
import uuid as _uuid
from datetime import datetime
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
    "Value Investor":   "You are a conservative value investor. Focus on fundamentals and long-term trends. Review the shared research AND your memory notes. Learn from past performance. Do NOT pick indices like SPY — pick the best individual asset. Pick ONE ticker from the ALLOWED MARKETS. Output reasoning then: TICKER:SYMBOL, ACTION:LONG or ACTION:SHORT.",
    "Technical Analyst":"You are a day trader and technical analyst. Focus on momentum and chart patterns. Review the shared research AND your memory. Learn from your track record. Pick the most explosive individual asset. Pick ONE ticker from the ALLOWED MARKETS. Output reasoning then: TICKER:SYMBOL, ACTION:LONG or ACTION:SHORT.",
    "Macro Economist":  "You are a macro economist. Focus on interest rates, geopolitics, and global trade. Review the shared research AND your memory. Calibrate confidence from past performance. Pick the asset most affected right now. Pick ONE ticker from the ALLOWED MARKETS. Output reasoning then: TICKER:SYMBOL, ACTION:LONG or ACTION:SHORT.",
    "Sentiment Analyst":"You are a sentiment momentum trader. Gauge market mood from news flow and crowd behavior. Review the shared research AND your memory. Find what the crowd is hyping or panic selling. Pick ONE ticker from the ALLOWED MARKETS. Output reasoning then: TICKER:SYMBOL, ACTION:LONG or ACTION:SHORT.",
}


def setup_agent_prompts(db: Session):
    for name, prompt in DEFAULT_AGENTS.items():
        existing = db.query(models.AgentPrompt).filter(models.AgentPrompt.agent_name == name).first()
        if not existing:
            db.add(models.AgentPrompt(agent_name=name, system_prompt=prompt))
    db.commit()


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

    research_items = fetch_web_research(topics=dynamic_topics, enabled_tickers=enabled_markets)
    research_context = format_research_for_context(research_items)

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

    # Live price snapshot for all enabled tickers
    price_lines = []
    for market, tickers in enabled_markets.items():
        for sym in tickers[:4]:  # sample up to 4 per market to keep context lean
            sig = fetch_market_data(sym)
            if sig:
                price_lines.append(f"  {sym}: ${sig.price:.4f}")
    price_context = ""
    if price_lines:
        price_context = "## Live Price Snapshot\n" + "\n".join(price_lines) + "\n"

    full_context = f"{research_context}\n\n{news_context}\n{price_context}"
    _log(db, run_id, "WEB_RESEARCH", "DONE",
         f"Shared context ready — {len(research_items)} articles, {len(news)} headlines, {len(price_lines)} live prices")

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
