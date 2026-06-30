import { ElectronHandler } from '../main/preload';

type FileSystemBridge = {
  openFolder: () => Promise<string | null>;
  openFile: () => Promise<string | null>;
  readFile: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
  readDir: (dirPath: string) => Promise<{ success: boolean; files?: Array<{ name: string; isDirectory: boolean; path: string }>; error?: string }>;
  createFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  createFolder: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
  rename: (oldPath: string, newPath: string) => Promise<{ success: boolean; error?: string }>;
  deleteEntry: (targetPath: string) => Promise<{ success: boolean; error?: string }>;
  openTerminal: (cwd?: string) => Promise<{ success: boolean; error?: string }>;
};

type StoreBridge = {
  getRecentProjects: () => Promise<{ success: boolean; projects: Array<{ name: string; path: string }>; error?: string }>;
  addRecentProject: (project: { name: string; path: string }) => Promise<{ success: boolean; projects: Array<{ name: string; path: string }>; error?: string }>;
};

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    electron: ElectronHandler;
    fileSystem: FileSystemBridge;
    store: StoreBridge;
    ai: {
      complete: (prompt: string) => Promise<{ success: boolean; result?: string; error?: string }>;
    };
    runner: {
      runFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
      checkSDK: (runtime: string) => Promise<{ available: boolean; version?: string; error?: string }>;
      onStdout: (cb: (data: string) => void) => () => void;
      onStderr: (cb: (data: string) => void) => () => void;
      onDone: (cb: (code: number) => void) => () => void;
    };
    git: {
      init: (cwd: string) => Promise<{ success: boolean; output: string; error?: string }>;
      status: (cwd: string) => Promise<{ success: boolean; output: string; error?: string }>;
      add: (cwd: string) => Promise<{ success: boolean; output: string; error?: string }>;
      commit: (cwd: string, message: string) => Promise<{ success: boolean; output: string; error?: string }>;
      push: (cwd: string) => Promise<{ success: boolean; output: string; error?: string }>;
      pull: (cwd: string) => Promise<{ success: boolean; output: string; error?: string }>;
      log: (cwd: string) => Promise<{ success: boolean; output: string; error?: string }>;
      statusFiles: (cwd: string) => Promise<{ success: boolean; output: string; error?: string }>;
      clone: (url: string, targetDir: string) => Promise<{ success: boolean; output: string; error?: string }>;
      onProgress: (cb: (data: string) => void) => () => void;
    };
  }
}

export {};
