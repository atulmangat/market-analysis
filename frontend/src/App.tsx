import { useEffect, useRef, useState } from 'react';

import type {
  Strategy, StrategyReport, PortfolioPnl, MarketConfig, DebateRound,
  AgentMemory, AgentPrompt, AgentFitness, WebResearch,
  PipelineEvent, PipelineRun, LiveQuote, MarketEvent, Page, PipelineReadiness
} from './types';
import { NAV } from './constants';
import { getToken, apiFetch, applyTheme, getMarketForTicker } from './utils';

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
import { PageLoader } from './components/PageLoader';

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
  const [scheduleInterval, setScheduleInterval] = useState<number>(60);
  const [scheduleResearch, setScheduleResearch] = useState<number>(60);
  const [scheduleTrade, setScheduleTrade]       = useState<number>(60);
  const [scheduleEval, setScheduleEval]         = useState<number>(120);
  const [isTriggering, setIsTriggering]     = useState(false);
  const isTriggeringRef = useRef(false);
  const [investmentFocus, setInvestmentFocus] = useState('');
  const [investmentFocusSaved, setInvestmentFocusSaved] = useState(false);
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
    '/settings':  'settings',
  };
  const PAGE_TO_URL: Record<Page, string> = {
    dashboard: '/dashboard',
    markets:   '/markets',
    graph:     '/data',
    portfolio: '/portfolio',
    memory:    '/agents',
    pipeline:  '/pipeline',
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



  const userNavigatedRef = useRef(false);
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
  const [timelineTicker, setTimelineTicker]       = useState<string | null>(null);



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
      const [stratRes, mktRes, debRes, appRes, memRes, resRes, schedRes, agentRes] = await Promise.all([
        apiFetch('/strategies'),
        apiFetch('/config/markets'), apiFetch('/debates'), apiFetch('/config/approval_mode'),
        apiFetch('/memory'), apiFetch('/research'), apiFetch('/config/schedule'),
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
      if (schedRes.ok) { const d = await schedRes.json(); setScheduleInterval(d.interval_minutes); }
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
      if (focusRes.ok) { const d = await focusRes.json(); setInvestmentFocus(d.investment_focus ?? ''); }
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

  const [pipelineEvents, setPipelineEvents]       = useState<PipelineEvent[]>([]);
  const [pipelineRunId, setPipelineRunId]         = useState<string | null>(null);
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
  const setResearchEvents = (v: PipelineEvent[]) => setPipelineTabEvents(s => ({ ...s, researchEvents: v }));
  const setTradeEvents    = (v: PipelineEvent[]) => setPipelineTabEvents(s => ({ ...s, tradeEvents: v }));
  const setEvalEvents     = (v: PipelineEvent[]) => setPipelineTabEvents(s => ({ ...s, evalEvents: v }));
  const [researchStepOpen, setResearchStepOpen]   = useState(false);
  const [pendingDropdownOpen, setPendingDropdownOpen] = useState(false);
  const [disableMarketPrompt, setDisableMarketPrompt] = useState<{ name: string; affected: Strategy[] } | null>(null);
  const [pipelineRuns, setPipelineRuns]           = useState<PipelineRun[]>([]);
  const [pipelineRunsLoaded, setPipelineRunsLoaded] = useState(false);
  const [pipelineReadiness, setPipelineReadiness] = useState<PipelineReadiness>({ has_research_data: false, last_research_at: null, active_positions: 0 });
  const [selectedRunId, setSelectedRunId]         = useState<string | null>(null);
  const [selectedRunEvents, setSelectedRunEvents] = useState<PipelineEvent[]>([]);
  const [selectedRunLoading, setSelectedRunLoading] = useState(false);
  // True when the user explicitly clicked a past run — prevents transition effects from overriding.
  const userSelectedRunRef = useRef(false);
  const [statFocus, setStatFocus]           = useState<'active' | 'pending' | 'debates' | 'memories' | null>(null);
  const [kgRefreshTrigger, setKgRefreshTrigger] = useState(0);
  const lastKgRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    const pollPipeline = async () => {
      try {
        const res = await apiFetch('/pipeline/events');
        if (res.ok) {
          const data = await res.json();
          const runId = data.run_id as string | null;
          // Trust the backend's is_running flag — it includes the stale-lock guard.
          // Do NOT re-derive from run_step: an intermediate step with is_running=false
          // means the pipeline died mid-step, not that it's still running.
          const running = !!data.is_running;
          // Do NOT call setIsTriggering here — /system/status is the single source of truth
          // for isTriggering (it includes the per-pipeline flags + trigger guard). Calling it
          // here too causes isTriggering to bounce between two values in a single poll tick,
          // triggering the transition effect twice and making the UI flicker.
          if (running) isTriggeringRef.current = true; // only set true optimistically; /system/status owns false
          setPipelineRunId(runId);
          // Always show events for the current run_id — don't clear on refresh
          const events: PipelineEvent[] = data.events ?? [];
          if (runId) {
            setPipelineEvents(events);
          } else {
            setPipelineEvents([]);
          }
          if (running && !initialPollDoneRef.current && !userNavigatedRef.current) {
            navigate('pipeline');
          }
          // Refresh KG viewer as soon as KG_INGEST DONE appears (once per run)
          const kgDone = events.some(e => e.step === 'KG_INGEST' && e.status === 'DONE');
          if (kgDone && runId && lastKgRunIdRef.current !== runId) {
            lastKgRunIdRef.current = runId;
            setKgRefreshTrigger(t => t + 1);
          }
          initialPollDoneRef.current = true;
        }
      } catch { /* ignore */ }
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
          // Fetch live events only while running, then update events atomically
          const fetches: Promise<void>[] = [];
          if (rr && ridR) fetches.push(
            apiFetch(`/pipeline/runs/${ridR}`).then(r => r.ok ? r.json() : null)
              .then(d => { if (d) setPipelineTabEvents(s => ({ ...s, researchEvents: d.events ?? [] })); }).catch(() => {})
          );
          if (tr && ridT) fetches.push(
            apiFetch(`/pipeline/runs/${ridT}`).then(r => r.ok ? r.json() : null)
              .then(d => { if (d) setPipelineTabEvents(s => ({ ...s, tradeEvents: d.events ?? [] })); }).catch(() => {})
          );
          if (er && ridE) fetches.push(
            apiFetch(`/pipeline/runs/${ridE}`).then(r => r.ok ? r.json() : null)
              .then(d => { if (d) setPipelineTabEvents(s => ({ ...s, evalEvents: d.events ?? [] })); }).catch(() => {})
          );
          // Fire all event fetches in parallel — results update state as they arrive
          void Promise.all(fetches);
        }
      } catch { /* ignore */ }
      pollTimerRef.current = setTimeout(pollPipeline, isTriggeringRef.current ? 2000 : 8000);
    };

    triggerPollRef.current = () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollPipeline();
    };

    pollPipeline();
    return () => { if (pollTimerRef.current) clearTimeout(pollTimerRef.current); };
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
    setTimeout(() => { triggerPollRef.current?.(); }, 500);
    apiFetch('/trigger', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'error') { isTriggeringRef.current = false; setIsTriggering(false); alert(data.message); }
        else {
          if (data.run_id) setPipelineRunId(data.run_id);
          setTimeout(() => { triggerPollRef.current?.(); fetchData(); }, 1000);
        }
      })
      .catch(() => { isTriggeringRef.current = false; setIsTriggering(false); });
  };

  const handleScheduleUpdate = (minutes: number) => {
    setScheduleInterval(minutes);
    apiFetch('/config/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ interval_minutes: minutes }) })
      .then(() => apiFetch('/system/sync_schedule', { method: 'POST' }))
      .catch(console.error);
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
    setEvalEvents([]);
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
    setResearchEvents([]);
    setTimeout(() => { triggerPollRef.current?.(); }, 500);
    apiFetch('/research/trigger', { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'error') { setResearchRunning(false); toast(data.message, 'err'); }
        else {
          if (data.run_id) { setCurrentRunIdResearch(data.run_id); setPipelineRunId(data.run_id); }
          toast('Research pipeline started', 'ok');
          setTimeout(() => { triggerPollRef.current?.(); fetchData(); }, 1000);
        }
      })
      .catch(() => { setResearchRunning(false); });
  };

  const handleTradeTrigger = () => {
    if (tradeRunning) return;
    lastTriggerAtRef.current.trade = Date.now();
    setTradeRunning(true);
    setTradeEvents([]);
    setTimeout(() => { triggerPollRef.current?.(); }, 500);
    apiFetch('/trade/trigger', { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'error') { setTradeRunning(false); toast(data.message, 'err'); }
        else {
          if (data.run_id) { setCurrentRunIdTrade(data.run_id); setPipelineRunId(data.run_id); }
          toast('Trade pipeline started', 'ok');
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

  // Track run transitions: new run started → go to Live; run finished → show completed run
  const prevIsTriggering = useRef(false);
  useEffect(() => {
    const wasRunning = prevIsTriggering.current;
    const isNowRunning = isTriggering;
    if (!wasRunning && isNowRunning) {
      // New pipeline started — clear selection and show live view
      userSelectedRunRef.current = false;
      setSelectedRunId(null);
      setSelectedRunEvents([]);
    } else if (wasRunning && !isNowRunning) {
      // Pipeline just finished — pick the most recently active run ID
      const finishedRunId = currentRunIdTrade ?? currentRunIdResearch ?? currentRunIdEval ?? pipelineRunId;
      if (finishedRunId && !userSelectedRunRef.current) {
        setPipelineEvents([]);
        setSelectedRunId(finishedRunId);
        setSelectedRunEvents([]);
        setSelectedRunLoading(true);
        apiFetch(`/pipeline/runs/${finishedRunId}`)
          .then(r => r.ok ? r.json() : null)
          .then(eventsData => { if (eventsData) setSelectedRunEvents(eventsData.events ?? []); })
          .catch(() => {})
          .finally(() => setSelectedRunLoading(false));
      }
    }
    prevIsTriggering.current = isNowRunning;
  }, [isTriggering, pipelineRunId, currentRunIdTrade, currentRunIdResearch, currentRunIdEval]);

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
            timelineTicker={timelineTicker}
            setTimelineTicker={setTimelineTicker}
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
            marketsSearchOpen={marketsSearchOpen}
            setMarketsSearchOpen={setMarketsSearchOpen}
            marketsSearchQuery={marketsSearchQuery}
            setMarketsSearchQuery={setMarketsSearchQuery}
            marketsSearchResults={marketsSearchResults}
            setMarketsSearchResults={setMarketsSearchResults}
            marketsSearchLoading={marketsSearchLoading}
            setMarketsSearchLoading={setMarketsSearchLoading}
            marketsSearchTimer={marketsSearchTimer}
            isTriggering={isTriggering}
            fetchQuotes={fetchQuotes}
            openReport={openReport}
            onTrigger={handleManualTrigger}
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
            isTriggering={isTriggering}
            researchRunning={researchRunning}
            tradeRunning={tradeRunning}
            evalRunning={evalRunning}
            currentRunIdResearch={currentRunIdResearch}
            currentRunIdTrade={currentRunIdTrade}
            currentRunIdEval={currentRunIdEval}
            researchEvents={researchEvents}
            tradeEvents={tradeEvents}
            evalEvents={evalEvents}
            pipelineEvents={pipelineEvents}
            pipelineRunId={pipelineRunId}
            pipelineRuns={pipelineRuns}
            pipelineRunsLoaded={pipelineRunsLoaded}
            selectedRunId={selectedRunId}
            setSelectedRunId={setSelectedRunId}
            selectedRunEvents={selectedRunEvents}
            setSelectedRunEvents={setSelectedRunEvents}
            selectedRunLoading={selectedRunLoading}
            loadRunEvents={loadRunEvents}
            setPipelineRuns={setPipelineRuns}
            setPipelineRunsLoaded={setPipelineRunsLoaded}
            researchStepOpen={researchStepOpen}
            setResearchStepOpen={setResearchStepOpen}
            research={research}
            investmentFocus={investmentFocus}
            setInvestmentFocus={setInvestmentFocus}
            investmentFocusSaved={investmentFocusSaved}
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
            handleManualTrigger={handleManualTrigger}
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
          />
        );
      case 'settings':
        return (
          <SettingsPage
            darkMode={darkMode}
            toggleDarkMode={toggleDarkMode}
            approvalMode={approvalMode}
            setMode={setMode}
            markets={markets}
            toggleMarket={toggleMarket}
            scheduleInterval={scheduleInterval}
            handleScheduleUpdate={handleScheduleUpdate}
            handleManualTrigger={handleManualTrigger}
            isTriggering={isTriggering}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex min-h-screen bg-background overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-52 shrink-0 border-r border-borderLight bg-surface flex flex-col overflow-hidden">
        {/* Logo */}
        <div className="px-5 py-[18px] border-b border-borderLight">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-brand-600 flex items-center justify-center shrink-0">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 12 L5 8 L8 10 L11 5 L14 7" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="14" cy="7" r="1.5" fill="white"/>
              </svg>
            </div>
            <div>
              <p className="text-[13px] font-semibold text-textMain leading-none tracking-tight">Market Intel</p>
              <p className="text-[10px] text-textDim mt-0.5 tracking-wide">AI Strategy Engine</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2.5 space-y-px">
          {NAV.map(n => (
            <button
              key={n.id}
              onClick={() => { userNavigatedRef.current = true; navigate(n.id); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all text-left group ${
                page === n.id
                  ? 'bg-brand-600/12 text-brand-400'
                  : 'text-textDim hover:text-textMuted hover:bg-surface2'
              }`}
            >
              <span className={`text-sm w-4 text-center shrink-0 transition-colors ${
                page === n.id ? 'text-brand-400' :
                n.id === 'pipeline' && isTriggering ? 'text-amber-400 animate-spin' :
                'text-textDim group-hover:text-textMuted'
              }`}>{n.icon}</span>
              <span className="flex-1 truncate">{n.label}</span>
              {n.id === 'pipeline' && isTriggering && (
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
              )}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-borderLight space-y-2">
          <div className="flex items-center gap-2 px-3 py-2">
            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${isTriggering ? 'bg-amber-400 animate-pulse' : 'bg-up'}`} />
            <button
              onClick={() => isTriggering && navigate('pipeline')}
              className={`text-[11px] truncate ${isTriggering ? 'text-amber-400 hover:underline cursor-pointer' : 'text-textDim'}`}
            >
              {isTriggering ? 'Pipeline running…' : 'System active'}
            </button>
          </div>
          <button
            onClick={toggleDarkMode}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface2 transition-colors group"
          >
            <span className="text-[11px] text-textDim group-hover:text-textMuted">{darkMode ? 'Dark' : 'Light'}</span>
            <span className="text-xs text-textDim">{darkMode ? '○' : '●'}</span>
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 min-w-0 overflow-y-auto h-screen">
        {/* Top bar */}
        <header className="sticky top-0 z-10 bg-background/90 backdrop-blur-md border-b border-borderLight px-7 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-textMain">
              {NAV.find(n => n.id === page)?.label}
            </h1>
            <span className="text-borderMid">·</span>
            <p className="text-[11px] text-textDim tabular-nums">{new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
          </div>
          <div className="flex items-center gap-2">
            {pendingStrategies.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setPendingDropdownOpen(o => !o)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-400/8 border border-amber-400/20 text-amber-400 rounded-lg text-[11px] font-medium hover:bg-amber-400/12 transition-colors"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                  {pendingStrategies.length} pending
                </button>
                {pendingDropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 z-50 w-72 bg-surface border border-borderMid rounded-xl shadow-2xl overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-borderLight flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-textMuted uppercase tracking-wider">Pending Approval</span>
                      <button onClick={() => setPendingDropdownOpen(false)} className="text-textDim hover:text-textMain text-base leading-none w-5 h-5 flex items-center justify-center">×</button>
                    </div>
                    <div className="divide-y divide-borderLight max-h-96 overflow-y-auto">
                      {pendingStrategies.map(s => (
                        <div key={s.id} className="px-4 py-3 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${s.strategy_type === 'LONG' ? 'bg-up/10 text-up border border-up/15' : 'bg-down/10 text-down border border-down/15'}`}>{s.strategy_type}</span>
                              <span className="text-sm font-semibold text-textMain font-mono">{s.symbol}</span>
                            </div>
                            <span className="text-[11px] text-textDim font-mono">${(s.entry_price ?? 0).toFixed(2)}</span>
                          </div>
                          <p className="text-[11px] text-textMuted leading-relaxed line-clamp-2">{s.reasoning_summary}</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => { handleApproval(s.id, 'approve'); setPendingDropdownOpen(false); }}
                              className="flex-1 py-1.5 text-[11px] font-semibold rounded-lg bg-up/10 border border-up/20 text-up hover:bg-up/15 transition-colors"
                            >Approve</button>
                            <button
                              onClick={() => { handleApproval(s.id, 'reject'); setPendingDropdownOpen(false); }}
                              className="flex-1 py-1.5 text-[11px] font-semibold rounded-lg bg-down/10 border border-down/20 text-down hover:bg-down/15 transition-colors"
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
              className="h-8 w-8 flex items-center justify-center rounded-lg border border-borderLight hover:bg-surface2 transition-colors text-textDim hover:text-textMuted"
              title={darkMode ? 'Light mode' : 'Dark mode'}
            >
              <span className="text-xs">{darkMode ? '○' : '●'}</span>
            </button>
          </div>
        </header>

        <div className="px-7 py-6">
          {renderPage()}
        </div>
      </main>

      {/* Disable Market Confirmation Dialog */}
      {disableMarketPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-surface border border-borderMid rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-start gap-3">
              <span className="text-amber-400 text-xl shrink-0">⚠</span>
              <div>
                <h3 className="text-sm font-semibold text-textMain">Disable {disableMarketPrompt.name} Market?</h3>
                <p className="text-xs text-textMuted mt-1">
                  This will close {disableMarketPrompt.affected.length} active position{disableMarketPrompt.affected.length !== 1 ? 's' : ''} at current market price:
                </p>
              </div>
            </div>
            <div className="bg-surface2 rounded-lg divide-y divide-borderLight">
              {disableMarketPrompt.affected.map(s => (
                <div key={s.id} className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-textMain">{s.symbol}</span>
                    <Badge type={s.strategy_type} />
                  </div>
                  <span className={`text-xs font-mono ${(s.current_return ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>
                    {s.current_return != null ? `${s.current_return >= 0 ? '+' : ''}${s.current_return.toFixed(2)}%` : '—'}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setDisableMarketPrompt(null)}
                className="flex-1 py-2 rounded-lg border border-borderMid text-sm text-textMuted hover:text-textMain hover:border-borderMid transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { const m = disableMarketPrompt; setDisableMarketPrompt(null); _doDisableMarket(m.name); }}
                className="flex-1 py-2 rounded-lg bg-down text-white text-sm font-semibold hover:opacity-90 transition-opacity"
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
  };
  if (!authed) return <LandingPage onLogin={handleLogin} />;
  return <AppInner />;
}

export default App;
