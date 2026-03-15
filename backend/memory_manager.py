"""
Memory Manager — per-agent persistent memory read/write/prune.
Each agent accumulates notes (insights, lessons, strategy results) that
are injected into their context on every debate.
"""
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import func
import models


# ── Memory types ─────────────────────────────────────────────────────────────

NOTE_TYPES = {
    "INSIGHT":          "Market insight or observation",
    "LESSON":           "Lesson learned from a past mistake or success",
    "STRATEGY_RESULT":  "Outcome of a strategy this agent participated in",
    "OBSERVATION":      "General observation made during a debate",
}


# ── Read ─────────────────────────────────────────────────────────────────────

def get_agent_memory(db: Session, agent_name: str, limit: int = 10) -> list[models.AgentMemory]:
    """Retrieve the most recent memory notes for an agent."""
    return (
        db.query(models.AgentMemory)
        .filter(models.AgentMemory.agent_name == agent_name)
        .order_by(models.AgentMemory.created_at.desc())
        .limit(limit)
        .all()
    )


def format_memory_for_context(memories: list[models.AgentMemory]) -> str:
    """Format memory notes into a string suitable for LLM context injection."""
    if not memories:
        return "You have no prior memory notes. This is your first analysis."

    lines = ["## Your Memory Notes (most recent first)\n"]
    for m in memories:
        timestamp = m.created_at.strftime("%Y-%m-%d %H:%M") if m.created_at else "unknown"
        lines.append(f"- [{m.note_type}] ({timestamp}) {m.content}")

    return "\n".join(lines)


# ── Write ────────────────────────────────────────────────────────────────────

def write_agent_memory(
    db: Session,
    agent_name: str,
    note_type: str,
    content: str,
    source_debate_id: int = None,
):
    """Save a new memory note for an agent."""
    if note_type not in NOTE_TYPES:
        note_type = "OBSERVATION"

    note = models.AgentMemory(
        agent_name=agent_name,
        note_type=note_type,
        content=content,
        source_debate_id=source_debate_id,
    )
    db.add(note)
    # Don't commit here — let the caller manage the transaction
    return note


# ── Prune ────────────────────────────────────────────────────────────────────

def prune_old_memory(db: Session, agent_name: str, keep: int = 50):
    """Keep only the most recent `keep` notes per agent. Deletes older ones."""
    total = db.query(models.AgentMemory).filter(
        models.AgentMemory.agent_name == agent_name
    ).count()

    if total <= keep:
        return 0

    # Find the cutoff: the `keep`-th most recent note
    cutoff_note = (
        db.query(models.AgentMemory)
        .filter(models.AgentMemory.agent_name == agent_name)
        .order_by(models.AgentMemory.created_at.desc())
        .offset(keep)
        .first()
    )

    if cutoff_note:
        deleted = (
            db.query(models.AgentMemory)
            .filter(
                models.AgentMemory.agent_name == agent_name,
                models.AgentMemory.created_at <= cutoff_note.created_at,
            )
            .delete(synchronize_session="fetch")
        )
        return deleted
    return 0


# ── Performance Summary ──────────────────────────────────────────────────────

def get_agent_performance_summary(db: Session, agent_name: str) -> str:
    """
    Build a short performance summary from AgentPrediction records.
    Returns a string like: "Past record: 5 picks, 3 correct, avg score 72.5"
    """
    predictions = (
        db.query(models.AgentPrediction)
        .filter(models.AgentPrediction.agent_name == agent_name)
        .order_by(models.AgentPrediction.timestamp.desc())
        .limit(20)
        .all()
    )

    if not predictions:
        return "No past performance data available yet."

    total = len(predictions)
    scored = [p for p in predictions if p.score is not None]
    avg_score = sum(p.score for p in scored) / len(scored) if scored else 0

    # Recent picks summary
    recent = predictions[:5]
    recent_lines = []
    for p in recent:
        ts = p.timestamp.strftime("%Y-%m-%d") if p.timestamp else "?"
        score_str = f"score={p.score:.0f}" if p.score is not None else "pending"
        recent_lines.append(f"  - {ts}: {p.prediction} {p.symbol} ({score_str})")

    summary = f"## Your Past Performance\n"
    summary += f"Total picks: {total} | Scored: {len(scored)} | Avg score: {avg_score:.1f}/100\n\n"
    summary += "Recent picks:\n" + "\n".join(recent_lines)

    return summary
