import React from 'react';

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`bg-surface border border-borderLight rounded-2xl transition-all duration-200 hover:border-borderMid ${className}`}
      style={{
        boxShadow: '0 1px 4px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.025)',
      }}
    >
      {children}
    </div>
  );
}
