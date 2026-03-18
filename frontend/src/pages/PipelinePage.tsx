import { useEffect, useRef, useState } from 'react';
import type { PipelineEvent, PipelineRun, WebResearch, PipelineReadiness } from '../types';
import { STEP_META, MARKET_SECTORS, MARKET_ICONS, TICKER_DB } from '../constants';
import { apiFetch, getMarketForTicker } from '../utils';

type PipelineTab = 'research' | 'trade' | 'eval';

interface PipelinePagesProps {
  isTriggering: boolean;
  researchRunning: boolean;
  tradeRunning: boolean;
  evalRunning: boolean;
  currentRunIdResearch: string | null;
  currentRunIdTrade: string | null;
  currentRunIdEval: string | null;
  researchEvents: PipelineEvent[];
  tradeEvents: PipelineEvent[];
  evalEvents: PipelineEvent[];
  pipelineEvents: PipelineEvent[];
  pipelineRunId: string | null;
  pipelineRuns: PipelineRun[];
  pipelineRunsLoaded: boolean;
  selectedRunId: string | null;
  selectedRunEvents: PipelineEvent[];
  selectedRunLoading: boolean;
  research: WebResearch[];
  researchStepOpen: boolean;
  enabledMarketNames: string[];
  investmentFocus: string;
  investmentFocusSaved: boolean;
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
  setPipelineRuns: (runs: PipelineRun[]) => void;
  setPipelineRunsLoaded: (v: boolean) => void;
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
  handleManualTrigger: (tickers?: string[]) => void;
  handleStopPipeline: (pipeline?: 'research' | 'trade' | 'eval') => void;
  handleEvalTrigger: () => void;
  handleResearchTrigger: () => void;
  handleTradeTrigger: () => void;
  onScheduleUpdate: (pipeline: 'research' | 'trade' | 'eval', minutes: number) => void;
  setSelectedRunLoading: (v: boolean) => void;
  loadRunEvents: (runId: string) => void;
  openReport: (id: number) => void;
}

const ORDERED_STEPS = [
  'START', 'WEB_RESEARCH', 'KG_INGEST', 'DEBATE_PANEL', 'AGENT_QUERY', 'JUDGE', 'DEPLOY', 'MEMORY_WRITE',
];

const RESEARCH_ORDERED_STEPS = [
  'START', 'WEB_RESEARCH', 'KG_INGEST', 'MEMORY_WRITE',
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
    if (e.status === 'DONE') done.add(e.step);
    if (e.status === 'IN_PROGRESS') {
      // If there's a later event for the same step that is DONE, mark done
      const later = events.slice(events.indexOf(e) + 1).find(x => x.step === e.step && x.status === 'DONE');
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
      if (events.some(e => e.step === stepsArray[i])) {
        done.add(stepsArray[i]);
      }
    }
  }
  return done;
}

function isRunComplete(events: PipelineEvent[]): boolean {
  return events.some(e => e.step === 'MEMORY_WRITE' && e.status === 'DONE') ||
    events.some(e => e.step === 'START' && e.status === 'DONE');
}


function hasError(events: PipelineEvent[]): boolean {
  return events.some(e => e.status === 'ERROR');
}

function getRunDuration(events: PipelineEvent[]): number | null {
  if (events.length < 2) return null;
  return Math.round(
    (new Date(events[events.length - 1].created_at).getTime() - new Date(events[0].created_at).getTime()) / 1000
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
  isTriggering: _isTriggering, researchRunning, tradeRunning, evalRunning,
  currentRunIdResearch, currentRunIdTrade, currentRunIdEval,
  researchEvents, tradeEvents, evalEvents,
  pipelineEvents, pipelineRunId: _pipelineRunId, pipelineRuns, pipelineRunsLoaded,
  selectedRunId, selectedRunEvents, selectedRunLoading, research, researchStepOpen,
  enabledMarketNames, investmentFocus, investmentFocusSaved,
  focusTickers, focusSearch, focusSearchOpen, focusSectorFilter,
  tickerSearchResults, tickerSearchLoading,
  scheduleResearch, scheduleTrade, scheduleEval, pipelineReadiness,
  setResearchStepOpen, setSelectedRunId, setSelectedRunEvents,
  setInvestmentFocus, setFocusTickers, setFocusSearch, setFocusSearchOpen,
  setFocusSectorFilter, setTickerSearchResults, setTickerSearchLoading,
  saveInvestmentFocus, handleManualTrigger: _handleManualTrigger, handleStopPipeline, handleEvalTrigger,
  handleResearchTrigger, handleTradeTrigger, onScheduleUpdate,
  setSelectedRunLoading, loadRunEvents, openReport, setPipelineRuns, setPipelineRunsLoaded,
}: PipelinePagesProps) {
  // Per-tab active state
  const tabIsActive = (tab: PipelineTab) =>
    tab === 'research' ? researchRunning :
    tab === 'trade'    ? tradeRunning :
    tab === 'eval'     ? evalRunning : false;
  const focusSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [stepsExpanded, setStepsExpanded] = useState(false);
  const [runsPage, setRunsPage] = useState(0);
  const [activeTab, setActiveTab] = useState<PipelineTab>('research');
  const RUNS_PER_PAGE = 10;

  // Keep a ref to selectedRunId so effects always read the current value without
  // needing to include it in deps (avoids stale-closure bugs).
  const selectedRunIdRef = useRef(selectedRunId);
  selectedRunIdRef.current = selectedRunId;

  // ── Lazy-load pipeline runs per tab ─────────────────────────────────────────
  const fetchRuns = (delay = 0) => {
    const doFetch = () =>
      apiFetch('/pipeline/runs')
        .then(r => r.ok ? r.json() : null)
        .then(runs => {
          if (runs) {
            setPipelineRuns(runs);
            setPipelineRunsLoaded(true);
          }
        })
        .catch(() => { setPipelineRunsLoaded(true); });
    if (delay > 0) setTimeout(doFetch, delay);
    else doFetch();
  };

  // Re-fetch runs on tab switch
  const prevActiveTabRef = useRef(activeTab);
  useEffect(() => {
    if (prevActiveTabRef.current !== activeTab) {
      prevActiveTabRef.current = activeTab;
      fetchRuns(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

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
    fetchRuns(1500);
    setTimeout(() => {
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
  // Live events per tab — use tab-specific events, fall back to shared pipelineEvents
  const liveEvents: PipelineEvent[] =
    activeTab === 'research' ? researchEvents :
    activeTab === 'trade'    ? tradeEvents :
    activeTab === 'eval'     ? evalEvents :
    pipelineEvents;
  const panelEvents = viewingLive ? liveEvents : selectedRunEvents;


  const focusVisibleResults = tickerSearchResults.filter(r => !focusTickers.includes(r.symbol));
  const showFocusDropdown = focusSearchOpen && (tickerSearchLoading || focusVisibleResults.length > 0);

  const addFocusTicker = (sym: string) => {
    if (!focusTickers.includes(sym)) setFocusTickers(p => [...p, sym]);
    setFocusSearch(''); setFocusSearchOpen(false); setTickerSearchResults([]);
  };

  // ── Active Run View ──────────────────────────────────────────────────────────
  const renderActiveView = (events: PipelineEvent[], stepsArray: string[] = ORDERED_STEPS) => {
    const currentStep = getCurrentStep(events);
    const completedSteps = getCompletedSteps(events, stepsArray);
    const stepIndex = currentStep ? stepsArray.indexOf(currentStep) : -1;
    const totalSteps = stepsArray.length;
    const progressPct = stepIndex >= 0 ? Math.round(((stepIndex + 0.5) / totalSteps) * 100) : 0;

    // Latest detail message for each step
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
        {/* Compact progress header */}
        <div className="px-5 py-4 border-b border-borderLight bg-surface2/40">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping shrink-0" />
              <span className="text-xs font-semibold text-amber-400">
                {currentStep ? (STEP_LABELS[currentStep] ?? currentStep) : 'Starting…'}
              </span>
            </div>
            <span className="text-[10px] text-textDim font-mono">{progressPct}%</span>
          </div>
          <div className="h-0.5 bg-surface3 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-amber-400 transition-all duration-700"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Step list — compact rows */}
        <div className="flex-1 px-5 py-3 space-y-0.5">
          {stepsArray.map(s => {
            const isDone = completedSteps.has(s);
            const isActive = s === currentStep;
            const c = STEP_COLORS[s] ?? STEP_COLORS.START;
            const m = STEP_META[s];
            const detail = (isDone || isActive) ? latestDetail(s) : '';

            return (
              <div key={s} className={`flex items-start gap-3 py-2 rounded-lg px-2 transition-colors ${
                isActive ? 'bg-surface2' : isDone ? 'bg-up/[0.06]' : ''
              }`}>
                {/* Status dot */}
                <div className={`mt-0.5 h-5 w-5 rounded-full shrink-0 flex items-center justify-center text-[10px] border ${
                  isActive  ? `${c.ring} ${c.bg} animate-pulse` :
                  isDone    ? 'border-up bg-up/20' :
                              'border-borderLight bg-surface3 opacity-30'
                }`}>
                  {isDone
                    ? <span className="text-up text-[9px] font-bold">✓</span>
                    : <span className={isActive ? c.text : 'text-textDim'}>{m?.icon ?? '·'}</span>
                  }
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-semibold ${
                      isActive ? c.text : isDone ? 'text-up' : 'text-textDim opacity-40'
                    }`}>
                      {STEP_LABELS[s] ?? s}
                    </span>
                    {isActive && <span className="text-[9px] text-amber-400 animate-pulse">running</span>}
                    {isDone && <span className="text-[9px] text-up/60 font-medium">done</span>}
                    {isDone && s === 'WEB_RESEARCH' && research.length > 0 && (
                      <button
                        onClick={() => setResearchStepOpen(o => !o)}
                        className="text-[9px] text-brand-400 bg-brand-900/30 border border-brand-700/30 px-1.5 py-0.5 rounded-full hover:bg-brand-800/40 transition-colors">
                        {research.length} articles {researchStepOpen ? '▲' : '▼'}
                      </button>
                    )}
                  </div>
                  {detail && (
                    <p className="text-[10px] text-textDim mt-0.5 leading-relaxed truncate max-w-sm" title={detail}>
                      {detail.length > 80 ? detail.slice(0, 80) + '…' : detail}
                    </p>
                  )}
                  {/* Agent pills for AGENT_QUERY */}
                  {s === 'AGENT_QUERY' && (activeAgents.length > 0 || doneAgents.length > 0) && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {[...doneAgents, ...activeAgents].filter((v, i, a) => a.indexOf(v) === i).map(agent => {
                        const done = doneAgents.includes(agent);
                        return (
                          <span key={agent} className={`text-[9px] px-1.5 py-0.5 rounded-full border font-medium ${
                            done ? 'text-up bg-up/10 border-up/30' : 'text-teal-300 bg-teal-500/10 border-teal-500/30 animate-pulse'
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
                          <span className="opacity-40 mr-1">—</span>
                          {r.source_url && r.source_url !== 'N/A'
                            ? <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="hover:text-brand-400 transition-colors">{r.title}</a>
                            : r.title
                          }
                        </div>
                      ))}
                      {research.length > 8 && <p className="text-[10px] text-textDim opacity-50">+{research.length - 8} more</p>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {!currentStep && events.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex items-center gap-2 text-amber-400 animate-pulse">
              <span className="text-sm">↻</span>
              <span className="text-xs">Starting pipeline…</span>
            </div>
          </div>
        )}
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
        <div className="px-5 py-4 border-b border-borderLight bg-surface2/40">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-ping shrink-0" />
              <span className="text-xs font-semibold text-purple-400">
                {currentStep ? (EVAL_STEP_LABELS[currentStep] ?? currentStep) : 'Starting…'}
              </span>
              <span className="text-[9px] text-textDim bg-purple-900/30 border border-purple-700/30 px-1.5 py-0.5 rounded uppercase tracking-wider">Eval</span>
            </div>
            <span className="text-[10px] text-textDim font-mono">{progressPct}%</span>
          </div>
          <div className="h-0.5 bg-surface3 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-purple-400 transition-all duration-700" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        <div className="flex-1 px-5 py-3 space-y-0.5">
          {EVAL_ORDERED_STEPS.map(s => {
            const isDone = doneSteps.has(s);
            const isCurrent = s === currentStep;
            const detail = (isDone || isCurrent) ? latestDetail(s) : '';

            return (
              <div key={s} className={`flex items-start gap-3 py-2 rounded-lg px-2 transition-colors ${
                isCurrent ? 'bg-surface2' : isDone ? 'bg-up/[0.06]' : ''
              }`}>
                <div className={`mt-0.5 h-5 w-5 rounded-full shrink-0 flex items-center justify-center text-[10px] border ${
                  isCurrent ? `border-purple-500 bg-purple-500/10 animate-pulse` :
                  isDone    ? 'border-up bg-up/20' :
                              'border-borderLight bg-surface3 opacity-30'
                }`}>
                  {isDone ? <span className="text-up text-[9px] font-bold">✓</span>
                    : <span className={isCurrent ? 'text-purple-400' : 'text-textDim'}>
                        {s === 'PRICE_FETCH' ? '₿' : s === 'SCORE_STRATEGIES' ? '⚖' : s === 'POSITION_REVIEW' ? '🔍' :
                         s === 'AGENT_ANALYSIS' ? '🔬' : s === 'DARWIN_SELECTION' ? '🧬' : '·'}
                      </span>
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-semibold ${isCurrent ? 'text-purple-400' : isDone ? 'text-up' : 'text-textDim opacity-40'}`}>
                      {EVAL_STEP_LABELS[s] ?? s}
                    </span>
                    {isCurrent && <span className="text-[9px] text-purple-400 animate-pulse">running</span>}
                    {isDone && <span className="text-[9px] text-up/60 font-medium">done</span>}
                  </div>
                  {detail && (
                    <p className="text-[10px] text-textDim mt-0.5 leading-relaxed" title={detail}>
                      {detail.length > 100 ? detail.slice(0, 100) + '…' : detail}
                    </p>
                  )}
                  {s === 'AGENT_ANALYSIS' && (agentsActive.length > 0 || agentsDone.length > 0) && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {[...agentsDone, ...agentsActive].filter((v, i, a) => a.indexOf(v) === i).map(agent => {
                        const done = agentsDone.includes(agent);
                        return (
                          <span key={agent} className={`text-[9px] px-1.5 py-0.5 rounded-full border font-medium ${
                            done ? 'text-up bg-up/10 border-up/30' : 'text-purple-300 bg-purple-500/10 border-purple-500/30 animate-pulse'
                          }`}>
                            {done ? '✓ ' : '🔬 '}{agent}
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
      </div>
    );
  };

  // ── Eval Completed View ───────────────────────────────────────────────────
  const renderEvalCompletedView = (events: PipelineEvent[], run?: PipelineRun) => {
    const complete = run?.status === 'done' || isRunComplete(events);
    const orphaned = !complete && events.length > 0 && events.every(e => e.status === 'IN_PROGRESS');
    const errored = !complete && (run?.status === 'error' || hasError(events) || orphaned);
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
        <div className={`px-6 py-5 border-b border-borderLight ${errored ? 'bg-down-bg/40' : 'bg-purple-500/5'}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`h-10 w-10 rounded-full flex items-center justify-center text-lg ${errored ? 'bg-down-bg text-down-text' : 'bg-purple-500/15 text-purple-400'}`}>
                {errored ? '✕' : '🧬'}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-semibold ${errored ? 'text-down-text' : 'text-purple-400'}`}>
                    {errored ? 'Evaluation Failed' : 'Evaluation Complete'}
                  </p>
                  <span className="text-[9px] text-purple-400 bg-purple-900/30 border border-purple-700/30 px-1.5 py-0.5 rounded uppercase tracking-wider">Eval</span>
                </div>
                <p className="text-[11px] text-textDim mt-0.5">
                  {events.length} events{dur != null ? ` · ${dur}s` : ''}
                </p>
              </div>
            </div>
            <button
              onClick={() => setStepsExpanded(v => !v)}
              className="flex items-center gap-1.5 text-[11px] text-textDim hover:text-textMuted border border-borderLight bg-surface2 hover:bg-surface3 px-3 py-1.5 rounded-lg transition-colors"
            >
              <span className="font-mono">{stepsExpanded ? '▲' : '▼'}</span>
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
                  <span key={s} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-borderLight text-textDim opacity-35">
                    {EVAL_STEP_LABELS[s]}
                  </span>
                );
                return (
                  <span key={s} className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border ${
                    failed ? 'border-down/40 text-down-text bg-down-bg' : 'border-purple-500/40 text-purple-400 bg-purple-500/10'
                  }`}>
                    {EVAL_STEP_LABELS[s]}{failed ? ' ✕' : ' ✓'}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Expanded step log */}
        {stepsExpanded && (
          <div className="border-b border-borderLight bg-surface2/30">
            <div className="divide-y divide-borderLight">
              {events.map(ev => {
                const timeStr = new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const label = EVAL_STEP_LABELS[ev.step] ?? ev.step;
                return (
                  <div key={ev.id} className="px-5 py-3 flex items-start gap-4">
                    <div className={`mt-0.5 shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-[10px] border ${
                      ev.status === 'ERROR' ? 'bg-down-bg border-down/50 text-down-text' :
                      ev.status === 'DONE'  ? 'bg-up/15 border-up/50 text-up' :
                                              'bg-purple-500/10 border-purple-500/30 text-purple-400'
                    }`}>
                      {ev.status === 'DONE' ? '✓' : ev.status === 'ERROR' ? '✕' : '↻'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-medium text-textMain">{label}</span>
                          {ev.agent_name && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium text-purple-300 bg-purple-900/40 border border-purple-700/40">{ev.agent_name}</span>
                          )}
                        </div>
                        <span className="text-[10px] text-textDim font-mono shrink-0">{timeStr}</span>
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
        <div className="px-5 py-4 space-y-4">
          {/* Price & Score summary */}
          {(priceFetchEvent || scoringEvent) && (
            <div className="rounded-xl border border-borderLight bg-surface2 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-borderLight bg-surface3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-textDim">Position Scoring</span>
              </div>
              <div className="px-4 py-3 space-y-1">
                {priceFetchEvent?.detail && <p className="text-[11px] text-textMuted">{priceFetchEvent.detail}</p>}
                {scoringEvent?.detail && (
                  <div className="mt-1">
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
            <div className="rounded-xl border border-borderLight bg-surface2 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-borderLight bg-surface3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-textDim">Position Review</span>
              </div>
              <div className="px-4 py-3">
                <p className="text-[11px] text-textMuted">{reviewEvent.detail}</p>
              </div>
            </div>
          )}

          {/* Agent post-mortems */}
          {analysisEvents.length > 0 && (
            <div className="rounded-xl border border-borderLight bg-surface2 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-borderLight bg-surface3 flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-textDim">Post-Mortem Analysis</span>
                <span className="text-[10px] text-textDim bg-surface2 border border-borderLight px-1.5 py-0.5 rounded">{analysisEvents.length}</span>
              </div>
              <div className="divide-y divide-borderLight">
                {analysisEvents.map(ev => (
                  <div key={ev.id} className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-1">
                      {ev.agent_name && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-900/40 border border-purple-700/40 text-purple-300">{ev.agent_name}</span>
                      )}
                    </div>
                    {ev.detail && <p className="text-[11px] text-textMuted leading-relaxed">{ev.detail}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Darwin evolution */}
          {(darwinEvent || darwinAgentEvents.length > 0) && (
            <div className="rounded-xl border border-borderLight bg-surface2 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-borderLight bg-surface3 flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-textDim">Agent Evolution</span>
              </div>
              <div className="divide-y divide-borderLight">
                {darwinAgentEvents.filter(e => e.detail && (e.detail.includes('evolved') || e.detail.includes('MUTATION') || e.detail.includes('CROSSOVER'))).map(ev => (
                  <div key={ev.id} className="px-4 py-3 flex items-start gap-3">
                    <span className="text-sm shrink-0">🧬</span>
                    <div>
                      {ev.agent_name && <span className="text-[10px] font-semibold text-textMain">{ev.agent_name}</span>}
                      {ev.detail && <p className="text-[11px] text-textMuted mt-0.5 leading-relaxed">{ev.detail}</p>}
                    </div>
                  </div>
                ))}
                {darwinEvent && (
                  <div className="px-4 py-3">
                    <p className="text-[11px] text-textMuted">{darwinEvent.detail}</p>
                  </div>
                )}
                {darwinAgentEvents.filter(e => e.detail && (e.detail.includes('evolved') || e.detail.includes('MUTATION') || e.detail.includes('CROSSOVER'))).length === 0 && !darwinEvent && (
                  <div className="px-4 py-3">
                    <p className="text-[11px] text-textDim italic">No agents evolved this run.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {memoryEvent && (
            <div className="rounded-xl border border-borderLight bg-surface2 px-4 py-3">
              <p className="text-[11px] text-textMuted">{memoryEvent.detail}</p>
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
    const complete = run?.status === 'done' || isRunComplete(events);
    // Only show as errored if the run didn't complete — intermediate errors (e.g. KG_INGEST)
    // are non-fatal and the pipeline can still finish successfully.
    const orphaned = !complete && events.length > 0 && events.every(e => e.status === 'IN_PROGRESS');
    const errored = !complete && (run?.status === 'error' || hasError(events) || orphaned);
    const wasStopped = !errored && !complete;
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

    return (
      <div className="flex-1 flex flex-col overflow-y-auto">
        {/* ── Outcome banner ─────────────────────────────────────────────── */}
        <div className={`px-6 py-5 border-b border-borderLight ${
          errored    ? 'bg-down-bg/40'    :
          wasStopped ? 'bg-warning-bg/40'  :
                       'bg-up/5'
        }`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`h-10 w-10 rounded-full flex items-center justify-center text-lg font-bold ${
                errored    ? 'bg-down-bg text-down-text'    :
                wasStopped ? 'bg-warning-bg text-warning' :
                             'bg-up/15 text-up'
              }`}>
                {errored ? '✕' : wasStopped ? '⏹' : '✓'}
              </div>
              <div>
                <p className={`text-sm font-semibold ${errored ? 'text-down-text' : wasStopped ? 'text-warning' : 'text-up'}`}>
                  {errored ? 'Pipeline Failed' : wasStopped ? 'Pipeline Stopped' : 'Pipeline Complete'}
                </p>
                {errored && errorEvent && (
                  <p className="text-[11px] text-textDim mt-0.5">
                    Failed at <span className="text-down-text font-medium">{STEP_META[errorEvent.step]?.label ?? errorEvent.step}</span>
                    {errorEvent.detail && <span className="opacity-60"> — {errorEvent.detail.slice(0, 80)}{errorEvent.detail.length > 80 ? '…' : ''}</span>}
                  </p>
                )}
                {!errored && (
                  <p className="text-[11px] text-textDim mt-0.5">
                    {events.length} events{dur != null ? ` · ${dur}s` : ''}
                    {positions.length > 0 && ` · ${positions.length} position${positions.length !== 1 ? 's' : ''} deployed`}
                  </p>
                )}
              </div>
            </div>

            <div className="shrink-0 flex items-center gap-2">
              {/* Resume button — shown for errored or stopped runs that have a checkpoint */}
              {(errored || wasStopped) && run && run.run_id && (
                <button
                  onClick={() => {
                    apiFetch(`/pipeline/resume/${run.run_id}`, { method: 'POST' })
                      .then(r => r.ok ? r.json() : null)
                      .then(d => { if (d) { setSelectedRunId(null); } });
                  }}
                  className="flex items-center gap-1.5 text-[11px] font-semibold border border-brand-500/40 bg-brand-600/10 text-brand-400 hover:bg-brand-600/20 px-3 py-1.5 rounded-lg transition-colors"
                >
                  ↻ Resume
                </button>
              )}
              {/* Expandable steps toggle */}
              <button
                onClick={() => setStepsExpanded(v => !v)}
                className="flex items-center gap-1.5 text-[11px] text-textDim hover:text-textMuted border border-borderLight bg-surface2 hover:bg-surface3 px-3 py-1.5 rounded-lg transition-colors"
              >
                <span className="font-mono">{stepsExpanded ? '▲' : '▼'}</span>
                <span>{stepsExpanded ? 'Hide' : 'View'} Steps</span>
              </button>
            </div>
          </div>

          {/* Step summary chips */}
          {!stepsExpanded && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {stepsArray.map(s => {
                const ran = events.some(e => e.step === s);
                const failed = events.some(e => e.step === s && e.status === 'ERROR');
                const warned = !failed && events.some(e => e.step === s && e.status === 'WARN');
                const skipped = ran && !failed && !warned && !events.some(e => e.step === s && (e.status === 'DONE' || e.status === 'IN_PROGRESS'));
                const c = STEP_COLORS[s] ?? STEP_COLORS.START;
                const m = STEP_META[s];
                if (!ran) return (
                  <span key={s} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-borderLight text-textDim opacity-35">
                    <span>{m?.icon}</span><span>{STEP_LABELS[s]}</span>
                  </span>
                );
                return (
                  <span key={s} className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border ${
                    failed  ? 'border-down/40 text-down-text bg-down-bg' :
                    warned  ? 'border-warning/40 text-warning bg-warning-bg' :
                    skipped ? 'border-borderMid text-textDim bg-surface3' :
                              `${c.ring} ${c.text} ${c.bg}`
                  }`}>
                    <span>{m?.icon}</span>
                    <span>{STEP_LABELS[s]}</span>
                    {failed  ? <span className="text-down-text">✕</span> :
                     warned  ? <span className="opacity-80">⚠</span> :
                     skipped ? <span className="opacity-60">—</span> :
                               <span className="opacity-60">✓</span>}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Expanded step log ────────────────────────────────────────────── */}
        {stepsExpanded && (
          <div className="border-b border-borderLight bg-surface2/30">
            <div className="relative">
              <div className="absolute left-[28px] top-0 bottom-0 w-px bg-borderLight" />
              <div className="divide-y divide-borderLight">
                {events.map((ev, idx) => {
                  const meta = STEP_META[ev.step] ?? { icon: '·', label: ev.step, color: 'text-textMuted' };
                  const isAgentQuery = ev.step === 'AGENT_QUERY';
                  const hasLaterResolution = ev.status === 'IN_PROGRESS' && events.slice(idx + 1).some(e => e.step === ev.step && (e.status === 'DONE' || e.status === 'ERROR'));
                  let displayStatus = ev.status;
                  if (ev.status === 'IN_PROGRESS' && hasLaterResolution) displayStatus = 'DONE';
                  if (ev.status === 'IN_PROGRESS' && !hasLaterResolution) {
                    displayStatus = hasError(events) ? 'ERROR' : 'DONE';
                  }
                  const c = STEP_COLORS[ev.step] ?? STEP_COLORS.START;
                  const timeStr = new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

                  return (
                    <div key={ev.id}>
                      <div className={`flex items-start gap-4 ${isAgentQuery ? 'pl-10 pr-5 py-2.5' : 'px-5 py-3'}`}>
                        <div className="relative z-10 shrink-0">
                          <div className={`h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-bold ${
                            displayStatus === 'ERROR' ? 'bg-down-bg border-2 border-down/50' :
                            displayStatus === 'DONE'  ? 'bg-up/15 border-2 border-up/50' :
                                                        'bg-surface3 border-2 border-borderMid'
                          }`}>
                            <span className={`text-xs ${displayStatus === 'ERROR' ? 'text-down-text' : displayStatus === 'DONE' ? 'text-up' : c.text}`}>
                              {displayStatus === 'DONE' ? '✓' : meta.icon}
                            </span>
                          </div>
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-xs font-medium ${c.text}`}>{meta.label}</span>
                              {ev.agent_name && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium text-teal-300 bg-teal-900/40 border border-teal-700/40">{ev.agent_name}</span>
                              )}
                              {displayStatus === 'ERROR' && (
                                <span className="text-[10px] text-down-text bg-down-bg border border-down/20 px-1.5 py-0.5 rounded">ERROR</span>
                              )}
                              {/* Research toggle inline */}
                              {showResearchToggle && ev.step === 'WEB_RESEARCH' && displayStatus === 'DONE' && (
                                <button
                                  onClick={() => setResearchStepOpen(o => !o)}
                                  className="text-[10px] text-brand-400 bg-brand-900/30 border border-brand-700/30 px-2 py-0.5 rounded-full hover:bg-brand-800/40 transition-colors">
                                  {research.length} articles {researchStepOpen ? '▲' : '▼'}
                                </button>
                              )}
                            </div>
                            <span className="text-[10px] text-textDim font-mono shrink-0">{timeStr}</span>
                          </div>
                          {ev.detail && <p className="text-[11px] text-textDim leading-relaxed">{ev.detail}</p>}
                        </div>
                      </div>
                      {/* Inline research articles */}
                      {showResearchToggle && ev.step === 'WEB_RESEARCH' && displayStatus === 'DONE' && researchStepOpen && research.length > 0 && (
                        <div className="ml-16 mr-5 mb-3 border border-borderLight rounded-lg overflow-hidden bg-surface2/40">
                          {research.map((r) => {
                            let domain = '';
                            try { domain = new URL(r.source_url).hostname.replace('www.', ''); } catch { /* invalid */ }
                            return (
                              <div key={r.id} className="p-3 hover:bg-surface3/50 transition-colors group border-b border-borderLight last:border-0">
                                <a href={r.source_url} target="_blank" rel="noreferrer" className="block mb-1">
                                  <p className="text-xs font-medium text-textMain group-hover:text-brand-400 leading-snug transition-colors line-clamp-2">{r.title}</p>
                                  {domain && <p className="text-[10px] text-brand-500 mt-0.5">{domain} ↗</p>}
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
            <div className="rounded-xl border border-borderLight bg-surface2 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-borderLight bg-surface3 flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-textDim">Deployed</span>
                <span className="text-[10px] text-textDim bg-surface2 border border-borderLight px-1.5 py-0.5 rounded">{positions.length}</span>
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
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                            pos.action === 'LONG' ? 'bg-up/15 text-up border-up/20' : 
                            pos.action === 'SHORT' ? 'bg-down/15 text-down border-down/20' : 
                            'bg-info-bg text-info-text border-info/20'
                          }`}>
                            {pos.action}
                          </span>
                          <span className="text-[9px] text-textDim bg-surface3 border border-borderLight px-1.5 py-0.5 rounded">{market}</span>
                          {!marketEnabled && (
                            <span className="text-[9px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">market disabled</span>
                          )}
                        </div>
                        {pos.strategy_id != null && (
                          <button
                            onClick={() => openReport(pos.strategy_id!)}
                            className="shrink-0 flex items-center gap-1 text-[10px] font-semibold text-brand-400 hover:text-brand-300 border border-brand-700/40 bg-brand-900/20 px-2.5 py-1 rounded-lg transition-colors"
                          >
                            ◈ Report
                          </button>
                        )}
                      </div>
                      {(pos.horizon || pos.size || pos.target || pos.stop) && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2">
                          {pos.horizon && <span className="text-[10px] text-textDim"><span className="text-textMuted font-medium">Horizon</span> {pos.horizon}</span>}
                          {pos.size    && <span className="text-[10px] text-textDim"><span className="text-textMuted font-medium">Size</span> {pos.size}</span>}
                          {pos.target  && <span className="text-[10px] text-up"><span className="text-textMuted font-medium">Target</span> {pos.target}</span>}
                          {pos.stop    && <span className="text-[10px] text-down"><span className="text-textMuted font-medium">Stop</span> {pos.stop}</span>}
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
            <div className="rounded-xl border border-borderLight bg-surface2 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-borderLight bg-surface3 flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-textDim">Agent Proposals</span>
                <span className="text-[10px] text-textDim bg-surface2 border border-borderLight px-1.5 py-0.5 rounded">{visibleProposals.length}</span>
              </div>
              <div className="divide-y divide-borderLight">
                {visibleProposals.map((p: { agent_name: string; ticker: string; action: string; reasoning?: string }, i: number) => {
                  const pMarket = getMarketForTicker(p.ticker);
                  return (
                    <div key={i} className="px-4 py-3 flex items-start gap-3">
                      <span className={`shrink-0 mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded ${
                        p.action === 'LONG' ? 'bg-up/10 text-up' : 
                        p.action === 'SHORT' ? 'bg-down/10 text-down' : 
                        'bg-info-bg text-info-text'
                      }`}>
                        {p.action}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <span className="text-[11px] font-semibold text-textMain">{p.agent_name}</span>
                          <span className="text-[10px] font-mono text-brand-400">{p.ticker}</span>
                          <span className="text-[9px] text-textDim bg-surface3 border border-borderLight px-1 py-0.5 rounded">{pMarket}</span>
                        </div>
                        {p.reasoning && <p className="text-[10px] text-textDim leading-relaxed line-clamp-2">{p.reasoning}</p>}
                      </div>
                    </div>
                  );
                })}
                {hiddenCount > 0 && (
                  <div className="px-4 py-2 text-[10px] text-textDim text-center">
                    {hiddenCount} proposal{hiddenCount > 1 ? 's' : ''} from disabled markets hidden
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Empty state for error/stop with no results */}
        {positions.length === 0 && visibleProposals.length === 0 && (
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
      <div className="flex-1 flex flex-col items-center justify-start px-8 pt-6">
        <div className="w-full max-w-sm">
          <p className={`text-[10px] font-semibold uppercase tracking-widest mb-3 text-center ${tab.color}`}>
            {tab.icon} {tab.label} · steps
          </p>
          <div className="relative">
            <div className="absolute left-[13px] top-0 bottom-0 w-px bg-borderLight" />
            <div className="space-y-0">
              {steps.map((s, i) => {
                const c = STEP_COLORS[s.step] ?? STEP_COLORS.START;
                const m = STEP_META[s.step];
                return (
                  <div key={i} className="flex items-start gap-4 py-2.5">
                    <div className="relative z-10 shrink-0 h-7 w-7 rounded-full bg-surface3 border border-borderMid flex items-center justify-center">
                      <span className={`text-xs ${c.text} opacity-50`}>{m?.icon ?? '·'}</span>
                    </div>
                    <div className="pt-0.5">
                      <p className="text-xs font-medium text-textMain">{s.label}</p>
                      <p className="text-[11px] text-textDim mt-0.5">{s.desc}</p>
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
      <div className="flex-1 flex flex-col overflow-y-auto animate-pulse">
        {/* Header banner — mirrors completed view */}
        <div className="px-6 py-5 border-b border-borderLight bg-surface2/40">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-surface3 shrink-0" />
              <div className="space-y-2">
                <div className="h-3.5 bg-surface3 rounded w-36" />
                <div className="h-2.5 bg-surface3 rounded w-24" />
              </div>
            </div>
            <div className="h-7 w-24 rounded-lg bg-surface3 shrink-0" />
          </div>
          {/* Step chips — exact steps for this tab, all greyed out */}
          <div className="mt-4 flex flex-wrap gap-1.5">
            {steps.map(s => (
              <span key={s} className="inline-flex items-center text-[10px] px-2.5 py-1 rounded-full border border-borderLight bg-surface3 text-transparent select-none">
                {labels[s] ?? s}
              </span>
            ))}
          </div>
        </div>
        {/* Event rows */}
        <div className="px-5 py-4 space-y-4">
          {steps.map((s, i) => (
            <div key={s} className="flex items-start gap-3">
              <div className="h-6 w-6 rounded-full bg-surface3 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-surface3 rounded" style={{ width: `${40 + (i % 3) * 15}%` }} />
                <div className="h-2.5 bg-surface3 rounded" style={{ width: `${55 + (i % 4) * 10}%` }} />
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

    // Live view — tab's pipeline is running, always show active view
    if (tabIsActive(activeTab)) {
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
      {/* ── Tab bar ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2">
        {TAB_CONFIG.map(tab => {
          const isThisTabRunning = tabIsActive(tab.id);
          const tabRunCount = pipelineRuns.filter(r => runTypeToTab(r.run_type) === tab.id && r.status !== 'running').length;
          const isActive_ = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setSelectedRunId(null); setSelectedRunEvents([]); setRunsPage(0); setStepsExpanded(false); }}
              className={`relative flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${
                isActive_
                  ? `${tab.activeBg} ${tab.activeBorder} border`
                  : 'bg-surface border-borderLight hover:bg-surface2 hover:border-borderMid'
              }`}
            >
              {/* Icon */}
              <span className={`text-lg leading-none shrink-0 ${isActive_ ? tab.color : 'text-textDim'}`}>{tab.icon}</span>
              {/* Labels */}
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-semibold leading-tight ${isActive_ ? tab.color : 'text-textMuted'}`}>{tab.label}</p>
                <p className="text-[10px] text-textDim mt-0.5 truncate">{tab.sublabel}</p>
              </div>
              {/* Run count badge */}
              {tabRunCount > 0 && (
                <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${isActive_ ? `${tab.activeBg} ${tab.activeBorder} ${tab.color}` : 'bg-surface3 border-borderLight text-textDim'}`}>
                  {tabRunCount}
                </span>
              )}
              {/* Running indicator */}
              {isThisTabRunning && (
                <span className={`shrink-0 h-2 w-2 rounded-full ${tab.dot} animate-pulse`} />
              )}
              {/* Active underline */}
              {isActive_ && (
                <span className={`absolute bottom-0 left-4 right-4 h-0.5 rounded-full ${tab.dot} opacity-60`} />
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
              <span className={`text-[10px] font-medium ${tab.color}`}>{tab.label}</span>
              <span className="text-[10px] text-textDim">auto-runs every</span>
              <div className="flex gap-1">
                {SCHEDULE_OPTIONS.map(m => (
                  <button
                    key={m}
                    onClick={() => onScheduleUpdate(activeTab, m)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors font-mono ${
                      tabSchedule === m
                        ? `${tab.activeBg} ${tab.activeBorder} ${tab.color} border`
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
      <div className="rounded-xl border border-borderLight bg-surface overflow-hidden">

        {/* Readiness banners — shown before run button when preconditions not met */}
        {!tradeRunning && activeTab === 'trade' && !pipelineReadiness.has_research_data && (
          <div className="flex items-center gap-2.5 px-4 py-2.5 bg-amber-500/8 border-b border-amber-500/20">
            <span className="text-amber-400 text-sm shrink-0">◎</span>
            <p className="text-xs text-amber-300 flex-1">No research data yet — run <strong>Data Collection</strong> first before generating trades.</p>
          </div>
        )}
        {!tradeRunning && activeTab === 'trade' && pipelineReadiness.has_research_data && pipelineReadiness.last_research_at && (() => {
          const age = (Date.now() - new Date(pipelineReadiness.last_research_at!).getTime()) / 1000 / 60;
          return age > 120;
        })() && (
          <div className="flex items-center gap-2.5 px-4 py-2.5 bg-surface2 border-b border-borderLight">
            <span className="text-textDim text-sm shrink-0">◷</span>
            <p className="text-xs text-textDim flex-1">
              Research data is {Math.round((Date.now() - new Date(pipelineReadiness.last_research_at!).getTime()) / 1000 / 60 / 60 * 10) / 10}h old — consider collecting fresh data first.
            </p>
          </div>
        )}
        {!evalRunning && activeTab === 'eval' && pipelineReadiness.active_positions === 0 && (
          <div className="flex items-center gap-2.5 px-4 py-2.5 bg-surface2 border-b border-borderLight">
            <span className="text-textDim text-sm shrink-0">◉</span>
            <p className="text-xs text-textDim flex-1">No active positions to evaluate — agent scoring requires at least one ACTIVE or PENDING strategy.</p>
          </div>
        )}

        {/* Row 1: Focus prompt (research + trade tabs) + Run button */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-borderLight">
          {(activeTab === 'research' || activeTab === 'trade') && (
            <>
              <span className="text-[10px] font-semibold text-textDim uppercase tracking-widest shrink-0">Focus</span>
              <input
                type="text"
                value={investmentFocus}
                onChange={e => setInvestmentFocus(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveInvestmentFocus(investmentFocus); }}
                placeholder="e.g. AI semiconductors, Indian IT, Bitcoin momentum…"
                className="flex-1 bg-transparent text-xs text-textMain placeholder-textDim focus:outline-none min-w-0"
              />
              {investmentFocus && (
                <button
                  onClick={() => saveInvestmentFocus(investmentFocus)}
                  className={`shrink-0 px-2.5 py-1 rounded text-[10px] font-semibold border transition-all ${investmentFocusSaved ? 'bg-up-bg text-up border-up/30' : 'bg-surface2 border-borderMid text-textMuted hover:border-brand-500 hover:text-brand-400'}`}
                >{investmentFocusSaved ? '✓ Saved' : 'Save'}</button>
              )}
              <div className="h-4 w-px bg-borderLight shrink-0" />
            </>
          )}
          {activeTab === 'eval' && (
            <p className="flex-1 text-xs text-textDim">Score active strategies, run post-mortem analysis, and evolve underperforming agents.</p>
          )}
          {tabIsActive(activeTab) ? (
            <button onClick={() => handleStopPipeline(activeTab)} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-down/40 bg-down-bg text-down-text hover:opacity-80 transition-opacity">
              ■ Stop
            </button>
          ) : (
            <>
              {activeTab === 'research' && (
                <button
                  onClick={handleResearchTrigger}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border bg-cyan-700 border-cyan-600 text-white hover:bg-cyan-600 transition-colors"
                >
                  ◎ {focusTickers.length > 0 ? `Collect · ${focusTickers.length} ticker${focusTickers.length !== 1 ? 's' : ''}` : 'Collect Data'}
                </button>
              )}
              {activeTab === 'trade' && (
                <button
                  onClick={handleTradeTrigger}
                  disabled={!pipelineReadiness.has_research_data}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    pipelineReadiness.has_research_data
                      ? 'bg-brand-600 border-brand-500 text-white hover:bg-brand-500'
                      : 'bg-surface2 border-borderLight text-textDim cursor-not-allowed opacity-50'
                  }`}
                  title={pipelineReadiness.has_research_data ? 'Generate trades using last research context' : 'Run Data Collection first'}
                >
                  ◈ {focusTickers.length > 0 ? `Generate · ${focusTickers.length} ticker${focusTickers.length !== 1 ? 's' : ''}` : 'Generate Trades'}
                </button>
              )}
              {activeTab === 'eval' && (
                <button
                  onClick={handleEvalTrigger}
                  disabled={pipelineReadiness.active_positions === 0}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    pipelineReadiness.active_positions > 0
                      ? 'border-purple-700/50 bg-purple-900/20 text-purple-400 hover:bg-purple-800/30'
                      : 'bg-surface2 border-borderLight text-textDim cursor-not-allowed opacity-50'
                  }`}
                  title={pipelineReadiness.active_positions === 0 ? 'No active positions to evaluate' : `Evaluate ${pipelineReadiness.active_positions} active position${pipelineReadiness.active_positions !== 1 ? 's' : ''}`}
                >
                  ◉ Evaluate Agents
                  {pipelineReadiness.active_positions > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 rounded-full bg-purple-700/40 text-purple-300 text-[10px] font-semibold leading-none">
                      {pipelineReadiness.active_positions}
                    </span>
                  )}
                </button>
              )}
            </>
          )}
        </div>

        {/* Row 2: Sector pills + ticker search (research + trade tabs) */}
        {(activeTab === 'research' || activeTab === 'trade') && <div className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
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
                      className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${isActiveFilter ? 'bg-cyan-700 border-cyan-600 text-white' : 'bg-surface2 border-borderLight text-textMuted hover:border-cyan-500 hover:text-cyan-400'}`}
                    >
                      <span className="mr-1 opacity-60">{MARKET_ICONS[market]}</span>{sector}
                    </button>
                  );
                })
              )}
          </div>
          {/* Ticker search */}
          <div className="relative shrink-0 w-56">
            <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border bg-surface2 transition-colors ${focusSearchOpen ? 'border-cyan-500' : 'border-borderLight'}`}>
              <span className="text-textDim text-[10px] shrink-0">{tickerSearchLoading ? <span className="animate-spin inline-block">↻</span> : '⌕'}</span>
              <input type="text" value={focusSearch}
                onChange={e => {
                  const val = e.target.value; setFocusSearch(val); setFocusSearchOpen(true);
                  if (focusSearchTimerRef.current) clearTimeout(focusSearchTimerRef.current);
                  if (!val.trim()) { setTickerSearchResults([]); setTickerSearchLoading(false); return; }
                  setTickerSearchLoading(true);
                  focusSearchTimerRef.current = setTimeout(async () => {
                    try { const res = await apiFetch(`/search/tickers?q=${encodeURIComponent(val.trim())}`); if (res.ok) setTickerSearchResults(await res.json()); } catch { /* network */ }
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
            <button onClick={() => { setFocusTickers(() => []); setFocusSectorFilter(null); }} className="text-[10px] text-textDim hover:text-textMuted transition-colors shrink-0">✕ Clear</button>
          )}
        </div>}

        {/* Row 3: Selected tickers (research + trade tabs) */}
        {(activeTab === 'research' || activeTab === 'trade') && focusTickers.length > 0 && (
          <div className="px-4 py-2 border-t border-borderLight flex flex-wrap gap-1.5 bg-surface2/40">
            {focusTickers.map(t => (
              <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono bg-cyan-900/40 border border-cyan-700/40 text-cyan-300">
                {t}
                <button onClick={() => setFocusTickers(p => p.filter(x => x !== t))} className="hover:text-cyan-200 text-[9px] leading-none ml-0.5 opacity-60 hover:opacity-100">✕</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Two-column layout ─────────────────────────────────────────────────── */}
      <div className="flex gap-0 border border-borderLight rounded-xl overflow-hidden" style={{ minHeight: '560px' }}>

        {/* Left: run list */}
        <div className="w-72 shrink-0 border-r border-borderLight bg-surface2 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-borderLight flex items-center gap-2">
            <p className="text-[10px] font-semibold text-textDim uppercase tracking-widest">
              {TAB_CONFIG.find(t => t.id === activeTab)?.icon} {TAB_CONFIG.find(t => t.id === activeTab)?.label} Runs
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {/* Live / current tab — only shown while this tab's pipeline is running */}
            {tabIsActive(activeTab) && (
              <button
                onClick={() => { setSelectedRunId(null); setSelectedRunEvents([]); setStepsExpanded(false); }}
                className={`w-full text-left px-4 py-3 border-b border-borderLight transition-colors ${viewingLive ? `bg-surface border-l-2 ${TAB_CONFIG.find(t => t.id === activeTab)?.borderColor}` : 'hover:bg-surface3'}`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping shrink-0" />
                  <span className="text-xs font-semibold text-textMain truncate">Running</span>
                </div>
                <p className="text-[10px] text-textDim pl-4">Running…</p>
              </button>
            )}

            {/* Past runs — filtered by tab, paginated */}
            {(() => {
              const tabRuns = pipelineRuns.filter(r => {
                if (r.status === 'running') return false;
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
                    return (
                      <button key={run.run_id}
                        onClick={() => { loadRunEvents(run.run_id); setStepsExpanded(false); }}
                        className={`w-full text-left px-4 py-3 border-b border-borderLight transition-colors ${isSelected ? `bg-surface border-l-2 ${tabCfg.borderColor}` : 'hover:bg-surface3'}`}
                      >
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`text-xs shrink-0 ${run.status === 'done' ? 'text-up' : run.status === 'error' ? 'text-down' : 'text-yellow-500'}`}>
                            {run.status === 'done' ? '✓' : run.status === 'error' ? '✕' : '⏹'}
                          </span>
                          <span className="text-[11px] font-mono text-textMuted truncate">{run.run_id.substring(0, 8)}</span>
                        </div>
                        <p className="text-[10px] text-textDim pl-4">
                          {new Date(run.started_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {dur}s
                        </p>
                        {activeTab !== 'eval' && params && (params.focus || (params.tickers && params.tickers.length > 0)) && (
                          <div className="pl-4 mt-0.5 flex flex-wrap gap-1">
                            {params.focus && (
                              <span className="text-[9px] text-brand-400 bg-brand-900/30 px-1 py-0.5 rounded truncate max-w-[110px]">{params.focus}</span>
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
                    <div className="flex items-center justify-between px-4 py-2 border-t border-borderLight bg-surface2/60 shrink-0">
                      <button
                        onClick={() => setRunsPage(p => Math.max(0, p - 1))}
                        disabled={runsPage === 0}
                        className="text-[10px] text-textDim hover:text-textMuted disabled:opacity-30 disabled:cursor-not-allowed px-1.5 py-0.5 rounded hover:bg-surface3 transition-colors"
                      >‹ Prev</button>
                      <span className="text-[9px] text-textDim font-mono">{runsPage + 1}/{totalPages}</span>
                      <button
                        onClick={() => setRunsPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={runsPage >= totalPages - 1}
                        className="text-[10px] text-textDim hover:text-textMuted disabled:opacity-30 disabled:cursor-not-allowed px-1.5 py-0.5 rounded hover:bg-surface3 transition-colors"
                      >Next ›</button>
                    </div>
                  )}
                </>
              );
            })()}

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
            {pipelineRunsLoaded && !pipelineRuns.some(r => runTypeToTab(r.run_type) === activeTab && r.status !== 'running') && (
              <p className="px-4 py-4 text-[11px] text-textDim">No {activeTab} runs yet.</p>
            )}
          </div>
        </div>

        {/* Right: main panel */}
        <div className="flex-1 min-w-0 bg-background flex flex-col overflow-hidden">
          {/* Panel header */}
          <div className="px-5 py-3 border-b border-borderLight bg-surface2 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              {viewingLive ? (
                tabIsActive(activeTab) ? (
                  <span className="flex items-center gap-1.5 text-xs text-amber-400 font-medium">
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
              {viewingLive && tabIsActive(activeTab) && (currentRunIdResearch || currentRunIdTrade || currentRunIdEval) && (
                <span className="text-[10px] text-textDim font-mono bg-surface3 px-2 py-0.5 rounded">
                  run/{(activeTab === 'research' ? currentRunIdResearch : activeTab === 'eval' ? currentRunIdEval : currentRunIdTrade)?.substring(0, 8)}…
                </span>
              )}
            </div>
            {focusTickers.length > 0 && viewingLive && !tabIsActive(activeTab) && (
              <span className="text-[10px] text-brand-400 bg-brand-900/40 border border-brand-700/30 px-2 py-0.5 rounded-full font-mono">
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
