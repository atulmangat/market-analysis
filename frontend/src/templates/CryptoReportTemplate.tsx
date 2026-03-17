import type { StrategyReport } from '../types';
import { Badge } from '../components/Badge';
import { StatusChip } from '../components/StatusChip';
import { StatPill } from '../components/StatPill';
import { PriceVolumeChart } from '../components/PriceVolumeChart';
import { DebateSection } from '../components/DebateSection';
import { fmtMarketCap, fmtVol } from '../utils';

function SectionHeader({ label }: { label: string }) {
  return (
    <p className="text-[10px] font-medium tracking-widest text-textDim uppercase mb-3">
      {label}
    </p>
  );
}

export function CryptoReportTemplate({ report }: { report: StrategyReport }) {
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

  const pnl = s.current_return;

  return (
    <div className="divide-y divide-borderLight">

      {/* ── HEADER ────────────────────────────────────────────────────── */}
      <div className="px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          {/* Left: identity */}
          <div className="min-w-0">
            <div className="flex items-center flex-wrap gap-2 mb-1">
              <span className="text-2xl font-bold font-mono text-textMain tracking-tight">
                {s.symbol.replace('-USD', '')}
              </span>
              <span className="text-sm text-textDim font-mono">/USD</span>
              <Badge type={s.strategy_type} />
              <StatusChip status={s.status} />
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded border tracking-widest bg-violet-900/60 text-violet-300 border-violet-500/30">
                CRYPTO
              </span>
              {f.name && <span className="text-[10px] text-textDim">{f.name}</span>}
            </div>
          </div>
          {/* Right: price */}
          <div className="text-right shrink-0">
            <p className="text-2xl font-mono font-medium text-textMain">${lastClose.toFixed(2)}</p>
            {change30d != null && (
              <p className={`text-xs font-mono font-semibold ${change30d >= 0 ? 'text-up' : 'text-down-text'}`}>
                {change30d >= 0 ? '+' : ''}{change30d.toFixed(2)}% 30d
              </p>
            )}
            <p className="text-[10px] text-textDim mt-0.5">
              Entry ${s.entry_price.toFixed(4)}
            </p>
          </div>
        </div>

        {/* 52-week range bar */}
        {posIn52w != null && (
          <div className="mt-4">
            <div className="flex justify-between text-[9px] text-textDim mb-1.5">
              <span>52w L ${range52wLow!.toFixed(2)}</span>
              <span className="text-textDim">{posIn52w.toFixed(0)}% of range</span>
              <span>52w H ${range52wHigh!.toFixed(2)}</span>
            </div>
            <div className="relative h-px bg-borderMid">
              <div
                className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-violet-400 border-2 border-surface2"
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
          : <PriceVolumeChart candles={ch.candles} entryPrice={ch.entry_price} accentColor="violet" />
        }
      </div>

      {/* ── POSITION METRICS ROW ──────────────────────────────────────── */}
      {(pnl != null || f.chg_5d != null || f.chg_20d != null || f.rsi_14 != null || f.vol_ratio != null) && (
        <div className="px-6 py-4">
          <SectionHeader label="Position & Technicals" />
          <div className="flex flex-wrap gap-0 divide-x divide-borderLight border border-borderLight rounded overflow-hidden">
            <div className="flex-1 min-w-[80px] px-3 py-2.5">
              <p className="text-[9px] text-textDim uppercase tracking-wider mb-0.5">Entry</p>
              <p className="text-xs font-mono font-medium text-textMain">${s.entry_price.toFixed(4)}</p>
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
                <p className={`text-xs font-mono font-medium ${f.vol_ratio > 1.5 ? 'text-violet-400' : 'text-textMain'}`}>
                  {f.vol_ratio.toFixed(1)}x {f.vol_ratio > 1.5 ? '↑' : f.vol_ratio < 0.7 ? '↓' : '–'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── MARKET METRICS ────────────────────────────────────────────── */}
      <div className="px-6 py-5">
        <SectionHeader label="Market Metrics" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {f.market_cap && (
            <StatPill label="Market Cap" value={fmtMarketCap(f.market_cap)} accent="border-violet-500/30" />
          )}
          {f.avg_volume && (
            <StatPill label="Avg Daily Volume" value={fmtVol(f.avg_volume)} />
          )}
          {f['52w_high'] && (
            <StatPill label="52w High" value={`$${f['52w_high']!.toFixed(2)}`} accent="border-down/30" />
          )}
          {f['52w_low'] && (
            <StatPill label="52w Low" value={`$${f['52w_low']!.toFixed(2)}`} accent="border-up/30" />
          )}
        </div>
      </div>

      {/* ── DEBATE ────────────────────────────────────────────────────── */}
      <DebateSection d={d} ticker={s.symbol} />
    </div>
  );
}
