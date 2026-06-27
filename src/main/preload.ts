// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

export type Channels = 'ipc-example' | 'ai:token' | 'run:stdout' | 'run:stderr' | 'run:done';

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
  openTerminal: (cwd?: string) => ipcRenderer.invoke('shell:openTerminal', cwd),
});

contextBridge.exposeInMainWorld('store', {
  getRecentProjects: () => ipcRenderer.invoke('store:getRecentProjects'),
  addRecentProject: (project: { name: string; path: string }) =>
    ipcRenderer.invoke('store:addRecentProject', project),
});

contextBridge.exposeInMainWorld('ai', {
  complete: (prompt: string) => ipcRenderer.invoke('ai:complete', prompt),
});

contextBridge.exposeInMainWorld('runner', {
  runFile: (filePath: string) => ipcRenderer.invoke('run:file', filePath),
  checkSDK: (runtime: string) => ipcRenderer.invoke('run:checkSDK', runtime),
  onStdout: (cb: (data: string) => void) => {
    const handler = (_event: IpcRendererEvent, data: string) => cb(data);
    ipcRenderer.on('run:stdout', handler);
    return () => ipcRenderer.removeListener('run:stdout', handler);
  },
  onStderr: (cb: (data: string) => void) => {
    const handler = (_event: IpcRendererEvent, data: string) => cb(data);
    ipcRenderer.on('run:stderr', handler);
    return () => ipcRenderer.removeListener('run:stderr', handler);
  },
  onDone: (cb: (code: number) => void) => {
    const handler = (_event: IpcRendererEvent, code: number) => cb(code);
    ipcRenderer.once('run:done', handler);
    return () => ipcRenderer.removeListener('run:done', handler);
  },
});


export type ElectronHandler = typeof electronHandler;
