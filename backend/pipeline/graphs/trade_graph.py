"""
LangGraph trade pipeline graph.

Topology:
  load_context → prepare_agents → [node_agent × N in parallel] → consensus → deploy → END
       ↓ (error)                                                    ↓ (error)
      error → END                                                  error → END

The fan-out uses LangGraph's Send API: `prepare_agents` populates `_agents_to_run`
in state, then the `route_to_agents` conditional-edge function reads it and returns
a list[Send], each targeting `node_agent`.
"""
import json
from langgraph.graph import StateGraph, END
from langgraph.types import Send

from core.database import SessionLocal
import core.models as models
from pipeline.graphs.state import TradeState
from pipeline.orchestrator import (
    _log,
    build_market_constraint,
    run_judge,
    _dispatch_agents,
    _query_single_agent,
    _build_portfolio_context,
    _get_interesting_stocks_from_graph,
)
from data.market import fetch_market_data
from agents.memory import write_agent_memory, prune_old_memory


# ── Nodes ─────────────────────────────────────────────────────────────────────

def node_load_context(state: TradeState) -> dict:
    """Load research context from AppConfig (for trade-only runs)."""
    run_id = state["run_id"]

    # If shared_context already populated (full pipeline), skip AppConfig lookup
    if state.get("shared_context"):
        return {}

    db = SessionLocal()
    try:
        ctx_conf = db.query(models.AppConfig).filter(
            models.AppConfig.key == "last_research_context"
        ).first()
        markets_conf = db.query(models.AppConfig).filter(
            models.AppConfig.key == "last_research_markets"
        ).first()

        if not ctx_conf or not ctx_conf.value:
            _log(db, run_id, "AGENT_QUERY", "ERROR",
                 "No research context available — run the Research pipeline first.")
            return {"error": "No research context available"}

        enabled_markets = json.loads(markets_conf.value) if markets_conf and markets_conf.value else {}

        run = db.query(models.PipelineRun).filter(
            models.PipelineRun.run_id == run_id
        ).first()
        if run:
            run.shared_context = json.dumps({"context": ctx_conf.value, "research_log": []})
            run.enabled_markets_json = json.dumps(enabled_markets)
            db.commit()

        _log(db, run_id, "AGENT_QUERY", "IN_PROGRESS", "Research context loaded — starting agents")
        return {
            "shared_context": ctx_conf.value,
            "enabled_markets": enabled_markets,
        }
    except Exception as e:
        try:
            _log(db, run_id, "AGENT_QUERY", "ERROR", str(e)[:300])
        except Exception:
            pass
        return {"error": str(e)}
    finally:
        db.close()


def node_prepare_agents(state: TradeState) -> dict:
    """
    Dispatcher node: select agents, build shared context elements, and store
    the agent list in state. The conditional edge `route_to_agents` will then
    read `_agents_to_run` and fan out via Send.
    """
    run_id = state["run_id"]
    shared_context = state["shared_context"]
    enabled_markets = state["enabled_markets"]
    db = SessionLocal()
    try:
        market_constraint = build_market_constraint(enabled_markets)
        agent_prompts = db.query(models.AgentPrompt).all()

        _log(db, run_id, "DEBATE_PANEL", "IN_PROGRESS", "Dispatcher: selecting agents for this session…")
        selected_names = _dispatch_agents(run_id, shared_context, market_constraint, agent_prompts)
        _log(db, run_id, "DEBATE_PANEL", "IN_PROGRESS",
             f"Dispatcher selected {len(selected_names)} agents: {', '.join(selected_names)}")

        portfolio_context = _build_portfolio_context(db)

        interesting_symbols, interesting_summary = _get_interesting_stocks_from_graph(db)
        from graph.knowledge import build_kg_context_for_ticker
        kg_parts = []
        if interesting_summary:
            kg_parts.append(interesting_summary)
        for sym in interesting_symbols[:6]:
            subgraph_ctx = build_kg_context_for_ticker(db, sym)
            if subgraph_ctx:
                kg_parts.append(subgraph_ctx)
        kg_context = "\n\n".join(kg_parts) if kg_parts else ""
        if kg_context:
            _log(db, run_id, "DEBATE_PANEL", "IN_PROGRESS",
                 f"KG context built for {len(interesting_symbols)} assets — passing to agents")

        from pipeline.validator import _compute_fitness as _cv_fitness
        fitness_map = {}
        for ap in agent_prompts:
            if ap.agent_name in selected_names:
                try:
                    fitness_map[ap.agent_name] = _cv_fitness(db, ap.agent_name)
                except Exception:
                    pass

        agents_to_run = [
            {
                "name":               ap.agent_name,
                "prompt":             ap.system_prompt,
                "market_constraint":  market_constraint,
                "portfolio_context":  portfolio_context,
                "kg_context":         kg_context,
            }
            for ap in agent_prompts
            if ap.agent_name in selected_names
        ]

        return {"fitness_map": fitness_map, "_agents_to_run": agents_to_run}
    except Exception as e:
        try:
            _log(db, run_id, "DEBATE_PANEL", "ERROR", str(e)[:300])
        except Exception:
            pass
        return {"error": str(e), "_agents_to_run": []}
    finally:
        db.close()


def node_agent(state: TradeState) -> dict:
    """
    Single agent node — invoked in parallel for each agent via Send.
    The Send carries extra keys (_name, _prompt, etc.) on the state snapshot.
    Returns a one-element proposals list; operator.add reducer merges all branches.
    """
    run_id            = state["run_id"]
    agent_name        = state["_name"]
    agent_prompt      = state["_prompt"]
    shared_context    = state["shared_context"]
    market_constraint = state["_market_constraint"]
    investment_focus  = state.get("investment_focus", "")
    portfolio_context = state.get("_portfolio_context", "")
    kg_context        = state.get("_kg_context", "")
    fitness_map       = state.get("fitness_map", {})

    result = _query_single_agent(
        agent_name, agent_prompt, run_id, shared_context,
        market_constraint, investment_focus, portfolio_context,
        kg_context, fitness_map,
    )
    return {"proposals": [result] if result else []}


def node_consensus(state: TradeState) -> dict:
    """Run the judge LLM over all proposals."""
    run_id = state["run_id"]
    proposals = state.get("proposals", [])
    shared_context = state["shared_context"]
    enabled_markets = state["enabled_markets"]
    db = SessionLocal()
    try:
        if not proposals:
            _log(db, run_id, "DEBATE_PANEL", "ERROR", "No proposals from any agent — aborting")
            return {"error": "No proposals"}

        _log(db, run_id, "DEBATE_PANEL", "DONE",
             f"{len(proposals)} proposals received — running judge")

        budget_conf = db.query(models.AppConfig).filter(
            models.AppConfig.key == "trading_budget"
        ).first()
        total_budget = float(budget_conf.value) if budget_conf else 10000.0
        active_strats = db.query(models.DeployedStrategy).filter(
            models.DeployedStrategy.status == "ACTIVE"
        ).all()
        allocated = sum(s.position_size or 0.0 for s in active_strats)
        available = total_budget - allocated
        open_positions = ", ".join(
            f"{s.strategy_type} {s.symbol}" for s in active_strats
        ) or "none"
        budget_context = (
            f"## Portfolio Budget Context\n"
            f"- Total budget: ${total_budget:,.2f}\n"
            f"- Allocated to open positions: ${allocated:,.2f}\n"
            f"- Available capital: ${available:,.2f}\n"
            f"- Open positions: {open_positions}\n"
            f"Only recommend a new trade if sufficient capital is available."
        )

        market_constraint = build_market_constraint(enabled_markets)
        fitness_map = state.get("fitness_map", {})

        verdicts = run_judge(
            db, run_id, proposals, shared_context,
            budget_context, market_constraint, fitness_map=fitness_map,
        )

        run = db.query(models.PipelineRun).filter(
            models.PipelineRun.run_id == run_id
        ).first()
        if run:
            run.proposals_json = json.dumps({"proposals": proposals, "verdicts": verdicts})
            run.step = "deploy"
            db.commit()

        summary = " | ".join(f"{v['action']} {v['ticker']}" for v in verdicts)
        _log(db, run_id, "JUDGE", "DONE",
             f"{len(verdicts)} position(s): {summary} — deploy step next")
        return {"verdicts": verdicts}
    except Exception as e:
        try:
            _log(db, run_id, "JUDGE", "ERROR", str(e)[:300])
        except Exception:
            pass
        return {"error": str(e)}
    finally:
        db.close()


def node_deploy(state: TradeState) -> dict:
    """Deploy strategies and write agent memories."""
    run_id = state["run_id"]
    proposals = state.get("proposals", [])
    verdicts = state.get("verdicts", [])
    enabled_markets = state["enabled_markets"]
    research_log = state.get("research_log", [])
    db = SessionLocal()
    try:
        _log(db, run_id, "DEPLOY", "IN_PROGRESS", "Deploying strategies…")

        approval_conf = db.query(models.AppConfig).filter(
            models.AppConfig.key == "approval_mode"
        ).first()
        approval_mode = approval_conf.value if approval_conf else "auto"
        initial_status = "ACTIVE" if approval_mode == "auto" else "PENDING"

        deployed_strategies = []
        for verdict in verdicts:
            best_ticker   = verdict["ticker"]
            best_action   = verdict["action"]
            judge_reasoning = verdict["reasoning"]

            signal = fetch_market_data(best_ticker)
            entry_price = signal.price if signal else 0.0

            agreeing = sum(
                1 for p in proposals
                if p["ticker"] == best_ticker and p["action"] == best_action
            )
            votes_str = f"{agreeing}/{len(proposals)}"
            summary_text = (
                f"Judge selected {best_action} {best_ticker} at ${entry_price:.4f}. "
                f"{agreeing}/{len(proposals)} agents agreed. "
                f"Rationale: {judge_reasoning[:200]}"
            )

            existing = (
                db.query(models.DeployedStrategy)
                .filter(
                    models.DeployedStrategy.symbol == best_ticker,
                    models.DeployedStrategy.status.in_(["ACTIVE", "PENDING"]),
                )
                .order_by(models.DeployedStrategy.id.desc())
                .first()
            )
            if existing:
                action_changed = existing.strategy_type != best_action
                existing.strategy_type     = best_action
                existing.entry_price       = entry_price
                existing.reasoning_summary = summary_text
                existing.status            = initial_status
                existing.notes = (
                    f"{'Direction reversed to ' + best_action + ' — ' if action_changed else 'Reaffirmed '}"
                    f"{votes_str} agents agreed."
                )
                existing.exit_price   = None
                existing.close_reason = None
                existing.closed_at    = None
                strategy = existing
            else:
                strategy = models.DeployedStrategy(
                    symbol=best_ticker,
                    strategy_type=best_action,
                    entry_price=entry_price,
                    reasoning_summary=summary_text,
                    status=initial_status,
                )
                db.add(strategy)
            deployed_strategies.append(
                (strategy, best_ticker, best_action, judge_reasoning, entry_price, votes_str)
            )

        primary = verdicts[0] if verdicts else {"ticker": "HOLD", "action": "HOLD", "reasoning": ""}
        first_ticker = primary["ticker"]
        first_action = primary["action"]
        first_agreeing = sum(
            1 for p in proposals
            if p["ticker"] == first_ticker and p["action"] == first_action
        )

        debate_round = models.DebateRound(
            consensus_ticker=first_ticker,
            consensus_action=first_action,
            consensus_votes=f"{first_agreeing}/{len(proposals)}",
            proposals_json=json.dumps(proposals),
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
        _log(db, run_id, "DEPLOY", "DONE",
             f"{len(deployed_strategies)} position(s) saved (status={initial_status}): "
             f"{positions_summary} — Debate round #{debate_round.id}")

        _log(db, run_id, "MEMORY_WRITE", "IN_PROGRESS",
             f"Writing memory notes for {len(proposals)} agents…")
        deployed_set = {(t, a) for (_, t, a, *_) in deployed_strategies}
        for proposal in proposals:
            agent_name = proposal["agent_name"]
            prop_key = (proposal["ticker"], proposal["action"])
            if prop_key in deployed_set:
                ep = next(
                    (ep for (_, t, a, _, ep, _) in deployed_strategies
                     if t == proposal["ticker"] and a == proposal["action"]),
                    0.0,
                )
                note = (
                    f"Round {debate_round.id}: Your {proposal['action']} {proposal['ticker']} call was selected "
                    f"at ${ep:.4f}. Watch this position — you'll get a P&L update when it closes."
                )
                note_type = "INSIGHT"
            else:
                deployed_str = ", ".join(f"{a} {t}" for (_, t, a, *_) in deployed_strategies)
                note = (
                    f"Round {debate_round.id}: You proposed {proposal['action']} {proposal['ticker']} but judge "
                    f"deployed: {deployed_str}. Track how these positions perform vs your pick."
                )
                note_type = "OBSERVATION"
            write_agent_memory(db, agent_name, note_type, note, debate_round.id)
            prune_old_memory(db, agent_name, keep=200)

        db.commit()

        try:
            from api.routes import _build_chart, _build_fundamentals
            _log(db, run_id, "MEMORY_WRITE", "IN_PROGRESS",
                 f"Generating report for {first_ticker}…")
            first_ep = next(
                (ep for (_, t, _, _, ep, _) in deployed_strategies if t == first_ticker),
                0.0,
            )
            report = {
                "chart":        _build_chart(first_ticker, first_ep, debate_round.timestamp),
                "fundamentals": _build_fundamentals(first_ticker),
            }
            debate_round.report_json = json.dumps(report)
            db.commit()
        except Exception as re_err:
            print(f"[node_deploy] Report generation failed (non-fatal): {re_err}")

        run = db.query(models.PipelineRun).filter(
            models.PipelineRun.run_id == run_id
        ).first()
        if run:
            _release_lock(db, "trade_running")
            run.step = "done"
        db.commit()
        _log(db, run_id, "MEMORY_WRITE", "DONE", "Pipeline complete")

        from core.cache import cache_invalidate
        cache_invalidate("pipeline_runs")
        return {}
    except Exception as e:
        try:
            _log(db, run_id, "DEPLOY", "ERROR", str(e)[:300])
            run = db.query(models.PipelineRun).filter(
                models.PipelineRun.run_id == run_id
            ).first()
            if run:
                run.step = "error"
                _release_lock(db, "trade_running")
            db.commit()
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass
        from core.cache import cache_invalidate
        cache_invalidate("pipeline_runs")
        return {"error": str(e)}
    finally:
        db.close()


def node_error(state: TradeState) -> dict:
    """Terminal error handler."""
    run_id = state["run_id"]
    db = SessionLocal()
    try:
        run = db.query(models.PipelineRun).filter(
            models.PipelineRun.run_id == run_id
        ).first()
        if run:
            run.step = "error"
            _release_lock(db, "trade_running")
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()
    return {}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _release_lock(db, lock_key: str):
    conf = db.query(models.AppConfig).filter(models.AppConfig.key == lock_key).first()
    if conf:
        conf.value = "0"


def _route_load(state: TradeState) -> str:
    return "error" if state.get("error") else "prepare_agents"


def route_to_agents(state: TradeState) -> list:
    """
    Conditional edge function: reads _agents_to_run from state and returns
    a list[Send], one per agent. LangGraph fans these out as parallel branches.
    """
    if state.get("error"):
        return [Send("error", state)]

    agents = state.get("_agents_to_run", [])
    if not agents:
        return [Send("error", {**state, "error": "No agents selected"})]

    return [
        Send("node_agent", {
            **state,
            "_name":              agent["name"],
            "_prompt":            agent["prompt"],
            "_market_constraint": agent["market_constraint"],
            "_portfolio_context": agent["portfolio_context"],
            "_kg_context":        agent["kg_context"],
        })
        for agent in agents
    ]


def _route_consensus(state: TradeState) -> str:
    return "error" if state.get("error") else "deploy"


# ── Graph ─────────────────────────────────────────────────────────────────────

def build_trade_graph():
    g = StateGraph(TradeState)

    g.add_node("load_context",   node_load_context)
    g.add_node("prepare_agents", node_prepare_agents)
    g.add_node("node_agent",     node_agent)
    g.add_node("consensus",      node_consensus)
    g.add_node("deploy",         node_deploy)
    g.add_node("error",          node_error)

    g.set_entry_point("load_context")

    g.add_conditional_edges("load_context",   _route_load,
                            {"error": "error", "prepare_agents": "prepare_agents"})
    # route_to_agents returns list[Send] → LangGraph fans out to node_agent
    g.add_conditional_edges("prepare_agents", route_to_agents)
    # all node_agent branches fan-in → consensus
    g.add_edge("node_agent", "consensus")
    g.add_conditional_edges("consensus",      _route_consensus,
                            {"error": "error", "deploy": "deploy"})
    g.add_edge("deploy", END)
    g.add_edge("error",  END)

    return g.compile()
