// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

export type Channels = 'ipc-example' | 'ai:token' | 'git:progress' | 'terminal:output' | 'terminal:exit' | 'adaptive:suggest';

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

contextBridge.exposeInMainWorld('adaptive', {
  dismiss: () => ipcRenderer.send('adaptive:dismiss'),
  requestHint: (payload: { code: string; language: string }) =>
    ipcRenderer.invoke('adaptive:hint', payload),
  getDebugState: () => ipcRenderer.invoke('adaptive:getDebugState'),
  onSuggest: (cb: (suggestion: { scenario: 1 | 2 | 3 | 4; message: string; offersHint: boolean; autoDismissSeconds: number }) => void) => {
    const handler = (_event: IpcRendererEvent, suggestion: { scenario: 1 | 2 | 3 | 4; message: string; offersHint: boolean; autoDismissSeconds: number }) =>
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
});

contextBridge.exposeInMainWorld('flutter', {
  listDevices: () => ipcRenderer.invoke('flutter:listDevices'),
});

contextBridge.exposeInMainWorld('mirror', {
  start: () => ipcRenderer.invoke('mirror:start'),
  stop: () => ipcRenderer.invoke('mirror:stop'),
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
  onProgress: (cb: (data: string) => void) => {
    const handler = (_event: IpcRendererEvent, data: string) => cb(data);
    ipcRenderer.on('git:progress', handler);
    return () => ipcRenderer.removeListener('git:progress', handler);
  },
});


export type ElectronHandler = typeof electronHandler;
