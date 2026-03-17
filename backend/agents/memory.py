"""
Memory Manager — per-agent persistent memory with tiered retrieval,
weighted scoring, and LLM-distilled consolidation.

Memory layers:
  SHORT_TERM  — raw episodic notes from recent debates (auto-created)
  LONG_TERM   — high-importance notes promoted from SHORT_TERM
  REFLECTION  — LLM-distilled consolidations of many SHORT_TERM notes
"""
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
import re
import core.models as models


# ── Constants ────────────────────────────────────────────────────────────────

NOTE_TYPES = {
    "INSIGHT":          "Market insight or observation",
    "LESSON":           "Lesson learned from a past mistake or success",
    "STRATEGY_RESULT":  "Outcome of a strategy this agent participated in",
    "OBSERVATION":      "General observation made during a debate",
}

# Default importance scores per note type
DEFAULT_IMPORTANCE = {
    "LESSON":          0.8,
    "STRATEGY_RESULT": 0.7,
    "INSIGHT":         0.6,
    "OBSERVATION":     0.4,
}

# Ticker symbol regex — matches patterns like NVDA, AAPL, BTC-USD, RELIANCE.NS, GC=F
_TICKER_RE = re.compile(
    r'\b([A-Z]{1,5}(?:[.\-=][A-Z0-9]{1,4})?)\b'
)

# Known tickers to filter noise from the regex
_KNOWN_SUFFIXES = {".NS", "-USD", "=F"}

CONSOLIDATION_THRESHOLD = 30   # trigger consolidation when SHORT_TERM count exceeds this
CONSOLIDATION_BATCH     = 30   # how many old notes to consume per consolidation


# ── Ticker extraction ────────────────────────────────────────────────────────

def _extract_tickers(text: str) -> str | None:
    """Extract plausible ticker symbols from text content. Returns comma-separated or None."""
    matches = _TICKER_RE.findall(text)
    # Filter to likely tickers (>=2 chars, not common English words)
    noise = {
        "THE", "AND", "FOR", "NOT", "BUT", "YOU", "YOUR", "ARE", "WAS", "HAS",
        "HAD", "HIS", "HER", "ITS", "ALL", "CAN", "DID", "GET", "GOT", "HAS",
        "HOW", "LET", "MAY", "NEW", "NOW", "OLD", "OUR", "OUT", "OWN", "SAY",
        "SHE", "TOO", "USE", "WAY", "WHO", "WIN", "YES", "YET", "DAY", "END",
        "FAR", "FEW", "RUN", "SET", "TRY", "WHY", "AIM", "BIG", "BIT", "CUT",
        "DUE", "ERA", "FIT", "GAP", "HIT", "KEY", "LAW", "LOW", "MIS", "NET",
        "PAY", "PUT", "RAW", "TOP", "USD", "PCT", "AVG", "MAX", "MIN", "PRE",
        "PER", "LOSS", "STOP", "LONG", "SHORT", "HIGH", "HOLD", "RULE",
        "RATE", "RISK", "MOVE", "TERM", "FUND", "GOOD", "LOOK", "PICK",
        "DOWN", "OVER", "CALL", "NOTE", "PAST", "WHAT", "WHEN", "WITH",
        "THAT", "THIS", "FROM", "BEEN", "HAVE", "WILL", "DOES", "DONE",
        "EACH", "FULL", "JUST", "KEEP", "LAST", "MADE", "MAKE", "MORE",
        "MUCH", "MUST", "NEXT", "ONLY", "SAME", "SOME", "SUCH", "TAKE",
        "THAN", "THEM", "THEN", "THEY", "VERY", "WENT", "WERE", "ALSO",
        "BACK", "COME", "GAVE", "GIVE", "GOES", "GONE", "KNEW", "LEFT",
        "LIKE", "LIVE", "MOST", "NAME", "NEAR", "OPEN", "PART", "REAL",
        "SAID", "SHOW", "SIDE", "TELL", "TURN", "UPON", "WELL", "WORK",
    }
    tickers = []
    seen = set()
    for m in matches:
        if len(m) < 2 or m in noise or m in seen:
            continue
        seen.add(m)
        tickers.append(m)

    return ",".join(tickers) if tickers else None


# ── Write ────────────────────────────────────────────────────────────────────

def write_agent_memory(
    db: Session,
    agent_name: str,
    note_type: str,
    content: str,
    source_debate_id: int = None,
    importance_score: float = None,
    ticker_refs: str = None,
    memory_layer: str = "SHORT_TERM",
):
    """Save a new memory note for an agent with importance and ticker metadata."""
    if note_type not in NOTE_TYPES:
        note_type = "OBSERVATION"

    if importance_score is None:
        importance_score = DEFAULT_IMPORTANCE.get(note_type, 0.5)

    if ticker_refs is None:
        ticker_refs = _extract_tickers(content)

    note = models.AgentMemory(
        agent_name=agent_name,
        note_type=note_type,
        content=content,
        source_debate_id=source_debate_id,
        importance_score=importance_score,
        ticker_refs=ticker_refs,
        memory_layer=memory_layer,
    )
    db.add(note)
    # Don't commit here — let the caller manage the transaction
    return note


# ── Tiered Read ──────────────────────────────────────────────────────────────

def _recency_score(created_at: datetime, max_hours: float = 168.0) -> float:
    """Score from 1.0 (just created) to 0.0 (>= max_hours old)."""
    if not created_at:
        return 0.0
    hours = (datetime.utcnow() - created_at).total_seconds() / 3600
    return max(0.0, min(1.0, 1.0 - (hours / max_hours)))


def get_agent_memory_tiered(
    db: Session,
    agent_name: str,
    context_tickers: list[str] | None = None,
    recent_limit: int = 5,
    principle_limit: int = 5,
    ticker_limit: int = 3,
) -> list[models.AgentMemory]:
    """
    Tiered memory retrieval:
      1. Recent episodic (SHORT_TERM, newest first)
      2. High-importance principles (importance >= 0.7, any layer)
      3. Ticker-specific (matching context_tickers)
    De-duplicated by id. Sorted by weighted composite score.
    """
    seen_ids: set[int] = set()
    all_memories: list[tuple[models.AgentMemory, float]] = []

    # ── Tier 1: Recent episodic ──────────────────────────────────────────────
    recent = (
        db.query(models.AgentMemory)
        .filter(
            models.AgentMemory.agent_name == agent_name,
            models.AgentMemory.memory_layer == "SHORT_TERM",
        )
        .order_by(models.AgentMemory.created_at.desc())
        .limit(recent_limit)
        .all()
    )
    for m in recent:
        seen_ids.add(m.id)
        recency = _recency_score(m.created_at)
        imp = m.importance_score or 0.5
        composite = (0.4 * recency) + (0.4 * imp) + 0.2  # no ticker bonus here
        all_memories.append((m, composite))

    # ── Tier 2: High-importance principles ───────────────────────────────────
    principles = (
        db.query(models.AgentMemory)
        .filter(
            models.AgentMemory.agent_name == agent_name,
            models.AgentMemory.importance_score >= 0.7,
        )
        .order_by(
            models.AgentMemory.importance_score.desc(),
            models.AgentMemory.created_at.desc(),
        )
        .limit(principle_limit + len(seen_ids))  # over-fetch to account for dedup
        .all()
    )
    for m in principles:
        if m.id in seen_ids:
            continue
        seen_ids.add(m.id)
        recency = _recency_score(m.created_at)
        imp = m.importance_score or 0.5
        composite = (0.4 * recency) + (0.4 * imp) + 0.2
        all_memories.append((m, composite))
        if len(all_memories) >= recent_limit + principle_limit:
            break

    # ── Tier 3: Ticker-specific ──────────────────────────────────────────────
    if context_tickers:
        ticker_filters = [
            models.AgentMemory.ticker_refs.contains(t)
            for t in context_tickers
        ]
        ticker_mems = (
            db.query(models.AgentMemory)
            .filter(
                models.AgentMemory.agent_name == agent_name,
                or_(*ticker_filters),
            )
            .order_by(models.AgentMemory.created_at.desc())
            .limit(ticker_limit + len(seen_ids))
            .all()
        )
        added = 0
        for m in ticker_mems:
            if m.id in seen_ids:
                continue
            seen_ids.add(m.id)
            recency = _recency_score(m.created_at)
            imp = m.importance_score or 0.5
            # Ticker relevance bonus
            refs = (m.ticker_refs or "").split(",")
            ticker_overlap = sum(1 for t in context_tickers if t in refs)
            ticker_bonus = min(1.0, ticker_overlap / max(1, len(context_tickers)))
            composite = (0.4 * recency) + (0.4 * imp) + (0.2 * ticker_bonus)
            all_memories.append((m, composite))
            added += 1
            if added >= ticker_limit:
                break

    # Sort by composite score descending
    all_memories.sort(key=lambda x: x[1], reverse=True)
    return [m for m, _ in all_memories]


# ── Legacy read (kept for backward compatibility) ────────────────────────────

def get_agent_memory(db: Session, agent_name: str, limit: int = 10) -> list[models.AgentMemory]:
    """Retrieve the most recent memory notes for an agent (legacy interface)."""
    return (
        db.query(models.AgentMemory)
        .filter(models.AgentMemory.agent_name == agent_name)
        .order_by(models.AgentMemory.created_at.desc())
        .limit(limit)
        .all()
    )


# ── Format for context injection ─────────────────────────────────────────────

def format_memory_for_context(memories: list[models.AgentMemory]) -> str:
    """Format memory notes into tiered sections for LLM context injection."""
    if not memories:
        return "You have no prior memory notes. This is your first analysis."

    reflections = [m for m in memories if (m.memory_layer or "") == "REFLECTION"]
    long_term   = [m for m in memories if (m.memory_layer or "") == "LONG_TERM"]
    short_term  = [m for m in memories if (m.memory_layer or "") not in ("REFLECTION", "LONG_TERM")]

    lines = []

    if reflections:
        lines.append("## Your Reflections (distilled principles)\n")
        for m in reflections:
            ts = m.created_at.strftime("%Y-%m-%d") if m.created_at else "?"
            lines.append(f"- [REFLECTION] ({ts}) {m.content}")
        lines.append("")

    if long_term:
        lines.append("## Long-Term Lessons\n")
        for m in long_term:
            ts = m.created_at.strftime("%Y-%m-%d") if m.created_at else "?"
            lines.append(f"- [{m.note_type}] ({ts}) {m.content}")
        lines.append("")

    if short_term:
        lines.append("## Recent Memory\n")
        for m in short_term:
            ts = m.created_at.strftime("%Y-%m-%d %H:%M") if m.created_at else "?"
            tickers = f" [{m.ticker_refs}]" if m.ticker_refs else ""
            lines.append(f"- [{m.note_type}] ({ts}){tickers} {m.content}")

    return "\n".join(lines)


# ── Consolidation (replaces FIFO prune) ──────────────────────────────────────

def consolidate_memories(db: Session, agent_name: str):
    """
    When SHORT_TERM count exceeds threshold:
    1. Promote high-importance SHORT_TERM notes to LONG_TERM
    2. Distill the oldest SHORT_TERM batch into REFLECTION notes via LLM
    3. Delete consumed SHORT_TERM notes
    """
    short_term_count = db.query(models.AgentMemory).filter(
        models.AgentMemory.agent_name == agent_name,
        models.AgentMemory.memory_layer == "SHORT_TERM",
    ).count()

    if short_term_count <= CONSOLIDATION_THRESHOLD:
        return 0

    print(f"[Memory] {agent_name}: {short_term_count} SHORT_TERM notes — triggering consolidation")

    # ── 1. Promote high-importance notes to LONG_TERM ────────────────────────
    high_imp = (
        db.query(models.AgentMemory)
        .filter(
            models.AgentMemory.agent_name == agent_name,
            models.AgentMemory.memory_layer == "SHORT_TERM",
            models.AgentMemory.importance_score >= 0.7,
        )
        .all()
    )
    for m in high_imp:
        m.memory_layer = "LONG_TERM"
    if high_imp:
        print(f"[Memory] Promoted {len(high_imp)} high-importance notes to LONG_TERM")

    # ── 2. Distill oldest SHORT_TERM notes into reflections ──────────────────
    oldest = (
        db.query(models.AgentMemory)
        .filter(
            models.AgentMemory.agent_name == agent_name,
            models.AgentMemory.memory_layer == "SHORT_TERM",
        )
        .order_by(models.AgentMemory.created_at.asc())
        .limit(CONSOLIDATION_BATCH)
        .all()
    )

    if len(oldest) < 5:
        # Not enough to meaningfully consolidate
        db.commit()
        return len(high_imp)

    # Build consolidation prompt
    notes_text = "\n".join(
        f"- [{m.note_type}] {m.content}" for m in oldest
    )

    consolidation_prompt = (
        "You are an AI memory consolidation system for a financial trading agent.\n\n"
        f"AGENT: {agent_name}\n\n"
        "Below are the agent's raw episodic memory notes from recent trading rounds. "
        "Distill them into 3-5 high-level, actionable principles or patterns that this agent "
        "should remember permanently. Focus on:\n"
        "- Recurring patterns (what works / what doesn't)\n"
        "- Asset-specific lessons\n"
        "- Strategy biases to adopt or avoid\n\n"
        "Output each principle on its own line, starting with a dash (-). "
        "Be concise and specific. No preamble.\n\n"
        f"RAW NOTES:\n{notes_text}"
    )

    try:
        from agents.llm import query_agent
        response = query_agent(
            "You are a memory consolidation system. Output only the distilled principles.",
            consolidation_prompt,
        )
    except Exception as e:
        print(f"[Memory] Consolidation LLM call failed for {agent_name}: {e}")
        db.commit()
        return len(high_imp)

    if not response:
        print(f"[Memory] Consolidation LLM returned empty for {agent_name}")
        db.commit()
        return len(high_imp)

    # Parse reflections from response
    reflections_created = 0
    for line in response.strip().splitlines():
        line = line.strip()
        if line.startswith("-"):
            line = line[1:].strip()
        if not line or len(line) < 10:
            continue

        ticker_refs = _extract_tickers(line)
        note = models.AgentMemory(
            agent_name=agent_name,
            note_type="LESSON",
            content=line,
            importance_score=0.9,
            ticker_refs=ticker_refs,
            memory_layer="REFLECTION",
        )
        db.add(note)
        reflections_created += 1

    # ── 3. Delete consumed SHORT_TERM notes ──────────────────────────────────
    consumed_ids = [m.id for m in oldest]
    db.query(models.AgentMemory).filter(
        models.AgentMemory.id.in_(consumed_ids),
        models.AgentMemory.memory_layer == "SHORT_TERM",  # safety: only delete if still SHORT_TERM
    ).delete(synchronize_session="fetch")

    db.commit()
    print(f"[Memory] Consolidated {len(consumed_ids)} notes → {reflections_created} reflections for {agent_name}")
    return reflections_created


# ── Legacy prune (kept but now wraps consolidation) ──────────────────────────

def prune_old_memory(db: Session, agent_name: str, keep: int = 200):
    """Consolidate memories instead of simple FIFO delete."""
    return consolidate_memories(db, agent_name)


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
