import type React from 'react';
import { useEffect, useState, useRef, useMemo, useCallback } from 'react';

import { FileEntry } from '../../types/index';
import './sidebar.css';

interface SidebarProps {
  onFileOpen: (path: string, filename: string) => void;
  initialFolder?: string;
  activeFilePath?: string;
  gitStatusFiles?: string[];
}

interface TreeNode {
  entry: FileEntry;
  children?: TreeNode[];
  isOpen?: boolean;
  isLoading?: boolean;
}

// Simple emoji icons
function getFileIcon(filename: string, isDirectory?: boolean): string {
  if (isDirectory) return '📁';
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  const icons: Record<string, string> = {
    '.html': '🌐',
    '.htm': '🌐',
    '.css': '🎨',
    '.scss': '🎨',
    '.sass': '🎨',
    '.less': '🎨',
    '.js': '📜',
    '.mjs': '📜',
    '.cjs': '📜',
    '.ts': '📘',
    '.tsx': '⚛️',
    '.jsx': '⚛️',
    '.py': '🐍',
    '.json': '📋',
    '.jsonc': '📋',
    '.php': '🐘',
    '.java': '☕',
    '.cs': '🔷',
    '.dart': '🎯',
    '.md': '📝',
    '.txt': '📄',
    '.xml': '📄',
    '.svg': '🖼️',
    '.png': '🖼️',
    '.jpg': '🖼️',
    '.jpeg': '🖼️',
    '.gif': '🖼️',
    '.ico': '🖼️',
    '.gitignore': '📄',
    '.env': '📄',
    '.yml': '📄',
    '.yaml': '📄',
    '.toml': '📄',
    '.sql': '🗄️',
    '.db': '🗄️',
    '.sqlite': '🗄️',
    '.sh': '💻',
    '.bash': '💻',
    '.zsh': '💻',
    '.ps1': '💻',
    '.dockerfile': '🐳',
    '.dockerignore': '🐳',
    '.tf': '📄',
    '.tfvars': '📄',
    '.lock': '🔒',
    '.vue': '🟢',
    '.svelte': '🟠',
    '.go': '🔵',
    '.rb': '❤️',
    '.rs': '🦀',
    '.kt': '📱',
    '.swift': '🦅',
    '.c': '⚙️',
    '.cpp': '⚙️',
    '.h': '⚙️',
    '.hpp': '⚙️',
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

type GitStatusMap = Record<string, string>;

function buildGitStatusMap(statusLines: string[], folderRoot?: string): GitStatusMap {
  const map: GitStatusMap = {};
  if (!folderRoot) return map;
  const sep = folderRoot.includes('\\') ? '\\' : '/';
  for (const line of statusLines) {
    const code = line.slice(0, 2).trim();
    const relPath = line.slice(3).trim();
    if (!relPath) continue;
    const normalizedRel = relPath.replace(/\//g, sep);
    const fullPath = `${folderRoot}${sep}${normalizedRel}`;
    map[fullPath] = code;
  }
  return map;
}

function getStatusBadge(code: string | undefined): { letter: string; color: string } | null {
  if (!code) return null;
  if (code === '??' || code === 'A') return { letter: 'U', color: '#86efac' };
  if (code.includes('M')) return { letter: 'M', color: '#fbbf24' };
  if (code.includes('D')) return { letter: 'D', color: '#f87171' };
  if (code.includes('R')) return { letter: 'R', color: '#93c5fd' };
  return null;
}

// Guard: if the preload bridge isn't ready yet, don't throw mid-render.
function hasFileSystemBridge(): boolean {
  return typeof window !== 'undefined' && !!window.fileSystem;
}

async function loadChildren(dirPath: string): Promise<TreeNode[]> {
  if (!hasFileSystemBridge()) return [];
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

// Opens a specific folder node (loading its children if needed) without
// touching the open/closed state of any of its siblings or ancestors.
async function ensureNodeOpen(targetPath: string, nodes: TreeNode[]): Promise<TreeNode[]> {
  return Promise.all(
    nodes.map(async (node) => {
      if (node.entry.path === targetPath) {
        if (node.isOpen) return node;
        const children = node.children ?? (await loadChildren(node.entry.path));
        return { ...node, isOpen: true, children };
      }
      if (node.children) {
        return { ...node, children: await ensureNodeOpen(targetPath, node.children) };
      }
      return node;
    })
  );
}

// Re-reads a single open node's children from disk while preserving the
// open/closed state (and cached children) of anything nested inside it.
async function refreshNode(node: TreeNode): Promise<TreeNode> {
  if (!node.entry.isDirectory || !node.isOpen) return node;
  const freshChildren = await loadChildren(node.entry.path);
  const withState = await Promise.all(
    freshChildren.map(async (fresh) => {
      const prev = node.children?.find((c) => c.entry.path === fresh.entry.path);
      if (prev?.isOpen) {
        return refreshNode({ ...fresh, isOpen: true, children: prev.children });
      }
      return fresh;
    })
  );
  return { ...node, isOpen: true, children: withState };
}

// Re-reads the whole tree from disk (e.g. after create/rename/delete) but
// keeps every currently-expanded folder expanded, VS Code style.
async function refreshTree(rootPath: string, currentTree: TreeNode[]): Promise<TreeNode[]> {
  const freshRoot = await loadChildren(rootPath);
  return Promise.all(
    freshRoot.map(async (fresh) => {
      const prev = currentTree.find((c) => c.entry.path === fresh.entry.path);
      if (prev?.isOpen) {
        return refreshNode({ ...fresh, isOpen: true, children: prev.children });
      }
      return fresh;
    })
  );
}

interface NewEntryState {
  parentPath: string;
  type: 'file' | 'folder';
}

interface NewEntryRowProps {
  depth: number;
  type: 'file' | 'folder';
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

// Inline "type a name" row rendered directly inside the tree, at the same
// indentation as a sibling of whatever folder is currently selected — this
// is the piece that makes it feel like VS Code's explorer instead of a
// separate text box floating above the tree.
function NewEntryRow({ depth, type, value, onChange, onSubmit, onCancel }: NewEntryRowProps) {
  const indent = depth * 12;
  return (
    <div
      className="w-full flex items-center gap-1.5"
      style={{
        paddingLeft: `${indent + 8}px`,
        paddingRight: '8px',
        minHeight: '22px',
      }}
    >
      <span style={{ fontSize: '14px', flexShrink: 0, width: '18px', textAlign: 'center' }}>
        {type === 'file' ? '📄' : '📁'}
      </span>
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={onSubmit}
        className="text-xs px-1 rounded flex-1 min-w-0"
        style={{
          background: '#1a0a2e',
          color: '#ffffff',
          border: '1px solid #a855f7',
          fontFamily: 'Space Mono, monospace',
          outline: 'none',
        }}
      />
    </div>
  );
}

interface TreeNodeRowProps {
  node: TreeNode;
  depth: number;
  activeFilePath?: string;
  onFileClick: (entry: FileEntry) => void;
  onToggle: (node: TreeNode, path: string[]) => void;
  nodePath: string[];
  gitStatusMap: GitStatusMap;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  renamingPath: string | null;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameSubmit: (entry: FileEntry) => void;
  onRenameCancel: () => void;
  selectedFolderPath?: string | null;
  onSelectFolder?: (path: string | null) => void;
  newEntry: NewEntryState | null;
  newEntryValue: string;
  onNewEntryChange: (value: string) => void;
  onNewEntrySubmit: () => void;
  onNewEntryCancel: () => void;
}

function TreeNodeRow({
  node,
  depth,
  activeFilePath,
  onFileClick,
  onToggle,
  nodePath,
  gitStatusMap,
  onContextMenu,
  renamingPath,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  selectedFolderPath,
  onSelectFolder,
  newEntry,
  newEntryValue,
  onNewEntryChange,
  onNewEntrySubmit,
  onNewEntryCancel,
}: TreeNodeRowProps) {
  const isActive = !node.entry.isDirectory && activeFilePath === node.entry.path;
  const isSelectedFolder = node.entry.isDirectory && selectedFolderPath === node.entry.path;
  const indent = depth * 12;
  const badge = !node.entry.isDirectory ? getStatusBadge(gitStatusMap[node.entry.path]) : null;
  const icon = getFileIcon(node.entry.name, node.entry.isDirectory);
  const isCreatingHere = node.entry.isDirectory && newEntry?.parentPath === node.entry.path;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (node.entry.isDirectory) {
            // Select the folder AND toggle it open
            if (onSelectFolder) {
              onSelectFolder(node.entry.path);
            }
            onToggle(node, nodePath);
          } else {
            onFileClick(node.entry);
          }
        }}
        onContextMenu={(e) => onContextMenu(e, node.entry)}
        className="w-full text-left py-0.5 flex items-center gap-1.5 truncate"
        style={{
          paddingLeft: `${indent + 8}px`,
          paddingRight: '8px',
          color: isActive || isSelectedFolder ? '#ffffff' : '#a7adc5',
          borderLeft: isActive || isSelectedFolder ? '2px solid #a855f7' : '2px solid transparent',
          background: isActive || isSelectedFolder ? 'rgba(168,85,247,0.12)' : 'transparent',
          fontFamily: 'Space Mono, monospace',
          fontSize: '12px',
          minHeight: '22px',
        }}
      >
        {node.entry.isDirectory && (
          <span style={{ fontSize: '10px', color: '#6b7280', flexShrink: 0 }}>
            {node.isOpen ? '▼' : '▶'}
          </span>
        )}
        <span style={{ fontSize: '14px', flexShrink: 0, width: '18px', textAlign: 'center' }}>
          {icon}
        </span>
        {renamingPath === node.entry.path ? (
          <input
            autoFocus
            value={renameValue}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') onRenameSubmit(node.entry);
              if (e.key === 'Escape') onRenameCancel();
            }}
            onBlur={() => onRenameSubmit(node.entry)}
            className="text-xs px-1 rounded flex-1 min-w-0"
            style={{
              background: '#1a0a2e',
              color: '#ffffff',
              border: '1px solid #a855f7',
              fontFamily: 'Space Mono, monospace',
              outline: 'none',
            }}
          />
        ) : (
          <span className="truncate" style={{ color: badge ? badge.color : '#a7adc5' }}>
            {node.entry.name}
          </span>
        )}
        {badge && (
          <span
            className="ml-auto shrink-0 text-xs font-bold"
            style={{ color: badge.color, fontSize: '10px', paddingRight: '4px' }}
          >
            {badge.letter}
          </span>
        )}
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
              gitStatusMap={gitStatusMap}
              onContextMenu={onContextMenu}
              renamingPath={renamingPath}
              renameValue={renameValue}
              onRenameChange={onRenameChange}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              selectedFolderPath={selectedFolderPath}
              onSelectFolder={onSelectFolder}
              newEntry={newEntry}
              newEntryValue={newEntryValue}
              onNewEntryChange={onNewEntryChange}
              onNewEntrySubmit={onNewEntrySubmit}
              onNewEntryCancel={onNewEntryCancel}
            />
          ))}

          {isCreatingHere && (
            <NewEntryRow
              depth={depth + 1}
              type={newEntry!.type}
              value={newEntryValue}
              onChange={onNewEntryChange}
              onSubmit={onNewEntrySubmit}
              onCancel={onNewEntryCancel}
            />
          )}

          {node.children.length === 0 && !isCreatingHere && (
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

export default function Sidebar({ onFileOpen, initialFolder, activeFilePath, gitStatusFiles }: SidebarProps) {
  const [folderName, setFolderName] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [newEntry, setNewEntry] = useState<NewEntryState | null>(null);
  const [newEntryValue, setNewEntryValue] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: FileEntry;
  } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  // Memoized instead of recomputed-and-thrown-away on every render.
  const gitStatusMap = useMemo(
    () => buildGitStatusMap(gitStatusFiles ?? [], folderName ?? undefined),
    [gitStatusFiles, folderName]
  );

  const treeRef = useRef(tree);
  treeRef.current = tree;

  const loadFolder = useCallback(async (folderPath: string) => {
    setFolderName(folderPath);
    const nodes = await loadChildren(folderPath);
    setTree(nodes);
  }, []);

  useEffect(() => {
    if (initialFolder) {
      void loadFolder(initialFolder);
      setSelectedFolder(initialFolder);
    }
  }, [initialFolder, loadFolder]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  const handleOpenFolder = async () => {
    if (!hasFileSystemBridge()) return;
    const folderPath = await window.fileSystem.openFolder();
    if (!folderPath) return;
    await loadFolder(folderPath);
    setSelectedFolder(folderPath);
  };

  const handleFileClick = async (entry: FileEntry) => {
    if (!hasFileSystemBridge()) return;
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
    const updated = await toggleNode(_node.entry.path, treeRef.current);
    setTree(updated);
  };

  // Refreshes the tree from disk without collapsing anything the user
  // already has open (used after create/rename/delete).
  const refreshTreeKeepingOpen = async () => {
    if (!folderName) return;
    const updated = await refreshTree(folderName, treeRef.current);
    setTree(updated);
  };

  const reloadAfterChange = async () => {
    await refreshTreeKeepingOpen();
  };

  // Opens the inline "name it" row nested under whichever folder is
  // selected (or at the root, if nothing/only the root is selected) —
  // mirrors clicking the New File / New Folder icons in VS Code's explorer.
  const handleNewEntryClick = async (type: 'file' | 'folder') => {
    const target = selectedFolder || folderName;
    if (!target) return;

    if (target !== folderName) {
      const updated = await ensureNodeOpen(target, treeRef.current);
      setTree(updated);
    }

    setNewEntry({ parentPath: target, type });
    setNewEntryValue('');
  };

  const handleSubmitNewEntry = async () => {
    if (!newEntry) return;
    const { parentPath, type } = newEntry;
    const trimmed = newEntryValue.trim();

    // Clear immediately so Enter (which blurs the input) and the resulting
    // onBlur don't both try to submit.
    setNewEntry(null);
    setNewEntryValue('');

    if (!trimmed || !hasFileSystemBridge()) return;

    const sep = parentPath.includes('\\') ? '\\' : '/';
    const fullPath = `${parentPath}${sep}${trimmed}`;
    const result =
      type === 'file'
        ? await window.fileSystem.createFile(fullPath)
        : await window.fileSystem.createFolder(fullPath);

    if (result.success) {
      await refreshTreeKeepingOpen();
      setSelectedFolder(parentPath);
    }
  };

  const handleCancelNewEntry = () => {
    setNewEntry(null);
    setNewEntryValue('');
  };

  const findParentDir = (entryPath: string): string => {
    const sep = entryPath.includes('\\') ? '\\' : '/';
    const parts = entryPath.split(sep);
    parts.pop();
    return parts.join(sep);
  };

  const handleRenameSubmit = async (entry: FileEntry) => {
    if (!renameValue.trim() || renameValue.trim() === entry.name) {
      setRenamingPath(null);
      return;
    }
    if (!hasFileSystemBridge()) {
      setRenamingPath(null);
      return;
    }
    const parentDir = findParentDir(entry.path);
    const sep = entry.path.includes('\\') ? '\\' : '/';
    const newPath = `${parentDir}${sep}${renameValue.trim()}`;
    const result = await window.fileSystem.rename(entry.path, newPath);
    setRenamingPath(null);
    if (result.success) {
      await reloadAfterChange();
    }
  };

  const handleDelete = async (entry: FileEntry) => {
    if (!hasFileSystemBridge()) return;
    const confirmed = window.confirm(
      `Delete "${entry.name}"? This cannot be undone.`
    );
    if (!confirmed) return;
    const result = await window.fileSystem.deleteEntry(entry.path);
    setContextMenu(null);
    if (result.success) {
      await reloadAfterChange();
    }
  };

  const activeFilename = activeFilePath
    ? activeFilePath.split(/[\\/]/).pop() ?? ''
    : '';

  const selectedFolderName = selectedFolder
    ? selectedFolder.split(/[\\/]/).pop() ?? selectedFolder
    : null;

  const isCreatingAtRoot = !!(newEntry && folderName && newEntry.parentPath === folderName);

  return (
    <div className="flex flex-col h-full w-48 overflow-hidden" style={{ background: '#2d1b4e' }}>
      {/* Header */}
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
          <button
            type="button"
            onClick={() => void handleNewEntryClick('file')}
            className="w-6 h-6 flex items-center justify-center rounded text-sm"
            style={{ background: '#2d1b4e', color: '#a855f7', border: '1px solid #a855f7' }}
            title={`New File in ${selectedFolderName || 'root'}`}
          >
            📄
          </button>
          <button
            type="button"
            onClick={() => void handleNewEntryClick('folder')}
            className="w-6 h-6 flex items-center justify-center rounded text-sm"
            style={{ background: '#2d1b4e', color: '#a855f7', border: '1px solid #a855f7' }}
            title={`New Folder in ${selectedFolderName || 'root'}`}
          >
            📁
          </button>
        </div>
      </div>

      {/* Show which folder is selected */}
      <div
        className="px-3 py-0.5 text-[10px] truncate shrink-0 cursor-pointer hover:bg-white/5"
        style={{ color: '#a855f7', fontFamily: 'Space Mono, monospace', borderBottom: '1px solid #1a0a2e' }}
        onClick={() => setSelectedFolder(folderName)}
        title="Click to select root folder"
      >
        📍 {selectedFolderName || 'root'}
      </div>

      {/* Folder name */}
      {folderName && (
        <div
          className="px-3 py-1 text-xs font-bold truncate shrink-0 cursor-pointer hover:bg-white/5"
          style={{
            color: selectedFolder === folderName ? '#a855f7' : '#ffffff',
            fontFamily: 'Space Mono, monospace',
            borderBottom: '1px solid #1a0a2e'
          }}
          onClick={() => setSelectedFolder(folderName)}
        >
          📁 {folderName.split(/[\\/]/).pop() ?? folderName}
        </div>
      )}

      {/* File Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {tree.length === 0 && !folderName && (
          <div className="px-3 py-4 text-xs text-center" style={{ color: '#4b5563' }}>
            Open a folder to start
          </div>
        )}

        {isCreatingAtRoot && (
          <NewEntryRow
            depth={0}
            type={newEntry!.type}
            value={newEntryValue}
            onChange={setNewEntryValue}
            onSubmit={handleSubmitNewEntry}
            onCancel={handleCancelNewEntry}
          />
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
            gitStatusMap={gitStatusMap}
            onContextMenu={(e, entry) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({ x: e.clientX, y: e.clientY, entry });
            }}
            renamingPath={renamingPath}
            renameValue={renameValue}
            onRenameChange={setRenameValue}
            onRenameSubmit={handleRenameSubmit}
            onRenameCancel={() => setRenamingPath(null)}
            selectedFolderPath={selectedFolder}
            onSelectFolder={setSelectedFolder}
            newEntry={newEntry}
            newEntryValue={newEntryValue}
            onNewEntryChange={setNewEntryValue}
            onNewEntrySubmit={handleSubmitNewEntry}
            onNewEntryCancel={handleCancelNewEntry}
          />
        ))}
      </div>

      {/* Status Bar */}
      <div className="px-3 py-2 shrink-0">
        <span
          className="text-xs px-2 py-1 rounded-full"
          style={{ background: '#1a0a2e', color: '#a855f7', fontFamily: 'Space Mono, monospace' }}
        >
          {activeFilename ? getLanguageTag(activeFilename) : 'No file open'}
        </span>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="fixed flex flex-col py-1 rounded shadow-lg z-50"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            background: '#1a0a2e',
            border: '1px solid #3d2b5e',
            minWidth: '140px',
          }}
        >
          {!contextMenu.entry.isDirectory && (
            <button
              type="button"
              onClick={() => {
                void handleFileClick(contextMenu.entry);
                setContextMenu(null);
              }}
              className="text-left text-xs px-3 py-1.5"
              style={{ color: '#a7adc5', fontFamily: 'Space Mono, monospace' }}
            >
              Open
            </button>
          )}
          {contextMenu.entry.isDirectory && (
            <button
              type="button"
              onClick={() => {
                setSelectedFolder(contextMenu.entry.path);
                setContextMenu(null);
              }}
              className="text-left text-xs px-3 py-1.5"
              style={{ color: '#a855f7', fontFamily: 'Space Mono, monospace' }}
            >
              Select Folder
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setRenamingPath(contextMenu.entry.path);
              setRenameValue(contextMenu.entry.name);
              setContextMenu(null);
            }}
            className="text-left text-xs px-3 py-1.5"
            style={{ color: '#a7adc5', fontFamily: 'Space Mono, monospace' }}
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => void handleDelete(contextMenu.entry)}
            className="text-left text-xs px-3 py-1.5"
            style={{ color: '#f87171', fontFamily: 'Space Mono, monospace' }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}