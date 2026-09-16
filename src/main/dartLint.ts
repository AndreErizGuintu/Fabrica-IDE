import { exec } from 'child_process';

// dart analyze --format=machine emits one pipe-delimited record per line:
// SEVERITY|TYPE|ERROR_CODE|FILE_PATH|LINE|COLUMN|LENGTH|MESSAGE
export interface DartError {
  file: string;
  line: number;
  column: number;
  endColumn: number;
  severity: string;
  code: string;
  message: string;
}

export function lintDart(dartBinary: string, projectPath: string): Promise<DartError[]> {
  console.log('[dart-lint] binary path:', dartBinary);
  return new Promise((resolve) => {
    exec(`"${dartBinary}" analyze --format=machine "${projectPath}"`, (err, stdout) => {
      if (err) {
        console.log('[dart-lint] exec error:', err);
      }
      console.log('[dart-lint] raw output:', stdout);
      const results: DartError[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const parts = line.split('|');
        if (parts.length < 8) continue;
        const [severity, , code, file, lineNo, column, length, ...messageParts] = parts;
        const col = +column;
        results.push({
          file,
          line: +lineNo,
          column: col,
          endColumn: col + +length,
          severity: severity.toLowerCase(),
          code,
          message: messageParts.join('|'),
        });
      }
      console.log('[dart-lint] parsed markers:', results.length);
      resolve(results);
    });
  });
}
