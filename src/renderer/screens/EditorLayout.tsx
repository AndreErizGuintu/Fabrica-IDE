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
    case 'html': return 'html';
    case 'css': return 'css';
    case 'js': return 'javascript';
    case 'ts': return 'typescript';
    case 'tsx': return 'typescript';
    case 'jsx': return 'javascript';
    case 'py': return 'python';
    case 'json': return 'json';
    case 'php': return 'php';
    case 'cs': return 'csharp';
    case 'java': return 'java';
    case 'dart': return 'dart';
    default: return 'plaintext';
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

  // Floating panel states - only one panel can float at a time
  const [floatingPanel, setFloatingPanel] = useState<'preview' | 'ai' | null>(null);
  const [floatPosition, setFloatPosition] = useState({ x: 100, y: 100 });
  const [isDraggingFloat, setIsDraggingFloat] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const floatRef = useRef<HTMLDivElement>(null);

  const activeTab = tabs[activeTabIndex] ?? null;
  const isHtmlFile = activeTab
    ? activeTab.filename.endsWith('.html') || activeTab.filename.endsWith('.css')
    : false;
  const previewHtml = activeTab?.filename.endsWith('.css')
    ? `<!DOCTYPE html><html><head><style>${activeTab.content}</style></head><body><div style="padding:20px"><h1>CSS Preview</h1><p>Your styles are applied to this page.</p><button>Button</button></div></body></html>`
    : activeTab?.content ?? '';

  // Float drag handlers
  const handleFloatMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.float-controls')) return;
    e.preventDefault();
    setIsDraggingFloat(true);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingFloat) {
        const newX = Math.min(Math.max(e.clientX - dragOffset.x, 0), window.innerWidth - 420);
        const newY = Math.min(Math.max(e.clientY - dragOffset.y, 0), window.innerHeight - 300);
        setFloatPosition({ x: newX, y: newY });
      }
    };

    const handleMouseUp = () => {
      setIsDraggingFloat(false);
    };

    if (isDraggingFloat) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingFloat, dragOffset]);

  const toggleFloat = (panel: 'preview' | 'ai') => {
    if (floatingPanel === panel) {
      setFloatingPanel(null);
    } else {
      const x = Math.min(Math.max(100, 0), window.innerWidth - 420);
      const y = Math.min(Math.max(100, 0), window.innerHeight - 300);
      setFloatPosition({ x, y });
      setFloatingPanel(panel);
    }
  };

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

  useEffect(() => {
    if (initialFolder) {
      void refreshGitStatus();
    }
  }, [initialFolder]);

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
    <div className="flex flex-col h-screen overflow-hidden" style={{ backgroundColor: '#1e1e2e', color: '#d4d4d4' }}>
      {/* Top Bar */}
      <div
        className="flex items-center justify-between px-4 py-1.5 shrink-0"
        style={{ backgroundColor: '#2d2d3a', borderBottom: '1px solid #3d3d4a' }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="text-sm px-2 py-1 rounded transition-colors hover:bg-white/10"
            style={{ color: '#d4d4d4' }}
          >
            ← Menu
          </button>
          <img src={icon} alt="Fabrica" className="w-5 h-5" />
          <span
            className="text-sm"
            style={{ fontFamily: 'Segoe UI, sans-serif', color: '#d4d4d4' }}
          >
            {activeTab?.filename ?? 'No file open'}
          </span>
          {activeTab?.isDirty && (
            <span className="text-xs" style={{ color: '#4ec9b0' }}>●</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleOpenFileDialog}
            className="text-sm px-3 py-1 rounded transition-colors hover:bg-white/10"
            style={{ color: '#d4d4d4' }}
          >
            Open File
          </button>
          <button
            type="button"
            onClick={() => setShowAI((prev) => !prev)}
            className="text-sm px-3 py-1 rounded transition-colors hover:bg-white/10"
            style={{
              background: showAI ? 'rgba(167, 139, 250, 0.15)' : 'transparent',
              color: showAI ? '#a78bfa' : '#d4d4d4',
            }}
          >
            AI
          </button>
          <button
            type="button"
            onClick={() => setShowGit((prev) => !prev)}
            className="text-sm px-3 py-1 rounded transition-colors hover:bg-white/10"
            style={{
              background: showGit ? 'rgba(167, 139, 250, 0.15)' : 'transparent',
              color: showGit ? '#a78bfa' : '#d4d4d4',
            }}
          >
            Git
          </button>
          <button
            type="button"
            onClick={handleRun}
            disabled={isRunning || !activeTab}
            className="px-4 py-1 rounded text-sm font-medium transition-colors hover:bg-white/10"
            style={{
              background: isRunning ? 'transparent' : 'rgba(78, 201, 176, 0.15)',
              color: isRunning ? '#d4d4d4' : '#4ec9b0',
              cursor: isRunning || !activeTab ? 'not-allowed' : 'pointer',
              opacity: !activeTab ? 0.4 : 1,
            }}
          >
            {isRunning ? 'Running…' : 'Run'}
          </button>
          <button
            type="button"
            className="w-7 h-7 rounded flex items-center justify-center transition-colors hover:bg-white/10"
            style={{ color: '#6b7280' }}
            aria-label="Settings"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
              <path d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm8.5 3.5-.98-.38a7.4 7.4 0 0 0-.66-1.6l.58-.9a1 1 0 0 0-.15-1.24l-1.64-1.64a1 1 0 0 0-1.24-.15l-.9.58a7.4 7.4 0 0 0-1.6-.66L12.5 3.5a1 1 0 0 0-1 0l-1 .39a7.4 7.4 0 0 0-1.6.66l-.9-.58a1 1 0 0 0-1.24.15L4.12 5.76a1 1 0 0 0-.15 1.24l.58.9a7.4 7.4 0 0 0-.66 1.6l-.98.38a1 1 0 0 0-.61.92v2.28a1 1 0 0 0 .61.92l.98.38a7.4 7.4 0 0 0 .66 1.6l-.58.9a1 1 0 0 0 .15 1.24l1.64 1.64a1 1 0 0 0 1.24.15l.9-.58a7.4 7.4 0 0 0 1.6.66l1 .39a1 1 0 0 0 1 0l1-.39a7.4 7.4 0 0 0 1.6-.66l.9.58a1 1 0 0 0 1.24-.15l1.64-1.64a1 1 0 0 0 .15-1.24l-.58-.9a7.4 7.4 0 0 0 .66-1.6l.98-.38a1 1 0 0 0 .61-.92v-2.28a1 1 0 0 0-.61-.92z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Tabs Bar */}
      <div
        className="flex items-center overflow-x-auto shrink-0"
        style={{ background: '#1e1e2e', borderBottom: '1px solid #2d2d3a' }}
      >
        {tabs.map((tab, index) => (
          <div
            key={index}
            className="group flex items-center gap-2 px-4 py-1.5 cursor-pointer text-sm shrink-0 transition-colors"
            style={{
              background: index === activeTabIndex ? '#1e1e2e' : 'transparent',
              color: index === activeTabIndex ? '#ffffff' : '#6b7280',
              borderBottom: index === activeTabIndex ? '2px solid #a78bfa' : '2px solid transparent',
              fontFamily: 'Segoe UI, sans-serif',
            }}
            onClick={() => setActiveTabIndex(index)}
          >
            <span className="max-w-30 truncate">{tab.filename}</span>
            {tab.isDirty && <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#a78bfa' }} />}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleCloseTab(index);
              }}
              className="ml-0.5 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity text-[10px]"
              style={{ color: '#6b7280' }}
            >
              ✕
            </button>
          </div>
        ))}
        {tabs.length === 0 && (
          <div className="text-sm px-4 py-1.5" style={{ color: '#3f3f46', fontFamily: 'Segoe UI, sans-serif' }}>
            No files open
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          onFileOpen={handleFileOpen}
          initialFolder={initialFolder}
          activeFilePath={activeTab?.path}
          gitStatusFiles={gitStatusFiles}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          {tabs.length === 0 ? (
            <div
              className="flex-1 flex flex-col items-center justify-center gap-4"
              style={{ background: '#1e1e2e' }}
            >
              <div className="text-5xl opacity-20">📂</div>
              <div className="text-center" style={{ fontFamily: 'Segoe UI, sans-serif' }}>
                <div className="text-white font-medium text-lg mb-1.5">No file open</div>
                <div className="text-sm" style={{ color: '#52525b' }}>
                  Open a folder from the sidebar
                  <br />
                  or click Open File to get started
                </div>
              </div>
              <button
                type="button"
                onClick={handleOpenFileDialog}
                className="mt-2 text-sm px-5 py-2 rounded transition-colors hover:bg-white/10"
                style={{
                  background: 'rgba(167, 139, 250, 0.1)',
                  color: '#a78bfa',
                  border: '1px solid rgba(167, 139, 250, 0.2)',
                }}
              >
                Open File →
              </button>
            </div>
          ) : (
            <div className="flex-1 flex overflow-hidden">
              {/* Editor */}
              <div className="flex-1 flex flex-col min-w-0">
                <Editor
                  language={getLanguage(tabs[activeTabIndex].filename)}
                  filename={activeTab!.filename}
                  value={activeTab!.content}
                  onChange={handleEditorChange}
                  onSelectionChange={(s) => setSelectedCode(s)}
                />
              </div>

              {/* Right Panel - Preview and AI (Preview always visible, AI hidden when floated) */}
              <div className="flex flex-col shrink-0 border-l" style={{ borderColor: '#2d2d3a', width: '380px' }}>
                {/* Preview Panel */}
                <div className="flex-1 flex flex-col min-h-0">
                  <div 
                    className="flex items-center justify-between px-3 py-1 shrink-0"
                    style={{ 
                      background: '#252535', 
                      borderBottom: '1px solid #2d2d3a',
                    }}
                  >
                    <span className="text-xs font-medium" style={{ color: '#6b7280' }}>
                      🔍 Live Preview
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px]" style={{ color: '#3f3f46' }}>
                        {isHtmlFile ? 'HTML' : 'Preview'}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleFloat('preview')}
                        className="text-[10px] hover:text-white transition-colors"
                        style={{ 
                          color: floatingPanel === 'preview' ? '#a78bfa' : '#52525b',
                          opacity: floatingPanel === 'preview' ? 1 : 0.6,
                        }}
                        title={floatingPanel === 'preview' ? 'Dock Preview' : 'Float Preview'}
                      >
                        {floatingPanel === 'preview' ? '⬇' : '⬆'}
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <Preview html={previewHtml} isHtmlFile={isHtmlFile} />
                  </div>
                </div>

                {/* Resize Handle - only show if AI is visible and not floating */}
                {showAI && floatingPanel !== 'ai' && (
                  <div 
                    className="h-0.75 shrink-0 cursor-row-resize hover:bg-purple-500/30 transition-colors"
                    style={{ 
                      background: '#1e1e2e',
                      borderTop: '1px solid #2d2d3a',
                      borderBottom: '1px solid #2d2d3a',
                    }}
                  />
                )}

                {/* AI Panel - hidden when floating */}
                {showAI && floatingPanel !== 'ai' && (
                  <div 
                    className="shrink-0 overflow-hidden"
                    style={{ height: '250px' }}
                  >
                    <div className="h-full flex flex-col">
                      <div 
                        className="flex items-center justify-between px-3 py-1 shrink-0"
                        style={{ 
                          background: '#252535', 
                          borderBottom: '1px solid #2d2d3a',
                        }}
                      >
                        <span className="text-xs font-medium" style={{ color: '#6b7280' }}>
                          ✨ AI Assistant
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleFloat('ai')}
                            className="text-[10px] hover:text-white transition-colors"
                            style={{ color: '#52525b' }}
                            title="Float AI"
                          >
                            ⬆
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowAI(false)}
                            className="text-[10px] hover:text-white transition-colors"
                            style={{ color: '#52525b' }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <AIPanel selectedCode={selectedCode} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Git Panel */}
        {showGit && (
          <div
            className="flex flex-col shrink-0 overflow-hidden border-l"
            style={{
              width: '260px',
              background: '#1e1e2e',
              borderColor: '#2d2d3a',
            }}
          >
            <div
              className="px-3 py-2 text-xs font-medium tracking-wider shrink-0 flex items-center justify-between"
              style={{
                color: '#6b7280',
                fontFamily: 'Segoe UI, sans-serif',
                borderBottom: '1px solid #2d2d3a',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              <span>Source Control</span>
              <button
                type="button"
                onClick={() => void refreshGitStatus()}
                className="transition-colors hover:text-white"
                style={{ color: '#52525b' }}
                title="Refresh"
              >
                ↻
              </button>
            </div>

            <div className="px-3 pt-2 pb-2 shrink-0 flex flex-col gap-1.5 border-b" style={{ borderColor: '#2d2d3a' }}>
              <input
                type="text"
                placeholder="Message (Ctrl+Enter)"
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
                className="text-xs px-2 py-1.5 rounded w-full transition-colors focus:outline-none focus:ring-1 focus:ring-purple-500"
                style={{
                  background: '#252535',
                  color: '#d4d4d4',
                  border: '1px solid #2d2d3a',
                  fontFamily: 'Segoe UI, sans-serif',
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
                className="text-xs py-1 rounded font-medium transition-colors"
                style={{
                  background: gitLoading || !commitMessage.trim() ? '#252535' : '#a78bfa',
                  color: gitLoading || !commitMessage.trim() ? '#52525b' : '#ffffff',
                  cursor: gitLoading || !commitMessage.trim() ? 'not-allowed' : 'pointer',
                  border: 'none',
                }}
              >
                Commit
              </button>

              <div className="flex gap-1">
                {[
                  { label: 'init', fn: () => window.git.init(initialFolder!) },
                  { label: 'add', fn: () => window.git.add(initialFolder!) },
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
                    className="flex-1 text-[10px] py-1 rounded transition-colors hover:bg-white/5"
                    style={{
                      background: '#252535',
                      color: '#6b7280',
                      border: '1px solid #2d2d3a',
                      opacity: gitLoading ? 0.4 : 1,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {(() => {
              const staged: { code: string; filename: string }[] = [];
              const unstaged: { code: string; filename: string }[] = [];

              gitStatusFiles.forEach((line) => {
                const stagedCode = line[0] ?? ' ';
                const unstagedCode = line[1] ?? ' ';
                const filename = line.slice(3);
                if (!filename) return;

                if (line.startsWith('??')) {
                  unstaged.push({ code: '?', filename });
                  return;
                }
                if (stagedCode !== ' ') {
                  staged.push({ code: stagedCode, filename });
                }
                if (unstagedCode !== ' ') {
                  unstaged.push({ code: unstagedCode, filename });
                }
              });

              const codeColor = (code: string) => {
                if (code === 'M') return '#fbbf24';
                if (code === 'A' || code === '?') return '#4ade80';
                if (code === 'D') return '#f87171';
                if (code === 'R') return '#60a5fa';
                return '#6b7280';
              };

              const renderRow = (item: { code: string; filename: string }, i: number) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-3 py-0.5 text-xs truncate transition-colors hover:bg-white/5"
                  style={{ fontFamily: 'Segoe UI, sans-serif', color: codeColor(item.code) }}
                >
                  <span className="shrink-0 text-[10px] font-medium w-4">{item.code}</span>
                  <span className="truncate">{item.filename}</span>
                </div>
              );

              return (
                <div className="flex-1 overflow-y-auto">
                  <div className="shrink-0">
                    <div
                      className="w-full flex items-center gap-1 px-3 py-1 text-[10px] font-medium"
                      style={{
                        color: '#52525b',
                        fontFamily: 'Segoe UI, sans-serif',
                        background: '#1a1a28',
                        borderTop: '1px solid #2d2d3a',
                        borderBottom: '1px solid #2d2d3a',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      <span className="text-[8px]">▼</span>
                      Staged
                      {staged.length > 0 && (
                        <span
                          className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full"
                          style={{ background: '#4ade80', color: '#1e1e2e' }}
                        >
                          {staged.length}
                        </span>
                      )}
                    </div>
                    <div>
                      {staged.length === 0 ? (
                        <div className="px-3 py-1.5 text-xs" style={{ color: '#3f3f46', fontFamily: 'Segoe UI, sans-serif' }}>
                          Nothing staged
                        </div>
                      ) : (
                        staged.map(renderRow)
                      )}
                    </div>
                  </div>

                  <div className="shrink-0">
                    <button
                      type="button"
                      onClick={() => setGitChangesOpen((p) => !p)}
                      className="w-full flex items-center gap-1 px-3 py-1 text-[10px] font-medium transition-colors hover:bg-white/5"
                      style={{
                        color: '#52525b',
                        fontFamily: 'Segoe UI, sans-serif',
                        background: '#1a1a28',
                        borderTop: '1px solid #2d2d3a',
                        borderBottom: gitChangesOpen ? '1px solid #2d2d3a' : 'none',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      <span className="text-[8px]">{gitChangesOpen ? '▼' : '▶'}</span>
                      Changes
                      {unstaged.length > 0 && (
                        <span
                          className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full"
                          style={{ background: '#a78bfa', color: '#1e1e2e' }}
                        >
                          {unstaged.length}
                        </span>
                      )}
                    </button>
                    {gitChangesOpen && (
                      <div>
                        {unstaged.length === 0 ? (
                          <div className="px-3 py-1.5 text-xs" style={{ color: '#3f3f46', fontFamily: 'Segoe UI, sans-serif' }}>
                            {initialFolder ? 'No changes' : 'No folder open'}
                          </div>
                        ) : (
                          unstaged.map(renderRow)
                        )}
                      </div>
                    )}
                  </div>

                  <div className="shrink-0">
                    <button
                      type="button"
                      onClick={() => setGitHistoryOpen((p) => !p)}
                      className="w-full flex items-center gap-1 px-3 py-1 text-[10px] font-medium transition-colors hover:bg-white/5"
                      style={{
                        color: '#52525b',
                        fontFamily: 'Segoe UI, sans-serif',
                        background: '#1a1a28',
                        borderTop: '1px solid #2d2d3a',
                        borderBottom: gitHistoryOpen ? '1px solid #2d2d3a' : 'none',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      <span className="text-[8px]">{gitHistoryOpen ? '▼' : '▶'}</span>
                      History
                    </button>
                    {gitHistoryOpen && (
                      <div>
                        {gitLog.length === 0 ? (
                          <div className="px-3 py-1.5 text-xs" style={{ color: '#3f3f46', fontFamily: 'Segoe UI, sans-serif' }}>
                            No commits
                          </div>
                        ) : (
                          gitLog.map((line, i) => {
                            const sha = line.slice(0, 7);
                            const message = line.slice(8);
                            return (
                              <div
                                key={i}
                                className="flex items-start gap-2 px-3 py-0.5 text-xs hover:bg-white/5"
                                style={{ fontFamily: 'Segoe UI, sans-serif' }}
                              >
                                <span
                                  className="shrink-0 px-1.5 py-0.5 rounded"
                                  style={{ background: '#252535', color: '#a78bfa', fontSize: '9px' }}
                                >
                                  {sha}
                                </span>
                                <span className="truncate" style={{ color: '#6b7280' }}>
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
              );
            })()}
          </div>
        )}
      </div>

      {/* Floating Panel - only one at a time */}
      {floatingPanel && (
        <div
          ref={floatRef}
          className="fixed rounded-lg shadow-2xl border"
          style={{
            width: '420px',
            height: floatingPanel === 'preview' ? '300px' : '350px',
            left: floatPosition.x,
            top: floatPosition.y,
            backgroundColor: '#1e1e2e',
            borderColor: '#2d2d3a',
            boxShadow: '0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(167, 139, 250, 0.15)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            userSelect: 'none',
          }}
        >
          {floatingPanel === 'preview' ? (
            <>
              <div 
                className="flex items-center justify-between px-3 py-1 shrink-0 cursor-move select-none"
                style={{ 
                  background: '#252535', 
                  borderBottom: '1px solid #2d2d3a',
                }}
                onMouseDown={handleFloatMouseDown}
              >
                <span className="text-xs font-medium" style={{ color: '#6b7280' }}>
                  🔍 Live Preview
                </span>
                <div className="flex items-center gap-2 float-controls">
                  <span className="text-[10px]" style={{ color: '#3f3f46' }}>
                    {isHtmlFile ? 'HTML' : 'Preview'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFloatingPanel(null)}
                    className="text-[10px] hover:text-white transition-colors"
                    style={{ color: '#52525b' }}
                    title="Dock Preview"
                  >
                    ⬇
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-hidden">
                <Preview html={previewHtml} isHtmlFile={isHtmlFile} />
              </div>
            </>
          ) : (
            <>
              <div 
                className="flex items-center justify-between px-3 py-1 shrink-0 cursor-move select-none"
                style={{ 
                  background: '#252535', 
                  borderBottom: '1px solid #2d2d3a',
                }}
                onMouseDown={handleFloatMouseDown}
              >
                <span className="text-xs font-medium" style={{ color: '#6b7280' }}>
                  ✨ AI Assistant
                </span>
                <div className="flex items-center gap-2 float-controls">
                  <button
                    type="button"
                    onClick={() => setFloatingPanel(null)}
                    className="text-[10px] hover:text-white transition-colors"
                    style={{ color: '#52525b' }}
                    title="Dock AI"
                  >
                    ⬇
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAI(false)}
                    className="text-[10px] hover:text-white transition-colors"
                    style={{ color: '#52525b' }}
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-hidden">
                <AIPanel selectedCode={selectedCode} />
              </div>
            </>
          )}
        </div>
      )}

      {/* Output Panel */}
      {showOutput && (
        <div
          className="flex flex-col shrink-0"
          style={{
            height: '150px',
            background: '#1e1e2e',
            borderTop: '1px solid #2d2d3a',
          }}
        >
          <div
            className="flex items-center justify-between px-3 py-1 shrink-0"
            style={{ background: '#252535', borderBottom: '1px solid #2d2d3a' }}
          >
            <div className="flex items-center gap-2">
              <span
                className="text-[10px] font-medium"
                style={{ 
                  color: '#6b7280', 
                  fontFamily: 'Segoe UI, sans-serif',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}
              >
                Terminal
              </span>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#4ade80' }} />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOutputLines([])}
                className="text-[10px] transition-colors hover:text-white"
                style={{ color: '#52525b' }}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setShowOutput(false)}
                className="text-[10px] transition-colors hover:text-white"
                style={{ color: '#52525b' }}
              >
                ✕
              </button>
            </div>
          </div>
          <div
            className="flex-1 overflow-y-auto px-3 py-2"
            style={{ fontFamily: 'Consolas, monospace', fontSize: '12px', lineHeight: '1.6' }}
          >
            {outputLines.length === 0 ? (
              <div style={{ color: '#3f3f46' }}>No output to display</div>
            ) : (
              outputLines.map((line, i) => (
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
                        ? '#a78bfa'
                        : '#4ade80',
                  }}
                >
                  {line.text}
                </pre>
              ))
            )}
            <div ref={outputEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}