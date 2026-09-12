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
import { app, BrowserWindow, shell, ipcMain, dialog, Menu, globalShortcut } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import * as pty from 'node-pty';
import MenuBuilder from './menu';
import { generate, shutdownWorker } from './llm';
import { ensureRequiredImports } from './translateImports';
import { ensureGpuDeviceIsolation } from './gpuIsolation';
import { startMirrorServer, stopMirrorServer } from './mirrorProcess';
import { registerAndroidSdkIpc } from './androidSdk';
import { resolveHtmlPath } from './util';
import {
  RUN_SENTINEL_SUFFIX,
  startCapture,
  feedCapture,
  discardCapture,
  stripSentinelForDisplay,
} from './runCapture';
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
  onRunError,
  dismissSuggestion,
  requestHint,
  requestCorrection,
  setSuggestionSink,
  getDebugState,
  Suggestion,
} from './adaptiveEngine';
import { classifyError } from './errorClassifier';
import {
  requestCodeInference,
  checkCodeInferenceTrigger,
  getCodeInferenceConfig,
} from './codeInference';

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

// `flutter devices --machine` schema: the platform field is `targetPlatform`,
// and it is arch-qualified — "android-arm64", "windows-x64", "web-javascript".
// There is NO `platformType` field in this output (that name belongs to
// Flutter's internal Device class / daemon protocol, not to `devices
// --machine`), so reading it yielded undefined for every entry and silently
// filtered the whole list to empty. Match on prefixes, never on equality.
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
          const filtered = (raw as Array<Record<string, unknown>>).filter((d) => {
            const targetPlatform = d.targetPlatform as string | undefined;
            if (typeof targetPlatform !== 'string') return false;
            // Windows desktop ("windows-x64") is always offered. Android is
            // offered only for physical hardware. Everything else — Edge and
            // Chrome ("web-javascript"), iOS, Linux — falls through and is
            // dropped, exactly as before.
            if (targetPlatform.startsWith('windows')) return true;
            return targetPlatform.startsWith('android') && d.emulator === false;
          });
          const devices: FlutterTarget[] = filtered
            .map((d) => ({ id: String(d.id), name: String(d.name), platform: String(d.targetPlatform) }));
          resolve({ success: true, devices });
        } catch (err) {
          resolve({ success: false, error: `Failed to parse flutter devices output: ${String(err)}` });
        }
      },
    );
  });
});

// Flutter is the only scaffold that cannot be hand-written: a Windows-desktop
// app is a multi-hundred-file tree (pubspec, lib/, plus windows/ CMake + the
// C++ runner + generated plugin registrants) that `flutter run -d windows`
// resolves against. So this shells out to the real tool.
//
// Streams like git:clone rather than buffering through exec(): `flutter create`
// runs a pub solve and can take tens of seconds, and a buffered call would show
// the student a frozen dialog with no output until it finished.
//
// --offline is deliberate, not a micro-optimisation. The app template declares
// two *hosted* dev/runtime deps (cupertino_icons ^1.0.8, flutter_lints ^6.0.0),
// so the pub get that `flutter create` runs at the end is the one step here that
// can touch the network. --offline forces pub to resolve from the local pub
// cache only, which makes the outcome deterministic instead of
// silently-online-dependent. It REQUIRES a warm cache — see DECISIONS.md.
//
// --project-name is required, not optional: without it flutter derives the
// package name from the directory name, and the default project name the wizard
// offers ("my-fabrica-project") contains hyphens, which flutter rejects
// outright ("is not a valid Dart package name"). The renderer sanitises to the
// same [a-z0-9_] rule flutter's own potentialValidPackageName() applies.
ipcMain.handle(
  'flutter:createProject',
  async (event, projectPath: string, projectName: string) => {
    return new Promise<{ success: boolean; output: string; error?: string }>((resolve) => {
      // flutter.bat can only be launched through a shell, and Node's shell:true
      // quoting breaks on paths with spaces — same reasoning (and same helpers)
      // as flutter:listDevices above.
      const commandLine = buildCommandLine(getFlutterBinary(), [
        'create',
        '--offline',
        '--platforms=windows',
        '--project-name',
        projectName,
        projectPath,
      ]);

      const child = spawn('cmd.exe', ['/d', '/s', '/c', `"${commandLine}"`], {
        windowsVerbatimArguments: true,
        env: prependBundledRuntimePaths(),
      });

      let output = '';

      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
        event.sender.send('flutter:create-progress', text);
      });

      child.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
        event.sender.send('flutter:create-progress', text);
      });

      child.on('close', (code: number | null) => {
        resolve({ success: code === 0, output });
      });

      child.on('error', (err: Error) => {
        resolve({ success: false, output, error: err.message });
      });
    });
  },
);

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

// Scenario 5's escalation path. Same shape as adaptive:hint — the failing
// category and output come from engine state, so the renderer sends only the
// code and language exactly as it does for a hint.
ipcMain.handle('adaptive:correction', async (_event, payload: { code: string; language: string }) => {
  try {
    const correction = await requestCorrection(payload.code, payload.language);
    return { success: true, correction };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// --- Code Inference (confirmation-based boilerplate completion) --------------
// Two handlers with deliberately different weights:
//   checkTrigger - a pure string match. No model, no lock, no counter. Asked on
//                  a debounce while the student types, so it must stay cheap.
//   request      - the real generation, reachable ONLY from an explicit accept.
//
// COUNTER NOTE, REVERSED 2026-08-07: this used to be the one AI path in the app
// that deliberately touched no counters, because ghost text appeared unasked.
// It is now accept-gated, so requestCodeInference() calls
// incrementAiCallCount() + onAiCall() itself, exactly like requestHint(). The
// counting lives in codeInference.ts next to the generation rather than here.
ipcMain.handle(
  'codeInference:checkTrigger',
  (_event, payload: { prefix: string; suffix: string; language: string }) =>
    checkCodeInferenceTrigger(payload),
);

ipcMain.handle(
  'codeInference:request',
  async (_event, payload: { prefix: string; suffix: string; language: string }) => {
    // TEMPORARY DIAGNOSTIC LOGGING - remove or gate before defense.
    const receivedAt = Date.now();
    console.log(
      '[CodeInference:main] accept -> generation requested',
      `language=${payload?.language}`,
      `prefixLen=${payload?.prefix?.length} suffixLen=${payload?.suffix?.length}`,
    );
    try {
      const { suggestion } = await requestCodeInference(payload);
      console.log(
        '[CodeInference:main] IPC responding',
        `elapsed=${Date.now() - receivedAt}ms`,
        `suggestion=${suggestion === null ? 'null' : `${suggestion.length} chars`}`,
      );
      return { success: true, suggestion };
    } catch (err) {
      // requestCodeInference already handles its own generation failures; this
      // is a backstop so a failed completion can never surface an error dialog.
      // The renderer shows a short inline message instead.
      console.log(
        '[CodeInference:main] IPC handler THREW',
        `elapsed=${Date.now() - receivedAt}ms`,
        String(err),
      );
      return { success: false, suggestion: null, error: String(err) };
    }
  },
);

ipcMain.handle('codeInference:getConfig', () => getCodeInferenceConfig());

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

// Used by the New Project flow when a remote URL is supplied: `git init` alone
// leaves the repo with no origin, so the first push has nowhere to go. Same
// runGit/exec shape as the handlers above; the URL is quoted for the same
// reason the commit message is (it reaches a shell as one token).
ipcMain.handle('git:remote-add', async (_event, cwd: string, url: string) => {
  return runGit(['remote', 'add', 'origin', `"${url}"`], cwd);
});

// Per-file staging for the Source Control panel. The existing git:add stages
// everything ('git add .') and stays as the Stage All action; this is the
// single-file equivalent. '--' terminates options so a filename that happens to
// start with a dash is still treated as a path, and the quoting is what lets
// paths with spaces survive runGit's exec().
ipcMain.handle('git:addFile', async (_event, cwd: string, filePath: string) => {
  return runGit(['add', '--', `"${filePath}"`], cwd);
});

// Unstage one file. Deliberately `git reset -- <file>` and NOT the more obvious
// `git reset HEAD <file>` or `git restore --staged <file>`: both of those
// resolve HEAD and so fail with exit 128 on a repository that has no commits
// yet ("fatal: ambiguous argument 'HEAD'" / "could not resolve 'HEAD'"). A
// freshly scaffolded Fabrica project created without a remote URL is exactly
// that case. Verified against git 2.54.0 on both an unborn and a normal repo.
ipcMain.handle('git:unstageFile', async (_event, cwd: string, filePath: string) => {
  return runGit(['reset', '--', `"${filePath}"`], cwd);
});

// Remote detection for the Sync-vs-Publish decision. Exits 0 with empty stdout
// when no remote is configured, so "has a remote" is simply non-empty output.
ipcMain.handle('git:remotes', async (_event, cwd: string) => {
  return runGit(['remote', '-v'], cwd);
});

// Works on an unborn branch too (returns e.g. "master" before the first
// commit), unlike `rev-parse --abbrev-ref HEAD`.
ipcMain.handle('git:currentBranch', async (_event, cwd: string) => {
  return runGit(['branch', '--show-current'], cwd);
});

ipcMain.handle('git:pushSetUpstream', async (_event, cwd: string, branch: string) => {
  return runGit(['push', '--set-upstream', 'origin', `"${branch}"`], cwd);
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
let activeFlutterSessionId: string | null = null;

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

  // `flutter run` is long-lived by design — it stays attached serving hot
  // reload/restart keystrokes (DECISIONS.md 2026-07-30) and only ends when the
  // app window is closed. A sentinel would therefore not resolve until app
  // shutdown, and buffering would grow for the whole session, so Flutter runs
  // are left as pure passthrough: no sentinel appended, no capture started.
  const capturesOutput = language !== 'flutter';

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

    if (language === 'flutter') {
      activeFlutterSessionId = sessionId;
    }

    if (capturesOutput) {
      startCapture(sessionId);
    }

    ptyProcess.onData((data) => {
      // Passthrough first — the capture below is a read-only tap and must never
      // delay what the terminal renders. The only edit made to the stream is
      // removing the sentinel this app injected; everything the program itself
      // wrote, colour included, is forwarded untouched.
      event.sender.send('terminal:output', {
        sessionId,
        data: capturesOutput ? stripSentinelForDisplay(data) : data,
      });

      if (capturesOutput) {
        // Deliberately the raw chunk, not the filtered one — the sentinel is
        // the capture's completion signal.
        const completion = feedCapture(sessionId, data);
        if (completion) {
          event.sender.send('terminal:run-complete', completion);

          // Classification happens HERE, in main, not round-tripped through the
          // renderer: `language` is already in scope from this handler's own
          // payload, and the Adaptive Engine lives in main anyway. onRun() has
          // already fired unconditionally for this run (top of the handler);
          // onRunError is strictly additional and only for a real, classified
          // failure — an unclassifiable one deliberately says nothing.
          const category = classifyError({
            language,
            output: completion.output,
            exitCode: completion.exitCode,
          });

          if (category) {
            onRunError(category, completion.output);
          }
        }
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (activeFlutterSessionId === sessionId) {
        activeFlutterSessionId = null;
      }
      ptySessions.delete(sessionId);
      // The shell died before any sentinel arrived — drop the buffer rather
      // than reporting a completion that never happened.
      discardCapture(sessionId);
      event.sender.send('terminal:exit', { sessionId, exitCode });
    });

    const commandLine = buildCommandLine(config.cmd, config.args);
    ptyProcess.write(`${commandLine}${capturesOutput ? RUN_SENTINEL_SUFFIX : ''}\r`);

    return { success: true, sessionId };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('terminal:hotReload', async () => {
  if (!activeFlutterSessionId) {
    return { success: true };
  }

  const session = ptySessions.get(activeFlutterSessionId);
  if (!session) {
    return { success: true };
  }

  session.write('r');
  return { success: true };
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
  // Explicit Stop / tab close — the run will never reach its sentinel, so the
  // buffer is dropped and no run-complete is emitted for it.
  discardCapture(sessionId);
  return { success: true };
});

// Blank interactive shell for the terminal tab bar's "+" button. Same spawn
// shape as terminal:run (persistent cmd.exe, NODE_OPTIONS scrubbed, per-session
// output/exit events) minus getRunConfig and the trailing command write — the
// shell comes up at a prompt with nothing queued.
//
// Deliberately does NOT call recordActivity()/incrementRunCount()/onRun():
// opening a shell is not a program run, and counting it would corrupt the
// run counter plus the Adaptive Engine's calls:runs ratio (Scenarios 2 and 4).
ipcMain.handle('terminal:create', async (event, { cwd }: { cwd?: string } = {}) => {
  const sessionId = crypto.randomUUID();
  const { NODE_OPTIONS, ...spawnEnv } = process.env;
  const env = Object.fromEntries(
    Object.entries({ ...spawnEnv, FORCE_COLOR: '1' }).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;

  const startDir = cwd && fs.existsSync(cwd) ? cwd : app.getPath('home');

  try {
    const ptyProcess = pty.spawn('cmd.exe', [], {
      cwd: startDir,
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

    return { success: true, sessionId };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// Device mirroring. Deliberately NOT following the `{ success, error }` shape
// the handlers above use: startMirrorServer()'s failures are diagnostic (a
// missing bundle path, the server's own stderr, a startup timeout) and the
// renderer should surface that text verbatim in its loading state. Letting the
// rejection through gives the panel the real message instead of a boolean.
ipcMain.handle('mirror:start', async () => startMirrorServer());

ipcMain.handle('mirror:stop', async () => stopMirrorServer());

// Android SDK first-run fetch. Unlike mirroring, this module registers its own
// handlers: its renderer contract is a stateful protocol (streamed progress, a
// license round-trip, cancel) rather than the two one-line calls above, so the
// channel names live next to the code that serves them.
//
// Registration only -- nothing here starts a download. The fetch is student-
// initiated and APK-building is the only feature that depends on it; mirroring
// and every other part of the IDE work with the SDK absent.
registerAndroidSdkIpc();

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
      // Required for the <webview> that embeds the ws-scrcpy client (device
      // mirroring). Off by default in Electron and never set here before, so
      // this turns a default on rather than reversing a deliberate choice --
      // nothing else in webPreferences is hardened (contextIsolation,
      // nodeIntegration and sandbox are all left at their secure defaults, and
      // this does not change any of them). The only page loaded into a webview
      // is the locally-forked mirror server on 127.0.0.1.
      webviewTag: true,
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

  // Native OS menu removed -- the custom MenuBarComponent in EditorLayout.tsx
  // duplicates File/View/Help. Of the old template's accelerators, only F11
  // (real OS-level fullscreen) was load-bearing with no fallback anywhere
  // else in the app; it's preserved below via a direct global shortcut.
  // Ctrl+O was already a dead no-op, Ctrl+W closed the whole window (likely
  // wrong, not a regression), and dev-only Ctrl+R conflicted with -- and is
  // superseded by -- the renderer's own Preview-refresh Ctrl+R binding.
  Menu.setApplicationMenu(null);
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true') {
    // buildMenu() used to wire this as a side effect; call it directly now
    // that the menu itself is gone, so the dev "Inspect element" right-click
    // context menu doesn't silently disappear.
    new MenuBuilder(mainWindow).setupDevelopmentEnvironment();
  }

  globalShortcut.register('F11', () => {
    if (!mainWindow) return;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });

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
  // TEMP DIAGNOSTIC (duplicate-session investigation, remove once confirmed):
  // before-quit fires on every dev save to src/main/** (electronmon hot-reload,
  // see comment below) as well as on a real app quit -- this line tells the
  // two apart in the terminal output.
  console.log(`[STATS] before-quit fired at=${new Date().toISOString()}`);
  endSession();
  stopEngineSession();
  // PART 2 of the utility-process migration (DECISIONS.md §9). Covers BOTH
  // teardown cases with one call, because electronmon's hot-reload restart is
  // itself a graceful `app.quit()` -- on a main-file change it sends 'reset' to
  // the hook it injects with `--require`, and that hook calls app.quit()
  // (node_modules/electronmon/src/hook.js). So every dev file save runs this
  // exact path, which is what stops a worker -- and its ~5GB of model VRAM --
  // leaking once per reload. Synchronous on purpose: nothing awaits this
  // handler, and electronmon's own 'will-quit' listener calls app.exit()
  // immediately after.
  shutdownWorker('app quit');
});

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  // Matches the F11 registration in createWindow() -- global shortcuts are
  // process-wide and must be released or they'd leak across app restarts.
  globalShortcut.unregisterAll();
});

// ===========================================================================
// TEMPORARY DIAGNOSTIC: main-process event-loop heartbeat probe.
// Added 2026-08-07 to diagnose the UI-freeze during AI generation. A plain
// setInterval fires from the main-process JS event loop; if generation starves
// that loop, the ticks stall and the logged gap balloons well past ~50ms,
// pointing at JS event-loop starvation (fixable via a utility process). If the
// heartbeat keeps ticking cleanly at ~50ms straight through a generation while
// the UI is still frozen, the stall is lower-level (GPU/compositor) and needs a
// different fix. Correlate the gap against llm.ts's [CodeInference:lock]
// generate() ENTRY / GENERATION START / END / LOCK RELEASED markers.
//
// Deliberately NOT tied to the model-busy lock, initLlama(), or any generation
// state -- it must keep trying to fire no matter what generate() is doing;
// that independence is the whole point of the probe. Same temporary-DEBUG
// pattern as tonight's CI_DEBUG/LOCK_DEBUG. Gate: HEARTBEAT_DEBUG=1. Strip
// before defense.
// ===========================================================================
if (process.env.HEARTBEAT_DEBUG === '1') {
  let lastTick = Date.now();
  const heartbeat = setInterval(() => {
    const now = Date.now();
    const gap = now - lastTick;
    lastTick = now;
    // gap far above the ~50ms interval == the event loop was blocked that long.
    console.log(`[heartbeat] ${now} gap=${gap}ms`);
  }, 50);
  // Don't let the probe keep the process alive on quit.
  heartbeat.unref();
  console.log('[heartbeat] probe armed (HEARTBEAT_DEBUG=1), interval=50ms');
}

app
  .whenReady()
  .then(async () => {
    // Must run before createWindow(): if isolation is needed, this relaunches
    // the whole app (app.relaunch() + app.exit()) so the fresh process
    // inherits GGML_VK_VISIBLE_DEVICES from creation. See gpuIsolation.ts.
    await ensureGpuDeviceIsolation();
    createWindow();

    // Fire-and-forget model warmup: forces the worker fork, the model load and
    // the resolveChatWrapper() cache to happen now instead of on the student's
    // first real AI request. Safe only POST-utility-process-migration -- run
    // in-process this would have frozen main for the whole ~14s load + ~3s
    // wrapper resolve; the model now loads in the worker, so main's event loop
    // and the window created directly above are untouched while it happens.
    //
    // Calls llm.generate() DIRECTLY, not via the 'ai:complete' handler below:
    // that handler calls incrementAiCallCount() and onAiCall(), and a silent
    // background call must not inflate aiCallCount or reset the adaptive-engine
    // idle timer that Scenarios 1-4 read from.
    //
    // 'opportunistic' so warmup can never make a real request wait: an
    // 'explicit' generation cancels an in-flight opportunistic one (see the
    // single-flight lock policy in llmWorker.ts). The load itself is shared via
    // initLlama()'s cached promise, so a cancelled warmup still leaves the
    // model loaded -- only the throwaway generation is dropped.
    generate('hi', undefined, undefined, { maxTokens: 1, priority: 'opportunistic' }).catch(
      (err: unknown) => {
        console.warn(
          '[warmup] Startup model warmup failed (harmless -- the first real AI request will load the model):',
          err instanceof Error ? err.message : err,
        );
      },
    );

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
    const systemPrompt = `You are a code translator. Translate the following code into ${payload.language}. Always return ONLY the translated code, with no explanation, no commentary, and no markdown fencing unless the code itself requires it. If the translated code uses any functions, types, or classes that require an import in ${payload.language} (for example, dart:math for min/max/sqrt in Dart, or System/System.Linq for C#), you MUST include the necessary import statement(s) at the top of the output — even if the original source code did not need an equivalent import. Before finalizing your answer, check your own output for any function calls or types that require an import and make sure every one of them is imported. If the code is already valid ${payload.language}, return it unchanged — do not explain why.`;
    const userPrompt = [
      `Language: ${payload.language}`,
      payload.prompt.trim() ? `Prompt: ${payload.prompt.trim()}` : `Prompt: Translate the selected code into ${payload.language}.`,
      payload.selectedCode.trim() ? `Selected code:\n${payload.selectedCode.trim()}` : '',
    ].filter(Boolean).join('\n\n');

    let fullText = '';
    const result = await generate(userPrompt, systemPrompt, (chunk: string) => {
      fullText += chunk;
      event.sender.send('ai:token', chunk);
    });

    // DETERMINISTIC IMPORT REPAIR (2026-08-10). Closes the 4-attempt
    // missing-import saga in DECISIONS.md with a mechanical guarantee instead
    // of a fifth prompt rewrite: the 08-10 diagnostic confirmed the import
    // instruction reaches the model intact and the 6.7B model drops it anyway,
    // so this is a compliance limit that wording cannot fix. Pure string/regex
    // work, no AI call -- see src/main/translateImports.ts.
    //
    // Applied to the FINALIZED text, after streaming has completed, because the
    // decision needs the whole output: whether an import is required cannot be
    // known until every symbol has been seen.
    const rawResponse = fullText || result;
    const finalResponse = ensureRequiredImports(rawResponse, payload.language);

    if (finalResponse !== rawResponse) {
      console.log(
        '[ai:translate] deterministic import repair APPLIED',
        `language=${payload.language}`,
        `addedChars=${finalResponse.length - rawResponse.length}`,
      );
    }

    incrementAiCallCount();
    onAiCall();
    return { success: true, result: finalResponse };
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