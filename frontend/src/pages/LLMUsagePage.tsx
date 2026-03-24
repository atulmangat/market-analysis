import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../utils';
import type { LLMUsageStats, LLMDailyUsage } from '../types';

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtCost(c: number): string {
  if (c === 0) return '$0.00';
  if (c < 0.001) return `$${c.toFixed(6)}`;
  if (c < 0.01) return `$${c.toFixed(4)}`;
  return `$${c.toFixed(4)}`;
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 2;
  return (
    <div className="h-1.5 w-full bg-surface2 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

const CALLER_LABELS: Record<string, string> = {
  agent:        'Agent Debates',
  judge:        'Judge',
  kg_ingest:    'Knowledge Graph',
  validator:    'Validator / Eval',
  dispatcher:   'Dispatcher',
  memory:       'Memory Consolidation',
  agent_builder:'Agent Builder',
  unknown:      'Other',
};

const MODEL_COLORS = [
  'bg-brand-500', 'bg-purple-500', 'bg-teal-500', 'bg-amber-500', 'bg-rose-500',
  'bg-cyan-500', 'bg-indigo-500', 'bg-orange-500',
];

export default function LLMUsagePage() {
  const [stats, setStats] = useState<LLMUsageStats | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const fetchIdRef = useRef(0);

  useEffect(() => {
    const id = ++fetchIdRef.current;
    apiFetch(`/llm/usage?days=${days}`)
      .then(r => r.json())
      .then((data: LLMUsageStats) => { if (id === fetchIdRef.current) { setStats(data); setLoading(false); } })
      .catch(() => { if (id === fetchIdRef.current) { setStats(null); setLoading(false); } });
  }, [days]);

  const totals = stats?.totals ?? { prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0, total_tokens: 0, cost: 0, calls: 0 };
  const dailyData: LLMDailyUsage[] = stats?.daily ?? [];
  const maxDaily = Math.max(...dailyData.map(d => d.total_tokens), 1);

  // Completion = output - reasoning (the "real" output the model wrote)
  const realOutput = totals.completion_tokens - totals.reasoning_tokens;
  const reasoningPct = totals.completion_tokens > 0
    ? Math.round((totals.reasoning_tokens / totals.completion_tokens) * 100) : 0;

  return (
    <div className="p-5 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-textMain">LLM Usage</h1>
          <p className="text-xs text-textDim mt-0.5">Token consumption across all pipeline components</p>
        </div>
        <div className="flex gap-1.5">
          {[7, 14, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
                days === d
                  ? 'bg-brand-500 text-white border-brand-500'
                  : 'bg-surface border-borderLight text-textDim hover:text-textMain'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 bg-surface2 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {!loading && stats && (
        <>
          {/* Stat cards — 5 across */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Total Tokens',     value: fmt(totals.total_tokens),      sub: `${days}d window` },
              { label: 'Prompt Tokens',    value: fmt(totals.prompt_tokens),      sub: `${totals.total_tokens > 0 ? Math.round(totals.prompt_tokens / totals.total_tokens * 100) : 0}% of total` },
              { label: 'Output Tokens',    value: fmt(realOutput),                sub: `excl. reasoning` },
              { label: 'Reasoning Tokens', value: fmt(totals.reasoning_tokens),   sub: `${reasoningPct}% of completion · chain-of-thought` },
              { label: 'Total Calls',      value: totals.calls.toLocaleString(),  sub: `${totals.calls > 0 && dailyData.length > 0 ? (totals.calls / dailyData.length).toFixed(1) : '0'} avg/day` },
            ].map(s => (
              <div key={s.label} className="bg-surface border border-borderLight rounded-xl p-4">
                <p className="text-[10px] text-textDim uppercase tracking-widest font-semibold">{s.label}</p>
                <p className="text-xl font-bold text-textMain mt-1 tabular-nums">{s.value}</p>
                <p className="text-[10px] text-textDim mt-0.5">{s.sub}</p>
              </div>
            ))}
          </div>

          {/* Daily Usage Chart */}
          {dailyData.length > 0 && (
            <div className="bg-surface border border-borderLight rounded-xl p-4">
              <p className="text-[10px] font-semibold text-textDim uppercase tracking-widest mb-4">Daily Token Usage</p>
              <div className="flex items-end gap-1 h-32">
                {dailyData.map(d => {
                  const pct = maxDaily > 0 ? (d.total_tokens / maxDaily) * 100 : 0;
                  const promptPct   = d.total_tokens > 0 ? (d.prompt_tokens / d.total_tokens) * 100 : 0;
                  const reasonPct   = d.completion_tokens > 0 ? (d.reasoning_tokens / d.completion_tokens) * 100 : 0;
                  const completionH = (100 - promptPct);          // completion share of bar
                  const reasonH     = completionH * reasonPct / 100; // reasoning sub-share
                  return (
                    <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5 group/bar relative min-w-0">
                      <div className="w-full flex flex-col justify-end rounded overflow-hidden" style={{ height: '112px' }}>
                        <div
                          className="w-full rounded bg-brand-500/80 group-hover/bar:bg-brand-500 transition-colors cursor-default relative overflow-hidden"
                          style={{ height: `${Math.max(2, pct)}%` }}
                        >
                          {/* completion layer (purple) */}
                          <div className="absolute bottom-0 left-0 right-0 bg-purple-500/60" style={{ height: `${completionH}%` }} />
                          {/* reasoning layer (amber) on top of completion */}
                          <div className="absolute bottom-0 left-0 right-0 bg-amber-400/70" style={{ height: `${reasonH}%` }} />
                        </div>
                      </div>
                      {/* Tooltip */}
                      <div className="pointer-events-none absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 z-10 opacity-0 group-hover/bar:opacity-100 transition-opacity whitespace-nowrap">
                        <div className="bg-surface border border-borderLight rounded-lg px-2.5 py-1.5 shadow-xl text-[10px] space-y-0.5">
                          <p className="font-semibold text-textMain">{d.date}</p>
                          <p className="text-textDim">Total: <span className="text-textMain">{fmt(d.total_tokens)}</span></p>
                          <p className="text-textDim">Prompt: <span className="text-brand-400">{fmt(d.prompt_tokens)}</span></p>
                          <p className="text-textDim">Output: <span className="text-purple-400">{fmt(d.completion_tokens - d.reasoning_tokens)}</span></p>
                          <p className="text-textDim">Reasoning: <span className="text-amber-400">{fmt(d.reasoning_tokens)}</span></p>
                          <p className="text-textDim">Calls: <span className="text-textMain">{d.calls}</span></p>
                          {d.cost > 0 && <p className="text-textDim">Cost: <span className="text-green-400">{fmtCost(d.cost)}</span></p>}
                        </div>
                      </div>
                      <p className="text-[8px] text-textDim truncate w-full text-center">{d.date.slice(5)}</p>
                    </div>
                  );
                })}
              </div>
              {/* Legend */}
              <div className="flex gap-4 mt-2">
                {[
                  { color: 'bg-brand-500',    label: 'Prompt' },
                  { color: 'bg-purple-500/60', label: 'Output' },
                  { color: 'bg-amber-400/70',  label: 'Reasoning (chain-of-thought)' },
                ].map(l => (
                  <div key={l.label} className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-sm ${l.color}`} />
                    <span className="text-[10px] text-textDim">{l.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            {/* By Model */}
            <div className="bg-surface border border-borderLight rounded-xl p-4">
              <p className="text-[10px] font-semibold text-textDim uppercase tracking-widest mb-4">By Model</p>
              {stats.by_model.length === 0 ? (
                <p className="text-xs text-textDim italic">No data yet</p>
              ) : (
                <div className="space-y-3">
                  {stats.by_model.map((m, i) => {
                    const shortName = m.model.split('/').pop() ?? m.model;
                    const mReasonPct = m.completion_tokens > 0
                      ? Math.round((m.reasoning_tokens / m.completion_tokens) * 100) : 0;
                    return (
                      <div key={m.model} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${MODEL_COLORS[i % MODEL_COLORS.length]}`} />
                            <p className="text-xs text-textMain truncate" title={m.model}>{shortName}</p>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                            <span className="text-[10px] text-textDim">{m.calls} calls</span>
                            <span className="text-xs font-medium text-textMain tabular-nums">{fmt(m.total_tokens)}</span>
                          </div>
                        </div>
                        <Bar value={m.total_tokens} max={stats.by_model[0].total_tokens} color={MODEL_COLORS[i % MODEL_COLORS.length]} />
                        <div className="flex gap-3 text-[9px] text-textDim">
                          <span>Prompt: {fmt(m.prompt_tokens)}</span>
                          <span>Output: {fmt(m.completion_tokens - m.reasoning_tokens)}</span>
                          {m.reasoning_tokens > 0 && <span className="text-amber-500">Reasoning: {fmt(m.reasoning_tokens)} ({mReasonPct}%)</span>}
                          {m.cost > 0 && <span className="text-green-500">{fmtCost(m.cost)}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* By Component */}
            <div className="bg-surface border border-borderLight rounded-xl p-4">
              <p className="text-[10px] font-semibold text-textDim uppercase tracking-widest mb-4">By Component</p>
              {stats.by_caller.length === 0 ? (
                <p className="text-xs text-textDim italic">No data yet</p>
              ) : (
                <div className="space-y-3">
                  {stats.by_caller.map((c, i) => (
                    <div key={c.caller} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${MODEL_COLORS[i % MODEL_COLORS.length]}`} />
                          <p className="text-xs text-textMain">{CALLER_LABELS[c.caller] ?? c.caller}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-textDim">{c.calls} calls</span>
                          <span className="text-xs font-medium text-textMain tabular-nums">{fmt(c.total_tokens)}</span>
                        </div>
                      </div>
                      <Bar value={c.total_tokens} max={stats.by_caller[0].total_tokens} color={MODEL_COLORS[i % MODEL_COLORS.length]} />
                      <div className="flex gap-3 text-[9px] text-textDim">
                        {c.reasoning_tokens > 0 && <span className="text-amber-500">Reasoning: {fmt(c.reasoning_tokens)}</span>}
                        {c.cost > 0 && <span className="text-green-500">{fmtCost(c.cost)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* No data state */}
          {totals.calls === 0 && (
            <div className="text-center py-12 text-textDim">
              <p className="text-4xl mb-3">⬡</p>
              <p className="text-sm font-medium text-textMain">No usage data yet</p>
              <p className="text-xs mt-1">Run a pipeline to start tracking token usage</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
