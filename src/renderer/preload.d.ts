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

type FlutterTarget = { id: string; name: string; platform: string };

type AdaptiveDebugState = {
  now: number;
  scenario1: {
    lastIdleExpiredAt: number | null;
    windowOpen: boolean;
    windowRemainingSeconds: number | null;
    conditionTrue: boolean;
  };
  scenario2: {
    callCountInWindow: number;
    runCountInWindow: number;
    threshold: number;
    windowRemainingSeconds: number | null;
    conditionTrue: boolean;
  };
  scenario3: {
    consecutiveIdleResets: number;
    threshold: number;
    conditionTrue: boolean;
  };
  scenario4: {
    sessionCallCount: number;
    sessionRunCount: number;
    ratio: number | null;
    threshold: number;
    minimumRunsBeforeEvaluating: number;
    minimumRunsMet: boolean;
    conditionTrue: boolean;
  };
  lastSuggestionFired: { scenario: 1 | 2 | 3 | 4; firedAt: number } | null;
  cooldown: {
    active: boolean;
    remainingSeconds: number | null;
  };
  suggestionActive: { scenario: 1 | 2 | 3 | 4; message: string; offersHint: boolean; autoDismissSeconds: number } | null;
  priorityWinner: 1 | 2 | 3 | 4 | null;
};

type FlutterBridge = {
  listDevices: () => Promise<{ success: boolean; devices?: FlutterTarget[]; error?: string }>;
  onUsbConnected: (cb: (deviceIds: string[]) => void) => () => void;
};

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    electron: ElectronHandler;
    fileSystem: FileSystemBridge;
    store: StoreBridge;
    ai: {
      complete: (prompt: string) => Promise<{ success: boolean; result?: string; error?: string }>;
      translate: (payload: { prompt: string; selectedCode: string; language: string }) => Promise<{ success: boolean; result?: string; error?: string }>;
      explain: (payload: { prompt: string; selectedCode: string }) => Promise<{ success: boolean; result?: string; error?: string }>;
      llamaTestPing: () => Promise<{ success: boolean; result?: string; error?: string }>;
    };
    runner: {
      checkSDK: (runtime: string) => Promise<{ available: boolean; version?: string; error?: string }>;
    };
    stats: {
      startSession: (projectPath: string) => Promise<{ success: boolean }>;
      activity: () => void;
      getCurrentSession: () => Promise<{
        projectPath: string;
        sessionStart: string;
        idleTimeMs: number;
        aiCallCount: number;
        runCount: number;
      } | null>;
      getAggregate: () => Promise<{
        totalIdleTimeMs: number;
        totalAiCallCount: number;
        totalRunCount: number;
        totalSessionCount: number;
        lastUpdated: string;
      }>;
      getSessionHistory: (projectPath: string) => Promise<Array<{
        fileName: string;
        projectPath: string;
        sessionStart: string;
        sessionEnd: string;
        idleTimeMs: number;
        aiCallCount: number;
        runCount: number;
      }>>;
    };
    adaptive: {
      dismiss: () => void;
      requestHint: (payload: { code: string; language: string }) => Promise<{ success: boolean; hint?: string; error?: string }>;
      onSuggest: (cb: (suggestion: { scenario: 1 | 2 | 3 | 4; message: string; offersHint: boolean; autoDismissSeconds: number }) => void) => () => void;
      getDebugState: () => Promise<AdaptiveDebugState>;
    };
    codeInference: {
      checkTrigger: (payload: { prefix: string; suffix: string; language: string }) => Promise<{ triggered: boolean }>;
      request: (payload: { prefix: string; suffix: string; language: string }) => Promise<{ success: boolean; suggestion: string | null; error?: string }>;
      getConfig: () => Promise<{ debounceMs: number; maxTriggerChars: number; maxTriggerLines: number }>;
    };
    terminal: {
      run: (payload: { language: string; path: string; deviceId?: string }) => Promise<{ success: boolean; sessionId?: string; html?: boolean; error?: string }>;
      input: (sessionId: string, data: string) => void;
      stop: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
      onOutput: (cb: (sessionId: string, data: string) => void) => () => void;
      onExit: (cb: (sessionId: string, exitCode: number) => void) => () => void;
    };
    flutter: FlutterBridge;
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
