import { exec } from 'child_process';

// The trailing "[project.csproj]" is optional: file-based app builds (a loose
// .cs file, no real .csproj) omit it entirely.
const ERROR_REGEX = /^(.+)\((\d+),(\d+)\): (error|warning) (\w+): (.+?)(?: \[.+\])?$/gm;

export interface ParsedError { file: string; line: number; column: number; severity: string; code: string; message: string; }

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
      const results: ParsedError[] = [];
      let m;
      while ((m = ERROR_REGEX.exec(stdout)) !== null) {
        const [, file, line, col, severity, code, message] = m;
        results.push({ file, line: +line, column: +col, severity, code, message });
      }
      console.log('[csharp-lint] parsed markers:', results.length);
      resolve(results);
    });
  });
}
