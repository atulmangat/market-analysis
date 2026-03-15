from sqlalchemy.orm import Session
from sqlalchemy import func
from database import SessionLocal
import models
from datetime import datetime
from agents import query_agent
from data_ingestion import fetch_market_data
from memory_manager import write_agent_memory, prune_old_memory

# ── Thresholds ──────────────────────────────────────────────────────────────
STOP_LOSS_PCT    = -10.0   # close strategy at this loss
TAKE_PROFIT_PCT  =  15.0   # close strategy at this gain
MIN_SCORED_FOR_DARWIN = 3  # minimum scored predictions before Darwinian eval runs
FITNESS_THRESHOLD     = 45.0  # fitness score below this triggers evolution
CROSSOVER_THRESHOLD   = 65.0  # fitness above this = "elite" donor for crossover


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


def _mutate_prompt(db: Session, agent_name: str, fitness: dict) -> str:
    """
    MUTATION: ask LLM to improve a failing agent's prompt, giving it full context
    about what went wrong (win rate, avg return, recent predictions).
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

    evolution_context = f"""
You are an AI agent optimizer performing Darwinian selection on a market prediction agent.

AGENT: {agent_name}
CURRENT FITNESS: {fitness['fitness_score']:.1f}/100
WIN RATE: {fitness['win_rate']*100:.1f}% over last {fitness['total_scored']} predictions
AVG RETURN SCORE: {fitness['avg_return']:+.2f} (centred at 0, positive = beating market)

RECENT PREDICTION RECORD:
{pred_summary}

CURRENT SYSTEM PROMPT:
{current.system_prompt}

This agent is UNDERPERFORMING. Analyse its recent failures and rewrite its system prompt to:
1. Fix the specific weaknesses shown in its prediction record
2. Keep the agent's core persona and market focus intact
3. Add more rigorous analysis steps that address the failure patterns
4. Make it more disciplined about when to go LONG vs SHORT

Output ONLY the improved system prompt. No commentary, no labels, just the prompt text.
"""
    new_prompt = query_agent(
        "You are an expert AI system designer specialising in financial prediction agents.",
        evolution_context
    )
    return new_prompt.strip()


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

    crossover_context = f"""
You are an AI agent optimizer performing genetic crossover between two market prediction agents.

WEAK AGENT: {agent_name}
- Fitness: {fitness['fitness_score']:.1f}/100, Win rate: {fitness['win_rate']*100:.1f}%
- Prompt: {current.system_prompt}

ELITE AGENT: {elite_name}
- Fitness: {elite_fitness['fitness_score']:.1f}/100, Win rate: {elite_fitness['win_rate']*100:.1f}%
- Prompt: {elite.system_prompt}

Create a new system prompt for {agent_name} by:
1. Keeping {agent_name}'s core persona and market specialisation
2. Borrowing the analytical rigour, discipline, and decision-making framework from {elite_name}
3. The result should still sound and behave like {agent_name}, but think more like {elite_name}

Output ONLY the new system prompt for {agent_name}. No commentary, no labels.
"""
    new_prompt = query_agent(
        "You are an expert AI system designer specialising in financial prediction agents.",
        crossover_context
    )
    return new_prompt.strip()


def _run_darwin_selection(db: Session):
    """
    Darwinian selection loop:
    1. Compute fitness for all agents
    2. Rank them
    3. Mutate the bottom performers; crossover with elite if available
    4. Archive old prompts, write new ones, log to memory
    """
    print("[Darwin] Running selection pressure evaluation...")

    agent_prompts = db.query(models.AgentPrompt).all()
    if not agent_prompts:
        return

    fitness_map = {}
    for ap in agent_prompts:
        f = _compute_fitness(db, ap.agent_name)
        fitness_map[ap.agent_name] = f
        score_str = f"{f['fitness_score']:.1f}" if f['fitness_score'] is not None else "N/A"
        print(f"[Darwin] {ap.agent_name}: fitness={score_str}, scored={f['total_scored']}")

    # Need minimum predictions before making evolution decisions
    eligible = {
        name: f for name, f in fitness_map.items()
        if f["total_scored"] >= MIN_SCORED_FOR_DARWIN and f["fitness_score"] is not None
    }

    if not eligible:
        print(f"[Darwin] Not enough scored predictions yet (need {MIN_SCORED_FOR_DARWIN} per agent). Skipping.")
        return

    # Sort by fitness — best first
    ranked = sorted(eligible.items(), key=lambda x: x[1]["fitness_score"], reverse=True)

    best_name  = ranked[0][0]
    best_score = ranked[0][1]["fitness_score"]
    print(f"[Darwin] Elite agent: {best_name} (fitness={best_score:.1f})")

    for agent_name, fitness in ranked:
        score = fitness["fitness_score"]

        if score >= FITNESS_THRESHOLD:
            print(f"[Darwin] {agent_name} fitness {score:.1f} is acceptable. No change.")
            continue

        # Decide: crossover if elite is available and strong, otherwise mutate
        current_prompt = db.query(models.AgentPrompt).filter(
            models.AgentPrompt.agent_name == agent_name
        ).first()
        if not current_prompt:
            continue

        if best_name != agent_name and best_score >= CROSSOVER_THRESHOLD:
            print(f"[Darwin] {agent_name} fitness={score:.1f} → CROSSOVER with {best_name}")
            reason = "CROSSOVER"
            new_prompt = _crossover_prompt(db, agent_name, best_name, fitness)
        else:
            print(f"[Darwin] {agent_name} fitness={score:.1f} → MUTATION")
            reason = "MUTATION"
            new_prompt = _mutate_prompt(db, agent_name, fitness)

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
        write_agent_memory(
            db, agent_name, "LESSON",
            f"[Generation {generation}] Darwinian {reason}: Your fitness score was "
            f"{score:.1f}/100 (win rate {win_pct:.0f}%). Your system prompt was evolved "
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
        write_agent_memory(db, agent_name, "STRATEGY_RESULT", note)

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

        write_agent_memory(db, agent_name, "LESSON", note)
        prune_old_memory(db, agent_name, keep=50)


if __name__ == "__main__":
    evaluate_predictions()
