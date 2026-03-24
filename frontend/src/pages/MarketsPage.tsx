import React, { useState, useEffect, useRef } from 'react';
import type { Strategy, LiveQuote, MarketEvent, MarketConfig } from '../types';
import { MARKET_ICONS, TICKER_DB, TICKER_META } from '../constants';
import { apiFetch, getCurrencySymbol } from '../utils';
import { Card } from '../components/Card';

interface MarketsPageProps {
  enabledMarketNames: string[];
  markets?: MarketConfig[];
  activeStrategies: Strategy[];
  pendingStrategies: Strategy[];
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
  onMarketsChange: () => void;
  fetchQuotes: () => void;
  openReport: (id: number) => void;
  onApprove: (id: number, action: string) => void;
}

// ── Market hours config ───────────────────────────────────────────────────
// All times in local hours of the exchange timezone

interface MarketSession { open: number; close: number; label: string; tz: string; }

const MARKET_SESSIONS: Record<string, MarketSession | null> = {
  US:     { open: 9.5,  close: 16,   label: 'NYSE / NASDAQ',   tz: 'America/New_York' },
  India:  { open: 9.25, close: 15.5, label: 'NSE / BSE',       tz: 'Asia/Kolkata'     },
  MCX:    { open: 9,    close: 23.5, label: 'MCX',             tz: 'Asia/Kolkata'     },
  Crypto: null, // 24/7
};

// Days: 0=Sun, 6=Sat. US and India are Mon–Fri only. MCX Mon–Fri + Sat till 14:00.
const MCX_SAT_CLOSE = 14;

function getMarketStatus(market: string, now: Date): {
  isOpen: boolean; label: string; statusText: string; countdown: string;
  openPct: number; localTime: string;
} {
  if (market === 'Crypto') {
    const localTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false });
    return { isOpen: true, label: 'Crypto', statusText: 'Open 24/7', countdown: '', openPct: 100, localTime: `${localTime} UTC` };
  }

  const session = MARKET_SESSIONS[market];
  if (!session) return { isOpen: false, label: market, statusText: 'Unknown', countdown: '', openPct: 0, localTime: '' };

  // Get current time in exchange timezone using Intl.DateTimeFormat for reliable field extraction
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: session.tz,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  const parts = dtf.formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '0';
  const weekday = get('weekday'); // 'Mon', 'Tue', etc.
  const localHour = (parseInt(get('hour'), 10) % 24) + parseInt(get('minute'), 10) / 60 + parseInt(get('second'), 10) / 3600;
  const dayIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);

  const localTimeDisplay = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: session.tz, hour12: false });
  const tzShort = session.tz === 'America/New_York' ? 'ET' : 'IST';

  // Determine if weekday trading day
  const isWeekday = dayIdx >= 1 && dayIdx <= 5;
  const isSat = dayIdx === 6;

  let isOpen = false;
  let effectiveClose = session.close;

  if (market === 'MCX') {
    if (isSat) effectiveClose = MCX_SAT_CLOSE;
    isOpen = (isWeekday || isSat) && localHour >= session.open && localHour < effectiveClose;
  } else {
    isOpen = isWeekday && localHour >= session.open && localHour < session.close;
  }

  // Time until open or close (in minutes)
  const toMinutes = (h: number) => Math.round(h * 60);
  const nowMin = Math.round(localHour * 60);

  let countdown = '';
  let openPct = 0;

  if (isOpen) {
    const closeMin = toMinutes(effectiveClose);
    const openMin = toMinutes(session.open);
    const totalMin = closeMin - openMin;
    const elapsedMin = nowMin - openMin;
    openPct = Math.min(100, Math.max(0, Math.round((elapsedMin / totalMin) * 100)));
    const remaining = closeMin - nowMin;
    const h = Math.floor(remaining / 60);
    const m = remaining % 60;
    countdown = h > 0 ? `${h}h ${m}m until close` : `${m}m until close`;
  } else {
    openPct = 0;
    // Find next open: today if before open, else next trading day
    let minsToOpen: number;
    const openMin = toMinutes(session.open);
    if ((isWeekday || (market === 'MCX' && isSat)) && nowMin < openMin) {
      minsToOpen = openMin - nowMin;
    } else {
      // Find next weekday
      let daysAhead = 1;
      while (daysAhead <= 7) {
        const nextDay = (dayIdx + daysAhead) % 7;
        const nextIsWeekday = nextDay >= 1 && nextDay <= 5;
        const nextIsSat = nextDay === 6;
        if (nextIsWeekday || (market === 'MCX' && nextIsSat)) break;
        daysAhead++;
      }
      minsToOpen = daysAhead * 24 * 60 - nowMin + openMin;
    }
    const h = Math.floor(minsToOpen / 60);
    const m = minsToOpen % 60;
    const days = Math.floor(h / 24);
    const rh = h % 24;
    if (days > 0) countdown = `Opens in ${days}d ${rh}h`;
    else if (rh > 0) countdown = `Opens in ${rh}h ${m}m`;
    else countdown = `Opens in ${m}m`;
  }

  return {
    isOpen,
    label: session.label,
    statusText: isOpen ? 'Open' : 'Closed',
    countdown,
    openPct,
    localTime: `${localTimeDisplay} ${tzShort}`,
  };
}

function MarketClock({ market }: { market: string }) {
  const [now, setNow] = useState(() => new Date());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => setNow(new Date()), 30000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const status = getMarketStatus(market, now);
  const isCrypto = market === 'Crypto';

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border ${status.isOpen ? 'bg-up/[0.04] border-up/20' : 'bg-surface2 border-borderLight'}`}>
      {/* Status dot */}
      <div className="shrink-0 flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full shrink-0 ${status.isOpen ? 'bg-up animate-pulse' : 'bg-textDim'}`} />
        <span className={`text-xs font-semibold ${status.isOpen ? 'text-up' : 'text-textDim'}`}>{status.statusText}</span>
      </div>

      <div className="h-3 w-px bg-borderLight shrink-0" />

      {/* Exchange label + local time */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-[11px] text-textMuted font-medium truncate">{status.label}</span>
        <span className="text-[10px] text-textDim font-mono">{status.localTime}</span>
      </div>

      {!isCrypto && (
        <>
          <div className="h-3 w-px bg-borderLight shrink-0" />
          {/* Progress bar */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="flex-1 h-1 bg-surface3 rounded-full overflow-hidden min-w-[60px]">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${status.isOpen ? 'bg-up' : 'bg-borderMid'}`}
                style={{ width: `${status.openPct}%` }}
              />
            </div>
            <span className="text-[10px] text-textDim whitespace-nowrap shrink-0">{status.countdown}</span>
          </div>
        </>
      )}
    </div>
  );
}


export function MarketsPage({
  enabledMarketNames, markets = [], activeStrategies, pendingStrategies, liveQuotes, marketEvents,
  quotesLoading, quotesMarketTab, quotesStockTab, watchlist,
  marketsSearchOpen, marketsSearchQuery, marketsSearchResults, marketsSearchLoading,
  marketsSearchTimer,
  setQuotesMarketTab, setQuotesStockTab, setMarketsSearchOpen,
  setMarketsSearchQuery, setMarketsSearchResults, setMarketsSearchLoading,
  setWatchlist, onMarketsChange, fetchQuotes, openReport, onApprove,
}: MarketsPageProps) {
  const [selectedTickers, setSelectedTickers] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);

  useEffect(() => {
    if (!marketsSearchOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMarketsSearchOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [marketsSearchOpen, setMarketsSearchOpen]);

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

  // Only tickers from enabled markets (static DB)
  const allDefaultSymbols = TICKER_DB.filter(t => enabledMarketNames.includes(t.market)).map(t => t.symbol);
  // Custom tickers from MarketConfig (user-persisted via Settings)
  const customMarketSymbols = markets.flatMap(m =>
    enabledMarketNames.includes(m.market_name) ? (m.custom_tickers ?? []) : []
  );
  // User-added symbols from watchlist (session-only, not in TICKER_DB)
  const userAddedSymbols = watchlist.filter(s => !allDefaultSymbols.includes(s) && !customMarketSymbols.includes(s));
  // Combined unique symbol list
  const allSymbols = [...new Set([...allDefaultSymbols, ...customMarketSymbols, ...userAddedSymbols])];

  // Resolve active tab — default to first enabled market
  const activeMarketTab = (quotesMarketTab && enabledMarketNames.includes(quotesMarketTab))
    ? quotesMarketTab
    : (enabledMarketNames[0] ?? '');

  // Build a quick lookup: custom symbol → market name
  const customSymbolMarket: Record<string, string> = {};
  for (const m of markets) {
    for (const t of (m.custom_tickers ?? [])) customSymbolMarket[t] = m.market_name;
  }

  // Filter by market tab
  const tabSymbols = allSymbols.filter(sym => {
    const meta = TICKER_META[sym];
    if (meta) return meta.market === activeMarketTab;
    // Custom ticker — use market from MarketConfig
    if (customSymbolMarket[sym]) return customSymbolMarket[sym] === activeMarketTab;
    // Watchlist / unknown — detect market from live quote data
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

  // Pending-only symbols (no active position) for this tab
  const pendingOnlyTabSymbols = pendingStrategies
    .filter(s => !activeStrategies.some(a => a.symbol === s.symbol))
    .map(s => s.symbol)
    .filter(sym => {
      const meta = TICKER_META[sym];
      if (meta) return meta.market === activeMarketTab;
      const q = liveQuotes.find(q => q.symbol === sym);
      return q?.market === activeMarketTab;
    });

  const activeStock = (
    (quotesStockTab && tabSymbols.includes(quotesStockTab)) ||
    (quotesStockTab && positionTabSymbols.includes(quotesStockTab)) ||
    (quotesStockTab && pendingOnlyTabSymbols.includes(quotesStockTab))
  ) ? quotesStockTab : null;
  const stockQuote = activeStock ? liveQuotes.find(q => q.symbol === activeStock) ?? null : null;
  const stockEvents = activeStock ? marketEvents.filter(e => e.symbol === activeStock) : [];
  const stockPending = activeStock ? pendingStrategies.filter(s => s.symbol === activeStock) : [];

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

  const toggleWatchlist = async (sym: string) => {
    const isAdded = customMarketSymbols.includes(sym) || watchlist.includes(sym);
    if (isAdded) {
      // Remove from the market it belongs to
      const market = customSymbolMarket[sym] ?? activeMarketTab;
      await apiFetch(`/config/markets/${market}/tickers/${encodeURIComponent(sym)}`, { method: 'DELETE' });
      setWatchlist(prev => { const next = prev.filter(s => s !== sym); localStorage.setItem('watchlist', JSON.stringify(next)); return next; });
    } else {
      // Add to currently active market tab
      await apiFetch(`/config/markets/${activeMarketTab}/tickers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym }),
      });
      setWatchlist(prev => { const next = [...prev, sym]; localStorage.setItem('watchlist', JSON.stringify(next)); return next; });
    }
    onMarketsChange();
    fetchQuotes();
  };

  const isTracked = (sym: string) => allDefaultSymbols.includes(sym) || customMarketSymbols.includes(sym) || watchlist.includes(sym);

  const renderStockCard = (sym: string, hasPosition = false) => {
    const q = liveQuotes.find(lq => lq.symbol === sym);
    const up = (q?.change_pct ?? 0) >= 0;
    const isActive = activeStock === sym;
    const ticker = sym.replace(/\.(NS)$/, '').replace(/-USD$/, '').replace(/=F$/, '');
    const isUserAdded = !allDefaultSymbols.includes(sym);
    const activePos = activeStrategies.find(s => s.symbol === sym);
    const pendingPos = pendingStrategies.find(s => s.symbol === sym);
    const posReturn = activePos?.current_return ?? null;
    const posUp = (posReturn ?? 0) >= 0;
    const isSelected = selectedTickers.has(sym);

    const handleCardClick = () => {
      if (selectMode) {
        setSelectedTickers(prev => {
          const next = new Set(prev);
          if (next.has(sym)) { next.delete(sym); } else { next.add(sym); }
          return next;
        });
      } else {
        setQuotesStockTab(isActive ? null : sym);
      }
    };

    return (
      <button key={sym} onClick={handleCardClick}
        className={`text-left p-4 rounded-xl border transition-all relative ${
          isSelected
            ? 'border-brand-500 bg-brand-900/20 ring-1 ring-brand-500/40'
            : hasPosition
              ? isActive
                ? `border-l-2 ${posUp ? 'border-l-up border-up/60 bg-up-bg ring-1 ring-up/20' : 'border-l-down border-down/60 bg-down-bg ring-1 ring-down/20'}`
                : `border-l-2 ${posUp ? 'border-l-up border-borderLight bg-surface hover:bg-surface2' : 'border-l-down border-borderLight bg-surface hover:bg-surface2'}`
              : isActive
                ? 'border-brand-500 bg-brand-900/20 ring-1 ring-brand-500/30'
                : 'border-borderLight bg-surface hover:border-borderMid hover:bg-surface2'
        }`}>
        {/* Selection checkbox (select mode) */}
        {selectMode && (
          <div className={`absolute top-2 right-2 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
            isSelected ? 'bg-brand-500 border-brand-500' : 'border-borderMid bg-surface3'
          }`}>
            {isSelected && <span className="text-[9px] text-white font-bold">✓</span>}
          </div>
        )}
        {/* Remove button for user-added symbols (non-select mode) */}
        {isUserAdded && !selectMode && (
          <button
            onClick={e => { e.stopPropagation(); toggleWatchlist(sym); }}
            className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center text-[10px] text-textDim hover:text-down-text hover:bg-down-bg rounded transition-colors"
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
        {/* Trade status badges */}
        <div className="mt-2 flex items-center flex-wrap gap-1.5">
          {activePos && posReturn !== null && (
            <>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                activePos.strategy_type === 'LONG'
                  ? 'bg-up/15 text-up border-up/30'
                  : 'bg-down/15 text-down border-down/30'
              }`}>
                {activePos.strategy_type === 'LONG' ? '▲' : '▼'} {activePos.strategy_type}
              </span>
              <span className={`text-[10px] font-semibold ${posUp ? 'text-up' : 'text-down'}`}>
                {posUp ? '+' : ''}{posReturn.toFixed(2)}%
              </span>
            </>
          )}
          {pendingPos && !activePos && (
            <span
              className="group relative inline-flex items-center"
              title="Pending suggested trade — click to review">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="absolute left-4 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center whitespace-nowrap bg-surface border border-borderMid text-[10px] text-amber-400 px-2 py-1 rounded-lg shadow-lg z-10 gap-1 pointer-events-none">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                Pending {pendingPos.strategy_type} — click to review
              </span>
            </span>
          )}
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xs font-semibold text-textMuted uppercase tracking-widest">Markets</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {quotesLoading && <span className="text-[10px] text-amber-400 animate-pulse">Fetching…</span>}

          {/* Select mode toggle */}
          <button
            onClick={() => { setSelectMode(s => !s); if (selectMode) setSelectedTickers(new Set()); }}
            className={`text-[11px] px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1.5 ${
              selectMode
                ? 'bg-brand-900/40 border-brand-500 text-brand-300'
                : 'bg-surface2 border-borderLight text-textMuted hover:border-brand-500 hover:text-brand-400'
            }`}>
            {selectMode ? `✓ ${selectedTickers.size} selected` : '⊡ Select'}
          </button>


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

      {/* Select mode hint */}
      {selectMode && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-900/20 border border-brand-700/30 text-[11px] text-brand-300">
          <span>Click tickers to select them, then run the pipeline focused on your selection.</span>
          <button onClick={() => { setSelectMode(false); setSelectedTickers(new Set()); }} className="ml-auto text-brand-400 hover:text-brand-300 underline">Cancel</button>
        </div>
      )}

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

      {/* Market clock */}
      {activeMarketTab && <MarketClock market={activeMarketTab} />}

      {/* Cards + inline detail */}
      <div className="space-y-4">
        {/* Render a section: renders cards and injects the detail panel below the row containing the active card */}
        {[
          { label: positionTabSymbols.length > 0 ? `Active Positions (${positionTabSymbols.length})` : null, syms: positionTabSymbols, hasPos: true },
          { label: positionTabSymbols.length > 0 ? 'Watchlist' : null, syms: watchlistTabSymbols, hasPos: false },
        ].map(({ label, syms, hasPos }) => {
          if (syms.length === 0) return null;
          const cols = 4; // fixed columns to track row breaks
          const activeIdx = activeStock ? syms.indexOf(activeStock) : -1;

          return (
            <div key={label ?? 'main'}>
              {label && (
                <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  {hasPos && <span className="w-1.5 h-1.5 rounded-full bg-up inline-block" />}
                  {label}
                </p>
              )}
              {/* Grid with injected detail panel */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {syms.map((sym, idx) => {
                  const card = renderStockCard(sym, hasPos);
                  // After every row-end or last item, if active card is in this row inject detail
                  const rowEnd = (idx + 1) % cols === 0 || idx === syms.length - 1;
                  const rowStart = Math.floor(idx / cols) * cols;
                  const rowContainsActive = activeIdx >= rowStart && activeIdx <= rowStart + cols - 1;
                  const injectDetail = rowEnd && rowContainsActive && activeStock;

                  return (
                    <React.Fragment key={sym}>
                      {card}
                      {injectDetail && (() => {
                        const stockCalEvents = stockEvents.filter(e => e.event_type !== 'News');
                        const stockNews = stockEvents.filter(e => e.event_type === 'News');
                        return (
                          <div className="col-span-2 sm:col-span-3 lg:col-span-4 -mt-1">
                            <Card className="p-0 overflow-hidden border-brand-500/40 bg-surface2/60">
                              {/* Header */}
                              <div className="flex items-center justify-between px-4 py-3 border-b border-borderLight bg-surface3/50">
                                <div className="flex items-baseline gap-2 min-w-0">
                                  <span className="text-sm font-bold font-mono text-textMain">
                                    {activeStock.replace(/\.(NS)$/, '').replace(/-USD$/, '').replace(/=F$/, '')}
                                  </span>
                                  {stockQuote?.name && <span className="text-[11px] text-textMuted">{stockQuote.name}</span>}
                                  {stockPending.length > 0 && (
                                    <span className="flex items-center gap-1 text-[10px] text-amber-400 font-medium">
                                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                      Pending trade
                                    </span>
                                  )}
                                </div>
                                <button onClick={() => setQuotesStockTab(null)} className="text-textDim hover:text-textMain text-base leading-none ml-2 px-1">×</button>
                              </div>

                              {/* Pending trade approval panel */}
                              {stockPending.length > 0 && (
                                <div className="border-b border-borderLight bg-amber-950/10 px-4 py-3 space-y-2.5">
                                  <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">Suggested Trade — Awaiting Approval</p>
                                  {stockPending.map(s => (
                                    <div key={s.id} className="space-y-2">
                                      <div className="flex items-center justify-between flex-wrap gap-2">
                                        <div className="flex items-center gap-2">
                                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${
                                            s.strategy_type === 'LONG'
                                              ? 'bg-up/10 text-up border-up/20'
                                              : 'bg-down/10 text-down border-down/20'
                                          }`}>{s.strategy_type === 'LONG' ? '▲' : '▼'} {s.strategy_type}</span>
                                          <span className="text-[11px] font-mono text-textMuted">Entry: {s.entry_price != null ? `${getCurrencySymbol(s.symbol)}${s.entry_price.toFixed(4)}` : '—'}</span>
                                        </div>
                                        <div className="flex gap-2">
                                          <button
                                            onClick={() => openReport(s.id)}
                                            className="px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-brand-500/10 border border-brand-500/30 text-brand-400 hover:bg-brand-500/20 transition-all flex items-center gap-1.5">
                                            <span className="text-xs">◈</span> Full Research Report
                                          </button>
                                          <button
                                            onClick={() => { onApprove(s.id, 'approve'); setQuotesStockTab(null); }}
                                            className="px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-up/10 border border-up/20 text-up hover:bg-up/15 transition-colors">
                                            ✓ Approve
                                          </button>
                                          <button
                                            onClick={() => { onApprove(s.id, 'reject'); setQuotesStockTab(null); }}
                                            className="px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-down/10 border border-down/20 text-down hover:bg-down/15 transition-colors">
                                            ✕ Reject
                                          </button>
                                        </div>
                                      </div>
                                      {s.reasoning_summary && (
                                        <p className="text-[11px] text-textMuted leading-relaxed">{s.reasoning_summary}</p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}

                              <div className="flex flex-wrap gap-0 divide-x divide-borderLight">
                                {/* Price block */}
                                <div className="px-4 py-3 min-w-[160px]">
                                  {stockQuote ? (() => {
                                    const up = (stockQuote.change_pct ?? 0) >= 0;
                                    return (
                                      <div>
                                        <p className="text-xl font-light font-mono text-textMain leading-none mb-2">
                                          {stockQuote.price !== null ? fmt(stockQuote.price, stockQuote.price > 100 ? 2 : 4) : '—'}
                                        </p>
                                        <div className="flex gap-4 flex-wrap">
                                          <div>
                                            <p className="text-[9px] text-textDim uppercase mb-0.5">Change</p>
                                            <p className={`text-xs font-mono font-semibold ${up ? 'text-up' : 'text-down'}`}>
                                              {stockQuote.change_pct != null ? `${up ? '+' : ''}${stockQuote.change_pct.toFixed(2)}%` : '—'}
                                            </p>
                                          </div>
                                          <div>
                                            <p className="text-[9px] text-textDim uppercase mb-0.5">Prev Close</p>
                                            <p className="text-xs font-mono text-textMain">{fmt(stockQuote.prev_close, stockQuote.prev_close && stockQuote.prev_close > 100 ? 2 : 4)}</p>
                                          </div>
                                          <div>
                                            <p className="text-[9px] text-textDim uppercase mb-0.5">Volume</p>
                                            <p className="text-xs font-mono text-textMain">{fmtVol(stockQuote.volume)}</p>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })() : <p className="text-xs text-textDim">No price data</p>}
                                </div>

                                {/* Events block */}
                                {stockCalEvents.length > 0 && (
                                  <div className="px-4 py-3 min-w-[200px]">
                                    <p className="text-[9px] font-semibold text-textDim uppercase tracking-wider mb-2">Upcoming Events</p>
                                    <div className="space-y-1.5">
                                      {stockCalEvents.map((ev, i) => (
                                        <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 bg-surface2 border border-borderLight rounded-lg">
                                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${
                                            ev.event_type === 'Earnings' ? 'bg-brand-900/60 text-brand-300 border border-brand-700/30' : 'bg-teal-900/60 text-teal-300 border border-teal-700/30'
                                          }`}>{ev.event_type}</span>
                                          <span className="text-[11px] font-mono text-textMain">{ev.date}</span>
                                          {ev.detail && <span className="text-[10px] text-textMuted truncate">{ev.detail}</span>}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* News block */}
                                <div className="px-4 py-3 flex-1 min-w-[240px]">
                                  <p className="text-[9px] font-semibold text-textDim uppercase tracking-wider mb-2">Latest News</p>
                                  {stockNews.length > 0 ? (
                                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                      {stockNews.map((ev, i) => (
                                        <div key={i} className="px-2.5 py-2 bg-surface2 border border-borderLight rounded-lg hover:border-borderMid transition-colors group">
                                          {ev.url ? (
                                            <a href={ev.url} target="_blank" rel="noreferrer" className="text-[11px] font-medium text-textMain group-hover:text-brand-400 transition-colors leading-snug block mb-1">
                                              {ev.title}
                                            </a>
                                          ) : (
                                            <p className="text-[11px] font-medium text-textMain leading-snug mb-1">{ev.title}</p>
                                          )}
                                          <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-textDim font-mono">{ev.date}</span>
                                            {ev.detail && <span className="text-[10px] text-textDim">{ev.detail}</span>}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-[11px] text-textDim">No news available.</p>
                                  )}
                                </div>
                              </div>
                            </Card>
                          </div>
                        );
                      })()}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          );
        })}

        {tabSymbols.length === 0 && positionTabSymbols.length === 0 && (
          <div className="py-10 text-center text-textDim text-sm">No symbols tracked for this market.</div>
        )}
      </div>

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
            {/* Custom tickers for active market tab */}
            {(() => {
              const tabCustom = markets.find(m => m.market_name === activeMarketTab)?.custom_tickers ?? [];
              if (tabCustom.length === 0 || marketsSearchQuery) return null;
              return (
                <div>
                  <p className="text-[10px] text-textDim uppercase tracking-wider mb-2">Currently Added — {activeMarketTab}</p>
                  <div className="flex flex-wrap gap-2">
                    {tabCustom.map(sym => (
                      <span key={sym} className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-brand-900/40 border border-brand-700/40 text-brand-300">
                        {sym.replace(/\.(NS)$/, '').replace(/-USD$/, '').replace(/=F$/, '')}
                        <button onClick={() => toggleWatchlist(sym)} className="hover:text-down-text ml-0.5">×</button>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}
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
                              ? 'border-down/50 bg-down-bg text-down-text hover:bg-down/20'
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

    </div>
  );
}
