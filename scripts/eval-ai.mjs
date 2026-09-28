// Offline eval for the AI panel's Ask mode: generates answers to the prompts in
// scripts/eval-prompts.json with the same model, system prompt and sampling
// the app uses, then checks the first code block of every answer with the
// bundled runtimes under resources/runtimes.
//
// Two phases, so a checker bug never costs a full generation pass:
//   1. generate -> scripts/eval-out/<timestamp>/raw/<id>-r<n>.md + generations.json
//   2. check    -> results.json + summary.md in the same folder
//
// These are compile/syntax checks, not correctness checks, and C# is
// first-answer only (the app's hidden fix-and-recheck is not run).
//
// Close Fabrica first: its worker holds the model in VRAM, and a second copy
// on 6GB pushes the gpuLayers ladder down and skews the timings.
//
// Run:  node scripts/eval-ai.mjs [--runs 2] [--filter csharp,flutter]
//       node scripts/eval-ai.mjs --check-only scripts/eval-out/<timestamp>
// GPU_LAYERS / GGML_VK_VISIBLE_DEVICES env vars behave as they do for the app.

import { register } from 'node:module';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import ts from 'typescript';

register(new URL('./adaptive-engine-test-loader.mjs', import.meta.url), import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const RUNTIMES = path.join(ROOT, 'resources', 'runtimes');
const FLUTTER_TEMPLATE = path.join(ROOT, 'resources', 'flutter-template');
const AIPANEL_PATH = path.join(ROOT, 'src', 'renderer', 'components', 'ai', 'AIPanel.tsx');
const MODEL_CONFIG_PATH = path.join(ROOT, 'src', 'main', 'modelConfig.json');
const PROMPTS_PATH = path.join(__dirname, 'eval-prompts.json');
const OUT_ROOT = path.join(__dirname, 'eval-out');

const LANGUAGES = ['csharp', 'javascript', 'php', 'java', 'flutter', 'react'];

// Only the bundled runtimes count: no PATH fallback, so results are tied to
// exactly what ships.
const BIN = {
  node: path.join(RUNTIMES, 'node', 'node.exe'),
  php: path.join(RUNTIMES, 'php', 'php.exe'),
  dotnet: path.join(RUNTIMES, 'dotnet', 'dotnet.exe'),
  javac: path.join(RUNTIMES, 'jdk', 'bin', 'javac.exe'),
  flutter: path.join(RUNTIMES, 'flutter', 'bin', 'flutter.bat'),
  flutterDart: path.join(RUNTIMES, 'flutter', 'bin', 'cache', 'dart-sdk', 'bin', 'dart.exe'),
};

// Fence tags that count as "the right language" for each prompt language.
const EXPECTED_TAGS = {
  csharp: ['csharp', 'cs', 'c#'],
  javascript: ['javascript', 'js', 'node'],
  php: ['php'],
  java: ['java'],
  flutter: ['dart', 'flutter'],
  react: ['jsx', 'tsx', 'javascript', 'js', 'react', 'typescript', 'ts'],
};

// ---------------------------------------------------------------------------
// CLI

const argv = process.argv.slice(2);
const argValue = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

const RUNS = Number(argValue('--runs') ?? 2);
const FILTER = argValue('--filter')
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const CHECK_ONLY_DIR = argValue('--check-only');

if (!Number.isInteger(RUNS) || RUNS < 1) {
  throw new Error(`--runs must be a positive integer, got: ${argValue('--runs')}`);
}
for (const language of FILTER ?? []) {
  if (!LANGUAGES.includes(language)) {
    throw new Error(`Unknown --filter language "${language}". Expected one of: ${LANGUAGES.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// Sampling -- copied from the ai:complete handler in src/main/main.ts. Keep in
// sync if that handler changes.

const SAMPLING = {
  maxTokens: 2048,
  temperature: 0.7,
  topP: 0.8,
  topK: 20,
  repeatPenalty: { penalty: 1.1, lastTokens: 64, penalizeNewLine: false },
};
const STOP_TRIGGERS = ['\nUser:', '\nAssistant:'];

// ---------------------------------------------------------------------------
// ASK_SYSTEM_PROMPT is read out of AIPanel.tsx rather than shared: it is a
// non-exported const in a file that imports React and Monaco, so plain node
// cannot import it, and moving it would be a renderer change. Parsed with the
// TypeScript compiler API so it fails loudly if it stops being a plain string.

function readAskSystemPrompt() {
  const source = fs.readFileSync(AIPANEL_PATH, 'utf8');
  const sourceFile = ts.createSourceFile(AIPANEL_PATH, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;

  const visit = (node) => {
    if (initializer !== undefined) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'ASK_SYSTEM_PROMPT') {
      initializer = node.initializer ?? null;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (!initializer) {
    throw new Error(`ASK_SYSTEM_PROMPT not found in ${AIPANEL_PATH}; update the eval extractor.`);
  }
  if (!ts.isStringLiteral(initializer) && !ts.isNoSubstitutionTemplateLiteral(initializer)) {
    throw new Error('ASK_SYSTEM_PROMPT is no longer a plain string literal; update the eval extractor.');
  }
  return initializer.text;
}

function loadPrompts() {
  const prompts = JSON.parse(fs.readFileSync(PROMPTS_PATH, 'utf8'));
  const seen = new Set();
  for (const prompt of prompts) {
    if (!prompt.id || !prompt.prompt || !LANGUAGES.includes(prompt.language)) {
      throw new Error(`Invalid prompt entry in eval-prompts.json: ${JSON.stringify(prompt)}`);
    }
    if (seen.has(prompt.id)) throw new Error(`Duplicate prompt id: ${prompt.id}`);
    seen.add(prompt.id);
  }
  return prompts;
}

const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const seconds = (ms) => (ms / 1000).toFixed(1);

// ---------------------------------------------------------------------------
// Model load -- copied from loadModelWithFallback() in
// src/main/worker/llmWorker.ts (that module throws on import without
// process.parentPort, so it cannot be imported here). Keep in sync.

const MAX_INFERENCE_THREADS = Math.max(1, os.cpus().length - 2);
const GPU_LAYERS = process.env.GPU_LAYERS ? parseInt(process.env.GPU_LAYERS, 10) : 'auto';
const GPU_LAYERS_FALLBACK_LADDER = [20, 13, 8, 4, 0];
const MAX_LOAD_ATTEMPTS = 6;

const VRAM_ERROR_PATTERNS = [
  /ErrorOutOfDeviceMemory/i,
  /out of device memory/i,
  /failed to allocate .*buffer/i,
  /failed to create context/i,
  /insufficient.*memory/i,
];

const isVramError = (err) => {
  const message = err instanceof Error ? err.message : String(err);
  return VRAM_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};

const buildLayerAttempts = () => {
  const start = GPU_LAYERS;
  const ladder = GPU_LAYERS_FALLBACK_LADDER.filter((n) => start === 'auto' || n < start);
  return [start, ...ladder].slice(0, MAX_LOAD_ATTEMPTS);
};

async function loadModelWithFallback(llama, modelPath) {
  const attempts = buildLayerAttempts();
  let lastError;

  for (let i = 0; i < attempts.length; i += 1) {
    const gpuLayers = attempts[i];
    const isLastAttempt = i === attempts.length - 1;
    let model;

    try {
      model = await llama.loadModel({ modelPath, gpuLayers });
    } catch (err) {
      lastError = err;
      if (!isVramError(err) || isLastAttempt) throw err;
      console.warn(`[eval] loadModel failed with gpuLayers=${gpuLayers}: ${err.message}. Stepping down.`);
      continue;
    }

    // KV-cache VRAM is allocated at context creation, not at load, so probe it.
    try {
      const probeContext = await model.createContext();
      await probeContext.dispose();
      console.log(`[eval] Model loaded with gpuLayers=${gpuLayers} -> resolved ${model.gpuLayers} layers.`);
      return model;
    } catch (err) {
      lastError = err;
      await model.dispose();
      if (!isVramError(err) || isLastAttempt) throw err;
      console.warn(`[eval] createContext failed with gpuLayers=${gpuLayers}: ${err.message}. Stepping down.`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Model failed to load at every gpuLayers fallback level.');
}

// ---------------------------------------------------------------------------
// Loop guard -- copied from checkForLoop() in the ai:complete handler in
// src/main/main.ts. Keep in sync.

const LOOP_REPEAT_LIMIT = 4;
const LOOP_STOP_NOTICE =
  '⚠ Stopped: the model started repeating itself. Try rephrasing or starting a new chat.';

function createLoopGuard() {
  let fullText = '';
  let scannedTo = 0;
  let runLine = '';
  let runCount = 0;
  let runFirstEnd = 0;
  let keepUntil = -1;

  const checkForLoop = () => {
    let nl = fullText.indexOf('\n', scannedTo);
    while (nl !== -1 && keepUntil === -1) {
      const line = fullText.slice(scannedTo, nl).trim();
      scannedTo = nl + 1;
      if (line === runLine && line !== '') {
        runCount += 1;
        if (runCount >= LOOP_REPEAT_LIMIT) keepUntil = runFirstEnd;
      } else if (line.length > 3 && /[A-Za-z0-9]/.test(line)) {
        runLine = line;
        runCount = 1;
        runFirstEnd = scannedTo;
      } else if (line !== '') {
        runLine = '';
        runCount = 0;
      }
      nl = fullText.indexOf('\n', scannedTo);
    }
  };

  return {
    // Returns true once the guard has tripped.
    push(chunk) {
      if (keepUntil !== -1) return true;
      fullText += chunk;
      checkForLoop();
      return keepUntil !== -1;
    },
    get tripped() {
      return keepUntil !== -1;
    },
    get fullText() {
      return fullText;
    },
    // What ai:complete returns to the renderer when the guard trips.
    stoppedAnswer() {
      let kept = fullText.slice(0, keepUntil);
      if ((kept.match(/```/g) ?? []).length % 2 === 1) kept += '```\n';
      return `${kept}\n${LOOP_STOP_NOTICE}`;
    },
  };
}

// ---------------------------------------------------------------------------
// Phase 1: generate

async function generateAll(prompts, outDir) {
  const systemPrompt = readAskSystemPrompt();
  const { modelFile, displayName } = JSON.parse(fs.readFileSync(MODEL_CONFIG_PATH, 'utf8'));
  const modelPath = path.join(ROOT, 'resources', 'models', modelFile);
  if (!fs.existsSync(modelPath)) throw new Error(`Model file not found at ${modelPath}`);

  const { getLlama, LlamaChatSession, resolveChatWrapper } = await import('node-llama-cpp');

  const llama = await getLlama({ maxThreads: MAX_INFERENCE_THREADS });
  const gpuDevices = await llama.getGpuDeviceNames();
  console.log(`[eval] GPU device(s): ${gpuDevices.join(', ') || '(none)'}`);
  if (gpuDevices.length > 1 && !process.env.GGML_VK_VISIBLE_DEVICES) {
    console.warn(
      '[eval] More than one GPU is visible and GGML_VK_VISIBLE_DEVICES is unset. The app isolates the ' +
        'dedicated GPU at startup; set GGML_VK_VISIBLE_DEVICES to its index to match.',
    );
  }

  const loadStart = performance.now();
  const model = await loadModelWithFallback(llama, modelPath);
  const loadMs = performance.now() - loadStart;
  // Resolved once, same as initLlama() in the worker.
  const chatWrapper = resolveChatWrapper(model);

  const total = prompts.length * RUNS;
  const meta = {
    startedAt: new Date().toISOString(),
    model: modelFile,
    displayName,
    gpuLayers: model.gpuLayers,
    gpuDevices,
    loadMs: Math.round(loadMs),
    askPromptSha256: sha256(systemPrompt),
    askPromptLength: systemPrompt.length,
    runs: RUNS,
    sampling: SAMPLING,
    stopTriggers: STOP_TRIGGERS,
    generations: [],
  };
  const metaPath = path.join(outDir, 'generations.json');
  writeJson(metaPath, meta);

  console.log(`[eval] ${prompts.length} prompts x ${RUNS} runs = ${total} generations. Model load ${seconds(loadMs)}s.\n`);

  let done = 0;
  let genMsTotal = 0;
  // Run-major, so an interrupted run still covers every prompt once.
  for (let run = 1; run <= RUNS; run += 1) {
    for (const prompt of prompts) {
      done += 1;
      const file = `raw/${prompt.id}-r${run}.md`;
      const record = { id: prompt.id, language: prompt.language, run, file };
      const context = await model.createContext({ threads: MAX_INFERENCE_THREADS });
      const guard = createLoopGuard();
      const abort = new AbortController();
      const start = performance.now();

      try {
        // Fresh context + session per generation; no history, as a new Ask chat.
        const session = new LlamaChatSession({ contextSequence: context.getSequence(), chatWrapper, systemPrompt });

        const result = await session.prompt(prompt.prompt, {
          ...SAMPLING,
          customStopTriggers: STOP_TRIGGERS,
          signal: abort.signal,
          stopOnAbortSignal: true,
          onTextChunk: (chunk) => {
            if (guard.push(chunk)) abort.abort();
          },
        }).catch((err) => {
          // Our own abort: the kept text is already in the guard (as ai:complete).
          if (guard.tripped) return '';
          throw err;
        });

        const generated = guard.fullText || result;
        const answer = guard.tripped ? guard.stoppedAnswer() : generated;
        record.genMs = Math.round(performance.now() - start);
        record.tokens = model.tokenize(generated).length;
        record.stoppedRepeating = guard.tripped;
        fs.writeFileSync(path.join(outDir, file), answer, 'utf8');
      } catch (err) {
        record.genMs = Math.round(performance.now() - start);
        record.error = String(err?.stack ?? err);
        fs.writeFileSync(path.join(outDir, file), '', 'utf8');
      } finally {
        await context.dispose();
      }

      genMsTotal += record.genMs;
      meta.generations.push(record);
      writeJson(metaPath, meta);

      const etaMs = (genMsTotal / done) * (total - done);
      const detail = record.error
        ? `ERROR ${record.error.split('\n')[0]}`
        : `${seconds(record.genMs)}s ${record.tokens} tok${record.stoppedRepeating ? ' LOOP-STOPPED' : ''}`;
      console.log(`[${done}/${total}] ${prompt.id} r${run}  ${detail}  (eta ${Math.round(etaMs / 60000)} min)`);
    }
  }

  meta.finishedAt = new Date().toISOString();
  writeJson(metaPath, meta);
  await model.dispose();
  await llama.dispose();
}

// ---------------------------------------------------------------------------
// Phase 2: check

function extractFirstCodeBlock(text) {
  const closed = /```([^\n`]*)\r?\n([\s\S]*?)```/.exec(text);
  const match = closed ?? /```([^\n`]*)\r?\n([\s\S]*)$/.exec(text);
  if (!match) return null;
  return {
    tag: match[1].trim().split(/\s+/)[0].toLowerCase(),
    code: match[2],
    // A fence left open means the answer was cut off (usually maxTokens).
    unclosed: !closed,
  };
}

function evaluateRules(code, rules) {
  if (!rules) return null;
  if (code === undefined) return { pass: false, failed: ['no code block'] };
  const failed = [];
  for (const pattern of rules.mustMatch ?? []) {
    if (!new RegExp(pattern).test(code)) failed.push(`missing /${pattern}/`);
  }
  for (const pattern of rules.mustNotMatch ?? []) {
    if (new RegExp(pattern).test(code)) failed.push(`forbidden /${pattern}/`);
  }
  return { pass: failed.length === 0, failed };
}

// exitCode is null when the tool could not run at all (missing, timed out).
function runTool(cmd, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: 120_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024, ...options },
      (err, stdout, stderr) => {
        let exitCode = 0;
        if (err) exitCode = typeof err.code === 'number' ? err.code : null;
        resolve({ err, exitCode, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      },
    );
  });
}

const pass = (extra = {}) => ({ status: 'pass', errors: [], ...extra });
const compileFail = (errors, extra = {}) => ({ status: 'compile_fail', errors, ...extra });
const checkError = (message) => ({ status: 'check_error', errors: [message] });
const snippet = (text) => text.trim().slice(0, 1500);
const toolFailure = (name, result) =>
  checkError(`${name} did not run: ${result.err?.message ?? 'unknown error'}${result.err?.killed ? ' (timed out)' : ''}`);

// Same quoting as quoteCmdArg()/buildCommandLine() in src/main/main.ts:
// flutter.bat can only be launched through cmd.exe.
function quoteCmdArg(arg) {
  if (/[\s"]/.test(arg)) {
    const escaped = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1');
    return `"${escaped}"`;
  }
  return arg;
}
const buildCommandLine = (cmd, args) => [cmd, ...args].map(quoteCmdArg).join(' ');

// The app seeds its pub cache into userData; reuse it rather than writing into
// resources/pub-cache-seed, which gets packaged.
function resolvePubCache() {
  if (process.env.PUB_CACHE) return process.env.PUB_CACHE;
  for (const appName of ['electron-react-boilerplate', 'Fabrica']) {
    const dir = path.join(process.env.APPDATA ?? '', appName, 'pub-cache');
    if (fs.existsSync(path.join(dir, '.seed-complete'))) return dir;
  }
  console.warn("[eval] No seeded app pub cache found; flutter pub get --offline will use the host's default PUB_CACHE.");
  return null;
}

function createCheckers(tmpRoot) {
  let sampleSeq = 0;
  const sampleDir = () => {
    sampleSeq += 1;
    const dir = path.join(tmpRoot, `s${sampleSeq}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  let csharpLint;
  let flutterProject;

  const missing = (binary) => (fs.existsSync(binary) ? null : checkError(`Bundled runtime missing: ${binary}`));

  return {
    async csharp(code) {
      const absent = missing(BIN.dotnet);
      if (absent) return absent;
      if (!csharpLint) {
        // The exact function Ask's verify step calls (dotnet build on one file).
        const { lintCSharpCode } = await import(new URL('../src/main/csharpLint.ts', import.meta.url).href);
        csharpLint = lintCSharpCode;
        console.log('[eval] Warming up dotnet (first file-based build restores)...');
        await csharpLint(BIN.dotnet, 'System.Console.WriteLine("warm");').catch(() => undefined);
      }
      try {
        const results = await csharpLint(BIN.dotnet, code);
        // dotnet prints each diagnostic twice (progress + summary).
        const errors = [
          ...new Set(
            results.filter((r) => r.severity === 'error').map((r) => `Line ${r.line}: ${r.code}: ${r.message}`),
          ),
        ];
        const warnings = new Set(results.filter((r) => r.severity === 'warning').map((r) => `${r.line}${r.code}`)).size;
        return errors.length ? compileFail(errors, { warnings }) : pass({ warnings });
      } catch (err) {
        return checkError(err.message);
      }
    },

    async javascript(code) {
      const absent = missing(BIN.node);
      if (absent) return absent;
      const file = path.join(sampleDir(), 'main.js');
      fs.writeFileSync(file, code, 'utf8');
      const result = await runTool(BIN.node, ['--check', file]);
      if (result.exitCode === 0) return pass();
      if (result.exitCode === null) return toolFailure('node --check', result);
      return compileFail([snippet(result.stderr)]);
    },

    async php(code) {
      const absent = missing(BIN.php);
      if (absent) return absent;
      // php -l passes plain text, so without an open tag nothing was checked.
      if (!/<\?php/i.test(code)) return compileFail(['Missing <?php open tag']);
      const file = path.join(sampleDir(), 'main.php');
      fs.writeFileSync(file, code, 'utf8');
      const result = await runTool(BIN.php, ['-l', file]);
      if (result.exitCode === 0) return pass();
      if (result.exitCode === null) return toolFailure('php -l', result);
      const output = `${result.stdout}\n${result.stderr}`;
      const errors = output.split(/\r?\n/).filter((line) => /error/i.test(line) && !/^Errors parsing/i.test(line));
      return compileFail(errors.length ? errors : [snippet(output)]);
    },

    async java(code) {
      const absent = missing(BIN.javac);
      if (absent) return absent;
      // Same class-name rule as getRunConfig() in src/main/main.ts.
      const className = (code.match(/public\s+class\s+(\w+)/) ?? code.match(/\bclass\s+(\w+)/))?.[1];
      if (!className) return compileFail(['No class declaration found']);
      const dir = sampleDir();
      const file = path.join(dir, `${className}.java`);
      fs.writeFileSync(file, code, 'utf8');
      // No -encoding flag, matching the app's Run path.
      const result = await runTool(BIN.javac, ['-d', path.join(dir, 'out'), file], { cwd: dir });
      if (result.exitCode === 0) return pass();
      if (result.exitCode === null) return toolFailure('javac', result);
      const errors = result.stderr.split(/\r?\n/).filter((line) => /: error: /.test(line));
      return compileFail(errors.length ? errors : [snippet(result.stderr)]);
    },

    async flutter(code) {
      for (const binary of [BIN.flutter, BIN.flutterDart]) {
        const absent = missing(binary);
        if (absent) return absent;
      }
      if (!flutterProject) flutterProject = await prepareFlutterProject(tmpRoot);
      if (flutterProject.error) return checkError(flutterProject.error);

      fs.writeFileSync(path.join(flutterProject.dir, 'lib', 'main.dart'), code, 'utf8');
      const result = await runTool(BIN.flutterDart, ['analyze', '--format=machine', flutterProject.dir], {
        cwd: flutterProject.dir,
        env: flutterProject.env,
      });
      if (result.exitCode === null) return toolFailure('dart analyze', result);

      // SEVERITY|TYPE|CODE|FILE|LINE|COLUMN|LENGTH|MESSAGE
      const records = `${result.stdout}\n${result.stderr}`
        .split(/\r?\n/)
        .map((line) => line.split('|'))
        .filter((parts) => parts.length >= 8);
      const errors = records
        .filter(([severity]) => severity === 'ERROR')
        .map(([, , errorCode, , line, , , ...message]) => `Line ${line}: ${errorCode}: ${message.join('|')}`);
      const warnings = records.filter(([severity]) => severity === 'WARNING').length;
      const infos = records.filter(([severity]) => severity === 'INFO').length;

      if (errors.length) return compileFail(errors, { warnings, infos });
      if (result.exitCode !== 0 && records.length === 0) {
        return checkError(`dart analyze failed without diagnostics: ${snippet(result.stderr || result.stdout)}`);
      }
      return pass({ warnings, infos });
    },

    // Syntax only: transpileModule reports syntactic diagnostics, never type errors.
    async react(code, block) {
      const extension = ['tsx', 'ts', 'typescript'].includes(block.tag) ? '.tsx' : '.jsx';
      const output = ts.transpileModule(code, {
        fileName: `App${extension}`,
        reportDiagnostics: true,
        compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
      });
      const errors = (output.diagnostics ?? [])
        .filter((d) => d.category === ts.DiagnosticCategory.Error)
        .map((d) => {
          const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
          const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : '?';
          return `Line ${line}: TS${d.code}: ${message}`;
        });
      return errors.length ? compileFail(errors, { parsedAs: extension }) : pass({ parsedAs: extension });
    },
  };
}

// Copies the template once (minus test/, whose widget_test.dart references
// MyApp, which generated code often does not define), resolves packages
// offline once, then every Flutter sample overwrites lib/main.dart.
async function prepareFlutterProject(tmpRoot) {
  const dir = path.join(tmpRoot, 'flutter_eval');
  const skip = new Set(['test', 'build', '.dart_tool']);
  fs.cpSync(FLUTTER_TEMPLATE, dir, {
    recursive: true,
    filter: (src) => !skip.has(path.relative(FLUTTER_TEMPLATE, src).split(path.sep)[0]),
  });

  const env = { ...process.env };
  const pubCache = resolvePubCache();
  if (pubCache) env.PUB_CACHE = pubCache;

  console.log('[eval] Preparing Flutter template copy (flutter pub get --offline)...');
  const commandLine = buildCommandLine(BIN.flutter, ['pub', 'get', '--offline']);
  const result = await runTool('cmd.exe', ['/d', '/s', '/c', `"${commandLine}"`], {
    cwd: dir,
    env,
    windowsVerbatimArguments: true,
    timeout: 300_000,
  });
  if (result.exitCode !== 0) {
    return { error: `flutter pub get --offline failed: ${snippet(result.stderr || result.stdout || String(result.err))}` };
  }
  return { dir, env };
}

async function checkAll(outDir) {
  const metaPath = path.join(outDir, 'generations.json');
  if (!fs.existsSync(metaPath)) throw new Error(`No generations.json in ${outDir}`);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  // Rules come from the current prompts file, so they can be refined and
  // re-checked with --check-only without regenerating.
  const rulesById = new Map(loadPrompts().map((p) => [p.id, p.rules]));
  const generations = meta.generations.filter((g) => !FILTER || FILTER.includes(g.language));

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fabrica-eval-'));
  const checkers = createCheckers(tmpRoot);
  const results = [];

  console.log(`\n[eval] Checking ${generations.length} answers...`);
  try {
    for (const [index, generation] of generations.entries()) {
      const answer = fs.readFileSync(path.join(outDir, generation.file), 'utf8');
      const block = generation.error ? null : extractFirstCodeBlock(answer);
      const check = block ? await checkers[generation.language](block.code, block) : null;

      let status;
      if (generation.error) status = 'gen_error';
      else if (!block) status = 'no_code';
      // The app shows a stop notice and skips verify, so this is never a pass.
      else if (generation.stoppedRepeating) status = 'loop_stopped';
      else status = check.status;

      const result = {
        ...generation,
        status,
        fenceTag: block?.tag ?? null,
        fenceMatch: block ? EXPECTED_TAGS[generation.language].includes(block.tag) : false,
        unclosedFence: block?.unclosed ?? false,
        check,
        rules: evaluateRules(block?.code, rulesById.get(generation.id)),
      };
      results.push(result);
      console.log(`[${index + 1}/${generations.length}] ${generation.id} r${generation.run}  ${status}`);
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  const { askPromptSha256, model, gpuLayers, sampling, runs } = meta;
  writeJson(path.join(outDir, 'results.json'), {
    checkedAt: new Date().toISOString(),
    model,
    gpuLayers,
    askPromptSha256,
    runs,
    sampling,
    results,
  });
  const summary = buildSummary(meta, results);
  fs.writeFileSync(path.join(outDir, 'summary.md'), summary, 'utf8');
  console.log(`\n${summary}`);
  console.log(`[eval] Wrote ${path.relative(ROOT, outDir)}\\results.json and summary.md`);
}

// ---------------------------------------------------------------------------
// Summary

const STATUSES = ['pass', 'compile_fail', 'no_code', 'loop_stopped', 'gen_error', 'check_error'];

function buildSummary(meta, results) {
  const lines = [];
  lines.push(`# Ask eval: ${meta.displayName ?? meta.model}`);
  lines.push('');
  lines.push(
    `Model \`${meta.model}\`, gpuLayers ${meta.gpuLayers}, ${meta.runs} run(s) per prompt, ` +
      `ASK_SYSTEM_PROMPT sha256 \`${meta.askPromptSha256.slice(0, 12)}\`.`,
  );
  lines.push('Pass rate excludes check_error (the tool failed, not the model).');
  lines.push('');
  lines.push(`| language | n | ${STATUSES.join(' | ')} | pass rate | rules | fence ok | avg gen s | avg tokens |`);
  lines.push(`|---|---|${STATUSES.map(() => '---').join('|')}|---|---|---|---|---|`);

  const row = (label, group) => {
    if (!group.length) return;
    const count = (status) => group.filter((r) => r.status === status).length;
    const scored = group.length - count('check_error');
    const passRate = scored ? `${Math.round((count('pass') / scored) * 100)}%` : '-';
    const withRules = group.filter((r) => r.rules);
    const rules = withRules.length ? `${withRules.filter((r) => r.rules.pass).length}/${withRules.length}` : '-';
    const fence = `${group.filter((r) => r.fenceMatch).length}/${group.length}`;
    const generated = group.filter((r) => !r.error);
    const avg = (key) => (generated.length ? generated.reduce((sum, r) => sum + (r[key] ?? 0), 0) / generated.length : 0);
    lines.push(
      `| ${label} | ${group.length} | ${STATUSES.map(count).join(' | ')} | ${passRate} | ${rules} | ${fence} | ` +
        `${seconds(avg('genMs'))} | ${Math.round(avg('tokens'))} |`,
    );
  };

  for (const language of LANGUAGES) row(language, results.filter((r) => r.language === language));
  row('**all**', results);

  lines.push('');
  lines.push('## Per prompt');
  lines.push('');
  const runNumbers = [...new Set(results.map((r) => r.run))].sort((a, b) => a - b);
  lines.push(`| id | ${runNumbers.map((n) => `r${n}`).join(' | ')} |`);
  lines.push(`|---|${runNumbers.map(() => '---').join('|')}|`);
  for (const id of [...new Set(results.map((r) => r.id))]) {
    const cells = runNumbers.map((n) => {
      const r = results.find((x) => x.id === id && x.run === n);
      if (!r) return '';
      const ruleNote = r.rules && !r.rules.pass ? ' (rules x)' : '';
      return `${r.status}${ruleNote}`;
    });
    lines.push(`| ${id} | ${cells.join(' | ')} |`);
  }

  const failures = results.filter((r) => r.status !== 'pass' || (r.rules && !r.rules.pass));
  if (failures.length) {
    lines.push('');
    lines.push('## Failures');
    for (const r of failures) {
      lines.push('');
      lines.push(`**${r.id} r${r.run}**: ${r.status} (fence \`${r.fenceTag ?? 'none'}\`${r.unclosedFence ? ', unclosed' : ''})`);
      for (const error of (r.check?.errors ?? []).slice(0, 3)) lines.push(`- ${error.replace(/\r?\n/g, ' ')}`);
      for (const failed of r.rules?.failed ?? []) lines.push(`- rule: ${failed}`);
      if (r.error) lines.push(`- ${r.error.split('\n')[0]}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------

if (CHECK_ONLY_DIR) {
  await checkAll(path.resolve(CHECK_ONLY_DIR));
} else {
  const prompts = loadPrompts().filter((p) => !FILTER || FILTER.includes(p.language));
  if (!prompts.length) throw new Error('No prompts selected.');
  const outDir = path.join(OUT_ROOT, new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(path.join(outDir, 'raw'), { recursive: true });
  console.log(`[eval] Output: ${path.relative(ROOT, outDir)}`);
  await generateAll(prompts, outDir);
  await checkAll(outDir);
}
process.exit(0);
