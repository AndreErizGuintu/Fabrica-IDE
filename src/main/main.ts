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
import crypto from 'crypto';
import { exec, execFile, spawn } from 'child_process';
import path from 'path';
import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import * as pty from 'node-pty';
import MenuBuilder from './menu';
import { generate } from './llm';
import { ensureGpuDeviceIsolation } from './gpuIsolation';
import { resolveHtmlPath } from './util';
import {
  startSession,
  recordActivity,
  incrementAiCallCount,
  endSession,
  getCurrentSession,
  getAggregate,
  getSessionHistory,
} from './stats';

// package.json's root "name" is still "electron-react-boilerplate" (only
// build.productName is "ElectronReact", which Electron itself never reads),
// so without this app.getPath('userData') resolves under
// %APPDATA%/electron-react-boilerplate instead of %APPDATA%/Fabrica.
app.setName('Fabrica');

type RecentProject = { name: string; path: string };
type RuntimeName = 'node' | 'php' | 'dotnet' | 'dart';

const getRecentProjectsPath = () =>
  path.join(app.getPath('userData'), 'recent-projects.json');

const getBundledRuntimeRoot = () => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'runtimes');
  }

  return path.join(app.getAppPath(), 'resources', 'runtimes');
};

const getBundledRuntimeDir = (runtime: RuntimeName) =>
  path.join(getBundledRuntimeRoot(), runtime);

const getBundledRuntimeBinary = (runtime: RuntimeName) => {
  const binaryName = process.platform === 'win32' ? `${runtime}.exe` : runtime;
  const subDir = runtime === 'dart' ? 'bin' : '';
  const bundledPath = path.join(getBundledRuntimeDir(runtime), subDir, binaryName);

  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }

  console.warn(`Bundled ${runtime} runtime not found at ${bundledPath}; falling back to PATH lookup.`);
  return binaryName;
};

// Flutter is project-level (whole-folder `flutter run`), not file-level like the
// RuntimeName runtimes above, so it gets its own resolver instead of joining that union.
const getFlutterBinary = () => {
  const binaryName = process.platform === 'win32' ? 'flutter.bat' : 'flutter';
  const bundledPath = path.join(getBundledRuntimeRoot(), 'flutter', 'bin', binaryName);

  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }

  console.warn(`Bundled flutter runtime not found at ${bundledPath}; falling back to PATH lookup.`);
  return binaryName;
};

const getBundledRuntimePathEntries = () =>
  (['node', 'php', 'dotnet', 'dart'] as RuntimeName[]).map(getBundledRuntimeDir);

const prependBundledRuntimePaths = (env: NodeJS.ProcessEnv = process.env) => {
  const pathEntries = getBundledRuntimePathEntries();
  const existingPath = env.PATH ?? env.Path ?? '';
  const nextPath = [...pathEntries, existingPath].filter(Boolean).join(path.delimiter);

  return {
    ...env,
    PATH: nextPath,
    Path: nextPath,
  };
};

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

// Single source of truth for "how do I run this" across the app: the run:checkSDK
// version-check, the terminal:run spawn, and (formerly) the separate flutter:run
// handler all resolve through here instead of each keeping their own switch.
function getRunConfig(targetPath: string, language: string):
  | { cmd: string; args: string[]; cwd: string }
  | { html: true }
  | { error: string } {
  switch (language) {
    case 'html':
      return { html: true };
    case 'php':
      return { cmd: getBundledRuntimeBinary('php'), args: ['-f', targetPath], cwd: path.dirname(targetPath) };
    case 'js':
    case 'ts':
      return { cmd: getBundledRuntimeBinary('node'), args: [targetPath], cwd: path.dirname(targetPath) };
    case 'cs':
      return { cmd: getBundledRuntimeBinary('dotnet'), args: ['run', targetPath], cwd: path.dirname(targetPath) };
    case 'dart':
      return { cmd: getBundledRuntimeBinary('dart'), args: ['run', targetPath], cwd: path.dirname(targetPath) };
    case 'flutter':
      // Project-level (whole-folder `flutter run`), so targetPath is the folder itself, not a file.
      return { cmd: getFlutterBinary(), args: ['run', '-d', 'windows'], cwd: targetPath };
    default:
      return { error: `No runner configured for ${language}` };
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

ipcMain.handle('fs:rename', async (_event, oldPath: string, newPath: string) => {
  try {
    if (fs.existsSync(newPath)) {
      return { success: false, error: 'A file or folder with that name already exists' };
    }
    fs.renameSync(oldPath, newPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('fs:delete', async (_event, targetPath: string) => {
  try {
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(targetPath);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('stats:startSession', async (_event, projectPath: string) => {
  startSession(projectPath);
  return { success: true };
});

ipcMain.on('stats:activity', () => {
  recordActivity();
});

// Debug-only handlers backing the temporary StatsDebugPanel UI.
ipcMain.handle('stats:getCurrentSession', () => getCurrentSession());

ipcMain.handle('stats:getAggregate', () => getAggregate());

ipcMain.handle('stats:getSessionHistory', (_event, projectPath: string) =>
  getSessionHistory(projectPath),
);

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

ipcMain.handle('git:push', async (_event, cwd: string) => {
  return runGit(['push'], cwd);
});

ipcMain.handle('git:pull', async (_event, cwd: string) => {
  return runGit(['pull'], cwd);
});

ipcMain.handle('git:log', async (_event, cwd: string) => {
  return runGit(['log', '--oneline', '-10', '--no-color'], cwd);
});

ipcMain.handle('git:statusFiles', async (_event, cwd: string) => {
  return runGit(['status', '--porcelain'], cwd);
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

// SDK detection — reuses getRunConfig for the binary resolution only; the
// version-check args ('--version') are inherently different from run args,
// so that part is still owned locally, but the runtime->binary switch is not.
const LANGUAGE_BY_RUNTIME: Record<string, string> = {
  node: 'js',
  php: 'php',
  dotnet: 'cs',
  dart: 'dart',
};

ipcMain.handle('run:checkSDK', async (_event, runtime: string) => {
  return new Promise<{ available: boolean; version?: string; error?: string }>((resolve) => {
    const language = LANGUAGE_BY_RUNTIME[runtime];
    const config = language ? getRunConfig('', language) : undefined;
    if (!config || !('cmd' in config)) {
      resolve({ available: false, error: `Unknown runtime: ${runtime}` });
      return;
    }
    execFile(config.cmd, ['--version'], (error, stdout, stderr) => {
      if (error) {
        resolve({ available: false, error: error.message });
      } else {
        resolve({ available: true, version: (stdout || stderr).trim().split('\n')[0] });
      }
    });
  });
});

ipcMain.handle('shell:openTerminal', async (_event, cwd?: string) => {
  try {
    const workingDirectory = cwd || process.cwd();
    const terminalEnv = prependBundledRuntimePaths();

    if (process.platform === 'win32') {
      exec('start powershell', { cwd: workingDirectory, env: terminalEnv });
    } else if (process.platform === 'darwin') {
      exec('open -a Terminal', { cwd: workingDirectory, env: terminalEnv });
    } else {
      exec('x-terminal-emulator', { cwd: workingDirectory, env: terminalEnv });
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// Integrated terminal — every language (including Flutter's project-level `flutter
// run`) is spawned through node-pty via getRunConfig, replacing the old run:file /
// code:run child_process paths and the Flutter-only shell:true spawn. ConPTY (used
// on Windows) doesn't open a separate visible console window the way shell:true did.
const ptySessions = new Map<string, pty.IPty>();

// Wraps an arg in double quotes for cmd.exe if it contains whitespace or a
// quote, escaping any embedded quotes — so paths like "C:\My Project\file.js"
// survive being typed into the shell as a single token.
function quoteCmdArg(arg: string): string {
  if (/[\s"]/.test(arg)) {
    const escaped = arg
      .replace(/(\\*)"/g, '$1$1\\"')
      .replace(/(\\+)$/g, '$1$1');
    return `"${escaped}"`;
  }
  return arg;
}

function buildCommandLine(cmd: string, args: string[]): string {
  return [cmd, ...args].map(quoteCmdArg).join(' ');
}

ipcMain.handle('terminal:run', async (event, { language, path: targetPath }: { language: string; path: string }) => {
  recordActivity();
  const config = getRunConfig(targetPath, language);

  if ('html' in config) {
    return { success: true, html: true };
  }

  if ('error' in config) {
    return { success: false, error: config.error };
  }

  const sessionId = crypto.randomUUID();
  // NODE_OPTIONS is set by the dev-mode launch chain (cross-env NODE_OPTIONS="-r
  // ts-node/register ..." in the start:renderer/start:main scripts) and inherited by
  // this Electron main process. Spawned runtimes (e.g. Dart, PHP, dotnet) must not
  // see it — it makes them try to load a Node/ts-node module that doesn't apply to them.
  const { NODE_OPTIONS, ...spawnEnv } = process.env;
  const env = Object.fromEntries(
    Object.entries({ ...spawnEnv, FORCE_COLOR: '1' }).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;

  try {
    // Spawn a persistent cmd.exe shell as the pty's root process (like VS Code's
    // integrated terminal) instead of running the target command directly as the
    // root process — that way the shell (and its prompt) survives after the run
    // command finishes, instead of the pty having nothing left running.
    const ptyProcess = pty.spawn('cmd.exe', [], {
      cwd: config.cwd,
      env,
      cols: 80,
      rows: 24,
    });

    ptySessions.set(sessionId, ptyProcess);

    ptyProcess.onData((data) => {
      event.sender.send('terminal:output', { sessionId, data });
    });

    ptyProcess.onExit(({ exitCode }) => {
      ptySessions.delete(sessionId);
      event.sender.send('terminal:exit', { sessionId, exitCode });
    });

    ptyProcess.write(`${buildCommandLine(config.cmd, config.args)}\r`);

    return { success: true, sessionId };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.on('terminal:input', (_event, { sessionId, data }: { sessionId: string; data: string }) => {
  ptySessions.get(sessionId)?.write(data);
});

ipcMain.handle('terminal:stop', async (_event, { sessionId }: { sessionId: string }) => {
  const session = ptySessions.get(sessionId);
  if (!session) {
    return { success: false, error: 'No such session' };
  }
  session.kill();
  ptySessions.delete(sessionId);
  return { success: true };
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

app.on('before-quit', () => {
  endSession();
});

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app
  .whenReady()
  .then(async () => {
    // Must run before createWindow(): if isolation is needed, this relaunches
    // the whole app (app.relaunch() + app.exit()) so the fresh process
    // inherits GGML_VK_VISIBLE_DEVICES from creation. See gpuIsolation.ts.
    await ensureGpuDeviceIsolation();
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
    let fullText = '';
    const result = await generate(prompt, undefined, (chunk: string) => {
      fullText += chunk;
      event.sender.send('ai:token', chunk);
    });

    incrementAiCallCount();
    return { success: true, result: fullText || result };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('ai:translate', async (event, payload: { prompt: string; selectedCode: string; language: string }) => {
  try {
    const systemPrompt = `You are a helpful coding assistant. Translate the user request into ${payload.language} code or explanation. Preserve the intent and provide a concise, accurate result. If code is provided, return code only when appropriate, otherwise explain briefly.`;
    const userPrompt = [
      `Language: ${payload.language}`,
      payload.prompt.trim() ? `Prompt: ${payload.prompt.trim()}` : 'Prompt: Complete the selected code.',
      payload.selectedCode.trim() ? `Selected code:\n${payload.selectedCode.trim()}` : '',
    ].filter(Boolean).join('\n\n');

    let fullText = '';
    const result = await generate(userPrompt, systemPrompt, (chunk: string) => {
      fullText += chunk;
      event.sender.send('ai:token', chunk);
    });

    incrementAiCallCount();
    return { success: true, result: fullText || result };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('llama-test-ping', async () => {
  try {
    const result = await generate('Write a JS function that adds two numbers');
    console.log('[llama-test] response:', result);
    return { success: true, result };
  } catch (err) {
    console.error('[llama-test] error:', err);
    return { success: false, error: String(err) };
  }
});