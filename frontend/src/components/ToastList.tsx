import type { Toast } from '../types';

const TOAST_STYLES: Record<string, React.CSSProperties> = {
  err:  { background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.28)', color: '#f87171' },
  info: { background: 'rgba(13,17,23,0.9)', border: '1px solid rgba(36,48,68,0.9)', color: '#e2e8f4' },
  ok:   { background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.28)', color: '#34d399' },
};

import React from 'react';

export function ToastList({ toasts }: { toasts: Toast[] }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex flex-col items-center gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className="px-4 py-2.5 rounded-xl text-[12px] font-semibold animate-fade-up"
          style={{
            ...(TOAST_STYLES[t.type ?? 'ok'] ?? TOAST_STYLES.ok),
            backdropFilter: 'blur(16px)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)',
            letterSpacing: '0.01em',
          }}
        >
          {t.msg}
        </div>
      ))}
    </div>
  );
}
