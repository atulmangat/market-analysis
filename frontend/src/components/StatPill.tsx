export function StatPill({ label, value, accent }: { label: string; value: string; accent?: string }) {
  const isUp   = accent?.includes('up');
  const isDown = accent?.includes('down');

  const style = isUp
    ? { background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.18)', color: '#34d399' }
    : isDown
      ? { background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }
      : { background: 'var(--color-surface2)', border: '1px solid var(--color-borderLight)', color: 'var(--color-textMain)' };

  return (
    <div className="rounded-xl px-3 py-2.5 transition-all duration-150" style={style}>
      <p className="text-[9px] text-textDim uppercase tracking-widest mb-1 font-semibold">{label}</p>
      <p className="text-[13px] font-mono font-semibold truncate tabular" style={{ color: style.color }}>{value}</p>
    </div>
  );
}
