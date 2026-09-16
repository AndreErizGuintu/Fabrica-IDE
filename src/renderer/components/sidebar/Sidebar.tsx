import type React from 'react';
import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Rnd } from 'react-rnd';

import { FileEntry } from '../../types/index';
import { getFileIcon } from '../../utils/fileIcons';
import { useTheme } from '../../theme/ThemeContext';

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
    '.html': 'HTML', '.css': 'CSS', '.php': 'PHP', '.js': 'JS', '.ts': 'TS',
    '.tsx': 'TSX', '.cs': 'C#', '.dart': 'Dart', '.java': 'Java', '.py': 'Python',
    '.json': 'JSON', '.md': 'Markdown',
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

function CreateInputRow({
  depth, icon, value, onChange, onSubmit, onCancel, placeholder, inputRef,
}: {
  depth: number; icon: 'file' | 'folder'; value: string;
  onChange: (value: string) => void; onSubmit: () => void; onCancel: () => void;
  placeholder: string; inputRef: React.RefObject<HTMLDivElement>;
}) {
  const { theme } = useTheme();
  const C = theme.ui;
  return (
    <div ref={inputRef} className="flex items-center gap-1.5"
      onClick={(e) => e.stopPropagation()}
      style={{
        paddingLeft: `${depth * 12 + 8}px`, paddingRight: '8px', minHeight: '22px',
      }}>
      <i className={`codicon codicon-${icon}`} style={{ fontSize: '14px', opacity: 0.7, flexShrink: 0, color: C.textSecondary }} />
      <input autoFocus value={value} onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onSubmit(); }
          if (e.key === 'Escape') { onCancel(); }
        }}
        placeholder={placeholder}
        className="flex-1 min-w-0 text-xs px-2 py-0.5 rounded outline-none"
        style={{
          color: C.textPrimary,
          background: C.bgInput,
          border: `1px solid ${C.accentAI}`,
          fontFamily: 'Segoe UI, sans-serif',
        }}
      />
    </div>
  );
}

interface TreeNodeRowProps {
  node: TreeNode; depth: number; activeFilePath?: string;
  onFileClick: (entry: FileEntry) => void;
  onToggle: (node: TreeNode, path: string[]) => void;
  nodePath: string[]; gitStatusMap: GitStatusMap;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  renamingPath: string | null; renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameSubmit: (entry: FileEntry) => void; onRenameCancel: () => void;
  selectedFolderPath?: string | null; onSelectFolder?: (path: string | null) => void;
  visuallySelectedPath: string | null; onVisualSelect: (path: string) => void;
  lastInteractedPath: string | null;
  creationTarget: string | null; isCreatingFile: boolean; isCreatingFolder: boolean;
  newFileName: string; newFolderName: string;
  onNewFileNameChange: (value: string) => void; onNewFolderNameChange: (value: string) => void;
  onCreateFileSubmit: () => void; onCreateFolderSubmit: () => void;
  onCreateFileCancel: () => void; onCreateFolderCancel: () => void;
  fileInputRef: React.RefObject<HTMLDivElement>;
  folderInputRef: React.RefObject<HTMLDivElement>;
  animationDelay?: number;
}

function TreeNodeRow({
  node, depth, activeFilePath, onFileClick, onToggle, nodePath, gitStatusMap,
  onContextMenu, renamingPath, renameValue, onRenameChange, onRenameSubmit,
  onRenameCancel, selectedFolderPath, onSelectFolder, visuallySelectedPath,
  onVisualSelect, lastInteractedPath, creationTarget,
  isCreatingFile, isCreatingFolder, newFileName, newFolderName,
  onNewFileNameChange, onNewFolderNameChange, onCreateFileSubmit,
  onCreateFolderSubmit, onCreateFileCancel, onCreateFolderCancel,
  fileInputRef, folderInputRef, animationDelay = 0,
}: TreeNodeRowProps) {
  const { theme } = useTheme();
  const C = theme.ui;
  const isVisuallySelected = !node.entry.isDirectory && visuallySelectedPath === node.entry.path;
  const isSelectedFolder = node.entry.isDirectory && (
    visuallySelectedPath
      ? visuallySelectedPath === node.entry.path
      : selectedFolderPath === node.entry.path
  );
  const isDimmed =
    !node.entry.isDirectory &&
    !isVisuallySelected &&
    lastInteractedPath === node.entry.path;
  const isOpenFile =
    !node.entry.isDirectory &&
    !isVisuallySelected &&
    !isDimmed &&
    activeFilePath === node.entry.path;
  const indent = depth * 12;
  const badge = !node.entry.isDirectory ? getStatusBadge(gitStatusMap[node.entry.path]) : null;
  const iconClass = getFileIcon(node.entry.name, node.entry.isDirectory);
  const iconColor = node.entry.isDirectory
    ? '#dcb67a'
    : iconClass.startsWith('devicon') ? undefined : C.textPrimary;

  return (
    <>
      <button type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (node.entry.isDirectory) {
            if (onSelectFolder) onSelectFolder(node.entry.path);
            onVisualSelect(node.entry.path);
            onToggle(node, nodePath);
          } else {
            onVisualSelect(node.entry.path);
            if (onSelectFolder) onSelectFolder(null);
            onFileClick(node.entry);
          }
        }}
        onContextMenu={(e) => onContextMenu(e, node.entry)}
        className="w-full text-left py-0.5 flex items-center gap-1.5 truncate"
        style={{
          paddingLeft: `${indent + 14}px`, paddingRight: '8px',
          color: isVisuallySelected || isSelectedFolder || isDimmed || isOpenFile ? C.textPrimary : C.textSecondary,
          borderLeft: isVisuallySelected || isSelectedFolder
            ? `2px solid ${C.accentAI}`
            : isDimmed
              ? '2px solid rgba(168, 85, 247, 0.35)'
              : isOpenFile
                ? '2px solid rgba(168, 85, 247, 0.2)'
                : '2px solid transparent',
          background: isVisuallySelected || isSelectedFolder
            ? C.bgSelected
            : isDimmed
              ? 'rgba(168, 85, 247, 0.08)'
              : isOpenFile
                ? 'rgba(168, 85, 247, 0.04)'
                : 'transparent',
          fontFamily: 'Segoe UI, sans-serif', fontSize: '12px', minHeight: '22px',
          transition: 'background 0.15s ease, color 0.15s ease, border-left 0.15s ease',
          animation: `fabricaRowIn 0.3s cubic-bezier(0.4, 0, 0.2, 1) ${animationDelay}ms both`,
        }}
        onMouseEnter={(e) => {
          if (!isVisuallySelected && !isSelectedFolder) e.currentTarget.style.background = 'rgba(168, 85, 247, 0.08)';
        }}
        onMouseLeave={(e) => {
          if (!isVisuallySelected && !isSelectedFolder) {
            e.currentTarget.style.background = isDimmed
              ? 'rgba(168, 85, 247, 0.08)'
              : isOpenFile
                ? 'rgba(168, 85, 247, 0.04)'
                : 'transparent';
          }
        }}
      >
        {node.entry.isDirectory && (
          <span style={{ color: C.textMuted, flexShrink: 0, display: 'inline-flex' }}>
            <i className={`codicon ${node.isOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} style={{ fontSize: '14px' }} />
          </span>
        )}
        <i className={iconClass} style={{
          fontSize: '16px', lineHeight: '1', flexShrink: 0, width: '18px',
          textAlign: 'center', color: iconColor,
        }} />
        {renamingPath === node.entry.path ? (
          <input autoFocus value={renameValue}
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
              background: C.bgInput, color: C.textPrimary, border: `1px solid ${C.accentAI}`,
              fontFamily: 'Segoe UI, sans-serif', outline: 'none',
            }}
          />
        ) : (
          <span className="truncate" style={{ color: badge ? badge.color : C.textSecondary }}>
            {node.entry.name}
          </span>
        )}
        {badge && (
          <span className="ml-auto shrink-0 text-xs font-bold"
            style={{ color: badge.color, fontSize: '10px', paddingRight: '4px' }}>
            {badge.letter}
          </span>
        )}
        {node.isLoading && (
          <span style={{ color: C.textMuted, fontSize: '10px', marginLeft: '4px' }}>...</span>
        )}
      </button>

      {node.entry.isDirectory && node.isOpen && node.children && (
        <div style={{ position: 'relative' }}>
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${(depth + 1) * 12 + 3}px`, width: '1px',
            background: 'rgba(168, 85, 247, 0.12)',
          }} />
          {node.children.map((child, idx) => (
            <TreeNodeRow key={child.entry.path} node={child} depth={depth + 1}
              activeFilePath={activeFilePath} onFileClick={onFileClick} onToggle={onToggle}
              nodePath={[...nodePath, child.entry.path]} gitStatusMap={gitStatusMap}
              onContextMenu={onContextMenu} renamingPath={renamingPath} renameValue={renameValue}
              onRenameChange={onRenameChange} onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel} selectedFolderPath={selectedFolderPath}
              onSelectFolder={onSelectFolder} visuallySelectedPath={visuallySelectedPath}
              onVisualSelect={onVisualSelect} lastInteractedPath={lastInteractedPath}
              creationTarget={creationTarget}
              isCreatingFile={isCreatingFile} isCreatingFolder={isCreatingFolder}
              newFileName={newFileName} newFolderName={newFolderName}
              onNewFileNameChange={onNewFileNameChange}
              onNewFolderNameChange={onNewFolderNameChange}
              onCreateFileSubmit={onCreateFileSubmit}
              onCreateFolderSubmit={onCreateFolderSubmit}
              onCreateFileCancel={onCreateFileCancel}
              onCreateFolderCancel={onCreateFolderCancel}
              fileInputRef={fileInputRef} folderInputRef={folderInputRef}
              animationDelay={idx * 20}
            />
          ))}
          {creationTarget === node.entry.path && isCreatingFile && (
            <CreateInputRow depth={depth + 1} icon="file" value={newFileName}
              onChange={onNewFileNameChange} onSubmit={onCreateFileSubmit}
              onCancel={onCreateFileCancel} placeholder={`file in ${node.entry.name}`}
              inputRef={fileInputRef} />
          )}
          {creationTarget === node.entry.path && isCreatingFolder && (
            <CreateInputRow depth={depth + 1} icon="folder" value={newFolderName}
              onChange={onNewFolderNameChange} onSubmit={onCreateFolderSubmit}
              onCancel={onCreateFolderCancel} placeholder={`folder in ${node.entry.name}`}
              inputRef={folderInputRef} />
          )}
          {node.children.length === 0 && !(creationTarget === node.entry.path && (isCreatingFile || isCreatingFolder)) && (
            <div style={{
              paddingLeft: `${(depth + 1) * 12 + 8}px`, fontSize: '11px', color: C.textMuted,
              minHeight: '20px', display: 'flex', alignItems: 'center',
              fontFamily: 'Segoe UI, sans-serif',
            }}>
              empty
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default function Sidebar({
  onFileOpen, initialFolder, activeFilePath, gitStatusFiles, refreshSignal,
}: SidebarProps) {
  const { theme } = useTheme();
  const C = theme.ui;
  const [folderName, setFolderName] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);
  const [contextMenuSize, setContextMenuSize] = useState({ width: 180, height: 224 });
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [creationTarget, setCreationTarget] = useState<string | null>(null);
  const [visuallySelectedPath, setVisuallySelectedPath] = useState<string | null>(null);
  const [lastInteractedPath, setLastInteractedPath] = useState<string | null>(null);
  const [isRootExpanded, setIsRootExpanded] = useState(true);
  const handleVisualSelect = (path: string | null) => {
    setVisuallySelectedPath(path);
    if (path) setLastInteractedPath(path);
  };
  const gitStatusMap = buildGitStatusMap(gitStatusFiles ?? [], folderName ?? undefined);

  const fileInputRef = useRef<HTMLDivElement>(null);
  const folderInputRef = useRef<HTMLDivElement>(null);
  const treeScrollRef = useRef<HTMLDivElement>(null);
  const [isTreeScrolling, setIsTreeScrolling] = useState(false);
  const scrollIdleTimerRef = useRef<number | null>(null);

  // Hover state for the header action icons
  const sidebarContainerRef = useRef<HTMLDivElement>(null);
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);

  useEffect(() => {
    const el = sidebarContainerRef.current;
    if (!el) return undefined;
    const onEnter = () => setIsSidebarHovered(true);
    const onLeave = () => setIsSidebarHovered(false);
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  const [isTreeEntering, setIsTreeEntering] = useState(false);
  useEffect(() => {
    if (tree.length === 0) return;
    setIsTreeEntering(true);
    const t = setTimeout(() => setIsTreeEntering(false), 500);
    return () => clearTimeout(t);
  }, [tree]);

  const handleTreeScroll = () => {
    setIsTreeScrolling(true);
    if (scrollIdleTimerRef.current !== null) window.clearTimeout(scrollIdleTimerRef.current);
    scrollIdleTimerRef.current = window.setTimeout(() => setIsTreeScrolling(false), 900);
  };

  useEffect(() => () => {
    if (scrollIdleTimerRef.current !== null) window.clearTimeout(scrollIdleTimerRef.current);
  }, []);

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
    if (folderName && refreshSignal !== undefined) void loadFolder(folderName);
  }, [refreshSignal]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [contextMenu]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (isCreatingFile && fileInputRef.current && !fileInputRef.current.contains(target)) {
        setIsCreatingFile(false); setNewFileName('');
      }
      if (isCreatingFolder && folderInputRef.current && !folderInputRef.current.contains(target)) {
        setIsCreatingFolder(false); setNewFolderName('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isCreatingFile, isCreatingFolder]);

  const handleOpenFolder = async () => {
    const folderPath = await window.fileSystem.openFolder();
    if (!folderPath) return;
    await loadFolder(folderPath);
    setSelectedFolder(folderPath);
  };

  const handleFileClick = async (entry: FileEntry) => {
    const result = await window.fileSystem.readFile(entry.path);
    if (result.success && result.content !== undefined) onFileOpen(entry.path, entry.name);
  };

  const toggleNode = async (targetPath: string, nodes: TreeNode[]): Promise<TreeNode[]> => {
    return Promise.all(nodes.map(async (node) => {
      if (node.entry.path === targetPath) {
        if (node.isOpen) return { ...node, isOpen: false };
        const children = node.children ?? await loadChildren(node.entry.path);
        return { ...node, isOpen: true, children };
      }
      if (node.children) return { ...node, children: await toggleNode(targetPath, node.children) };
      return node;
    }));
  };

  const handleToggle = async (_node: TreeNode, _nodePath: string[]) => {
    const updated = await toggleNode(_node.entry.path, tree);
    setTree(updated);
  };

  const openNode = async (targetPath: string, nodes: TreeNode[]): Promise<TreeNode[]> => {
    return Promise.all(nodes.map(async (node) => {
      if (node.entry.path === targetPath) {
        const children = node.children ?? await loadChildren(node.entry.path);
        return { ...node, isOpen: true, children };
      }
      if (node.children) return { ...node, children: await openNode(targetPath, node.children) };
      return node;
    }));
  };

  const getAncestorChain = (root: string, target: string): string[] => {
    if (target === root || !target.startsWith(root)) return [];
    const sep = target.includes('\\') ? '\\' : '/';
    const rest = target.slice(root.length).replace(/^[\\/]/, '');
    if (!rest) return [];
    const chain: string[] = [];
    let current = root;
    rest.split(sep).filter(Boolean).forEach((segment) => {
      current = `${current}${sep}${segment}`;
      chain.push(current);
    });
    return chain;
  };

  const reloadAndExpand = async (targetFolder: string) => {
    if (!folderName) return;
    let nodes = await loadChildren(folderName);
    const chain = getAncestorChain(folderName, targetFolder);
    for (let i = 0; i < chain.length; i += 1) {
      nodes = await openNode(chain[i], nodes);
    }
    setTree(nodes);
  };

  const expandChainInPlace = async (targetFolder: string) => {
    if (!folderName || targetFolder === folderName) return;
    let nodes = tree;
    const chain = getAncestorChain(folderName, targetFolder);
    for (let i = 0; i < chain.length; i += 1) {
      nodes = await openNode(chain[i], nodes);
    }
    setTree(nodes);
  };

  const handleCreateFile = async (targetFolder?: string | null) => {
    if (!newFileName.trim()) return;
    const resolvedTarget = targetFolder ?? selectedFolder ?? folderName;
    if (!resolvedTarget) return;
    const sep = resolvedTarget.includes('\\') ? '\\' : '/';
    const filePath = `${resolvedTarget}${sep}${newFileName.trim()}`;
    const result = await window.fileSystem.createFile(filePath);
    if (result.success) {
      setNewFileName(''); setIsCreatingFile(false);
      await reloadAndExpand(resolvedTarget);
      setSelectedFolder(resolvedTarget);
      handleVisualSelect(filePath);
    }
  };

  const handleCreateFolder = async (targetFolder?: string | null) => {
    if (!newFolderName.trim()) return;
    const resolvedTarget = targetFolder ?? selectedFolder ?? folderName;
    if (!resolvedTarget) return;
    const sep = resolvedTarget.includes('\\') ? '\\' : '/';
    const folderPath = `${resolvedTarget}${sep}${newFolderName.trim()}`;
    const result = await window.fileSystem.createFolder(folderPath);
    if (result.success) {
      await reloadAndExpand(resolvedTarget);
      setSelectedFolder(folderPath);
      handleVisualSelect(folderPath);
    }
    setIsCreatingFolder(false); setNewFolderName('');
  };

  const findParentDir = (entryPath: string): string => {
    const sep = entryPath.includes('\\') ? '\\' : '/';
    const parts = entryPath.split(sep);
    parts.pop();
    return parts.join(sep);
  };

  const reloadAfterChange = async () => { if (folderName) await loadFolder(folderName); };

  const handleRenameSubmit = async (entry: FileEntry) => {
    if (!renameValue.trim() || renameValue.trim() === entry.name) { setRenamingPath(null); return; }
    const parentDir = findParentDir(entry.path);
    const sep = entry.path.includes('\\') ? '\\' : '/';
    const newPath = `${parentDir}${sep}${renameValue.trim()}`;
    const result = await window.fileSystem.rename(entry.path, newPath);
    setRenamingPath(null);
    if (result.success) await reloadAfterChange();
  };

  const handleDelete = async (entry: FileEntry) => {
    const confirmed = window.confirm(`Delete "${entry.name}"? This cannot be undone.`);
    if (!confirmed) return;
    const result = await window.fileSystem.deleteEntry(entry.path);
    setContextMenu(null);
    if (result.success) await reloadAfterChange();
  };

  const handleNewFileClick = async (targetFolder?: string) => {
    const resolved = targetFolder ?? selectedFolder ?? folderName;
    setIsCreatingFolder(false); setNewFolderName('');
    setCreationTarget(resolved);
    if (resolved) await expandChainInPlace(resolved);
    setIsCreatingFile(true);
  };

  const handleNewFolderClick = async (targetFolder?: string) => {
    const resolved = targetFolder ?? selectedFolder ?? folderName;
    setIsCreatingFile(false); setNewFileName('');
    setCreationTarget(resolved);
    if (resolved) await expandChainInPlace(resolved);
    setIsCreatingFolder(true);
  };

  const rootFolderName = folderName
    ? folderName.split(/[\\/]/).filter(Boolean).pop() ?? 'workspace'
    : null;
  const activeFilename = activeFilePath ? activeFilePath.split(/[\\/]/).pop() ?? '' : '';
  const creationTargetName = creationTarget ? creationTarget.split(/[\\/]/).pop() ?? creationTarget : null;
  const contextMenuTargetDir = contextMenu
    ? contextMenu.entry.isDirectory ? contextMenu.entry.path : findParentDir(contextMenu.entry.path)
    : null;

  const headerActionStyle: React.CSSProperties = {
    width: 22,
    height: 22,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 5,
    background: 'transparent',
    border: 'none',
    color: C.textSecondary,
    cursor: 'pointer',
    transition: 'background 0.15s ease, color 0.15s ease',
  };

  return (
    <div
      ref={sidebarContainerRef}
      className="flex flex-col h-full w-full overflow-hidden"
      style={{ background: C.bgSidebar }}
    >
      {/* Inline CSS — replaces sidebar.css */}
      <style>{`
        @keyframes fabricaRowIn {
          from { opacity: 0; transform: translateX(-6px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .explorer-scroll::-webkit-scrollbar {
          width: 8px;
        }
        .explorer-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .explorer-scroll::-webkit-scrollbar-thumb {
          background-color: transparent;
          border-radius: 4px;
          border: 2.5px solid transparent;
          background-clip: padding-box;
          transition: background-color 0.2s ease;
        }
        .explorer-scroll:hover::-webkit-scrollbar-thumb,
        .explorer-scroll.is-scrolling::-webkit-scrollbar-thumb {
          background-color: rgba(255, 255, 255, 0.18);
        }
      `}</style>

      {/* Header — Explorer + 3 hover-revealed action icons */}
      <div className="px-3 py-2 flex items-center justify-between shrink-0"
        style={{
          borderBottom: `1px solid ${C.border}`,
          height: '36px',
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
        }}>
        <span className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: C.textSecondary, fontFamily: 'Segoe UI, sans-serif', letterSpacing: '0.08em' }}>
          Explorer
        </span>

        <div
          className="flex items-center gap-0.5"
          style={{
            opacity: isSidebarHovered ? 1 : 0,
            pointerEvents: isSidebarHovered ? 'auto' : 'none',
            transition: 'opacity 0.15s ease',
          }}
        >
          {/* New File */}
          <button
            type="button"
            onClick={() => void handleNewFileClick()}
            style={headerActionStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(168, 85, 247, 0.15)';
              e.currentTarget.style.color = C.codePurple;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = C.textSecondary;
            }}
            title="New File"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5L9 1.5z" />
              <path d="M9 1.5V5.5H13" />
              <circle cx="12" cy="12" r="3" fill={C.bgSidebar} stroke="currentColor" strokeWidth="1.1" />
              <path d="M12 10.6v2.8M10.6 12h2.8" stroke={C.codePurple} strokeWidth="1.5" />
            </svg>
          </button>

          {/* New Folder */}
          <button
            type="button"
            onClick={() => void handleNewFolderClick()}
            style={headerActionStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(168, 85, 247, 0.15)';
              e.currentTarget.style.color = C.codePurple;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = C.textSecondary;
            }}
            title="New Folder"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1.5 3.5a1 1 0 0 1 1-1h3.2l1.4 1.5h6.4a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9z" />
              <circle cx="12" cy="12" r="3" fill={C.bgSidebar} stroke="currentColor" strokeWidth="1.1" />
              <path d="M12 10.6v2.8M10.6 12h2.8" stroke={C.codePurple} strokeWidth="1.5" />
            </svg>
          </button>

          {/* Open Folder */}
          <button
            type="button"
            onClick={handleOpenFolder}
            style={headerActionStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(168, 85, 247, 0.15)';
              e.currentTarget.style.color = C.codePurple;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = C.textSecondary;
            }}
            title="Open Folder"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1.5 3.5a1 1 0 0 1 1-1h3.2l1.4 1.5h6.4a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9z" />
              <path d="M6 8l2 2 2-2" stroke={C.codePurple} strokeWidth="1.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* File Tree */}
      <div ref={treeScrollRef}
        className={`flex-1 overflow-y-auto pt-1 pb-3 explorer-scroll${isTreeScrolling ? ' is-scrolling' : ''}`}
        onScroll={handleTreeScroll}
        onClick={(e) => {
          // Only clear when the click target is the container itself,
          // not a descendant (row button, input, chevron, etc.).
          if (e.target === e.currentTarget) {
            setSelectedFolder(null);
            setVisuallySelectedPath(null);
            // lastInteractedPath intentionally left as-is so the row dims instead of clearing
          }
        }}
        style={{ background: C.bgSidebar, paddingLeft: 6, paddingBottom: 200, cursor: 'default' }}>
        {tree.length === 0 && !folderName && (
          <div className="px-3 py-4 text-xs text-center" style={{ color: C.textMuted }}>
            Open a folder to start
          </div>
        )}
        {rootFolderName && (
          <div
            onClick={() => setIsRootExpanded((p) => !p)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              height: 22,
              cursor: 'pointer',
              color: C.textPrimary,
              fontFamily: 'Segoe UI, sans-serif',
              fontSize: 13,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.02em',
              userSelect: 'none',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(168, 85, 247, 0.08)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <i
              className={`codicon ${isRootExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`}
              style={{ fontSize: 14, color: C.textSecondary, lineHeight: 1 }}
            />
            <span>{rootFolderName}</span>
          </div>
        )}
        {isRootExpanded && tree.map((node, idx) => (
          <TreeNodeRow key={node.entry.path} node={node} depth={0}
            activeFilePath={activeFilePath} onFileClick={handleFileClick}
            onToggle={handleToggle} nodePath={[node.entry.path]} gitStatusMap={gitStatusMap}
            onContextMenu={(e, entry) => {
              e.preventDefault(); e.stopPropagation();
              handleVisualSelect(entry.path);
              setSelectedFolder(entry.isDirectory ? entry.path : findParentDir(entry.path));
              setContextMenu({ x: e.clientX, y: e.clientY, entry });
            }}
            renamingPath={renamingPath} renameValue={renameValue}
            onRenameChange={setRenameValue} onRenameSubmit={handleRenameSubmit}
            onRenameCancel={() => setRenamingPath(null)}
            selectedFolderPath={selectedFolder} onSelectFolder={setSelectedFolder}
            visuallySelectedPath={visuallySelectedPath} onVisualSelect={handleVisualSelect}
            lastInteractedPath={lastInteractedPath}
            creationTarget={creationTarget} isCreatingFile={isCreatingFile}
            isCreatingFolder={isCreatingFolder} newFileName={newFileName}
            newFolderName={newFolderName} onNewFileNameChange={setNewFileName}
            onNewFolderNameChange={setNewFolderName}
            onCreateFileSubmit={() => void handleCreateFile(creationTarget)}
            onCreateFolderSubmit={() => void handleCreateFolder(creationTarget)}
            onCreateFileCancel={() => { setIsCreatingFile(false); setNewFileName(''); }}
            onCreateFolderCancel={() => { setIsCreatingFolder(false); setNewFolderName(''); }}
            fileInputRef={fileInputRef} folderInputRef={folderInputRef}
            animationDelay={isTreeEntering ? idx * 20 : 0}
          />
        ))}
        {isRootExpanded && folderName && creationTarget === folderName && isCreatingFile && (
          <CreateInputRow depth={0} icon="file" value={newFileName} onChange={setNewFileName}
            onSubmit={() => void handleCreateFile(creationTarget)}
            onCancel={() => { setIsCreatingFile(false); setNewFileName(''); }}
            placeholder={`file in ${creationTargetName || 'root'}`} inputRef={fileInputRef} />
        )}
        {isRootExpanded && folderName && creationTarget === folderName && isCreatingFolder && (
          <CreateInputRow depth={0} icon="folder" value={newFolderName} onChange={setNewFolderName}
            onSubmit={() => void handleCreateFolder(creationTarget)}
            onCancel={() => { setIsCreatingFolder(false); setNewFolderName(''); }}
            placeholder={`folder in ${creationTargetName || 'root'}`} inputRef={folderInputRef} />
        )}
      </div>

      {/* Bottom pill */}
      <div className="p-2 shrink-0"
        style={{ borderTop: `1px solid ${C.border}`, background: C.bgSidebar }}>
        <span className="text-[10px] px-1.5 py-0.5 rounded"
          style={{ background: C.bgCard, color: C.textMuted, fontFamily: 'Segoe UI, sans-serif' }}>
          {activeFilename ? getLanguageTag(activeFilename) : 'No file open'}
        </span>
      </div>

      {/* Context Menu */}
      {contextMenu && createPortal(
        <Rnd
          size={{ width: contextMenuSize.width, height: contextMenuSize.height }}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          minWidth={160}
          minHeight={120}
          bounds="window"
          dragHandleClassName="sidebar-ctx-menu-handle"
          onDragStop={(_e, data) => {
            setContextMenu((prev) => (prev ? { ...prev, x: data.x, y: data.y } : prev));
          }}
          onResizeStop={(_e, _dir, ref, _delta, position) => {
            setContextMenuSize({ width: ref.offsetWidth, height: ref.offsetHeight });
            setContextMenu((prev) => (prev ? { ...prev, x: position.x, y: position.y } : prev));
          }}
          style={{
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            background: C.bgCard, border: `1px solid ${C.border}`,
            borderRadius: 6,
            boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
            overflow: 'hidden',
          }}
        >
          <div className="sidebar-ctx-menu-handle flex items-center justify-between shrink-0 px-2"
            style={{ height: 22, cursor: 'move', background: C.bgExplorer, borderBottom: `1px solid ${C.border}` }}>
            <span style={{ color: C.textMuted, fontSize: 10, fontFamily: 'Segoe UI, sans-serif' }}>⠿</span>
            <button type="button" onClick={() => setContextMenu(null)}
              className="flex items-center justify-center text-xs leading-none"
              style={{ color: C.textSecondary, width: 16, height: 16 }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#f87171'}
              onMouseLeave={(e) => e.currentTarget.style.color = C.textSecondary}>
              ✕
            </button>
          </div>
          <div className="flex-1 flex flex-col py-1 overflow-auto">
          {!contextMenu.entry.isDirectory && (
            <button type="button"
              onClick={() => { void handleFileClick(contextMenu.entry); setContextMenu(null); }}
              className="text-left text-xs px-3 py-1"
              style={{ color: C.textSecondary, fontFamily: 'Segoe UI, sans-serif' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.12)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              Open
            </button>
          )}
          <button type="button"
            onClick={() => {
              setSelectedFolder(contextMenuTargetDir);
              void handleNewFileClick(contextMenuTargetDir ?? undefined);
              setContextMenu(null);
            }}
            className="text-left text-xs px-3 py-1"
            style={{ color: C.textSecondary, fontFamily: 'Segoe UI, sans-serif' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.12)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            New File
          </button>
          <button type="button"
            onClick={() => {
              setSelectedFolder(contextMenuTargetDir);
              void handleNewFolderClick(contextMenuTargetDir ?? undefined);
              setContextMenu(null);
            }}
            className="text-left text-xs px-3 py-1"
            style={{ color: C.textSecondary, fontFamily: 'Segoe UI, sans-serif' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.12)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            New Folder
          </button>
          {contextMenu.entry.isDirectory && (
            <button type="button"
              onClick={() => { setSelectedFolder(contextMenu.entry.path); setContextMenu(null); }}
              className="text-left text-xs px-3 py-1"
              style={{ color: C.accentAI, fontFamily: 'Segoe UI, sans-serif' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.12)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              Select Folder
            </button>
          )}
          <button type="button"
            onClick={() => {
              setRenamingPath(contextMenu.entry.path);
              setRenameValue(contextMenu.entry.name);
              setContextMenu(null);
            }}
            className="text-left text-xs px-3 py-1"
            style={{ color: C.textSecondary, fontFamily: 'Segoe UI, sans-serif' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.12)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            Rename
          </button>
          <button type="button" onClick={() => void handleDelete(contextMenu.entry)}
            className="text-left text-xs px-3 py-1"
            style={{ color: '#f87171', fontFamily: 'Segoe UI, sans-serif' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(248, 113, 113, 0.12)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            Delete
          </button>
          </div>
        </Rnd>,
        document.body,
      )}
    </div>
  );
}