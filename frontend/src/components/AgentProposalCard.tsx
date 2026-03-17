import { useState } from 'react';
import type { StrategyReport } from '../types';
import { Badge } from './Badge';
import { MarkdownText } from './MarkdownText';

export function AgentProposalCard({ p }: { p: StrategyReport['debate'] extends null ? never : NonNullable<StrategyReport['debate']>['proposals'][0] }) {
  const [expanded, setExpanded] = useState(false);
  const preview = p.reasoning.slice(0, 320);
  const hasMore = p.reasoning.length > 320;

  return (
    <div className={`rounded-lg border border-borderLight bg-surface2 overflow-hidden ${p.matched_consensus ? 'border-l-2 border-l-up bg-up-bg' : ''}`}>
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-textMain">{p.agent_name}</span>
            {p.matched_consensus && (
              <span className="text-[9px] bg-up-text text-white px-1.5 py-0.5 rounded font-semibold tracking-wide">SELECTED</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge type={p.action} />
            <span className="text-[10px] text-brand-400 font-mono">{p.ticker}</span>
          </div>
        </div>
        <MarkdownText text={expanded ? p.reasoning : preview + (!expanded && hasMore ? '…' : '')} />
        {hasMore && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="mt-2 text-[10px] text-brand-400 hover:text-brand-300 font-medium"
          >
            {expanded ? '▲ Show less' : '▼ Read full analysis'}
          </button>
        )}
      </div>
    </div>
  );
}
