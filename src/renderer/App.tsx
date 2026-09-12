import { useEffect, useState, ReactNode } from 'react';
import logo from '../assets/log.png';
import './App.css';
import EditorLayout from './screens/EditorLayout';
import StatsDashboard from './screens/StatsDashboard';
// TEMPORARY: throwaway device-mirroring test UI. Remove this import and its
// one usage in MainMenu below when the real mirror panel lands.
import MirrorTest from './components/MirrorTest';

type Screen = 'splash' | 'main' | 'new-project' | 'editor' | 'templates' | 'settings' | 'stats-dashboard';
type SettingsCategory = 'general' | 'appearance' | 'editor';

type RecentProject = {
  name: string;
  path: string;
};

function getPathSeparator(targetPath: string): string {
  return targetPath.includes('\\') ? '\\' : '/';
}

function getLastPathSegment(targetPath: string): string {
  return targetPath.split(/[\\/]/).filter(Boolean).pop() ?? targetPath;
}

// ============================================================
// PROJECT TEMPLATES
// ============================================================
// Each template id is the language key, and every generated entry point is
// named/placed to match what main.ts's getRunConfig() expects for that
// language, so Run works immediately after creation with no extra steps:
//
//   web    -> index.html  getRunConfig returns { html: true } — no process is
//             spawned, it renders in the Live Preview panel instead.
//   csharp -> Program.cs  run as `dotnet run <file>`  (file-level, .NET 10
//             file-based app — no .csproj, confirmed against the bundled
//             dotnet 10.0.302 in resources/runtimes/dotnet)
//   flutter-> lib/main.dart, but Flutter is PROJECT-level (`flutter run -d
//             windows`, cwd = folder) and is launched from the Flutter target
//             selector in the editor toolbar, NOT the Run button.
type TemplateId = 'web' | 'csharp' | 'flutter';

type ProjectTemplate = {
  id: TemplateId;
  name: string;
  description: string;
  icon: string;
};

const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'web',
    name: 'Web',
    description: 'index.html, style.css and script.js. Static files, no build step.',
    icon: '🌐',
  },
  {
    id: 'csharp',
    name: 'C#',
    description: 'Program.cs using top-level statements. No .csproj needed on .NET 10.',
    icon: '🟦',
  },
  {
    id: 'flutter',
    name: 'Flutter (Windows)',
    description: 'Full Windows desktop preview app via flutter create. Desktop only.',
    icon: '💙',
  },
];

// Mirrors flutter_tools' own potentialValidPackageName() (create_base.dart):
// lowercase, a leading digit gets an underscore prefix, hyphens become
// underscores. Everything else outside [a-z0-9_] is folded to '_' too, which is
// a superset of flutter's rule and keeps the name a legal Dart identifier.
// Used for the Flutter --project-name, which rejects the wizard's own default
// ("my-fabrica-project") otherwise.
function toDartPackageName(projectName: string): string {
  let name = projectName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (/^[0-9]/.test(name)) name = `_${name}`;
  return name || 'fabrica_project';
}

// Files written directly to disk via window.fileSystem.writeFile for every
// template except Flutter, which has to shell out to the real tool instead.
function getScaffoldFiles(
  template: TemplateId,
  projectName: string,
): { relativePath: string; content: string }[] {
  switch (template) {
    case 'web':
      // Three plain static files, no build step and no package.json. The
      // stylesheet/script are linked by relative path, which is what a browser
      // (and a preview that serves from the project folder) expects. NOTE: the
      // current Live Preview panel feeds the editor buffer to iframe.srcdoc, so
      // it renders index.html's markup but does NOT resolve these two relative
      // links — see the report; fixing that lives in Preview.tsx/EditorLayout.
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
      // Top-level statements, no Main() and no .csproj: .NET 10 file-based
      // apps let `dotnet run Program.cs` compile a lone .cs file. The explicit
      // `using System;` is redundant under implicit usings but costs nothing
      // and removes the one way this could fail to compile.
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

    case 'flutter':
    default:
      // Handled by window.flutter.createProject(), not by file writes.
      return [];
  }
}

function useRecentProjects() {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);

  const load = async () => {
    const result = await window.store.getRecentProjects();
    if (result.success && result.projects) {
      setRecentProjects(result.projects);
    }
  };

  const add = async (project: RecentProject) => {
    const result = await window.store.addRecentProject(project);
    if (result.success && result.projects) {
      setRecentProjects(result.projects);
    }
  };

  return { recentProjects, load, add };
}

function SplashScreen({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDone(), 2500);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4" style={{ backgroundColor: '#100718' }}>
      <div className="w-full max-w-xl text-center flex flex-col items-center gap-6">
        <img 
          src={logo} 
          alt="Fabrica IDE Logo" 
          className="w-24 h-24 object-contain"
        />
        <div
          className="text-3xl font-bold"
          style={{ fontFamily: 'Syne, sans-serif', color: '#ffffff' }}
        >
          Fabrica IDE
        </div>
        <div className="text-gray-400 text-base">
          Code Smarter. Work Offline. Build Anything.
        </div>
        <div
          className="w-96 h-2 rounded-full overflow-hidden"
          style={{ backgroundColor: '#180C29' }}
        >
          <div
            className="h-full rounded-full animate-progress"
            style={{ backgroundColor: '#a855f7' }}
          />
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
  const templates = [
    { id: 'web', name: 'Web App Blank', description: 'Templates included', icon: '🌐' },
    { id: 'mobile', name: 'Mobile App', description: 'Templates included', icon: '📱' },
    { id: 'backend', name: 'Backend/API', description: 'Templates included', icon: '⚙️' },
  ];

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#100718', color: '#F5F0FA' }}>
      <div
        className="flex flex-col w-48 lg:w-56 shrink-0"
        style={{ backgroundColor: '#180C29', borderRight: '1px solid rgba(168, 85, 247, 0.24)' }}
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <img src={logo} alt="Fabrica" className="w-6 h-6" />
          <span className="text-base font-semibold hidden sm:block" style={{ color: '#ffffff', fontFamily: 'Segoe UI, sans-serif' }}>
            Fabrica
          </span>
        </div>

        <nav className="flex flex-col gap-0.5 px-2 mt-2">
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded transition-colors hover:bg-white/5"
            style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif' }}
          >
            <span>📁</span> Projects
          </button>
          <div
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded"
            style={{
              backgroundColor: 'rgba(168, 85, 247, 0.15)',
              color: '#a855f7',
              fontFamily: 'Segoe UI, sans-serif',
              cursor: 'default',
            }}
          >
            <span>📋</span> Templates
          </div>
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded transition-colors hover:bg-white/5"
            style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif' }}
          >
            <span>⚙️</span> Settings
          </button>
        </nav>

        <div className="mt-auto px-3 py-3">
          <div className="text-xs" style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif', marginBottom: '4px' }}>
            Offline model
          </div>
          <div
            className="flex items-center justify-between px-3 py-1.5 rounded text-sm"
            style={{
              backgroundColor: '#100718',
              color: '#F5F0FA',
              fontFamily: 'Segoe UI, sans-serif',
              border: '1px solid rgba(168, 85, 247, 0.24)',
            }}
          >
            <span>llama-3.1-8b</span>
            <span style={{ color: '#B8AFC2' }}>▼</span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div
          className="flex items-center justify-between px-4 sm:px-6 py-3 shrink-0"
          style={{ borderBottom: '1px solid rgba(168, 85, 247, 0.24)' }}
        >
          <h1 className="text-base sm:text-lg font-semibold" style={{ color: '#ffffff', fontFamily: 'Segoe UI, sans-serif' }}>
            Templates
          </h1>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            {templates.map((template) => (
              <div
                key={template.id}
                className="p-4 rounded-lg transition-colors hover:bg-white/5"
                style={{
                  backgroundColor: '#180C29',
                  border: '1px solid rgba(168, 85, 247, 0.24)',
                }}
              >
                <div className="text-3xl mb-2">{template.icon}</div>
                <div className="text-sm font-medium" style={{ color: '#ffffff', fontFamily: 'Segoe UI, sans-serif' }}>
                  {template.name}
                </div>
                <div className="text-xs mt-1" style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif' }}>
                  {template.description}
                </div>
                <button
                  className="mt-3 px-3 py-1 text-xs font-medium rounded transition-colors hover:bg-purple-500"
                  style={{
                    backgroundColor: 'rgba(168, 85, 247, 0.2)',
                    color: '#a855f7',
                    border: '1px solid rgba(168, 85, 247, 0.3)',
                  }}
                >
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

// ============================================================
// SETTINGS SCREEN
// ============================================================
function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative inline-flex items-center rounded-full transition-colors duration-200 shrink-0"
      style={{
        width: '38px',
        height: '20px',
        backgroundColor: checked ? '#a855f7' : '#1C0F30',
      }}
    >
      <span
        className="absolute rounded-full bg-white transition-transform duration-200"
        style={{
          width: '14px',
          height: '14px',
          top: '3px',
          left: '3px',
          transform: checked ? 'translateX(18px)' : 'translateX(0)',
        }}
      />
    </button>
  );
}

function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between gap-6 py-3"
      style={{ borderBottom: '1px solid #180C29' }}
    >
      <div>
        <div className="text-sm font-medium" style={{ color: '#ffffff', fontFamily: 'Segoe UI, sans-serif' }}>
          {label}
        </div>
        <div className="text-xs mt-0.5" style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif' }}>
          {description}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function GeneralSettingsCategory() {
  return (
    <div className="text-sm" style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif' }}>
      General settings are coming soon.
    </div>
  );
}

function AppearanceSettingsCategory() {
  return (
    <div className="text-sm" style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif' }}>
      Appearance settings (theme, etc.) are coming soon.
    </div>
  );
}

function EditorSettingsCategory() {
  const [fontSize, setFontSize] = useState(14);
  const [tabSize, setTabSize] = useState(2);
  const [indentType, setIndentType] = useState<'spaces' | 'tabs'>('spaces');
  const [wordWrap, setWordWrap] = useState(true);
  const [lineNumbers, setLineNumbers] = useState(true);

  return (
    <div className="max-w-2xl">
      <SettingsRow label="Font Size" description="Adjust the text size in the code editor.">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={10}
            max={24}
            step={1}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="w-40"
            style={{ accentColor: '#a855f7' }}
          />
          <span
            className="text-xs w-10 text-right"
            style={{ color: '#F5F0FA', fontFamily: 'Space Mono, monospace' }}
          >
            {fontSize}px
          </span>
        </div>
      </SettingsRow>

      <SettingsRow label="Tab Size" description="Number of spaces a tab character represents.">
        <select
          value={tabSize}
          onChange={(e) => setTabSize(Number(e.target.value))}
          className="px-3 py-1.5 rounded text-sm outline-none"
          style={{
            backgroundColor: '#100718',
            color: '#F5F0FA',
            border: '1px solid rgba(168, 85, 247, 0.24)',
            fontFamily: 'Segoe UI, sans-serif',
          }}
        >
          <option value={2}>2</option>
          <option value={4}>4</option>
          <option value={8}>8</option>
        </select>
      </SettingsRow>

      <SettingsRow label="Indentation" description="Insert spaces or tab characters when pressing Tab.">
        <div className="flex rounded overflow-hidden" style={{ border: '1px solid rgba(168, 85, 247, 0.24)' }}>
          {(['spaces', 'tabs'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setIndentType(option)}
              className="px-3 py-1.5 text-xs font-medium capitalize transition-colors"
              style={{
                backgroundColor: indentType === option ? '#a855f7' : '#100718',
                color: indentType === option ? '#ffffff' : '#B8AFC2',
                fontFamily: 'Segoe UI, sans-serif',
              }}
            >
              {option}
            </button>
          ))}
        </div>
      </SettingsRow>

      <SettingsRow label="Word Wrap" description="Wrap long lines to fit the editor width.">
        <ToggleSwitch checked={wordWrap} onChange={setWordWrap} label="Word Wrap" />
      </SettingsRow>

      <SettingsRow label="Line Numbers" description="Show line numbers in the editor gutter.">
        <ToggleSwitch checked={lineNumbers} onChange={setLineNumbers} label="Line Numbers" />
      </SettingsRow>
    </div>
  );
}

function SettingsScreen({ onBack }: { onBack: () => void }) {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('general');

  const categories: { id: SettingsCategory; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'editor', label: 'Editor' },
  ];

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#100718', color: '#F5F0FA' }}>
      <div
        className="flex flex-col w-48 lg:w-56 shrink-0"
        style={{ backgroundColor: '#180C29', borderRight: '1px solid rgba(168, 85, 247, 0.24)' }}
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <img src={logo} alt="Fabrica" className="w-6 h-6" />
          <span className="text-base font-semibold hidden sm:block" style={{ color: '#ffffff', fontFamily: 'Segoe UI, sans-serif' }}>
            Fabrica
          </span>
        </div>

        <nav className="flex flex-col gap-0.5 px-2 mt-2">
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded transition-colors hover:bg-white/5"
            style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif' }}
          >
            <span>📁</span> Projects
          </button>
          <div
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded"
            style={{
              backgroundColor: 'rgba(168, 85, 247, 0.15)',
              color: '#a855f7',
              fontFamily: 'Segoe UI, sans-serif',
              cursor: 'default',
            }}
          >
            <span>⚙️</span> Settings
          </div>
        </nav>

        <div className="mt-auto px-3 py-3">
          <div className="text-xs" style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif', marginBottom: '4px' }}>
            Offline model
          </div>
          <div
            className="flex items-center justify-between px-3 py-1.5 rounded text-sm"
            style={{
              backgroundColor: '#100718',
              color: '#F5F0FA',
              fontFamily: 'Segoe UI, sans-serif',
              border: '1px solid rgba(168, 85, 247, 0.24)',
            }}
          >
            <span>llama-3.1-8b</span>
            <span style={{ color: '#B8AFC2' }}>▼</span>
          </div>
        </div>
      </div>

      <div
        className="flex flex-col w-44 shrink-0"
        style={{ backgroundColor: '#100718', borderRight: '1px solid rgba(168, 85, 247, 0.24)' }}
      >
        <div className="px-4 py-4">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif' }}>
            Categories
          </span>
        </div>
        <nav className="flex flex-col gap-0.5 px-2">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setActiveCategory(category.id)}
              className="w-full text-left px-3 py-1.5 text-sm rounded transition-colors hover:bg-white/5"
              style={{
                backgroundColor: activeCategory === category.id ? 'rgba(168, 85, 247, 0.15)' : 'transparent',
                color: activeCategory === category.id ? '#a855f7' : '#B8AFC2',
                fontFamily: 'Segoe UI, sans-serif',
              }}
            >
              {category.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div
          className="flex items-center justify-between px-4 sm:px-6 py-3 shrink-0"
          style={{ borderBottom: '1px solid rgba(168, 85, 247, 0.24)' }}
        >
          <h1 className="text-base sm:text-lg font-semibold" style={{ color: '#ffffff', fontFamily: 'Segoe UI, sans-serif' }}>
            {categories.find((c) => c.id === activeCategory)?.label}
          </h1>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
          {activeCategory === 'general' && <GeneralSettingsCategory />}
          {activeCategory === 'appearance' && <AppearanceSettingsCategory />}
          {activeCategory === 'editor' && <EditorSettingsCategory />}
        </div>
      </div>
    </div>
  );
}

function NewProjectScreen({
  onBack,
  onCreate,
  onOpenSettings,
  busy,
  progress,
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
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#100718', color: '#F5F0FA' }}>
      <div
        className="flex flex-col w-48 lg:w-56 shrink-0"
        style={{ backgroundColor: '#180C29', borderRight: '1px solid rgba(168, 85, 247, 0.24)' }}
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <img src={logo} alt="Fabrica" className="w-6 h-6" />
          <span className="text-base font-semibold hidden sm:block" style={{ color: '#ffffff', fontFamily: 'Segoe UI, sans-serif' }}>
            Fabrica
          </span>
        </div>

        <nav className="flex flex-col gap-0.5 px-2 mt-2">
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded transition-colors hover:bg-white/5"
            style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif' }}
          >
            <span>📁</span> Projects
          </button>
          <div
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded"
            style={{
              color: '#ffffff',
              fontFamily: 'Segoe UI, sans-serif',
              cursor: 'default',
            }}
          >
            <span>✨</span> New Project
          </div>
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded transition-colors hover:bg-white/5"
            style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif' }}
          >
            <span>⚙️</span> Settings
          </button>
        </nav>

      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div
          className="flex items-center justify-between px-4 sm:px-6 py-3 shrink-0"
          style={{ borderBottom: '1px solid rgba(168, 85, 247, 0.24)' }}
        >
          <h1 className="text-base sm:text-lg font-semibold" style={{ color: '#ffffff', fontFamily: 'Segoe UI, sans-serif' }}>
            New Project
          </h1>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="max-w-3xl mx-auto">
            <p className="text-sm mb-6" style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif' }}>
              Choose a language to scaffold a starter project you can run straight away.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
              {templates.map((template) => {
                const isSelected = selectedTemplate === template.id;
                return (
                  <button
                    key={template.id}
                    onClick={() => setSelectedTemplate(template.id)}
                    className="p-3 sm:p-4 rounded-lg text-left transition-all duration-200"
                    style={{
                      backgroundColor: isSelected ? '#100718' : '#180C29',
                      border: isSelected ? '2px solid #a855f7' : '1px solid rgba(168, 85, 247, 0.24)',
                      transform: isSelected ? 'scale(1.02)' : 'scale(1)',
                      boxShadow: isSelected ? '0 0 20px rgba(168, 85, 247, 0.2)' : 'none',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.backgroundColor = '#1C0F30';
                        e.currentTarget.style.borderColor = '#4d3b6e';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.backgroundColor = '#180C29';
                        e.currentTarget.style.borderColor = 'rgba(168, 85, 247, 0.24)';
                      }
                    }}
                  >
                    <div className="text-2xl sm:text-3xl mb-2">{template.icon}</div>
                    <div 
                      className="text-sm sm:text-base font-medium" 
                      style={{ 
                        color: isSelected ? '#ffffff' : '#F5F0FA', 
                        fontFamily: 'Segoe UI, sans-serif' 
                      }}
                    >
                      {template.name}
                    </div>
                    <div 
                      className="text-xs sm:text-sm" 
                      style={{ 
                        color: isSelected ? '#a855f7' : '#B8AFC2', 
                        fontFamily: 'Segoe UI, sans-serif' 
                      }}
                    >
                      {template.description}
                    </div>
                    {isSelected && (
                      <div 
                        className="mt-2 text-xs font-medium"
                        style={{ color: '#a855f7' }}
                      >
                        ✓ Selected
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mb-6">
              <label className="text-sm font-medium block mb-1.5" style={{ color: '#F5F0FA', fontFamily: 'Segoe UI, sans-serif' }}>
                Project Name
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full px-3 sm:px-4 py-2 rounded text-sm outline-none transition-all duration-200 focus:ring-2 focus:ring-[#a855f7]"
                style={{
                  backgroundColor: '#100718',
                  color: '#F5F0FA',
                  border: '1px solid rgba(168, 85, 247, 0.24)',
                  fontFamily: 'Segoe UI, sans-serif',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                }}
                autoFocus
              />
            </div>

            <div className="mb-6">
              <label className="text-sm font-medium block mb-1.5" style={{ color: '#F5F0FA', fontFamily: 'Segoe UI, sans-serif' }}>
                Git remote URL (optional)
              </label>
              <input
                type="text"
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder="https://github.com/user/repo.git"
                className="w-full px-3 sm:px-4 py-2 rounded text-sm outline-none transition-all duration-200 focus:ring-2 focus:ring-[#a855f7]"
                style={{
                  backgroundColor: '#100718',
                  color: '#F5F0FA',
                  border: '1px solid rgba(168, 85, 247, 0.24)',
                  fontFamily: 'Segoe UI, sans-serif',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                }}
              />
              <p className="text-xs mt-1.5" style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif' }}>
                Leave blank to just initialise a local repository. If filled, the
                project is also wired to this remote as “origin” and gets an
                initial commit.
              </p>
            </div>

            {progress && (
              <pre
                className="mb-4 p-3 rounded text-xs overflow-y-auto whitespace-pre-wrap"
                style={{
                  backgroundColor: '#180C29',
                  color: '#B8AFC2',
                  border: '1px solid rgba(168, 85, 247, 0.24)',
                  maxHeight: '160px',
                  fontFamily: 'Space Mono, monospace',
                }}
              >
                {progress}
              </pre>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={onBack}
                disabled={busy}
                className="px-4 py-2 text-sm rounded transition-colors hover:bg-white/5"
                style={{
                  color: '#B8AFC2',
                  fontFamily: 'Segoe UI, sans-serif',
                  opacity: busy ? 0.5 : 1,
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={busy || !projectName.trim()}
                className="px-4 py-2 text-sm font-medium rounded transition-colors hover:bg-purple-500"
                style={{
                  backgroundColor: busy || !projectName.trim() ? '#1C0F30' : '#a855f7',
                  color: busy || !projectName.trim() ? '#B8AFC2' : '#ffffff',
                  fontFamily: 'Segoe UI, sans-serif',
                  cursor: busy || !projectName.trim() ? 'not-allowed' : 'pointer',
                }}
              >
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
  recentProjects,
  onNewProject,
  onOpenProject,
  onOpenFolder,
  onCloneRepository,
  onOpenSettings,
  onOpenStats,
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
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#100718', color: '#F5F0FA' }}>
      {/* Sidebar */}
      <div
        className="flex flex-col w-48 lg:w-56 shrink-0"
        style={{ backgroundColor: '#180C29', borderRight: '1px solid rgba(168, 85, 247, 0.24)' }}
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <img src={logo} alt="Fabrica" className="w-6 h-6" />
          <span className="text-base font-semibold hidden sm:block" style={{ color: '#ffffff', fontFamily: 'Segoe UI, sans-serif' }}>
            Fabrica
          </span>
        </div>

        <nav className="flex flex-col gap-0.5 px-2 mt-2">
          <button
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded transition-colors"
            style={{
              backgroundColor: 'rgba(168, 85, 247, 0.15)',
              color: '#a855f7',
              fontFamily: 'Segoe UI, sans-serif',
            }}
          >
            <span>📁</span> Projects
          </button>
          <button
            onClick={onOpenStats}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded transition-colors hover:bg-white/5"
            style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif' }}
          >
            <span>📊</span> Stats
          </button>
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded transition-colors hover:bg-white/5"
            style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif' }}
          >
            <span>⚙️</span> Settings
          </button>
        </nav>

        <div className="mt-auto px-3 py-3">
          <div className="text-xs" style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif', marginBottom: '4px' }}>
            Offline model
          </div>
          <div
            className="flex items-center justify-between px-3 py-1.5 rounded text-sm"
            style={{
              backgroundColor: '#100718',
              color: '#F5F0FA',
              fontFamily: 'Segoe UI, sans-serif',
              border: '1px solid rgba(168, 85, 247, 0.24)',
            }}
          >
            <span>llama-3.1-8b</span>
            <span style={{ color: '#B8AFC2' }}>▼</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div
          className="flex items-center justify-between px-4 sm:px-6 py-3 shrink-0"
          style={{ borderBottom: '1px solid rgba(168, 85, 247, 0.24)' }}
        >
          <h1 className="text-base sm:text-lg font-semibold" style={{ color: '#ffffff', fontFamily: 'Segoe UI, sans-serif' }}>
            Projects
          </h1>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
          {/* Tab Buttons - Equal height */}
          <div className="flex gap-3 mb-4">
            <button
              onClick={onNewProject}
              className="flex-1 px-5 py-3 text-sm font-medium rounded-lg transition-all duration-200 hover:scale-[1.02] flex items-center justify-center gap-2"
              style={{
                height: '48px',
                backgroundColor: 'rgba(168, 85, 247, 0.15)',
                color: '#ffffff',
                border: '1px solid rgba(168, 85, 247, 0.3)',
                fontFamily: 'Segoe UI, sans-serif',
              }}
            >
              <span>✨</span> New Project
            </button>
            <button
              onClick={onOpenFolder}
              className="flex-1 px-5 py-3 text-sm font-medium rounded-lg transition-all duration-200 hover:bg-white/5 hover:scale-[1.02] flex items-center justify-center gap-2"
              style={{
                height: '48px',
                backgroundColor: '#180C29',
                color: '#ffffff',
                border: '1px solid rgba(168, 85, 247, 0.24)',
                fontFamily: 'Segoe UI, sans-serif',
              }}
            >
              <span>📂</span> Open Folder
            </button>
            <button
              onClick={openCloneDialog}
              className="flex-1 px-5 py-3 text-sm font-medium rounded-lg transition-all duration-200 hover:bg-white/5 hover:scale-[1.02] flex items-center justify-center gap-2"
              style={{
                height: '48px',
                backgroundColor: '#180C29',
                color: '#ffffff',
                border: '1px solid rgba(168, 85, 247, 0.24)',
                fontFamily: 'Segoe UI, sans-serif',
              }}
            >
              <span>🔗</span> Clone Repository
            </button>
          </div>

          {/* TEMPORARY: device-mirroring test UI. Delete with its import. */}
          <MirrorTest />

          {/* Recent Projects */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-4">
            {recentProjects.length === 0 ? (
              <div className="col-span-full text-center py-12">
                <div className="text-4xl mb-3 opacity-30">📂</div>
                <div className="text-sm" style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif' }}>
                  No projects yet
                </div>
                <div className="text-xs mt-1" style={{ color: '#81748F', fontFamily: 'Segoe UI, sans-serif' }}>
                  Click "New Project" to get started
                </div>
              </div>
            ) : (
              recentProjects.map((project, index) => (
                <div
                  key={project.path}
                  onClick={() => onOpenProject(project)}
                  className="p-3 sm:p-4 rounded-lg cursor-pointer transition-all duration-200 hover:border-purple-500 hover:shadow-lg hover:shadow-purple-500/10 hover:-translate-y-1"
                  style={{
                    backgroundColor: '#180C29',
                    border: '1px solid rgba(168, 85, 247, 0.24)',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div
                      className="w-8 h-8 sm:w-10 sm:h-10 rounded flex items-center justify-center text-base sm:text-lg"
                      style={{ backgroundColor: '#100718' }}
                    >
                      📁
                    </div>
                    <div>
                      <div className="text-xs sm:text-sm font-medium" style={{ color: '#ffffff', fontFamily: 'Segoe UI, sans-serif' }}>
                        {project.name}
                      </div>
                      <div className="text-[10px] sm:text-xs" style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif' }}>
                        {index === 0 ? '2 hours ago' : index === 1 ? 'Yesterday' : '3 days ago'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded" style={{ backgroundColor: '#100718', color: '#B8AFC2' }}>
                      Local
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* What's New */}
          <div
            className="p-3 rounded-lg transition-all duration-200 hover:border-purple-500"
            style={{
              backgroundColor: '#180C29',
              border: '1px solid rgba(168, 85, 247, 0.24)',
            }}
          >
            <div className="text-[10px] sm:text-xs font-medium" style={{ color: '#a855f7', fontFamily: 'Segoe UI, sans-serif' }}>
              WHAT'S NEW
            </div>
            <div className="text-xs sm:text-sm mt-1" style={{ color: '#F5F0FA', fontFamily: 'Segoe UI, sans-serif' }}>
              Offline AI completion for Rust and Go · Faster indexing · Terminal fixes
            </div>
          </div>
        </div>
      </div>

      {/* Clone Repository Dialog */}
      {showCloneDialog && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
          onClick={() => {
            if (!cloneLoading) {
              setShowCloneDialog(false);
              setCloneNotice('');
            }
          }}
        >
          <div
            className="rounded-lg p-6 w-[480px] max-w-[90vw]"
            style={{
              backgroundColor: '#180C29',
              border: '1px solid rgba(168, 85, 247, 0.24)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold" style={{ color: '#ffffff', fontFamily: 'Segoe UI, sans-serif' }}>
                Clone Repository
              </h2>
              <button
                type="button"
                onClick={() => {
                  if (!cloneLoading) {
                    setShowCloneDialog(false);
                    setCloneNotice('');
                  }
                }}
                className="text-[#B8AFC2] hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>

            <p className="text-sm mb-4" style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif' }}>
              Enter the repository URL to clone from GitHub or Git.
            </p>

            <div className="mb-4">
              <label className="text-sm font-medium block mb-1.5" style={{ color: '#F5F0FA', fontFamily: 'Segoe UI, sans-serif' }}>
                Repository URL
              </label>
              <input
                type="text"
                placeholder="https://github.com/user/repo.git"
                value={cloneUrl}
                onChange={(e) => setCloneUrl(e.target.value)}
                className="w-full px-3 py-2 rounded text-sm outline-none transition-all duration-200 focus:ring-2 focus:ring-[#a855f7]"
                style={{
                  backgroundColor: '#100718',
                  color: '#F5F0FA',
                  border: '1px solid rgba(168, 85, 247, 0.24)',
                  fontFamily: 'Segoe UI, sans-serif',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleClone();
                }}
                autoFocus
              />
            </div>

            {cloneNotice && (
              <div className="mb-4 text-sm" style={{ color: cloneNotice.startsWith('✓') ? '#4ade80' : '#f87171' }}>
                {cloneNotice}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!cloneLoading) {
                    setShowCloneDialog(false);
                    setCloneNotice('');
                  }
                }}
                className="px-4 py-1.5 text-sm rounded transition-colors hover:bg-white/5"
                style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={cloneLoading || !cloneUrl.trim()}
                onClick={handleClone}
                className="px-4 py-1.5 text-sm font-medium rounded transition-colors hover:bg-purple-500"
                style={{
                  backgroundColor: cloneLoading || !cloneUrl.trim() ? '#1C0F30' : '#a855f7',
                  color: cloneLoading || !cloneUrl.trim() ? '#B8AFC2' : '#ffffff',
                  cursor: cloneLoading || !cloneUrl.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {cloneLoading ? 'Cloning...' : 'Clone'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  // ===== ALL HOOKS AT TOP LEVEL - UNCONDITIONALLY =====
  const [screen, setScreen] = useState<Screen>('splash');
  const [editorFolder, setEditorFolder] = useState<string | undefined>(undefined);
  const [createBusy, setCreateBusy] = useState(false);
  const [createProgress, setCreateProgress] = useState('');
  const { recentProjects, load: loadRecentProjects, add: addRecentProject } = useRecentProjects();

  // All useEffect hooks at top level
  useEffect(() => {
    void loadRecentProjects();
  }, []);

  useEffect(() => {
    if (screen === 'main' || screen === 'new-project' || screen === 'templates') {
      void loadRecentProjects();
    }
    // Clear any output left over from a previous (possibly failed) create so
    // the wizard doesn't reopen showing a stale log.
    if (screen === 'new-project') {
      setCreateProgress('');
    }
  }, [screen]);

  // `flutter create` is the only scaffold that streams; everything else reports
  // per-file. Subscribed once for the life of the app rather than per-create so
  // no output is missed between the invoke and the first chunk.
  useEffect(() => {
    return window.flutter.onCreateProgress((data) => {
      setCreateProgress((prev) => prev + data);
    });
  }, []);

  // All callback functions
  const openEditor = (folderPath?: string) => {
    // TEMP DIAGNOSTIC (Stats Issue 1 investigation, remove once confirmed):
    // this is the only path that puts a truthy folder into EditorLayout,
    // which is the only place that calls window.stats.startSession(). Logs
    // the argument plus a stack trace so we can see which caller fired it.
    console.log(`[STATS][renderer] openEditor called with folderPath=${folderPath}`);
    console.trace('[STATS][renderer] openEditor call stack');
    setEditorFolder(folderPath);
    setScreen('editor');
  };

  const handleCreateProject = async (
    projectName: string,
    template: TemplateId,
    remoteUrl: string,
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
      // Guards an existing folder: fs:createFolder refuses when the path is
      // already there, which is what stops a scaffold from landing on top of
      // someone's existing project.
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

        // fs:writeFile is a plain writeFileSync — it will not create missing
        // parent directories, so any nested path needs its folder made first.
        const dirs = new Set<string>();
        files.forEach((file) => {
          const idx = file.relativePath.lastIndexOf('/');
          if (idx > 0) dirs.add(file.relativePath.slice(0, idx));
        });
        // eslint-disable-next-line no-restricted-syntax
        for (const dir of Array.from(dirs)) {
          // eslint-disable-next-line no-await-in-loop
          await window.fileSystem.createFolder(`${fullPath}${sep}${dir.split('/').join(sep)}`);
        }

        // Sequential rather than Promise.all so a failure reports the specific
        // file that broke, and the progress log stays in a readable order.
        // eslint-disable-next-line no-restricted-syntax
        for (const file of files) {
          const target = `${fullPath}${sep}${file.relativePath.split('/').join(sep)}`;
          // eslint-disable-next-line no-await-in-loop
          const written = await window.fileSystem.writeFile(target, file.content);
          if (!written.success) {
            log(`✗ Failed to write ${file.relativePath}: ${written.error ?? 'unknown error'}\n`);
            return;
          }
          log(`✓ ${file.relativePath}\n`);
        }
      }

      // Every new project gets a local repo. A remote is only touched when the
      // student actually supplied a URL — a blank field stops at `git init`,
      // with no origin and no commit forced.
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

  // ===== RENDER LOGIC - NO HOOKS HERE =====
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

  // screen === 'main'
  return (
    <MainMenu
      recentProjects={recentProjects}
      onNewProject={() => setScreen('new-project')}
      onOpenProject={(project) => openEditor(project.path)}
      onOpenFolder={handleOpenFolder}
      onCloneRepository={handleCloneRepository}
      onOpenSettings={() => setScreen('settings')}
      onOpenStats={() => setScreen('stats-dashboard')}
    />
  );
}