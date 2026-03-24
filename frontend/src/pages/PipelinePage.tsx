import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { PipelineEvent, PipelineRun, WebResearch, PipelineReadiness } from '../types';
import { STEP_META, MARKET_SECTORS, MARKET_ICONS, TICKER_DB } from '../constants';
import { apiFetch, getMarketForTicker } from '../utils';

type PipelineTab = 'research' | 'trade' | 'eval';

interface PipelinePagesProps {
  researchRunning: boolean;
  tradeRunning: boolean;
  evalRunning: boolean;
  currentRunIdResearch: string | null;
  currentRunIdTrade: string | null;
  currentRunIdEval: string | null;
  researchEvents: PipelineEvent[];
  tradeEvents: PipelineEvent[];
  evalEvents: PipelineEvent[];
  pipelineRuns: PipelineRun[];
  selectedRunId: string | null;
  selectedRunEvents: PipelineEvent[];
  selectedRunLoading: boolean;
  research: WebResearch[];
  researchStepOpen: boolean;
  enabledMarketNames: string[];
  investmentFocus: string;
  focusTickers: string[];
  focusSearch: string;
  focusSearchOpen: boolean;
  focusSectorFilter: { market: string; sector: string } | null;
  tickerSearchResults: { symbol: string; name: string; sector: string; exchange: string; type: string }[];
  tickerSearchLoading: boolean;
  scheduleResearch: number;
  scheduleTrade: number;
  scheduleEval: number;
  pipelineReadiness: PipelineReadiness;
  setResearchStepOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setPipelineRuns: Dispatch<SetStateAction<PipelineRun[]>>;
  setSelectedRunId: (id: string | null) => void;
  setSelectedRunEvents: (evts: PipelineEvent[]) => void;
  setInvestmentFocus: (v: string) => void;
  setFocusTickers: (fn: (prev: string[]) => string[]) => void;
  setFocusSearch: (v: string) => void;
  setFocusSearchOpen: (v: boolean) => void;
  setFocusSectorFilter: (f: { market: string; sector: string } | null) => void;
  setTickerSearchResults: (r: { symbol: string; name: string; sector: string; exchange: string; type: string }[]) => void;
  setTickerSearchLoading: (v: boolean) => void;
  saveInvestmentFocus: (text: string) => void;
  handleStopPipeline: (pipeline?: 'research' | 'trade' | 'eval') => void;
  handleEvalTrigger: () => void;
  handleResearchTrigger: () => void;
  handleTradeTrigger: () => void;
  onScheduleUpdate: (pipeline: 'research' | 'trade' | 'eval', minutes: number) => void;
  setSelectedRunLoading: (v: boolean) => void;
  loadRunEvents: (runId: string) => void;
  openReport: (id: number) => void;
  clearTabEvents: (tab: PipelineTab) => void;
}

const ORDERED_STEPS = [
  'START', 'WEB_RESEARCH', 'KG_INGEST', 'DEBATE_PANEL', 'AGENT_QUERY', 'JUDGE', 'DEPLOY', 'MEMORY_WRITE',
];

const RESEARCH_ORDERED_STEPS = [
  'START', 'WEB_RESEARCH', 'KG_INGEST',
];

const TRADE_ORDERED_STEPS = [
  'START', 'DEBATE_PANEL', 'AGENT_QUERY', 'JUDGE', 'DEPLOY', 'MEMORY_WRITE',
];

// Evaluation pipeline steps
const EVAL_ORDERED_STEPS = [
  'START', 'PRICE_FETCH', 'SCORE_STRATEGIES', 'POSITION_REVIEW', 'AGENT_ANALYSIS', 'DARWIN_SELECTION', 'MEMORY_WRITE',
];

const EVAL_STEP_LABELS: Record<string, string> = {
  START:             'Initialising',
  PRICE_FETCH:       'Fetching Live Prices',
  SCORE_STRATEGIES:  'Scoring Strategies',
  POSITION_REVIEW:   'Reviewing Positions',
  AGENT_ANALYSIS:    'Agent Analysis',
  DARWIN_SELECTION:  'Evolving Agents',
  MEMORY_WRITE:      'Writing Lessons',
};


const STEP_LABELS: Record<string, string> = {
  START:        'Initialising',
  WEB_RESEARCH: 'Fetching Research',
  KG_INGEST:    'Building Knowledge Graph',
  DEBATE_PANEL: 'Starting Debate',
  AGENT_QUERY:  'Agents Deliberating',
  JUDGE:        'Judge Evaluating',
  DEPLOY:       'Deploying Strategy',
  MEMORY_WRITE: 'Writing Memories',
};


const STEP_COLORS: Record<string, { ring: string; glow: string; text: string; bg: string }> = {
  // Pipeline event styling configs
  START:        { ring: 'border-brand-500',   glow: 'shadow-brand-500/20',   text: 'text-brand-400',   bg: 'bg-brand-500/10'   },
  WEB_RESEARCH: { ring: 'border-purple-500',  glow: 'shadow-purple-500/20',  text: 'text-purple-400',  bg: 'bg-purple-500/10'  },
  KG_INGEST:    { ring: 'border-cyan-500',    glow: 'shadow-cyan-500/20',    text: 'text-cyan-400',    bg: 'bg-cyan-500/10'    },
  DEBATE_PANEL: { ring: 'border-teal-500',    glow: 'shadow-teal-500/20',    text: 'text-teal-400',    bg: 'bg-teal-500/10'    },
  AGENT_QUERY:  { ring: 'border-teal-400',    glow: 'shadow-teal-400/20',    text: 'text-teal-300',    bg: 'bg-teal-400/10'    },
  JUDGE:        { ring: 'border-warning',   glow: 'shadow-warning/20',   text: 'text-warning',   bg: 'bg-warning-bg'   },
  DEPLOY:       { ring: 'border-brand-400',   glow: 'shadow-brand-400/20',   text: 'text-brand-400',   bg: 'bg-brand-400/10'   },
  MEMORY_WRITE: { ring: 'border-indigo-500',  glow: 'shadow-indigo-500/20',  text: 'text-indigo-400',  bg: 'bg-indigo-500/10'  },
  ERROR:        { ring: 'border-down',     glow: 'shadow-down/20',     text: 'text-down-text',     bg: 'bg-down-bg'     },
};

// Derive the "current" in-progress step from events
function getCurrentStep(events: PipelineEvent[]): string | null {
  const inProgress = [...events].reverse().find(e => e.status === 'IN_PROGRESS');
  return inProgress?.step ?? null;
}

function getCompletedSteps(events: PipelineEvent[], stepsArray: string[] = ORDERED_STEPS): Set<string> {
  const done = new Set<string>();
  for (const e of events) {
    if (e.status === 'DONE' || e.status === 'WARN') done.add(e.step);
    if (e.status === 'IN_PROGRESS') {
      // If there's a later event for the same step that is DONE or WARN, mark done
      const later = events.slice(events.indexOf(e) + 1).find(x => x.step === e.step && (x.status === 'DONE' || x.status === 'WARN'));
      if (later) done.add(e.step);
    }
  }
  // Any step that comes before the current in-progress step should also be marked done,
  // even if its DONE event hasn't fired yet (e.g. WEB_RESEARCH DONE fires after KG_INGEST starts).
  const currentInProgressIdx = (() => {
    const inProgress = [...events].reverse().find(e => e.status === 'IN_PROGRESS');
    if (!inProgress) return -1;
    return stepsArray.indexOf(inProgress.step);
  })();
  if (currentInProgressIdx > 0) {
    for (let i = 0; i < currentInProgressIdx; i++) {
      // Mark all preceding steps done — they must have completed for the pipeline to reach the current step
      done.add(stepsArray[i]);
    }
  }
  return done;
}

function isRunComplete(events: PipelineEvent[], stepsArray: string[] = ORDERED_STEPS): boolean {
  // The last step in the pipeline emitting DONE = run complete.
  const lastStep = stepsArray[stepsArray.length - 1];
  return events.some(e => e.step === lastStep && e.status === 'DONE')
    || events.some(e => e.step === 'MEMORY_WRITE' && e.status === 'DONE');
}


function hasError(events: PipelineEvent[]): boolean {
  return events.some(e => e.status === 'ERROR');
}

// A run is stale if it's been "running" with no new events for > 10 minutes
function isStaleRun(run: PipelineRun | undefined, events: PipelineEvent[]): boolean {
  if (!run || run.status === 'done' || run.status === 'error') return false;
  const lastEventTime = events.length > 0
    ? new Date(events[events.length - 1].created_at).getTime()
    : new Date(run.started_at).getTime();
  return Date.now() - lastEventTime > 10 * 60 * 1000;
}

function getRunDuration(events: PipelineEvent[]): number | null {
  if (events.length < 2) return null;
  return Math.round(
    (new Date(events[events.length - 1].created_at).getTime() - new Date(events[0].created_at).getTime()) / 1000
  );
}

// ── Pipeline tab SVG icons ────────────────────────────────────────────────
function TabIcon({ id, className }: { id: PipelineTab; className?: string }) {
  if (id === 'research') return (
    // Data Collection: satellite dish pulling in signals → knowledge graph node
    <svg viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="2"/>
      {/* Concentric arcs (incoming signal) */}
      <path d="M6.5 6.5 A6.5 6.5 0 0 1 15.5 6.5" opacity="0.5"/>
      <path d="M4   4   A9.9 9.9 0 0 1 18 4"   opacity="0.3"/>
      {/* Outgoing spokes to graph nodes */}
      <line x1="11" y1="13" x2="7"  y2="17" opacity="0.6"/>
      <line x1="11" y1="13" x2="15" y2="17" opacity="0.6"/>
      <circle cx="7"  cy="17" r="1.3" fill="currentColor" stroke="none" opacity="0.7"/>
      <circle cx="15" cy="17" r="1.3" fill="currentColor" stroke="none" opacity="0.7"/>
    </svg>
  );
  if (id === 'trade') return (
    // Generate Trades: four agent circles debating → converge to judge gavel → arrow up
    <svg viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {/* Agent nodes */}
      <circle cx="5"  cy="5"  r="2" opacity="0.7"/>
      <circle cx="17" cy="5"  r="2" opacity="0.7"/>
      <circle cx="5"  cy="17" r="2" opacity="0.5"/>
      <circle cx="17" cy="17" r="2" opacity="0.5"/>
      {/* Lines to center */}
      <line x1="7"  y1="7"  x2="10" y2="10" opacity="0.4"/>
      <line x1="15" y1="7"  x2="12" y2="10" opacity="0.4"/>
      {/* Center judge / decision */}
      <circle cx="11" cy="11" r="2.5" fill="currentColor" stroke="none" opacity="0.9"/>
      {/* Upward deploy arrow */}
      <path d="M11 8.5 L11 3 M9 5 L11 3 L13 5" strokeWidth="1.4"/>
    </svg>
  );
  // eval
  return (
    // Agent Evaluation: score dial + upward evolution arrow
    <svg viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {/* Score arc */}
      <path d="M4.5 15 A8 8 0 1 1 17.5 15" strokeWidth="1.5" opacity="0.5"/>
      {/* Needle */}
      <line x1="11" y1="11" x2="15" y2="7" strokeWidth="1.6"/>
      <circle cx="11" cy="11" r="1.5" fill="currentColor" stroke="none"/>
      {/* Evolution up-arrow with branch */}
      <path d="M7 17 L11 13 L15 17" opacity="0.6"/>
      <line x1="11" y1="13" x2="11" y2="19" opacity="0.4"/>
    </svg>
  );
}

const TAB_CONFIG: { id: PipelineTab; label: string; sublabel: string; icon: string; color: string; activeBg: string; activeBorder: string; dot: string; borderColor: string }[] = [
  { id: 'research', label: 'Data Collection',  sublabel: 'News · KG · Research',       icon: '◎', color: 'text-cyan-400',   activeBg: 'bg-cyan-500/10',   activeBorder: 'border-cyan-500/40',   dot: 'bg-cyan-400',    borderColor: 'border-l-cyan-500'   },
  { id: 'trade',    label: 'Generate Trades',  sublabel: 'Agents · Judge · Deploy',     icon: '◈', color: 'text-brand-400',  activeBg: 'bg-brand-500/10',  activeBorder: 'border-brand-500/40',  dot: 'bg-brand-400',   borderColor: 'border-l-brand-500'  },
  { id: 'eval',     label: 'Agent Evaluation', sublabel: 'Score · Evolve · Improve',    icon: '◉', color: 'text-purple-400', activeBg: 'bg-purple-500/10', activeBorder: 'border-purple-500/40', dot: 'bg-purple-400',  borderColor: 'border-l-purple-500' },
];


// Map run_type to tab
function runTypeToTab(runType: string): PipelineTab {
  if (runType === 'eval') return 'eval';
  if (runType === 'research') return 'research';
  if (runType === 'trade' || runType === 'debate') return 'trade';
  return 'trade';
}

const SCHEDULE_OPTIONS = [15, 30, 60, 120, 240, 480];

export function PipelinePage({
  researchRunning, tradeRunning, evalRunning,
  currentRunIdResearch, currentRunIdTrade, currentRunIdEval,
  researchEvents, tradeEvents, evalEvents,
  pipelineRuns,
  selectedRunId, selectedRunEvents, selectedRunLoading, research, researchStepOpen,
  enabledMarketNames, investmentFocus,
  focusTickers, focusSearch, focusSearchOpen, focusSectorFilter,
  tickerSearchResults, tickerSearchLoading,
  scheduleResearch, scheduleTrade, scheduleEval, pipelineReadiness,
  setResearchStepOpen, setSelectedRunId, setSelectedRunEvents,
  setInvestmentFocus, setFocusTickers, setFocusSearch, setFocusSearchOpen,
  setFocusSectorFilter, setTickerSearchResults, setTickerSearchLoading,
  saveInvestmentFocus, handleStopPipeline, handleEvalTrigger,
  handleResearchTrigger, handleTradeTrigger, onScheduleUpdate,
  setSelectedRunLoading, loadRunEvents, openReport, setPipelineRuns,
  clearTabEvents,
}: PipelinePagesProps) {
  // Per-tab active state
  const tabIsActive = (tab: PipelineTab) =>
    tab === 'research' ? researchRunning :
    tab === 'trade'    ? tradeRunning :
    tab === 'eval'     ? evalRunning : false;
  const focusSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSelectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [stepsExpanded, setStepsExpanded] = useState(false);
  const [llmLogsOpen, setLlmLogsOpen] = useState(false);
  const [evalBadgeTooltip, setEvalBadgeTooltip] = useState<{ x: number; y: number } | null>(null);
  const [focusDropdownRect, setFocusDropdownRect] = useState<DOMRect | null>(null);
  const focusInputWrapRef = useRef<HTMLDivElement>(null);
  const [runsPage, setRunsPage] = useState(0);
  const [activeTab, setActiveTab] = useState<PipelineTab>('research');
  const RUNS_PER_PAGE = 10;

  // Keep a ref to selectedRunId so effects always read the current value without
  // needing to include it in deps (avoids stale-closure bugs).
  const selectedRunIdRef = useRef(selectedRunId);
  selectedRunIdRef.current = selectedRunId;

  // ── Lazy-load pipeline runs per tab ─────────────────────────────────────────
  // Fetch runs for a specific tab type and merge into the shared pipelineRuns list.
  // This avoids loading all 50 runs up-front — each tab loads its own 20 on first open.
  const fetchRuns = (tab: PipelineTab, delay = 0) => {
    const doFetch = () =>
      apiFetch(`/pipeline/runs?type=${tab}`)
        .then(r => r.ok ? r.json() : null)
        .then((incoming: PipelineRun[] | null) => {
          if (incoming) {
            setPipelineRuns(prev => {
              const map = new Map(prev.map(r => [r.run_id, r]));
              incoming.forEach(r => map.set(r.run_id, r));
              return Array.from(map.values()).sort(
                (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
              );
            });
          }
          tabsLoadedRef.current.add(tab);
          setTabRunsLoading(false);
        })
        .catch(() => {
          tabsLoadedRef.current.add(tab);
          setTabRunsLoading(false);
        });
    if (delay > 0) setTimeout(doFetch, delay);
    else doFetch();
  };

  // Per-tab fetch tracking — which tabs have been loaded at least once.
  const tabsLoadedRef = useRef<Set<PipelineTab>>(new Set());
  const [tabRunsLoading, setTabRunsLoading] = useState(true);

  // Fetch runs for active tab on switch; show skeleton until resolved.
  const prevActiveTabRef = useRef<PipelineTab | null>(null);
  useEffect(() => {
    if (prevActiveTabRef.current !== activeTab) {
      prevActiveTabRef.current = activeTab;
      setTabRunsLoading(true);
      fetchRuns(activeTab, 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // ── Per-pipeline start detection ─────────────────────────────────────────────
  // When a pipeline starts running, immediately switch to its tab.
  const prevResearchRunningStart = useRef(researchRunning);
  const prevTradeRunningStart    = useRef(tradeRunning);
  const prevEvalRunningStart     = useRef(evalRunning);
  useEffect(() => {
    const rStarted = !prevResearchRunningStart.current && researchRunning;
    const tStarted = !prevTradeRunningStart.current    && tradeRunning;
    const eStarted = !prevEvalRunningStart.current     && evalRunning;
    prevResearchRunningStart.current = researchRunning;
    prevTradeRunningStart.current    = tradeRunning;
    prevEvalRunningStart.current     = evalRunning;

    const startedTab: PipelineTab | null = eStarted ? 'eval' : tStarted ? 'trade' : rStarted ? 'research' : null;
    if (startedTab) {
      setActiveTab(startedTab);
      setSelectedRunId(null);
      setSelectedRunEvents([]);
      setRunsPage(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [researchRunning, tradeRunning, evalRunning]);

  // ── Per-pipeline finish detection ────────────────────────────────────────────
  // When a specific pipeline finishes, switch to its tab and auto-select the run.
  const prevResearchRunning = useRef(researchRunning);
  const prevTradeRunning    = useRef(tradeRunning);
  const prevEvalRunning     = useRef(evalRunning);
  useEffect(() => {
    const rFinished = prevResearchRunning.current && !researchRunning;
    const tFinished = prevTradeRunning.current    && !tradeRunning;
    const eFinished = prevEvalRunning.current     && !evalRunning;
    prevResearchRunning.current = researchRunning;
    prevTradeRunning.current    = tradeRunning;
    prevEvalRunning.current     = evalRunning;

    const finishedTab: PipelineTab | null = eFinished ? 'eval' : tFinished ? 'trade' : rFinished ? 'research' : null;
    const finishedRunId = eFinished ? currentRunIdEval : tFinished ? currentRunIdTrade : rFinished ? currentRunIdResearch : null;

    // Don't auto-select if user already has a run open
    if (!finishedTab || !finishedRunId || selectedRunIdRef.current) return;

    // Switch to the tab that just finished
    setActiveTab(finishedTab);
    setRunsPage(0);
    setStepsExpanded(false);

    // Delay auto-select so backend has time to commit step="done" before the
    // runs-list re-fetch arrives (also delayed 1.5s).
    fetchRuns(finishedTab, 1500);
    if (autoSelectTimerRef.current) clearTimeout(autoSelectTimerRef.current);
    autoSelectTimerRef.current = setTimeout(() => {
      autoSelectTimerRef.current = null;
      // Clear stale live events so clicking the tab later shows idle, not the old run.
      clearTabEvents(finishedTab);
      if (selectedRunIdRef.current) return; // user picked something else during delay
      setSelectedRunId(finishedRunId);
      setSelectedRunEvents([]);
      setSelectedRunLoading(true);
      apiFetch(`/pipeline/runs/${finishedRunId}`)
        .then(r => r.ok ? r.json() : null)
        .then(eventsData => { if (eventsData) setSelectedRunEvents(eventsData.events ?? []); })
        .catch(() => {})
        .finally(() => setSelectedRunLoading(false));
    }, 1500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [researchRunning, tradeRunning, evalRunning]);

  const viewingLive = selectedRunId === null;
  // Live events per tab
  const liveEvents: PipelineEvent[] =
    activeTab === 'research' ? researchEvents :
    activeTab === 'trade'    ? tradeEvents :
    evalEvents;
  const panelEvents = viewingLive ? liveEvents : selectedRunEvents;


  const focusVisibleResults = tickerSearchResults.filter(r => !focusTickers.includes(r.symbol));
  const showFocusDropdown = focusSearchOpen && (tickerSearchLoading || focusVisibleResults.length > 0);

  const addFocusTicker = (sym: string) => {
    if (!focusTickers.includes(sym)) setFocusTickers(p => [...p, sym]);
    setFocusSearch(''); setFocusSearchOpen(false); setTickerSearchResults([]);
  };

  const [resolvingFocus, setResolvingFocus] = useState(false);
  const [resolvedFocusText, setResolvedFocusText] = useState('');

  const handleFindTickers = async () => {
    if (!investmentFocus.trim() || resolvingFocus) return;
    const focusText = investmentFocus.trim();
    setResolvingFocus(true);
    try {
      // Step 1: fast ticker search — strip common noise words so yfinance can match company names
      const NOISE = /\b(stock|stocks|share|shares|price|equity|ticker|invest(?:ing|ment)?|buy|sell|trade)\b/gi;
      const searchQuery = focusText.replace(NOISE, '').replace(/\s+/g, ' ').trim();
      let candidates: { symbol: string; name: string; sector: string; exchange: string; type: string }[] = [];
      try {
        const searchRes = await apiFetch(`/search/tickers?q=${encodeURIComponent(searchQuery || focusText)}`);
        if (searchRes.ok) candidates = await searchRes.json();
      } catch { /* non-fatal */ }

      // Step 2: LLM picks from candidates (1 call) — or falls back to full flow if no candidates
      const data = await apiFetch('/focus/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ focus: focusText, candidates }),
      }).then(r => r.json());

      if (data.tickers?.length) {
        setFocusTickers(() => data.tickers);
        setResolvedFocusText(focusText);
      }
    } catch { /* ignore */ } finally {
      setResolvingFocus(false);
    }
  };

  // ── Active Run View ──────────────────────────────────────────────────────────
  const renderActiveView = (events: PipelineEvent[], stepsArray: string[] = ORDERED_STEPS) => {
    const currentStep = getCurrentStep(events);
    const completedSteps = getCompletedSteps(events, stepsArray);
    const stepIndex = currentStep ? stepsArray.indexOf(currentStep) : -1;
    const totalSteps = stepsArray.length;
    const progressPct = stepIndex >= 0 ? Math.round(((stepIndex + 0.5) / totalSteps) * 100) : 0;

    const latestDetail = (step: string) => {
      const evs = [...events].reverse();
      return evs.find(e => e.step === step && e.detail)?.detail ?? '';
    };

    const activeAgents = events
      .filter(e => e.step === 'AGENT_QUERY' && e.status === 'IN_PROGRESS')
      .map(e => e.agent_name).filter(Boolean);
    const doneAgents = events
      .filter(e => e.step === 'AGENT_QUERY' && e.status === 'DONE')
      .map(e => e.agent_name)
      .filter((v, i, a) => v && a.indexOf(v) === i);

    return (
      <div className="flex-1 flex flex-col overflow-y-auto">
        {/* Progress header */}
        <div className="px-5 py-4 border-b border-borderLight" style={{ background: 'rgba(245,158,11,0.04)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="relative shrink-0">
                <span className="absolute inset-0 rounded-full bg-amber-400/20 animate-ping" />
                <span className="relative h-2 w-2 rounded-full bg-amber-400 block" />
              </div>
              <span className="text-xs font-semibold text-amber-300">
                {currentStep ? (STEP_LABELS[currentStep] ?? currentStep) : 'Starting…'}
              </span>
            </div>
            <span className="text-[10px] text-textDim font-mono tabular">{progressPct}%</span>
          </div>
          <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-surface3)' }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${progressPct}%`,
                background: 'linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)',
                boxShadow: '0 0 8px rgba(245,158,11,0.5)',
              }}
            />
          </div>
        </div>

        {/* Step list */}
        <div className="flex-1 px-4 py-3 space-y-0.5">
          {stepsArray.map(s => {
            const isDone = completedSteps.has(s);
            const isActive = s === currentStep;
            const isWarn = !isDone && events.some(e => e.step === s && e.status === 'WARN');
            const c = STEP_COLORS[s] ?? STEP_COLORS.START;
            const m = STEP_META[s];
            const detail = (isDone || isActive) ? latestDetail(s) : '';

            return (
              <div key={s}
                className="flex items-start gap-3 py-2.5 px-3 rounded-xl transition-all duration-200"
                style={isActive ? {
                  background: 'rgba(245,158,11,0.06)',
                  border: '1px solid rgba(245,158,11,0.15)',
                } : isDone ? {
                  background: 'rgba(16,185,129,0.04)',
                  border: '1px solid transparent',
                } : {
                  border: '1px solid transparent',
                }}
              >
                {/* Status dot */}
                <div className={`mt-0.5 h-6 w-6 rounded-full shrink-0 flex items-center justify-center text-[10px] border transition-all ${
                  isActive  ? `${c.ring} ${c.bg}` :
                  isDone    ? 'border-up/40 bg-up/15' :
                  isWarn    ? 'border-amber-500/40 bg-amber-500/10' :
                              'border-borderLight bg-surface3 opacity-25'
                }`}
                style={isActive ? { boxShadow: `0 0 10px rgba(245,158,11,0.3)` } : {}}>
                  {isActive
                    ? <span className={`${c.text} text-[9px] animate-spin-slow`}>◈</span>
                    : isDone
                      ? <span className="text-up text-[9px] font-bold">✓</span>
                      : isWarn
                        ? <span className="text-amber-400 text-[8px]">⚠</span>
                        : <span className={`text-textDim opacity-40 text-[9px]`}>{m?.icon ?? '·'}</span>
                  }
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-semibold ${
                      isActive ? 'text-amber-300' : isDone ? 'text-up' : isWarn ? 'text-amber-400' : 'text-textDim opacity-35'
                    }`}>
                      {STEP_LABELS[s] ?? s}
                    </span>
                    {isActive && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-medium text-amber-400/80 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full">
                        <span className="h-1 w-1 rounded-full bg-amber-400 animate-pulse" />running
                      </span>
                    )}
                    {isDone && <span className="text-[9px] text-up/50 font-medium">done</span>}
                    {isWarn && !isDone && <span className="text-[9px] text-amber-400/70 font-medium">timed out</span>}
                    {isDone && s === 'WEB_RESEARCH' && research.length > 0 && (
                      <button
                        onClick={() => setResearchStepOpen(o => !o)}
                        className="text-[9px] text-brand-400 bg-brand-900/30 border border-brand-700/30 px-1.5 py-0.5 rounded-full hover:bg-brand-800/40 transition-colors">
                        {research.length} articles {researchStepOpen ? '▲' : '▼'}
                      </button>
                    )}
                  </div>
                  {detail && (
                    <p className="text-[10px] text-textDim mt-0.5 leading-relaxed" title={detail}>
                      {detail.length > 120 ? detail.slice(0, 120) + '…' : detail}
                    </p>
                  )}
                  {/* Agent pills for AGENT_QUERY */}
                  {s === 'AGENT_QUERY' && (activeAgents.length > 0 || doneAgents.length > 0) && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {[...doneAgents, ...activeAgents].filter((v, i, a) => a.indexOf(v) === i).map(agent => {
                        const done = doneAgents.includes(agent);
                        return (
                          <span key={agent} className={`text-[9px] px-2 py-0.5 rounded-full border font-medium ${
                            done ? 'text-up bg-up/10 border-up/25' : 'text-teal-300 bg-teal-500/10 border-teal-500/25 animate-pulse'
                          }`}>
                            {done ? '✓ ' : '↻ '}{agent}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {/* Research articles inline */}
                  {s === 'WEB_RESEARCH' && isDone && researchStepOpen && research.length > 0 && (
                    <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                      {research.slice(0, 8).map((r, i) => (
                        <div key={i} className="text-[10px] text-textDim truncate">
                          <span className="opacity-30 mr-1">—</span>
                          {r.source_url && r.source_url !== 'N/A'
                            ? <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="hover:text-brand-400 transition-colors">{r.title}</a>
                            : r.title
                          }
                        </div>
                      ))}
                      {research.length > 8 && <p className="text-[10px] text-textDim opacity-40">+{research.length - 8} more</p>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {!currentStep && events.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex items-center gap-2 text-amber-400">
              <span className="text-sm animate-spin">◈</span>
              <span className="text-xs">Starting pipeline…</span>
            </div>
          </div>
        )}

        {/* LLM Interactions panel */}
        {(() => {
          const llmEvents = events.filter(e => e.step === 'LLM_CALL');
          if (llmEvents.length === 0) return null;
          return (
            <div className="mx-4 mb-4 rounded-xl border border-borderLight overflow-hidden" style={{ background: 'rgba(15,23,42,0.6)' }}>
              <button
                onClick={() => setLlmLogsOpen(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-brand-400 font-mono">◈</span>
                  <span className="text-[10px] font-semibold text-textMuted">LLM Interactions</span>
                  <span className="text-[9px] text-brand-400 bg-brand-900/40 border border-brand-700/30 px-1.5 py-0.5 rounded-full">{llmEvents.length}</span>
                </div>
                <span className="text-[9px] text-textDim font-mono">{llmLogsOpen ? '▲' : '▼'}</span>
              </button>
              {llmLogsOpen && (
                <div className="border-t border-borderLight max-h-60 overflow-y-auto">
                  {[...llmEvents].reverse().map((e, i) => {
                    // detail format: "[model] caller — N tokens → snippet…"
                    const modelMatch = e.detail?.match(/^\[([^\]]+)\]/);
                    const model = modelMatch ? modelMatch[1] : '';
                    const rest = e.detail?.replace(/^\[[^\]]+\]\s*/, '') ?? '';
                    const arrowIdx = rest.indexOf(' → ');
                    const meta = arrowIdx >= 0 ? rest.slice(0, arrowIdx) : rest;
                    const snippet = arrowIdx >= 0 ? rest.slice(arrowIdx + 3) : '';
                    return (
                      <div key={i} className="px-3 py-2 border-b border-borderLight/50 last:border-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[9px] font-mono text-brand-400/70 bg-brand-900/30 px-1.5 py-px rounded shrink-0">{model}</span>
                          <span className="text-[10px] text-textMuted truncate">{meta}</span>
                        </div>
                        {snippet && (
                          <p className="text-[9px] text-textDim leading-relaxed pl-1 opacity-70 line-clamp-2">{snippet}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    );
  };

  // ── Eval Active View ──────────────────────────────────────────────────────
  const renderEvalActiveView = (events: PipelineEvent[]) => {
    const currentStep = events.slice().reverse().find(e => e.status === 'IN_PROGRESS')?.step ?? null;
    const doneSteps = new Set(events.filter(e => e.status === 'DONE').map(e => e.step));
    const stepIndex = currentStep ? EVAL_ORDERED_STEPS.indexOf(currentStep) : -1;
    const progressPct = stepIndex >= 0 ? Math.round(((stepIndex + 0.5) / EVAL_ORDERED_STEPS.length) * 100) : 0;

    const latestDetail = (step: string) => {
      return [...events].reverse().find(e => e.step === step && e.detail)?.detail ?? '';
    };

    const agentsDone = events
      .filter(e => e.step === 'AGENT_ANALYSIS' && e.status === 'DONE' && e.agent_name)
      .map(e => e.agent_name!)
      .filter((v, i, a) => a.indexOf(v) === i);
    const agentsActive = events
      .filter(e => e.step === 'AGENT_ANALYSIS' && e.status === 'IN_PROGRESS' && e.agent_name)
      .map(e => e.agent_name!);

    return (
      <div className="flex-1 flex flex-col overflow-y-auto">
        <div className="px-5 py-4 border-b border-borderLight" style={{ background: 'rgba(139,92,246,0.04)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="relative shrink-0">
                <span className="absolute inset-0 rounded-full bg-purple-400/20 animate-ping" />
                <span className="relative h-2 w-2 rounded-full bg-purple-400 block" />
              </div>
              <span className="text-xs font-semibold text-purple-300">
                {currentStep ? (EVAL_STEP_LABELS[currentStep] ?? currentStep) : 'Starting…'}
              </span>
              <span className="text-[9px] text-purple-400/70 bg-purple-900/30 border border-purple-700/30 px-1.5 py-0.5 rounded uppercase tracking-wider">Eval</span>
            </div>
            <span className="text-[10px] text-textDim font-mono tabular">{progressPct}%</span>
          </div>
          <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-surface3)' }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${progressPct}%`,
                background: 'linear-gradient(90deg, #8b5cf6 0%, #a78bfa 100%)',
                boxShadow: '0 0 8px rgba(139,92,246,0.5)',
              }}
            />
          </div>
        </div>

        <div className="flex-1 px-4 py-3 space-y-0.5">
          {EVAL_ORDERED_STEPS.map(s => {
            const isDone = doneSteps.has(s);
            const isCurrent = s === currentStep;
            const detail = (isDone || isCurrent) ? latestDetail(s) : '';

            const stepIcon = s === 'PRICE_FETCH' ? '₿' : s === 'SCORE_STRATEGIES' ? '⚖' : s === 'POSITION_REVIEW' ? '◎' :
              s === 'AGENT_ANALYSIS' ? '◈' : s === 'DARWIN_SELECTION' ? '◉' : '·';

            return (
              <div key={s}
                className="flex items-start gap-3 py-2.5 px-3 rounded-xl transition-all duration-200"
                style={isCurrent ? {
                  background: 'rgba(139,92,246,0.06)',
                  border: '1px solid rgba(139,92,246,0.15)',
                } : isDone ? {
                  background: 'rgba(16,185,129,0.04)',
                  border: '1px solid transparent',
                } : {
                  border: '1px solid transparent',
                }}
              >
                <div className={`mt-0.5 h-6 w-6 rounded-full shrink-0 flex items-center justify-center text-[10px] border transition-all ${
                  isCurrent ? 'border-purple-500/50 bg-purple-500/10' :
                  isDone    ? 'border-up/40 bg-up/15' :
                              'border-borderLight bg-surface3 opacity-25'
                }`}
                style={isCurrent ? { boxShadow: '0 0 10px rgba(139,92,246,0.3)' } : {}}>
                  {isDone
                    ? <span className="text-up text-[9px] font-bold">✓</span>
                    : isCurrent
                      ? <span className="text-purple-400 text-[9px] animate-spin-slow">◈</span>
                      : <span className="text-textDim opacity-40 text-[9px]">{stepIcon}</span>
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-semibold ${isCurrent ? 'text-purple-300' : isDone ? 'text-up' : 'text-textDim opacity-35'}`}>
                      {EVAL_STEP_LABELS[s] ?? s}
                    </span>
                    {isCurrent && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-medium text-purple-400/80 bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.5 rounded-full">
                        <span className="h-1 w-1 rounded-full bg-purple-400 animate-pulse" />running
                      </span>
                    )}
                    {isDone && <span className="text-[9px] text-up/50 font-medium">done</span>}
                  </div>
                  {detail && (
                    <p className="text-[10px] text-textDim mt-0.5 leading-relaxed" title={detail}>
                      {detail.length > 100 ? detail.slice(0, 100) + '…' : detail}
                    </p>
                  )}
                  {s === 'AGENT_ANALYSIS' && (agentsActive.length > 0 || agentsDone.length > 0) && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {[...agentsDone, ...agentsActive].filter((v, i, a) => a.indexOf(v) === i).map(agent => {
                        const done = agentsDone.includes(agent);
                        return (
                          <span key={agent} className={`text-[9px] px-2 py-0.5 rounded-full border font-medium ${
                            done ? 'text-up bg-up/10 border-up/25' : 'text-purple-300 bg-purple-500/10 border-purple-500/25 animate-pulse'
                          }`}>
                            {done ? '✓ ' : '◈ '}{agent}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* LLM Interactions panel (eval) */}
        {(() => {
          const llmEvents = events.filter(e => e.step === 'LLM_CALL');
          if (llmEvents.length === 0) return null;
          return (
            <div className="mx-4 mb-4 rounded-xl border border-borderLight overflow-hidden" style={{ background: 'rgba(15,23,42,0.6)' }}>
              <button
                onClick={() => setLlmLogsOpen(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-purple-400 font-mono">◈</span>
                  <span className="text-[10px] font-semibold text-textMuted">LLM Interactions</span>
                  <span className="text-[9px] text-purple-400 bg-purple-900/40 border border-purple-700/30 px-1.5 py-0.5 rounded-full">{llmEvents.length}</span>
                </div>
                <span className="text-[9px] text-textDim font-mono">{llmLogsOpen ? '▲' : '▼'}</span>
              </button>
              {llmLogsOpen && (
                <div className="border-t border-borderLight max-h-60 overflow-y-auto">
                  {[...llmEvents].reverse().map((e, i) => {
                    const modelMatch = e.detail?.match(/^\[([^\]]+)\]/);
                    const model = modelMatch ? modelMatch[1] : '';
                    const rest = e.detail?.replace(/^\[[^\]]+\]\s*/, '') ?? '';
                    const arrowIdx = rest.indexOf(' → ');
                    const meta = arrowIdx >= 0 ? rest.slice(0, arrowIdx) : rest;
                    const snippet = arrowIdx >= 0 ? rest.slice(arrowIdx + 3) : '';
                    return (
                      <div key={i} className="px-3 py-2 border-b border-borderLight/50 last:border-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[9px] font-mono text-purple-400/70 bg-purple-900/30 px-1.5 py-px rounded shrink-0">{model}</span>
                          <span className="text-[10px] text-textMuted truncate">{meta}</span>
                        </div>
                        {snippet && (
                          <p className="text-[9px] text-textDim leading-relaxed pl-1 opacity-70 line-clamp-2">{snippet}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    );
  };

  // ── Eval Completed View ───────────────────────────────────────────────────
  const renderEvalCompletedView = (events: PipelineEvent[], run?: PipelineRun) => {
    const complete = run?.status === 'done' || isRunComplete(events);
    const isTerminalNonSuccess = run ? run.status === 'error' : true;
    const orphaned = !complete && (
      (isTerminalNonSuccess && events.length > 0 && events.every(e => e.status === 'IN_PROGRESS')) ||
      isStaleRun(run, events)
    );
    const errored = !complete && (run?.status === 'error' || hasError(events) || orphaned);
    const stillRunning = !complete && !errored && run != null && run.status !== 'error' && run.status !== 'done';
    const dur = getRunDuration(events);

    // Extract key data from events
    const priceFetchEvent = events.find(e => e.step === 'PRICE_FETCH' && e.status === 'DONE');
    const scoringEvent = events.find(e => e.step === 'SCORE_STRATEGIES' && e.status === 'DONE');
    const reviewEvent = events.find(e => e.step === 'POSITION_REVIEW' && e.status === 'DONE');
    const darwinEvent = events.find(e => e.step === 'DARWIN_SELECTION' && e.status === 'DONE');
    const memoryEvent = events.find(e => e.step === 'MEMORY_WRITE' && e.status === 'DONE');

    // Agent analysis events
    const analysisEvents = events.filter(e => e.step === 'AGENT_ANALYSIS' && e.status === 'DONE');
    // Darwin in-progress events (per-agent evolution)
    const darwinAgentEvents = events.filter(e => e.step === 'DARWIN_SELECTION' && e.status === 'IN_PROGRESS' && e.agent_name);

    return (
      <div className="flex-1 flex flex-col overflow-y-auto">
        {/* Outcome banner */}
        <div className="px-6 py-5 border-b border-borderLight" style={{
          background: errored ? 'rgba(239,68,68,0.05)' : stillRunning ? 'rgba(56,189,248,0.04)' : 'rgba(139,92,246,0.05)',
        }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className="h-10 w-10 rounded-2xl flex items-center justify-center text-base font-bold shrink-0"
                style={{
                  background: errored ? 'rgba(239,68,68,0.12)' : stillRunning ? 'rgba(56,189,248,0.1)' : 'rgba(139,92,246,0.12)',
                  border: `1px solid ${errored ? 'rgba(239,68,68,0.25)' : stillRunning ? 'rgba(56,189,248,0.2)' : 'rgba(139,92,246,0.25)'}`,
                  color: errored ? '#f87171' : stillRunning ? '#38bdf8' : '#a78bfa',
                }}
              >
                {errored ? '✕' : stillRunning ? '↻' : '◉'}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-semibold ${errored ? 'text-down-text' : stillRunning ? 'text-info-text' : 'text-purple-300'}`}>
                    {errored ? 'Evaluation Failed' : stillRunning ? 'Evaluation Running…' : 'Evaluation Complete'}
                  </p>
                  <span className="text-[9px] text-purple-400/70 bg-purple-900/30 border border-purple-700/30 px-1.5 py-0.5 rounded-full uppercase tracking-wider">Eval</span>
                </div>
                <p className="text-[11px] text-textDim mt-0.5">
                  {events.length} events{dur != null ? ` · ${dur}s` : ''}
                </p>
              </div>
            </div>
            <button
              onClick={() => setStepsExpanded(v => !v)}
              className="flex items-center gap-1.5 text-[11px] text-textDim hover:text-textMuted border border-borderLight bg-surface2 hover:bg-surface3 px-3 py-1.5 rounded-lg transition-colors shrink-0"
            >
              <span className="font-mono text-[9px]">{stepsExpanded ? '▲' : '▼'}</span>
              <span>{stepsExpanded ? 'Hide' : 'View'} Steps</span>
            </button>
          </div>

          {/* Step chips */}
          {!stepsExpanded && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {EVAL_ORDERED_STEPS.map(s => {
                const ran = events.some(e => e.step === s);
                const failed = events.some(e => e.step === s && e.status === 'ERROR');
                if (!ran) return (
                  <span key={s} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-borderLight text-textDim opacity-30">
                    {EVAL_STEP_LABELS[s]}
                  </span>
                );
                return (
                  <span key={s} className={`inline-flex items-center gap-1 text-[10px] px-2.5 py-0.5 rounded-full border font-medium ${
                    failed ? 'border-down/40 text-down-text bg-down-bg' : 'border-purple-500/35 text-purple-300 bg-purple-500/10'
                  }`}>
                    {EVAL_STEP_LABELS[s]}<span className="opacity-60">{failed ? ' ✕' : ' ✓'}</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Expanded step log */}
        {stepsExpanded && (
          <div className="border-b border-borderLight" style={{ background: 'var(--color-surface2)', opacity: 0.97 }}>
            <div className="divide-y divide-borderLight">
              {events.filter(ev => EVAL_ORDERED_STEPS.includes(ev.step)).map((ev, idx) => {
                const timeStr = new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const label = EVAL_STEP_LABELS[ev.step] ?? ev.step;
                const hasLaterEvalResolution = ev.status === 'IN_PROGRESS' && events.slice(idx + 1).some(e => e.step === ev.step && (e.status === 'DONE' || e.status === 'WARN' || e.status === 'ERROR'));
                const evalDisplayStatus = ev.status === 'IN_PROGRESS' && !hasLaterEvalResolution
                  ? ((hasError(events) || errored) ? 'ERROR' : 'DONE')
                  : ev.status === 'IN_PROGRESS' && hasLaterEvalResolution ? 'DONE' : ev.status;
                return (
                  <div key={ev.id} className="px-5 py-3 flex items-start gap-4 hover:bg-surface3/30 transition-colors">
                    <div className={`mt-0.5 shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold border ${
                      evalDisplayStatus === 'ERROR' ? 'bg-down-bg border-down/40 text-down-text' :
                      evalDisplayStatus === 'DONE'  ? 'bg-up/12 border-up/40 text-up' :
                                                      'bg-purple-500/10 border-purple-500/30 text-purple-400'
                    }`}>
                      {evalDisplayStatus === 'DONE' ? '✓' : evalDisplayStatus === 'ERROR' ? '✕' : '↻'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-semibold text-textMain">{label}</span>
                          {ev.agent_name && (
                            <span className="text-[9px] px-2 py-0.5 rounded-full font-medium text-purple-300 bg-purple-900/30 border border-purple-700/30">{ev.agent_name}</span>
                          )}
                        </div>
                        <span className="text-[10px] text-textDim font-mono shrink-0 tabular">{timeStr}</span>
                      </div>
                      {ev.detail && <p className="text-[11px] text-textDim leading-relaxed">{ev.detail}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Summary cards */}
        <div className="px-5 py-4 space-y-3">
          {/* Price & Score summary */}
          {(priceFetchEvent || scoringEvent) && (
            <div className="rounded-2xl border border-borderLight bg-surface2 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-borderLight flex items-center gap-2" style={{ background: 'var(--color-surface3)' }}>
                <span className="text-[10px] font-bold uppercase tracking-widest text-textDim">Position Scoring</span>
              </div>
              <div className="px-4 py-3 space-y-1.5">
                {priceFetchEvent?.detail && <p className="text-[11px] text-textMuted">{priceFetchEvent.detail}</p>}
                {scoringEvent?.detail && (
                  <div className="mt-1.5 rounded-xl border border-borderLight bg-surface3/50 px-3 py-2">
                    {scoringEvent.detail.split('\n').map((line, i) => (
                      <p key={i} className="text-[11px] text-textDim font-mono leading-relaxed">{line}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Position review summary */}
          {reviewEvent && (
            <div className="rounded-2xl border border-borderLight bg-surface2 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-borderLight" style={{ background: 'var(--color-surface3)' }}>
                <span className="text-[10px] font-bold uppercase tracking-widest text-textDim">Position Review</span>
              </div>
              <div className="px-4 py-3">
                <p className="text-[11px] text-textMuted leading-relaxed">{reviewEvent.detail}</p>
              </div>
            </div>
          )}

          {/* Agent post-mortems */}
          {analysisEvents.length > 0 && (
            <div className="rounded-2xl border border-borderLight bg-surface2 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-borderLight flex items-center gap-2" style={{ background: 'var(--color-surface3)' }}>
                <span className="text-[10px] font-bold uppercase tracking-widest text-textDim">Post-Mortem Analysis</span>
                <span className="text-[10px] text-textDim bg-surface2 border border-borderLight px-1.5 py-0.5 rounded-full">{analysisEvents.length}</span>
              </div>
              <div className="divide-y divide-borderLight">
                {analysisEvents.map(ev => (
                  <div key={ev.id} className="px-4 py-3">
                    {ev.agent_name && (
                      <span className="inline-block text-[9px] font-bold px-2 py-0.5 rounded-full bg-purple-900/40 border border-purple-700/40 text-purple-300 mb-2">{ev.agent_name}</span>
                    )}
                    {ev.detail && <p className="text-[11px] text-textMuted leading-relaxed">{ev.detail}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Darwin evolution */}
          {(darwinEvent || darwinAgentEvents.length > 0) && (() => {
            // Build per-agent evolution summary from events
            // "evolved → generation N via REASON" events
            const evolvedEvents = darwinAgentEvents.filter(e => e.detail && e.detail.includes('evolved') && e.detail.includes('generation'));
            // "fitness=X → MUTATION/CROSSOVER" events
            const mutationEvents = darwinAgentEvents.filter(e => e.detail && (e.detail.includes('MUTATION') || e.detail.includes('CROSSOVER')) && !e.detail.includes('evolved'));
            // "fitness X acceptable" events
            const stableEvents = darwinAgentEvents.filter(e => e.detail && e.detail.includes('acceptable'));
            // "Fitness: agent1: X | agent2: Y" event
            const fitnessEvent = darwinAgentEvents.find(e => e.detail && e.detail.startsWith('Fitness:'));

            return (
              <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(139,92,246,0.2)', background: 'rgba(139,92,246,0.04)' }}>
                <div className="px-4 py-2.5 border-b flex items-center justify-between gap-2" style={{ borderColor: 'rgba(139,92,246,0.15)', background: 'rgba(139,92,246,0.08)' }}>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-purple-400/80">Agent Evolution</span>
                  {evolvedEvents.length > 0 && (
                    <span className="text-[10px] text-purple-300 bg-purple-500/15 border border-purple-500/25 px-2 py-0.5 rounded-full font-medium">
                      {evolvedEvents.length} evolved
                    </span>
                  )}
                </div>
                <div className="divide-y" style={{ borderColor: 'rgba(139,92,246,0.1)' }}>
                  {/* Evolved agents — show prominently */}
                  {evolvedEvents.map(ev => {
                    const genMatch = ev.detail?.match(/generation\s+(\d+)/i);
                    const viaMatch = ev.detail?.match(/via\s+(\S+)/i);
                    // Find the matching mutation event for this agent to get fitness score
                    const mutEv = mutationEvents.find(m => m.agent_name === ev.agent_name);
                    const fitnessMatch = mutEv?.detail?.match(/fitness[=\s]+([\d.]+)/i);
                    return (
                      <div key={ev.id} className="px-4 py-3 flex items-start gap-3">
                        <div className="h-6 w-6 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                          style={{ background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.35)' }}>
                          <span className="text-purple-300 text-[9px] font-bold">↑</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {ev.agent_name && <span className="text-[11px] font-semibold text-purple-300">{ev.agent_name}</span>}
                            {viaMatch && (
                              <span className="text-[9px] px-2 py-0.5 rounded-full border font-medium text-purple-400 bg-purple-500/10 border-purple-500/25">
                                {viaMatch[1].replace('_', ' ')}
                              </span>
                            )}
                            {genMatch && <span className="text-[9px] text-textDim">gen {genMatch[1]}</span>}
                            {fitnessMatch && <span className="text-[9px] text-textDim">fitness {fitnessMatch[1]}</span>}
                          </div>
                          {mutEv?.detail && (
                            <p className="text-[10px] text-textDim mt-0.5 leading-relaxed">{mutEv.detail}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {/* Stable agents */}
                  {stableEvents.map(ev => {
                    const fitnessMatch = ev.detail?.match(/fitness\s+([\d.]+)/i);
                    return (
                      <div key={ev.id} className="px-4 py-2.5 flex items-center gap-3">
                        <div className="h-6 w-6 rounded-full flex items-center justify-center shrink-0"
                          style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                          <span className="text-up text-[9px] font-bold">✓</span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {ev.agent_name && <span className="text-[11px] font-semibold text-textMuted">{ev.agent_name}</span>}
                          <span className="text-[9px] text-up/70">no evolution needed</span>
                          {fitnessMatch && <span className="text-[9px] text-textDim">fitness {fitnessMatch[1]}</span>}
                        </div>
                      </div>
                    );
                  })}
                  {/* Fitness scores summary */}
                  {fitnessEvent && (
                    <div className="px-4 py-2.5">
                      <p className="text-[10px] text-textDim font-mono leading-relaxed">
                        {fitnessEvent.detail}
                      </p>
                    </div>
                  )}
                  {/* Overall summary */}
                  {darwinEvent && (
                    <div className="px-4 py-2.5">
                      <p className="text-[11px] text-textMuted">{darwinEvent.detail}</p>
                    </div>
                  )}
                  {evolvedEvents.length === 0 && stableEvents.length === 0 && !darwinEvent && (
                    <div className="px-4 py-3">
                      <p className="text-[11px] text-textDim italic">No agents evolved this run.</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {memoryEvent && (
            <div className="rounded-2xl border border-borderLight bg-surface2 px-4 py-3">
              <p className="text-[11px] text-textMuted leading-relaxed">{memoryEvent.detail}</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Completed / Past Run View ─────────────────────────────────────────────
  const renderCompletedView = (events: PipelineEvent[], run?: PipelineRun, stepsArray: string[] = ORDERED_STEPS) => {
    // Use run.status as the authoritative signal — events may be incomplete if
    // the Vercel function timed out before the final MEMORY_WRITE DONE log.
    const complete = run?.status === 'done' || isRunComplete(events, stepsArray);
    // Show as orphaned if: run is in a terminal non-success state with all-IN_PROGRESS events,
    // OR the run has been stuck "running" with no new events for > 10 minutes.
    const isTerminalNonSuccess = run ? run.status === 'error' : true;
    const orphaned = !complete && (
      (isTerminalNonSuccess && events.length > 0 && events.every(e => e.status === 'IN_PROGRESS')) ||
      isStaleRun(run, events)
    );
    const errored = !complete && (run?.status === 'error' || hasError(events) || orphaned);
    // A run is still in progress if its DB step is not a terminal state
    const stillRunning = !complete && !errored && run != null && run.status !== 'error' && run.status !== 'done';
    const wasStopped = !errored && !complete && !stillRunning;
    const dur = getRunDuration(events);
    const errorEvent = events.find(e => e.status === 'ERROR');

    // Run output data
    const out = run?.output;
    const positions = out
      ? (out.positions ?? (out.ticker ? [{ ticker: out.ticker, action: out.action, reasoning: out.judge_reasoning, strategy_id: out.strategy_id }] : []))
      : [];
    const visibleProposals = out
      ? out.proposals.filter((p: { ticker: string }) => {
          const m = getMarketForTicker(p.ticker);
          return enabledMarketNames.length === 0 || enabledMarketNames.includes(m);
        })
      : [];
    const hiddenCount = out ? out.proposals.length - visibleProposals.length : 0;

    // For live completed view (no run object), look at research
    const showResearchToggle = !run && research.length > 0;

    // Research pipeline result data
    const isResearchPipeline = stepsArray === RESEARCH_ORDERED_STEPS || (stepsArray.includes('WEB_RESEARCH') && !stepsArray.includes('JUDGE'));
    const kgIngestDoneEvent = events.find(e => e.step === 'KG_INGEST' && e.status === 'DONE');
    const webResearchDoneEvent = events.find(e => e.step === 'WEB_RESEARCH' && e.status === 'DONE');

    return (
      <div className="flex-1 flex flex-col overflow-y-auto">
        {/* ── Outcome banner ─────────────────────────────────────────────── */}
        <div className="px-6 py-5 border-b border-borderLight" style={{
          background: errored      ? 'rgba(239,68,68,0.05)'    :
                      stillRunning ? 'rgba(56,189,248,0.04)'   :
                      wasStopped   ? 'rgba(245,158,11,0.05)'   :
                                     'rgba(16,185,129,0.05)',
        }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className="h-10 w-10 rounded-2xl flex items-center justify-center text-base font-bold shrink-0"
                style={{
                  background: errored      ? 'rgba(239,68,68,0.12)'    :
                               stillRunning ? 'rgba(56,189,248,0.1)'    :
                               wasStopped   ? 'rgba(245,158,11,0.12)'   :
                                              'rgba(16,185,129,0.12)',
                  border: `1px solid ${
                    errored      ? 'rgba(239,68,68,0.25)'    :
                    stillRunning ? 'rgba(56,189,248,0.2)'    :
                    wasStopped   ? 'rgba(245,158,11,0.25)'   :
                                   'rgba(16,185,129,0.25)'
                  }`,
                  color: errored ? '#f87171' : stillRunning ? '#38bdf8' : wasStopped ? '#fbbf24' : '#34d399',
                  boxShadow: errored ? '0 0 16px rgba(239,68,68,0.12)' :
                             !errored && !stillRunning && !wasStopped ? '0 0 16px rgba(16,185,129,0.12)' : 'none',
                }}
              >
                {errored ? '✕' : stillRunning ? '↻' : wasStopped ? '⏹' : '✓'}
              </div>
              <div>
                <p className={`text-sm font-semibold ${errored ? 'text-down-text' : stillRunning ? 'text-info-text' : wasStopped ? 'text-warning-text' : 'text-up'}`}>
                  {errored ? 'Pipeline Failed' : stillRunning ? 'Pipeline Running…' : wasStopped ? 'Pipeline Stopped' : 'Pipeline Complete'}
                </p>
                {errored && (() => {
                  const stuckEvent = !errorEvent ? events.filter(e => e.status === 'IN_PROGRESS').slice(-1)[0] : null;
                  const displayEvent = errorEvent ?? stuckEvent;
                  return displayEvent ? (
                    <p className="text-[11px] text-textDim mt-0.5">
                      {errorEvent ? 'Failed at' : 'Stuck at'}{' '}
                      <span className="text-down-text font-medium">{STEP_META[displayEvent.step]?.label ?? displayEvent.step}</span>
                      {displayEvent.detail && <span className="opacity-60"> — {displayEvent.detail.slice(0, 100)}{displayEvent.detail.length > 100 ? '…' : ''}</span>}
                    </p>
                  ) : null;
                })()}
                {!errored && (
                  <p className="text-[11px] text-textDim mt-0.5">
                    {events.length} events{dur != null ? ` · ${dur}s` : ''}
                    {positions.length > 0 && ` · ${positions.length} position${positions.length !== 1 ? 's' : ''} deployed`}
                  </p>
                )}
              </div>
            </div>

            <div className="shrink-0 flex items-center gap-2">
              {/* Resume button */}
              {(errored || wasStopped) && run && run.run_id && (
                <button
                  onClick={() => {
                    apiFetch(`/pipeline/resume/${run.run_id}`, { method: 'POST' })
                      .then(r => r.ok ? r.json() : null)
                      .then(d => { if (d) { setSelectedRunId(null); } });
                  }}
                  className="flex items-center gap-1.5 text-[11px] font-semibold border border-brand-500/40 bg-brand-600/10 text-brand-400 hover:bg-brand-600/20 px-3 py-1.5 rounded-lg transition-colors btn-lift"
                >
                  ↻ Resume
                </button>
              )}
              {/* Expandable steps toggle */}
              <button
                onClick={() => setStepsExpanded(v => !v)}
                className="flex items-center gap-1.5 text-[11px] text-textDim hover:text-textMuted border border-borderLight bg-surface2 hover:bg-surface3 px-3 py-1.5 rounded-lg transition-colors"
              >
                <span className="font-mono text-[9px]">{stepsExpanded ? '▲' : '▼'}</span>
                <span>{stepsExpanded ? 'Hide' : 'View'} Steps</span>
              </button>
            </div>
          </div>

          {/* Step summary chips */}
          {!stepsExpanded && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {stepsArray.map(s => {
                const ran = events.some(e => e.step === s);
                const hasExplicitError = events.some(e => e.step === s && e.status === 'ERROR');
                const hasOrphanedInProgress = errored && events.some(e => e.step === s && e.status === 'IN_PROGRESS') && !events.some(e => e.step === s && (e.status === 'DONE' || e.status === 'WARN' || e.status === 'ERROR'));
                const failed = hasExplicitError || hasOrphanedInProgress;
                const warned = !failed && events.some(e => e.step === s && e.status === 'WARN');
                const skipped = ran && !failed && !warned && !events.some(e => e.step === s && (e.status === 'DONE' || e.status === 'IN_PROGRESS'));
                const c = STEP_COLORS[s] ?? STEP_COLORS.START;
                const m = STEP_META[s];
                if (!ran) {
                  // On a successfully completed run, hide steps that never logged any event
                  // (they were skipped by the pipeline, e.g. JUDGE/DEPLOY when no trade was made).
                  if (complete && !errored) return null;
                  return (
                    <span key={s} className="inline-flex items-center gap-1 text-[10px] px-2.5 py-0.5 rounded-full border border-borderLight text-textDim opacity-25">
                      <span>{m?.icon}</span><span>{STEP_LABELS[s]}</span>
                    </span>
                  );
                }
                return (
                  <span key={s} className={`inline-flex items-center gap-1 text-[10px] px-2.5 py-0.5 rounded-full border font-medium ${
                    failed  ? 'border-down/40 text-down-text bg-down-bg' :
                    warned  ? 'border-warning/40 text-warning bg-warning-bg' :
                    skipped ? 'border-borderMid text-textDim bg-surface3' :
                              `${c.ring} ${c.text} ${c.bg}`
                  }`}>
                    <span>{m?.icon}</span>
                    <span>{STEP_LABELS[s]}</span>
                    <span className="opacity-50">{failed ? '✕' : warned ? '⚠' : skipped ? '—' : '✓'}</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Expanded step log ────────────────────────────────────────────── */}
        {stepsExpanded && (
          <div className="border-b border-borderLight" style={{ background: 'var(--color-surface2)' }}>
            <div className="relative">
              <div className="absolute left-[29px] top-0 bottom-0 w-px" style={{ background: 'var(--color-borderLight)', opacity: 0.6 }} />
              <div className="divide-y divide-borderLight">
                {events.filter(ev => stepsArray.includes(ev.step)).map((ev, idx) => {
                  const meta = STEP_META[ev.step] ?? { icon: '·', label: ev.step, color: 'text-textMuted' };
                  const isAgentQuery = ev.step === 'AGENT_QUERY';
                  const hasLaterResolution = ev.status === 'IN_PROGRESS' && events.slice(idx + 1).some(e => e.step === ev.step && (e.status === 'DONE' || e.status === 'WARN' || e.status === 'ERROR'));
                  let displayStatus = ev.status;
                  if (ev.status === 'IN_PROGRESS' && hasLaterResolution) displayStatus = 'DONE';
                  if (ev.status === 'IN_PROGRESS' && !hasLaterResolution) {
                    displayStatus = (hasError(events) || errored) ? 'ERROR' : 'DONE';
                  }
                  const c = STEP_COLORS[ev.step] ?? STEP_COLORS.START;
                  const timeStr = new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

                  return (
                    <div key={ev.id} className="hover:bg-surface3/20 transition-colors">
                      <div className={`flex items-start gap-4 ${isAgentQuery ? 'pl-10 pr-5 py-2.5' : 'px-5 py-3'}`}>
                        <div className="relative z-10 shrink-0">
                          <div className={`h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-bold border-2 ${
                            displayStatus === 'ERROR' ? 'bg-down-bg border-down/40' :
                            displayStatus === 'WARN'  ? 'bg-amber-500/12 border-amber-500/40' :
                            displayStatus === 'DONE'  ? 'bg-up/12 border-up/40' :
                                                        'bg-surface3 border-borderMid'
                          }`}>
                            <span className={`text-xs ${displayStatus === 'ERROR' ? 'text-down-text' : displayStatus === 'WARN' ? 'text-amber-400' : displayStatus === 'DONE' ? 'text-up' : c.text}`}>
                              {displayStatus === 'DONE' ? '✓' : displayStatus === 'WARN' ? '⚠' : meta.icon}
                            </span>
                          </div>
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-xs font-semibold ${c.text}`}>{meta.label}</span>
                              {ev.agent_name && (
                                <span className="text-[9px] px-2 py-0.5 rounded-full font-medium text-teal-300 bg-teal-900/30 border border-teal-700/30">{ev.agent_name}</span>
                              )}
                              {displayStatus === 'ERROR' && (
                                <span className="text-[9px] text-down-text bg-down-bg border border-down/20 px-1.5 py-0.5 rounded-full font-semibold">ERROR</span>
                              )}
                              {showResearchToggle && ev.step === 'WEB_RESEARCH' && displayStatus === 'DONE' && (
                                <button
                                  onClick={() => setResearchStepOpen(o => !o)}
                                  className="text-[9px] text-brand-400 bg-brand-900/30 border border-brand-700/30 px-2 py-0.5 rounded-full hover:bg-brand-800/40 transition-colors">
                                  {research.length} articles {researchStepOpen ? '▲' : '▼'}
                                </button>
                              )}
                            </div>
                            <span className="text-[10px] text-textDim font-mono shrink-0 tabular">{timeStr}</span>
                          </div>
                          {ev.detail && <p className="text-[11px] text-textDim leading-relaxed">{ev.detail}</p>}
                        </div>
                      </div>
                      {/* Inline research articles */}
                      {showResearchToggle && ev.step === 'WEB_RESEARCH' && displayStatus === 'DONE' && researchStepOpen && research.length > 0 && (
                        <div className="ml-16 mr-5 mb-3 rounded-xl border border-borderLight overflow-hidden" style={{ background: 'var(--color-surface2)' }}>
                          {research.map((r) => {
                            let domain = '';
                            try { domain = new URL(r.source_url).hostname.replace('www.', ''); } catch { /* invalid */ }
                            return (
                              <div key={r.id} className="p-3 hover:bg-surface3/50 transition-colors group border-b border-borderLight last:border-0">
                                <a href={r.source_url} target="_blank" rel="noreferrer" className="block mb-1">
                                  <p className="text-xs font-semibold text-textMain group-hover:text-brand-400 leading-snug transition-colors line-clamp-2">{r.title}</p>
                                  {domain && <p className="text-[10px] text-brand-500/80 mt-0.5">{domain} ↗</p>}
                                </a>
                                <p className="text-[11px] text-textMuted line-clamp-2 leading-relaxed">{r.snippet}</p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Results: Positions ───────────────────────────────────────────── */}
        {positions.length > 0 && (
          <div className="px-5 pt-5 pb-1">
            <div className="rounded-2xl border border-borderLight bg-surface2 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-borderLight flex items-center gap-2" style={{ background: 'var(--color-surface3)' }}>
                <span className="text-[10px] font-bold uppercase tracking-widest text-textDim">Deployed Positions</span>
                <span className="text-[10px] text-textDim bg-surface2 border border-borderLight px-1.5 py-0.5 rounded-full">{positions.length}</span>
              </div>
              <div className="divide-y divide-borderLight">
                {positions.map((pos, i: number) => {
                  const market = getMarketForTicker(pos.ticker);
                  const marketEnabled = enabledMarketNames.length === 0 || enabledMarketNames.includes(market);
                  return (
                    <div key={i} className="px-4 py-4">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-base font-bold font-mono text-textMain">{pos.ticker}</span>
                          <span
                            className="text-[10px] font-bold px-2.5 py-0.5 rounded-lg"
                            style={pos.action === 'LONG'
                              ? { background: 'rgba(16,185,129,0.12)', color: '#34d399', border: '1px solid rgba(16,185,129,0.25)' }
                              : pos.action === 'SHORT'
                              ? { background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }
                              : { background: 'var(--color-info-bg)', color: 'var(--color-info-text)', border: '1px solid rgba(56,189,248,0.2)' }
                            }
                          >
                            {pos.action}
                          </span>
                          <span className="text-[9px] text-textDim bg-surface3 border border-borderLight px-1.5 py-0.5 rounded-full">{market}</span>
                          {!marketEnabled && (
                            <span className="text-[9px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full">market disabled</span>
                          )}
                        </div>
                        {pos.strategy_id != null && (
                          <button
                            onClick={() => openReport(pos.strategy_id!)}
                            className="shrink-0 flex items-center gap-1.5 text-[10px] font-semibold text-brand-400 hover:text-brand-300 border border-brand-700/40 bg-brand-900/20 hover:bg-brand-900/30 px-2.5 py-1 rounded-lg transition-colors btn-lift"
                          >
                            ◈ Report
                          </button>
                        )}
                      </div>
                      {(pos.horizon || pos.size || pos.target || pos.stop) && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2.5">
                          {pos.horizon && <span className="text-[10px] text-textDim"><span className="text-textMuted font-semibold">Horizon</span> {pos.horizon}</span>}
                          {pos.size    && <span className="text-[10px] text-textDim"><span className="text-textMuted font-semibold">Size</span> {pos.size}</span>}
                          {pos.target  && <span className="text-[10px] text-up"><span className="text-textMuted font-semibold">Target</span> {pos.target}</span>}
                          {pos.stop    && <span className="text-[10px] text-down-text"><span className="text-textMuted font-semibold">Stop</span> {pos.stop}</span>}
                        </div>
                      )}
                      {pos.reasoning && (
                        <p className="text-[11px] text-textMuted leading-relaxed line-clamp-3">{pos.reasoning}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Results: Agent Proposals ──────────────────────────────────────── */}
        {visibleProposals.length > 0 && (
          <div className="px-5 pt-3 pb-5">
            <div className="rounded-2xl border border-borderLight bg-surface2 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-borderLight flex items-center gap-2" style={{ background: 'var(--color-surface3)' }}>
                <span className="text-[10px] font-bold uppercase tracking-widest text-textDim">Agent Proposals</span>
                <span className="text-[10px] text-textDim bg-surface2 border border-borderLight px-1.5 py-0.5 rounded-full">{visibleProposals.length}</span>
              </div>
              <div className="divide-y divide-borderLight">
                {visibleProposals.map((p: { agent_name: string; ticker: string; action: string; reasoning?: string }, i: number) => {
                  const pMarket = getMarketForTicker(p.ticker);
                  return (
                    <div key={i} className="px-4 py-3 flex items-start gap-3">
                      <span
                        className="shrink-0 mt-0.5 text-[9px] font-bold px-2 py-0.5 rounded-full border"
                        style={p.action === 'LONG'
                          ? { background: 'rgba(16,185,129,0.1)', color: '#34d399', borderColor: 'rgba(16,185,129,0.2)' }
                          : p.action === 'SHORT'
                          ? { background: 'rgba(239,68,68,0.1)', color: '#f87171', borderColor: 'rgba(239,68,68,0.2)' }
                          : { background: 'var(--color-info-bg)', color: 'var(--color-info-text)', borderColor: 'rgba(56,189,248,0.2)' }
                        }
                      >
                        {p.action}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <span className="text-[11px] font-semibold text-textMain">{p.agent_name}</span>
                          <span className="text-[10px] font-mono font-semibold text-brand-400">{p.ticker}</span>
                          <span className="text-[9px] text-textDim bg-surface3 border border-borderLight px-1.5 py-0.5 rounded-full">{pMarket}</span>
                        </div>
                        {p.reasoning && <p className="text-[10px] text-textDim leading-relaxed line-clamp-2">{p.reasoning}</p>}
                      </div>
                    </div>
                  );
                })}
                {hiddenCount > 0 && (
                  <div className="px-4 py-2.5 text-[10px] text-textDim text-center border-t border-borderLight">
                    {hiddenCount} proposal{hiddenCount > 1 ? 's' : ''} from disabled markets hidden
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Research pipeline result cards ───────────────────────────────── */}
        {isResearchPipeline && (kgIngestDoneEvent || webResearchDoneEvent) && (
          <div className="px-5 pt-5 pb-5 space-y-3">
            {webResearchDoneEvent && (
              <div className="rounded-2xl border border-borderLight bg-surface2 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-borderLight flex items-center gap-2" style={{ background: 'var(--color-surface3)' }}>
                  <span className="text-[10px]">◎</span>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-textDim">Articles Collected</span>
                </div>
                <div className="px-4 py-3">
                  <p className="text-[12px] text-textMuted leading-relaxed">{webResearchDoneEvent.detail}</p>
                </div>
              </div>
            )}
            {kgIngestDoneEvent && (
              <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(6,182,212,0.2)', background: 'rgba(6,182,212,0.02)' }}>
                <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: 'rgba(6,182,212,0.15)', background: 'rgba(6,182,212,0.06)' }}>
                  <span className="text-[10px] text-cyan-400">◈</span>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400/80">Knowledge Graph Updated</span>
                </div>
                <div className="px-4 py-3">
                  {(() => {
                    const detail = kgIngestDoneEvent.detail ?? '';
                    // Parse "N nodes · M edges added — relation types: ..." format
                    const nodesMatch = detail.match(/(\d+)\s*nodes/);
                    const edgesMatch = detail.match(/(\d+)\s*edges/);
                    const relMatch = detail.match(/relation types?:\s*(.+)/);
                    if (nodesMatch || edgesMatch) {
                      return (
                        <div className="space-y-2">
                          <div className="flex gap-4">
                            {nodesMatch && (
                              <div className="flex items-center gap-2">
                                <span className="text-lg font-bold font-mono text-cyan-300">{nodesMatch[1]}</span>
                                <span className="text-[10px] text-textDim">nodes added</span>
                              </div>
                            )}
                            {edgesMatch && (
                              <div className="flex items-center gap-2">
                                <span className="text-lg font-bold font-mono text-cyan-300">{edgesMatch[1]}</span>
                                <span className="text-[10px] text-textDim">edges added</span>
                              </div>
                            )}
                          </div>
                          {relMatch && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {relMatch[1].split(',').map(r => r.trim()).filter(Boolean).map((rel, i) => (
                                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full border font-mono text-cyan-300/80 bg-cyan-500/10 border-cyan-500/20">
                                  {rel}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    }
                    return <p className="text-[12px] text-textMuted">{detail}</p>;
                  })()}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {positions.length === 0 && visibleProposals.length === 0 && !isResearchPipeline && (
          <div className="flex-1 flex flex-col items-center justify-center px-8 py-12 text-center">
            <p className="text-sm text-textMuted">
              {errored ? 'Pipeline did not produce results.' : wasStopped ? 'Pipeline was stopped before completing.' : 'No results to display.'}
            </p>
          </div>
        )}
        {isResearchPipeline && !kgIngestDoneEvent && !webResearchDoneEvent && (
          <div className="flex-1 flex flex-col items-center justify-center px-8 py-12 text-center">
            <p className="text-sm text-textMuted">
              {errored ? 'Pipeline did not produce results.' : wasStopped ? 'Pipeline was stopped before completing.' : 'No results to display.'}
            </p>
          </div>
        )}
      </div>
    );
  };

  // ── Per-tab idle step definitions ────────────────────────────────────────
  const TAB_IDLE_STEPS: Record<PipelineTab, { step: string; label: string; desc: string }[]> = {
    research: [
      { step: 'START',        label: 'Initialise',             desc: 'Acquire lock and set up the run' },
      { step: 'WEB_RESEARCH', label: 'Fetch News & Prices',    desc: 'Scrape RSS feeds, Google News, and Yahoo Finance for all enabled markets' },
      { step: 'KG_INGEST',    label: 'Enrich Knowledge Graph', desc: 'LLM extracts EVENT nodes and relationships from research into the KG' },
      { step: 'MEMORY_WRITE', label: 'Cache Research',         desc: 'Store research context for the next trade generation run' },
    ],
    trade: [
      { step: 'START',        label: 'Initialise',             desc: 'Acquire lock and load last research context' },
      { step: 'DEBATE_PANEL', label: 'Brief Agents',           desc: 'Spin up all specialist agents with shared research + KG context' },
      { step: 'AGENT_QUERY',  label: 'Agents Deliberate',      desc: 'Value Investor · Technical Analyst · Macro Economist · Sentiment Analyst propose tickers' },
      { step: 'JUDGE',        label: 'Judge Evaluates',        desc: 'Independent LLM reviews all proposals and picks the best trade' },
      { step: 'DEPLOY',       label: 'Deploy Strategy',        desc: 'Save strategy with entry price, position sizing, and report' },
      { step: 'MEMORY_WRITE', label: 'Write Agent Memories',   desc: 'Record outcome context into each agent\'s persistent memory' },
    ],
    eval: [
      { step: 'START',            label: 'Initialise',           desc: 'Acquire lock and load active strategies' },
      { step: 'PRICE_FETCH',      label: 'Fetch Live Prices',    desc: 'Pull current market prices for all open positions' },
      { step: 'SCORE_STRATEGIES', label: 'Score Strategies',     desc: 'Compute P&L, win rate, and fitness for each agent\'s predictions' },
      { step: 'POSITION_REVIEW',  label: 'Review Positions',     desc: 'LLM reviews each open position\'s live thesis and interim P&L' },
      { step: 'AGENT_ANALYSIS',   label: 'Agent Analysis',       desc: 'Per-agent LLM insight on what is working, what needs adjusting' },
      { step: 'DARWIN_SELECTION', label: 'Evolve Agents',        desc: 'Underperforming agents get their prompts mutated via Darwin selection' },
      { step: 'MEMORY_WRITE',     label: 'Write Lessons',        desc: 'Store LESSON and STRATEGY_RESULT notes to agent memory' },
    ],
  };

  // ── Idle / Blueprint View ────────────────────────────────────────────────
  const renderIdleView = () => {
    const steps = TAB_IDLE_STEPS[activeTab];
    const tab = TAB_CONFIG.find(t => t.id === activeTab)!;
    return (
      <div className="flex-1 flex flex-col items-center justify-start px-8 pt-10 pb-10">
        <div className="w-full max-w-xs">
          <p className={`text-[10px] font-bold uppercase tracking-widest mb-5 text-center ${tab.color} opacity-70 flex items-center justify-center gap-1.5`}>
            <TabIcon id={tab.id} className="w-3.5 h-3.5 inline-block" />{tab.label}
          </p>
          <div className="relative">
            <div className="absolute left-[13px] top-3 bottom-3 w-px" style={{ background: 'var(--color-borderLight)', opacity: 0.5 }} />
            <div className="space-y-1">
              {steps.map((s, i) => {
                const c = STEP_COLORS[s.step] ?? STEP_COLORS.START;
                const m = STEP_META[s.step];
                return (
                  <div key={i} className="flex items-start gap-3.5 py-2 px-2 rounded-xl transition-colors hover:bg-surface2/60"
                    style={{ animationDelay: `${i * 0.05}s` }}>
                    <div className="relative z-10 shrink-0 h-7 w-7 rounded-full flex items-center justify-center border"
                      style={{ background: 'var(--color-surface3)', borderColor: 'var(--color-borderMid)' }}>
                      <span className={`text-[10px] ${c.text} opacity-40`}>{m?.icon ?? '·'}</span>
                    </div>
                    <div className="pt-0.5">
                      <p className="text-xs font-semibold text-textMuted">{s.label}</p>
                      <p className="text-[10px] text-textDim mt-0.5 leading-relaxed">{s.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderLoadingSkeleton = () => {
    const steps = activeTab === 'eval' ? EVAL_ORDERED_STEPS
      : activeTab === 'research' ? RESEARCH_ORDERED_STEPS
      : TRADE_ORDERED_STEPS;
    const labels = activeTab === 'eval' ? EVAL_STEP_LABELS : STEP_LABELS;
    return (
      <div className="flex-1 flex flex-col overflow-y-auto">
        {/* Header banner */}
        <div className="px-6 py-5 border-b border-borderLight" style={{ background: 'var(--color-surface2)', opacity: 0.8 }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl shrink-0 shimmer" />
              <div className="space-y-2">
                <div className="h-3.5 shimmer rounded-lg w-36" />
                <div className="h-2.5 shimmer rounded-lg w-24" />
              </div>
            </div>
            <div className="h-7 w-24 rounded-lg shimmer shrink-0" />
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {steps.map(s => (
              <span key={s} className="inline-flex items-center text-[10px] px-2.5 py-1 rounded-full shimmer text-transparent select-none border border-transparent">
                {labels[s] ?? s}
              </span>
            ))}
          </div>
        </div>
        {/* Event rows */}
        <div className="px-5 py-4 space-y-3.5">
          {steps.map((s, i) => (
            <div key={s} className="flex items-start gap-3" style={{ opacity: 1 - i * 0.08 }}>
              <div className="h-7 w-7 rounded-full shimmer shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1.5 pt-0.5">
                <div className="h-3 shimmer rounded-lg" style={{ width: `${40 + (i % 3) * 15}%` }} />
                <div className="h-2.5 shimmer rounded-lg" style={{ width: `${55 + (i % 4) * 10}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ── Stale events re-fetch ─────────────────────────────────────────────────
  // When we auto-selected a run immediately after completion, we may have fetched
  // events before the backend finished committing them all. If the loaded count is
  // less than run.event_count, silently re-fetch once to get the full set.
  const staleRefetchedRef = useRef<string | null>(null);
  useEffect(() => {
    if (viewingLive || selectedRunLoading || !selectedRunId) return;
    const run = pipelineRuns.find(r => r.run_id === selectedRunId);
    if (!run || !run.event_count) return;
    if (panelEvents.length >= run.event_count) return;
    if (staleRefetchedRef.current === selectedRunId) return; // already retried
    staleRefetchedRef.current = selectedRunId;
    setSelectedRunLoading(true);
    apiFetch(`/pipeline/runs/${selectedRunId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setSelectedRunEvents(d.events ?? []); })
      .catch(() => {})
      .finally(() => setSelectedRunLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRunId, panelEvents.length, selectedRunLoading]);

  // ── Decide what to render in main panel ──────────────────────────────────
  const renderPanel = () => {
    // Show skeleton while fetching a selected run's events
    if (!viewingLive && (selectedRunLoading || (selectedRunId && panelEvents.length === 0))) {
      return renderLoadingSkeleton();
    }

    if (!viewingLive) {
      const run = pipelineRuns.find(r => r.run_id === selectedRunId);
      // Guard: if the selected run belongs to a different tab, don't display it.
      // This prevents a stale selectedRunId from a race condition showing the wrong run.
      if (run && runTypeToTab(run.run_type) !== activeTab) {
        return renderIdleView();
      }
      if (panelEvents.length === 0) return <p className="flex-1 flex items-center justify-center text-sm text-textMuted">No events recorded for this run.</p>;
      // Determine pipeline type: use run.run_type if loaded, otherwise sniff events
      // (eval events contain PRICE_FETCH/SCORE_STRATEGIES/DARWIN_SELECTION which never
      // appear in trade/research — avoids misclassification during lazy-load race).
      const EVAL_STEPS = new Set(['PRICE_FETCH', 'SCORE_STRATEGIES', 'POSITION_REVIEW', 'DARWIN_SELECTION', 'AGENT_ANALYSIS']);
      const RESEARCH_STEPS = new Set(['WEB_RESEARCH', 'KG_INGEST']);
      const eventsHaveEvalSteps = panelEvents.some(e => EVAL_STEPS.has(e.step));
      const eventsHaveResearchSteps = !eventsHaveEvalSteps && panelEvents.some(e => RESEARCH_STEPS.has(e.step)) && !panelEvents.some(e => e.step === 'DEBATE_PANEL');
      const effectiveTab = run
        ? runTypeToTab(run.run_type)
        : eventsHaveEvalSteps ? 'eval'
        : eventsHaveResearchSteps ? 'research'
        : activeTab;
      if (effectiveTab === 'eval') return renderEvalCompletedView(panelEvents, run);
      if (effectiveTab === 'research') return renderCompletedView(panelEvents, run, RESEARCH_ORDERED_STEPS);
      return renderCompletedView(panelEvents, run, TRADE_ORDERED_STEPS);
    }

    // Live view — tab's pipeline is running (or just finished before poller caught up)
    if (tabIsActive(activeTab) || liveEvents.length > 0) {
      // If events already show the run is complete, switch to completed view immediately
      // without waiting for the poller to update the running flag. Also handles the case
      // where the poller has already cleared the running flag but we still have the events
      // in memory — keeps showing the result instead of flashing to idle.
      const stepsForTab = activeTab === 'research' ? RESEARCH_ORDERED_STEPS : TRADE_ORDERED_STEPS;
      if (!tabIsActive(activeTab) || isRunComplete(panelEvents, stepsForTab)) {
        if (activeTab === 'eval') return renderEvalCompletedView(panelEvents);
        if (activeTab === 'research') return renderCompletedView(panelEvents, undefined, RESEARCH_ORDERED_STEPS);
        return renderCompletedView(panelEvents, undefined, TRADE_ORDERED_STEPS);
      }
      if (activeTab === 'eval') return renderEvalActiveView(panelEvents);
      if (activeTab === 'research') return renderActiveView(panelEvents, RESEARCH_ORDERED_STEPS);
      return renderActiveView(panelEvents, TRADE_ORDERED_STEPS);
    }

    // Idle with no past runs yet — show blueprint
    return renderIdleView();
  };

  // Determine schedule value and label for current tab
  const tabSchedule = activeTab === 'research' ? scheduleResearch : activeTab === 'trade' ? scheduleTrade : scheduleEval;

  return (
    <div className="space-y-4">
      {/* ── Fixed-position ticker search dropdown (escapes overflow:hidden) ───── */}
      {showFocusDropdown && focusDropdownRect && (
        <div
          className="fixed z-[9999] bg-surface border border-borderMid rounded-lg shadow-xl overflow-hidden"
          style={{
            left: focusDropdownRect.left,
            top: focusDropdownRect.bottom + 4,
            width: focusDropdownRect.width,
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          {tickerSearchLoading && focusVisibleResults.length === 0 && (
            <div className="px-3 py-2 text-xs text-textDim animate-pulse">Searching…</div>
          )}
          {focusVisibleResults.map(t => (
            <button key={t.symbol} onMouseDown={e => { e.preventDefault(); addFocusTicker(t.symbol); }}
              className="w-full text-left px-3 py-2 hover:bg-surface2 flex items-center justify-between gap-2 border-b border-borderLight last:border-0">
              <span className="text-xs font-mono font-semibold text-textMain">{t.symbol}</span>
              <span className="text-[10px] text-textDim truncate flex-1 text-right">{t.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Fixed-position tooltip (escapes overflow:hidden parents) ─────────── */}
      {evalBadgeTooltip && (
        <div
          className="pointer-events-none fixed z-[9999] -translate-x-1/2 -translate-y-full"
          style={{ left: evalBadgeTooltip.x, top: evalBadgeTooltip.y - 6 }}
        >
          <span className="block bg-surface border border-borderMid rounded-lg px-2.5 py-1.5 shadow-xl text-[11px] text-textMuted whitespace-nowrap">
            <span className="font-semibold text-textMain">{pipelineReadiness.active_positions}</span> active position{pipelineReadiness.active_positions !== 1 ? 's' : ''} to evaluate
          </span>
        </div>
      )}
      {/* ── Tab bar ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2.5">
        {TAB_CONFIG.map(tab => {
          const isThisTabRunning = tabIsActive(tab.id);
          const activeRunIds = new Set([currentRunIdResearch, currentRunIdTrade, currentRunIdEval].filter(Boolean) as string[]);
          const tabRunCount = pipelineRuns.filter(r =>
            runTypeToTab(r.run_type) === tab.id &&
            r.status !== 'running' &&
            !activeRunIds.has(r.run_id)
          ).length;
          const isActive_ = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => { if (autoSelectTimerRef.current) { clearTimeout(autoSelectTimerRef.current); autoSelectTimerRef.current = null; } setActiveTab(tab.id); setSelectedRunId(null); setSelectedRunEvents([]); setRunsPage(0); setStepsExpanded(false); }}
              className="relative flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left transition-all duration-200 btn-lift"
              style={isActive_ ? {
                background: tab.id === 'research' ? 'rgba(6,182,212,0.08)' : tab.id === 'trade' ? 'rgba(37,99,235,0.08)' : 'rgba(139,92,246,0.08)',
                border: `1px solid ${tab.id === 'research' ? 'rgba(6,182,212,0.25)' : tab.id === 'trade' ? 'rgba(37,99,235,0.25)' : 'rgba(139,92,246,0.25)'}`,
                boxShadow: `0 0 20px ${tab.id === 'research' ? 'rgba(6,182,212,0.08)' : tab.id === 'trade' ? 'rgba(37,99,235,0.08)' : 'rgba(139,92,246,0.08)'}`,
              } : {
                background: 'var(--color-surface)',
                border: '1px solid var(--color-borderLight)',
              }}
            >
              {/* Icon */}
              <TabIcon
                id={tab.id}
                className={`w-5 h-5 shrink-0 transition-all ${isActive_ ? tab.color : 'text-textDim opacity-40'}`}
              />
              {/* Labels */}
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-semibold leading-tight transition-colors ${isActive_ ? tab.color : 'text-textMuted'}`}>{tab.label}</p>
                <p className="text-[10px] text-textDim mt-0.5 truncate">{tab.sublabel}</p>
              </div>
              {/* Run count badge */}
              {tabRunCount > 0 && (
                <span className="relative group/badge shrink-0">
                  <span className={`block text-[9px] font-bold px-1.5 py-0.5 rounded-full border cursor-default ${
                    isActive_ ? `${tab.activeBg} ${tab.activeBorder} ${tab.color}` : 'bg-surface3 border-borderLight text-textDim'
                  }`}>
                    {tabRunCount}
                  </span>
                  <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 w-max max-w-[160px] opacity-0 group-hover/badge:opacity-100 transition-opacity duration-150 z-50">
                    <span className="block bg-surface border border-borderMid rounded-xl px-2.5 py-1.5 shadow-xl text-[11px] text-textMuted whitespace-nowrap">
                      <span className="font-semibold text-textMain">{tabRunCount}</span> completed run{tabRunCount !== 1 ? 's' : ''}
                    </span>
                  </span>
                </span>
              )}
              {/* Running indicator */}
              {isThisTabRunning && (
                <span className={`shrink-0 h-2 w-2 rounded-full ${tab.dot} pulse-ring`} />
              )}
              {/* Active bottom line */}
              {isActive_ && (
                <span
                  className={`absolute bottom-0 left-5 right-5 h-0.5 rounded-full`}
                  style={{
                    background: tab.id === 'research' ? 'rgba(6,182,212,0.6)' : tab.id === 'trade' ? 'rgba(59,130,246,0.6)' : 'rgba(139,92,246,0.6)',
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Schedule row for active tab ───────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-1">
        {(() => {
          const tab = TAB_CONFIG.find(t => t.id === activeTab)!;
          return (
            <>
              <span className={`text-[10px] font-semibold ${tab.color} opacity-80`}>{tab.label}</span>
              <span className="text-[10px] text-textDim">auto-runs every</span>
              <div className="flex gap-1">
                {SCHEDULE_OPTIONS.map(m => (
                  <button
                    key={m}
                    onClick={() => onScheduleUpdate(activeTab, m)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-all font-mono ${
                      tabSchedule === m
                        ? `${tab.activeBg} ${tab.activeBorder} ${tab.color} border font-semibold`
                        : 'bg-surface2 border-borderLight text-textDim hover:text-textMuted hover:border-borderMid'
                    }`}
                  >
                    {m < 60 ? `${m}m` : `${m / 60}h`}
                  </button>
                ))}
              </div>
            </>
          );
        })()}
      </div>

      {/* ── Control bar ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-borderLight bg-surface overflow-hidden">

        {/* Readiness banners */}
        {!tradeRunning && activeTab === 'trade' && !pipelineReadiness.has_research_data && (
          <div className="flex items-center gap-2.5 px-4 py-2.5 border-b" style={{ background: 'rgba(245,158,11,0.06)', borderColor: 'rgba(245,158,11,0.18)' }}>
            <span className="text-amber-400 text-sm shrink-0">◎</span>
            <p className="text-xs text-amber-300/90 flex-1">No research data yet — run <strong>Data Collection</strong> first before generating trades.</p>
          </div>
        )}
        {!tradeRunning && activeTab === 'trade' && pipelineReadiness.has_research_data && pipelineReadiness.last_research_at && (() => {
          const age = (Date.now() - new Date(pipelineReadiness.last_research_at!).getTime()) / 1000 / 60;
          return age > 120;
        })() && (
          <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-borderLight" style={{ background: 'var(--color-surface2)' }}>
            <span className="text-textDim text-sm shrink-0">◷</span>
            <p className="text-xs text-textDim flex-1">
              Research data is {Math.round((Date.now() - new Date(pipelineReadiness.last_research_at!).getTime()) / 1000 / 60 / 60 * 10) / 10}h old — consider collecting fresh data first.
            </p>
          </div>
        )}
        {!evalRunning && activeTab === 'eval' && pipelineReadiness.active_positions === 0 && (
          <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-borderLight" style={{ background: 'var(--color-surface2)' }}>
            <span className="text-textDim text-sm shrink-0">◉</span>
            <p className="text-xs text-textDim flex-1">No active positions to evaluate — agent scoring requires at least one ACTIVE or PENDING strategy.</p>
          </div>
        )}

        {/* Row 1: Focus prompt (research + trade tabs) + Run button */}
        <div className="relative flex items-center gap-3 px-4 border-b border-borderLight" style={{ height: '44px' }}>
          {/* Loading bar — spans the full row bottom edge while resolving */}
          {resolvingFocus && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden">
              <div className="h-full bg-brand-500 animate-[focusLoad_1.4s_ease-in-out_infinite]" />
            </div>
          )}
          <style>{`@keyframes focusLoad { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`}</style>
          {(activeTab === 'research' || activeTab === 'trade') && (
            <>
              <span className="text-[10px] font-semibold text-textDim uppercase tracking-widest shrink-0">Focus</span>
              <input
                type="text"
                value={investmentFocus}
                onChange={e => {
                  const val = e.target.value;
                  setInvestmentFocus(val);
                  if (resolvedFocusText && val.trim() !== resolvedFocusText) {
                    setFocusTickers(() => []);
                    setResolvedFocusText('');
                  }
                  if (!val) saveInvestmentFocus('');
                }}
                onKeyDown={e => { if (e.key === 'Enter') handleFindTickers(); }}
                placeholder="e.g. leading AI stocks in India, top US semiconductors, Bitcoin and Ethereum…"
                className="flex-1 bg-transparent text-xs text-textMain placeholder-textDim focus:outline-none min-w-0"
              />
              {investmentFocus && (
                <button
                  onClick={handleFindTickers}
                  disabled={resolvingFocus}
                  className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-semibold border transition-all disabled:cursor-wait"
                  style={resolvingFocus
                    ? { background: 'rgba(99,102,241,0.12)', borderColor: 'rgba(99,102,241,0.4)', color: '#a5b4fc' }
                    : { background: 'rgba(6,182,212,0.08)', borderColor: 'rgba(6,182,212,0.35)', color: '#22d3ee' }
                  }
                >
                  {resolvingFocus
                    ? <><span className="inline-block w-2.5 h-2.5 rounded-full border-2 border-indigo-400/40 border-t-indigo-400 animate-spin" />Finding</>
                    : <>⌕ Find</>
                  }
                </button>
              )}
              {/* Clear button — only shown when there's resolved text, preserves query until explicitly cleared */}
              {resolvedFocusText && !resolvingFocus && (
                <button
                  onClick={() => { setInvestmentFocus(''); setFocusTickers(() => []); setResolvedFocusText(''); saveInvestmentFocus(''); }}
                  className="shrink-0 text-[10px] text-textDim hover:text-textMuted transition-colors"
                  title="Clear focus"
                >✕</button>
              )}
              <div className="h-4 w-px bg-borderLight shrink-0" />
            </>
          )}
          {activeTab === 'eval' && (
            <p className="flex-1 text-xs text-textDim leading-none">Score active strategies, run post-mortem analysis, and evolve underperforming agents.</p>
          )}
          {tabIsActive(activeTab) ? (
            <button
              onClick={() => handleStopPipeline(activeTab)}
              className="shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all btn-lift"
              style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)', color: '#f87171' }}
            >
              ■ Stop
            </button>
          ) : (
            <>
              {activeTab === 'research' && (
                <button
                  onClick={handleResearchTrigger}
                  className="shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all btn-lift"
                  style={{ background: 'rgba(6,182,212,0.12)', borderColor: 'rgba(6,182,212,0.3)', color: '#22d3ee' }}
                >
                  ◎ {focusTickers.length > 0 ? `Collect · ${focusTickers.length} ticker${focusTickers.length !== 1 ? 's' : ''}` : 'Collect Data'}
                </button>
              )}
              {activeTab === 'trade' && (
                <button
                  onClick={handleTradeTrigger}
                  disabled={!pipelineReadiness.has_research_data}
                  className="shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all btn-lift disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none"
                  style={pipelineReadiness.has_research_data ? {
                    background: 'rgba(37,99,235,0.15)',
                    borderColor: 'rgba(59,130,246,0.35)',
                    color: '#60a5fa',
                  } : {
                    background: 'var(--color-surface2)',
                    borderColor: 'var(--color-borderLight)',
                    color: 'var(--color-textDim)',
                  }}
                  title={pipelineReadiness.has_research_data ? 'Generate trades using last research context' : 'Run Data Collection first'}
                >
                  ◈ {focusTickers.length > 0 ? `Generate · ${focusTickers.length} ticker${focusTickers.length !== 1 ? 's' : ''}` : 'Generate Trades'}
                </button>
              )}
              {activeTab === 'eval' && (
                <button
                  onClick={handleEvalTrigger}
                  disabled={pipelineReadiness.active_positions === 0}
                  className="shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all btn-lift disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none"
                  style={pipelineReadiness.active_positions > 0 ? {
                    background: 'rgba(139,92,246,0.1)',
                    borderColor: 'rgba(139,92,246,0.3)',
                    color: '#a78bfa',
                  } : {
                    background: 'var(--color-surface2)',
                    borderColor: 'var(--color-borderLight)',
                    color: 'var(--color-textDim)',
                  }}
                >
                  ◉ Evaluate Agents
                  {pipelineReadiness.active_positions > 0 && (
                    <span
                      className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold leading-none"
                      style={{ background: 'rgba(139,92,246,0.3)', color: '#c4b5fd' }}
                      onMouseEnter={e => { const r = e.currentTarget.getBoundingClientRect(); setEvalBadgeTooltip({ x: r.left + r.width / 2, y: r.top }); }}
                      onMouseLeave={() => setEvalBadgeTooltip(null)}
                    >
                      {pipelineReadiness.active_positions}
                    </span>
                  )}
                </button>
              )}
            </>
          )}
        </div>

        {/* Row 2: Sector pills + ticker search */}
        {(activeTab === 'research' || activeTab === 'trade') && <div className="px-4 py-2.5 flex items-center gap-3 flex-wrap border-t border-borderLight" style={{ background: 'var(--color-surface2)' }}>
          <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
            {Object.entries(MARKET_SECTORS)
              .filter(([market]) => enabledMarketNames.length === 0 || enabledMarketNames.includes(market))
              .map(([market, sectors]) =>
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
                      className="text-[10px] px-2 py-0.5 rounded-full border transition-all"
                      style={isActiveFilter ? {
                        background: 'rgba(6,182,212,0.15)',
                        borderColor: 'rgba(6,182,212,0.35)',
                        color: '#22d3ee',
                      } : {
                        background: 'var(--color-surface3)',
                        borderColor: 'var(--color-borderLight)',
                        color: 'var(--color-textMuted)',
                      }}
                    >
                      <span className="mr-1 opacity-50">{MARKET_ICONS[market]}</span>{sector}
                    </button>
                  );
                })
              )}
          </div>
          {/* Ticker search */}
          <div className="relative shrink-0 w-56" ref={focusInputWrapRef}>
            <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border transition-all ${focusSearchOpen ? 'border-cyan-500/50' : 'border-borderLight'}`}
              style={{ background: 'var(--color-surface3)' }}>
              <span className="text-textDim text-[10px] shrink-0">{tickerSearchLoading ? <span className="animate-spin inline-block">↻</span> : '⌕'}</span>
              <input type="text" value={focusSearch}
                onChange={e => {
                  const val = e.target.value; setFocusSearch(val); setFocusSearchOpen(true);
                  if (focusInputWrapRef.current) setFocusDropdownRect(focusInputWrapRef.current.getBoundingClientRect());
                  if (focusSearchTimerRef.current) clearTimeout(focusSearchTimerRef.current);
                  if (!val.trim()) { setTickerSearchResults([]); setTickerSearchLoading(false); return; }
                  setTickerSearchLoading(true);
                  focusSearchTimerRef.current = setTimeout(async () => {
                    try { const res = await apiFetch(`/search/tickers?q=${encodeURIComponent(val.trim())}`); if (res.ok) setTickerSearchResults(await res.json()); } catch { /* network */ }
                    setTickerSearchLoading(false);
                  }, 350);
                }}
                onFocus={() => {
                  setFocusSearchOpen(true);
                  if (focusInputWrapRef.current) setFocusDropdownRect(focusInputWrapRef.current.getBoundingClientRect());
                }}
                onBlur={() => setTimeout(() => { setFocusSearchOpen(false); setFocusDropdownRect(null); }, 150)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && focusVisibleResults.length > 0) addFocusTicker(focusVisibleResults[0].symbol);
                  if (e.key === 'Escape') { setFocusSearchOpen(false); setFocusSearch(''); setFocusDropdownRect(null); }
                }}
                placeholder="Add ticker…"
                className="flex-1 bg-transparent text-[11px] text-textMain placeholder-textDim focus:outline-none w-0 min-w-0"
              />
            </div>
          </div>
          {(focusTickers.length > 0 || focusSectorFilter) && (
            <button onClick={() => { setFocusTickers(() => []); setFocusSectorFilter(null); }} className="text-[10px] text-textDim hover:text-textMuted transition-colors shrink-0">✕ Clear</button>
          )}
        </div>}

        {/* Row 3: Selected tickers */}
        {(activeTab === 'research' || activeTab === 'trade') && focusTickers.length > 0 && (
          <div className="px-4 py-2 border-t border-borderLight flex flex-wrap gap-1.5" style={{ background: 'rgba(6,182,212,0.03)' }}>
            {focusTickers.map(t => (
              <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold"
                style={{ background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.25)', color: '#67e8f9' }}>
                {t}
                <button onClick={() => setFocusTickers(p => p.filter(x => x !== t))} className="text-[9px] leading-none ml-0.5 opacity-50 hover:opacity-100 transition-opacity">✕</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Two-column layout ─────────────────────────────────────────────────── */}
      <div className="flex gap-0 rounded-2xl overflow-hidden border border-borderLight" style={{ minHeight: '560px' }}>

        {/* Left: run list */}
        <div className="w-64 shrink-0 border-r border-borderLight flex flex-col overflow-hidden" style={{ background: 'var(--color-surface2)' }}>
          <div className="px-4 py-3 border-b border-borderLight flex items-center gap-2" style={{ background: 'var(--color-surface3)' }}>
            {(() => {
              const tab = TAB_CONFIG.find(t => t.id === activeTab)!;
              return (
                <p className={`text-[10px] font-bold uppercase tracking-widest ${tab.color} opacity-70 flex items-center gap-1.5`}>
                  <TabIcon id={tab.id} className="w-3.5 h-3.5 inline-block" />{tab.label}
                </p>
              );
            })()}
          </div>
          <div className="flex-1 overflow-y-auto">
            {/* Live entry — shown while running */}
            {tabIsActive(activeTab) && (
              <button
                onClick={() => { setSelectedRunId(null); setSelectedRunEvents([]); setStepsExpanded(false); }}
                className={`w-full text-left px-4 py-3 border-b border-borderLight transition-all ${
                  viewingLive
                    ? 'bg-surface border-l-2 ' + TAB_CONFIG.find(t => t.id === activeTab)?.borderColor
                    : 'hover:bg-surface3/60'
                }`}
              >
                <div className="flex items-center gap-2.5 mb-0.5">
                  <div className="relative shrink-0">
                    <span className="absolute inset-0 rounded-full bg-amber-400/30 animate-ping" style={{ animationDuration: '1.5s' }} />
                    <span className="relative h-2 w-2 rounded-full bg-amber-400 block" />
                  </div>
                  <span className="text-xs font-semibold text-amber-300">Running</span>
                </div>
                <p className="text-[10px] text-textDim pl-4.5">Live · in progress</p>
              </button>
            )}

            {/* Past runs */}
            {(() => {
              const activeRunIds = new Set([
                currentRunIdResearch,
                currentRunIdTrade,
                currentRunIdEval,
              ].filter(Boolean) as string[]);
              const tabRuns = pipelineRuns.filter(r => {
                if (r.status === 'running') return false;
                if (activeRunIds.has(r.run_id)) return false;
                return runTypeToTab(r.run_type) === activeTab;
              });
              const totalPages = Math.ceil(tabRuns.length / RUNS_PER_PAGE);
              const pageRuns = tabRuns.slice(runsPage * RUNS_PER_PAGE, (runsPage + 1) * RUNS_PER_PAGE);
              const tabCfg = TAB_CONFIG.find(t => t.id === activeTab)!;
              return (
                <>
                  {pageRuns.map(run => {
                    const isSelected = selectedRunId === run.run_id;
                    const dur = Math.round((new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()) / 1000);
                    const params = run.run_params;
                    // Treat as failed if stuck running > 10 mins with no ended_at progress
                    const isStale = run.status === 'running' &&
                      Date.now() - new Date(run.started_at).getTime() > 10 * 60 * 1000;
                    const displayStatus = isStale ? 'error' : run.status;
                    return (
                      <button key={run.run_id}
                        onClick={() => { loadRunEvents(run.run_id); setStepsExpanded(false); }}
                        className={`w-full text-left px-4 py-3 border-b border-borderLight transition-all ${
                          isSelected
                            ? 'bg-surface border-l-2 ' + tabCfg.borderColor
                            : 'hover:bg-surface3/60'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`text-[10px] shrink-0 font-bold ${
                            displayStatus === 'done'  ? 'text-up'           :
                            displayStatus === 'error' ? 'text-down-text'    :
                                                        'text-warning-text'
                          }`}>
                            {displayStatus === 'done' ? '✓' : displayStatus === 'error' ? '✕' : '⏹'}
                          </span>
                          <span className="text-[11px] font-mono font-semibold text-textMuted truncate">{run.run_id.substring(0, 8)}</span>
                        </div>
                        <p className="text-[10px] text-textDim pl-3.5">
                          {new Date(run.started_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {dur}s
                        </p>
                        {activeTab !== 'eval' && params && (params.focus || (params.tickers && params.tickers.length > 0)) && (
                          <div className="pl-3.5 mt-1 flex flex-wrap gap-1">
                            {params.focus && (
                              <span className="text-[9px] text-brand-400 bg-brand-900/25 border border-brand-800/30 px-1.5 py-0.5 rounded-full truncate max-w-[110px]">{params.focus}</span>
                            )}
                            {params.tickers && params.tickers.length > 0 && (
                              <span className="text-[9px] text-textDim font-mono">{params.tickers.slice(0, 3).join(', ')}{params.tickers.length > 3 ? `+${params.tickers.length - 3}` : ''}</span>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-2 border-t border-borderLight shrink-0" style={{ background: 'var(--color-surface3)' }}>
                      <button
                        onClick={() => setRunsPage(p => Math.max(0, p - 1))}
                        disabled={runsPage === 0}
                        className="text-[10px] text-textDim hover:text-textMuted disabled:opacity-30 disabled:cursor-not-allowed px-2 py-0.5 rounded-lg hover:bg-surface2 transition-colors"
                      >‹ Prev</button>
                      <span className="text-[9px] text-textDim font-mono tabular">{runsPage + 1}/{totalPages}</span>
                      <button
                        onClick={() => setRunsPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={runsPage >= totalPages - 1}
                        className="text-[10px] text-textDim hover:text-textMuted disabled:opacity-30 disabled:cursor-not-allowed px-2 py-0.5 rounded-lg hover:bg-surface2 transition-colors"
                      >Next ›</button>
                    </div>
                  )}
                </>
              );
            })()}

            {tabRunsLoading && (
              <div className="px-4 py-4 space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="space-y-1.5" style={{ opacity: 1 - (i - 1) * 0.25 }}>
                    <div className="h-2.5 shimmer rounded-lg w-3/4" />
                    <div className="h-2 shimmer rounded-lg w-1/2" />
                  </div>
                ))}
              </div>
            )}
            {!tabRunsLoading && (() => {
              const activeRunIds = new Set([currentRunIdResearch, currentRunIdTrade, currentRunIdEval].filter(Boolean) as string[]);
              const hasRuns = pipelineRuns.some(r =>
                runTypeToTab(r.run_type) === activeTab &&
                r.status !== 'running' &&
                !activeRunIds.has(r.run_id)
              );
              return !hasRuns && !tabIsActive(activeTab);
            })() && (
              <p className="px-4 py-5 text-[11px] text-textDim opacity-60">No {activeTab} runs yet.</p>
            )}
          </div>
        </div>

        {/* Right: main panel */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden" style={{ background: 'var(--color-background)' }}>
          {/* Panel header */}
          <div className="px-5 py-3 border-b border-borderLight flex items-center justify-between shrink-0" style={{ background: 'var(--color-surface2)' }}>
            <div className="flex items-center gap-2">
              {viewingLive ? (
                tabIsActive(activeTab) ? (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                    <div className="relative shrink-0">
                      <span className="absolute inset-0 rounded-full bg-amber-400/20 animate-ping" />
                      <span className="relative h-1.5 w-1.5 rounded-full bg-amber-400 block" />
                    </div>
                    Running
                  </span>
                ) : (
                  <span className="text-xs text-textDim">Idle — ready to run</span>
                )
              ) : (() => {
                const selectedRun = pipelineRuns.find(r => r.run_id === selectedRunId);
                const runDur = selectedRun ? Math.round((new Date(selectedRun.ended_at).getTime() - new Date(selectedRun.started_at).getTime()) / 1000) : null;
                return (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-semibold text-textMuted bg-surface3 border border-borderLight px-2 py-0.5 rounded-lg">
                      run/{selectedRunId?.substring(0, 8)}
                    </span>
                    {selectedRun && (
                      <span className="text-[10px] text-textDim tabular">{selectedRun.event_count} events{runDur != null ? ` · ${runDur}s` : ''}</span>
                    )}
                  </div>
                );
              })()}
              {viewingLive && tabIsActive(activeTab) && (currentRunIdResearch || currentRunIdTrade || currentRunIdEval) && (
                <span className="text-[10px] text-textDim font-mono bg-surface3 border border-borderLight px-2 py-0.5 rounded-lg">
                  run/{(activeTab === 'research' ? currentRunIdResearch : activeTab === 'eval' ? currentRunIdEval : currentRunIdTrade)?.substring(0, 8)}…
                </span>
              )}
            </div>
            {focusTickers.length > 0 && viewingLive && !tabIsActive(activeTab) && (
              <span className="text-[10px] font-mono font-semibold"
                style={{ background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(59,130,246,0.2)', color: '#60a5fa', padding: '2px 8px', borderRadius: '99px' }}>
                focused · {focusTickers.join(', ')}
              </span>
            )}
          </div>

          {/* Main content */}
          <div className="flex-1 overflow-y-auto flex flex-col">
            {renderPanel()}
          </div>
        </div>
      </div>
    </div>
  );
}
