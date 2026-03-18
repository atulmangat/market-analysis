import { useState } from 'react';
import type { AgentMemory, AgentPrompt, AgentFitness, AgentEvolution } from '../types';
import { NOTE_COLORS } from '../constants';
import { Card } from '../components/Card';
import { Toggle } from '../components/Toggle';
import { AgentManager } from '../components/AgentManager';
import { apiFetch } from '../utils';
import { useToast } from '../hooks/useToast';

// Agent metadata: type labels and market specializations
const AGENT_META: Record<string, { type: 'core' | 'specialist'; market?: string; icon: string; desc: string }> = {
  'Value Investor':          { type: 'core',       icon: '📊', desc: 'Fundamental analysis & mispricing detection' },
  'Technical Analyst':       { type: 'core',       icon: '📈', desc: 'Price action, patterns & momentum signals' },
  'Macro Economist':         { type: 'core',       icon: '🌍', desc: 'Cross-asset macro regime & policy analysis' },
  'Sentiment Analyst':       { type: 'core',       icon: '🎯', desc: 'Crowd psychology & flow analysis' },
  'Crypto Specialist':       { type: 'specialist', icon: '₿', market: 'Crypto',  desc: 'On-chain, DeFi, tokenomics & crypto narratives' },
  'India Market Specialist': { type: 'specialist', icon: '🇮🇳', market: 'India',   desc: 'NSE/BSE, RBI policy, FII/DII flows' },
  'Commodities Specialist':  { type: 'specialist', icon: '🪙', market: 'MCX',     desc: 'Gold, crude, natgas & base metals supply/demand' },
  'Semiconductor Specialist': { type: 'specialist', icon: '💾', market: 'US', desc: 'TSMC nodes, wafter capacities & AI capex trends' },
  'AI & Robotics Specialist': { type: 'specialist', icon: '🦾', market: 'US', desc: 'Software, LLMs, enterprise automation & real ROI' },
  'Real Estate Specialist':   { type: 'specialist', icon: '🏢', market: 'US', desc: 'REITs, commercial vacancies & rate-sensitive housing' },
  'Biotech & Pharma Specialist': { type: 'specialist', icon: '🧬', market: 'US', desc: 'Clinical trials, FDA approvals & drug pricing' },
};

interface AgentPageProps {
  agents: AgentPrompt[];
  groupedMemories: Record<string, AgentMemory[]>;
  agentFitness: AgentFitness[];
  editingPromptAgent: string | null;
  editPromptText: string;
  setEditingPromptAgent: (a: string | null) => void;
  setEditPromptText: (t: string) => void;
  saveAgentPrompt: (agentName: string, prompt: string) => void;
  onRefresh: () => void;
}

export function AgentPage({
  agents, groupedMemories, agentFitness,
  editingPromptAgent, editPromptText,
  setEditingPromptAgent, setEditPromptText, saveAgentPrompt, onRefresh,
}: AgentPageProps) {
  const { push: toast } = useToast();
  const [expandedAgents, setExpandedAgents] = useState<string[]>([]);
  const [leaderboardExpanded, setLeaderboardExpanded] = useState(true);
  const [disabledAgents, setDisabledAgents] = useState<string[]>([]);
  const [aiEditAgent, setAiEditAgent] = useState<AgentPrompt | null>(null);
  const [evolutionHistory, setEvolutionHistory] = useState<Record<string, AgentEvolution[]>>({});
  const [expandedEvolution, setExpandedEvolution] = useState<string[]>([]);
  const [tradesModal, setTradesModal] = useState<{ agentName: string; total: number } | null>(null);
  const [agentTrades, setAgentTrades] = useState<Record<string, { id: number; symbol: string; prediction: string; confidence: number; reasoning: string; actual_outcome: string | null; score: number | null; timestamp: string | null }[]>>({});
  const [tradesLoading, setTradesLoading] = useState<string | null>(null);
  const [expandedTradeId, setExpandedTradeId] = useState<number | null>(null);

  const toggleExpandedAgent = (agentName: string) => {
    const willExpand = !expandedAgents.includes(agentName);
    setExpandedAgents(prev =>
      prev.includes(agentName) ? prev.filter(name => name !== agentName) : [...prev, agentName]
    );
    if (willExpand) loadEvolutionHistory(agentName);
  };

  // Merge agents from predefined metadata, active prompts, and memories
  const allAgentNames = [...new Set([
    ...Object.keys(AGENT_META), // Include ALL predefined agents
    ...agents.map(a => a.agent_name),
    ...Object.keys(groupedMemories),
  ])];

  const coreAgents = allAgentNames.filter(n => (AGENT_META[n]?.type ?? 'core') === 'core');
  const specialistAgents = allAgentNames.filter(n => AGENT_META[n]?.type === 'specialist');

  const openTradesModal = async (agentName: string, total: number) => {
    setTradesModal({ agentName, total });
    if (agentTrades[agentName]) return;
    setTradesLoading(agentName);
    try {
      const res = await apiFetch(`/agents/predictions/${encodeURIComponent(agentName)}`);
      if (res.ok) { const data = await res.json(); setAgentTrades(prev => ({ ...prev, [agentName]: data })); }
    } catch { /* network */ } finally { setTradesLoading(null); }
  };

  const loadEvolutionHistory = async (agentName: string) => {
    if (evolutionHistory[agentName]) return; // already loaded
    try {
      const res = await apiFetch(`/agents/evolution/${encodeURIComponent(agentName)}`);
      if (res.ok) {
        const data = await res.json();
        setEvolutionHistory(prev => ({ ...prev, [agentName]: data }));
      }
    } catch { /* network */ }
  };

  const renderAgentCard = (agentName: string) => {
    const meta = AGENT_META[agentName];
    const memories = groupedMemories[agentName] ?? [];
    const prompt = agents.find(a => a.agent_name === agentName);
    const isExpanded = expandedAgents.includes(agentName);
    const isEditingPrompt = editingPromptAgent === agentName;

    const handleDelete = async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!confirm(`Are you sure you want to delete agent "${agentName}"? This will remove all their memory and history.`)) return;
      try {
        const res = await apiFetch(`/agents/${encodeURIComponent(agentName)}`, { method: 'DELETE' });
        if (res.ok) {
          toast('Agent deleted');
          onRefresh();
        } else {
          toast('Delete failed', 'err');
        }
      } catch (err) {
        toast('Network error', 'err');
      }
    };

    return (
      <Card 
        key={agentName} 
        className={`overflow-hidden transition-[grid-column] duration-300 ${isExpanded ? 'col-span-full' : ''}`}
      >
        {/* Agent header */}
        <div
          className="flex items-start gap-3 px-4 py-4 cursor-pointer hover:bg-surface2/50 transition-colors"
          onClick={() => toggleExpandedAgent(agentName)}>
          <span className="text-xl leading-none mt-0.5">{meta?.icon ?? '🤖'}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-textMain">{agentName}</span>
              {meta?.type === 'specialist' && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-brand-900/40 text-brand-300 border border-brand-700/30 uppercase tracking-wide">
                  Specialist · {meta.market}
                </span>
              )}
              {meta?.type === 'core' && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-surface3 text-textDim border border-borderLight uppercase tracking-wide">
                  Core
                </span>
              )}
            </div>
            <p className="text-[11px] text-textDim mt-0.5">{prompt?.description || meta?.desc || 'Custom Agent'}</p>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <span className="text-[10px] text-textDim">
                {memories.length} {memories.length === 1 ? 'memory' : 'memories'}
              </span>
              {prompt && (
                <span className="text-[10px] text-textDim">
                  {prompt.system_prompt.length} chars prompt
                </span>
              )}
              <div className="flex items-center gap-1.5 ml-auto">
                <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border ${
                    disabledAgents.includes(agentName) 
                      ? 'bg-surface3 text-textDim border-borderLight' 
                      : 'bg-up/10 text-up border-up/30'
                  }`}>
                  {disabledAgents.includes(agentName) ? 'Disabled' : 'Enabled'}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {!meta?.type && (
              <button 
                onClick={handleDelete}
                className="p-1.5 text-down-text hover:bg-down-bg/20 rounded-lg transition-colors"
                title="Delete Agent"
              >
                <span className="text-sm">🗑</span>
              </button>
            )}
            <span className={`text-textDim text-xs transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▾</span>
          </div>
        </div>

        {/* Expanded content */}
        {isExpanded && (
          <div className="border-t border-borderLight" onClick={e => e.stopPropagation()}>
            {/* Agent Control Panel */}
            <div className="px-4 py-3 bg-surface2/40 border-b border-borderLight flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider">Agent Status</p>
                <p className="text-[11px] text-textMuted mt-0.5">Toggle availability for the debate orchestrator</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-textMain">
                  {disabledAgents.includes(agentName) ? 'Disabled' : 'Enabled'}
                </span>
                <Toggle
                  checked={!disabledAgents.includes(agentName)}
                  onChange={() => {
                    setDisabledAgents(prev => 
                      prev.includes(agentName) ? prev.filter(n => n !== agentName) : [...prev, agentName]
                    );
                  }}
                />
              </div>
            </div>

            {/* Memory notes */}
            {memories.length > 0 && (
              <div className="px-4 py-3">
                <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-2">Memory Notes</p>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {memories.map(m => (
                    <div key={m.id} className="px-3 py-2 bg-surface2 rounded-lg border border-borderLight">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${NOTE_COLORS[m.note_type] ?? 'text-textDim bg-surface3'}`}>
                          {m.note_type}
                        </span>
                        <span className="text-[10px] text-textDim font-mono">
                          {new Date(m.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-[11px] text-textMuted leading-relaxed">{m.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {memories.length === 0 && (
              <div className="px-4 py-3">
                <p className="text-[11px] text-textDim italic">No memory notes yet — memories accumulate after each pipeline run.</p>
              </div>
            )}

            {/* Evolution History */}
            {(() => {
              const evo = evolutionHistory[agentName];
              if (!evo) return null;
              if (evo.length === 0) return (
                <div className="border-t border-borderLight px-4 py-3">
                  <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-1">Evolution History</p>
                  <p className="text-[11px] text-textDim italic">No evolution history yet — this agent hasn't been evolved.</p>
                </div>
              );
              const showEvo = expandedEvolution.includes(agentName);
              return (
                <div className="border-t border-borderLight">
                  <button
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-surface2/50 transition-colors"
                    onClick={e => { e.stopPropagation(); setExpandedEvolution(prev => prev.includes(agentName) ? prev.filter(n => n !== agentName) : [...prev, agentName]); }}
                  >
                    <div className="flex items-center gap-2">
                      <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider">Evolution History</p>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-900/40 border border-purple-700/40 text-purple-400">{evo.length} versions</span>
                    </div>
                    <span className={`text-textDim text-xs transition-transform ${showEvo ? 'rotate-180' : ''}`}>▾</span>
                  </button>
                  {showEvo && (
                    <div className="px-4 pb-3 space-y-3 max-h-80 overflow-y-auto" onClick={e => e.stopPropagation()}>
                      {evo.map(h => (
                        <div key={h.id} className="bg-surface2 rounded-lg border border-borderLight overflow-hidden">
                          <div className="px-3 py-2 bg-surface3 border-b border-borderLight flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-900/40 border border-purple-700/40 text-purple-400">gen {h.generation}</span>
                              {h.evolution_reason && (
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                  h.evolution_reason.includes('AGGRESSIVE') ? 'bg-down-bg border-down/30 text-down-text' :
                                  h.evolution_reason.includes('CROSSOVER') ? 'bg-brand-900/40 border-brand-700/40 text-brand-400' :
                                  'bg-amber-900/40 border-amber-700/40 text-amber-400'
                                }`}>{h.evolution_reason}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-[9px] text-textDim">
                              {h.fitness_score !== null && (
                                <span className={h.fitness_score >= 55 ? 'text-up' : 'text-down'}>
                                  fitness {h.fitness_score?.toFixed(1)}
                                </span>
                              )}
                              {h.win_rate !== null && (
                                <span>{Math.round((h.win_rate ?? 0) * 100)}% WR / {h.total_scored} scored</span>
                              )}
                              {h.replaced_at && (
                                <span className="font-mono">{new Date(h.replaced_at).toLocaleDateString()}</span>
                              )}
                            </div>
                          </div>
                          <pre className="text-[9px] text-textDim leading-relaxed whitespace-pre-wrap font-sans px-3 py-2 line-clamp-3 overflow-hidden">
                            {h.system_prompt.slice(0, 400)}{h.system_prompt.length > 400 ? '…' : ''}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* System Prompt */}
            <div className="border-t border-borderLight px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider">System Prompt</p>
                {!isEditingPrompt && (
                  <div className="flex gap-2">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        setEditingPromptAgent(agentName);
                        setEditPromptText(prompt?.system_prompt ?? '');
                      }}
                      className="text-[10px] text-brand-400 hover:text-brand-300 px-2 py-0.5 rounded border border-brand-700/30 bg-brand-900/20 hover:bg-brand-800/30 transition-colors">
                      ✎ Manual Edit
                    </button>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        if (prompt) setAiEditAgent(prompt);
                      }}
                      className="text-[10px] text-amber-400 hover:text-amber-300 px-2 py-0.5 rounded border border-amber-700/30 bg-amber-900/20 hover:bg-amber-800/30 transition-colors">
                      ✨ AI Edit
                    </button>
                  </div>
                )}
              </div>
              {isEditingPrompt ? (
                <div className="space-y-2" onClick={e => e.stopPropagation()}>
                  <textarea
                    value={editPromptText}
                    onChange={e => setEditPromptText(e.target.value)}
                    rows={8}
                    className="w-full bg-surface border border-borderLight rounded px-2 py-1.5 text-xs text-textMain placeholder-textDim focus:outline-none focus:border-brand-500 resize-y font-sans leading-relaxed"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveAgentPrompt(agentName, editPromptText)}
                      className="px-3 py-1 bg-brand-600 text-white rounded text-xs font-semibold hover:bg-brand-500">
                      Save
                    </button>
                    <button
                      onClick={() => setEditingPromptAgent(null)}
                      className="px-3 py-1 bg-surface border border-borderLight text-textMuted rounded text-xs">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <pre className="text-[10px] text-textDim leading-relaxed whitespace-pre-wrap font-sans line-clamp-4">
                  {prompt?.system_prompt ?? '—'}
                </pre>
              )}
            </div>
          </div>
        )}
      </Card>
    );
  };

  // ── Trades modal ─────────────────────────────────────────────────────────
  const tradesModalContent = tradesModal && (() => {
    const { agentName } = tradesModal;
    const trades = agentTrades[agentName] ?? [];
    const loading = tradesLoading === agentName;
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={() => setTradesModal(null)}
      >
        <div
          className="relative bg-surface border border-borderMid rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col mx-4"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-borderLight shrink-0">
            <div>
              <p className="text-sm font-semibold text-textMain">{agentName}</p>
              <p className="text-[11px] text-textDim mt-0.5">Trade history · {tradesModal.total} recorded</p>
            </div>
            <button
              onClick={() => setTradesModal(null)}
              className="h-7 w-7 flex items-center justify-center rounded-lg text-textDim hover:text-textMain hover:bg-surface2 transition-colors text-sm"
            >✕</button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <span className="text-xs text-textDim animate-pulse">Loading trades…</span>
              </div>
            ) : trades.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <span className="text-xs text-textDim italic">No trades recorded yet.</span>
              </div>
            ) : (
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-surface2 border-b border-borderLight z-10">
                  <tr>
                    <th className="text-left px-5 py-2.5 text-[10px] font-semibold text-textDim uppercase tracking-wider">Symbol</th>
                    <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-textDim uppercase tracking-wider">Call</th>
                    <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-textDim uppercase tracking-wider">Outcome</th>
                    <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-textDim uppercase tracking-wider">Score</th>
                    <th className="text-right px-5 py-2.5 text-[10px] font-semibold text-textDim uppercase tracking-wider">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map(t => {
                    const isExpanded = expandedTradeId === t.id;
                    return (
                      <>
                        <tr
                          key={t.id}
                          onClick={() => setExpandedTradeId(isExpanded ? null : t.id)}
                          className="border-t border-borderLight hover:bg-surface2/50 transition-colors cursor-pointer"
                        >
                          <td className="px-5 py-3 font-mono font-semibold text-textMain">{t.symbol}</td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              t.prediction === 'BULLISH' ? 'bg-up/10 text-up' : 'bg-down/10 text-down'
                            }`}>{t.prediction}</span>
                          </td>
                          <td className="px-4 py-3">
                            {t.actual_outcome ? (
                              <span className={`font-semibold ${
                                t.actual_outcome === 'PROFIT' ? 'text-up' : t.actual_outcome === 'LOSS' ? 'text-down' : 'text-textDim'
                              }`}>
                                {t.actual_outcome === 'PROFIT' ? '↑ Profit' : t.actual_outcome === 'LOSS' ? '↓ Loss' : t.actual_outcome}
                              </span>
                            ) : <span className="text-textDim">Pending</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            {t.score !== null
                              ? <span className={t.score >= 50 ? 'text-up' : 'text-down'}>{t.score.toFixed(1)}</span>
                              : <span className="text-textDim">—</span>}
                          </td>
                          <td className="px-5 py-3 text-right text-textDim font-mono">
                            {t.timestamp ? new Date(t.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—'}
                          </td>
                        </tr>
                        {isExpanded && t.reasoning && (
                          <tr key={`${t.id}-reasoning`} className="border-t border-borderLight bg-surface2/40">
                            <td colSpan={5} className="px-5 py-3">
                              <p className="text-[11px] text-textMuted leading-relaxed">{t.reasoning}</p>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {!loading && trades.length > 0 && (
            <div className="px-5 py-2.5 border-t border-borderLight bg-surface2/40 shrink-0">
              <p className="text-[10px] text-textDim">Click a row to expand reasoning</p>
            </div>
          )}
        </div>
      </div>
    );
  })();

  return (
    <div className="space-y-8">
      {tradesModalContent}
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xs font-semibold text-textMuted uppercase tracking-widest">Agents</h2>
          <p className="text-[11px] text-textDim mt-0.5">
            {agents.length} agents active · {Object.values(groupedMemories).reduce((s, m) => s + m.length, 0)} memory notes
          </p>
        </div>
        <AgentManager onRefresh={() => {}} />
      </div>

      <AgentManager 
        isOpen={!!aiEditAgent} 
        onClose={() => setAiEditAgent(null)}
        initialName={aiEditAgent?.agent_name}
        initialPrompt={aiEditAgent?.system_prompt}
        initialDescription={aiEditAgent?.description}
        onRefresh={() => {}}
        hideButton
      />

      {/* Leaderboard */}
      {agentFitness.length > 0 && (() => {
        const sorted = [...agentFitness].sort((a, b) =>
          (b.fitness_score ?? -1) - (a.fitness_score ?? -1)
        );
        return (
          <div>
            <button
              onClick={() => setLeaderboardExpanded(v => !v)}
              className="w-full flex items-center justify-between mb-3 group"
            >
              <h3 className="text-sm font-semibold text-textMain flex items-center gap-2">
                <span>🏆</span> Fitness Leaderboard
              </h3>
              <span className={`text-[10px] text-textDim group-hover:text-textMuted transition-all ${leaderboardExpanded ? '' : 'rotate-180'}`}>▲</span>
            </button>
            {leaderboardExpanded && (
              <Card className="overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-borderLight bg-surface2/60">
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-textDim uppercase tracking-wider w-6">#</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-textDim uppercase tracking-wider">Agent</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-textDim uppercase tracking-wider">Trades</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-textDim uppercase tracking-wider">Profit</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-textDim uppercase tracking-wider">Loss</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-textDim uppercase tracking-wider">Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-borderLight">
                    {sorted.map((af, rank) => {
                      const fitness = af.fitness_score;
                      const hasData = af.total_scored >= 1;
                      const profitable = Math.round((af.win_rate ?? 0) * af.total_scored);
                      const loss = af.total_scored - profitable;
                      const rankLabel = rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `${rank + 1}`;
                      return (
                        <tr key={af.agent_name} className="hover:bg-surface2/40 transition-colors">
                          <td className="px-4 py-3 text-center text-xs">{rankLabel}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-textMain">{af.agent_name}</span>
                              {af.generation > 1 && (
                                <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-purple-900/40 border border-purple-700/40 text-purple-400">gen {af.generation}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            {hasData ? (
                              <button
                                onClick={() => openTradesModal(af.agent_name, af.total_scored)}
                                className="tabular-nums font-mono text-brand-400 hover:text-brand-300 underline decoration-dotted underline-offset-2 transition-colors"
                              >
                                {af.total_scored}
                              </button>
                            ) : <span className="text-textDim">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            {hasData ? <span className="text-up">{profitable}</span> : <span className="text-textDim">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            {hasData ? <span className="text-down">{loss}</span> : <span className="text-textDim">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {fitness !== null ? (
                              <span className={`font-semibold tabular-nums ${fitness >= 65 ? 'text-up' : fitness >= 45 ? 'text-amber-400' : 'text-down'}`}>
                                {fitness.toFixed(1)}
                              </span>
                            ) : (
                              <span className="text-textDim">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            )}

          </div>
        );
      })()}

      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-textMain mb-3 flex items-center gap-2">
            <span>⚡</span> Core Agents
          </h3>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            {coreAgents.length > 0 ? (
              coreAgents.map(agentName => renderAgentCard(agentName))
            ) : (
              <div className="col-span-2 py-6 text-center text-textDim text-sm bg-surface2 rounded-lg border border-borderLight">
                No core agents found.
              </div>
            )}
          </div>
        </div>

        <div className="pt-4 border-t border-borderLight">
          <h3 className="text-sm font-semibold text-textMain mb-3 flex items-center gap-2">
            <span>🎯</span> Specialists
          </h3>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            {specialistAgents.length > 0 ? (
              specialistAgents.map(agentName => renderAgentCard(agentName))
            ) : (
              <div className="col-span-2 py-6 text-center text-textDim text-sm bg-surface2 rounded-lg border border-borderLight">
                No specialist agents found.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
