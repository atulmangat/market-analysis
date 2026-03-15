import { useEffect, useRef, useState } from 'react';

interface Prediction { id: number; symbol: string; agent_name: string; prediction: string; reasoning: string; confidence: number; score?: number; }
interface Strategy { id: number; symbol: string; strategy_type: string; entry_price: number; current_return: number; reasoning_summary: string; status: string; timestamp: string; position_size: number | null; exit_price: number | null; realized_pnl: number | null; close_reason: string | null; closed_at: string | null; notes: string | null; debate_round_id?: number | null; }
interface ReportCandle { date: string; open: number; high: number; low: number; close: number; volume: number; }
interface StrategyReport {
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
interface PortfolioPnl { total_budget: number; allocated: number; available: number; realized_pnl: number; unrealized_pnl: number; total_pnl: number; total_pnl_pct: number; using_assumed_sizes?: boolean; positions: (Strategy & { pnl_usd: number | null; pnl_pct: number | null; is_open: boolean; current_price?: number | null; assumed_size?: number | null })[]; }
interface MarketConfig { id: number; market_name: string; is_enabled: number; }
interface DebateRound { id: number; timestamp: string; consensus_ticker: string; consensus_action: string; consensus_votes: string; proposals_json: string; enabled_markets: string; research_context?: string; judge_reasoning?: string; }
interface Proposal { agent_name: string; ticker: string; action: string; reasoning: string; }
interface AgentMemory { id: number; agent_name: string; note_type: string; content: string; created_at: string; }
interface AgentPrompt { id: number; agent_name: string; system_prompt: string; updated_at: string | null; }
interface AgentFitness { agent_name: string; generation: number; fitness_score: number | null; win_rate: number | null; avg_return: number | null; total_scored: number; updated_at: string | null; }
interface AgentEvolution { id: number; generation: number; fitness_score: number | null; win_rate: number | null; avg_return: number | null; total_scored: number; evolution_reason: string | null; system_prompt: string; replaced_at: string | null; created_at: string; }
interface KGNode { id: string; type: 'ASSET' | 'EVENT' | 'ENTITY' | 'INDICATOR'; label: string; symbol: string | null; last_seen_at: string | null; metadata: Record<string, unknown>; }
interface KGEdge { source: string; target: string; relation: string; confidence: number; created_at: string | null; }
interface KnowledgeGraph { nodes: KGNode[]; edges: KGEdge[]; center?: string; }
interface WebResearch { id: number; title: string; snippet: string; source_url: string; fetched_at: string; }
interface PipelineEvent { id: number; step: string; agent_name: string | null; status: string; detail: string | null; created_at: string; }
interface PipelineRunOutput { ticker: string; action: string; votes: string; judge_reasoning: string; proposals: { agent_name: string; ticker: string; action: string; reasoning: string }[]; strategy_id: number | null; debate_id: number | null; }
interface PipelineRun { run_id: string; started_at: string; ended_at: string; event_count: number; status: 'running' | 'done' | 'error'; deploy_detail: string | null; output: PipelineRunOutput | null; }
interface LiveQuote { market: string; symbol: string; name: string; price: number | null; prev_close: number | null; change_pct: number | null; volume: number | null; week_closes?: number[]; week_change_pct?: number | null; error?: string; }
interface MarketEvent { market: string; symbol: string; name: string; event_type: string; date: string; detail: string | null; url?: string | null; title?: string | null; }

const MARKET_ICONS: Record<string, string> = { US: '🇺🇸', India: '🇮🇳', Crypto: '₿', MCX: '⛏️' };
const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000/api';

// ── Auth helpers ────────────────────────────────────────────────────────────
function getToken(): string | null { return localStorage.getItem('auth_token'); }
function setToken(t: string) { localStorage.setItem('auth_token', t); }
function clearToken() { localStorage.removeItem('auth_token'); }
function authHeaders(): HeadersInit {
  const t = getToken();
  return t ? { 'Authorization': `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}
async function apiFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { ...authHeaders(), ...(opts.headers ?? {}) },
  });
  if (res.status === 401) { clearToken(); window.location.reload(); }
  return res;
}

interface TickerMeta { symbol: string; name: string; market: string; sector: string; }

const TICKER_DB: TickerMeta[] = [
  // US — Tech
  { symbol: 'AAPL',  name: 'Apple',             market: 'US',     sector: 'Tech' },
  { symbol: 'MSFT',  name: 'Microsoft',          market: 'US',     sector: 'Tech' },
  { symbol: 'NVDA',  name: 'NVIDIA',             market: 'US',     sector: 'Tech' },
  { symbol: 'GOOGL', name: 'Alphabet',           market: 'US',     sector: 'Tech' },
  { symbol: 'META',  name: 'Meta Platforms',     market: 'US',     sector: 'Tech' },
  { symbol: 'AMD',   name: 'AMD',                market: 'US',     sector: 'Tech' },
  // US — Consumer / E-commerce
  { symbol: 'AMZN',  name: 'Amazon',             market: 'US',     sector: 'Consumer' },
  { symbol: 'TSLA',  name: 'Tesla',              market: 'US',     sector: 'Consumer' },
  // US — ETFs
  { symbol: 'SPY',   name: 'S&P 500 ETF',        market: 'US',     sector: 'ETF' },
  { symbol: 'QQQ',   name: 'Nasdaq 100 ETF',     market: 'US',     sector: 'ETF' },
  // India — Energy / Conglomerate
  { symbol: 'RELIANCE.NS',   name: 'Reliance Industries', market: 'India', sector: 'Energy' },
  { symbol: 'TATAMOTORS.NS', name: 'Tata Motors',         market: 'India', sector: 'Consumer' },
  // India — IT / Tech
  { symbol: 'TCS.NS',  name: 'Tata Consultancy',  market: 'India', sector: 'Tech' },
  { symbol: 'INFY.NS', name: 'Infosys',            market: 'India', sector: 'Tech' },
  { symbol: 'WIPRO.NS',name: 'Wipro',              market: 'India', sector: 'Tech' },
  // India — Banking / Finance
  { symbol: 'HDFCBANK.NS',  name: 'HDFC Bank',    market: 'India', sector: 'Finance' },
  { symbol: 'ICICIBANK.NS', name: 'ICICI Bank',   market: 'India', sector: 'Finance' },
  { symbol: 'SBIN.NS',      name: 'State Bank of India', market: 'India', sector: 'Finance' },
  // Crypto — Layer 1
  { symbol: 'BTC-USD',  name: 'Bitcoin',     market: 'Crypto', sector: 'Layer 1' },
  { symbol: 'ETH-USD',  name: 'Ethereum',    market: 'Crypto', sector: 'Layer 1' },
  { symbol: 'SOL-USD',  name: 'Solana',      market: 'Crypto', sector: 'Layer 1' },
  { symbol: 'ADA-USD',  name: 'Cardano',     market: 'Crypto', sector: 'Layer 1' },
  // Crypto — Alt / Meme
  { symbol: 'BNB-USD',  name: 'BNB',         market: 'Crypto', sector: 'Exchange' },
  { symbol: 'XRP-USD',  name: 'XRP',         market: 'Crypto', sector: 'Payments' },
  { symbol: 'DOGE-USD', name: 'Dogecoin',    market: 'Crypto', sector: 'Meme' },
  // MCX — Metals & Energy
  { symbol: 'GC=F', name: 'Gold Futures',       market: 'MCX', sector: 'Metals' },
  { symbol: 'SI=F', name: 'Silver Futures',     market: 'MCX', sector: 'Metals' },
  { symbol: 'HG=F', name: 'Copper Futures',     market: 'MCX', sector: 'Metals' },
  { symbol: 'CL=F', name: 'Crude Oil Futures',  market: 'MCX', sector: 'Energy' },
  { symbol: 'NG=F', name: 'Natural Gas Futures',market: 'MCX', sector: 'Energy' },
];

// Derived helpers — keep MARKET_TICKERS working for the rest of the app
const MARKET_TICKERS: Record<string, string[]> = TICKER_DB.reduce((acc, t) => {
  (acc[t.market] = acc[t.market] ?? []).push(t.symbol);
  return acc;
}, {} as Record<string, string[]>);

const TICKER_META: Record<string, TickerMeta> = Object.fromEntries(TICKER_DB.map(t => [t.symbol, t]));

// Sectors grouped by market
const MARKET_SECTORS: Record<string, string[]> = TICKER_DB.reduce((acc, t) => {
  if (!acc[t.market]) acc[t.market] = [];
  if (!acc[t.market].includes(t.sector)) acc[t.market].push(t.sector);
  return acc;
}, {} as Record<string, string[]>);

// Simple fuzzy match: every char in query appears in target in order

function getMarketForTicker(ticker: string): string {
  for (const [market, tickers] of Object.entries(MARKET_TICKERS)) {
    if (tickers.includes(ticker)) return market;
  }
  return 'US';
}

function parseProposals(jsonStr: string): Proposal[] {
  try { return JSON.parse(jsonStr); } catch { return []; }
}

// ── Theme ──────────────────────────────────────────────────────────────────
function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
}

// ── Nav pages ──────────────────────────────────────────────────────────────
type Page = 'dashboard' | 'markets' | 'graph' | 'portfolio' | 'memory' | 'pipeline' | 'settings';

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard',    icon: '▦' },
  { id: 'markets',   label: 'Markets',      icon: '◈' },
  { id: 'graph',     label: 'Knowledge Graph', icon: '◎' },
  { id: 'portfolio', label: 'Portfolio',    icon: '$' },
  { id: 'memory',    label: 'Agent Memory', icon: '◉' },
  { id: 'pipeline',  label: 'Live Pipeline', icon: '⟳' },
  { id: 'settings',  label: 'Settings',     icon: '⚙' },
];

// ── Shared note-type color map — works in both light and dark mode ──────────
const NOTE_COLORS: Record<string, string> = {
  LESSON:          'text-amber-600 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/40',
  STRATEGY_RESULT: 'text-purple-600 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800/40',
  OBSERVATION:     'text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/40',
  INSIGHT:         'text-teal-600 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800/40',
};

const STEP_META: Record<string, { icon: string; label: string; color: string }> = {
  START:        { icon: '▶', label: 'Pipeline Started',   color: 'text-brand-500 dark:text-brand-400'    },
  WEB_RESEARCH: { icon: '⌖', label: 'Shared Retrieval',   color: 'text-purple-600 dark:text-purple-400'  },
  KG_INGEST:    { icon: '⬡', label: 'Knowledge Graph',    color: 'text-cyan-600 dark:text-cyan-400'      },
  DEBATE_PANEL: { icon: '◈', label: 'Debate Panel',       color: 'text-teal-600 dark:text-teal-400'      },
  AGENT_QUERY:  { icon: '◉', label: 'Agent Query',        color: 'text-teal-600 dark:text-teal-300'      },
  JUDGE:        { icon: '⚖', label: 'Judge',              color: 'text-amber-600 dark:text-amber-400'    },
  DEPLOY:       { icon: '◆', label: 'Deploy Strategy',    color: 'text-brand-500 dark:text-brand-400'    },
  MEMORY_WRITE: { icon: '◈', label: 'Write Memories',     color: 'text-indigo-600 dark:text-indigo-400'  },
  ERROR:        { icon: '✕', label: 'Error',              color: 'text-down'                             },
};

// ── Small reusable components ──────────────────────────────────────────────

function Badge({ type }: { type: 'LONG' | 'SHORT' | string }) {
  if (type === 'LONG')
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold tracking-wide bg-up-bg text-up-text">▲ LONG</span>;
  if (type === 'SHORT')
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold tracking-wide bg-down-bg text-down-text">▼ SHORT</span>;
  return <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-bold bg-surface3 text-textMuted">{type}</span>;
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE:   'bg-up-bg text-up-text border border-up/20',
    PENDING:  'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-500/20',
    REJECTED: 'bg-down-bg text-down-text border border-down/20',
    CLOSED:   'bg-surface3 text-textDim border border-borderLight',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${map[status] ?? 'bg-surface3 text-textMuted'}`}>
      {status}
    </span>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface border border-borderLight rounded-xl ${className}`}>
      {children}
    </div>
  );
}

function SectionHeader({ title, meta }: { title: string; meta?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-borderLight">
      <h2 className="text-sm font-semibold text-textMain tracking-wide">{title}</h2>
      {meta && <div className="text-xs text-textMuted">{meta}</div>}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none ${checked ? 'bg-brand-500' : 'bg-surface3'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

// ── Formatting helpers ─────────────────────────────────────────────────────
function fmtMarketCap(n: number | null | undefined): string {
  if (!n) return 'N/A';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
}
function fmtVol(n: number | null | undefined): string {
  if (!n) return 'N/A';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  return n.toLocaleString();
}

// ── Detect asset class from symbol / quote_type ────────────────────────────
type AssetClass = 'crypto' | 'stock' | 'commodity';
function detectAssetClass(symbol: string, quoteType: string | null | undefined): AssetClass {
  if (quoteType === 'CRYPTOCURRENCY' || symbol.endsWith('-USD')) return 'crypto';
  if (quoteType === 'FUTURE' || symbol.endsWith('=F')) return 'commodity';
  return 'stock';
}

// ── Shared: price + volume chart ───────────────────────────────────────────
function PriceVolumeChart({ candles, entryPrice, accentColor }: {
  candles: ReportCandle[];
  entryPrice: number;
  accentColor: string;
}) {
  if (!candles.length) return <div className="h-52 flex items-center justify-center text-textDim text-xs">No chart data</div>;
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const maxVol = Math.max(...volumes) || 1;
  const minY = Math.min(...closes) * 0.997;
  const maxY = Math.max(...closes) * 1.003;
  const W = 600, H = 160, VH = 32, GAP = 6;
  const n = candles.length;
  const toX = (i: number) => n === 1 ? W / 2 : (i / (n - 1)) * W;
  const toY = (v: number) => H - ((v - minY) / (maxY - minY || 1)) * H;
  const lastClose = closes[closes.length - 1];
  const isUp = lastClose >= entryPrice;
  const lineColor = isUp ? '#22c55e' : '#ef4444';
  const entryY = toY(entryPrice);
  const pathD = `M ${closes.map((c, i) => `${toX(i)},${toY(c)}`).join(' L ')} L ${W},${H} L 0,${H} Z`;
  const pts = closes.map((c, i) => `${toX(i)},${toY(c)}`).join(' ');
  const barW = Math.max(2, W / n - 1);
  const totalH = H + GAP + VH;
  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${totalH}`} preserveAspectRatio="none" className="w-full" style={{ height: 220 }}>
        <defs>
          <linearGradient id={`cg-${accentColor}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.3" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* Price area */}
        <path d={pathD} fill={`url(#cg-${accentColor})`} />
        <polyline points={pts} fill="none" stroke={lineColor} strokeWidth="1.8" strokeLinejoin="round" />
        {entryPrice > 0 && entryY >= 0 && entryY <= H && (
          <>
            <line x1="0" y1={entryY} x2={W} y2={entryY} stroke="#f59e0b" strokeWidth="1" strokeDasharray="5,3" opacity="0.8" />
            <rect x="0" y={entryY - 11} width="60" height="11" fill="#f59e0b" opacity="0.15" rx="2" />
            <text x="4" y={entryY - 2} fill="#f59e0b" fontSize="8.5" fontWeight="600">Entry {entryPrice.toFixed(2)}</text>
          </>
        )}
        <circle cx={toX(n - 1)} cy={toY(lastClose)} r="3.5" fill={lineColor} />
        {/* Volume bars */}
        {candles.map((c, i) => {
          const bh = ((c.volume / maxVol) * VH) || 1;
          const bx = toX(i) - barW / 2;
          const by = H + GAP + (VH - bh);
          return <rect key={i} x={bx} y={by} width={barW} height={bh} fill={lineColor} opacity="0.35" rx="1" />;
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-textDim mt-0.5 px-1">
        <span>{candles[0]?.date}</span>
        <span className={`font-semibold tabular-nums ${isUp ? 'text-up' : 'text-down'}`}>{lastClose.toFixed(4)}</span>
        <span>{candles[n - 1]?.date}</span>
      </div>
    </div>
  );
}

// ── Shared: stat pill ──────────────────────────────────────────────────────
function StatPill({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className={`bg-surface2 border rounded-lg px-3 py-2.5 ${accent ?? 'border-borderLight'}`}>
      <p className="text-[9px] text-textDim uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-xs font-semibold text-textMain truncate">{value}</p>
    </div>
  );
}

// ── Shared: judge + proposals section ─────────────────────────────────────
function AgentProposalCard({ p }: { p: StrategyReport['debate'] extends null ? never : NonNullable<StrategyReport['debate']>['proposals'][0] }) {
  const [expanded, setExpanded] = useState(false);
  const preview = p.reasoning.slice(0, 320);
  const hasMore = p.reasoning.length > 320;
  return (
    <div className={`rounded-xl border p-4 ${p.matched_consensus ? 'border-brand-500/30 bg-brand-900/10' : 'border-borderLight bg-surface2'}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-brand-400">{p.agent_name}</span>
          {p.matched_consensus && <span className="text-[9px] bg-brand-500/20 text-brand-300 px-1.5 py-0.5 rounded font-semibold">✓ SELECTED</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <Badge type={p.action} />
          <span className="text-[10px] text-textDim font-mono">{p.ticker}</span>
        </div>
      </div>
      <p className="text-[11px] text-textMuted leading-relaxed whitespace-pre-wrap">
        {expanded ? p.reasoning : preview}{!expanded && hasMore ? '…' : ''}
      </p>
      {hasMore && (
        <button onClick={() => setExpanded(e => !e)}
          className="mt-2 text-[10px] text-brand-400 hover:text-brand-300 font-semibold">
          {expanded ? '▲ Show less' : '▼ Read full analysis'}
        </button>
      )}
    </div>
  );
}

function DebateSection({ d }: { d: StrategyReport['debate'] }) {
  return (
    <>
      <div className="px-6 py-5">
        <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-3">Judge Verdict</p>
        {d ? (
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-500/20 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">⚖ Committee Decision</span>
              <span className="text-[10px] text-textDim font-mono">{d.consensus_votes} agents aligned</span>
              {d.enabled_markets && <span className="text-[10px] text-textDim">· {d.enabled_markets}</span>}
            </div>
            <p className="text-[11px] text-textMuted leading-relaxed whitespace-pre-wrap">{d.judge_reasoning ?? 'No reasoning recorded.'}</p>
          </div>
        ) : (
          <p className="text-xs text-textDim">No debate linked to this strategy.</p>
        )}
      </div>
      {d && d.proposals.length > 0 && (
        <div className="px-6 py-5">
          <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-3">Agent Analysis ({d.proposals.length} analysts)</p>
          <div className="space-y-3">
            {d.proposals.map((p, i) => <AgentProposalCard key={i} p={p} />)}
          </div>
        </div>
      )}
    </>
  );
}

// ── Template: Crypto ───────────────────────────────────────────────────────
function CryptoReportTemplate({ report }: { report: StrategyReport }) {
  const { strategy: s, fundamentals: f, chart: ch, debate: d } = report;
  const lastClose = ch.candles.at(-1)?.close ?? s.entry_price;
  const change30d = ch.candles.length >= 2
    ? ((ch.candles.at(-1)!.close - ch.candles[0].close) / ch.candles[0].close * 100)
    : null;
  const range52wLow = f['52w_low'];
  const range52wHigh = f['52w_high'];
  const posIn52w = (range52wLow != null && range52wHigh != null && range52wHigh > range52wLow)
    ? ((lastClose - range52wLow) / (range52wHigh - range52wLow) * 100)
    : null;

  return (
    <div className="divide-y divide-borderLight">
      {/* Hero banner */}
      <div className="px-6 py-5 bg-gradient-to-br from-violet-950/40 to-surface">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl font-bold text-textMain font-mono">{s.symbol.replace('-USD','')}</span>
              <span className="text-sm text-textDim">/USD</span>
              <Badge type={s.strategy_type} />
            </div>
            <p className="text-[11px] text-textDim">{f.name ?? s.symbol} · Cryptocurrency</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-light font-mono text-textMain">${lastClose.toFixed(2)}</p>
            {change30d != null && (
              <p className={`text-sm font-semibold ${change30d >= 0 ? 'text-up' : 'text-down'}`}>
                {change30d >= 0 ? '+' : ''}{change30d.toFixed(2)}% (30d)
              </p>
            )}
          </div>
        </div>
        {/* 52-week position bar */}
        {posIn52w != null && (
          <div className="mt-1">
            <div className="flex justify-between text-[9px] text-textDim mb-1">
              <span>52w Low ${range52wLow!.toFixed(2)}</span>
              <span className="text-violet-400">{posIn52w.toFixed(0)}% of range</span>
              <span>52w High ${range52wHigh!.toFixed(2)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-surface3 overflow-hidden">
              <div className="h-full rounded-full bg-violet-500" style={{ width: `${posIn52w}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="px-6 py-5">
        <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-3">Price & Volume — 30 Days</p>
        {ch.error ? <p className="text-xs text-textDim py-4">Chart unavailable</p>
          : <PriceVolumeChart candles={ch.candles} entryPrice={ch.entry_price} accentColor="violet" />}
      </div>

      {/* Key metrics */}
      <div className="px-6 py-5">
        <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-3">Market Metrics</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {f.market_cap && <StatPill label="Market Cap" value={fmtMarketCap(f.market_cap)} accent="border-violet-500/30" />}
          {f.avg_volume && <StatPill label="Avg Daily Volume" value={fmtVol(f.avg_volume)} />}
          {f['52w_high'] && <StatPill label="52w High" value={`$${f['52w_high']!.toFixed(2)}`} />}
          {f['52w_low'] && <StatPill label="52w Low" value={`$${f['52w_low']!.toFixed(2)}`} />}
          <StatPill label="Entry Price" value={`$${s.entry_price.toFixed(4)}`} accent="border-amber-500/30" />
          {s.current_return != null && (
            <StatPill label="Current P&L"
              value={`${s.current_return >= 0 ? '+' : ''}${s.current_return.toFixed(2)}%`}
              accent={s.current_return >= 0 ? 'border-up/40' : 'border-down/40'}
            />
          )}
          {f.chg_5d != null && <StatPill label="5d Change" value={`${f.chg_5d >= 0 ? '+' : ''}${f.chg_5d.toFixed(2)}%`} accent={f.chg_5d >= 0 ? 'border-up/30' : 'border-down/30'} />}
          {f.chg_20d != null && <StatPill label="20d Change" value={`${f.chg_20d >= 0 ? '+' : ''}${f.chg_20d.toFixed(2)}%`} accent={f.chg_20d >= 0 ? 'border-up/30' : 'border-down/30'} />}
          {f.rsi_14 != null && (
            <StatPill label="RSI (14)"
              value={`${f.rsi_14.toFixed(0)} · ${f.rsi_14 > 70 ? 'Overbought' : f.rsi_14 < 30 ? 'Oversold' : 'Neutral'}`}
              accent={f.rsi_14 > 70 ? 'border-down/40' : f.rsi_14 < 30 ? 'border-up/40' : 'border-borderLight'}
            />
          )}
          {f.vol_ratio != null && (
            <StatPill label="Volume vs Avg"
              value={`${f.vol_ratio.toFixed(1)}x ${f.vol_ratio > 1.5 ? '↑ Surge' : f.vol_ratio < 0.7 ? '↓ Quiet' : '– Normal'}`}
            />
          )}
        </div>
      </div>

      <DebateSection d={d} />
    </div>
  );
}

// ── Template: Stock (Equity) ───────────────────────────────────────────────
function StockReportTemplate({ report }: { report: StrategyReport }) {
  const { strategy: s, fundamentals: f, chart: ch, debate: d } = report;
  const lastClose = ch.candles.at(-1)?.close ?? s.entry_price;
  const change30d = ch.candles.length >= 2
    ? ((ch.candles.at(-1)!.close - ch.candles[0].close) / ch.candles[0].close * 100)
    : null;
  const range52wLow = f['52w_low'];
  const range52wHigh = f['52w_high'];
  const posIn52w = (range52wLow != null && range52wHigh != null && range52wHigh > range52wLow)
    ? ((lastClose - range52wLow) / (range52wHigh - range52wLow) * 100)
    : null;

  // Valuation score — rough composite
  const peScore = f.pe_ratio != null ? (f.pe_ratio < 15 ? 'Undervalued' : f.pe_ratio < 30 ? 'Fair' : 'Premium') : null;

  return (
    <div className="divide-y divide-borderLight">
      {/* Hero */}
      <div className="px-6 py-5 bg-gradient-to-br from-brand-950/40 to-surface">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl font-bold text-textMain font-mono">{s.symbol.replace('.NS','')}</span>
              <Badge type={s.strategy_type} />
              <StatusChip status={s.status} />
            </div>
            <p className="text-[11px] text-textDim">{f.name ?? s.symbol}</p>
            {(f.sector || f.industry) && (
              <p className="text-[10px] text-brand-400 mt-0.5">{[f.sector, f.industry].filter(Boolean).join(' · ')}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-2xl font-light font-mono text-textMain">${lastClose.toFixed(2)}</p>
            {change30d != null && (
              <p className={`text-sm font-semibold ${change30d >= 0 ? 'text-up' : 'text-down'}`}>
                {change30d >= 0 ? '+' : ''}{change30d.toFixed(2)}% (30d)
              </p>
            )}
          </div>
        </div>
        {posIn52w != null && (
          <div>
            <div className="flex justify-between text-[9px] text-textDim mb-1">
              <span>52w Low ${range52wLow!.toFixed(2)}</span>
              <span className="text-brand-400">{posIn52w.toFixed(0)}% of annual range</span>
              <span>52w High ${range52wHigh!.toFixed(2)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-surface3 overflow-hidden">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${posIn52w}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="px-6 py-5">
        <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-3">Price & Volume — 30 Days</p>
        {ch.error ? <p className="text-xs text-textDim py-4">Chart unavailable</p>
          : <PriceVolumeChart candles={ch.candles} entryPrice={ch.entry_price} accentColor="brand" />}
      </div>

      {/* Description */}
      {f.description && (
        <div className="px-6 py-4 border-t border-borderLight">
          <p className="text-[11px] text-textMuted leading-relaxed">{f.description}</p>
        </div>
      )}

      {/* Valuation */}
      <div className="px-6 py-5">
        <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-3">Valuation</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {f.market_cap && <StatPill label="Market Cap" value={fmtMarketCap(f.market_cap)} accent="border-brand-500/30" />}
          {f.enterprise_value && <StatPill label="Enterprise Value" value={fmtMarketCap(f.enterprise_value)} />}
          {f.pe_ratio != null && (
            <StatPill label="P/E (TTM)"
              value={`${f.pe_ratio.toFixed(1)}x${peScore ? ` · ${peScore}` : ''}`}
              accent={peScore === 'Undervalued' ? 'border-up/40' : peScore === 'Premium' ? 'border-down/40' : 'border-borderLight'}
            />
          )}
          {f.forward_pe != null && <StatPill label="Fwd P/E" value={`${f.forward_pe.toFixed(1)}x`} />}
          {f.pb_ratio != null && <StatPill label="P/B" value={`${f.pb_ratio.toFixed(2)}x`} />}
          {f.ps_ratio != null && <StatPill label="P/S" value={`${f.ps_ratio.toFixed(2)}x`} />}
          {f.ev_ebitda != null && <StatPill label="EV/EBITDA" value={`${f.ev_ebitda.toFixed(1)}x`} />}
          {f.beta != null && <StatPill label="Beta" value={`${f.beta.toFixed(2)}${f.beta > 1.5 ? ' · High vol' : f.beta < 0.8 ? ' · Low vol' : ''}`} />}
          {f.dividend_yield != null && <StatPill label="Div Yield" value={`${(f.dividend_yield * 100).toFixed(2)}%`} accent="border-up/30" />}
        </div>
      </div>

      {/* Growth & Profitability */}
      {(f.revenue_growth != null || f.earnings_growth != null || f.profit_margin != null || f.roe != null || f.debt_equity != null) && (
        <div className="px-6 py-5">
          <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-3">Growth & Profitability</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {f.revenue_growth != null && <StatPill label="Revenue Growth (YoY)" value={`${(f.revenue_growth * 100).toFixed(1)}%`} accent={f.revenue_growth >= 0 ? 'border-up/30' : 'border-down/30'} />}
            {f.earnings_growth != null && <StatPill label="Earnings Growth" value={`${(f.earnings_growth * 100).toFixed(1)}%`} accent={f.earnings_growth >= 0 ? 'border-up/30' : 'border-down/30'} />}
            {f.profit_margin != null && <StatPill label="Net Margin" value={`${(f.profit_margin * 100).toFixed(1)}%`} />}
            {f.operating_margin != null && <StatPill label="Operating Margin" value={`${(f.operating_margin * 100).toFixed(1)}%`} />}
            {f.roe != null && <StatPill label="ROE" value={`${(f.roe * 100).toFixed(1)}%`} />}
            {f.roa != null && <StatPill label="ROA" value={`${(f.roa * 100).toFixed(1)}%`} />}
            {f.debt_equity != null && <StatPill label="Debt/Equity" value={`${f.debt_equity.toFixed(2)}x`} accent={f.debt_equity > 2 ? 'border-down/30' : 'border-borderLight'} />}
          </div>
        </div>
      )}

      {/* Analyst Consensus */}
      {(f.analyst_target != null || f.analyst_recommendation) && (
        <div className="px-6 py-5">
          <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-3">Analyst Consensus</p>
          <div className="bg-surface2 rounded-xl border border-borderLight p-4">
            <div className="flex items-center justify-between mb-3">
              {f.analyst_recommendation && (
                <div>
                  <p className="text-[10px] text-textDim mb-0.5">Consensus Rating</p>
                  <span className={`text-sm font-bold uppercase ${f.analyst_recommendation.includes('buy') ? 'text-up' : f.analyst_recommendation.includes('sell') ? 'text-down' : 'text-amber-400'}`}>
                    {f.analyst_recommendation.replace(/_/g, ' ')}
                  </span>
                  {f.analyst_count && <span className="text-[10px] text-textDim ml-2">({f.analyst_count} analysts)</span>}
                </div>
              )}
              {f.analyst_target != null && (
                <div className="text-right">
                  <p className="text-[10px] text-textDim mb-0.5">Price Target</p>
                  <p className="text-lg font-light font-mono text-textMain">${f.analyst_target.toFixed(2)}</p>
                  {f.analyst_upside != null && (
                    <p className={`text-xs font-semibold ${f.analyst_upside >= 0 ? 'text-up' : 'text-down'}`}>
                      {f.analyst_upside >= 0 ? '+' : ''}{f.analyst_upside.toFixed(1)}% upside
                    </p>
                  )}
                </div>
              )}
            </div>
            {(f.analyst_target_low != null || f.analyst_target_high != null) && (
              <div className="flex justify-between text-[10px] text-textDim border-t border-borderLight pt-2">
                {f.analyst_target_low != null && <span>Bear: ${f.analyst_target_low.toFixed(2)}</span>}
                {f.analyst_target != null && <span className="text-textMuted">Base: ${f.analyst_target.toFixed(2)}</span>}
                {f.analyst_target_high != null && <span>Bull: ${f.analyst_target_high.toFixed(2)}</span>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Technical Signals */}
      <div className="px-6 py-5">
        <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-3">Technical Signals</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <StatPill label="Entry Price" value={`$${s.entry_price.toFixed(4)}`} accent="border-amber-500/30" />
          {s.current_return != null && (
            <StatPill label="Current P&L"
              value={`${s.current_return >= 0 ? '+' : ''}${s.current_return.toFixed(2)}%`}
              accent={s.current_return >= 0 ? 'border-up/40' : 'border-down/40'}
            />
          )}
          {f.chg_5d != null && <StatPill label="5d Change" value={`${f.chg_5d >= 0 ? '+' : ''}${f.chg_5d.toFixed(2)}%`} accent={f.chg_5d >= 0 ? 'border-up/30' : 'border-down/30'} />}
          {f.chg_20d != null && <StatPill label="20d Change" value={`${f.chg_20d >= 0 ? '+' : ''}${f.chg_20d.toFixed(2)}%`} accent={f.chg_20d >= 0 ? 'border-up/30' : 'border-down/30'} />}
          {f.rsi_14 != null && (
            <StatPill label="RSI (14)"
              value={`${f.rsi_14.toFixed(0)} · ${f.rsi_14 > 70 ? 'Overbought' : f.rsi_14 < 30 ? 'Oversold' : 'Neutral'}`}
              accent={f.rsi_14 > 70 ? 'border-down/40' : f.rsi_14 < 30 ? 'border-up/40' : 'border-borderLight'}
            />
          )}
          {f.vol_ratio != null && (
            <StatPill label="Volume vs Avg"
              value={`${f.vol_ratio.toFixed(1)}x ${f.vol_ratio > 1.5 ? '↑ Surge' : f.vol_ratio < 0.7 ? '↓ Quiet' : '– Normal'}`}
              accent={f.vol_ratio > 1.5 ? 'border-brand-500/30' : 'border-borderLight'}
            />
          )}
          {f.avg_volume && <StatPill label="Avg Volume" value={fmtVol(f.avg_volume)} />}
          {f['52w_high'] && <StatPill label="52w High" value={`$${f['52w_high']!.toFixed(2)}`} />}
          {f['52w_low'] && <StatPill label="52w Low" value={`$${f['52w_low']!.toFixed(2)}`} />}
          {f.short_pct_float != null && <StatPill label="Short Interest" value={`${(f.short_pct_float * 100).toFixed(1)}% of float`} accent={f.short_pct_float > 0.1 ? 'border-down/30' : 'border-borderLight'} />}
          {f.next_earnings && <StatPill label="Next Earnings" value={f.next_earnings.slice(0, 10)} accent="border-amber-500/20" />}
        </div>
      </div>

      <DebateSection d={d} />
    </div>
  );
}

// ── Template: Commodity / Futures ──────────────────────────────────────────
function CommodityReportTemplate({ report }: { report: StrategyReport }) {
  const { strategy: s, fundamentals: f, chart: ch, debate: d } = report;
  const lastClose = ch.candles.at(-1)?.close ?? s.entry_price;
  const change30d = ch.candles.length >= 2
    ? ((ch.candles.at(-1)!.close - ch.candles[0].close) / ch.candles[0].close * 100)
    : null;
  const range52wLow = f['52w_low'];
  const range52wHigh = f['52w_high'];
  const posIn52w = (range52wLow != null && range52wHigh != null && range52wHigh > range52wLow)
    ? ((lastClose - range52wLow) / (range52wHigh - range52wLow) * 100)
    : null;

  // Commodity name mapping
  const commodityLabels: Record<string, string> = {
    'GC=F': 'Gold Futures', 'SI=F': 'Silver Futures', 'CL=F': 'Crude Oil WTI',
    'NG=F': 'Natural Gas', 'HG=F': 'Copper Futures',
  };
  const commodityLabel = commodityLabels[s.symbol] ?? f.name ?? s.symbol;

  // Determine if price is near support (52w low) or resistance (52w high)
  const priceZone = posIn52w != null
    ? posIn52w < 20 ? 'Near Support' : posIn52w > 80 ? 'Near Resistance' : 'Mid Range'
    : null;

  return (
    <div className="divide-y divide-borderLight">
      {/* Hero */}
      <div className="px-6 py-5 bg-gradient-to-br from-amber-950/40 to-surface">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl font-bold text-textMain font-mono">{s.symbol.replace('=F','')}</span>
              <span className="text-xs text-amber-500 font-semibold border border-amber-500/30 px-1.5 py-0.5 rounded">FUTURES</span>
              <Badge type={s.strategy_type} />
            </div>
            <p className="text-[11px] text-textDim">{commodityLabel}</p>
            {priceZone && (
              <p className={`text-[10px] mt-0.5 font-semibold ${priceZone === 'Near Support' ? 'text-up' : priceZone === 'Near Resistance' ? 'text-down' : 'text-amber-400'}`}>
                ● {priceZone}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-2xl font-light font-mono text-textMain">${lastClose.toFixed(2)}</p>
            {change30d != null && (
              <p className={`text-sm font-semibold ${change30d >= 0 ? 'text-up' : 'text-down'}`}>
                {change30d >= 0 ? '+' : ''}{change30d.toFixed(2)}% (30d)
              </p>
            )}
          </div>
        </div>
        {posIn52w != null && (
          <div>
            <div className="flex justify-between text-[9px] text-textDim mb-1">
              <span>52w Low ${range52wLow!.toFixed(2)}</span>
              <span className="text-amber-400">{posIn52w.toFixed(0)}% of annual range</span>
              <span>52w High ${range52wHigh!.toFixed(2)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-surface3 overflow-hidden">
              <div className="h-full rounded-full bg-amber-500" style={{ width: `${posIn52w}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="px-6 py-5">
        <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-3">Price & Volume — 30 Days</p>
        {ch.error ? <p className="text-xs text-textDim py-4">Chart unavailable</p>
          : <PriceVolumeChart candles={ch.candles} entryPrice={ch.entry_price} accentColor="amber" />}
      </div>

      {/* Contract & market metrics */}
      <div className="px-6 py-5">
        <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-3">Contract & Technical Data</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {f['52w_high'] && <StatPill label="52w High" value={`$${f['52w_high']!.toFixed(2)}`} accent="border-down/30" />}
          {f['52w_low'] && <StatPill label="52w Low" value={`$${f['52w_low']!.toFixed(2)}`} accent="border-up/30" />}
          {f.avg_volume && <StatPill label="Avg Volume" value={fmtVol(f.avg_volume)} />}
          <StatPill label="Entry Price" value={`$${s.entry_price.toFixed(4)}`} accent="border-amber-500/30" />
          {priceZone && <StatPill label="Price Zone"
            value={priceZone}
            accent={priceZone === 'Near Support' ? 'border-up/40' : priceZone === 'Near Resistance' ? 'border-down/40' : 'border-amber-500/30'}
          />}
          {s.current_return != null && (
            <StatPill label="Current P&L"
              value={`${s.current_return >= 0 ? '+' : ''}${s.current_return.toFixed(2)}%`}
              accent={s.current_return >= 0 ? 'border-up/40' : 'border-down/40'}
            />
          )}
          {f.chg_5d != null && <StatPill label="5d Change" value={`${f.chg_5d >= 0 ? '+' : ''}${f.chg_5d.toFixed(2)}%`} accent={f.chg_5d >= 0 ? 'border-up/30' : 'border-down/30'} />}
          {f.chg_20d != null && <StatPill label="20d Change" value={`${f.chg_20d >= 0 ? '+' : ''}${f.chg_20d.toFixed(2)}%`} accent={f.chg_20d >= 0 ? 'border-up/30' : 'border-down/30'} />}
          {f.rsi_14 != null && (
            <StatPill label="RSI (14)"
              value={`${f.rsi_14.toFixed(0)} · ${f.rsi_14 > 70 ? 'Overbought' : f.rsi_14 < 30 ? 'Oversold' : 'Neutral'}`}
              accent={f.rsi_14 > 70 ? 'border-down/40' : f.rsi_14 < 30 ? 'border-up/40' : 'border-borderLight'}
            />
          )}
          {f.vol_ratio != null && (
            <StatPill label="Volume vs Avg"
              value={`${f.vol_ratio.toFixed(1)}x ${f.vol_ratio > 1.5 ? '↑ Surge' : f.vol_ratio < 0.7 ? '↓ Quiet' : '– Normal'}`}
            />
          )}
        </div>
      </div>

      <DebateSection d={d} />
    </div>
  );
}

// ── Knowledge Graph ──────────────────────────────────────────────────────────

const KG_COLORS: Record<string, string> = {
  ASSET:     '#3b82f6',
  ENTITY:    '#8b5cf6',
  EVENT:     '#f59e0b',
  INDICATOR: '#10b981',
};

function runForceLayout(
  nodes: KGNode[], edges: KGEdge[], W: number, H: number
): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {};
  nodes.forEach((n, i) => {
    const angle = (i / Math.max(nodes.length, 1)) * 2 * Math.PI;
    pos[n.id] = {
      x: W / 2 + Math.cos(angle) * W * 0.33,
      y: H / 2 + Math.sin(angle) * H * 0.33,
    };
  });
  for (let iter = 0; iter < 100; iter++) {
    const forces: Record<string, { fx: number; fy: number }> = {};
    nodes.forEach(n => { forces[n.id] = { fx: 0, fy: 0 }; });
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = pos[a.id].x - pos[b.id].x;
        const dy = pos[a.id].y - pos[b.id].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = 3500 / (dist * dist);
        forces[a.id].fx += (dx / dist) * f; forces[a.id].fy += (dy / dist) * f;
        forces[b.id].fx -= (dx / dist) * f; forces[b.id].fy -= (dy / dist) * f;
      }
    }
    edges.forEach(e => {
      const sp = pos[e.source], tp = pos[e.target];
      if (!sp || !tp) return;
      const dx = tp.x - sp.x, dy = tp.y - sp.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (dist - 130) * 0.04 * e.confidence;
      forces[e.source].fx += (dx / dist) * f; forces[e.source].fy += (dy / dist) * f;
      forces[e.target].fx -= (dx / dist) * f; forces[e.target].fy -= (dy / dist) * f;
    });
    nodes.forEach(n => {
      pos[n.id].x = Math.max(48, Math.min(W - 48, pos[n.id].x + forces[n.id].fx * 0.12));
      pos[n.id].y = Math.max(48, Math.min(H - 48, pos[n.id].y + forces[n.id].fy * 0.12));
    });
  }
  return pos;
}

function KnowledgeGraphViewer() {
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'ASSET' | 'ENTITY' | 'EVENT' | 'INDICATOR'>('ALL');
  const [selectedNode, setSelectedNode] = useState<KGNode | null>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [tickerSearch, setTickerSearch] = useState('');
  const W = 800, H = 480;

  const loadGraph = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/knowledge-graph');
      if (res.ok) {
        const data = await res.json();
        setGraph(data);
        setPositions(runForceLayout(data.nodes.slice(0, 150), data.edges, W, H));
      }
    } finally { setLoading(false); }
  };

  const loadSubgraph = async (symbol: string) => {
    setLoading(true);
    try {
      const res = await apiFetch(`/knowledge-graph/ticker/${encodeURIComponent(symbol)}?hops=2`);
      if (res.ok) {
        const data = await res.json();
        setGraph(data);
        setPositions(runForceLayout(data.nodes, data.edges, W, H));
        setFilter('ALL');
      }
    } finally { setLoading(false); }
  };

  useEffect(() => { loadGraph(); }, []);

  const displayNodes = (graph?.nodes ?? []).slice(0, 150).filter(
    n => filter === 'ALL' || n.type === filter
  );
  const displayNodeIds = new Set(displayNodes.map(n => n.id));
  const displayEdges = (graph?.edges ?? []).filter(
    e => displayNodeIds.has(e.source) && displayNodeIds.has(e.target)
  );

  const relLabel = (r: string) => r.replace(/_/g, ' ');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-textMain">Knowledge Graph</h2>
          <p className="text-[11px] text-textDim mt-0.5">
            {graph ? `${graph.nodes.length} nodes · ${graph.edges.length} edges` : 'Persistent market intelligence network — updated each pipeline run'}
          </p>
        </div>
        <button onClick={loadGraph} disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg border border-borderMid bg-surface2 text-textMuted hover:text-textMain hover:border-brand-500/40 transition-colors disabled:opacity-50">
          {loading ? '…' : '↺ Refresh'}
        </button>
      </div>

      {/* Search + ticker subgraph */}
      <div className="flex gap-2">
        <input
          value={tickerSearch}
          onChange={e => setTickerSearch(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && tickerSearch && loadSubgraph(tickerSearch)}
          placeholder="Focus on ticker (e.g. NVDA)"
          className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-borderMid bg-surface2 text-textMain placeholder:text-textDim focus:outline-none focus:border-brand-500/60"
        />
        <button onClick={() => tickerSearch ? loadSubgraph(tickerSearch) : loadGraph()}
          className="text-xs px-3 py-1.5 rounded-lg border border-brand-500/40 bg-brand-500/10 text-brand-300 hover:bg-brand-500/20 transition-colors">
          {tickerSearch ? `Subgraph: ${tickerSearch}` : 'Full graph'}
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 flex-wrap">
        {(['ALL', 'ASSET', 'ENTITY', 'EVENT', 'INDICATOR'] as const).map(t => (
          <button key={t} onClick={() => setFilter(t)}
            className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
              filter === t
                ? 'border-brand-500 bg-brand-500/20 text-brand-300'
                : 'border-borderLight bg-surface2 text-textMuted hover:border-brand-400'
            }`}>
            {t === 'ALL' ? 'All types' : t}
            {t !== 'ALL' && graph && (
              <span className="ml-1 opacity-60">({graph.nodes.filter(n => n.type === t).length})</span>
            )}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="flex gap-4 flex-wrap">
        {Object.entries(KG_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
            <span className="text-[10px] text-textDim">{type}</span>
          </div>
        ))}
      </div>

      {/* SVG Graph */}
      <div className="rounded-xl border border-borderLight overflow-hidden bg-surface2">
        {loading ? (
          <div className="h-64 flex items-center justify-center text-textDim text-sm">Loading graph…</div>
        ) : !graph || graph.nodes.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center gap-2 px-6">
            <span className="text-3xl opacity-30">◎</span>
            <p className="text-sm text-textDim">No graph data yet</p>
            <p className="text-[11px] text-textDim">Run a pipeline to populate the knowledge graph. Nodes and relationships are extracted from market news automatically.</p>
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 480 }}>
            <defs>
              <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
                <polygon points="0 0, 6 2, 0 4" fill="#475569" />
              </marker>
            </defs>
            {/* Edges */}
            {displayEdges.map((e, i) => {
              const sp = positions[e.source], tp = positions[e.target];
              if (!sp || !tp) return null;
              const mx = (sp.x + tp.x) / 2, my = (sp.y + tp.y) / 2;
              return (
                <g key={i}>
                  <line x1={sp.x} y1={sp.y} x2={tp.x} y2={tp.y}
                    stroke="#334155" strokeWidth={e.confidence * 2 + 0.5}
                    opacity={0.55} markerEnd="url(#arrowhead)" />
                  <text x={mx} y={my} fontSize="7" fill="#475569" textAnchor="middle" dominantBaseline="middle">
                    {relLabel(e.relation)}
                  </text>
                </g>
              );
            })}
            {/* Nodes */}
            {displayNodes.map(n => {
              const p = positions[n.id];
              if (!p) return null;
              const r = n.type === 'ASSET' ? 14 : n.type === 'INDICATOR' ? 12 : 10;
              const isSelected = selectedNode?.id === n.id;
              const color = KG_COLORS[n.type] ?? '#6b7280';
              return (
                <g key={n.id} onClick={() => setSelectedNode(isSelected ? null : n)}
                  className="cursor-pointer" style={{ userSelect: 'none' }}>
                  <circle cx={p.x} cy={p.y} r={r + (isSelected ? 3 : 0)}
                    fill={color} fillOpacity={0.85}
                    stroke={isSelected ? '#fff' : color} strokeWidth={isSelected ? 2 : 0.5} strokeOpacity={0.4} />
                  <text x={p.x} y={p.y + r + 11} fontSize="8" fill="#94a3b8"
                    textAnchor="middle" dominantBaseline="middle">
                    {n.label.length > 14 ? n.label.slice(0, 13) + '…' : n.label}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* Selected node detail */}
      {selectedNode && graph && (
        <div className="bg-surface2 border border-borderLight rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-semibold text-textMain">{selectedNode.label}</span>
              <span className="text-[10px] text-textDim ml-2 font-mono">{selectedNode.id}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-2 py-0.5 rounded font-semibold"
                style={{ background: KG_COLORS[selectedNode.type] + '22', color: KG_COLORS[selectedNode.type] }}>
                {selectedNode.type}
              </span>
              <button onClick={() => setSelectedNode(null)}
                className="text-textDim hover:text-textMain text-sm leading-none">×</button>
            </div>
          </div>

          {/* Edges from/to this node */}
          {(() => {
            const nodeEdges = graph.edges.filter(
              e => e.source === selectedNode.id || e.target === selectedNode.id
            );
            if (!nodeEdges.length) return <p className="text-[11px] text-textDim">No relationships found.</p>;
            const nodesById = Object.fromEntries(graph.nodes.map(n => [n.id, n]));
            return (
              <div className="space-y-1">
                <p className="text-[10px] text-textDim uppercase tracking-wider font-semibold">Relationships ({nodeEdges.length})</p>
                {nodeEdges.slice(0, 10).map((e, i) => {
                  const isOutbound = e.source === selectedNode.id;
                  const otherId = isOutbound ? e.target : e.source;
                  const other = nodesById[otherId];
                  return (
                    <div key={i} className="flex items-center gap-2 text-[11px] text-textMuted">
                      <span className="font-mono text-textDim w-4 text-center">{isOutbound ? '→' : '←'}</span>
                      <button onClick={() => other && setSelectedNode(other)}
                        className="text-brand-400 hover:underline truncate max-w-[140px]">
                        {other?.label ?? otherId}
                      </button>
                      <span className="text-textDim text-[10px]">{relLabel(e.relation)}</span>
                      <span className="ml-auto text-textDim text-[10px]">{(e.confidence * 100).toFixed(0)}%</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* EVENT node: show compressed summary + metadata */}
          {selectedNode.type === 'EVENT' && (() => {
            const m = selectedNode.metadata as Record<string, string | number>;
            const dir = String(m.direction ?? '');
            const mag = String(m.magnitude ?? '');
            const exp = m.expires_days ? String(m.expires_days) : '';
            const sum = String(m.summary ?? '');
            if (!dir && !sum) return null;
            return (
              <div className="space-y-1.5 border-t border-borderLight pt-3">
                {dir && (
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                      dir === 'bullish' ? 'bg-up/10 text-up' :
                      dir === 'bearish' ? 'bg-down/10 text-down' :
                      'bg-surface3 text-textDim'
                    }`}>{dir.toUpperCase()}</span>
                    {mag && <span className="text-[10px] text-textDim">{mag.toUpperCase()} IMPACT</span>}
                    {exp && <span className="text-[10px] text-textDim ml-auto">expires {exp}d</span>}
                  </div>
                )}
                {sum && <p className="text-[11px] text-textMuted leading-relaxed">{sum}</p>}
              </div>
            );
          })()}

          {/* Subgraph shortcut for assets */}
          {selectedNode.type === 'ASSET' && selectedNode.symbol && (
            <button onClick={() => loadSubgraph(selectedNode.symbol!)}
              className="text-[11px] text-brand-400 hover:text-brand-300 hover:underline">
              Focus 2-hop subgraph on {selectedNode.symbol} →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Toast ────────────────────────────────────────────────────────────────────
interface Toast { id: number; msg: string; type: 'ok' | 'err' | 'info'; }
let _toastId = 0;
function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (msg: string, type: Toast['type'] = 'ok') => {
    const id = ++_toastId;
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3000);
  };
  return { toasts, push };
}
function ToastList({ toasts }: { toasts: Toast[] }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[200] flex flex-col items-center gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={`px-4 py-2 rounded-lg text-xs font-medium shadow-lg border animate-fade-in ${
          t.type === 'err' ? 'bg-down-bg border-down/30 text-down-text' :
          t.type === 'info' ? 'bg-surface2 border-borderMid text-textMain' :
          'bg-up-bg border-up/30 text-up-text'
        }`}>{t.msg}</div>
      ))}
    </div>
  );
}

// ── Strategy Report Panel (router) ─────────────────────────────────────────
function StrategyReportPanel({ report, loading, error, onClose }: { report: StrategyReport | null; loading: boolean; error?: string | null; onClose: () => void }) {
  const s = report?.strategy;
  const assetClass = s ? detectAssetClass(s.symbol, report?.fundamentals?.quote_type) : 'stock';

  const assetLabel: Record<AssetClass, string> = {
    crypto: '₿ Crypto',
    stock: '◈ Equity',
    commodity: '⛏ Commodity',
  };
  const headerAccent: Record<AssetClass, string> = {
    crypto:    'border-violet-500/30',
    stock:     'border-brand-500/30',
    commodity: 'border-amber-500/30',
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`w-full max-w-2xl h-full bg-surface border-l flex flex-col shadow-2xl overflow-hidden ${s ? headerAccent[assetClass] : 'border-borderLight'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-borderLight bg-surface2 shrink-0">
          {s ? (
            <div className="flex items-center gap-3">
              <div className={`h-9 w-9 rounded-lg border flex items-center justify-center text-xs font-bold text-textMain ${
                assetClass === 'crypto' ? 'bg-violet-950/60 border-violet-500/30 text-violet-300' :
                assetClass === 'commodity' ? 'bg-amber-950/60 border-amber-500/30 text-amber-300' :
                'bg-surface3 border-borderMid'
              }`}>
                {s.symbol.replace(/[.\-=]/g, '').substring(0, 3).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-textMain">{s.symbol}</span>
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${
                    assetClass === 'crypto' ? 'text-violet-400 border-violet-500/30 bg-violet-950/40' :
                    assetClass === 'commodity' ? 'text-amber-400 border-amber-500/30 bg-amber-950/40' :
                    'text-brand-400 border-brand-500/30 bg-brand-950/40'
                  }`}>{assetLabel[assetClass]}</span>
                </div>
                <p className="text-[11px] text-textDim mt-0.5">Strategy Report · {new Date(s.timestamp).toLocaleString()}</p>
              </div>
            </div>
          ) : (
            <span className="text-sm text-textMuted">Strategy Report</span>
          )}
          <button onClick={onClose} className="text-textDim hover:text-textMain text-xl leading-none ml-4">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3">
              <div className="w-6 h-6 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
              <p className="text-sm text-textDim">Loading report…</p>
            </div>
          ) : !report ? (
            <div className="p-6 text-center space-y-2">
              <p className="text-sm font-semibold text-down">Failed to load report</p>
              {error && <p className="text-xs text-textDim font-mono bg-surface3 rounded p-2">{error}</p>}
            </div>
          ) : assetClass === 'crypto' ? (
            <CryptoReportTemplate report={report} />
          ) : assetClass === 'commodity' ? (
            <CommodityReportTemplate report={report} />
          ) : (
            <StockReportTemplate report={report} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Stat Drawer ────────────────────────────────────────────────────────────

function StatDrawer({
  focus, onClose, activeStrategies, pendingStrategies, debates, memories, groupedMemories, onApproval,
}: {
  focus: 'active' | 'pending' | 'debates' | 'memories';
  onClose: () => void;
  activeStrategies: Strategy[];
  pendingStrategies: Strategy[];
  debates: DebateRound[];
  memories: AgentMemory[];
  groupedMemories: Record<string, AgentMemory[]>;
  onApproval: (id: number, action: string) => void;
}) {
  const [expandedDebateId, setExpandedDebateId] = useState<number | null>(null);

  const titles: Record<string, string> = {
    active:   'Active Strategies',
    pending:  'Pending Approval',
    debates:  'Debate Rounds',
    memories: 'Agent Memory Notes',
  };

  const noteColors = NOTE_COLORS;

  const renderContent = () => {
    if (focus === 'active' || focus === 'pending') {
      const list = focus === 'active' ? activeStrategies : pendingStrategies;
      if (list.length === 0)
        return <p className="text-sm text-textMuted px-5 py-10 text-center">No {focus === 'pending' ? 'pending' : 'active'} strategies.</p>;
      return (
        <div className="divide-y divide-borderLight">
          {list.map(strat => (
            <div key={strat.id} className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-surface3 border border-borderMid flex items-center justify-center text-xs font-bold text-textMain">
                    {strat.symbol.replace(/[.\-=]/g, '').substring(0, 3)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-base font-semibold text-textMain">{strat.symbol}</span>
                      <Badge type={strat.strategy_type} />
                      <StatusChip status={strat.status} />
                    </div>
                    <p className="text-[11px] text-textMuted">
                      Entry <span className="font-mono text-textMain">${strat.entry_price.toFixed(2)}</span>
                      <span className="mx-1.5 opacity-40">·</span>
                      {new Date(strat.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="shrink-0 ml-3 text-right">
                  {strat.status === 'PENDING' ? (
                    <div className="flex gap-2">
                      <button onClick={() => onApproval(strat.id, 'approve')} className="px-3 py-1.5 bg-up text-white rounded-lg text-xs font-semibold hover:opacity-80 transition-opacity">Approve</button>
                      <button onClick={() => onApproval(strat.id, 'reject')}  className="px-3 py-1.5 bg-down text-white rounded-lg text-xs font-semibold hover:opacity-80 transition-opacity">Reject</button>
                    </div>
                  ) : (
                    <div>
                      <p className="text-[10px] text-textDim uppercase tracking-wider mb-0.5">Return</p>
                      <p className={`text-xl font-light tabular-nums ${strat.current_return >= 0 ? 'text-up' : 'text-down'}`}>
                        {strat.current_return >= 0 ? '+' : ''}{(strat.current_return ?? 0).toFixed(2)}%
                      </p>
                    </div>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-textMuted leading-relaxed border-t border-borderLight pt-2 mt-2">{strat.reasoning_summary}</p>
            </div>
          ))}
        </div>
      );
    }

    if (focus === 'debates') {
      if (debates.length === 0)
        return <p className="text-sm text-textMuted px-5 py-10 text-center">No debate rounds yet.</p>;
      return (
        <div className="divide-y divide-borderLight">
          {debates.map(debate => {
            const isExpanded = expandedDebateId === debate.id;
            const proposals: Proposal[] = (() => { try { return JSON.parse(debate.proposals_json); } catch { return []; } })();
            const isLong = debate.consensus_action === 'LONG';
            return (
              <div key={debate.id}>
                <button
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface2 transition-colors text-left"
                  onClick={() => setExpandedDebateId(isExpanded ? null : debate.id)}
                >
                  <div className="flex items-center gap-3">
                    <div className={`h-2 w-2 rounded-full ${isLong ? 'bg-up' : 'bg-down'}`} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-textMain">{debate.consensus_ticker}</span>
                        <Badge type={debate.consensus_action} />
                        <span className="text-[11px] text-textMuted bg-surface3 px-2 py-0.5 rounded font-mono">{debate.consensus_votes} votes</span>
                      </div>
                      <p className="text-[11px] text-textDim mt-0.5">{new Date(debate.timestamp).toLocaleString()}</p>
                    </div>
                  </div>
                  <span className="text-textDim text-xs">{isExpanded ? '▲' : '▼'}</span>
                </button>
                {isExpanded && (
                  <div className="bg-background/40 border-t border-borderLight px-5 py-4 space-y-3">
                    <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider">Agent Proposals</p>
                    {proposals.map((p, i) => (
                      <div key={i} className="bg-surface border border-borderLight rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-semibold text-brand-400">{p.agent_name}</span>
                          <span className="flex items-center gap-1.5"><Badge type={p.action} /><span className="text-[10px] text-textDim font-mono">{p.ticker}</span></span>
                        </div>
                        <p className="text-[11px] text-textMuted leading-relaxed">{p.reasoning}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    }

    if (focus === 'memories') {
      if (memories.length === 0)
        return <p className="text-sm text-textMuted px-5 py-10 text-center">No memory notes yet.</p>;
      return (
        <div className="divide-y divide-borderLight">
          {Object.entries(groupedMemories).map(([agentName, agentMemories]) => (
            <div key={agentName} className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-7 w-7 rounded-md bg-brand-600/20 border border-brand-500/30 flex items-center justify-center text-brand-400 font-bold text-[10px]">
                  {agentName.split(' ').map((w: string) => w[0]).join('')}
                </div>
                <span className="text-sm font-semibold text-textMain">{agentName}</span>
                <span className="text-[10px] text-textDim bg-surface3 px-1.5 py-0.5 rounded-full">{agentMemories.length}</span>
              </div>
              <div className="space-y-2">
                {agentMemories.map(m => (
                  <div key={m.id} className="bg-surface2 border border-borderLight rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${noteColors[m.note_type] ?? 'text-textDim bg-surface3'}`}>{m.note_type}</span>
                      <span className="text-[10px] text-textDim">{new Date(m.created_at).toLocaleString()}</span>
                    </div>
                    <p className="text-[11px] text-textMuted leading-relaxed">{m.content}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  const counts: Record<string, number> = {
    active: activeStrategies.length, pending: pendingStrategies.length,
    debates: debates.length, memories: memories.length,
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={onClose} />
      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-surface border-l border-borderLight z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-borderLight bg-surface2 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-textMain">{titles[focus]}</h2>
            <p className="text-[11px] text-textMuted">{counts[focus]} item{counts[focus] !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-surface3 text-textMuted hover:text-textMain transition-colors text-lg">✕</button>
        </div>
        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {renderContent()}
        </div>
      </div>
    </>
  );
}

// ── Login modal (used inside landing page) ────────────────────────────────

function LoginModal({ onLogin, onClose }: { onLogin: () => void; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        const { token } = await res.json();
        setToken(token);
        onLogin();
      } else if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail ?? 'Too many attempts. Please wait before trying again.');
      } else {
        setError('Incorrect password. Try again.');
        setPassword('');
      }
    } catch {
      setError('Could not reach the server. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm mx-4 rounded-2xl p-8 shadow-2xl space-y-6"
        style={{ background: '#161b22', border: '1px solid #374151' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xl font-bold tracking-tight" style={{ color: '#f1f5f9' }}>
              market-analysis<span style={{ color: '#60a5fa' }}>.space</span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: '#94a3b8' }}>Enter your access password</p>
          </div>
          <button onClick={onClose} className="text-xl leading-none transition-colors" style={{ color: '#64748b' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#f1f5f9')}
            onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}>×</button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <input
            autoFocus
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full px-4 py-3 rounded-xl text-sm transition-colors focus:outline-none"
            style={{ background: '#0d1117', border: '1px solid #1e293b', color: '#f1f5f9' }}
            onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
            onBlur={e => (e.currentTarget.style.borderColor = '#1e293b')}
          />
          {error && (
            <p className="text-xs rounded-lg px-3 py-2" style={{ color: '#f87171', background: 'rgba(153,27,27,0.2)', border: '1px solid rgba(153,27,27,0.4)' }}>{error}</p>
          )}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
            style={{ background: '#3b82f6', color: '#fff' }}
            onMouseEnter={e => { if (!loading && password) e.currentTarget.style.background = '#60a5fa'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#3b82f6'; }}>
            {loading ? 'Signing in…' : 'Open Dashboard →'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Landing page ────────────────────────────────────────────────────────────

function LandingPage({ onLogin }: { onLogin: () => void }) {
  const [showLogin, setShowLogin] = useState(false);

  // Ticker data for the tape
  const tickers = [
    { sym: 'NVDA',        price: '$875.40',  chg: '+3.21%', up: true  },
    { sym: 'AAPL',        price: '$192.35',  chg: '−0.84%', up: false },
    { sym: 'BTC-USD',     price: '$67,420',  chg: '+2.15%', up: true  },
    { sym: 'MSFT',        price: '$415.20',  chg: '+1.02%', up: true  },
    { sym: 'ETH-USD',     price: '$3,512',   chg: '−1.40%', up: false },
    { sym: 'RELIANCE.NS', price: '₹2,890',   chg: '+0.76%', up: true  },
    { sym: 'GC=F',        price: '$2,145',   chg: '+0.32%', up: true  },
    { sym: 'META',        price: '$512.80',  chg: '+2.67%', up: true  },
    { sym: 'TCS.NS',      price: '₹3,945',   chg: '−0.55%', up: false },
    { sym: 'SOL-USD',     price: '$168.90',  chg: '+4.12%', up: true  },
    { sym: 'TSLA',        price: '$248.60',  chg: '−2.10%', up: false },
    { sym: 'CL=F',        price: '$82.40',   chg: '+0.91%', up: true  },
  ];

  const TickerTape = () => (
    <div className="w-full overflow-hidden border-y border-borderLight bg-surface">
      <div className="flex animate-[ticker_30s_linear_infinite] hover:[animation-play-state:paused] py-3 whitespace-nowrap">
        {[...tickers, ...tickers].map((t, i) => (
          <div key={i} className="inline-flex items-center gap-2.5 px-6 border-r border-borderLight shrink-0">
            <span className="text-[13px] font-bold font-mono text-textMain">{t.sym}</span>
            <span className="text-[13px] font-mono text-textMuted">{t.price}</span>
            <span className={`text-[11px] font-bold font-mono ${t.up ? 'text-up' : 'text-down'}`}>
              {t.up ? '▲' : '▼'} {t.chg}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  const features = [
    { icon: '⟳', title: 'Live Pipeline',       desc: 'Watch every debate step unfold in real-time — research, agent queries, consensus verdict, and deployment.',   accent: '#3b82f6' },
    { icon: '$',  title: 'Portfolio P&L',       desc: 'Track unrealized and realized returns across all active positions with automatic stop-loss and take-profit.',   accent: '#10b981' },
    { icon: '◉', title: 'Agent Memory',         desc: 'Each agent accumulates persistent observations and lessons across rounds, shaping future decisions over time.', accent: '#8b5cf6' },
    { icon: '🧬', title: 'Darwinian Evolution', desc: 'Underperforming agents are automatically rewritten — their strategy either mutates or inherits from elite peers.', accent: '#f59e0b' },
    { icon: '◈', title: 'Markets & Watchlist',  desc: 'Monitor US, India, Crypto, and Commodities. Add any ticker via search. Active positions surface at the top.',   accent: '#14b8a6' },
    { icon: '⚙', title: 'Full Control',         desc: 'Configure markets, schedule, approval mode, agent prompts, and trading budget entirely from the dashboard.',    accent: '#f43f5e' },
  ];

  return (
    <div className="landing-root bg-[#0d1117] text-textMain font-sans antialiased overflow-x-hidden">
      <style>{`
        @keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .5; transform: scale(.8); } }
        @keyframes fade-up { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .landing-section { max-width: 1200px; margin: 0 auto; padding: 96px 24px; }
        .animate-fade-up { animation: fade-up .6s ease both; }
        .delay-100 { animation-delay: .1s; }
        .delay-200 { animation-delay: .2s; }
        .delay-300 { animation-delay: .3s; }
        .delay-400 { animation-delay: .4s; }
        .delay-500 { animation-delay: .5s; }
        /* Force dark-mode color tokens inside landing page regardless of OS theme */
        .landing-root { --color-textMain: #f1f5f9; --color-textMuted: #94a3b8; --color-textDim: #64748b; --color-borderLight: #1e293b; --color-borderMid: #374151; --color-surface2: #161b22; --color-surface3: #1e2630; }
      `}</style>

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-8 h-16 bg-[#0d1117]/90 backdrop-blur-md border-b border-borderLight">
        <div className="text-xl font-extrabold tracking-tight">market-analysis<span className="text-brand-400">.space</span></div>
        <div className="hidden md:flex items-center gap-8 text-sm text-textMuted">
          {['How it works', 'Features', 'Agents', 'Markets'].map(l => (
            <a key={l} href={`#${l.toLowerCase().replace(/ /g,'-')}`} className="hover:text-textMain transition-colors">{l}</a>
          ))}
        </div>
        <button
          onClick={() => setShowLogin(true)}
          className="px-5 py-2 rounded-lg bg-brand-500 hover:bg-brand-400 text-white text-sm font-semibold transition-all hover:-translate-y-px">
          Open Dashboard →
        </button>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center text-center px-6 pt-28 pb-20 overflow-hidden">
        {/* radial glow */}
        <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[900px] h-[600px] pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at center, rgba(59,130,246,.18) 0%, transparent 70%)' }} />
        <div className="absolute bottom-0 left-0 right-0 h-40 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, transparent, #0d1117)' }} />

        <div className="animate-fade-up inline-flex items-center gap-2 text-[11px] font-semibold tracking-widest uppercase text-brand-400 bg-brand-900/40 border border-brand-700/40 rounded-full px-4 py-1.5 mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-400 inline-block" style={{ animation: 'pulse-dot 2s infinite' }}></span>
          Live · Multiple AI Agents Debating Now
        </div>

        <h1 className="animate-fade-up delay-100 text-[clamp(40px,6vw,80px)] font-extrabold tracking-[-2px] leading-[1.07] max-w-4xl mb-6">
          Multiple AI Agents.<br/>
          One{' '}
          <span style={{ background: 'linear-gradient(135deg,#60a5fa,#818cf8,#a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            Market Consensus.
          </span>
        </h1>

        <p className="animate-fade-up delay-200 text-[clamp(16px,2vw,20px)] text-textMuted leading-relaxed max-w-xl mb-12">
          A multi-agent system where AI analysts debate every trade — then vote on a LONG or SHORT strategy. Continuously evolving through Darwinian selection.
        </p>

        <div className="animate-fade-up delay-300 flex items-center gap-4 flex-wrap justify-center mb-20">
          <button
            onClick={() => setShowLogin(true)}
            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-brand-500 hover:bg-brand-400 text-white font-semibold text-[15px] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(59,130,246,.35)]">
            Open Dashboard
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <a href="#how-it-works" className="inline-flex items-center gap-2 px-7 py-4 rounded-xl border border-borderMid text-textMuted hover:text-textMain hover:border-textDim font-medium text-[15px] transition-all hover:-translate-y-0.5">
            See how it works
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M4 9l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </a>
        </div>

        {/* Stats */}
        <div className="animate-fade-up delay-400 flex items-center gap-10 flex-wrap justify-center">
          {[['AI', 'Agents'], ['28+', 'Tracked Tickers'], ['4', 'Markets'], ['∞', 'Evolution Cycles']].map(([n, l], i) => (
            <div key={i} className="flex items-center gap-10">
              {i > 0 && <div className="w-px h-9 bg-borderLight hidden sm:block" />}
              <div className="text-center">
                <div className={`text-3xl font-extrabold tracking-tight ${i === 0 || i === 3 ? 'text-brand-400' : 'text-textMain'}`}>{n}</div>
                <div className="text-[11px] text-textDim uppercase tracking-widest mt-0.5">{l}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Ticker tape ──────────────────────────────────────────────────── */}
      <TickerTape />

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <div id="how-it-works" className="border-t border-borderLight">
        <div className="landing-section">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-brand-400 mb-4">How it works</p>
          <h2 className="text-[clamp(26px,4vw,44px)] font-extrabold tracking-tight leading-tight mb-14">From market data to deployed strategy</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-borderLight rounded-2xl overflow-hidden">
            {[
              { n: '01', icon: '⌖', title: 'Research',   desc: 'Live market news and price data shared across all agents each cycle.' },
              { n: '02', icon: '◉', title: 'Debate',     desc: 'Multiple AI agents run in parallel — each proposes a ticker and LONG/SHORT.' },
              { n: '03', icon: '⚖', title: 'Consensus',  desc: 'A Judge LLM picks the majority vote and records the reasoning.' },
              { n: '04', icon: '◈', title: 'Learn',      desc: 'Strategies close at SL/TP. Weak agents evolve via Darwinian selection.' },
            ].map(s => (
              <div key={s.n} className="bg-[#0d1117] p-8">
                <div className="text-[10px] font-bold font-mono text-brand-400 uppercase tracking-widest mb-3">{s.n}</div>
                <div className="text-2xl mb-3">{s.icon}</div>
                <h3 className="text-[15px] font-bold mb-2">{s.title}</h3>
                <p className="text-[12px] text-textMuted leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <div id="features" className="border-t border-borderLight">
        <div className="landing-section">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-brand-400 mb-4">Features</p>
          <h2 className="text-[clamp(26px,4vw,44px)] font-extrabold tracking-tight leading-tight mb-12">Everything in one dashboard</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map(f => (
              <div key={f.title} className="rounded-2xl border border-[#1e293b] bg-[#161b22] p-7 hover:border-[#374151] hover:-translate-y-0.5 transition-all">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg mb-5"
                  style={{ background: `${f.accent}22`, border: `1px solid ${f.accent}44` }}>
                  {f.icon}
                </div>
                <h3 className="text-[15px] font-bold mb-2 text-[#f1f5f9]">{f.title}</h3>
                <p className="text-[13px] leading-relaxed text-[#94a3b8]">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <div className="border-t border-borderLight relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(59,130,246,.1) 0%, transparent 70%)' }} />
        <div className="landing-section text-center relative">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-brand-400 mb-5">Get started</p>
          <h2 className="text-[clamp(32px,5vw,56px)] font-extrabold tracking-tight leading-tight mb-5">
            Ready to let AI<br/>
            <span style={{ background: 'linear-gradient(135deg,#60a5fa,#a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              debate your trades?
            </span>
          </h2>
          <p className="text-[18px] text-textMuted leading-relaxed max-w-md mx-auto mb-12">
            Self-hosted, fully configurable, and always evolving. Deploy your own instance in minutes.
          </p>
          <button
            onClick={() => setShowLogin(true)}
            className="inline-flex items-center gap-2 px-10 py-5 rounded-xl bg-brand-500 hover:bg-brand-400 text-white font-semibold text-[16px] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(59,130,246,.4)]">
            Open Dashboard
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-borderLight px-8 py-10 flex items-center justify-between flex-wrap gap-5">
        <div className="text-[16px] font-extrabold">market-analysis<span className="text-brand-400">.space</span></div>
        <ul className="flex gap-7 list-none">
          {['How it works','Features','Agents','Markets'].map(l => (
            <li key={l}><a href={`#${l.toLowerCase().replace(/ /g,'-')}`} className="text-[13px] text-textDim hover:text-textMuted transition-colors">{l}</a></li>
          ))}
        </ul>
        <div className="text-[12px] text-textDim">© {new Date().getFullYear()} market-analysis.space · AI-powered market analysis</div>
      </footer>

      {/* ── Login modal ──────────────────────────────────────────────────── */}
      {showLogin && <LoginModal onLogin={onLogin} onClose={() => setShowLogin(false)} />}
    </div>
  );
}


// ── Main App ───────────────────────────────────────────────────────────────

function AppInner() {
  const { toasts, push: toast } = useToast();
  const [predictions, setPredictions]       = useState<Prediction[]>([]);
  const [strategies, setStrategies]         = useState<Strategy[]>([]);
  const [markets, setMarkets]               = useState<MarketConfig[]>(() => {
    try { return JSON.parse(localStorage.getItem('markets') ?? 'null') ?? []; } catch { return []; }
  });
  const [debates, setDebates]               = useState<DebateRound[]>([]);
  const [memories, setMemories]             = useState<AgentMemory[]>([]);
  const [agents, setAgents]                 = useState<AgentPrompt[]>([]);
  const [agentFitness, setAgentFitness]     = useState<AgentFitness[]>([]);
  const [agentEvolution, setAgentEvolution] = useState<AgentEvolution[]>([]);
  const [evolutionAgent, setEvolutionAgent] = useState<string | null>(null);
  const [research, setResearch]             = useState<WebResearch[]>(() => { try { return JSON.parse(localStorage.getItem('cache_research') ?? 'null') ?? []; } catch { return []; } });
  const [liveQuotes, setLiveQuotes]         = useState<LiveQuote[]>(() => { try { return JSON.parse(localStorage.getItem('cache_quotes') ?? 'null') ?? []; } catch { return []; } });
  const [marketEvents, setMarketEvents]     = useState<MarketEvent[]>(() => { try { return JSON.parse(localStorage.getItem('cache_market_events') ?? 'null') ?? []; } catch { return []; } });
  const [quotesLoading, setQuotesLoading]   = useState(false);
  const [quotesMarketTab, setQuotesMarketTab] = useState<string>('');
  const [quotesStockTab, setQuotesStockTab]   = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('watchlist') ?? 'null') ?? []; } catch { return []; }
  });
  const [marketsSearchOpen, setMarketsSearchOpen] = useState(false);
  const [marketsSearchQuery, setMarketsSearchQuery] = useState('');
  const [marketsSearchResults, setMarketsSearchResults] = useState<{ symbol: string; name: string; sector: string; exchange: string; type: string }[]>([]);
  const [marketsSearchLoading, setMarketsSearchLoading] = useState(false);
  const marketsSearchTimer = useState<ReturnType<typeof setTimeout> | null>(null);
  const [portfolio, setPortfolio]           = useState<PortfolioPnl | null>(null);
  const [editStratId, setEditStratId]       = useState<number | null>(null);
  const [editStratForm, setEditStratForm]   = useState<{ position_size: string; notes: string }>({ position_size: '', notes: '' });
  const [reportStratId, setReportStratId]   = useState<number | null>(null);
  const [reportData, setReportData]         = useState<StrategyReport | null>(null);
  const [reportLoading, setReportLoading]   = useState(false);
  const [budgetInput, setBudgetInput]       = useState<string>('10000');
  const [approvalMode, setApprovalMode]     = useState('auto');
  const [scheduleInterval, setScheduleInterval] = useState<number>(60);
  const [isTriggering, setIsTriggering]     = useState(false);
  const isTriggeringRef = useRef(false);
  const [investmentFocus, setInvestmentFocus] = useState('');
  const [investmentFocusSaved, setInvestmentFocusSaved] = useState(false);
  const [strategiesLoaded, setStrategiesLoaded] = useState(false);
  const [page, setPage]                     = useState<Page>('dashboard');
  const [darkMode, setDarkMode]             = useState<boolean>(() => {
    const saved = localStorage.getItem('theme');
    // Use saved preference, otherwise follow browser/OS preference
    const isDark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(isDark);
    return isDark;
  });
  const [selectedAgent, setSelectedAgent]   = useState<string | null>(null);
  const [editingPromptAgent, setEditingPromptAgent] = useState<string | null>(null);
  const [editPromptText, setEditPromptText] = useState('');

  // Dashboard inline timeline
  const [expandedDebateId, setExpandedDebateId]   = useState<number | null>(null);
  const [timelineTicker, setTimelineTicker]       = useState<string | null>(null);

  const loadEvolution = async (agentName: string) => {
    const res = await apiFetch(`/agents/evolution/${encodeURIComponent(agentName)}`);
    if (res.ok) setAgentEvolution(await res.json());
    setEvolutionAgent(agentName);
  };

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    applyTheme(next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };

  // Follow OS theme changes unless user has manually set a preference
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('theme')) {
        setDarkMode(e.matches);
        applyTheme(e.matches);
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const fetchData = async () => {
    try {
      const [stratRes, predRes, mktRes, debRes, appRes, memRes, resRes, schedRes, statRes, agentRes] = await Promise.all([
        apiFetch('/strategies'), apiFetch('/predictions'),
        apiFetch('/config/markets'), apiFetch('/debates'), apiFetch('/config/approval_mode'),
        apiFetch('/memory'), apiFetch('/research'), apiFetch('/config/schedule'), apiFetch('/system/status'),
        apiFetch('/agents'),
      ]);
      if (stratRes.ok) setStrategies(await stratRes.json());
      setStrategiesLoaded(true);
      if (predRes.ok) setPredictions(await predRes.json());
      if (mktRes.ok) { const mktData = await mktRes.json(); setMarkets(mktData); localStorage.setItem('markets', JSON.stringify(mktData)); }
      if (debRes.ok) setDebates(await debRes.json());
      if (appRes.ok) { const d = await appRes.json(); setApprovalMode(d.approval_mode); }
      if (memRes.ok) setMemories(await memRes.json());
      if (resRes.ok) { const d = await resRes.json(); setResearch(d); try { localStorage.setItem('cache_research', JSON.stringify(d)); } catch {} }
      if (schedRes.ok) { const d = await schedRes.json(); setScheduleInterval(d.interval_minutes); }
      if (statRes.ok) { const d = await statRes.json(); setIsTriggering(d.is_running); }
      if (agentRes.ok) setAgents(await agentRes.json());
      const [fitnessRes, budgetRes, pnlRes, focusRes] = await Promise.all([
        apiFetch('/agents/fitness'),
        apiFetch('/config/budget'),
        apiFetch('/portfolio/pnl'),
        apiFetch('/config/investment_focus'),
      ]);
      if (fitnessRes.ok) setAgentFitness(await fitnessRes.json());
      if (budgetRes.ok) { const d = await budgetRes.json(); setBudgetInput(d.trading_budget.toString()); }
      if (pnlRes.ok) setPortfolio(await pnlRes.json());
      if (focusRes.ok) { const d = await focusRes.json(); setInvestmentFocus(d.investment_focus ?? ''); }
    } catch (e) { console.error('Fetch error', e); }
  };

  const fetchQuotes = async () => {
    setQuotesLoading(true);
    try {
      const [qRes, eRes] = await Promise.all([
        apiFetch('/quotes'),
        apiFetch('/market/events'),
      ]);
      if (qRes.ok) { const d = await qRes.json(); setLiveQuotes(d); try { localStorage.setItem('cache_quotes', JSON.stringify(d)); } catch {} }
      if (eRes.ok) { const d = await eRes.json(); setMarketEvents(d); try { localStorage.setItem('cache_market_events', JSON.stringify(d)); } catch {} }
    } catch (e) { console.error('Quotes fetch error', e); }
    finally { setQuotesLoading(false); }
  };

  // Fetch quotes on login and refresh every 30s in the background
  useEffect(() => {
    fetchQuotes();
    const i = setInterval(fetchQuotes, 30000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 10000); return () => clearInterval(i); }, []);

  // Background live P&L refresh — polls every 30s regardless of active page
  useEffect(() => {
    const fetchPnl = async () => {
      try {
        const res = await apiFetch('/portfolio/pnl');
        if (res.ok) setPortfolio(await res.json());
      } catch (e) { /* silent */ }
    };
    fetchPnl();
    const i = setInterval(fetchPnl, 30000);
    return () => clearInterval(i);
  }, []);

  // Dedicated pipeline poller — 2s while running, 8s while idle.
  // triggerPollRef lets handleManualTrigger kick an immediate poll and switch to fast mode.
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerPollRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const pollPipeline = async () => {
      try {
        const res = await apiFetch('/pipeline/events');
        if (res.ok) {
          const data = await res.json();
          const running = !!data.is_running;
          isTriggeringRef.current = running;
          setIsTriggering(running);
          setPipelineRunId(data.run_id ?? null);
          // Only populate live events while a run is actively in progress.
          // When idle, live tab shows the blueprint — past runs show completed events.
          if (running) {
            setPipelineEvents(data.events ?? []);
          } else {
            setPipelineEvents([]);
          }
        }
      } catch { /* ignore */ }
      try {
        const r = await apiFetch('/pipeline/runs');
        if (r.ok) {
          const runs = await r.json();
          setPipelineRuns(runs);
        }
      } catch { /* ignore */ } finally {
        setPipelineRunsLoaded(true);
      }
      // Schedule next poll — 2s when running, 8s when idle
      pollTimerRef.current = setTimeout(pollPipeline, isTriggeringRef.current ? 2000 : 8000);
    };

    // Expose a way for handleManualTrigger to cancel pending timer and poll immediately
    triggerPollRef.current = () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollPipeline();
    };

    pollPipeline();
    return () => { if (pollTimerRef.current) clearTimeout(pollTimerRef.current); };
  }, []);

  const loadRunEvents = async (runId: string) => {
    if (selectedRunId === runId) { setSelectedRunId(null); setSelectedRunEvents([]); return; }
    setSelectedRunId(runId);
    setSelectedRunEvents([]);
    setSelectedRunLoading(true);
    try {
      const res = await apiFetch(`/pipeline/runs/${runId}`);
      if (res.ok) { const d = await res.json(); setSelectedRunEvents(d.events ?? []); }
    } catch { /* ignore */ } finally {
      setSelectedRunLoading(false);
    }
  };

  const toggleMarket = (name: string, enabled: number) => {
    const v = !enabled;
    // Update UI immediately, fire API in background
    setMarkets(p => { const updated = p.map(m => m.market_name === name ? { ...m, is_enabled: v ? 1 : 0 } : m); localStorage.setItem('markets', JSON.stringify(updated)); return updated; });
    apiFetch('/config/markets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ market_name: name, is_enabled: v }]) }).catch(console.error);
  };

  const setMode = (mode: string) => {
    setApprovalMode(mode);
    apiFetch('/config/approval_mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approval_mode: mode }) }).catch(console.error);
  };

  const handleApproval = (id: number, action: string) => {
    // Optimistic: remove from pending immediately
    setStrategies(p => p.map(s => s.id === id ? { ...s, status: action === 'approve' ? 'ACTIVE' : 'REJECTED' } : s));
    apiFetch('/strategies/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ strategy_id: id, action }) })
      .then(r => { if (r.ok) { toast(action === 'approve' ? 'Strategy approved' : 'Strategy rejected'); fetchData(); } else toast('Action failed', 'err'); })
      .catch(() => toast('Network error', 'err'));
  };

  const handleUndeploy = (id: number) => {
    if (!confirm('Close this strategy at current market price?')) return;
    setStrategies(p => p.map(s => s.id === id ? { ...s, status: 'CLOSED' } : s));
    apiFetch(`/strategies/${id}/undeploy`, { method: 'POST' })
      .then(r => { if (r.ok) { toast('Position closed'); fetchData(); } else toast('Failed to close', 'err'); })
      .catch(() => toast('Network error', 'err'));
  };

  const handleStrategyUpdate = (id: number) => {
    const body: Record<string, unknown> = {};
    if (editStratForm.position_size !== '') body.position_size = parseFloat(editStratForm.position_size);
    if (editStratForm.notes !== '') body.notes = editStratForm.notes;
    setEditStratId(null);
    apiFetch(`/strategies/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => { if (r.ok) { toast('Strategy updated'); fetchData(); } else toast('Update failed', 'err'); })
      .catch(() => toast('Network error', 'err'));
  };

  const [reportError, setReportError] = useState<string | null>(null);
  const openReport = async (id: number) => {
    setReportStratId(id);
    setReportData(null);
    setReportError(null);
    setReportLoading(true);
    try {
      const res = await apiFetch(`/strategies/${id}/report`);
      if (res.ok) {
        setReportData(await res.json());
      } else {
        const body = await res.json().catch(() => ({}));
        setReportError(`${body.detail ?? `HTTP ${res.status}`} (strategy #${id})`);
      }
    } catch (e: unknown) {
      setReportError(e instanceof Error ? e.message : 'Network error');
    }
    finally { setReportLoading(false); }
  };

  const handleBudgetSave = (val: number) => {
    apiFetch('/config/budget', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trading_budget: val }) }).catch(console.error);
  };

  const [focusTickers, setFocusTickers] = useState<string[]>([]);
  const [focusSearch, setFocusSearch] = useState('');
  const [focusSearchOpen, setFocusSearchOpen] = useState(false);
  const [focusSectorFilter, setFocusSectorFilter] = useState<{ market: string; sector: string } | null>(null);
  const [tickerSearchResults, setTickerSearchResults] = useState<{ symbol: string; name: string; sector: string; exchange: string; type: string }[]>([]);
  const [tickerSearchLoading, setTickerSearchLoading] = useState(false);
  const focusSearchTimer = useState<ReturnType<typeof setTimeout> | null>(null);

  const saveInvestmentFocus = (text: string) => {
    setInvestmentFocusSaved(true);
    setTimeout(() => setInvestmentFocusSaved(false), 2000);
    apiFetch('/config/investment_focus', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ investment_focus: text }),
    }).catch(console.error);
  };

  const handleManualTrigger = (tickers?: string[]) => {
    if (isTriggering) return;
    isTriggeringRef.current = true;
    setIsTriggering(true);
    const body = tickers && tickers.length > 0 ? { tickers } : {};
    // Fire-and-forget — the pipeline runs synchronously on the backend (~3 min).
    // Immediately reschedule the poller to fast mode (500ms) so we catch is_running=true quickly.
    setTimeout(() => { triggerPollRef.current?.(); }, 500);
    apiFetch('/trigger', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'error') { isTriggeringRef.current = false; setIsTriggering(false); alert(data.message); }
        else { setTimeout(() => { triggerPollRef.current?.(); fetchData(); }, 1000); }
      })
      .catch(() => { isTriggeringRef.current = false; setIsTriggering(false); });
  };

  const handleScheduleUpdate = (minutes: number) => {
    setScheduleInterval(minutes);
    apiFetch('/config/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ interval_minutes: minutes }) })
      .then(() => apiFetch('/system/sync_schedule', { method: 'POST' }))
      .catch(console.error);
  };

  // Timeline grouping
  const enabledMarketNames = markets.length > 0
    ? markets.filter(m => m.is_enabled).map(m => m.market_name)
    : ['US', 'India', 'Crypto', 'MCX'];

  const debatesByMarketAndTicker: Record<string, Record<string, DebateRound[]>> = {};
  for (const debate of debates) {
    const market = getMarketForTicker(debate.consensus_ticker);
    if (!enabledMarketNames.includes(market)) continue;
    if (!debatesByMarketAndTicker[market]) debatesByMarketAndTicker[market] = {};
    if (!debatesByMarketAndTicker[market][debate.consensus_ticker]) debatesByMarketAndTicker[market][debate.consensus_ticker] = [];
    debatesByMarketAndTicker[market][debate.consensus_ticker].push(debate);
  }
  const groupedMemories = memories.reduce((acc, m) => {
    (acc[m.agent_name] = acc[m.agent_name] || []).push(m);
    return acc;
  }, {} as Record<string, AgentMemory[]>);

  const [expandedStratMarket, setExpandedStratMarket] = useState<string>('US');
  const [expandedStratTicker, setExpandedStratTicker] = useState<string | null>(null);
  const [pipelineEvents, setPipelineEvents]       = useState<PipelineEvent[]>([]);
  const [pipelineRunId, setPipelineRunId]         = useState<string | null>(null);
  const [researchStepOpen, setResearchStepOpen]   = useState(false);
  const [pendingDropdownOpen, setPendingDropdownOpen] = useState(false);
  const [pipelineRuns, setPipelineRuns]           = useState<PipelineRun[]>([]);
  const [pipelineRunsLoaded, setPipelineRunsLoaded] = useState(false);
  const [selectedRunId, setSelectedRunId]         = useState<string | null>(null);
  const [selectedRunEvents, setSelectedRunEvents] = useState<PipelineEvent[]>([]);
  const [selectedRunLoading, setSelectedRunLoading] = useState(false);
  const [statFocus, setStatFocus]           = useState<'active' | 'pending' | 'debates' | 'memories' | null>(null);

  // Track run transitions: new run started → go to Live; run finished → show completed run
  const prevIsTriggering = useRef(false);
  const prevPipelineRunId = useRef<string | null>(null);
  useEffect(() => {
    const wasRunning = prevIsTriggering.current;
    const isNowRunning = isTriggering;
    if (!wasRunning && isNowRunning) {
      // New run just started — switch to Live view and clear old state
      setSelectedRunId(null);
      setSelectedRunEvents([]);
    } else if (wasRunning && !isNowRunning && pipelineRunId) {
      // Run just finished — auto-select it in past runs, reset Live to blueprint
      setPipelineEvents([]);
      setSelectedRunId(pipelineRunId);
      setSelectedRunEvents([]);
      setSelectedRunLoading(true);
      apiFetch(`/pipeline/runs/${pipelineRunId}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setSelectedRunEvents(d.events ?? []); })
        .catch(() => {})
        .finally(() => setSelectedRunLoading(false));
    }

    prevIsTriggering.current = isNowRunning;
    prevPipelineRunId.current = pipelineRunId;
  }, [isTriggering, pipelineRunId]);

  const activeStrategies = strategies.filter(s => s.status === 'ACTIVE');
  const pendingStrategies = strategies.filter(s => s.status === 'PENDING');

  // Group strategies by market → ticker
  const strategiesByMarketAndTicker: Record<string, Record<string, Strategy[]>> = {};
  for (const strat of strategies) {
    const market = getMarketForTicker(strat.symbol);
    if (!strategiesByMarketAndTicker[market]) strategiesByMarketAndTicker[market] = {};
    if (!strategiesByMarketAndTicker[market][strat.symbol]) strategiesByMarketAndTicker[market][strat.symbol] = [];
    strategiesByMarketAndTicker[market][strat.symbol].push(strat);
  }
  const marketsWithStrategies = Object.keys(strategiesByMarketAndTicker);
  const activeStratMarket = marketsWithStrategies.includes(expandedStratMarket) ? expandedStratMarket : (marketsWithStrategies[0] ?? 'US');

  // ── Stats bar ──────────────────────────────────────────────────────────────
  const stats: { key: 'active' | 'pending' | 'debates' | 'memories'; label: string; value: number; color: string; hint: string }[] = [
    { key: 'active',   label: 'Active Strategies', value: activeStrategies.length,  color: 'text-up',         hint: 'View all active strategies' },
    { key: 'pending',  label: 'Pending Approval',  value: pendingStrategies.length, color: 'text-amber-400',  hint: 'Review & approve pending strategies' },
    { key: 'debates',  label: 'Debate Rounds',     value: debates.length,           color: 'text-brand-400',  hint: 'Browse debate history' },
    { key: 'memories', label: 'Agent Memories',    value: memories.length,          color: 'text-purple-400', hint: 'Inspect agent memory notes' },
  ];

  // ── Pages ──────────────────────────────────────────────────────────────────

  const renderDashboard = () => (
    <div className="space-y-6">
      {/* Stats row — clickable */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => (
          <button
            key={s.key}
            onClick={() => setStatFocus(s.key)}
            className="text-left group"
          >
            <Card className="p-5 transition-all hover:border-borderMid hover:shadow-md group-hover:bg-surface2 cursor-pointer">
              <div className="flex items-start justify-between">
                <p className="text-xs text-textMuted mb-1 uppercase tracking-wider">{s.label}</p>
                <span className="text-[10px] text-textDim opacity-0 group-hover:opacity-100 transition-opacity">View →</span>
              </div>
              <p className={`text-3xl font-light ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-textDim mt-1 opacity-0 group-hover:opacity-100 transition-opacity">{s.hint}</p>
            </Card>
          </button>
        ))}
      </div>

      {/* Stat drill-down drawer */}
      {statFocus && (
        <StatDrawer
          focus={statFocus}
          onClose={() => setStatFocus(null)}
          activeStrategies={activeStrategies}
          pendingStrategies={pendingStrategies}
          debates={debates}
          memories={memories}
          groupedMemories={groupedMemories}
          onApproval={handleApproval}
        />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Strategies — market → ticker hierarchy */}
        <div className="xl:col-span-2 space-y-4">
          <h2 className="text-xs font-semibold text-textMuted uppercase tracking-widest">Deployed Strategies</h2>
          {!strategiesLoaded && (
            <Card className="p-6 space-y-3">
              {[1,2,3].map(i => (
                <div key={i} className="animate-pulse flex items-center gap-4">
                  <div className="h-8 w-8 rounded-full bg-surface3 shrink-0" style={{opacity: 1 - i*0.2}} />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-surface3 rounded w-1/4" style={{opacity: 1 - i*0.2}} />
                    <div className="h-2.5 bg-surface3 rounded w-1/2" style={{opacity: 1 - i*0.2}} />
                  </div>
                </div>
              ))}
            </Card>
          )}
          {strategiesLoaded && strategies.length === 0 && (
            <Card className="p-10 text-center text-textMuted text-sm">
              No strategies yet — awaiting the next debate cycle.
            </Card>
          )}
          {strategies.length > 0 && (
            <Card className="overflow-hidden">
              {/* Market tabs */}
              <div className="flex border-b border-borderLight overflow-x-auto">
                {marketsWithStrategies.map(market => (
                  <button
                    key={market}
                    onClick={() => { setExpandedStratMarket(market); setExpandedStratTicker(null); }}
                    className={`flex items-center gap-2 px-6 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                      activeStratMarket === market
                        ? 'border-brand-500 text-textMain bg-surface2'
                        : 'border-transparent text-textMuted hover:text-textMain hover:bg-surface2/50'
                    }`}
                  >
                    <span className="text-base">{MARKET_ICONS[market] ?? '📊'}</span>
                    <span>{market}</span>
                    <span className="text-[10px] bg-surface3 text-textDim rounded-full px-1.5 py-0.5">
                      {Object.keys(strategiesByMarketAndTicker[market] ?? {}).length}
                    </span>
                  </button>
                ))}
              </div>

              {/* Ticker rows */}
              <div className="divide-y divide-borderLight">
                {Object.entries(strategiesByMarketAndTicker[activeStratMarket] ?? {}).map(([ticker, tickerStrats]) => {
                  const isOpen = expandedStratTicker === ticker;
                  const latestStrat = tickerStrats[0];
                  const hasPending = tickerStrats.some(s => s.status === 'PENDING');

                  return (
                    <div key={ticker}>
                      <button
                        className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface2 transition-colors text-left group"
                        onClick={() => { setExpandedStratTicker(isOpen ? null : ticker); if (!isOpen) setTimelineTicker(ticker); else setTimelineTicker(null); }}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`h-1.5 w-1.5 rounded-full ${latestStrat.strategy_type === 'LONG' ? 'bg-up' : 'bg-down'}`} />
                          <div className="h-9 w-9 rounded-lg bg-surface3 border border-borderMid flex items-center justify-center text-xs font-bold text-textMain">
                            {ticker.replace(/[.\-=]/g, '').substring(0, 3)}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-textMain">{ticker}</p>
                            <p className="text-[11px] text-textMuted">{tickerStrats.length} strateg{tickerStrats.length !== 1 ? 'ies' : 'y'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {hasPending && (
                            <span className="text-[10px] text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950 border border-amber-300 dark:border-amber-500/30 px-2 py-0.5 rounded-full animate-pulse">
                              Pending
                            </span>
                          )}
                          <Badge type={latestStrat.strategy_type} />
                          <span className="text-textDim group-hover:text-textMuted transition-colors text-xs">{isOpen ? '▲' : '▼'}</span>
                        </div>
                      </button>

                      {isOpen && (
                        <div className="bg-background/60 border-t border-borderLight divide-y divide-borderLight">
                          {tickerStrats.map(strat => (
                            <div key={strat.id} className={`p-5 ${strat.status === 'PENDING' ? 'ring-inset ring-1 ring-amber-500/20' : ''}`}>
                              <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-2">
                                  <Badge type={strat.strategy_type} />
                                  <StatusChip status={strat.status} />
                                  <span className="text-[11px] text-textDim">{new Date(strat.timestamp).toLocaleString()}</span>
                                </div>
                                <div className="text-right shrink-0 ml-4">
                                  {strat.status === 'PENDING' ? (
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => handleApproval(strat.id, 'approve')}
                                        className="px-3 py-1.5 bg-up text-white rounded-lg text-xs font-semibold hover:opacity-80 transition-opacity"
                                      >
                                        Approve
                                      </button>
                                      <button
                                        onClick={() => handleApproval(strat.id, 'reject')}
                                        className="px-3 py-1.5 bg-down text-white rounded-lg text-xs font-semibold hover:opacity-80 transition-opacity"
                                      >
                                        Reject
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="text-right">
                                      <p className="text-[10px] text-textDim uppercase tracking-wider mb-0.5">Return</p>
                                      <p className={`text-2xl font-light tabular-nums ${(strat.current_return ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>
                                        {(strat.current_return ?? 0) >= 0 ? '+' : ''}{(strat.current_return ?? 0).toFixed(2)}%
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-3 text-[11px] text-textMuted mb-3 flex-wrap">
                                <span>Entry <span className="text-textMain font-medium font-mono">${strat.entry_price.toFixed(2)}</span></span>
                                {strat.position_size && <span>Size <span className="text-textMain font-medium font-mono">${strat.position_size.toLocaleString()}</span></span>}
                                {strat.exit_price && <span>Exit <span className="text-textMain font-medium font-mono">${strat.exit_price.toFixed(2)}</span></span>}
                                {strat.close_reason && <span className="text-textDim">{strat.close_reason}</span>}
                              </div>
                              {strat.notes && (
                                <div className="mb-3 px-3 py-2 bg-surface3/50 rounded-lg">
                                  <p className="text-[11px] text-textMuted italic">{strat.notes}</p>
                                </div>
                              )}

                              {/* Edit form */}
                              {editStratId === strat.id && (
                                <div className="mb-3 p-3 bg-surface3/50 border border-borderMid rounded-lg space-y-2">
                                  <div className="flex gap-2">
                                    <input
                                      type="number"
                                      placeholder="Position size ($)"
                                      value={editStratForm.position_size}
                                      onChange={e => setEditStratForm(f => ({ ...f, position_size: e.target.value }))}
                                      className="flex-1 bg-surface border border-borderLight rounded px-2 py-1 text-xs text-textMain placeholder-textDim focus:outline-none focus:border-brand-500"
                                    />
                                  </div>
                                  <textarea
                                    placeholder="Notes..."
                                    value={editStratForm.notes}
                                    onChange={e => setEditStratForm(f => ({ ...f, notes: e.target.value }))}
                                    rows={2}
                                    className="w-full bg-surface border border-borderLight rounded px-2 py-1 text-xs text-textMain placeholder-textDim focus:outline-none focus:border-brand-500 resize-none"
                                  />
                                  <div className="flex gap-2">
                                    <button onClick={() => handleStrategyUpdate(strat.id)} className="px-3 py-1 bg-brand-600 text-white rounded text-xs font-semibold hover:bg-brand-500">Save</button>
                                    <button onClick={() => setEditStratId(null)} className="px-3 py-1 bg-surface border border-borderLight text-textMuted rounded text-xs">Cancel</button>
                                  </div>
                                </div>
                              )}

                              <div className="pt-3 border-t border-borderLight flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <p className="text-[10px] text-textDim uppercase tracking-wider mb-1">Rationale</p>
                                  <p className="text-[11px] text-textMuted leading-relaxed">{strat.reasoning_summary}</p>
                                </div>
                                <div className="shrink-0 flex gap-2">
                                    <button
                                      onClick={() => openReport(strat.id)}
                                      className="px-2 py-1 text-[10px] bg-surface3 border border-borderLight text-textMuted rounded hover:text-textMain transition-colors"
                                    >◈ Report</button>
                                    {strat.status === 'ACTIVE' && <>
                                      <button
                                        onClick={() => { setEditStratId(strat.id); setEditStratForm({ position_size: strat.position_size?.toString() ?? '', notes: strat.notes ?? '' }); }}
                                        className="px-2 py-1 text-[10px] bg-surface3 border border-borderLight text-textMuted rounded hover:text-textMain transition-colors"
                                      >✎ Edit</button>
                                      <button
                                        onClick={() => handleUndeploy(strat.id)}
                                        className="px-2 py-1 text-[10px] bg-down-bg text-down-text border border-down/20 rounded hover:opacity-80 transition-opacity font-semibold"
                                      >✕ Undeploy</button>
                                    </>}
                                  </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>

        {/* Right col: Agent proposals */}
        <div className="space-y-4">
          <h2 className="text-xs font-semibold text-textMuted uppercase tracking-widest">Latest Agent Proposals</h2>
          <Card>
            <div className="divide-y divide-borderLight max-h-[600px] overflow-y-auto">
              {predictions.length === 0 && (
                <p className="p-5 text-xs text-textMuted">No recent proposals.</p>
              )}
              {predictions.slice(0, 8).map(pred => (
                <div key={pred.id} className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-brand-400">{pred.agent_name}</span>
                    <Badge type={pred.prediction} />
                  </div>
                  <p className="text-[10px] text-textDim font-mono mb-1">{pred.symbol}</p>
                  {pred.reasoning.includes('Agent error') ? (
                    <p className="text-[11px] text-down bg-down-bg/50 p-2 rounded border border-down/20">LLM API error — check API key.</p>
                  ) : (
                    <p className="text-[11px] text-textMuted line-clamp-3 leading-relaxed">{pred.reasoning}</p>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Inline timeline panel — shown when a ticker row is clicked */}
      {timelineTicker && (() => {
        const tickerDebates = Object.values(debatesByMarketAndTicker).flatMap(byTicker => byTicker[timelineTicker] ?? []).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-textMuted uppercase tracking-widest">
                Debate History — <span className="text-brand-400 font-mono">{timelineTicker}</span>
              </h2>
              <button onClick={() => { setTimelineTicker(null); setExpandedDebateId(null); }} className="text-[11px] text-textDim hover:text-textMuted px-2 py-1 rounded hover:bg-surface2 transition-colors">✕ Close</button>
            </div>
            {tickerDebates.length === 0 ? (
              <Card className="p-6 text-center text-sm text-textMuted">No debate history for {timelineTicker} yet.</Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="px-6 py-5">
                  <div className="relative border-l border-borderMid ml-2 space-y-4 pl-6 pb-1">
                    {tickerDebates.map(debate => {
                      const isExpanded = expandedDebateId === debate.id;
                      const proposals = parseProposals(debate.proposals_json);
                      const debIsLong = debate.consensus_action === 'LONG';
                      return (
                        <div key={debate.id} className="relative">
                          <div className={`absolute -left-[25px] top-3 h-3 w-3 rounded-full border-2 border-background ${debIsLong ? 'bg-up' : 'bg-down'}`} />
                          <div className={`border rounded-lg overflow-hidden transition-all ${isExpanded ? 'border-brand-500/40 bg-surface' : 'border-borderLight bg-surface hover:border-borderMid'}`}>
                            <button
                              className="w-full flex items-center justify-between px-4 py-3 text-left"
                              onClick={() => setExpandedDebateId(isExpanded ? null : debate.id)}
                            >
                              <div className="flex items-center gap-3">
                                <Badge type={debate.consensus_action} />
                                <span className="text-[11px] text-textMuted bg-surface3 px-2 py-0.5 rounded font-mono">{debate.consensus_votes} agreed</span>
                                {debate.judge_reasoning && (
                                  <span className="text-[10px] text-amber-400 bg-amber-950/50 border border-amber-700/30 px-2 py-0.5 rounded">⚖ Judge</span>
                                )}
                                <span className="text-[11px] text-textDim">{new Date(debate.timestamp).toLocaleString()}</span>
                              </div>
                              <span className="text-textDim text-xs">{isExpanded ? '▲' : '▼'}</span>
                            </button>
                            {isExpanded && (
                              <div className="border-t border-borderLight p-4 space-y-4 bg-background/40">
                                {debate.judge_reasoning && (
                                  <div className="bg-amber-950/30 border border-amber-700/30 rounded-lg p-4">
                                    <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider mb-2">⚖ Judge Verdict</p>
                                    <p className="text-[11px] text-textMuted leading-relaxed">{debate.judge_reasoning}</p>
                                  </div>
                                )}
                                <div>
                                  <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-3">Agent Proposals</p>
                                  <div className="space-y-3">
                                    {proposals.map((p, i) => {
                                      const isWinner = p.ticker === debate.consensus_ticker && p.action === debate.consensus_action;
                                      return (
                                        <div key={i} className={`bg-surface border rounded-lg p-3 ${isWinner ? 'border-amber-500/30' : 'border-borderLight'}`}>
                                          <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                              <span className="text-xs font-semibold text-brand-400">{p.agent_name}</span>
                                              {isWinner && <span className="text-[9px] text-amber-400 bg-amber-950/50 px-1.5 py-0.5 rounded">✓ matched</span>}
                                            </div>
                                            <span className="flex items-center gap-1.5">
                                              <Badge type={p.action} />
                                              <span className="text-[10px] text-textDim font-mono">{p.ticker}</span>
                                            </span>
                                          </div>
                                          <p className="text-[11px] text-textMuted leading-relaxed">{p.reasoning}</p>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                                {debate.research_context && parseProposals(debate.research_context).length > 0 && (
                                  <div>
                                    <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-2">Sources Used</p>
                                    <ul className="space-y-1.5">
                                      {parseProposals(debate.research_context).map((src: any, i: number) => (
                                        <li key={i} className="flex items-start gap-2 text-[11px]">
                                          <span className="text-textDim mt-0.5 shrink-0">›</span>
                                          {src.url && src.url !== 'N/A' ? (
                                            <a href={src.url} target="_blank" rel="noreferrer" className="text-brand-400 hover:text-brand-300 hover:underline line-clamp-1">{src.title}</a>
                                          ) : (
                                            <span className="text-textMuted line-clamp-1">{src.title}</span>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Card>
            )}
          </div>
        );
      })()}
    </div>
  );


  const saveAgentPrompt = (agentName: string, prompt: string) => {
    setEditingPromptAgent(null);
    apiFetch(`/agents/${encodeURIComponent(agentName)}/prompt`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system_prompt: prompt }),
    }).then(r => { if (r.ok) { toast('Prompt saved'); fetchData(); } else toast('Save failed', 'err'); })
      .catch(() => toast('Network error', 'err'));
  };

  const renderMemory = () => (
    <div className="space-y-4">
      <h2 className="text-xs font-semibold text-textMuted uppercase tracking-widest">Agent Memory & Feedback Loop</h2>
      {Object.keys(groupedMemories).length === 0 && (
        <Card className="p-8 text-center text-sm text-textMuted">No memory notes yet.</Card>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.entries(groupedMemories).map(([agentName, agentMemories]) => (
          <Card key={agentName} className="overflow-hidden">
            <SectionHeader
              title={agentName}
              meta={<span className="text-[10px] text-textDim">{agentMemories.length} notes</span>}
            />
            <div className="divide-y divide-borderLight max-h-80 overflow-y-auto">
              {agentMemories.map(m => {
                const noteColors = NOTE_COLORS;
                return (
                  <div key={m.id} className="px-4 py-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${noteColors[m.note_type] ?? 'text-textDim bg-surface3'}`}>
                        {m.note_type}
                      </span>
                      <span className="text-[10px] text-textDim">{new Date(m.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="text-[11px] text-textMuted leading-relaxed">{m.content}</p>
                  </div>
                );
              })}
            </div>
            {/* System Prompt section */}
            <div className="border-t border-borderLight px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider">System Prompt</p>
                {editingPromptAgent !== agentName && (
                  <button
                    onClick={() => { setEditingPromptAgent(agentName); setEditPromptText(agents.find(a => a.agent_name === agentName)?.system_prompt ?? ''); }}
                    className="text-[10px] text-brand-400 hover:text-brand-300 px-2 py-0.5 rounded border border-brand-700/30 bg-brand-900/20 hover:bg-brand-800/30 transition-colors"
                  >&#9998; Edit</button>
                )}
              </div>
              {editingPromptAgent === agentName ? (
                <div className="space-y-2">
                  <textarea
                    value={editPromptText}
                    onChange={e => setEditPromptText(e.target.value)}
                    rows={6}
                    className="w-full bg-surface border border-borderLight rounded px-2 py-1.5 text-xs text-textMain placeholder-textDim focus:outline-none focus:border-brand-500 resize-y font-sans leading-relaxed"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => saveAgentPrompt(agentName, editPromptText)} className="px-3 py-1 bg-brand-600 text-white rounded text-xs font-semibold hover:bg-brand-500">Save</button>
                    <button onClick={() => setEditingPromptAgent(null)} className="px-3 py-1 bg-surface border border-borderLight text-textMuted rounded text-xs">Cancel</button>
                  </div>
                </div>
              ) : (
                <pre className="text-[10px] text-textDim leading-relaxed whitespace-pre-wrap font-sans line-clamp-3">
                  {agents.find(a => a.agent_name === agentName)?.system_prompt ?? '—'}
                </pre>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );

  const renderPortfolio = () => {
    const p = portfolio;
    const fmtUsd = (v: number | null | undefined, fallback = '—') =>
      v == null ? fallback : `${v >= 0 ? '+' : ''}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const fmtPct = (v: number | null | undefined) =>
      v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

    const openPositions = p?.positions.filter(pos => pos.is_open) ?? [];
    const closedPositions = p?.positions.filter(pos => !pos.is_open) ?? [];

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xs font-semibold text-textMuted uppercase tracking-widest">Portfolio & P&L</h2>
            {p && (
              <p className={`text-[11px] mt-0.5 font-mono ${(p.total_pnl ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>
                {(p.total_pnl ?? 0) >= 0 ? '+' : ''}${Math.abs(p.total_pnl ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total · {(p.total_pnl_pct ?? 0) >= 0 ? '+' : ''}{(p.total_pnl_pct ?? 0).toFixed(2)}%
              </p>
            )}
          </div>
          <button onClick={fetchData} className="text-[11px] px-3 py-1.5 rounded-lg bg-surface2 border border-borderLight hover:border-brand-500 text-textMuted hover:text-brand-400 transition-all">
            ↻ Refresh
          </button>
        </div>

        {/* Budget + Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Budget setter */}
          <Card className="p-4 col-span-2 md:col-span-1">
            <p className="text-[10px] text-textDim uppercase tracking-wider mb-2">Trading Budget</p>
            <div className="flex gap-2">
              <input
                type="number"
                value={budgetInput}
                onChange={e => setBudgetInput(e.target.value)}
                className="flex-1 bg-surface border border-borderLight rounded px-2 py-1 text-sm font-mono text-textMain focus:outline-none focus:border-brand-500 min-w-0"
              />
              <button
                onClick={() => handleBudgetSave(parseFloat(budgetInput) || 0)}
                className="px-3 py-1 bg-brand-600 text-white rounded text-xs font-semibold hover:bg-brand-500"
              >Set</button>
            </div>
            {p && (
              <div className="mt-3 space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-textMuted">Allocated</span>
                  <span className="text-textMain font-mono">${(p.allocated).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-textMuted">Available</span>
                  <span className={`font-mono ${p.available < 0 ? 'text-down' : 'text-up'}`}>${p.available.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </div>
                {/* Budget bar */}
                <div className="mt-2 h-1.5 rounded-full bg-surface3 overflow-hidden">
                  <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${Math.min(100, p.total_budget > 0 ? (p.allocated / p.total_budget) * 100 : 0)}%` }} />
                </div>
              </div>
            )}
          </Card>

          {[
            { label: 'Total P&L', value: fmtUsd(p?.total_pnl), sub: fmtPct(p?.total_pnl_pct), up: (p?.total_pnl ?? 0) >= 0 },
            { label: 'Unrealized', value: fmtUsd(p?.unrealized_pnl), sub: `${openPositions.length} open`, up: (p?.unrealized_pnl ?? 0) >= 0 },
            { label: 'Realized', value: fmtUsd(p?.realized_pnl), sub: `${closedPositions.length} closed`, up: (p?.realized_pnl ?? 0) >= 0 },
          ].map(stat => (
            <Card key={stat.label} className="p-4">
              <p className="text-[10px] text-textDim uppercase tracking-wider mb-1">{stat.label}</p>
              <p className={`text-xl font-semibold font-mono ${stat.up ? 'text-up' : 'text-down'}`}>{stat.value}</p>
              <p className="text-[11px] text-textMuted mt-0.5">{stat.sub}</p>
              {p?.using_assumed_sizes && stat.label !== 'Realized' && (
                <p className="text-[9px] text-amber-500 mt-1">equal-weight est.</p>
              )}
            </Card>
          ))}
        </div>

        {/* Budget Allocation bar */}
        {p && p.total_budget > 0 && (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] text-textDim uppercase tracking-wider">Budget Allocation</p>
              <p className="text-[11px] text-textMuted font-mono">${p.total_budget.toLocaleString(undefined, { maximumFractionDigits: 0 })} total</p>
            </div>
            <div className="h-2 rounded-full bg-surface3 overflow-hidden flex">
              <div className="h-full bg-brand-500 transition-all" style={{ width: `${Math.min(100, (p.allocated / p.total_budget) * 100)}%` }} />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] text-brand-400">{((p.allocated / p.total_budget) * 100).toFixed(0)}% allocated · ${p.allocated.toLocaleString(undefined, { maximumFractionDigits: 0 })}{p.using_assumed_sizes ? ' (equal-weight est.)' : ''}</span>
              <span className="text-[10px] text-textDim">${p.available.toLocaleString(undefined, { maximumFractionDigits: 0 })} free</span>
            </div>
          </Card>
        )}

        {/* Open Positions */}
        <div>
          <h3 className="text-xs font-semibold text-textMuted uppercase tracking-widest mb-3">Open Positions</h3>
          {openPositions.length === 0 ? (
            <Card className="p-6 text-center text-sm text-textMuted">No open positions.</Card>
          ) : (
            <div className="space-y-2">
              {openPositions.map(pos => {
                const pnlUp = (pos.pnl_pct ?? 0) >= 0;
                return (
                  <Card key={pos.id} className="px-5 py-4">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-lg bg-surface3 border border-borderMid flex items-center justify-center text-xs font-bold text-textMain shrink-0">
                        {pos.symbol.replace(/[.\-=]/g, '').substring(0, 3)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-semibold text-textMain font-mono">{pos.symbol}</span>
                          <Badge type={pos.strategy_type} />
                          <StatusChip status={pos.status} />
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-textMuted">
                          <span>Entry <span className="font-mono text-textMain">${pos.entry_price.toFixed(4)}</span></span>
                          {pos.current_price != null && (
                            <span>Live <span className={`font-mono font-semibold ${(pos.pnl_pct ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>${pos.current_price.toFixed(4)}</span></span>
                          )}
                          {pos.position_size && <span>Size <span className="font-mono text-textMain">${pos.position_size.toLocaleString()}</span></span>}
                          <span>{new Date(pos.timestamp).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0 flex items-center gap-3">
                        <div>
                          <p className={`text-xl font-light tabular-nums ${pnlUp ? 'text-up' : 'text-down'}`}>{fmtPct(pos.pnl_pct)}</p>
                          {pos.pnl_usd != null
                            ? <p className={`text-[11px] font-mono ${pnlUp ? 'text-up' : 'text-down'}`}>{fmtUsd(pos.pnl_usd)}</p>
                            : pos.assumed_size != null && <p className="text-[9px] text-amber-500">~{fmtUsd((pos.assumed_size * (pos.pnl_pct ?? 0)) / 100)} est.</p>
                          }
                        </div>
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => openReport(pos.id)}
                            className="px-2 py-1 text-[10px] bg-surface3 border border-borderLight text-textMuted rounded hover:text-textMain transition-colors"
                          >◈</button>
                          <button
                            onClick={() => { setEditStratId(editStratId === pos.id ? null : pos.id); setEditStratForm({ position_size: pos.position_size?.toString() ?? '', notes: pos.notes ?? '' }); }}
                            className="px-2 py-1 text-[10px] bg-surface3 border border-borderLight text-textMuted rounded hover:text-textMain transition-colors"
                          >✎</button>
                          <button
                            onClick={() => handleUndeploy(pos.id)}
                            className="px-2 py-1 text-[10px] bg-down-bg text-down-text border border-down/20 rounded hover:opacity-80 font-semibold"
                          >✕</button>
                        </div>
                      </div>
                    </div>
                    {editStratId === pos.id && (
                      <div className="mt-3 p-3 bg-surface3/50 border border-borderMid rounded-lg space-y-2">
                        <div className="flex gap-2">
                          <input
                            type="number"
                            placeholder="Position size ($)"
                            value={editStratForm.position_size}
                            onChange={e => setEditStratForm(f => ({ ...f, position_size: e.target.value }))}
                            className="flex-1 bg-surface border border-borderLight rounded px-2 py-1 text-xs text-textMain placeholder-textDim focus:outline-none focus:border-brand-500"
                          />
                        </div>
                        <textarea
                          placeholder="Notes..."
                          value={editStratForm.notes}
                          onChange={e => setEditStratForm(f => ({ ...f, notes: e.target.value }))}
                          rows={2}
                          className="w-full bg-surface border border-borderLight rounded px-2 py-1 text-xs text-textMain placeholder-textDim focus:outline-none focus:border-brand-500 resize-none"
                        />
                        <div className="flex gap-2">
                          <button onClick={() => handleStrategyUpdate(pos.id)} className="px-3 py-1 bg-brand-600 text-white rounded text-xs font-semibold hover:bg-brand-500">Save</button>
                          <button onClick={() => setEditStratId(null)} className="px-3 py-1 bg-surface border border-borderLight text-textMuted rounded text-xs">Cancel</button>
                        </div>
                      </div>
                    )}
                    {/* P&L progress bar: stop-loss at -10%, take-profit at +15% */}
                    {(() => {
                      const pct = pos.pnl_pct ?? 0;
                      const range = 25;
                      const offset = 10;
                      const fillPct = Math.min(100, Math.max(0, ((pct + offset) / range) * 100));
                      const stopLossMark = (offset / range) * 100;
                      return (
                        <div className="mt-3 pt-3 border-t border-borderLight">
                          <div className="flex justify-between text-[9px] text-textDim mb-1">
                            <span className="text-down">SL −10%</span>
                            <span className="text-textDim">{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</span>
                            <span className="text-up">TP +15%</span>
                          </div>
                          <div className="relative h-1.5 rounded-full bg-surface3 overflow-visible">
                            <div
                              className={`absolute left-0 top-0 h-full rounded-full transition-all ${pct >= 0 ? 'bg-up' : 'bg-down'}`}
                              style={{ width: `${fillPct}%` }}
                            />
                            <div className="absolute top-[-2px] h-[10px] w-px bg-down/60" style={{ left: `${stopLossMark}%` }} />
                          </div>
                        </div>
                      );
                    })()}
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Closed Positions */}
        <div>
          <h3 className="text-xs font-semibold text-textMuted uppercase tracking-widest mb-3">Closed Positions</h3>
          {closedPositions.length === 0 ? (
            <Card className="p-6 text-center text-sm text-textMuted">No closed positions yet.</Card>
          ) : (
            <div className="space-y-2">
              {closedPositions.map(pos => {
                const pnlUp = (pos.pnl_pct ?? 0) >= 0;
                const closeReasonColor: Record<string, string> = {
                  MANUAL: 'text-textMuted bg-surface3',
                  STOP_LOSS: 'text-down-text bg-down-bg',
                  TAKE_PROFIT: 'text-up-text bg-up-bg',
                };
                const closeReasonBorder: Record<string, string> = {
                  TAKE_PROFIT: 'border-l-up',
                  STOP_LOSS: 'border-l-down',
                  MANUAL: 'border-l-borderMid',
                };
                const closeReasonIcon: Record<string, string> = {
                  TAKE_PROFIT: '▲',
                  STOP_LOSS: '▼',
                  MANUAL: '·',
                };
                const borderClass = pos.close_reason ? (closeReasonBorder[pos.close_reason] ?? 'border-l-borderMid') : '';
                return (
                  <Card key={pos.id} className={`px-5 py-3 border-l-4 ${borderClass}`}>
                    <div className="flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-semibold text-textMain font-mono">{pos.symbol}</span>
                          <Badge type={pos.strategy_type} />
                          {pos.close_reason && (
                            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase ${closeReasonColor[pos.close_reason] ?? 'text-textMuted bg-surface3'}`}>
                              {closeReasonIcon[pos.close_reason] ?? ''} {pos.close_reason}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-textMuted">
                          <span>Entry <span className="font-mono text-textMain">${pos.entry_price.toFixed(4)}</span></span>
                          {pos.exit_price && <span>Exit <span className="font-mono text-textMain">${pos.exit_price.toFixed(4)}</span></span>}
                          {pos.position_size && <span>Size <span className="font-mono text-textMain">${pos.position_size.toLocaleString()}</span></span>}
                          {pos.closed_at && <span>{new Date(pos.closed_at).toLocaleDateString()}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <p className={`text-lg font-light tabular-nums ${pnlUp ? 'text-up' : 'text-down'}`}>{fmtPct(pos.pnl_pct)}</p>
                          {pos.realized_pnl != null && (
                            <p className={`text-[11px] font-mono ${(pos.realized_pnl ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>
                              {fmtUsd(pos.realized_pnl)}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => openReport(pos.id)}
                          className="px-2 py-1 text-[10px] bg-surface3 border border-borderLight text-textMuted rounded hover:text-textMain transition-colors"
                        >◈</button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderMarkets = () => {
    const fmt = (n: number | null, dec = 2, prefix = '') => {
      if (n === null || n === undefined) return '—';
      return `${prefix}${n.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
    };

    const fmtVol = (v: number | null) => {
      if (!v) return '—';
      if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
      if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
      if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
      return String(v);
    };

    // Only tickers from enabled markets
    const allDefaultSymbols = TICKER_DB.filter(t => enabledMarketNames.includes(t.market)).map(t => t.symbol);
    // User-added symbols not in defaults
    const userAddedSymbols = watchlist.filter(s => !allDefaultSymbols.includes(s));
    // Combined unique symbol list
    const allSymbols = [...new Set([...allDefaultSymbols, ...userAddedSymbols])];

    // Resolve active tab — default to first enabled market
    const activeMarketTab = (quotesMarketTab && enabledMarketNames.includes(quotesMarketTab))
      ? quotesMarketTab
      : (enabledMarketNames[0] ?? '');

    // Filter by market tab
    const tabSymbols = allSymbols.filter(sym => {
      const meta = TICKER_META[sym];
      if (meta) return meta.market === activeMarketTab;
      // For user-added symbols not in TICKER_DB, detect market from quote data
      const q = liveQuotes.find(q => q.symbol === sym);
      return q?.market === activeMarketTab;
    });

    // Symbols with active positions
    const positionSymbols = [...new Set(activeStrategies.map(s => s.symbol))];
    const positionTabSymbols = positionSymbols.filter(sym => {
      const meta = TICKER_META[sym];
      if (meta) return meta.market === activeMarketTab;
      const q = liveQuotes.find(q => q.symbol === sym);
      return q?.market === activeMarketTab;
    }
    );

    // Non-position watchlist symbols for the current tab
    const watchlistTabSymbols = tabSymbols.filter(sym => !positionSymbols.includes(sym));

    const activeStock = (quotesStockTab && tabSymbols.includes(quotesStockTab)) || (quotesStockTab && positionTabSymbols.includes(quotesStockTab))
      ? quotesStockTab : null;
    const stockQuote = activeStock ? liveQuotes.find(q => q.symbol === activeStock) ?? null : null;
    const stockEvents = activeStock ? marketEvents.filter(e => e.symbol === activeStock) : [];

    // Debounced markets search
    const handleMarketsSearch = (q: string) => {
      setMarketsSearchQuery(q);
      const timer = marketsSearchTimer[0];
      if (timer) clearTimeout(timer);
      if (!q.trim()) { setMarketsSearchResults([]); return; }
      const newTimer = setTimeout(async () => {
        setMarketsSearchLoading(true);
        try {
          const res = await apiFetch(`/search/tickers?q=${encodeURIComponent(q)}`);
          if (res.ok) setMarketsSearchResults(await res.json());
        } catch { /* silent */ }
        finally { setMarketsSearchLoading(false); }
      }, 350);
      marketsSearchTimer[1](newTimer);
    };

    const toggleWatchlist = (sym: string) => {
      setWatchlist(prev => {
        const next = prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym];
        localStorage.setItem('watchlist', JSON.stringify(next));
        return next;
      });
    };

    const isTracked = (sym: string) => allDefaultSymbols.includes(sym) || watchlist.includes(sym);

    const renderStockCard = (sym: string, hasPosition = false) => {
      const q = liveQuotes.find(lq => lq.symbol === sym);
      const up = (q?.change_pct ?? 0) >= 0;
      const isActive = activeStock === sym;
      const ticker = sym.replace(/\.(NS)$/, '').replace(/-USD$/, '').replace(/=F$/, '');
      const isUserAdded = !allDefaultSymbols.includes(sym);
      const activePos = activeStrategies.find(s => s.symbol === sym);
      const posReturn = activePos?.current_return ?? null;
      const posUp = (posReturn ?? 0) >= 0;

      return (
        <button key={sym} onClick={() => setQuotesStockTab(isActive ? null : sym)}
          className={`text-left p-4 rounded-xl border transition-all relative ${
            hasPosition
              ? isActive
                ? `border-l-2 ${posUp ? 'border-l-emerald-500 border-emerald-500/60 bg-emerald-900/10 ring-1 ring-emerald-500/20' : 'border-l-red-500 border-red-500/60 bg-red-900/10 ring-1 ring-red-500/20'}`
                : `border-l-2 ${posUp ? 'border-l-emerald-500 border-borderLight bg-surface hover:bg-surface2' : 'border-l-red-500 border-borderLight bg-surface hover:bg-surface2'}`
              : isActive
                ? 'border-brand-500 bg-brand-900/20 ring-1 ring-brand-500/30'
                : 'border-borderLight bg-surface hover:border-borderMid hover:bg-surface2'
          }`}>
          {/* Remove button for user-added symbols */}
          {isUserAdded && (
            <button
              onClick={e => { e.stopPropagation(); toggleWatchlist(sym); }}
              className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center text-[10px] text-textDim hover:text-red-400 hover:bg-red-900/30 rounded transition-colors"
              title="Remove from watchlist">
              ×
            </button>
          )}
          <div className="flex items-start justify-between gap-2 mb-2">
            <span className="text-sm font-bold font-mono text-textMain leading-none">{ticker}</span>
            <div className="flex flex-col items-end gap-0.5">
              {q?.change_pct != null && (
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${up ? 'bg-up-bg text-up-text' : 'bg-down-bg text-down-text'}`}>
                  {up ? '+' : ''}{q.change_pct.toFixed(2)}% <span className="font-normal opacity-70">1d</span>
                </span>
              )}
              {q?.week_change_pct != null && q?.week_closes && q.week_closes.length >= 3 && (
                <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${(q.week_change_pct ?? 0) >= 0 ? 'text-up/70' : 'text-down/70'}`}>
                  {(q.week_change_pct ?? 0) >= 0 ? '+' : ''}{q.week_change_pct?.toFixed(2)}% <span className="opacity-70">5d</span>
                </span>
              )}
            </div>
          </div>
          {q?.price != null ? (
            <p className="text-lg font-light font-mono text-textMain leading-none">
              {fmt(q.price, q.price > 100 ? 2 : 4)}
            </p>
          ) : (
            <p className="text-sm text-textDim">—</p>
          )}
          {/* 5-day sparkline */}
          {q?.week_closes && q.week_closes.length >= 2 && (() => {
            const pts = q.week_closes!;
            const mn = Math.min(...pts), mx = Math.max(...pts);
            const range = mx - mn || 1;
            const w = 80, h = 24;
            const coords = pts.map((v, i) => `${(i / (pts.length - 1)) * w},${h - ((v - mn) / range) * h}`).join(' ');
            const sparkUp = pts[pts.length - 1] >= pts[0];
            return (
              <svg width={w} height={h} className="mt-2 overflow-visible">
                <polyline points={coords} fill="none" stroke={sparkUp ? 'var(--color-up)' : 'var(--color-down)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
              </svg>
            );
          })()}
          {q?.name && <p className="text-[10px] text-textDim mt-0.5 truncate">{q.name}</p>}
          {/* Position return badge */}
          {activePos && posReturn !== null && (
            <div className={`mt-2 text-[10px] font-semibold px-2 py-0.5 rounded-full w-fit ${posUp ? 'bg-emerald-900/40 text-emerald-400' : 'bg-red-900/40 text-red-400'}`}>
              {activePos.strategy_type} {posUp ? '+' : ''}{posReturn.toFixed(2)}%
            </div>
          )}
        </button>
      );
    };

    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-textMuted uppercase tracking-widest">Markets</h2>
          <div className="flex items-center gap-2">
            {quotesLoading && <span className="text-[10px] text-amber-400 animate-pulse">Fetching…</span>}
            <button onClick={() => { setMarketsSearchOpen(true); setMarketsSearchQuery(''); setMarketsSearchResults([]); }}
              className="text-[11px] px-3 py-1.5 rounded-lg bg-surface2 border border-borderLight hover:border-brand-500 text-textMuted hover:text-brand-400 transition-all flex items-center gap-1.5">
              + Add / Remove
            </button>
            <button onClick={fetchQuotes} disabled={quotesLoading}
              className="text-[11px] px-3 py-1.5 rounded-lg bg-surface2 border border-borderLight hover:border-brand-500 text-textMuted hover:text-brand-400 transition-all disabled:opacity-40">
              ↻ Refresh
            </button>
            <span className="text-[10px] text-textDim">Live · auto-refresh</span>
          </div>
        </div>

        {/* Market filter tabs */}
        <div className="flex gap-2 flex-wrap">
          {enabledMarketNames.map(m => (
            <button key={m}
              onClick={() => { setQuotesMarketTab(m); setQuotesStockTab(null); }}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
                activeMarketTab === m
                  ? 'border-brand-500 bg-brand-900/30 text-brand-300'
                  : 'border-borderLight bg-surface2 text-textMuted hover:text-textMain hover:border-borderMid'
              }`}>
              <span>{MARKET_ICONS[m]}</span>
              <span>{m}</span>
            </button>
          ))}
        </div>

        {/* Active Positions section */}
        {positionTabSymbols.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
              Active Positions ({positionTabSymbols.length})
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {positionTabSymbols.map(sym => renderStockCard(sym, true))}
            </div>
          </div>
        )}

        {/* Watchlist / All markets grid */}
        {watchlistTabSymbols.length > 0 && (
          <div>
            {positionTabSymbols.length > 0 && (
              <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-2">Watchlist</p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {watchlistTabSymbols.map(sym => renderStockCard(sym, false))}
            </div>
          </div>
        )}

        {tabSymbols.length === 0 && positionTabSymbols.length === 0 && (
          <div className="py-10 text-center text-textDim text-sm">No symbols tracked for this market.</div>
        )}

        {/* Search / Add-Remove Modal */}
        {marketsSearchOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setMarketsSearchOpen(false)}>
            <div className="bg-surface border border-borderMid rounded-2xl shadow-2xl w-full max-w-md mx-4 p-5 space-y-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-textMain">Add / Remove from Watchlist</h3>
                <button onClick={() => setMarketsSearchOpen(false)} className="text-textDim hover:text-textMain text-lg leading-none">×</button>
              </div>
              <input
                autoFocus
                value={marketsSearchQuery}
                onChange={e => handleMarketsSearch(e.target.value)}
                placeholder="Search ticker or company name…"
                className="w-full px-3 py-2 text-sm rounded-lg bg-surface2 border border-borderLight focus:border-brand-500 focus:outline-none text-textMain placeholder-textDim"
              />
              {/* User-added symbols */}
              {userAddedSymbols.length > 0 && !marketsSearchQuery && (
                <div>
                  <p className="text-[10px] text-textDim uppercase tracking-wider mb-2">Currently Added</p>
                  <div className="flex flex-wrap gap-2">
                    {userAddedSymbols.map(sym => (
                      <span key={sym} className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-brand-900/40 border border-brand-700/40 text-brand-300">
                        {sym.replace(/\.(NS)$/, '').replace(/-USD$/, '').replace(/=F$/, '')}
                        <button onClick={() => toggleWatchlist(sym)} className="hover:text-red-400 ml-0.5">×</button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {marketsSearchLoading && <p className="text-xs text-textDim text-center py-4 animate-pulse">Searching…</p>}
              {!marketsSearchLoading && marketsSearchResults.length > 0 && (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {marketsSearchResults.map(r => {
                    const tracked = isTracked(r.symbol);
                    const isDefault = allDefaultSymbols.includes(r.symbol);
                    return (
                      <div key={r.symbol} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surface2 border border-borderLight hover:border-borderMid transition-colors">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-mono font-bold text-textMain leading-none">{r.symbol}</p>
                          <p className="text-[11px] text-textMuted truncate mt-0.5">{r.name}</p>
                          {r.sector && <p className="text-[10px] text-textDim">{r.sector} · {r.exchange}</p>}
                        </div>
                        <button
                          onClick={() => !isDefault && toggleWatchlist(r.symbol)}
                          disabled={isDefault}
                          className={`shrink-0 text-[11px] px-3 py-1 rounded-lg border transition-colors ${
                            isDefault
                              ? 'border-borderLight text-textDim cursor-default'
                              : tracked
                                ? 'border-red-700/50 bg-red-900/30 text-red-400 hover:bg-red-900/50'
                                : 'border-brand-700/50 bg-brand-900/30 text-brand-400 hover:bg-brand-900/50'
                          }`}>
                          {isDefault ? 'Default' : tracked ? '− Remove' : '+ Add'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {!marketsSearchLoading && marketsSearchQuery && marketsSearchResults.length === 0 && (
                <p className="text-xs text-textDim text-center py-4">No results found.</p>
              )}
            </div>
          </div>
        )}

        {/* Expanded stock detail */}
        {activeStock && (() => {
          const stockCalEvents = stockEvents.filter(e => e.event_type !== 'News');
          const stockNews = stockEvents.filter(e => e.event_type === 'News');
          return (
            <Card className="p-5 space-y-5">
              {/* Header row */}
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-3">
                  <h3 className="text-base font-bold font-mono text-textMain">
                    {activeStock.replace(/\.(NS)$/, '').replace(/-USD$/, '').replace(/=F$/, '')}
                  </h3>
                  {stockQuote?.name && <span className="text-xs text-textMuted">{stockQuote.name}</span>}
                </div>
                <button onClick={() => setQuotesStockTab(null)} className="text-textDim hover:text-textMain text-lg leading-none">×</button>
              </div>

              {/* Price stats */}
              {stockQuote ? (() => {
                const up = (stockQuote.change_pct ?? 0) >= 0;
                return (
                  <div className="flex items-end gap-6 flex-wrap">
                    <div>
                      <p className="text-3xl font-light font-mono text-textMain">
                        {stockQuote.price !== null ? fmt(stockQuote.price, stockQuote.price > 100 ? 2 : 4) : '—'}
                      </p>
                    </div>
                    <div className="flex gap-5 pb-1">
                      <div><p className="text-[10px] text-textDim uppercase mb-0.5">Prev Close</p><p className="text-sm font-mono text-textMain">{fmt(stockQuote.prev_close, stockQuote.prev_close && stockQuote.prev_close > 100 ? 2 : 4)}</p></div>
                      <div><p className="text-[10px] text-textDim uppercase mb-0.5">Volume</p><p className="text-sm font-mono text-textMain">{fmtVol(stockQuote.volume)}</p></div>
                      <div><p className="text-[10px] text-textDim uppercase mb-0.5">Change</p><p className={`text-sm font-mono ${up ? 'text-up' : 'text-down'}`}>{stockQuote.change_pct != null ? `${up ? '+' : ''}${stockQuote.change_pct.toFixed(2)}%` : '—'}</p></div>
                    </div>
                  </div>
                );
              })() : (
                <p className="text-sm text-textDim">No price data — click Refresh.</p>
              )}

              {/* Upcoming events */}
              {stockCalEvents.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-2">Upcoming Events</p>
                  <div className="space-y-2">
                    {stockCalEvents.map((ev, i) => (
                      <div key={i} className="flex items-center gap-3 px-3 py-2.5 bg-surface2 border border-borderLight rounded-lg">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                          ev.event_type === 'Earnings' ? 'bg-brand-100 dark:bg-brand-900/60 text-brand-700 dark:text-brand-300 border border-brand-300 dark:border-brand-700/30' : 'bg-teal-100 dark:bg-teal-900/60 text-teal-700 dark:text-teal-300 border border-teal-300 dark:border-teal-700/30'
                        }`}>{ev.event_type}</span>
                        <span className="text-xs font-mono text-textMain">{ev.date}</span>
                        {ev.detail && <span className="text-xs text-textMuted">{ev.detail}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* News */}
              {stockNews.length > 0 ? (
                <div>
                  <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-2">Latest News</p>
                  <div className="space-y-2">
                    {stockNews.map((ev, i) => (
                      <div key={i} className="px-3 py-3 bg-surface2 border border-borderLight rounded-lg hover:border-borderMid transition-colors group">
                        {ev.url ? (
                          <a href={ev.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-textMain group-hover:text-brand-400 transition-colors leading-snug block mb-1">
                            {ev.title}
                          </a>
                        ) : (
                          <p className="text-sm font-medium text-textMain leading-snug mb-1">{ev.title}</p>
                        )}
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-textDim font-mono">{ev.date}</span>
                          {ev.detail && <><span className="text-textDim text-[10px]">·</span><span className="text-[10px] text-textDim">{ev.detail}</span></>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-textDim">No news available for this stock.</p>
              )}
            </Card>
          );
        })()}
      </div>
    );
  };


  const renderSettings = () => {
    const agentMemoriesFor = (name: string) => memories.filter(m => m.agent_name === name);
    const noteColors = NOTE_COLORS;
    return (
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left column: system settings */}
        <div className="xl:col-span-1 space-y-5">
          <h2 className="text-xs font-semibold text-textMuted uppercase tracking-widest">System Settings</h2>

          {/* Theme */}
          <Card>
            <SectionHeader title="Appearance" />
            <div className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-textMain">{darkMode ? 'Dark Mode' : 'Light Mode'}</p>
                  <p className="text-[11px] text-textMuted mt-0.5">{darkMode ? 'Easy on the eyes at night' : 'Bright and clear'}</p>
                </div>
                <button
                  onClick={toggleDarkMode}
                  className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors duration-300 focus:outline-none ${darkMode ? 'bg-brand-600' : 'bg-surface3 border border-borderLight'}`}
                >
                  <span className={`absolute text-sm transition-all duration-300 ${darkMode ? 'left-1.5' : 'right-1.5'}`}>
                    {darkMode ? '🌙' : '☀️'}
                  </span>
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-300 ${darkMode ? 'translate-x-7' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
          </Card>

          {/* Approval mode */}
          <Card>
            <SectionHeader title="Approval Mode" />
            <div className="p-5 space-y-3">
              <div className="flex rounded-lg overflow-hidden border border-borderLight">
                <button onClick={() => setMode('auto')} className={`flex-1 py-2.5 text-sm font-medium transition-colors ${approvalMode === 'auto' ? 'bg-brand-600 text-white' : 'bg-surface2 text-textMuted hover:bg-surface3'}`}>
                  Auto Deploy
                </button>
                <button onClick={() => setMode('manual')} className={`flex-1 py-2.5 text-sm font-medium transition-colors ${approvalMode === 'manual' ? 'bg-amber-600 text-white' : 'bg-surface2 text-textMuted hover:bg-surface3'}`}>
                  Manual
                </button>
              </div>
              <p className="text-xs text-textMuted">{approvalMode === 'auto' ? 'Strategies deploy automatically after consensus.' : 'Each strategy requires your approval before going live.'}</p>
            </div>
          </Card>

          {/* Markets */}
          <Card>
            <SectionHeader title="Enabled Markets" />
            <div className="p-5 space-y-4">
              {markets.map(m => (
                <div key={m.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{MARKET_ICONS[m.market_name] ?? '📊'}</span>
                    <div>
                      <p className="text-sm font-medium text-textMain">{m.market_name}</p>
                      <p className="text-[11px] text-textMuted">{MARKET_TICKERS[m.market_name]?.length ?? 0} tickers</p>
                    </div>
                  </div>
                  <Toggle checked={!!m.is_enabled} onChange={() => toggleMarket(m.market_name, m.is_enabled)} />
                </div>
              ))}
            </div>
          </Card>

          {/* Schedule */}
          <Card>
            <SectionHeader title="Debate Schedule" />
            <div className="p-5 space-y-4">
              <p className="text-xs text-textMuted">Run a new debate cycle every:</p>
              <div className="grid grid-cols-4 gap-2">
                {[15, 30, 60, 120].map(mins => (
                  <button key={mins} onClick={() => handleScheduleUpdate(mins)}
                    className={`py-2 text-xs font-medium rounded-lg border transition-colors ${scheduleInterval === mins ? 'bg-brand-600 border-brand-500 text-white' : 'bg-surface2 border-borderLight text-textMuted hover:bg-surface3 hover:text-textMain'}`}>
                    {mins >= 60 ? `${mins / 60}h` : `${mins}m`}
                  </button>
                ))}
              </div>
              <button onClick={() => handleManualTrigger()} disabled={isTriggering}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium border transition-colors ${isTriggering ? 'bg-surface3 border-borderLight text-textDim cursor-not-allowed' : 'bg-brand-600 border-brand-500 text-white hover:bg-brand-500'}`}>
                {isTriggering ? <><span className="animate-spin inline-block">↻</span> Running…</> : <><span>▶</span> Run Now</>}
              </button>
              <p className="text-[11px] text-textDim text-center">Next auto-run in ~{scheduleInterval} min</p>
            </div>
          </Card>
        </div>

        {/* Right columns: agent transparency */}
        <div className="xl:col-span-2 space-y-5">
          <h2 className="text-xs font-semibold text-textMuted uppercase tracking-widest">Agent Darwinian Evolution</h2>

          {agents.length === 0 && (
            <Card className="p-8 text-center text-sm text-textMuted">No agents found. Run a debate first.</Card>
          )}

          {/* Darwin fitness leaderboard */}
          {agentFitness.length > 0 && (() => {
            const sorted = [...agentFitness].sort((a, b) =>
              (b.fitness_score ?? -1) - (a.fitness_score ?? -1)
            );
            return (
              <Card className="overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-borderLight bg-surface2">
                  <span className="text-sm font-semibold text-textMain">Fitness Leaderboard</span>
                  <span className="text-[10px] text-textDim">Updates after each evaluation cycle</span>
                </div>
                <div className="divide-y divide-borderLight">
                  {sorted.map((af, rank) => {
                    const fitness = af.fitness_score;
                    const hasData = fitness !== null && af.total_scored >= 1;
                    const barWidth = hasData ? `${(fitness! / 100) * 100}%` : '0%';
                    const barColor = !hasData ? 'bg-surface3'
                      : fitness! >= 65 ? 'bg-up'
                      : fitness! >= 45 ? 'bg-amber-500'
                      : 'bg-down';
                    const rankEmoji = rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `#${rank + 1}`;
                    return (
                      <div key={af.agent_name} className="px-5 py-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <span className="text-base w-6 text-center">{rankEmoji}</span>
                            <div className="h-8 w-8 rounded-lg bg-brand-600/20 border border-brand-500/30 flex items-center justify-center text-brand-400 font-bold text-xs">
                              {af.agent_name.split(' ').map(w => w[0]).join('')}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-textMain">{af.agent_name}</p>
                              <p className="text-[10px] text-textDim">
                                Gen {af.generation}
                                {af.total_scored > 0 && <> · {af.total_scored} scored</>}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            {hasData ? (
                              <>
                                <p className={`text-lg font-light tabular-nums ${fitness! >= 65 ? 'text-up' : fitness! >= 45 ? 'text-amber-400' : 'text-down'}`}>
                                  {fitness!.toFixed(1)}
                                  <span className="text-xs text-textDim">/100</span>
                                </p>
                                <p className="text-[10px] text-textDim">
                                  {((af.win_rate ?? 0) * 100).toFixed(0)}% wins
                                  {af.avg_return !== null && <> · {af.avg_return > 0 ? '+' : ''}{af.avg_return.toFixed(1)} ret</>}
                                </p>
                              </>
                            ) : (
                              <p className="text-xs text-textDim">Awaiting data</p>
                            )}
                          </div>
                        </div>

                        {/* Fitness bar */}
                        <div className="h-1.5 w-full bg-surface3 rounded-full overflow-hidden mb-2">
                          <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: barWidth }} />
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center justify-between">
                          <div className="flex gap-2">
                            <button
                              onClick={() => setSelectedAgent(selectedAgent === af.agent_name ? null : af.agent_name)}
                              className={`text-[10px] px-2 py-1 rounded border transition-colors ${selectedAgent === af.agent_name ? 'bg-brand-600/20 border-brand-500/40 text-brand-400' : 'border-borderLight text-textDim hover:text-textMuted hover:bg-surface2'}`}
                            >
                              {selectedAgent === af.agent_name ? '▲ Prompt' : '▼ Prompt'}
                            </button>
                            <button
                              onClick={() => evolutionAgent === af.agent_name ? setEvolutionAgent(null) : loadEvolution(af.agent_name)}
                              className={`text-[10px] px-2 py-1 rounded border transition-colors ${evolutionAgent === af.agent_name ? 'bg-purple-600/20 border-purple-500/40 text-purple-400' : 'border-borderLight text-textDim hover:text-textMuted hover:bg-surface2'}`}
                            >
                              {evolutionAgent === af.agent_name ? '▲ History' : '🧬 History'}
                            </button>
                          </div>
                          {fitness !== null && fitness < 45 && af.total_scored >= 3 && (
                            <span className="text-[10px] text-down bg-down-bg px-2 py-0.5 rounded-full border border-down/20 animate-pulse">
                              Evolution candidate
                            </span>
                          )}
                          {fitness !== null && fitness >= 65 && (
                            <span className="text-[10px] text-up bg-up-bg px-2 py-0.5 rounded-full border border-up/20">
                              Elite donor
                            </span>
                          )}
                        </div>

                        {/* Inline prompt panel */}
                        {selectedAgent === af.agent_name && (() => {
                          const agent = agents.find(a => a.agent_name === af.agent_name);
                          const agentMems = agentMemoriesFor(af.agent_name);
                          if (!agent) return null;
                          return (
                            <div className="mt-3 space-y-3">
                              <div className="bg-surface2 border border-borderLight rounded-lg p-3">
                                <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-2">Current System Prompt</p>
                                <pre className="text-[11px] text-textMuted leading-relaxed whitespace-pre-wrap font-sans">{agent.system_prompt}</pre>
                                {agent.updated_at && <p className="text-[10px] text-textDim mt-2">Last evolved: {new Date(agent.updated_at).toLocaleString()}</p>}
                              </div>
                              {agentMems.length > 0 && (
                                <div className="bg-surface2 border border-borderLight rounded-lg p-3">
                                  <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-2">Memory Notes ({agentMems.length})</p>
                                  <div className="space-y-2 max-h-48 overflow-y-auto">
                                    {agentMems.map(m => (
                                      <div key={m.id} className="flex gap-2 text-[11px]">
                                        <span className={`shrink-0 text-[9px] font-bold uppercase px-1 py-0.5 rounded h-fit ${noteColors[m.note_type] ?? 'text-textDim bg-surface3'}`}>{m.note_type}</span>
                                        <p className="text-textMuted leading-relaxed">{m.content}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Inline evolution history */}
                        {evolutionAgent === af.agent_name && agentEvolution.length > 0 && (
                          <div className="mt-3 bg-surface2 border border-borderLight rounded-lg overflow-hidden">
                            <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider px-3 py-2 border-b border-borderLight">
                              Evolution History — {agentEvolution.length} generation{agentEvolution.length !== 1 ? 's' : ''}
                            </p>
                            <div className="divide-y divide-borderLight max-h-64 overflow-y-auto">
                              {agentEvolution.map(ev => {
                                const reasonColor: Record<string, string> = {
                                  MUTATION:  'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/40',
                                  CROSSOVER: 'text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/50 border border-purple-200 dark:border-purple-800/40',
                                  RESET:     'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/40',
                                  SEED:      'text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800/40',
                                  MANUAL:    'text-textMuted bg-surface2 border border-borderLight',
                                };
                                return (
                                  <div key={ev.id} className="px-3 py-3">
                                    <div className="flex items-center justify-between mb-1.5">
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-bold text-textMuted">Gen {ev.generation}</span>
                                        {ev.evolution_reason && (
                                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${reasonColor[ev.evolution_reason] ?? 'text-textDim bg-surface3'}`}>
                                            {ev.evolution_reason}
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-right">
                                        {ev.fitness_score !== null && (
                                          <span className={`text-[11px] font-medium ${ev.fitness_score >= 65 ? 'text-up' : ev.fitness_score >= 45 ? 'text-amber-400' : 'text-down'}`}>
                                            {ev.fitness_score.toFixed(1)}/100
                                          </span>
                                        )}
                                        {ev.replaced_at && <p className="text-[10px] text-textDim">{new Date(ev.replaced_at).toLocaleDateString()}</p>}
                                      </div>
                                    </div>
                                    <pre className="text-[10px] text-textDim leading-relaxed whitespace-pre-wrap font-sans line-clamp-3">{ev.system_prompt}</pre>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {evolutionAgent === af.agent_name && agentEvolution.length === 0 && (
                          <div className="mt-3 bg-surface2 border border-borderLight rounded-lg p-3 text-center text-[11px] text-textMuted">
                            No evolution history yet — this agent is still in its original form.
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })()}

        </div>
      </div>
    );
  };

  const handleStopPipeline = () => {
    setIsTriggering(false);
    isTriggeringRef.current = false;
    apiFetch('/system/stop', { method: 'POST' })
      .then(r => { if (r.ok) toast('Pipeline stopped', 'info'); })
      .catch(() => {});
  };

  const PIPELINE_STEPS = [
    { step: 'START',        label: 'Initialise',          desc: 'Acquire lock, set run ID' },
    { step: 'WEB_RESEARCH', label: 'Shared Retrieval',    desc: 'Fetch news, research & live prices once for all agents' },
    { step: 'KG_INGEST',    label: 'Knowledge Graph',     desc: 'Extract events & relationships from research, deduplicate via embeddings' },
    { step: 'DEBATE_PANEL', label: 'Debate Panel',        desc: '4 agents each receive shared context + own memory and propose a trade' },
    { step: 'AGENT_QUERY',  label: '  ↳ Agent × 4',      desc: 'Value Investor · Technical Analyst · Macro Economist · Sentiment Analyst' },
    { step: 'JUDGE',        label: 'Judge',               desc: 'Independent LLM evaluates all 4 proposals and picks the best one' },
    { step: 'DEPLOY',       label: 'Deploy Strategy',     desc: 'Save strategy (ACTIVE or PENDING approval) with entry price' },
    { step: 'MEMORY_WRITE', label: 'Write Memories',      desc: 'Each agent gets a memory note about the outcome for next round' },
  ];

  const renderPipeline = () => {
    const isActive = isTriggering;

    // Determine which run's events to show in the right panel
    // 'live' = current run, or a past run_id
    const viewingLive = selectedRunId === null || selectedRunId === pipelineRunId;
    const panelEvents = viewingLive ? pipelineEvents : selectedRunEvents;

    const renderEventList = (events: PipelineEvent[], live: boolean) => {
      if (events.length === 0 && live && !isActive) {
        // Blueprint
        return (
          <div className="px-5 py-6">
            <p className="text-xs text-textMuted mb-4">Pipeline will execute these steps in order:</p>
            <div className="relative">
              <div className="absolute left-[13px] top-0 bottom-0 w-px bg-borderLight" />
              <div className="space-y-0">
                {PIPELINE_STEPS.map((s, i) => (
                  <div key={i} className="flex items-start gap-4 py-2.5">
                    <div className="relative z-10 shrink-0 h-7 w-7 rounded-full bg-surface3 border border-borderMid flex items-center justify-center">
                      <span className={`text-xs ${STEP_META[s.step]?.color ?? 'text-textDim'}`}>{STEP_META[s.step]?.icon ?? '·'}</span>
                    </div>
                    <div className="pt-0.5">
                      <p className="text-xs font-medium text-textMain">{s.label}</p>
                      <p className="text-[11px] text-textDim mt-0.5">{s.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      }
      if (events.length === 0 && live && isActive) {
        return (
          <div className="px-5 py-6 space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-3 animate-pulse">
                <div className="h-7 w-7 rounded-full bg-surface3" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-surface3 rounded w-1/3" />
                  <div className="h-2.5 bg-surface3 rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        );
      }
      if (events.length === 0 && !live && selectedRunLoading) {
        return (
          <div className="px-5 py-6 space-y-4">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex items-center gap-3 animate-pulse">
                <div className="h-7 w-7 rounded-full bg-surface3 shrink-0" style={{ opacity: 1 - i * 0.15 }} />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-surface3 rounded" style={{ width: `${60 - i * 5}%`, opacity: 1 - i * 0.15 }} />
                  <div className="h-2.5 bg-surface3 rounded" style={{ width: `${80 - i * 5}%`, opacity: 1 - i * 0.15 }} />
                </div>
              </div>
            ))}
          </div>
        );
      }
      if (events.length === 0) {
        return <p className="px-5 py-8 text-sm text-textMuted text-center">Loading…</p>;
      }
      const hasError = events.some(e => e.status === 'ERROR');
      const dur = Math.round((new Date(events[events.length - 1].created_at).getTime() - new Date(events[0].created_at).getTime()) / 1000);
      const stepRingColor: Record<string, string> = {
        START:        'border-brand-500',
        WEB_RESEARCH: 'border-purple-500',
        KG_INGEST:    'border-cyan-500',
        DEBATE_PANEL: 'border-teal-500',
        AGENT_QUERY:  'border-teal-400',
        JUDGE:        'border-amber-500',
        DEPLOY:       'border-brand-400',
        MEMORY_WRITE: 'border-indigo-500',
        ERROR:        'border-down',
      };
      return (
        <>
          <div className="relative">
            <div className="absolute left-[28px] top-0 bottom-0 w-px bg-borderLight" />
            <div className="divide-y divide-borderLight">
              {events.map((ev, idx) => {
                const meta = STEP_META[ev.step] ?? { icon: '·', label: ev.step, color: 'text-textMuted' };
                const isLast = idx === events.length - 1;
                const timeStr = new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const isAgentQuery = ev.step === 'AGENT_QUERY';
                // Treat IN_PROGRESS as DONE if: pipeline stopped, OR a later DONE/ERROR event exists for this step
                const hasLaterResolution = ev.status === 'IN_PROGRESS' && events.slice(idx + 1).some(e => e.step === ev.step && (e.status === 'DONE' || e.status === 'ERROR'));
                const displayStatus = (ev.status === 'IN_PROGRESS' && (!isActive || hasLaterResolution)) ? 'DONE' : ev.status;
                return (
                  <div key={ev.id} className={`relative ${isLast && live && isActive ? 'bg-amber-950/10' : ''}`}>
                    <div className={`flex items-start gap-4 ${isAgentQuery ? 'pl-10 pr-5 py-3' : 'px-5 py-4'}`}>
                      <div className="relative z-10 shrink-0">
                        <div className={`h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-bold ${
                          displayStatus === 'IN_PROGRESS' ? 'bg-amber-500 border-2 border-amber-300' :
                          displayStatus === 'ERROR'       ? 'bg-down border-2 border-down' :
                          displayStatus === 'DONE'        ? `bg-surface2 border-2 ${stepRingColor[ev.step] ?? 'border-borderMid'}` :
                          'bg-surface3 border-2 border-borderMid'
                        }`}>
                          {displayStatus === 'IN_PROGRESS'
                            ? <span className="animate-spin text-white text-xs">↻</span>
                            : <span className={`text-xs ${displayStatus === 'ERROR' ? 'text-white' : meta.color}`}>{meta.icon}</span>}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 pt-0.5">
                        <div className="flex items-center justify-between mb-0.5">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-semibold ${meta.color}`}>{meta.label}</span>
                            {ev.agent_name && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${isAgentQuery ? 'text-teal-600 dark:text-teal-300 bg-teal-50 dark:bg-teal-900/60 border border-teal-300 dark:border-teal-700/50' : 'text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/60 border border-brand-300 dark:border-brand-700/50'}`}>{ev.agent_name}</span>
                            )}
                            {ev.status === 'ERROR' && (
                              <span className="text-[10px] text-down bg-down-bg border border-down/20 px-1.5 py-0.5 rounded">ERROR</span>
                            )}
                            {ev.step === 'WEB_RESEARCH' && ev.status === 'DONE' && research.length > 0 && (
                              <button
                                onClick={() => setResearchStepOpen(o => !o)}
                                className="text-[10px] text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/60 border border-brand-300 dark:border-brand-700/50 px-2 py-0.5 rounded-full hover:bg-brand-100 dark:hover:bg-brand-800/60 transition-colors">
                                {research.length} articles {researchStepOpen ? '▲' : '▼'}
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-3">
                            {live && <span className={`h-1.5 w-1.5 rounded-full ${displayStatus === 'IN_PROGRESS' ? 'bg-amber-400 animate-pulse' : displayStatus === 'DONE' ? 'bg-up' : displayStatus === 'ERROR' ? 'bg-down' : 'bg-textDim'}`} />}
                            <span className="text-[10px] text-textDim font-mono">{timeStr}</span>
                          </div>
                        </div>
                        {ev.detail && <p className="text-[11px] text-textMuted leading-relaxed">{ev.detail}</p>}
                      </div>
                    </div>
                    {/* Inline research articles under WEB_RESEARCH step */}
                    {ev.step === 'WEB_RESEARCH' && ev.status === 'DONE' && researchStepOpen && research.length > 0 && (
                      <div className="ml-16 mr-5 mb-4 border border-borderLight rounded-lg overflow-hidden bg-surface2/40">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x-0">
                          {research.map((r, ri) => {
                            let domain = '';
                            try { domain = new URL(r.source_url).hostname.replace('www.', ''); } catch {}
                            return (
                              <div key={r.id} className={`p-3 hover:bg-surface3/50 transition-colors group ${ri < research.length - 1 ? 'border-b border-borderLight' : ''}`}>
                                <a href={r.source_url} target="_blank" rel="noreferrer" className="block mb-1">
                                  <p className="text-xs font-medium text-textMain group-hover:text-brand-400 leading-snug transition-colors line-clamp-2">{r.title}</p>
                                  {domain && <p className="text-[10px] text-brand-500 mt-0.5">{domain} ↗</p>}
                                </a>
                                <p className="text-[11px] text-textMuted line-clamp-2 leading-relaxed mb-1.5">{r.snippet}</p>
                                <p className="text-[10px] text-textDim">{new Date(r.fetched_at).toLocaleString()}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {live && isActive && (
                <div className="flex items-center gap-4 px-5 py-4 bg-surface2/50">
                  <div className="shrink-0 h-7 w-7 rounded-full border-2 border-borderMid bg-surface3 flex items-center justify-center">
                    <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                  </div>
                  <p className="text-xs text-textMuted animate-pulse">Waiting for next step…</p>
                </div>
              )}
            </div>
          </div>
          {!isActive || !live ? (
            <div className={`px-5 py-3 border-t border-borderLight flex items-center justify-between ${hasError ? 'bg-down-bg/20' : 'bg-up-bg/20'}`}>
              <span className={`text-xs ${hasError ? 'text-down' : 'text-up'}`}>{hasError ? '✕ Ended with error' : '✓ Completed'} · {events.length} events</span>
              <span className="text-[11px] text-textDim font-mono">{dur}s</span>
            </div>
          ) : null}
        </>
      );
    };

    // Ticker search helpers (used in the control bar below)
    const addFocusTicker = (sym: string) => {
      if (!focusTickers.includes(sym)) setFocusTickers(p => [...p, sym]);
      setFocusSearch(''); setFocusSearchOpen(false); setTickerSearchResults([]);
    };
    const focusVisibleResults = tickerSearchResults.filter(r => !focusTickers.includes(r.symbol));
    const showFocusDropdown = focusSearchOpen && (tickerSearchLoading || focusVisibleResults.length > 0);

    return (
      <div className="space-y-4">
        {/* ── Control bar ─────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-borderLight bg-surface overflow-hidden">

          {/* Row 1: Investment focus + Run button */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-borderLight">
            <span className="text-[10px] font-semibold text-textDim uppercase tracking-widest shrink-0">Focus</span>
            <input
              type="text"
              value={investmentFocus}
              onChange={e => setInvestmentFocus(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveInvestmentFocus(investmentFocus); }}
              placeholder="e.g. AI semiconductors, Indian IT, Bitcoin momentum… (leave empty for broad coverage)"
              className="flex-1 bg-transparent text-xs text-textMain placeholder-textDim focus:outline-none min-w-0"
            />
            {investmentFocus && (
              <button
                onClick={() => saveInvestmentFocus(investmentFocus)}
                className={`shrink-0 px-2.5 py-1 rounded text-[10px] font-semibold border transition-all ${investmentFocusSaved ? 'bg-up-bg text-up border-up/30' : 'bg-surface2 border-borderMid text-textMuted hover:border-brand-500 hover:text-brand-400'}`}
              >{investmentFocusSaved ? '✓ Saved' : 'Save'}</button>
            )}
            <div className="h-4 w-px bg-borderLight shrink-0" />
            {isActive ? (
              <button onClick={handleStopPipeline} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-down/40 bg-down-bg text-down-text hover:opacity-80 transition-opacity">
                ■ Stop
              </button>
            ) : (
              <button onClick={() => handleManualTrigger(focusTickers.length > 0 ? focusTickers : undefined)}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border bg-brand-600 border-brand-500 text-white hover:bg-brand-500 transition-colors">
                ▶ {focusTickers.length > 0 ? `Run ${focusTickers.length} ticker${focusTickers.length !== 1 ? 's' : ''}` : 'Run Pipeline'}
              </button>
            )}
          </div>

          {/* Row 2: Sector pills + ticker search */}
          <div className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
            {/* Market sector pills */}
            <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
              {Object.entries(MARKET_SECTORS).map(([market, sectors]) =>
                sectors.map(sector => {
                  const isActiveFilter = focusSectorFilter?.market === market && focusSectorFilter?.sector === sector;
                  return (
                    <button key={`${market}-${sector}`}
                      onClick={() => {
                        if (isActiveFilter) { setFocusSectorFilter(null); } else {
                          setFocusSectorFilter({ market, sector });
                          const st = TICKER_DB.filter(t => t.market === market && t.sector === sector).map(t => t.symbol);
                          setFocusTickers(prev => [...new Set([...prev, ...st])]);
                        }
                      }}
                      className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${isActiveFilter ? 'bg-brand-600 border-brand-500 text-white' : 'bg-surface2 border-borderLight text-textMuted hover:border-brand-400 hover:text-brand-400'}`}
                    >
                      <span className="mr-1 opacity-60">{MARKET_ICONS[market]}</span>{sector}
                    </button>
                  );
                })
              )}
            </div>
            {/* Ticker search */}
            <div className="relative shrink-0 w-56">
              <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border bg-surface2 transition-colors ${focusSearchOpen ? 'border-brand-500' : 'border-borderLight'}`}>
                <span className="text-textDim text-[10px] shrink-0">{tickerSearchLoading ? <span className="animate-spin inline-block">↻</span> : '⌕'}</span>
                <input type="text" value={focusSearch}
                  onChange={e => {
                    const val = e.target.value; setFocusSearch(val); setFocusSearchOpen(true);
                    if (focusSearchTimer[0]) clearTimeout(focusSearchTimer[0]);
                    if (!val.trim()) { setTickerSearchResults([]); setTickerSearchLoading(false); return; }
                    setTickerSearchLoading(true);
                    focusSearchTimer[0] = setTimeout(async () => {
                      try { const res = await apiFetch(`/search/tickers?q=${encodeURIComponent(val.trim())}`); if (res.ok) setTickerSearchResults(await res.json()); } catch { /**/ }
                      setTickerSearchLoading(false);
                    }, 350);
                  }}
                  onFocus={() => setFocusSearchOpen(true)}
                  onBlur={() => setTimeout(() => setFocusSearchOpen(false), 150)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && focusVisibleResults.length > 0) addFocusTicker(focusVisibleResults[0].symbol);
                    if (e.key === 'Escape') { setFocusSearchOpen(false); setFocusSearch(''); }
                  }}
                  placeholder="Add ticker…"
                  className="flex-1 bg-transparent text-[11px] text-textMain placeholder-textDim focus:outline-none w-0 min-w-0"
                />
              </div>
              {showFocusDropdown && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-surface border border-borderMid rounded-lg shadow-xl z-20 overflow-hidden max-h-60 overflow-y-auto">
                  {tickerSearchLoading && focusVisibleResults.length === 0 && <div className="px-3 py-2 text-xs text-textDim animate-pulse">Searching…</div>}
                  {focusVisibleResults.map(t => (
                    <button key={t.symbol} onMouseDown={e => { e.preventDefault(); addFocusTicker(t.symbol); }}
                      className="w-full text-left px-3 py-2 hover:bg-surface2 flex items-center justify-between gap-2 border-b border-borderLight last:border-0">
                      <span className="text-xs font-mono font-semibold text-textMain">{t.symbol}</span>
                      <span className="text-[10px] text-textMuted truncate flex-1 text-right">{t.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {(focusTickers.length > 0 || focusSectorFilter) && (
              <button onClick={() => { setFocusTickers([]); setFocusSectorFilter(null); }} className="text-[10px] text-textDim hover:text-textMuted transition-colors shrink-0">✕ Clear</button>
            )}
          </div>

          {/* Row 3: Selected ticker chips (only when non-empty) */}
          {focusTickers.length > 0 && (
            <div className="px-4 py-2 border-t border-borderLight flex flex-wrap gap-1.5 bg-surface2/40">
              {focusTickers.map(t => (
                <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono bg-brand-900/40 border border-brand-700/40 text-brand-300">
                  {t}
                  <button onClick={() => setFocusTickers(p => p.filter(x => x !== t))} className="hover:text-brand-200 text-[9px] leading-none ml-0.5 opacity-60 hover:opacity-100">✕</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Two-column layout: left = run tabs, right = event panel */}
        <div className="flex gap-0 border border-borderLight rounded-xl overflow-hidden" style={{ minHeight: '520px' }}>

          {/* Left: vertical tab list */}
          <div className="w-56 shrink-0 border-r border-borderLight bg-surface2 flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-borderLight">
              <p className="text-[10px] font-semibold text-textDim uppercase tracking-widest">Pipeline Runs</p>
            </div>
            <div className="flex-1 overflow-y-auto">
              {/* Live tab */}
              <button
                onClick={() => { setSelectedRunId(null); setSelectedRunEvents([]); }}
                className={`w-full text-left px-4 py-3 border-b border-borderLight transition-colors ${viewingLive ? 'bg-surface border-l-2 border-l-brand-500' : 'hover:bg-surface3'}`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  {isActive
                    ? <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping shrink-0" />
                    : <span className="h-2 w-2 rounded-full bg-textDim shrink-0" />}
                  <span className="text-xs font-semibold text-textMain truncate">Live</span>
                </div>
                <p className="text-[10px] text-textDim pl-4">{isActive ? 'Running…' : pipelineEvents.length > 0 ? `${pipelineEvents.length} events` : 'Idle'}</p>
              </button>

              {/* Past run tabs */}
              {pipelineRuns.map(run => {
                const isSelected = selectedRunId === run.run_id;
                const dur = Math.round((new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()) / 1000);
                const out = run.output;
                return (
                  <button key={run.run_id}
                    onClick={() => loadRunEvents(run.run_id)}
                    className={`w-full text-left px-4 py-3 border-b border-borderLight transition-colors ${isSelected ? 'bg-surface border-l-2 border-l-brand-500' : 'hover:bg-surface3'}`}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-xs shrink-0 ${run.status === 'error' ? 'text-down' : 'text-up'}`}>
                        {run.status === 'error' ? '✕' : '✓'}
                      </span>
                      {out ? (
                        <>
                          <span className="text-xs font-bold font-mono text-textMain truncate">{out.ticker}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${out.action === 'LONG' ? 'bg-up/10 text-up' : 'bg-down/10 text-down'}`}>{out.action}</span>
                          <span className="text-[9px] text-textDim shrink-0">{out.votes}</span>
                        </>
                      ) : (
                        <span className="text-xs font-mono text-textMuted truncate">{run.run_id.substring(0, 8)}…</span>
                      )}
                    </div>
                    <p className="text-[10px] text-textDim pl-4 truncate">
                      {new Date(run.started_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {dur}s
                    </p>
                  </button>
                );
              })}

              {!pipelineRunsLoaded && (
                <div className="px-4 py-5 space-y-2">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="animate-pulse space-y-1.5">
                      <div className="h-2.5 bg-surface3 rounded w-3/4" style={{ opacity: 1 - i * 0.2 }} />
                      <div className="h-2 bg-surface3 rounded w-1/2" style={{ opacity: 1 - i * 0.2 }} />
                    </div>
                  ))}
                </div>
              )}
              {pipelineRunsLoaded && pipelineRuns.length === 0 && (
                <p className="px-4 py-4 text-[11px] text-textDim">No past runs yet.</p>
              )}
            </div>
          </div>

          {/* Right: event panel */}
          <div className="flex-1 min-w-0 overflow-y-auto bg-background">
            {/* Panel header */}
            <div className="px-5 py-3.5 border-b border-borderLight bg-surface2 flex items-center justify-between sticky top-0 z-10">
              <div className="flex items-center gap-2">
                {viewingLive ? (
                  isActive ? (
                    <span className="flex items-center gap-1.5 text-xs text-amber-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" /> Running
                    </span>
                  ) : (
                    <span className="text-xs text-textDim">Idle — ready to run</span>
                  )
                ) : (() => {
                  const selectedRun = pipelineRuns.find(r => r.run_id === selectedRunId);
                  const runDur = selectedRun ? Math.round((new Date(selectedRun.ended_at).getTime() - new Date(selectedRun.started_at).getTime()) / 1000) : null;
                  return (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-textMuted bg-surface3 px-2 py-0.5 rounded">run/{selectedRunId?.substring(0, 8)}</span>
                      {selectedRun && (
                        <span className="text-[10px] text-textDim">{selectedRun.event_count} events{runDur != null ? ` · ${runDur}s` : ''}</span>
                      )}
                    </div>
                  );
                })()}
                {viewingLive && pipelineRunId && (
                  <span className="text-[10px] text-textDim font-mono bg-surface3 px-2 py-0.5 rounded">run/{pipelineRunId.substring(0, 8)}…</span>
                )}
              </div>
              {focusTickers.length > 0 && viewingLive && !isActive && (
                <span className="text-[10px] text-brand-400 bg-brand-900/40 border border-brand-700/30 px-2 py-0.5 rounded-full font-mono">
                  focused · {focusTickers.join(', ')}
                </span>
              )}
            </div>
            {renderEventList(panelEvents, viewingLive)}
            {/* Run output card — shown for completed past runs with output */}
            {(() => {
              if (viewingLive) return null;
              const selectedRun = pipelineRuns.find(r => r.run_id === selectedRunId);
              const out = selectedRun?.output;
              if (!out) return null;
              return (
                <div className="px-5 py-5 border-t border-borderLight bg-surface">
                  <div className="rounded-xl border border-borderLight bg-surface2 overflow-hidden">
                    {/* Header */}
                    <div className="px-4 py-3 border-b border-borderLight flex items-center justify-between bg-surface3">
                      <div className="flex items-center gap-2.5">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-textDim">Pipeline Output</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${out.action === 'LONG' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>
                          {out.action}
                        </span>
                      </div>
                      {out.strategy_id != null && (
                        <button
                          onClick={() => openReport(out.strategy_id!)}
                          className="flex items-center gap-1 text-[10px] font-semibold text-brand-400 hover:text-brand-300 border border-brand-700/40 bg-brand-900/20 px-2.5 py-1 rounded-lg transition-colors"
                        >
                          ◈ View Report
                        </button>
                      )}
                    </div>
                    {/* Recommendation hero */}
                    <div className="px-4 py-4 flex items-center gap-4 border-b border-borderLight">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xl font-bold font-mono text-textMain">{out.ticker}</span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${out.action === 'LONG' ? 'bg-up/15 text-up border border-up/20' : 'bg-down/15 text-down border border-down/20'}`}>
                            {out.action}
                          </span>
                          <span className="text-[11px] text-textDim bg-surface3 border border-borderLight px-2 py-0.5 rounded font-mono">{out.votes}</span>
                        </div>
                        {out.judge_reasoning && (
                          <p className="text-[11px] text-textMuted leading-relaxed line-clamp-3">{out.judge_reasoning}</p>
                        )}
                      </div>
                    </div>
                    {/* Agent proposals */}
                    {out.proposals.length > 0 && (
                      <div className="divide-y divide-borderLight">
                        {out.proposals.map((p, i) => (
                          <div key={i} className="px-4 py-3 flex items-start gap-3">
                            <div className="shrink-0 mt-0.5">
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${p.action === 'LONG' ? 'bg-up/10 text-up' : 'bg-down/10 text-down'}`}>{p.action}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-[11px] font-semibold text-textMain">{p.agent_name}</span>
                                <span className="text-[10px] font-mono text-brand-400">{p.ticker}</span>
                              </div>
                              <p className="text-[10px] text-textDim leading-relaxed line-clamp-2">{p.reasoning}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

      </div>
    );
  };

  const pageContent = {
    dashboard: renderDashboard,
    markets:   renderMarkets,
    graph:     () => <KnowledgeGraphViewer />,
    portfolio: renderPortfolio,
    memory:    renderMemory,
    pipeline:  renderPipeline,
    settings:  renderSettings,
  };

  return (
    <div className="flex min-h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 min-w-[14rem] max-w-[14rem] shrink-0 border-r border-borderLight bg-surface flex flex-col overflow-hidden">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-borderLight">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-md bg-brand-600 flex items-center justify-center text-white text-xs font-bold">MI</div>
            <div>
              <p className="text-sm font-semibold text-textMain leading-none">Market Intel</p>
              <p className="text-[10px] text-textDim mt-0.5">AI Strategy Engine</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-0.5">
          {NAV.map(n => (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                page === n.id
                  ? 'bg-brand-600/15 text-brand-400'
                  : 'text-textMuted hover:text-textMain hover:bg-surface2'
              }`}
            >
              <span className={`text-base w-4 text-center ${n.id === 'pipeline' && isTriggering ? 'animate-spin text-amber-400' : ''}`}>{n.icon}</span>
              <span className="flex-1">{n.label}</span>
              {n.id === 'pipeline' && isTriggering && (
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              )}
            </button>
          ))}
        </nav>

        {/* Theme toggle + status */}
        <div className="px-5 py-4 border-t border-borderLight space-y-3">
          <button
            onClick={toggleDarkMode}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-surface2 border border-borderLight hover:bg-surface3 transition-colors"
          >
            <span className="text-[11px] text-textMuted">{darkMode ? 'Dark Mode' : 'Light Mode'}</span>
            <span className="text-base">{darkMode ? '🌙' : '☀️'}</span>
          </button>
          <div className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${isTriggering ? 'bg-amber-400 animate-pulse' : 'bg-up animate-pulse'}`} />
            <button onClick={() => isTriggering && setPage('pipeline')} className={`text-[11px] ${isTriggering ? 'text-amber-400 hover:underline cursor-pointer' : 'text-textMuted'}`}>
              {isTriggering ? 'Debate running…' : 'System active'}
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-y-auto h-screen">
        {/* Top bar */}
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-borderLight px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-textMain capitalize">{NAV.find(n => n.id === page)?.label}</h1>
            <p className="text-[11px] text-textDim mt-0.5">{new Date().toLocaleString()}</p>
          </div>
          <div className="flex items-center gap-3">
            {pendingStrategies.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setPendingDropdownOpen(o => !o)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 dark:bg-amber-950 border border-amber-300 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 rounded-lg text-xs font-medium animate-pulse hover:bg-amber-200 dark:hover:bg-amber-900 transition-colors"
                >
                  <span>⚠</span> {pendingStrategies.length} pending {pendingStrategies.length === 1 ? 'strategy' : 'strategies'}
                </button>
                {pendingDropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 z-50 w-80 bg-surface border border-borderMid rounded-xl shadow-2xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-borderLight bg-surface2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-amber-400">Pending Approval</span>
                      <button onClick={() => setPendingDropdownOpen(false)} className="text-textDim hover:text-textMain text-base leading-none">×</button>
                    </div>
                    <div className="divide-y divide-borderLight max-h-96 overflow-y-auto">
                      {pendingStrategies.map(s => (
                        <div key={s.id} className="px-4 py-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-bold px-2 py-0.5 rounded ${s.strategy_type === 'LONG' ? 'bg-up/10 text-up' : 'bg-down/10 text-down'}`}>{s.strategy_type}</span>
                              <span className="text-sm font-semibold text-textMain">{s.symbol}</span>
                            </div>
                            <span className="text-[10px] text-textDim">${(s.entry_price ?? 0).toFixed(2)}</span>
                          </div>
                          <p className="text-[11px] text-textMuted leading-relaxed line-clamp-2">{s.reasoning_summary}</p>
                          <div className="flex gap-2 pt-1">
                            <button
                              onClick={() => { handleApproval(s.id, 'approve'); setPendingDropdownOpen(false); }}
                              className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-up/10 border border-up/30 text-up hover:bg-up/20 transition-colors"
                            >Approve</button>
                            <button
                              onClick={() => { handleApproval(s.id, 'reject'); setPendingDropdownOpen(false); }}
                              className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-down/10 border border-down/30 text-down hover:bg-down/20 transition-colors"
                            >Reject</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <button
              onClick={toggleDarkMode}
              className="h-8 w-8 flex items-center justify-center rounded-lg bg-surface2 border border-borderLight hover:bg-surface3 transition-colors text-base"
              title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {darkMode ? '☀️' : '🌙'}
            </button>
            <button
              onClick={() => { clearToken(); window.location.reload(); }}
              className="h-8 w-8 flex items-center justify-center rounded-lg bg-surface2 border border-borderLight hover:bg-red-900/40 hover:border-red-700/50 hover:text-red-400 text-textDim transition-colors text-sm"
              title="Sign out"
            >⏻</button>
            <button
              onClick={() => handleManualTrigger()}
              disabled={isTriggering}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                isTriggering
                  ? 'bg-surface3 border-borderLight text-textDim cursor-not-allowed'
                  : 'bg-brand-600 border-brand-500 text-white hover:bg-brand-500'
              }`}
            >
              {isTriggering ? <span className="animate-spin">↻</span> : <span>▶</span>}
              {isTriggering ? 'Running' : 'Run Now'}
            </button>
          </div>
        </header>

        <div className="p-8">
          {pageContent[page]()}
        </div>
      </main>

      {/* Strategy Report Panel */}
      {reportStratId !== null && (
        <StrategyReportPanel
          report={reportData}
          loading={reportLoading}
          error={reportError}
          onClose={() => { setReportStratId(null); setReportData(null); setReportError(null); }}
        />
      )}
      <ToastList toasts={toasts} />
    </div>
  );
}

function App() {
  const [authed, setAuthed] = useState<boolean>(() => !!getToken());
  const handleLogin = () => {
    window.history.replaceState(null, '', window.location.pathname);
    setAuthed(true);
  };
  // If already authed and URL has a landing-page hash (e.g. #how-it-works), strip it
  if (authed && window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname);
  }
  if (!authed) return <LandingPage onLogin={handleLogin} />;
  return <AppInner />;
}

export default App;
