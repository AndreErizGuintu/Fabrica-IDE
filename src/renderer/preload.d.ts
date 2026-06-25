import { ElectronHandler } from '../main/preload';

type FileSystemBridge = {
  openFolder: () => Promise<string | null>;
  openFile: () => Promise<string | null>;
  readFile: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
  readDir: (dirPath: string) => Promise<{ success: boolean; files?: Array<{ name: string; isDirectory: boolean; path: string }>; error?: string }>;
  createFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  createFolder: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
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
    runner: {
      run: (filePath: string) => Promise<{ success: boolean; html?: boolean; exitCode?: number; error?: string }>;
      onOutput: (cb: (data: { type: 'stdout' | 'stderr'; text: string }) => void) => void;
      onDone: (cb: (data: { exitCode: number }) => void) => void;
      removeListeners: () => void;
    };
  }
}

export {};
