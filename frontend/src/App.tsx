import { useEffect, useRef, useState } from 'react';

import type {
  Strategy, StrategyReport, PortfolioPnl, MarketConfig, DebateRound,
  AgentMemory, AgentPrompt, AgentFitness, WebResearch,
  PipelineEvent, PipelineRun, LiveQuote, MarketEvent, Page, PipelineReadiness
} from './types';
import { NAV, API } from './constants';
import { getToken, apiFetch, applyTheme, getMarketForTicker, getCurrencySymbol } from './utils';

import { Badge } from './components/Badge';
import { ToastList } from './components/ToastList';
import { StrategyReportPanel } from './templates/StrategyReportPanel';
import { useToast } from './hooks/useToast';

import { LandingPage } from './pages/LandingPage';
import { DashboardPage } from './pages/DashboardPage';
import { MarketsPage } from './pages/MarketsPage';
import { KnowledgeGraphPage } from './pages/KnowledgeGraphPage';
import { PortfolioPage } from './pages/PortfolioPage';
import { AgentPage } from './pages/AgentPage';
import { PipelinePage } from './pages/PipelinePage';
import { SettingsPage } from './pages/SettingsPage';
import LLMUsagePage from './pages/LLMUsagePage';
import { PageLoader } from './components/PageLoader';

// ── Nav icons ──────────────────────────────────────────────────────────────
// Inline SVG icons — no dependency, pixel-perfect at 18×18

const NAV_ICONS: Record<string, (props: React.SVGProps<SVGSVGElement>) => React.ReactElement> = {
  // Dashboard — command grid with pulse dot
  dashboard: (p) => (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="2" y="2" width="6" height="6" rx="1.5"/>
      <rect x="10" y="2" width="6" height="6" rx="1.5"/>
      <rect x="2" y="10" width="6" height="6" rx="1.5"/>
      <path d="M10 13h6M13 10v6"/>
    </svg>
  ),
  // Markets — candlestick chart
  markets: (p) => (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="4"  y1="2"  x2="4"  y2="16"/>
      <rect x="2.5" y="5"  width="3" height="5" rx="0.75" fill="currentColor" stroke="none" opacity="0.9"/>
      <line x1="9"  y1="2"  x2="9"  y2="16"/>
      <rect x="7.5" y="3"  width="3" height="6" rx="0.75" fill="currentColor" stroke="none" opacity="0.9"/>
      <line x1="14" y1="4"  x2="14" y2="16"/>
      <rect x="12.5" y="7" width="3" height="5" rx="0.75" fill="currentColor" stroke="none" opacity="0.9"/>
    </svg>
  ),
  // Knowledge Graph — nodes connected in a network
  graph: (p) => (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" {...p}>
      <circle cx="9"  cy="9"  r="2"   fill="currentColor" opacity="0.9" stroke="none"/>
      <circle cx="3"  cy="4"  r="1.3" fill="currentColor" opacity="0.65" stroke="none"/>
      <circle cx="15" cy="4"  r="1.3" fill="currentColor" opacity="0.65" stroke="none"/>
      <circle cx="3"  cy="14" r="1.3" fill="currentColor" opacity="0.5"  stroke="none"/>
      <circle cx="15" cy="14" r="1.3" fill="currentColor" opacity="0.5"  stroke="none"/>
      <line x1="9" y1="9" x2="3"  y2="4"/>
      <line x1="9" y1="9" x2="15" y2="4"/>
      <line x1="9" y1="9" x2="3"  y2="14"/>
      <line x1="9" y1="9" x2="15" y2="14"/>
      <line x1="3" y1="4" x2="15" y2="4" opacity="0.4"/>
    </svg>
  ),
  // Portfolio — stacked bar chart (capital allocation)
  portfolio: (p) => (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="2" y1="16" x2="16" y2="16"/>
      <rect x="3"  y="9"  width="3" height="7" rx="0.75" fill="currentColor" stroke="none" opacity="0.9"/>
      <rect x="7.5" y="5" width="3" height="11" rx="0.75" fill="currentColor" stroke="none" opacity="0.9"/>
      <rect x="12" y="7" width="3" height="9" rx="0.75" fill="currentColor" stroke="none" opacity="0.9"/>
      <path d="M3 7 L7.5 3.5 L12 5.5 L16 2" strokeWidth="1.3" opacity="0.7"/>
    </svg>
  ),
  // Agents — brain with circuit traces (AI minds)
  agents: (p) => (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M6.5 4a3.5 3.5 0 0 1 5 5c0 1-.4 1.9-1 2.6L9 13l-1.5-1.4A3.5 3.5 0 0 1 6.5 4z"/>
      <line x1="9"  y1="13" x2="9"  y2="16"/>
      <line x1="7"  y1="15" x2="11" y2="15"/>
      <line x1="7.5" y1="7.5" x2="10.5" y2="7.5" opacity="0.6"/>
      <line x1="9"   y1="6"  x2="9"    y2="9"    opacity="0.6"/>
    </svg>
  ),
  // Pipeline — linked workflow steps
  pipeline: (p) => (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="1"  y="7" width="4" height="4" rx="1"/>
      <rect x="7"  y="7" width="4" height="4" rx="1"/>
      <rect x="13" y="7" width="4" height="4" rx="1"/>
      <line x1="5"  y1="9" x2="7"  y2="9"/>
      <line x1="11" y1="9" x2="13" y2="9"/>
      <path d="M3 7 V4 Q3 2 5 2 H13 Q15 2 15 4 V7" opacity="0.45"/>
    </svg>
  ),
  // LLM Usage — CPU chip (compute/tokens)
  llm: (p) => (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="5" y="5" width="8" height="8" rx="1.5"/>
      <line x1="7" y1="5" x2="7" y2="2"/><line x1="11" y1="5" x2="11" y2="2"/>
      <line x1="7" y1="13" x2="7" y2="16"/><line x1="11" y1="13" x2="11" y2="16"/>
      <line x1="5" y1="7" x2="2" y2="7"/><line x1="5" y1="11" x2="2" y2="11"/>
      <line x1="13" y1="7" x2="16" y2="7"/><line x1="13" y1="11" x2="16" y2="11"/>
      <rect x="7.5" y="7.5" width="3" height="3" rx="0.75" fill="currentColor" stroke="none" opacity="0.7"/>
    </svg>
  ),
  // Settings — tuning sliders
  settings: (p) => (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" {...p}>
      <line x1="2" y1="5"  x2="16" y2="5"/>
      <line x1="2" y1="9"  x2="16" y2="9"/>
      <line x1="2" y1="13" x2="16" y2="13"/>
      <circle cx="6"  cy="5"  r="1.8" fill="var(--color-surface)" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="12" cy="9"  r="1.8" fill="var(--color-surface)" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="7"  cy="13" r="1.8" fill="var(--color-surface)" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  ),
};

function NavIcon({ id, className, style }: { id: string; className?: string; style?: React.CSSProperties }) {
  const Icon = NAV_ICONS[id];
  if (!Icon) return null;
  return <Icon className={className} style={style} aria-hidden="true" />;
}

// ── Main App ───────────────────────────────────────────────────────────────

function AppInner() {
  const { toasts, push: toast } = useToast();
  const [strategies, setStrategies]         = useState<Strategy[]>([]);
  const [markets, setMarkets]               = useState<MarketConfig[]>(() => {
    try { return JSON.parse(localStorage.getItem('markets') ?? 'null') ?? []; } catch { return []; }
  });
  const [debates, setDebates]               = useState<DebateRound[]>([]);
  const [memories, setMemories]             = useState<AgentMemory[]>([]);
  const [agents, setAgents]                 = useState<AgentPrompt[]>([]);
  const [agentFitness, setAgentFitness]     = useState<AgentFitness[]>([]);
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
  const [reportError, setReportError]       = useState<string | null>(null);
  const [budgetInput, setBudgetInput]       = useState<string>('10000');
  const [approvalMode, setApprovalMode]     = useState('auto');
  const [scheduleResearch, setScheduleResearch] = useState<number>(60);
  const [scheduleTrade, setScheduleTrade]       = useState<number>(60);
  const [scheduleEval, setScheduleEval]         = useState<number>(120);
  const [isTriggering, setIsTriggering]     = useState(false);
  const isTriggeringRef = useRef(false);
  const [investmentFocus, setInvestmentFocus] = useState('');
  const focusLoadedRef = useRef(false);
  const [strategiesLoaded, setStrategiesLoaded] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  // URL path ↔ Page mapping. '/agents' maps to the internal 'memory' page id.
  const URL_TO_PAGE: Record<string, Page> = {
    '/dashboard': 'dashboard',
    '/markets':   'markets',
    '/data':      'graph',
    '/portfolio': 'portfolio',
    '/agents':    'memory',
    '/pipeline':  'pipeline',
    '/llm':       'llm',
    '/settings':  'settings',
  };
  const PAGE_TO_URL: Record<Page, string> = {
    dashboard: '/dashboard',
    markets:   '/markets',
    graph:     '/data',
    portfolio: '/portfolio',
    memory:    '/agents',
    pipeline:  '/pipeline',
    llm:       '/llm',
    settings:  '/settings',
  };

  const pageFromPath = (): Page => {
    const path = window.location.pathname;
    return URL_TO_PAGE[path] ?? 'dashboard';
  };

  const [page, setPage] = useState<Page>(pageFromPath);

  const navigate = (p: Page) => {
    window.history.pushState(null, '', PAGE_TO_URL[p]);
    setPage(p);
  };

  useEffect(() => {
    const handlePopState = () => setPage(pageFromPath());
    window.addEventListener('popstate', handlePopState);
    // Sync URL on first load (handles bare '/' → '/dashboard')
    if (!URL_TO_PAGE[window.location.pathname]) {
      window.history.replaceState(null, '', PAGE_TO_URL[page]);
    }
    return () => window.removeEventListener('popstate', handlePopState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);



  // If the user loaded the app directly on a non-default page (e.g. /markets),
  // treat it as an intentional navigation — don't redirect them to /pipeline.
  const userNavigatedRef = useRef(pageFromPath() !== 'dashboard');
  const [darkMode, setDarkMode]             = useState<boolean>(() => {
    const saved = localStorage.getItem('theme');
    const isDark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(isDark);
    return isDark;
  });
  const [editingPromptAgent, setEditingPromptAgent] = useState<string | null>(null);
  const [editPromptText, setEditPromptText] = useState('');

  // Dashboard inline timeline
  const [expandedDebateId, setExpandedDebateId]   = useState<number | null>(null);



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
      const [stratRes, mktRes, debRes, appRes, memRes, resRes, agentRes] = await Promise.all([
        apiFetch('/strategies'),
        apiFetch('/config/markets'), apiFetch('/debates'), apiFetch('/config/approval_mode'),
        apiFetch('/memory'), apiFetch('/research'),
        apiFetch('/agents'),
      ]);
      if (stratRes.ok) setStrategies(await stratRes.json());
      setStrategiesLoaded(true);
      setDataLoaded(true);
      if (mktRes.ok) { const mktData = await mktRes.json(); setMarkets(mktData); localStorage.setItem('markets', JSON.stringify(mktData)); }
      if (debRes.ok) setDebates(await debRes.json());
      if (appRes.ok) { const d = await appRes.json(); setApprovalMode(d.approval_mode); }
      if (memRes.ok) setMemories(await memRes.json());
      if (resRes.ok) { const d = await resRes.json(); setResearch(d); try { localStorage.setItem('cache_research', JSON.stringify(d)); } catch { /* storage quota */ } }
      if (agentRes.ok) setAgents(await agentRes.json());
      const [fitnessRes, budgetRes, pnlRes, focusRes, schedRRes, schedTRes, schedERes] = await Promise.all([
        apiFetch('/agents/fitness'),
        apiFetch('/config/budget'),
        apiFetch('/portfolio/pnl'),
        apiFetch('/config/investment_focus'),
        apiFetch('/config/schedule/research'),
        apiFetch('/config/schedule/trade'),
        apiFetch('/config/schedule/eval'),
      ]);
      if (fitnessRes.ok) setAgentFitness(await fitnessRes.json());
      if (budgetRes.ok) { const d = await budgetRes.json(); setBudgetInput(d.trading_budget.toString()); }
      if (pnlRes.ok) setPortfolio(await pnlRes.json());
      if (focusRes.ok && !focusLoadedRef.current) { const d = await focusRes.json(); setInvestmentFocus(d.investment_focus ?? ''); focusLoadedRef.current = true; }
      if (schedRRes.ok) { const d = await schedRRes.json(); setScheduleResearch(d.interval_minutes); }
      if (schedTRes.ok) { const d = await schedTRes.json(); setScheduleTrade(d.interval_minutes); }
      if (schedERes.ok) { const d = await schedERes.json(); setScheduleEval(d.interval_minutes); }
    } catch (err) { console.error('Fetch error', err); }
  };

  const fetchQuotes = async () => {
    setQuotesLoading(true);
    try {
      const [qRes, eRes] = await Promise.all([
        apiFetch('/quotes'),
        apiFetch('/market/events'),
      ]);
      if (qRes.ok) { const d = await qRes.json(); setLiveQuotes(d); try { localStorage.setItem('cache_quotes', JSON.stringify(d)); } catch { /* storage quota */ } }
      if (eRes.ok) { const d = await eRes.json(); setMarketEvents(d); try { localStorage.setItem('cache_market_events', JSON.stringify(d)); } catch { /* storage quota */ } }
    } catch (err) { console.error('Quotes fetch error', err); }
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
      } catch { /* silent */ }
    };
    fetchPnl();
    const i = setInterval(fetchPnl, 30000);
    return () => clearInterval(i);
  }, []);

  // Dedicated pipeline poller — 2s while running, 8s while idle.
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerPollRef = useRef<(() => void) | null>(null);
  const initialPollDoneRef = useRef(false);
  // Trigger-guard: track when each pipeline was last triggered to prevent the
  // poller from overriding optimistic running=true before the backend sets the lock.
  const lastTriggerAtRef = useRef<{ research: number; trade: number; eval: number }>({ research: 0, trade: 0, eval: 0 });
  const TRIGGER_GUARD_MS = 6000; // ignore backend running=false for 6s after trigger

  // SSE connections — one per pipeline type, keyed by run_id currently streamed
  type SseEntry = { es: EventSource; runId: string };
  const sseRefs = useRef<{ research: SseEntry | null; trade: SseEntry | null; eval: SseEntry | null }>({
    research: null, trade: null, eval: null,
  });

  // Per-pipeline running state — single object so all fields update atomically
  const [pipelineStatus, setPipelineStatus] = useState({
    researchRunning: false, tradeRunning: false, evalRunning: false,
    currentRunIdResearch: null as string | null,
    currentRunIdTrade: null as string | null,
    currentRunIdEval: null as string | null,
  });
  const { researchRunning, tradeRunning, evalRunning, currentRunIdResearch, currentRunIdTrade, currentRunIdEval } = pipelineStatus;
  // Setters for trigger handlers
  const setResearchRunning = (v: boolean) => setPipelineStatus(s => ({ ...s, researchRunning: v }));
  const setTradeRunning    = (v: boolean) => setPipelineStatus(s => ({ ...s, tradeRunning: v }));
  const setEvalRunning     = (v: boolean) => setPipelineStatus(s => ({ ...s, evalRunning: v }));
  const setCurrentRunIdResearch = (v: string | null) => setPipelineStatus(s => ({ ...s, currentRunIdResearch: v }));
  const setCurrentRunIdTrade    = (v: string | null) => setPipelineStatus(s => ({ ...s, currentRunIdTrade: v }));
  const setCurrentRunIdEval     = (v: string | null) => setPipelineStatus(s => ({ ...s, currentRunIdEval: v }));
  // Per-pipeline live events — single object for atomic updates
  const [pipelineTabEvents, setPipelineTabEvents] = useState({
    researchEvents: [] as PipelineEvent[],
    tradeEvents:    [] as PipelineEvent[],
    evalEvents:     [] as PipelineEvent[],
  });
  const { researchEvents, tradeEvents, evalEvents } = pipelineTabEvents;
  const [researchStepOpen, setResearchStepOpen]   = useState(false);
  const [pendingDropdownOpen, setPendingDropdownOpen] = useState(false);
  const [disableMarketPrompt, setDisableMarketPrompt] = useState<{ name: string; affected: Strategy[] } | null>(null);
  const [pipelineRuns, setPipelineRuns]           = useState<PipelineRun[]>([]);
  const [pipelineReadiness, setPipelineReadiness] = useState<PipelineReadiness>({ has_research_data: false, last_research_at: null, active_positions: 0 });
  const [selectedRunId, setSelectedRunId]         = useState<string | null>(null);
  const [selectedRunEvents, setSelectedRunEvents] = useState<PipelineEvent[]>([]);
  const [selectedRunLoading, setSelectedRunLoading] = useState(false);
  // True when the user explicitly clicked a past run — prevents transition effects from overriding.
  const userSelectedRunRef = useRef(false);
  const [statFocus, setStatFocus]           = useState<'active' | 'pending' | 'debates' | 'memories' | null>(null);
  const [kgRefreshTrigger, setKgRefreshTrigger] = useState(0);
  const lastKgRunIdRef = useRef<string | null>(null);

  // Global Esc handler — closes whichever modal is open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (reportStratId !== null) { setReportStratId(null); setReportData(null); setReportError(null); return; }
      if (disableMarketPrompt) { setDisableMarketPrompt(null); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reportStratId, disableMarketPrompt]);

  useEffect(() => {
    const closeSse = (type: 'research' | 'trade' | 'eval') => {
      const entry = sseRefs.current[type];
      if (entry) { entry.es.close(); sseRefs.current[type] = null; }
    };

    const openSse = (type: 'research' | 'trade' | 'eval', runId: string) => {
      // Already streaming this run — do nothing
      if (sseRefs.current[type]?.runId === runId) return;
      closeSse(type);
      // Clear stale events from the previous run
      const evtKey = type === 'research' ? 'researchEvents' : type === 'trade' ? 'tradeEvents' : 'evalEvents';
      setPipelineTabEvents(s => ({ ...s, [evtKey]: [] }));

      const token = getToken();
      if (!token) return;
      const url = `${API}/pipeline/stream/${runId}?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);

      es.onmessage = (e) => {
        const evt = JSON.parse(e.data) as PipelineEvent;
        if (type === 'research') {
          setPipelineTabEvents(s => ({
            ...s,
            researchEvents: s.researchEvents.some(x => x.id === evt.id)
              ? s.researchEvents
              : [...s.researchEvents, evt],
          }));
          // Refresh KG viewer as soon as KG_INGEST DONE appears (once per run)
          if (evt.step === 'KG_INGEST' && evt.status === 'DONE' && lastKgRunIdRef.current !== runId) {
            lastKgRunIdRef.current = runId;
            setKgRefreshTrigger(t => t + 1);
          }
        } else if (type === 'trade') {
          setPipelineTabEvents(s => ({
            ...s,
            tradeEvents: s.tradeEvents.some(x => x.id === evt.id)
              ? s.tradeEvents
              : [...s.tradeEvents, evt],
          }));
        } else {
          setPipelineTabEvents(s => ({
            ...s,
            evalEvents: s.evalEvents.some(x => x.id === evt.id)
              ? s.evalEvents
              : [...s.evalEvents, evt],
          }));
        }
      };

      es.addEventListener('done', () => { closeSse(type); });
      es.onerror = () => { closeSse(type); };

      sseRefs.current[type] = { es, runId };
    };

    const pollPipeline = async () => {
      try {
        const r = await apiFetch('/system/status');
        if (r.ok) {
          const d = await r.json();
          const now = Date.now();
          const guard = lastTriggerAtRef.current;
          // If a pipeline was recently triggered (<TRIGGER_GUARD_MS ago), keep running=true
          // even if the backend hasn't persisted the lock yet (avoids optimistic flash).
          const rr = !!d.research_running || (now - guard.research < TRIGGER_GUARD_MS);
          const tr = !!d.trade_running    || (now - guard.trade    < TRIGGER_GUARD_MS);
          const er = !!d.eval_running     || (now - guard.eval     < TRIGGER_GUARD_MS);
          const ridR = d.current_run_id_research ?? null;
          const ridT = d.current_run_id_trade ?? null;
          const ridE = d.current_run_id_eval ?? null;
          // Update all running state atomically in one setState call
          setPipelineStatus({ researchRunning: rr, tradeRunning: tr, evalRunning: er, currentRunIdResearch: ridR, currentRunIdTrade: ridT, currentRunIdEval: ridE });
          const anyRunning = rr || tr || er;
          isTriggeringRef.current = anyRunning;
          setIsTriggering(anyRunning);
          setPipelineReadiness({
            has_research_data: d.has_research_data ?? false,
            last_research_at: d.last_research_at ?? null,
            active_positions: d.active_positions ?? 0,
          });
          // Navigate to pipeline page on first poll if any pipeline is running
          if (anyRunning && !initialPollDoneRef.current && !userNavigatedRef.current) {
            navigate('pipeline');
          }
          initialPollDoneRef.current = true;
          // Open SSE streams for running pipelines; close for stopped ones
          if (rr && ridR) openSse('research', ridR); else closeSse('research');
          if (tr && ridT) openSse('trade',    ridT); else closeSse('trade');
          if (er && ridE) openSse('eval',     ridE); else closeSse('eval');
        }
      } catch { /* ignore */ }
      pollTimerRef.current = setTimeout(pollPipeline, isTriggeringRef.current ? 2000 : 8000);
    };

    triggerPollRef.current = () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollPipeline();
    };

    pollPipeline();
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      closeSse('research'); closeSse('trade'); closeSse('eval');
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRunEvents = async (runId: string) => {
    if (selectedRunId === runId) { setSelectedRunId(null); setSelectedRunEvents([]); userSelectedRunRef.current = false; return; }
    userSelectedRunRef.current = true;
    setSelectedRunId(runId);
    setSelectedRunEvents([]);
    setSelectedRunLoading(true);
    try {
      const res = await apiFetch(`/pipeline/runs/${runId}`);
      if (res.ok) {
        const d = await res.json();
        setSelectedRunEvents(d.events ?? []);
      } else {
        // Keep empty array — PipelinePage will show "No events recorded"
        setSelectedRunEvents([]);
      }
    } catch {
      setSelectedRunEvents([]);
    } finally {
      setSelectedRunLoading(false);
    }
  };

  const _doDisableMarket = async (name: string) => {
    setMarkets(p => { const u = p.map(m => m.market_name === name ? { ...m, is_enabled: 0 } : m); localStorage.setItem('markets', JSON.stringify(u)); return u; });
    await apiFetch('/config/markets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ market_name: name, is_enabled: false }]) });
    await apiFetch(`/config/markets/${name}/exit-positions`, { method: 'POST' });
    const r = await apiFetch('/strategies');
    if (r.ok) setStrategies(await r.json());
  };

  const toggleMarket = (name: string, enabled: number) => {
    if (enabled) {
      const affected = strategies.filter(s =>
        (s.status === 'ACTIVE' || s.status === 'PENDING') &&
        getMarketForTicker(s.symbol) === name
      );
      if (affected.length > 0) {
        setDisableMarketPrompt({ name, affected });
        return;
      }
      _doDisableMarket(name);
    } else {
      setMarkets(p => { const u = p.map(m => m.market_name === name ? { ...m, is_enabled: 1 } : m); localStorage.setItem('markets', JSON.stringify(u)); return u; });
      apiFetch('/config/markets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ market_name: name, is_enabled: true }]) }).catch(console.error);
    }
  };

  const reloadMarkets = () => {
    apiFetch('/config/markets').then(r => r.ok ? r.json() : null).then(d => {
      if (d) { setMarkets(d); localStorage.setItem('markets', JSON.stringify(d)); }
    }).catch(() => {});
  };

  const setMode = (mode: string) => {
    setApprovalMode(mode);
    apiFetch('/config/approval_mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approval_mode: mode }) }).catch(console.error);
  };

  const handleApproval = (id: number, action: string) => {
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

  const saveInvestmentFocus = (text: string) => {
    apiFetch('/config/investment_focus', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ investment_focus: text }),
    }).catch(console.error);
  };

  const handleStopPipeline = (pipeline: 'research' | 'trade' | 'eval' = 'all' as never) => {
    if (pipeline === 'research' || pipeline === ('all' as string)) setResearchRunning(false);
    if (pipeline === 'trade'    || pipeline === ('all' as string)) setTradeRunning(false);
    if (pipeline === 'eval'     || pipeline === ('all' as string)) setEvalRunning(false);
    apiFetch('/system/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipeline }),
    }).then(r => { if (r.ok) toast('Pipeline stopped', 'info'); }).catch(() => {});
  };

  const handleEvalTrigger = () => {
    if (evalRunning) return;
    lastTriggerAtRef.current.eval = Date.now();
    setEvalRunning(true);
    setPipelineTabEvents(s => ({ ...s, evalEvents: [] }));
    setTimeout(() => { triggerPollRef.current?.(); }, 500);
    apiFetch('/eval/trigger', { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'error') { setEvalRunning(false); toast(data.message, 'err'); }
        else {
          if (data.run_id) setCurrentRunIdEval(data.run_id);
          toast('Evaluation pipeline started', 'ok');
          setTimeout(() => { triggerPollRef.current?.(); fetchData(); }, 1000);
        }
      })
      .catch(() => { setEvalRunning(false); });
  };

  const handleResearchTrigger = () => {
    if (researchRunning) return;
    lastTriggerAtRef.current.research = Date.now();
    setResearchRunning(true);
    setPipelineTabEvents(s => ({ ...s, researchEvents: [] }));
    setTimeout(() => { triggerPollRef.current?.(); }, 500);
    apiFetch('/research/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        investment_focus: investmentFocus.trim(),
        tickers: focusTickers,
      }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'error') { setResearchRunning(false); toast(data.message, 'err'); }
        else {
          if (data.run_id) { setCurrentRunIdResearch(data.run_id); }
          // Populate focus chips with LLM-resolved tickers
          if (data.resolved_tickers?.length) {
            setFocusTickers(data.resolved_tickers);
            toast(`Focused on: ${data.resolved_tickers.join(', ')}`, 'ok');
          } else {
            toast('Research pipeline started', 'ok');
          }
          setTimeout(() => { triggerPollRef.current?.(); fetchData(); }, 1000);
        }
      })
      .catch(() => { setResearchRunning(false); });
  };

  const handleTradeTrigger = () => {
    if (tradeRunning) return;
    lastTriggerAtRef.current.trade = Date.now();
    setTradeRunning(true);
    setPipelineTabEvents(s => ({ ...s, tradeEvents: [] }));
    setTimeout(() => { triggerPollRef.current?.(); }, 500);
    apiFetch('/trade/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        investment_focus: investmentFocus.trim(),
        tickers: focusTickers,
      }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'error') { setTradeRunning(false); toast(data.message, 'err'); }
        else {
          if (data.run_id) { setCurrentRunIdTrade(data.run_id); }
          if (data.resolved_tickers?.length) {
            setFocusTickers(data.resolved_tickers);
            toast(`Trades scoped to: ${data.resolved_tickers.join(', ')}`, 'ok');
          } else {
            toast('Trade pipeline started', 'ok');
          }
          setTimeout(() => { triggerPollRef.current?.(); fetchData(); }, 1000);
        }
      })
      .catch(() => { setTradeRunning(false); });
  };

  const handlePipelineScheduleUpdate = (pipeline: 'research' | 'trade' | 'eval', minutes: number) => {
    if (pipeline === 'research') setScheduleResearch(minutes);
    else if (pipeline === 'trade') setScheduleTrade(minutes);
    else setScheduleEval(minutes);
    apiFetch(`/config/schedule/${pipeline}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interval_minutes: minutes }),
    }).catch(console.error);
  };

  const saveAgentPrompt = (agentName: string, prompt: string) => {
    setEditingPromptAgent(null);
    apiFetch(`/agents/${encodeURIComponent(agentName)}/prompt`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system_prompt: prompt }),
    }).then(r => { if (r.ok) { toast('Prompt saved'); fetchData(); } else toast('Save failed', 'err'); })
      .catch(() => toast('Network error', 'err'));
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

  // Clear live events when a new pipeline starts so the live view doesn't show stale data.
  const prevIsTriggering = useRef(false);
  useEffect(() => {
    const wasRunning = prevIsTriggering.current;
    const isNowRunning = isTriggering;
    if (!wasRunning && isNowRunning) {
      setPipelineTabEvents({ researchEvents: [], tradeEvents: [], evalEvents: [] });
    }
    prevIsTriggering.current = isNowRunning;
  }, [isTriggering]);

  const visibleStrategies = strategies.filter(s =>
    enabledMarketNames.length === 0 || enabledMarketNames.includes(getMarketForTicker(s.symbol))
  );
  const activeStrategies = visibleStrategies.filter(s => s.status === 'ACTIVE');
  const pendingStrategies = visibleStrategies.filter(s => s.status === 'PENDING');

  const strategiesByMarketAndTicker: Record<string, Record<string, Strategy[]>> = {};
  for (const strat of visibleStrategies) {
    const market = getMarketForTicker(strat.symbol);
    if (!strategiesByMarketAndTicker[market]) strategiesByMarketAndTicker[market] = {};
    if (!strategiesByMarketAndTicker[market][strat.symbol]) strategiesByMarketAndTicker[market][strat.symbol] = [];
    strategiesByMarketAndTicker[market][strat.symbol].push(strat);
  }
  const marketsWithStrategies = Object.keys(strategiesByMarketAndTicker);
  const activeStratMarket = marketsWithStrategies.includes(expandedStratMarket) ? expandedStratMarket : (marketsWithStrategies[0] ?? 'US');

  const renderPage = () => {
    if (!dataLoaded) return <PageLoader />;
    switch (page) {
      case 'dashboard':
        return (
          <DashboardPage
            strategiesLoaded={strategiesLoaded}
            debates={debates}
            memories={memories}
            activeStrategies={activeStrategies}
            pendingStrategies={pendingStrategies}
            strategiesByMarketAndTicker={strategiesByMarketAndTicker}
            marketsWithStrategies={marketsWithStrategies}
            activeStratMarket={activeStratMarket}
            debatesByMarketAndTicker={debatesByMarketAndTicker}
            groupedMemories={groupedMemories}
            statFocus={statFocus}
            setStatFocus={setStatFocus}
            expandedStratTicker={expandedStratTicker}
            setExpandedStratMarket={setExpandedStratMarket}
            setExpandedStratTicker={setExpandedStratTicker}
            expandedDebateId={expandedDebateId}
            setExpandedDebateId={setExpandedDebateId}
            editStratId={editStratId}
            setEditStratId={setEditStratId}
            editStratForm={editStratForm}
            setEditStratForm={setEditStratForm}
            handleApproval={handleApproval}
            handleUndeploy={handleUndeploy}
            handleStrategyUpdate={handleStrategyUpdate}
            openReport={openReport}
          />
        );
      case 'markets':
        return (
          <MarketsPage
            markets={markets}
            enabledMarketNames={enabledMarketNames}
            activeStrategies={activeStrategies}
            pendingStrategies={pendingStrategies}
            liveQuotes={liveQuotes}
            marketEvents={marketEvents}
            quotesLoading={quotesLoading}
            quotesMarketTab={quotesMarketTab}
            setQuotesMarketTab={setQuotesMarketTab}
            quotesStockTab={quotesStockTab}
            setQuotesStockTab={setQuotesStockTab}
            watchlist={watchlist}
            setWatchlist={setWatchlist}
            onMarketsChange={reloadMarkets}
            marketsSearchOpen={marketsSearchOpen}
            setMarketsSearchOpen={setMarketsSearchOpen}
            marketsSearchQuery={marketsSearchQuery}
            setMarketsSearchQuery={setMarketsSearchQuery}
            marketsSearchResults={marketsSearchResults}
            setMarketsSearchResults={setMarketsSearchResults}
            marketsSearchLoading={marketsSearchLoading}
            setMarketsSearchLoading={setMarketsSearchLoading}
            marketsSearchTimer={marketsSearchTimer}
            fetchQuotes={fetchQuotes}
            openReport={openReport}
            onApprove={handleApproval}
          />
        );
      case 'graph':
        return <KnowledgeGraphPage refreshTrigger={kgRefreshTrigger} />;
      case 'portfolio':
        return (
          <PortfolioPage
            portfolio={portfolio}
            budgetInput={budgetInput}
            setBudgetInput={setBudgetInput}
            handleBudgetSave={handleBudgetSave}
            editStratId={editStratId}
            setEditStratId={setEditStratId}
            editStratForm={editStratForm}
            setEditStratForm={setEditStratForm}
            handleStrategyUpdate={handleStrategyUpdate}
            openReport={openReport}
            handleUndeploy={handleUndeploy}
            fetchData={fetchData}
          />
        );
      case 'memory':
        return (
          <AgentPage
            agents={agents}
            groupedMemories={groupedMemories}
            agentFitness={agentFitness}
            editingPromptAgent={editingPromptAgent}
            editPromptText={editPromptText}
            setEditingPromptAgent={setEditingPromptAgent}
            setEditPromptText={setEditPromptText}
            saveAgentPrompt={saveAgentPrompt}
            onRefresh={fetchData}
          />
        );
      case 'pipeline':
        return (
          <PipelinePage
            researchRunning={researchRunning}
            tradeRunning={tradeRunning}
            evalRunning={evalRunning}
            currentRunIdResearch={currentRunIdResearch}
            currentRunIdTrade={currentRunIdTrade}
            currentRunIdEval={currentRunIdEval}
            researchEvents={researchEvents}
            tradeEvents={tradeEvents}
            evalEvents={evalEvents}
            pipelineRuns={pipelineRuns}
            selectedRunId={selectedRunId}
            setSelectedRunId={setSelectedRunId}
            selectedRunEvents={selectedRunEvents}
            setSelectedRunEvents={setSelectedRunEvents}
            selectedRunLoading={selectedRunLoading}
            setSelectedRunLoading={setSelectedRunLoading}
            loadRunEvents={loadRunEvents}
            setPipelineRuns={setPipelineRuns}
            researchStepOpen={researchStepOpen}
            setResearchStepOpen={setResearchStepOpen}
            research={research}
            investmentFocus={investmentFocus}
            setInvestmentFocus={setInvestmentFocus}
            saveInvestmentFocus={saveInvestmentFocus}
            focusTickers={focusTickers}
            setFocusTickers={setFocusTickers}
            focusSearch={focusSearch}
            setFocusSearch={setFocusSearch}
            focusSearchOpen={focusSearchOpen}
            setFocusSearchOpen={setFocusSearchOpen}
            focusSectorFilter={focusSectorFilter}
            setFocusSectorFilter={setFocusSectorFilter}
            tickerSearchResults={tickerSearchResults}
            setTickerSearchResults={setTickerSearchResults}
            tickerSearchLoading={tickerSearchLoading}
            setTickerSearchLoading={setTickerSearchLoading}
            handleStopPipeline={(pipeline) => handleStopPipeline(pipeline ?? 'all' as never)}
            handleEvalTrigger={handleEvalTrigger}
            handleResearchTrigger={handleResearchTrigger}
            handleTradeTrigger={handleTradeTrigger}
            scheduleResearch={scheduleResearch}
            scheduleTrade={scheduleTrade}
            scheduleEval={scheduleEval}
            onScheduleUpdate={handlePipelineScheduleUpdate}
            pipelineReadiness={pipelineReadiness}
            enabledMarketNames={enabledMarketNames}
            openReport={openReport}
            clearTabEvents={(tab) => setPipelineTabEvents(s => ({
              ...s,
              researchEvents: tab === 'research' ? [] : s.researchEvents,
              tradeEvents:    tab === 'trade'    ? [] : s.tradeEvents,
              evalEvents:     tab === 'eval'     ? [] : s.evalEvents,
            }))}
          />
        );
      case 'llm':
        return <LLMUsagePage />;
      case 'settings':
        return (
          <SettingsPage
            darkMode={darkMode}
            toggleDarkMode={toggleDarkMode}
            approvalMode={approvalMode}
            setMode={setMode}
            markets={markets}
            toggleMarket={toggleMarket}
            reloadMarkets={reloadMarkets}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex min-h-dvh bg-background overflow-hidden">
      {/* ── Sidebar ── */}
      <aside
        className="w-[212px] shrink-0 flex flex-col overflow-hidden"
        style={{
          background: 'var(--color-surface)',
          borderRight: '1px solid var(--color-borderLight)',
          boxShadow: '4px 0 32px rgba(0,0,0,0.2)',
        }}
      >
        {/* Logo */}
        <div className="px-4 pt-5 pb-4" style={{ borderBottom: '1px solid var(--color-borderLight)' }}>
          <div className="flex items-center gap-3">
            {/* App logomark: knowledge-graph nodes + upward signal */}
            <div
              className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: 'linear-gradient(135deg, #1d4ed8 0%, #4f46e5 60%, #7c3aed 100%)',
                boxShadow: '0 0 16px rgba(79,70,229,0.55), 0 2px 6px rgba(0,0,0,0.35)',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                {/* Central hub node */}
                <circle cx="10" cy="10" r="2.2" fill="white" opacity="0.95"/>
                {/* Satellite nodes */}
                <circle cx="4"  cy="5"  r="1.4" fill="white" opacity="0.7"/>
                <circle cx="16" cy="5"  r="1.4" fill="white" opacity="0.7"/>
                <circle cx="4"  cy="15" r="1.4" fill="white" opacity="0.55"/>
                <circle cx="16" cy="15" r="1.4" fill="white" opacity="0.55"/>
                {/* Edges from hub */}
                <line x1="10" y1="10" x2="4"  y2="5"  stroke="white" strokeWidth="1.1" opacity="0.6"/>
                <line x1="10" y1="10" x2="16" y2="5"  stroke="white" strokeWidth="1.1" opacity="0.6"/>
                <line x1="10" y1="10" x2="4"  y2="15" stroke="white" strokeWidth="1.1" opacity="0.4"/>
                <line x1="10" y1="10" x2="16" y2="15" stroke="white" strokeWidth="1.1" opacity="0.4"/>
                {/* Upward signal arrow on top-right node */}
                <path d="M14.5 2.5 L16 5 L17.5 2.5" stroke="white" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" opacity="0.9"/>
              </svg>
            </div>
            <div>
              <p className="text-[13px] font-bold text-textMain leading-none tracking-tight">Market Intel</p>
              <p className="text-[9px] mt-1 tracking-[0.14em] uppercase font-semibold" style={{ color: 'var(--color-textDim)' }}>AI Engine</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2.5 space-y-0.5" aria-label="Main navigation">
          {NAV.map(n => {
            const isActive = page === n.id;
            const isPipelineLive = n.id === 'pipeline' && isTriggering;
            return (
              <button
                key={n.id}
                onClick={() => { userNavigatedRef.current = true; navigate(n.id); }}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[12.5px] font-medium transition-all duration-200 text-left group cursor-pointer ${
                  isActive
                    ? 'nav-active text-brand-400'
                    : 'text-textDim hover:text-textMuted hover:bg-surface2'
                }`}
              >
                <NavIcon
                  id={n.icon}
                  className={`w-[18px] h-[18px] shrink-0 transition-all duration-200 ${
                    isActive
                      ? 'text-brand-400'
                      : isPipelineLive
                        ? 'text-warning'
                        : 'text-textDim group-hover:text-textMuted'
                  }`}
                  style={isActive ? { filter: 'drop-shadow(0 0 5px rgba(96,165,250,0.6))' } : undefined}
                />
                <span className="flex-1 truncate">{n.label}</span>
                {isPipelineLive && (
                  <span className="h-1.5 w-1.5 rounded-full bg-warning animate-pulse shrink-0" aria-label="Pipeline running" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Status footer */}
        <div className="px-2.5 py-3 space-y-1" style={{ borderTop: '1px solid var(--color-borderLight)' }}>
          <button
            onClick={() => isTriggering && navigate('pipeline')}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl transition-all duration-200 ${isTriggering ? 'cursor-pointer' : 'cursor-default'}`}
            style={isTriggering ? {
              background: 'rgba(245,158,11,0.08)',
              border: '1px solid rgba(245,158,11,0.18)',
            } : undefined}
            aria-label={isTriggering ? 'View pipeline' : 'System status'}
          >
            <span
              className={`h-2 w-2 rounded-full shrink-0 ${isTriggering ? 'bg-warning animate-pulse' : 'bg-up'}`}
              aria-hidden="true"
            />
            <span className={`text-[11px] truncate font-medium ${isTriggering ? 'text-warning' : 'text-textDim'}`}>
              {isTriggering ? 'Pipeline running…' : 'System active'}
            </span>
          </button>
          <button
            onClick={toggleDarkMode}
            className="w-full flex items-center justify-between px-3 py-1.5 rounded-xl hover:bg-surface2 transition-colors duration-150 group cursor-pointer"
            aria-label={`Switch to ${darkMode ? 'light' : 'dark'} mode`}
          >
            <span className="text-[11px] text-textDim group-hover:text-textMuted transition-colors">
              {darkMode ? 'Dark mode' : 'Light mode'}
            </span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-textDim group-hover:text-textMuted transition-colors" aria-hidden="true">
              {darkMode
                ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></>
                : <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/>
              }
            </svg>
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 min-w-0 overflow-y-auto h-screen">
        {/* Top bar */}
        <header
          className="sticky top-0 z-10 px-6 py-3.5 flex items-center justify-between"
          style={{
            background: 'color-mix(in srgb, var(--color-surface) 90%, transparent)',
            backdropFilter: 'blur(20px) saturate(1.5)',
            WebkitBackdropFilter: 'blur(20px) saturate(1.5)',
            borderBottom: '1px solid var(--color-borderLight)',
          }}
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5">
              <NavIcon
                id={NAV.find(n => n.id === page)?.icon ?? ''}
                className="w-[15px] h-[15px] shrink-0"
                style={{ color: 'var(--color-textDim)' }}
              />
              <h1 className="text-[14px] font-semibold text-textMain tracking-tight">
                {NAV.find(n => n.id === page)?.label}
              </h1>
            </div>
            <span className="h-3.5 w-px" style={{ background: 'var(--color-borderMid)' }} aria-hidden="true" />
            <p className="text-[11px] text-textDim tabular font-mono">{new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
          </div>
          <div className="flex items-center gap-2">
            {pendingStrategies.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setPendingDropdownOpen(o => !o)}
                  aria-expanded={pendingDropdownOpen}
                  aria-haspopup="true"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-warning-bg border border-warning/25 text-warning-text rounded-lg text-[11px] font-semibold hover:bg-warning/20 transition-all duration-150 cursor-pointer btn-lift"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-warning pulse-live" aria-hidden="true" />
                  {pendingStrategies.length} pending
                </button>
                {pendingDropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 z-50 w-80 bg-surface/95 backdrop-blur-xl rounded-2xl overflow-hidden border border-borderMid animate-scale-in" style={{ boxShadow: '0 16px 48px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.04)' }} role="dialog" aria-label="Pending approvals">
                    <div className="px-4 py-3 border-b border-borderLight flex items-center justify-between bg-surface2/60">
                      <div className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-warning pulse-live" aria-hidden="true" />
                        <span className="text-[11px] font-semibold text-textMain uppercase tracking-wider">Pending Approval</span>
                      </div>
                      <button onClick={() => setPendingDropdownOpen(false)} aria-label="Close" className="text-textDim hover:text-textMain w-6 h-6 flex items-center justify-center rounded-md hover:bg-surface3 transition-colors cursor-pointer">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l10 10M11 1L1 11"/></svg>
                      </button>
                    </div>
                    <div className="divide-y divide-borderLight max-h-96 overflow-y-auto">
                      {pendingStrategies.map(s => (
                        <div key={s.id} className="px-4 py-3 space-y-2.5 hover:bg-surface2/40 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Badge type={s.strategy_type} />
                              <span className="text-[13px] font-bold text-textMain font-mono tabular">{s.symbol}</span>
                            </div>
                            <span className="text-[11px] text-textDim font-mono tabular">{(s.entry_price ?? 0) > 0 ? `${getCurrencySymbol(getMarketForTicker(s.symbol))}${s.entry_price!.toFixed(2)}` : '—'}</span>
                          </div>
                          <p className="text-[11px] text-textMuted leading-relaxed line-clamp-2">{s.reasoning_summary}</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => { handleApproval(s.id, 'approve'); setPendingDropdownOpen(false); }}
                              className="flex-1 py-1.5 text-[11px] font-semibold rounded-lg bg-up-bg border border-up/25 text-up-text hover:bg-up/20 transition-colors duration-150 cursor-pointer"
                            >Approve</button>
                            <button
                              onClick={() => { handleApproval(s.id, 'reject'); setPendingDropdownOpen(false); }}
                              className="flex-1 py-1.5 text-[11px] font-semibold rounded-lg bg-down-bg border border-down/25 text-down-text hover:bg-down/20 transition-colors duration-150 cursor-pointer"
                            >Reject</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        <div className="px-6 py-6 page-enter">
          {renderPage()}
        </div>
      </main>

      {/* Disable Market Confirmation Dialog */}
      {disableMarketPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm px-4" role="dialog" aria-modal="true" aria-labelledby="disable-market-title">
          <div className="glass border border-borderMid rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.6)] w-full max-w-md p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-xl bg-warning-bg border border-warning/25 flex items-center justify-center shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-warning" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <div>
                <h3 id="disable-market-title" className="text-[14px] font-semibold text-textMain">Disable {disableMarketPrompt.name} Market?</h3>
                <p className="text-[12px] text-textMuted mt-1">
                  This will close {disableMarketPrompt.affected.length} active position{disableMarketPrompt.affected.length !== 1 ? 's' : ''} at current market price:
                </p>
              </div>
            </div>
            <div className="bg-surface2 rounded-xl border border-borderLight divide-y divide-borderLight overflow-hidden">
              {disableMarketPrompt.affected.map(s => (
                <div key={s.id} className="flex items-center justify-between px-3.5 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-mono font-bold text-textMain tabular">{s.symbol}</span>
                    <Badge type={s.strategy_type} />
                  </div>
                  <span className={`text-[12px] font-mono font-semibold tabular ${(s.current_return ?? 0) >= 0 ? 'text-up-text' : 'text-down-text'}`}>
                    {s.current_return != null ? `${s.current_return >= 0 ? '+' : ''}${s.current_return.toFixed(2)}%` : '—'}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setDisableMarketPrompt(null)}
                className="flex-1 py-2.5 rounded-xl border border-borderMid text-[13px] font-medium text-textMuted hover:text-textMain hover:border-textDim transition-colors duration-150 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => { const m = disableMarketPrompt; setDisableMarketPrompt(null); _doDisableMarket(m.name); }}
                className="flex-1 py-2.5 rounded-xl bg-down text-white text-[13px] font-semibold hover:opacity-90 transition-opacity duration-150 cursor-pointer"
              >
                Exit Positions & Disable
              </button>
            </div>
          </div>
        </div>
      )}

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
    setAuthed(true);
    window.history.replaceState(null, '', '/dashboard');
  };

  useEffect(() => {
    if (!authed && window.location.pathname !== '/') {
      window.history.replaceState(null, '', '/');
    }
  }, [authed]);

  if (!authed) return <LandingPage onLogin={handleLogin} />;
  return <AppInner />;
}

export default App;
