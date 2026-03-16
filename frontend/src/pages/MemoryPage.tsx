import type { AgentMemory, AgentPrompt } from '../types';
import { NOTE_COLORS } from '../constants';
import { Card } from '../components/Card';
import { SectionHeader } from '../components/SectionHeader';

interface MemoryPageProps {
  agents: AgentPrompt[];
  groupedMemories: Record<string, AgentMemory[]>;
  editingPromptAgent: string | null;
  editPromptText: string;
  setEditingPromptAgent: (a: string | null) => void;
  setEditPromptText: (t: string) => void;
  saveAgentPrompt: (agentName: string, prompt: string) => void;
}

export function MemoryPage({
  agents, groupedMemories,
  editingPromptAgent, editPromptText,
  setEditingPromptAgent, setEditPromptText, saveAgentPrompt,
}: MemoryPageProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-xs font-semibold text-textMuted uppercase tracking-widest">Agent Memory & Feedback Loop</h2>
      {Object.keys(groupedMemories).length === 0 && (
        <Card className="p-8 text-center text-sm text-textMuted">No memory notes yet.</Card>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.entries(groupedMemories).map(([agentName, agentMemories]) => (
          <Card key={agentName} className="overflow-hidden">
            <SectionHeader
              title={agentName}
              meta={<span className="text-[10px] text-textDim">{agentMemories.length} notes</span>}
            />
            <div className="divide-y divide-borderLight max-h-80 overflow-y-auto">
              {agentMemories.map(m => {
                const noteColors = NOTE_COLORS;
                return (
                  <div key={m.id} className="px-4 py-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${noteColors[m.note_type] ?? 'text-textDim bg-surface3'}`}>
                        {m.note_type}
                      </span>
                      <span className="text-[10px] text-textDim">{new Date(m.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="text-[11px] text-textMuted leading-relaxed">{m.content}</p>
                  </div>
                );
              })}
            </div>
            {/* System Prompt section */}
            <div className="border-t border-borderLight px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold text-textDim uppercase tracking-wider">System Prompt</p>
                {editingPromptAgent !== agentName && (
                  <button
                    onClick={() => { setEditingPromptAgent(agentName); setEditPromptText(agents.find(a => a.agent_name === agentName)?.system_prompt ?? ''); }}
                    className="text-[10px] text-brand-400 hover:text-brand-300 px-2 py-0.5 rounded border border-brand-700/30 bg-brand-900/20 hover:bg-brand-800/30 transition-colors"
                  >&#9998; Edit</button>
                )}
              </div>
              {editingPromptAgent === agentName ? (
                <div className="space-y-2">
                  <textarea
                    value={editPromptText}
                    onChange={e => setEditPromptText(e.target.value)}
                    rows={6}
                    className="w-full bg-surface border border-borderLight rounded px-2 py-1.5 text-xs text-textMain placeholder-textDim focus:outline-none focus:border-brand-500 resize-y font-sans leading-relaxed"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => saveAgentPrompt(agentName, editPromptText)} className="px-3 py-1 bg-brand-600 text-white rounded text-xs font-semibold hover:bg-brand-500">Save</button>
                    <button onClick={() => setEditingPromptAgent(null)} className="px-3 py-1 bg-surface border border-borderLight text-textMuted rounded text-xs">Cancel</button>
                  </div>
                </div>
              ) : (
                <pre className="text-[10px] text-textDim leading-relaxed whitespace-pre-wrap font-sans line-clamp-3">
                  {agents.find(a => a.agent_name === agentName)?.system_prompt ?? '—'}
                </pre>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
