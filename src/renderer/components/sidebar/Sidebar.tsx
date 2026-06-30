import { useEffect, useState } from 'react';

import { FileEntry } from '../../types/index';
import './sidebar.css';

interface SidebarProps {
  onFileOpen: (path: string, filename: string) => void;
  initialFolder?: string;
  activeFilePath?: string;
}

interface TreeNode {
  entry: FileEntry;
  children?: TreeNode[];
  isOpen?: boolean;
  isLoading?: boolean;
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
    '.tsx': '⚛️',
    '.json': '📋',
    '.md': '📝',
    '.py': '🐍',
    '.txt': '📄',
  };
  return icons[ext] ?? '📄';
}

function getLanguageTag(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  const map: Record<string, string> = {
    '.html': 'HTML',
    '.css': 'CSS',
    '.php': 'PHP',
    '.js': 'JS',
    '.ts': 'TS',
    '.tsx': 'TSX',
    '.cs': 'C#',
    '.dart': 'Dart',
    '.java': 'Java',
    '.py': 'Python',
    '.json': 'JSON',
    '.md': 'Markdown',
  };
  return map[ext] ?? ext.replace('.', '').toUpperCase();
}

async function loadChildren(dirPath: string): Promise<TreeNode[]> {
  const result = await window.fileSystem.readDir(dirPath);
  if (!result.success || !result.files) return [];
  const filtered = result.files.filter((f) => !f.name.startsWith('.') && f.name !== 'node_modules');
  const sorted = [...filtered].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });
  return sorted.map((entry) => ({ entry }));
}

interface TreeNodeRowProps {
  node: TreeNode;
  depth: number;
  activeFilePath?: string;
  onFileClick: (entry: FileEntry) => void;
  onToggle: (node: TreeNode, path: string[]) => void;
  nodePath: string[];
}

function TreeNodeRow({ node, depth, activeFilePath, onFileClick, onToggle, nodePath }: TreeNodeRowProps) {
  const isActive = !node.entry.isDirectory && activeFilePath === node.entry.path;
  const indent = depth * 12;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (node.entry.isDirectory) {
            onToggle(node, nodePath);
          } else {
            onFileClick(node.entry);
          }
        }}
        className="w-full text-left py-0.5 flex items-center gap-1 truncate"
        style={{
          paddingLeft: `${indent + 8}px`,
          paddingRight: '8px',
          color: isActive ? '#ffffff' : '#a7adc5',
          borderLeft: isActive ? '2px solid #a855f7' : '2px solid transparent',
          background: isActive ? 'rgba(168,85,247,0.12)' : 'transparent',
          fontFamily: 'Space Mono, monospace',
          fontSize: '12px',
          minHeight: '22px',
        }}
      >
        {node.entry.isDirectory && (
          <span style={{ fontSize: '9px', color: '#6b7280', flexShrink: 0 }}>
            {node.isOpen ? '▼' : '▶'}
          </span>
        )}
        <span style={{ flexShrink: 0 }}>{getFileIcon(node.entry.name, node.entry.isDirectory)}</span>
        <span className="truncate">{node.entry.name}</span>
        {node.isLoading && (
          <span style={{ color: '#6b7280', fontSize: '10px', marginLeft: '4px' }}>...</span>
        )}
      </button>

      {node.entry.isDirectory && node.isOpen && node.children && (
        <>
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.entry.path}
              node={child}
              depth={depth + 1}
              activeFilePath={activeFilePath}
              onFileClick={onFileClick}
              onToggle={onToggle}
              nodePath={[...nodePath, child.entry.path]}
            />
          ))}
          {node.children.length === 0 && (
            <div
              style={{
                paddingLeft: `${(depth + 1) * 12 + 8}px`,
                fontSize: '11px',
                color: '#4b5563',
                minHeight: '20px',
                display: 'flex',
                alignItems: 'center',
                fontFamily: 'Space Mono, monospace',
              }}
            >
              empty
            </div>
          )}
        </>
      )}
    </>
  );
}

export default function Sidebar({ onFileOpen, initialFolder, activeFilePath }: SidebarProps) {
  const [folderName, setFolderName] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const loadFolder = async (folderPath: string) => {
    setFolderName(folderPath);
    const nodes = await loadChildren(folderPath);
    setTree(nodes);
  };

  useEffect(() => {
    if (initialFolder) {
      void loadFolder(initialFolder);
    }
  }, [initialFolder]);

  const handleOpenFolder = async () => {
    const folderPath = await window.fileSystem.openFolder();
    if (!folderPath) return;
    await loadFolder(folderPath);
  };

  const handleFileClick = async (entry: FileEntry) => {
    const result = await window.fileSystem.readFile(entry.path);
    if (result.success && result.content !== undefined) {
      onFileOpen(entry.path, entry.name);
    }
  };

  const toggleNode = async (targetPath: string, nodes: TreeNode[]): Promise<TreeNode[]> => {
    return Promise.all(
      nodes.map(async (node) => {
        if (node.entry.path === targetPath) {
          if (node.isOpen) {
            return { ...node, isOpen: false };
          }
          const children = node.children ?? await loadChildren(node.entry.path);
          return { ...node, isOpen: true, children };
        }
        if (node.children) {
          return { ...node, children: await toggleNode(targetPath, node.children) };
        }
        return node;
      })
    );
  };

  const handleToggle = async (_node: TreeNode, _nodePath: string[]) => {
    const updated = await toggleNode(_node.entry.path, tree);
    setTree(updated);
  };

  const handleCreateFile = async () => {
    if (!newFileName.trim() || !folderName) return;
    const sep = folderName.includes('\\') ? '\\' : '/';
    const filePath = `${folderName}${sep}${newFileName.trim()}`;
    const result = await window.fileSystem.createFile(filePath);
    if (result.success) {
      setNewFileName('');
      setIsCreatingFile(false);
      await loadFolder(folderName);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !folderName) return;
    const sep = folderName.includes('\\') ? '\\' : '/';
    const folderPath = `${folderName}${sep}${newFolderName.trim()}`;
    const result = await window.fileSystem.createFolder(folderPath);
    if (result.success) {
      await loadFolder(folderName);
    }
    setIsCreatingFolder(false);
    setNewFolderName('');
  };

  const activeFilename = activeFilePath
    ? activeFilePath.split(/[\\/]/).pop() ?? ''
    : '';

  return (
    <div className="flex flex-col h-full w-48 overflow-hidden" style={{ background: '#2d1b4e' }}>
      <div className="px-3 py-2 flex items-center justify-between shrink-0">
        <span
          className="text-xs font-bold tracking-widest"
          style={{ color: '#6b7280', fontFamily: 'Space Mono, monospace' }}
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
                style={{ background: '#2d1b4e', color: '#a855f7', border: '1px solid #a855f7' }}
                title="New File"
              >
                📄
              </button>
              <button
                type="button"
                onClick={() => setIsCreatingFolder(true)}
                className="w-6 h-6 flex items-center justify-center rounded text-sm"
                style={{ background: '#2d1b4e', color: '#a855f7', border: '1px solid #a855f7' }}
                title="New Folder"
              >
                📁
              </button>
            </>
          )}
        </div>
      </div>

      {folderName && (
        <div className="px-3 py-1 text-xs font-bold truncate shrink-0" style={{ color: '#ffffff', fontFamily: 'Space Mono, monospace', borderBottom: '1px solid #1a0a2e' }}>
          📁 {folderName.split(/[\\/]/).pop() ?? folderName}
        </div>
      )}

      {isCreatingFile && (
        <div className="px-3 py-2 flex gap-1 shrink-0">
          <input
            autoFocus
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreateFile();
              if (e.key === 'Escape') {
                setIsCreatingFile(false);
                setNewFileName('');
              }
            }}
            placeholder="filename.html"
            className="flex-1 text-xs px-2 py-1 rounded outline-none"
            style={{ background: '#1a0a2e', color: '#ffffff', border: '1px solid #a855f7', fontFamily: 'Space Mono, monospace' }}
          />
          <button type="button" onClick={() => void handleCreateFile()} className="text-xs px-2 py-1 rounded" style={{ background: '#a855f7', color: '#ffffff' }}>✓</button>
        </div>
      )}

      {isCreatingFolder && (
        <div className="px-3 py-2 flex gap-1 shrink-0">
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreateFolder();
              if (e.key === 'Escape') {
                setIsCreatingFolder(false);
                setNewFolderName('');
              }
            }}
            placeholder="folder-name"
            className="flex-1 text-xs px-2 py-1 rounded outline-none"
            style={{ background: '#1a0a2e', color: '#ffffff', border: '1px solid #a855f7', fontFamily: 'Space Mono, monospace' }}
          />
          <button type="button" onClick={() => void handleCreateFolder()} className="text-xs px-2 py-1 rounded" style={{ background: '#a855f7', color: '#ffffff' }}>✓</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-1">
        {tree.length === 0 && !folderName && (
          <div className="px-3 py-4 text-xs text-center" style={{ color: '#4b5563' }}>
            Open a folder to start
          </div>
        )}
        {tree.map((node) => (
          <TreeNodeRow
            key={node.entry.path}
            node={node}
            depth={0}
            activeFilePath={activeFilePath}
            onFileClick={handleFileClick}
            onToggle={handleToggle}
            nodePath={[node.entry.path]}
          />
        ))}
      </div>

      <div className="px-3 py-2 shrink-0">
        <span
          className="text-xs px-2 py-1 rounded-full"
          style={{ background: '#1a0a2e', color: '#a855f7', fontFamily: 'Space Mono, monospace' }}
        >
          {activeFilename ? getLanguageTag(activeFilename) : 'No file open'}
        </span>
      </div>
    </div>
  );
}
