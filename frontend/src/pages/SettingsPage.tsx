import { useEffect, useState } from 'react';
import type { MarketConfig } from '../types';
import { MARKET_ICONS, MARKET_TICKERS } from '../constants';
import { Card } from '../components/Card';
import { SectionHeader } from '../components/SectionHeader';
import { clearToken, apiFetch } from '../utils';
import { Toggle } from '../components/Toggle';

interface DataSource {
  id: string;
  name: string;
  category: string;
  description: string;
  configured: boolean;
  required: boolean;
  url?: string;
  signup_url?: string;
  env_key?: string;
}

interface RssFeed {
  id: number;
  url: string;
  label: string;
  market: string;
  is_enabled: number;
  is_builtin: number;
}

interface SettingsPageProps {
  darkMode: boolean;
  toggleDarkMode: () => void;
  approvalMode: string;
  setMode: (mode: string) => void;
  markets: MarketConfig[];
  toggleMarket: (name: string, enabled: number) => void;
  reloadMarkets: () => void;
}

const CATEGORY_ORDER = ['LLM', 'Market Data', 'News', 'Macro', 'Sentiment', 'Social'];
const CATEGORY_ICON: Record<string, string> = {
  LLM: '◈', 'Market Data': '◆', News: '◎', Macro: '◉', Sentiment: '▣', Social: '▦',
};

const FEED_MARKETS = ['US', 'Crypto', 'India', 'MCX', 'All'];

export function SettingsPage({
  darkMode, toggleDarkMode,
  approvalMode, setMode,
  markets, toggleMarket, reloadMarkets,
}: SettingsPageProps) {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [feeds, setFeeds] = useState<RssFeed[]>([]);
  const [addingFeed, setAddingFeed] = useState(false);
  const [newFeed, setNewFeed] = useState({ url: '', label: '', market: 'US' });
  const [feedError, setFeedError] = useState('');
  const [feedSaving, setFeedSaving] = useState(false);
  const [feedMarketTab, setFeedMarketTab] = useState('All');

  // Per-market ticker add state: { [marketName]: inputValue }
  const [tickerInputs, setTickerInputs] = useState<Record<string, string>>({});
  const [tickerAdding, setTickerAdding] = useState<Record<string, boolean>>({});
  const [localMarkets, setLocalMarkets] = useState<MarketConfig[]>(markets);

  // Sync localMarkets when markets prop changes
  useEffect(() => { setLocalMarkets(markets); }, [markets]);

  useEffect(() => {
    apiFetch('/config/data-sources')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.sources) setSources(d.sources); })
      .catch(() => {});
    loadFeeds();
  }, []);

  function loadFeeds() {
    apiFetch('/config/rss-feeds')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (Array.isArray(d)) setFeeds(d); })
      .catch(() => {});
  }

  function toggleFeed(id: number) {
    apiFetch(`/config/rss-feeds/${id}/toggle`, { method: 'PATCH' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) setFeeds(prev => prev.map(f => f.id === id ? { ...f, is_enabled: d.is_enabled } : f));
      });
  }

  function deleteFeed(id: number) {
    apiFetch(`/config/rss-feeds/${id}`, { method: 'DELETE' })
      .then(r => { if (r.ok) setFeeds(prev => prev.filter(f => f.id !== id)); });
  }

  async function submitFeed() {
    setFeedError('');
    if (!newFeed.url.trim()) { setFeedError('URL is required'); return; }
    if (!newFeed.label.trim()) { setFeedError('Label is required'); return; }
    try { new URL(newFeed.url.trim()); } catch { setFeedError('Enter a valid URL'); return; }
    setFeedSaving(true);
    try {
      const r = await apiFetch('/config/rss-feeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newFeed.url.trim(), label: newFeed.label.trim(), market: newFeed.market }),
      });
      if (r.status === 409) { setFeedError('This feed URL already exists'); return; }
      if (!r.ok) { setFeedError('Failed to add feed'); return; }
      const d = await r.json();
      setFeeds(prev => [...prev, d]);
      setNewFeed({ url: '', label: '', market: 'US' });
      setAddingFeed(false);
    } finally {
      setFeedSaving(false);
    }
  }

  async function addTicker(marketName: string) {
    const sym = (tickerInputs[marketName] ?? '').trim().toUpperCase();
    if (!sym) return;
    setTickerAdding(p => ({ ...p, [marketName]: true }));
    try {
      const r = await apiFetch(`/config/markets/${marketName}/tickers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym }),
      });
      if (r.ok) {
        const d = await r.json();
        setLocalMarkets(prev => prev.map(m =>
          m.market_name === marketName ? { ...m, custom_tickers: d.custom_tickers } : m
        ));
        setTickerInputs(p => ({ ...p, [marketName]: '' }));
        reloadMarkets();
      }
    } finally {
      setTickerAdding(p => ({ ...p, [marketName]: false }));
    }
  }

  async function removeTicker(marketName: string, symbol: string) {
    const r = await apiFetch(`/config/markets/${marketName}/tickers/${symbol}`, { method: 'DELETE' });
    if (r.ok) {
      const d = await r.json();
      setLocalMarkets(prev => prev.map(m =>
        m.market_name === marketName ? { ...m, custom_tickers: d.custom_tickers } : m
      ));
      reloadMarkets();
    }
  }

  const grouped = CATEGORY_ORDER.reduce<Record<string, DataSource[]>>((acc, cat) => {
    acc[cat] = sources.filter(s => s.category === cat);
    return acc;
  }, {});

  const visibleFeeds = feedMarketTab === 'All' ? feeds : feeds.filter(f => f.market === feedMarketTab);
  const feedMarkets = ['All', ...Array.from(new Set(feeds.map(f => f.market)))];

  return (
    <div className="max-w-3xl mx-auto space-y-8">

      {/* Display & Strategy */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-textMuted uppercase tracking-widest">Display &amp; Strategy</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card>
            <SectionHeader title="Appearance" />
            <div className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-textMain">{darkMode ? 'Dark Mode' : 'Light Mode'}</p>
                  <p className="text-[11px] text-textMuted mt-0.5">{darkMode ? 'Easy on the eyes at night' : 'Bright and clear'}</p>
                </div>
                <button
                  onClick={toggleDarkMode}
                  className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors duration-300 focus:outline-none ${darkMode ? 'bg-brand-600' : 'bg-surface3 border border-borderLight'}`}
                >
                  <span className={`absolute text-sm transition-all duration-300 ${darkMode ? 'left-1.5' : 'right-1.5'}`}>
                    {darkMode ? '🌙' : '☀️'}
                  </span>
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-300 ${darkMode ? 'translate-x-7' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
          </Card>

          <Card>
            <SectionHeader title="Approval Mode" />
            <div className="p-5 space-y-3">
              <div className="flex rounded-lg overflow-hidden border border-borderLight">
                <button onClick={() => setMode('auto')} className={`flex-1 py-2.5 text-sm font-medium transition-colors ${approvalMode === 'auto' ? 'bg-brand-600 text-white' : 'bg-surface2 text-textMuted hover:bg-surface3'}`}>
                  Auto Deploy
                </button>
                <button onClick={() => setMode('manual')} className={`flex-1 py-2.5 text-sm font-medium transition-colors ${approvalMode === 'manual' ? 'bg-amber-600 text-white' : 'bg-surface2 text-textMuted hover:bg-surface3'}`}>
                  Manual
                </button>
              </div>
              <p className="text-xs text-textMuted">{approvalMode === 'auto' ? 'Strategies deploy automatically after consensus.' : 'Each strategy requires your approval before going live.'}</p>
            </div>
          </Card>
        </div>
      </section>

      {/* Markets */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-textMuted uppercase tracking-widest">Markets</h2>
        <Card>
          <SectionHeader title="Enabled Markets" />
          <div className="p-5 space-y-3">
            {localMarkets.map(m => {
              const baseTickers = m.base_tickers ?? MARKET_TICKERS[m.market_name] ?? [];
              const customTickers = m.custom_tickers ?? [];
              const totalCount = baseTickers.length + customTickers.length;
              return (
                <div key={m.id} className="border border-borderLight rounded-xl overflow-hidden">
                  {/* Market header row */}
                  <div className="flex items-center justify-between bg-surface2 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xl leading-none">{MARKET_ICONS[m.market_name] ?? '📊'}</span>
                      <div>
                        <p className="text-sm font-medium text-textMain">{m.market_name}</p>
                        <p className="text-[11px] text-textMuted">{totalCount} ticker{totalCount !== 1 ? 's' : ''}{customTickers.length > 0 ? ` (${customTickers.length} custom)` : ''}</p>
                      </div>
                    </div>
                    <Toggle checked={!!m.is_enabled} onChange={() => toggleMarket(m.market_name, m.is_enabled)} />
                  </div>

                  {/* Ticker pills */}
                  <div className="px-4 py-3 flex flex-wrap gap-1.5">
                    {baseTickers.map(t => (
                      <span key={t} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono bg-surface3 border border-borderLight text-textMuted">
                        {t}
                      </span>
                    ))}
                    {customTickers.map(t => (
                      <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-brand-500/10 border border-brand-500/30 text-brand-400">
                        {t}
                        <button
                          onClick={() => removeTicker(m.market_name, t)}
                          className="text-[9px] opacity-60 hover:opacity-100 hover:text-down transition-colors leading-none"
                          title="Remove"
                        >✕</button>
                      </span>
                    ))}

                    {/* Inline add input */}
                    <form
                      onSubmit={e => { e.preventDefault(); addTicker(m.market_name); }}
                      className="inline-flex items-center gap-1"
                    >
                      <input
                        type="text"
                        value={tickerInputs[m.market_name] ?? ''}
                        onChange={e => setTickerInputs(p => ({ ...p, [m.market_name]: e.target.value.toUpperCase() }))}
                        placeholder="+ Add ticker"
                        className="w-24 px-2 py-0.5 rounded-full text-[10px] font-mono bg-surface3 border border-borderLight text-textMain placeholder-textDim focus:outline-none focus:border-brand-500 transition-colors"
                      />
                      {(tickerInputs[m.market_name] ?? '').trim() && (
                        <button
                          type="submit"
                          disabled={tickerAdding[m.market_name]}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-brand-500 text-white font-medium disabled:opacity-50"
                        >
                          {tickerAdding[m.market_name] ? '…' : 'Add'}
                        </button>
                      )}
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </section>

      {/* Data Sources */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-textMuted uppercase tracking-widest">Data Sources</h2>

        {/* API / service sources — 2-col grid of compact cards */}
        {sources.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {CATEGORY_ORDER.filter(cat => cat !== 'News' && grouped[cat]?.length > 0).flatMap(cat =>
              grouped[cat].map(src => (
                <div key={src.id} className="flex items-start gap-3 p-4 bg-surface2 border border-borderLight rounded-xl">
                  <div className="mt-1 shrink-0">
                    <span className={`inline-block w-2 h-2 rounded-full ${src.configured ? 'bg-up' : src.required ? 'bg-down' : 'bg-borderMid'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                      <span className="text-xs font-semibold text-textMain">{src.name}</span>
                      <span className="text-[9px] text-textDim uppercase tracking-wider">{src.category}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mb-1">
                      {src.required && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-brand-600/10 text-brand-500 border border-brand-500/20">required</span>}
                      {!src.required && src.configured && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-up-bg text-up-text border border-up/20">active</span>}
                      {!src.required && !src.configured && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface3 text-textDim border border-borderLight">not configured</span>}
                    </div>
                    <p className="text-[11px] text-textMuted leading-relaxed">{src.description}</p>
                    {src.env_key && !src.configured && (
                      <p className="text-[10px] text-textDim mt-1 font-mono truncate">
                        <span className="text-amber-500">{src.env_key}</span>
                        {src.signup_url && <> · <a href={src.signup_url} target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">get key ↗</a></>}
                      </p>
                    )}
                    {src.env_key && src.configured && (
                      <p className="text-[10px] text-textDim mt-1 font-mono"><span className="text-up-text">{src.env_key}</span></p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* RSS Feeds — full CRUD */}
        <Card>
          <div className="px-5 pt-4 pb-3 border-b border-borderLight flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-textMuted text-sm">{CATEGORY_ICON['News']}</span>
              <span className="text-xs font-semibold text-textMuted uppercase tracking-widest">RSS Feeds</span>
              <span className="text-[10px] bg-surface3 text-textDim rounded-full px-1.5 py-0.5 ml-1">{feeds.filter(f => f.is_enabled).length} active</span>
            </div>
            <button
              onClick={() => { setAddingFeed(v => !v); setFeedError(''); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-brand-600/10 border border-brand-500/30 text-brand-400 hover:bg-brand-600/20 transition-all"
            >
              {addingFeed ? '✕ Cancel' : '+ Add Feed'}
            </button>
          </div>

          {/* Add feed form */}
          {addingFeed && (
            <div className="px-5 py-4 border-b border-borderLight bg-surface2/50 space-y-3">
              <p className="text-xs font-medium text-textMain">Add RSS Feed</p>
              <div className="space-y-2">
                <input
                  type="url"
                  placeholder="Feed URL (https://...)"
                  value={newFeed.url}
                  onChange={e => setNewFeed(v => ({ ...v, url: e.target.value }))}
                  className="w-full bg-surface border border-borderLight rounded-lg px-3 py-2 text-xs text-textMain placeholder-textDim focus:outline-none focus:border-brand-500 font-mono"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Label (e.g. Reuters Markets)"
                    value={newFeed.label}
                    onChange={e => setNewFeed(v => ({ ...v, label: e.target.value }))}
                    className="flex-1 bg-surface border border-borderLight rounded-lg px-3 py-2 text-xs text-textMain placeholder-textDim focus:outline-none focus:border-brand-500"
                  />
                  <select
                    value={newFeed.market}
                    onChange={e => setNewFeed(v => ({ ...v, market: e.target.value }))}
                    className="bg-surface border border-borderLight rounded-lg px-3 py-2 text-xs text-textMain focus:outline-none focus:border-brand-500"
                  >
                    {FEED_MARKETS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                {feedError && <p className="text-[11px] text-down">{feedError}</p>}
                <button
                  onClick={submitFeed}
                  disabled={feedSaving}
                  className="px-4 py-1.5 bg-brand-600 text-white text-xs font-semibold rounded-lg hover:bg-brand-500 disabled:opacity-50 transition-colors"
                >
                  {feedSaving ? 'Adding…' : 'Add Feed'}
                </button>
              </div>
            </div>
          )}

          {/* Market tabs */}
          {feedMarkets.length > 1 && (
            <div className="flex border-b border-borderLight overflow-x-auto">
              {feedMarkets.map(m => (
                <button key={m}
                  onClick={() => setFeedMarketTab(m)}
                  className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${feedMarketTab === m ? 'border-brand-500 text-textMain' : 'border-transparent text-textMuted hover:text-textMain'}`}
                >
                  {m === 'All' ? `All (${feeds.length})` : `${MARKET_ICONS[m] ?? ''} ${m} (${feeds.filter(f => f.market === m).length})`}
                </button>
              ))}
            </div>
          )}

          {/* Feed list */}
          <div className="divide-y divide-borderLight">
            {visibleFeeds.length === 0 && (
              <p className="px-5 py-4 text-sm text-textMuted">No feeds in this market.</p>
            )}
            {visibleFeeds.map(feed => (
              <div key={feed.id} className="flex items-center gap-3 px-5 py-3">
                <div className="shrink-0">
                  <span className={`inline-block w-2 h-2 rounded-full ${feed.is_enabled ? 'bg-up' : 'bg-borderMid'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-textMain truncate">{feed.label}</span>
                    {feedMarketTab === 'All' && (
                      <span className="text-[10px] text-textDim bg-surface3 px-1.5 py-0.5 rounded shrink-0">{feed.market}</span>
                    )}
                    {feed.is_builtin ? (
                      <span className="text-[10px] text-textDim shrink-0">built-in</span>
                    ) : (
                      <span className="text-[10px] text-brand-400 shrink-0">custom</span>
                    )}
                  </div>
                  <p className="text-[10px] text-textDim font-mono truncate mt-0.5">{feed.url}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Toggle checked={!!feed.is_enabled} onChange={() => toggleFeed(feed.id)} />
                  {!feed.is_builtin && (
                    <button
                      onClick={() => deleteFeed(feed.id)}
                      className="px-2 py-1 text-[10px] bg-down-bg text-down-text border border-down/20 rounded hover:opacity-80 transition-opacity"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* Account */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-textMuted uppercase tracking-widest">Account</h2>
        <Card>
          <div className="p-5">
            <button
              onClick={() => { clearToken(); window.location.reload(); }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium border border-borderMid bg-surface2 text-textMain hover:bg-down-bg hover:border-down/30 hover:text-down-text transition-colors"
            >
              <span className="text-base leading-none">⏻</span> Sign Out
            </button>
          </div>
        </Card>
      </section>

    </div>
  );
}
