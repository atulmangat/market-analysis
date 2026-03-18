import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

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
    """
    Run all pending Alembic migrations, then seed baseline data.

    On a brand-new DB (e.g. fresh SQLite or new Postgres schema) this creates
    every table and runs all migrations in order.  On an existing DB it only
    applies migrations that haven't been applied yet — fully idempotent.
    """
    _run_alembic_migrations()
    _seed_builtin_rss_feeds()
    _seed_schedule_keys()


def _run_alembic_migrations():
    """Apply all pending Alembic migrations programmatically."""
    import os
    from alembic.config import Config
    from alembic import command

    # Locate alembic.ini relative to this file (backend/core/ → backend/)
    backend_dir = os.path.dirname(os.path.dirname(__file__))
    ini_path = os.path.join(backend_dir, "alembic.ini")

    alembic_cfg = Config(ini_path)
    # Override the sqlalchemy.url so we always use the runtime DATABASE_URL,
    # not whatever is in alembic.ini
    alembic_cfg.set_main_option("sqlalchemy.url", DATABASE_URL)

    command.upgrade(alembic_cfg, "head")


def _seed_schedule_keys():
    """Upsert per-pipeline schedule keys with sensible defaults (idempotent)."""
    db = SessionLocal()
    try:
        from core.models import AppConfig
        defaults = {
            "schedule_research_minutes": "60",
            "schedule_trade_minutes":    "60",
            "schedule_eval_minutes":     "120",
        }
        for key, val in defaults.items():
            if not db.query(AppConfig).filter(AppConfig.key == key).first():
                db.add(AppConfig(key=key, value=val))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def _seed_builtin_rss_feeds():
    """Upsert the hardcoded RSS feeds into rss_feeds as built-in rows (idempotent)."""
    from core.models import RssFeed
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
            if not db.query(RssFeed).filter(RssFeed.url == url).first():
                db.add(RssFeed(url=url, label=label, market=market, is_enabled=1, is_builtin=1))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()
