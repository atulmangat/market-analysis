export function Badge({ type }: { type: 'LONG' | 'SHORT' | string }) {
  if (type === 'LONG')
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-widest bg-up-bg text-up-text border border-up/20">
        ▲ LONG
      </span>
    );
  if (type === 'SHORT')
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-widest bg-down-bg text-down-text border border-down/20">
        ▼ SHORT
      </span>
    );
  return (
    <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold bg-surface3 text-textMuted border border-borderLight">
      {type}
    </span>
  );
}
