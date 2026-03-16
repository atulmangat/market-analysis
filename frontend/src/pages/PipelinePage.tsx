import { useRef } from 'react';
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

  // Determine which run's events to show in the right panel
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
    const errorEvent = events.find(e => e.status === 'ERROR');
    const lastEvent = events[events.length - 1];
    const dur = Math.round((new Date(lastEvent.created_at).getTime() - new Date(events[0].created_at).getTime()) / 1000);
    const errorStep = errorEvent?.step ?? null;
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
              const hasLaterResolution = ev.status === 'IN_PROGRESS' && events.slice(idx + 1).some(e => e.step === ev.step && (e.status === 'DONE' || e.status === 'ERROR'));
              let displayStatus = ev.status;
              if (ev.status === 'IN_PROGRESS' && (!isActive || hasLaterResolution)) {
                if (!isActive && hasError && ev.step === errorStep && !hasLaterResolution) {
                  displayStatus = 'ERROR';
                } else {
                  displayStatus = 'DONE';
                }
              }
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
                          try { domain = new URL(r.source_url).hostname.replace('www.', ''); } catch { /* invalid URL */ }
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
          <div className={`border-t border-borderLight ${hasError ? 'bg-down/5' : 'bg-up/5'}`}>
            {/* Skipped steps */}
            {hasError && (() => {
              const ranSteps = new Set(events.map(e => e.step));
              const skipped = PIPELINE_STEPS.filter(s => !ranSteps.has(s.step) && s.step !== 'START');
              if (!skipped.length) return null;
              return (
                <div className="px-5 py-3 border-b border-borderLight/50 flex flex-wrap gap-2 items-center">
                  <span className="text-[10px] text-textDim uppercase tracking-wider font-semibold shrink-0">Skipped:</span>
                  {skipped.map(s => (
                    <span key={s.step} className="flex items-center gap-1 text-[10px] text-textDim bg-surface3 border border-borderLight px-2 py-0.5 rounded opacity-50">
                      <span>{STEP_META[s.step]?.icon ?? '·'}</span>
                      <span>{s.label}</span>
                    </span>
                  ))}
                </div>
              );
            })()}
            <div className="px-5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold ${hasError ? 'text-down' : 'text-up'}`}>
                  {hasError ? '✕ Failed' : '✓ Completed'}
                </span>
                {hasError && errorEvent && (
                  <span className="text-[10px] text-textDim">
                    at <span className="font-semibold text-down">{STEP_META[errorEvent.step]?.label ?? errorEvent.step}</span>
                    {errorEvent.detail && <span className="ml-1 opacity-70">— {errorEvent.detail.slice(0, 80)}{errorEvent.detail.length > 80 ? '…' : ''}</span>}
                  </span>
                )}
              </div>
              <span className="text-[11px] text-textDim font-mono">{events.length} events · {dur}s</span>
            </div>
          </div>
        ) : null}
      </>
    );
  };

  // Ticker search helpers
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

            {/* Past run tabs — exclude the currently-running run (shown in Live tab) */}
            {pipelineRuns.filter(r => !isActive || r.run_id !== pipelineRunId).map(run => {
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
                      <span className={`text-xs font-mono truncate ${run.status === 'error' ? 'text-down' : 'text-textMuted'}`}>
                        {run.status === 'error' ? 'Failed' : `${run.run_id.substring(0, 8)}…`}
                      </span>
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
            const winnerMarket = getMarketForTicker(out.ticker);
            const winnerMarketEnabled = enabledMarketNames.length === 0 || enabledMarketNames.includes(winnerMarket);
            const visibleProposals = out.proposals.filter(p => {
              const m = getMarketForTicker(p.ticker);
              return enabledMarketNames.length === 0 || enabledMarketNames.includes(m);
            });
            const hiddenCount = out.proposals.length - visibleProposals.length;
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
                      <span className="text-[10px] text-textDim bg-surface3 border border-borderLight px-1.5 py-0.5 rounded">{winnerMarket}</span>
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
                  {/* Disabled market warning */}
                  {!winnerMarketEnabled && (
                    <div className="px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/20 flex items-center gap-2">
                      <span className="text-yellow-400 text-[10px]">⚠</span>
                      <span className="text-[10px] text-yellow-400">This run's winner ({out.ticker}) is from the <strong>{winnerMarket}</strong> market which is now disabled. It will not appear on the dashboard.</span>
                    </div>
                  )}
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
                  {/* Agent proposals — only from enabled markets */}
                  {visibleProposals.length > 0 && (
                    <div className="divide-y divide-borderLight">
                      {visibleProposals.map((p, i) => {
                        const pMarket = getMarketForTicker(p.ticker);
                        return (
                          <div key={i} className="px-4 py-3 flex items-start gap-3">
                            <div className="shrink-0 mt-0.5">
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${p.action === 'LONG' ? 'bg-up/10 text-up' : 'bg-down/10 text-down'}`}>{p.action}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-[11px] font-semibold text-textMain">{p.agent_name}</span>
                                <span className="text-[10px] font-mono text-brand-400">{p.ticker}</span>
                                <span className="text-[9px] text-textDim bg-surface3 border border-borderLight px-1 py-0.5 rounded">{pMarket}</span>
                              </div>
                              <p className="text-[10px] text-textDim leading-relaxed line-clamp-2">{p.reasoning}</p>
                            </div>
                          </div>
                        );
                      })}
                      {hiddenCount > 0 && (
                        <div className="px-4 py-2 text-[10px] text-textDim text-center">
                          {hiddenCount} proposal{hiddenCount > 1 ? 's' : ''} from disabled market{hiddenCount > 1 ? 's' : ''} hidden
                        </div>
                      )}
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
}
