import React from 'react';

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface border border-borderLight rounded-xl ${className}`}>
      {children}
    </div>
  );
}
