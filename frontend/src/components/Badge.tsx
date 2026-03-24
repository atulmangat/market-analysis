export function Badge({ type }: { type: 'LONG' | 'SHORT' | string }) {
  if (type === 'LONG')
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold tracking-wider tabular"
        style={{
          background: 'rgba(16,185,129,0.12)',
          color: '#34d399',
          border: '1px solid rgba(16,185,129,0.25)',
          boxShadow: '0 0 8px rgba(16,185,129,0.1)',
        }}
      >
        <svg width="6" height="6" viewBox="0 0 6 6" fill="currentColor" aria-hidden="true"><path d="M3 0L6 6H0L3 0Z"/></svg>
        LONG
      </span>
    );
  if (type === 'SHORT')
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold tracking-wider tabular"
        style={{
          background: 'rgba(239,68,68,0.12)',
          color: '#f87171',
          border: '1px solid rgba(239,68,68,0.25)',
          boxShadow: '0 0 8px rgba(239,68,68,0.1)',
        }}
      >
        <svg width="6" height="6" viewBox="0 0 6 6" fill="currentColor" aria-hidden="true"><path d="M3 6L0 0H6L3 6Z"/></svg>
        SHORT
      </span>
    );
  return (
    <span className="inline-flex px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-surface3 text-textMuted border border-borderLight">
      {type}
    </span>
  );
}
