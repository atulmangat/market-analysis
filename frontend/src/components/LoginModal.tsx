import { useState, useEffect } from 'react';
import { API } from '../constants';
import { setToken } from '../utils';

export function LoginModal({ onLogin, onClose }: { onLogin: () => void; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        const { token } = await res.json();
        setToken(token);
        onLogin();
      } else if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail ?? 'Too many attempts. Please wait before trying again.');
      } else {
        setError('Incorrect password. Try again.');
        setPassword('');
      }
    } catch {
      setError('Could not reach the server. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(4,8,14,0.8)', backdropFilter: 'blur(24px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl animate-scale-in"
        style={{
          background: '#0d1117',
          border: '1px solid #1a2535',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.04)',
          padding: '32px',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-7">
          <div className="flex items-center gap-3">
            <div style={{ height: 32, width: 32, borderRadius: 10, background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 16px rgba(37,99,235,0.45)', flexShrink: 0 }}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2 12L5 8L8 10L11 5L14 7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="14" cy="7" r="1.5" fill="white"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f4', letterSpacing: '-0.3px' }}>
                market-analysis<span style={{ color: '#60a5fa' }}>.space</span>
              </div>
              <p style={{ fontSize: 11, marginTop: 2, color: '#6b7fa0' }}>Enter your access password</p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.04)', border: '1px solid #1a2535', cursor: 'pointer', color: '#6b7fa0', transition: 'all 150ms ease' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'; (e.currentTarget as HTMLElement).style.color = '#e2e8f4'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLElement).style.color = '#6b7fa0'; }}
            aria-label="Close"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M1 1l10 10M11 1L1 11"/>
            </svg>
          </button>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <input
            autoFocus
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            style={{ width: '100%', padding: '12px 16px', borderRadius: 12, fontSize: 14, background: '#070b10', border: '1px solid #1a2535', color: '#e2e8f4', outline: 'none', transition: 'border-color 150ms ease', boxSizing: 'border-box' }}
            onFocus={e => (e.currentTarget.style.borderColor = 'rgba(59,130,246,0.6)')}
            onBlur={e => (e.currentTarget.style.borderColor = '#1a2535')}
          />
          {error && (
            <p style={{ fontSize: 12, color: '#f87171', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 12px', margin: 0 }}>{error}</p>
          )}
          <button
            type="submit"
            disabled={loading || !password}
            style={{
              width: '100%',
              padding: '13px 0',
              borderRadius: 12,
              fontWeight: 700,
              fontSize: 14,
              border: 'none',
              cursor: loading || !password ? 'not-allowed' : 'pointer',
              transition: 'all 180ms cubic-bezier(0.16,1,0.3,1)',
              background: loading || !password ? '#1a2535' : 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)',
              color: loading || !password ? '#6b7fa0' : '#fff',
              boxShadow: loading || !password ? 'none' : '0 0 24px rgba(37,99,235,0.35)',
            }}
            onMouseEnter={e => { if (!loading && password) { (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(37,99,235,0.45)'; } }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = loading || !password ? 'none' : '0 0 24px rgba(37,99,235,0.35)'; }}
          >
            {loading ? 'Signing in…' : 'Open Dashboard →'}
          </button>
        </form>
      </div>
    </div>
  );
}
