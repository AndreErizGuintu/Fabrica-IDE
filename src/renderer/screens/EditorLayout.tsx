import { useEffect, useRef, useState } from 'react';

import icon from '../../../assets/icon.svg';
import Editor from '../components/editor/Editor';
import Preview from '../components/preview/Preview';
import Sidebar from '../components/sidebar/Sidebar';
import AIPanel from '../components/ai/AIPanel';
import { Tab } from '../types/index';

function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'html':
      return 'html';
    case 'css':
      return 'css';
    case 'js':
      return 'javascript';
    case 'ts':
      return 'typescript';
    case 'tsx':
      return 'typescript';
    case 'jsx':
      return 'javascript';
    case 'py':
      return 'python';
    case 'json':
      return 'json';
    case 'php':
      return 'php';
    case 'cs':
      return 'csharp';
    case 'java':
      return 'java';
    case 'dart':
      return 'dart';
    default:
      return 'plaintext';
  }
}

export default function EditorLayout({ onBack, initialFolder }: { onBack: () => void; initialFolder?: string }) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [selectedCode, setSelectedCode] = useState('');
  const [showAI, setShowAI] = useState(false);
  const [showGit, setShowGit] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [gitStatusFiles, setGitStatusFiles] = useState<string[]>([]);
  const [gitLog, setGitLog] = useState<string[]>([]);
  const [gitChangesOpen, setGitChangesOpen] = useState(true);
  const [gitHistoryOpen, setGitHistoryOpen] = useState(true);
  const [gitLoading, setGitLoading] = useState(false);
  const [outputLines, setOutputLines] = useState<{ text: string; type: 'stdout' | 'stderr' | 'info' | 'error' }[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const outputEndRef = useRef<HTMLDivElement>(null);

  const activeTab = tabs[activeTabIndex] ?? null;
  const isHtmlFile = activeTab
    ? activeTab.filename.endsWith('.html') || activeTab.filename.endsWith('.css')
    : false;
  const previewHtml = activeTab?.filename.endsWith('.css')
    ? `<!DOCTYPE html><html><head><style>${activeTab.content}</style></head><body><div style="padding:20px"><h1>CSS Preview</h1><p>Your styles are applied to this page.</p><button>Button</button></div></body></html>`
    : activeTab?.content ?? '';

  const openFileInTab = (filePath: string, filename: string, content: string) => {
    const existing = tabs.findIndex((tab) => tab.path === filePath);
    if (existing !== -1) {
      setActiveTabIndex(existing);
      return;
    }
    const newTab: Tab = { filename, path: filePath, content, isDirty: false };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabIndex(tabs.length);
  };

  const handleFileOpen = async (filePath: string, filename: string) => {
    const result = await window.fileSystem.readFile(filePath);
    if (result.success && result.content !== undefined) {
      openFileInTab(filePath, filename, result.content);
    }
  };

  const handleEditorChange = (value: string | undefined) => {
    if (!activeTab) return;
    setTabs((prev) =>
      prev.map((tab, index) =>
        index === activeTabIndex
          ? { ...tab, content: value ?? '', isDirty: true }
          : tab,
      ),
    );
  };

  const handleSave = async () => {
    if (!activeTab || !activeTab.path) return;
    const result = await window.fileSystem.writeFile(activeTab.path, activeTab.content);
    if (result.success) {
      setTabs((prev) =>
        prev.map((tab, index) =>
          index === activeTabIndex ? { ...tab, isDirty: false } : tab,
        ),
      );
    }
  };

  const handleRun = async () => {
    if (!activeTab?.path) {
      setOutputLines([{ text: 'No file saved. Save the file before running.', type: 'error' }]);
      setShowOutput(true);
      return;
    }

    const ext = activeTab.filename.split('.').pop()?.toLowerCase();
    const runtimeMap: Record<string, string> = {
      js: 'node', ts: 'node',
      php: 'php',
      cs: 'dotnet',
      dart: 'dart',
    };
    const runtime = ext ? runtimeMap[ext] : undefined;

    if (!runtime) {
      setOutputLines([{ text: `Cannot run .${ext ?? '?'} files directly.`, type: 'error' }]);
      setShowOutput(true);
      return;
    }

    const sdkCheck = await window.runner.checkSDK(runtime);
    if (!sdkCheck.available) {
      setOutputLines([{
        text: `Runtime not found: ${runtime}\nInstall it and make sure it's on your PATH.\n${sdkCheck.error ?? ''}`,
        type: 'error',
      }]);
      setShowOutput(true);
      return;
    }

    setOutputLines([{ text: `▶ Running ${activeTab.filename} (${sdkCheck.version ?? runtime})...\n`, type: 'info' }]);
    setShowOutput(true);
    setIsRunning(true);

    const removeStdout = window.runner.onStdout((data) => {
      setOutputLines((prev) => [...prev, { text: data, type: 'stdout' }]);
    });
    const removeStderr = window.runner.onStderr((data) => {
      setOutputLines((prev) => [...prev, { text: data, type: 'stderr' }]);
    });
    window.runner.onDone((code) => {
      setOutputLines((prev) => [
        ...prev,
        { text: `\n● Process exited with code ${code}`, type: code === 0 ? 'info' : 'error' },
      ]);
      setIsRunning(false);
      removeStdout();
      removeStderr();
    });

    await window.runner.runFile(activeTab.path);
  };

  const runGitCommand = async (
    label: string,
    fn: () => Promise<{ success: boolean; output: string; error?: string }>,
  ) => {
    if (!initialFolder) {
      setOutputLines([{ text: 'No folder open. Open a folder first.', type: 'error' }]);
      setShowOutput(true);
      return;
    }

    setGitLoading(true);
    setOutputLines([{ text: `⎇ git ${label}...\n`, type: 'info' }]);
    setShowOutput(true);

    try {
      const result = await fn();
      setOutputLines((prev) => [
        ...prev,
        { text: result.output || result.error || '(no output)', type: result.success ? 'stdout' : 'stderr' },
        { text: result.success ? `\n✓ Done` : `\n✗ Failed`, type: result.success ? 'info' : 'error' },
      ]);
    } finally {
      setGitLoading(false);
    }
  };

  const refreshGitStatus = async () => {
    if (!initialFolder) return;
    const [statusResult, logResult] = await Promise.all([
      window.git.statusFiles(initialFolder),
      window.git.log(initialFolder),
    ]);
    if (statusResult.success) {
      setGitStatusFiles(
        statusResult.output
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean),
      );
    } else {
      setGitStatusFiles([]);
    }
    if (logResult.success) {
      setGitLog(
        logResult.output
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean),
      );
    } else {
      setGitLog([]);
    }
  };

  const handleOpenFileDialog = async () => {
    const filePath = await window.fileSystem.openFile();
    if (!filePath) return;
    const result = await window.fileSystem.readFile(filePath);
    if (result.success && result.content !== undefined) {
      const filename = filePath.split('\\').pop() ?? filePath;
      openFileInTab(filePath, filename, result.content);
    }
  };

  const handleCloseTab = (index: number) => {
    const newTabs = tabs.filter((_, tabIndex) => tabIndex !== index);
    setTabs(newTabs);
    if (newTabs.length === 0) {
      setActiveTabIndex(0);
    } else {
      setActiveTabIndex(Math.min(activeTabIndex, newTabs.length - 1));
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        if (activeTab) handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab]);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [outputLines]);

  useEffect(() => {
    if (showGit) {
      void refreshGitStatus();
    }
  }, [showGit, initialFolder]);

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{ backgroundColor: '#1a0a2e', color: '#ffffff' }}
    >
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{ backgroundColor: '#2d1b4e' }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="text-sm px-2 py-1 rounded-lg"
            style={{ background: '#1a0a2e', color: '#a855f7', border: '1px solid #a855f7' }}
            aria-label="Back to menu"
          >
            ← Menu
          </button>
          <img src={icon} alt="Fabrica" className="w-6 h-6" />
          <span
            className="text-sm font-semibold text-white"
            style={{ fontFamily: 'Space Mono, monospace' }}
          >
            {activeTab?.filename ?? 'No file open'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleOpenFileDialog}
            className="text-sm px-3 py-1 rounded-lg"
            style={{ background: '#2d1b4e', color: '#ffffff', border: '1px solid #a855f7' }}
          >
            Open File
          </button>
          {activeTab?.isDirty && (
            <button
              type="button"
              onClick={handleSave}
              className="text-sm px-3 py-1 rounded-lg"
              style={{ background: '#2d1b4e', color: '#ffffff', border: '1px solid #a855f7' }}
            >
              Save
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowAI((prev) => !prev)}
            className="text-sm px-3 py-1 rounded-lg"
            style={{
              background: showAI ? '#a855f7' : '#2d1b4e',
              color: '#ffffff',
              border: '1px solid #a855f7',
            }}
          >
            ✨ AI
          </button>
          <button
            type="button"
            onClick={() => setShowGit((prev) => !prev)}
            className="text-sm px-3 py-1 rounded-lg"
            style={{
              background: showGit ? '#a855f7' : '#2d1b4e',
              color: '#ffffff',
              border: '1px solid #a855f7',
            }}
          >
            ⎇ Git
          </button>
          <button
            type="button"
            onClick={handleRun}
            disabled={isRunning || !activeTab}
            className="px-4 py-1.5 rounded-full text-sm font-semibold text-white"
            style={{
              background: isRunning ? '#4b5563' : '#22c55e',
              cursor: isRunning || !activeTab ? 'not-allowed' : 'pointer',
              opacity: !activeTab ? 0.5 : 1,
            }}
          >
            {isRunning ? '⏳ Running…' : '▶ Run'}
          </button>
          <button
            type="button"
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ backgroundColor: '#1a0a2e', color: '#ffffff' }}
            aria-label="Settings"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4">
              <path
                d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm8.5 3.5-.98-.38a7.4 7.4 0 0 0-.66-1.6l.58-.9a1 1 0 0 0-.15-1.24l-1.64-1.64a1 1 0 0 0-1.24-.15l-.9.58a7.4 7.4 0 0 0-1.6-.66L12.5 3.5a1 1 0 0 0-1 0l-1 .39a7.4 7.4 0 0 0-1.6.66l-.9-.58a1 1 0 0 0-1.24.15L4.12 5.76a1 1 0 0 0-.15 1.24l.58.9a7.4 7.4 0 0 0-.66 1.6l-.98.38a1 1 0 0 0-.61.92v2.28a1 1 0 0 0 .61.92l.98.38a7.4 7.4 0 0 0 .66 1.6l-.58.9a1 1 0 0 0 .15 1.24l1.64 1.64a1 1 0 0 0 1.24.15l.9-.58a7.4 7.4 0 0 0 1.6.66l1 .39a1 1 0 0 0 1 0l1-.39a7.4 7.4 0 0 0 1.6-.66l.9.58a1 1 0 0 0 1.24-.15l1.64-1.64a1 1 0 0 0 .15-1.24l-.58-.9a7.4 7.4 0 0 0 .66-1.6l.98-.38a1 1 0 0 0 .61-.92v-2.28a1 1 0 0 0-.61-.92z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
      </div>
      <div
        className="flex overflow-x-auto"
        style={{ background: '#1a0a2e', borderBottom: '1px solid #2d1b4e' }}
      >
        {tabs.map((tab, index) => (
          <div
            key={index}
            className="flex items-center gap-2 px-4 py-2 cursor-pointer text-sm shrink-0"
            style={{
              background: index === activeTabIndex ? '#2d1b4e' : 'transparent',
              color: index === activeTabIndex ? '#ffffff' : '#a7adc5',
              borderBottom:
                index === activeTabIndex ? '2px solid #a855f7' : '2px solid transparent',
              fontFamily: 'Space Mono, monospace',
            }}
            onClick={() => setActiveTabIndex(index)}
          >
            {tab.filename}
            {tab.isDirty && <span style={{ color: '#a855f7' }}>●</span>}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleCloseTab(index);
              }}
              className="ml-1 opacity-50 hover:opacity-100 text-xs"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="flex flex-1 overflow-hidden min-h-0">
          <Sidebar onFileOpen={handleFileOpen} initialFolder={initialFolder} activeFilePath={activeTab?.path} />
          {tabs.length === 0 ? (
            <div
              className="flex-1 flex flex-col items-center justify-center gap-4"
              style={{ background: '#1a0a2e' }}
            >
              <div className="text-6xl">📂</div>
              <div className="text-center" style={{ fontFamily: 'Space Mono, monospace' }}>
                <div className="text-white font-bold mb-2">No file open</div>
                <div className="text-gray-500 text-sm">
                  Open a folder from the sidebar
                  <br />
                  or click Open File to get started
                </div>
              </div>
            </div>
          ) : (
            <>
                <Editor
                  language={getLanguage(tabs[activeTabIndex].filename)}
                  filename={activeTab!.filename}
                  value={activeTab!.content}
                  onChange={handleEditorChange}
                  onSelectionChange={(s) => setSelectedCode(s)}
                />
                <Preview html={previewHtml} isHtmlFile={isHtmlFile} />
                {showAI && (
                  <div className="w-80 shrink-0 h-full min-h-0 overflow-hidden">
                    <AIPanel selectedCode={selectedCode} />
                  </div>
                )}
                {showGit && (
                  <div
                    className="flex flex-col shrink-0 overflow-y-auto"
                    style={{
                      width: '240px',
                      background: '#1a0a2e',
                      borderLeft: '1px solid #2d1b4e',
                    }}
                  >
                    {/* Panel header */}
                    <div
                      className="px-3 py-2 text-xs font-bold tracking-widest shrink-0 flex items-center justify-between"
                      style={{
                        color: '#a7adc5',
                        fontFamily: 'Space Mono, monospace',
                        borderBottom: '1px solid #2d1b4e',
                        textTransform: 'uppercase',
                      }}
                    >
                      <span>Source Control</span>
                      <button
                        type="button"
                        onClick={() => void refreshGitStatus()}
                        style={{ color: '#6b7280', fontSize: '11px' }}
                        title="Refresh"
                      >
                        ↻
                      </button>
                    </div>

                    {/* Commit message input */}
                    <div className="px-3 pt-3 pb-2 shrink-0 flex flex-col gap-2">
                      <input
                        type="text"
                        placeholder="Message (Ctrl+Enter to commit)"
                        value={commitMessage}
                        onChange={(e) => setCommitMessage(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.ctrlKey) {
                            runGitCommand('commit', () =>
                              window.git.commit(initialFolder!, commitMessage)
                            );
                            setCommitMessage('');
                            setTimeout(() => void refreshGitStatus(), 800);
                          }
                        }}
                        className="text-xs px-2 py-1.5 rounded w-full"
                        style={{
                          background: '#2d1b4e',
                          color: '#ffffff',
                          border: '1px solid #3d2b5e',
                          fontFamily: 'Space Mono, monospace',
                          outline: 'none',
                        }}
                      />
                      <button
                        type="button"
                        disabled={gitLoading || !commitMessage.trim()}
                        onClick={() => {
                          runGitCommand('commit', () =>
                            window.git.commit(initialFolder!, commitMessage)
                          );
                          setCommitMessage('');
                          setTimeout(() => void refreshGitStatus(), 800);
                        }}
                        className="text-xs py-1.5 rounded font-semibold flex items-center justify-center gap-1"
                        style={{
                          background: gitLoading || !commitMessage.trim() ? '#2d1b4e' : '#a855f7',
                          color: '#ffffff',
                          cursor: gitLoading || !commitMessage.trim() ? 'not-allowed' : 'pointer',
                          border: 'none',
                        }}
                      >
                        ✓ Commit
                      </button>

                      {/* Quick actions row */}
                      <div className="flex gap-1">
                        {[
                          { label: 'init', fn: () => window.git.init(initialFolder!) },
                          { label: 'add .', fn: () => window.git.add(initialFolder!) },
                          { label: 'push', fn: () => window.git.push(initialFolder!) },
                          { label: 'pull', fn: () => window.git.pull(initialFolder!) },
                        ].map(({ label, fn }) => (
                          <button
                            key={label}
                            type="button"
                            disabled={gitLoading}
                            onClick={() => {
                              runGitCommand(label, fn);
                              setTimeout(() => void refreshGitStatus(), 600);
                            }}
                            className="flex-1 text-xs py-1 rounded"
                            style={{
                              background: '#2d1b4e',
                              color: '#a7adc5',
                              border: '1px solid #3d2b5e',
                              opacity: gitLoading ? 0.5 : 1,
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* CHANGES section */}
                    <div className="shrink-0">
                      <button
                        type="button"
                        onClick={() => setGitChangesOpen((p) => !p)}
                        className="w-full flex items-center gap-1 px-3 py-1 text-xs font-bold"
                        style={{
                          color: '#a7adc5',
                          fontFamily: 'Space Mono, monospace',
                          background: '#1a0a2e',
                          borderTop: '1px solid #2d1b4e',
                          borderBottom: gitChangesOpen ? '1px solid #2d1b4e' : 'none',
                        }}
                      >
                        <span style={{ fontSize: '9px' }}>{gitChangesOpen ? '▼' : '▶'}</span>
                        CHANGES
                        {gitStatusFiles.length > 0 && (
                          <span
                            className="ml-auto text-xs px-1.5 py-0.5 rounded-full"
                            style={{ background: '#a855f7', color: '#fff', fontSize: '10px' }}
                          >
                            {gitStatusFiles.length}
                          </span>
                        )}
                      </button>

                      {gitChangesOpen && (
                        <div className="overflow-y-auto" style={{ maxHeight: '160px' }}>
                          {gitStatusFiles.length === 0 ? (
                            <div
                              className="px-4 py-2 text-xs"
                              style={{ color: '#4b5563', fontFamily: 'Space Mono, monospace' }}
                            >
                              {initialFolder ? 'No changes — run git status' : 'No folder open'}
                            </div>
                          ) : (
                            gitStatusFiles.map((line, i) => {
                              const statusCode = line.slice(0, 2).trim();
                              const filename = line.slice(3);
                              const color =
                                statusCode === 'M' || statusCode === 'MM'
                                  ? '#fbbf24'
                                  : statusCode === '??' || statusCode === 'A'
                                  ? '#86efac'
                                  : statusCode === 'D'
                                  ? '#f87171'
                                  : '#a7adc5';
                              return (
                                <div
                                  key={i}
                                  className="flex items-center gap-2 px-4 py-0.5 text-xs truncate"
                                  style={{ fontFamily: 'Space Mono, monospace', color }}
                                >
                                  <span style={{ flexShrink: 0, fontSize: '10px' }}>{statusCode || '?'}</span>
                                  <span className="truncate">{filename}</span>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>

                    {/* HISTORY section */}
                    <div className="shrink-0">
                      <button
                        type="button"
                        onClick={() => setGitHistoryOpen((p) => !p)}
                        className="w-full flex items-center gap-1 px-3 py-1 text-xs font-bold"
                        style={{
                          color: '#a7adc5',
                          fontFamily: 'Space Mono, monospace',
                          background: '#1a0a2e',
                          borderTop: '1px solid #2d1b4e',
                          borderBottom: gitHistoryOpen ? '1px solid #2d1b4e' : 'none',
                        }}
                      >
                        <span style={{ fontSize: '9px' }}>{gitHistoryOpen ? '▼' : '▶'}</span>
                        HISTORY
                      </button>

                      {gitHistoryOpen && (
                        <div className="overflow-y-auto" style={{ maxHeight: '180px' }}>
                          {gitLog.length === 0 ? (
                            <div
                              className="px-4 py-2 text-xs"
                              style={{ color: '#4b5563', fontFamily: 'Space Mono, monospace' }}
                            >
                              No commits yet
                            </div>
                          ) : (
                            gitLog.map((line, i) => {
                              const sha = line.slice(0, 7);
                              const message = line.slice(8);
                              return (
                                <div
                                  key={i}
                                  className="flex items-start gap-2 px-4 py-1 text-xs"
                                  style={{ fontFamily: 'Space Mono, monospace' }}
                                >
                                  <span
                                    className="shrink-0 px-1 rounded"
                                    style={{ background: '#2d1b4e', color: '#a855f7', fontSize: '10px' }}
                                  >
                                    {sha}
                                  </span>
                                  <span className="truncate" style={{ color: '#a7adc5' }}>
                                    {message}
                                  </span>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
            </>
          )}
        </div>

        {showOutput && (
          <div
            className="flex flex-col shrink-0"
            style={{
              height: '220px',
              background: '#0d0d1a',
              borderTop: '1px solid #2d1b4e',
            }}
          >
            <div
              className="flex items-center justify-between px-4 py-1.5 shrink-0"
              style={{ background: '#1a0a2e', borderBottom: '1px solid #2d1b4e' }}
            >
              <span
                className="text-xs font-semibold"
                style={{ color: '#a855f7', fontFamily: 'Space Mono, monospace' }}
              >
                OUTPUT
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setOutputLines([])}
                  className="text-xs"
                  style={{ color: '#6b7280' }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setShowOutput(false)}
                  className="text-xs"
                  style={{ color: '#6b7280' }}
                >
                  ✕
                </button>
              </div>
            </div>
            <div
              className="flex-1 overflow-y-auto px-4 py-3"
              style={{ fontFamily: 'Space Mono, monospace', fontSize: '12px', lineHeight: '1.6' }}
            >
              {outputLines.map((line, i) => (
                <pre
                  key={i}
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    color:
                      line.type === 'stderr' || line.type === 'error'
                        ? '#f87171'
                        : line.type === 'info'
                        ? '#a855f7'
                        : '#d1fae5',
                  }}
                >
                  {line.text}
                </pre>
              ))}
              <div ref={outputEndRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
