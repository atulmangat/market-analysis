export function Badge({ type }: { type: 'LONG' | 'SHORT' | string }) {
  if (type === 'LONG')
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold tracking-wide bg-up-bg text-up-text">▲ LONG</span>;
  if (type === 'SHORT')
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold tracking-wide bg-down-bg text-down-text">▼ SHORT</span>;
  return <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-bold bg-surface3 text-textMuted">{type}</span>;
}
