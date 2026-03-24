import { useState } from 'react';
import { LoginModal } from '../components/LoginModal';

const LANDING_TICKERS = [
  { sym: 'NVDA',        price: '$116.40',  chg: '+2.84%', up: true  },
  { sym: 'AAPL',        price: '$213.50',  chg: '−0.62%', up: false },
  { sym: 'BTC-USD',     price: '$84,200',  chg: '+1.45%', up: true  },
  { sym: 'MSFT',        price: '$388.70',  chg: '+0.91%', up: true  },
  { sym: 'ETH-USD',     price: '$2,040',   chg: '−2.10%', up: false },
  { sym: 'RELIANCE.NS', price: '₹1,234',   chg: '+0.54%', up: true  },
  { sym: 'GC=F',        price: '$3,020',   chg: '+0.48%', up: true  },
  { sym: 'META',        price: '$608.90',  chg: '+1.73%', up: true  },
  { sym: 'TCS.NS',      price: '₹3,620',   chg: '−0.38%', up: false },
  { sym: 'SOL-USD',     price: '$136.50',  chg: '+3.20%', up: true  },
  { sym: 'TSLA',        price: '$243.80',  chg: '−1.55%', up: false },
  { sym: 'CL=F',        price: '$68.20',   chg: '+0.74%', up: true  },
  { sym: 'BNB-USD',     price: '$585.00',  chg: '+0.92%', up: true  },
  { sym: 'XRP-USD',     price: '$2.38',    chg: '−1.20%', up: false },
  { sym: 'INFY.NS',     price: '₹1,570',   chg: '+0.30%', up: true  },
  { sym: 'GOOGL',       price: '$165.20',  chg: '+1.10%', up: true  },
  { sym: 'AMZN',        price: '$196.40',  chg: '+0.85%', up: true  },
  { sym: 'DOGE-USD',    price: '$0.172',   chg: '−2.40%', up: false },
];

function TickerTape() {
  return (
    <div
      style={{
        width: '100%',
        overflow: 'hidden',
        borderTop: '1px solid rgba(30,44,62,0.8)',
        borderBottom: '1px solid rgba(30,44,62,0.8)',
        background: 'rgba(10,14,20,0.85)',
        backdropFilter: 'blur(12px)',
        position: 'relative',
        zIndex: 2,
      }}
    >
      {/* Fade edges */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 80, background: 'linear-gradient(90deg, rgba(10,14,20,1) 0%, transparent 100%)', zIndex: 1, pointerEvents: 'none' }} aria-hidden="true" />
      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 80, background: 'linear-gradient(270deg, rgba(10,14,20,1) 0%, transparent 100%)', zIndex: 1, pointerEvents: 'none' }} aria-hidden="true" />
      <div
        style={{ display: 'flex', paddingTop: 10, paddingBottom: 10, whiteSpace: 'nowrap', animation: 'ticker 42s linear infinite' }}
        onMouseEnter={e => (e.currentTarget.style.animationPlayState = 'paused')}
        onMouseLeave={e => (e.currentTarget.style.animationPlayState = 'running')}
        aria-hidden="true"
      >
        {[...LANDING_TICKERS, ...LANDING_TICKERS].map((t, i) => (
          <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 20px', borderRight: '1px solid rgba(30,44,62,0.6)', flexShrink: 0 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: '#e2e8f4', letterSpacing: '0.02em' }}>{t.sym}</span>
            <span style={{ fontSize: 11.5, fontFamily: 'JetBrains Mono, monospace', color: '#6b7fa0' }}>{t.price}</span>
            <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', display: 'flex', alignItems: 'center', gap: 3, color: t.up ? '#34d399' : '#f87171' }}>
              {t.up
                ? <svg width="7" height="7" viewBox="0 0 6 6" fill="currentColor"><path d="M3 0L6 6H0L3 0Z"/></svg>
                : <svg width="7" height="7" viewBox="0 0 6 6" fill="currentColor"><path d="M3 6L0 0H6L3 6Z"/></svg>
              }
              {t.chg}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const STEPS = [
  { n: '01', title: 'Research',        desc: 'Web news + RSS fetched for all enabled tickers, cached 30 min.', color: '#60a5fa' },
  { n: '02', title: 'Knowledge Graph', desc: 'LLM extracts EVENT nodes and edges into a live knowledge graph.',  color: '#a78bfa' },
  { n: '03', title: 'Debate',          desc: '4 AI agents query in parallel — Value, Technical, Macro, Sentiment.',color: '#34d399' },
  { n: '04', title: 'Consensus',       desc: 'Judge LLM reviews all proposals and picks the single best trade.',  color: '#fbbf24' },
  { n: '05', title: 'Deploy & Learn',  desc: 'Strategy deploys. −10% SL / +15% TP. Weak agents evolve via LLM.', color: '#f87171' },
];

const FEATURES = [
  { icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
    ), title: 'Live Pipeline', desc: 'Watch every step unfold — research, KG ingest, debate, consensus, deploy.', accent: '#2563eb' },
  { icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
    ), title: 'Portfolio P&L', desc: 'Track unrealized returns with automatic −10% stop-loss and +15% take-profit.', accent: '#10b981' },
  { icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    ), title: 'Agent Memory', desc: 'Each agent accumulates persistent observations and lessons across rounds.', accent: '#8b5cf6' },
  { icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
    ), title: 'Knowledge Graph', desc: 'LLM-extracted EVENT nodes link assets, entities, and indicators in real time.', accent: '#06b6d4' },
  { icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
    ), title: 'Markets & Watchlist', desc: 'Monitor 29 tickers across US, India NSE, Crypto, and MCX commodities.', accent: '#14b8a6' },
  { icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
    ), title: 'Darwinian Evolution', desc: 'Underperforming agents are rewritten — mutated or inheriting from elite peers.', accent: '#f59e0b' },
  { icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="12" y1="9" x2="12" y2="15"/></svg>
    ), title: 'Judge Consensus', desc: 'A Judge LLM weighs all 4 proposals against budget context and picks one.', accent: '#a78bfa' },
  { icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M6.34 17.66l-1.41 1.41M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>
    ), title: 'Full Control', desc: 'Configure markets, schedule, approval mode, agent prompts, and budget.', accent: '#f43f5e' },
  { icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 20h.01M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/><path d="M22 4v16"/></svg>
    ), title: 'LLM Cost Tracking', desc: 'Per-model token usage and cost breakdown for every pipeline step.', accent: '#ec4899' },
];

export function LandingPage({ onLogin }: { onLogin: () => void }) {
  const [showLogin, setShowLogin] = useState(false);

  return (
    <div
      className="min-h-dvh antialiased overflow-x-hidden"
      style={{ background: '#070b10', color: '#e2e8f4', fontFamily: '"Inter", system-ui, sans-serif' }}
    >
      <style>{`
        @keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes fade-up { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.8); } }
        @keyframes grid-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes blob-drift { 0%, 100% { transform: translate(0,0) scale(1); } 33% { transform: translate(20px,-15px) scale(1.03); } 66% { transform: translate(-10px,10px) scale(0.97); } }
        .afu { animation: fade-up 0.5s cubic-bezier(0.16,1,0.3,1) both; }
        .d1 { animation-delay: 0.1s; } .d2 { animation-delay: 0.2s; }
        .d3 { animation-delay: 0.3s; } .d4 { animation-delay: 0.4s; } .d5 { animation-delay: 0.5s; }
        .step-card { background: #0d1117; border: 1px solid #1a2535; transition: all 220ms cubic-bezier(0.16,1,0.3,1); }
        .step-card:hover { border-color: #243044; background: #111827; transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
        .feat-card { background: #0d1117; border: 1px solid #1a2535; border-radius: 16px; transition: all 220ms cubic-bezier(0.16,1,0.3,1); }
        .feat-card:hover { border-color: #243044; background: #111827; transform: translateY(-2px); box-shadow: 0 8px 32px rgba(0,0,0,0.35); }
        .cta-btn { transition: all 200ms cubic-bezier(0.16,1,0.3,1); }
        .cta-btn:hover { transform: translateY(-2px); }
        .cta-btn:active { transform: translateY(0) scale(0.98); }
        .sec-btn { transition: all 200ms ease; }
        .sec-btn:hover { color: #e2e8f4 !important; border-color: #334155 !important; transform: translateY(-2px); }
        @media (prefers-reduced-motion: reduce) {
          .afu, [style*="animation"] { animation: none !important; }
          .step-card:hover, .feat-card:hover, .cta-btn:hover { transform: none !important; }
        }
      `}</style>

      {/* ── Grid mesh bg ── */}
      <div aria-hidden="true" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
        {/* Ambient blobs */}
        <div style={{ position: 'absolute', top: '-15%', left: '25%', width: 700, height: 700, borderRadius: '50%', background: 'radial-gradient(circle, rgba(37,99,235,0.1) 0%, transparent 65%)', filter: 'blur(60px)', animation: 'blob-drift 18s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', bottom: '5%', right: '5%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 65%)', filter: 'blur(60px)', animation: 'blob-drift 24s ease-in-out infinite reverse' }} />
        <div style={{ position: 'absolute', top: '40%', left: '-10%', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(20,184,166,0.05) 0%, transparent 65%)', filter: 'blur(50px)' }} />
        {/* Grid lines */}
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.35,
          backgroundImage: 'linear-gradient(rgba(30,44,62,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(30,44,62,0.7) 1px, transparent 1px)',
          backgroundSize: '52px 52px',
        }} />
      </div>

      {/* ── Nav ── */}
      <nav
        style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px', height: 62, background: 'rgba(7,11,16,0.88)', backdropFilter: 'blur(20px) saturate(1.5)', borderBottom: '1px solid rgba(30,44,62,0.8)' }}
        aria-label="Site navigation"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ height: 30, width: 30, borderRadius: 10, background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 18px rgba(37,99,235,0.5)' }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 12L5 8L8 10L11 5L14 7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="14" cy="7" r="1.5" fill="white"/>
            </svg>
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f4', letterSpacing: '-0.3px' }}>
            market-analysis<span style={{ color: '#60a5fa' }}>.space</span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setShowLogin(true)}
            className="cta-btn"
            style={{ padding: '8px 20px', borderRadius: 10, background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)', color: '#fff', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', boxShadow: '0 0 20px rgba(37,99,235,0.4)' }}
          >
            Open Dashboard →
          </button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={{ position: 'relative', zIndex: 1, minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '130px 24px 80px' }}>

        {/* Live badge */}
        <div className="afu" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 18px', borderRadius: 999, background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.28)', marginBottom: 32, backdropFilter: 'blur(8px)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#60a5fa', display: 'inline-block', animation: 'pulse-dot 2.2s ease infinite' }} aria-hidden="true" />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#60a5fa' }}>Live · AI Agents Debating Markets Now</span>
        </div>

        {/* Headline */}
        <h1 className="afu d1" style={{ fontSize: 'clamp(38px,5.5vw,78px)', fontWeight: 900, letterSpacing: '-3px', lineHeight: 1.04, maxWidth: 960, marginBottom: 24 }}>
          Multiple AI Agents.<br/>
          One{' '}
          <span style={{ background: 'linear-gradient(135deg, #60a5fa 0%, #818cf8 45%, #a78bfa 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            Market Consensus.
          </span>
        </h1>

        <p className="afu d2" style={{ fontSize: 'clamp(16px,2vw,20px)', color: '#6b7fa0', lineHeight: 1.7, maxWidth: 520, marginBottom: 48 }}>
          A multi-agent system where AI analysts debate every trade — then vote on a LONG or SHORT strategy. Continuously evolving through Darwinian selection.
        </p>

        {/* CTAs */}
        <div className="afu d3" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 80 }}>
          <button
            onClick={() => setShowLogin(true)}
            className="cta-btn"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '15px 36px', borderRadius: 14, background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)', color: '#fff', fontWeight: 700, fontSize: 15, border: 'none', cursor: 'pointer', boxShadow: '0 0 32px rgba(37,99,235,0.4), 0 4px 16px rgba(0,0,0,0.3)' }}
          >
            Open Dashboard
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <a
            href="#how-it-works"
            className="sec-btn"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '14px 28px', borderRadius: 14, border: '1px solid #1a2535', color: '#6b7fa0', fontWeight: 500, fontSize: 15, textDecoration: 'none', backdropFilter: 'blur(8px)', background: 'rgba(13,17,23,0.5)' }}
          >
            See how it works
          </a>
        </div>

        {/* Stats */}
        <div className="afu d4" style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap', justifyContent: 'center', background: 'rgba(13,17,23,0.6)', border: '1px solid #1a2535', borderRadius: 16, padding: '20px 36px', backdropFilter: 'blur(12px)' }}>
          {[
            { n: '4',  l: 'AI Agents',       c: '#60a5fa' },
            { n: '29', l: 'Tracked Tickers',  c: '#e2e8f4' },
            { n: '4',  l: 'Markets',          c: '#e2e8f4' },
            { n: '∞',  l: 'Evolution Cycles', c: '#a78bfa' },
          ].map(({ n, l, c }, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
              {i > 0 && <div style={{ width: 1, height: 38, background: '#1a2535', margin: '0 32px' }} aria-hidden="true" />}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 34, fontWeight: 900, color: c, letterSpacing: '-1.5px', fontVariantNumeric: 'tabular-nums' }}>{n}</div>
                <div style={{ fontSize: 10, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 700, marginTop: 4 }}>{l}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Ticker tape ── */}
      <TickerTape />

      {/* ── How it works ── */}
      <section id="how-it-works" style={{ borderTop: '1px solid #1a2535', padding: '100px 24px', maxWidth: 1240, margin: '0 auto' }}>
        <div className="afu" style={{ marginBottom: 56 }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#60a5fa', marginBottom: 16 }}>How it works</p>
          <h2 style={{ fontSize: 'clamp(26px,4vw,44px)', fontWeight: 900, letterSpacing: '-1.5px', lineHeight: 1.12 }}>From market data to deployed strategy</h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 2, background: '#1a2535', borderRadius: 18, overflow: 'hidden' }}>
          {STEPS.map((s, i) => (
            <div
              key={s.n}
              className={`step-card afu d${i + 1}`}
              style={{ padding: '30px 24px' }}
            >
              <div style={{ fontSize: 10, fontWeight: 800, fontFamily: 'monospace', color: s.color, textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 16 }}>{s.n}</div>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: `${s.color}15`, border: `1px solid ${s.color}28`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <div style={{ width: 11, height: 11, borderRadius: '50%', background: s.color, boxShadow: `0 0 10px ${s.color}60` }} aria-hidden="true" />
              </div>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f4', marginBottom: 10, letterSpacing: '-0.3px' }}>{s.title}</h3>
              <p style={{ fontSize: 12, color: '#6b7fa0', lineHeight: 1.7 }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <div id="features" style={{ borderTop: '1px solid #1a2535' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '100px 24px' }}>
          <div style={{ marginBottom: 56 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#60a5fa', marginBottom: 16 }}>Features</p>
            <h2 style={{ fontSize: 'clamp(26px,4vw,44px)', fontWeight: 900, letterSpacing: '-1.5px', lineHeight: 1.12 }}>Everything in one dashboard</h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(286px, 1fr))', gap: 14 }}>
            {FEATURES.map(f => (
              <div
                key={f.title}
                className="feat-card"
                style={{ padding: '26px 24px', cursor: 'default' }}
              >
                <div style={{ width: 40, height: 40, borderRadius: 12, background: `${f.accent}14`, border: `1px solid ${f.accent}28`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20, color: f.accent, boxShadow: `0 0 16px ${f.accent}15` }}>
                  {f.icon}
                </div>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f4', marginBottom: 10, letterSpacing: '-0.3px' }}>{f.title}</h3>
                <p style={{ fontSize: 12.5, color: '#6b7fa0', lineHeight: 1.7 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── CTA ── */}
      <div style={{ borderTop: '1px solid #1a2535', position: 'relative', overflow: 'hidden' }}>
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 0%, rgba(37,99,235,0.1) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '100px 24px', textAlign: 'center', position: 'relative' }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#60a5fa', marginBottom: 22 }}>Get started</p>
          <h2 style={{ fontSize: 'clamp(32px,5vw,58px)', fontWeight: 900, letterSpacing: '-2px', lineHeight: 1.08, marginBottom: 20 }}>
            Ready to let AI<br/>
            <span style={{ background: 'linear-gradient(135deg, #60a5fa 0%, #818cf8 50%, #a78bfa 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              debate your trades?
            </span>
          </h2>
          <p style={{ fontSize: 18, color: '#6b7fa0', lineHeight: 1.65, maxWidth: 440, margin: '0 auto 52px' }}>
            Self-hosted, fully configurable, and always evolving.
          </p>
          <button
            onClick={() => setShowLogin(true)}
            className="cta-btn"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 12, padding: '18px 44px', borderRadius: 16, background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)', color: '#fff', fontWeight: 700, fontSize: 16, border: 'none', cursor: 'pointer', boxShadow: '0 0 40px rgba(37,99,235,0.45), 0 8px 32px rgba(0,0,0,0.35)' }}
          >
            Open Dashboard
            <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer style={{ borderTop: '1px solid #1a2535', padding: '28px 36px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ height: 24, width: 24, borderRadius: 7, background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 12L5 8L8 10L11 5L14 7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="14" cy="7" r="1.5" fill="white"/>
            </svg>
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f4' }}>
            market-analysis<span style={{ color: '#60a5fa' }}>.space</span>
          </span>
        </div>
        <span style={{ fontSize: 11, color: '#334155' }}>© {new Date().getFullYear()} market-analysis.space · AI-powered market analysis</span>
      </footer>

      {showLogin && <LoginModal onLogin={onLogin} onClose={() => setShowLogin(false)} />}
    </div>
  );
}
