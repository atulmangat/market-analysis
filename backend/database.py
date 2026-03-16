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
    from models import Base
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
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass  # column already exists (SQLite) or other benign error
