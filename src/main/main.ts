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
  incrementRunCount,
  endSession,
  getCurrentSession,
  getAggregate,
  getSessionHistory,
} from './stats';
import {
  startEngineSession,
  stopEngineSession,
  onEditorActivity,
  onAiCall,
  onRun,
  dismissSuggestion,
  requestHint,
  setSuggestionSink,
  getDebugState,
  Suggestion,
} from './adaptiveEngine';

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
function getRunConfig(targetPath: string, language: string, deviceId?: string):
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
      // deviceId comes from the run-target selector in the renderer; falls back to
      // the Windows desktop target when unset (e.g. a caller that predates the selector).
      return { cmd: getFlutterBinary(), args: ['run', '-d', deviceId || 'windows'], cwd: targetPath };
    default:
      return { error: `No runner configured for ${language}` };
  }
}

type FlutterTarget = { id: string; name: string; platform: string };

// `flutter devices --machine` schema: each entry has a `platform` field that's
// arch-qualified (e.g. "windows-x64", "android-arm64") and a separate
// `platformType` field that's the coarse group ("windows", "android", "ios", "web").
// We filter on platformType to match the spec's plain "windows" / "android" check.
ipcMain.handle('flutter:listDevices', async () => {
  return new Promise<{ success: boolean; devices?: FlutterTarget[]; error?: string }>((resolve) => {
    // flutter.bat (like all .bat/.cmd files on Windows) isn't a real PE executable —
    // it can only be launched through a shell, so execFile(getFlutterBinary(), ...)
    // throws EINVAL here the same way it would for any other .bat target.
    //
    // execFile(..., { shell: true }) alone is NOT a safe fix: Node's shell:true path
    // (see lib/child_process.js normalizeSpawnArguments) naively joins file+args with
    // a single space and wraps the *whole* result in one pair of quotes — it does not
    // quote the file/each arg individually. That breaks the instant the resolved
    // flutter.bat path itself contains a space (this project's own path,
    // "Documents\Capstone\Fabrica-IDE", doesn't, but a different install location
    // easily could — e.g. "My Documents" or a "Program Files" style path).
    //
    // Fixed by driving cmd.exe /d /s /c ourselves with a manually quoted command
    // line, reusing quoteCmdArg()/buildCommandLine() below — the same helpers the
    // working pty-based Flutter Preview run path (terminal:run) already relies on to
    // survive spaces, which is why that path never hit this bug.
    const commandLine = buildCommandLine(getFlutterBinary(), ['devices', '--machine']);
    execFile(
      'cmd.exe',
      ['/d', '/s', '/c', `"${commandLine}"`],
      { timeout: 20000, windowsVerbatimArguments: true },
      (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, error: stderr || error.message });
          return;
        }
        try {
          const raw = JSON.parse(stdout);
          const devices: FlutterTarget[] = (raw as Array<Record<string, unknown>>)
            .filter((d) => {
              const platformType = d.platformType as string | undefined;
              if (platformType === 'windows') return true;
              return typeof platformType === 'string' && platformType.startsWith('android') && d.emulator === false;
            })
            .map((d) => ({ id: String(d.id), name: String(d.name), platform: String(d.platformType) }));
          resolve({ success: true, devices });
        } catch (err) {
          resolve({ success: false, error: `Failed to parse flutter devices output: ${String(err)}` });
        }
      },
    );
  });
});

// Best-effort secondary signal for the run-target dropdown: detects raw USB
// connection events at the OS level so the UI can distinguish "nothing plugged
// in" from "something's plugged in but Flutter/adb doesn't see it as debug-ready"
// (missing OEM driver, USB debugging not enabled, etc.).
//
// Deliberately implemented via polling `Get-PnpDevice` through child_process
// rather than a native module (e.g. usb-detection) — see DECISIONS.md's standing
// node-gyp/VS2022 rebuild-pain note for node-pty; this avoids that risk class
// entirely at the cost of ~3s detection latency, which is fine for a nicety.
let knownUsbDeviceIds = new Set<string>();
let usbWatcherStarted = false;

function startUsbWatcher() {
  if (usbWatcherStarted || process.platform !== 'win32') return;
  usbWatcherStarted = true;

  const poll = () => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'USB\\*' } | Select-Object -ExpandProperty InstanceId",
      ],
      { timeout: 5000 },
      (error, stdout) => {
        if (error) return; // best-effort — silently skip this tick rather than surface noise
        const current = new Set(
          stdout.split('\n').map((line) => line.trim()).filter(Boolean),
        );
        const added = [...current].filter((id) => !knownUsbDeviceIds.has(id));
        knownUsbDeviceIds = current;
        if (added.length > 0) {
          mainWindow?.webContents.send('usb:connected', added);
        }
      },
    );
  };

  poll();
  setInterval(poll, 3000);
}

class AppUpdater {
  constructor() {
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
    autoUpdater.checkForUpdatesAndNotify();
  }
}

let mainWindow: BrowserWindow | null = null;

setSuggestionSink((suggestion: Suggestion) => {
  mainWindow?.webContents.send('adaptive:suggest', suggestion);
});

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
  startEngineSession();
  return { success: true };
});

ipcMain.on('stats:activity', () => {
  recordActivity();
  onEditorActivity();
});

ipcMain.on('adaptive:dismiss', () => {
  dismissSuggestion();
});

ipcMain.handle('adaptive:getDebugState', () => getDebugState());

ipcMain.handle('adaptive:hint', async (_event, payload: { code: string; language: string }) => {
  try {
    const hint = await requestHint(payload.code, payload.language);
    return { success: true, hint };
  } catch (err) {
    return { success: false, error: String(err) };
  }
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

ipcMain.handle('terminal:run', async (event, { language, path: targetPath, deviceId }: { language: string; path: string; deviceId?: string }) => {
  recordActivity();
  incrementRunCount();
  onRun();
  const config = getRunConfig(targetPath, language, deviceId);

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

  startUsbWatcher();
};

/**
 * Add event listeners...
 */

app.on('before-quit', () => {
  endSession();
  stopEngineSession();
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
    onAiCall();
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
    onAiCall();
    return { success: true, result: fullText || result };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('ai:explain', async (event, payload: { prompt: string; selectedCode: string }) => {
  try {
    const systemPrompt = 'You are a precise code-explanation assistant. Describe exactly what the provided code does, its structure, and its properties as they actually appear in the code. Do not invent, assume, or add any properties, styles, values, or behavior that are not explicitly present in the code. If something is referenced but not defined, point that out rather than guessing or filling it in.';
    const userPrompt = [
      payload.prompt.trim() ? `Question: ${payload.prompt.trim()}` : 'Explain what this code does.',
      payload.selectedCode.trim() ? `Code:\n${payload.selectedCode.trim()}` : '',
    ].filter(Boolean).join('\n\n');

    let fullText = '';
    const result = await generate(userPrompt, systemPrompt, (chunk: string) => {
      fullText += chunk;
      event.sender.send('ai:token', chunk);
    });

    incrementAiCallCount();
    onAiCall();
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