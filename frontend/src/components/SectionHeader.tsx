import React from 'react';

export function SectionHeader({ title, meta }: { title: string; meta?: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-between px-5 py-3.5"
      style={{
        borderBottom: '1px solid var(--color-borderLight)',
        background: 'color-mix(in srgb, var(--color-surface2) 50%, transparent)',
      }}
    >
      <h2 className="text-[13px] font-semibold text-textMain tracking-tight">{title}</h2>
      {meta && <div className="text-[11px] text-textMuted">{meta}</div>}
    </div>
  );
}
