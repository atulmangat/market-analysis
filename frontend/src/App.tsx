import { useEffect, useRef, useState } from 'react';

import type {
  Prediction, Strategy, StrategyReport, PortfolioPnl, MarketConfig, DebateRound,
  AgentMemory, AgentPrompt, AgentFitness, AgentEvolution, WebResearch,
  PipelineEvent, PipelineRun, LiveQuote, MarketEvent,
} from './types';
import { NAV } from './constants';
import { getToken, clearToken, apiFetch, applyTheme, getMarketForTicker } from './utils';

import { Badge } from './components/Badge';
import { ToastList } from './components/ToastList';
import { StrategyReportPanel } from './templates/StrategyReportPanel';
import { useToast } from './hooks/useToast';

import { LandingPage } from './pages/LandingPage';
import { DashboardPage } from './pages/DashboardPage';
import { MarketsPage } from './pages/MarketsPage';
import { KnowledgeGraphPage } from './pages/KnowledgeGraphPage';
import { PortfolioPage } from './pages/PortfolioPage';
import { MemoryPage } from './pages/MemoryPage';
import { PipelinePage } from './pages/PipelinePage';
import { SettingsPage } from './pages/SettingsPage';

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
  const [reportError, setReportError]       = useState<string | null>(null);
  const [budgetInput, setBudgetInput]       = useState<string>('10000');
  const [approvalMode, setApprovalMode]     = useState('auto');
  const [scheduleInterval, setScheduleInterval] = useState<number>(60);
  const [isTriggering, setIsTriggering]     = useState(false);
  const isTriggeringRef = useRef(false);
  const [investmentFocus, setInvestmentFocus] = useState('');
  const [investmentFocusSaved, setInvestmentFocusSaved] = useState(false);
  const [strategiesLoaded, setStrategiesLoaded] = useState(false);
  const [page, setPage]                     = useState<import('./types').Page>('dashboard');
  const userNavigatedRef = useRef(false);
  const [darkMode, setDarkMode]             = useState<boolean>(() => {
    const saved = localStorage.getItem('theme');
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
      if (resRes.ok) { const d = await resRes.json(); setResearch(d); try { localStorage.setItem('cache_research', JSON.stringify(d)); } catch { /* storage quota */ } }
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

  const [pipelineEvents, setPipelineEvents]       = useState<PipelineEvent[]>([]);
  const [pipelineRunId, setPipelineRunId]         = useState<string | null>(null);
  const [researchStepOpen, setResearchStepOpen]   = useState(false);
  const [pendingDropdownOpen, setPendingDropdownOpen] = useState(false);
  const [disableMarketPrompt, setDisableMarketPrompt] = useState<{ name: string; affected: Strategy[] } | null>(null);
  const [pipelineRuns, setPipelineRuns]           = useState<PipelineRun[]>([]);
  const [pipelineRunsLoaded, setPipelineRunsLoaded] = useState(false);
  const [selectedRunId, setSelectedRunId]         = useState<string | null>(null);
  const [selectedRunEvents, setSelectedRunEvents] = useState<PipelineEvent[]>([]);
  const [selectedRunLoading, setSelectedRunLoading] = useState(false);
  const [statFocus, setStatFocus]           = useState<'active' | 'pending' | 'debates' | 'memories' | null>(null);

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
          if (running) {
            setPipelineEvents(data.events ?? []);
            if (!initialPollDoneRef.current && !userNavigatedRef.current) {
              setPage('pipeline');
            }
          } else {
            setPipelineEvents([]);
          }
          initialPollDoneRef.current = true;
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
      pollTimerRef.current = setTimeout(pollPipeline, isTriggeringRef.current ? 2000 : 8000);
    };

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

  const handleStopPipeline = () => {
    setIsTriggering(false);
    isTriggeringRef.current = false;
    apiFetch('/system/stop', { method: 'POST' })
      .then(r => { if (r.ok) toast('Pipeline stopped', 'info'); })
      .catch(() => {});
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
  const prevPipelineRunId = useRef<string | null>(null);
  useEffect(() => {
    const wasRunning = prevIsTriggering.current;
    const isNowRunning = isTriggering;
    if (!wasRunning && isNowRunning) {
      setSelectedRunId(null);
      setSelectedRunEvents([]);
    } else if (wasRunning && !isNowRunning && pipelineRunId) {
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
    switch (page) {
      case 'dashboard':
        return (
          <DashboardPage
            strategies={strategies}
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
            predictions={predictions}
          />
        );
      case 'markets':
        return (
          <MarketsPage
            enabledMarketNames={enabledMarketNames}
            activeStrategies={activeStrategies}
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
            fetchQuotes={fetchQuotes}
            openReport={openReport}
          />
        );
      case 'graph':
        return <KnowledgeGraphPage />;
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
          <MemoryPage
            agents={agents}
            groupedMemories={groupedMemories}
            editingPromptAgent={editingPromptAgent}
            editPromptText={editPromptText}
            setEditingPromptAgent={setEditingPromptAgent}
            setEditPromptText={setEditPromptText}
            saveAgentPrompt={saveAgentPrompt}
          />
        );
      case 'pipeline':
        return (
          <PipelinePage
            isTriggering={isTriggering}
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
            handleStopPipeline={handleStopPipeline}
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
            agents={agents}
            agentFitness={agentFitness}
            agentEvolution={agentEvolution}
            evolutionAgent={evolutionAgent}
            selectedAgent={selectedAgent}
            setSelectedAgent={setSelectedAgent}
            loadEvolution={loadEvolution}
            setEvolutionAgent={setEvolutionAgent}
            memories={memories}
          />
        );
      default:
        return null;
    }
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
              onClick={() => { userNavigatedRef.current = true; setPage(n.id); }}
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
