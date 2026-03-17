import os
import json
import threading
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session
from core.database import engine, Base, get_db
import core.models as models
import api.routes as api
from contextlib import asynccontextmanager

# On Vercel (serverless), skip APScheduler — cron endpoints handle scheduling instead.
# On Railway/local, use APScheduler for automatic background jobs.
VERCEL = os.getenv("VERCEL", "") == "1"

scheduler = None

def get_initial_interval():
    from core.database import SessionLocal
    db = SessionLocal()
    conf = db.query(models.AppConfig).filter(models.AppConfig.key == "schedule_interval_minutes").first()
    db.close()
    return int(conf.value) if conf else 60

@asynccontextmanager
async def lifespan(app: FastAPI):
    global scheduler
    if not VERCEL:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.interval import IntervalTrigger
        from pipeline.orchestrator import run_debate
        from pipeline.validator import evaluate_predictions

        interval = get_initial_interval()
        print(f"[Scheduler] Starting jobs with an interval of {interval} minutes.")
        scheduler = BackgroundScheduler()
        scheduler.add_job(run_debate, 'interval', minutes=interval, id='debate_job')
        scheduler.add_job(evaluate_predictions, 'interval', minutes=interval, id='eval_job')
        scheduler.start()
    else:
        print("[Scheduler] Vercel mode — APScheduler disabled. Using cron endpoints.")
    yield
    if scheduler:
        scheduler.shutdown()

# Create database tables + run migrations
Base.metadata.create_all(bind=engine)
from core.database import run_migrations
run_migrations(engine)

# Seed all agent prompts (core + specialists) — safe to run on every cold start
from pipeline.orchestrator import setup_agent_prompts
from core.database import SessionLocal as _SessionLocal
_db = _SessionLocal()
try:
    setup_agent_prompts(_db)
finally:
    _db.close()

app = FastAPI(title="AI Stock Market Suggestion API", lifespan=lifespan)

# Configure CORS — allow all origins in dev, restrict to FRONTEND_URL in prod
_frontend_url = os.getenv("FRONTEND_URL", "")
_cors_origins = [_frontend_url] if _frontend_url else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=r"https://.*\.vercel\.app" if not _frontend_url else None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api.router, prefix="/api")
app.include_router(api.protected, prefix="/api")

@app.get("/")
def read_root():
    return {"status": "ok", "message": "AI Stock Market Suggestion API is running"}


# ── Cron endpoints (called by Vercel Cron — protected by CRON_SECRET) ────────

from fastapi import Header, HTTPException

def _verify_cron(x_vercel_cron_signature: str = Header(default="")):
    """Allow Vercel cron calls (signed) or internal calls with CRON_SECRET header."""
    secret = os.getenv("CRON_SECRET", "")
    # Vercel sets this header automatically; for local testing pass it manually.
    if secret and x_vercel_cron_signature != secret:
        raise HTTPException(status_code=401, detail="Unauthorized")

@app.post("/api/cron/debate", dependencies=[Depends(_verify_cron)])
def cron_debate(focus_tickers: list[str] | None = None):
    """Kick off the lambda chain pipeline."""
    import uuid as _uuid
    from core.database import SessionLocal
    db = SessionLocal()
    try:
        # Concurrency lock
        lock = db.query(models.AppConfig).filter(models.AppConfig.key == "debate_running").first()
        if lock and lock.value == "1":
            db.close()
            return {"status": "already_running"}
        if not lock:
            db.add(models.AppConfig(key="debate_running", value="1"))
        else:
            lock.value = "1"

        run_id = str(_uuid.uuid4())
        # Load investment focus
        focus_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "investment_focus").first()
        investment_focus = focus_conf.value.strip() if focus_conf and focus_conf.value else ""

        run = models.PipelineRun(
            run_id=run_id,
            step="pending",
            investment_focus=investment_focus,
            focus_tickers=json.dumps(focus_tickers) if focus_tickers else None,
        )
        db.add(run)

        # Set current_run_id
        run_id_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "current_run_id").first()
        if run_id_conf:
            run_id_conf.value = run_id
        else:
            db.add(models.AppConfig(key="current_run_id", value=run_id))
        db.commit()
        db.close()
    except Exception as e:
        db.close()
        raise

    from pipeline.runner import run_full_pipeline
    run_full_pipeline(run_id)
    return {"status": "pipeline_started", "run_id": run_id}


@app.post("/api/cron/evaluate", dependencies=[Depends(_verify_cron)])
def cron_evaluate():
    """Vercel Cron endpoint: runs the prediction evaluator."""
    import threading
    from pipeline.validator import evaluate_predictions
    t = threading.Thread(target=evaluate_predictions, daemon=True)
    t.start()
    return {"status": "triggered"}


@app.post("/api/system/sync_schedule")
def sync_schedule(db: Session = Depends(get_db)):
    """Sync APScheduler interval with the database setting (no-op on Vercel)."""
    if VERCEL or scheduler is None:
        return {"status": "skipped", "reason": "APScheduler not running (Vercel mode)"}

    from apscheduler.triggers.interval import IntervalTrigger
    conf = db.query(models.AppConfig).filter(models.AppConfig.key == "schedule_interval_minutes").first()
    new_interval = int(conf.value) if conf else 60
    print(f"[Scheduler] Rescheduling jobs to run every {new_interval} minutes.")
    scheduler.reschedule_job('debate_job', trigger=IntervalTrigger(minutes=new_interval))
    scheduler.reschedule_job('eval_job', trigger=IntervalTrigger(minutes=new_interval))
    return {"status": "success", "new_interval_minutes": new_interval}
