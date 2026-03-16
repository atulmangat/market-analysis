import type { StrategyReport } from '../types';
import { Badge } from '../components/Badge';
import { StatusChip } from '../components/StatusChip';
import { StatPill } from '../components/StatPill';
import { PriceVolumeChart } from '../components/PriceVolumeChart';
import { DebateSection } from '../components/DebateSection';
import { fmtMarketCap, fmtVol } from '../utils';

export function StockReportTemplate({ report }: { report: StrategyReport }) {
  const { strategy: s, fundamentals: f, chart: ch, debate: d } = report;
  const lastClose = ch.candles.at(-1)?.close ?? s.entry_price;
  const change30d = ch.candles.length >= 2
    ? ((ch.candles.at(-1)!.close - ch.candles[0].close) / ch.candles[0].close * 100)
    : null;
  const range52wLow = f['52w_low'];
  const range52wHigh = f['52w_high'];
  const posIn52w = (range52wLow != null && range52wHigh != null && range52wHigh > range52wLow)
    ? ((lastClose - range52wLow) / (range52wHigh - range52wLow) * 100)
    : null;

  // Valuation score — rough composite
  const peScore = f.pe_ratio != null ? (f.pe_ratio < 15 ? 'Undervalued' : f.pe_ratio < 30 ? 'Fair' : 'Premium') : null;

  return (
    <div className="divide-y divide-borderLight">
      {/* Hero */}
      <div className="px-6 py-5 bg-gradient-to-br from-brand-950/40 to-surface">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl font-bold text-textMain font-mono">{s.symbol.replace('.NS','')}</span>
              <Badge type={s.strategy_type} />
              <StatusChip status={s.status} />
            </div>
            <p className="text-[11px] text-textDim">{f.name ?? s.symbol}</p>
            {(f.sector || f.industry) && (
              <p className="text-[10px] text-brand-400 mt-0.5">{[f.sector, f.industry].filter(Boolean).join(' · ')}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-2xl font-light font-mono text-textMain">${lastClose.toFixed(2)}</p>
            {change30d != null && (
              <p className={`text-sm font-semibold ${change30d >= 0 ? 'text-up' : 'text-down'}`}>
                {change30d >= 0 ? '+' : ''}{change30d.toFixed(2)}% (30d)
              </p>
            )}
          </div>
        </div>
        {posIn52w != null && (
          <div>
            <div className="flex justify-between text-[9px] text-textDim mb-1">
              <span>52w Low ${range52wLow!.toFixed(2)}</span>
              <span className="text-brand-400">{posIn52w.toFixed(0)}% of annual range</span>
              <span>52w High ${range52wHigh!.toFixed(2)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-surface3 overflow-hidden">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${posIn52w}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="px-6 py-5">
        <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-3">Price & Volume — 30 Days</p>
        {ch.error ? <p className="text-xs text-textDim py-4">Chart unavailable</p>
          : <PriceVolumeChart candles={ch.candles} entryPrice={ch.entry_price} accentColor="brand" />}
      </div>

      {/* Description */}
      {f.description && (
        <div className="px-6 py-4 border-t border-borderLight">
          <p className="text-[11px] text-textMuted leading-relaxed">{f.description}</p>
        </div>
      )}

      {/* Valuation */}
      <div className="px-6 py-5">
        <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-3">Valuation</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {f.market_cap && <StatPill label="Market Cap" value={fmtMarketCap(f.market_cap)} accent="border-brand-500/30" />}
          {f.enterprise_value && <StatPill label="Enterprise Value" value={fmtMarketCap(f.enterprise_value)} />}
          {f.pe_ratio != null && (
            <StatPill label="P/E (TTM)"
              value={`${f.pe_ratio.toFixed(1)}x${peScore ? ` · ${peScore}` : ''}`}
              accent={peScore === 'Undervalued' ? 'border-up/40' : peScore === 'Premium' ? 'border-down/40' : 'border-borderLight'}
            />
          )}
          {f.forward_pe != null && <StatPill label="Fwd P/E" value={`${f.forward_pe.toFixed(1)}x`} />}
          {f.pb_ratio != null && <StatPill label="P/B" value={`${f.pb_ratio.toFixed(2)}x`} />}
          {f.ps_ratio != null && <StatPill label="P/S" value={`${f.ps_ratio.toFixed(2)}x`} />}
          {f.ev_ebitda != null && <StatPill label="EV/EBITDA" value={`${f.ev_ebitda.toFixed(1)}x`} />}
          {f.beta != null && <StatPill label="Beta" value={`${f.beta.toFixed(2)}${f.beta > 1.5 ? ' · High vol' : f.beta < 0.8 ? ' · Low vol' : ''}`} />}
          {f.dividend_yield != null && <StatPill label="Div Yield" value={`${(f.dividend_yield * 100).toFixed(2)}%`} accent="border-up/30" />}
        </div>
      </div>

      {/* Growth & Profitability */}
      {(f.revenue_growth != null || f.earnings_growth != null || f.profit_margin != null || f.roe != null || f.debt_equity != null) && (
        <div className="px-6 py-5">
          <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-3">Growth & Profitability</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {f.revenue_growth != null && <StatPill label="Revenue Growth (YoY)" value={`${(f.revenue_growth * 100).toFixed(1)}%`} accent={f.revenue_growth >= 0 ? 'border-up/30' : 'border-down/30'} />}
            {f.earnings_growth != null && <StatPill label="Earnings Growth" value={`${(f.earnings_growth * 100).toFixed(1)}%`} accent={f.earnings_growth >= 0 ? 'border-up/30' : 'border-down/30'} />}
            {f.profit_margin != null && <StatPill label="Net Margin" value={`${(f.profit_margin * 100).toFixed(1)}%`} />}
            {f.operating_margin != null && <StatPill label="Operating Margin" value={`${(f.operating_margin * 100).toFixed(1)}%`} />}
            {f.roe != null && <StatPill label="ROE" value={`${(f.roe * 100).toFixed(1)}%`} />}
            {f.roa != null && <StatPill label="ROA" value={`${(f.roa * 100).toFixed(1)}%`} />}
            {f.debt_equity != null && <StatPill label="Debt/Equity" value={`${f.debt_equity.toFixed(2)}x`} accent={f.debt_equity > 2 ? 'border-down/30' : 'border-borderLight'} />}
          </div>
        </div>
      )}

      {/* Analyst Consensus */}
      {(f.analyst_target != null || f.analyst_recommendation) && (
        <div className="px-6 py-5">
          <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-3">Analyst Consensus</p>
          <div className="bg-surface2 rounded-xl border border-borderLight p-4">
            <div className="flex items-center justify-between mb-3">
              {f.analyst_recommendation && (
                <div>
                  <p className="text-[10px] text-textDim mb-0.5">Consensus Rating</p>
                  <span className={`text-sm font-bold uppercase ${f.analyst_recommendation.includes('buy') ? 'text-up' : f.analyst_recommendation.includes('sell') ? 'text-down' : 'text-amber-400'}`}>
                    {f.analyst_recommendation.replace(/_/g, ' ')}
                  </span>
                  {f.analyst_count && <span className="text-[10px] text-textDim ml-2">({f.analyst_count} analysts)</span>}
                </div>
              )}
              {f.analyst_target != null && (
                <div className="text-right">
                  <p className="text-[10px] text-textDim mb-0.5">Price Target</p>
                  <p className="text-lg font-light font-mono text-textMain">${f.analyst_target.toFixed(2)}</p>
                  {f.analyst_upside != null && (
                    <p className={`text-xs font-semibold ${f.analyst_upside >= 0 ? 'text-up' : 'text-down'}`}>
                      {f.analyst_upside >= 0 ? '+' : ''}{f.analyst_upside.toFixed(1)}% upside
                    </p>
                  )}
                </div>
              )}
            </div>
            {(f.analyst_target_low != null || f.analyst_target_high != null) && (
              <div className="flex justify-between text-[10px] text-textDim border-t border-borderLight pt-2">
                {f.analyst_target_low != null && <span>Bear: ${f.analyst_target_low.toFixed(2)}</span>}
                {f.analyst_target != null && <span className="text-textMuted">Base: ${f.analyst_target.toFixed(2)}</span>}
                {f.analyst_target_high != null && <span>Bull: ${f.analyst_target_high.toFixed(2)}</span>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Technical Signals */}
      <div className="px-6 py-5">
        <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-3">Technical Signals</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <StatPill label="Entry Price" value={`$${s.entry_price.toFixed(4)}`} accent="border-amber-500/30" />
          {s.current_return != null && (
            <StatPill label="Current P&L"
              value={`${s.current_return >= 0 ? '+' : ''}${s.current_return.toFixed(2)}%`}
              accent={s.current_return >= 0 ? 'border-up/40' : 'border-down/40'}
            />
          )}
          {f.chg_5d != null && <StatPill label="5d Change" value={`${f.chg_5d >= 0 ? '+' : ''}${f.chg_5d.toFixed(2)}%`} accent={f.chg_5d >= 0 ? 'border-up/30' : 'border-down/30'} />}
          {f.chg_20d != null && <StatPill label="20d Change" value={`${f.chg_20d >= 0 ? '+' : ''}${f.chg_20d.toFixed(2)}%`} accent={f.chg_20d >= 0 ? 'border-up/30' : 'border-down/30'} />}
          {f.rsi_14 != null && (
            <StatPill label="RSI (14)"
              value={`${f.rsi_14.toFixed(0)} · ${f.rsi_14 > 70 ? 'Overbought' : f.rsi_14 < 30 ? 'Oversold' : 'Neutral'}`}
              accent={f.rsi_14 > 70 ? 'border-down/40' : f.rsi_14 < 30 ? 'border-up/40' : 'border-borderLight'}
            />
          )}
          {f.vol_ratio != null && (
            <StatPill label="Volume vs Avg"
              value={`${f.vol_ratio.toFixed(1)}x ${f.vol_ratio > 1.5 ? '↑ Surge' : f.vol_ratio < 0.7 ? '↓ Quiet' : '– Normal'}`}
              accent={f.vol_ratio > 1.5 ? 'border-brand-500/30' : 'border-borderLight'}
            />
          )}
          {f.avg_volume && <StatPill label="Avg Volume" value={fmtVol(f.avg_volume)} />}
          {f['52w_high'] && <StatPill label="52w High" value={`$${f['52w_high']!.toFixed(2)}`} />}
          {f['52w_low'] && <StatPill label="52w Low" value={`$${f['52w_low']!.toFixed(2)}`} />}
          {f.short_pct_float != null && <StatPill label="Short Interest" value={`${(f.short_pct_float * 100).toFixed(1)}% of float`} accent={f.short_pct_float > 0.1 ? 'border-down/30' : 'border-borderLight'} />}
          {f.next_earnings && <StatPill label="Next Earnings" value={f.next_earnings.slice(0, 10)} accent="border-amber-500/20" />}
        </div>
      </div>

      <DebateSection d={d} />
    </div>
  );
}
