import type { AgentMemory, AgentPrompt, AgentFitness, AgentEvolution, MarketConfig } from '../types';
import { MARKET_ICONS, MARKET_TICKERS, NOTE_COLORS } from '../constants';
import { Card } from '../components/Card';
import { SectionHeader } from '../components/SectionHeader';
import { Toggle } from '../components/Toggle';

interface SettingsPageProps {
  darkMode: boolean;
  toggleDarkMode: () => void;
  approvalMode: string;
  setMode: (mode: string) => void;
  markets: MarketConfig[];
  toggleMarket: (name: string, enabled: number) => void;
  scheduleInterval: number;
  handleScheduleUpdate: (minutes: number) => void;
  handleManualTrigger: () => void;
  isTriggering: boolean;
  agents: AgentPrompt[];
  agentFitness: AgentFitness[];
  agentEvolution: AgentEvolution[];
  evolutionAgent: string | null;
  selectedAgent: string | null;
  setSelectedAgent: (name: string | null) => void;
  loadEvolution: (agentName: string) => void;
  setEvolutionAgent: (name: string | null) => void;
  memories: AgentMemory[];
}

export function SettingsPage({
  darkMode, toggleDarkMode,
  approvalMode, setMode,
  markets, toggleMarket,
  scheduleInterval, handleScheduleUpdate, handleManualTrigger, isTriggering,
  agents, agentFitness, agentEvolution, evolutionAgent,
  selectedAgent, setSelectedAgent, loadEvolution, setEvolutionAgent,
  memories,
}: SettingsPageProps) {
  const agentMemoriesFor = (name: string) => memories.filter(m => m.agent_name === name);
  const noteColors = NOTE_COLORS;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      {/* Left column: system settings */}
      <div className="xl:col-span-1 space-y-5">
        <h2 className="text-xs font-semibold text-textMuted uppercase tracking-widest">System Settings</h2>

        {/* Theme */}
        <Card>
          <SectionHeader title="Appearance" />
          <div className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-textMain">{darkMode ? 'Dark Mode' : 'Light Mode'}</p>
                <p className="text-[11px] text-textMuted mt-0.5">{darkMode ? 'Easy on the eyes at night' : 'Bright and clear'}</p>
              </div>
              <button
                onClick={toggleDarkMode}
                className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors duration-300 focus:outline-none ${darkMode ? 'bg-brand-600' : 'bg-surface3 border border-borderLight'}`}
              >
                <span className={`absolute text-sm transition-all duration-300 ${darkMode ? 'left-1.5' : 'right-1.5'}`}>
                  {darkMode ? '🌙' : '☀️'}
                </span>
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-300 ${darkMode ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>
        </Card>

        {/* Approval mode */}
        <Card>
          <SectionHeader title="Approval Mode" />
          <div className="p-5 space-y-3">
            <div className="flex rounded-lg overflow-hidden border border-borderLight">
              <button onClick={() => setMode('auto')} className={`flex-1 py-2.5 text-sm font-medium transition-colors ${approvalMode === 'auto' ? 'bg-brand-600 text-white' : 'bg-surface2 text-textMuted hover:bg-surface3'}`}>
                Auto Deploy
              </button>
              <button onClick={() => setMode('manual')} className={`flex-1 py-2.5 text-sm font-medium transition-colors ${approvalMode === 'manual' ? 'bg-amber-600 text-white' : 'bg-surface2 text-textMuted hover:bg-surface3'}`}>
                Manual
              </button>
            </div>
            <p className="text-xs text-textMuted">{approvalMode === 'auto' ? 'Strategies deploy automatically after consensus.' : 'Each strategy requires your approval before going live.'}</p>
          </div>
        </Card>

        {/* Markets */}
        <Card>
          <SectionHeader title="Enabled Markets" />
          <div className="p-5 space-y-4">
            {markets.map(m => (
              <div key={m.id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xl">{MARKET_ICONS[m.market_name] ?? '📊'}</span>
                  <div>
                    <p className="text-sm font-medium text-textMain">{m.market_name}</p>
                    <p className="text-[11px] text-textMuted">{MARKET_TICKERS[m.market_name]?.length ?? 0} tickers</p>
                  </div>
                </div>
                <Toggle checked={!!m.is_enabled} onChange={() => toggleMarket(m.market_name, m.is_enabled)} />
              </div>
            ))}
          </div>
        </Card>

        {/* Schedule */}
        <Card>
          <SectionHeader title="Debate Schedule" />
          <div className="p-5 space-y-4">
            <p className="text-xs text-textMuted">Run a new debate cycle every:</p>
            <div className="grid grid-cols-4 gap-2">
              {[15, 30, 60, 120].map(mins => (
                <button key={mins} onClick={() => handleScheduleUpdate(mins)}
                  className={`py-2 text-xs font-medium rounded-lg border transition-colors ${scheduleInterval === mins ? 'bg-brand-600 border-brand-500 text-white' : 'bg-surface2 border-borderLight text-textMuted hover:bg-surface3 hover:text-textMain'}`}>
                  {mins >= 60 ? `${mins / 60}h` : `${mins}m`}
                </button>
              ))}
            </div>
            <button onClick={() => handleManualTrigger()} disabled={isTriggering}
              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium border transition-colors ${isTriggering ? 'bg-surface3 border-borderLight text-textDim cursor-not-allowed' : 'bg-brand-600 border-brand-500 text-white hover:bg-brand-500'}`}>
              {isTriggering ? <><span className="animate-spin inline-block">↻</span> Running…</> : <><span>▶</span> Run Now</>}
            </button>
            <p className="text-[11px] text-textDim text-center">Next auto-run in ~{scheduleInterval} min</p>
          </div>
        </Card>
      </div>

      {/* Right columns: agent transparency */}
      <div className="xl:col-span-2 space-y-5">
        <h2 className="text-xs font-semibold text-textMuted uppercase tracking-widest">Agent Darwinian Evolution</h2>

        {agents.length === 0 && (
          <Card className="p-8 text-center text-sm text-textMuted">No agents found. Run a debate first.</Card>
        )}

        {/* Darwin fitness leaderboard */}
        {agentFitness.length > 0 && (() => {
          const sorted = [...agentFitness].sort((a, b) =>
            (b.fitness_score ?? -1) - (a.fitness_score ?? -1)
          );
          return (
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-borderLight bg-surface2">
                <span className="text-sm font-semibold text-textMain">Fitness Leaderboard</span>
                <span className="text-[10px] text-textDim">Updates after each evaluation cycle</span>
              </div>
              <div className="divide-y divide-borderLight">
                {sorted.map((af, rank) => {
                  const fitness = af.fitness_score;
                  const hasData = fitness !== null && af.total_scored >= 1;
                  const barWidth = hasData ? `${(fitness! / 100) * 100}%` : '0%';
                  const barColor = !hasData ? 'bg-surface3'
                    : fitness! >= 65 ? 'bg-up'
                    : fitness! >= 45 ? 'bg-amber-500'
                    : 'bg-down';
                  const rankEmoji = rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `#${rank + 1}`;
                  return (
                    <div key={af.agent_name} className="px-5 py-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <span className="text-base w-6 text-center">{rankEmoji}</span>
                          <div className="h-8 w-8 rounded-lg bg-brand-600/20 border border-brand-500/30 flex items-center justify-center text-brand-400 font-bold text-xs">
                            {af.agent_name.split(' ').map(w => w[0]).join('')}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-textMain">{af.agent_name}</p>
                            <p className="text-[10px] text-textDim">
                              Gen {af.generation}
                              {af.total_scored > 0 && <> · {af.total_scored} scored</>}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          {hasData ? (
                            <>
                              <p className={`text-lg font-light tabular-nums ${fitness! >= 65 ? 'text-up' : fitness! >= 45 ? 'text-amber-400' : 'text-down'}`}>
                                {fitness!.toFixed(1)}
                                <span className="text-xs text-textDim">/100</span>
                              </p>
                              <p className="text-[10px] text-textDim">
                                {((af.win_rate ?? 0) * 100).toFixed(0)}% wins
                                {af.avg_return !== null && <> · {af.avg_return > 0 ? '+' : ''}{af.avg_return.toFixed(1)} ret</>}
                              </p>
                            </>
                          ) : (
                            <p className="text-xs text-textDim">Awaiting data</p>
                          )}
                        </div>
                      </div>

                      {/* Fitness bar */}
                      <div className="h-1.5 w-full bg-surface3 rounded-full overflow-hidden mb-2">
                        <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: barWidth }} />
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center justify-between">
                        <div className="flex gap-2">
                          <button
                            onClick={() => setSelectedAgent(selectedAgent === af.agent_name ? null : af.agent_name)}
                            className={`text-[10px] px-2 py-1 rounded border transition-colors ${selectedAgent === af.agent_name ? 'bg-brand-600/20 border-brand-500/40 text-brand-400' : 'border-borderLight text-textDim hover:text-textMuted hover:bg-surface2'}`}
                          >
                            {selectedAgent === af.agent_name ? '▲ Prompt' : '▼ Prompt'}
                          </button>
                          <button
                            onClick={() => evolutionAgent === af.agent_name ? setEvolutionAgent(null) : loadEvolution(af.agent_name)}
                            className={`text-[10px] px-2 py-1 rounded border transition-colors ${evolutionAgent === af.agent_name ? 'bg-purple-600/20 border-purple-500/40 text-purple-400' : 'border-borderLight text-textDim hover:text-textMuted hover:bg-surface2'}`}
                          >
                            {evolutionAgent === af.agent_name ? '▲ History' : '🧬 History'}
                          </button>
                        </div>
                        {fitness !== null && fitness < 45 && af.total_scored >= 3 && (
                          <span className="text-[10px] text-down bg-down-bg px-2 py-0.5 rounded-full border border-down/20 animate-pulse">
                            Evolution candidate
                          </span>
                        )}
                        {fitness !== null && fitness >= 65 && (
                          <span className="text-[10px] text-up bg-up-bg px-2 py-0.5 rounded-full border border-up/20">
                            Elite donor
                          </span>
                        )}
                      </div>

                      {/* Inline prompt panel */}
                      {selectedAgent === af.agent_name && (() => {
                        const agent = agents.find(a => a.agent_name === af.agent_name);
                        const agentMems = agentMemoriesFor(af.agent_name);
                        if (!agent) return null;
                        return (
                          <div className="mt-3 space-y-3">
                            <div className="bg-surface2 border border-borderLight rounded-lg p-3">
                              <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-2">Current System Prompt</p>
                              <pre className="text-[11px] text-textMuted leading-relaxed whitespace-pre-wrap font-sans">{agent.system_prompt}</pre>
                              {agent.updated_at && <p className="text-[10px] text-textDim mt-2">Last evolved: {new Date(agent.updated_at).toLocaleString()}</p>}
                            </div>
                            {agentMems.length > 0 && (
                              <div className="bg-surface2 border border-borderLight rounded-lg p-3">
                                <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider mb-2">Memory Notes ({agentMems.length})</p>
                                <div className="space-y-2 max-h-48 overflow-y-auto">
                                  {agentMems.map(m => (
                                    <div key={m.id} className="flex gap-2 text-[11px]">
                                      <span className={`shrink-0 text-[9px] font-bold uppercase px-1 py-0.5 rounded h-fit ${noteColors[m.note_type] ?? 'text-textDim bg-surface3'}`}>{m.note_type}</span>
                                      <p className="text-textMuted leading-relaxed">{m.content}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Inline evolution history */}
                      {evolutionAgent === af.agent_name && agentEvolution.length > 0 && (
                        <div className="mt-3 bg-surface2 border border-borderLight rounded-lg overflow-hidden">
                          <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider px-3 py-2 border-b border-borderLight">
                            Evolution History — {agentEvolution.length} generation{agentEvolution.length !== 1 ? 's' : ''}
                          </p>
                          <div className="divide-y divide-borderLight max-h-64 overflow-y-auto">
                            {agentEvolution.map(ev => {
                              const reasonColor: Record<string, string> = {
                                MUTATION:  'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/40',
                                CROSSOVER: 'text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/50 border border-purple-200 dark:border-purple-800/40',
                                RESET:     'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/40',
                                SEED:      'text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800/40',
                                MANUAL:    'text-textMuted bg-surface2 border border-borderLight',
                              };
                              return (
                                <div key={ev.id} className="px-3 py-3">
                                  <div className="flex items-center justify-between mb-1.5">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] font-bold text-textMuted">Gen {ev.generation}</span>
                                      {ev.evolution_reason && (
                                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${reasonColor[ev.evolution_reason] ?? 'text-textDim bg-surface3'}`}>
                                          {ev.evolution_reason}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-right">
                                      {ev.fitness_score !== null && (
                                        <span className={`text-[11px] font-medium ${ev.fitness_score >= 65 ? 'text-up' : ev.fitness_score >= 45 ? 'text-amber-400' : 'text-down'}`}>
                                          {ev.fitness_score.toFixed(1)}/100
                                        </span>
                                      )}
                                      {ev.replaced_at && <p className="text-[10px] text-textDim">{new Date(ev.replaced_at).toLocaleDateString()}</p>}
                                    </div>
                                  </div>
                                  <pre className="text-[10px] text-textDim leading-relaxed whitespace-pre-wrap font-sans line-clamp-3">{ev.system_prompt}</pre>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {evolutionAgent === af.agent_name && agentEvolution.length === 0 && (
                        <div className="mt-3 bg-surface2 border border-borderLight rounded-lg p-3 text-center text-[11px] text-textMuted">
                          No evolution history yet — this agent is still in its original form.
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
    </div>
  );
}
