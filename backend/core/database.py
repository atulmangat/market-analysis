import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./market_analysis.db")

# Heroku/Railway/Vercel Postgres uses postgres:// scheme; SQLAlchemy requires postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_tables(engine):
    """Create all tables if they don't exist. Safe to call multiple times."""
    from core.models import Base
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)


def run_migrations(engine):
    """Run idempotent schema migrations not handled by create_all."""
    from sqlalchemy import text
    is_pg = not str(engine.url).startswith("sqlite")
    ine = "IF NOT EXISTS " if is_pg else ""
    migrations = [
        # deployed_strategies — added over time
        f"ALTER TABLE deployed_strategies ADD COLUMN {ine}debate_round_id INTEGER",
        f"ALTER TABLE deployed_strategies ADD COLUMN {ine}position_size FLOAT",
        f"ALTER TABLE deployed_strategies ADD COLUMN {ine}exit_price FLOAT",
        f"ALTER TABLE deployed_strategies ADD COLUMN {ine}realized_pnl FLOAT",
        f"ALTER TABLE deployed_strategies ADD COLUMN {ine}close_reason VARCHAR",
        f"ALTER TABLE deployed_strategies ADD COLUMN {ine}closed_at DATETIME",
        f"ALTER TABLE deployed_strategies ADD COLUMN {ine}notes TEXT",
        # debate_rounds
        f"ALTER TABLE debate_rounds ADD COLUMN {ine}report_json TEXT",
        f"ALTER TABLE debate_rounds ADD COLUMN {ine}research_context TEXT",
        f"ALTER TABLE debate_rounds ADD COLUMN {ine}judge_reasoning TEXT",
        # pipeline_runs
        f"ALTER TABLE pipeline_runs ADD COLUMN {ine}investment_focus VARCHAR",
        f"ALTER TABLE pipeline_runs ADD COLUMN {ine}focus_tickers TEXT",
        # agent_memory — tiered memory system
        f"ALTER TABLE agent_memory ADD COLUMN {ine}importance_score FLOAT DEFAULT 0.5",
        f"ALTER TABLE agent_memory ADD COLUMN {ine}ticker_refs VARCHAR",
        f"ALTER TABLE agent_memory ADD COLUMN {ine}memory_layer VARCHAR DEFAULT 'SHORT_TERM'",
        # agent_prompts
        f"ALTER TABLE agent_prompts ADD COLUMN {ine}description TEXT",
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass  # column already exists (SQLite) or other benign error
    _seed_builtin_rss_feeds(engine)


def _seed_builtin_rss_feeds(engine):
    """Upsert the hardcoded RSS feeds into rss_feeds as built-in rows (idempotent)."""
    from core.models import RssFeed  # local import avoids circular
    BUILTIN = [
        # Global
        ("https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines", "MarketWatch Real-Time", "US"),
        ("https://feeds.marketwatch.com/marketwatch/topstories/", "MarketWatch Top Stories", "US"),
        ("https://feeds.marketwatch.com/marketwatch/marketpulse/", "MarketWatch Pulse", "US"),
        ("https://feeds.a.dj.com/rss/RSSMarketsMain.xml", "WSJ Markets", "US"),
        ("https://www.ft.com/rss/home", "Financial Times", "US"),
        ("https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", "NYT Business", "US"),
        ("https://feeds.washingtonpost.com/rss/business", "Washington Post Business", "US"),
        ("https://seekingalpha.com/market_currents.xml", "Seeking Alpha", "US"),
        ("https://www.investing.com/rss/news.rss", "Investing.com", "US"),
        # Crypto
        ("https://cointelegraph.com/feed", "CoinTelegraph", "Crypto"),
        ("https://cryptoslate.com/feed/", "CryptoSlate", "Crypto"),
        ("https://bitcoinmagazine.com/.rss/full/", "Bitcoin Magazine", "Crypto"),
        ("https://decrypt.co/feed", "Decrypt", "Crypto"),
        # India
        ("https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms", "Economic Times Markets", "India"),
        ("https://www.moneycontrol.com/rss/MCtopnews.xml", "Moneycontrol", "India"),
        ("https://www.livemint.com/rss/markets", "Livemint Markets", "India"),
        ("https://www.thehindu.com/business/feeder/default.rss", "The Hindu Business", "India"),
    ]
    db = SessionLocal()
    try:
        for url, label, market in BUILTIN:
            existing = db.query(RssFeed).filter(RssFeed.url == url).first()
            if not existing:
                db.add(RssFeed(url=url, label=label, market=market, is_enabled=1, is_builtin=1))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()
