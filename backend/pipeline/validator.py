from sqlalchemy.orm import Session
from sqlalchemy import func
from core.database import SessionLocal
import core.models as models
import re
import uuid
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


def _log(db: Session, run_id: str, step: str, status: str, detail: str = None, agent_name: str = None):
    """Write a PipelineEvent for the eval pipeline and immediately commit."""
    try:
        ev = models.PipelineEvent(
            run_id=run_id,
            run_type="eval",
            step=step,
            agent_name=agent_name,
            status=status,
            detail=detail,
        )
        db.add(ev)
        db.commit()
    except Exception as e:
        print(f"[eval/_log] DB write failed for {step}/{status}: {e}")
        try:
            db.rollback()
        except Exception:
            pass


def _update_run(db: Session, run: models.PipelineRun, step: str):
    try:
        run.step = step
        run.updated_at = datetime.utcnow()
        db.commit()
    except Exception as e:
        print(f"[eval/_update_run] DB write failed for step={step}: {e}")
        try:
            db.rollback()
        except Exception:
            pass


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


def _build_exhaustive_analysis_prompt(
    agent_name: str,
    prediction: models.AgentPrediction,
    strategy: models.DeployedStrategy,
    pct_return: float,
    outcome: str,
) -> str:
    """
    Build a rich prompt for exhaustive post-mortem analysis of a closed position.
    """
    direction = "LONG" if strategy.strategy_type == "LONG" else "SHORT"
    was_right = (
        (direction == "LONG" and pct_return >= 0) or
        (direction == "SHORT" and pct_return >= 0)
    )

    original_reasoning = prediction.reasoning or "(no reasoning recorded)"
    exit_price_str = f"${strategy.exit_price:.4f}" if strategy.exit_price is not None else "N/A (position still open)"

    return f"""You are conducting an exhaustive post-mortem analysis of a market prediction made by the {agent_name} agent.

=== ORIGINAL PREDICTION ===
Agent: {agent_name}
Symbol: {prediction.symbol}
Call: {prediction.prediction} (deployed as {direction})
Entry price: ${strategy.entry_price:.4f}
Current price: {exit_price_str}
Return so far: {pct_return:+.2f}%
Outcome: {outcome}
Prediction timestamp: {prediction.timestamp}

=== ORIGINAL REASONING ===
{original_reasoning}

=== YOUR TASK ===
Perform a thorough forensic analysis of this trade. Structure your output EXACTLY as follows:

WHAT_THE_AGENT_SAW:
<2-4 sentences summarising what data/signals the agent used to justify this call>

WHAT_WENT_WRONG:
<If a LOSS: What specific signals were wrong or misread? What did the agent over-weight or under-weight? What did it miss entirely?>
<If a WIN: What signals were correct? Was this luck or skill?>

ROOT_CAUSE:
<1-2 sentences identifying the single most important mistake (if loss) or edge (if win)>

IMPROVEMENT_RULES:
<3-5 concrete, actionable rules this agent should follow in the future to avoid repeating this mistake or to replicate this success. Be SPECIFIC to {agent_name}'s methodology. Start each rule with a verb (e.g. "Always check...", "Never go LONG when...", "Weight macro context more heavily when...")>

UPDATED_GUIDELINES_DELTA:
<Write 2-3 bullet points that should be added or changed in this agent's evolved guidelines section — focus on what was learned from this specific trade>

Keep each section concise but specific. Do NOT be generic. Ground every statement in the actual prediction data above.
"""


def _exhaustive_agent_analysis(
    db: Session,
    run_id: str,
    agent_name: str,
    prediction: models.AgentPrediction,
    strategy: models.DeployedStrategy,
    pct_return: float,
    outcome: str,
) -> dict:
    """
    Run exhaustive LLM post-mortem on a closed position.
    Returns parsed sections as a dict.
    """
    prompt = _build_exhaustive_analysis_prompt(agent_name, prediction, strategy, pct_return, outcome)
    _log(db, run_id, "AGENT_ANALYSIS", "IN_PROGRESS",
         f"Analysing {agent_name}'s {prediction.prediction} call on {prediction.symbol}",
         agent_name=agent_name)

    response = query_agent(
        "You are an expert trading post-mortem analyst. Be precise, specific, and brutally honest.",
        prompt,
    )
    if not response:
        _log(db, run_id, "AGENT_ANALYSIS", "ERROR",
             f"LLM failed for {agent_name}/{prediction.symbol}", agent_name=agent_name)
        return {}

    # Parse sections
    sections = {}
    section_keys = ["WHAT_THE_AGENT_SAW", "WHAT_WENT_WRONG", "ROOT_CAUSE", "IMPROVEMENT_RULES", "UPDATED_GUIDELINES_DELTA"]
    for i, key in enumerate(section_keys):
        pattern = rf"{key}:\s*(.+?)(?={'|'.join(section_keys[i+1:]) or '$'})"
        m = re.search(rf"{key}:\s*(.+?)(?={'|'.join(section_keys[i+1:]) if i+1 < len(section_keys) else ''}$)", response, re.DOTALL | re.IGNORECASE)
        if m:
            sections[key] = m.group(1).strip()
        else:
            # Fallback: grab everything after the key
            start = response.find(key + ":")
            if start != -1:
                start += len(key) + 1
                # Find the next section heading
                next_pos = len(response)
                for next_key in section_keys[i+1:]:
                    pos = response.find(next_key + ":", start)
                    if pos != -1 and pos < next_pos:
                        next_pos = pos
                sections[key] = response[start:next_pos].strip()

    _log(db, run_id, "AGENT_ANALYSIS", "DONE",
         f"{agent_name} → {outcome} ({pct_return:+.2f}%) | {sections.get('ROOT_CAUSE', '')[:120]}",
         agent_name=agent_name)
    return sections


def _mutate_prompt_exhaustive(
    db: Session,
    run_id: str,
    agent_name: str,
    fitness: dict,
    streak: int,
    analysis_summaries: list[dict],
) -> str | None:
    """
    MUTATION with exhaustive post-mortem context.
    analysis_summaries: list of {symbol, outcome, root_cause, improvement_rules, guidelines_delta}
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
    current_guidelines = _extract_section(current.system_prompt, "EVOLVED_GUIDELINES")
    current_bias = _extract_section(current.system_prompt, "STRATEGY_BIAS") or "(none set yet)"

    # Format post-mortem summaries
    postmortem_text = ""
    for s in analysis_summaries[:5]:  # cap at 5 to avoid token overflow
        postmortem_text += f"\n--- Trade: {s.get('symbol','?')} ({s.get('outcome','?')}) ---\n"
        if s.get("root_cause"):
            postmortem_text += f"Root cause: {s['root_cause']}\n"
        if s.get("improvement_rules"):
            postmortem_text += f"Improvement rules:\n{s['improvement_rules']}\n"
        if s.get("guidelines_delta"):
            postmortem_text += f"Suggested guidelines update:\n{s['guidelines_delta']}\n"

    if is_aggressive:
        evolution_context = f"""You are an AI agent optimizer performing AGGRESSIVE Darwinian selection on a chronically underperforming market prediction agent.

AGENT: {agent_name}
CURRENT FITNESS: {fitness['fitness_score']:.1f}/100 (CRITICAL — well below threshold)
WIN RATE: {fitness['win_rate']*100:.1f}% over last {fitness['total_scored']} predictions
LOSS STREAK: {abs(streak)} consecutive losses
AVG RETURN SCORE: {fitness['avg_return']:+.2f}

RECENT PREDICTION RECORD:
{pred_summary}

EXHAUSTIVE POST-MORTEM ANALYSIS OF CLOSED POSITIONS:
{postmortem_text or "(no positions closed this eval run)"}

CURRENT EVOLVED GUIDELINES:
{current_guidelines or "(none)"}

CURRENT STRATEGY BIAS:
{current_bias}

This agent is on a LOSING STREAK and needs radical surgery. Using the post-mortem analysis above as your primary evidence, rewrite BOTH sections:

1. EVOLVED_GUIDELINES — completely overhaul the analysis rules; reverse any biases that have been causing losses; incorporate the improvement rules from the post-mortem analyses
2. STRATEGY_BIAS — write 3-5 concrete directional rules that directly address the failure patterns identified in the post-mortems

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

        guidelines_m = re.search(r"EVOLVED_GUIDELINES:\s*(.+?)(?=STRATEGY_BIAS:|$)", response, re.DOTALL | re.IGNORECASE)
        bias_m = re.search(r"STRATEGY_BIAS:\s*(.+?)$", response, re.DOTALL | re.IGNORECASE)

        new_prompt = current.system_prompt
        if guidelines_m:
            new_prompt = _replace_section(new_prompt, "EVOLVED_GUIDELINES", guidelines_m.group(1).strip())
        if bias_m:
            new_prompt = _replace_section(new_prompt, "STRATEGY_BIAS", bias_m.group(1).strip())
        return new_prompt
    else:
        evolution_context = f"""You are an AI agent optimizer performing Darwinian selection on a market prediction agent.

AGENT: {agent_name}
CURRENT FITNESS: {fitness['fitness_score']:.1f}/100
WIN RATE: {fitness['win_rate']*100:.1f}% over last {fitness['total_scored']} predictions
AVG RETURN SCORE: {fitness['avg_return']:+.2f}

RECENT PREDICTION RECORD:
{pred_summary}

EXHAUSTIVE POST-MORTEM ANALYSIS OF CLOSED POSITIONS:
{postmortem_text or "(no positions closed this eval run)"}

CURRENT EVOLVED GUIDELINES (this is the ONLY section you are allowed to change):
{current_guidelines or "(No evolved guidelines section found — treat entire prompt as guidelines)"}

This agent is UNDERPERFORMING. Using the post-mortem analysis as your primary evidence, rewrite ONLY the evolved guidelines section to:
1. Fix the specific weaknesses identified in the post-mortems
2. Incorporate the improvement rules discovered from closed positions
3. Add market biases, risk preferences, or sector tilts that address failure patterns
4. Make it more disciplined about when to go LONG vs SHORT
5. Keep guidelines actionable and concise (5-10 bullet points max)

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


def _run_darwin_selection(
    db: Session,
    run_id: str,
    agent_analysis_map: dict,  # {agent_name: [analysis_dict, ...]}
):
    """
    Darwinian selection loop with exhaustive post-mortem context:
    1. Compute fitness + streaks for all agents
    2. Rank them; write competitive rank-change memory notes
    3. Mutate bottom performers using post-mortem insights; crossover with elite
    4. Archive old prompts, write new ones, log to memory
    """
    _log(db, run_id, "DARWIN_SELECTION", "IN_PROGRESS", "Running selection pressure evaluation")

    agent_prompts = db.query(models.AgentPrompt).all()
    if not agent_prompts:
        _log(db, run_id, "DARWIN_SELECTION", "DONE", "No agent prompts found — skipped")
        return

    fitness_map = {}
    streak_map = {}
    for ap in agent_prompts:
        f = _compute_fitness(db, ap.agent_name)
        fitness_map[ap.agent_name] = f
        streak_map[ap.agent_name] = _compute_streak(db, ap.agent_name)

    fitness_summary = " | ".join(
        f"{n}: {f['fitness_score']:.1f}" if f['fitness_score'] is not None else f"{n}: N/A"
        for n, f in fitness_map.items()
    )
    _log(db, run_id, "DARWIN_SELECTION", "IN_PROGRESS", f"Fitness: {fitness_summary}")

    # Need minimum predictions before making evolution decisions
    eligible = {
        name: f for name, f in fitness_map.items()
        if f["total_scored"] >= MIN_SCORED_FOR_DARWIN and f["fitness_score"] is not None
    }

    if not eligible:
        _log(db, run_id, "DARWIN_SELECTION", "DONE",
             f"Not enough scored predictions yet (need {MIN_SCORED_FOR_DARWIN} per agent). Skipping evolution.")
        return

    # Sort by fitness — best first (rank 1 = best)
    ranked = sorted(eligible.items(), key=lambda x: x[1]["fitness_score"], reverse=True)

    best_name  = ranked[0][0]
    best_score = ranked[0][1]["fitness_score"]
    total = len(ranked)

    # ── Write competitive rank-change memory notes ─────────────────────────
    for pos, (agent_name, fitness) in enumerate(ranked):
        current_rank = pos + 1  # 1-indexed
        prev_rank = _get_previous_rank(db, agent_name)
        _save_rank(db, agent_name, current_rank)

        if prev_rank is not None and prev_rank != current_rank:
            score = fitness["fitness_score"]
            if current_rank < prev_rank:
                write_agent_memory(
                    db, agent_name, "INSIGHT",
                    f"[Leaderboard] You climbed from rank {prev_rank} → #{current_rank}/{total} "
                    f"(fitness {score:.1f}/100). Your recent strategy adjustments are working — "
                    f"reinforce what's working and stay disciplined.",
                    importance_score=0.9,
                )
            else:
                write_agent_memory(
                    db, agent_name, "LESSON",
                    f"[Leaderboard] You dropped from rank {prev_rank} → #{current_rank}/{total} "
                    f"(fitness {score:.1f}/100). Review recent losing trades and change your approach.",
                    importance_score=0.9,
                )
        elif prev_rank is None and current_rank == 1:
            write_agent_memory(
                db, agent_name, "INSIGHT",
                f"[Leaderboard] You are the #1 ranked agent (fitness {fitness['fitness_score']:.1f}/100). "
                f"Maintain discipline — stay consistent with what's working.",
                importance_score=0.85,
            )
        db.commit()

    evolved_agents = []
    for agent_name, fitness in ranked:
        score = fitness["fitness_score"]
        streak = streak_map.get(agent_name, 0)

        if score >= FITNESS_THRESHOLD and streak > -STREAK_AGGRESSIVE_MUTATE:
            _log(db, run_id, "DARWIN_SELECTION", "IN_PROGRESS",
                 f"{agent_name}: fitness {score:.1f} acceptable — no evolution needed", agent_name=agent_name)
            continue

        # Decide: crossover if elite is available and strong, otherwise mutate
        current_prompt = db.query(models.AgentPrompt).filter(
            models.AgentPrompt.agent_name == agent_name
        ).first()
        if not current_prompt:
            continue

        agent_postmortems = agent_analysis_map.get(agent_name, [])

        if best_name != agent_name and best_score >= CROSSOVER_THRESHOLD and streak > -STREAK_AGGRESSIVE_MUTATE:
            reason = "CROSSOVER"
            _log(db, run_id, "DARWIN_SELECTION", "IN_PROGRESS",
                 f"{agent_name}: fitness={score:.1f} → CROSSOVER with {best_name}", agent_name=agent_name)
            new_prompt = _crossover_prompt(db, agent_name, best_name, fitness)
        elif streak <= -STREAK_AGGRESSIVE_MUTATE:
            reason = f"AGGRESSIVE_MUTATION (streak {streak})"
            _log(db, run_id, "DARWIN_SELECTION", "IN_PROGRESS",
                 f"{agent_name}: streak={streak} → AGGRESSIVE MUTATION with {len(agent_postmortems)} post-mortems",
                 agent_name=agent_name)
            new_prompt = _mutate_prompt_exhaustive(db, run_id, agent_name, fitness, streak, agent_postmortems)
        else:
            reason = "MUTATION"
            _log(db, run_id, "DARWIN_SELECTION", "IN_PROGRESS",
                 f"{agent_name}: fitness={score:.1f} → MUTATION with {len(agent_postmortems)} post-mortems",
                 agent_name=agent_name)
            new_prompt = _mutate_prompt_exhaustive(db, run_id, agent_name, fitness, streak, agent_postmortems)

        if not new_prompt or "Agent error" in new_prompt:
            _log(db, run_id, "DARWIN_SELECTION", "IN_PROGRESS",
                 f"{agent_name}: LLM failed to produce new prompt — skipped", agent_name=agent_name)
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

        evolved_agents.append({"agent": agent_name, "reason": reason, "generation": generation, "fitness": score})
        _log(db, run_id, "DARWIN_SELECTION", "IN_PROGRESS",
             f"{agent_name} evolved → generation {generation} via {reason}", agent_name=agent_name)

    summary = f"Evolution complete. Evolved {len(evolved_agents)} agent(s): {', '.join(a['agent'] for a in evolved_agents) or 'none'}"
    _log(db, run_id, "DARWIN_SELECTION", "DONE", summary)
    return evolved_agents


# ── Public entry point ───────────────────────────────────────────────────────

def evaluate_predictions(run_id: str = None):
    """
    Exhaustive evaluation pipeline:
    1. Create a PipelineRun of type "eval"
    2. PRICE_FETCH — fetch live prices for all open positions
    3. SCORE_STRATEGIES — update current_return on every open position
    4. POSITION_REVIEW — LLM analyses each open position's live thesis (no closing)
    5. AGENT_ANALYSIS — per-agent LLM review emitted per position
    6. DARWIN_SELECTION — evolve underperforming agents using live-review insights
    7. MEMORY_WRITE — write lessons and prune old memory
    """
    db = SessionLocal()
    if not run_id:
        run_id = str(uuid.uuid4())

    # ── Create eval pipeline run ──────────────────────────────────────────────
    run = models.PipelineRun(
        run_id=run_id,
        run_type="eval",
        step="pending",
    )
    db.add(run)
    db.commit()

    _log(db, run_id, "START", "IN_PROGRESS", "Evaluation pipeline started")
    _update_run(db, run, "running")

    try:
        # ── PRICE_FETCH ───────────────────────────────────────────────────────
        _log(db, run_id, "PRICE_FETCH", "IN_PROGRESS", "Fetching live prices for active strategies")

        active_strategies = db.query(models.DeployedStrategy).filter(
            models.DeployedStrategy.status == "ACTIVE"
        ).all()

        if not active_strategies:
            _log(db, run_id, "PRICE_FETCH", "DONE", "No active strategies to evaluate")
        else:
            _log(db, run_id, "PRICE_FETCH", "IN_PROGRESS",
                 f"Fetching prices for {len(active_strategies)} active position(s): "
                 f"{', '.join(s.symbol for s in active_strategies)}")

        price_data = {}
        failed_fetches = []
        for strategy in active_strategies:
            try:
                current_data = fetch_market_data(strategy.symbol, timeout=15)
            except Exception as e:
                print(f"[eval] fetch_market_data crashed for {strategy.symbol}: {e}")
                current_data = None
            if current_data:
                price_data[strategy.id] = current_data.price
            else:
                failed_fetches.append(strategy.symbol)

        if failed_fetches:
            _log(db, run_id, "PRICE_FETCH", "IN_PROGRESS",
                 f"Could not fetch: {', '.join(failed_fetches)}")

        _log(db, run_id, "PRICE_FETCH", "DONE",
             f"Fetched {len(price_data)}/{len(active_strategies)} prices successfully")

        # ── SCORE_STRATEGIES ──────────────────────────────────────────────────
        _log(db, run_id, "SCORE_STRATEGIES", "IN_PROGRESS", "Scoring strategies against live prices")
        _update_run(db, run, "score_strategies")

        score_lines = []
        for strategy in active_strategies:
            current_price = price_data.get(strategy.id)
            if not current_price:
                continue

            entry_price = strategy.entry_price or 0.0
            if not entry_price:
                score_lines.append(f"{strategy.symbol}: skipped — entry price is 0")
                continue
            if strategy.strategy_type == "LONG":
                pct_return = ((current_price - entry_price) / entry_price) * 100
            else:
                pct_return = ((entry_price - current_price) / entry_price) * 100

            strategy.current_return = pct_return
            score_lines.append(
                f"{strategy.symbol} ({strategy.strategy_type}): "
                f"entry=${entry_price:.2f} now=${current_price:.2f} return={pct_return:+.2f}%"
            )

            # Update prediction scores (mark partial performance)
            try:
                _write_performance_feedback(db, strategy, current_price, pct_return)
            except Exception as e:
                print(f"[eval] _write_performance_feedback failed for {strategy.symbol}: {e}")
                try:
                    db.rollback()
                except Exception:
                    pass


        db.commit()

        _log(db, run_id, "SCORE_STRATEGIES", "DONE",
             "\n".join(score_lines) if score_lines else "No positions to score")

        # ── POSITION_REVIEW — LLM analysis of every open position ────────────
        # Positions are never closed here; we learn from live P&L instead.
        _log(db, run_id, "POSITION_REVIEW", "IN_PROGRESS",
             f"Analysing {len(active_strategies)} open position(s) — agents review their live thesis")
        _update_run(db, run, "position_review")

        # {agent_name: [analysis_dict, ...]} accumulated for Darwin selection
        agent_analysis_map: dict[str, list] = {}

        for strategy in active_strategies:
            current_price = price_data.get(strategy.id)
            if not current_price:
                continue
            pct_return = strategy.current_return or 0.0

            # Find the most recent agent prediction for this symbol
            agent_preds = (
                db.query(models.AgentPrediction)
                .filter(models.AgentPrediction.symbol == strategy.symbol)
                .order_by(models.AgentPrediction.timestamp.desc())
                .limit(1)
                .all()
            )

            for pred in agent_preds:
                # Outcome label: still open but we can characterise direction
                interim_outcome = "WINNING" if pct_return >= 0 else "LOSING"
                analysis = _exhaustive_agent_analysis(
                    db, run_id, pred.agent_name, pred, strategy, pct_return, interim_outcome
                )
                if analysis:
                    analysis["symbol"] = strategy.symbol
                    analysis["outcome"] = interim_outcome
                    if pred.agent_name not in agent_analysis_map:
                        agent_analysis_map[pred.agent_name] = []
                    agent_analysis_map[pred.agent_name].append(analysis)

                    # Write lessons as memory so agents learn even without closing
                    if analysis.get("IMPROVEMENT_RULES") or analysis.get("improvement_rules"):
                        rules = analysis.get("IMPROVEMENT_RULES") or analysis.get("improvement_rules", "")
                        write_agent_memory(
                            db, pred.agent_name, "LESSON",
                            f"[Live review {strategy.symbol} {interim_outcome} {pct_return:+.2f}%] {rules[:400]}",
                            importance_score=0.75,
                            ticker_refs=strategy.symbol,
                        )
                    db.commit()

        reviewed_count = len(active_strategies)
        _log(db, run_id, "POSITION_REVIEW", "DONE",
             f"Reviewed {reviewed_count} open position(s). "
             f"LLM analysis complete for {len(agent_analysis_map)} agent(s).")

        # ── DARWIN_SELECTION ──────────────────────────────────────────────────
        _update_run(db, run, "darwin_selection")
        evolved = _run_darwin_selection(db, run_id, agent_analysis_map)

        # ── MEMORY_WRITE ──────────────────────────────────────────────────────
        _log(db, run_id, "MEMORY_WRITE", "IN_PROGRESS", "Writing final memories and pruning")
        _update_run(db, run, "memory_write")

        all_agents = db.query(models.AgentPrompt).all()
        for ap in all_agents:
            prune_old_memory(db, ap.agent_name, keep=200)

        _log(db, run_id, "MEMORY_WRITE", "DONE",
             f"Memory pruned. {len(all_agents)} agent(s) maintained at ≤200 notes.")

        # ── Finish ────────────────────────────────────────────────────────────
        evolved_summary = ""
        if evolved:
            evolved_summary = f" Evolved: {', '.join(a['agent'] for a in evolved)}."

        _log(db, run_id, "START", "DONE",
             f"Evaluation complete. {len(active_strategies)} position(s) reviewed, "
             f"{len(agent_analysis_map)} agent(s) analysed.{evolved_summary}")
        _update_run(db, run, "done")

    except Exception as e:
        import traceback
        err = traceback.format_exc()
        _log(db, run_id, "ERROR", "ERROR", f"Evaluation pipeline failed: {e}\n{err[:500]}")
        _update_run(db, run, "error")
    finally:
        db.commit()
        db.close()


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
