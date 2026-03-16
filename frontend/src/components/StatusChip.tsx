export function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE:   'bg-up-bg text-up-text border border-up/20',
    PENDING:  'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-500/20',
    REJECTED: 'bg-down-bg text-down-text border border-down/20',
    CLOSED:   'bg-surface3 text-textDim border border-borderLight',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${map[status] ?? 'bg-surface3 text-textMuted'}`}>
      {status}
    </span>
  );
}
