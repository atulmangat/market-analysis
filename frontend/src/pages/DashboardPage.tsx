import type { Strategy, DebateRound, AgentMemory, Prediction } from '../types';
import { MARKET_ICONS } from '../constants';
import { parseProposals } from '../utils';
import { Badge } from '../components/Badge';
import { StatusChip } from '../components/StatusChip';
import { Card } from '../components/Card';
import { StatDrawer } from '../components/StatDrawer';

interface DashboardPageProps {
  predictions: Prediction[];
  strategies: Strategy[];
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
  timelineTicker: string | null;
  statFocus: 'active' | 'pending' | 'debates' | 'memories' | null;
  editStratId: number | null;
  editStratForm: { position_size: string; notes: string };
  setExpandedStratMarket: (m: string) => void;
  setExpandedStratTicker: (t: string | null) => void;
  setExpandedDebateId: (id: number | null) => void;
  setTimelineTicker: (t: string | null) => void;
  setStatFocus: (f: 'active' | 'pending' | 'debates' | 'memories' | null) => void;
  setEditStratId: (id: number | null) => void;
  setEditStratForm: (f: { position_size: string; notes: string }) => void;
  handleApproval: (id: number, action: string) => void;
  handleUndeploy: (id: number) => void;
  handleStrategyUpdate: (id: number) => void;
  openReport: (id: number) => void;
}

export function DashboardPage({
  predictions, strategies, strategiesLoaded,
  activeStrategies, pendingStrategies, debates, memories, groupedMemories,
  debatesByMarketAndTicker, strategiesByMarketAndTicker, marketsWithStrategies,
  activeStratMarket, expandedStratTicker,
  expandedDebateId, timelineTicker, statFocus, editStratId, editStratForm,
  setExpandedStratMarket, setExpandedStratTicker, setExpandedDebateId,
  setTimelineTicker, setStatFocus, setEditStratId, setEditStratForm,
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

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Strategies — market → ticker hierarchy */}
        <div className="xl:col-span-2 space-y-4">
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
          {strategiesLoaded && strategies.length === 0 && (
            <Card className="p-10 text-center text-textMuted text-sm">
              No trades yet — awaiting the next debate cycle.
            </Card>
          )}
          {strategies.length > 0 && (
            <Card className="overflow-hidden">
              {/* Market tabs */}
              <div className="flex border-b border-borderLight overflow-x-auto">
                {marketsWithStrategies.map(market => (
                  <button
                    key={market}
                    onClick={() => { setExpandedStratMarket(market); setExpandedStratTicker(null); }}
                    className={`flex items-center gap-2 px-6 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                      activeStratMarket === market
                        ? 'border-brand-500 text-textMain bg-surface2'
                        : 'border-transparent text-textMuted hover:text-textMain hover:bg-surface2/50'
                    }`}
                  >
                    <span className="text-base">{MARKET_ICONS[market] ?? '📊'}</span>
                    <span>{market}</span>
                    <span className="text-[10px] bg-surface3 text-textDim rounded-full px-1.5 py-0.5">
                      {Object.keys(strategiesByMarketAndTicker[market] ?? {}).length}
                    </span>
                  </button>
                ))}
              </div>

              {/* Ticker rows */}
              <div className="divide-y divide-borderLight">
                {Object.entries(strategiesByMarketAndTicker[activeStratMarket] ?? {}).map(([ticker, tickerStrats]) => {
                  const isOpen = expandedStratTicker === ticker;
                  const latestStrat = tickerStrats[0];
                  const hasPending = tickerStrats.some(s => s.status === 'PENDING');

                  return (
                    <div key={ticker}>
                      <button
                        className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface2 transition-colors text-left group"
                        onClick={() => { setExpandedStratTicker(isOpen ? null : ticker); if (!isOpen) setTimelineTicker(ticker); else setTimelineTicker(null); }}
                      >
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
                          {hasPending && (
                            <span className="text-[10px] text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950 border border-amber-300 dark:border-amber-500/30 px-2 py-0.5 rounded-full animate-pulse">
                              Pending
                            </span>
                          )}
                          {latestStrat.status === 'ACTIVE' && (
                            <span className={`text-xs font-mono font-semibold tabular-nums ${(latestStrat.current_return ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>
                              {(latestStrat.current_return ?? 0) >= 0 ? '+' : ''}{(latestStrat.current_return ?? 0).toFixed(2)}%
                            </span>
                          )}
                          <Badge type={latestStrat.strategy_type} />
                          <span className="text-textDim group-hover:text-textMuted transition-colors text-xs">{isOpen ? '▲' : '▼'}</span>
                        </div>
                      </button>

                      {isOpen && (
                        <div className="bg-background/60 border-t border-borderLight divide-y divide-borderLight">
                          {tickerStrats.map(strat => (
                            <div key={strat.id} className={`p-5 ${strat.status === 'PENDING' ? 'ring-inset ring-1 ring-amber-500/20' : ''}`}>
                              <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-2">
                                  <Badge type={strat.strategy_type} />
                                  <StatusChip status={strat.status} />
                                  <span className="text-[11px] text-textDim">{new Date(strat.timestamp).toLocaleString()}</span>
                                </div>
                                <div className="text-right shrink-0 ml-4">
                                  {strat.status === 'PENDING' ? (
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => handleApproval(strat.id, 'approve')}
                                        className="px-3 py-1.5 bg-up text-white rounded-lg text-xs font-semibold hover:opacity-80 transition-opacity"
                                      >
                                        Approve
                                      </button>
                                      <button
                                        onClick={() => handleApproval(strat.id, 'reject')}
                                        className="px-3 py-1.5 bg-down text-white rounded-lg text-xs font-semibold hover:opacity-80 transition-opacity"
                                      >
                                        Reject
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="text-right">
                                      <p className="text-[10px] text-textDim uppercase tracking-wider mb-0.5">Return</p>
                                      <p className={`text-2xl font-light tabular-nums ${(strat.current_return ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>
                                        {(strat.current_return ?? 0) >= 0 ? '+' : ''}{(strat.current_return ?? 0).toFixed(2)}%
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-3 text-[11px] text-textMuted mb-3 flex-wrap">
                                <span>Entry <span className="text-textMain font-medium font-mono">${strat.entry_price.toFixed(2)}</span></span>
                                {strat.position_size && <span>Size <span className="text-textMain font-medium font-mono">${strat.position_size.toLocaleString()}</span></span>}
                                {strat.exit_price && <span>Exit <span className="text-textMain font-medium font-mono">${strat.exit_price.toFixed(2)}</span></span>}
                                {strat.close_reason && <span className="text-textDim">{strat.close_reason}</span>}
                              </div>
                              {strat.notes && (
                                <div className="mb-3 px-3 py-2 bg-surface3/50 rounded-lg">
                                  <p className="text-[11px] text-textMuted italic">{strat.notes}</p>
                                </div>
                              )}

                              {/* Edit form */}
                              {editStratId === strat.id && (
                                <div className="mb-3 p-3 bg-surface3/50 border border-borderMid rounded-lg space-y-2">
                                  <div className="flex gap-2">
                                    <input
                                      type="number"
                                      placeholder="Position size ($)"
                                      value={editStratForm.position_size}
                                      onChange={e => setEditStratForm({ ...editStratForm, position_size: e.target.value })}
                                      className="flex-1 bg-surface border border-borderLight rounded px-2 py-1 text-xs text-textMain placeholder-textDim focus:outline-none focus:border-brand-500"
                                    />
                                  </div>
                                  <textarea
                                    placeholder="Notes..."
                                    value={editStratForm.notes}
                                    onChange={e => setEditStratForm({ ...editStratForm, notes: e.target.value })}
                                    rows={2}
                                    className="w-full bg-surface border border-borderLight rounded px-2 py-1 text-xs text-textMain placeholder-textDim focus:outline-none focus:border-brand-500 resize-none"
                                  />
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
                                    <button
                                      onClick={() => openReport(strat.id)}
                                      className="px-2 py-1 text-[10px] bg-surface3 border border-borderLight text-textMuted rounded hover:text-textMain transition-colors"
                                    >◈ Report</button>
                                    {strat.status === 'ACTIVE' && <>
                                      <button
                                        onClick={() => { setEditStratId(strat.id); setEditStratForm({ position_size: strat.position_size?.toString() ?? '', notes: strat.notes ?? '' }); }}
                                        className="px-2 py-1 text-[10px] bg-surface3 border border-borderLight text-textMuted rounded hover:text-textMain transition-colors"
                                      >✎ Edit</button>
                                      <button
                                        onClick={() => handleUndeploy(strat.id)}
                                        className="px-2 py-1 text-[10px] bg-down-bg text-down-text border border-down/20 rounded hover:opacity-80 transition-opacity font-semibold"
                                      >✕ Undeploy</button>
                                    </>}
                                  </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>

        {/* Right col: Agent proposals */}
        <div className="space-y-4">
          <h2 className="text-xs font-semibold text-textMuted uppercase tracking-widest">Latest Agent Proposals</h2>
          <Card>
            <div className="divide-y divide-borderLight max-h-[600px] overflow-y-auto">
              {predictions.length === 0 && (
                <p className="p-5 text-xs text-textMuted">No recent proposals.</p>
              )}
              {predictions.slice(0, 8).map(pred => (
                <div key={pred.id} className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-brand-400">{pred.agent_name}</span>
                    <Badge type={pred.prediction} />
                  </div>
                  <p className="text-[10px] text-textDim font-mono mb-1">{pred.symbol}</p>
                  {pred.reasoning.includes('Agent error') ? (
                    <p className="text-[11px] text-down bg-down-bg/50 p-2 rounded border border-down/20">LLM API error — check API key.</p>
                  ) : (
                    <p className="text-[11px] text-textMuted line-clamp-3 leading-relaxed">{pred.reasoning}</p>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Inline timeline panel — shown when a ticker row is clicked */}
      {timelineTicker && (() => {
        const tickerDebates = Object.values(debatesByMarketAndTicker).flatMap(byTicker => byTicker[timelineTicker] ?? []).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-textMuted uppercase tracking-widest">
                Debate History — <span className="text-brand-400 font-mono">{timelineTicker}</span>
              </h2>
              <button onClick={() => { setTimelineTicker(null); setExpandedDebateId(null); }} className="text-[11px] text-textDim hover:text-textMuted px-2 py-1 rounded hover:bg-surface2 transition-colors">✕ Close</button>
            </div>
            {tickerDebates.length === 0 ? (
              <Card className="p-6 text-center text-sm text-textMuted">No debate history for {timelineTicker} yet.</Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="px-6 py-5">
                  <div className="relative border-l border-borderMid ml-2 space-y-4 pl-6 pb-1">
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
              </Card>
            )}
          </div>
        );
      })()}
    </div>
  );
}
