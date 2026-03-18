import type { Strategy, DebateRound, AgentMemory } from '../types';
import { MARKET_ICONS } from '../constants';
import { parseProposals } from '../utils';
import { Badge } from '../components/Badge';
import { StatusChip } from '../components/StatusChip';
import { Card } from '../components/Card';
import { StatDrawer } from '../components/StatDrawer';

interface DashboardPageProps {
  strategiesLoaded: boolean;
  activeStrategies: Strategy[];
  pendingStrategies: Strategy[];
  debates: DebateRound[];
  memories: AgentMemory[];
  groupedMemories: Record<string, AgentMemory[]>;
  debatesByMarketAndTicker: Record<string, Record<string, DebateRound[]>>;
  strategiesByMarketAndTicker: Record<string, Record<string, Strategy[]>>;
  marketsWithStrategies: string[];
  activeStratMarket: string;
  expandedStratTicker: string | null;
  expandedDebateId: number | null;
  statFocus: 'active' | 'pending' | 'debates' | 'memories' | null;
  editStratId: number | null;
  editStratForm: { position_size: string; notes: string };
  setExpandedStratMarket: (m: string) => void;
  setExpandedStratTicker: (t: string | null) => void;
  setExpandedDebateId: (id: number | null) => void;
  setStatFocus: (f: 'active' | 'pending' | 'debates' | 'memories' | null) => void;
  setEditStratId: (id: number | null) => void;
  setEditStratForm: (f: { position_size: string; notes: string }) => void;
  handleApproval: (id: number, action: string) => void;
  handleUndeploy: (id: number) => void;
  handleStrategyUpdate: (id: number) => void;
  openReport: (id: number) => void;
}

export function DashboardPage({
  strategiesLoaded,
  activeStrategies, pendingStrategies, debates, memories, groupedMemories,
  debatesByMarketAndTicker, strategiesByMarketAndTicker, marketsWithStrategies,
  activeStratMarket, expandedStratTicker,
  expandedDebateId, statFocus, editStratId, editStratForm,
  setExpandedStratMarket, setExpandedStratTicker, setExpandedDebateId,
  setStatFocus, setEditStratId, setEditStratForm,
  handleApproval, handleUndeploy, handleStrategyUpdate, openReport,
}: DashboardPageProps) {

  const stats: { key: 'active' | 'pending' | 'debates' | 'memories'; label: string; value: number; color: string; hint: string }[] = [
    { key: 'active',   label: 'Active Trades',     value: activeStrategies.length,  color: 'text-up',         hint: 'View all active trades' },
    { key: 'pending',  label: 'Pending Approval',  value: pendingStrategies.length, color: 'text-amber-400',  hint: 'Review & approve pending trades' },
    { key: 'debates',  label: 'Debate Rounds',     value: debates.length,           color: 'text-brand-400',  hint: 'Browse debate history' },
    { key: 'memories', label: 'Agent Memories',    value: memories.length,          color: 'text-purple-400', hint: 'Inspect agent memory notes' },
  ];

  return (
    <div className="space-y-6">
      {/* Stats row — clickable */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => (
          <button
            key={s.key}
            onClick={() => setStatFocus(s.key)}
            className="text-left group"
          >
            <Card className="p-5 transition-all hover:border-borderMid hover:shadow-md group-hover:bg-surface2 cursor-pointer">
              <div className="flex items-start justify-between">
                <p className="text-xs text-textMuted mb-1 uppercase tracking-wider">{s.label}</p>
                <span className="text-[10px] text-textDim opacity-0 group-hover:opacity-100 transition-opacity">View →</span>
              </div>
              <p className={`text-3xl font-light ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-textDim mt-1 opacity-0 group-hover:opacity-100 transition-opacity">{s.hint}</p>
            </Card>
          </button>
        ))}
      </div>

      {/* Stat drill-down drawer */}
      {statFocus && (
        <StatDrawer
          focus={statFocus}
          onClose={() => setStatFocus(null)}
          activeStrategies={activeStrategies}
          pendingStrategies={pendingStrategies}
          debates={debates}
          memories={memories}
          groupedMemories={groupedMemories}
          onApproval={handleApproval}
        />
      )}

      <div className="space-y-6">
        {/* Strategies — two sections: active + pending */}
        <div className="space-y-6">

          {/* ── Active Trades ── */}
          <div className="space-y-3">
            <h2 className="text-xs font-semibold text-textMuted uppercase tracking-widest">Active Trades</h2>
            {!strategiesLoaded && (
              <Card className="p-6 space-y-3">
                {[1,2,3].map(i => (
                  <div key={i} className="animate-pulse flex items-center gap-4">
                    <div className="h-8 w-8 rounded-full bg-surface3 shrink-0" style={{opacity: 1 - i*0.2}} />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 bg-surface3 rounded w-1/4" style={{opacity: 1 - i*0.2}} />
                      <div className="h-2.5 bg-surface3 rounded w-1/2" style={{opacity: 1 - i*0.2}} />
                    </div>
                  </div>
                ))}
              </Card>
            )}
            {strategiesLoaded && activeStrategies.length === 0 && (
              <Card className="p-8 text-center text-textMuted text-sm">
                No active trades — awaiting next pipeline run.
              </Card>
            )}
            {activeStrategies.length > 0 && (() => {
              // Build market → ticker map for active only
              const activeByMarketAndTicker: Record<string, Record<string, Strategy[]>> = {};
              for (const strat of activeStrategies) {
                const market = marketsWithStrategies.find(m => Object.keys(strategiesByMarketAndTicker[m] ?? {}).some(t => t === strat.symbol)) ?? 'Other';
                if (!activeByMarketAndTicker[market]) activeByMarketAndTicker[market] = {};
                if (!activeByMarketAndTicker[market][strat.symbol]) activeByMarketAndTicker[market][strat.symbol] = [];
                activeByMarketAndTicker[market][strat.symbol].push(strat);
              }
              const activeMarkets = Object.keys(activeByMarketAndTicker);
              const currentMarket = activeMarkets.includes(activeStratMarket) ? activeStratMarket : activeMarkets[0] ?? '';
              return (
                <Card className="overflow-hidden">
                  {activeMarkets.length > 1 && (
                    <div className="flex border-b border-borderLight overflow-x-auto">
                      {activeMarkets.map(market => (
                        <button key={market} onClick={() => { setExpandedStratMarket(market); setExpandedStratTicker(null); }}
                          className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                            currentMarket === market ? 'border-brand-500 text-textMain bg-surface2' : 'border-transparent text-textMuted hover:text-textMain hover:bg-surface2/50'
                          }`}>
                          <span className="text-base">{MARKET_ICONS[market] ?? '📊'}</span>
                          <span>{market}</span>
                          <span className="text-[10px] bg-surface3 text-textDim rounded-full px-1.5 py-0.5">
                            {Object.keys(activeByMarketAndTicker[market] ?? {}).length}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="divide-y divide-borderLight">
                    {Object.entries(activeByMarketAndTicker[currentMarket] ?? {}).map(([ticker, tickerStrats]) => {
                      const isOpen = expandedStratTicker === ticker;
                      const latestStrat = tickerStrats[0];
                      return (
                        <div key={ticker}>
                          <button className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface2 transition-colors text-left group"
                            onClick={() => setExpandedStratTicker(isOpen ? null : ticker)}>
                            <div className="flex items-center gap-3">
                              <div className={`h-1.5 w-1.5 rounded-full ${latestStrat.strategy_type === 'LONG' ? 'bg-up' : 'bg-down'}`} />
                              <div className="h-9 w-9 rounded-lg bg-surface3 border border-borderMid flex items-center justify-center text-xs font-bold text-textMain">
                                {ticker.replace(/[.\-=]/g, '').substring(0, 3)}
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-textMain">{ticker}</p>
                                <p className="text-[11px] text-textMuted">{tickerStrats.length} trade{tickerStrats.length !== 1 ? 's' : ''}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className={`text-xs font-mono font-semibold tabular-nums ${(latestStrat.current_return ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>
                                {(latestStrat.current_return ?? 0) >= 0 ? '+' : ''}{(latestStrat.current_return ?? 0).toFixed(2)}%
                              </span>
                              <Badge type={latestStrat.strategy_type} />
                              <span className="text-textDim group-hover:text-textMuted transition-colors text-xs">{isOpen ? '▲' : '▼'}</span>
                            </div>
                          </button>
                          {isOpen && (
                            <div className="bg-background/60 border-t border-borderLight divide-y divide-borderLight">
                              {tickerStrats.map(strat => (
                                <div key={strat.id} className="p-5">
                                  <div className="flex items-start justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                      <Badge type={strat.strategy_type} />
                                      <StatusChip status={strat.status} />
                                      <span className="text-[11px] text-textDim">{new Date(strat.timestamp).toLocaleString()}</span>
                                    </div>
                                    <div className="text-right shrink-0 ml-4">
                                      <p className="text-[10px] text-textDim uppercase tracking-wider mb-0.5">Return</p>
                                      <p className={`text-2xl font-light tabular-nums ${(strat.current_return ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>
                                        {(strat.current_return ?? 0) >= 0 ? '+' : ''}{(strat.current_return ?? 0).toFixed(2)}%
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-3 text-[11px] text-textMuted mb-3 flex-wrap">
                                    <span>Entry <span className="text-textMain font-medium font-mono">${strat.entry_price.toFixed(2)}</span></span>
                                    {strat.position_size && <span>Size <span className="text-textMain font-medium font-mono">${strat.position_size.toLocaleString()}</span></span>}
                                  </div>
                                  {strat.notes && (
                                    <div className="mb-3 px-3 py-2 bg-surface3/50 rounded-lg">
                                      <p className="text-[11px] text-textMuted italic">{strat.notes}</p>
                                    </div>
                                  )}
                                  {editStratId === strat.id && (
                                    <div className="mb-3 p-3 bg-surface3/50 border border-borderMid rounded-lg space-y-2">
                                      <input type="number" placeholder="Position size ($)" value={editStratForm.position_size}
                                        onChange={e => setEditStratForm({ ...editStratForm, position_size: e.target.value })}
                                        className="w-full bg-surface border border-borderLight rounded px-2 py-1 text-xs text-textMain placeholder-textDim focus:outline-none focus:border-brand-500" />
                                      <textarea placeholder="Notes..." value={editStratForm.notes} rows={2}
                                        onChange={e => setEditStratForm({ ...editStratForm, notes: e.target.value })}
                                        className="w-full bg-surface border border-borderLight rounded px-2 py-1 text-xs text-textMain placeholder-textDim focus:outline-none focus:border-brand-500 resize-none" />
                                      <div className="flex gap-2">
                                        <button onClick={() => handleStrategyUpdate(strat.id)} className="px-3 py-1 bg-brand-600 text-white rounded text-xs font-semibold hover:bg-brand-500">Save</button>
                                        <button onClick={() => setEditStratId(null)} className="px-3 py-1 bg-surface border border-borderLight text-textMuted rounded text-xs">Cancel</button>
                                      </div>
                                    </div>
                                  )}
                                  <div className="pt-3 border-t border-borderLight flex items-start justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[10px] text-textDim uppercase tracking-wider mb-1">Rationale</p>
                                      <p className="text-[11px] text-textMuted leading-relaxed">{strat.reasoning_summary}</p>
                                    </div>
                                    <div className="shrink-0 flex gap-2">
                                      <button onClick={() => openReport(strat.id)}
                                        className="px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-brand-500/10 border border-brand-500/30 text-brand-400 hover:bg-brand-500/20 transition-all flex items-center gap-1.5">
                                        <span className="text-xs">◈</span> Full Research Report
                                      </button>
                                      <button onClick={() => { setEditStratId(strat.id); setEditStratForm({ position_size: strat.position_size?.toString() ?? '', notes: strat.notes ?? '' }); }}
                                        className="px-2 py-1 text-[10px] bg-surface3 border border-borderLight text-textMuted rounded hover:text-textMain transition-colors">✎ Edit</button>
                                      <button onClick={() => handleUndeploy(strat.id)} className="px-2 py-1 text-[10px] bg-down-bg text-down-text border border-down/20 rounded hover:opacity-80 transition-opacity font-semibold">✕ Close</button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                              {/* ── Debate History inline (below Rationale) ── */}
                              {(() => {
                                const tickerDebates = Object.values(debatesByMarketAndTicker).flatMap(byTicker => byTicker[ticker] ?? []).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                                if (tickerDebates.length === 0) return null;
                                return (
                                  <div className="border-t border-borderLight px-5 py-4 space-y-3 bg-surface2/30">
                                    <p className="text-[10px] font-semibold text-textDim uppercase tracking-widest">Debate History</p>
                                    <div className="relative border-l border-borderMid ml-2 space-y-3 pl-6 pb-1">
                                      {tickerDebates.map(debate => {
                                        const isExpanded = expandedDebateId === debate.id;
                                        const proposals = parseProposals(debate.proposals_json);
                                        const debIsLong = debate.consensus_action === 'LONG';
                                        return (
                                          <div key={debate.id} className="relative">
                                            <div className={`absolute -left-[25px] top-3 h-3 w-3 rounded-full border-2 border-background ${debIsLong ? 'bg-up' : 'bg-down'}`} />
                                            <div className={`border rounded-lg overflow-hidden transition-all ${isExpanded ? 'border-brand-500/40 bg-surface' : 'border-borderLight bg-surface hover:border-borderMid'}`}>
                                              <button
                                                className="w-full flex items-center justify-between px-4 py-3 text-left"
                                                onClick={() => setExpandedDebateId(isExpanded ? null : debate.id)}
                                              >
                                                <div className="flex items-center gap-3">
                                                  <Badge type={debate.consensus_action} />
                                                  <span className="text-[11px] text-textMuted bg-surface3 px-2 py-0.5 rounded font-mono">{debate.consensus_votes} agreed</span>
                                                  {debate.judge_reasoning && (
                                                    <span className="text-[10px] text-amber-400 bg-amber-950/50 border border-amber-700/30 px-2 py-0.5 rounded">⚖ Judge</span>
                                                  )}
                                                  <span className="text-[11px] text-textDim">{new Date(debate.timestamp).toLocaleString()}</span>
                                                </div>
                                                <span className="text-textDim text-xs">{isExpanded ? '▲' : '▼'}</span>
                                              </button>
                                              {isExpanded && (
                                                <div className="border-t border-borderLight p-4 space-y-4 bg-background/40">
                                                  {debate.judge_reasoning && (
                                                    <div className="bg-amber-950/30 border border-amber-700/30 rounded-lg p-4">
                                                      <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider mb-2">⚖ Judge Verdict</p>
                                                      <p className="text-[11px] text-textMuted leading-relaxed">{debate.judge_reasoning}</p>
                                                    </div>
                                                  )}
                                                  <div>
                                                    <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-3">Agent Proposals</p>
                                                    <div className="space-y-3">
                                                      {proposals.map((p, i) => {
                                                        const isWinner = p.ticker === debate.consensus_ticker && p.action === debate.consensus_action;
                                                        return (
                                                          <div key={i} className={`bg-surface border rounded-lg p-3 ${isWinner ? 'border-amber-500/30' : 'border-borderLight'}`}>
                                                            <div className="flex items-center justify-between mb-2">
                                                              <div className="flex items-center gap-2">
                                                                <span className="text-xs font-semibold text-brand-400">{p.agent_name}</span>
                                                                {isWinner && <span className="text-[9px] text-amber-400 bg-amber-950/50 px-1.5 py-0.5 rounded">✓ matched</span>}
                                                              </div>
                                                              <span className="flex items-center gap-1.5">
                                                                <Badge type={p.action} />
                                                                <span className="text-[10px] text-textDim font-mono">{p.ticker}</span>
                                                              </span>
                                                            </div>
                                                            <p className="text-[11px] text-textMuted leading-relaxed">{p.reasoning}</p>
                                                          </div>
                                                        );
                                                      })}
                                                    </div>
                                                  </div>
                                                  {debate.research_context && parseProposals(debate.research_context).length > 0 && (
                                                    <div>
                                                      <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-2">Sources Used</p>
                                                      <ul className="space-y-1.5">
                                                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                                        {parseProposals(debate.research_context).map((src: any, i: number) => (
                                                          <li key={i} className="flex items-start gap-2 text-[11px]">
                                                            <span className="text-textDim mt-0.5 shrink-0">›</span>
                                                            {src.url && src.url !== 'N/A' ? (
                                                              <a href={src.url} target="_blank" rel="noreferrer" className="text-brand-400 hover:text-brand-300 hover:underline line-clamp-1">{src.title}</a>
                                                            ) : (
                                                              <span className="text-textMuted line-clamp-1">{src.title}</span>
                                                            )}
                                                          </li>
                                                        ))}
                                                      </ul>
                                                    </div>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              );
            })()}
          </div>

          {/* ── Pending Approval ── */}
          {pendingStrategies.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-semibold text-textMuted uppercase tracking-widest flex items-center gap-2">
                Pending Approval
                <span className="text-[10px] bg-amber-500/15 text-amber-500 border border-amber-500/25 px-1.5 py-0.5 rounded-full tabular-nums">{pendingStrategies.length}</span>
              </h2>
              <div className="space-y-3">
                {pendingStrategies.map(strat => (
                  <Card key={strat.id} className="overflow-hidden">
                    {/* Amber accent bar */}
                    <div className="h-0.5 w-full bg-gradient-to-r from-amber-500/60 via-amber-400/30 to-transparent" />
                    <div className="p-5 space-y-3">
                      {/* Top row: ticker info + action buttons */}
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-xs font-bold text-amber-400 shrink-0">
                            {strat.symbol.replace(/[.\-=]/g, '').substring(0, 3)}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-textMain font-mono">{strat.symbol}</span>
                              <Badge type={strat.strategy_type} />
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-textDim">
                              <span>Entry <span className="font-mono text-textMuted">${strat.entry_price.toFixed(2)}</span></span>
                              <span>·</span>
                              <span>{new Date(strat.timestamp).toLocaleString()}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button onClick={() => handleApproval(strat.id, 'approve')}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold border bg-up-bg text-up-text border-up/25 hover:border-up/50 transition-colors">
                            ✓ Approve
                          </button>
                          <button onClick={() => handleApproval(strat.id, 'reject')}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold border bg-surface2 text-textMuted border-borderLight hover:bg-down-bg hover:text-down-text hover:border-down/25 transition-colors">
                            ✕ Reject
                          </button>
                        </div>
                      </div>
                      {/* Reasoning */}
                      {strat.reasoning_summary && (
                        <p className="text-[11px] text-textMuted leading-relaxed line-clamp-2 pl-[52px]">{strat.reasoning_summary}</p>
                      )}
                      {/* Report link — subtle, below reasoning */}
                      <div className="pl-[52px]">
                        <button onClick={() => openReport(strat.id)}
                          className="inline-flex items-center gap-1 text-[11px] text-brand-400 hover:text-brand-300 transition-colors">
                          <span className="text-[10px]">◈</span> Full Research Report →
                        </button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>

    </div>
  );
}
