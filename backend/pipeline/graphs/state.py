"""
LangGraph state TypedDicts for the research and trade pipelines.
"""
from typing import TypedDict, Optional, Annotated
import operator


class ResearchState(TypedDict):
    run_id: str
    enabled_markets: dict            # {"US": [...], "Crypto": [...]}
    investment_focus: str
    focus_tickers: Optional[list]
    research_items: list             # raw articles from fetch_research_items()
    shared_context: str              # full context string for agents
    research_log: list               # [{title, url}] for debate_round
    kg_edges_added: int
    error: Optional[str]             # non-None → terminal error


class AgentProposal(TypedDict):
    agent_name: str
    ticker: str
    action: str
    reasoning: str


class TradeState(TypedDict):
    run_id: str
    enabled_markets: dict
    investment_focus: str
    shared_context: str
    research_log: list
    # operator.add reducer: each parallel agent branch appends its proposal
    proposals: Annotated[list, operator.add]
    fitness_map: dict                # {agent_name: fitness_dict}
    verdicts: list                   # judge output
    error: Optional[str]
    # Internal fields set by node_prepare_agents, consumed by route_to_agents
    _agents_to_run: list             # [{name, prompt, market_constraint, portfolio_context, kg_context}]
