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


def run_migrations(engine):
    """Run idempotent schema migrations not handled by create_all."""
    from sqlalchemy import text
    is_pg = not str(engine.url).startswith("sqlite")
    if_not_exists = "IF NOT EXISTS " if is_pg else ""
    migrations = [
        f"ALTER TABLE deployed_strategies ADD COLUMN {if_not_exists}debate_round_id INTEGER",
        f"ALTER TABLE debate_rounds ADD COLUMN {if_not_exists}report_json TEXT",
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass  # column already exists (SQLite) or other benign error
