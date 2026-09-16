import { exec } from 'child_process';

// php -l is syntax-only and stops at the first error, unlike dotnet build /
// dart analyze which report everything -- accepted tradeoff.
export interface PhpError {
  file: string;
  line: number;
  message: string;
}

// "PHP " prefix presence depends on php.ini's display_errors setting, so it's
// optional here. The "Errors parsing <file>" trailer line php -l appends
// after a real error doesn't match this pattern and is ignored as a result.
const ERROR_REGEX = /^(?:PHP )?Parse error:\s*(.+) in (.+) on line (\d+)$/m;

export function lintPhp(phpBinary: string, filePath: string): Promise<PhpError[]> {
  console.log('[php-lint] binary path:', phpBinary);
  return new Promise((resolve) => {
    exec(`"${phpBinary}" -l "${filePath}"`, (err, stdout, stderr) => {
      if (err) {
        console.log('[php-lint] exec error:', err);
      }
      console.log('[php-lint] raw output:', stdout);
      const match = ERROR_REGEX.exec(`${stdout}\n${stderr}`);
      if (!match) {
        console.log('[php-lint] parsed markers:', 0);
        resolve([]);
        return;
      }
      const [, message, file, line] = match;
      const results = [{ file, line: +line, message }];
      console.log('[php-lint] parsed markers:', results.length);
      resolve(results);
    });
  });
}
