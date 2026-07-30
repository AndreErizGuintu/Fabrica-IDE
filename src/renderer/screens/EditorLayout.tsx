import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Rnd } from 'react-rnd';
import icon from '../../../assets/icon.svg';
import Editor from '../components/editor/Editor';
import Preview from '../components/preview/Preview';
import Sidebar from '../components/sidebar/Sidebar';
import AIPanel from '../components/ai/AIPanel';
import Terminal, { TerminalHandle } from '../components/terminal/Terminal';
import StatsDebugPanel from '../components/StatsDebugPanel';
import { Tab } from '../types/index';

type FloatingPanel = 'preview' | 'ai';

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

const RUNTIME_BY_EXT: Record<string, string> = {
  js: 'node', ts: 'node',
  php: 'php',
  cs: 'dotnet',
  dart: 'dart',
};

const RUN_LANGUAGE_BY_EXT: Record<string, string> = {
  html: 'html',
  js: 'js', ts: 'ts',
  php: 'php',
  cs: 'cs',
  dart: 'dart',
};

const DETACH_THRESHOLD = 6;

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
  const [isRunning, setIsRunning] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const terminalRef = useRef<TerminalHandle>(null);

  // Floating panel states
  const [floatingPanel, setFloatingPanel] = useState<FloatingPanel | null>(null);
  const [floatPosition, setFloatPosition] = useState<Record<FloatingPanel, { x: number; y: number }>>({
    preview: { x: 100, y: 100 },
    ai: { x: 140, y: 120 },
  });
  const [floatSize, setFloatSize] = useState<Record<FloatingPanel, { width: number; height: number }>>({
    preview: { width: 420, height: 350 },
    ai: { width: 420, height: 350 },
  });
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [previewZoom, setPreviewZoom] = useState(1);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const preFullscreenRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  const [armedDetachPanel, setArmedDetachPanel] = useState<FloatingPanel | null>(null);
  const detachStartRef = useRef({ x: 0, y: 0 });

  const [aiPanelHeight, setAiPanelHeight] = useState(250);
  const [isResizingAIHeight, setIsResizingAIHeight] = useState(false);
  const resizeAIStartRef = useRef({ y: 0, height: 250, containerHeight: 600 });
  const rightPanelContentRef = useRef<HTMLDivElement>(null);

  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const RIGHT_PANEL_WIDTH = 380;

  useEffect(() => {
    if (initialFolder) {
      window.stats?.startSession(initialFolder);
    }
    // Session boundary is one continuous app open->close for the loaded
    // project; write-on-quit is handled in the main process, not here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFolder]);

  const activeTab = tabs[activeTabIndex] ?? null;
  const isHtmlFile = activeTab
    ? activeTab.filename.endsWith('.html') || activeTab.filename.endsWith('.css')
    : false;

  const previewHtml = useMemo(() => {
    if (!activeTab) return '';
    if (activeTab.filename.endsWith('.css')) {
      return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 40px;
            background: #f5f5f5;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
        }
        .preview-container {
            max-width: 800px;
            width: 100%;
            background: white;
            border-radius: 12px;
            padding: 40px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        ${activeTab.content}
    </style>
</head>
<body>
    <div class="preview-container">
        <h1>CSS Preview</h1>
        <p style="color: #666; margin: 16px 0;">Your styles are applied to this page.</p>
        <button style="padding: 10px 24px; border: none; border-radius: 6px; background: #6c5ce7; color: white; cursor: pointer; font-size: 16px;">Button</button>
        <div style="margin-top: 20px; padding: 20px; background: #f8f9fa; border-radius: 8px;">
            <p style="color: #333;">This is a sample card to preview your CSS styles.</p>
            <p style="color: #666; font-size: 14px; margin-top: 8px;">Try styling: backgrounds, colors, fonts, borders, spacing, etc.</p>
        </div>
    </div>
</body>
</html>`;
    }
    return activeTab.content;
  }, [activeTab]);

  // FIXED: ONLY dock when dragged to the RIGHT side
  const checkDockPosition = useCallback((x: number, y: number, width: number, height: number) => {
    if (!sidebarRef.current) return null;
    
    const sidebarRect = sidebarRef.current.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    
    // ONLY dock when dragged to the RIGHT side (where the panel came from)
    const rightPanelX = sidebarRect.right + 50;
    if (x > rightPanelX - 50 && x < rightPanelX + 50) {
      return 'right-panel';
    }
    
    // If window is in the right half of the screen
    if (x > windowWidth / 2) {
      return 'right-panel';
    }
    
    // REMOVED: left side docking - now returns null instead of 'sidebar'
    return null;
  }, []);

  const zoomIn = useCallback(() => {
    setPreviewZoom((prev) => Math.min(prev + 0.1, 2));
  }, []);

  const zoomOut = useCallback(() => {
    setPreviewZoom((prev) => Math.max(prev - 0.1, 0.5));
  }, []);

  const resetZoom = useCallback(() => {
    setPreviewZoom(1);
  }, []);

  const dockPanel = useCallback(() => {
    setFloatingPanel(null);
    setIsFullscreen(false);
    preFullscreenRef.current = null;
    setPreviewZoom(1);
  }, []);

  const handleDetachMouseDown = useCallback((panel: FloatingPanel) => (e: React.MouseEvent) => {
    if (floatingPanel === panel) return;
    if ((e.target as HTMLElement).closest('.float-controls')) return;
    detachStartRef.current = { x: e.clientX, y: e.clientY };
    setArmedDetachPanel(panel);
  }, [floatingPanel]);

  const handleAIResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeAIStartRef.current = {
      y: e.clientY,
      height: aiPanelHeight,
      containerHeight: rightPanelContentRef.current?.clientHeight ?? 600,
    };
    setIsResizingAIHeight(true);
  }, [aiPanelHeight]);

  const toggleFullscreen = useCallback(() => {
    if (!floatingPanel) return;
    const panel = floatingPanel;
    setIsFullscreen((prev) => {
      const next = !prev;
      if (next) {
        preFullscreenRef.current = {
          x: floatPosition[panel]?.x ?? 100,
          y: floatPosition[panel]?.y ?? 100,
          width: floatSize[panel]?.width ?? 420,
          height: floatSize[panel]?.height ?? 350,
        };
        return true;
      } else if (preFullscreenRef.current) {
        setFloatPosition((prevPos) => ({
          ...prevPos,
          [panel]: { x: preFullscreenRef.current!.x, y: preFullscreenRef.current!.y },
        }));
        setFloatSize((prevSize) => ({
          ...prevSize,
          [panel]: { width: preFullscreenRef.current!.width, height: preFullscreenRef.current!.height },
        }));
        preFullscreenRef.current = null;
        return false;
      }
      return false;
    });
  }, [floatingPanel, floatPosition, floatSize]);

  const handleFloatDragStop = useCallback((_event: any, data: any) => {
    if (!floatingPanel || isFullscreen) return;
    const panel = floatingPanel;
    
    const panelSize = floatSize[panel];
    if (!panelSize) return;
    
    const dockTarget = checkDockPosition(
      data.x, 
      data.y, 
      panelSize.width, 
      panelSize.height
    );
    
    if (dockTarget) {
      setFloatingPanel(null);
      setIsFullscreen(false);
      preFullscreenRef.current = null;
      if (panel === 'preview') setPreviewZoom(1);
    } else {
      setFloatPosition((prev) => ({ ...prev, [panel]: { x: data.x, y: data.y } }));
    }
  }, [floatingPanel, isFullscreen, floatSize, checkDockPosition]);

  const handleFloatResizeStop = useCallback((_event: any, _direction: any, ref: any, _delta: any, position: any) => {
    if (!floatingPanel || isFullscreen) return;
    const panel = floatingPanel;
    setFloatSize((prev) => ({
      ...prev,
      [panel]: { width: ref.offsetWidth, height: ref.offsetHeight },
    }));
    setFloatPosition((prev) => ({
      ...prev,
      [panel]: { x: position.x, y: position.y },
    }));
  }, [floatingPanel, isFullscreen]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (armedDetachPanel) {
        const dx = e.clientX - detachStartRef.current.x;
        const dy = e.clientY - detachStartRef.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > DETACH_THRESHOLD) {
          const panel = armedDetachPanel;
          const dims = floatSize[panel];
          if (!dims) return;
          const offset = { x: 24, y: 12 };
          const newX = Math.min(Math.max(e.clientX - offset.x, 0), window.innerWidth - dims.width);
          const newY = Math.min(Math.max(e.clientY - offset.y, 0), window.innerHeight - dims.height);
          setFloatPosition((prev) => ({
            ...prev,
            [panel]: { x: newX, y: newY },
          }));
          setFloatingPanel(panel);
          if (panel === 'preview') setPreviewZoom(1);
          setArmedDetachPanel(null);
        }
      }

      if (isResizingAIHeight) {
        const { y, height, containerHeight } = resizeAIStartRef.current;
        const dy = e.clientY - y;
        const maxHeight = Math.max(120, containerHeight - 120);
        const newHeight = Math.min(Math.max(height - dy, 120), maxHeight);
        setAiPanelHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      setArmedDetachPanel(null);
      setIsResizingAIHeight(false);
    };

    if (armedDetachPanel || isResizingAIHeight) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [armedDetachPanel, floatSize, isResizingAIHeight]);

  const openFileInTab = useCallback((filePath: string, filename: string, content: string) => {
    setTabs((prev) => {
      const existing = prev.findIndex((tab) => tab.path === filePath);
      if (existing !== -1) {
        setActiveTabIndex(existing);
        return prev;
      }
      const newTab: Tab = { filename, path: filePath, content, isDirty: false };
      const newTabs = [...prev, newTab];
      setActiveTabIndex(newTabs.length - 1);
      return newTabs;
    });
  }, []);

  const handleFileOpen = useCallback(async (filePath: string, filename: string) => {
    const result = await window.fileSystem.readFile(filePath);
    if (result.success && result.content !== undefined) {
      openFileInTab(filePath, filename, result.content);
    }
  }, [openFileInTab]);

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (!activeTab) return;
    window.stats?.activity();
    setTabs((prev) =>
      prev.map((tab, index) =>
        index === activeTabIndex
          ? { ...tab, content: value ?? '', isDirty: true }
          : tab,
      ),
    );
  }, [activeTab, activeTabIndex]);

  const handleSave = useCallback(async () => {
    if (!activeTab || !activeTab.path) return;
    const result = await window.fileSystem.writeFile(activeTab.path, activeTab.content);
    if (result.success) {
      setTabs((prev) =>
        prev.map((tab, index) =>
          index === activeTabIndex ? { ...tab, isDirty: false } : tab,
        ),
      );
    }
  }, [activeTab, activeTabIndex]);

  const handleRun = useCallback(async () => {
    if (!activeTab?.path) {
      setRunError('No file saved. Save the file before running.');
      setShowOutput(true);
      return;
    }

    const ext = activeTab.filename.split('.').pop()?.toLowerCase();
    const language = ext ? RUN_LANGUAGE_BY_EXT[ext] : undefined;

    if (!language) {
      setRunError(`Cannot run .${ext ?? '?'} files directly.`);
      setShowOutput(true);
      return;
    }

    if (language !== 'html') {
      const runtime = ext ? RUNTIME_BY_EXT[ext] : undefined;
      const sdkCheck = runtime ? await window.runner.checkSDK(runtime) : undefined;
      if (runtime && !sdkCheck?.available) {
        setRunError(`Runtime not found: ${runtime}\nInstall it and make sure it's on your PATH.\n${sdkCheck?.error ?? ''}`);
        setShowOutput(true);
        return;
      }
    }

    setRunError(null);
    setShowOutput(true);
    await terminalRef.current?.run({ language, path: activeTab.path });
  }, [activeTab]);

  const handleFlutterRun = useCallback(async () => {
    if (!initialFolder) return;
    setRunError(null);
    setShowOutput(true);
    await terminalRef.current?.run({ language: 'flutter', path: initialFolder });
  }, [initialFolder]);

  const runGitCommand = useCallback(async (
    label: string,
    fn: () => Promise<{ success: boolean; output: string; error?: string }>,
  ) => {
    if (!initialFolder) {
      setShowOutput(true);
      terminalRef.current?.write('No folder open. Open a folder first.\n');
      return;
    }

    setGitLoading(true);
    setShowOutput(true);
    terminalRef.current?.write(`⎇ git ${label}...\n`);

    try {
      const result = await fn();
      terminalRef.current?.write(`${result.output || result.error || '(no output)'}\n`);
      terminalRef.current?.write(result.success ? '✓ Done\n' : '✗ Failed\n');
    } finally {
      setGitLoading(false);
    }
  }, [initialFolder]);

  const refreshGitStatus = useCallback(async () => {
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
  }, [initialFolder]);

  useEffect(() => {
    if (initialFolder) {
      void refreshGitStatus();
    }
  }, [initialFolder, refreshGitStatus]);

  const handleOpenFileDialog = useCallback(async () => {
    const filePath = await window.fileSystem.openFile();
    if (!filePath) return;
    const result = await window.fileSystem.readFile(filePath);
    if (result.success && result.content !== undefined) {
      const filename = filePath.split('\\').pop() ?? filePath;
      openFileInTab(filePath, filename, result.content);
    }
  }, [openFileInTab]);

  const handleCloseTab = useCallback((index: number) => {
    setTabs((prev) => {
      const newTabs = prev.filter((_, tabIndex) => tabIndex !== index);
      if (newTabs.length === 0) {
        setActiveTabIndex(0);
      } else if (index < activeTabIndex) {
        setActiveTabIndex(activeTabIndex - 1);
      } else if (index === activeTabIndex) {
        setActiveTabIndex(Math.min(activeTabIndex, newTabs.length - 1));
      } else {
        setActiveTabIndex(activeTabIndex);
      }
      return newTabs;
    });
  }, [activeTabIndex]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        if (activeTab) handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, handleSave]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (floatingPanel !== 'preview') return;
      if (event.ctrlKey || event.metaKey) {
        if (event.key === '=' || event.key === '+') {
          event.preventDefault();
          zoomIn();
        } else if (event.key === '-') {
          event.preventDefault();
          zoomOut();
        } else if (event.key === '0') {
          event.preventDefault();
          resetZoom();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [floatingPanel, zoomIn, zoomOut, resetZoom]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!floatingPanel) return;
      
      if (event.key === 'Escape' && !isFullscreen) {
        event.preventDefault();
        dockPanel();
      }
      
      if (event.key === 'F11') {
        event.preventDefault();
        toggleFullscreen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [floatingPanel, isFullscreen, dockPanel, toggleFullscreen]);

  useEffect(() => {
    if (!floatingPanel) {
      setIsFullscreen(false);
      preFullscreenRef.current = null;
    }
  }, [floatingPanel]);

  useEffect(() => {
    if (showGit) {
      void refreshGitStatus();
    }
  }, [showGit, refreshGitStatus]);

  const currentFloatingPanel = floatingPanel ?? 'preview';
  const currentSize = floatSize[currentFloatingPanel] || { width: 420, height: 350 };
  const currentPosition = floatPosition[currentFloatingPanel] || { x: 100, y: 100 };
  
  const floatStyle = isFullscreen
    ? {
        width: '100vw',
        height: '100vh',
        x: 0,
        y: 0,
        borderRadius: 0,
      }
    : {
        width: currentSize.width,
        height: currentSize.height,
        x: currentPosition.x,
        y: currentPosition.y,
        borderRadius: 8,
      };

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ backgroundColor: '#1e1e2e', color: '#d4d4d4' }}>
      {/* Temporary debug-only tool, see src/renderer/components/StatsDebugPanel.tsx */}
      <StatsDebugPanel projectPath={initialFolder} />
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
            disabled={!activeTab}
            title={isRunning ? 'A process is already running — this will stop it and start a new one' : undefined}
            className="px-4 py-1 rounded text-sm font-medium transition-colors hover:bg-white/10"
            style={{
              background: 'rgba(78, 201, 176, 0.15)',
              color: '#4ec9b0',
              cursor: !activeTab ? 'not-allowed' : 'pointer',
              opacity: !activeTab ? 0.4 : 1,
            }}
          >
            {isRunning ? 'Running…' : 'Run'}
          </button>
          <button
            type="button"
            onClick={handleFlutterRun}
            disabled={!initialFolder}
            title={
              isRunning
                ? 'A process is already running — this will stop it and start a new one'
                : 'Launch Flutter Windows desktop preview for the open project'
            }
            className="px-4 py-1 rounded text-sm font-medium transition-colors hover:bg-white/10"
            style={{
              background: 'rgba(96, 165, 250, 0.15)',
              color: '#60a5fa',
              cursor: !initialFolder ? 'not-allowed' : 'pointer',
              opacity: !initialFolder ? 0.4 : 1,
            }}
          >
            Flutter Preview
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
        <div ref={sidebarRef} className="flex">
          <Sidebar
            onFileOpen={handleFileOpen}
            initialFolder={initialFolder}
            activeFilePath={activeTab?.path}
            gitStatusFiles={gitStatusFiles}
          />
        </div>

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

              {/* Right Panel */}
              <div className="flex shrink-0 relative">
                <button
                  type="button"
                  onClick={() => setRightPanelCollapsed((prev) => !prev)}
                  className="w-4 flex items-center justify-center shrink-0 transition-colors hover:bg-white/10"
                  style={{
                    background: '#1e1e2e',
                    borderLeft: '1px solid #2d2d3a',
                    borderRight: rightPanelCollapsed ? 'none' : '1px solid #2d2d3a',
                    color: '#6b7280',
                  }}
                  title={rightPanelCollapsed ? 'Show preview & AI panel' : 'Hide preview & AI panel'}
                >
                  <span className="text-[10px]">{rightPanelCollapsed ? '◀' : '▶'}</span>
                </button>

                <div
                  className="flex flex-col overflow-hidden transition-all duration-200 ease-out"
                  style={{
                    width: rightPanelCollapsed ? 0 : `${RIGHT_PANEL_WIDTH}px`,
                  }}
                >
                  <div ref={rightPanelContentRef} className="flex flex-col h-full" style={{ width: `${RIGHT_PANEL_WIDTH}px` }}>
                    {/* Preview Panel - Drag to float */}
                    {floatingPanel !== 'preview' && (
                      <div
                        className="flex-1 flex flex-col min-h-0"
                        onMouseDown={handleDetachMouseDown('preview')}
                        style={{ cursor: armedDetachPanel === 'preview' ? 'grabbing' : 'grab' }}
                        title="Drag to detach the preview"
                      >
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
                          <span className="text-[10px]" style={{ color: '#3f3f46' }}>
                            {isHtmlFile ? 'HTML' : 'Preview'}
                          </span>
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <Preview 
                            key={activeTab?.path + previewHtml}
                            html={previewHtml} 
                            isHtmlFile={isHtmlFile} 
                            zoom={1} 
                          />
                        </div>
                      </div>
                    )}

                    {/* AI Panel - Drag to float */}
                    {showAI && floatingPanel !== 'ai' && (
                      <>
                        {floatingPanel !== 'preview' && (
                          <div
                            onMouseDown={handleAIResizeMouseDown}
                            className="h-1.5 shrink-0 cursor-row-resize hover:bg-purple-500/30 transition-colors"
                            style={{
                              background: isResizingAIHeight ? 'rgba(167, 139, 250, 0.3)' : '#1e1e2e',
                              borderTop: '1px solid #2d2d3a',
                              borderBottom: '1px solid #2d2d3a',
                            }}
                            title="Drag to resize"
                          />
                        )}
                        <div className="shrink-0 overflow-hidden" style={{ height: `${aiPanelHeight}px` }}>
                          <div
                            className="h-full flex flex-col"
                            onMouseDown={handleDetachMouseDown('ai')}
                            style={{ cursor: armedDetachPanel === 'ai' ? 'grabbing' : 'grab' }}
                            title="Drag to detach the AI assistant"
                          >
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
                              <div className="flex items-center gap-2 float-controls">
                                <button
                                  type="button"
                                  onClick={() => setShowAI(false)}
                                  className="text-[10px] hover:text-white transition-colors"
                                  style={{ color: '#52525b' }}
                                  title="Close AI"
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
                      </>
                    )}
                  </div>
                </div>
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

      {/* Floating Preview */}
      {floatingPanel === 'preview' && (
        <Rnd
          size={{ width: floatStyle.width, height: floatStyle.height }}
          position={{ x: floatStyle.x, y: floatStyle.y }}
          minWidth={320}
          minHeight={240}
          bounds="window"
          disableDragging={isFullscreen}
          enableResizing={!isFullscreen}
          dragHandleClassName="float-drag-handle"
          onDragStop={handleFloatDragStop}
          onResizeStop={handleFloatResizeStop}
          style={{
            borderRadius: isFullscreen ? 0 : floatStyle.borderRadius,
            backgroundColor: '#1e1e2e',
            border: '1px solid #2d2d3a',
            boxShadow: '0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(167, 139, 250, 0.15)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            userSelect: 'none',
          }}
        >
          <div
            className="float-drag-handle flex items-center justify-between px-3 py-1 shrink-0 select-none"
            style={{
              background: '#252535',
              borderBottom: '1px solid #2d2d3a',
              cursor: isFullscreen ? 'default' : 'move',
            }}
            onDoubleClick={toggleFullscreen}
            title="Drag to move • double-click to toggle fullscreen"
          >
            <span className="text-xs font-medium" style={{ color: '#6b7280' }}>
              🔍 Live Preview
            </span>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <button type="button" onClick={(e) => { e.stopPropagation(); zoomOut(); }} className="text-[10px] hover:text-white transition-colors px-1" style={{ color: '#52525b' }} title="Zoom Out">➖</button>
                <span className="text-[10px]" style={{ color: '#6b7280', minWidth: '35px', textAlign: 'center' }}>{Math.round(previewZoom * 100)}%</span>
                <button type="button" onClick={(e) => { e.stopPropagation(); zoomIn(); }} className="text-[10px] hover:text-white transition-colors px-1" style={{ color: '#52525b' }} title="Zoom In">➕</button>
                <button type="button" onClick={(e) => { e.stopPropagation(); resetZoom(); }} className="text-[10px] hover:text-white transition-colors px-1" style={{ color: '#52525b' }} title="Reset Zoom">⟲</button>
              </div>
              
              {isFullscreen && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFullscreen();
                  }}
                  className="text-[10px] hover:text-white transition-colors px-1"
                  style={{ color: '#a78bfa' }}
                  title="Exit Fullscreen (F11 or Escape)"
                >
                  ⛶ Exit
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <Preview 
              key={activeTab?.path + previewHtml}
              html={previewHtml} 
              isHtmlFile={isHtmlFile} 
              zoom={previewZoom} 
            />
          </div>
        </Rnd>
      )}

      {/* Floating AI */}
      {floatingPanel === 'ai' && (
        <Rnd
          size={{ width: floatStyle.width, height: floatStyle.height }}
          position={{ x: floatStyle.x, y: floatStyle.y }}
          minWidth={320}
          minHeight={220}
          bounds="window"
          disableDragging={isFullscreen}
          enableResizing={!isFullscreen}
          dragHandleClassName="float-drag-handle"
          onDragStop={handleFloatDragStop}
          onResizeStop={handleFloatResizeStop}
          style={{
            borderRadius: isFullscreen ? 0 : floatStyle.borderRadius,
            backgroundColor: '#1e1e2e',
            border: '1px solid #2d2d3a',
            boxShadow: '0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(167, 139, 250, 0.15)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            userSelect: 'none',
          }}
        >
          <div
            className="float-drag-handle flex items-center justify-between px-3 py-1 shrink-0 select-none"
            style={{
              background: '#252535',
              borderBottom: '1px solid #2d2d3a',
              cursor: isFullscreen ? 'default' : 'move',
            }}
            onDoubleClick={toggleFullscreen}
            title="Drag to move • double-click to toggle fullscreen"
          >
            <span className="text-xs font-medium" style={{ color: '#6b7280' }}>
              ✨ AI Assistant
            </span>
            <div className="flex items-center gap-2 float-controls">
              {isFullscreen && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFullscreen();
                  }}
                  className="text-[10px] hover:text-white transition-colors px-1"
                  style={{ color: '#a78bfa' }}
                  title="Exit Fullscreen (F11 or Escape)"
                >
                  ⛶ Exit
                </button>
              )}
              <button
                type="button"
                onClick={() => { dockPanel(); setShowAI(false); }}
                className="text-[10px] hover:text-white transition-colors"
                style={{ color: '#52525b' }}
                title="Close AI"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <AIPanel selectedCode={selectedCode} />
          </div>
        </Rnd>
      )}

      {/* Terminal Panel — always mounted (so the ref is ready before the first Run/Git
          click), just collapsed to zero height when closed rather than unmounted. */}
      <div
        className="flex flex-col shrink-0 overflow-hidden"
        style={{
          height: showOutput ? '220px' : '0px',
          background: '#1e1e2e',
          borderTop: showOutput ? '1px solid #2d2d3a' : 'none',
        }}
      >
        {runError && (
          <div
            className="px-3 py-1 text-xs shrink-0"
            style={{
              color: '#f87171',
              background: '#2d1b1b',
              borderBottom: '1px solid #2d2d3a',
              fontFamily: 'Consolas, monospace',
              whiteSpace: 'pre-wrap',
            }}
          >
            {runError}
          </div>
        )}
        <div className="flex-1 min-h-0">
          <Terminal ref={terminalRef} onClose={() => setShowOutput(false)} onRunningChange={setIsRunning} />
        </div>
      </div>
    </div>
  );
}