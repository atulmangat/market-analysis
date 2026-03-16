import type { PortfolioPnl } from '../types';
import { Badge } from '../components/Badge';
import { StatusChip } from '../components/StatusChip';
import { Card } from '../components/Card';

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

export function PortfolioPage({
  portfolio, budgetInput, editStratId, editStratForm,
  setBudgetInput, setEditStratId, setEditStratForm,
  handleBudgetSave, handleUndeploy, handleStrategyUpdate, openReport, fetchData,
}: PortfolioPageProps) {
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
            {p?.using_assumed_sizes && stat.label !== 'Realized' && (
              <p className="text-[9px] text-amber-500 mt-1">equal-weight est.</p>
            )}
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
            <span className="text-[10px] text-brand-400">{((p.allocated / p.total_budget) * 100).toFixed(0)}% allocated · ${p.allocated.toLocaleString(undefined, { maximumFractionDigits: 0 })}{p.using_assumed_sizes ? ' (equal-weight est.)' : ''}</span>
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
                        {pos.pnl_usd != null
                          ? <p className={`text-[11px] font-mono ${pnlUp ? 'text-up' : 'text-down'}`}>{fmtUsd(pos.pnl_usd)}</p>
                          : pos.assumed_size != null && <p className="text-[9px] text-amber-500">~{fmtUsd((pos.assumed_size * (pos.pnl_pct ?? 0)) / 100)} est.</p>
                        }
                      </div>
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={() => openReport(pos.id)}
                          className="px-2 py-1 text-[10px] bg-surface3 border border-borderLight text-textMuted rounded hover:text-textMain transition-colors"
                        >◈</button>
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
                          onChange={e => setEditStratForm({ ...editStratForm, position_size: e.target.value })}
                          className="flex-1 bg-surface border border-borderLight rounded px-2 py-1 text-xs text-textMain placeholder-textDim focus:outline-none focus:border-brand-500"
                        />
                      </div>
                      <textarea
                        placeholder="Notes..."
                        value={editStratForm.notes}
                        onChange={e => setEditStratForm({ ...editStratForm, notes: e.target.value })}
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
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <p className={`text-lg font-light tabular-nums ${pnlUp ? 'text-up' : 'text-down'}`}>{fmtPct(pos.pnl_pct)}</p>
                        {pos.realized_pnl != null && (
                          <p className={`text-[11px] font-mono ${(pos.realized_pnl ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>
                            {fmtUsd(pos.realized_pnl)}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => openReport(pos.id)}
                        className="px-2 py-1 text-[10px] bg-surface3 border border-borderLight text-textMuted rounded hover:text-textMain transition-colors"
                      >◈</button>
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
}
