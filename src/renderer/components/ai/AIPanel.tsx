import type { AIPanelState, ChatMessage, TabKey } from '../useAIPanelState';
import StatsDebugPanel from '../StatsDebugPanel';

interface AIPanelProps {
  selectedCode: string;
  activeFilePath?: string;
  onSaveTranslatedFile?: (
    content: string,
    language: string,
  ) => Promise<{ success: boolean; error?: string; skipped?: boolean }>;
  panelState: AIPanelState;
}

const LANGUAGES = [
  'JavaScript',
  'Dart',
  'C#',
  'PHP',
  'Python',
  'Java',
  'TypeScript'
];

function renderResponseContent(response: string) {
  const sections: Array<{
    type: 'text' | 'code';
    content: string;
    language?: string;
  }> = [];
  const fencePattern = /```(\w+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(response)) !== null) {
    if (match.index > lastIndex) {
      sections.push({ type: 'text', content: response.slice(lastIndex, match.index) });
    }

    sections.push({
      type: 'code',
      content: match[2],
      language: match[1] || 'code',
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < response.length) {
    sections.push({ type: 'text', content: response.slice(lastIndex) });
  }

  if (!sections.length) {
    return <div className="whitespace-pre-wrap text-xs leading-5">{response}</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {sections.map((section, index) => {
        if (section.type === 'code') {
          return (
            <div key={`${section.language}-${index}`} className="overflow-hidden rounded border border-[#7c3aed] bg-[#1e1e2e]">
              <div className="border-b border-[#2d2d3a] px-2 py-0.5 text-[9px] uppercase tracking-widest text-[#a78bfa]" style={{ fontFamily: 'Space Mono, monospace' }}>
                {section.language}
              </div>
              <pre className="m-0 overflow-x-auto p-2 text-[10px] text-[#d4d4d4]" style={{ fontFamily: 'Space Mono, monospace', whiteSpace: 'pre' }}>
                <code>{section.content}</code>
              </pre>
            </div>
          );
        }

        return (
          <p key={index} className="m-0 whitespace-pre-wrap leading-4 text-xs">
            {section.content}
          </p>
        );
      })}
    </div>
  );
}

function renderChatThread(messages: ChatMessage[]) {
  return (
    <div className="flex flex-col gap-2">
      {messages.length ? (
        messages.map((message, index) => {
          const isUser = message.role === 'user';

          return (
            <div key={`${message.role}-${index}`} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div
                className="max-w-[85%] rounded border px-2 py-1.5 text-xs leading-4"
                style={{
                  background: isUser ? '#4c1d95' : '#1e1e2e',
                  borderColor: isUser ? '#a78bfa' : '#2d2d3a',
                  color: '#d4d4d4',
                  fontFamily: 'Segoe UI, sans-serif',
                }}
              >
                {isUser ? message.content : renderResponseContent(message.content)}
              </div>
            </div>
          );
        })
      ) : (
        <div className="text-xs text-[#6b7280]" style={{ fontFamily: 'Segoe UI, sans-serif' }}>
          Start a conversation to get help with code, reasoning, or planning.
        </div>
      )}
    </div>
  );
}

function buildChatPrompt(systemPrompt: string, messages: ChatMessage[], userMessage: string) {
  const transcript = [...messages, { role: 'user' as const, content: userMessage }];
  const formattedTranscript = transcript
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n');

  return `${systemPrompt}\n\n${formattedTranscript}\nAssistant:`;
}

function getCompletionErrorText(error?: string) {
  if (typeof error === 'string' && error.trim() && error.trim() !== 'undefined') {
    return `⚠️ ${error.trim()}`;
  }

  return '⚠️ AI request failed';
}

export default function AIPanel({ selectedCode, activeFilePath, onSaveTranslatedFile, panelState }: AIPanelProps) {
  const {
    activeTab, setActiveTab,
    response, setResponse,
    loading, setLoading,
    saving, setSaving,
    saveMessage, setSaveMessage,
    language, setLanguage,
    prompt, setPrompt,
    askMessages, setAskMessages,
    askPrompt, setAskPrompt,
    askLoading, setAskLoading,
    planMessages, setPlanMessages,
    planPrompt, setPlanPrompt,
    planLoading, setPlanLoading,
    explainPrompt, setExplainPrompt,
    explainResponse, setExplainResponse,
    explainLoading, setExplainLoading,
  } = panelState;

  const appWindow = typeof window !== 'undefined' ? window : ({} as typeof window);
  const appWindowWithAI = appWindow as typeof window & {
    ai?: {
      translate: (payload: {
        prompt: string;
        selectedCode: string;
        language: string;
      }) => Promise<{ success: boolean; result?: string; error?: string }>;
      explain: (payload: {
        prompt: string;
        selectedCode: string;
      }) => Promise<{ success: boolean; result?: string; error?: string }>;
      complete: (prompt: string) => Promise<{ success: boolean; result?: string; error?: string }>;
    };
    electron?: {
      ipcRenderer: {
        on: (channel: string, listener: (token: unknown) => void) => (() => void) | void;
      };
    };
  };

  const sendChatMessage = async (
    userPrompt: string,
    messages: ChatMessage[],
    setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
    setLoadingState: React.Dispatch<React.SetStateAction<boolean>>,
    setPromptState: React.Dispatch<React.SetStateAction<string>>,
    systemPrompt: string,
  ) => {
    const trimmedPrompt = userPrompt.trim();
    if (!trimmedPrompt) return;

    setLoadingState(true);
    setPromptState('');
    setMessages((prev) => [...prev, { role: 'user', content: trimmedPrompt }, { role: 'assistant', content: '' }]);

    const removeListener = appWindow.electron?.ipcRenderer.on('ai:token', (token: unknown) => {
      setMessages((prev) => {
        const next = [...prev];
        for (let index = next.length - 1; index >= 0; index -= 1) {
          if (next[index]?.role === 'assistant') {
            next[index] = {
              ...next[index],
              content: next[index].content + String(token),
            };
            break;
          }
        }
        return next;
      });
    });

    try {
      const completion = await appWindowWithAI.ai?.complete(buildChatPrompt(systemPrompt, messages, trimmedPrompt));

      if (!completion?.success) {
        const errorText = getCompletionErrorText(completion?.error);
        setMessages((prev) => {
          const next = [...prev];
          for (let index = next.length - 1; index >= 0; index -= 1) {
            if (next[index]?.role === 'assistant') {
              next[index] = {
                ...next[index],
                content: errorText,
              };
              break;
            }
          }
          return next;
        });
      }
    } catch (err) {
      const errorText = getCompletionErrorText(err instanceof Error ? err.message : String(err));
      setMessages((prev) => {
        const next = [...prev];
        for (let index = next.length - 1; index >= 0; index -= 1) {
          if (next[index]?.role === 'assistant') {
            next[index] = {
              ...next[index],
              content: errorText,
            };
            break;
          }
        }
        return next;
      });
    } finally {
      if (removeListener) removeListener();
      setLoadingState(false);
    }
  };

  const handleAskSend = async () => {
    await sendChatMessage(
      askPrompt,
      askMessages,
      setAskMessages,
      setAskLoading,
      setAskPrompt,
      'You are a helpful, concise coding assistant for a beginner CS student. Answer directly in the chat.',
    );
  };

  const handlePlanSend = async () => {
    await sendChatMessage(
      planPrompt,
      planMessages,
      setPlanMessages,
      setPlanLoading,
      setPlanPrompt,
      'You are a planning assistant. Given the user\'s task, respond with a numbered, step-by-step plan only. Do not write full code, do not claim to make any changes — this is analysis only.',
    );
  };

  const handleTranslate = async () => {
    if (!prompt.trim() && !selectedCode.trim()) return;
    setLoading(true);
    setResponse('');
    setSaveMessage(null);

    const removeListener = appWindow.electron?.ipcRenderer.on('ai:token', (token: unknown) => {
      setResponse((prev) => prev + String(token));
    });

    try {
      const completion = await appWindowWithAI.ai?.translate({
        prompt: prompt.trim(),
        selectedCode: selectedCode.trim(),
        language,
      });

      if (!completion?.success) {
        setResponse(getCompletionErrorText(completion?.error));
      } else if (completion.result) {
        setResponse(completion.result);
      }
    } catch (err) {
      setResponse(getCompletionErrorText(err instanceof Error ? err.message : String(err)));
    } finally {
      if (removeListener) removeListener();
      setLoading(false);
    }
  };

  const handleSaveTranslatedFile = async () => {
    if (!response.trim() || saving) return;
    if (!activeFilePath) {
      setSaveMessage('⚠️ Open a file first so the new filename can be derived from it.');
      return;
    }
    if (!onSaveTranslatedFile) {
      setSaveMessage('⚠️ Saving is unavailable.');
      return;
    }

    setSaving(true);
    setSaveMessage(null);

    try {
      const result = await onSaveTranslatedFile(response, language);
      if (result.success) {
        setSaveMessage('✔ Saved to file');
      } else if (result.skipped) {
        setSaveMessage('Save cancelled — existing file kept.');
      } else {
        setSaveMessage(getCompletionErrorText(result.error));
      }
    } catch (err) {
      setSaveMessage(getCompletionErrorText(err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  const handleExplain = async () => {
    if (!explainPrompt.trim() && !selectedCode.trim()) return;
    setExplainLoading(true);
    setExplainResponse('');

    const removeListener = appWindow.electron?.ipcRenderer.on('ai:token', (token: unknown) => {
      setExplainResponse((prev) => prev + String(token));
    });

    try {
      const completion = await appWindow.ai?.explain({
        prompt: explainPrompt.trim(),
        selectedCode: selectedCode.trim(),
      });

      if (!completion?.success) {
        setExplainResponse(getCompletionErrorText(completion?.error));
      }
    } catch (err) {
      setExplainResponse(getCompletionErrorText(err instanceof Error ? err.message : String(err)));
    } finally {
      if (removeListener) removeListener();
      setExplainLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#1e1e2e] border-l border-[#2d2d3a] overflow-hidden">
      {/* Header with Stats Debug - ⓘ Icon is clickable */}
      <div 
        className="flex items-center justify-between px-4 py-1.5 shrink-0"
        style={{ 
          background: '#252535', 
          borderBottom: '1px solid #2d2d3a',
        }}
      >
        <span className="text-xs font-medium flex items-center gap-2" style={{ color: '#6b7280', fontFamily: 'Segoe UI, sans-serif' }}>
          ✨ AI Assistant
        </span>
        <div className="flex items-center gap-3">
          {/* ⓘ Clickable Icon - Opens Stats Debug Dialog */}
          <StatsDebugPanel projectPath={activeFilePath} />
          <span className="text-[10px]" style={{ color: '#6b7280' }}>
            Lines: {selectedCode.split('\n').length}
          </span>
          <span>|</span>
          <span className="text-[10px]" style={{ color: '#6b7280' }}>
            Complexity: {Math.min(Math.floor(selectedCode.length / 50), 20)}
          </span>
          <span>|</span>
          <span className="text-[10px]" style={{ color: '#6b7280' }}>
            Issues: 0
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-3 pt-2" style={{ borderBottom: '1px solid #2d2d3a' }}>
        {(['ask', 'plan', 'translate', 'explain'] as TabKey[]).map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className="text-[10px] px-3 py-1 rounded-t font-medium tracking-widest transition-colors"
              style={{
                background: isActive ? '#252535' : 'transparent',
                color: isActive ? '#d4d4d4' : '#6b7280',
                border: '1px solid #2d2d3a',
                borderBottomColor: isActive ? '#252535' : 'transparent',
                fontFamily: 'Segoe UI, sans-serif',
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col gap-1.5 px-3 py-2 overflow-hidden min-h-0">
        {activeTab === 'ask' && (
          <>
            <div className="flex-1 overflow-y-auto rounded bg-[#1e1e2e] p-2 min-h-0" style={{ border: '1px solid #2d2d3a' }}>
              {renderChatThread(askMessages)}
            </div>

            <div className="shrink-0 flex flex-col gap-1.5">
              <textarea
                value={askPrompt}
                onChange={(e) => setAskPrompt(e.target.value)}
                placeholder="Ask for help with code, concepts, debugging, or explanation..."
                className="text-[10px] p-2 rounded resize-none outline-none w-full"
                style={{
                  background: '#252535',
                  color: '#d4d4d4',
                  fontFamily: 'Segoe UI, sans-serif',
                  minHeight: '50px',
                  maxHeight: '70px',
                  border: '1px solid #2d2d3a',
                }}
              />

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleAskSend}
                  disabled={askLoading || !askPrompt.trim()}
                  className="text-[10px] px-3 py-1 rounded font-semibold flex items-center gap-2 transition-colors"
                  style={{
                    background: askLoading || !askPrompt.trim() ? '#2d2d3a' : '#a78bfa',
                    color: '#ffffff',
                    cursor: askLoading || !askPrompt.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {askLoading ? 'Thinking...' : 'Send'}
                </button>
              </div>
            </div>
          </>
        )}

        {activeTab === 'plan' && (
          <>
            <div className="shrink-0 rounded border border-[#2d2d3a] bg-[#1e1e2e] px-3 py-1 text-[10px] text-[#6b7280]" style={{ fontFamily: 'Segoe UI, sans-serif' }}>
              Plan mode — outlines steps only, does not make changes.
            </div>

            <div className="flex-1 overflow-y-auto rounded bg-[#1e1e2e] p-2 min-h-0" style={{ border: '1px solid #2d2d3a' }}>
              {renderChatThread(planMessages)}
            </div>

            <div className="shrink-0 flex flex-col gap-1.5">
              <textarea
                value={planPrompt}
                onChange={(e) => setPlanPrompt(e.target.value)}
                placeholder="Describe what you want to plan..."
                className="text-[10px] p-2 rounded resize-none outline-none w-full"
                style={{
                  background: '#252535',
                  color: '#d4d4d4',
                  fontFamily: 'Segoe UI, sans-serif',
                  minHeight: '50px',
                  maxHeight: '70px',
                  border: '1px solid #2d2d3a',
                }}
              />

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handlePlanSend}
                  disabled={planLoading || !planPrompt.trim()}
                  className="text-[10px] px-3 py-1 rounded font-semibold flex items-center gap-2 transition-colors"
                  style={{
                    background: planLoading || !planPrompt.trim() ? '#2d2d3a' : '#a78bfa',
                    color: '#ffffff',
                    cursor: planLoading || !planPrompt.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {planLoading ? 'Thinking...' : 'Send'}
                </button>
              </div>
            </div>
          </>
        )}

        {activeTab === 'translate' && (
          <>
            <div className="shrink-0 flex flex-col gap-1.5">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ask the AI to complete, explain, refactor, or generate code..."
                className="text-[10px] p-2 rounded resize-none outline-none w-full"
                style={{
                  background: '#252535',
                  color: '#d4d4d4',
                  fontFamily: 'Segoe UI, sans-serif',
                  minHeight: '50px',
                  maxHeight: '70px',
                  border: '1px solid #2d2d3a',
                }}
              />

              <div
                className="text-[10px] p-1.5 rounded overflow-y-auto shrink-0"
                style={{
                  background: '#252535',
                  color: '#6b7280',
                  fontFamily: 'Space Mono, monospace',
                  minHeight: '30px',
                  maxHeight: '50px',
                  whiteSpace: 'pre',
                  overflowX: 'hidden',
                  border: '1px solid #2d2d3a',
                }}
              >
                {selectedCode.trim() ? selectedCode.slice(0, 300) + (selectedCode.length > 300 ? '...' : '') : 'Select code in editor to translate'}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="text-[10px] px-2 py-1 rounded bg-[#252535] text-[#d4d4d4] flex-1"
                  style={{ fontFamily: 'Segoe UI, sans-serif', border: '1px solid #2d2d3a' }}
                >
                  {LANGUAGES.map((ln) => (
                    <option key={ln} value={ln} className="bg-[#252535]">
                      {ln}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={handleTranslate}
                  disabled={loading || (!prompt.trim() && !selectedCode.trim())}
                  className="text-[10px] px-3 py-1 rounded font-semibold flex items-center gap-2 transition-colors shrink-0"
                  style={{
                    background: loading || (!prompt.trim() && !selectedCode.trim()) ? '#2d2d3a' : '#a78bfa',
                    color: '#ffffff',
                    cursor: loading || (!prompt.trim() && !selectedCode.trim()) ? 'not-allowed' : 'pointer',
                  }}
                >
                  {loading ? (
                    'Thinking...'
                  ) : (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 3v2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M5 6h14" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M4 12h16" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M5 18h14" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Translate
                    </>
                  )}
                </button>
              </div>
            </div>

            {response.trim() && !loading && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleSaveTranslatedFile}
                  disabled={saving || !activeFilePath}
                  title={activeFilePath ? 'Save the translated code to a new file' : 'Open a file first'}
                  className="text-[10px] px-3 py-1 rounded font-semibold flex items-center gap-1.5 transition-colors shrink-0"
                  style={{
                    background: saving || !activeFilePath ? '#2d2d3a' : '#7c3aed',
                    color: '#ffffff',
                    cursor: saving || !activeFilePath ? 'not-allowed' : 'pointer',
                    fontFamily: 'Segoe UI, sans-serif',
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M5 4h11l3 3v13H5V4z" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M8 4v5h7" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {saving ? 'Saving...' : 'Save as file'}
                </button>
                {saveMessage && (
                  <span className="text-[9px] leading-3 truncate" style={{ color: '#6b7280', fontFamily: 'Segoe UI, sans-serif' }}>
                    {saveMessage}
                  </span>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto text-[10px] p-2 rounded bg-[#252535] text-[#d4d4d4] min-h-0" style={{ fontFamily: 'Segoe UI, sans-serif', border: '1px solid #2d2d3a' }}>
              {response ? renderResponseContent(response) : 'AI response will appear here...'}
            </div>
          </>
        )}

        {activeTab === 'explain' && (
          <>
            <textarea
              value={explainPrompt}
              onChange={(e) => setExplainPrompt(e.target.value)}
              placeholder="Ask a specific question about the code, or leave blank for a general explanation..."
              className="text-xs p-2 rounded resize-none outline-none"
              style={{
                background: '#252535',
                color: '#d4d4d4',
                fontFamily: 'Segoe UI, sans-serif',
                minHeight: '92px',
                border: '1px solid #2d2d3a',
              }}
            />

            <div
              className="text-xs p-2 rounded overflow-y-auto"
              style={{
                background: '#252535',
                color: '#6b7280',
                fontFamily: 'Space Mono, monospace',
                minHeight: '60px',
                maxHeight: '120px',
                whiteSpace: 'pre',
                overflowX: 'hidden',
                border: '1px solid #2d2d3a',
              }}
            >
              {selectedCode.trim() ? selectedCode.slice(0, 300) + (selectedCode.length > 300 ? '...' : '') : 'Select code in editor to explain'}
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleExplain}
                disabled={explainLoading || (!explainPrompt.trim() && !selectedCode.trim())}
                className="text-xs px-3 py-2 rounded font-semibold flex items-center gap-2"
                style={{
                  background: explainLoading || (!explainPrompt.trim() && !selectedCode.trim()) ? '#2d2d3a' : '#a78bfa',
                  color: '#ffffff',
                  cursor: explainLoading || (!explainPrompt.trim() && !selectedCode.trim()) ? 'not-allowed' : 'pointer',
                }}
              >
                {explainLoading ? 'Thinking...' : 'Explain'}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto text-xs p-2 rounded bg-[#252535] text-[#d4d4d4]" style={{ fontFamily: 'Segoe UI, sans-serif', border: '1px solid #2d2d3a' }}>
              {explainResponse ? renderResponseContent(explainResponse) : 'AI response will appear here...'}
            </div>
          </>
        )}
      </div>
    </div>
  );
}