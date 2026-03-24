"""
Pipeline execution module using the new dynamic PipelineEngine.
"""
import os
import json
from core.database import SessionLocal, engine, ensure_tables
import core.models as models

ensure_tables(engine)

from pipeline.engine import PipelineEngine, PipelineContext
from pipeline.steps.research import WebResearchStep
from pipeline.steps.agents import AgentDebateStep
from pipeline.steps.consensus import JudgeConsensusStep
from pipeline.steps.deploy import DeployStep
from pipeline.orchestrator import _log

def _get_base_url() -> str:
    vercel_url = os.getenv("VERCEL_URL", "")
    if vercel_url:
        return f"https://{vercel_url}"
    return "http://localhost:8000"

def _tag_run_events(run_id: str, run_type: str):
    db = SessionLocal()
    try:
        db.query(models.PipelineEvent).filter(
            models.PipelineEvent.run_id == run_id
        ).update({"run_type": run_type})
        db.query(models.PipelineRun).filter(
            models.PipelineRun.run_id == run_id
        ).update({"run_type": run_type})
        db.commit()
    finally:
        db.close()

def _get_run(db, run_id: str) -> models.PipelineRun | None:
    return db.query(models.PipelineRun).filter(models.PipelineRun.run_id == run_id).first()

def _lock_key_for_run(run: models.PipelineRun | None) -> str:
    run_type = getattr(run, "run_type", None) or "debate"
    return {"research": "research_running", "trade": "trade_running", "eval": "eval_running"}.get(run_type, "trade_running")

def _release_lock(db, lock_key: str):
    conf = db.query(models.AppConfig).filter(models.AppConfig.key == lock_key).first()
    if conf:
        conf.value = "0"

def run_research_pipeline(run_id: str):
    db = SessionLocal()
    try:
        run = _get_run(db, run_id)
        if not run: return
        lock_key = _lock_key_for_run(run)
        
        engine = PipelineEngine(db, run_id, lock_key)
        engine.set_steps([WebResearchStep()])
        engine.run()
        
        # Save research context to AppConfig for trade pipeline
        run_record = engine.get_run()
        if run_record and run_record.shared_context and run_record.step == "done":
            for key, val in [
                ("last_research_context", run_record.shared_context),
                ("last_research_markets", run_record.enabled_markets_json or "{}"),
                ("last_research_run_id",  run_id),
            ]:
                conf = db.query(models.AppConfig).filter(models.AppConfig.key == key).first()
                if conf:
                    conf.value = val
                else:
                    db.add(models.AppConfig(key=key, value=val))
            db.commit()
            
    finally:
        db.close()
    _tag_run_events(run_id, "research")

class LoadResearchContextStep(WebResearchStep):
    @property
    def name(self) -> str:
        return "load_research"
    def get_log_step(self) -> str:
        return "START"
    def execute(self, context: PipelineContext) -> None:
        db = context.db
        run_id = context.run_id

        _log(db, run_id, "START", "IN_PROGRESS", "Loading research context…")

        ctx_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "last_research_context").first()
        markets_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "last_research_markets").first()

        if not ctx_conf or not ctx_conf.value:
            raise ValueError("No research context available — run the Research pipeline first.")

        # Inject context directly
        context.shared_data = json.loads(ctx_conf.value)

        # Handle focus tickers
        if context.focus_tickers:
            context.enabled_markets = {"Focused": context.focus_tickers}
        else:
            context.enabled_markets = json.loads(markets_conf.value) if markets_conf else {}

        context.save_to_db()
        _log(db, run_id, "START", "DONE", "Research context loaded — ready for debate")

def run_trade_pipeline(run_id: str):
    db = SessionLocal()
    try:
        run = _get_run(db, run_id)
        if not run: return
        lock_key = _lock_key_for_run(run)
        
        engine = PipelineEngine(db, run_id, lock_key)
        engine.set_steps([
            LoadResearchContextStep(),
            AgentDebateStep(),
            JudgeConsensusStep(),
            DeployStep()
        ])
        engine.run()
        
    finally:
        db.close()
    _tag_run_events(run_id, "trade")

def resume_pipeline(run_id: str):
    db = SessionLocal()
    try:
        run = _get_run(db, run_id)
        if not run:
            print(f"[resume_pipeline] run_id {run_id} not found")
            return
        run_type = getattr(run, "run_type", "debate") or "debate"
    finally:
        db.close()

    print(f"[resume_pipeline] Resuming run {run_id} (type={run_type})")

    if run_type == "research":
        run_research_pipeline(run_id)
    else:
        run_trade_pipeline(run_id)


# ── Subprocess launcher (reload-safe) ─────────────────────────────────────────

def _subprocess_target(fn_name: str, run_id: str):
    """Entry point for multiprocessing.Process — runs in a fresh interpreter."""
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    fn_map = {
        "research": run_research_pipeline,
        "trade":    run_trade_pipeline,
        "resume":   resume_pipeline,
    }
    fn_map[fn_name](run_id)


def spawn_pipeline(pipeline_type: str, run_id: str):
    """
    Spawn the pipeline in a completely separate OS process.
    Safe against uvicorn --reload which only kills the worker thread/process.
    """
    import multiprocessing
    p = multiprocessing.Process(
        target=_subprocess_target,
        args=(pipeline_type, run_id),
        daemon=False,
    )
    p.start()
    return p
