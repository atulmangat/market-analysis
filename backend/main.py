import os
import json
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

def _upsert_config(db, key: str, value: str):
    conf = db.query(models.AppConfig).filter(models.AppConfig.key == key).first()
    if conf:
        conf.value = value
    else:
        db.add(models.AppConfig(key=key, value=value))

scheduler = None

def _get_schedule_minutes(pipeline: str) -> int:
    from core.database import SessionLocal
    key_map = {
        "research": "schedule_research_minutes",
        "trade":    "schedule_trade_minutes",
        "eval":     "schedule_eval_minutes",
    }
    db = SessionLocal()
    conf = db.query(models.AppConfig).filter(models.AppConfig.key == key_map.get(pipeline, "schedule_trade_minutes")).first()
    db.close()
    default = 120 if pipeline == "eval" else 60
    return int(conf.value) if conf else default


def _run_research_scheduled():
    """APScheduler-called wrapper for the research pipeline."""
    import uuid as _uuid
    from core.database import SessionLocal
    db = SessionLocal()
    try:
        any_running = db.query(models.AppConfig).filter(
            models.AppConfig.key.in_(["research_running", "trade_running"]),
            models.AppConfig.value == "1",
        ).first()
        if any_running:
            db.close()
            return
        research_lock = db.query(models.AppConfig).filter(models.AppConfig.key == "research_running").first()
        if not research_lock:
            db.add(models.AppConfig(key="research_running", value="1"))
        else:
            research_lock.value = "1"
        run_id = str(_uuid.uuid4())
        db.add(models.PipelineRun(run_id=run_id, run_type="research", step="pending"))
        _upsert_config(db, "current_run_id_research", run_id)
        db.commit()
        db.close()
    except Exception:
        db.close()
        return
    from pipeline.runner import run_research_pipeline
    run_research_pipeline(run_id)


def _run_trade_scheduled():
    """APScheduler-called wrapper for the trade pipeline."""
    import uuid as _uuid
    from core.database import SessionLocal
    db = SessionLocal()
    try:
        any_running = db.query(models.AppConfig).filter(
            models.AppConfig.key.in_(["research_running", "trade_running"]),
            models.AppConfig.value == "1",
        ).first()
        if any_running:
            db.close()
            return
        trade_lock = db.query(models.AppConfig).filter(models.AppConfig.key == "trade_running").first()
        if not trade_lock:
            db.add(models.AppConfig(key="trade_running", value="1"))
        else:
            trade_lock.value = "1"
        run_id = str(_uuid.uuid4())
        db.add(models.PipelineRun(run_id=run_id, run_type="trade", step="pending"))
        _upsert_config(db, "current_run_id_trade", run_id)
        db.commit()
        db.close()
    except Exception:
        db.close()
        return
    from pipeline.runner import run_trade_pipeline
    run_trade_pipeline(run_id)


def _cleanup_stuck_runs():
    """On startup, mark any runs stuck in a non-terminal step as errored and release locks.
    Only marks runs that had no activity in the last 2 minutes — this avoids falsely failing
    runs that were interrupted by a uvicorn --reload during active development.
    """
    from core.database import SessionLocal
    from datetime import datetime, timedelta
    db = SessionLocal()
    try:
        TERMINAL_STEPS = {"done", "error"}
        # Only clean up runs that haven't had activity recently
        recent_threshold = datetime.utcnow() - timedelta(minutes=2)
        stuck = db.query(models.PipelineRun).filter(
            models.PipelineRun.step.notin_(TERMINAL_STEPS)
        ).all()
        actually_stuck = []
        for run in stuck:
            # Check when the last event was logged for this run
            last_evt = (
                db.query(models.PipelineEvent)
                .filter(models.PipelineEvent.run_id == run.run_id)
                .order_by(models.PipelineEvent.created_at.desc())
                .first()
            )
            if not last_evt or last_evt.created_at < recent_threshold:
                run.step = "error"
                actually_stuck.append(run.run_id[:8])
        # Release locks only for runs we actually marked as error
        for key in ["research_running", "trade_running", "eval_running"]:
            lock = db.query(models.AppConfig).filter(models.AppConfig.key == key).first()
            if lock and lock.value == "1":
                lock.value = "0"
        if actually_stuck:
            print(f"[Startup] Cleaned up {len(actually_stuck)} stuck pipeline run(s): {actually_stuck}")
        db.commit()
    except Exception as e:
        print(f"[Startup] Cleanup error (non-fatal): {e}")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global scheduler
    _cleanup_stuck_runs()
    if not VERCEL:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.interval import IntervalTrigger
        from pipeline.validator import evaluate_predictions

        r_mins = _get_schedule_minutes("research")
        t_mins = _get_schedule_minutes("trade")
        e_mins = _get_schedule_minutes("eval")
        print(f"[Scheduler] research={r_mins}m, trade={t_mins}m, eval={e_mins}m")
        scheduler = BackgroundScheduler()
        scheduler.add_job(_run_research_scheduled, 'interval', minutes=r_mins, id='research_job')
        scheduler.add_job(_run_trade_scheduled,    'interval', minutes=t_mins, id='trade_job')
        scheduler.add_job(evaluate_predictions,    'interval', minutes=e_mins, id='eval_job')
        scheduler.start()
    else:
        print("[Scheduler] Vercel mode — APScheduler disabled. Using cron endpoints.")
    yield
    if scheduler:
        scheduler.shutdown()

# Create database tables + run migrations
from core.database import ensure_tables
ensure_tables(engine)

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

@app.post("/api/cron/evaluate", dependencies=[Depends(_verify_cron)])
def cron_evaluate():
    """Vercel Cron endpoint: runs the prediction evaluator."""
    import threading as _threading
    from pipeline.validator import evaluate_predictions
    _threading.Thread(target=evaluate_predictions, daemon=False).start()
    return {"status": "triggered"}


@app.post("/api/system/sync_schedule")
def sync_schedule(db: Session = Depends(get_db)):
    """Sync APScheduler intervals with the database settings (no-op on Vercel)."""
    if VERCEL or scheduler is None:
        return {"status": "skipped", "reason": "APScheduler not running (Vercel mode)"}

    from apscheduler.triggers.interval import IntervalTrigger
    r_mins = _get_schedule_minutes("research")
    t_mins = _get_schedule_minutes("trade")
    e_mins = _get_schedule_minutes("eval")
    scheduler.reschedule_job('research_job', trigger=IntervalTrigger(minutes=r_mins))
    scheduler.reschedule_job('trade_job',    trigger=IntervalTrigger(minutes=t_mins))
    scheduler.reschedule_job('eval_job',     trigger=IntervalTrigger(minutes=e_mins))
    return {"status": "success", "research_minutes": r_mins, "trade_minutes": t_mins, "eval_minutes": e_mins}
