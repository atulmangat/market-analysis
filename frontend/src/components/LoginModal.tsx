import { useState } from 'react';
import { API } from '../constants';
import { setToken } from '../utils';

export function LoginModal({ onLogin, onClose }: { onLogin: () => void; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm mx-4 rounded-2xl p-8 shadow-2xl space-y-6"
        style={{ background: '#161b22', border: '1px solid #374151' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xl font-bold tracking-tight" style={{ color: '#f1f5f9' }}>
              market-analysis<span style={{ color: '#60a5fa' }}>.space</span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: '#94a3b8' }}>Enter your access password</p>
          </div>
          <button onClick={onClose} className="text-xl leading-none transition-colors" style={{ color: '#64748b' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#f1f5f9')}
            onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}>×</button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <input
            autoFocus
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full px-4 py-3 rounded-xl text-sm transition-colors focus:outline-none"
            style={{ background: '#0d1117', border: '1px solid #1e293b', color: '#f1f5f9' }}
            onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
            onBlur={e => (e.currentTarget.style.borderColor = '#1e293b')}
          />
          {error && (
            <p className="text-xs rounded-lg px-3 py-2" style={{ color: '#f87171', background: 'rgba(153,27,27,0.2)', border: '1px solid rgba(153,27,27,0.4)' }}>{error}</p>
          )}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
            style={{ background: '#3b82f6', color: '#fff' }}
            onMouseEnter={e => { if (!loading && password) e.currentTarget.style.background = '#60a5fa'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#3b82f6'; }}>
            {loading ? 'Signing in…' : 'Open Dashboard →'}
          </button>
        </form>
      </div>
    </div>
  );
}
