import json
import core.models as models
from pipeline.steps.base import BaseStep
from pipeline.engine import PipelineContext
from pipeline.orchestrator import build_market_constraint, run_judge

class JudgeConsensusStep(BaseStep):
    @property
    def name(self) -> str:
        return "consensus"

    def get_log_step(self) -> str:
        return "JUDGE"

    def execute(self, context: PipelineContext) -> None:
        db = context.db
        run_id = context.run_id
        
        proposals_data = context.shared_data.get("proposals_json")
        if not proposals_data:
            raise ValueError(f"Run {run_id} missing proposals")
            
        if isinstance(proposals_data, list):
            proposals_log = proposals_data
            fitness_map = {}
        else:
            proposals_log = proposals_data.get("proposals", [])
            fitness_map = proposals_data.get("fitness_map", {})

        shared_context = context.shared_data.get("context", "")

        budget_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "trading_budget").first()
        total_budget = float(budget_conf.value) if budget_conf else 10000.0
        open_strats = db.query(models.DeployedStrategy).filter(
            models.DeployedStrategy.status.in_(["ACTIVE", "PENDING"])
        ).all()
        allocated = sum(s.position_size or 0.0 for s in open_strats)
        available = total_budget - allocated
        open_positions_lines = "\\n".join(
            f"  • {s.strategy_type} {s.symbol} @ ${s.entry_price:.4f} | status: {s.status}"
            for s in open_strats
        ) if open_strats else "  (none)"
        budget_context = (
            f"## Portfolio Budget Context\\n"
            f"- Total budget: ${total_budget:,.2f}\\n"
            f"- Allocated to open positions: ${allocated:,.2f}\\n"
            f"- Available capital: ${available:,.2f}\\n"
            f"- Open positions (ACTIVE + PENDING — do NOT open a new trade for these tickers; use UPDATE_LONG/UPDATE_SHORT instead):\\n"
            f"{open_positions_lines}\\n"
            f"Only recommend a new trade if sufficient capital is available and the ticker has no existing open position."
        )

        market_constraint = build_market_constraint(context.enabled_markets)
        verdicts = run_judge(
            db, run_id, proposals_log, shared_context, budget_context, market_constraint,
            fitness_map=fitness_map
        )

        context.shared_data["verdicts"] = verdicts
        context.save_to_db()
