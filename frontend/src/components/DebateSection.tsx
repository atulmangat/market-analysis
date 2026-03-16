import type { StrategyReport } from '../types';
import { AgentProposalCard } from './AgentProposalCard';

export function DebateSection({ d }: { d: StrategyReport['debate'] }) {
  return (
    <>
      <div className="px-6 py-5">
        <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-3">Judge Verdict</p>
        {d ? (
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-500/20 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">⚖ Committee Decision</span>
              <span className="text-[10px] text-textDim font-mono">{d.consensus_votes} agents aligned</span>
              {d.enabled_markets && <span className="text-[10px] text-textDim">· {d.enabled_markets}</span>}
            </div>
            <p className="text-[11px] text-textMuted leading-relaxed whitespace-pre-wrap">{d.judge_reasoning ?? 'No reasoning recorded.'}</p>
          </div>
        ) : (
          <p className="text-xs text-textDim">No debate linked to this strategy.</p>
        )}
      </div>
      {d && d.proposals.length > 0 && (
        <div className="px-6 py-5">
          <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-3">Agent Analysis ({d.proposals.length} analysts)</p>
          <div className="space-y-3">
            {d.proposals.map((p, i) => <AgentProposalCard key={i} p={p} />)}
          </div>
        </div>
      )}
    </>
  );
}
