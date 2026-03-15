import { useEffect, useState } from 'react';

interface Prediction { id: number; symbol: string; agent_name: string; prediction: string; reasoning: string; confidence: number; score?: number; }
interface Strategy { id: number; symbol: string; strategy_type: string; entry_price: number; current_return: number; reasoning_summary: string; status: string; timestamp: string; position_size: number | null; exit_price: number | null; realized_pnl: number | null; close_reason: string | null; closed_at: string | null; notes: string | null; }
interface PortfolioPnl { total_budget: number; allocated: number; available: number; realized_pnl: number; unrealized_pnl: number; total_pnl: number; total_pnl_pct: number; positions: (Strategy & { pnl_usd: number | null; pnl_pct: number | null; is_open: boolean; current_price?: number | null })[]; }
interface MarketConfig { id: number; market_name: string; is_enabled: number; }
interface DebateRound { id: number; timestamp: string; consensus_ticker: string; consensus_action: string; consensus_votes: string; proposals_json: string; enabled_markets: string; research_context?: string; judge_reasoning?: string; }
interface Proposal { agent_name: string; ticker: string; action: string; reasoning: string; }
interface AgentMemory { id: number; agent_name: string; note_type: string; content: string; created_at: string; }
interface AgentPrompt { id: number; agent_name: string; system_prompt: string; updated_at: string | null; }
interface AgentFitness { agent_name: string; generation: number; fitness_score: number | null; win_rate: number | null; avg_return: number | null; total_scored: number; updated_at: string | null; }
interface AgentEvolution { id: number; generation: number; fitness_score: number | null; win_rate: number | null; avg_return: number | null; total_scored: number; evolution_reason: string | null; system_prompt: string; replaced_at: string | null; created_at: string; }
interface WebResearch { id: number; title: string; snippet: string; source_url: string; fetched_at: string; }
interface PipelineEvent { id: number; step: string; agent_name: string | null; status: string; detail: string | null; created_at: string; }
interface PipelineRun { run_id: string; started_at: string; ended_at: string; event_count: number; status: 'running' | 'done' | 'error'; deploy_detail: string | null; }
interface LiveQuote { market: string; symbol: string; name: string; price: number | null; prev_close: number | null; change_pct: number | null; volume: number | null; error?: string; }
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
type Page = 'dashboard' | 'markets' | 'portfolio' | 'memory' | 'pipeline' | 'settings';

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard',    icon: '▦' },
  { id: 'markets',   label: 'Markets',      icon: '◈' },
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
  const [predictions, setPredictions]       = useState<Prediction[]>([]);
  const [strategies, setStrategies]         = useState<Strategy[]>([]);
  const [markets, setMarkets]               = useState<MarketConfig[]>([]);
  const [debates, setDebates]               = useState<DebateRound[]>([]);
  const [memories, setMemories]             = useState<AgentMemory[]>([]);
  const [agents, setAgents]                 = useState<AgentPrompt[]>([]);
  const [agentFitness, setAgentFitness]     = useState<AgentFitness[]>([]);
  const [agentEvolution, setAgentEvolution] = useState<AgentEvolution[]>([]);
  const [evolutionAgent, setEvolutionAgent] = useState<string | null>(null);
  const [research, setResearch]             = useState<WebResearch[]>([]);
  const [liveQuotes, setLiveQuotes]         = useState<LiveQuote[]>([]);
  const [marketEvents, setMarketEvents]     = useState<MarketEvent[]>([]);
  const [quotesLoading, setQuotesLoading]   = useState(false);
  const [quotesMarketTab, setQuotesMarketTab] = useState<string>('All');
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
  const [budgetInput, setBudgetInput]       = useState<string>('10000');
  const [approvalMode, setApprovalMode]     = useState('auto');
  const [scheduleInterval, setScheduleInterval] = useState<number>(60);
  const [isTriggering, setIsTriggering]     = useState(false);
  const [isUpdatingSchedule, setIsUpdatingSchedule] = useState(false);
  const [investmentFocus, setInvestmentFocus] = useState('');
  const [investmentFocusSaved, setInvestmentFocusSaved] = useState(false);
  const [loading, setLoading]               = useState(true);
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
      if (predRes.ok) setPredictions(await predRes.json());
      if (mktRes.ok) setMarkets(await mktRes.json());
      if (debRes.ok) setDebates(await debRes.json());
      if (appRes.ok) { const d = await appRes.json(); setApprovalMode(d.approval_mode); }
      if (memRes.ok) setMemories(await memRes.json());
      if (resRes.ok) setResearch(await resRes.json());
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
    } catch (e) { console.error('Fetch error', e); } finally { setLoading(false); }
  };

  const fetchQuotes = async () => {
    setQuotesLoading(true);
    try {
      const [qRes, eRes] = await Promise.all([
        apiFetch('/quotes'),
        apiFetch('/market/events'),
      ]);
      if (qRes.ok) setLiveQuotes(await qRes.json());
      if (eRes.ok) setMarketEvents(await eRes.json());
    } catch (e) { console.error('Quotes fetch error', e); }
    finally { setQuotesLoading(false); }
  };

  // Fetch quotes when Markets page is opened, refresh every 30s
  useEffect(() => {
    if (page !== 'markets') return;
    fetchQuotes();
    const i = setInterval(fetchQuotes, 30000);
    return () => clearInterval(i);
  }, [page]);

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

  // Dedicated pipeline poller — 2s while running, 8s while idle
  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout>;
    const pollPipeline = async () => {
      try {
        const res = await apiFetch('/pipeline/events');
        if (res.ok) {
          const data = await res.json();
          setPipelineEvents(data.events ?? []);
          setPipelineRunId(data.run_id ?? null);
          setIsTriggering(data.is_running);
        }
      } catch { /* ignore */ }
      // Refresh run history list too
      try {
        const r = await apiFetch('/pipeline/runs');
        if (r.ok) setPipelineRuns(await r.json());
      } catch { /* ignore */ }
      timerId = setTimeout(pollPipeline, isTriggering ? 2000 : 8000);
    };
    pollPipeline();
    return () => clearTimeout(timerId);
  }, [isTriggering]);

  const loadRunEvents = async (runId: string) => {
    if (selectedRunId === runId) { setSelectedRunId(null); setSelectedRunEvents([]); return; }
    setSelectedRunId(runId);
    try {
      const res = await apiFetch(`/pipeline/runs/${runId}`);
      if (res.ok) { const d = await res.json(); setSelectedRunEvents(d.events ?? []); }
    } catch { /* ignore */ }
  };

  const toggleMarket = async (name: string, enabled: number) => {
    const v = !enabled;
    await apiFetch('/config/markets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ market_name: name, is_enabled: v }]) });
    setMarkets(p => p.map(m => m.market_name === name ? { ...m, is_enabled: v ? 1 : 0 } : m));
  };

  const setMode = async (mode: string) => {
    await apiFetch('/config/approval_mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approval_mode: mode }) });
    setApprovalMode(mode);
  };

  const handleApproval = async (id: number, action: string) => {
    await apiFetch('/strategies/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ strategy_id: id, action }) });
    fetchData();
  };

  const handleUndeploy = async (id: number) => {
    if (!confirm('Close this strategy at current market price?')) return;
    await apiFetch(`/strategies/${id}/undeploy`, { method: 'POST' });
    fetchData();
  };

  const handleStrategyUpdate = async (id: number) => {
    const body: Record<string, unknown> = {};
    if (editStratForm.position_size !== '') body.position_size = parseFloat(editStratForm.position_size);
    if (editStratForm.notes !== '') body.notes = editStratForm.notes;
    await apiFetch(`/strategies/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setEditStratId(null);
    fetchData();
  };

  const handleBudgetSave = async (val: number) => {
    await apiFetch('/config/budget', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trading_budget: val }) });
    fetchData();
  };

  const [focusTickers, setFocusTickers] = useState<string[]>([]);
  const [focusSearch, setFocusSearch] = useState('');
  const [focusSearchOpen, setFocusSearchOpen] = useState(false);
  const [focusSectorFilter, setFocusSectorFilter] = useState<{ market: string; sector: string } | null>(null);
  const [tickerSearchResults, setTickerSearchResults] = useState<{ symbol: string; name: string; sector: string; exchange: string; type: string }[]>([]);
  const [tickerSearchLoading, setTickerSearchLoading] = useState(false);
  const focusSearchTimer = useState<ReturnType<typeof setTimeout> | null>(null);

  const saveInvestmentFocus = async (text: string) => {
    await apiFetch('/config/investment_focus', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ investment_focus: text }),
    });
    setInvestmentFocusSaved(true);
    setTimeout(() => setInvestmentFocusSaved(false), 2000);
  };

  const handleManualTrigger = async (tickers?: string[]) => {
    if (isTriggering) return;
    setIsTriggering(true);
    const body = tickers && tickers.length > 0 ? { tickers } : {};
    try {
      const res = await apiFetch('/trigger', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.status === 'error') { alert(data.message); setIsTriggering(false); }
      else setTimeout(fetchData, 3000);
    } catch (e) { console.error(e); setIsTriggering(false); }
  };

  const handleScheduleUpdate = async (minutes: number) => {
    setIsUpdatingSchedule(true);
    try {
      await apiFetch('/config/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ interval_minutes: minutes }) });
      await apiFetch('/system/sync_schedule', { method: 'POST' });
      setScheduleInterval(minutes);
    } catch (e) { console.error(e); } finally { setIsUpdatingSchedule(false); }
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
  const [pipelineRuns, setPipelineRuns]           = useState<PipelineRun[]>([]);
  const [selectedRunId, setSelectedRunId]         = useState<string | null>(null);
  const [selectedRunEvents, setSelectedRunEvents] = useState<PipelineEvent[]>([]);
  const [statFocus, setStatFocus]           = useState<'active' | 'pending' | 'debates' | 'memories' | null>(null);

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
          {loading && <Card className="p-8 text-center text-textMuted text-sm">Loading…</Card>}
          {!loading && strategies.length === 0 && (
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
                                {strat.status === 'ACTIVE' && (
                                  <div className="shrink-0 flex gap-2">
                                    <button
                                      onClick={() => { setEditStratId(strat.id); setEditStratForm({ position_size: strat.position_size?.toString() ?? '', notes: strat.notes ?? '' }); }}
                                      className="px-2 py-1 text-[10px] bg-surface3 border border-borderLight text-textMuted rounded hover:text-textMain transition-colors"
                                    >✎ Edit</button>
                                    <button
                                      onClick={() => handleUndeploy(strat.id)}
                                      className="px-2 py-1 text-[10px] bg-down-bg text-down-text border border-down/20 rounded hover:opacity-80 transition-opacity font-semibold"
                                    >✕ Undeploy</button>
                                  </div>
                                )}
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


  const saveAgentPrompt = async (agentName: string, prompt: string) => {
    await apiFetch(`/agents/${encodeURIComponent(agentName)}/prompt`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system_prompt: prompt }),
    });
    setEditingPromptAgent(null);
    fetchData();
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
              <span className="text-[10px] text-brand-400">{((p.allocated / p.total_budget) * 100).toFixed(0)}% allocated · ${p.allocated.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
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
                          {pos.pnl_usd != null && <p className={`text-[11px] font-mono ${pnlUp ? 'text-up' : 'text-down'}`}>{fmtUsd(pos.pnl_usd)}</p>}
                        </div>
                        <div className="flex flex-col gap-1">
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
                      <div className="text-right shrink-0">
                        <p className={`text-lg font-light tabular-nums ${pnlUp ? 'text-up' : 'text-down'}`}>{fmtPct(pos.pnl_pct)}</p>
                        {pos.realized_pnl != null && (
                          <p className={`text-[11px] font-mono ${(pos.realized_pnl ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>
                            {fmtUsd(pos.realized_pnl)}
                          </p>
                        )}
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

    // All default tickers across all markets
    const allDefaultSymbols = TICKER_DB.map(t => t.symbol);
    // User-added symbols not in defaults
    const userAddedSymbols = watchlist.filter(s => !allDefaultSymbols.includes(s));
    // Combined unique symbol list
    const allSymbols = [...new Set([...allDefaultSymbols, ...userAddedSymbols])];

    // Filter by market tab
    const tabSymbols = quotesMarketTab === 'All'
      ? allSymbols
      : allSymbols.filter(sym => {
          const meta = TICKER_META[sym];
          if (meta) return meta.market === quotesMarketTab;
          // For user-added symbols not in TICKER_DB, detect market from quote data
          const q = liveQuotes.find(q => q.symbol === sym);
          return q?.market === quotesMarketTab;
        });

    // Symbols with active positions
    const positionSymbols = [...new Set(activeStrategies.map(s => s.symbol))];
    const positionTabSymbols = positionSymbols.filter(sym =>
      quotesMarketTab === 'All' || (() => {
        const meta = TICKER_META[sym];
        if (meta) return meta.market === quotesMarketTab;
        const q = liveQuotes.find(q => q.symbol === sym);
        return q?.market === quotesMarketTab;
      })()
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
            {q?.change_pct != null && (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${up ? 'bg-up-bg text-up-text' : 'bg-down-bg text-down-text'}`}>
                {up ? '+' : ''}{q.change_pct.toFixed(2)}%
              </span>
            )}
          </div>
          {q?.price != null ? (
            <p className="text-lg font-light font-mono text-textMain leading-none">
              {fmt(q.price, q.price > 100 ? 2 : 4)}
            </p>
          ) : (
            <p className="text-sm text-textDim">—</p>
          )}
          {q?.name && <p className="text-[10px] text-textDim mt-1.5 truncate">{q.name}</p>}
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
          {(['All', ...enabledMarketNames] as string[]).map(m => (
            <button key={m}
              onClick={() => { setQuotesMarketTab(m); setQuotesStockTab(null); }}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
                quotesMarketTab === m
                  ? 'border-brand-500 bg-brand-900/30 text-brand-300'
                  : 'border-borderLight bg-surface2 text-textMuted hover:text-textMain hover:border-borderMid'
              }`}>
              {m !== 'All' && <span>{MARKET_ICONS[m]}</span>}
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
                  <button key={mins} onClick={() => handleScheduleUpdate(mins)} disabled={isUpdatingSchedule}
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

  const handleStopPipeline = async () => {
    await apiFetch('/system/stop', { method: 'POST' });
    setIsTriggering(false);
  };

  const PIPELINE_STEPS = [
    { step: 'START',        label: 'Initialise',          desc: 'Acquire lock, set run ID' },
    { step: 'WEB_RESEARCH', label: 'Shared Retrieval',    desc: 'Fetch news, research & live prices once for all agents' },
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
      if (events.length === 0) {
        return <p className="px-5 py-8 text-sm text-textMuted text-center">Loading…</p>;
      }
      const hasError = events.some(e => e.status === 'ERROR');
      const dur = Math.round((new Date(events[events.length - 1].created_at).getTime() - new Date(events[0].created_at).getTime()) / 1000);
      const stepRingColor: Record<string, string> = {
        START:        'border-brand-500',
        WEB_RESEARCH: 'border-purple-500',
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
                // If the pipeline is no longer running, treat any stuck IN_PROGRESS as DONE
                const displayStatus = (live && !isActive && ev.status === 'IN_PROGRESS') ? 'DONE' : ev.status;
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

    return (
      <div className="space-y-5">
        {/* Investment Focus prompt */}
        <Card className="p-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <p className="text-xs font-semibold text-textMain">Investment Focus <span className="text-textDim font-normal">(persisted across runs)</span></p>
              <p className="text-[11px] text-textDim mt-0.5">
                Describe what you're interested in — the pipeline will scrape targeted research and steer agents accordingly.
                Leave empty for broad market coverage.
              </p>
            </div>
            <button
              onClick={() => saveInvestmentFocus(investmentFocus)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                investmentFocusSaved
                  ? 'bg-up-bg text-up-text border-up/30'
                  : 'bg-brand-600 border-brand-500 text-white hover:bg-brand-500'
              }`}
            >
              {investmentFocusSaved ? '✓ Saved' : 'Save'}
            </button>
          </div>
          <textarea
            value={investmentFocus}
            onChange={e => setInvestmentFocus(e.target.value)}
            rows={3}
            placeholder={`e.g. "AI and semiconductor stocks in the US — focused on NVDA, AMD, and INTC"\n"Indian IT sector — TCS, Infosys, Wipro and mid-cap IT"\n"Crypto: Bitcoin and Ethereum momentum plays"\n"US healthcare and biotech — growth stocks with upcoming catalysts"`}
            className="w-full bg-surface2 border border-borderLight rounded-lg px-3 py-2.5 text-xs text-textMain placeholder-textDim focus:outline-none focus:border-brand-500 resize-none leading-relaxed"
          />
          {investmentFocus && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {/* Show extracted keywords as preview chips */}
              {['tech', 'ai', 'semiconductor', 'ev', 'healthcare', 'pharma', 'crypto', 'bitcoin',
                'energy', 'banking', 'india', 'small cap', 'growth', 'dividend'].filter(kw =>
                  investmentFocus.toLowerCase().includes(kw)
              ).map(kw => (
                <span key={kw} className="text-[10px] px-2 py-0.5 rounded-full bg-brand-900/30 border border-brand-700/30 text-brand-400 dark:text-brand-300">
                  {kw}
                </span>
              ))}
            </div>
          )}
        </Card>

        {/* Top bar: focus picker + run controls */}
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs font-semibold text-textMain">Focus Run <span className="text-textDim font-normal">(optional)</span></p>
                  <p className="text-[11px] text-textDim mt-0.5">Search by name or ticker, or pick a market sector. Leave empty to run across all enabled markets.</p>
                </div>
                {(focusTickers.length > 0 || focusSectorFilter) && (
                  <button onClick={() => { setFocusTickers([]); setFocusSectorFilter(null); }} className="text-[11px] text-textDim hover:text-textMuted px-2 py-1 rounded hover:bg-surface2 transition-colors shrink-0 ml-3">✕ Clear all</button>
                )}
              </div>

              {/* Sector filter pills — grouped by market */}
              <div className="mb-3 space-y-1.5">
                {Object.entries(MARKET_SECTORS).map(([market, sectors]) => (
                  <div key={market} className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-textDim w-10 shrink-0">{MARKET_ICONS[market]}</span>
                    {sectors.map(sector => {
                      const isActive = focusSectorFilter?.market === market && focusSectorFilter?.sector === sector;
                      return (
                        <button
                          key={sector}
                          onClick={() => {
                            if (isActive) {
                              setFocusSectorFilter(null);
                            } else {
                              setFocusSectorFilter({ market, sector });
                              // Add all tickers in this sector that aren't already selected
                              const sectorTickers = TICKER_DB.filter(t => t.market === market && t.sector === sector).map(t => t.symbol);
                              setFocusTickers(prev => [...new Set([...prev, ...sectorTickers])]);
                            }
                          }}
                          className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                            isActive
                              ? 'bg-brand-600 border-brand-500 text-white'
                              : 'bg-surface2 border-borderLight text-textMuted hover:border-brand-500 hover:text-brand-400'
                          }`}
                        >
                          {sector}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Selected ticker tags */}
              {focusTickers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {focusTickers.map(t => {
                    const meta = TICKER_META[t];
                    return (
                      <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono bg-brand-600 border border-brand-500 text-white">
                        {t}{meta ? <span className="font-sans font-normal opacity-70 text-[10px]"> · {meta.name}</span> : null}
                        <button onClick={() => setFocusTickers(p => p.filter(x => x !== t))} className="hover:text-brand-200 leading-none text-[10px] ml-0.5">✕</button>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Ticker search */}
              {(() => {
                const addTicker = (sym: string) => {
                  if (!focusTickers.includes(sym)) setFocusTickers(p => [...p, sym]);
                  setFocusSearch('');
                  setFocusSearchOpen(false);
                  setTickerSearchResults([]);
                };
                const visibleResults = tickerSearchResults.filter(r => !focusTickers.includes(r.symbol));
                const showDropdown = focusSearchOpen && (tickerSearchLoading || visibleResults.length > 0);
                return (
                  <div className="relative">
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border bg-surface2 transition-colors ${focusSearchOpen ? 'border-brand-500' : 'border-borderLight hover:border-borderMid'}`}>
                      {tickerSearchLoading
                        ? <span className="text-brand-400 text-xs animate-spin shrink-0">↻</span>
                        : <span className="text-textDim text-xs shrink-0">⌕</span>}
                      <input
                        type="text"
                        value={focusSearch}
                        onChange={e => {
                          const val = e.target.value;
                          setFocusSearch(val);
                          setFocusSearchOpen(true);
                          // Debounce API call
                          if (focusSearchTimer[0]) clearTimeout(focusSearchTimer[0]);
                          if (val.trim().length === 0) {
                            setTickerSearchResults([]);
                            setTickerSearchLoading(false);
                            return;
                          }
                          setTickerSearchLoading(true);
                          focusSearchTimer[0] = setTimeout(async () => {
                            try {
                              const res = await apiFetch(`/search/tickers?q=${encodeURIComponent(val.trim())}`);
                              if (res.ok) setTickerSearchResults(await res.json());
                            } catch { /* ignore */ }
                            setTickerSearchLoading(false);
                          }, 350);
                        }}
                        onFocus={() => setFocusSearchOpen(true)}
                        onBlur={() => setTimeout(() => setFocusSearchOpen(false), 150)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && visibleResults.length > 0) addTicker(visibleResults[0].symbol);
                          if (e.key === 'Escape') { setFocusSearchOpen(false); setFocusSearch(''); setTickerSearchResults([]); }
                        }}
                        placeholder="Search any ticker or company name (e.g. Intel, NVDA, Bitcoin)…"
                        className="flex-1 bg-transparent text-xs text-textMain placeholder-textDim focus:outline-none"
                      />
                      {focusSearch && (
                        <button onMouseDown={e => { e.preventDefault(); setFocusSearch(''); setTickerSearchResults([]); }} className="text-textDim hover:text-textMuted text-[10px] shrink-0">✕</button>
                      )}
                    </div>
                    {showDropdown && (
                      <div className="absolute left-0 right-0 top-full mt-1 bg-surface border border-borderMid rounded-lg shadow-xl z-20 overflow-hidden max-h-72 overflow-y-auto">
                        {tickerSearchLoading && visibleResults.length === 0 && (
                          <div className="px-4 py-3 text-xs text-textDim animate-pulse">Searching…</div>
                        )}
                        {visibleResults.map(t => {
                          const typeColor: Record<string, string> = {
                            equity: 'text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/30',
                            etf:    'text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/30',
                            crypto: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30',
                            future: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30',
                          };
                          const tc = typeColor[t.type] ?? 'text-textDim bg-surface3';
                          return (
                            <button
                              key={t.symbol}
                              onMouseDown={e => { e.preventDefault(); addTicker(t.symbol); }}
                              className="w-full text-left px-3 py-2.5 hover:bg-surface2 transition-colors flex items-center justify-between gap-3 group border-b border-borderLight last:border-0"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className="text-xs font-mono font-semibold text-textMain group-hover:text-brand-400 transition-colors shrink-0">{t.symbol}</span>
                                <span className="text-[11px] text-textMuted truncate">{t.name}</span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {t.sector && <span className="text-[9px] text-textDim bg-surface3 px-1.5 py-0.5 rounded truncate max-w-[80px]">{t.sector}</span>}
                                {t.type && <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${tc}`}>{t.type}</span>}
                                {t.exchange && <span className="text-[9px] text-textDim">{t.exchange}</span>}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
            </Card>
          </div>
          <div className="flex flex-col gap-2 shrink-0 pt-1">
            {isActive && (
              <button onClick={handleStopPipeline}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium border border-down/40 bg-down-bg text-down-text hover:opacity-80 transition-opacity">
                ■ Stop
              </button>
            )}
            <button onClick={() => handleManualTrigger(focusTickers.length > 0 ? focusTickers : undefined)} disabled={isActive}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium border transition-colors ${isActive ? 'bg-surface3 border-borderLight text-textDim cursor-not-allowed' : 'bg-brand-600 border-brand-500 text-white hover:bg-brand-500'}`}>
              {isActive ? <><span className="animate-spin">↻</span> Running</> : focusTickers.length > 0 ? <>▶ Run on {focusTickers.length} ticker{focusTickers.length !== 1 ? 's' : ''}</> : <>▶ Run Pipeline</>}
            </button>
          </div>
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
              {pipelineRuns.filter(r => r.run_id !== pipelineRunId).map(run => {
                const isSelected = selectedRunId === run.run_id;
                const dur = Math.round((new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()) / 1000);
                // Parse ticker from deploy_detail (e.g. "NVDA LONG" or "Deployed NVDA LONG")
                let deployTicker: string | null = null;
                if (run.deploy_detail) {
                  const words = run.deploy_detail.trim().split(/\s+/);
                  // Skip leading words like "Deployed"
                  const tickerWord = words.find(w => w === w.toUpperCase() && w.length >= 2 && w !== 'LONG' && w !== 'SHORT' && w !== 'DEPLOYED');
                  deployTicker = tickerWord ?? null;
                }
                return (
                  <button key={run.run_id}
                    onClick={() => loadRunEvents(run.run_id)}
                    className={`w-full text-left px-4 py-3 border-b border-borderLight transition-colors ${isSelected ? 'bg-surface border-l-2 border-l-brand-500' : 'hover:bg-surface3'}`}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-xs shrink-0 ${run.status === 'error' ? 'text-down' : 'text-up'}`}>
                        {run.status === 'error' ? '✕' : '✓'}
                      </span>
                      <span className="text-xs font-mono text-textMuted truncate">{run.run_id.substring(0, 8)}…</span>
                      {deployTicker && (
                        <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded bg-brand-900/40 border border-brand-700/30 text-brand-400 shrink-0">{deployTicker}</span>
                      )}
                    </div>
                    <p className="text-[10px] text-textDim pl-4 truncate">
                      {new Date(run.started_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {dur}s
                    </p>
                  </button>
                );
              })}

              {pipelineRuns.length === 0 && (
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
          </div>
        </div>

      </div>
    );
  };

  const pageContent = {
    dashboard: renderDashboard,
    markets:   renderMarkets,
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
              <button
                onClick={() => setPage('dashboard')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 dark:bg-amber-950 border border-amber-300 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 rounded-lg text-xs font-medium animate-pulse hover:bg-amber-200 dark:hover:bg-amber-900 transition-colors"
              >
                <span>⚠</span> {pendingStrategies.length} Pending
              </button>
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
    </div>
  );
}

function App() {
  const [authed, setAuthed] = useState<boolean>(() => !!getToken());
  if (!authed) return <LandingPage onLogin={() => setAuthed(true)} />;
  return <AppInner />;
}

export default App;
