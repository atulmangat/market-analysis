import { useRef, useState } from 'react';
import type { PipelineEvent, PipelineRun, WebResearch } from '../types';
import { STEP_META, MARKET_SECTORS, MARKET_ICONS, TICKER_DB } from '../constants';
import { apiFetch, getMarketForTicker } from '../utils';

interface PipelinePagesProps {
  isTriggering: boolean;
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
  setResearchStepOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
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
  handleStopPipeline: () => void;
  loadRunEvents: (runId: string) => void;
  openReport: (id: number) => void;
}

const ORDERED_STEPS = [
  'START', 'WEB_RESEARCH', 'KG_INGEST', 'DEBATE_PANEL', 'AGENT_QUERY', 'JUDGE', 'DEPLOY', 'MEMORY_WRITE',
];

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

const STEP_DESC: Record<string, string> = {
  START:        'Acquiring lock and initialising the run',
  WEB_RESEARCH: 'Fetching live news, prices and research for all tickers',
  KG_INGEST:    'Extracting events and relationships into the knowledge graph',
  DEBATE_PANEL: 'Spinning up 4 specialised agents with shared context',
  AGENT_QUERY:  'Value Investor · Technical Analyst · Macro Economist · Sentiment Analyst',
  JUDGE:        'Independent LLM reviewing all proposals and picking the best trade',
  DEPLOY:       'Saving strategy with entry price and position sizing',
  MEMORY_WRITE: 'Writing outcome notes to each agent\'s persistent memory',
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

function getCompletedSteps(events: PipelineEvent[]): Set<string> {
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
    return ORDERED_STEPS.indexOf(inProgress.step);
  })();
  if (currentInProgressIdx > 0) {
    for (let i = 0; i < currentInProgressIdx; i++) {
      if (events.some(e => e.step === ORDERED_STEPS[i])) {
        done.add(ORDERED_STEPS[i]);
      }
    }
  }
  return done;
}

function isRunComplete(events: PipelineEvent[]): boolean {
  return events.some(e => e.step === 'MEMORY_WRITE' && e.status === 'DONE');
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

export function PipelinePage({
  isTriggering, pipelineEvents, pipelineRunId, pipelineRuns, pipelineRunsLoaded,
  selectedRunId, selectedRunEvents, selectedRunLoading, research, researchStepOpen,
  enabledMarketNames, investmentFocus, investmentFocusSaved,
  focusTickers, focusSearch, focusSearchOpen, focusSectorFilter,
  tickerSearchResults, tickerSearchLoading,
  setResearchStepOpen, setSelectedRunId, setSelectedRunEvents,
  setInvestmentFocus, setFocusTickers, setFocusSearch, setFocusSearchOpen,
  setFocusSectorFilter, setTickerSearchResults, setTickerSearchLoading,
  saveInvestmentFocus, handleManualTrigger, handleStopPipeline, loadRunEvents, openReport,
}: PipelinePagesProps) {
  const isActive = isTriggering;
  const focusSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [stepsExpanded, setStepsExpanded] = useState(false);
  const [runsPage, setRunsPage] = useState(0);
  const RUNS_PER_PAGE = 10;

  const viewingLive = selectedRunId === null;
  const panelEvents = viewingLive ? pipelineEvents : selectedRunEvents;


  const focusVisibleResults = tickerSearchResults.filter(r => !focusTickers.includes(r.symbol));
  const showFocusDropdown = focusSearchOpen && (tickerSearchLoading || focusVisibleResults.length > 0);

  const addFocusTicker = (sym: string) => {
    if (!focusTickers.includes(sym)) setFocusTickers(p => [...p, sym]);
    setFocusSearch(''); setFocusSearchOpen(false); setTickerSearchResults([]);
  };

  // ── Active Run View ──────────────────────────────────────────────────────────
  const renderActiveView = (events: PipelineEvent[]) => {
    const currentStep = getCurrentStep(events);
    const completedSteps = getCompletedSteps(events);
    const stepIndex = currentStep ? ORDERED_STEPS.indexOf(currentStep) : -1;
    const totalSteps = ORDERED_STEPS.length;
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
          {ORDERED_STEPS.map(s => {
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

  // ── Completed / Past Run View ─────────────────────────────────────────────
  const renderCompletedView = (events: PipelineEvent[], run?: PipelineRun) => {
    // Use run.status as the authoritative signal — events may be incomplete if
    // the Vercel function timed out before the final MEMORY_WRITE DONE log.
    const complete = run?.status === 'done' || isRunComplete(events);
    // Only show as errored if the run didn't complete — intermediate errors (e.g. KG_INGEST)
    // are non-fatal and the pipeline can still finish successfully.
    const errored = !complete && (run?.status === 'error' || hasError(events));
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
              {ORDERED_STEPS.map(s => {
                const ran = events.some(e => e.step === s);
                const failed = events.some(e => e.step === s && e.status === 'ERROR');
                const c = STEP_COLORS[s] ?? STEP_COLORS.START;
                const m = STEP_META[s];
                if (!ran) return (
                  <span key={s} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-borderLight text-textDim opacity-35">
                    <span>{m?.icon}</span><span>{STEP_LABELS[s]}</span>
                  </span>
                );
                return (
                  <span key={s} className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border ${
                    failed ? 'border-down/40 text-down-text bg-down-bg' : `${c.ring} ${c.text} ${c.bg}`
                  }`}>
                    <span>{m?.icon}</span>
                    <span>{STEP_LABELS[s]}</span>
                    {failed ? <span className="text-down-text">✕</span> : <span className="opacity-60">✓</span>}
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
                  if (ev.status === 'IN_PROGRESS' && !isActive && !hasLaterResolution) {
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

  // ── Idle / Blueprint View ────────────────────────────────────────────────
  const renderIdleView = () => (
    <div className="flex-1 flex flex-col items-center justify-center px-8 py-12">
      <div className="w-full max-w-sm">
        <p className="text-[10px] font-semibold text-textDim uppercase tracking-widest mb-6 text-center">Pipeline steps</p>
        <div className="relative">
          <div className="absolute left-[13px] top-0 bottom-0 w-px bg-borderLight" />
          <div className="space-y-0">
            {ORDERED_STEPS.map((s, i) => {
              const c = STEP_COLORS[s] ?? STEP_COLORS.START;
              const m = STEP_META[s];
              return (
                <div key={i} className="flex items-start gap-4 py-2.5">
                  <div className={`relative z-10 shrink-0 h-7 w-7 rounded-full bg-surface3 border border-borderMid flex items-center justify-center`}>
                    <span className={`text-xs ${c.text} opacity-50`}>{m?.icon ?? '·'}</span>
                  </div>
                  <div className="pt-0.5">
                    <p className="text-xs font-medium text-textMain">{STEP_LABELS[s]}</p>
                    <p className="text-[11px] text-textDim mt-0.5">{STEP_DESC[s]}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  // ── Decide what to render in main panel ──────────────────────────────────
  const renderPanel = () => {
    if (selectedRunLoading && !viewingLive) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center px-8 py-12 space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="w-full max-w-sm flex items-center gap-3 animate-pulse">
              <div className="h-7 w-7 rounded-full bg-surface3 shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-surface3 rounded" style={{ width: `${55 - i * 5}%` }} />
                <div className="h-2.5 bg-surface3 rounded" style={{ width: `${75 - i * 5}%` }} />
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (!viewingLive) {
      // Past run
      const run = pipelineRuns.find(r => r.run_id === selectedRunId);
      if (panelEvents.length === 0) return <p className="flex-1 flex items-center justify-center text-sm text-textMuted">No events recorded for this run.</p>;
      return renderCompletedView(panelEvents, run);
    }

    // Live view
    if (isActive && !isRunComplete(panelEvents)) return renderActiveView(panelEvents);
    // Not active and no run selected → show idle blueprint
    return renderIdleView();
  };

  return (
    <div className="space-y-4">
      {/* ── Control bar ─────────────────────────────────────────────────────── */}
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
            <button
              onClick={() => handleManualTrigger(focusTickers.length > 0 ? focusTickers : undefined)}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border bg-brand-600 border-brand-500 text-white hover:bg-brand-500 transition-colors"
            >
              ▶ {focusTickers.length > 0 ? `Run ${focusTickers.length} ticker${focusTickers.length !== 1 ? 's' : ''}` : 'Run Pipeline'}
            </button>
          )}
        </div>

        {/* Row 2: Sector pills + ticker search */}
        <div className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
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
        </div>

        {/* Row 3: Selected tickers */}
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

      {/* ── Two-column layout ─────────────────────────────────────────────────── */}
      <div className="flex gap-0 border border-borderLight rounded-xl overflow-hidden" style={{ minHeight: '560px' }}>

        {/* Left: run list */}
        <div className="w-52 shrink-0 border-r border-borderLight bg-surface2 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-borderLight">
            <p className="text-[10px] font-semibold text-textDim uppercase tracking-widest">Runs</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {/* Live / current tab — only shown while a pipeline is actively running */}
            {isActive && (
              <button
                onClick={() => { setSelectedRunId(null); setSelectedRunEvents([]); setStepsExpanded(false); }}
                className={`w-full text-left px-4 py-3 border-b border-borderLight transition-colors ${viewingLive ? 'bg-surface border-l-2 border-l-brand-500' : 'hover:bg-surface3'}`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping shrink-0" />
                  <span className="text-xs font-semibold text-textMain truncate">Running</span>
                </div>
                <p className="text-[10px] text-textDim pl-4">Running…</p>
              </button>
            )}

            {/* Past runs — paginated */}
            {(() => {
              const pastRuns = pipelineRuns.filter(r => r.status !== 'running');
              const totalPages = Math.ceil(pastRuns.length / RUNS_PER_PAGE);
              const pageRuns = pastRuns.slice(runsPage * RUNS_PER_PAGE, (runsPage + 1) * RUNS_PER_PAGE);
              return (
                <>
                  {pageRuns.map(run => {
                    const isSelected = selectedRunId === run.run_id;
                    const dur = Math.round((new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()) / 1000);
                    const params = run.run_params;
                    return (
                      <button key={run.run_id}
                        onClick={() => { loadRunEvents(run.run_id); setStepsExpanded(false); }}
                        className={`w-full text-left px-4 py-3 border-b border-borderLight transition-colors ${isSelected ? 'bg-surface border-l-2 border-l-brand-500' : 'hover:bg-surface3'}`}
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
                        {params && (params.focus || (params.tickers && params.tickers.length > 0)) && (
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
            {pipelineRunsLoaded && pipelineRuns.length === 0 && (
              <p className="px-4 py-4 text-[11px] text-textDim">No past runs yet.</p>
            )}
          </div>
        </div>

        {/* Right: main panel */}
        <div className="flex-1 min-w-0 bg-background flex flex-col overflow-hidden">
          {/* Panel header */}
          <div className="px-5 py-3 border-b border-borderLight bg-surface2 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              {viewingLive ? (
                isActive ? (
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
              {viewingLive && isActive && pipelineRunId && (
                <span className="text-[10px] text-textDim font-mono bg-surface3 px-2 py-0.5 rounded">
                  run/{pipelineRunId.substring(0, 8)}…
                </span>
              )}
            </div>
            {focusTickers.length > 0 && viewingLive && !isActive && (
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
