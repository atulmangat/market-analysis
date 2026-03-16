import type { StrategyReport } from '../types';
import { Badge } from '../components/Badge';
import { StatPill } from '../components/StatPill';
import { PriceVolumeChart } from '../components/PriceVolumeChart';
import { DebateSection } from '../components/DebateSection';
import { fmtMarketCap, fmtVol } from '../utils';

export function CryptoReportTemplate({ report }: { report: StrategyReport }) {
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

  return (
    <div className="divide-y divide-borderLight">
      {/* Hero banner */}
      <div className="px-6 py-5 bg-gradient-to-br from-violet-950/40 to-surface">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl font-bold text-textMain font-mono">{s.symbol.replace('-USD','')}</span>
              <span className="text-sm text-textDim">/USD</span>
              <Badge type={s.strategy_type} />
            </div>
            <p className="text-[11px] text-textDim">{f.name ?? s.symbol} · Cryptocurrency</p>
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
        {/* 52-week position bar */}
        {posIn52w != null && (
          <div className="mt-1">
            <div className="flex justify-between text-[9px] text-textDim mb-1">
              <span>52w Low ${range52wLow!.toFixed(2)}</span>
              <span className="text-violet-400">{posIn52w.toFixed(0)}% of range</span>
              <span>52w High ${range52wHigh!.toFixed(2)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-surface3 overflow-hidden">
              <div className="h-full rounded-full bg-violet-500" style={{ width: `${posIn52w}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="px-6 py-5">
        <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-3">Price & Volume — 30 Days</p>
        {ch.error ? <p className="text-xs text-textDim py-4">Chart unavailable</p>
          : <PriceVolumeChart candles={ch.candles} entryPrice={ch.entry_price} accentColor="violet" />}
      </div>

      {/* Key metrics */}
      <div className="px-6 py-5">
        <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-3">Market Metrics</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {f.market_cap && <StatPill label="Market Cap" value={fmtMarketCap(f.market_cap)} accent="border-violet-500/30" />}
          {f.avg_volume && <StatPill label="Avg Daily Volume" value={fmtVol(f.avg_volume)} />}
          {f['52w_high'] && <StatPill label="52w High" value={`$${f['52w_high']!.toFixed(2)}`} />}
          {f['52w_low'] && <StatPill label="52w Low" value={`$${f['52w_low']!.toFixed(2)}`} />}
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
            />
          )}
        </div>
      </div>

      <DebateSection d={d} />
    </div>
  );
}
