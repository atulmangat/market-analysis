import type { Strategy, LiveQuote, MarketEvent } from '../types';
import { MARKET_ICONS, TICKER_DB, TICKER_META } from '../constants';
import { apiFetch } from '../utils';
import { Card } from '../components/Card';

interface MarketsPageProps {
  enabledMarketNames: string[];
  activeStrategies: Strategy[];
  liveQuotes: LiveQuote[];
  marketEvents: MarketEvent[];
  quotesLoading: boolean;
  quotesMarketTab: string;
  quotesStockTab: string | null;
  watchlist: string[];
  marketsSearchOpen: boolean;
  marketsSearchQuery: string;
  marketsSearchResults: { symbol: string; name: string; sector: string; exchange: string; type: string }[];
  marketsSearchLoading: boolean;
  marketsSearchTimer: [ReturnType<typeof setTimeout> | null, (v: ReturnType<typeof setTimeout> | null) => void];
  setQuotesMarketTab: (m: string) => void;
  setQuotesStockTab: (s: string | null) => void;
  setMarketsSearchOpen: (v: boolean) => void;
  setMarketsSearchQuery: (q: string) => void;
  setMarketsSearchResults: (r: { symbol: string; name: string; sector: string; exchange: string; type: string }[]) => void;
  setMarketsSearchLoading: (v: boolean) => void;
  setWatchlist: (fn: (prev: string[]) => string[]) => void;
  fetchQuotes: () => void;
  openReport: (id: number) => void;
}

export function MarketsPage({
  enabledMarketNames, activeStrategies, liveQuotes, marketEvents,
  quotesLoading, quotesMarketTab, quotesStockTab, watchlist,
  marketsSearchOpen, marketsSearchQuery, marketsSearchResults, marketsSearchLoading,
  marketsSearchTimer,
  setQuotesMarketTab, setQuotesStockTab, setMarketsSearchOpen,
  setMarketsSearchQuery, setMarketsSearchResults, setMarketsSearchLoading,
  setWatchlist, fetchQuotes,
}: MarketsPageProps) {

  const fmt = (n: number | null, dec = 2, prefix = '') => {
    if (n === null || n === undefined) return '—';
    return `${prefix}${n.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
  };

  const fmtVol = (v: number | null) => {
    if (!v) return '—';
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return String(v);
  };

  // Only tickers from enabled markets
  const allDefaultSymbols = TICKER_DB.filter(t => enabledMarketNames.includes(t.market)).map(t => t.symbol);
  // User-added symbols not in defaults
  const userAddedSymbols = watchlist.filter(s => !allDefaultSymbols.includes(s));
  // Combined unique symbol list
  const allSymbols = [...new Set([...allDefaultSymbols, ...userAddedSymbols])];

  // Resolve active tab — default to first enabled market
  const activeMarketTab = (quotesMarketTab && enabledMarketNames.includes(quotesMarketTab))
    ? quotesMarketTab
    : (enabledMarketNames[0] ?? '');

  // Filter by market tab
  const tabSymbols = allSymbols.filter(sym => {
    const meta = TICKER_META[sym];
    if (meta) return meta.market === activeMarketTab;
    // For user-added symbols not in TICKER_DB, detect market from quote data
    const q = liveQuotes.find(q => q.symbol === sym);
    return q?.market === activeMarketTab;
  });

  // Symbols with active positions
  const positionSymbols = [...new Set(activeStrategies.map(s => s.symbol))];
  const positionTabSymbols = positionSymbols.filter(sym => {
    const meta = TICKER_META[sym];
    if (meta) return meta.market === activeMarketTab;
    const q = liveQuotes.find(q => q.symbol === sym);
    return q?.market === activeMarketTab;
  });

  // Non-position watchlist symbols for the current tab
  const watchlistTabSymbols = tabSymbols.filter(sym => !positionSymbols.includes(sym));

  const activeStock = (quotesStockTab && tabSymbols.includes(quotesStockTab)) || (quotesStockTab && positionTabSymbols.includes(quotesStockTab))
    ? quotesStockTab : null;
  const stockQuote = activeStock ? liveQuotes.find(q => q.symbol === activeStock) ?? null : null;
  const stockEvents = activeStock ? marketEvents.filter(e => e.symbol === activeStock) : [];

  // Debounced markets search
  const handleMarketsSearch = (q: string) => {
    setMarketsSearchQuery(q);
    const timer = marketsSearchTimer[0];
    if (timer) clearTimeout(timer);
    if (!q.trim()) { setMarketsSearchResults([]); return; }
    const newTimer = setTimeout(async () => {
      setMarketsSearchLoading(true);
      try {
        const res = await apiFetch(`/search/tickers?q=${encodeURIComponent(q)}`);
        if (res.ok) setMarketsSearchResults(await res.json());
      } catch { /* silent */ }
      finally { setMarketsSearchLoading(false); }
    }, 350);
    marketsSearchTimer[1](newTimer);
  };

  const toggleWatchlist = (sym: string) => {
    setWatchlist(prev => {
      const next = prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym];
      localStorage.setItem('watchlist', JSON.stringify(next));
      return next;
    });
  };

  const isTracked = (sym: string) => allDefaultSymbols.includes(sym) || watchlist.includes(sym);

  const renderStockCard = (sym: string, hasPosition = false) => {
    const q = liveQuotes.find(lq => lq.symbol === sym);
    const up = (q?.change_pct ?? 0) >= 0;
    const isActive = activeStock === sym;
    const ticker = sym.replace(/\.(NS)$/, '').replace(/-USD$/, '').replace(/=F$/, '');
    const isUserAdded = !allDefaultSymbols.includes(sym);
    const activePos = activeStrategies.find(s => s.symbol === sym);
    const posReturn = activePos?.current_return ?? null;
    const posUp = (posReturn ?? 0) >= 0;

    return (
      <button key={sym} onClick={() => setQuotesStockTab(isActive ? null : sym)}
        className={`text-left p-4 rounded-xl border transition-all relative ${
          hasPosition
            ? isActive
              ? `border-l-2 ${posUp ? 'border-l-emerald-500 border-emerald-500/60 bg-emerald-900/10 ring-1 ring-emerald-500/20' : 'border-l-red-500 border-red-500/60 bg-red-900/10 ring-1 ring-red-500/20'}`
              : `border-l-2 ${posUp ? 'border-l-emerald-500 border-borderLight bg-surface hover:bg-surface2' : 'border-l-red-500 border-borderLight bg-surface hover:bg-surface2'}`
            : isActive
              ? 'border-brand-500 bg-brand-900/20 ring-1 ring-brand-500/30'
              : 'border-borderLight bg-surface hover:border-borderMid hover:bg-surface2'
        }`}>
        {/* Remove button for user-added symbols */}
        {isUserAdded && (
          <button
            onClick={e => { e.stopPropagation(); toggleWatchlist(sym); }}
            className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center text-[10px] text-textDim hover:text-red-400 hover:bg-red-900/30 rounded transition-colors"
            title="Remove from watchlist">
            ×
          </button>
        )}
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className="text-sm font-bold font-mono text-textMain leading-none">{ticker}</span>
          <div className="flex flex-col items-end gap-0.5">
            {q?.change_pct != null && (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${up ? 'bg-up-bg text-up-text' : 'bg-down-bg text-down-text'}`}>
                {up ? '+' : ''}{q.change_pct.toFixed(2)}% <span className="font-normal opacity-70">1d</span>
              </span>
            )}
            {q?.week_change_pct != null && q?.week_closes && q.week_closes.length >= 3 && (
              <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${(q.week_change_pct ?? 0) >= 0 ? 'text-up/70' : 'text-down/70'}`}>
                {(q.week_change_pct ?? 0) >= 0 ? '+' : ''}{q.week_change_pct?.toFixed(2)}% <span className="opacity-70">5d</span>
              </span>
            )}
          </div>
        </div>
        {q?.price != null ? (
          <p className="text-lg font-light font-mono text-textMain leading-none">
            {fmt(q.price, q.price > 100 ? 2 : 4)}
          </p>
        ) : (
          <p className="text-sm text-textDim">—</p>
        )}
        {/* 5-day sparkline */}
        {q?.week_closes && q.week_closes.length >= 2 && (() => {
          const pts = q.week_closes!;
          const mn = Math.min(...pts), mx = Math.max(...pts);
          const range = mx - mn || 1;
          const w = 80, h = 24;
          const coords = pts.map((v, i) => `${(i / (pts.length - 1)) * w},${h - ((v - mn) / range) * h}`).join(' ');
          const sparkUp = pts[pts.length - 1] >= pts[0];
          return (
            <svg width={w} height={h} className="mt-2 overflow-visible">
              <polyline points={coords} fill="none" stroke={sparkUp ? 'var(--color-up)' : 'var(--color-down)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
            </svg>
          );
        })()}
        {q?.name && <p className="text-[10px] text-textDim mt-0.5 truncate">{q.name}</p>}
        {/* Position return badge */}
        {activePos && posReturn !== null && (
          <div className={`mt-2 text-[10px] font-semibold px-2 py-0.5 rounded-full w-fit ${posUp ? 'bg-emerald-900/40 text-emerald-400' : 'bg-red-900/40 text-red-400'}`}>
            {activePos.strategy_type} {posUp ? '+' : ''}{posReturn.toFixed(2)}%
          </div>
        )}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-textMuted uppercase tracking-widest">Markets</h2>
        <div className="flex items-center gap-2">
          {quotesLoading && <span className="text-[10px] text-amber-400 animate-pulse">Fetching…</span>}
          <button onClick={() => { setMarketsSearchOpen(true); setMarketsSearchQuery(''); setMarketsSearchResults([]); }}
            className="text-[11px] px-3 py-1.5 rounded-lg bg-surface2 border border-borderLight hover:border-brand-500 text-textMuted hover:text-brand-400 transition-all flex items-center gap-1.5">
            + Add / Remove
          </button>
          <button onClick={fetchQuotes} disabled={quotesLoading}
            className="text-[11px] px-3 py-1.5 rounded-lg bg-surface2 border border-borderLight hover:border-brand-500 text-textMuted hover:text-brand-400 transition-all disabled:opacity-40">
            ↻ Refresh
          </button>
          <span className="text-[10px] text-textDim">Live · auto-refresh</span>
        </div>
      </div>

      {/* Market filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {enabledMarketNames.map(m => (
          <button key={m}
            onClick={() => { setQuotesMarketTab(m); setQuotesStockTab(null); }}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
              activeMarketTab === m
                ? 'border-brand-500 bg-brand-900/30 text-brand-300'
                : 'border-borderLight bg-surface2 text-textMuted hover:text-textMain hover:border-borderMid'
            }`}>
            <span>{MARKET_ICONS[m]}</span>
            <span>{m}</span>
          </button>
        ))}
      </div>

      {/* Active Positions section */}
      {positionTabSymbols.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
            Active Positions ({positionTabSymbols.length})
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {positionTabSymbols.map(sym => renderStockCard(sym, true))}
          </div>
        </div>
      )}

      {/* Watchlist / All markets grid */}
      {watchlistTabSymbols.length > 0 && (
        <div>
          {positionTabSymbols.length > 0 && (
            <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-2">Watchlist</p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {watchlistTabSymbols.map(sym => renderStockCard(sym, false))}
          </div>
        </div>
      )}

      {tabSymbols.length === 0 && positionTabSymbols.length === 0 && (
        <div className="py-10 text-center text-textDim text-sm">No symbols tracked for this market.</div>
      )}

      {/* Search / Add-Remove Modal */}
      {marketsSearchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setMarketsSearchOpen(false)}>
          <div className="bg-surface border border-borderMid rounded-2xl shadow-2xl w-full max-w-md mx-4 p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-textMain">Add / Remove from Watchlist</h3>
              <button onClick={() => setMarketsSearchOpen(false)} className="text-textDim hover:text-textMain text-lg leading-none">×</button>
            </div>
            <input
              autoFocus
              value={marketsSearchQuery}
              onChange={e => handleMarketsSearch(e.target.value)}
              placeholder="Search ticker or company name…"
              className="w-full px-3 py-2 text-sm rounded-lg bg-surface2 border border-borderLight focus:border-brand-500 focus:outline-none text-textMain placeholder-textDim"
            />
            {/* User-added symbols */}
            {userAddedSymbols.length > 0 && !marketsSearchQuery && (
              <div>
                <p className="text-[10px] text-textDim uppercase tracking-wider mb-2">Currently Added</p>
                <div className="flex flex-wrap gap-2">
                  {userAddedSymbols.map(sym => (
                    <span key={sym} className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-brand-900/40 border border-brand-700/40 text-brand-300">
                      {sym.replace(/\.(NS)$/, '').replace(/-USD$/, '').replace(/=F$/, '')}
                      <button onClick={() => toggleWatchlist(sym)} className="hover:text-red-400 ml-0.5">×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {marketsSearchLoading && <p className="text-xs text-textDim text-center py-4 animate-pulse">Searching…</p>}
            {!marketsSearchLoading && marketsSearchResults.length > 0 && (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {marketsSearchResults.map(r => {
                  const tracked = isTracked(r.symbol);
                  const isDefault = allDefaultSymbols.includes(r.symbol);
                  return (
                    <div key={r.symbol} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surface2 border border-borderLight hover:border-borderMid transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-mono font-bold text-textMain leading-none">{r.symbol}</p>
                        <p className="text-[11px] text-textMuted truncate mt-0.5">{r.name}</p>
                        {r.sector && <p className="text-[10px] text-textDim">{r.sector} · {r.exchange}</p>}
                      </div>
                      <button
                        onClick={() => !isDefault && toggleWatchlist(r.symbol)}
                        disabled={isDefault}
                        className={`shrink-0 text-[11px] px-3 py-1 rounded-lg border transition-colors ${
                          isDefault
                            ? 'border-borderLight text-textDim cursor-default'
                            : tracked
                              ? 'border-red-700/50 bg-red-900/30 text-red-400 hover:bg-red-900/50'
                              : 'border-brand-700/50 bg-brand-900/30 text-brand-400 hover:bg-brand-900/50'
                        }`}>
                        {isDefault ? 'Default' : tracked ? '− Remove' : '+ Add'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {!marketsSearchLoading && marketsSearchQuery && marketsSearchResults.length === 0 && (
              <p className="text-xs text-textDim text-center py-4">No results found.</p>
            )}
          </div>
        </div>
      )}

      {/* Expanded stock detail */}
      {activeStock && (() => {
        const stockCalEvents = stockEvents.filter(e => e.event_type !== 'News');
        const stockNews = stockEvents.filter(e => e.event_type === 'News');
        return (
          <Card className="p-5 space-y-5">
            {/* Header row */}
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-3">
                <h3 className="text-base font-bold font-mono text-textMain">
                  {activeStock.replace(/\.(NS)$/, '').replace(/-USD$/, '').replace(/=F$/, '')}
                </h3>
                {stockQuote?.name && <span className="text-xs text-textMuted">{stockQuote.name}</span>}
              </div>
              <button onClick={() => setQuotesStockTab(null)} className="text-textDim hover:text-textMain text-lg leading-none">×</button>
            </div>

            {/* Price stats */}
            {stockQuote ? (() => {
              const up = (stockQuote.change_pct ?? 0) >= 0;
              return (
                <div className="flex items-end gap-6 flex-wrap">
                  <div>
                    <p className="text-3xl font-light font-mono text-textMain">
                      {stockQuote.price !== null ? fmt(stockQuote.price, stockQuote.price > 100 ? 2 : 4) : '—'}
                    </p>
                  </div>
                  <div className="flex gap-5 pb-1">
                    <div><p className="text-[10px] text-textDim uppercase mb-0.5">Prev Close</p><p className="text-sm font-mono text-textMain">{fmt(stockQuote.prev_close, stockQuote.prev_close && stockQuote.prev_close > 100 ? 2 : 4)}</p></div>
                    <div><p className="text-[10px] text-textDim uppercase mb-0.5">Volume</p><p className="text-sm font-mono text-textMain">{fmtVol(stockQuote.volume)}</p></div>
                    <div><p className="text-[10px] text-textDim uppercase mb-0.5">Change</p><p className={`text-sm font-mono ${up ? 'text-up' : 'text-down'}`}>{stockQuote.change_pct != null ? `${up ? '+' : ''}${stockQuote.change_pct.toFixed(2)}%` : '—'}</p></div>
                  </div>
                </div>
              );
            })() : (
              <p className="text-sm text-textDim">No price data — click Refresh.</p>
            )}

            {/* Upcoming events */}
            {stockCalEvents.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-2">Upcoming Events</p>
                <div className="space-y-2">
                  {stockCalEvents.map((ev, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2.5 bg-surface2 border border-borderLight rounded-lg">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                        ev.event_type === 'Earnings' ? 'bg-brand-100 dark:bg-brand-900/60 text-brand-700 dark:text-brand-300 border border-brand-300 dark:border-brand-700/30' : 'bg-teal-100 dark:bg-teal-900/60 text-teal-700 dark:text-teal-300 border border-teal-300 dark:border-teal-700/30'
                      }`}>{ev.event_type}</span>
                      <span className="text-xs font-mono text-textMain">{ev.date}</span>
                      {ev.detail && <span className="text-xs text-textMuted">{ev.detail}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* News */}
            {stockNews.length > 0 ? (
              <div>
                <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-2">Latest News</p>
                <div className="space-y-2">
                  {stockNews.map((ev, i) => (
                    <div key={i} className="px-3 py-3 bg-surface2 border border-borderLight rounded-lg hover:border-borderMid transition-colors group">
                      {ev.url ? (
                        <a href={ev.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-textMain group-hover:text-brand-400 transition-colors leading-snug block mb-1">
                          {ev.title}
                        </a>
                      ) : (
                        <p className="text-sm font-medium text-textMain leading-snug mb-1">{ev.title}</p>
                      )}
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-textDim font-mono">{ev.date}</span>
                        {ev.detail && <><span className="text-textDim text-[10px]">·</span><span className="text-[10px] text-textDim">{ev.detail}</span></>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-textDim">No news available for this stock.</p>
            )}
          </Card>
        );
      })()}
    </div>
  );
}
