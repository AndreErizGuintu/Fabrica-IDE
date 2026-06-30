/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import fs from 'fs';
import { exec, spawn } from 'child_process';
import path from 'path';
import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import MenuBuilder from './menu';
import { resolveHtmlPath } from './util';

type RecentProject = { name: string; path: string };

const getRecentProjectsPath = () =>
  path.join(app.getPath('userData'), 'recent-projects.json');

const readRecentProjects = (): RecentProject[] => {
  try {
    const filePath = getRecentProjectsPath();
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (project): project is RecentProject =>
        project && typeof project.name === 'string' && typeof project.path === 'string',
    );
  } catch {
    return [];
  }
};

const writeRecentProjects = (projects: RecentProject[]) => {
  fs.writeFileSync(getRecentProjectsPath(), JSON.stringify(projects, null, 2), 'utf-8');
};

function getRunConfig(filePath: string):
  | { cmd: string; args: string[] }
  | { html: true }
  | { error: string } {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'html': return { html: true };
    case 'php': return { cmd: 'php', args: ['-f', filePath] };
    case 'js': return { cmd: 'node', args: [filePath] };
    case 'ts': return { error: 'TypeScript files cannot be run directly — rename to .js or compile first' };
    case 'cs': return { error: '.NET SDK required — install from https://dot.net' };
    case 'dart': return { error: 'Dart SDK required — install from https://dart.dev' };
    default: return { error: `No runner configured for .${ext ?? 'unknown'} files` };
  }
}

class AppUpdater {
  constructor() {
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
    autoUpdater.checkForUpdatesAndNotify();
  }
}

let mainWindow: BrowserWindow | null = null;

ipcMain.on('ipc-example', async (event, arg) => {
  const msgTemplate = (pingPong: string) => `IPC test: ${pingPong}`;
  console.log(msgTemplate(arg));
  event.reply('ipc-example', msgTemplate('pong'));
});

// Open folder dialog
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });

  return result.canceled ? null : result.filePaths[0];
});

// Open file dialog
ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Supported Files', extensions: ['html', 'css', 'php', 'java', 'cs', 'dart'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  return result.canceled ? null : result.filePaths[0];
});

// Read file contents
ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  try {
    return { success: true, content: fs.readFileSync(filePath, 'utf-8') };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// Write file contents
ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// Read directory contents
ipcMain.handle('fs:readDir', async (_event, dirPath: string) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return {
      success: true,
      files: entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        path: path.join(dirPath, entry.name),
      })),
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('fs:createFile', async (_event, filePath: string) => {
  try {
    if (fs.existsSync(filePath)) {
      return { success: false, error: 'File already exists' };
    }
    fs.writeFileSync(filePath, '', 'utf-8');
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('fs:createFolder', async (_event, folderPath: string) => {
  try {
    if (fs.existsSync(folderPath)) {
      return { success: false, error: 'Folder already exists' };
    }
    fs.mkdirSync(folderPath, { recursive: true });
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('store:getRecentProjects', async () => {
  const projects = readRecentProjects();
  return { success: true, projects };
});

ipcMain.handle('store:addRecentProject', async (_event, project: RecentProject) => {
  try {
    const projects = [
      project,
      ...readRecentProjects().filter((entry) => entry.path !== project.path),
    ].slice(0, 5);
    writeRecentProjects(projects);
    return { success: true, projects };
  } catch (err) {
    return { success: false, error: String(err), projects: readRecentProjects() };
  }
});

function runGit(args: string[], cwd: string): Promise<{ success: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    exec(`git ${args.join(' ')}`, { cwd }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, output: stderr || stdout, error: error.message });
      } else {
        resolve({ success: true, output: stdout || stderr });
      }
    });
  });
}

ipcMain.handle('git:init', async (_event, cwd: string) => {
  return runGit(['init'], cwd);
});

ipcMain.handle('git:status', async (_event, cwd: string) => {
  return runGit(['status'], cwd);
});

ipcMain.handle('git:add', async (_event, cwd: string) => {
  return runGit(['add', '.'], cwd);
});

ipcMain.handle('git:commit', async (_event, cwd: string, message: string) => {
  return runGit(['commit', '-m', `"${message}"`], cwd);
});

ipcMain.handle('git:clone', async (event, url: string, targetDir: string) => {
  return new Promise<{ success: boolean; output: string; error?: string }>((resolve) => {
    const child = spawn('git', ['clone', url, targetDir], {
      env: { ...process.env },
    });

    let output = '';

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      event.sender.send('git:progress', text);
    });

    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      event.sender.send('git:progress', text);
    });

    child.on('close', (code: number | null) => {
      resolve({ success: code === 0, output });
    });

    child.on('error', (err: Error) => {
      resolve({ success: false, output: '', error: err.message });
    });
  });
});

// SDK detection
ipcMain.handle('run:checkSDK', async (_event, runtime: string) => {
  return new Promise<{ available: boolean; version?: string; error?: string }>((resolve) => {
    const cmds: Record<string, string> = {
      node: 'node --version',
      php: 'php --version',
      dotnet: 'dotnet --version',
      dart: 'dart --version',
    };
    const cmd = cmds[runtime];
    if (!cmd) {
      resolve({ available: false, error: `Unknown runtime: ${runtime}` });
      return;
    }
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        resolve({ available: false, error: error.message });
      } else {
        resolve({ available: true, version: (stdout || stderr).trim().split('\n')[0] });
      }
    });
  });
});

// Run file
ipcMain.handle('run:file', async (event, filePath: string) => {
  const ext = filePath.split('.').pop()?.toLowerCase();

  let cmd: string;
  let args: string[];

  switch (ext) {
    case 'js':
    case 'ts':
      cmd = 'node';
      args = [filePath];
      break;
    case 'php':
      cmd = 'php';
      args = ['-f', filePath];
      break;
    case 'cs':
      cmd = 'dotnet';
      args = ['script', filePath];
      break;
    case 'dart':
      cmd = 'dart';
      args = ['run', filePath];
      break;
    default:
      return { success: false, error: `Unsupported file type: .${ext}` };
  }

  return new Promise<{ success: boolean; error?: string }>((resolve) => {
    const child = spawn(cmd, args, {
      cwd: path.dirname(filePath),
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        NODE_OPTIONS: '',
      },
    });

    child.stdout.on('data', (data: Buffer) => {
      event.sender.send('run:stdout', data.toString());
    });

    child.stderr.on('data', (data: Buffer) => {
      event.sender.send('run:stderr', data.toString());
    });

    child.on('close', (code: number | null) => {
      event.sender.send('run:done', code ?? -1);
      resolve({ success: true });
    });

    child.on('error', (err: Error) => {
      event.sender.send('run:stderr', `Error: ${err.message}\n`);
      event.sender.send('run:done', -1);
      resolve({ success: false, error: err.message });
    });
  });
});

ipcMain.handle('shell:openTerminal', async (_event, cwd?: string) => {
  try {
    const workingDirectory = cwd || process.cwd();

    if (process.platform === 'win32') {
      exec('start powershell', { cwd: workingDirectory });
    } else if (process.platform === 'darwin') {
      exec('open -a Terminal', { cwd: workingDirectory });
    } else {
      exec('x-terminal-emulator', { cwd: workingDirectory });
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('code:run', async (event, filePath: string) => {
  const config = getRunConfig(filePath);

  if ('html' in config) {
    return { success: true, html: true };
  }

  if ('error' in config) {
    event.sender.send('run:output', { type: 'stderr', text: config.error + '\n' });
    event.sender.send('run:done', { exitCode: 1 });
    return { success: false, error: config.error };
  }

  return new Promise<{ success: boolean; exitCode?: number; error?: string }>((resolve) => {
    const child = spawn(config.cmd, config.args, {
      cwd: path.dirname(filePath),
      shell: true,
      env: { ...process.env, NODE_OPTIONS: '', FORCE_COLOR: '0', NO_COLOR: '1' },
    });

    child.stdout.on('data', (data: Buffer) => {
      event.sender.send('run:output', { type: 'stdout', text: data.toString() });
    });

    child.stderr.on('data', (data: Buffer) => {
      event.sender.send('run:output', { type: 'stderr', text: data.toString() });
    });

    child.on('close', (code: number | null) => {
      const exitCode = code ?? 1;
      event.sender.send('run:done', { exitCode });
      resolve({ success: exitCode === 0, exitCode });
    });

    child.on('error', (err: Error) => {
      const msg = err.message.includes('ENOENT')
        ? `Command not found: '${config.cmd}' — is it installed and on PATH?\n`
        : `${err.message}\n`;
      event.sender.send('run:output', { type: 'stderr', text: msg });
      event.sender.send('run:done', { exitCode: 1 });
      resolve({ success: false, error: err.message });
    });
  });
});

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  require('electron-debug').default();
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS'];

  return installer
    .default(
      extensions.map((name) => installer[name]),
      forceDownload,
    )
    .catch(console.log);
};

const createWindow = async () => {
  if (isDebug) {
    await installExtensions();
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  mainWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
    icon: getAssetPath('icon.png'),
    webPreferences: {
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
    },
  });

  mainWindow.loadURL(resolveHtmlPath('index.html'));

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });

  // Remove this if your app does not use auto updates
  // eslint-disable-next-line
  new AppUpdater();
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app
  .whenReady()
  .then(() => {
    createWindow();
    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) createWindow();
    });
  })
  .catch(console.log);

ipcMain.handle('ai:complete', async (event, prompt: string) => {
  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-coder:6.7b',
        prompt: prompt,
        stream: true,
      }),
    });

    let fullText = '';
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.response && typeof parsed.response === 'string') {
            fullText += parsed.response;
            event.sender.send('ai:token', parsed.response);
          }
          if (parsed.done === true) break;
        } catch {}
      }
    }

    return { success: true, result: fullText };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});