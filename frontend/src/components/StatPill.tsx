export function StatPill({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className={`bg-surface2 border rounded-lg px-3 py-2.5 ${accent ?? 'border-borderLight'}`}>
      <p className="text-[9px] text-textDim uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-xs font-semibold text-textMain truncate">{value}</p>
    </div>
  );
}
