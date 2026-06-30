import { useEffect, useState } from 'react';
import icon from '../../assets/icon.svg';
import './App.css';
import EditorLayout from './screens/EditorLayout';

type Screen = 'splash' | 'main' | 'create' | 'editor';

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
    <div className="min-h-screen w-full flex items-center justify-center p-4">
      <div className="w-full max-w-xl text-center flex flex-col items-center gap-6">
        <svg
          viewBox="0 0 100 100"
          aria-hidden="true"
          className="w-20 h-20"
        >
          <polygon
            points="50,4 93,27 93,73 50,96 7,73 7,27"
            style={{ fill: '#2d1b4e' }}
          />
        </svg>
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
          style={{ backgroundColor: '#2d1b4e' }}
        >
          <div
            className="h-full rounded-full animate-progress"
            style={{ backgroundColor: '#a855f7' }}
          />
        </div>
      </div>
    </div>
  );
}

function MainMenu({
  recentProjects,
  onCreate,
  onNewFile,
  onOpenFolder,
  onOpenTerminal,
  onOpenRecent,
}: {
  recentProjects: RecentProject[];
  onCreate: () => void;
  onNewFile: () => void;
  onOpenFolder: () => void;
  onOpenTerminal: () => void;
  onOpenRecent: (project: RecentProject) => void;
}) {
  const [cloneNotice, setCloneNotice] = useState('');
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneLoading, setCloneLoading] = useState(false);
  const [showCloneInput, setShowCloneInput] = useState(false);

  const quickActions = [
    {
      title: 'New File',
      caption: 'Start a blank workspace',
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm8 1.5V9h4.5L13 4.5z" />
          <path d="M12 11v6m-3-3h6" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      ),
      onClick: onNewFile,
    },
    {
      title: 'Open Folder',
      caption: 'Browse local projects',
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8.5a2.5 2.5 0 0 1-2.5 2.5H5.5A2.5 2.5 0 0 1 3 16.5V6z" />
        </svg>
      ),
      onClick: onOpenFolder,
    },
    {
      title: 'Clone Repository',
      caption: 'Pull from remote source',
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 4a3 3 0 1 0 2.83 4H14a3 3 0 1 0 2.83 4H9.83A3 3 0 1 0 7 20a3 3 0 0 0 2.83-4H14a3 3 0 1 0-2.83-4H9.83A3 3 0 1 0 7 4z" />
        </svg>
      ),
      onClick: () => setShowCloneInput((prev) => !prev),
    },
    {
      title: 'Open Terminal',
      caption: 'Jump into a shell',
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm2.5 4.5 3 3-3 3"
            stroke="currentColor"
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M12 14h5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      ),
      onClick: onOpenTerminal,
    },
  ];

  return (
    <div className="app-glow min-h-screen px-14 py-7 relative overflow-hidden">
      <header className="flex items-center justify-between mb-12 relative z-10">
        <div className="flex items-center gap-3 text-xl font-semibold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          <img src={icon} alt="Fabrica" className="w-8 h-8" />
          <span>Fabrica</span>
        </div>
        <nav className="flex items-center gap-6" aria-label="Primary">
          <button type="button" className="text-sm text-gray-400">
            Docs
          </button>
          <button type="button" className="text-sm text-gray-400">
            Community
          </button>
          <span className="h-5 w-px" style={{ backgroundColor: 'var(--panel-border)' }} />
          <button
            type="button"
            className="text-sm px-4 py-2 rounded-full border"
            style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
          >
            Connect GitHub
          </button>
        </nav>
      </header>

      <main
        className="grid gap-8 relative z-10"
        style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,0.9fr)' }}
      >
        <section className="flex flex-col gap-8">
          <div>
            <div className="text-xs tracking-[0.2em]" style={{ color: 'var(--text-muted)' }}>
              WELCOME BACK
            </div>
            <h1
              className="text-5xl font-semibold mt-3"
              style={{ fontFamily: 'Space Grotesk, sans-serif' }}
            >
              Welcome to Fabrica IDE
            </h1>
            <p className="text-lg mt-3" style={{ color: 'var(--text-muted)' }}>
              Your offline-first intelligent coding environment.
            </p>
          </div>

          <div
            className="rounded-2xl p-6 backdrop-blur-md border"
            style={{ background: 'var(--panel)', borderColor: 'var(--panel-border)' }}
          >
            <div className="text-sm font-semibold mb-4" style={{ color: 'var(--text-muted)' }}>
              Recent Projects
            </div>
            <div className="h-px w-full mb-5" style={{ backgroundColor: 'var(--panel-border)' }} />
            <div>
              {recentProjects.map((project, index) => (
                <button
                  key={project.name}
                  type="button"
                  className="flex items-center justify-between w-full px-4 py-3 rounded-xl border mb-3"
                  style={{ background: '#161a2b', borderColor: 'var(--panel-border)' }}
                  onClick={() => onOpenRecent(project)}
                >
                  <div>
                    <div
                      className="flex items-center text-sm font-semibold"
                      style={{ color: ['#a855f7', '#06b6d4', '#f43f5e', '#f59e0b', '#22c55e'][index % 5] }}
                    >
                      {project.name}
                    </div>
                    <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      {project.path}
                    </div>
                  </div>
                  <span className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>
                    Open →
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="w-full py-3 rounded-xl font-semibold text-white"
              style={{
                background: 'linear-gradient(120deg, #a855f7 0%, #7c3aed 100%)',
              }}
              onClick={onCreate}
            >
              Start a New Project →
            </button>
          </div>
        </section>

        <section className="flex flex-col gap-8">
          <div
            className="rounded-2xl p-6 backdrop-blur-md border"
            style={{ background: 'var(--panel)', borderColor: 'var(--panel-border)' }}
          >
            <div className="text-sm font-semibold mb-4" style={{ color: 'var(--text-muted)' }}>
              Quick Actions
            </div>
            <div className="grid grid-cols-2 gap-4">
              {quickActions.map((action) => (
                <button
                  key={action.title}
                  type="button"
                  className="flex flex-col gap-2 p-4 rounded-xl border text-left"
                  style={{ background: '#161a2b', borderColor: 'var(--panel-border)' }}
                  onClick={action.onClick}
                >
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#262a3d' }}>
                    <div style={{ color: 'var(--text-muted)' }}>{action.icon}</div>
                  </div>
                  <div className="text-sm font-semibold">{action.title}</div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{action.caption}</div>
                </button>
              ))}
            </div>
            {showCloneInput && (
              <div className="flex flex-col gap-2 mt-2">
                <input
                  type="text"
                  placeholder="https://github.com/user/repo.git"
                  value={cloneUrl}
                  onChange={(e) => setCloneUrl(e.target.value)}
                  className="text-xs px-3 py-2 rounded w-full"
                  style={{
                    background: '#2d1b4e',
                    color: '#ffffff',
                    border: '1px solid #a855f7',
                    fontFamily: 'Space Mono, monospace',
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  disabled={cloneLoading || !cloneUrl.trim()}
                  onClick={async () => {
                    if (!cloneUrl.trim()) return;
                    setCloneLoading(true);
                    setCloneNotice('Cloning...');
                    const targetDir = await window.fileSystem.openFolder();
                    if (!targetDir) {
                      setCloneLoading(false);
                      setCloneNotice('');
                      return;
                    }
                    const result = await window.git.clone(cloneUrl.trim(), targetDir);
                    setCloneLoading(false);
                    setCloneNotice(result.success ? '✓ Cloned successfully!' : `✗ ${result.error ?? 'Clone failed'} ${result.output ?? ''}`);
                    if (result.success) {
                      setCloneUrl('');
                      setShowCloneInput(false);
                    }
                  }}
                  className="text-xs px-3 py-2 rounded font-semibold"
                  style={{
                    background: cloneLoading || !cloneUrl.trim() ? '#2d1b4e' : '#a855f7',
                    color: '#ffffff',
                    cursor: cloneLoading || !cloneUrl.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {cloneLoading ? 'Cloning...' : 'Clone'}
                </button>
                {cloneNotice ? (
                  <p className="text-xs" style={{ color: cloneNotice.startsWith('✓') ? '#86efac' : '#f87171' }}>
                    {cloneNotice}
                  </p>
                ) : null}
              </div>
            )}
          </div>

          <div
            className="rounded-2xl p-6 backdrop-blur-md border"
            style={{ background: 'var(--panel)', borderColor: 'var(--panel-border)' }}
          >
            <div className="text-sm font-semibold mb-4" style={{ color: 'var(--text-muted)' }}>
              What&#39;s New
            </div>
            <ul className="text-sm list-disc pl-5 space-y-2" style={{ color: 'var(--text-muted)' }}>
              <li>Introduced offline AI code completion for Rust and Go.</li>
              <li>Performance improvements in large project indexing.</li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}

function CreateProject({
  onCancel,
  onNext,
}: {
  onCancel: () => void;
  onNext: (folderPath: string) => void;
}) {
  const [selectedType, setSelectedType] = useState('Web App');
  const [projectName, setProjectName] = useState('');
  const [projectLocation, setProjectLocation] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const types = ['Web App', 'Mobile App', 'Backend/API'];

  const handleBrowse = async () => {
    const folderPath = await window.fileSystem.openFolder();
    if (folderPath) {
      setProjectLocation(folderPath);
      setErrorMessage('');
    }
  };

  const handleCreateProject = async () => {
    const trimmedName = projectName.trim();
    const trimmedLocation = projectLocation.trim();

    if (!trimmedName || !trimmedLocation) {
      setErrorMessage('Project name and location are required.');
      return;
    }

    const separator = getPathSeparator(trimmedLocation);
    const normalizedLocation = trimmedLocation.endsWith(separator)
      ? trimmedLocation.slice(0, -1)
      : trimmedLocation;
    const fullPath = `${normalizedLocation}${separator}${trimmedName}`;

    const result = await window.fileSystem.createFolder(fullPath);
    if (!result.success) {
      setErrorMessage(result.error ?? 'Unable to create project folder.');
      return;
    }

    await window.store.addRecentProject({ name: trimmedName, path: fullPath });
    onNext(fullPath);
  };

  return (
    <div className="min-h-screen w-full px-10 py-8">
      <header className="w-full flex items-center justify-between mb-10">
        <div className="flex items-center gap-3">
          <img src={icon} alt="Fabrica" className="w-8 h-8" />
          <span
            className="text-xl font-bold"
            style={{ fontFamily: 'Syne, sans-serif', color: '#ffffff' }}
          >
            Fabrica
          </span>
        </div>
        <nav className="flex items-center gap-6" aria-label="Primary">
          <button type="button" className="text-sm text-gray-400">
            Docs
          </button>
          <button type="button" className="text-sm text-gray-400">
            Community
          </button>
          <span
            className="h-5 w-px"
            style={{ backgroundColor: '#2d1b4e' }}
          />
          <button
            type="button"
            className="text-sm px-4 py-2 rounded-full border"
            style={{ color: '#ffffff', borderColor: '#a855f7' }}
          >
            Connect GitHub
          </button>
        </nav>
      </header>
      <div className="h-px w-full mb-8" style={{ backgroundColor: '#2d1b4e' }} />

      <main className="w-full max-w-3xl mx-auto flex flex-col gap-6">
        <div>
          <h1
            className="text-3xl font-bold"
            style={{ fontFamily: 'Syne, sans-serif', color: '#ffffff' }}
          >
            Create New Project
          </h1>
          <p className="text-gray-400 mt-2">
            Set up your workspace in a few steps.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
            style={{ backgroundColor: '#a855f7', color: '#ffffff' }}
          >
            1
          </div>
          <div className="text-sm" style={{ color: '#ffffff' }}>
            Project Details
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {types.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setSelectedType(type)}
              className="rounded-xl p-4 border text-left"
              style={{
                backgroundColor: '#2d1b4e',
                borderColor: selectedType === type ? '#a855f7' : 'transparent',
                color: '#ffffff',
              }}
            >
              <div className="text-sm font-bold" style={{ color: '#ffffff' }}>
                {type}
              </div>
              <div className="text-xs text-gray-400 mt-2">
                Recommended templates included.
              </div>
            </button>
          ))}
        </div>

        <div className="grid gap-4">
          <div>
            <label className="text-sm" style={{ color: '#ffffff' }}>
              Project Name
            </label>
            <input
              className="w-full px-4 py-3 rounded-xl border mt-2 text-sm placeholder:text-gray-400"
              style={{
                backgroundColor: '#2d1b4e',
                borderColor: '#1a0a2e',
                color: '#ffffff',
                fontFamily: 'Space Mono, monospace',
              }}
              placeholder="my-fabrica-project"
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm" style={{ color: '#ffffff' }}>
              Project Location
            </label>
            <div className="flex items-center gap-3 mt-2">
              <input
                className="flex-1 px-4 py-3 rounded-xl border text-sm placeholder:text-gray-400"
                style={{
                  backgroundColor: '#2d1b4e',
                  borderColor: '#1a0a2e',
                  color: '#ffffff',
                  fontFamily: 'Space Mono, monospace',
                }}
                placeholder="/home/user/projects"
                type="text"
                value={projectLocation}
                onChange={(e) => setProjectLocation(e.target.value)}
              />
              <button
                type="button"
                className="px-4 py-3 rounded-xl text-sm font-bold"
                style={{ backgroundColor: '#a855f7', color: '#ffffff' }}
                  onClick={handleBrowse}
              >
                Browse
              </button>
            </div>
              {errorMessage ? (
                <div className="mt-2 text-sm" style={{ color: '#a855f7' }}>
                  {errorMessage}
                </div>
              ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between mt-2">
          <button
            type="button"
            className="px-4 py-3 rounded-xl text-sm"
            style={{ color: '#ffffff' }}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="px-6 py-3 rounded-xl text-sm font-bold"
            style={{ backgroundColor: '#a855f7', color: '#ffffff' }}
            onClick={handleCreateProject}
          >
            Create Project →
          </button>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('splash');
  const [editorFolder, setEditorFolder] = useState<string | undefined>(undefined);
  const { recentProjects, load: loadRecentProjects, add: addRecentProject } = useRecentProjects();

  useEffect(() => {
    void loadRecentProjects();
  }, []);

  useEffect(() => {
    if (screen === 'main') {
      void loadRecentProjects();
    }
  }, [screen]);

  const openEditor = (folderPath?: string) => {
    setEditorFolder(folderPath);
    setScreen('editor');
  };

  if (screen === 'splash') {
    return <SplashScreen onDone={() => setScreen('main')} />;
  }

  if (screen === 'create') {
    return (
      <CreateProject
        onCancel={() => setScreen('main')}
        onNext={(folderPath) => {
          setEditorFolder(folderPath);
          setScreen('editor');
        }}
      />
    );
  }

  if (screen === 'editor') {
    return <EditorLayout onBack={() => setScreen('main')} initialFolder={editorFolder} />;
  }

  return (
    <MainMenu
      recentProjects={recentProjects}
      onCreate={() => setScreen('create')}
      onNewFile={() => openEditor(undefined)}
      onOpenFolder={async () => {
        const folderPath = await window.fileSystem.openFolder();
        if (!folderPath) return;

        const project = {
          name: getLastPathSegment(folderPath),
          path: folderPath,
        };

        await addRecentProject(project);

        openEditor(folderPath);
      }}
      onOpenTerminal={async () => {
        const fileSystemWithTerminal = window.fileSystem as typeof window.fileSystem & {
          openTerminal: (cwd?: string) => Promise<{ success: boolean; error?: string }>;
        };
        await fileSystemWithTerminal.openTerminal();
      }}
      onOpenRecent={(project) => {
        openEditor(project.path);
      }}
    />
  );
}
