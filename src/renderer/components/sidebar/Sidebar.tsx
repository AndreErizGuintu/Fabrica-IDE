import type React from 'react';
import { useEffect, useState, useRef } from 'react';

import { FileEntry } from '../../types/index';
import './sidebar.css';
import { getFileIcon } from '../../utils/fileIcons';

interface SidebarProps {
  onFileOpen: (path: string, filename: string) => void;
  initialFolder?: string;
  activeFilePath?: string;
  gitStatusFiles?: string[];
  refreshSignal?: number;
}

interface TreeNode {
  entry: FileEntry;
  children?: TreeNode[];
  isOpen?: boolean;
  isLoading?: boolean;
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
  gitStatusMap: GitStatusMap;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  renamingPath: string | null;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameSubmit: (entry: FileEntry) => void;
  onRenameCancel: () => void;
  selectedFolderPath?: string | null;
  onSelectFolder?: (path: string | null) => void;
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
}: TreeNodeRowProps) {
  const isActive = !node.entry.isDirectory && activeFilePath === node.entry.path;
  const isSelectedFolder = node.entry.isDirectory && selectedFolderPath === node.entry.path;
  const indent = depth * 12;
  const badge = !node.entry.isDirectory ? getStatusBadge(gitStatusMap[node.entry.path]) : null;
  const iconClass = getFileIcon(node.entry.name, node.entry.isDirectory);
  const iconColor = node.entry.isDirectory
    ? '#dcb67a'
    : iconClass.startsWith('devicon')
      ? undefined
      : '#e8e8f0';

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (node.entry.isDirectory) {
            if (onSelectFolder) {
              onSelectFolder(node.entry.path);
            }
            onToggle(node, nodePath);
          } else {
            onFileClick(node.entry);
          }
        }}
        onContextMenu={(e) => onContextMenu(e, node.entry)}
        className="w-full text-left py-0.5 flex items-center gap-1.5 truncate hover:bg-[#a855f7]/10 transition-colors"
        style={{
          paddingLeft: `${indent + 8}px`,
          paddingRight: '8px',
          color: isActive || isSelectedFolder ? '#ffffff' : '#a7adc5',
          borderLeft: isActive || isSelectedFolder ? '2px solid #a855f7' : '2px solid transparent',
          background: isActive || isSelectedFolder ? 'rgba(168,85,247,0.15)' : 'transparent',
          fontFamily: 'Segoe UI, sans-serif',
          fontSize: '12px',
          minHeight: '22px',
        }}
      >
        {node.entry.isDirectory && (
          <span style={{ color: '#6b7280', flexShrink: 0, display: 'inline-flex' }}>
            <i className={`codicon ${node.isOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} style={{ fontSize: '14px' }} />
          </span>
        )}
        <i
          className={iconClass}
          style={{
            fontSize: '16px',
            lineHeight: '1',
            flexShrink: 0,
            width: '18px',
            textAlign: 'center',
            color: iconColor,
          }}
        />
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
              color: '#d4d4d4',
              border: '1px solid #a855f7',
              fontFamily: 'Segoe UI, sans-serif',
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
            />
          ))}
          {node.children.length === 0 && (
            <div
              style={{
                paddingLeft: `${(depth + 1) * 12 + 8}px`,
                fontSize: '11px',
                color: '#2d1b4e',
                minHeight: '20px',
                display: 'flex',
                alignItems: 'center',
                fontFamily: 'Segoe UI, sans-serif',
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

export default function Sidebar({ 
  onFileOpen, 
  initialFolder, 
  activeFilePath, 
  gitStatusFiles,
  refreshSignal 
}: SidebarProps) {
  const [folderName, setFolderName] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: FileEntry;
  } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const gitStatusMap = buildGitStatusMap(gitStatusFiles ?? [], folderName ?? undefined);

  const fileInputRef = useRef<HTMLDivElement>(null);
  const folderInputRef = useRef<HTMLDivElement>(null);

  const loadFolder = async (folderPath: string) => {
    setFolderName(folderPath);
    const nodes = await loadChildren(folderPath);
    setTree(nodes);
  };

  useEffect(() => {
    if (initialFolder) {
      void loadFolder(initialFolder);
      setSelectedFolder(initialFolder);
    }
  }, [initialFolder]);

  useEffect(() => {
    if (folderName && refreshSignal !== undefined) {
      void loadFolder(folderName);
    }
  }, [refreshSignal]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      
      if (isCreatingFile && fileInputRef.current && !fileInputRef.current.contains(target)) {
        setIsCreatingFile(false);
        setNewFileName('');
      }
      
      if (isCreatingFolder && folderInputRef.current && !folderInputRef.current.contains(target)) {
        setIsCreatingFolder(false);
        setNewFolderName('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isCreatingFile, isCreatingFolder]);

  const handleOpenFolder = async () => {
    const folderPath = await window.fileSystem.openFolder();
    if (!folderPath) return;
    await loadFolder(folderPath);
    setSelectedFolder(folderPath);
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
    if (!newFileName.trim()) return;
    
    const targetFolder = selectedFolder || folderName;
    if (!targetFolder) return;
    
    const sep = targetFolder.includes('\\') ? '\\' : '/';
    const filePath = `${targetFolder}${sep}${newFileName.trim()}`;
    const result = await window.fileSystem.createFile(filePath);
    if (result.success) {
      setNewFileName('');
      setIsCreatingFile(false);
      await loadFolder(folderName!);
      setSelectedFolder(targetFolder);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    
    const targetFolder = selectedFolder || folderName;
    if (!targetFolder) return;
    
    const sep = targetFolder.includes('\\') ? '\\' : '/';
    const folderPath = `${targetFolder}${sep}${newFolderName.trim()}`;
    const result = await window.fileSystem.createFolder(folderPath);
    if (result.success) {
      await loadFolder(folderName!);
      setSelectedFolder(folderPath);
    }
    setIsCreatingFolder(false);
    setNewFolderName('');
  };

  const findParentDir = (entryPath: string): string => {
    const sep = entryPath.includes('\\') ? '\\' : '/';
    const parts = entryPath.split(sep);
    parts.pop();
    return parts.join(sep);
  };

  const reloadAfterChange = async () => {
    if (folderName) {
      await loadFolder(folderName);
    }
  };

  const handleRenameSubmit = async (entry: FileEntry) => {
    if (!renameValue.trim() || renameValue.trim() === entry.name) {
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

  const handleNewFileClick = () => {
    setIsCreatingFolder(false);
    setNewFolderName('');
    setIsCreatingFile(true);
  };

  const handleNewFolderClick = () => {
    setIsCreatingFile(false);
    setNewFileName('');
    setIsCreatingFolder(true);
  };

  const activeFilename = activeFilePath
    ? activeFilePath.split(/[\\/]/).pop() ?? ''
    : '';

  const selectedFolderName = selectedFolder
    ? selectedFolder.split(/[\\/]/).pop() ?? selectedFolder
    : null;

  return (
    <div className="flex flex-col h-full w-52 overflow-hidden" style={{ background: '#1a0a2e' }}>
      {/* Header - Violet Theme */}
      <div className="px-3 py-2 flex items-center justify-between shrink-0" style={{ borderBottom: '1px solid #2d1b4e' }}>
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif' }}>
          Explorer
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={handleNewFileClick}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#a855f7]/20 transition-colors"
            style={{ color: '#a855f7' }}
            title="New File"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
              <path d="M14 5.5V14c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1V2c0-.6.4-1 1-1h6.5L14 5.5z"/>
              <path d="M9.5 2v3.5H13" stroke="currentColor" strokeWidth="1" fill="none"/>
            </svg>
          </button>
          <button
            type="button"
            onClick={handleNewFolderClick}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#a855f7]/20 transition-colors"
            style={{ color: '#a855f7' }}
            title="New Folder"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
              <path d="M13.5 2.5H8.5L6.7.7c-.2-.2-.4-.2-.6-.2H2.5C1.7.5 1 1.2 1 2v12c0 .8.7 1.5 1.5 1.5h11c.8 0 1.5-.7 1.5-1.5V4c0-.8-.7-1.5-1.5-1.5z"/>
            </svg>
          </button>
          <button
            type="button"
            onClick={handleOpenFolder}
            className="ml-0.5 px-2.5 py-1 rounded text-[11px] font-medium transition-opacity hover:opacity-80"
            style={{ background: '#a855f7', color: '#ffffff', fontFamily: 'Segoe UI, sans-serif' }}
            title="Open Folder"
          >
            Open
          </button>
        </div>
      </div>

      {/* Selected folder indicator */}
      <div 
        className="px-3 py-0.5 text-[10px] truncate shrink-0 cursor-pointer hover:bg-[#a855f7]/10"
        style={{ color: '#a855f7', fontFamily: 'Segoe UI, sans-serif', borderBottom: '1px solid #2d1b4e' }}
        onClick={() => setSelectedFolder(folderName)}
        title="Click to select root folder"
      >
        📍 {selectedFolderName || 'root'}
      </div>

      {/* Folder name */}
      {folderName && (
        <div 
          className="px-3 py-1 text-xs truncate shrink-0 cursor-pointer hover:bg-[#a855f7]/10"
          style={{ 
            color: selectedFolder === folderName ? '#a855f7' : '#d4d4d4', 
            fontFamily: 'Segoe UI, sans-serif', 
            borderBottom: '1px solid #2d1b4e' 
          }}
          onClick={() => setSelectedFolder(folderName)}
        >
          📁 {folderName.split(/[\\/]/).pop() ?? folderName}
        </div>
      )}

      {/* Create File Input */}
      {isCreatingFile && (
        <div ref={fileInputRef} className="px-3 py-1 flex gap-1 shrink-0 items-center">
          <i className="codicon codicon-file" style={{ fontSize: '14px', opacity: 0.7 }} />
          <input
            autoFocus
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleCreateFile();
              }
              if (e.key === 'Escape') {
                setIsCreatingFile(false);
                setNewFileName('');
              }
            }}
            placeholder={`file in ${selectedFolderName || 'root'}`}
            className="flex-1 text-xs px-2 py-0.5 rounded outline-none bg-transparent"
            style={{ 
              color: '#a7adc5', 
              border: '1px solid #a855f7',
              fontFamily: 'Segoe UI, sans-serif',
            }}
          />
        </div>
      )}

      {/* Create Folder Input */}
      {isCreatingFolder && (
        <div ref={folderInputRef} className="px-3 py-1 flex gap-1 shrink-0 items-center">
          <i className="codicon codicon-folder" style={{ fontSize: '14px', opacity: 0.7 }} />
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleCreateFolder();
              }
              if (e.key === 'Escape') {
                setIsCreatingFolder(false);
                setNewFolderName('');
              }
            }}
            placeholder={`folder in ${selectedFolderName || 'root'}`}
            className="flex-1 text-xs px-2 py-0.5 rounded outline-none bg-transparent"
            style={{ 
              color: '#a7adc5', 
              border: '1px solid #a855f7',
              fontFamily: 'Segoe UI, sans-serif',
            }}
          />
        </div>
      )}

      {/* File Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {tree.length === 0 && !folderName && (
          <div className="px-3 py-4 text-xs text-center" style={{ color: '#2d1b4e' }}>
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
          />
        ))}
      </div>

      {/* Status Bar */}
      <div className="px-3 py-1.5 shrink-0" style={{ borderTop: '1px solid #2d1b4e', background: '#1a0a2e' }}>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{ background: '#2d1b4e', color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif' }}
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
            border: '1px solid #2d1b4e',
            minWidth: '160px',
          }}
        >
          {!contextMenu.entry.isDirectory && (
            <button
              type="button"
              onClick={() => {
                void handleFileClick(contextMenu.entry);
                setContextMenu(null);
              }}
              className="text-left text-xs px-3 py-1 hover:bg-[#a855f7]/10"
              style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif' }}
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
              className="text-left text-xs px-3 py-1 hover:bg-[#a855f7]/10"
              style={{ color: '#a855f7', fontFamily: 'Segoe UI, sans-serif' }}
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
            className="text-left text-xs px-3 py-1 hover:bg-[#a855f7]/10"
            style={{ color: '#a7adc5', fontFamily: 'Segoe UI, sans-serif' }}
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => void handleDelete(contextMenu.entry)}
            className="text-left text-xs px-3 py-1 hover:bg-[#a855f7]/10"
            style={{ color: '#f87171', fontFamily: 'Segoe UI, sans-serif' }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}