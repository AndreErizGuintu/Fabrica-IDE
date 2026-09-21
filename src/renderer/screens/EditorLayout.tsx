import { useEffect, useRef, useState, useCallback, useMemo, Fragment } from 'react';
import { Rnd } from 'react-rnd';
import { loader } from '@monaco-editor/react';
import Editor from '../components/editor/Editor';
import Preview from '../components/preview/Preview';
import WebPreview from '../components/WebPreview';
import Sidebar from '../components/sidebar/Sidebar';
import { getFileIcon } from '../utils/fileIcons';
import AIPanel from '../components/ai/AIPanel';
import { useAIPanelState } from '../components/useAIPanelState';
import TerminalTabs, { TerminalTabsHandle } from '../components/terminal/TerminalTabs';
import StatsDebugPanel from '../components/StatsDebugPanel';
import AdaptiveToast from '../components/adaptive/AdaptiveToast';
import CodeInferencePrompt from '../components/inference/CodeInferencePrompt';
import log from '../assets/log.png';
import FlutterTargetSelector, {
  FlutterTarget, WINDOWS_TARGET, isAndroidPlatform,
} from '../components/flutter/FlutterTargetSelector';
import MirrorButton from '../components/mirror/MirrorButton';
import SourceControlPanel from '../components/git/SourceControlPanel';
import AndroidSdkButton from '../components/AndroidSdkButton';
import AndroidBuildApkModal from '../components/AndroidBuildApkModal';
import SettingsScreen from './SettingsScreen';
import { lintCSharpFile, lintDartFile, lintPhpFile } from '../lsp/csharpLint';
import { Tab } from '../types/index';
import { useTheme } from '../theme/ThemeContext';
import { useEditorSettings } from '../theme/EditorSettingsContext';

type FloatingPanel = 'preview' | 'ai' | 'webPreview';

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

// Wire sentinel returned by fs:readFile (main.ts) for non-text files instead of raw
// bytes force-decoded as UTF-8 -- must match the constant of the same name there.
const NOT_PREVIEWABLE_SENTINEL = '\u0000FABRICA_NOT_PREVIEWABLE\u0000';
const NOT_PREVIEWABLE_MESSAGE = 'Preview not available for this file type.';

const RUNTIME_BY_EXT: Record<string, string> = {
  js: 'node', ts: 'node', php: 'php', cs: 'dotnet', dart: 'dart', java: 'java',
};

const RUN_LANGUAGE_BY_EXT: Record<string, string> = {
  html: 'html', js: 'js', ts: 'ts', tsx: 'tsx', php: 'php', cs: 'cs', dart: 'dart', java: 'java',
};

const LANGUAGE_NAME_TO_EXT: Record<string, string> = {
  JavaScript: 'js', TypeScript: 'ts', Dart: 'dart', 'C#': 'cs',
  PHP: 'php', Python: 'py', Java: 'java', Go: 'go', Rust: 'rs',
};

// Sandboxed .tsx preview: no bundler, no CRA/Vite scaffold. The vendor React/
// ReactDOM/Babel-standalone UMD sources are inlined verbatim so the whole thing
// runs from a single srcDoc with zero network access. Babel.transform runs the
// typescript+react presets in isTSX mode (so plain .tsx type annotations don't
// need a real module resolver), and transform-modules-commonjs turns any
// `export default` into an assignment our tiny module/exports shim can read —
// convention: the previewed file must expose its component as either a default
// export or a top-level `App` identifier, since there is no real module system
// to resolve imports against.
function buildReactSandboxHtml(vendor: { react: string; reactDom: string; babel: string }, source: string): string {
  const escapeScriptClose = (text: string) => text.replace(/<\/script/gi, '<\\/script');
  const escapedSource = escapeScriptClose(JSON.stringify(source));
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 16px; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>${escapeScriptClose(vendor.react)}</script>
  <script>${escapeScriptClose(vendor.reactDom)}</script>
  <script>${escapeScriptClose(vendor.babel)}</script>
  <script>
    (function () {
      try {
        var source = ${escapedSource};
        var result = Babel.transform(source, {
          filename: 'sandbox.tsx',
          presets: [['typescript', { isTSX: true, allExtensions: true }], 'react'],
          plugins: ['transform-modules-commonjs'],
        });
        var mod = { exports: {} };
        var run = new Function('React', 'ReactDOM', 'exports', 'module', result.code);
        run(React, ReactDOM, mod.exports, mod);
        var Component = mod.exports.default || mod.exports.App || window.App;
        if (!Component) {
          throw new Error('No component found. Export a default component or define one named "App".');
        }
        ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Component));
      } catch (err) {
        document.getElementById('root').innerHTML =
          '<pre style="color:#f87171;white-space:pre-wrap;font-family:Consolas,monospace;">' +
          String(err && err.message ? err.message : err).replace(/</g, '&lt;') +
          '</pre>';
      }
    })();
  </script>
</body>
</html>`;
}

// Converts an absolute file path (Windows "C:\Users\x\proj\file.html", or
// POSIX) to a file:// directory URI, terminated with a trailing slash, for
// use as a <base href>. encodeURI (not encodeURIComponent) is deliberate: it
// escapes spaces as %20 but leaves '/' and the drive letter's ':' alone,
// which encodeURIComponent would mangle.
function toFileDirectoryUri(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  const dir = lastSlash === -1 ? normalized : normalized.slice(0, lastSlash);
  const withLeadingSlash = dir.startsWith('/') ? dir : `/${dir}`;
  return `file://${encodeURI(withLeadingSlash)}/`;
}

// Injects <base href> as the very first element inside <head>, so it takes
// effect before any other relative reference in the document -- fixing
// srcDoc's relative paths resolving against about:srcdoc instead of the
// real project folder (images/css/js 404s in Live Preview). Falls back to
// synthesizing a <head> when the source has none, since previewHtml can be
// a bare HTML fragment rather than a guaranteed full document.
function injectBaseHref(html: string, baseUri: string): string {
  const baseTag = `<base href="${baseUri}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}\n    ${baseTag}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (match) => `${match}\n<head>${baseTag}</head>`);
  }
  return `<head>${baseTag}</head>${html}`;
}

function extractTranslatedCode(raw: string): string {
  const text = raw.trim();
  const closedFence = /```[^\n]*\n([\s\S]*?)```/.exec(text);
  if (closedFence) return closedFence[1].replace(/^\n+/, '').replace(/\s+$/, '');
  const openFence = /^```[^\n]*\n([\s\S]*)$/.exec(text);
  if (openFence) return openFence[1].trim();
  return text;
}

// No build-versioning scheme exists yet for Fabrica itself (package.json is
// still the untouched electron-react-boilerplate template and carries no
// real version) -- shown as a plain label in the About modal until one does.
const APP_VERSION = 'Development build';

const DETACH_THRESHOLD = 6;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 400;
const DEFAULT_SIDEBAR_WIDTH = 240;
const MIN_RIGHT_PANEL_WIDTH = 280;
const MAX_RIGHT_PANEL_WIDTH = 600;
const DEFAULT_RIGHT_PANEL_WIDTH = 380;
const AUTOSAVE_DELAY_MS = 1200;

interface MenuBarProps {
  onOpenFile: () => void;
  onSave: () => void;
  onCloseEditor: () => void;
  onCloseFolder: () => void;
  onOpenSettings: () => void;
  hasActiveTab: boolean;
  onToggleSidebar: () => void;
  onToggleTerminal: () => void;
  onToggleAI: () => void;
  onToggleStats: () => void;
  onTogglePreview: () => void;
  onToggleGit: () => void;
  onRun: () => void;
  onStop: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onFind: () => void;
  onNewTerminalTab: () => void;
  onKillActiveTerminalTab: () => void;
  hasOpenTerminal: boolean;
  isFlutterProject: boolean;
  projectPath?: string;
  autoSaveEnabled: boolean;
  onToggleAutoSave: () => void;
}

function MenuBarComponent({
  onOpenFile, onSave, onCloseEditor, onCloseFolder, onOpenSettings, hasActiveTab,
  onToggleSidebar, onToggleTerminal, onToggleAI, onToggleStats, onTogglePreview, onToggleGit,
  onRun, onStop, onUndo, onRedo, onCut, onCopy, onPaste, onFind,
  onNewTerminalTab, onKillActiveTerminalTab, hasOpenTerminal,
  isFlutterProject, projectPath, autoSaveEnabled, onToggleAutoSave,
}: MenuBarProps) {
  const { theme } = useTheme();
  const C = theme.ui;
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [showBuildApkModal, setShowBuildApkModal] = useState(false);
  const menuRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  const menus = {
    File: { items: [
      { label: 'New File', shortcut: 'Ctrl+N', disabled: true },
      { label: 'New Folder', shortcut: 'Ctrl+Shift+N', disabled: true },
      { separator: true },
      { label: 'Open File', shortcut: 'Ctrl+O', action: onOpenFile },
      { label: 'Open Folder', shortcut: 'Ctrl+K Ctrl+O', disabled: true },
      { label: 'Open Recent', shortcut: '', disabled: true },
      { separator: true },
      { label: 'Save', shortcut: 'Ctrl+S', action: onSave },
      { label: 'Save As', shortcut: 'Ctrl+Shift+S', disabled: true },
      { label: 'Autosave', shortcut: autoSaveEnabled ? 'On' : 'Off', action: onToggleAutoSave, checked: autoSaveEnabled },
      { separator: true },
      { label: 'Close Editor', shortcut: 'Ctrl+W', action: onCloseEditor },
      { label: 'Close Folder/Workspace', shortcut: '', action: onCloseFolder },
      { separator: true },
      { label: 'Settings', shortcut: 'Ctrl+,', action: onOpenSettings },
      { separator: true },
      { label: 'Exit', shortcut: '', disabled: true },
    ]},
    Edit: { items: [
      { label: 'Undo', shortcut: 'Ctrl+Z', action: onUndo, disabled: !hasActiveTab },
      { label: 'Redo', shortcut: 'Ctrl+Y', action: onRedo, disabled: !hasActiveTab },
      { separator: true },
      { label: 'Cut', shortcut: 'Ctrl+X', action: onCut, disabled: !hasActiveTab },
      { label: 'Copy', shortcut: 'Ctrl+C', action: onCopy, disabled: !hasActiveTab },
      { label: 'Paste', shortcut: 'Ctrl+V', action: onPaste, disabled: !hasActiveTab },
      { separator: true },
      { label: 'Find', shortcut: 'Ctrl+F', action: onFind, disabled: !hasActiveTab },
      { label: 'Replace', shortcut: 'Ctrl+H', disabled: true },
    ]},
    View: { items: [
      { label: 'Explorer', shortcut: 'Ctrl+Shift+E', action: onToggleSidebar },
      { label: 'Source Control', shortcut: 'Ctrl+Shift+G', action: onToggleGit },
      { label: 'AI Assistant', shortcut: 'Ctrl+Shift+A', action: onToggleAI },
      { label: 'Preview', shortcut: '', action: onTogglePreview },
      { label: 'Stats Dashboard', shortcut: '', action: onToggleStats },
      { separator: true },
      { label: 'Toggle Sidebar', shortcut: 'Ctrl+B', action: onToggleSidebar },
      { label: 'Toggle Terminal', shortcut: 'Ctrl+`', action: onToggleTerminal },
      { label: 'Toggle Fullscreen', shortcut: 'F11', disabled: true },
    ]},
    Run: { items: [
      { label: 'Run', shortcut: 'F5', action: onRun, disabled: !hasActiveTab },
      { label: 'Stop', shortcut: 'Shift+F5', action: onStop },
      { separator: true },
      { label: 'Run Current File', shortcut: '', action: onRun, disabled: !hasActiveTab },
      { separator: true },
      { label: 'Build APK', shortcut: '', action: () => setShowBuildApkModal(true), disabled: !isFlutterProject },
    ]},
    Terminal: { items: [
      { label: 'New Terminal', shortcut: 'Ctrl+`', action: onNewTerminalTab },
      { label: 'Kill Terminal', shortcut: '', action: onKillActiveTerminalTab, disabled: !hasOpenTerminal },
      { separator: true },
      { label: 'Run Active File', shortcut: '', action: onRun, disabled: !hasActiveTab },
    ]},
    Help: { items: [
      { label: 'Documentation', shortcut: '', disabled: true },
      { label: 'Keyboard Shortcuts', shortcut: 'Ctrl+K Ctrl+S', disabled: true },
      { separator: true },
      { label: 'About Fabrica', shortcut: '', action: () => setAboutOpen(true) },
      { label: 'Report Issue', shortcut: '', action: () => { void window.appLinks.openIssues(); } },
    ]}
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.menu-bar-container')) setOpenMenu(null);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenMenu(null); };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const toggleMenu = (menuName: string) => setOpenMenu(openMenu === menuName ? null : menuName);

  const renderMenuItem = (item: any, index: number) => {
    if (item.separator) return <div key={`sep-${index}`} className="h-px my-1" style={{ background: C.border }} />;
    if (item.disabled) {
      return (
        <div key={item.label} className="w-full text-left px-4 py-1.5 text-xs flex items-center justify-between"
          style={{ color: C.textMuted, fontFamily: 'Segoe UI, sans-serif', cursor: 'default' }}>
          <span>{item.label}</span>
          {item.shortcut && <span className="text-[10px]" style={{ color: C.textMuted }}>{item.shortcut}</span>}
        </div>
      );
    }
    return (
      <button key={item.label} type="button"
        className="w-full text-left px-4 py-1.5 text-xs flex items-center justify-between transition-colors"
        style={{ color: C.textPrimary, fontFamily: 'Segoe UI, sans-serif', cursor: 'pointer' }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.12)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        onClick={() => { item.action(); setOpenMenu(null); }}>
        <span>{item.checked !== undefined ? `${item.checked ? '✓' : ' '} ${item.label}` : item.label}</span>
        {item.shortcut && <span className="text-[10px]" style={{ color: C.textMuted }}>{item.shortcut}</span>}
      </button>
    );
  };

  return (
    <Fragment>
      <div className="menu-bar-container flex items-center gap-0.5 px-3 shrink-0"
        style={{
          background: C.bgTopBar,
          fontFamily: 'Segoe UI, sans-serif',
          fontSize: '13px',
          color: C.textSecondary,
          height: '38px',
          userSelect: 'none',
        }}>
        {Object.keys(menus).map((menuName) => (
          <div key={menuName} ref={(el) => { menuRefs.current[menuName] = el; }} className="relative">
            <button type="button"
              className="px-2.5 py-1 rounded transition-colors"
              style={{
                color: openMenu === menuName ? C.accentAI : C.textSecondary,
                background: openMenu === menuName ? 'rgba(168, 85, 247, 0.12)' : 'transparent',
              }}
              onClick={() => toggleMenu(menuName)}>
              {menuName}
            </button>
            {openMenu === menuName && (
              <div className="absolute top-full left-0 mt-1 rounded-lg shadow-2xl z-50 py-1 min-w-[220px]"
                style={{
                  background: C.bgCard,
                  border: `1px solid ${C.border}`,
                  boxShadow: '0 12px 40px rgba(0,0,0,0.75)',
                }}>
                {menus[menuName as keyof typeof menus].items.map((item, index) => renderMenuItem(item, index))}
              </div>
            )}
          </div>
        ))}
      </div>

      {aboutOpen && (
        <div
          role="presentation"
          onClick={() => setAboutOpen(false)}
          className="fixed inset-0 flex items-center justify-center z-200"
          style={{ background: 'rgba(0,0,0,0.55)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="rounded-lg shadow-2xl px-6 py-5 min-w-70"
            style={{ background: C.bgCard, border: `1px solid ${C.border}` }}
          >
            <h2 className="text-sm font-semibold mb-1" style={{ color: C.textPrimary }}>Fabrica IDE</h2>
            <p className="text-xs mb-1" style={{ color: C.textSecondary }}>{APP_VERSION}</p>
            <p className="text-xs mb-4" style={{ color: C.textMuted }}>A capstone thesis project.</p>
            <button type="button" onClick={() => setAboutOpen(false)}
              className="text-xs px-3 py-1 rounded transition-colors"
              style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>
              Close
            </button>
          </div>
        </div>
      )}

      <AndroidBuildApkModal
        isOpen={showBuildApkModal}
        projectPath={projectPath ?? ''}
        onClose={() => setShowBuildApkModal(false)}
      />
    </Fragment>
  );
}

function StatusBarComponent({
  activeTab, language, line, col, branch = 'main',
}: {
  activeTab: Tab | null; language: string; line?: number; col?: number; branch?: string;
}) {
  const { theme } = useTheme();
  const C = theme.ui;
  return (
    <div className="flex items-center justify-between px-4 shrink-0"
      style={{
        background: C.bgTopBar,
        fontSize: '11px',
        color: C.textMuted,
        fontFamily: 'Segoe UI, sans-serif',
        height: '26px',
        userSelect: 'none',
      }}>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5" style={{ color: C.accentAI }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.success }} />
          {activeTab ? language.toUpperCase() : 'PLAIN TEXT'}
        </span>
        <span style={{ color: C.border }}>·</span>
        <span style={{ color: C.textPrimary }}>Ln {line || 1}, Col {col || 1}</span>
        <span style={{ color: C.border }}>·</span>
        <span>Spaces: 4</span>
        <span style={{ color: C.border }}>·</span>
        <span>UTF-8</span>
        <span style={{ color: C.border }}>·</span>
        <span>LF</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <i className="codicon codicon-git-branch" style={{ fontSize: 12, color: C.textSecondary }} />
          <span style={{ color: C.textPrimary }}>{branch}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.success }} />
          <span style={{ color: C.success }}>Live</span>
        </span>
        <i className="codicon codicon-bell" style={{ fontSize: 12, color: C.textSecondary }} />
      </div>
    </div>
  );
}

function BreadcrumbComponent({ currentPath, projectRoot }: { currentPath: string; projectRoot?: string }) {
  if (!currentPath) return null;

  const relative = projectRoot && currentPath.startsWith(projectRoot)
    ? currentPath.slice(projectRoot.length).replace(/^[\\/]/, '')
    : currentPath;
  const parts = relative.split(/[\\/]/).filter(Boolean);
  const fileName = parts.pop() || '';
  if (!fileName && parts.length === 0) return null;

  const folderSegments = parts.map((name, idx) => ({
    name,
    fullPath: parts.slice(0, idx + 1).join('/'),
  }));
  const fileIconClass = getFileIcon(fileName);

  return (
    <div
      className="flex items-center shrink-0 overflow-x-auto"
      style={{
        padding: '0 12px',
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '11px',
        height: 22,
        lineHeight: '22px',
        color: '#77718F',
        whiteSpace: 'nowrap',
        gap: 4,
        background: '#080719',
      }}
    >
      {folderSegments.map((seg) => (
        <Fragment key={seg.fullPath}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              color: '#77718F',
              fontSize: '11px',
              padding: '0 4px',
              borderRadius: 3,
              height: 18,
              lineHeight: '18px',
              cursor: 'pointer',
              transition: 'background 0.1s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(168, 85, 247, 0.12)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <i className="codicon codicon-folder" style={{ fontSize: '12px', color: '#77718F', lineHeight: 1 }} />
            {seg.name}
          </span>
          <span style={{ color: '#77718F', fontSize: '11px', userSelect: 'none', lineHeight: 1 }}>›</span>
        </Fragment>
      ))}
      {fileName && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            color: '#77718F',
            fontSize: '11px',
            padding: '0 4px',
            height: 18,
            lineHeight: '18px',
          }}
        >
          <i className={fileIconClass} style={{ fontSize: '12px', color: '#77718F', lineHeight: 1 }} />
          {fileName}
        </span>
      )}
    </div>
  );
}

function ToolWindowHeader({
  icon, title, mode, onMinimize, onMaximizeFullscreen, onClose,
  dragHandleClassName, onHeaderDoubleClick, leftExtra, children,
}: {
  icon: string; title: string; mode: 'docked' | 'floating';
  onMinimize?: () => void; onMaximizeFullscreen: () => void; onClose: () => void;
  dragHandleClassName?: string; onHeaderDoubleClick?: () => void;
  leftExtra?: React.ReactNode; children?: React.ReactNode;
}) {
  const { theme } = useTheme();
  const C = theme.ui;
  return (
    <div
      className={`flex items-center justify-between px-3 shrink-0 select-none ${dragHandleClassName ?? ''}`}
      style={{
        background: C.bgCard,
        borderBottom: `1px solid ${C.border}`,
        height: '36px',
        cursor: mode === 'floating' ? 'move' : 'default',
      }}
      onDoubleClick={onHeaderDoubleClick}>
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-medium flex items-center gap-2"
          style={{ color: C.textPrimary, fontFamily: 'Segoe UI, sans-serif' }}>
          <span style={{ color: C.codePurple }}>{icon}</span> {title}
        </span>
        {leftExtra}
      </div>
      <div className="flex items-center gap-0.5 float-controls">
        {children}
        {onMinimize && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onMinimize(); }}
            className="w-6 h-6 flex items-center justify-center text-[12px] transition-colors rounded"
            style={{ color: C.textSecondary }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(168, 85, 247, 0.15)'; e.currentTarget.style.color = C.textPrimary; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textSecondary; }}
            title="Minimize">−</button>
        )}
        <button type="button" onClick={(e) => { e.stopPropagation(); onMaximizeFullscreen(); }}
          className="w-6 h-6 flex items-center justify-center text-[11px] transition-colors rounded"
          style={{ color: C.textSecondary }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(168, 85, 247, 0.15)'; e.currentTarget.style.color = C.textPrimary; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textSecondary; }}
          title={mode === 'floating' ? 'Toggle fullscreen' : 'Detach'}>□</button>
        <button type="button" onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="w-6 h-6 flex items-center justify-center text-[12px] transition-colors rounded"
          style={{ color: C.textSecondary }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(168, 85, 247, 0.15)'; e.currentTarget.style.color = C.textPrimary; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textSecondary; }}
          title="Close">✕</button>
      </div>
    </div>
  );
}

export default function EditorLayout({ onBack, initialFolder }: { onBack: () => void; initialFolder?: string }) {
  const { theme } = useTheme();
  const C = theme.ui;
  const { autoSave, setAutoSave } = useEditorSettings();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [selectedCode, setSelectedCode] = useState('');
  const [sidebarRefreshToken, setSidebarRefreshToken] = useState(0);
  const flutterHotReloadTimerRef = useRef<number | null>(null);
  const csharpLintTimerRef = useRef<number | null>(null);
  const dartLintTimerRef = useRef<number | null>(null);
  const phpLintTimerRef = useRef<number | null>(null);
  const [showAI, setShowAI] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showWebPreview, setShowWebPreview] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [showGit, setShowGit] = useState(false);
  const [gitStatusFiles, setGitStatusFiles] = useState<string[]>([]);
  const [gitRefreshToken, setGitRefreshToken] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [flutterTarget, setFlutterTarget] = useState<FlutterTarget>(WINDOWS_TARGET);
  const [isFlutterProject, setIsFlutterProject] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [rightPanelWidth, setRightPanelWidth] = useState(DEFAULT_RIGHT_PANEL_WIDTH);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isResizingRightPanel, setIsResizingRightPanel] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(190);
  const [isResizingTerminal, setIsResizingTerminal] = useState(false);
  const terminalResizeStartY = useRef(0);
  const terminalResizeStartHeight = useRef(190);
  const [floatingPanel, setFloatingPanel] = useState<FloatingPanel | null>(null);
  const [floatPosition, setFloatPosition] = useState<Record<FloatingPanel, { x: number; y: number }>>({
    preview: { x: 100, y: 100 }, ai: { x: 140, y: 120 }, webPreview: { x: 180, y: 140 },
  });
  const [floatSize, setFloatSize] = useState<Record<FloatingPanel, { width: number; height: number }>>({
    preview: { width: 420, height: 350 }, ai: { width: 420, height: 350 }, webPreview: { width: 420, height: 350 },
  });
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isFloatMinimized, setIsFloatMinimized] = useState(false);
  const [armedDetachPanel, setArmedDetachPanel] = useState<FloatingPanel | null>(null);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, col: 1 });
  const [notification, setNotification] = useState<{ message: string; type: 'info' | 'success' | 'error' | 'warning' } | null>(null);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  // Blob URL (not the raw HTML) — see handleRunReactSandbox. A srcDoc document
  // inherits the main app's CSP and can only add restrictions, never loosen it,
  // which blocks Babel's eval-based transpile; navigating to its own blob: URL
  // makes it a separate document governed only by its own CSP meta tag.
  const [tsxPreviewUrl, setTsxPreviewUrl] = useState<string | null>(null);
  const tsxPreviewUrlRef = useRef<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Hover state for VS Code-like toggle strips
  const [hoverStrip, setHoverStrip] = useState<'left' | 'right' | null>(null);

  const terminalRef = useRef<TerminalTabsHandle>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);
  const stripMouseDownRef = useRef<{ x: number; active: boolean; moved: boolean }>({ x: 0, active: false, moved: false });
  const rightStripMouseDownRef = useRef<{ x: number; active: boolean; moved: boolean }>({ x: 0, active: false, moved: false });
  const sidebarRef = useRef<HTMLDivElement>(null);
  const preFullscreenRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const detachStartRef = useRef({ x: 0, y: 0 });
  const notificationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const wasDirtyRef = useRef<boolean>(false);

  const aiPanelState = useAIPanelState();
  const activeTab = tabs[activeTabIndex] ?? null;
  // Broadened to include .tsx so Preview renders its sandboxed output instead of
  // the "not available" placeholder once handleRunReactSandbox has populated
  // tsxPreviewUrl. Unlike .html/.css this does NOT auto-show Preview on open —
  // see the auto-show effect below, which checks its own narrower condition.
  const isHtmlFile = activeTab
    ? activeTab.filename.endsWith('.html') || activeTab.filename.endsWith('.css') || activeTab.filename.endsWith('.tsx')
    : false;

  const showNotification = useCallback((message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    if (notificationTimeoutRef.current) clearTimeout(notificationTimeoutRef.current);
    setNotification({ message, type });
    notificationTimeoutRef.current = setTimeout(() => setNotification(null), 2000);
  }, []);

  // Auto-show Preview when an HTML/CSS file opens. Auto-hide when switching away.
  // .tsx is deliberately excluded here — its preview is Run-triggered only
  // (handleRunReactSandbox), never shown just from opening the file.
  useEffect(() => {
    const isAutoPreviewFile = activeTab
      ? activeTab.filename.endsWith('.html') || activeTab.filename.endsWith('.css')
      : false;
    if (isAutoPreviewFile) {
      setPreviewLoaded(true);
      setPreviewRefreshKey((prev) => prev + 1);
      setShowPreview(true);
    } else {
      setPreviewLoaded(false);
      setShowPreview(false);
    }
  }, [activeTab?.path, isHtmlFile]);

  useEffect(() => {
    const isDirty = activeTab?.isDirty ?? false;
    if (wasDirtyRef.current && !isDirty && isHtmlFile && previewLoaded) {
      setPreviewRefreshKey((prev) => prev + 1);
    }
    wasDirtyRef.current = isDirty;
  }, [activeTab?.isDirty, isHtmlFile, previewLoaded]);

  useEffect(() => {
    if (initialFolder) {
      window.stats?.startSession(initialFolder);
      window.lsp?.startDart();
      window.lsp?.startPhp();
      showNotification(`Workspace opened: ${initialFolder.split(/[\\/]/).pop()}`, 'success');
    }
  }, [initialFolder]);

  // No existing Flutter-project detector -- useFlutterDevices.ts only polls
  // connected devices, so this is the single check for "does the open folder
  // have a pubspec.yaml at its root".
  useEffect(() => {
    let cancelled = false;
    if (!initialFolder) { setIsFlutterProject(false); return; }
    (async () => {
      const result = await window.fileSystem.readDir(initialFolder);
      if (cancelled) return;
      const hasPubspec = !!result.success && !!result.files?.some(
        (f) => !f.isDirectory && f.name.toLowerCase() === 'pubspec.yaml'
      );
      setIsFlutterProject(hasPubspec);
    })();
    return () => { cancelled = true; };
  }, [initialFolder, sidebarRefreshToken]);

  const previewHtml = useMemo(() => {
    if (!activeTab) return '';
    if (activeTab.filename.endsWith('.tsx')) {
      // Rendered via the src (blob URL) prop instead — see tsxPreviewUrl.
      return '';
    }
    const baseUri = activeTab.path ? toFileDirectoryUri(activeTab.path) : '';
    if (activeTab.filename.endsWith('.css')) {
      return `<!DOCTYPE html>
<html>
<head>
    ${baseUri ? `<base href="${baseUri}">` : ''}
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 40px; background: #f5f5f5; min-height: 100vh;
            display: flex; justify-content: center; align-items: center;
        }
        .preview-container {
            max-width: 800px; width: 100%; background: white;
            border-radius: 12px; padding: 40px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        ${activeTab.content}
    </style>
</head>
<body>
    <div class="preview-container">
        <h1>CSS Preview</h1>
        <p style="color: #666; margin: 16px 0;">Your styles are applied to this page.</p>
    </div>
</body>
</html>`;
    }
    return baseUri ? injectBaseHref(activeTab.content, baseUri) : activeTab.content;
  }, [activeTab]);

  const tsxPreviewSrc = activeTab?.filename.endsWith('.tsx') ? tsxPreviewUrl ?? undefined : undefined;

  const handleSidebarStripMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    stripMouseDownRef.current = { x: e.clientX, active: true, moved: false };
    resizeStartX.current = e.clientX; resizeStartWidth.current = sidebarWidth;
  }, [sidebarWidth]);

  const handleRightStripMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    rightStripMouseDownRef.current = { x: e.clientX, active: true, moved: false };
    resizeStartX.current = e.clientX; resizeStartWidth.current = rightPanelWidth;
  }, [rightPanelWidth]);

  // Distinguish a pure click (toggle collapse) from a drag (resize) on the toggle strips.
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const left = stripMouseDownRef.current;
      if (left.active && !left.moved && Math.abs(e.clientX - left.x) > 4) {
        left.moved = true;
        setIsResizingSidebar(true);
      }
      const right = rightStripMouseDownRef.current;
      if (right.active && !right.moved && Math.abs(e.clientX - right.x) > 4) {
        right.moved = true;
        setIsResizingRightPanel(true);
      }
    };
    const handleMouseUp = () => {
      const left = stripMouseDownRef.current;
      if (left.active) {
        if (!left.moved) setIsSidebarCollapsed((prev) => !prev);
        stripMouseDownRef.current = { x: 0, active: false, moved: false };
      }
      const right = rightStripMouseDownRef.current;
      if (right.active) {
        if (!right.moved) setIsRightPanelCollapsed((prev) => !prev);
        rightStripMouseDownRef.current = { x: 0, active: false, moved: false };
      }
      setIsResizingSidebar(false);
      setIsResizingRightPanel(false);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar) {
        const delta = e.clientX - resizeStartX.current;
        setSidebarWidth(Math.min(Math.max(resizeStartWidth.current + delta, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH));
      }
      if (isResizingRightPanel) {
        const delta = resizeStartX.current - e.clientX;
        setRightPanelWidth(Math.min(Math.max(resizeStartWidth.current + delta, MIN_RIGHT_PANEL_WIDTH), MAX_RIGHT_PANEL_WIDTH));
      }
    };
    const handleMouseUp = () => { setIsResizingSidebar(false); setIsResizingRightPanel(false); };
    if (isResizingSidebar || isResizingRightPanel) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar, isResizingRightPanel]);

  const handleTerminalResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingTerminal(true);
    terminalResizeStartY.current = e.clientY;
    terminalResizeStartHeight.current = terminalHeight;
  }, [terminalHeight]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingTerminal) return;
      const delta = terminalResizeStartY.current - e.clientY;
      const newHeight = Math.min(Math.max(terminalResizeStartHeight.current + delta, 80), 600);
      setTerminalHeight(newHeight);
    };
    const handleMouseUp = () => setIsResizingTerminal(false);
    if (isResizingTerminal) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingTerminal]);

  const checkDockPosition = useCallback((x: number, y: number, width: number, height: number) => {
    if (!sidebarRef.current) return null;
    const sidebarRect = sidebarRef.current.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const rightPanelX = sidebarRect.right + 50;
    if (x > rightPanelX - 50 && x < rightPanelX + 50) return 'right-panel';
    if (x > windowWidth / 2) return 'right-panel';
    return null;
  }, []);

  const dockPanel = useCallback(() => {
    setFloatingPanel(null); setIsFullscreen(false);
    preFullscreenRef.current = null; setIsFloatMinimized(false);
  }, []);

  const detachToFloat = useCallback((panel: FloatingPanel) => {
    setFloatingPanel(panel); setIsFloatMinimized(false);
  }, []);

  const handleToggleAI = useCallback(() => {
    if (floatingPanel === 'ai' && isFloatMinimized) { setIsFloatMinimized(false); return; }
    setShowAI((prev) => !prev);
  }, [floatingPanel, isFloatMinimized]);

  const handleTogglePreview = useCallback(() => {
    if (floatingPanel === 'preview' && isFloatMinimized) { setIsFloatMinimized(false); return; }
    setShowPreview((prev) => !prev);
  }, [floatingPanel, isFloatMinimized]);

  const handleToggleWebPreview = useCallback(() => {
    if (floatingPanel === 'webPreview' && isFloatMinimized) { setIsFloatMinimized(false); return; }
    setShowWebPreview((prev) => !prev);
  }, [floatingPanel, isFloatMinimized]);

  // Editor.tsx never forwards a ref to its underlying Monaco instance, and
  // adding one is out of scope here (components/ is off-limits for this
  // change). monaco.editor.getEditors() is the module-level Monaco registry
  // -- it works without a ref, and EditorLayout only ever mounts one <Editor>
  // at a time, so [0] is always the live instance for the active tab.
  const triggerMonacoAction = useCallback((actionId: string) => {
    void loader.init().then((monaco) => {
      monaco.editor.getEditors()[0]?.getAction(actionId)?.run();
    });
  }, []);

  const triggerMonacoCommand = useCallback((commandId: 'undo' | 'redo') => {
    void loader.init().then((monaco) => {
      monaco.editor.getEditors()[0]?.trigger('menu', commandId, null);
    });
  }, []);

  const handleMenuUndo = useCallback(() => triggerMonacoCommand('undo'), [triggerMonacoCommand]);
  const handleMenuRedo = useCallback(() => triggerMonacoCommand('redo'), [triggerMonacoCommand]);
  const handleMenuCut = useCallback(
    () => triggerMonacoAction('editor.action.clipboardCutAction'), [triggerMonacoAction],
  );
  const handleMenuCopy = useCallback(
    () => triggerMonacoAction('editor.action.clipboardCopyAction'), [triggerMonacoAction],
  );
  const handleMenuPaste = useCallback(
    () => triggerMonacoAction('editor.action.clipboardPasteAction'), [triggerMonacoAction],
  );
  const handleMenuFind = useCallback(() => triggerMonacoAction('actions.find'), [triggerMonacoAction]);

  const handleDetachMouseDown = useCallback((panel: FloatingPanel) => (e: React.MouseEvent) => {
    if (floatingPanel === panel) return;
    if ((e.target as HTMLElement).closest('.float-controls')) return;
    detachStartRef.current = { x: e.clientX, y: e.clientY };
    setArmedDetachPanel(panel);
  }, [floatingPanel]);

  const toggleFullscreen = useCallback((explicitPanel?: FloatingPanel) => {
    const panel = explicitPanel ?? floatingPanel;
    if (!panel) return;
    setIsFullscreen((prev) => {
      const next = !prev;
      if (next) {
        preFullscreenRef.current = {
          x: floatPosition[panel]?.x ?? 100, y: floatPosition[panel]?.y ?? 100,
          width: floatSize[panel]?.width ?? 420, height: floatSize[panel]?.height ?? 350,
        };
        return true;
      } else if (preFullscreenRef.current) {
        const r = preFullscreenRef.current;
        setFloatPosition((p) => ({ ...p, [panel]: { x: r.x, y: r.y } }));
        setFloatSize((p) => ({ ...p, [panel]: { width: r.width, height: r.height } }));
        preFullscreenRef.current = null;
        return false;
      }
      return false;
    });
  }, [floatingPanel, floatPosition, floatSize]);

  const handleFloatDragStop = useCallback((_e: any, data: any) => {
    if (!floatingPanel || isFullscreen) return;
    const panel = floatingPanel;
    const panelSize = floatSize[panel];
    if (!panelSize) return;
    const dockTarget = checkDockPosition(data.x, data.y, panelSize.width, panelSize.height);
    if (dockTarget) {
      setFloatingPanel(null); setIsFullscreen(false); preFullscreenRef.current = null;
    } else {
      setFloatPosition((p) => ({ ...p, [panel]: { x: data.x, y: data.y } }));
    }
  }, [floatingPanel, isFullscreen, floatSize, checkDockPosition]);

  const handleFloatResizeStop = useCallback((_e: any, _d: any, ref: any, _dd: any, position: any) => {
    if (!floatingPanel || isFullscreen) return;
    const panel = floatingPanel;
    setFloatSize((p) => ({ ...p, [panel]: { width: ref.offsetWidth, height: ref.offsetHeight } }));
    setFloatPosition((p) => ({ ...p, [panel]: { x: position.x, y: position.y } }));
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
          setFloatPosition((p) => ({ ...p, [panel]: { x: newX, y: newY } }));
          setFloatingPanel(panel); setIsFloatMinimized(false); setArmedDetachPanel(null);
        }
      }
    };
    const handleMouseUp = () => setArmedDetachPanel(null);
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
    const tabContent = content === NOT_PREVIEWABLE_SENTINEL ? NOT_PREVIEWABLE_MESSAGE : content;
    setTabs((prev) => {
      const existing = prev.findIndex((tab) => tab.path === filePath);
      if (existing !== -1) {
        setActiveTabIndex(existing);
        showNotification(`Switched to ${filename}`, 'info');
        return prev;
      }
      const newTab: Tab = { filename, path: filePath, content: tabContent, isDirty: false };
      const newTabs = [...prev, newTab];
      setActiveTabIndex(newTabs.length - 1);
      showNotification(`Opened ${filename}`, 'success');
      return newTabs;
    });
  }, []);

  const triggerFlutterHotReload = useCallback((filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (ext !== 'dart') return;
    if (flutterHotReloadTimerRef.current !== null) window.clearTimeout(flutterHotReloadTimerRef.current);
    flutterHotReloadTimerRef.current = window.setTimeout(() => { void window.terminal.hotReload(); }, 400);
  }, []);

  const triggerCSharpLint = useCallback((filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (ext !== 'cs') return;
    if (csharpLintTimerRef.current !== null) window.clearTimeout(csharpLintTimerRef.current);
    csharpLintTimerRef.current = window.setTimeout(() => { void lintCSharpFile(filePath); }, 400);
  }, []);

  const triggerDartLint = useCallback((filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (ext !== 'dart') return;
    if (dartLintTimerRef.current !== null) window.clearTimeout(dartLintTimerRef.current);
    dartLintTimerRef.current = window.setTimeout(() => { void lintDartFile(filePath); }, 400);
  }, []);

  const triggerPhpLint = useCallback((filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (ext !== 'php') return;
    if (phpLintTimerRef.current !== null) window.clearTimeout(phpLintTimerRef.current);
    phpLintTimerRef.current = window.setTimeout(() => { void lintPhpFile(filePath); }, 400);
  }, []);

  const handleSaveTranslatedFile = useCallback(
    async (content: string, language: string): Promise<{ success: boolean; error?: string; skipped?: boolean }> => {
      const activePath = tabs[activeTabIndex]?.path;
      if (!activePath) return { success: false, error: 'Open a file first so the new filename can be derived from it.' };
      const ext = LANGUAGE_NAME_TO_EXT[language];
      if (!ext) return { success: false, error: `No file extension is known for "${language}".` };
      const cleaned = extractTranslatedCode(content);
      if (!cleaned.trim()) return { success: false, error: 'Nothing to save — the translation was empty.' };
      const sep = activePath.includes('\\') ? '\\' : '/';
      const lastSep = activePath.lastIndexOf(sep);
      const dir = lastSep >= 0 ? activePath.slice(0, lastSep) : '';
      const nameOnly = lastSep >= 0 ? activePath.slice(lastSep + 1) : activePath;
      const dotIdx = nameOnly.lastIndexOf('.');
      const base = dotIdx > 0 ? nameOnly.slice(0, dotIdx) : nameOnly;
      const newName = `${base}.${ext}`;
      const targetPath = dir ? `${dir}${sep}${newName}` : newName;
      const listing = await window.fileSystem.readDir(dir);
      const alreadyExists = listing.success && (listing.files ?? []).some((f) => !f.isDirectory && f.name === newName);
      if (alreadyExists) {
        const overwrite = window.confirm(`"${newName}" already exists in this folder. Overwrite it?`);
        if (!overwrite) return { success: false, skipped: true };
      }
      const result = await window.fileSystem.writeFile(targetPath, cleaned);
      if (!result.success) return { success: false, error: result.error || 'Failed to write file.' };
      triggerFlutterHotReload(targetPath);
      openFileInTab(targetPath, newName, cleaned);
      setSidebarRefreshToken((n) => n + 1);
      setGitRefreshToken((n) => n + 1);
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

  const activeTabIndexRef = useRef(activeTabIndex);
  activeTabIndexRef.current = activeTabIndex;

  const handleEditorChange = useCallback((value: string | undefined) => {
    window.stats?.activity();
    setTabs((prev) => {
      const index = activeTabIndexRef.current;
      if (index < 0 || index >= prev.length) return prev;
      const content = value ?? '';
      if (prev[index].content === content) return prev;
      const next = prev.slice();
      next[index] = { ...next[index], content, isDirty: true };
      return next;
    });
  }, []);

  const handleSave = useCallback(async (opts?: { silent?: boolean }) => {
    if (!activeTab || !activeTab.path) return;
    // A placeholder tab (non-previewable file) is never dirty and has no Monaco
    // instance to edit it, but Ctrl+S doesn't check isDirty -- without this guard
    // it would silently overwrite the real binary file with the placeholder text.
    if (activeTab.content === NOT_PREVIEWABLE_MESSAGE) return;
    const result = await window.fileSystem.writeFile(activeTab.path, activeTab.content);
    if (result.success) {
      triggerFlutterHotReload(activeTab.path);
      triggerCSharpLint(activeTab.path);
      triggerDartLint(activeTab.path);
      triggerPhpLint(activeTab.path);
      setTabs((prev) => prev.map((tab, index) => index === activeTabIndex ? { ...tab, isDirty: false } : tab));
      setGitRefreshToken((n) => n + 1);
      if (!opts?.silent) showNotification(`Saved ${activeTab.filename}`, 'success');
    } else if (!opts?.silent) {
      showNotification(`Failed to save ${activeTab.filename}`, 'error');
    }
  }, [activeTab, activeTabIndex, triggerFlutterHotReload, triggerCSharpLint, triggerDartLint, triggerPhpLint, showNotification]);

  useEffect(() => {
    if (!autoSave || !activeTab?.path || !activeTab.isDirty) return undefined;
    const timer = window.setTimeout(() => { void handleSave({ silent: true }); }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [autoSave, activeTab?.path, activeTab?.isDirty, activeTab?.content, handleSave]);

  // No spawn, no terminal — reads the current buffer, transpiles it in-process
  // with the bundled Babel standalone, and mounts the result into the existing
  // Preview panel. See buildReactSandboxHtml for the transpile/mount contract.
  const handleRunReactSandbox = useCallback(async () => {
    if (!activeTab) return;
    showNotification(`Running ${activeTab.filename}...`, 'info');
    try {
      const vendorPaths = await window.runner.getVendorAssetPaths();
      const [reactFile, reactDomFile, babelFile] = await Promise.all([
        window.fileSystem.readFile(vendorPaths.react),
        window.fileSystem.readFile(vendorPaths.reactDom),
        window.fileSystem.readFile(vendorPaths.babel),
      ]);
      if (!reactFile.success || !reactDomFile.success || !babelFile.success) {
        setRunError('React sandbox assets not found. Run "npm run vendor:sandbox" and repackage.');
        setShowOutput(true);
        return;
      }
      const html = buildReactSandboxHtml(
        { react: reactFile.content ?? '', reactDom: reactDomFile.content ?? '', babel: babelFile.content ?? '' },
        activeTab.content,
      );
      const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      // Revoke the previous URL before the new one is ever assigned anywhere
      // (ref or state) — so a second quick Run click can never leave two blob
      // URLs alive at once, even mid-transition.
      if (tsxPreviewUrlRef.current) {
        URL.revokeObjectURL(tsxPreviewUrlRef.current);
      }
      tsxPreviewUrlRef.current = blobUrl;
      setTsxPreviewUrl(blobUrl);
      setPreviewLoaded(true);
      setShowPreview(true);
      setPreviewRefreshKey((prev) => prev + 1);
    } catch (err) {
      setRunError(`Failed to run React sandbox: ${String(err)}`);
      setShowOutput(true);
    }
  }, [activeTab, showNotification]);

  // Blob URLs created for the .tsx sandbox preview are only ever referenced via
  // tsxPreviewUrlRef, so this is the one place a leftover URL could otherwise
  // survive past the component's lifetime.
  useEffect(() => {
    return () => {
      if (tsxPreviewUrlRef.current) {
        URL.revokeObjectURL(tsxPreviewUrlRef.current);
      }
    };
  }, []);

  const handleRun = useCallback(async () => {
    if (!activeTab?.path) {
      setRunError('No file saved. Save the file before running.');
      setShowOutput(true); return;
    }
    const ext = activeTab.filename.split('.').pop()?.toLowerCase();
    const language = ext ? RUN_LANGUAGE_BY_EXT[ext] : undefined;
    if (!language) { setRunError(`Cannot run .${ext ?? '?'} files directly.`); setShowOutput(true); return; }
    if (language === 'tsx') {
      setRunError(null);
      await handleRunReactSandbox();
      return;
    }
    if (language !== 'html') {
      const runtime = ext ? RUNTIME_BY_EXT[ext] : undefined;
      const sdkCheck = runtime ? await window.runner.checkSDK(runtime) : undefined;
      if (runtime && !sdkCheck?.available) {
        setRunError(`Runtime not found: ${runtime}\nInstall it and make sure it's on your PATH.\n${sdkCheck?.error ?? ''}`);
        setShowOutput(true); return;
      }
    }
    setRunError(null); setShowOutput(true);
    showNotification(`Running ${activeTab.filename}...`, 'info');
    await terminalRef.current?.run({ language, path: activeTab.path });
  }, [activeTab, handleRunReactSandbox]);

  const handleFlutterRun = useCallback(async (target: FlutterTarget) => {
    if (!initialFolder) return;
    setRunError(null); setShowOutput(true);
    showNotification(`Running Flutter on ${target.name}...`, 'info');
    await terminalRef.current?.run({ language: 'flutter', path: initialFolder, deviceId: target.id });
  }, [initialFolder]);

  const handleGitLog = useCallback((text: string) => {
    setShowOutput(true); terminalRef.current?.write(text);
  }, []);

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
      const newTabs = prev.filter((_, i) => i !== index);
      if (newTabs.length === 0) setActiveTabIndex(0);
      else if (index < activeTabIndex) setActiveTabIndex(activeTabIndex - 1);
      else if (index === activeTabIndex) setActiveTabIndex(Math.min(activeTabIndex, newTabs.length - 1));
      else setActiveTabIndex(activeTabIndex);
      return newTabs;
    });
    if (tabToClose) showNotification(`Closed ${tabToClose.filename}`, 'info');
  }, [activeTabIndex, tabs]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault(); if (activeTab) handleSave();
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'b') {
        event.preventDefault(); setIsSidebarCollapsed((prev) => !prev);
      }
      if ((event.ctrlKey || event.metaKey) && event.key === '`') {
        event.preventDefault(); setShowOutput((prev) => !prev);
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'r') {
        event.preventDefault();
        setPreviewLoaded(true);
        setPreviewRefreshKey((prev) => prev + 1);
        showNotification('Preview refreshed', 'success');
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, handleSave, triggerDartLint, triggerPhpLint]);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [settingsOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!floatingPanel || isFloatMinimized) return;
      if (event.key === 'Escape' && !isFullscreen) { event.preventDefault(); dockPanel(); }
      if (event.key === 'F11') { event.preventDefault(); toggleFullscreen(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [floatingPanel, isFullscreen, isFloatMinimized, dockPanel, toggleFullscreen]);

  useEffect(() => {
    if (!floatingPanel) { setIsFullscreen(false); preFullscreenRef.current = null; }
  }, [floatingPanel]);

  const currentFloatingPanel = floatingPanel ?? 'preview';
  const currentSize = floatSize[currentFloatingPanel] || { width: 420, height: 350 };
  const currentPosition = floatPosition[currentFloatingPanel] || { x: 100, y: 100 };
  const floatStyle = isFullscreen
    ? { width: '100vw', height: '100vh', x: 0, y: 0, borderRadius: 0 }
    : { width: currentSize.width, height: currentSize.height, x: currentPosition.x, y: currentPosition.y, borderRadius: 10 };

  const topPillStyle = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 14px',
    borderRadius: 8,
    fontSize: 12.5,
    fontFamily: 'Segoe UI, sans-serif',
    fontWeight: 500,
    cursor: 'pointer',
    background: active ? 'rgba(168, 85, 247, 0.35)' : 'rgba(168, 85, 247, 0.18)',
    color: C.textPrimary,
    border: active
      ? `1px solid ${C.accentAI}`
      : `1px solid rgba(168, 85, 247, 0.55)`,
    transition: 'all 0.2s ease',
  });

  const topPillIconStyle: React.CSSProperties = { width: 13, height: 13 };

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ backgroundColor: C.bgApp, color: C.textPrimary }}>
      <StatsDebugPanel projectPath={initialFolder} open={statsOpen} onClose={() => setStatsOpen(false)} />
      <AdaptiveToast currentCode={activeTab?.content ?? ''} language={activeTab ? getLanguage(activeTab.filename) : 'plaintext'} />
      <CodeInferencePrompt />

      {notification && (
        <div className="fixed top-4 right-4 z-50 px-3 py-1.5 rounded"
          style={{
            background: C.bgCard,
            border: `1px solid ${
              notification.type === 'error' ? '#f87171' :
              notification.type === 'success' ? C.success :
              notification.type === 'warning' ? C.codeOrange : C.accentAI
            }`,
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
            color: C.textSecondary,
            fontFamily: 'Segoe UI, sans-serif',
            fontSize: '11px',
            maxWidth: '280px',
          }}>
          <div className="flex items-center gap-1.5">
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

      {/* Top bar */}
      <div className="flex items-center justify-between shrink-0"
        style={{
          background: C.bgTopBar,
          borderBottom: `1px solid ${C.border}`,
          height: '48px',
        }}>
        <div className="flex items-center">
          <div className="flex items-center gap-2 px-4 shrink-0">
            <img src={log} alt="Fabrica" className="w-5 h-5 object-contain" />
            <span className="text-[14px] font-semibold" style={{ color: C.textPrimary, fontFamily: 'Segoe UI, sans-serif' }}>
              Fabrica
            </span>
          </div>
          <MenuBarComponent
            onOpenFile={handleOpenFileDialog}
            onSave={handleSave}
            onCloseEditor={() => { if (activeTab) handleCloseTab(activeTabIndex); }}
            onCloseFolder={onBack}
            onOpenSettings={() => setSettingsOpen(true)}
            hasActiveTab={!!activeTab}
            onToggleSidebar={() => setIsSidebarCollapsed((prev) => !prev)}
            onToggleTerminal={() => setShowOutput((prev) => !prev)}
            onToggleAI={handleToggleAI}
            onToggleStats={() => setStatsOpen((prev) => !prev)}
            onTogglePreview={handleTogglePreview}
            onToggleGit={() => setShowGit((prev) => !prev)}
            onRun={handleRun}
            onStop={() => { void terminalRef.current?.kill(); }}
            onUndo={handleMenuUndo}
            onRedo={handleMenuRedo}
            onCut={handleMenuCut}
            onCopy={handleMenuCopy}
            onPaste={handleMenuPaste}
            onFind={handleMenuFind}
            onNewTerminalTab={() => { setShowOutput(true); terminalRef.current?.addShellTab(); }}
            onKillActiveTerminalTab={() => { void terminalRef.current?.closeActiveTab(); }}
            hasOpenTerminal={showOutput}
            isFlutterProject={isFlutterProject}
            projectPath={initialFolder}
            autoSaveEnabled={autoSave}
            onToggleAutoSave={() => {
              setAutoSave(!autoSave);
              showNotification(`Autosave turned ${!autoSave ? 'on' : 'off'}`, 'info');
            }}
          />
        </div>

        <div className="flex items-center gap-2 pr-4">
          <button type="button" onClick={handleTogglePreview} style={topPillStyle(showPreview)} title="Toggle Live Preview">
            <svg style={topPillIconStyle} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            Live Preview
          </button>

          <button type="button" onClick={handleToggleWebPreview} style={topPillStyle(showWebPreview)} title="Toggle Browser Preview">
            <svg style={topPillIconStyle} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12a9 9 0 1018 0 9 9 0 00-18 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18" />
            </svg>
            Browser Preview
          </button>

          <button type="button" onClick={handleToggleAI} style={topPillStyle(showAI)} title="Toggle AI Assistant">
            <svg style={topPillIconStyle} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
            AI
          </button>

          <button type="button" onClick={() => setShowGit((prev) => !prev)} style={topPillStyle(showGit)} title="Toggle Source Control">
            <svg style={topPillIconStyle} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            Git
          </button>

          <button type="button" onClick={handleRun} disabled={!activeTab}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 8,
              fontSize: 12.5,
              fontFamily: 'Segoe UI, sans-serif',
              fontWeight: 500,
              background: isRunning ? 'transparent' : 'rgba(124, 58, 237, 0.25)',
              color: isRunning ? C.textMuted : C.codePurple,
              border: isRunning ? `1px solid ${C.border}` : `1px solid ${C.btnPrimary}`,
              cursor: !activeTab ? 'not-allowed' : 'pointer',
              opacity: !activeTab ? 0.4 : 1,
              transition: 'all 0.2s ease',
            }}>
            <svg style={topPillIconStyle} fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            {isRunning ? 'Running' : 'Run'}
          </button>

          {isFlutterProject && (
            <FlutterTargetSelector
              disabled={!initialFolder}
              isRunning={isRunning}
              selected={flutterTarget}
              onTargetChange={setFlutterTarget}
              onRun={handleFlutterRun}
            />
          )}

          {isFlutterProject && isRunning && (
            <>
              <button type="button" onClick={() => { void window.terminal.hotReload(); }} style={topPillStyle(false)} title="Hot Reload (r)">
                <svg style={topPillIconStyle} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Reload
              </button>

              <button type="button" onClick={() => { void window.terminal.hotRestart(); }} style={topPillStyle(false)} title="Hot Restart (R)">
                <svg style={topPillIconStyle} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Restart
              </button>
            </>
          )}
        </div>
      </div>

      {/* Workspace */}
      <div className="flex flex-1 overflow-hidden" style={{ background: C.bgApp, position: 'relative' }}>
        {/* Sidebar */}
        <div ref={sidebarRef} className="flex shrink-0 relative"
          style={{
            width: isSidebarCollapsed ? 0 : sidebarWidth,
            overflow: 'hidden',
            transition: isResizingSidebar ? 'none' : 'width 0.15s ease',
            background: C.bgExplorer,
            borderRight: isSidebarCollapsed ? 'none' : `1px solid ${C.borderSubtle}`,
          }}>
          <div className="flex h-full" style={{ width: sidebarWidth }}>
            <Sidebar
              onFileOpen={handleFileOpen}
              initialFolder={initialFolder}
              activeFilePath={activeTab?.path}
              gitStatusFiles={gitStatusFiles}
              refreshSignal={sidebarRefreshToken}
            />
          </div>
        </div>

        {/* VS Code-style left toggle strip — 1px line + 3 dots on hover */}
        <div
          onMouseEnter={() => setHoverStrip('left')}
          onMouseLeave={() => setHoverStrip(null)}
          onMouseDown={handleSidebarStripMouseDown}
          title={isSidebarCollapsed ? 'Show Sidebar' : 'Hide Sidebar'}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: (isSidebarCollapsed ? 0 : sidebarWidth) - 3,
            width: 6,
            zIndex: 5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'col-resize',
            background: hoverStrip === 'left' ? 'rgba(168, 85, 247, 0.5)' : 'transparent',
            transition: 'background 0.15s ease',
          }}
        >
          {hoverStrip === 'left' && !isSidebarCollapsed && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              color: C.accentAI,
              fontSize: 10,
              fontWeight: 'bold',
              pointerEvents: 'none',
              background: C.bgApp,
              padding: '4px 2px',
              borderRadius: 4,
              border: `1px solid ${C.accentAI}`,
              lineHeight: 1,
            }}>
              <span>·</span>
              <span>·</span>
              <span>·</span>
            </div>
          )}
        </div>

        {/* Editor column */}
        <div className="flex-1 flex flex-col overflow-hidden"
          style={{
            background: '#080719',
            borderRight: (showPreview || showAI || showWebPreview) ? `1px solid ${C.borderSubtle}` : 'none',
          }}>
          <div className="flex items-center overflow-x-auto shrink-0"
            style={{
              background: C.bgEditor,
              borderBottom: `1px solid ${C.border}`,
              height: '36px',
              boxSizing: 'border-box',
              padding: '0 8px',
            }}>
            {tabs.map((tab, index) => {
              const tabIconClass = getFileIcon(tab.filename);
              const isActive = index === activeTabIndex;
              return (
                <div key={index}
                  className="group flex items-center gap-1.5 px-3 h-full cursor-pointer text-sm shrink-0"
                  style={{
                    background: isActive ? C.bgActiveTab : 'transparent',
                    color: isActive ? C.textPrimary : C.textMuted,
                    borderTop: isActive ? `2px solid ${C.accentAI}` : '2px solid transparent',
                    borderRight: `1px solid ${C.border}`,
                    fontFamily: 'Segoe UI, sans-serif',
                    fontSize: '13px',
                  }}
                  onClick={() => setActiveTabIndex(index)}>
                  <i className={tabIconClass}
                    style={{ fontSize: '12px', flexShrink: 0, color: tabIconClass.startsWith('devicon') ? undefined : C.textPrimary }} />
                  <span className="truncate max-w-28"
                    style={tab.isDirty && !isActive ? { fontStyle: 'italic', color: C.codeOrange } : undefined}>
                    {tab.filename}
                  </span>
                  {tab.isDirty && <span className="w-1 h-1 rounded-full" style={{ background: C.codeOrange }} />}
                  <button type="button"
                    onClick={(event) => { event.stopPropagation(); handleCloseTab(index); }}
                    className="ml-1 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
                    style={{ color: C.textMuted, fontSize: '11px' }}>
                    ✕
                  </button>
                </div>
              );
            })}
            {tabs.length === 0 && (
              <div className="text-sm px-3" style={{ color: C.textMuted, fontFamily: 'Segoe UI, sans-serif' }}>
                No files open
              </div>
            )}
            <button
              type="button"
              onClick={handleOpenFileDialog}
              style={{
                width: 28,
                height: 28,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                border: 'none',
                borderRadius: 4,
                color: '#77718F',
                cursor: 'pointer',
                marginLeft: 4,
                fontSize: 16,
                transition: 'background 0.15s ease, color 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(168, 85, 247, 0.12)';
                e.currentTarget.style.color = '#C084FC';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#77718F';
              }}
              title="Open File"
            >
              +
            </button>
          </div>

          <BreadcrumbComponent currentPath={activeTab?.path || ''} projectRoot={initialFolder} />

          <div className="flex flex-1 overflow-hidden">
            {tabs.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ background: C.bgEditor }}>
                <div style={{
                  width: '64px', height: '64px', borderRadius: '50%',
                  background: 'rgba(168, 85, 247, 0.05)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: `1px solid ${C.border}`,
                }}>
                  <i className="codicon codicon-folder-opened" style={{ fontSize: '32px', color: C.textMuted }} />
                </div>
                <div className="text-center" style={{ fontFamily: 'Segoe UI, sans-serif' }}>
                  <div className="font-medium text-sm mb-0.5" style={{ color: C.textPrimary }}>No file open</div>
                  <div className="text-xs" style={{ color: C.textMuted }}>Open a folder or file to get started</div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-w-0" style={{ background: '#080719' }}>
                {activeTab!.content === NOT_PREVIEWABLE_MESSAGE ? (
                  <div className="flex-1 flex items-center justify-center text-sm"
                    style={{ color: C.textMuted, fontFamily: 'Segoe UI, sans-serif' }}>
                    {NOT_PREVIEWABLE_MESSAGE}
                  </div>
                ) : (
                  <Editor
                    language={getLanguage(tabs[activeTabIndex].filename)}
                    filename={activeTab!.filename}
                    path={activeTab!.path}
                    value={activeTab!.content}
                    onChange={handleEditorChange}
                    onSelectionChange={(s) => setSelectedCode(s)}
                  />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right panel — only if preview, AI, or browser preview is shown */}
        {(showPreview || showAI || showWebPreview) && (
          <>
            {/* VS Code-style right toggle strip */}
            <div
              onMouseEnter={() => setHoverStrip('right')}
              onMouseLeave={() => setHoverStrip(null)}
              onMouseDown={handleRightStripMouseDown}
              title={isRightPanelCollapsed ? 'Show right panel' : 'Hide right panel'}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                right: (isRightPanelCollapsed ? 0 : rightPanelWidth) - 3,
                width: 6,
                zIndex: 5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'col-resize',
                background: hoverStrip === 'right' ? 'rgba(168, 85, 247, 0.5)' : 'transparent',
                transition: 'background 0.15s ease',
              }}
            >
              {hoverStrip === 'right' && !isRightPanelCollapsed && (
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  color: C.accentAI,
                  fontSize: 10,
                  fontWeight: 'bold',
                  pointerEvents: 'none',
                  background: C.bgApp,
                  padding: '4px 2px',
                  borderRadius: 4,
                  border: `1px solid ${C.accentAI}`,
                  lineHeight: 1,
                }}>
                  <span>·</span>
                  <span>·</span>
                  <span>·</span>
                </div>
              )}
            </div>

            <div className="flex flex-col shrink-0 overflow-hidden"
              style={{
                width: isRightPanelCollapsed ? 0 : rightPanelWidth,
                padding: isRightPanelCollapsed ? 0 : 8,
                gap: isRightPanelCollapsed ? 0 : 8,
                background: C.bgApp,
                transition: 'width 0.15s ease',
              }}>

              {/* Preview card */}
              {showPreview && floatingPanel !== 'preview' && (
                <div
                  className="flex flex-col overflow-hidden"
                  style={{
                    cursor: armedDetachPanel === 'preview' ? 'grabbing' : 'grab',
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: C.bgPreviewAI,
                    flex: (showAI || showWebPreview) ? 1 : '1 1 auto',
                    minHeight: 0,
                  }}
                  onMouseDown={handleDetachMouseDown('preview')}>
                  <ToolWindowHeader icon="◉" title="Live Preview" mode="docked"
                    onMinimize={() => setShowPreview(false)}
                    onMaximizeFullscreen={() => { detachToFloat('preview'); toggleFullscreen('preview'); }}
                    onClose={() => setShowPreview(false)}>
                    <button type="button"
                      className="w-6 h-6 flex items-center justify-center text-[12px] transition-colors rounded"
                      style={{ color: C.textSecondary }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(168, 85, 247, 0.15)'; e.currentTarget.style.color = C.textPrimary; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textSecondary; }}
                      onClick={() => { setPreviewLoaded(true); setPreviewRefreshKey((prev) => prev + 1); }}>
                      ⟳
                    </button>
                  </ToolWindowHeader>
                  <div className="flex-1 overflow-hidden" style={{ background: C.bgPreviewAI }}>
                    {previewLoaded ? (
                      <Preview
                        key={activeTab?.path + (tsxPreviewSrc ?? previewHtml)}
                        html={previewHtml}
                        isHtmlFile={isHtmlFile}
                        src={tsxPreviewSrc}
                        zoom={1}
                        refreshKey={previewRefreshKey}
                      />
                    ) : (
                      <div className="flex flex-col h-full w-full items-center justify-center gap-4"
                        style={{ background: C.bgPreviewAI, fontFamily: 'Segoe UI, sans-serif' }}>
                        <div style={{
                          width: 72, height: 72, borderRadius: 12,
                          border: `2px solid rgba(168, 85, 247, 0.4)`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: 'rgba(168, 85, 247, 0.05)', color: C.accentAI,
                          fontSize: 28, fontFamily: 'monospace', fontWeight: 'bold',
                          position: 'relative',
                        }}>
                          &lt;/&gt;
                        </div>
                        <div className="text-center">
                          <div className="font-semibold text-sm mb-1" style={{ color: C.textPrimary }}>Live Preview</div>
                          <div className="text-xs" style={{ color: C.textSecondary }}>
                            Open an HTML/CSS file to preview
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Browser Preview card */}
              {showWebPreview && floatingPanel !== 'webPreview' && (
                <div
                  className="flex flex-col overflow-hidden"
                  style={{
                    cursor: armedDetachPanel === 'webPreview' ? 'grabbing' : 'grab',
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: C.bgPreviewAI,
                    flex: (showPreview || showAI) ? 1 : '1 1 auto',
                    minHeight: 0,
                  }}
                  onMouseDown={handleDetachMouseDown('webPreview')}>
                  <ToolWindowHeader icon="⌂" title="Browser Preview" mode="docked"
                    onMinimize={() => setShowWebPreview(false)}
                    onMaximizeFullscreen={() => { detachToFloat('webPreview'); toggleFullscreen('webPreview'); }}
                    onClose={() => setShowWebPreview(false)}
                  />
                  <div className="flex-1 overflow-hidden" style={{ background: C.bgPreviewAI }}>
                    <WebPreview />
                  </div>
                </div>
              )}

              {/* AI card */}
              {showAI && floatingPanel !== 'ai' && (
                <div
                  className="flex flex-col overflow-hidden"
                  style={{
                    cursor: armedDetachPanel === 'ai' ? 'grabbing' : 'grab',
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: C.bgPreviewAI,
                    flex: (showPreview || showWebPreview) ? 1 : '1 1 auto',
                    minHeight: 0,
                  }}
                  onMouseDown={handleDetachMouseDown('ai')}>
                  <ToolWindowHeader icon="✦" title="AI Assistant" mode="docked"
                    onMinimize={() => setShowAI(false)}
                    onMaximizeFullscreen={() => { detachToFloat('ai'); toggleFullscreen('ai'); }}
                    onClose={() => setShowAI(false)}>
                    <button type="button" onClick={() => setStatsOpen(true)}
                      className="w-6 h-6 flex items-center justify-center text-[11px] transition-colors rounded"
                      style={{ color: C.textSecondary }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(168, 85, 247, 0.15)'; e.currentTarget.style.color = C.textPrimary; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textSecondary; }}>
                      ⓘ
                    </button>
                  </ToolWindowHeader>
                  <div className="flex-1 overflow-hidden" style={{ background: C.bgPreviewAI }}>
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
          </>
        )}

        <SourceControlPanel
          cwd={initialFolder}
          visible={showGit}
          onLog={handleGitLog}
          onNotify={showNotification}
          onStatusChange={setGitStatusFiles}
          refreshToken={gitRefreshToken}
        />
      </div>

      {/* Floating Preview */}
      {floatingPanel === 'preview' && !isFloatMinimized && (
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
            backgroundColor: C.bgPreviewAI,
            border: `1px solid ${C.border}`,
            boxShadow: '0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(168, 85, 247, 0.08)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            userSelect: 'none',
          }}
        >
          <ToolWindowHeader
            icon="◉"
            title="Live Preview"
            mode="floating"
            dragHandleClassName="float-drag-handle"
            onHeaderDoubleClick={() => toggleFullscreen()}
            onMinimize={dockPanel}
            onMaximizeFullscreen={() => toggleFullscreen()}
            onClose={() => { dockPanel(); setShowPreview(false); }}
          >
            <button type="button"
              onClick={(e) => { e.stopPropagation(); setPreviewRefreshKey((prev) => prev + 1); showNotification('Preview refreshed', 'success'); }}
              className="w-6 h-6 flex items-center justify-center text-[12px] transition-colors rounded"
              style={{ color: C.textSecondary }}
              title="Refresh preview (Ctrl+R)">⟳</button>
          </ToolWindowHeader>
          <div className="flex-1 overflow-hidden" style={{ background: C.bgPreviewAI }}>
            <Preview
              key={activeTab?.path + (tsxPreviewSrc ?? previewHtml)}
              html={previewHtml}
              isHtmlFile={isHtmlFile}
              src={tsxPreviewSrc}
              zoom={1}
              refreshKey={previewRefreshKey}
            />
          </div>
        </Rnd>
      )}

      {/* Floating Browser Preview */}
      {floatingPanel === 'webPreview' && !isFloatMinimized && (
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
            backgroundColor: C.bgPreviewAI,
            border: `1px solid ${C.border}`,
            boxShadow: '0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(168, 85, 247, 0.08)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            userSelect: 'none',
          }}
        >
          <ToolWindowHeader
            icon="⌂"
            title="Browser Preview"
            mode="floating"
            dragHandleClassName="float-drag-handle"
            onHeaderDoubleClick={() => toggleFullscreen()}
            onMinimize={dockPanel}
            onMaximizeFullscreen={() => toggleFullscreen()}
            onClose={() => { dockPanel(); setShowWebPreview(false); }}
          />
          <div className="flex-1 overflow-hidden" style={{ background: C.bgPreviewAI }}>
            <WebPreview />
          </div>
        </Rnd>
      )}

      {/* Floating AI */}
      {floatingPanel === 'ai' && !isFloatMinimized && (
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
            backgroundColor: C.bgPreviewAI,
            border: `1px solid ${C.border}`,
            boxShadow: '0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(168, 85, 247, 0.08)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            userSelect: 'none',
          }}
        >
          <ToolWindowHeader
            icon="✦"
            title="AI Assistant"
            mode="floating"
            dragHandleClassName="float-drag-handle"
            onHeaderDoubleClick={() => toggleFullscreen()}
            onMinimize={dockPanel}
            onMaximizeFullscreen={() => toggleFullscreen()}
            onClose={() => { dockPanel(); setShowAI(false); }}
          >
            <button type="button" onClick={(e) => { e.stopPropagation(); setStatsOpen(true); }}
              className="w-6 h-6 flex items-center justify-center text-[11px] transition-colors rounded"
              style={{ color: C.textSecondary }}
              title="Stats Debug">ⓘ</button>
          </ToolWindowHeader>
          <div className="flex-1 overflow-hidden" style={{ background: C.bgPreviewAI }}>
            <AIPanel
              selectedCode={selectedCode}
              activeFilePath={activeTab?.path}
              onSaveTranslatedFile={handleSaveTranslatedFile}
              panelState={aiPanelState}
            />
          </div>
        </Rnd>
      )}

      {/* Terminal */}
      <div className="flex flex-col shrink-0 overflow-hidden"
        style={{
          height: showOutput ? `${terminalHeight}px` : '0px',
          background: C.bgEditor,
          borderTop: showOutput ? `1px solid ${C.border}` : 'none',
          transition: isResizingTerminal ? 'none' : 'height 0.2s ease',
        }}>
        {showOutput && (
          <div
            onMouseDown={handleTerminalResizeStart}
            style={{
              height: 4,
              cursor: 'ns-resize',
              background: isResizingTerminal ? 'rgba(168, 85, 247, 0.5)' : 'transparent',
              transition: 'background 0.15s ease',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              if (!isResizingTerminal) e.currentTarget.style.background = 'rgba(168, 85, 247, 0.3)';
            }}
            onMouseLeave={(e) => {
              if (!isResizingTerminal) e.currentTarget.style.background = 'transparent';
            }}
          />
        )}
        {showOutput && (
          <div className="flex items-center justify-between px-4 shrink-0"
            style={{
              background: C.bgCard,
              borderBottom: `1px solid ${C.border}`,
              height: 36,
            }}>
            <div className="flex items-center gap-3">
              <FlutterTargetSelector
                disabled={!initialFolder}
                isRunning={isRunning}
                selected={flutterTarget}
                onTargetChange={setFlutterTarget}
                onRun={handleFlutterRun}
              />
              {isAndroidPlatform(flutterTarget.platform) && (<MirrorButton udid={flutterTarget.id} />)}
              <AndroidSdkButton />
            </div>
            <button type="button" onClick={() => setShowOutput(false)}
              className="w-6 h-6 flex items-center justify-center text-[11px] transition-colors rounded"
              style={{ color: C.textSecondary }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(168, 85, 247, 0.15)'; e.currentTarget.style.color = C.textPrimary; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textSecondary; }}>✕</button>
          </div>
        )}

        {runError && (
          <div className="px-3 py-1 text-xs shrink-0"
            style={{
              color: '#f87171',
              background: '#2d1b1b',
              borderBottom: `1px solid ${C.border}`,
              fontFamily: 'Consolas, monospace',
              whiteSpace: 'pre-wrap',
            }}>
            {runError}
          </div>
        )}

        <div className="flex-1 min-h-0">
          <TerminalTabs ref={terminalRef} onClose={() => setShowOutput(false)}
            onRunningChange={setIsRunning} cwd={initialFolder} />
        </div>
      </div>

      <StatusBarComponent
        activeTab={activeTab}
        language={activeTab ? getLanguage(activeTab.filename) : 'Plain Text'}
        line={cursorPosition.line}
        col={cursorPosition.col}
        branch="main"
      />

      {settingsOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setSettingsOpen(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '90vw',
              maxWidth: 1000,
              height: '85vh',
              maxHeight: 700,
              background: '#080719',
              border: '1px solid #29204A',
              borderRadius: 12,
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              animation: 'fabricaDialogIn 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 20px',
                borderBottom: '1px solid #29204A',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: '#A855F7', fontSize: 18 }}>⚙️</span>
                <strong style={{ color: '#F4F1FF', fontSize: 15, fontFamily: 'Segoe UI, sans-serif' }}>
                  Settings
                </strong>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                style={{
                  width: 28,
                  height: 28,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  color: '#A9A3C7',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease, color 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(168, 85, 247, 0.15)';
                  e.currentTarget.style.color = '#F4F1FF';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = '#A9A3C7';
                }}
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflow: 'hidden' }}>
              <SettingsScreen onBack={() => setSettingsOpen(false)} embedded onOpenStats={() => {}} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}