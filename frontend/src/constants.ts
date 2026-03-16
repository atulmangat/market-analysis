import type { TickerMeta, Page } from './types';

export const MARKET_ICONS: Record<string, string> = { US: '🇺🇸', India: '🇮🇳', Crypto: '₿', MCX: '⛏️' };
export const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000/api';

export const TICKER_DB: TickerMeta[] = [
  // US — Tech
  { symbol: 'AAPL',  name: 'Apple',             market: 'US',     sector: 'Tech' },
  { symbol: 'MSFT',  name: 'Microsoft',          market: 'US',     sector: 'Tech' },
  { symbol: 'NVDA',  name: 'NVIDIA',             market: 'US',     sector: 'Tech' },
  { symbol: 'GOOGL', name: 'Alphabet',           market: 'US',     sector: 'Tech' },
  { symbol: 'META',  name: 'Meta Platforms',     market: 'US',     sector: 'Tech' },
  { symbol: 'AMD',   name: 'AMD',                market: 'US',     sector: 'Tech' },
  // US — Consumer / E-commerce
  { symbol: 'AMZN',  name: 'Amazon',             market: 'US',     sector: 'Consumer' },
  { symbol: 'TSLA',  name: 'Tesla',              market: 'US',     sector: 'Consumer' },
  // US — ETFs
  { symbol: 'SPY',   name: 'S&P 500 ETF',        market: 'US',     sector: 'ETF' },
  { symbol: 'QQQ',   name: 'Nasdaq 100 ETF',     market: 'US',     sector: 'ETF' },
  // India — Energy / Conglomerate
  { symbol: 'RELIANCE.NS',   name: 'Reliance Industries', market: 'India', sector: 'Energy' },
  { symbol: 'TATAMOTORS.NS', name: 'Tata Motors',         market: 'India', sector: 'Consumer' },
  // India — IT / Tech
  { symbol: 'TCS.NS',  name: 'Tata Consultancy',  market: 'India', sector: 'Tech' },
  { symbol: 'INFY.NS', name: 'Infosys',            market: 'India', sector: 'Tech' },
  { symbol: 'WIPRO.NS',name: 'Wipro',              market: 'India', sector: 'Tech' },
  // India — Banking / Finance
  { symbol: 'HDFCBANK.NS',  name: 'HDFC Bank',    market: 'India', sector: 'Finance' },
  { symbol: 'ICICIBANK.NS', name: 'ICICI Bank',   market: 'India', sector: 'Finance' },
  { symbol: 'SBIN.NS',      name: 'State Bank of India', market: 'India', sector: 'Finance' },
  // Crypto — Layer 1
  { symbol: 'BTC-USD',  name: 'Bitcoin',     market: 'Crypto', sector: 'Layer 1' },
  { symbol: 'ETH-USD',  name: 'Ethereum',    market: 'Crypto', sector: 'Layer 1' },
  { symbol: 'SOL-USD',  name: 'Solana',      market: 'Crypto', sector: 'Layer 1' },
  { symbol: 'ADA-USD',  name: 'Cardano',     market: 'Crypto', sector: 'Layer 1' },
  // Crypto — Alt / Meme
  { symbol: 'BNB-USD',  name: 'BNB',         market: 'Crypto', sector: 'Exchange' },
  { symbol: 'XRP-USD',  name: 'XRP',         market: 'Crypto', sector: 'Payments' },
  { symbol: 'DOGE-USD', name: 'Dogecoin',    market: 'Crypto', sector: 'Meme' },
  // MCX — Metals & Energy
  { symbol: 'GC=F', name: 'Gold Futures',       market: 'MCX', sector: 'Metals' },
  { symbol: 'SI=F', name: 'Silver Futures',     market: 'MCX', sector: 'Metals' },
  { symbol: 'HG=F', name: 'Copper Futures',     market: 'MCX', sector: 'Metals' },
  { symbol: 'CL=F', name: 'Crude Oil Futures',  market: 'MCX', sector: 'Energy' },
  { symbol: 'NG=F', name: 'Natural Gas Futures',market: 'MCX', sector: 'Energy' },
];

// Derived helpers — keep MARKET_TICKERS working for the rest of the app
export const MARKET_TICKERS: Record<string, string[]> = TICKER_DB.reduce((acc, t) => {
  (acc[t.market] = acc[t.market] ?? []).push(t.symbol);
  return acc;
}, {} as Record<string, string[]>);

export const TICKER_META: Record<string, TickerMeta> = Object.fromEntries(TICKER_DB.map(t => [t.symbol, t]));

// Sectors grouped by market
export const MARKET_SECTORS: Record<string, string[]> = TICKER_DB.reduce((acc, t) => {
  if (!acc[t.market]) acc[t.market] = [];
  if (!acc[t.market].includes(t.sector)) acc[t.market].push(t.sector);
  return acc;
}, {} as Record<string, string[]>);

export const NAV: { id: Page; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard',    icon: '▦' },
  { id: 'markets',   label: 'Markets',      icon: '◈' },
  { id: 'graph',     label: 'Knowledge Graph', icon: '◎' },
  { id: 'portfolio', label: 'Portfolio',    icon: '$' },
  { id: 'memory',    label: 'Agent Memory', icon: '◉' },
  { id: 'pipeline',  label: 'Live Pipeline', icon: '⟳' },
  { id: 'settings',  label: 'Settings',     icon: '⚙' },
];

// Shared note-type color map — works in both light and dark mode
export const NOTE_COLORS: Record<string, string> = {
  LESSON:          'text-amber-600 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/40',
  STRATEGY_RESULT: 'text-purple-600 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800/40',
  OBSERVATION:     'text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/40',
  INSIGHT:         'text-teal-600 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800/40',
};

export const STEP_META: Record<string, { icon: string; label: string; color: string }> = {
  START:        { icon: '▶', label: 'Pipeline Started',   color: 'text-brand-500 dark:text-brand-400'    },
  WEB_RESEARCH: { icon: '⌖', label: 'Shared Retrieval',   color: 'text-purple-600 dark:text-purple-400'  },
  KG_INGEST:    { icon: '⬡', label: 'Knowledge Graph',    color: 'text-cyan-600 dark:text-cyan-400'      },
  DEBATE_PANEL: { icon: '◈', label: 'Debate Panel',       color: 'text-teal-600 dark:text-teal-400'      },
  AGENT_QUERY:  { icon: '◉', label: 'Agent Query',        color: 'text-teal-600 dark:text-teal-300'      },
  JUDGE:        { icon: '⚖', label: 'Judge',              color: 'text-amber-600 dark:text-amber-400'    },
  DEPLOY:       { icon: '◆', label: 'Deploy Strategy',    color: 'text-brand-500 dark:text-brand-400'    },
  MEMORY_WRITE: { icon: '◈', label: 'Write Memories',     color: 'text-indigo-600 dark:text-indigo-400'  },
  ERROR:        { icon: '✕', label: 'Error',              color: 'text-down'                             },
};

export const KG_COLORS: Record<string, string> = {
  ASSET:     '#3b82f6',
  ENTITY:    '#8b5cf6',
  EVENT:     '#f59e0b',
  INDICATOR: '#10b981',
};
