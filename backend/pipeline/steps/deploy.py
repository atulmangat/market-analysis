import json
from datetime import datetime
import core.models as models
from pipeline.steps.base import BaseStep
from pipeline.engine import PipelineContext
from pipeline.orchestrator import _log
from data.market import fetch_market_data
from agents.memory import write_agent_memory, prune_old_memory

class DeployStep(BaseStep):
    @property
    def name(self) -> str:
        return "deploy"

    def get_log_step(self) -> str:
        return "DEPLOY"

    def execute(self, context: PipelineContext) -> None:
        db = context.db
        run_id = context.run_id
        
        proposals_data = context.shared_data.get("proposals_json", {})
        proposals_log = proposals_data.get("proposals", []) if isinstance(proposals_data, dict) else proposals_data
        
        verdicts = context.shared_data.get("verdicts", [])
        if not verdicts:
            raise ValueError(f"Run {run_id} missing verdicts")
            
        enabled_markets = context.enabled_markets
        research_log = context.shared_data.get("research_log", [])

        approval_conf = db.query(models.AppConfig).filter(models.AppConfig.key == "approval_mode").first()
        approval_mode = approval_conf.value if approval_conf else "auto"
        initial_status = "ACTIVE" if approval_mode == "auto" else "PENDING"

        # Pre-clean: close any existing duplicates (same ticker, multiple open positions)
        # so that per-verdict dedup logic below always sees at most 1 open position per ticker.
        all_open_pre = (
            db.query(models.DeployedStrategy)
            .filter(models.DeployedStrategy.status.in_(["ACTIVE", "PENDING"]))
            .order_by(models.DeployedStrategy.symbol, models.DeployedStrategy.id.desc())
            .all()
        )
        seen_pre: dict[str, int] = {}
        for s in all_open_pre:
            if s.symbol not in seen_pre:
                seen_pre[s.symbol] = s.id
            else:
                s.status = "CLOSED"
                s.close_reason = "Superseded by newer strategy for same ticker"
                s.closed_at = datetime.utcnow()
        db.commit()

        deployed_strategies = []
        for verdict in verdicts:
            best_ticker = verdict["ticker"]
            raw_action  = verdict["action"].upper()
            is_update   = raw_action.startswith("UPDATE_")
            best_action = raw_action.replace("UPDATE_", "")
            judge_reasoning = verdict["reasoning"]

            signal = fetch_market_data(best_ticker)
            current_price = signal.price if signal else None

            if not current_price or current_price <= 0:
                _log(db, run_id, self.get_log_step(), "IN_PROGRESS",
                     f"Skipping {best_ticker}: price fetch returned None — will not deploy with $0 entry")
                # Still close any existing stale/zero-price open positions for this ticker
                stale_open = (
                    db.query(models.DeployedStrategy)
                    .filter(
                        models.DeployedStrategy.symbol == best_ticker,
                        models.DeployedStrategy.status.in_(["ACTIVE", "PENDING"]),
                    )
                    .all()
                )
                for stale in stale_open:
                    stale.status = "CLOSED"
                    stale.close_reason = "Superseded — price unavailable at re-evaluation"
                    stale.closed_at = datetime.utcnow()
                if stale_open:
                    db.commit()
                continue

            agreeing = sum(1 for p in proposals_log
                           if p["ticker"] == best_ticker
                           and p.get("action", "").replace("UPDATE_", "") == best_action)
            votes_str = f"{agreeing}/{len(proposals_log) if proposals_log else 1}"

            all_open = (
                db.query(models.DeployedStrategy)
                .filter(
                    models.DeployedStrategy.symbol == best_ticker,
                    models.DeployedStrategy.status.in_(["ACTIVE", "PENDING"]),
                )
                .order_by(models.DeployedStrategy.id.desc())
                .all()
            )
            existing = all_open[0] if all_open else None
            # Close older duplicates
            for dup in all_open[1:]:
                dup.status = "CLOSED"
                dup.close_reason = "Superseded by newer strategy for same ticker"
                dup.closed_at = datetime.utcnow()
                
            if existing:
                action_changed = existing.strategy_type != best_action
                bad_entry = not existing.entry_price or existing.entry_price == 0.0
                entry_price = existing.entry_price if (not action_changed and not bad_entry) else current_price
                summary_text = (
                    f"{'Direction reversed to ' + best_action if action_changed else 'Updated'} "
                    f"{best_ticker} @ ${entry_price:.4f} (current: ${current_price:.4f}). "
                    f"{votes_str} agents agreed. Rationale: {judge_reasoning[:200]}"
                )
                existing.strategy_type     = best_action
                existing.reasoning_summary = summary_text
                existing.status            = initial_status
                existing.notes = (
                    f"{'Direction reversed to ' + best_action + ' — ' if action_changed else 'Reaffirmed — '}"
                    f"{votes_str} agents agreed. Thesis updated by judge."
                )
                if action_changed or bad_entry:
                    existing.entry_price   = current_price
                    existing.exit_price    = None
                    existing.close_reason  = None
                    existing.closed_at     = None
                strategy = existing
            else:
                entry_price  = current_price
                summary_text = (
                    f"Judge selected {best_action} {best_ticker} at ${entry_price:.4f}. "
                    f"{votes_str} agents agreed. "
                    f"Rationale: {judge_reasoning[:200]}"
                )
                strategy = models.DeployedStrategy(
                    symbol=best_ticker,
                    strategy_type=best_action,
                    entry_price=entry_price,
                    reasoning_summary=summary_text,
                    status=initial_status,
                )
                db.add(strategy)
            deployed_strategies.append((strategy, best_ticker, best_action, judge_reasoning, entry_price, votes_str))

        if not deployed_strategies:
            raise ValueError(f"Run {run_id}: all verdicts skipped (price fetch failed for all tickers)")

        primary = verdicts[0] if verdicts else {"ticker": "HOLD", "action": "HOLD", "reasoning": ""}
        first_ticker = primary["ticker"]
        first_action = primary["action"]
        first_agreeing = sum(1 for p in proposals_log if p["ticker"] == first_ticker and p.get("action") == first_action)
        first_votes = f"{first_agreeing}/{len(proposals_log) if proposals_log else 1}"

        debate_round = models.DebateRound(
            consensus_ticker=first_ticker,
            consensus_action=first_action,
            consensus_votes=first_votes,
            proposals_json=json.dumps(proposals_log),
            enabled_markets=", ".join(enabled_markets.keys()),
            research_context=json.dumps(research_log),
            judge_reasoning=json.dumps(verdicts),
        )
        db.add(debate_round)
        db.commit()
        db.refresh(debate_round)

        for (strategy, *_) in deployed_strategies:
            strategy.debate_round_id = debate_round.id
        db.commit()

        positions_summary = " | ".join(f"{a} {t}" for (_, t, a, *_) in deployed_strategies)
        _log(db, run_id, self.get_log_step(), "DONE",
             f"{len(deployed_strategies)} position(s) saved (status={initial_status}): {positions_summary} — Debate round #{debate_round.id}")

        # Memory Write
        _log(db, run_id, "MEMORY_WRITE", "IN_PROGRESS", f"Writing memory notes for {len(proposals_log)} agents…")
        deployed_set = {(t, a) for (_, t, a, *_) in deployed_strategies}
        for proposal in proposals_log:
            agent_name = proposal["agent_name"]
            prop_key = (proposal["ticker"], proposal.get("action", ""))
            if prop_key in deployed_set:
                ep = next((ep for (_, t, a, _, ep, _) in deployed_strategies if t == proposal["ticker"] and a == proposal.get("action")), 0.0)
                note = (
                    f"Round {debate_round.id}: Your {proposal.get('action')} {proposal['ticker']} call was selected "
                    f"at ${ep:.4f}. Watch this position — you'll get a P&L update when it closes."
                )
                note_type = "INSIGHT"
            else:
                deployed_str = ", ".join(f"{a} {t}" for (_, t, a, *_) in deployed_strategies)
                note = (
                    f"Round {debate_round.id}: You proposed {proposal.get('action')} {proposal['ticker']} but judge "
                    f"deployed: {deployed_str}. Track how these positions perform vs your pick."
                )
                note_type = "OBSERVATION"
            write_agent_memory(db, agent_name, note_type, note, debate_round.id)
            prune_old_memory(db, agent_name, keep=200)

        db.commit()

        try:
            from api.routes import _build_chart, _build_fundamentals
            tickers_to_report = [(t, ep) for (_, t, _, _, ep, _) in deployed_strategies]
            _log(db, run_id, "MEMORY_WRITE", "IN_PROGRESS",
                 f"Generating reports for {', '.join(t for t, _ in tickers_to_report)}…")
            # Build per-ticker reports; primary ticker uses "chart"/"fundamentals" keys for
            # backward compat, additional tickers stored under "charts"/"fundamentals_map".
            charts_map = {}
            fundamentals_map = {}
            for ticker, ep in tickers_to_report:
                charts_map[ticker] = _build_chart(ticker, ep, debate_round.timestamp)
                fundamentals_map[ticker] = _build_fundamentals(ticker)
            first_ep = next((ep for t, ep in tickers_to_report if t == first_ticker), 0.0)
            report = {
                "chart":            charts_map.get(first_ticker),
                "fundamentals":     fundamentals_map.get(first_ticker),
                "charts_map":       charts_map,
                "fundamentals_map": fundamentals_map,
            }
            debate_round.report_json = json.dumps(report)
            db.commit()
        except Exception as re_err:
            print(f"[DeployStep] Report generation failed (non-fatal): {re_err}")

        _log(db, run_id, "MEMORY_WRITE", "DONE", "Pipeline deploy step memory write complete")
