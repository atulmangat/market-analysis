import { API, MARKET_TICKERS } from './constants';
import type { AssetClass, Proposal } from './types';

// ── Auth helpers ────────────────────────────────────────────────────────────
export function getToken(): string | null { return localStorage.getItem('auth_token'); }
export function setToken(t: string) { localStorage.setItem('auth_token', t); }
export function clearToken() { localStorage.removeItem('auth_token'); }
export function authHeaders(): HeadersInit {
  const t = getToken();
  return t ? { 'Authorization': `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}
export async function apiFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { ...authHeaders(), ...(opts.headers ?? {}) },
  });
  if (res.status === 401) { clearToken(); window.location.reload(); }
  return res;
}

export function getMarketForTicker(ticker: string): string {
  for (const [market, tickers] of Object.entries(MARKET_TICKERS)) {
    if (tickers.includes(ticker)) return market;
  }
  return 'US';
}

export function parseProposals(jsonStr: string): Proposal[] {
  try { return JSON.parse(jsonStr); } catch { return []; }
}

// ── Theme ──────────────────────────────────────────────────────────────────
export function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
}

// ── Formatting helpers ─────────────────────────────────────────────────────
export function fmtMarketCap(n: number | null | undefined): string {
  if (!n) return 'N/A';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
}
export function fmtVol(n: number | null | undefined): string {
  if (!n) return 'N/A';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  return n.toLocaleString();
}

// ── Detect asset class from symbol / quote_type ────────────────────────────
export function detectAssetClass(symbol: string, quoteType: string | null | undefined): AssetClass {
  if (quoteType === 'CRYPTOCURRENCY' || symbol.endsWith('-USD')) return 'crypto';
  if (quoteType === 'FUTURE' || symbol.endsWith('=F')) return 'commodity';
  return 'stock';
}
