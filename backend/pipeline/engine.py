import os
from sqlalchemy.orm import Session
from datetime import datetime
import json
import core.models as models

class PipelineContext:
    def __init__(self, run_id: str, db: Session, shared_data: dict = None):
        self.run_id = run_id
        self.db = db
        self.shared_data = shared_data or {}
        self.enabled_markets = {}
        self.focus_tickers = None
        self.investment_focus = ""
        self.lessons: list[str] = []  # intra-run lesson layer (not persisted)

        self._load_from_db()

    def _load_from_db(self):
        run = self.db.query(models.PipelineRun).filter(models.PipelineRun.run_id == self.run_id).first()
        if run:
            if run.shared_context:
                try:
                    self.shared_data = json.loads(run.shared_context)
                except json.JSONDecodeError:
                    pass
            if run.enabled_markets_json:
                try:
                    self.enabled_markets = json.loads(run.enabled_markets_json)
                except json.JSONDecodeError:
                    pass
            if run.focus_tickers:
                try:
                    self.focus_tickers = json.loads(run.focus_tickers)
                except json.JSONDecodeError:
                    pass
            self.investment_focus = run.investment_focus or ""

    def save_to_db(self):
        run = self.db.query(models.PipelineRun).filter(models.PipelineRun.run_id == self.run_id).first()
        if run:
            run.shared_context = json.dumps(self.shared_data)
            run.enabled_markets_json = json.dumps(self.enabled_markets)
            if self.focus_tickers is not None:
                run.focus_tickers = json.dumps(self.focus_tickers)
            run.investment_focus = self.investment_focus
            self.db.commit()

def log_event(db: Session, run_id: str, step: str, status: str, detail: str = None, agent_name: str = None):
    run = db.query(models.PipelineRun).filter(models.PipelineRun.run_id == run_id).first()
    run_type = getattr(run, "run_type", "debate") if run else "debate"
    print(f"[{run_id}] {step} ({status}) - {detail}")
    evt = models.PipelineEvent(
        run_id=run_id,
        run_type=run_type,
        step=step,
        agent_name=agent_name,
        status=status,
        detail=detail,
    )
    db.add(evt)
    db.commit()

class PipelineEngine:
    def __init__(self, db: Session, run_id: str, lock_key: str):
        self.db = db
        self.run_id = run_id
        self.lock_key = lock_key
        self.steps = []

    def set_steps(self, steps: list):
        self.steps = steps

    def get_run(self) -> models.PipelineRun | None:
        return self.db.query(models.PipelineRun).filter(models.PipelineRun.run_id == self.run_id).first()

    def _acquire_lock(self):
        conf = self.db.query(models.AppConfig).filter(models.AppConfig.key == self.lock_key).first()
        if conf:
            conf.value = "1"
        else:
            self.db.add(models.AppConfig(key=self.lock_key, value="1"))
        self.db.commit()

    def _release_lock(self):
        conf = self.db.query(models.AppConfig).filter(models.AppConfig.key == self.lock_key).first()
        if conf:
            conf.value = "0"
            self.db.commit()

    def run(self):
        run_record = self.get_run()
        if not run_record:
            print(f"[PipelineEngine] Run ID {self.run_id} not found.")
            return

        # Skip if already in terminal state
        if run_record.step in ("done", "error"):
            print(f"[PipelineEngine] Run {self.run_id} already in terminal state {run_record.step}. Skipping.")
            return

        self._acquire_lock()
        context = PipelineContext(self.run_id, self.db)
        final_step = "error"  # default; overwritten on success

        # Track whether we've encountered a step where we should start/resume.
        current_db_step = run_record.step
        # If DB says "pending", we execute all. If DB says "agents", we execute the step defined as "agents" and subsequent.
        resume_found = False
        if current_db_step == "pending":
            resume_found = True

        last_error_msg: str | None = None
        last_error_step: str | None = None
        try:
            for step in self.steps:
                if not resume_found:
                    if step.name == current_db_step:
                        resume_found = True
                    else:
                        print(f"[PipelineEngine] Skipping step {step.name} (resuming from {current_db_step})")
                        continue

                # Execute step
                run_record.step = step.name
                self.db.commit()
                log_event(self.db, self.run_id, step.get_log_step(), "IN_PROGRESS", f"Starting {step.name} step")

                try:
                    step.execute(context)
                    log_event(self.db, self.run_id, step.get_log_step(), "DONE", f"Finished {step.name} step")
                except Exception as e:
                    import traceback
                    err_detail = f"Error in {step.name}: {str(e)[:300]}"
                    last_error_msg = err_detail
                    last_error_step = step.get_log_step()
                    print(f"Pipeline error in {step.name}: {traceback.format_exc()}")
                    # Try to log the error — if DB session is poisoned, use a fresh one
                    try:
                        self.db.rollback()
                        log_event(self.db, self.run_id, step.get_log_step(), "ERROR", err_detail)
                    except Exception:
                        from core.database import SessionLocal as _SL2
                        _db3 = _SL2()
                        try:
                            log_event(_db3, self.run_id, step.get_log_step(), "ERROR", err_detail)
                            _db3.commit()
                        except Exception:
                            pass
                        finally:
                            _db3.close()
                    raise e

            # If all steps succeed
            final_step = "done"
        except Exception as err:
            final_step = "error"
        finally:
            # Use a brand-new DB connection to guarantee final step + lock release
            # are persisted even if self.db session was poisoned by a rollback inside a step.
            from core.database import SessionLocal as _SL
            _db2 = _SL()
            try:
                _db2.execute(
                    models.PipelineRun.__table__.update()
                    .where(models.PipelineRun.__table__.c.run_id == self.run_id)
                    .values(step=final_step)
                )
                lock_conf = _db2.query(models.AppConfig).filter(models.AppConfig.key == self.lock_key).first()
                if lock_conf:
                    lock_conf.value = "0"
                # If run failed, ensure there's at least one ERROR event visible in the UI
                if final_step == "error":
                    has_error_evt = _db2.query(models.PipelineEvent).filter(
                        models.PipelineEvent.run_id == self.run_id,
                        models.PipelineEvent.status == "ERROR"
                    ).first()
                    if not has_error_evt:
                        msg = last_error_msg or "Pipeline terminated unexpectedly"
                        step_name = last_error_step or "PIPELINE"
                        _db2.add(models.PipelineEvent(
                            run_id=self.run_id,
                            step=step_name,
                            status="ERROR",
                            detail=msg,
                        ))
                _db2.commit()
            except Exception as _fe:
                print(f"[PipelineEngine] WARNING: failed to write final step '{final_step}': {_fe}")
            finally:
                _db2.close()
            # Also attempt release on original session as fallback
            try:
                self._release_lock()
            except Exception:
                pass
            
            # Invalidate cache for new runs
            from core.cache import cache_invalidate_prefix
            cache_invalidate_prefix("pipeline_runs_")
