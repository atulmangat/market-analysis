import type { StrategyReport } from '../types';
import { AgentProposalCard } from './AgentProposalCard';
import { MarkdownText } from './MarkdownText';
import { Badge } from './Badge';

interface VerdictEntry {
  ticker: string;
  action: string;
  horizon?: string;
  size?: string;
  target?: string;
  stop?: string;
  reasoning: string;
}

function parseJudgeReasoning(raw: string | null | undefined): VerdictEntry[] {
  if (!raw) return [];
  // Try to parse as JSON array of verdict objects
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as VerdictEntry[];
    // Single object
    if (parsed && typeof parsed === 'object') return [parsed as VerdictEntry];
  } catch {
    // Plain text reasoning — wrap as single entry
    return [{ ticker: '', action: '', reasoning: raw }];
  }
  return [{ ticker: '', action: '', reasoning: raw }];
}

export function DebateSection({ d, ticker }: { d: StrategyReport['debate']; ticker?: string }) {
  const allVerdicts = parseJudgeReasoning(d?.judge_reasoning);
  // Filter to only the verdict for this report's ticker (if known)
  const verdicts = ticker
    ? allVerdicts.filter(v => !v.ticker || v.ticker === ticker)
    : allVerdicts.slice(0, 1); // fallback: show only first verdict

  return (
    <>
      <div className="px-6 py-5">
        <p className="text-[10px] font-medium text-textDim tracking-widest uppercase pb-3 mb-3 border-b border-borderLight">Judge Verdict</p>
        {d ? (
          <div className="space-y-3">
            {verdicts.map((v, i) => (
              <div key={i} className="bg-surface2 border border-borderLight border-l-2 border-l-amber-500 rounded-lg overflow-hidden">
                {/* Verdict header */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-borderLight bg-surface3/30 flex-wrap">
                  <span className="text-xs font-semibold text-amber-400">⚖ Judge Verdict</span>
                  <span className="text-[10px] text-textDim bg-surface3 border border-borderLight px-1.5 py-0.5 rounded font-mono">
                    {d.consensus_votes} agents aligned
                  </span>
                  {d.enabled_markets && (
                    <span className="text-[10px] text-textDim">· {d.enabled_markets}</span>
                  )}
                  {v.ticker && (
                    <>
                      <div className="ml-auto flex items-center gap-2">
                        <Badge type={v.action} />
                        <span className="text-[11px] font-mono font-semibold text-textMain">{v.ticker}</span>
                      </div>
                    </>
                  )}
                </div>

                {/* Trade metadata pills */}
                {(v.horizon || v.size || v.target || v.stop) && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2.5 border-b border-borderLight bg-surface3/20 text-[10px] text-textDim">
                    {v.horizon && <span><span className="text-textDim uppercase tracking-wider mr-1">Horizon</span><span className="text-textMuted font-medium">{v.horizon}</span></span>}
                    {v.size    && <span><span className="text-textDim uppercase tracking-wider mr-1">Size</span><span className="text-textMuted font-medium">{v.size}</span></span>}
                    {v.target  && <span><span className="text-up uppercase tracking-wider mr-1">Target</span><span className="text-up font-medium">{v.target}</span></span>}
                    {v.stop    && <span><span className="text-down-text uppercase tracking-wider mr-1">Stop</span><span className="text-down-text font-medium">{v.stop}</span></span>}
                  </div>
                )}

                {/* Reasoning — rendered as markdown */}
                <div className="px-4 py-3">
                  <MarkdownText text={v.reasoning ?? 'No reasoning recorded.'} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-textDim">No debate linked to this strategy.</p>
        )}
      </div>

      {d && d.proposals.length > 0 && (() => {
        // Show proposals for this ticker first, then others (greyed) — or filter to ticker only
        const relevant = ticker ? d.proposals.filter(p => p.ticker === ticker) : d.proposals;
        if (relevant.length === 0) return null;
        return (
          <div className="px-6 py-5">
            <p className="text-[10px] font-medium text-textDim tracking-widest uppercase pb-3 mb-3 border-b border-borderLight">
              Agent Analysis <span className="normal-case tracking-normal">({relevant.length} analyst{relevant.length !== 1 ? 's' : ''})</span>
            </p>
            <div className="space-y-3">
              {relevant.map((p, i) => <AgentProposalCard key={i} p={p} />)}
            </div>
          </div>
        );
      })()}
    </>
  );
}
