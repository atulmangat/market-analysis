import { useState } from 'react';
import type { Strategy, DebateRound, AgentMemory, Proposal } from '../types';
import { NOTE_COLORS } from '../constants';
import { Badge } from './Badge';
import { StatusChip } from './StatusChip';

export function StatDrawer({
  focus, onClose, activeStrategies, pendingStrategies, debates, memories, groupedMemories, onApproval,
}: {
  focus: 'active' | 'pending' | 'debates' | 'memories';
  onClose: () => void;
  activeStrategies: Strategy[];
  pendingStrategies: Strategy[];
  debates: DebateRound[];
  memories: AgentMemory[];
  groupedMemories: Record<string, AgentMemory[]>;
  onApproval: (id: number, action: string) => void;
}) {
  const [expandedDebateId, setExpandedDebateId] = useState<number | null>(null);

  const titles: Record<string, string> = {
    active:   'Active Strategies',
    pending:  'Pending Approval',
    debates:  'Debate Rounds',
    memories: 'Agent Memory Notes',
  };

  const noteColors = NOTE_COLORS;

  const renderContent = () => {
    if (focus === 'active' || focus === 'pending') {
      const list = focus === 'active' ? activeStrategies : pendingStrategies;
      if (list.length === 0)
        return <p className="text-sm text-textMuted px-5 py-10 text-center">No {focus === 'pending' ? 'pending' : 'active'} strategies.</p>;
      return (
        <div className="divide-y divide-borderLight">
          {list.map(strat => (
            <div key={strat.id} className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-surface3 border border-borderMid flex items-center justify-center text-xs font-bold text-textMain">
                    {strat.symbol.replace(/[.\-=]/g, '').substring(0, 3)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-base font-semibold text-textMain">{strat.symbol}</span>
                      <Badge type={strat.strategy_type} />
                      <StatusChip status={strat.status} />
                    </div>
                    <p className="text-[11px] text-textMuted">
                      Entry <span className="font-mono text-textMain">${strat.entry_price.toFixed(2)}</span>
                      <span className="mx-1.5 opacity-40">·</span>
                      {new Date(strat.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="shrink-0 ml-3 text-right">
                  {strat.status === 'PENDING' ? (
                    <div className="flex gap-2">
                      <button onClick={() => onApproval(strat.id, 'approve')} className="px-3 py-1.5 bg-up text-white rounded-lg text-xs font-semibold hover:opacity-80 transition-opacity">Approve</button>
                      <button onClick={() => onApproval(strat.id, 'reject')}  className="px-3 py-1.5 bg-down text-white rounded-lg text-xs font-semibold hover:opacity-80 transition-opacity">Reject</button>
                    </div>
                  ) : (
                    <div>
                      <p className="text-[10px] text-textDim uppercase tracking-wider mb-0.5">Return</p>
                      <p className={`text-xl font-light tabular-nums ${strat.current_return >= 0 ? 'text-up' : 'text-down'}`}>
                        {strat.current_return >= 0 ? '+' : ''}{(strat.current_return ?? 0).toFixed(2)}%
                      </p>
                    </div>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-textMuted leading-relaxed border-t border-borderLight pt-2 mt-2">{strat.reasoning_summary}</p>
            </div>
          ))}
        </div>
      );
    }

    if (focus === 'debates') {
      if (debates.length === 0)
        return <p className="text-sm text-textMuted px-5 py-10 text-center">No debate rounds yet.</p>;
      return (
        <div className="divide-y divide-borderLight">
          {debates.map(debate => {
            const isExpanded = expandedDebateId === debate.id;
            const proposals: Proposal[] = (() => { try { return JSON.parse(debate.proposals_json); } catch { return []; } })();
            const isLong = debate.consensus_action === 'LONG';
            return (
              <div key={debate.id}>
                <button
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface2 transition-colors text-left"
                  onClick={() => setExpandedDebateId(isExpanded ? null : debate.id)}
                >
                  <div className="flex items-center gap-3">
                    <div className={`h-2 w-2 rounded-full ${isLong ? 'bg-up' : 'bg-down'}`} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-textMain">{debate.consensus_ticker}</span>
                        <Badge type={debate.consensus_action} />
                        <span className="text-[11px] text-textMuted bg-surface3 px-2 py-0.5 rounded font-mono">{debate.consensus_votes} votes</span>
                      </div>
                      <p className="text-[11px] text-textDim mt-0.5">{new Date(debate.timestamp).toLocaleString()}</p>
                    </div>
                  </div>
                  <span className="text-textDim text-xs">{isExpanded ? '▲' : '▼'}</span>
                </button>
                {isExpanded && (
                  <div className="bg-background/40 border-t border-borderLight px-5 py-4 space-y-3">
                    <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider">Agent Proposals</p>
                    {proposals.map((p, i) => (
                      <div key={i} className="bg-surface border border-borderLight rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-semibold text-brand-400">{p.agent_name}</span>
                          <span className="flex items-center gap-1.5"><Badge type={p.action} /><span className="text-[10px] text-textDim font-mono">{p.ticker}</span></span>
                        </div>
                        <p className="text-[11px] text-textMuted leading-relaxed">{p.reasoning}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    }

    if (focus === 'memories') {
      if (memories.length === 0)
        return <p className="text-sm text-textMuted px-5 py-10 text-center">No memory notes yet.</p>;
      return (
        <div className="divide-y divide-borderLight">
          {Object.entries(groupedMemories).map(([agentName, agentMemories]) => (
            <div key={agentName} className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-7 w-7 rounded-md bg-brand-600/20 border border-brand-500/30 flex items-center justify-center text-brand-400 font-bold text-[10px]">
                  {agentName.split(' ').map((w: string) => w[0]).join('')}
                </div>
                <span className="text-sm font-semibold text-textMain">{agentName}</span>
                <span className="text-[10px] text-textDim bg-surface3 px-1.5 py-0.5 rounded-full">{agentMemories.length}</span>
              </div>
              <div className="space-y-2">
                {agentMemories.map(m => (
                  <div key={m.id} className="bg-surface2 border border-borderLight rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${noteColors[m.note_type] ?? 'text-textDim bg-surface3'}`}>{m.note_type}</span>
                      <span className="text-[10px] text-textDim">{new Date(m.created_at).toLocaleString()}</span>
                    </div>
                    <p className="text-[11px] text-textMuted leading-relaxed">{m.content}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  const counts: Record<string, number> = {
    active: activeStrategies.length, pending: pendingStrategies.length,
    debates: debates.length, memories: memories.length,
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={onClose} />
      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-surface border-l border-borderLight z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-borderLight bg-surface2 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-textMain">{titles[focus]}</h2>
            <p className="text-[11px] text-textMuted">{counts[focus]} item{counts[focus] !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-surface3 text-textMuted hover:text-textMain transition-colors text-lg">✕</button>
        </div>
        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {renderContent()}
        </div>
      </div>
    </>
  );
}
