export function StatPill({ label, value, accent }: { label: string; value: string; accent?: string }) {
  const isUp = accent?.includes('up');
  const isDown = accent?.includes('down');
  const valueColor = isUp ? 'text-up' : isDown ? 'text-down-text' : 'text-textMain';

  return (
    <div className={`bg-surface2 border rounded px-3 py-3 ${accent ?? 'border-borderLight'}`}>
      <p className="text-[9px] text-textDim uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xs font-mono font-medium truncate ${valueColor}`}>{value}</p>
    </div>
  );
}
