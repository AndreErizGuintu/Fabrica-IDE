import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Rnd } from 'react-rnd';
import icon from '../../../assets/icon.svg';
import Editor from '../components/editor/Editor';
import Preview from '../components/preview/Preview';
import Sidebar from '../components/sidebar/Sidebar';
import { getFileIcon } from '../utils/fileIcons';
import AIPanel from '../components/ai/AIPanel';
import { useAIPanelState } from '../components/useAIPanelState';
import Terminal, { TerminalHandle } from '../components/terminal/Terminal';
import AdaptiveToast from '../components/adaptive/AdaptiveToast';
import CodeInferencePrompt from '../components/inference/CodeInferencePrompt';
import log from '../assets/log.png';
import FlutterTargetSelector, { 
  FlutterTarget, 
  WINDOWS_TARGET 
} from '../components/flutter/FlutterTargetSelector';
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

const LANGUAGE_NAME_TO_EXT: Record<string, string> = {
  JavaScript: 'js',
  TypeScript: 'ts',
  Dart: 'dart',
  'C#': 'cs',
  PHP: 'php',
  Python: 'py',
  Java: 'java',
  Go: 'go',
  Rust: 'rs',
};

function extractTranslatedCode(raw: string): string {
  const text = raw.trim();
  const closedFence = /```[^\n]*\n([\s\S]*?)```/.exec(text);
  if (closedFence) {
    return closedFence[1].replace(/^\n+/, '').replace(/\s+$/, '');
  }
  const openFence = /^```[^\n]*\n([\s\S]*)$/.exec(text);
  if (openFence) {
    return openFence[1].trim();
  }
  return text;
}

const DETACH_THRESHOLD = 6;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 400;
const DEFAULT_SIDEBAR_WIDTH = 220;
const MIN_RIGHT_PANEL_WIDTH = 280;
const MAX_RIGHT_PANEL_WIDTH = 600;
const DEFAULT_RIGHT_PANEL_WIDTH = 380;

// ============================================================
// MENU BAR COMPONENT - Extracted to avoid hook ordering issues
// ============================================================
function MenuBarComponent() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  const menus = {
    File: {
      items: [
        { label: 'New File', shortcut: 'Ctrl+N', action: () => console.log('New File') },
        { label: 'New Folder', shortcut: 'Ctrl+Shift+N', action: () => console.log('New Folder') },
        { separator: true },
        { label: 'Open File', shortcut: 'Ctrl+O', action: () => console.log('Open File') },
        { label: 'Open Folder', shortcut: 'Ctrl+K Ctrl+O', action: () => console.log('Open Folder') },
        { label: 'Open Recent', shortcut: '', action: () => console.log('Open Recent') },
        { separator: true },
        { label: 'Save', shortcut: 'Ctrl+S', action: () => console.log('Save') },
        { label: 'Save As', shortcut: 'Ctrl+Shift+S', action: () => console.log('Save As') },
        { label: 'Save All', shortcut: 'Ctrl+K S', action: () => console.log('Save All') },
        { separator: true },
        { label: 'Close Editor', shortcut: 'Ctrl+W', action: () => console.log('Close Editor') },
        { label: 'Close Folder/Workspace', shortcut: '', action: () => console.log('Close Folder') },
        { separator: true },
        { label: 'Exit', shortcut: '', action: () => console.log('Exit') },
      ]
    },
    Edit: {
      items: [
        { label: 'Undo', shortcut: 'Ctrl+Z', action: () => console.log('Undo') },
        { label: 'Redo', shortcut: 'Ctrl+Y', action: () => console.log('Redo') },
        { separator: true },
        { label: 'Cut', shortcut: 'Ctrl+X', action: () => console.log('Cut') },
        { label: 'Copy', shortcut: 'Ctrl+C', action: () => console.log('Copy') },
        { label: 'Paste', shortcut: 'Ctrl+V', action: () => console.log('Paste') },
        { separator: true },
        { label: 'Select All', shortcut: 'Ctrl+A', action: () => console.log('Select All') },
        { separator: true },
        { label: 'Find', shortcut: 'Ctrl+F', action: () => console.log('Find') },
        { label: 'Replace', shortcut: 'Ctrl+H', action: () => console.log('Replace') },
        { label: 'Find in Files', shortcut: 'Ctrl+Shift+F', action: () => console.log('Find in Files') },
      ]
    },
    View: {
      items: [
        { label: 'Explorer', shortcut: 'Ctrl+Shift+E', action: () => console.log('Explorer') },
        { label: 'Search', shortcut: 'Ctrl+Shift+F', action: () => console.log('Search') },
        { label: 'Source Control', shortcut: 'Ctrl+Shift+G', action: () => console.log('Source Control') },
        { label: 'Run & Debug', shortcut: 'Ctrl+Shift+D', action: () => console.log('Run & Debug') },
        { label: 'AI Assistant', shortcut: 'Ctrl+Shift+A', action: () => console.log('AI Assistant') },
        { separator: true },
        { label: 'Toggle Sidebar', shortcut: 'Ctrl+B', action: () => console.log('Toggle Sidebar') },
        { label: 'Toggle Panel', shortcut: 'Ctrl+J', action: () => console.log('Toggle Panel') },
        { label: 'Toggle Fullscreen', shortcut: 'F11', action: () => console.log('Toggle Fullscreen') },
        { separator: true },
        { label: 'Zoom In', shortcut: 'Ctrl+=', action: () => console.log('Zoom In') },
        { label: 'Zoom Out', shortcut: 'Ctrl+-', action: () => console.log('Zoom Out') },
        { label: 'Reset Zoom', shortcut: '', action: () => console.log('Reset Zoom') },
      ]
    },
    Run: {
      items: [
        { label: 'Run', shortcut: 'F5', action: () => console.log('Run') },
        { label: 'Run Without Debugging', shortcut: 'Ctrl+F5', action: () => console.log('Run Without Debugging') },
        { label: 'Start Debugging', shortcut: 'F5', action: () => console.log('Start Debugging') },
        { label: 'Stop', shortcut: 'Shift+F5', action: () => console.log('Stop') },
        { label: 'Restart', shortcut: 'Ctrl+Shift+F5', action: () => console.log('Restart') },
        { separator: true },
        { label: 'Configure Run', shortcut: '', action: () => console.log('Configure Run') },
        { label: 'Run Current File', shortcut: '', action: () => console.log('Run Current File') },
      ]
    },
    Terminal: {
      items: [
        { label: 'New Terminal', shortcut: 'Ctrl+`', action: () => console.log('New Terminal') },
        { label: 'Split Terminal', shortcut: 'Ctrl+Shift+5', action: () => console.log('Split Terminal') },
        { label: 'Kill Terminal', shortcut: '', action: () => console.log('Kill Terminal') },
        { label: 'Clear Terminal', shortcut: '', action: () => console.log('Clear Terminal') },
        { separator: true },
        { label: 'Run Active File', shortcut: '', action: () => console.log('Run Active File') },
        { label: 'Terminal Settings', shortcut: '', action: () => console.log('Terminal Settings') },
      ]
    },
    Help: {
      items: [
        { label: 'Documentation', shortcut: '', action: () => console.log('Documentation') },
        { label: 'Keyboard Shortcuts', shortcut: 'Ctrl+K Ctrl+S', action: () => console.log('Keyboard Shortcuts') },
        { label: 'Command Palette', shortcut: 'Ctrl+Shift+P', action: () => console.log('Command Palette') },
        { separator: true },
        { label: 'Report Issue', shortcut: '', action: () => console.log('Report Issue') },
        { label: 'About Fabrica', shortcut: '', action: () => console.log('About Fabrica') },
      ]
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.menu-bar-container')) {
        setOpenMenu(null);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenu(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const toggleMenu = (menuName: string) => {
    setOpenMenu(openMenu === menuName ? null : menuName);
  };

  const renderMenuItem = (item: any, index: number) => {
    if (item.separator) {
      return (
        <div key={`sep-${index}`} className="h-px my-1" style={{ background: '#2d1b4e' }} />
      );
    }

    return (
      <button
        key={item.label}
        type="button"
        className="w-full text-left px-4 py-1 text-xs flex items-center justify-between hover:bg-[#a855f7]/10 transition-colors"
        style={{ 
          color: '#d4d4d4', 
          fontFamily: 'Segoe UI, sans-serif',
          cursor: 'pointer',
        }}
        onClick={() => {
          item.action();
          setOpenMenu(null);
        }}
      >
        <span>{item.label}</span>
        {item.shortcut && (
          <span className="text-[10px]" style={{ color: '#6b7280' }}>{item.shortcut}</span>
        )}
      </button>
    );
  };

  return (
    <div 
      className="menu-bar-container flex items-center gap-1 px-3 py-0.5 shrink-0"
      style={{
        background: '#0a0512',
        borderBottom: '1px solid #1a0a2e',
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '13px',
        color: '#a7adc5',
        minHeight: '28px',
        userSelect: 'none',
      }}
    >
      {Object.keys(menus).map((menuName) => (
        <div
          key={menuName}
          ref={(el) => { menuRefs.current[menuName] = el; }}
          className="relative"
        >
          <button
            type="button"
            className="px-2 py-0.5 rounded transition-colors hover:bg-[#a855f7]/10"
            style={{
              color: openMenu === menuName ? '#a855f7' : '#a7adc5',
            }}
            onClick={() => toggleMenu(menuName)}
          >
            {menuName}
          </button>
          {openMenu === menuName && (
            <div 
              className="absolute top-full left-0 mt-0.5 rounded shadow-lg z-50 py-1 min-w-[220px]"
              style={{
                background: '#12081f',
                border: '1px solid #2d1b4e',
              }}
            >
              {menus[menuName as keyof typeof menus].items.map((item, index) => renderMenuItem(item, index))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// STATUS BAR COMPONENT
// ============================================================
function StatusBarComponent({ 
  activeTab, 
  language, 
  line, 
  col, 
  errors = 0, 
  warnings = 0,
  branch = 'main',
}: { 
  activeTab: Tab | null; 
  language: string; 
  line?: number; 
  col?: number; 
  errors?: number; 
  warnings?: number;
  branch?: string;
}) {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      className="flex items-center justify-between px-4 py-0.5 shrink-0"
      style={{
        background: '#0a0512',
        borderTop: '1px solid #1a0a2e',
        fontSize: '11px',
        color: '#6b7280',
        fontFamily: 'Segoe UI, sans-serif',
        minHeight: '24px',
        userSelect: 'none',
      }}
    >
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#4ade80]" />
          Ready
        </span>
        <span className="text-[#2d1b4e]">|</span>
        <span className="text-[#a7adc5]">{branch}</span>
        <span className="text-[#2d1b4e]">|</span>
        <span style={{ color: '#d4d4d4' }}>
          {activeTab ? language : 'Plain Text'}
        </span>
        <span className="text-[#2d1b4e]">|</span>
        <span style={{ color: '#d4d4d4' }}>Ln {line || 1}, Col {col || 1}</span>
        <span className="text-[#2d1b4e]">|</span>
        <span style={{ color: '#6b7280' }}>UTF-8</span>
        <span className="text-[#2d1b4e]">|</span>
        <span style={{ color: '#6b7280' }}>LF</span>
        <span className="text-[#2d1b4e]">|</span>
        <span style={{ color: '#6b7280' }}>Spaces: 2</span>
      </div>
      <div className="flex items-center gap-4">
        <button
          type="button"
          className="hover:text-white transition-colors px-1.5 py-0.5 rounded hover:bg-[#a855f7]/10"
          style={{ color: errors > 0 ? '#f87171' : '#6b7280' }}
        >
          Errors: {errors}
        </button>
        <button
          type="button"
          className="hover:text-white transition-colors px-1.5 py-0.5 rounded hover:bg-[#a855f7]/10"
          style={{ color: warnings > 0 ? '#fbbf24' : '#6b7280' }}
        >
          Warnings: {warnings}
        </button>
        <span style={{ color: '#a7adc5' }}>
          {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}

// ============================================================
// BREADCRUMB COMPONENT
// ============================================================
function BreadcrumbComponent({ currentPath, projectRoot }: { currentPath: string; projectRoot?: string }) {
  if (!currentPath) return null;

  const relative = projectRoot && currentPath.startsWith(projectRoot)
    ? currentPath.slice(projectRoot.length).replace(/^[\\/]/, '')
    : currentPath;
  const parts = relative.split(/[\\/]/);
  const fileName = parts.pop() || '';
  const folderPath = parts.join(' / ');

  if (!folderPath && !fileName) return null;

  return (
    <div 
      className="flex items-center gap-2 px-4 py-1 shrink-0 overflow-x-auto"
      style={{ 
        background: '#0a0512', 
        borderBottom: '1px solid #1a0a2e',
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '12px',
        color: '#6b7280',
        minHeight: '26px',
      }}
    >
      <span className="text-[#a855f7] inline-flex items-center">
        <i className="codicon codicon-folder" style={{ fontSize: '13px' }} />
      </span>
      <span className="truncate" style={{ maxWidth: '280px' }} title={currentPath}>
        {folderPath || 'workspace'}
      </span>
      {fileName && (
        <>
          <span style={{ color: '#2d1b4e' }}>›</span>
          <span style={{ color: '#d4d4d4' }}>{fileName}</span>
        </>
      )}
      <span className="ml-auto text-[10px] inline-flex items-center gap-1" style={{ color: '#2d1b4e' }}>
        <i className="codicon codicon-git-branch" style={{ fontSize: '12px' }} /> main
      </span>
    </div>
  );
}

// ============================================================
// MAIN EDITOR LAYOUT COMPONENT
// ============================================================
export default function EditorLayout({ onBack, initialFolder }: { onBack: () => void; initialFolder?: string }) {
  // ===== ALL useState HOOKS - MUST BE FIRST AND IN SAME ORDER =====
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [selectedCode, setSelectedCode] = useState('');
  const [sidebarRefreshToken, setSidebarRefreshToken] = useState(0);
  const flutterHotReloadTimerRef = useRef<number | null>(null);
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
  const [flutterTarget, setFlutterTarget] = useState<FlutterTarget>(WINDOWS_TARGET);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [rightPanelWidth, setRightPanelWidth] = useState(DEFAULT_RIGHT_PANEL_WIDTH);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isResizingRightPanel, setIsResizingRightPanel] = useState(false);
  const [floatingPanel, setFloatingPanel] = useState<FloatingPanel | null>(null);
  const [floatPosition, setFloatPosition] = useState<Record<FloatingPanel, { x: number; y: number }>>({
    preview: { x: 100, y: 100 },
    ai: { x: 140, y: 120 },
  });
  const [floatSize, setFloatSize] = useState<Record<FloatingPanel, { width: number; height: number }>>({
    preview: { width: 420, height: 350 },
    ai: { width: 420, height: 350 },
  });
  const [previewZoom, setPreviewZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [armedDetachPanel, setArmedDetachPanel] = useState<FloatingPanel | null>(null);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, col: 1 });
  const [errors, setErrors] = useState(0);
  const [warnings, setWarnings] = useState(0);
  const [notification, setNotification] = useState<{ message: string; type: 'info' | 'success' | 'error' | 'warning' } | null>(null);

  // ===== ALL useRef HOOKS =====
  const terminalRef = useRef<TerminalHandle>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const preFullscreenRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const detachStartRef = useRef({ x: 0, y: 0 });
  const rightPanelContentRef = useRef<HTMLDivElement>(null);
  const notificationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ===== CUSTOM HOOKS =====
  const aiPanelState = useAIPanelState();

  // ===== COMPUTED VALUES =====
  const activeTab = tabs[activeTabIndex] ?? null;
  const isHtmlFile = activeTab
    ? activeTab.filename.endsWith('.html') || activeTab.filename.endsWith('.css')
    : false;

  // ===== FUNCTIONS (not hooks) =====
  const showNotification = useCallback((message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current);
    }
    setNotification({ message, type });
    notificationTimeoutRef.current = setTimeout(() => {
      setNotification(null);
    }, 3000);
  }, []);

  // ===== ALL useEffect HOOKS =====
  useEffect(() => {
    if (initialFolder) {
      window.stats?.startSession(initialFolder);
      showNotification(`Workspace opened: ${initialFolder.split(/[\\/]/).pop()}`, 'success');
    }
  }, [initialFolder]);

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

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = sidebarWidth;
  }, [sidebarWidth]);

  const handleRightPanelResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingRightPanel(true);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = rightPanelWidth;
  }, [rightPanelWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar) {
        const delta = e.clientX - resizeStartX.current;
        const newWidth = Math.min(
          Math.max(resizeStartWidth.current + delta, MIN_SIDEBAR_WIDTH),
          MAX_SIDEBAR_WIDTH
        );
        setSidebarWidth(newWidth);
      }

      if (isResizingRightPanel) {
        const delta = resizeStartX.current - e.clientX;
        const newWidth = Math.min(
          Math.max(resizeStartWidth.current + delta, MIN_RIGHT_PANEL_WIDTH),
          MAX_RIGHT_PANEL_WIDTH
        );
        setRightPanelWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      setIsResizingRightPanel(false);
    };

    if (isResizingSidebar || isResizingRightPanel) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar, isResizingRightPanel]);

  const checkDockPosition = useCallback((x: number, y: number, width: number, height: number) => {
    if (!sidebarRef.current) return null;
    
    const sidebarRect = sidebarRef.current.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    
    const rightPanelX = sidebarRect.right + 50;
    if (x > rightPanelX - 50 && x < rightPanelX + 50) {
      return 'right-panel';
    }
    
    if (x > windowWidth / 2) {
      return 'right-panel';
    }
    
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
    };

    const handleMouseUp = () => {
      setArmedDetachPanel(null);
    };

    if (armedDetachPanel) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [armedDetachPanel, floatSize]);

  const openFileInTab = useCallback((filePath: string, filename: string, content: string) => {
    setTabs((prev) => {
      const existing = prev.findIndex((tab) => tab.path === filePath);
      if (existing !== -1) {
        setActiveTabIndex(existing);
        showNotification(`Switched to ${filename}`, 'info');
        return prev;
      }
      const newTab: Tab = { filename, path: filePath, content, isDirty: false };
      const newTabs = [...prev, newTab];
      setActiveTabIndex(newTabs.length - 1);
      showNotification(`Opened ${filename}`, 'success');
      return newTabs;
    });
  }, []);

  const triggerFlutterHotReload = useCallback((filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (ext !== 'dart') return;

    if (flutterHotReloadTimerRef.current !== null) {
      window.clearTimeout(flutterHotReloadTimerRef.current);
    }

    flutterHotReloadTimerRef.current = window.setTimeout(() => {
      void window.terminal.hotReload();
    }, 400);
  }, []);

  // Saves an AI Translate-mode result to a new file in the SAME directory as
  // the currently active file, deriving the name from the active file's base
  // name + the target language's extension. Prompts before overwriting, opens
  // the new file in a tab, and refreshes the sidebar tree. Returns a result the
  // AI panel surfaces inline. (AI panel = teammate-owned; the file/path/refresh
  // logic lives here in the editor lane where openFileInTab already lives.)
  const handleSaveTranslatedFile = useCallback(
    async (
      content: string,
      language: string,
    ): Promise<{ success: boolean; error?: string; skipped?: boolean }> => {
      const activePath = tabs[activeTabIndex]?.path;
      if (!activePath) {
        return { success: false, error: 'Open a file first so the new filename can be derived from it.' };
      }

      const ext = LANGUAGE_NAME_TO_EXT[language];
      if (!ext) {
        return { success: false, error: `No file extension is known for "${language}".` };
      }

      const cleaned = extractTranslatedCode(content);
      if (!cleaned.trim()) {
        return { success: false, error: 'Nothing to save — the translation was empty.' };
      }

      const sep = activePath.includes('\\') ? '\\' : '/';
      const lastSep = activePath.lastIndexOf(sep);
      const dir = lastSep >= 0 ? activePath.slice(0, lastSep) : '';
      const nameOnly = lastSep >= 0 ? activePath.slice(lastSep + 1) : activePath;
      const dotIdx = nameOnly.lastIndexOf('.');
      const base = dotIdx > 0 ? nameOnly.slice(0, dotIdx) : nameOnly;
      const newName = `${base}.${ext}`;
      const targetPath = dir ? `${dir}${sep}${newName}` : newName;

      const listing = await window.fileSystem.readDir(dir);
      const alreadyExists =
        listing.success && (listing.files ?? []).some((f) => !f.isDirectory && f.name === newName);
      if (alreadyExists) {
        const overwrite = window.confirm(
          `"${newName}" already exists in this folder. Overwrite it?`,
        );
        if (!overwrite) return { success: false, skipped: true };
      }

      const result = await window.fileSystem.writeFile(targetPath, cleaned);
      if (!result.success) {
        return { success: false, error: result.error || 'Failed to write file.' };
      }

      triggerFlutterHotReload(targetPath);
      openFileInTab(targetPath, newName, cleaned);
      setSidebarRefreshToken((n) => n + 1);
      showNotification(`Saved translation to ${newName}`, 'success');
      return { success: true };
    },
    [tabs, activeTabIndex, openFileInTab, triggerFlutterHotReload],
  );

  const handleFileOpen = useCallback(async (filePath: string, filename: string) => {
    const result = await window.fileSystem.readFile(filePath);
    if (result.success && result.content !== undefined) {
      openFileInTab(filePath, filename, result.content);
    } else {
      showNotification(`Failed to open ${filename}`, 'error');
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
      triggerFlutterHotReload(activeTab.path);
      setTabs((prev) =>
        prev.map((tab, index) =>
          index === activeTabIndex ? { ...tab, isDirty: false } : tab,
        ),
      );
      showNotification(`Saved ${activeTab.filename}`, 'success');
    } else {
      showNotification(`Failed to save ${activeTab.filename}`, 'error');
    }
  }, [activeTab, activeTabIndex, triggerFlutterHotReload]);

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
    showNotification(`Running ${activeTab.filename}...`, 'info');
    await terminalRef.current?.run({ language, path: activeTab.path });
  }, [activeTab]);

  const handleFlutterRun = useCallback(async (target: FlutterTarget) => {
    if (!initialFolder) return;
    setRunError(null);
    setShowOutput(true);
    showNotification(`Running Flutter on ${target.name}...`, 'info');
    await terminalRef.current?.run({ language: 'flutter', path: initialFolder, deviceId: target.id });
  }, [initialFolder]);

  const runGitCommand = useCallback(async (
    label: string,
    fn: () => Promise<{ success: boolean; output: string; error?: string }>,
  ) => {
    if (!initialFolder) {
      setShowOutput(true);
      terminalRef.current?.write('No folder open. Open a folder first.\n');
      showNotification('No folder open', 'error');
      return;
    }

    setGitLoading(true);
    setShowOutput(true);
    terminalRef.current?.write(`⎇ git ${label}...\n`);
    showNotification(`Git ${label}...`, 'info');

    try {
      const result = await fn();
      terminalRef.current?.write(`${result.output || result.error || '(no output)'}\n`);
      terminalRef.current?.write(result.success ? '✓ Done\n' : '✗ Failed\n');
      if (result.success) {
        showNotification(`Git ${label} successful`, 'success');
      } else {
        showNotification(`Git ${label} failed`, 'error');
      }
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
    } else {
      showNotification('Failed to open file', 'error');
    }
  }, [openFileInTab]);

  const handleCloseTab = useCallback((index: number) => {
    const tabToClose = tabs[index];
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
    if (tabToClose) {
      showNotification(`Closed ${tabToClose.filename}`, 'info');
    }
  }, [activeTabIndex, tabs]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        if (activeTab) handleSave();
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'b') {
        event.preventDefault();
        setIsSidebarCollapsed((prev) => !prev);
      }
      if ((event.ctrlKey || event.metaKey) && event.key === '`') {
        event.preventDefault();
        setShowOutput((prev) => !prev);
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
    <div className="flex flex-col h-screen overflow-hidden" style={{ backgroundColor: '#0a0512', color: '#d4d4d4' }}>
      <AdaptiveToast
        currentCode={activeTab?.content ?? ''}
        language={activeTab ? getLanguage(activeTab.filename) : 'plaintext'}
      />
      <CodeInferencePrompt />
      
      {/* Notification Toast */}
      {notification && (
        <div
          className="fixed top-4 right-4 z-50 px-4 py-2 rounded shadow-lg transition-all duration-200"
          style={{
            background: notification.type === 'error' ? '#2d1b1b' :
                       notification.type === 'success' ? '#1b2d1b' :
                       notification.type === 'warning' ? '#2d2b1b' : '#1b1b2d',
            border: `1px solid ${
              notification.type === 'error' ? '#f87171' :
              notification.type === 'success' ? '#4ade80' :
              notification.type === 'warning' ? '#fbbf24' : '#a855f7'
            }`,
            color: '#d4d4d4',
            fontFamily: 'Segoe UI, sans-serif',
            fontSize: '13px',
            maxWidth: '400px',
          }}
        >
          <div className="flex items-center gap-2">
            <span>
              {notification.type === 'error' && '❌ '}
              {notification.type === 'success' && '✅ '}
              {notification.type === 'warning' && '⚠️ '}
              {notification.type === 'info' && 'ℹ️ '}
            </span>
            {notification.message}
          </div>
        </div>
      )}
      
      {/* Menu Bar */}
      <MenuBarComponent />
      
      {/* Application Toolbar */}
      <div
        className="flex items-center justify-between px-4 py-1.5 shrink-0"
        style={{ 
          background: '#12081f',
          borderBottom: '1px solid #1a0a2e',
          minHeight: '36px',
        }}
      >
       <div className="flex items-center gap-3">
  <img src={log} alt="Fabrica" className="w-6 h-6 object-contain" />
  <span className="text-sm font-medium" style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif' }}>
    Fabrica
  </span>

</div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleOpenFileDialog}
            className="text-xs px-3 py-1 rounded transition-all duration-200 hover:bg-[#a855f7]/10 hover:text-white flex items-center gap-1.5"
            style={{ color: '#a7adc5' }}
            title="Open File (Ctrl+O)"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            Open File
          </button>
          <div className="w-px h-4" style={{ background: '#1a0a2e' }} />
          <button
            type="button"
            onClick={() => setShowAI((prev) => !prev)}
            className="text-xs px-3 py-1 rounded transition-all duration-200 hover:bg-[#a855f7]/10 flex items-center gap-1.5"
            style={{
              background: showAI ? 'rgba(168, 85, 247, 0.15)' : 'transparent',
              color: showAI ? '#a855f7' : '#a7adc5',
              border: showAI ? '1px solid #a855f7' : 'none',
            }}
            title="Toggle AI Assistant (Ctrl+Shift+A)"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            AI
          </button>
          <button
            type="button"
            onClick={() => setShowGit((prev) => !prev)}
            className="text-xs px-3 py-1 rounded transition-all duration-200 hover:bg-[#a855f7]/10 flex items-center gap-1.5"
            style={{
              background: showGit ? 'rgba(168, 85, 247, 0.15)' : 'transparent',
              color: showGit ? '#a855f7' : '#a7adc5',
              border: showGit ? '1px solid #a855f7' : 'none',
            }}
            title="Toggle Source Control (Ctrl+Shift+G)"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            Git
          </button>
          <div className="w-px h-4" style={{ background: '#1a0a2e' }} />
          <button
            type="button"
            onClick={handleRun}
            disabled={!activeTab}
            className="text-xs px-3 py-1 rounded font-medium transition-all duration-200 hover:bg-[#a855f7]/10 flex items-center gap-1.5"
            style={{
              background: isRunning ? 'transparent' : 'rgba(168, 85, 247, 0.15)',
              color: isRunning ? '#6b7280' : '#a855f7',
              border: isRunning ? '1px solid #1a0a2e' : '1px solid rgba(168, 85, 247, 0.3)',
              cursor: !activeTab ? 'not-allowed' : 'pointer',
              opacity: !activeTab ? 0.4 : 1,
            }}
            title="Run (F5)"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {isRunning ? 'Running' : 'Run'}
          </button>
          <FlutterTargetSelector
            disabled={!initialFolder}
            isRunning={isRunning}
            selected={flutterTarget}
            onTargetChange={setFlutterTarget}
            onRun={handleFlutterRun}
          />
          <button
            type="button"
            className="w-7 h-7 rounded flex items-center justify-center transition-all duration-200 hover:bg-[#a855f7]/10"
            style={{ color: '#6b7280' }}
            aria-label="Settings"
            title="Settings"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
              <path d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm8.5 3.5-.98-.38a7.4 7.4 0 0 0-.66-1.6l.58-.9a1 1 0 0 0-.15-1.24l-1.64-1.64a1 1 0 0 0-1.24-.15l-.9.58a7.4 7.4 0 0 0-1.6-.66L12.5 3.5a1 1 0 0 0-1 0l-1 .39a7.4 7.4 0 0 0-1.6.66l-.9-.58a1 1 0 0 0-1.24.15L4.12 5.76a1 1 0 0 0-.15 1.24l.58.9a7.4 7.4 0 0 0-.66 1.6l-.98.38a1 1 0 0 0-.61.92v2.28a1 1 0 0 0 .61.92l.98.38a7.4 7.4 0 0 0 .66 1.6l-.58.9a1 1 0 0 0 .15 1.24l1.64 1.64a1 1 0 0 0 1.24.15l.9-.58a7.4 7.4 0 0 0 1.6.66l1 .39a1 1 0 0 0 1 0l1-.39a7.4 7.4 0 0 0 1.6-.66l.9.58a1 1 0 0 0 1.24-.15l1.64-1.64a1 1 0 0 0 .15-1.24l-.58-.9a7.4 7.4 0 0 0 .66-1.6l.98-.38a1 1 0 0 0 .61-.92v-2.28a1 1 0 0 0-.61-.92z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Editor Tabs */}
      <div
        className="flex items-center overflow-x-auto shrink-0"
        style={{ 
          background: '#0a0512', 
          borderBottom: '1px solid #1a0a2e',
          padding: '0 4px',
          minHeight: '30px',
        }}
      >
        {tabs.map((tab, index) => {
          const tabIconClass = getFileIcon(tab.filename);
          const isActive = index === activeTabIndex;
          return (
          <div
            key={index}
            className="group flex items-center gap-1.5 px-3 py-1 cursor-pointer text-sm shrink-0 transition-all duration-200"
            style={{
              background: isActive ? '#12081f' : 'transparent',
              color: isActive ? '#ffffff' : '#6b7280',
              borderBottom: isActive ? '2px solid #a855f7' : '2px solid transparent',
              borderRadius: '4px 4px 0 0',
              fontFamily: 'Segoe UI, sans-serif',
            }}
            onClick={() => setActiveTabIndex(index)}
          >
            
            <i
              className={tabIconClass}
              style={{ fontSize: '13px', flexShrink: 0, color: tabIconClass.startsWith('devicon') ? undefined : '#e8e8f0' }}
              
            />
            <span
              className="truncate max-w-28"
              style={tab.isDirty && !isActive ? { fontStyle: 'italic', color: '#a855f7' } : undefined}
            >
              {tab.filename}
            </span>
            {tab.isDirty && (
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#a855f7' }} />
            )}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleCloseTab(index);
              }}
              className="ml-0.5 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity text-[10px]"
              style={{ color: '#6b7280' }}
            >
              <i className="codicon codicon-close" style={{ fontSize: '12px' }} />
            </button>
          </div>
          );
        })}
        {tabs.length === 0 && (
          <div className="text-sm px-3 py-1" style={{ color: '#2d1b4e', fontFamily: 'Segoe UI, sans-serif' }}>
            No files open
          </div>
        )}
      </div>

      {/* Breadcrumb */}
      <BreadcrumbComponent currentPath={activeTab?.path || ''} projectRoot={initialFolder} />

      {/* Main Workspace */}
      <div className="flex flex-1 overflow-hidden">
        {/* Explorer Sidebar */}
        <div 
          ref={sidebarRef}
          className="flex shrink-0 relative"
          style={{ 
            width: isSidebarCollapsed ? 0 : sidebarWidth,
            overflow: 'hidden',
            transition: isResizingSidebar ? 'none' : 'width 0.15s ease',
          }}
        >
          <div className="flex h-full" style={{ width: sidebarWidth }}>
            <Sidebar
              onFileOpen={handleFileOpen}
              initialFolder={initialFolder}
              activeFilePath={activeTab?.path}
              gitStatusFiles={gitStatusFiles}
              refreshSignal={sidebarRefreshToken}
            />
          </div>
          
          {!isSidebarCollapsed && (
            <div
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[#a855f7]/40 transition-colors z-10"
              style={{ 
                background: isResizingSidebar ? 'rgba(168, 85, 247, 0.2)' : 'transparent',
              }}
              onMouseDown={handleSidebarResizeStart}
              title="Drag to resize sidebar"
            />
          )}
        </div>

        {/* Toggle Sidebar Button */}
        <button
          type="button"
          onClick={() => setIsSidebarCollapsed((prev) => !prev)}
          className="w-3 flex items-center justify-center shrink-0 transition-colors hover:bg-[#a855f7]/10"
          style={{
            background: '#0a0512',
            borderLeft: '1px solid #1a0a2e',
            borderRight: isSidebarCollapsed ? 'none' : '1px solid #1a0a2e',
            color: '#6b7280',
          }}
          title={isSidebarCollapsed ? 'Show Sidebar (Ctrl+B)' : 'Hide Sidebar (Ctrl+B)'}
        >
          <i className={`codicon ${isSidebarCollapsed ? 'codicon-chevron-right' : 'codicon-chevron-left'}`} style={{ fontSize: '11px' }} />
        </button>

        {/* Editor Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {tabs.length === 0 ? (
            <div
              className="flex-1 flex flex-col items-center justify-center gap-3"
              style={{ background: '#0a0512' }}
            >
              <div style={{ 
                width: '80px', 
                height: '80px', 
                borderRadius: '50%', 
                background: 'rgba(168, 85, 247, 0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid rgba(168, 85, 247, 0.08)',
              }}>
                <i className="codicon codicon-folder-opened" style={{ fontSize: '40px', color: 'rgba(168, 85, 247, 0.3)' }} />
              </div>
              <div className="text-center" style={{ fontFamily: 'Segoe UI, sans-serif' }}>
                <div className="text-white font-medium text-lg mb-0.5">No file open</div>
                <div className="text-sm" style={{ color: '#6b7280' }}>
                  Open a folder or file to get started
                </div>
              </div>
              <button
                type="button"
                onClick={handleOpenFileDialog}
                className="mt-1 text-sm px-5 py-1.5 rounded transition-all duration-200 hover:scale-105 hover:shadow-[0_0_20px_rgba(168,85,247,0.2)]"
                style={{
                  background: '#a855f7',
                  color: '#ffffff',
                  boxShadow: '0 2px 12px rgba(168, 85, 247, 0.15)',
                  fontFamily: 'Segoe UI, sans-serif',
                }}
              >
                Open File
              </button>
            </div>
          ) : (
            <div className="flex-1 flex overflow-hidden">
              {/* Code Editor */}
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
                  onClick={() => setIsRightPanelCollapsed((prev) => !prev)}
                  className="w-3 flex items-center justify-center shrink-0 transition-colors hover:bg-[#a855f7]/10"
                  style={{
                    background: '#0a0512',
                    borderLeft: '1px solid #1a0a2e',
                    borderRight: isRightPanelCollapsed ? 'none' : '1px solid #1a0a2e',
                    color: '#6b7280',
                  }}
                  title={isRightPanelCollapsed ? 'Show panels' : 'Hide panels'}
                >
                  <i className={`codicon ${isRightPanelCollapsed ? 'codicon-chevron-left' : 'codicon-chevron-right'}`} style={{ fontSize: '11px' }} />
                </button>

                <div
                  className="flex flex-col overflow-hidden transition-all duration-200 ease-out"
                  style={{
                    width: isRightPanelCollapsed ? 0 : rightPanelWidth,
                  }}
                >
                  <div ref={rightPanelContentRef} className="flex flex-col h-full" style={{ width: rightPanelWidth }}>
                    {/* Live Preview Panel */}
                    {floatingPanel !== 'preview' && (
                      <div
                        className="flex-1 flex flex-col min-h-0"
                        onMouseDown={handleDetachMouseDown('preview')}
                        style={{ cursor: armedDetachPanel === 'preview' ? 'grabbing' : 'grab' }}
                        title="Drag to detach the preview"
                      >
                        <div
                          className="flex items-center justify-between px-3 py-1.5 shrink-0"
                          style={{
                            background: '#12081f',
                            borderBottom: '1px solid #1a0a2e',
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-medium" style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif' }}>
                              🔍 Live Preview
                            </span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: '#1a0a2e', color: '#6b7280' }}>
                              {isHtmlFile ? 'HTML' : 'Preview'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className="text-[10px] hover:text-white transition-colors px-1.5 py-0.5 rounded hover:bg-[#a855f7]/10"
                              style={{ color: '#6b7280' }}
                              title="Refresh preview (Ctrl+R)"
                              onClick={() => showNotification('Preview refreshed', 'success')}
                            >
                              ⟳
                            </button>
                            <button
                              type="button"
                              className="text-[10px] hover:text-white transition-colors px-1.5 py-0.5 rounded hover:bg-[#a855f7]/10"
                              style={{ color: '#6b7280' }}
                              title="Open in browser"
                              onClick={() => showNotification('Opening in browser...', 'info')}
                            >
                              ↗
                            </button>
                            <button
                              type="button"
                              className="text-[10px] hover:text-white transition-colors px-1.5 py-0.5 rounded hover:bg-[#a855f7]/10"
                              style={{ color: '#6b7280' }}
                              title="Desktop view"
                            >
                              🖥
                            </button>
                            <button
                              type="button"
                              className="text-[10px] hover:text-white transition-colors px-1.5 py-0.5 rounded hover:bg-[#a855f7]/10"
                              style={{ color: '#6b7280' }}
                              title="Tablet view"
                            >
                              📱
                            </button>
                            <button
                              type="button"
                              className="text-[10px] hover:text-white transition-colors px-1.5 py-0.5 rounded hover:bg-[#a855f7]/10"
                              style={{ color: '#6b7280' }}
                              title="Mobile view"
                            >
                              📱
                            </button>
                          </div>
                        </div>
                        <div className="flex-1 overflow-hidden" style={{ background: '#0a0512' }}>
                          <Preview 
                            key={activeTab?.path + previewHtml}
                            html={previewHtml} 
                            isHtmlFile={isHtmlFile} 
                            zoom={1} 
                          />
                        </div>
                      </div>
                    )}

                    {/* Draggable Divider */}
                    {showAI && floatingPanel !== 'ai' && floatingPanel !== 'preview' && (
                      <div
                        className="h-1 shrink-0 cursor-row-resize hover:bg-[#a855f7]/20 transition-colors"
                        style={{
                          background: '#0a0512',
                          borderTop: '1px solid #1a0a2e',
                          borderBottom: '1px solid #1a0a2e',
                          position: 'relative',
                        }}
                      >
                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-0.5 rounded-full" style={{ background: '#2d1b4e' }} />
                      </div>
                    )}

                    {/* AI Assistant Panel */}
                    {showAI && floatingPanel !== 'ai' && (
                      <div
                        className="flex-1 flex flex-col min-h-0"
                        onMouseDown={handleDetachMouseDown('ai')}
                        style={{ cursor: armedDetachPanel === 'ai' ? 'grabbing' : 'grab' }}
                        title="Drag to detach the AI assistant"
                      >
                        <div className="flex-1 overflow-hidden" style={{ background: '#0a0512' }}>
                          <AIPanel
                            selectedCode={selectedCode}
                            activeFilePath={activeTab?.path}
                            onSaveTranslatedFile={handleSaveTranslatedFile}
                            panelState={aiPanelState}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Panel Resize Handle */}
                {!isRightPanelCollapsed && (
                  <div
                    className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[#a855f7]/40 transition-colors z-10"
                    style={{ 
                      background: isResizingRightPanel ? 'rgba(168, 85, 247, 0.2)' : 'transparent',
                    }}
                    onMouseDown={handleRightPanelResizeStart}
                    title="Drag to resize panel"
                  />
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
              background: '#0a0512',
              borderColor: '#1a0a2e',
            }}
          >
            <div
              className="px-4 py-2 text-[10px] font-medium tracking-wider shrink-0 flex items-center justify-between"
              style={{
                color: '#a7adc5',
                fontFamily: 'Segoe UI, sans-serif',
                borderBottom: '1px solid #1a0a2e',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              <span className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                Source Control
              </span>
              <button
                type="button"
                onClick={() => void refreshGitStatus()}
                className="transition-colors hover:text-white"
                style={{ color: '#6b7280' }}
                title="Refresh"
              >
                <i className="codicon codicon-refresh" style={{ fontSize: '13px' }} />
              </button>
            </div>

            {/* Commit Section */}
            <div className="px-4 pt-2 pb-2 shrink-0 flex flex-col gap-1.5 border-b" style={{ borderColor: '#1a0a2e' }}>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  placeholder="Commit message (Ctrl+Enter)"
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
                  className="flex-1 text-[10px] px-2.5 py-1.5 rounded transition-all duration-200 focus:ring-1 focus:ring-[#a855f7]"
                  style={{
                    background: '#12081f',
                    color: '#d4d4d4',
                    border: '1px solid #1a0a2e',
                    fontFamily: 'Segoe UI, sans-serif',
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
                  className="text-[10px] px-3 py-1.5 rounded font-medium transition-all duration-200 hover:scale-[1.02]"
                  style={{
                    background: gitLoading || !commitMessage.trim() ? '#1a0a2e' : '#a855f7',
                    color: gitLoading || !commitMessage.trim() ? '#6b7280' : '#ffffff',
                    cursor: gitLoading || !commitMessage.trim() ? 'not-allowed' : 'pointer',
                    border: 'none',
                  }}
                >
                  Commit
                </button>
              </div>

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
                    className="flex-1 text-[10px] py-1 rounded transition-all duration-200 hover:bg-[#a855f7]/10"
                    style={{
                      background: '#12081f',
                      color: '#6b7280',
                      border: '1px solid #1a0a2e',
                      opacity: gitLoading ? 0.4 : 1,
                      fontFamily: 'Segoe UI, sans-serif',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Git Status */}
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
                  className="flex items-center gap-2 px-4 py-0.5 text-xs truncate transition-colors hover:bg-[#a855f7]/10"
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
                      className="w-full flex items-center gap-1 px-4 py-1 text-[10px] font-medium"
                      style={{
                        color: '#6b7280',
                        fontFamily: 'Segoe UI, sans-serif',
                        background: '#0a0512',
                        borderTop: '1px solid #1a0a2e',
                        borderBottom: '1px solid #1a0a2e',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      <i className="codicon codicon-chevron-down" style={{ fontSize: '11px' }} />
                      Staged
                      {staged.length > 0 && (
                        <span
                          className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full"
                          style={{ background: '#4ade80', color: '#0a0512' }}
                        >
                          {staged.length}
                        </span>
                      )}
                    </div>
                    <div>
                      {staged.length === 0 ? (
                        <div className="px-4 py-1.5 text-xs" style={{ color: '#2d1b4e', fontFamily: 'Segoe UI, sans-serif' }}>
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
                      className="w-full flex items-center gap-1 px-4 py-1 text-[10px] font-medium transition-colors hover:bg-[#a855f7]/10"
                      style={{
                        color: '#6b7280',
                        fontFamily: 'Segoe UI, sans-serif',
                        background: '#0a0512',
                        borderTop: '1px solid #1a0a2e',
                        borderBottom: gitChangesOpen ? '1px solid #1a0a2e' : 'none',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      <i className={`codicon ${gitChangesOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} style={{ fontSize: '11px' }} />
                      Changes
                      {unstaged.length > 0 && (
                        <span
                          className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full"
                          style={{ background: '#a855f7', color: '#0a0512' }}
                        >
                          {unstaged.length}
                        </span>
                      )}
                    </button>
                    {gitChangesOpen && (
                      <div>
                        {unstaged.length === 0 ? (
                          <div className="px-4 py-1.5 text-xs" style={{ color: '#2d1b4e', fontFamily: 'Segoe UI, sans-serif' }}>
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
                      className="w-full flex items-center gap-1 px-4 py-1 text-[10px] font-medium transition-colors hover:bg-[#a855f7]/10"
                      style={{
                        color: '#6b7280',
                        fontFamily: 'Segoe UI, sans-serif',
                        background: '#0a0512',
                        borderTop: '1px solid #1a0a2e',
                        borderBottom: gitHistoryOpen ? '1px solid #1a0a2e' : 'none',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      <i className={`codicon ${gitHistoryOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} style={{ fontSize: '11px' }} />
                      History
                    </button>
                    {gitHistoryOpen && (
                      <div>
                        {gitLog.length === 0 ? (
                          <div className="px-4 py-1.5 text-xs" style={{ color: '#2d1b4e', fontFamily: 'Segoe UI, sans-serif' }}>
                            No commits
                          </div>
                        ) : (
                          gitLog.map((line, i) => {
                            const sha = line.slice(0, 7);
                            const message = line.slice(8);
                            return (
                              <div
                                key={i}
                                className="flex items-start gap-2 px-4 py-0.5 text-xs hover:bg-[#a855f7]/10"
                                style={{ fontFamily: 'Segoe UI, sans-serif' }}
                              >
                                <span
                                  className="shrink-0 px-1.5 py-0.5 rounded"
                                  style={{ background: '#1a0a2e', color: '#a855f7', fontSize: '9px' }}
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
            backgroundColor: '#12081f',
            border: '1px solid #1a0a2e',
            boxShadow: '0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(168, 85, 247, 0.08)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            userSelect: 'none',
          }}
        >
          <div
            className="float-drag-handle flex items-center justify-between px-4 py-1.5 shrink-0 select-none"
            style={{
              background: '#1a0a2e',
              borderBottom: '1px solid #2d1b4e',
              cursor: isFullscreen ? 'default' : 'move',
            }}
            onDoubleClick={toggleFullscreen}
            title="Drag to move • double-click to toggle fullscreen"
          >
            <span className="text-[10px] font-medium flex items-center gap-2" style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif' }}>
              <span>🔍</span> Live Preview
            </span>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <button type="button" onClick={(e) => { e.stopPropagation(); zoomOut(); }} className="text-[10px] hover:text-white transition-colors px-1.5 py-0.5 rounded" style={{ color: '#6b7280' }} title="Zoom Out">➖</button>
                <span className="text-[10px]" style={{ color: '#6b7280', minWidth: '35px', textAlign: 'center' }}>{Math.round(previewZoom * 100)}%</span>
                <button type="button" onClick={(e) => { e.stopPropagation(); zoomIn(); }} className="text-[10px] hover:text-white transition-colors px-1.5 py-0.5 rounded" style={{ color: '#6b7280' }} title="Zoom In">➕</button>
                <button type="button" onClick={(e) => { e.stopPropagation(); resetZoom(); }} className="text-[10px] hover:text-white transition-colors px-1.5 py-0.5 rounded" style={{ color: '#6b7280' }} title="Reset Zoom">⟲</button>
              </div>
              
              {isFullscreen && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFullscreen();
                  }}
                  className="text-[10px] hover:text-white transition-colors px-1.5 py-0.5 rounded"
                  style={{ color: '#a855f7' }}
                  title="Exit Fullscreen (F11 or Escape)"
                >
                  ⛶ Exit
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-hidden" style={{ background: '#0a0512' }}>
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
            backgroundColor: '#12081f',
            border: '1px solid #1a0a2e',
            boxShadow: '0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(168, 85, 247, 0.08)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            userSelect: 'none',
          }}
        >
          <div
            className="float-drag-handle flex items-center justify-between px-4 py-1.5 shrink-0 select-none"
            style={{
              background: '#1a0a2e',
              borderBottom: '1px solid #2d1b4e',
              cursor: isFullscreen ? 'default' : 'move',
            }}
            onDoubleClick={toggleFullscreen}
            title="Drag to move • double-click to toggle fullscreen"
          >
            <span className="text-[10px] font-medium flex items-center gap-2" style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif' }}>
              <span>✨</span> AI Assistant
            </span>
            <div className="flex items-center gap-2 float-controls">
              {isFullscreen && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFullscreen();
                  }}
                  className="text-[10px] hover:text-white transition-colors px-1.5 py-0.5 rounded"
                  style={{ color: '#a855f7' }}
                  title="Exit Fullscreen (F11 or Escape)"
                >
                  ⛶ Exit
                </button>
              )}
              <button
                type="button"
                onClick={() => { dockPanel(); setShowAI(false); }}
                className="text-[10px] hover:text-white transition-colors"
                style={{ color: '#6b7280' }}
                title="Close AI"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden" style={{ background: '#0a0512' }}>
            <AIPanel
              selectedCode={selectedCode}
              activeFilePath={activeTab?.path}
              onSaveTranslatedFile={handleSaveTranslatedFile}
              panelState={aiPanelState}
            />
          </div>
        </Rnd>
      )}

      {/* Terminal Panel */}
      <div
        className="flex flex-col shrink-0 overflow-hidden"
        style={{
          height: showOutput ? '160px' : '0px',
          background: '#0a0512',
          borderTop: showOutput ? '1px solid #1a0a2e' : 'none',
        }}
      >
        {runError && (
          <div
            className="px-3 py-1 text-xs shrink-0"
            style={{
              color: '#f87171',
              background: '#2d1b1b',
              borderBottom: '1px solid #1a0a2e',
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

      {/* Status Bar */}
      <StatusBarComponent 
        activeTab={activeTab} 
        language={activeTab ? getLanguage(activeTab.filename) : 'Plain Text'}
        line={cursorPosition.line}
        col={cursorPosition.col}
        errors={errors}
        warnings={warnings}
        branch="main"
      />
    </div>
  );
}