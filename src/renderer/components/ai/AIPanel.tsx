import { useState } from 'react';

interface AIPanelProps {
  selectedCode: string;
}

const LANGUAGES = [
  'JavaScript',
  'Dart',
  'C#',
  'PHP',
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
    return <div>{response}</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      {sections.map((section, index) => {
        if (section.type === 'code') {
          return (
            <div key={`${section.language}-${index}`} className="overflow-hidden rounded border border-[#7c3aed] bg-[#12081f]">
              <div className="border-b border-[#2d1b4e] px-3 py-1 text-[10px] uppercase tracking-widest text-[#a855f7]" style={{ fontFamily: 'Space Mono, monospace' }}>
                {section.language}
              </div>
              <pre className="m-0 overflow-x-auto p-3 text-xs text-[#f8fafc]" style={{ fontFamily: 'Space Mono, monospace', whiteSpace: 'pre' }}>
                <code>{section.content}</code>
              </pre>
            </div>
          );
        }

        return (
          <p key={index} className="m-0 whitespace-pre-wrap leading-5">
            {section.content}
          </p>
        );
      })}
    </div>
  );
}

export default function AIPanel({ selectedCode }: AIPanelProps) {
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState('JavaScript');

  const handleTranslate = async () => {
    if (!selectedCode.trim()) return;
    setLoading(true);
    setResponse('');
    const prompt = [
  'AutoComplete the Code base on what is highlighted',
  'based example if the hint is login form auto complete a whole login form ',
  '',
  selectedCode,
].join('\n');

    const removeListener = window.electron.ipcRenderer.on(
      'ai:token',
      (token: unknown) => {
        setResponse((prev) => prev + String(token));
      }
    );

    await window.ai.complete(prompt);

    if (removeListener) removeListener();
    setLoading(false);
  };

  return (
    <div className="flex flex-col h-full bg-[#1a0a2e] border-l border-[#2d1b4e]">
      <div className="px-3 py-2 text-xs font-bold tracking-widest text-[#a855f7]" style={{ fontFamily: 'Space Mono, monospace', borderBottom: '1px solid #2d1b4e' }}>
        AI ASSISTANT
      </div>

      <div className="px-3 py-2 flex flex-col gap-2 flex-1 overflow-hidden">
        <div
          className="text-xs p-2 rounded overflow-y-auto"
          style={{
            background: '#2d1b4e',
            color: '#a7adc5',
            fontFamily: 'Space Mono, monospace',
            minHeight: '60px',
            maxHeight: '120px',
            whiteSpace: 'pre',
            overflowX: 'hidden',
          }}
        >
          {selectedCode.trim() ? selectedCode.slice(0, 300) + (selectedCode.length > 300 ? '...' : '') : 'Select code in editor to translate'}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="text-xs px-2 py-1 rounded bg-[#2d1b4e] text-[#ffffff]"
            style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}
          >
            {LANGUAGES.map((ln) => (
              <option key={ln} value={ln} className="bg-[#2d1b4e]">
                {ln}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleTranslate}
            disabled={loading || !selectedCode.trim()}
            className="text-xs px-3 py-2 rounded font-semibold flex items-center gap-2"
            style={{
              background: loading || !selectedCode.trim() ? '#2d1b4e' : '#a855f7',
              color: '#ffffff',
              cursor: loading || !selectedCode.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? (
              'Thinking...'
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
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

        <div className="flex-1 overflow-y-auto text-xs p-2 rounded bg-[#2d1b4e] text-[#ffffff]" style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}>
          {response ? renderResponseContent(response) : 'AI response will appear here...'}
        </div>
      </div>
    </div>
  );
}