from sqlalchemy.orm import Session
from sqlalchemy import func
from core.database import SessionLocal
import core.models as models
import re
from datetime import datetime
from agents.llm import query_agent
from data.market import fetch_market_data
from agents.memory import write_agent_memory, prune_old_memory

# ── Thresholds ──────────────────────────────────────────────────────────────
STOP_LOSS_PCT    = -10.0   # close strategy at this loss
TAKE_PROFIT_PCT  =  15.0   # close strategy at this gain
MIN_SCORED_FOR_DARWIN     = 3     # minimum scored predictions before Darwinian eval runs
FITNESS_THRESHOLD         = 55.0  # fitness score below this triggers evolution (raised: more competition)
CROSSOVER_THRESHOLD       = 70.0  # fitness above this = "elite" donor for crossover (raised: higher bar)
STREAK_AGGRESSIVE_MUTATE  = 3     # consecutive losses before aggressive (full-prompt) mutation kicks in

# ── Structured prompt section delimiters ─────────────────────────────────────
_SECTION_MARKER = "=== {} ==="


def _extract_section(prompt: str, section: str) -> str:
    """Extract content between === SECTION === markers. Returns empty string if not found."""
    marker = _SECTION_MARKER.format(section)
    start = prompt.find(marker)
    if start == -1:
        return ""
    start += len(marker)
    # Find the next section marker or end of string
    next_marker = prompt.find("===", start)
    if next_marker == -1:
        return prompt[start:].strip()
    return prompt[start:next_marker].strip()


def _replace_section(prompt: str, section: str, new_content: str) -> str:
    """Replace content of a specific section, preserving all other sections."""
    marker = _SECTION_MARKER.format(section)
    start = prompt.find(marker)
    if start == -1:
        # Section not found — append it
        return prompt.rstrip() + f"\n\n{marker}\n{new_content}"
    content_start = start + len(marker)
    # Find the next section marker or end of string
    next_marker = prompt.find("===", content_start)
    if next_marker == -1:
        return prompt[:content_start] + f"\n{new_content}"
    return prompt[:content_start] + f"\n{new_content}\n\n" + prompt[next_marker:]


def _compute_streak(db: Session, agent_name: str) -> int:
    """
    Return the current consecutive loss streak for an agent.
    Positive = winning streak, negative = losing streak.
    """
    preds = (
        db.query(models.AgentPrediction)
        .filter(
            models.AgentPrediction.agent_name == agent_name,
            models.AgentPrediction.score != None,
        )
        .order_by(models.AgentPrediction.timestamp.desc())
        .limit(10)
        .all()
    )
    if not preds:
        return 0
    streak = 0
    last_sign = None
    for p in preds:
        win = (p.score or 0) >= 50
        if last_sign is None:
            last_sign = win
            streak = 1 if win else -1
        elif win == last_sign:
            streak = streak + 1 if win else streak - 1
        else:
            break
    return streak


def _compute_fitness(db: Session, agent_name: str, last_n: int = 10) -> dict:
    """
    Compute a fitness dict for an agent based on their last N scored predictions.
    fitness_score = (win_rate * 60) + (normalised avg_return * 40)  — 0-100 scale
    """
    preds = (
        db.query(models.AgentPrediction)
        .filter(
            models.AgentPrediction.agent_name == agent_name,
            models.AgentPrediction.score != None,
        )
        .order_by(models.AgentPrediction.timestamp.desc())
        .limit(last_n)
        .all()
    )

    if not preds:
        return {"fitness_score": None, "win_rate": None, "avg_return": None, "total_scored": 0}

    wins = sum(1 for p in preds if (p.score or 0) >= 50)
    win_rate = wins / len(preds)
    avg_return = sum((p.score or 50) - 50 for p in preds) / len(preds)  # centred at 0

    # Blend: 60% win rate, 40% avg return quality
    normalised_return = max(-50, min(50, avg_return))   # clamp
    fitness_score = (win_rate * 60) + ((normalised_return + 50) / 100 * 40)

    return {
        "fitness_score": round(fitness_score, 2),
        "win_rate": round(win_rate, 4),
        "avg_return": round(avg_return, 2),
        "total_scored": len(preds),
    }


def _archive_prompt(db: Session, agent_name: str, reason: str, fitness: dict):
    """Save current prompt to history before replacing it."""
    current = db.query(models.AgentPrompt).filter(
        models.AgentPrompt.agent_name == agent_name
    ).first()
    if not current:
        return

    # Find current generation
    last = (
        db.query(models.AgentPromptHistory)
        .filter(models.AgentPromptHistory.agent_name == agent_name)
        .order_by(models.AgentPromptHistory.generation.desc())
        .first()
    )
    generation = (last.generation if last else 0) + 1

    history = models.AgentPromptHistory(
        agent_name=agent_name,
        generation=generation,
        system_prompt=current.system_prompt,
        fitness_score=fitness.get("fitness_score"),
        win_rate=fitness.get("win_rate"),
        avg_return=fitness.get("avg_return"),
        total_scored=fitness.get("total_scored", 0),
        evolution_reason=reason,
        replaced_at=datetime.utcnow(),
    )
    db.add(history)
    db.commit()
    return generation


def _mutate_prompt(db: Session, agent_name: str, fitness: dict, streak: int = 0) -> str:
    """
    MUTATION: ask LLM to improve a failing agent's prompt, giving it full context
    about what went wrong (win rate, avg return, recent predictions).
    If streak <= -STREAK_AGGRESSIVE_MUTATE, performs aggressive mutation that also
    rewrites the CONSTITUTION section (not just EVOLVED_GUIDELINES).
    """
    current = db.query(models.AgentPrompt).filter(
        models.AgentPrompt.agent_name == agent_name
    ).first()
    if not current:
        return None

    recent_preds = (
        db.query(models.AgentPrediction)
        .filter(
            models.AgentPrediction.agent_name == agent_name,
            models.AgentPrediction.score != None,
        )
        .order_by(models.AgentPrediction.timestamp.desc())
        .limit(5)
        .all()
    )
    pred_summary = "\n".join(
        f"- {p.prediction} {p.symbol}: score={p.score:.0f}/100, outcome={p.actual_outcome}"
        for p in recent_preds
    )

    is_aggressive = streak <= -STREAK_AGGRESSIVE_MUTATE
    streak_note = f"\n⚠️  STREAK ALERT: This agent is on a {abs(streak)}-loss streak. AGGRESSIVE MODE: be radical in your changes." if is_aggressive else ""

    if is_aggressive:
        # Aggressive: mutate EVOLVED_GUIDELINES AND add a STRATEGY_BIAS section
        current_guidelines = _extract_section(current.system_prompt, "EVOLVED_GUIDELINES")
        current_bias = _extract_section(current.system_prompt, "STRATEGY_BIAS") or ""
        evolution_context = f"""
You are an AI agent optimizer performing AGGRESSIVE Darwinian selection on a chronically underperforming market prediction agent.

AGENT: {agent_name}
CURRENT FITNESS: {fitness['fitness_score']:.1f}/100 (CRITICAL — well below threshold)
WIN RATE: {fitness['win_rate']*100:.1f}% over last {fitness['total_scored']} predictions
LOSS STREAK: {abs(streak)} consecutive losses
AVG RETURN SCORE: {fitness['avg_return']:+.2f} (centred at 0, positive = beating market)

RECENT PREDICTION RECORD:
{pred_summary}

CURRENT EVOLVED GUIDELINES:
{current_guidelines}

CURRENT STRATEGY BIAS:
{current_bias or '(none set yet)'}
{streak_note}

This agent is on a LOSING STREAK and needs radical surgery. Rewrite BOTH sections:

1. EVOLVED_GUIDELINES — completely overhaul the analysis rules; reverse any biases that have been causing losses; add clear stop rules for the specific patterns that keep failing
2. STRATEGY_BIAS — write 3-5 concrete directional rules for THIS agent's specific failure mode (e.g. "Do NOT go LONG on high-P/E tech unless earnings beat by >10%", "Always check BTC dominance before altcoin longs")

OUTPUT FORMAT (output BOTH sections, clearly labelled):
EVOLVED_GUIDELINES:
<new evolved guidelines text>

STRATEGY_BIAS:
<new strategy bias rules>

Do NOT include section markers (===). Do NOT include the full prompt. Just the two sections with their labels.
"""
        response = query_agent(
            "You are an expert AI system designer specialising in financial prediction agents.",
            evolution_context
        )
        if not response:
            return None
        response = response.strip()

        # Parse out the two sections
        guidelines_m = re.search(r"EVOLVED_GUIDELINES:\s*(.+?)(?=STRATEGY_BIAS:|$)", response, re.DOTALL | re.IGNORECASE)
        bias_m = re.search(r"STRATEGY_BIAS:\s*(.+?)$", response, re.DOTALL | re.IGNORECASE)

        new_prompt = current.system_prompt
        if guidelines_m:
            new_prompt = _replace_section(new_prompt, "EVOLVED_GUIDELINES", guidelines_m.group(1).strip())
        if bias_m:
            new_prompt = _replace_section(new_prompt, "STRATEGY_BIAS", bias_m.group(1).strip())
        return new_prompt
    else:
        # Standard mutation: only EVOLVED_GUIDELINES
        current_guidelines = _extract_section(current.system_prompt, "EVOLVED_GUIDELINES")
        if not current_guidelines:
            current_guidelines = "(No evolved guidelines section found — treat entire prompt as guidelines)"

        evolution_context = f"""
You are an AI agent optimizer performing Darwinian selection on a market prediction agent.

AGENT: {agent_name}
CURRENT FITNESS: {fitness['fitness_score']:.1f}/100
WIN RATE: {fitness['win_rate']*100:.1f}% over last {fitness['total_scored']} predictions
AVG RETURN SCORE: {fitness['avg_return']:+.2f} (centred at 0, positive = beating market)

RECENT PREDICTION RECORD:
{pred_summary}

CURRENT EVOLVED GUIDELINES (this is the ONLY section you are allowed to change):
{current_guidelines}

This agent is UNDERPERFORMING. Analyse its recent failures and rewrite ONLY the evolved guidelines section to:
1. Fix the specific weaknesses shown in its prediction record
2. Add market biases, risk preferences, or sector tilts that address failure patterns
3. Make it more disciplined about when to go LONG vs SHORT
4. Keep guidelines actionable and concise (5-10 bullet points max)

IMPORTANT: Output ONLY the evolved guidelines text. Do NOT include section markers, commentary, or the full prompt.
Do NOT change the agent's identity, analysis framework, or output format.
"""
        new_guidelines = query_agent(
            "You are an expert AI system designer specialising in financial prediction agents.",
            evolution_context
        )
        if not new_guidelines:
            return None
        new_guidelines = new_guidelines.strip()
        return _replace_section(current.system_prompt, "EVOLVED_GUIDELINES", new_guidelines)


def _crossover_prompt(db: Session, agent_name: str, elite_name: str, fitness: dict) -> str:
    """
    CROSSOVER: blend the failing agent's strategy with traits from the best-performing agent.
    """
    current = db.query(models.AgentPrompt).filter(
        models.AgentPrompt.agent_name == agent_name
    ).first()
    elite = db.query(models.AgentPrompt).filter(
        models.AgentPrompt.agent_name == elite_name
    ).first()
    if not current or not elite:
        return None

    elite_fitness = _compute_fitness(db, elite_name)

    # Extract only the EVOLVED_GUIDELINES sections for crossover
    current_guidelines = _extract_section(current.system_prompt, "EVOLVED_GUIDELINES")
    elite_guidelines = _extract_section(elite.system_prompt, "EVOLVED_GUIDELINES")

    if not current_guidelines:
        current_guidelines = "(No evolved guidelines found)"
    if not elite_guidelines:
        elite_guidelines = "(No evolved guidelines found)"

    crossover_context = f"""
You are an AI agent optimizer performing genetic crossover between two market prediction agents.

WEAK AGENT: {agent_name}
- Fitness: {fitness['fitness_score']:.1f}/100, Win rate: {fitness['win_rate']*100:.1f}%
- Current Evolved Guidelines: {current_guidelines}

ELITE AGENT: {elite_name}
- Fitness: {elite_fitness['fitness_score']:.1f}/100, Win rate: {elite_fitness['win_rate']*100:.1f}%
- Evolved Guidelines: {elite_guidelines}

Create new evolved guidelines for {agent_name} by:
1. Keeping {agent_name}'s market specialisation focus
2. Borrowing successful strategies, risk preferences, and sector tilts from {elite_name}
3. The result should help {agent_name} make better trading decisions
4. Keep guidelines actionable and concise (5-10 bullet points max)

IMPORTANT: Output ONLY the new evolved guidelines text. Do NOT include section markers, commentary, or the full prompt.
"""
    new_guidelines = query_agent(
        "You are an expert AI system designer specialising in financial prediction agents.",
        crossover_context
    )
    if not new_guidelines:
        return None
    new_guidelines = new_guidelines.strip()

    # Splice the new guidelines back into the weak agent's full structured prompt
    return _replace_section(current.system_prompt, "EVOLVED_GUIDELINES", new_guidelines)


def _get_previous_rank(db: Session, agent_name: str) -> int | None:
    """
    Get the stored leaderboard rank from the last Darwin run.
    Stored as AppConfig key 'darwin_rank_{agent_name}'.
    """
    key = f"darwin_rank_{agent_name}"
    conf = db.query(models.AppConfig).filter(models.AppConfig.key == key).first()
    if conf and conf.value:
        try:
            return int(conf.value)
        except ValueError:
            pass
    return None


def _save_rank(db: Session, agent_name: str, rank: int):
    """Persist an agent's leaderboard rank for next-run comparison."""
    key = f"darwin_rank_{agent_name}"
    conf = db.query(models.AppConfig).filter(models.AppConfig.key == key).first()
    if conf:
        conf.value = str(rank)
    else:
        db.add(models.AppConfig(key=key, value=str(rank)))


def _run_darwin_selection(db: Session):
    """
    Darwinian selection loop:
    1. Compute fitness + streaks for all agents
    2. Rank them; write competitive rank-change memory notes
    3. Mutate bottom performers (aggressive if on losing streak); crossover with elite
    4. Archive old prompts, write new ones, log to memory
    """
    print("[Darwin] Running selection pressure evaluation...")

    agent_prompts = db.query(models.AgentPrompt).all()
    if not agent_prompts:
        return

    fitness_map = {}
    streak_map = {}
    for ap in agent_prompts:
        f = _compute_fitness(db, ap.agent_name)
        fitness_map[ap.agent_name] = f
        streak_map[ap.agent_name] = _compute_streak(db, ap.agent_name)
        score_str = f"{f['fitness_score']:.1f}" if f['fitness_score'] is not None else "N/A"
        streak = streak_map[ap.agent_name]
        streak_str = f"+{streak}" if streak > 0 else str(streak)
        print(f"[Darwin] {ap.agent_name}: fitness={score_str}, scored={f['total_scored']}, streak={streak_str}")

    # Need minimum predictions before making evolution decisions
    eligible = {
        name: f for name, f in fitness_map.items()
        if f["total_scored"] >= MIN_SCORED_FOR_DARWIN and f["fitness_score"] is not None
    }

    if not eligible:
        print(f"[Darwin] Not enough scored predictions yet (need {MIN_SCORED_FOR_DARWIN} per agent). Skipping.")
        return

    # Sort by fitness — best first (rank 1 = best)
    ranked = sorted(eligible.items(), key=lambda x: x[1]["fitness_score"], reverse=True)

    best_name  = ranked[0][0]
    best_score = ranked[0][1]["fitness_score"]
    total = len(ranked)
    print(f"[Darwin] Elite agent: {best_name} (fitness={best_score:.1f})")

    # ── Write competitive rank-change memory notes ─────────────────────────
    for pos, (agent_name, fitness) in enumerate(ranked):
        current_rank = pos + 1  # 1-indexed
        prev_rank = _get_previous_rank(db, agent_name)
        _save_rank(db, agent_name, current_rank)

        if prev_rank is not None and prev_rank != current_rank:
            score = fitness["fitness_score"]
            if current_rank < prev_rank:
                # Climbed the leaderboard
                write_agent_memory(
                    db, agent_name, "INSIGHT",
                    f"[Leaderboard] You climbed from rank {prev_rank} → #{current_rank}/{total} "
                    f"(fitness {score:.1f}/100). Your recent strategy adjustments are working — "
                    f"reinforce what's working and stay disciplined.",
                    importance_score=0.9,
                )
            else:
                # Dropped
                write_agent_memory(
                    db, agent_name, "LESSON",
                    f"[Leaderboard] You dropped from rank {prev_rank} → #{current_rank}/{total} "
                    f"(fitness {score:.1f}/100). Review recent losing trades and change your approach.",
                    importance_score=0.9,
                )
        elif prev_rank is None and current_rank == 1:
            # First appearance at top
            write_agent_memory(
                db, agent_name, "INSIGHT",
                f"[Leaderboard] You are the #1 ranked agent (fitness {fitness['fitness_score']:.1f}/100). "
                f"Maintain discipline — stay consistent with what's working.",
                importance_score=0.85,
            )
        db.commit()

    for agent_name, fitness in ranked:
        score = fitness["fitness_score"]
        streak = streak_map.get(agent_name, 0)

        if score >= FITNESS_THRESHOLD and streak > -STREAK_AGGRESSIVE_MUTATE:
            print(f"[Darwin] {agent_name} fitness {score:.1f} is acceptable. No change.")
            continue

        # Decide: crossover if elite is available and strong, otherwise mutate
        current_prompt = db.query(models.AgentPrompt).filter(
            models.AgentPrompt.agent_name == agent_name
        ).first()
        if not current_prompt:
            continue

        if best_name != agent_name and best_score >= CROSSOVER_THRESHOLD and streak > -STREAK_AGGRESSIVE_MUTATE:
            print(f"[Darwin] {agent_name} fitness={score:.1f} → CROSSOVER with {best_name}")
            reason = "CROSSOVER"
            new_prompt = _crossover_prompt(db, agent_name, best_name, fitness)
        elif streak <= -STREAK_AGGRESSIVE_MUTATE:
            print(f"[Darwin] {agent_name} streak={streak} → AGGRESSIVE MUTATION")
            reason = f"AGGRESSIVE_MUTATION (streak {streak})"
            new_prompt = _mutate_prompt(db, agent_name, fitness, streak=streak)
        else:
            print(f"[Darwin] {agent_name} fitness={score:.1f} → MUTATION")
            reason = "MUTATION"
            new_prompt = _mutate_prompt(db, agent_name, fitness, streak=streak)

        if not new_prompt or "Agent error" in new_prompt:
            print(f"[Darwin] LLM failed to produce a new prompt for {agent_name}. Skipping.")
            continue

        # Archive old prompt
        generation = _archive_prompt(db, agent_name, reason, fitness)

        # Apply new prompt
        current_prompt.system_prompt = new_prompt
        current_prompt.updated_at = datetime.utcnow()
        db.commit()

        win_pct = fitness['win_rate'] * 100
        streak_context = f" You are on a {abs(streak)}-loss streak — your approach was radically overhauled." if streak <= -STREAK_AGGRESSIVE_MUTATE else ""
        write_agent_memory(
            db, agent_name, "LESSON",
            f"[Generation {generation}] Darwinian {reason}: Your fitness score was "
            f"{score:.1f}/100 (win rate {win_pct:.0f}%).{streak_context} Your system prompt was evolved "
            f"to improve performance. Adapt your strategy accordingly."
        )
        db.commit()
        print(f"[Darwin] {agent_name} evolved via {reason} → generation {generation}")

    print("[Darwin] Selection complete.")


# ── Public entry point ───────────────────────────────────────────────────────

def evaluate_predictions():
    """
    1. Score active deployed strategies against live prices.
    2. Close strategies at stop-loss / take-profit.
    3. Run Darwinian selection on underperforming agents.
    """
    db = SessionLocal()
    print("--- Running Evaluation Loop ---")

    # ── Score active strategies ──────────────────────────────────────────────
    active_strategies = db.query(models.DeployedStrategy).filter(
        models.DeployedStrategy.status == "ACTIVE"
    ).all()

    for strategy in active_strategies:
        print(f"Evaluating: {strategy.strategy_type} {strategy.symbol}")

        current_data = fetch_market_data(strategy.symbol)
        if not current_data:
            print(f"Could not fetch data for {strategy.symbol}")
            continue

        current_price = current_data.price
        entry_price   = strategy.entry_price

        if strategy.strategy_type == "LONG":
            pct_return = ((current_price - entry_price) / entry_price) * 100
        else:
            pct_return = ((entry_price - current_price) / entry_price) * 100

        strategy.current_return = pct_return
        print(f"  {strategy.symbol}: entry=${entry_price:.2f} current=${current_price:.2f} return={pct_return:+.2f}%")

        _write_performance_feedback(db, strategy, current_price, pct_return)

        if pct_return <= STOP_LOSS_PCT:
            strategy.status = "CLOSED"
            strategy.exit_price = current_price
            strategy.close_reason = "STOP_LOSS"
            strategy.closed_at = datetime.utcnow()
            if strategy.position_size:
                strategy.realized_pnl = round(strategy.position_size * pct_return / 100, 2)
            _write_closure_feedback(db, strategy, pct_return, "STOP_LOSS")
            print(f"  Stop-loss triggered at {pct_return:.2f}%. Strategy closed.")
        elif pct_return >= TAKE_PROFIT_PCT:
            strategy.status = "CLOSED"
            strategy.exit_price = current_price
            strategy.close_reason = "TAKE_PROFIT"
            strategy.closed_at = datetime.utcnow()
            if strategy.position_size:
                strategy.realized_pnl = round(strategy.position_size * pct_return / 100, 2)
            _write_closure_feedback(db, strategy, pct_return, "TAKE_PROFIT")
            print(f"  Take-profit triggered at {pct_return:.2f}%. Strategy closed.")

    db.commit()

    # ── Darwinian selection ──────────────────────────────────────────────────
    _run_darwin_selection(db)

    db.commit()
    db.close()
    print("--- Evaluation Complete ---")


def _write_performance_feedback(db: Session, strategy, current_price: float, pct_return: float):
    # Get distinct agent names that have predictions for this symbol
    agent_names = (
        db.query(models.AgentPrediction.agent_name)
        .filter(models.AgentPrediction.symbol == strategy.symbol)
        .distinct()
        .all()
    )

    for (agent_name,) in agent_names:
        # Get the most recent prediction this agent made for this symbol
        pred = (
            db.query(models.AgentPrediction)
            .filter(
                models.AgentPrediction.symbol == strategy.symbol,
                models.AgentPrediction.agent_name == agent_name,
            )
            .order_by(models.AgentPrediction.timestamp.desc())
            .first()
        )
        if not pred:
            continue

        paying_off = pct_return > 0
        outcome_label = "Paying off ✅" if paying_off else "Not working ❌"
        note = (
            f"Your {pred.prediction} call on {strategy.symbol}: "
            f"entry ${strategy.entry_price:.2f} → current ${current_price:.2f} "
            f"({pct_return:+.2f}%). {outcome_label}"
        )
        write_agent_memory(
            db, agent_name, "STRATEGY_RESULT", note,
            importance_score=0.7,
            ticker_refs=strategy.symbol,
        )

        if pred.score is None:
            pred.score = max(0, min(100, 50 + pct_return * 5))
            pred.actual_outcome = "PROFIT" if pct_return > 0 else "LOSS"


def _write_closure_feedback(db: Session, strategy, pct_return: float, reason: str):
    # Get distinct agent names that have predictions for this symbol
    agent_names = (
        db.query(models.AgentPrediction.agent_name)
        .filter(models.AgentPrediction.symbol == strategy.symbol)
        .distinct()
        .all()
    )

    for (agent_name,) in agent_names:
        # Get the most recent prediction this agent made for this symbol
        pred = (
            db.query(models.AgentPrediction)
            .filter(
                models.AgentPrediction.symbol == strategy.symbol,
                models.AgentPrediction.agent_name == agent_name,
            )
            .order_by(models.AgentPrediction.timestamp.desc())
            .first()
        )
        if not pred:
            continue

        if reason == "STOP_LOSS":
            note = (
                f"LOSS: Your {pred.prediction} {strategy.symbol} stopped out at {pct_return:.2f}% "
                f"(entry ${strategy.entry_price:.2f} → exit ${strategy.exit_price:.2f}). "
                f"Analyse what you missed and avoid this pattern."
            )
        else:
            note = (
                f"WIN: Your {pred.prediction} {strategy.symbol} closed at {pct_return:+.2f}% profit "
                f"(entry ${strategy.entry_price:.2f} → exit ${strategy.exit_price:.2f}). "
                f"Identify what made this call right and repeat similar setups."
            )

        write_agent_memory(
            db, agent_name, "LESSON", note,
            importance_score=0.8,
            ticker_refs=strategy.symbol,
        )
        prune_old_memory(db, agent_name, keep=200)


if __name__ == "__main__":
    evaluate_predictions()
