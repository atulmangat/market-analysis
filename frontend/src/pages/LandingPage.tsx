import { useState } from 'react';
import { LoginModal } from '../components/LoginModal';

// Ticker data for the tape — static, defined at module level
const LANDING_TICKERS = [
  { sym: 'NVDA',        price: '$875.40',  chg: '+3.21%', up: true  },
  { sym: 'AAPL',        price: '$192.35',  chg: '−0.84%', up: false },
  { sym: 'BTC-USD',     price: '$67,420',  chg: '+2.15%', up: true  },
  { sym: 'MSFT',        price: '$415.20',  chg: '+1.02%', up: true  },
  { sym: 'ETH-USD',     price: '$3,512',   chg: '−1.40%', up: false },
  { sym: 'RELIANCE.NS', price: '₹2,890',   chg: '+0.76%', up: true  },
  { sym: 'GC=F',        price: '$2,145',   chg: '+0.32%', up: true  },
  { sym: 'META',        price: '$512.80',  chg: '+2.67%', up: true  },
  { sym: 'TCS.NS',      price: '₹3,945',   chg: '−0.55%', up: false },
  { sym: 'SOL-USD',     price: '$168.90',  chg: '+4.12%', up: true  },
  { sym: 'TSLA',        price: '$248.60',  chg: '−2.10%', up: false },
  { sym: 'CL=F',        price: '$82.40',   chg: '+0.91%', up: true  },
];

function TickerTape() {
  return (
    <div className="w-full overflow-hidden border-y border-borderLight bg-surface">
      <div className="flex animate-[ticker_30s_linear_infinite] hover:[animation-play-state:paused] py-3 whitespace-nowrap">
        {[...LANDING_TICKERS, ...LANDING_TICKERS].map((t, i) => (
          <div key={i} className="inline-flex items-center gap-2.5 px-6 border-r border-borderLight shrink-0">
            <span className="text-[13px] font-bold font-mono text-textMain">{t.sym}</span>
            <span className="text-[13px] font-mono text-textMuted">{t.price}</span>
            <span className={`text-[11px] font-bold font-mono ${t.up ? 'text-up' : 'text-down'}`}>
              {t.up ? '▲' : '▼'} {t.chg}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LandingPage({ onLogin }: { onLogin: () => void }) {
  const [showLogin, setShowLogin] = useState(false);

  const features = [
    { icon: '⟳', title: 'Live Pipeline',       desc: 'Watch every debate step unfold in real-time — research, agent queries, consensus verdict, and deployment.',   accent: '#3b82f6' },
    { icon: '$',  title: 'Portfolio P&L',       desc: 'Track unrealized and realized returns across all active positions with automatic stop-loss and take-profit.',   accent: '#10b981' },
    { icon: '◉', title: 'Agent Memory',         desc: 'Each agent accumulates persistent observations and lessons across rounds, shaping future decisions over time.', accent: '#8b5cf6' },
    { icon: '🧬', title: 'Darwinian Evolution', desc: 'Underperforming agents are automatically rewritten — their strategy either mutates or inherits from elite peers.', accent: '#f59e0b' },
    { icon: '◈', title: 'Markets & Watchlist',  desc: 'Monitor US, India, Crypto, and Commodities. Add any ticker via search. Active positions surface at the top.',   accent: '#14b8a6' },
    { icon: '⚙', title: 'Full Control',         desc: 'Configure markets, schedule, approval mode, agent prompts, and trading budget entirely from the dashboard.',    accent: '#f43f5e' },
  ];

  return (
    <div className="landing-root bg-[#0d1117] text-textMain font-sans antialiased overflow-x-hidden">
      <style>{`
        @keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .5; transform: scale(.8); } }
        @keyframes fade-up { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .landing-section { max-width: 1200px; margin: 0 auto; padding: 96px 24px; }
        .animate-fade-up { animation: fade-up .6s ease both; }
        .delay-100 { animation-delay: .1s; }
        .delay-200 { animation-delay: .2s; }
        .delay-300 { animation-delay: .3s; }
        .delay-400 { animation-delay: .4s; }
        .delay-500 { animation-delay: .5s; }
        /* Force dark-mode color tokens inside landing page regardless of OS theme */
        .landing-root { --color-textMain: #f1f5f9; --color-textMuted: #94a3b8; --color-textDim: #64748b; --color-borderLight: #1e293b; --color-borderMid: #374151; --color-surface2: #161b22; --color-surface3: #1e2630; }
      `}</style>

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-8 h-16 bg-[#0d1117]/90 backdrop-blur-md border-b border-borderLight">
        <div className="text-xl font-extrabold tracking-tight">market-analysis<span className="text-brand-400">.space</span></div>
        <div className="hidden md:flex items-center gap-8 text-sm text-textMuted">
          {['How it works', 'Features', 'Agents', 'Markets'].map(l => (
            <a key={l} href={`#${l.toLowerCase().replace(/ /g,'-')}`} className="hover:text-textMain transition-colors">{l}</a>
          ))}
        </div>
        <button
          onClick={() => setShowLogin(true)}
          className="px-5 py-2 rounded-lg bg-brand-500 hover:bg-brand-400 text-white text-sm font-semibold transition-all hover:-translate-y-px">
          Open Dashboard →
        </button>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center text-center px-6 pt-28 pb-20 overflow-hidden">
        {/* radial glow */}
        <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[900px] h-[600px] pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at center, rgba(59,130,246,.18) 0%, transparent 70%)' }} />
        <div className="absolute bottom-0 left-0 right-0 h-40 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, transparent, #0d1117)' }} />

        <div className="animate-fade-up inline-flex items-center gap-2 text-[11px] font-semibold tracking-widest uppercase text-brand-400 bg-brand-900/40 border border-brand-700/40 rounded-full px-4 py-1.5 mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-400 inline-block" style={{ animation: 'pulse-dot 2s infinite' }}></span>
          Live · Multiple AI Agents Debating Now
        </div>

        <h1 className="animate-fade-up delay-100 text-[clamp(40px,6vw,80px)] font-extrabold tracking-[-2px] leading-[1.07] max-w-4xl mb-6">
          Multiple AI Agents.<br/>
          One{' '}
          <span style={{ background: 'linear-gradient(135deg,#60a5fa,#818cf8,#a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            Market Consensus.
          </span>
        </h1>

        <p className="animate-fade-up delay-200 text-[clamp(16px,2vw,20px)] text-textMuted leading-relaxed max-w-xl mb-12">
          A multi-agent system where AI analysts debate every trade — then vote on a LONG or SHORT strategy. Continuously evolving through Darwinian selection.
        </p>

        <div className="animate-fade-up delay-300 flex items-center gap-4 flex-wrap justify-center mb-20">
          <button
            onClick={() => setShowLogin(true)}
            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-brand-500 hover:bg-brand-400 text-white font-semibold text-[15px] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(59,130,246,.35)]">
            Open Dashboard
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <a href="#how-it-works" className="inline-flex items-center gap-2 px-7 py-4 rounded-xl border border-borderMid text-textMuted hover:text-textMain hover:border-textDim font-medium text-[15px] transition-all hover:-translate-y-0.5">
            See how it works
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M4 9l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </a>
        </div>

        {/* Stats */}
        <div className="animate-fade-up delay-400 flex items-center gap-10 flex-wrap justify-center">
          {[['AI', 'Agents'], ['28+', 'Tracked Tickers'], ['4', 'Markets'], ['∞', 'Evolution Cycles']].map(([n, l], i) => (
            <div key={i} className="flex items-center gap-10">
              {i > 0 && <div className="w-px h-9 bg-borderLight hidden sm:block" />}
              <div className="text-center">
                <div className={`text-3xl font-extrabold tracking-tight ${i === 0 || i === 3 ? 'text-brand-400' : 'text-textMain'}`}>{n}</div>
                <div className="text-[11px] text-textDim uppercase tracking-widest mt-0.5">{l}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Ticker tape ──────────────────────────────────────────────────── */}
      <TickerTape />

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <div id="how-it-works" className="border-t border-borderLight">
        <div className="landing-section">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-brand-400 mb-4">How it works</p>
          <h2 className="text-[clamp(26px,4vw,44px)] font-extrabold tracking-tight leading-tight mb-14">From market data to deployed strategy</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-borderLight rounded-2xl overflow-hidden">
            {[
              { n: '01', icon: '⌖', title: 'Research',   desc: 'Live market news and price data shared across all agents each cycle.' },
              { n: '02', icon: '◉', title: 'Debate',     desc: 'Multiple AI agents run in parallel — each proposes a ticker and LONG/SHORT.' },
              { n: '03', icon: '⚖', title: 'Consensus',  desc: 'A Judge LLM picks the majority vote and records the reasoning.' },
              { n: '04', icon: '◈', title: 'Learn',      desc: 'Strategies close at SL/TP. Weak agents evolve via Darwinian selection.' },
            ].map(s => (
              <div key={s.n} className="bg-[#0d1117] p-8">
                <div className="text-[10px] font-bold font-mono text-brand-400 uppercase tracking-widest mb-3">{s.n}</div>
                <div className="text-2xl mb-3">{s.icon}</div>
                <h3 className="text-[15px] font-bold mb-2">{s.title}</h3>
                <p className="text-[12px] text-textMuted leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <div id="features" className="border-t border-borderLight">
        <div className="landing-section">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-brand-400 mb-4">Features</p>
          <h2 className="text-[clamp(26px,4vw,44px)] font-extrabold tracking-tight leading-tight mb-12">Everything in one dashboard</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map(f => (
              <div key={f.title} className="rounded-2xl border border-[#1e293b] bg-[#161b22] p-7 hover:border-[#374151] hover:-translate-y-0.5 transition-all">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg mb-5"
                  style={{ background: `${f.accent}22`, border: `1px solid ${f.accent}44` }}>
                  {f.icon}
                </div>
                <h3 className="text-[15px] font-bold mb-2 text-[#f1f5f9]">{f.title}</h3>
                <p className="text-[13px] leading-relaxed text-[#94a3b8]">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <div className="border-t border-borderLight relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(59,130,246,.1) 0%, transparent 70%)' }} />
        <div className="landing-section text-center relative">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-brand-400 mb-5">Get started</p>
          <h2 className="text-[clamp(32px,5vw,56px)] font-extrabold tracking-tight leading-tight mb-5">
            Ready to let AI<br/>
            <span style={{ background: 'linear-gradient(135deg,#60a5fa,#a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              debate your trades?
            </span>
          </h2>
          <p className="text-[18px] text-textMuted leading-relaxed max-w-md mx-auto mb-12">
            Self-hosted, fully configurable, and always evolving. Deploy your own instance in minutes.
          </p>
          <button
            onClick={() => setShowLogin(true)}
            className="inline-flex items-center gap-2 px-10 py-5 rounded-xl bg-brand-500 hover:bg-brand-400 text-white font-semibold text-[16px] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(59,130,246,.4)]">
            Open Dashboard
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-borderLight px-8 py-10 flex items-center justify-between flex-wrap gap-5">
        <div className="text-[16px] font-extrabold">market-analysis<span className="text-brand-400">.space</span></div>
        <ul className="flex gap-7 list-none">
          {['How it works','Features','Agents','Markets'].map(l => (
            <li key={l}><a href={`#${l.toLowerCase().replace(/ /g,'-')}`} className="text-[13px] text-textDim hover:text-textMuted transition-colors">{l}</a></li>
          ))}
        </ul>
        <div className="text-[12px] text-textDim">© {new Date().getFullYear()} market-analysis.space · AI-powered market analysis</div>
      </footer>

      {/* ── Login modal ──────────────────────────────────────────────────── */}
      {showLogin && <LoginModal onLogin={onLogin} onClose={() => setShowLogin(false)} />}
    </div>
  );
}
