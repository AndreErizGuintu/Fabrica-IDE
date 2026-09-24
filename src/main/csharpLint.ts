import { exec, execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// The trailing "[project.csproj]" is optional: file-based app builds (a loose
// .cs file, no real .csproj) omit it entirely.
const ERROR_REGEX = /^(.+)\((\d+),(\d+)\): (error|warning) (\w+): (.+?)(?: \[.+\])?$/gm;

export interface ParsedError { file: string; line: number; column: number; severity: string; code: string; message: string; }

export function parseCSharpBuildOutput(stdout: string): ParsedError[] {
  const results: ParsedError[] = [];
  let m;
  while ((m = ERROR_REGEX.exec(stdout)) !== null) {
    const [, file, line, col, severity, code, message] = m;
    results.push({ file, line: +line, column: +col, severity, code, message });
  }
  return results;
}

export function lintCSharp(dotnetBinary: string, csprojPath: string): Promise<ParsedError[]> {
  console.log('[csharp-lint] dotnet binary path:', dotnetBinary);
  console.log('[csharp-lint] csproj/file path:', csprojPath);
  return new Promise((resolve) => {
    // No extra flags here: for a loose .cs file with no .csproj, --no-restore
    // and -clp:NoSummary get treated as MSBuild arguments and break file-based
    // app detection (dotnet then warns the .cs file itself was "treated as an
    // MSBuild argument" instead of running in file-based app mode).
    exec(`"${dotnetBinary}" build "${csprojPath}"`, (err, stdout) => {
      if (err) {
        console.log('[csharp-lint] exec error:', err);
      }
      console.log('[csharp-lint] raw output:', stdout);
      const results = parseCSharpBuildOutput(stdout);
      console.log('[csharp-lint] parsed markers:', results.length);
      resolve(results);
    });
  });
}

// One fixed file, overwritten per check: dotnet caches a file-based app's build
// per source path, so a stable path keeps later builds warm and leaves a single
// cache folder behind instead of one per check.
const VERIFY_DIR = path.join(os.tmpdir(), 'fabrica-csharp-verify');
const VERIFY_FILE = path.join(VERIFY_DIR, 'Program.cs');
const VERIFY_TIMEOUT_MS = 60_000;
let verifyQueue: Promise<unknown> = Promise.resolve();

// Rejects when the build could not run or failed without any parsable
// compiler error (timeout, restore failure) so that is never read as "clean".
export function lintCSharpCode(dotnetBinary: string, code: string): Promise<ParsedError[]> {
  const run = async () => {
    await fs.promises.mkdir(VERIFY_DIR, { recursive: true });
    await fs.promises.writeFile(VERIFY_FILE, code, 'utf8');
    return new Promise<ParsedError[]>((resolve, reject) => {
      execFile(
        dotnetBinary,
        ['build', VERIFY_FILE],
        { timeout: VERIFY_TIMEOUT_MS, windowsHide: true },
        (err, stdout) => {
          const results = parseCSharpBuildOutput(stdout ?? '');
          if (err && !results.some((r) => r.severity === 'error')) {
            reject(new Error(`C# verify build failed to run: ${err.message}`));
            return;
          }
          resolve(results);
        },
      );
    });
  };
  const result = verifyQueue.then(run, run);
  verifyQueue = result.catch(() => undefined);
  return result;
}
