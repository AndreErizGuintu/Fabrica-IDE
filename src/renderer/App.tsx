import { useEffect, useState } from 'react';
import logo from '../assets/log.png';
import './App.css';
import EditorLayout from './screens/EditorLayout';

type Screen = 'splash' | 'main' | 'new-project' | 'editor' | 'templates';

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
    <div className="min-h-screen w-full flex items-center justify-center p-4" style={{ backgroundColor: '#1a0a2e' }}>
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

function TemplatesScreen({ onBack }: { onBack: () => void }) {
  const templates = [
    { id: 'web', name: 'Web App Blank', description: 'Templates included', icon: '🌐' },
    { id: 'mobile', name: 'Mobile App', description: 'Templates included', icon: '📱' },
    { id: 'backend', name: 'Backend/API', description: 'Templates included', icon: '⚙️' },
  ];

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#1a0a2e', color: '#d4d4d4' }}>
      <div
        className="flex flex-col w-48 lg:w-56 shrink-0"
        style={{ backgroundColor: '#2d1b4e', borderRight: '1px solid #3d2b5e' }}
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
            style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif' }}
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
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded transition-colors hover:bg-white/5"
            style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif' }}
          >
            <span>🌐</span> Remote
          </button>
          <button
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded transition-colors hover:bg-white/5"
            style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif' }}
          >
            <span>⚙️</span> Settings
          </button>
        </nav>

        <div className="mt-auto px-3 py-3">
          <div className="text-xs" style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif', marginBottom: '4px' }}>
            Offline model
          </div>
          <div
            className="flex items-center justify-between px-3 py-1.5 rounded text-sm"
            style={{
              backgroundColor: '#1a0a2e',
              color: '#d4d4d4',
              fontFamily: 'Segoe UI, sans-serif',
              border: '1px solid #3d2b5e',
            }}
          >
            <span>llama-3.1-8b</span>
            <span style={{ color: '#a7adc5' }}>▼</span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div
          className="flex items-center justify-between px-4 sm:px-6 py-3 shrink-0"
          style={{ borderBottom: '1px solid #3d2b5e' }}
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
                  backgroundColor: '#2d1b4e',
                  border: '1px solid #3d2b5e',
                }}
              >
                <div className="text-3xl mb-2">{template.icon}</div>
                <div className="text-sm font-medium" style={{ color: '#ffffff', fontFamily: 'Segoe UI, sans-serif' }}>
                  {template.name}
                </div>
                <div className="text-xs mt-1" style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif' }}>
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

function NewProjectScreen({ 
  onBack, 
  onCreate 
}: { 
  onBack: () => void; 
  onCreate: (projectName: string, template: string) => void;
}) {
  const [projectName, setProjectName] = useState('my-fabrica-project');
  const [selectedTemplate, setSelectedTemplate] = useState('web');

  const templates = [
    { id: 'web', name: 'Web App Blank', description: 'Templates included', icon: '🌐' },
    { id: 'mobile', name: 'Mobile App', description: 'Templates included', icon: '📱' },
    { id: 'backend', name: 'Backend/API', description: 'Templates included', icon: '⚙️' },
  ];

  const handleCreate = () => {
    if (projectName.trim()) {
      onCreate(projectName.trim(), selectedTemplate);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#1a0a2e', color: '#d4d4d4' }}>
      <div
        className="flex flex-col w-48 lg:w-56 shrink-0"
        style={{ backgroundColor: '#2d1b4e', borderRight: '1px solid #3d2b5e' }}
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
            style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif' }}
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
            <span>📋</span> Templates
          </div>
          <button
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded transition-colors hover:bg-white/5"
            style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif' }}
          >
            <span>🌐</span> Remote
          </button>
          <button
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded transition-colors hover:bg-white/5"
            style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif' }}
          >
            <span>⚙️</span> Settings
          </button>
        </nav>

        <div className="mt-auto px-3 py-3">
          <div className="text-xs" style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif', marginBottom: '4px' }}>
            Offline model
          </div>
          <div
            className="flex items-center justify-between px-3 py-1.5 rounded text-sm"
            style={{
              backgroundColor: '#1a0a2e',
              color: '#d4d4d4',
              fontFamily: 'Segoe UI, sans-serif',
              border: '1px solid #3d2b5e',
            }}
          >
            <span>llama-3.1-8b</span>
            <span style={{ color: '#a7adc5' }}>▼</span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div
          className="flex items-center justify-between px-4 sm:px-6 py-3 shrink-0"
          style={{ borderBottom: '1px solid #3d2b5e' }}
        >
          <h1 className="text-base sm:text-lg font-semibold" style={{ color: '#ffffff', fontFamily: 'Segoe UI, sans-serif' }}>
            New Project
          </h1>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="max-w-3xl mx-auto">
            <p className="text-sm mb-6" style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif' }}>
              Choose a template to get started.
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
                      backgroundColor: isSelected ? '#1a0a2e' : '#2d1b4e',
                      border: isSelected ? '2px solid #a855f7' : '1px solid #3d2b5e',
                      transform: isSelected ? 'scale(1.02)' : 'scale(1)',
                      boxShadow: isSelected ? '0 0 20px rgba(168, 85, 247, 0.2)' : 'none',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.backgroundColor = '#3d2b5e';
                        e.currentTarget.style.borderColor = '#4d3b6e';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.backgroundColor = '#2d1b4e';
                        e.currentTarget.style.borderColor = '#3d2b5e';
                      }
                    }}
                  >
                    <div className="text-2xl sm:text-3xl mb-2">{template.icon}</div>
                    <div 
                      className="text-sm sm:text-base font-medium" 
                      style={{ 
                        color: isSelected ? '#ffffff' : '#d4d4d4', 
                        fontFamily: 'Segoe UI, sans-serif' 
                      }}
                    >
                      {template.name}
                    </div>
                    <div 
                      className="text-xs sm:text-sm" 
                      style={{ 
                        color: isSelected ? '#a855f7' : '#a7adc5', 
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
              <label className="text-sm font-medium block mb-1.5" style={{ color: '#d4d4d4', fontFamily: 'Segoe UI, sans-serif' }}>
                Project Name
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full px-3 sm:px-4 py-2 rounded text-sm outline-none transition-all duration-200 focus:ring-2 focus:ring-[#a855f7]"
                style={{
                  backgroundColor: '#1a0a2e',
                  color: '#d4d4d4',
                  border: '1px solid #3d2b5e',
                  fontFamily: 'Segoe UI, sans-serif',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                }}
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={onBack}
                className="px-4 py-2 text-sm rounded transition-colors hover:bg-white/5"
                style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif' }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                className="px-4 py-2 text-sm font-medium rounded transition-colors hover:bg-purple-500"
                style={{
                  backgroundColor: '#a855f7',
                  color: '#ffffff',
                  fontFamily: 'Segoe UI, sans-serif',
                }}
              >
                Create Project
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
}: { 
  recentProjects: RecentProject[];
  onNewProject: () => void;
  onOpenProject: (project: RecentProject) => void;
  onOpenFolder: () => void;
  onCloneRepository: (url: string) => Promise<{ success: boolean; error?: string }>;
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
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#1a0a2e', color: '#d4d4d4' }}>
      {/* Sidebar */}
      <div
        className="flex flex-col w-48 lg:w-56 shrink-0"
        style={{ backgroundColor: '#2d1b4e', borderRight: '1px solid #3d2b5e' }}
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
          <div
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded"
            style={{ 
              color: '#ffffff', 
              fontFamily: 'Segoe UI, sans-serif',
              cursor: 'default',
            }}
          >
            <span>📋</span> Templates
          </div>
          <button
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded transition-colors hover:bg-white/5"
            style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif' }}
          >
            <span>🌐</span> Remote
          </button>
          <button
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded transition-colors hover:bg-white/5"
            style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif' }}
          >
            <span>⚙️</span> Settings
          </button>
        </nav>

        <div className="mt-auto px-3 py-3">
          <div className="text-xs" style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif', marginBottom: '4px' }}>
            Offline model
          </div>
          <div
            className="flex items-center justify-between px-3 py-1.5 rounded text-sm"
            style={{
              backgroundColor: '#1a0a2e',
              color: '#d4d4d4',
              fontFamily: 'Segoe UI, sans-serif',
              border: '1px solid #3d2b5e',
            }}
          >
            <span>llama-3.1-8b</span>
            <span style={{ color: '#a7adc5' }}>▼</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div
          className="flex items-center justify-between px-4 sm:px-6 py-3 shrink-0"
          style={{ borderBottom: '1px solid #3d2b5e' }}
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
                backgroundColor: '#2d1b4e',
                color: '#ffffff',
                border: '1px solid #3d2b5e',
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
                backgroundColor: '#2d1b4e',
                color: '#ffffff',
                border: '1px solid #3d2b5e',
                fontFamily: 'Segoe UI, sans-serif',
              }}
            >
              <span>🔗</span> Clone Repository
            </button>
          </div>

          {/* Recent Projects */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-4">
            {recentProjects.length === 0 ? (
              <div className="col-span-full text-center py-12">
                <div className="text-4xl mb-3 opacity-30">📂</div>
                <div className="text-sm" style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif' }}>
                  No projects yet
                </div>
                <div className="text-xs mt-1" style={{ color: '#3d2b5e', fontFamily: 'Segoe UI, sans-serif' }}>
                  Click "New Project" to get started
                </div>
              </div>
            ) : (
              recentProjects.map((project, index) => (
                <div
                  key={project.name}
                  onClick={() => onOpenProject(project)}
                  className="p-3 sm:p-4 rounded-lg cursor-pointer transition-all duration-200 hover:border-purple-500 hover:shadow-lg hover:shadow-purple-500/10 hover:-translate-y-1"
                  style={{
                    backgroundColor: '#2d1b4e',
                    border: '1px solid #3d2b5e',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div
                      className="w-8 h-8 sm:w-10 sm:h-10 rounded flex items-center justify-center text-base sm:text-lg"
                      style={{ backgroundColor: '#1a0a2e' }}
                    >
                      📁
                    </div>
                    <div>
                      <div className="text-xs sm:text-sm font-medium" style={{ color: '#ffffff', fontFamily: 'Segoe UI, sans-serif' }}>
                        {project.name}
                      </div>
                      <div className="text-[10px] sm:text-xs" style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif' }}>
                        {index === 0 ? '2 hours ago' : index === 1 ? 'Yesterday' : '3 days ago'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded" style={{ backgroundColor: '#1a0a2e', color: '#a7adc5' }}>
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
              backgroundColor: '#2d1b4e',
              border: '1px solid #3d2b5e',
            }}
          >
            <div className="text-[10px] sm:text-xs font-medium" style={{ color: '#a855f7', fontFamily: 'Segoe UI, sans-serif' }}>
              WHAT'S NEW
            </div>
            <div className="text-xs sm:text-sm mt-1" style={{ color: '#d4d4d4', fontFamily: 'Segoe UI, sans-serif' }}>
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
              backgroundColor: '#2d1b4e',
              border: '1px solid #3d2b5e',
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
                className="text-[#a7adc5] hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>

            <p className="text-sm mb-4" style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif' }}>
              Enter the repository URL to clone from GitHub or Git.
            </p>

            <div className="mb-4">
              <label className="text-sm font-medium block mb-1.5" style={{ color: '#d4d4d4', fontFamily: 'Segoe UI, sans-serif' }}>
                Repository URL
              </label>
              <input
                type="text"
                placeholder="https://github.com/user/repo.git"
                value={cloneUrl}
                onChange={(e) => setCloneUrl(e.target.value)}
                className="w-full px-3 py-2 rounded text-sm outline-none transition-all duration-200 focus:ring-2 focus:ring-[#a855f7]"
                style={{
                  backgroundColor: '#1a0a2e',
                  color: '#d4d4d4',
                  border: '1px solid #3d2b5e',
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
                style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={cloneLoading || !cloneUrl.trim()}
                onClick={handleClone}
                className="px-4 py-1.5 text-sm font-medium rounded transition-colors hover:bg-purple-500"
                style={{
                  backgroundColor: cloneLoading || !cloneUrl.trim() ? '#3d2b5e' : '#a855f7',
                  color: cloneLoading || !cloneUrl.trim() ? '#a7adc5' : '#ffffff',
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
  const { recentProjects, load: loadRecentProjects, add: addRecentProject } = useRecentProjects();

  // All useEffect hooks at top level
  useEffect(() => {
    void loadRecentProjects();
  }, []);

  useEffect(() => {
    if (screen === 'main' || screen === 'new-project' || screen === 'templates') {
      void loadRecentProjects();
    }
  }, [screen]);

  // All callback functions
  const openEditor = (folderPath?: string) => {
    setEditorFolder(folderPath);
    setScreen('editor');
  };

  const handleCreateProject = async (projectName: string, template: string) => {
    const folderPath = await window.fileSystem.openFolder();
    if (!folderPath) return;

    const sep = getPathSeparator(folderPath);
    const normalizedLocation = folderPath.endsWith(sep) ? folderPath.slice(0, -1) : folderPath;
    const fullPath = `${normalizedLocation}${sep}${projectName}`;

    const result = await window.fileSystem.createFolder(fullPath);
    if (!result.success) {
      console.error('Failed to create project folder:', result.error);
      return;
    }

    await window.store.addRecentProject({ name: projectName, path: fullPath });
    setScreen('main');
    openEditor(fullPath);
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
      />
    );
  }

  if (screen === 'templates') {
    return <TemplatesScreen onBack={() => setScreen('main')} />;
  }

  // screen === 'main'
  return (
    <MainMenu
      recentProjects={recentProjects}
      onNewProject={() => setScreen('new-project')}
      onOpenProject={(project) => openEditor(project.path)}
      onOpenFolder={handleOpenFolder}
      onCloneRepository={handleCloneRepository}
    />
  );
}