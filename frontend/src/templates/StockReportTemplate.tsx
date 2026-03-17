import type { StrategyReport } from '../types';
import { Badge } from '../components/Badge';
import { StatusChip } from '../components/StatusChip';
import { StatPill } from '../components/StatPill';
import { PriceVolumeChart } from '../components/PriceVolumeChart';
import { DebateSection } from '../components/DebateSection';
import { fmtMarketCap, fmtVol } from '../utils';

// ── helpers ──────────────────────────────────────────────────────────────────
function SectionHeader({ label }: { label: string }) {
  return (
    <p className="text-[10px] font-medium tracking-widest text-textDim uppercase mb-3">
      {label}
    </p>
  );
}

function MetricRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-baseline justify-between py-1.5 border-b border-borderLight last:border-0">
      <span className="text-[9px] text-textDim uppercase tracking-wider">{label}</span>
      <span className={`text-sm font-mono font-medium text-right ${valueClass ?? 'text-textMain'}`}>{value}</span>
    </div>
  );
}

// ── component ────────────────────────────────────────────────────────────────
export function StockReportTemplate({ report }: { report: StrategyReport }) {
  const { strategy: s, fundamentals: f, chart: ch, debate: d } = report;
  const lastClose = ch.candles.at(-1)?.close ?? s.entry_price;
  const change30d = ch.candles.length >= 2
    ? ((ch.candles.at(-1)!.close - ch.candles[0].close) / ch.candles[0].close * 100)
    : null;
  const range52wLow  = f['52w_low'];
  const range52wHigh = f['52w_high'];
  const posIn52w = (range52wLow != null && range52wHigh != null && range52wHigh > range52wLow)
    ? ((lastClose - range52wLow) / (range52wHigh - range52wLow) * 100)
    : null;

  const peScore = f.pe_ratio != null
    ? (f.pe_ratio < 15 ? 'Undervalued' : f.pe_ratio < 30 ? 'Fair' : 'Premium')
    : null;

  const pnl = s.current_return;
  const currencySymbol = f.currency && f.currency !== 'USD' ? f.currency + ' ' : '$';

  return (
    <div className="divide-y divide-borderLight">

      {/* ── HEADER ────────────────────────────────────────────────────── */}
      <div className="px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          {/* Left: identity */}
          <div className="min-w-0">
            <div className="flex items-center flex-wrap gap-2 mb-1">
              <span className="text-2xl font-bold font-mono text-textMain tracking-tight">
                {s.symbol.replace('.NS', '')}
              </span>
              <Badge type={s.strategy_type} />
              <StatusChip status={s.status} />
            </div>
            {f.name && <p className="text-[11px] text-textMuted truncate">{f.name}</p>}
            {(f.sector || f.industry) && (
              <p className="text-[10px] text-textDim mt-0.5">
                {[f.sector, f.industry].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          {/* Right: price */}
          <div className="text-right shrink-0">
            <p className="text-2xl font-mono font-medium text-textMain">
              {currencySymbol}{lastClose.toFixed(2)}
            </p>
            {change30d != null && (
              <p className={`text-xs font-mono font-semibold ${change30d >= 0 ? 'text-up' : 'text-down-text'}`}>
                {change30d >= 0 ? '+' : ''}{change30d.toFixed(2)}% 30d
              </p>
            )}
            <p className="text-[10px] text-textDim mt-0.5">
              Entry {currencySymbol}{s.entry_price.toFixed(4)}
            </p>
          </div>
        </div>

        {/* 52-week range bar */}
        {posIn52w != null && (
          <div className="mt-4">
            <div className="flex justify-between text-[9px] text-textDim mb-1.5">
              <span>52w L {currencySymbol}{range52wLow!.toFixed(2)}</span>
              <span className="text-textDim">{posIn52w.toFixed(0)}% of range</span>
              <span>52w H {currencySymbol}{range52wHigh!.toFixed(2)}</span>
            </div>
            {/* thin track with dot marker */}
            <div className="relative h-px bg-borderMid">
              <div
                className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-brand-400 border-2 border-surface2"
                style={{ left: `calc(${posIn52w}% - 4px)` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── CHART ─────────────────────────────────────────────────────── */}
      <div className="px-6 py-5">
        <SectionHeader label="30-day Price History" />
        {ch.error
          ? <p className="text-xs text-textDim py-4">Chart unavailable</p>
          : <PriceVolumeChart candles={ch.candles} entryPrice={ch.entry_price} accentColor="brand" />
        }
      </div>

      {/* ── POSITION METRICS ROW ──────────────────────────────────────── */}
      {(pnl != null || f.chg_5d != null || f.chg_20d != null || f.rsi_14 != null || f.vol_ratio != null) && (
        <div className="px-6 py-4">
          <SectionHeader label="Position & Technicals" />
          <div className="flex flex-wrap gap-0 divide-x divide-borderLight border border-borderLight rounded overflow-hidden">
            <div className="flex-1 min-w-[80px] px-3 py-2.5">
              <p className="text-[9px] text-textDim uppercase tracking-wider mb-0.5">Entry</p>
              <p className="text-xs font-mono font-medium text-textMain">{currencySymbol}{s.entry_price.toFixed(4)}</p>
            </div>
            {pnl != null && (
              <div className="flex-1 min-w-[80px] px-3 py-2.5">
                <p className="text-[9px] text-textDim uppercase tracking-wider mb-0.5">P&amp;L</p>
                <p className={`text-xs font-mono font-medium ${pnl >= 0 ? 'text-up' : 'text-down-text'}`}>
                  {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}%
                </p>
              </div>
            )}
            {f.chg_5d != null && (
              <div className="flex-1 min-w-[80px] px-3 py-2.5">
                <p className="text-[9px] text-textDim uppercase tracking-wider mb-0.5">5d</p>
                <p className={`text-xs font-mono font-medium ${f.chg_5d >= 0 ? 'text-up' : 'text-down-text'}`}>
                  {f.chg_5d >= 0 ? '+' : ''}{f.chg_5d.toFixed(2)}%
                </p>
              </div>
            )}
            {f.chg_20d != null && (
              <div className="flex-1 min-w-[80px] px-3 py-2.5">
                <p className="text-[9px] text-textDim uppercase tracking-wider mb-0.5">20d</p>
                <p className={`text-xs font-mono font-medium ${f.chg_20d >= 0 ? 'text-up' : 'text-down-text'}`}>
                  {f.chg_20d >= 0 ? '+' : ''}{f.chg_20d.toFixed(2)}%
                </p>
              </div>
            )}
            {f.rsi_14 != null && (
              <div className="flex-1 min-w-[80px] px-3 py-2.5">
                <p className="text-[9px] text-textDim uppercase tracking-wider mb-0.5">RSI 14</p>
                <p className={`text-xs font-mono font-medium ${f.rsi_14 > 70 ? 'text-down-text' : f.rsi_14 < 30 ? 'text-up' : 'text-textMain'}`}>
                  {f.rsi_14.toFixed(0)} · {f.rsi_14 > 70 ? 'OB' : f.rsi_14 < 30 ? 'OS' : 'Neut'}
                </p>
              </div>
            )}
            {f.vol_ratio != null && (
              <div className="flex-1 min-w-[80px] px-3 py-2.5">
                <p className="text-[9px] text-textDim uppercase tracking-wider mb-0.5">Vol Ratio</p>
                <p className={`text-xs font-mono font-medium ${f.vol_ratio > 1.5 ? 'text-brand-400' : 'text-textMain'}`}>
                  {f.vol_ratio.toFixed(1)}x {f.vol_ratio > 1.5 ? '↑' : f.vol_ratio < 0.7 ? '↓' : '–'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TWO-COLUMN METRICS GRID ───────────────────────────────────── */}
      <div className="px-6 py-5">
        <SectionHeader label="Fundamentals" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-0">
          {/* Left: Valuation */}
          <div>
            <p className="text-[9px] text-textDim uppercase tracking-widest mb-1 font-medium">Valuation</p>
            {f.market_cap && <MetricRow label="Market Cap" value={fmtMarketCap(f.market_cap)} />}
            {f.enterprise_value && <MetricRow label="Enterprise Value" value={fmtMarketCap(f.enterprise_value)} />}
            {f.pe_ratio != null && (
              <MetricRow
                label="P/E (TTM)"
                value={`${f.pe_ratio.toFixed(1)}x${peScore ? ` · ${peScore}` : ''}`}
                valueClass={peScore === 'Undervalued' ? 'text-up' : peScore === 'Premium' ? 'text-down-text' : undefined}
              />
            )}
            {f.forward_pe != null && <MetricRow label="Fwd P/E" value={`${f.forward_pe.toFixed(1)}x`} />}
            {f.pb_ratio != null && <MetricRow label="P/B" value={`${f.pb_ratio.toFixed(2)}x`} />}
            {f.ps_ratio != null && <MetricRow label="P/S" value={`${f.ps_ratio.toFixed(2)}x`} />}
            {f.ev_ebitda != null && <MetricRow label="EV/EBITDA" value={`${f.ev_ebitda.toFixed(1)}x`} />}
            {f.beta != null && (
              <MetricRow
                label="Beta"
                value={`${f.beta.toFixed(2)}${f.beta > 1.5 ? ' · High vol' : f.beta < 0.8 ? ' · Low vol' : ''}`}
              />
            )}
            {f.dividend_yield != null && (
              <MetricRow label="Div Yield" value={`${(f.dividend_yield * 100).toFixed(2)}%`} valueClass="text-up" />
            )}
          </div>
          {/* Right: Growth & Profitability */}
          <div>
            <p className="text-[9px] text-textDim uppercase tracking-widest mb-1 font-medium">Growth &amp; Profitability</p>
            {f.revenue_growth != null && (
              <MetricRow
                label="Revenue Growth YoY"
                value={`${(f.revenue_growth * 100).toFixed(1)}%`}
                valueClass={f.revenue_growth >= 0 ? 'text-up' : 'text-down-text'}
              />
            )}
            {f.earnings_growth != null && (
              <MetricRow
                label="Earnings Growth"
                value={`${(f.earnings_growth * 100).toFixed(1)}%`}
                valueClass={f.earnings_growth >= 0 ? 'text-up' : 'text-down-text'}
              />
            )}
            {f.profit_margin != null && (
              <MetricRow label="Net Margin" value={`${(f.profit_margin * 100).toFixed(1)}%`} />
            )}
            {f.operating_margin != null && (
              <MetricRow label="Operating Margin" value={`${(f.operating_margin * 100).toFixed(1)}%`} />
            )}
            {f.roe != null && <MetricRow label="ROE" value={`${(f.roe * 100).toFixed(1)}%`} />}
            {f.roa != null && <MetricRow label="ROA" value={`${(f.roa * 100).toFixed(1)}%`} />}
            {f.debt_equity != null && (
              <MetricRow
                label="Debt / Equity"
                value={`${f.debt_equity.toFixed(2)}x`}
                valueClass={f.debt_equity > 2 ? 'text-down-text' : undefined}
              />
            )}
            {f.avg_volume && <MetricRow label="Avg Volume" value={fmtVol(f.avg_volume)} />}
            {f.short_pct_float != null && (
              <MetricRow
                label="Short Interest"
                value={`${(f.short_pct_float * 100).toFixed(1)}% float`}
                valueClass={f.short_pct_float > 0.1 ? 'text-amber-400' : undefined}
              />
            )}
            {f.next_earnings && <MetricRow label="Next Earnings" value={f.next_earnings.slice(0, 10)} valueClass="text-amber-400" />}
          </div>
        </div>
      </div>

      {/* ── ANALYST CONSENSUS ─────────────────────────────────────────── */}
      {(f.analyst_target != null || f.analyst_recommendation) && (
        <div className="px-6 py-5">
          <SectionHeader label="Analyst Consensus" />
          <div className="bg-surface2 border border-borderLight rounded-lg p-4">
            <div className="flex items-start justify-between mb-3 gap-4">
              {f.analyst_recommendation && (
                <div>
                  <p className="text-[9px] text-textDim uppercase tracking-wider mb-1">Consensus Rating</p>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold uppercase font-mono ${
                      f.analyst_recommendation.includes('buy')  ? 'text-up' :
                      f.analyst_recommendation.includes('sell') ? 'text-down-text'     : 'text-amber-400'
                    }`}>
                      {f.analyst_recommendation.replace(/_/g, ' ')}
                    </span>
                    {f.analyst_count && (
                      <span className="text-[10px] text-textDim bg-surface3 px-1.5 py-0.5 rounded border border-borderLight">
                        {f.analyst_count} analysts
                      </span>
                    )}
                  </div>
                </div>
              )}
              {f.analyst_target != null && (
                <div className="text-right">
                  <p className="text-[9px] text-textDim uppercase tracking-wider mb-1">Price Target</p>
                  <p className="text-lg font-mono font-medium text-textMain">${f.analyst_target.toFixed(2)}</p>
                  {f.analyst_upside != null && (
                    <p className={`text-xs font-mono font-semibold ${f.analyst_upside >= 0 ? 'text-up' : 'text-down-text'}`}>
                      {f.analyst_upside >= 0 ? '+' : ''}{f.analyst_upside.toFixed(1)}% upside
                    </p>
                  )}
                </div>
              )}
            </div>
            {(f.analyst_target_low != null || f.analyst_target_high != null) && (
              <div className="grid grid-cols-3 gap-2 border-t border-borderLight pt-3">
                <div className="text-center">
                  <p className="text-[9px] text-textDim uppercase tracking-wider mb-0.5">Bear</p>
                  <p className="text-xs font-mono font-medium text-down-text">
                    {f.analyst_target_low != null ? `$${f.analyst_target_low.toFixed(2)}` : '—'}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[9px] text-textDim uppercase tracking-wider mb-0.5">Base</p>
                  <p className="text-xs font-mono font-medium text-textMain">
                    {f.analyst_target != null ? `$${f.analyst_target.toFixed(2)}` : '—'}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[9px] text-textDim uppercase tracking-wider mb-0.5">Bull</p>
                  <p className="text-xs font-mono font-medium text-up">
                    {f.analyst_target_high != null ? `$${f.analyst_target_high.toFixed(2)}` : '—'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ADDITIONAL TECHNICAL SIGNALS (StatPill grid) ──────────────── */}
      {(f['52w_high'] || f['52w_low']) && (
        <div className="px-6 py-5">
          <SectionHeader label="Range" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {f['52w_high'] && <StatPill label="52w High" value={`$${f['52w_high']!.toFixed(2)}`} accent="border-down/30" />}
            {f['52w_low']  && <StatPill label="52w Low"  value={`$${f['52w_low']!.toFixed(2)}`}  accent="border-up/30" />}
          </div>
        </div>
      )}

      {/* ── COMPANY DESCRIPTION ───────────────────────────────────────── */}
      {f.description && (
        <div className="px-6 py-4">
          <SectionHeader label="About" />
          <div className="border-l-2 border-borderMid pl-3">
            <p className="text-[11px] text-textMuted leading-relaxed italic">{f.description}</p>
          </div>
        </div>
      )}

      {/* ── DEBATE ────────────────────────────────────────────────────── */}
      <DebateSection d={d} ticker={s.symbol} />
    </div>
  );
}
