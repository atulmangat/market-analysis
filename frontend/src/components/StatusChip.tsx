export function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE:   'bg-up-bg text-up-text border border-up/20',
    PENDING:  'bg-warning-bg text-warning-text border border-warning/20',
    REJECTED: 'bg-down-bg text-down-text border border-down/20',
    CLOSED:   'bg-surface3 text-textDim border border-borderLight',
  };
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${map[status] ?? 'bg-surface3 text-textMuted border border-borderLight'}`}>
      {status}
    </span>
  );
}
