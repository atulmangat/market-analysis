import type { ReportCandle } from '../types';

export function PriceVolumeChart({ candles, entryPrice, accentColor }: {
  candles: ReportCandle[];
  entryPrice: number;
  accentColor: string;
}) {
  if (!candles.length) return <div className="h-52 flex items-center justify-center text-textDim text-xs">No chart data</div>;
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const maxVol = Math.max(...volumes) || 1;
  const minY = Math.min(...closes) * 0.997;
  const maxY = Math.max(...closes) * 1.003;
  const W = 600, H = 160, VH = 32, GAP = 6;
  const n = candles.length;
  const toX = (i: number) => n === 1 ? W / 2 : (i / (n - 1)) * W;
  const toY = (v: number) => H - ((v - minY) / (maxY - minY || 1)) * H;
  const lastClose = closes[closes.length - 1];
  const isUp = lastClose >= entryPrice;
  const lineColor = isUp ? '#22c55e' : '#ef4444';
  const entryY = toY(entryPrice);
  const pathD = `M ${closes.map((c, i) => `${toX(i)},${toY(c)}`).join(' L ')} L ${W},${H} L 0,${H} Z`;
  const pts = closes.map((c, i) => `${toX(i)},${toY(c)}`).join(' ');
  const barW = Math.max(2, W / n - 1);
  const totalH = H + GAP + VH;
  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${totalH}`} preserveAspectRatio="none" className="w-full" style={{ height: 220 }}>
        <defs>
          <linearGradient id={`cg-${accentColor}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.3" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* Price area */}
        <path d={pathD} fill={`url(#cg-${accentColor})`} />
        <polyline points={pts} fill="none" stroke={lineColor} strokeWidth="1.8" strokeLinejoin="round" />
        {entryPrice > 0 && entryY >= 0 && entryY <= H && (
          <>
            <line x1="0" y1={entryY} x2={W} y2={entryY} stroke="#f59e0b" strokeWidth="1" strokeDasharray="5,3" opacity="0.8" />
            <rect x="0" y={entryY - 11} width="60" height="11" fill="#f59e0b" opacity="0.15" rx="2" />
            <text x="4" y={entryY - 2} fill="#f59e0b" fontSize="8.5" fontWeight="600">Entry {entryPrice.toFixed(2)}</text>
          </>
        )}
        <circle cx={toX(n - 1)} cy={toY(lastClose)} r="3.5" fill={lineColor} />
        {/* Volume bars */}
        {candles.map((c, i) => {
          const bh = ((c.volume / maxVol) * VH) || 1;
          const bx = toX(i) - barW / 2;
          const by = H + GAP + (VH - bh);
          return <rect key={i} x={bx} y={by} width={barW} height={bh} fill={lineColor} opacity="0.35" rx="1" />;
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-textDim mt-0.5 px-1">
        <span>{candles[0]?.date}</span>
        <span className={`font-semibold tabular-nums ${isUp ? 'text-up' : 'text-down'}`}>{lastClose.toFixed(4)}</span>
        <span>{candles[n - 1]?.date}</span>
      </div>
    </div>
  );
}
