from sqlalchemy import Column, Integer, BigInteger, String, Float, Text, DateTime
from core.database import Base
from datetime import datetime

class MarketSignal(Base):
    __tablename__ = "market_signals"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    price = Column(Float)
    volume = Column(BigInteger)

class AgentPrediction(Base):
    __tablename__ = "agent_predictions"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    symbol = Column(String, index=True) # The specific stock they propose
    agent_name = Column(String)
    prediction = Column(String)  # BULLISH, BEARISH (for their proposed symbol)
    confidence = Column(Float)
    reasoning = Column(Text)
    actual_outcome = Column(String, nullable=True) # Populated later by verification loop
    score = Column(Float, nullable=True) # Populated later by verification loop

class DeployedStrategy(Base):
    __tablename__ = "deployed_strategies"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    symbol = Column(String, index=True)
    strategy_type = Column(String) # LONG or SHORT
    entry_price = Column(Float)
    reasoning_summary = Column(Text)
    status = Column(String, default="ACTIVE") # ACTIVE, CLOSED, PENDING, REJECTED
    current_return = Column(Float, default=0.0)
    position_size = Column(Float, nullable=True)   # allocated capital in USD
    exit_price = Column(Float, nullable=True)       # set when manually closed
    realized_pnl = Column(Float, nullable=True)     # final P&L in USD when closed
    close_reason = Column(String, nullable=True)    # STOP_LOSS | TAKE_PROFIT | MANUAL | REJECTED
    closed_at = Column(DateTime, nullable=True)     # when the position was closed
    notes = Column(Text, nullable=True)             # user editable notes
    debate_round_id = Column(Integer, nullable=True, index=True)  # FK → DebateRound.id


class AgentPrompt(Base):
    __tablename__ = "agent_prompts"

    id = Column(Integer, primary_key=True, index=True)
    agent_name = Column(String, unique=True, index=True)
    description = Column(Text, nullable=True) # Short summary of capabilities for the dispatcher
    system_prompt = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class MarketConfig(Base):
    __tablename__ = "market_config"

    id = Column(Integer, primary_key=True, index=True)
    market_name = Column(String, unique=True, index=True) # e.g., US, Crypto, India, MCX
    is_enabled = Column(Integer, default=1) # 1 for True, 0 for False
    custom_tickers = Column(Text, nullable=True)  # JSON list of user-added tickers e.g. ["INTC","PLTR"]
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class DebateRound(Base):
    __tablename__ = "debate_rounds"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    consensus_ticker = Column(String)        # e.g. NVDA
    consensus_action = Column(String)        # LONG or SHORT
    consensus_votes = Column(String)         # e.g. "3/4"
    proposals_json = Column(Text)            # JSON array of {agent_name, ticker, action, reasoning}
    enabled_markets = Column(String)         # e.g. "US, Crypto, India, MCX"
    research_context = Column(Text, nullable=True) # JSON tracking what research was used
    judge_reasoning = Column(Text, nullable=True)  # Judge LLM verdict explaining the final decision
    report_json = Column(Text, nullable=True)       # Full structured report (chart + fundamentals) generated post-deploy

class AppConfig(Base):
    __tablename__ = "app_config"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, index=True)
    value = Column(String)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AgentMemory(Base):
    """Per-agent persistent memory notes. Agents recall these in future debates."""
    __tablename__ = "agent_memory"

    id = Column(Integer, primary_key=True, index=True)
    agent_name = Column(String, index=True)
    note_type = Column(String)  # INSIGHT | LESSON | STRATEGY_RESULT | OBSERVATION
    content = Column(Text)
    source_debate_id = Column(Integer, nullable=True)  # links back to DebateRound.id
    created_at = Column(DateTime, default=datetime.utcnow)
    importance_score = Column(Float, default=0.5)       # 0.0–1.0; higher = more valuable
    ticker_refs = Column(String, nullable=True)          # comma-separated, e.g. "NVDA,AAPL"
    memory_layer = Column(String, default="SHORT_TERM")  # SHORT_TERM | LONG_TERM | REFLECTION


class WebResearch(Base):
    """Cached web research results fetched for agent context."""
    __tablename__ = "web_research"

    id = Column(Integer, primary_key=True, index=True)
    query = Column(String, index=True)
    source_url = Column(String)
    title = Column(String)
    snippet = Column(Text)
    fetched_at = Column(DateTime, default=datetime.utcnow)


class AgentPromptHistory(Base):
    """Full version history of every agent prompt — tracks Darwinian evolution."""
    __tablename__ = "agent_prompt_history"

    id           = Column(Integer, primary_key=True, index=True)
    agent_name   = Column(String, index=True)
    generation   = Column(Integer, default=1)        # increments with each evolution
    system_prompt = Column(Text)
    fitness_score = Column(Float, nullable=True)     # win_rate * 100 at time of replacement
    win_rate      = Column(Float, nullable=True)     # 0.0–1.0
    avg_return    = Column(Float, nullable=True)     # avg pct return of scored predictions
    total_scored  = Column(Integer, default=0)       # how many predictions were scored
    evolution_reason = Column(String, nullable=True) # MUTATION | CROSSOVER | RESET | SEED
    replaced_at   = Column(DateTime, nullable=True)  # when this version was superseded
    created_at    = Column(DateTime, default=datetime.utcnow)


class PipelineRun(Base):
    """Tracks state between lambda steps in the debate pipeline."""
    __tablename__ = "pipeline_runs"

    id            = Column(Integer, primary_key=True, index=True)
    run_id        = Column(String, unique=True, index=True)
    run_type      = Column(String, default="debate")   # "debate" | "eval"
    step          = Column(String, default="pending")  # pending | research | agents | consensus | deploy | done | error
    shared_context = Column(Text, nullable=True)       # cached research context JSON
    proposals_json = Column(Text, nullable=True)       # agent proposals JSON
    enabled_markets_json = Column(Text, nullable=True) # enabled markets snapshot
    investment_focus = Column(String, nullable=True)
    focus_tickers  = Column(Text, nullable=True)       # JSON list if focused run
    created_at    = Column(DateTime, default=datetime.utcnow)
    updated_at    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PipelineEvent(Base):
    """Real-time log of steps within a single run_debate() execution."""
    __tablename__ = "pipeline_events"

    id         = Column(Integer, primary_key=True, index=True)
    run_id     = Column(String, index=True)       # UUID, one per run_debate() call
    run_type   = Column(String, default="debate") # "debate" | "eval"
    step       = Column(String)                   # START | WEB_RESEARCH | AGENT_QUERY | VOTE | DEPLOY | MEMORY_WRITE | ERROR
    agent_name = Column(String, nullable=True)    # set for AGENT_QUERY steps
    status     = Column(String)                   # IN_PROGRESS | DONE | ERROR
    detail     = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class KGNode(Base):
    """A node in the persistent knowledge graph."""
    __tablename__ = "kg_nodes"

    id            = Column(Integer, primary_key=True, index=True)
    node_id       = Column(String, unique=True, index=True)  # e.g. "asset:NVDA"
    node_type     = Column(String, index=True)               # ASSET | EVENT | ENTITY | INDICATOR
    label         = Column(String)
    symbol        = Column(String, nullable=True, index=True)
    metadata_json = Column(Text, nullable=True)
    last_seen_at  = Column(DateTime, default=datetime.utcnow)
    created_at    = Column(DateTime, default=datetime.utcnow)


class KGEdge(Base):
    """A directed, typed relationship between two KG nodes."""
    __tablename__ = "kg_edges"

    id             = Column(Integer, primary_key=True, index=True)
    source_node_id = Column(String, index=True)
    target_node_id = Column(String, index=True)
    relation       = Column(String, index=True)  # affects | correlated_with | caused_by | related_to | sector_peer
    confidence     = Column(Float, default=0.5)
    source_run_id  = Column(String, nullable=True, index=True)
    expires_at     = Column(DateTime, nullable=True)
    created_at     = Column(DateTime, default=datetime.utcnow)


class CacheEntry(Base):
    """DB-backed cache shared across all workers/serverless invocations."""
    __tablename__ = "cache_entries"

    key        = Column(String, primary_key=True, index=True)
    value_json = Column(Text, nullable=False)
    expires_at = Column(DateTime, nullable=True)   # NULL = no expiry
    updated_at = Column(DateTime, default=datetime.utcnow)


class LLMUsage(Base):
    """Per-call token usage and cost tracking for all LLM requests."""
    __tablename__ = "llm_usage"

    id                = Column(Integer, primary_key=True, index=True)
    timestamp         = Column(DateTime, default=datetime.utcnow, index=True)
    model             = Column(String, index=True)
    caller            = Column(String, nullable=True, index=True)
    prompt_tokens     = Column(Integer, default=0)
    completion_tokens = Column(Integer, default=0)  # total output incl. reasoning
    reasoning_tokens  = Column(Integer, default=0)  # chain-of-thought tokens (subset of completion)
    total_tokens      = Column(Integer, default=0)
    cost              = Column(Float, default=0.0)  # USD cost reported by OpenRouter (0 for free models)
    run_id            = Column(String, nullable=True, index=True)


class SeenArticle(Base):
    """Tracks articles already processed so they are not fed to the KG again."""
    __tablename__ = "seen_articles"

    id            = Column(Integer, primary_key=True, index=True)
    title_key     = Column(String, unique=True, index=True)  # first 80 chars, lowercased
    source_domain = Column(String, index=True)               # e.g. "reuters.com"
    first_seen_at = Column(DateTime, default=datetime.utcnow, index=True)
    expires_at    = Column(DateTime, index=True)             # 30 days after first_seen_at


class RssFeed(Base):
    """User-managed RSS feed sources included in web research."""
    __tablename__ = "rss_feeds"

    id         = Column(Integer, primary_key=True, index=True)
    url        = Column(String, unique=True, index=True)
    label      = Column(String)
    market     = Column(String, default="US")   # US | Crypto | India | MCX | All
    is_enabled = Column(Integer, default=1)     # 1 = active, 0 = disabled
    is_builtin = Column(Integer, default=0)     # 1 = seeded from code, 0 = user-added
    created_at = Column(DateTime, default=datetime.utcnow)
