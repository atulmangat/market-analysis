import os
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from fastapi import FastAPI, BackgroundTasks, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from database import engine, Base, get_db
import models
import api
from apscheduler.schedulers.background import BackgroundScheduler
from contextlib import asynccontextmanager
from orchestrator import run_debate
from validator import evaluate_predictions
from apscheduler.triggers.interval import IntervalTrigger

# Setup Scheduler
scheduler = BackgroundScheduler()

def get_initial_interval():
    from database import SessionLocal
    db = SessionLocal()
    conf = db.query(models.AppConfig).filter(models.AppConfig.key == "schedule_interval_minutes").first()
    db.close()
    return int(conf.value) if conf else 60

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Retrieve initial schedule interval from DB
    interval = get_initial_interval()
    print(f"[Scheduler] Starting jobs with an interval of {interval} minutes.")
    
    # Start the scheduler on app startup
    scheduler.add_job(run_debate, 'interval', minutes=interval, id='debate_job')
    scheduler.add_job(evaluate_predictions, 'interval', minutes=interval, id='eval_job')
    scheduler.start()
    yield
    # Shutdown the scheduler on app teardown
    scheduler.shutdown()

# Create database tables
Base.metadata.create_all(bind=engine)

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

@app.post("/api/system/sync_schedule")
def sync_schedule(db: Session = Depends(get_db)):
    """Used to sync the APScheduler interval with the database setting."""
    conf = db.query(models.AppConfig).filter(models.AppConfig.key == "schedule_interval_minutes").first()
    new_interval = int(conf.value) if conf else 60
    
    print(f"[Scheduler] Rescheduling jobs to run every {new_interval} minutes.")
    scheduler.reschedule_job('debate_job', trigger=IntervalTrigger(minutes=new_interval))
    scheduler.reschedule_job('eval_job', trigger=IntervalTrigger(minutes=new_interval))
    
    return {"status": "success", "new_interval_minutes": new_interval}
