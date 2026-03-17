import { useState } from 'react';
import type { PortfolioPnl } from '../types';
import { Badge } from '../components/Badge';

interface PortfolioPageProps {
  portfolio: PortfolioPnl | null;
  budgetInput: string;
  editStratId: number | null;
  editStratForm: { position_size: string; notes: string };
  setBudgetInput: (v: string) => void;
  setEditStratId: (id: number | null) => void;
  setEditStratForm: (f: { position_size: string; notes: string }) => void;
  handleBudgetSave: (val: number) => void;
  handleUndeploy: (id: number) => void;
  handleStrategyUpdate: (id: number) => void;
  openReport: (id: number) => void;
  fetchData: () => void;
}

// ─── Palette — 8 distinct hues for position rings / rows ────────────────────
const HUE: string[] = [
  '#6366f1', '#06b6d4', '#f59e0b', '#22c55e',
  '#f43f5e', '#a78bfa', '#fb923c', '#34d399',
];

// ─── Pure SVG ring chart ─────────────────────────────────────────────────────
interface Seg { label: string; value: number; color: string }

function RingChart({ segs, size = 140 }: { segs: Seg[]; size?: number }) {
  const total = segs.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return null;
  const cx = size / 2, cy = size / 2;
  const R = size * 0.40, r = size * 0.27;
  const gap = 0.025; // radians gap between segments

  let angle = -Math.PI / 2;
  const arcs: { d: string; color: string; pct: number; label: string }[] = [];

  for (const seg of segs) {
    const sweep = (seg.value / total) * 2 * Math.PI - gap;
    if (sweep <= 0) { angle += (seg.value / total) * 2 * Math.PI; continue; }
    const a0 = angle + gap / 2, a1 = a0 + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const cos0 = Math.cos(a0), sin0 = Math.sin(a0);
    const cos1 = Math.cos(a1), sin1 = Math.sin(a1);
    const d = [
      `M ${cx + R * cos0} ${cy + R * sin0}`,
      `A ${R} ${R} 0 ${large} 1 ${cx + R * cos1} ${cy + R * sin1}`,
      `L ${cx + r * cos1} ${cy + r * sin1}`,
      `A ${r} ${r} 0 ${large} 0 ${cx + r * cos0} ${cy + r * sin0}`,
      'Z',
    ].join(' ');
    arcs.push({ d, color: seg.color, pct: (seg.value / total) * 100, label: seg.label });
    angle += (seg.value / total) * 2 * Math.PI;
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {arcs.map((a, i) => (
        <path key={i} d={a.d} fill={a.color}>
          <title>{a.label}: {a.pct.toFixed(1)}%</title>
        </path>
      ))}
    </svg>
  );
}

// ─── Inline budget editor ────────────────────────────────────────────────────
function BudgetCell({ value, input, setInput, onSave }: {
  value: number; input: string; setInput: (v: string) => void; onSave: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (!editing) return (
    <button
      onClick={() => setEditing(true)}
      className="group flex items-center gap-1.5 font-mono text-sm text-textMain hover:text-brand-400 transition-colors"
    >
      ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      <span className="text-[10px] text-textDim opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
    </button>
  );
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={e => { e.preventDefault(); onSave(parseFloat(input) || 0); setEditing(false); }}
    >
      <input
        autoFocus
        type="number"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => e.key === 'Escape' && setEditing(false)}
        className="w-24 bg-surface3 border border-brand-500/60 rounded px-2 py-0.5 text-xs font-mono text-textMain focus:outline-none"
      />
      <button type="submit" className="text-[10px] px-2 py-0.5 bg-brand-600 text-white rounded font-semibold">✓</button>
      <button type="button" onClick={() => setEditing(false)} className="text-[10px] text-textDim hover:text-textMain">✕</button>
    </form>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────
export function PortfolioPage({
  portfolio, budgetInput, editStratId, editStratForm,
  setBudgetInput, setEditStratId, setEditStratForm,
  handleBudgetSave, handleUndeploy, handleStrategyUpdate, openReport, fetchData,
}: PortfolioPageProps) {
  const p = portfolio;
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fmt$ = (v: number | null | undefined, digits = 2) =>
    v == null ? '—' : `${v < 0 ? '-' : '+'}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  const fmtPct = (v: number | null | undefined) =>
    v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

  const open   = p?.positions.filter(x => x.is_open)  ?? [];
  const closed = p?.positions.filter(x => !x.is_open) ?? [];

  const allocPct = p && p.total_budget > 0
    ? Math.min(100, (p.allocated / p.total_budget) * 100) : 0;

  // Ring segments: each open position + unallocated
  const ringSegs: Seg[] = open.map((pos, i) => ({
    label: pos.symbol,
    value: pos.position_size ?? (p ? p.total_budget / Math.max(open.length, 1) : 1),
    color: HUE[i % HUE.length],
  }));
  if (p && p.available > 0) ringSegs.push({ label: 'Free', value: p.available, color: '#26263a' });

  const CLOSE_STYLE: Record<string, { badge: string; border: string; label: string }> = {
    TAKE_PROFIT: { badge: 'text-up-text bg-up-bg border-up/30',   border: 'border-l-up',   label: '▲ TP' },
    STOP_LOSS:   { badge: 'text-down-text bg-down-bg border-down/30', border: 'border-l-down', label: '▼ SL' },
    MANUAL:      { badge: 'text-textDim bg-surface3 border-borderLight', border: 'border-l-borderMid', label: '· Closed' },
  };

  return (
    <div className="space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-[10px] font-semibold tracking-[0.15em] uppercase text-textDim">Portfolio</h2>
          {p && (
            <span className={`text-[11px] font-mono font-semibold ${(p.total_pnl ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>
              {fmtPct(p.total_pnl_pct)} total return
            </span>
          )}
        </div>
        <button
          onClick={fetchData}
          className="text-[10px] px-2.5 py-1.5 rounded border border-borderLight bg-surface2 text-textDim hover:border-brand-500/50 hover:text-brand-400 transition-all font-mono"
        >↻ refresh</button>
      </div>

      {/* ── Overview panel ─────────────────────────────────────────────────── */}
      {p && (
        <div className="bg-surface border border-borderLight rounded-xl overflow-hidden">
          <div className="flex flex-col sm:flex-row">

            {/* Ring chart column */}
            <div className="flex items-center justify-center px-8 py-6 sm:border-r border-borderLight shrink-0">
              <div className="relative">
                <RingChart segs={ringSegs} size={130} />
                {/* Centre text */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
                  <span className="text-[9px] text-textDim uppercase tracking-widest">alloc</span>
                  <span className="text-base font-mono font-bold text-textMain leading-none">{allocPct.toFixed(0)}%</span>
                </div>
              </div>
            </div>

            {/* Metrics — 3×2 grid */}
            <div className="flex-1 grid grid-cols-3 divide-x divide-y divide-borderLight">
              {[
                {
                  label: 'Total Budget',
                  value: (
                    <BudgetCell
                      value={p.total_budget}
                      input={budgetInput}
                      setInput={setBudgetInput}
                      onSave={handleBudgetSave}
                    />
                  ),
                  sub: null,
                },
                {
                  label: 'Allocated',
                  value: <span className="font-mono text-sm text-textMain">${p.allocated.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>,
                  sub: `${allocPct.toFixed(0)}% of budget`,
                },
                {
                  label: 'Available',
                  value: <span className={`font-mono text-sm ${p.available >= 0 ? 'text-up' : 'text-down'}`}>${p.available.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>,
                  sub: null,
                },
                {
                  label: 'Unrealized P&L',
                  value: <span className={`font-mono text-sm font-semibold ${(p.unrealized_pnl ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>{fmt$(p.unrealized_pnl)}</span>,
                  sub: `${open.length} open position${open.length !== 1 ? 's' : ''}`,
                },
                {
                  label: 'Realized P&L',
                  value: <span className={`font-mono text-sm font-semibold ${(p.realized_pnl ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>{fmt$(p.realized_pnl)}</span>,
                  sub: `${closed.length} closed`,
                },
                {
                  label: 'Total Return',
                  value: <span className={`font-mono text-sm font-semibold ${(p.total_pnl ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>{fmtPct(p.total_pnl_pct)}</span>,
                  sub: fmt$(p.total_pnl),
                },
              ].map((m, i) => (
                <div key={i} className="px-4 py-3.5">
                  <p className="text-[9px] text-textDim uppercase tracking-widest mb-1.5">{m.label}</p>
                  <div>{m.value}</div>
                  {m.sub && <p className="text-[10px] text-textDim mt-0.5">{m.sub}</p>}
                </div>
              ))}
            </div>
          </div>

          {/* Segmented allocation bar */}
          {p.total_budget > 0 && open.length > 0 && (
            <div className="border-t border-borderLight px-5 py-3">
              <div className="flex items-center gap-3">
                {/* Bar */}
                <div className="flex-1 h-1 rounded-full bg-surface3 overflow-hidden flex gap-px">
                  {open.map((pos, i) => {
                    const w = pos.position_size && p.total_budget > 0
                      ? (pos.position_size / p.total_budget) * 100
                      : allocPct / Math.max(open.length, 1);
                    return <div key={pos.id} className="h-full transition-all" style={{ width: `${w}%`, background: HUE[i % HUE.length] }} />;
                  })}
                </div>
                {/* Legend inline */}
                <div className="flex items-center gap-3 shrink-0">
                  {open.map((pos, i) => (
                    <span key={pos.id} className="flex items-center gap-1 text-[9px] font-mono">
                      <span className="w-1.5 h-1.5 rounded-full inline-block shrink-0" style={{ background: HUE[i % HUE.length] }} />
                      <span className="text-textDim">{pos.symbol.replace(/[.=].*/, '')}</span>
                    </span>
                  ))}
                  {p.using_assumed_sizes && <span className="text-[9px] text-amber-500/70">est.</span>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Open Positions table ────────────────────────────────────────────── */}
      <div>
        <p className="text-[9px] font-semibold tracking-[0.18em] uppercase text-textDim mb-2">
          Open Positions{open.length > 0 && <span className="ml-2 text-brand-400">{open.length}</span>}
        </p>

        {open.length === 0 ? (
          <div className="border border-borderLight rounded-xl bg-surface px-6 py-10 text-center text-xs text-textDim">
            No open positions.
          </div>
        ) : (
          <div className="border border-borderLight rounded-xl bg-surface overflow-hidden divide-y divide-borderLight">
            {/* Column headers */}
            <div className="grid grid-cols-[16px_1fr_auto_auto_auto_auto_auto] gap-x-4 px-4 py-2 bg-surface2">
              {['', 'Symbol', 'Invested', 'Entry', 'Live', 'P&L', ''].map((h, i) => (
                <span key={i} className="text-[9px] text-textDim uppercase tracking-widest font-semibold text-right first:text-left [&:nth-child(2)]:text-left last:text-right">{h}</span>
              ))}
            </div>

            {open.map((pos, i) => {
              const pnlUp = (pos.pnl_pct ?? 0) >= 0;
              const color = HUE[i % HUE.length];
              const isExpanded = expandedId === pos.id;
              const pct = pos.pnl_pct ?? 0;
              const fillPct = Math.min(100, Math.max(0, ((pct + 10) / 25) * 100));
              const stopMark = (10 / 25) * 100;

              return (
                <div key={pos.id}>
                  {/* Main row */}
                  <div
                    className="grid grid-cols-[16px_1fr_auto_auto_auto_auto_auto] gap-x-4 items-center px-4 py-3 hover:bg-surface2/60 transition-colors cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : pos.id)}
                  >
                    {/* Colour swatch */}
                    <div className="w-1 h-6 rounded-full shrink-0" style={{ background: color }} />

                    {/* Identity */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono font-semibold text-textMain">{pos.symbol}</span>
                        <Badge type={pos.strategy_type} />
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${pos.status === 'ACTIVE' ? 'bg-up-bg text-up-text border-up/30' : 'bg-amber-900/30 text-amber-300 border-amber-500/30'}`}>
                          {pos.status}
                        </span>
                      </div>
                      <p className="text-[10px] text-textDim mt-0.5">{new Date(pos.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                    </div>

                    {/* Invested */}
                    <div className="text-right">
                      <p className="text-[10px] text-textDim">Invested</p>
                      <p className="text-xs font-mono text-textMain">
                        {pos.position_size ? `$${pos.position_size.toLocaleString()}` : <span className="text-textDim">—</span>}
                      </p>
                    </div>

                    {/* Entry */}
                    <div className="text-right">
                      <p className="text-[10px] text-textDim">Entry</p>
                      <p className="text-xs font-mono text-textMain">${pos.entry_price.toFixed(4)}</p>
                    </div>

                    {/* Live price */}
                    <div className="text-right">
                      <p className="text-[10px] text-textDim">Live</p>
                      <p className={`text-xs font-mono font-semibold ${pnlUp ? 'text-up' : 'text-down'}`}>
                        {pos.current_price != null ? `$${pos.current_price.toFixed(4)}` : '—'}
                      </p>
                    </div>

                    {/* P&L */}
                    <div className="text-right min-w-[70px]">
                      <p className={`text-sm font-mono font-semibold tabular-nums ${pnlUp ? 'text-up' : 'text-down'}`}>
                        {fmtPct(pos.pnl_pct)}
                      </p>
                      {pos.pnl_usd != null
                        ? <p className={`text-[10px] font-mono ${pnlUp ? 'text-up' : 'text-down'}`}>{fmt$(pos.pnl_usd)}</p>
                        : pos.assumed_size != null
                        ? <p className="text-[9px] text-amber-500">~{fmt$((pos.assumed_size * pct) / 100)} est</p>
                        : null
                      }
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => openReport(pos.id)}
                        title="View report"
                        className="h-6 w-6 flex items-center justify-center rounded bg-surface3 border border-borderLight text-textDim hover:text-brand-400 hover:border-brand-500/50 transition-colors text-[10px]"
                      >◈</button>
                      <button
                        onClick={() => {
                          setEditStratId(editStratId === pos.id ? null : pos.id);
                          setEditStratForm({ position_size: pos.position_size?.toString() ?? '', notes: pos.notes ?? '' });
                          setExpandedId(pos.id);
                        }}
                        title="Edit"
                        className={`h-6 w-6 flex items-center justify-center rounded border transition-colors text-[10px] ${editStratId === pos.id ? 'bg-brand-600 border-brand-500 text-white' : 'bg-surface3 border-borderLight text-textDim hover:text-brand-400 hover:border-brand-500/50'}`}
                      >✎</button>
                      <button
                        onClick={() => handleUndeploy(pos.id)}
                        title="Close position"
                        className="h-6 w-6 flex items-center justify-center rounded bg-down-bg border border-down/20 text-down-text hover:opacity-80 transition-opacity text-[10px]"
                      >✕</button>
                    </div>
                  </div>

                  {/* Expanded drawer */}
                  {isExpanded && (
                    <div className="border-t border-borderLight bg-surface2/40 px-4 pb-4 pt-3 space-y-3">
                      {/* P&L bar */}
                      <div>
                        <div className="flex justify-between text-[9px] mb-1.5">
                          <span className="text-down font-mono">SL −10%</span>
                          <span className={`font-mono font-semibold ${pnlUp ? 'text-up' : 'text-down'}`}>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</span>
                          <span className="text-up font-mono">TP +15%</span>
                        </div>
                        <div className="relative h-1 rounded-full bg-surface3">
                          <div
                            className="absolute left-0 top-0 h-full rounded-full transition-all"
                            style={{ width: `${fillPct}%`, background: pnlUp ? 'var(--color-up)' : 'var(--color-down)' }}
                          />
                          <div className="absolute top-[-3px] h-[7px] w-px bg-borderMid" style={{ left: `${stopMark}%` }} />
                        </div>
                      </div>

                      {/* Position size info */}
                      {pos.position_size && (
                        <p className="text-[10px] text-textDim">
                          Position size: <span className="text-textMuted font-mono">${pos.position_size.toLocaleString()}</span>
                          {p && p.total_budget > 0 && <span className="ml-1">({((pos.position_size / p.total_budget) * 100).toFixed(1)}% of budget)</span>}
                        </p>
                      )}

                      {/* Notes */}
                      {pos.notes && editStratId !== pos.id && (
                        <p className="text-[10px] text-textDim border-l-2 border-borderMid pl-2.5 italic">{pos.notes}</p>
                      )}

                      {/* Edit form */}
                      {editStratId === pos.id && (
                        <div className="pt-1 space-y-2">
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <label className="text-[9px] text-textDim uppercase tracking-widest block mb-1">Position Size ($)</label>
                              <input
                                type="number"
                                placeholder="e.g. 1500"
                                value={editStratForm.position_size}
                                onChange={e => setEditStratForm({ ...editStratForm, position_size: e.target.value })}
                                className="w-full bg-surface border border-borderLight rounded px-2.5 py-1.5 text-xs font-mono text-textMain placeholder-textDim focus:outline-none focus:border-brand-500"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="text-[9px] text-textDim uppercase tracking-widest block mb-1">Notes</label>
                            <textarea
                              placeholder="Trade thesis, risk notes..."
                              value={editStratForm.notes}
                              onChange={e => setEditStratForm({ ...editStratForm, notes: e.target.value })}
                              rows={2}
                              className="w-full bg-surface border border-borderLight rounded px-2.5 py-1.5 text-xs text-textMain placeholder-textDim focus:outline-none focus:border-brand-500 resize-none"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => { handleStrategyUpdate(pos.id); setEditStratId(null); }}
                              className="px-3 py-1 bg-brand-600 text-white rounded text-xs font-semibold hover:bg-brand-500 transition-colors"
                            >Save</button>
                            <button
                              onClick={() => setEditStratId(null)}
                              className="px-3 py-1 border border-borderLight text-textDim rounded text-xs hover:text-textMain transition-colors"
                            >Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Closed Positions ─────────────────────────────────────────────────── */}
      {closed.length > 0 && (
        <div>
          <p className="text-[9px] font-semibold tracking-[0.18em] uppercase text-textDim mb-2">
            Closed Positions<span className="ml-2 text-textDim">{closed.length}</span>
          </p>
          <div className="border border-borderLight rounded-xl bg-surface overflow-hidden divide-y divide-borderLight">
            {closed.map(pos => {
              const pnlUp = (pos.pnl_pct ?? 0) >= 0;
              const cs = pos.close_reason ? (CLOSE_STYLE[pos.close_reason] ?? CLOSE_STYLE.MANUAL) : CLOSE_STYLE.MANUAL;
              return (
                <div key={pos.id} className={`flex items-center gap-4 px-4 py-3 border-l-2 ${cs.border} hover:bg-surface2/40 transition-colors`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-mono font-semibold text-textMain">{pos.symbol}</span>
                      <Badge type={pos.strategy_type} />
                      {pos.close_reason && (
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${cs.badge}`}>
                          {cs.label}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[10px] text-textDim font-mono flex-wrap">
                      <span>in ${pos.entry_price.toFixed(4)}</span>
                      {pos.exit_price && <span>out ${pos.exit_price.toFixed(4)}</span>}
                      {pos.position_size && <span>${pos.position_size.toLocaleString()} size</span>}
                      {pos.closed_at && <span>{new Date(pos.closed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-mono font-semibold tabular-nums ${pnlUp ? 'text-up' : 'text-down'}`}>{fmtPct(pos.pnl_pct)}</p>
                    {pos.realized_pnl != null && (
                      <p className={`text-[10px] font-mono ${(pos.realized_pnl ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>{fmt$(pos.realized_pnl)}</p>
                    )}
                  </div>
                  <button
                    onClick={() => openReport(pos.id)}
                    className="h-6 w-6 flex items-center justify-center rounded bg-surface3 border border-borderLight text-textDim hover:text-brand-400 hover:border-brand-500/50 transition-colors text-[10px] shrink-0"
                  >◈</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
