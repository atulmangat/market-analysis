export interface Prediction { id: number; symbol: string; agent_name: string; prediction: string; reasoning: string; confidence: number; score?: number; }
export interface Strategy { id: number; symbol: string; strategy_type: string; entry_price: number; current_return: number; reasoning_summary: string; status: string; timestamp: string; position_size: number | null; exit_price: number | null; realized_pnl: number | null; close_reason: string | null; closed_at: string | null; notes: string | null; debate_round_id?: number | null; }
export interface ReportCandle { date: string; open: number; high: number; low: number; close: number; volume: number; }
export interface StrategyReport {
  strategy: Strategy;
  debate: { id: number; timestamp: string; consensus_votes: string; judge_reasoning: string | null; enabled_markets: string | null; proposals: (Proposal & { matched_consensus: boolean })[]; } | null;
  chart: { symbol: string; candles: ReportCandle[]; entry_price: number; entry_date: string | null; error?: string; };
  fundamentals: {
    name: string | null; sector: string | null; industry: string | null; exchange: string | null;
    market_cap: number | null; enterprise_value: number | null;
    pe_ratio: number | null; forward_pe: number | null; pb_ratio: number | null; ps_ratio: number | null; ev_ebitda: number | null;
    revenue_growth: number | null; earnings_growth: number | null; profit_margin: number | null; operating_margin: number | null;
    roe: number | null; roa: number | null; debt_equity: number | null;
    '52w_high': number | null; '52w_low': number | null; avg_volume: number | null; beta: number | null; dividend_yield: number | null;
    analyst_target: number | null; analyst_target_low: number | null; analyst_target_high: number | null;
    analyst_upside: number | null; analyst_recommendation: string | null; analyst_count: number | null;
    short_pct_float: number | null;
    rsi_14: number | null; vol_ratio: number | null; chg_5d: number | null; chg_20d: number | null;
    recent_closes: { date: string; close: number }[];
    next_earnings: string | null;
    currency: string; quote_type: string | null; description?: string | null; error?: string;
  };
}
export interface PortfolioPnl { total_budget: number; allocated: number; available: number; realized_pnl: number; unrealized_pnl: number; total_pnl: number; total_pnl_pct: number; using_assumed_sizes?: boolean; positions: (Strategy & { pnl_usd: number | null; pnl_pct: number | null; is_open: boolean; current_price?: number | null; assumed_size?: number | null })[]; }
export interface MarketConfig { id: number; market_name: string; is_enabled: number; }
export interface DebateRound { id: number; timestamp: string; consensus_ticker: string; consensus_action: string; consensus_votes: string; proposals_json: string; enabled_markets: string; research_context?: string; judge_reasoning?: string; }
export interface Proposal { agent_name: string; ticker: string; action: string; reasoning: string; }
export interface AgentMemory { id: number; agent_name: string; note_type: string; content: string; created_at: string; }
export interface AgentPrompt { id: number; agent_name: string; description?: string; system_prompt: string; updated_at: string | null; }
export interface AgentFitness { agent_name: string; generation: number; fitness_score: number | null; win_rate: number | null; avg_return: number | null; total_scored: number; updated_at: string | null; }
export interface AgentEvolution { id: number; generation: number; fitness_score: number | null; win_rate: number | null; avg_return: number | null; total_scored: number; evolution_reason: string | null; system_prompt: string; replaced_at: string | null; created_at: string; }
export interface KGNode { id: string; type: 'ASSET' | 'EVENT' | 'ENTITY' | 'INDICATOR'; label: string; symbol: string | null; last_seen_at: string | null; metadata: Record<string, unknown>; x?: number; y?: number; vx?: number; vy?: number; fx?: number; fy?: number; }
export interface KGEdge { source: string; target: string; relation: string; confidence: number; created_at: string | null; }
export interface KnowledgeGraph { nodes: KGNode[]; edges: KGEdge[]; center?: string; }
export interface WebResearch { id: number; title: string; snippet: string; source_url: string; fetched_at: string; }
export interface PipelineEvent { id: number; step: string; agent_name: string | null; status: string; detail: string | null; created_at: string; }
export interface PipelinePosition { ticker: string; action: string; horizon?: string; size?: string; target?: string; stop?: string; reasoning: string; strategy_id: number | null; }
export interface PipelineRunOutput { positions: PipelinePosition[]; proposals: { agent_name: string; ticker: string; action: string; reasoning: string }[]; debate_id: number | null; ticker: string; action: string; votes: string; judge_reasoning: string; strategy_id: number | null; }
export interface PipelineRunParams { focus?: string; tickers?: string[]; markets?: string[]; }
export interface PipelineRun { run_id: string; started_at: string; ended_at: string; event_count: number; status: 'running' | 'done' | 'error'; deploy_detail: string | null; run_params: PipelineRunParams | null; output: PipelineRunOutput | null; }
export interface LiveQuote { market: string; symbol: string; name: string; price: number | null; prev_close: number | null; change_pct: number | null; volume: number | null; week_closes?: number[]; week_change_pct?: number | null; error?: string; }
export interface MarketEvent { market: string; symbol: string; name: string; event_type: string; date: string; detail: string | null; url?: string | null; title?: string | null; }

export type AssetClass = 'crypto' | 'stock' | 'commodity';
export type Page = 'dashboard' | 'markets' | 'graph' | 'portfolio' | 'memory' | 'pipeline' | 'settings';
export interface Toast { id: number; msg: string; type: 'ok' | 'err' | 'info'; }
export interface TickerMeta { symbol: string; name: string; market: string; sector: string; }
