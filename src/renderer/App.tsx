import { useEffect, useState } from 'react';
import {
  Globe,
  Code2,
  Smartphone,
  Sparkles,
  FolderOpen,
  Link as LinkIcon,
  Settings as SettingsIcon,
} from 'lucide-react';
import logo from '../assets/log.png';
import './App.css';
import EditorLayout from './screens/EditorLayout';
import StatsDashboard from './screens/StatsDashboard';
import SettingsScreen from './screens/SettingsScreen';
import AppSidebar from './components/AppSidebar';
import { ThemeProvider } from './theme/ThemeContext';
import { EditorSettingsProvider } from './theme/EditorSettingsContext';

// ── Shared theme palette (matches EditorLayout) ──
const C = {
  bgApp: '#080719',
  bgTopBar: '#100A24',
  bgCard: '#12102D',
  bgInput: '#17133A',
  border: '#29204A',
  bgSelected: '#3B1D72',
  btnPrimary: '#7C3AED',
  btnHover: '#8B5CF6',
  accentAI: '#A855F7',
  textPrimary: '#F4F1FF',
  textSecondary: '#A9A3C7',
  textMuted: '#77718F',
  success: '#22C55E',
};

type Screen = 'splash' | 'main' | 'new-project' | 'editor' | 'templates' | 'settings' | 'stats-dashboard';

type RecentProject = {
  name: string;
  path: string;
  lastOpenedAt: number;
};

function getPathSeparator(targetPath: string): string {
  return targetPath.includes('\\') ? '\\' : '/';
}

function getLastPathSegment(targetPath: string): string {
  return targetPath.split(/[\\/]/).filter(Boolean).pop() ?? targetPath;
}

function formatRelativeTime(timestamp: number): string {
  if (!timestamp || Number.isNaN(timestamp)) return 'Opened previously';
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  return `${Math.floor(days / 365)} year${Math.floor(days / 365) === 1 ? '' : 's'} ago`;
}

type TemplateId = 'web' | 'csharp' | 'flutter' | 'blank';

type ProjectTemplate = {
  id: TemplateId;
  name: string;
  description: string;
  icon: React.ReactNode;
};

const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'web',
    name: 'Web',
    description: 'index.html, style.css and script.js. Static files, no build step.',
    icon: <Globe size={28} strokeWidth={1.6} />,
  },
  {
    id: 'csharp',
    name: 'C#',
    description: 'Program.cs using top-level statements. No .csproj needed on .NET 10.',
    icon: <Code2 size={28} strokeWidth={1.6} />,
  },
  {
    id: 'flutter',
    name: 'Flutter (Windows)',
    description: 'Full Windows desktop preview app via flutter create. Desktop only.',
    icon: <Smartphone size={28} strokeWidth={1.6} />,
  },
  {
    id: 'blank',
    name: 'Blank',
    description: 'Empty folder — no starter files. Use the terminal to scaffold whatever you want.',
    icon: <FolderOpen size={28} strokeWidth={1.6} />,
  },
];

function toDartPackageName(projectName: string): string {
  let name = projectName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (/^[0-9]/.test(name)) name = `_${name}`;
  return name || 'fabrica_project';
}

function getScaffoldFiles(
  template: TemplateId,
  projectName: string,
): { relativePath: string; content: string }[] {
  switch (template) {
    case 'web':
      return [
        {
          relativePath: 'index.html',
          content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${projectName}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main class="container">
    <h1>Hello, World!</h1>
    <p>Edit index.html, style.css and script.js to get started.</p>
    <button id="greet-button" type="button">Click me</button>
    <p id="output"></p>
  </main>

  <script src="script.js"></script>
</body>
</html>
`,
        },
        {
          relativePath: 'style.css',
          content: `/* style.css - styles for this Fabrica web project. */

body {
  margin: 0;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: #f5f5f5;
  color: #222;
}

.container {
  max-width: 640px;
  margin: 0 auto;
  padding: 48px 24px;
}

h1 {
  margin-bottom: 8px;
}

button {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  background: #6c5ce7;
  color: #fff;
  font-size: 16px;
  cursor: pointer;
}

button:hover {
  background: #5b4bd6;
}
`,
        },
        {
          relativePath: 'script.js',
          content: `// script.js - behaviour for this Fabrica web project.

console.log('Hello from script.js');

const button = document.getElementById('greet-button');
const output = document.getElementById('output');
let clicks = 0;

button.addEventListener('click', () => {
  clicks += 1;
  output.textContent = \`You clicked \${clicks} time\${clicks === 1 ? '' : 's'}.\`;
});
`,
        },
      ];

    case 'csharp':
      return [
        {
          relativePath: 'Program.cs',
          content: `// Program.cs - entry point for this Fabrica C# project.
// Press Run to execute it (Fabrica runs: dotnet run Program.cs).
// .NET 10 file-based app: a single .cs file, no .csproj required.

using System;

string Greet(string name) => $"Hello, {name}!";

Console.WriteLine(Greet("World"));
`,
        },
      ];

    case 'blank':
      return [];

    case 'flutter':
    default:
      return [];
  }
}

function useRecentProjects() {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);

  const load = async () => {
    const result = await window.store.getRecentProjects();
    if (result.success && result.projects) setRecentProjects(result.projects);
  };

  const add = async (project: { name: string; path: string }) => {
    const result = await window.store.addRecentProject(project);
    if (result.success && result.projects) setRecentProjects(result.projects);
  };

  return { recentProjects, load, add };
}

function useActiveModel(): string {
  const [modelName, setModelName] = useState('Loading...');

  useEffect(() => {
    window.model.getActiveModel().then((result) => {
      if (result.success && result.name) setModelName(result.name);
    });
  }, []);

  return modelName;
}

function SplashScreen({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDone(), 2500);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4" style={{ backgroundColor: C.bgApp }}>
      <div className="w-full max-w-xl text-center flex flex-col items-center gap-6">
        <img src={logo} alt="Fabrica IDE Logo" className="w-24 h-24 object-contain" />
        <div className="text-3xl font-bold" style={{ fontFamily: 'Syne, sans-serif', color: C.textPrimary }}>
          Fabrica IDE
        </div>
        <div className="text-base" style={{ color: C.textSecondary }}>
          Code Smarter. Work Offline. Build Anything.
        </div>
        <div className="w-96 h-2 rounded-full overflow-hidden" style={{ backgroundColor: C.bgCard }}>
          <div className="h-full rounded-full animate-progress" style={{ backgroundColor: C.btnPrimary }} />
        </div>
        <style>{`
          @keyframes progress {
            0% { width: 0%; }
            100% { width: 100%; }
          }
          .animate-progress {
            animation: progress 2.5s ease forwards;
          }
        `}</style>
      </div>
    </div>
  );
}

function TemplatesScreen({ onBack, onOpenSettings }: { onBack: () => void; onOpenSettings: () => void }) {
  const modelName = useActiveModel();
  const templates = [
    { id: 'web', name: 'Web App Blank', description: 'Templates included', icon: <Globe size={28} strokeWidth={1.6} /> },
    { id: 'mobile', name: 'Mobile App', description: 'Templates included', icon: <Smartphone size={28} strokeWidth={1.6} /> },
    { id: 'backend', name: 'Backend/API', description: 'Templates included', icon: <SettingsIcon size={28} strokeWidth={1.6} /> },
  ];

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: C.bgApp, color: C.textPrimary }}>
      <AppSidebar
        active="main"
        onNavigate={(screen) => {
          if (screen === 'main') onBack();
          if (screen === 'settings') onOpenSettings();
        }}
        bottomSlot={
          <>
            <div className="text-[10px] uppercase tracking-wider mb-1.5"
              style={{ color: C.textMuted, fontFamily: 'Segoe UI, sans-serif' }}>
              Offline model
            </div>
            <div className="flex items-center justify-between px-3 py-1.5 rounded text-sm"
              style={{
                backgroundColor: C.bgApp,
                color: C.textPrimary,
                fontFamily: 'Segoe UI, sans-serif',
                border: `1px solid ${C.border}`,
              }}>
              <span>{modelName}</span>
              <span style={{ color: C.textSecondary }}>▼</span>
            </div>
          </>
        }
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 shrink-0"
          style={{ borderBottom: `1px solid ${C.border}` }}>
          <h1 className="text-base sm:text-lg font-semibold"
            style={{ color: C.textPrimary, fontFamily: 'Segoe UI, sans-serif' }}>
            Templates
          </h1>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            {templates.map((template) => (
              <div key={template.id}
                className="p-4 rounded-lg transition-colors"
                style={{ backgroundColor: C.bgCard, border: `1px solid ${C.border}` }}>
                <div
                  className="mb-3 flex items-center justify-center"
                  style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: 'rgba(168, 85, 247, 0.1)',
                    border: `1px solid rgba(168, 85, 247, 0.25)`,
                    color: C.accentAI,
                  }}
                >
                  {template.icon}
                </div>
                <div className="text-sm font-medium"
                  style={{ color: C.textPrimary, fontFamily: 'Segoe UI, sans-serif' }}>
                  {template.name}
                </div>
                <div className="text-xs mt-1"
                  style={{ color: C.textSecondary, fontFamily: 'Segoe UI, sans-serif' }}>
                  {template.description}
                </div>
                <button className="mt-3 px-3 py-1 text-xs font-medium rounded transition-colors"
                  style={{
                    backgroundColor: 'rgba(168, 85, 247, 0.2)',
                    color: C.accentAI,
                    border: `1px solid rgba(168, 85, 247, 0.35)`,
                  }}>
                  Create from template
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function NewProjectScreen({
  onBack, onCreate, onOpenSettings, busy, progress,
}: {
  onBack: () => void;
  onCreate: (projectName: string, template: TemplateId, remoteUrl: string) => void;
  onOpenSettings: () => void;
  busy: boolean;
  progress: string;
}) {
  const [projectName, setProjectName] = useState('my-fabrica-project');
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId>('web');
  const [remoteUrl, setRemoteUrl] = useState('');

  const templates = PROJECT_TEMPLATES;

  const handleCreate = () => {
    if (projectName.trim() && !busy) {
      onCreate(projectName.trim(), selectedTemplate, remoteUrl.trim());
    }
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: C.bgApp, color: C.textPrimary }}>
      <AppSidebar
        active="main"
        onNavigate={(screen) => {
          if (screen === 'main') onBack();
          if (screen === 'settings') onOpenSettings();
        }}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 shrink-0"
          style={{ borderBottom: `1px solid ${C.border}` }}>
          <h1 className="text-base sm:text-lg font-semibold"
            style={{ color: C.textPrimary, fontFamily: 'Segoe UI, sans-serif' }}>
            New Project
          </h1>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="max-w-3xl mx-auto">
            <p className="text-sm mb-6" style={{ color: C.textSecondary, fontFamily: 'Segoe UI, sans-serif' }}>
              Choose a language to scaffold a starter project you can run straight away.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
              {templates.map((template) => {
                const isSelected = selectedTemplate === template.id;
                return (
                  <button key={template.id} onClick={() => setSelectedTemplate(template.id)}
                    className="p-3 sm:p-4 rounded-lg text-left transition-all duration-200"
                    style={{
                      backgroundColor: isSelected ? C.bgApp : C.bgCard,
                      border: isSelected ? `2px solid ${C.accentAI}` : `1px solid ${C.border}`,
                      transform: isSelected ? 'scale(1.02)' : 'scale(1)',
                      boxShadow: isSelected ? '0 0 20px rgba(168, 85, 247, 0.25)' : 'none',
                    }}>
                    <div
                      className="mb-3 flex items-center justify-center"
                      style={{
                        width: 40, height: 40, borderRadius: 10,
                        background: isSelected ? 'rgba(168, 85, 247, 0.18)' : 'rgba(168, 85, 247, 0.08)',
                        border: isSelected ? `1px solid rgba(168, 85, 247, 0.55)` : `1px solid rgba(168, 85, 247, 0.2)`,
                        color: isSelected ? C.codePurple : C.accentAI,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {template.icon}
                    </div>
                    <div className="text-sm sm:text-base font-medium"
                      style={{ color: C.textPrimary, fontFamily: 'Segoe UI, sans-serif' }}>
                      {template.name}
                    </div>
                    <div className="text-xs sm:text-sm"
                      style={{ color: isSelected ? C.accentAI : C.textSecondary, fontFamily: 'Segoe UI, sans-serif' }}>
                      {template.description}
                    </div>
                    {isSelected && (
                      <div className="mt-2 text-xs font-medium" style={{ color: C.accentAI }}>
                        ✓ Selected
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mb-6">
              <label className="text-sm font-medium block mb-1.5"
                style={{ color: C.textPrimary, fontFamily: 'Segoe UI, sans-serif' }}>
                Project Name
              </label>
              <input type="text" value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full px-3 sm:px-4 py-2 rounded text-sm outline-none"
                style={{
                  backgroundColor: C.bgInput,
                  color: C.textPrimary,
                  border: `1px solid ${C.border}`,
                  fontFamily: 'Segoe UI, sans-serif',
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                autoFocus />
            </div>

            <div className="mb-6">
              <label className="text-sm font-medium block mb-1.5"
                style={{ color: C.textPrimary, fontFamily: 'Segoe UI, sans-serif' }}>
                Git remote URL (optional)
              </label>
              <input type="text" value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder="https://github.com/user/repo.git"
                className="w-full px-3 sm:px-4 py-2 rounded text-sm outline-none"
                style={{
                  backgroundColor: C.bgInput,
                  color: C.textPrimary,
                  border: `1px solid ${C.border}`,
                  fontFamily: 'Segoe UI, sans-serif',
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }} />
              <p className="text-xs mt-1.5" style={{ color: C.textSecondary, fontFamily: 'Segoe UI, sans-serif' }}>
                Leave blank to just initialise a local repository. If filled, the
                project is also wired to this remote as "origin" and gets an
                initial commit.
              </p>
            </div>

            {progress && (
              <pre className="mb-4 p-3 rounded text-xs overflow-y-auto whitespace-pre-wrap"
                style={{
                  backgroundColor: C.bgCard,
                  color: C.textSecondary,
                  border: `1px solid ${C.border}`,
                  maxHeight: '160px',
                  fontFamily: 'Space Mono, monospace',
                }}>
                {progress}
              </pre>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={onBack} disabled={busy}
                className="px-4 py-2 text-sm rounded transition-colors"
                style={{
                  color: C.textSecondary,
                  fontFamily: 'Segoe UI, sans-serif',
                  opacity: busy ? 0.5 : 1,
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}>
                Cancel
              </button>
              <button onClick={handleCreate} disabled={busy || !projectName.trim()}
                className="px-4 py-2 text-sm font-medium rounded transition-colors"
                style={{
                  backgroundColor: busy || !projectName.trim() ? C.bgCard : C.btnPrimary,
                  color: busy || !projectName.trim() ? C.textMuted : '#ffffff',
                  fontFamily: 'Segoe UI, sans-serif',
                  cursor: busy || !projectName.trim() ? 'not-allowed' : 'pointer',
                }}>
                {busy ? 'Creating...' : 'Create Project'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MainMenu({
  recentProjects, onNewProject, onOpenProject, onOpenFolder,
  onCloneRepository, onOpenSettings, onOpenStats,
}: {
  recentProjects: RecentProject[];
  onNewProject: () => void;
  onOpenProject: (project: RecentProject) => void;
  onOpenFolder: () => void;
  onCloneRepository: (url: string) => Promise<{ success: boolean; error?: string }>;
  onOpenSettings: () => void;
  onOpenStats: () => void;
}) {
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneLoading, setCloneLoading] = useState(false);
  const [cloneNotice, setCloneNotice] = useState('');

  const handleClone = async () => {
    if (!cloneUrl.trim()) return;
    setCloneLoading(true);
    setCloneNotice('Cloning...');

    const result = await onCloneRepository(cloneUrl.trim());
    setCloneLoading(false);

    if (result.success) {
      setCloneNotice('✓ Cloned successfully!');
      setCloneUrl('');
      setTimeout(() => {
        setShowCloneDialog(false);
        setCloneNotice('');
      }, 1500);
    } else {
      setCloneNotice(`✗ ${result.error || 'Clone failed'}`);
    }
  };

  const openCloneDialog = () => {
    setShowCloneDialog(true);
    setCloneUrl('');
    setCloneNotice('');
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: C.bgApp, color: C.textPrimary }}>
      <AppSidebar
        active="main"
        onNavigate={(screen) => {
          if (screen === 'main') return;
          if (screen === 'stats-dashboard') onOpenStats();
          if (screen === 'settings') onOpenSettings();
        }}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 shrink-0"
          style={{ borderBottom: `1px solid ${C.border}` }}>
          <h1 className="text-base sm:text-lg font-semibold"
            style={{ color: C.textPrimary, fontFamily: 'Segoe UI, sans-serif' }}>
            Projects
          </h1>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
          <div className="flex gap-3 mb-4">
            <button onClick={onNewProject}
              className="flex-1 px-5 py-3 text-sm font-medium rounded-lg transition-all duration-200 hover:scale-[1.02] flex items-center justify-center gap-2"
              style={{
                height: '48px',
                backgroundColor: 'rgba(168, 85, 247, 0.15)',
                color: C.textPrimary,
                border: `1px solid rgba(168, 85, 247, 0.4)`,
                fontFamily: 'Segoe UI, sans-serif',
              }}>
              <Sparkles size={14} strokeWidth={2} /> New Project
            </button>
            <button onClick={onOpenFolder}
              className="flex-1 px-5 py-3 text-sm font-medium rounded-lg transition-all duration-200 hover:scale-[1.02] flex items-center justify-center gap-2"
              style={{
                height: '48px',
                backgroundColor: C.bgCard,
                color: C.textPrimary,
                border: `1px solid ${C.border}`,
                fontFamily: 'Segoe UI, sans-serif',
              }}>
              <FolderOpen size={14} strokeWidth={2} /> Open Folder
            </button>
            <button onClick={openCloneDialog}
              className="flex-1 px-5 py-3 text-sm font-medium rounded-lg transition-all duration-200 hover:scale-[1.02] flex items-center justify-center gap-2"
              style={{
                height: '48px',
                backgroundColor: C.bgCard,
                color: C.textPrimary,
                border: `1px solid ${C.border}`,
                fontFamily: 'Segoe UI, sans-serif',
              }}>
              <LinkIcon size={14} strokeWidth={2} /> Clone Repository
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-4">
            {recentProjects.length === 0 ? (
              <div className="col-span-full text-center py-12">
                <div className="mb-3 flex items-center justify-center mx-auto"
                  style={{
                    width: 56, height: 56, borderRadius: 14,
                    background: 'rgba(168, 85, 247, 0.08)',
                    border: `1px solid ${C.border}`,
                    color: C.textMuted,
                  }}>
                  <FolderOpen size={28} strokeWidth={1.5} />
                </div>
                <div className="text-sm" style={{ color: C.textSecondary, fontFamily: 'Segoe UI, sans-serif' }}>
                  No projects yet
                </div>
                <div className="text-xs mt-1" style={{ color: C.textMuted, fontFamily: 'Segoe UI, sans-serif' }}>
                  Click "New Project" to get started
                </div>
              </div>
            ) : (
              recentProjects.map((project) => (
                <div key={project.path} onClick={() => onOpenProject(project)}
                  className="p-3 sm:p-4 rounded-lg cursor-pointer transition-all duration-200 hover:-translate-y-1"
                  style={{
                    backgroundColor: C.bgCard,
                    border: `1px solid ${C.border}`,
                    position: 'relative',
                    overflow: 'hidden',
                  }}>
                  <div className="flex items-center gap-3 mb-2">
                    <div
                      className="flex items-center justify-center shrink-0"
                      style={{
                        width: 32, height: 32, borderRadius: 8,
                        background: 'rgba(168, 85, 247, 0.12)',
                        color: C.accentAI,
                      }}
                    >
                      <FolderOpen size={16} strokeWidth={1.8} />
                    </div>
                    <div>
                      <div className="text-xs sm:text-sm font-medium"
                        style={{ color: C.textPrimary, fontFamily: 'Segoe UI, sans-serif' }}>
                        {project.name}
                      </div>
                      <div className="text-[10px] sm:text-xs"
                        style={{ color: C.textSecondary, fontFamily: 'Segoe UI, sans-serif' }}>
                        {formatRelativeTime(project.lastOpenedAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded"
                      style={{ backgroundColor: C.bgApp, color: C.textSecondary }}>
                      Local
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-3 rounded-lg transition-all duration-200"
            style={{
              backgroundColor: C.bgCard,
              border: `1px solid ${C.border}`,
            }}>
            <div className="text-[10px] sm:text-xs font-medium"
              style={{ color: C.accentAI, fontFamily: 'Segoe UI, sans-serif' }}>
              WHAT'S NEW
            </div>
            <div className="text-xs sm:text-sm mt-1"
              style={{ color: C.textPrimary, fontFamily: 'Segoe UI, sans-serif' }}>
              Welcome to Fabrica IDE! Check out the new features and improvements in this version.
            </div>
          </div>
        </div>
      </div>

      {showCloneDialog && (
        <div className="fixed inset-0 flex items-center justify-center z-50"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)' }}
          onClick={() => {
            if (!cloneLoading) {
              setShowCloneDialog(false);
              setCloneNotice('');
            }
          }}>
          <div className="rounded-lg p-6 w-[480px] max-w-[90vw]"
            style={{
              backgroundColor: C.bgCard,
              border: `1px solid ${C.border}`,
              boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
            }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold"
                style={{ color: C.textPrimary, fontFamily: 'Segoe UI, sans-serif' }}>
                Clone Repository
              </h2>
              <button type="button"
                onClick={() => {
                  if (!cloneLoading) {
                    setShowCloneDialog(false);
                    setCloneNotice('');
                  }
                }}
                style={{ color: C.textSecondary }}>
                ✕
              </button>
            </div>

            <p className="text-sm mb-4" style={{ color: C.textSecondary, fontFamily: 'Segoe UI, sans-serif' }}>
              Enter the repository URL to clone from GitHub or Git.
            </p>

            <div className="mb-4">
              <label className="text-sm font-medium block mb-1.5"
                style={{ color: C.textPrimary, fontFamily: 'Segoe UI, sans-serif' }}>
                Repository URL
              </label>
              <input type="text" placeholder="https://github.com/user/repo.git"
                value={cloneUrl} onChange={(e) => setCloneUrl(e.target.value)}
                className="w-full px-3 py-2 rounded text-sm outline-none"
                style={{
                  backgroundColor: C.bgInput,
                  color: C.textPrimary,
                  border: `1px solid ${C.border}`,
                  fontFamily: 'Segoe UI, sans-serif',
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleClone(); }}
                autoFocus />
            </div>

            {cloneNotice && (
              <div className="mb-4 text-sm"
                style={{ color: cloneNotice.startsWith('✓') ? C.success : '#f87171' }}>
                {cloneNotice}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button type="button"
                onClick={() => {
                  if (!cloneLoading) {
                    setShowCloneDialog(false);
                    setCloneNotice('');
                  }
                }}
                className="px-4 py-1.5 text-sm rounded transition-colors"
                style={{ color: C.textSecondary, fontFamily: 'Segoe UI, sans-serif' }}>
                Cancel
              </button>
              <button type="button" disabled={cloneLoading || !cloneUrl.trim()}
                onClick={handleClone}
                className="px-4 py-1.5 text-sm font-medium rounded transition-colors"
                style={{
                  backgroundColor: cloneLoading || !cloneUrl.trim() ? C.bgCard : C.btnPrimary,
                  color: cloneLoading || !cloneUrl.trim() ? C.textMuted : '#ffffff',
                  cursor: cloneLoading || !cloneUrl.trim() ? 'not-allowed' : 'pointer',
                }}>
                {cloneLoading ? 'Cloning...' : 'Clone'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const [screen, setScreen] = useState<Screen>('splash');
  const [editorFolder, setEditorFolder] = useState<string | undefined>(undefined);
  const [createBusy, setCreateBusy] = useState(false);
  const [createProgress, setCreateProgress] = useState('');
  const { recentProjects, load: loadRecentProjects, add: addRecentProject } = useRecentProjects();

  useEffect(() => {
    void loadRecentProjects();
  }, []);

  useEffect(() => {
    if (screen === 'main' || screen === 'new-project' || screen === 'templates') {
      void loadRecentProjects();
    }
    if (screen === 'new-project') {
      setCreateProgress('');
    }
  }, [screen]);

  useEffect(() => {
    return window.flutter.onCreateProgress((data) => {
      setCreateProgress((prev) => prev + data);
    });
  }, []);

  const openEditor = (folderPath?: string) => {
    console.log(`[STATS][renderer] openEditor called with folderPath=${folderPath}`);
    console.trace('[STATS][renderer] openEditor call stack');
    setEditorFolder(folderPath);
    setScreen('editor');
  };

  const handleCreateProject = async (
    projectName: string, template: TemplateId, remoteUrl: string,
  ) => {
    const folderPath = await window.fileSystem.openFolder();
    if (!folderPath) return;

    const sep = getPathSeparator(folderPath);
    const normalizedLocation = folderPath.endsWith(sep) ? folderPath.slice(0, -1) : folderPath;
    const fullPath = `${normalizedLocation}${sep}${projectName}`;

    setCreateBusy(true);
    setCreateProgress('');
    const log = (line: string) => setCreateProgress((prev) => prev + line);

    try {
      const result = await window.fileSystem.createFolder(fullPath);
      if (!result.success) {
        log(`✗ Could not create project folder: ${result.error ?? 'unknown error'}\n`);
        return;
      }

      if (template === 'flutter') {
        log('Running flutter create (this can take a while)...\n');
        const created = await window.flutter.createProject(
          fullPath,
          toDartPackageName(projectName),
        );
        if (!created.success) {
          log(`\n✗ flutter create failed: ${created.error ?? 'see output above'}\n`);
          return;
        }
        log('\n✓ Flutter project created.\n');
      } else {
        const files = getScaffoldFiles(template, projectName);

        const dirs = new Set<string>();
        files.forEach((file) => {
          const idx = file.relativePath.lastIndexOf('/');
          if (idx > 0) dirs.add(file.relativePath.slice(0, idx));
        });
        for (const dir of Array.from(dirs)) {
          await window.fileSystem.createFolder(`${fullPath}${sep}${dir.split('/').join(sep)}`);
        }

        for (const file of files) {
          const target = `${fullPath}${sep}${file.relativePath.split('/').join(sep)}`;
          const written = await window.fileSystem.writeFile(target, file.content);
          if (!written.success) {
            log(`✗ Failed to write ${file.relativePath}: ${written.error ?? 'unknown error'}\n`);
            return;
          }
          log(`✓ ${file.relativePath}\n`);
        }
      }

      const initResult = await window.git.init(fullPath);
      log(initResult.success ? '✓ git init\n' : `✗ git init: ${initResult.error ?? ''}\n`);

      if (initResult.success && remoteUrl) {
        const remoteResult = await window.git.remoteAdd(fullPath, remoteUrl);
        log(
          remoteResult.success
            ? '✓ git remote add origin\n'
            : `✗ git remote add: ${remoteResult.error ?? ''}\n`,
        );

        if (remoteResult.success) {
          await window.git.add(fullPath);
          const commitResult = await window.git.commit(fullPath, 'Initial commit');
          log(
            commitResult.success
              ? '✓ Initial commit\n'
              : `✗ Initial commit: ${commitResult.error ?? ''}\n`,
          );
        }
      }

      await addRecentProject({ name: projectName, path: fullPath });
      openEditor(fullPath);
    } finally {
      setCreateBusy(false);
    }
  };

  const handleOpenFolder = async () => {
    const folderPath = await window.fileSystem.openFolder();
    if (!folderPath) return;
    const project = {
      name: getLastPathSegment(folderPath),
      path: folderPath,
    };
    await addRecentProject(project);
    openEditor(folderPath);
  };

  const handleCloneRepository = async (url: string) => {
    const targetDir = await window.fileSystem.openFolder();
    if (!targetDir) {
      return { success: false, error: 'No folder selected' };
    }
    const result = await window.git.clone(url, targetDir);
    if (result.success) {
      await loadRecentProjects();
      const projectName = url.split('/').pop()?.replace('.git', '') || 'cloned-project';
      const project = {
        name: projectName,
        path: targetDir,
      };
      await addRecentProject(project);
      openEditor(targetDir);
    }
    return result;
  };

  const handleOpenRecentProject = async (project: RecentProject) => {
    await addRecentProject({ name: project.name, path: project.path });
    openEditor(project.path);
  };

  if (screen === 'splash') {
    return <SplashScreen onDone={() => setScreen('main')} />;
  }

  if (screen === 'editor') {
    return <EditorLayout onBack={() => setScreen('main')} initialFolder={editorFolder} />;
  }

  if (screen === 'new-project') {
    return (
      <NewProjectScreen
        onBack={() => setScreen('main')}
        onCreate={handleCreateProject}
        onOpenSettings={() => setScreen('settings')}
        busy={createBusy}
        progress={createProgress}
      />
    );
  }

  if (screen === 'templates') {
    return (
      <TemplatesScreen
        onBack={() => setScreen('main')}
        onOpenSettings={() => setScreen('settings')}
      />
    );
  }

  if (screen === 'settings') {
    return <SettingsScreen onBack={() => setScreen('main')} />;
  }

  if (screen === 'stats-dashboard') {
    return (
      <StatsDashboard
        onBack={() => setScreen('main')}
        onOpenSettings={() => setScreen('settings')}
        recentProjects={recentProjects}
      />
    );
  }

  return (
    <MainMenu
      recentProjects={recentProjects}
      onNewProject={() => setScreen('new-project')}
      onOpenProject={handleOpenRecentProject}
      onOpenFolder={handleOpenFolder}
      onCloneRepository={handleCloneRepository}
      onOpenSettings={() => setScreen('settings')}
      onOpenStats={() => setScreen('stats-dashboard')}
    />
  );
}

export default function AppRoot() {
  return (
    <ThemeProvider>
      <EditorSettingsProvider>
        <App />
      </EditorSettingsProvider>
    </ThemeProvider>
  );
}