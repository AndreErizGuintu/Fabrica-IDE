import { useState } from 'react';

import { FileEntry } from '../../types/index';
import './sidebar.css';

interface SidebarProps {
  onFileOpen: (path: string, filename: string) => void;
}

function getFileIcon(filename: string, isDirectory?: boolean): string {
  if (isDirectory) return '📁';
  const ext = filename.slice(filename.lastIndexOf('.'));
  const icons: Record<string, string> = {
    '.html': '🌐',
    '.css': '🎨',
    '.php': '🐘',
    '.java': '☕',
    '.cs': '🔷',
    '.dart': '🎯',
    '.js': '📜',
    '.ts': '📘',
    '.json': '📋',
    '.md': '📝',
  };
  return icons[ext] ?? '📄';
}

export default function Sidebar({ onFileOpen }: SidebarProps) {
  const [folderName, setFolderName] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const handleOpenFolder = async () => {
    const folderPath = await window.fileSystem.openFolder();
    if (!folderPath) return;
    const result = await window.fileSystem.readDir(folderPath);
    if (result.success && result.files) {
      setFolderName(folderPath);
      setFiles(result.files);
    }
  };

  const handleFileClick = async (file: FileEntry) => {
    const result = await window.fileSystem.readFile(file.path);
    if (result.success && result.content !== undefined) {
      setActiveFile(file.path);
      onFileOpen(file.path, file.name);
    }
  };

  const handleCreateFile = async () => {
    if (!newFileName.trim() || !folderName) return;
    const sep = folderName.includes('\\') ? '\\' : '/';
    const filePath = `${folderName}${sep}${newFileName.trim()}`;
    const result = await window.fileSystem.createFile(filePath);
    if (result.success) {
      setNewFileName('');
      setIsCreatingFile(false);
      const dir = await window.fileSystem.readDir(folderName);
      if (dir.success && dir.files) setFiles(dir.files);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !folderName) return;
    const sep = folderName.includes('\\') ? '\\' : '/';
    const folderPath = `${folderName}${sep}${newFolderName.trim()}`;
    const result = await window.fileSystem.createFolder(folderPath);
    if (result.success) {
      const dir = await window.fileSystem.readDir(folderName);
      if (dir.success && dir.files) setFiles(dir.files);
    }
    setIsCreatingFolder(false);
    setNewFolderName('');
  };

  return (
    <div className="flex flex-col h-full w-48 overflow-hidden" style={{ background: '#2d1b4e' }}>
      <div className="px-3 py-2 flex items-center justify-between">
        <span
          className="text-xs font-bold tracking-widest text-gray-400"
          style={{ fontFamily: 'Space Mono, monospace' }}
        >
          EXPLORER
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleOpenFolder}
            className="text-xs px-2 py-1 rounded"
            style={{ background: '#a855f7', color: '#ffffff' }}
          >
            Open
          </button>
         {folderName !== null && (
  <>
    <button
      type="button"
      onClick={() => setIsCreatingFile(true)}
      className="w-6 h-6 flex items-center justify-center rounded text-sm"
      style={{
        background: '#2d1b4e',
        color: '#a855f7',
        border: '1px solid #a855f7',
      }}
      title="New File"
    >
      📄
    </button>
    <button
      type="button"
      onClick={() => setIsCreatingFolder(true)}
      className="w-6 h-6 flex items-center justify-center rounded text-sm"
      style={{
        background: '#2d1b4e',
        color: '#a855f7',
        border: '1px solid #a855f7',
      }}
      title="New Folder"
    >
      📁
    </button>
  </>
)}
        </div>
      </div>

      {folderName && (
        <div className="px-3 py-1 text-sm font-bold truncate" style={{ color: '#ffffff' }}>
          📁 {folderName?.split('\\').pop() ?? folderName}
        </div>
      )}

      {isCreatingFile && (
        <div className="px-3 py-2 flex gap-1">
          <input
            autoFocus
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFile();
              if (e.key === 'Escape') {
                setIsCreatingFile(false);
                setNewFileName('');
              }
            }}
            placeholder="filename.html"
            className="flex-1 text-xs px-2 py-1 rounded outline-none"
            style={{
              background: '#1a0a2e',
              color: '#ffffff',
              border: '1px solid #a855f7',
              fontFamily: 'Space Mono, monospace',
            }}
          />
          <button
            type="button"
            onClick={handleCreateFile}
            className="text-xs px-2 py-1 rounded"
            style={{ background: '#a855f7', color: '#ffffff' }}
          >
            ✓
          </button>
        </div>
      )}

      {isCreatingFolder && (
        <div className="px-3 py-2 flex gap-1">
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFolder();
              if (e.key === 'Escape') {
                setIsCreatingFolder(false);
                setNewFolderName('');
              }
            }}
            placeholder="folder-name"
            className="flex-1 text-xs px-2 py-1 rounded outline-none"
            style={{
              background: '#1a0a2e',
              color: '#ffffff',
              border: '1px solid #a855f7',
              fontFamily: 'Space Mono, monospace',
            }}
          />
          <button
            type="button"
            onClick={handleCreateFolder}
            className="text-xs px-2 py-1 rounded"
            style={{ background: '#a855f7', color: '#ffffff' }}
          >
            ✓
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {files.length === 0 && !folderName && (
          <div className="px-3 py-4 text-xs text-gray-500 text-center">
            Open a folder to start
          </div>
        )}
        {files.map((file) => (
          <button
            key={file.path}
            type="button"
            onClick={() => handleFileClick(file)}
            className="w-full text-left px-4 py-1.5 text-sm truncate flex items-center gap-2"
            style={{
              color: activeFile === file.path ? '#ffffff' : '#a7adc5',
              borderLeft:
                activeFile === file.path ? '2px solid #a855f7' : '2px solid transparent',
              background: activeFile === file.path ? 'rgba(168,85,247,0.1)' : 'transparent',
              fontFamily: 'Space Mono, monospace',
            }}
          >
            {getFileIcon(file.name, file.isDirectory)} {file.name}
          </button>
        ))}
      </div>

      <div className="px-3 py-2">
        <span
          className="text-xs px-2 py-1 rounded-full"
          style={{
            background: '#1a0a2e',
            color: '#a855f7',
            fontFamily: 'Space Mono, monospace',
          }}
        >
          HTML • CSS • JS
        </span>
      </div>
    </div>
  );
}
