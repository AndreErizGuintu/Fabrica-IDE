// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

export type Channels = 'ipc-example' | 'ai:token' | 'git:progress' | 'flutter:create-progress' | 'terminal:output' | 'terminal:exit' | 'terminal:run-complete' | 'adaptive:suggest';

const electronHandler = {
  ipcRenderer: {
    sendMessage(channel: Channels, ...args: unknown[]) {
      ipcRenderer.send(channel, ...args);
    },
    on(channel: Channels, func: (...args: unknown[]) => void) {
      const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
        func(...args);
      ipcRenderer.on(channel, subscription);

      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once(channel: Channels, func: (...args: unknown[]) => void) {
      ipcRenderer.once(channel, (_event, ...args) => func(...args));
    },
  },
};

contextBridge.exposeInMainWorld('electron', electronHandler);

contextBridge.exposeInMainWorld('fileSystem', {
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),
  readDir: (dirPath: string) => ipcRenderer.invoke('fs:readDir', dirPath),
  createFile: (filePath: string) => ipcRenderer.invoke('fs:createFile', filePath),
  createFolder: (folderPath: string) => ipcRenderer.invoke('fs:createFolder', folderPath),
  rename: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
  deleteEntry: (targetPath: string) => ipcRenderer.invoke('fs:delete', targetPath),
  openTerminal: (cwd?: string) => ipcRenderer.invoke('shell:openTerminal', cwd),
});

contextBridge.exposeInMainWorld('store', {
  getRecentProjects: () => ipcRenderer.invoke('store:getRecentProjects'),
  addRecentProject: (project: { name: string; path: string }) =>
    ipcRenderer.invoke('store:addRecentProject', project),
});

contextBridge.exposeInMainWorld('ai', {
  complete: (prompt: string) => ipcRenderer.invoke('ai:complete', prompt),
  translate: (payload: { prompt: string; selectedCode: string; language: string }) =>
    ipcRenderer.invoke('ai:translate', payload),
  explain: (payload: { prompt: string; selectedCode: string }) =>
    ipcRenderer.invoke('ai:explain', payload),
  llamaTestPing: () => ipcRenderer.invoke('llama-test-ping'),
});

contextBridge.exposeInMainWorld('runner', {
  checkSDK: (runtime: string) => ipcRenderer.invoke('run:checkSDK', runtime),
});

contextBridge.exposeInMainWorld('stats', {
  startSession: (projectPath: string) => ipcRenderer.invoke('stats:startSession', projectPath),
  activity: () => ipcRenderer.send('stats:activity'),
  getCurrentSession: () => ipcRenderer.invoke('stats:getCurrentSession'),
  getAggregate: () => ipcRenderer.invoke('stats:getAggregate'),
  getSessionHistory: (projectPath: string) =>
    ipcRenderer.invoke('stats:getSessionHistory', projectPath),
});

// Mirrors Suggestion in adaptiveEngine.ts. Kept as a local type rather than an
// import so preload stays free of main-process module graph.
type AdaptiveSuggestionPayload = {
  scenario: 1 | 2 | 3 | 4 | 5;
  message: string;
  offersHint: boolean;
  autoDismissSeconds: number;
  errorCategory?: string;
  offersCorrection?: boolean;
};

contextBridge.exposeInMainWorld('adaptive', {
  dismiss: () => ipcRenderer.send('adaptive:dismiss'),
  requestHint: (payload: { code: string; language: string }) =>
    ipcRenderer.invoke('adaptive:hint', payload),
  requestCorrection: (payload: { code: string; language: string }) =>
    ipcRenderer.invoke('adaptive:correction', payload),
  getDebugState: () => ipcRenderer.invoke('adaptive:getDebugState'),
  onSuggest: (cb: (suggestion: AdaptiveSuggestionPayload) => void) => {
    const handler = (_event: IpcRendererEvent, suggestion: AdaptiveSuggestionPayload) =>
      cb(suggestion);
    ipcRenderer.on('adaptive:suggest', handler);
    return () => ipcRenderer.removeListener('adaptive:suggest', handler);
  },
});

contextBridge.exposeInMainWorld('codeInference', {
  // Cheap eligibility check, no model behind it.
  checkTrigger: (payload: { prefix: string; suffix: string; language: string }) =>
    ipcRenderer.invoke('codeInference:checkTrigger', payload),
  // The real generation. Only ever called from an explicit accept.
  request: (payload: { prefix: string; suffix: string; language: string }) =>
    ipcRenderer.invoke('codeInference:request', payload),
  getConfig: () => ipcRenderer.invoke('codeInference:getConfig'),
});

contextBridge.exposeInMainWorld('terminal', {
  run: (payload: { language: string; path: string; deviceId?: string }) => ipcRenderer.invoke('terminal:run', payload),
  create: (payload?: { cwd?: string }) => ipcRenderer.invoke('terminal:create', payload ?? {}),
  hotReload: () => ipcRenderer.invoke('terminal:hotReload'),
  input: (sessionId: string, data: string) => ipcRenderer.send('terminal:input', { sessionId, data }),
  stop: (sessionId: string) => ipcRenderer.invoke('terminal:stop', { sessionId }),
  onOutput: (cb: (sessionId: string, data: string) => void) => {
    const handler = (_event: IpcRendererEvent, payload: { sessionId: string; data: string }) =>
      cb(payload.sessionId, payload.data);
    ipcRenderer.on('terminal:output', handler);
    return () => ipcRenderer.removeListener('terminal:output', handler);
  },
  onExit: (cb: (sessionId: string, exitCode: number) => void) => {
    const handler = (_event: IpcRendererEvent, payload: { sessionId: string; exitCode: number }) =>
      cb(payload.sessionId, payload.exitCode);
    ipcRenderer.on('terminal:exit', handler);
    return () => ipcRenderer.removeListener('terminal:exit', handler);
  },
  // Fires once per captured run, when the exit sentinel is seen. Same
  // unsubscribe-returning shape as onOutput/onExit. No current consumer — this
  // is the surface future error classification reads from.
  onRunComplete: (
    cb: (payload: { sessionId: string; exitCode: number; output: string; truncated: boolean }) => void,
  ) => {
    const handler = (
      _event: IpcRendererEvent,
      payload: { sessionId: string; exitCode: number; output: string; truncated: boolean },
    ) => cb(payload);
    ipcRenderer.on('terminal:run-complete', handler);
    return () => ipcRenderer.removeListener('terminal:run-complete', handler);
  },
});

contextBridge.exposeInMainWorld('flutter', {
  listDevices: () => ipcRenderer.invoke('flutter:listDevices'),
  createProject: (projectPath: string, projectName: string) =>
    ipcRenderer.invoke('flutter:createProject', projectPath, projectName),
  // Same unsubscribe-returning shape as git.onProgress — `flutter create` is
  // long-running, so the New Project dialog tails this for live output.
  onCreateProgress: (cb: (data: string) => void) => {
    const handler = (_event: IpcRendererEvent, data: string) => cb(data);
    ipcRenderer.on('flutter:create-progress', handler);
    return () => ipcRenderer.removeListener('flutter:create-progress', handler);
  },
});

contextBridge.exposeInMainWorld('mirror', {
  start: () => ipcRenderer.invoke('mirror:start'),
  stop: () => ipcRenderer.invoke('mirror:stop'),
});

contextBridge.exposeInMainWorld('androidSdk', {
  check: () => ipcRenderer.invoke('android:check'),
  fetch: () => ipcRenderer.invoke('android:fetch'),
  cancel: () => ipcRenderer.invoke('android:cancel'),
  // Lets a renderer that mounted mid-install (a reload, a panel opened late)
  // paint the current state immediately instead of waiting for the next event.
  getProgress: () => ipcRenderer.invoke('android:getProgress'),
  // The student's explicit answer to the license currently on screen. Nothing
  // in main writes an acceptance without this call having been made first.
  respondToLicense: (accepted: boolean) =>
    ipcRenderer.invoke('android:licenseRespond', accepted),
  // Same unsubscribe-returning shape as git.onProgress and terminal.onOutput.
  onProgress: (cb: (progress: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, progress: unknown) => cb(progress);
    ipcRenderer.on('android:sdk-progress', handler);
    return () => ipcRenderer.removeListener('android:sdk-progress', handler);
  },
});

contextBridge.exposeInMainWorld('git', {
  init: (cwd: string) => ipcRenderer.invoke('git:init', cwd),
  status: (cwd: string) => ipcRenderer.invoke('git:status', cwd),
  add: (cwd: string) => ipcRenderer.invoke('git:add', cwd),
  commit: (cwd: string, message: string) => ipcRenderer.invoke('git:commit', cwd, message),
  push: (cwd: string) => ipcRenderer.invoke('git:push', cwd),
  pull: (cwd: string) => ipcRenderer.invoke('git:pull', cwd),
  log: (cwd: string) => ipcRenderer.invoke('git:log', cwd),
  statusFiles: (cwd: string) => ipcRenderer.invoke('git:statusFiles', cwd),
  clone: (url: string, targetDir: string) => ipcRenderer.invoke('git:clone', url, targetDir),
  remoteAdd: (cwd: string, url: string) => ipcRenderer.invoke('git:remote-add', cwd, url),
  addFile: (cwd: string, filePath: string) => ipcRenderer.invoke('git:addFile', cwd, filePath),
  unstageFile: (cwd: string, filePath: string) =>
    ipcRenderer.invoke('git:unstageFile', cwd, filePath),
  remotes: (cwd: string) => ipcRenderer.invoke('git:remotes', cwd),
  currentBranch: (cwd: string) => ipcRenderer.invoke('git:currentBranch', cwd),
  pushSetUpstream: (cwd: string, branch: string) =>
    ipcRenderer.invoke('git:pushSetUpstream', cwd, branch),
  onProgress: (cb: (data: string) => void) => {
    const handler = (_event: IpcRendererEvent, data: string) => cb(data);
    ipcRenderer.on('git:progress', handler);
    return () => ipcRenderer.removeListener('git:progress', handler);
  },
});


export type ElectronHandler = typeof electronHandler;
