import { classifyError, normalizeLanguage } from '../main/errorClassifier';

// ===========================================================================
// Unit tests for the deterministic run-output error classifier.
//
// Safe to import from src/main here: errorClassifier.ts is pure and imports
// nothing, so it pulls in no `electron` and needs no mocking — same rationale
// as translateImports.test.ts.
//
// The Node fixture below is the output hand-traced in today\u2019s runCapture
// investigation (cleaned output as terminal:run-complete would deliver it,
// i.e. prompt/banner/sentinel already stripped). Everything else is derived
// from general knowledge of each runtime and is NOT verified against the
// bundled runtimes — see the confidence notes in errorClassifier.ts.
// ===========================================================================

const NODE_REFERENCE_ERROR = [
  'starting',
  'C:\\proj\\x.js:2',
  'undefinedFn();',
  '^',
  '',
  'ReferenceError: undefinedFn is not defined',
  '    at Object.<anonymous> (C:\\proj\\x.js:2:1)',
  '    at Module._compile (node:internal/modules/cjs/loader:1234:14)',
  'Node.js v20.11.0',
].join('\n');

describe('classifyError - guards', () => {
  it('returns null for a successful run even if output mentions an error', () => {
    expect(
      classifyError({ language: 'js', output: 'done: 0 errors found', exitCode: 0 }),
    ).toBeNull();
  });

  it('returns null for empty or whitespace-only output', () => {
    expect(classifyError({ language: 'js', output: '', exitCode: 1 })).toBeNull();
    expect(classifyError({ language: 'js', output: '   \n  ', exitCode: 1 })).toBeNull();
  });

  it('returns null for an unknown language rather than guessing', () => {
    expect(
      classifyError({ language: 'cobol', output: 'SyntaxError: nope', exitCode: 1 }),
    ).toBeNull();
  });

  it('returns null when a non-zero exit has no error evidence at all', () => {
    // grep-style "no match" exit 1 with ordinary output — not a crash.
    expect(
      classifyError({ language: 'js', output: 'no results found\n', exitCode: 1 }),
    ).toBeNull();
  });

  it('falls back to runtime-exception only on clear generic evidence', () => {
    expect(
      classifyError({ language: 'php', output: 'Stack trace:\n#0 {main}', exitCode: 255 }),
    ).toBe('runtime-exception');
  });

  it('normalizes language spellings onto rule-table keys', () => {
    expect(normalizeLanguage('C#')).toBe('csharp');
    expect(normalizeLanguage(' TypeScript ')).toBe('node');
    expect(normalizeLanguage('cobol')).toBeNull();
  });
});

describe('classifyError - Node / JS / TS', () => {
  it('classifies the hand-traced ReferenceError fixture', () => {
    expect(
      classifyError({ language: 'js', output: NODE_REFERENCE_ERROR, exitCode: 1 }),
    ).toBe('undefined-reference');
  });

  it('classifies SyntaxError as syntax', () => {
    const output = "C:\\proj\\x.js:1\nconsole.log('a'))\n                ^\n\nSyntaxError: Unexpected token ')'";
    expect(classifyError({ language: 'js', output, exitCode: 1 })).toBe('syntax');
  });

  it('classifies Cannot find module as missing-import, not runtime-exception', () => {
    const output = "Error: Cannot find module 'lodash'\n    at Module._resolveFilename (node:internal:1:1)";
    expect(classifyError({ language: 'js', output, exitCode: 1 })).toBe('missing-import');
  });

  it('classifies a null dereference TypeError as null-reference, not type-mismatch', () => {
    const output = "TypeError: Cannot read properties of undefined (reading 'name')\n    at foo (C:\\proj\\x.js:3:9)";
    expect(classifyError({ language: 'js', output, exitCode: 1 })).toBe('null-reference');
  });

  it('classifies a non-null TypeError as type-mismatch', () => {
    const output = 'TypeError: x.map is not a function\n    at foo (C:\\proj\\x.js:3:9)';
    expect(classifyError({ language: 'ts', output, exitCode: 1 })).toBe('type-mismatch');
  });

  it('classifies Node TS type-stripping syntax failures as syntax', () => {
    const output = 'SyntaxError [ERR_INVALID_TYPESCRIPT_SYNTAX]: Unsupported TypeScript syntax';
    expect(classifyError({ language: 'ts', output, exitCode: 1 })).toBe('syntax');
  });
});

describe('classifyError - PHP', () => {
  it('classifies a parse error as syntax', () => {
    const output = 'PHP Parse error:  syntax error, unexpected token ";" in C:\\proj\\x.php on line 7';
    expect(classifyError({ language: 'php', output, exitCode: 255 })).toBe('syntax');
  });

  it('classifies an undefined function call as undefined-reference', () => {
    const output = [
      'PHP Fatal error:  Uncaught Error: Call to undefined function foo() in C:\\proj\\x.php:3',
      'Stack trace:',
      '#0 {main}',
      '  thrown in C:\\proj\\x.php on line 3',
    ].join('\n');
    expect(classifyError({ language: 'php', output, exitCode: 255 })).toBe('undefined-reference');
  });

  it('classifies a method call on null as null-reference', () => {
    const output = 'PHP Fatal error:  Uncaught Error: Call to a member function getName() on null in C:\\proj\\x.php:9';
    expect(classifyError({ language: 'php', output, exitCode: 255 })).toBe('null-reference');
  });

  it('classifies a bare fatal error as runtime-exception', () => {
    const output = 'PHP Fatal error:  Allowed memory size of 134217728 bytes exhausted';
    expect(classifyError({ language: 'php', output, exitCode: 255 })).toBe('runtime-exception');
  });
});

describe('classifyError - C#', () => {
  it('classifies CS0103 as undefined-reference', () => {
    const output = "C:\\proj\\Program.cs(12,9): error CS0103: The name 'x' does not exist in the current context [C:\\proj\\p.csproj]";
    expect(classifyError({ language: 'cs', output, exitCode: 1 })).toBe('undefined-reference');
  });

  it('classifies NullReferenceException as null-reference', () => {
    const output = [
      'Unhandled exception. System.NullReferenceException: Object reference not set to an instance of an object.',
      '   at Program.Main(String[] args) in C:\\proj\\Program.cs:line 12',
    ].join('\n');
    expect(classifyError({ language: 'C#', output, exitCode: 134 })).toBe('null-reference');
  });

  it('classifies CS0246 as missing-import', () => {
    const output = "C:\\proj\\Program.cs(3,7): error CS0246: The type or namespace name 'Newtonsoft' could not be found";
    expect(classifyError({ language: 'csharp', output, exitCode: 1 })).toBe('missing-import');
  });

  it('classifies a conversion error as type-mismatch', () => {
    const output = "C:\\proj\\Program.cs(8,20): error CS0029: Cannot implicitly convert type 'string' to 'int'";
    expect(classifyError({ language: 'cs', output, exitCode: 1 })).toBe('type-mismatch');
  });

  it('classifies an expected-token error as syntax', () => {
    const output = "C:\\proj\\Program.cs(10,1): error CS1002: ; expected";
    expect(classifyError({ language: 'cs', output, exitCode: 1 })).toBe('syntax');
  });

  it('buckets an unlisted CS code as syntax (lowest-confidence rule)', () => {
    const output = "C:\\proj\\Program.cs(5,5): error CS0815: Cannot assign lambda expression to an implicitly-typed variable";
    expect(classifyError({ language: 'cs', output, exitCode: 1 })).toBe('syntax');
  });
});

describe('classifyError - Dart', () => {
  it('classifies an expected-token compile error as syntax', () => {
    const output = "x.dart:5:3: Error: Expected ';' after this.\n  var a = 1\n          ^";
    expect(classifyError({ language: 'dart', output, exitCode: 254 })).toBe('syntax');
  });

  it('classifies a method-called-on-null as null-reference', () => {
    const output = [
      'Unhandled exception:',
      "NoSuchMethodError: The method 'toUpperCase' was called on null.",
      '#0      main (file:///C:/proj/x.dart:5:3)',
    ].join('\n');
    expect(classifyError({ language: 'dart', output, exitCode: 255 })).toBe('null-reference');
  });

  it('classifies an undefined member as undefined-reference', () => {
    const output = "lib/x.dart:10:5: Error: The method 'foo' isn't defined for the class 'X'.";
    expect(classifyError({ language: 'dart', output, exitCode: 254 })).toBe('undefined-reference');
  });

  it('classifies a subtype failure as type-mismatch', () => {
    const output = "Unhandled exception:\ntype 'String' is not a subtype of type 'int'";
    expect(classifyError({ language: 'dart', output, exitCode: 255 })).toBe('type-mismatch');
  });

  it('classifies a bare unhandled exception as runtime-exception', () => {
    const output = 'Unhandled exception:\nBad state: No element\n#0      main (file:///C:/proj/x.dart:2:3)';
    expect(classifyError({ language: 'dart', output, exitCode: 255 })).toBe('runtime-exception');
  });
});

describe('classifyError - Flutter', () => {
  it('reuses the Dart rules for a compile error', () => {
    const output = "lib/main.dart:10:5: Error: The method 'foo' isn't defined for the class 'X'.\nTarget kernel_snapshot failed";
    expect(classifyError({ language: 'flutter', output, exitCode: 1 })).toBe('undefined-reference');
  });

  it('classifies a framework assertion banner as runtime-exception', () => {
    const output = [
      '\u2550\u2550\u2550\u2550 Exception caught by widgets library \u2550\u2550\u2550\u2550',
      'The following assertion was thrown building MyWidget:',
      'A RenderFlex overflowed by 99 pixels on the right.',
    ].join('\n');
    expect(classifyError({ language: 'flutter', output, exitCode: 1 })).toBe('runtime-exception');
  });

  it('falls back to runtime-exception for a bare build failure summary', () => {
    const output = 'FAILURE: Build failed with an exception.\nGradle task assembleDebug failed';
    expect(classifyError({ language: 'flutter', output, exitCode: 1 })).toBe('runtime-exception');
  });
});

describe('classifyError - truncation', () => {
  it('still classifies when the signature precedes the truncation point', () => {
    const output = `${NODE_REFERENCE_ERROR}\n${'filler output line\n'.repeat(50)}`;
    expect(classifyError({ language: 'js', output, exitCode: 1 })).toBe('undefined-reference');
  });

  it('degrades to null, not a wrong answer, when the signature was truncated away', () => {
    const output = 'starting\nworking\nstill working\n';
    expect(classifyError({ language: 'js', output, exitCode: 1 })).toBeNull();
  });
});