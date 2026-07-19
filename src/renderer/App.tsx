import { useEffect, useState } from 'react';
import logo from '../assets/log.png';
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
  const [llamaNotice, setLlamaNotice] = useState('');
  const [llamaLoading, setLlamaLoading] = useState(false);

  const quickActions = [
  {
    title: 'New File',
    caption: 'Start a blank workspace',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
          d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" 
        />
      </svg>
    ),
    onClick: onNewFile,
  },
  {
    title: 'Open Folder',
    caption: 'Browse local projects',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
          d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" 
        />
      </svg>
    ),
    onClick: onOpenFolder,
  },
  {
    title: 'Clone Repository',
    caption: 'Pull from remote source',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
          d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" 
        />
      </svg>
    ),
    onClick: () => setShowCloneInput((prev) => !prev),
  },
  {
    title: 'Open Terminal',
    caption: 'Jump into a shell',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
          d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" 
        />
      </svg>
    ),
    onClick: onOpenTerminal,
  },
  {
    title: 'Llama Test Ping',
    caption: 'Run temporary local LLM ping',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9.75 3a.75.75 0 00-.75.75V6h6V3.75a.75.75 0 00-.75-.75h-4.5zM7.5 6v3h9V6m-9 3H6a2 2 0 00-2 2v5.5A2.5 2.5 0 006.5 19h11a2.5 2.5 0 002.5-2.5V11a2 2 0 00-2-2h-1.5m-9 0h9M9 13h6m-6 3h4"
        />
      </svg>
    ),
    onClick: async () => {
      setLlamaLoading(true);
      setLlamaNotice('Running llama-test-ping...');
      const result = await window.ai.llamaTestPing();
      setLlamaLoading(false);
      if (result.success) {
        setLlamaNotice('llama-test-ping completed.');
      } else {
        setLlamaNotice(`llama-test-ping failed: ${result.error ?? 'Unknown error'}`);
      }
    },
  },
];
  

  return (
    <div className="app-glow min-h-screen px-14 py-7 relative overflow-hidden">
      <header className="flex items-center justify-between mb-12 relative z-10">
        <div className="flex items-center gap-3 text-xl font-semibold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          <img src={logo} alt="Fabrica" className="w-8 h-8 object-contain" />
          <span>Fabrica</span>
        </div>
        <nav className="flex items-center gap-6" aria-label="Primary">
          <button 
            type="button" 
            className="text-sm text-gray-400 hover:text-white transition-colors duration-200"
          >
            Docs
          </button>
          <button 
            type="button" 
            className="text-sm text-gray-400 hover:text-white transition-colors duration-200"
          >
            Community
          </button>
          <span className="h-5 w-px" style={{ backgroundColor: 'var(--panel-border)' }} />
          <button
            type="button"
            className="text-sm px-4 py-2 rounded-full border flex items-center gap-2 transition-all duration-200 hover:bg-purple-600 hover:text-white hover:border-purple-600 hover:scale-105"
            style={{ color: '#ffffff', borderColor: '#a855f7' }}
          >
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
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
                  className="flex items-center justify-between w-full px-4 py-3 rounded-xl border mb-3 transition-all duration-200 hover:border-purple-500 hover:bg-purple-900/20 hover:scale-[1.02]"
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
                  <span className="text-sm font-semibold transition-colors duration-200 group-hover:text-purple-400" style={{ color: 'var(--accent)' }}>
                    Open →
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="w-full py-3 rounded-xl font-semibold text-white transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-purple-500/30"
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
                  className="flex flex-col gap-2 p-4 rounded-xl border text-left transition-all duration-200 hover:border-purple-500 hover:bg-purple-900/20 hover:scale-[1.03] hover:shadow-lg hover:shadow-purple-500/10"
                  style={{ background: '#161a2b', borderColor: 'var(--panel-border)' }}
                  onClick={action.onClick}
                >
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center transition-colors duration-200 group-hover:bg-purple-600" style={{ backgroundColor: '#262a3d' }}>
                    <div className="transition-colors duration-200 group-hover:text-purple-400" style={{ color: 'var(--text-muted)' }}>{action.icon}</div>
                  </div>
                  <div className="text-sm font-semibold transition-colors duration-200 group-hover:text-purple-400">{action.title}</div>
                  <div className="text-xs transition-colors duration-200 group-hover:text-gray-300" style={{ color: 'var(--text-muted)' }}>{action.caption}</div>
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
                  className="text-xs px-3 py-2 rounded w-full transition-all duration-200 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
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
                  className="text-xs px-3 py-2 rounded font-semibold transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-purple-500/30"
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
            {llamaNotice ? (
              <p className="text-xs mt-2" style={{ color: llamaLoading ? '#a855f7' : '#86efac' }}>
                {llamaNotice}
              </p>
            ) : null}
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
          <img src={logo} alt="Fabrica" className="w-8 h-8 object-contain" />
          <span
            className="text-xl font-bold"
            style={{ fontFamily: 'Syne, sans-serif', color: '#ffffff' }}
          >
            Fabrica
          </span>
        </div>
        <nav className="flex items-center gap-6" aria-label="Primary">
          <button 
            type="button" 
            className="text-sm text-gray-400 hover:text-white transition-colors duration-200"
          >
            Docs
          </button>
          <button 
            type="button" 
            className="text-sm text-gray-400 hover:text-white transition-colors duration-200"
          >
            Community
          </button>
          <span
            className="h-5 w-px"
            style={{ backgroundColor: '#2d1b4e' }}
          />
          <button
            type="button"
            className="text-sm px-4 py-2 rounded-full border flex items-center gap-2 transition-all duration-200 hover:bg-purple-600 hover:text-white hover:border-purple-600 hover:scale-105"
            style={{ color: '#ffffff', borderColor: '#a855f7' }}
          >
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
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
              className="rounded-xl p-4 border text-left transition-all duration-200 hover:border-purple-500 hover:bg-purple-900/20 hover:scale-[1.02]"
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
              className="w-full px-4 py-3 rounded-xl border mt-2 text-sm placeholder:text-gray-400 transition-all duration-200 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              style={{
                backgroundColor: '#2d1b4e',
                borderColor: '#1a0a2e',
                color: '#ffffff',
                fontFamily: 'Space Mono, monospace',
                outline: 'none',
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
                className="flex-1 px-4 py-3 rounded-xl border text-sm placeholder:text-gray-400 transition-all duration-200 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                style={{
                  backgroundColor: '#2d1b4e',
                  borderColor: '#1a0a2e',
                  color: '#ffffff',
                  fontFamily: 'Space Mono, monospace',
                  outline: 'none',
                }}
                placeholder="/home/user/projects"
                type="text"
                value={projectLocation}
                onChange={(e) => setProjectLocation(e.target.value)}
              />
              <button
                type="button"
                className="px-4 py-3 rounded-xl text-sm font-bold transition-all duration-200 hover:scale-[1.05] hover:shadow-lg hover:shadow-purple-500/30"
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
            className="px-4 py-3 rounded-xl text-sm transition-all duration-200 hover:text-purple-400 hover:scale-[1.02]"
            style={{ color: '#ffffff' }}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="px-6 py-3 rounded-xl text-sm font-bold transition-all duration-200 hover:scale-[1.05] hover:shadow-lg hover:shadow-purple-500/30"
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