import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../utils';
import { Card } from './Card';
import { useToast } from '../hooks/useToast';

interface AgentManagerProps {
  onRefresh: () => void;
  initialPrompt?: string;
  initialName?: string;
  initialDescription?: string;
  isOpen?: boolean;
  onClose?: () => void;
  hideButton?: boolean;
}

export function AgentManager({ 
  onRefresh, initialPrompt, initialName, initialDescription, isOpen, onClose, hideButton 
}: AgentManagerProps) {
  const { push: toast } = useToast();
  const [chatOpen, setChatOpen] = useState(isOpen || false);
  const [chatMessage, setChatMessage] = useState('');
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'assistant', content: string }[]>([]);
  const [isBuilding, setIsBuilding] = useState(false);
  const [suggestedAgent, setSuggestedAgent] = useState<{ agent_name: string; system_prompt: string; description: string } | null>(
    initialPrompt ? { agent_name: initialName || '', system_prompt: initialPrompt, description: initialDescription || '' } : null
  );
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
        setChatOpen(true);
        if (initialPrompt) {
            setSuggestedAgent({ agent_name: initialName || '', system_prompt: initialPrompt, description: initialDescription || '' });
            setChatHistory([{ role: 'assistant', content: `Adjusting "${initialName}". How should I change the strategy?` }]);
        }
    }
  }, [isOpen, initialPrompt, initialName, initialDescription]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  useEffect(() => {
    if (!chatOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatOpen]);

  const handleClose = () => {
    setChatOpen(false);
    setSuggestedAgent(null);
    setChatHistory([]);
    onClose?.();
  };

  const handleBuildPrompt = async () => {
    if (!chatMessage.trim()) return;
    
    const userMsg = chatMessage.trim();
    setChatHistory(prev => [...prev, { role: 'user', content: userMsg }]);
    setChatMessage('');
    setIsBuilding(true);

    try {
      const res = await apiFetch('/agents/build-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          instruction: userMsg,
          current_prompt: suggestedAgent?.system_prompt || '' 
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setSuggestedAgent(data);
        setChatHistory(prev => [...prev, { 
          role: 'assistant', 
          content: `I've updated the prompt for "${data.agent_name}".\n\n**Description:** ${data.description}\n\nHow does this look? You can ask for more changes or click "Save Agent" to apply.` 
        }]);
      } else {
        toast('Failed to generate prompt', 'err');
      }
    } catch {
      toast('Network error', 'err');
    } finally {
      setIsBuilding(false);
    }
  };

  const handleSaveAgent = async () => {
    if (!suggestedAgent) return;
    try {
      const isUpdate = !!initialName;
      // If it's an update, we use PUT /agents/{name}/prompt, otherwise POST /agents
      const url = isUpdate 
        ? `/agents/${encodeURIComponent(initialName!)}/prompt`
        : '/agents';
      
      const method = isUpdate ? 'PUT' : 'POST';
      const body = isUpdate 
        ? { system_prompt: suggestedAgent.system_prompt, description: suggestedAgent.description }
        : suggestedAgent;

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        toast(isUpdate ? 'Agent updated' : 'Agent created');
        handleClose();
        onRefresh();
      } else {
        const d = await res.json();
        toast(d.detail || 'Failed to save agent', 'err');
      }
    } catch {
      toast('Network error', 'err');
    }
  };

  return (
    <>
      {!isOpen && !hideButton && (
        <button
          onClick={() => setChatOpen(true)}
          className="flex items-center gap-2.5 px-4 py-2 bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-white rounded-xl text-xs font-bold shadow-lg shadow-brand-900/20 hover:shadow-brand-900/40 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-300"
        >
          <span className="text-sm">＋</span> Build New Agent
        </button>
      )}

      {chatOpen && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <Card className="w-full max-w-2xl h-[80vh] flex flex-col overflow-hidden shadow-2xl border-brand-500/20">
            {/* Header */}
            <div className="px-6 py-4 border-b border-borderLight flex items-center justify-between bg-surface2/30">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-brand-600/20 text-brand-400 flex items-center justify-center">
                  <span className="text-lg">🤖</span>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-textMain">{initialName ? `Editing ${initialName}` : 'Agent Architect'}</h3>
                  <p className="text-[10px] text-textDim uppercase tracking-wider">AI Prompt Designer</p>
                </div>
              </div>
              <button 
                onClick={handleClose}
                className="text-textDim hover:text-textMain transition-colors text-xl"
              >
                ×
              </button>
            </div>

            {/* Chat Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-background/50">
              {chatHistory.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4 max-w-md mx-auto">
                  <div className="text-4xl">✨</div>
                  <h4 className="text-sm font-medium text-textMain">Refine your analyst</h4>
                  <p className="text-xs text-textDim leading-relaxed">
                    Tell me how you want this agent to behave. E.g., "Add a rule to always check for upcoming FDA decisions for biotech stocks."
                  </p>
                </div>
              )}
              {chatHistory.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                    msg.role === 'user' 
                      ? 'bg-brand-600 text-white rounded-tr-none' 
                      : 'bg-surface2 border border-borderLight text-textMain rounded-tl-none pr-8 relative'
                  }`}>
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  </div>
                </div>
              ))}
              {isBuilding && (
                <div className="flex justify-start">
                  <div className="bg-surface2 border border-borderLight rounded-2xl rounded-tl-none px-4 py-3 space-x-1 flex items-center">
                    <span className="w-1 h-1 bg-brand-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                    <span className="w-1 h-1 bg-brand-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                    <span className="w-1 h-1 bg-brand-400 rounded-full animate-bounce"></span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Suggested Prompt Preview (if available) */}
            {suggestedAgent && (
              <div className="px-6 py-4 border-t border-borderLight bg-surface2/50 max-h-48 overflow-y-auto">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[10px] font-bold text-textDim uppercase tracking-widest">System Prompt Preview</h4>
                  <span className="text-[10px] text-brand-400 font-mono">Structure: IDENTITY | CONSTITUTION</span>
                </div>
                <pre className="text-[10px] text-textMuted leading-relaxed font-mono whitespace-pre-wrap bg-background p-3 rounded-lg border border-borderLight overflow-x-hidden">
                  {suggestedAgent.system_prompt}
                </pre>
              </div>
            )}

            {/* Input Area */}
            <div className="p-4 border-t border-borderLight bg-surface flex flex-col gap-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatMessage}
                  onChange={e => setChatMessage(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleBuildPrompt()}
                  placeholder="Ask the Architect to refine the agent..."
                  className="flex-1 bg-background border border-borderLight rounded-xl px-4 py-2.5 text-xs text-textMain focus:outline-none focus:border-brand-500 transition-colors"
                />
                <button
                  onClick={handleBuildPrompt}
                  disabled={isBuilding || !chatMessage.trim()}
                  className="px-5 py-2.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:hover:bg-brand-600 text-white rounded-xl text-xs font-bold shadow-md shadow-brand-900/10 hover:shadow-brand-900/20 active:scale-95 transition-all duration-200"
                >
                  {isBuilding ? (
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Designing...
                    </div>
                  ) : 'Send'}
                </button>
              </div>
              
              {suggestedAgent && (
                <div className="flex items-center justify-end gap-3 pt-1">
                  <p className="text-[10px] text-textDim italic flex-1">Suggested Name: <span className="text-textMain font-semibold not-italic">{suggestedAgent.agent_name}</span></p>
                  <button
                    onClick={handleSaveAgent}
                    className="px-5 py-2.5 bg-gradient-to-r from-up to-emerald-500 hover:from-up-hover hover:to-emerald-400 text-white shadow-lg shadow-up/20 hover:shadow-up/40 rounded-xl text-xs font-black uppercase tracking-wider active:scale-95 transition-all duration-300"
                  >
                    {initialName ? 'Save Changes' : 'Confirm & Create Agent'}
                  </button>
                </div>
              )}
            </div>
          </Card>
        </div>,
        document.body
      )}
    </>
  );
}
