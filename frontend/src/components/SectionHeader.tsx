import React from 'react';

export function SectionHeader({ title, meta }: { title: string; meta?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-borderLight">
      <h2 className="text-sm font-semibold text-textMain tracking-wide">{title}</h2>
      {meta && <div className="text-xs text-textMuted">{meta}</div>}
    </div>
  );
}
