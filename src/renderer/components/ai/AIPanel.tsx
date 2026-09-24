import { useEffect, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { loader } from '@monaco-editor/react';
import type { AIPanelState, ChatMessage, TabKey } from '../useAIPanelState';
import useModelSelector, { ModelOption } from '../../hooks/useModelSelector';
import { useTheme } from '../../theme/ThemeContext';
import type { ThemeUI } from '../../theme/themes';
import ThinkingIndicator from '../adaptive/ThinkingIndicator';

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

const LOADING_MESSAGES = [
  'Analyzing your code...',
  'Reading context...',
  'Considering options...',
  'Generating response...',
];

// C (theme.ui) is threaded through as a prop/param rather than called via
// useTheme() in here -- these are plain helper functions (renderResponseContent
// and renderChatThread are invoked directly, not rendered as JSX), and calling
// a hook from a conditionally-invoked plain function would break the rules of
// hooks. Same signature convention used throughout.
function LoadingIndicator({ C }: { C: ThemeUI }) {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((i) => (i + 1) % LOADING_MESSAGES.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-1.5 text-xs" style={{ color: C.textSecondary, fontFamily: 'Segoe UI, sans-serif' }}>
      <span
        className="inline-block w-2.5 h-2.5 rounded-full animate-spin shrink-0"
        style={{ border: `2px solid ${C.border}`, borderTopColor: C.accentAI }}
      />
      {LOADING_MESSAGES[messageIndex]}
    </div>
  );
}

// section.content is already fence-stripped by the regex in renderResponseContent
// (capture group 2 sits between the ```lang line and the closing ```), so this
// copies only the code itself — no markdown fence lines.
function CodeBlockCopyButton({ content, C }: { content: string; C: ThemeUI }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content.replace(/\n$/, ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard write failed (permissions, unsupported context) — no toast,
      // matches the low-visual-weight, non-intrusive intent of this control.
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied' : 'Copy code'}
      className="flex items-center justify-center p-1 rounded transition-colors hover:bg-[rgba(168,85,247,0.12)]"
      style={{ color: copied ? C.success : C.textMuted }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

function renderResponseContent(response: string, C: ThemeUI) {
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
            <div key={`${section.language}-${index}`} className="overflow-hidden rounded" style={{ border: `1px solid ${C.accentAI}`, background: C.bgCard }}>
              <div className="px-2 py-0.5 text-[9px] uppercase tracking-widest" style={{ borderBottom: `1px solid ${C.border}`, color: C.accentAI, fontFamily: 'Space Mono, monospace' }}>
                {section.language}
              </div>
              <pre className="m-0 overflow-x-auto p-2 text-[10px]" style={{ color: C.textPrimary, fontFamily: 'Space Mono, monospace', whiteSpace: 'pre' }}>
                <code>{section.content}</code>
              </pre>
              <div className="flex items-center justify-end px-1 py-0.5" style={{ borderTop: `1px solid ${C.border}` }}>
                <CodeBlockCopyButton content={section.content} C={C} />
              </div>
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

function renderChatThread(messages: ChatMessage[], C: ThemeUI, loading?: boolean) {
  return (
    <div className="flex flex-col gap-2">
      {messages.length ? (
        messages.map((message, index) => {
          const isUser = message.role === 'user';
          const isPendingAssistant = !isUser && loading && !message.content && index === messages.length - 1;

          if (isPendingAssistant) {
            return (
              <div key={`${message.role}-${index}`} className="flex justify-start">
                <ThinkingIndicator />
              </div>
            );
          }

          return (
            <div key={`${message.role}-${index}`} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div
                className="max-w-[85%] rounded border px-2 py-1.5 text-xs leading-4"
                style={{
                  background: isUser ? C.bgSelected : C.bgCard,
                  borderColor: isUser ? C.accentAI : C.border,
                  color: C.textPrimary,
                  fontFamily: 'Segoe UI, sans-serif',
                }}
              >
                {isUser ? message.content : renderResponseContent(message.content, C)}
              </div>
            </div>
          );
        })
      ) : (
        <div className="text-xs" style={{ color: C.textSecondary, fontFamily: 'Segoe UI, sans-serif' }}>
          Start a conversation to get help with code, reasoning, or planning.
        </div>
      )}
    </div>
  );
}

const CHAT_HISTORY_LIMIT = 6;

// The text shown in the chat bubble stays in `content`; `modelContent`, when
// set, is what the model saw for that turn (message + attached file/errors).
type StoredChatMessage = ChatMessage & { modelContent?: string };

// Error placeholders and empty replies are UI state, not model output. The
// question that produced one is dropped with it so no failed turn stays in history.
function buildChatHistory(messages: StoredChatMessage[]): ChatMessage[] {
  const kept: StoredChatMessage[] = [];
  messages.forEach((message) => {
    const failedReply =
      message.role === 'assistant' && (!message.content.trim() || message.content.startsWith('⚠️'));
    if (failedReply) {
      if (kept[kept.length - 1]?.role === 'user') kept.pop();
      return;
    }
    kept.push(message);
  });
  const recent = kept.slice(-CHAT_HISTORY_LIMIT);

  // Only the latest attachment is sent in full; older ones fall back to the
  // bubble text so the file appears in history at most once.
  let attachedIndex = -1;
  recent.forEach((message, index) => {
    if (message.role === 'user' && message.modelContent) attachedIndex = index;
  });
  return recent.map((message, index) => ({
    role: message.role,
    content: index === attachedIndex ? message.modelContent ?? message.content : message.content,
  }));
}

const ERROR_HELP_PATTERN = /\b(fix|error|bug|wrong|broken|not working|doesn['’]?t work|debug|issue)/i;

// Mirrors Editor.tsx's toModelPath() so the lookup hits the same Monaco model.
const toModelPath = (filePath: string) =>
  `file:///${filePath.replace(/\\/g, '/').replace(/^\/+/, '')}`;

// Returns the message to send the model with the open file and its error
// markers attached, or undefined when there is nothing worth attaching.
async function buildErrorContextMessage(message: string, filePath?: string): Promise<string | undefined> {
  if (!filePath || !ERROR_HELP_PATTERN.test(message)) return undefined;
  const monaco = await loader.init();
  const model = monaco.editor.getModel(monaco.Uri.parse(toModelPath(filePath)));
  if (!model) return undefined;
  const errors = monaco.editor
    .getModelMarkers({ resource: model.uri })
    .filter((marker) => marker.severity === monaco.MarkerSeverity.Error)
    .sort((a, b) => a.startLineNumber - b.startLineNumber);
  if (errors.length === 0) return undefined;

  const filename = filePath.split(/[\\/]/).pop();
  const languageId = model.getLanguageId();
  return [
    message,
    '',
    `File: ${filename} (${languageId})`,
    `\`\`\`${languageId}`,
    model.getValue(),
    '```',
    'Compiler errors:',
    ...errors.map((marker) => `Line ${marker.startLineNumber}: ${marker.message}`),
    '',
    'Rewrite the code so every error above is fixed. Change the lines the errors point to. Do not return the code unchanged. Return the full corrected file.',
  ].join('\n');
}

function getCompletionErrorText(error?: string) {
  if (typeof error === 'string' && error.trim() && error.trim() !== 'undefined') {
    return `⚠️ ${error.trim()}`;
  }

  return '⚠️ AI request failed';
}

export default function AIPanel({ selectedCode, activeFilePath, onSaveTranslatedFile, panelState }: AIPanelProps) {
  const { theme } = useTheme();
  const C = theme.ui;
  const [pulseTab, setPulseTab] = useState<TabKey | null>(null);
  const pulseTimeoutRef = useRef<number | null>(null);

  const {
    activeKey: modelKey,
    modelName,
    models,
    switching: modelSwitching,
    error: modelError,
    selectModel,
  } = useModelSelector();

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
      complete: (payload: {
        systemPrompt: string;
        history: ChatMessage[];
        userMessage: string;
      }) => Promise<{ success: boolean; result?: string; error?: string }>;
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
    modelMessage?: string,
  ) => {
    const trimmedPrompt = userPrompt.trim();
    if (!trimmedPrompt) return;

    setLoadingState(true);
    setPromptState('');
    const userEntry: StoredChatMessage = { role: 'user', content: trimmedPrompt, modelContent: modelMessage };
    setMessages((prev) => [...prev, userEntry, { role: 'assistant', content: '' }]);

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
      const completion = await appWindowWithAI.ai?.complete({
        systemPrompt,
        history: buildChatHistory(messages),
        userMessage: modelMessage ?? trimmedPrompt,
      });

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
    const modelMessage = await buildErrorContextMessage(askPrompt.trim(), activeFilePath);
    await sendChatMessage(
      askPrompt,
      askMessages,
      setAskMessages,
      setAskLoading,
      setAskPrompt,
      'You are the coding assistant inside Fabrica IDE, helping beginner CS students. When asked to write code, return ONE complete, runnable program in exactly the language and framework the user names, with all imports and the entry point. For Flutter, always include main() with runApp and a MaterialApp at the root, and use Navigator for moving between pages. Never switch frameworks, for example Material to Cupertino, unless the user asks. If the user says fix the error or similar without details, review the code you wrote earlier in this conversation, find the bugs yourself, and return the full corrected program. Keep explanations short and after the code. If asked what model you are, say you are Fabrica\'s offline coding assistant running a local open source model on this computer, not GPT or any online service.',
      modelMessage,
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

  const handleTabClick = (tab: TabKey) => {
    setActiveTab(tab);
    setPulseTab(tab);
    if (pulseTimeoutRef.current) window.clearTimeout(pulseTimeoutRef.current);
    pulseTimeoutRef.current = window.setTimeout(() => setPulseTab(null), 200);
  };

  useEffect(() => {
    return () => {
      if (pulseTimeoutRef.current) window.clearTimeout(pulseTimeoutRef.current);
    };
  }, []);

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
    <div className="flex flex-col h-full border-l overflow-hidden" style={{ background: C.bgPreviewAI, borderColor: C.border }}>
      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: 4,
        padding: '4px 8px',
        background: '#12102D',
        borderBottom: '1px solid #29204A',
      }}>
        {(['ask', 'plan', 'translate', 'explain'] as TabKey[]).map((tab) => {
          const isActive = activeTab === tab;
          const isPulsing = pulseTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => handleTabClick(tab)}
              style={{
                position: 'relative',
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 500,
                fontFamily: 'Segoe UI, sans-serif',
                border: 'none',
                borderRadius: 6,
                background: isActive ? '#3B1D72' : 'transparent',
                color: isActive ? '#F4F1FF' : '#A9A3C7',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: isActive ? '0 0 12px rgba(168, 85, 247, 0.35)' : 'none',
                transform: isPulsing ? 'scale(1.04)' : 'scale(1)',
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = 'rgba(168, 85, 247, 0.1)';
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = 'transparent';
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {isActive && (
                <span style={{
                  position: 'absolute',
                  bottom: -6,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 20,
                  height: 2,
                  borderRadius: 1,
                  background: '#A855F7',
                }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Model selector — applies to all tabs, one model backs every mode */}
      <div
        className="flex items-center justify-between gap-2 px-3 py-1.5 shrink-0"
        style={{ borderBottom: `1px solid ${C.border}` }}
      >
        <span
          className="text-[9px] uppercase tracking-widest"
          style={{ color: C.textSecondary, fontFamily: 'Segoe UI, sans-serif' }}
        >
          Model
        </span>
        {modelSwitching ? (
          <span className="text-[10px] flex items-center gap-1.5" style={{ color: C.textSecondary, fontFamily: 'Segoe UI, sans-serif' }}>
            Switching…
            <span
              className="inline-block w-2.5 h-2.5 rounded-full animate-spin"
              style={{ border: `2px solid ${C.border}`, borderTopColor: C.accentAI }}
            />
          </span>
        ) : (
          <select
            value={modelKey ?? ''}
            onChange={(e) => selectModel(e.target.value as ModelOption['key'])}
            disabled={models.length === 0}
            className="text-[10px] px-2 py-0.5 rounded max-w-[150px]"
            style={{ background: C.bgInput, color: C.textPrimary, fontFamily: 'Segoe UI, sans-serif', border: `1px solid ${C.border}` }}
          >
            {models.length === 0 && <option value="">{modelName}</option>}
            {models.map((m) => (
              <option key={m.key} value={m.key} style={{ background: C.bgInput }}>
                {m.displayName}
              </option>
            ))}
          </select>
        )}
      </div>
      {modelError && (
        <div className="px-3 pt-1 text-[9px] shrink-0" style={{ color: '#f87171', fontFamily: 'Segoe UI, sans-serif' }}>
          {modelError}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex flex-col gap-1.5 px-3 py-2 overflow-hidden min-h-0">
        {activeTab === 'ask' && (
          <>
            <div className="flex-1 overflow-y-auto rounded p-2 min-h-0" style={{ background: C.bgCard, border: `1px solid ${C.border}` }}>
              {renderChatThread(askMessages, C, askLoading)}
            </div>

            <div className="shrink-0 flex flex-col gap-1.5">
              <textarea
                value={askPrompt}
                onChange={(e) => setAskPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!askLoading && askPrompt.trim()) {
                      handleAskSend();
                    }
                  }
                }}
                placeholder="Ask for help with code, concepts, debugging, or explanation..."
                className="text-[10px] p-2 rounded resize-none outline-none w-full"
                style={{
                  background: C.bgInput,
                  color: C.textPrimary,
                  fontFamily: 'Segoe UI, sans-serif',
                  minHeight: '50px',
                  maxHeight: '70px',
                  border: `1px solid ${C.border}`,
                }}
              />
              <div style={{ fontSize: 10, color: '#77718F', fontFamily: 'Segoe UI, sans-serif' }}>
                Enter to send · Shift+Enter for new line
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleAskSend}
                  disabled={askLoading || !askPrompt.trim()}
                  className="text-[10px] px-3 py-1 rounded font-semibold flex items-center gap-2 transition-colors"
                  style={{
                    background: askLoading || !askPrompt.trim() ? C.bgInput : C.accentAI,
                    color: '#ffffff',
                    cursor: askLoading || !askPrompt.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  Send
                </button>
              </div>
            </div>
          </>
        )}

        {activeTab === 'plan' && (
          <>
            <div className="shrink-0 rounded px-3 py-1 text-[10px]" style={{ border: `1px solid ${C.border}`, background: C.bgCard, color: C.textSecondary, fontFamily: 'Segoe UI, sans-serif' }}>
              Plan mode — outlines steps only, does not make changes.
            </div>

            <div className="flex-1 overflow-y-auto rounded p-2 min-h-0" style={{ background: C.bgCard, border: `1px solid ${C.border}` }}>
              {renderChatThread(planMessages, C, planLoading)}
            </div>

            <div className="shrink-0 flex flex-col gap-1.5">
              <textarea
                value={planPrompt}
                onChange={(e) => setPlanPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!planLoading && planPrompt.trim()) {
                      handlePlanSend();
                    }
                  }
                }}
                placeholder="Describe what you want to plan..."
                className="text-[10px] p-2 rounded resize-none outline-none w-full"
                style={{
                  background: C.bgInput,
                  color: C.textPrimary,
                  fontFamily: 'Segoe UI, sans-serif',
                  minHeight: '50px',
                  maxHeight: '70px',
                  border: `1px solid ${C.border}`,
                }}
              />
              <div style={{ fontSize: 10, color: '#77718F', fontFamily: 'Segoe UI, sans-serif' }}>
                Enter to send · Shift+Enter for new line
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handlePlanSend}
                  disabled={planLoading || !planPrompt.trim()}
                  className="text-[10px] px-3 py-1 rounded font-semibold flex items-center gap-2 transition-colors"
                  style={{
                    background: planLoading || !planPrompt.trim() ? C.bgInput : C.accentAI,
                    color: '#ffffff',
                    cursor: planLoading || !planPrompt.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  Send
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
                  background: C.bgInput,
                  color: C.textPrimary,
                  fontFamily: 'Segoe UI, sans-serif',
                  minHeight: '50px',
                  maxHeight: '70px',
                  border: `1px solid ${C.border}`,
                }}
              />

              <div
                className="text-[10px] p-1.5 rounded overflow-y-auto shrink-0"
                style={{
                  background: C.bgInput,
                  color: C.textSecondary,
                  fontFamily: 'Space Mono, monospace',
                  minHeight: '30px',
                  maxHeight: '50px',
                  whiteSpace: 'pre',
                  overflowX: 'hidden',
                  border: `1px solid ${C.border}`,
                }}
              >
                {selectedCode.trim() ? selectedCode.slice(0, 300) + (selectedCode.length > 300 ? '...' : '') : 'Select code in editor to translate'}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="text-[10px] px-2 py-1 rounded flex-1"
                  style={{ background: C.bgInput, color: C.textPrimary, fontFamily: 'Segoe UI, sans-serif', border: `1px solid ${C.border}` }}
                >
                  {LANGUAGES.map((ln) => (
                    <option key={ln} value={ln} style={{ background: C.bgInput }}>
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
                    background: loading || (!prompt.trim() && !selectedCode.trim()) ? C.bgInput : C.accentAI,
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
                    background: saving || !activeFilePath ? C.bgInput : C.accentAI,
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
                  <span className="text-[9px] leading-3 truncate" style={{ color: C.textSecondary, fontFamily: 'Segoe UI, sans-serif' }}>
                    {saveMessage}
                  </span>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto text-[10px] p-2 rounded min-h-0" style={{ background: C.bgInput, color: C.textPrimary, fontFamily: 'Segoe UI, sans-serif', border: `1px solid ${C.border}` }}>
              {response ? renderResponseContent(response, C) : loading ? <LoadingIndicator C={C} /> : 'AI response will appear here...'}
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
                background: C.bgInput,
                color: C.textPrimary,
                fontFamily: 'Segoe UI, sans-serif',
                minHeight: '92px',
                border: `1px solid ${C.border}`,
              }}
            />

            <div
              className="text-xs p-2 rounded overflow-y-auto"
              style={{
                background: C.bgInput,
                color: C.textSecondary,
                fontFamily: 'Space Mono, monospace',
                minHeight: '60px',
                maxHeight: '120px',
                whiteSpace: 'pre',
                overflowX: 'hidden',
                border: `1px solid ${C.border}`,
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
                  background: explainLoading || (!explainPrompt.trim() && !selectedCode.trim()) ? C.bgInput : C.accentAI,
                  color: '#ffffff',
                  cursor: explainLoading || (!explainPrompt.trim() && !selectedCode.trim()) ? 'not-allowed' : 'pointer',
                }}
              >
                {explainLoading ? 'Thinking...' : 'Explain'}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto text-xs p-2 rounded" style={{ background: C.bgInput, color: C.textPrimary, fontFamily: 'Segoe UI, sans-serif', border: `1px solid ${C.border}` }}>
              {explainResponse ? renderResponseContent(explainResponse, C) : explainLoading ? <LoadingIndicator C={C} /> : 'AI response will appear here...'}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
