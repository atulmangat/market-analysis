import type { StrategyReport, AssetClass } from '../types';
import { detectAssetClass } from '../utils';
import { CryptoReportTemplate } from './CryptoReportTemplate';
import { StockReportTemplate } from './StockReportTemplate';
import { CommodityReportTemplate } from './CommodityReportTemplate';

export function StrategyReportPanel({ report, loading, error, onClose }: { report: StrategyReport | null; loading: boolean; error?: string | null; onClose: () => void }) {
  const s = report?.strategy;
  const assetClass = s ? detectAssetClass(s.symbol, report?.fundamentals?.quote_type) : 'stock';

  const assetLabel: Record<AssetClass, string> = {
    crypto: '₿ Crypto',
    stock: '◈ Equity',
    commodity: '⛏ Commodity',
  };
  const headerAccent: Record<AssetClass, string> = {
    crypto:    'border-violet-500/30',
    stock:     'border-brand-500/30',
    commodity: 'border-amber-500/30',
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`w-full max-w-2xl h-full bg-surface border-l flex flex-col shadow-2xl overflow-hidden ${s ? headerAccent[assetClass] : 'border-borderLight'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-borderLight bg-surface2 shrink-0">
          {s ? (
            <div className="flex items-center gap-3">
              <div className={`h-9 w-9 rounded-lg border flex items-center justify-center text-xs font-bold text-textMain ${
                assetClass === 'crypto' ? 'bg-violet-950/60 border-violet-500/30 text-violet-300' :
                assetClass === 'commodity' ? 'bg-amber-950/60 border-amber-500/30 text-amber-300' :
                'bg-surface3 border-borderMid'
              }`}>
                {s.symbol.replace(/[.\-=]/g, '').substring(0, 3).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-textMain">{s.symbol}</span>
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${
                    assetClass === 'crypto' ? 'text-violet-400 border-violet-500/30 bg-violet-950/40' :
                    assetClass === 'commodity' ? 'text-amber-400 border-amber-500/30 bg-amber-950/40' :
                    'text-brand-400 border-brand-500/30 bg-brand-950/40'
                  }`}>{assetLabel[assetClass]}</span>
                </div>
                <p className="text-[11px] text-textDim mt-0.5">Strategy Report · {new Date(s.timestamp).toLocaleString()}</p>
              </div>
            </div>
          ) : (
            <span className="text-sm text-textMuted">Strategy Report</span>
          )}
          <button onClick={onClose} className="text-textDim hover:text-textMain text-xl leading-none ml-4">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3">
              <div className="w-6 h-6 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
              <p className="text-sm text-textDim">Loading report…</p>
            </div>
          ) : !report ? (
            <div className="p-6 text-center space-y-2">
              <p className="text-sm font-semibold text-down">Failed to load report</p>
              {error && <p className="text-xs text-textDim font-mono bg-surface3 rounded p-2">{error}</p>}
            </div>
          ) : assetClass === 'crypto' ? (
            <CryptoReportTemplate report={report} />
          ) : assetClass === 'commodity' ? (
            <CommodityReportTemplate report={report} />
          ) : (
            <StockReportTemplate report={report} />
          )}
        </div>
      </div>
    </div>
  );
}
