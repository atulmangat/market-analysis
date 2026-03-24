import type { CSSProperties } from 'react';

export function StatusChip({ status }: { status: string }) {
  const map: Record<string, { style: CSSProperties; dot: string }> = {
    ACTIVE:   {
      style: { background: 'rgba(16,185,129,0.1)', color: '#34d399', border: '1px solid rgba(16,185,129,0.22)', boxShadow: '0 0 8px rgba(16,185,129,0.08)' },
      dot: 'bg-up pulse-live',
    },
    PENDING:  {
      style: { background: 'rgba(245,158,11,0.1)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.22)' },
      dot: 'bg-warning pulse-live',
    },
    REJECTED: {
      style: { background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.22)' },
      dot: 'bg-down',
    },
    CLOSED:   {
      style: { background: 'var(--color-surface3)', color: 'var(--color-textDim)', border: '1px solid var(--color-borderLight)' },
      dot: 'bg-textDim',
    },
  };
  const entry = map[status] ?? { style: { background: 'var(--color-surface3)', color: 'var(--color-textMuted)', border: '1px solid var(--color-borderLight)' }, dot: 'bg-textDim' };
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[10px] font-semibold uppercase tracking-wider"
      style={entry.style}
    >
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${entry.dot}`} aria-hidden="true" />
      {status}
    </span>
  );
}
