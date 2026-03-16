import { useState } from 'react';
import type { StrategyReport } from '../types';
import { Badge } from './Badge';

export function AgentProposalCard({ p }: { p: StrategyReport['debate'] extends null ? never : NonNullable<StrategyReport['debate']>['proposals'][0] }) {
  const [expanded, setExpanded] = useState(false);
  const preview = p.reasoning.slice(0, 320);
  const hasMore = p.reasoning.length > 320;
  return (
    <div className={`rounded-xl border p-4 ${p.matched_consensus ? 'border-brand-500/30 bg-brand-900/10' : 'border-borderLight bg-surface2'}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-brand-400">{p.agent_name}</span>
          {p.matched_consensus && <span className="text-[9px] bg-brand-500/20 text-brand-300 px-1.5 py-0.5 rounded font-semibold">✓ SELECTED</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <Badge type={p.action} />
          <span className="text-[10px] text-textDim font-mono">{p.ticker}</span>
        </div>
      </div>
      <p className="text-[11px] text-textMuted leading-relaxed whitespace-pre-wrap">
        {expanded ? p.reasoning : preview}{!expanded && hasMore ? '…' : ''}
      </p>
      {hasMore && (
        <button onClick={() => setExpanded(e => !e)}
          className="mt-2 text-[10px] text-brand-400 hover:text-brand-300 font-semibold">
          {expanded ? '▲ Show less' : '▼ Read full analysis'}
        </button>
      )}
    </div>
  );
}
