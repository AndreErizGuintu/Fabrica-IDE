import { ensureRequiredImports } from '../main/translateImports';

// ===========================================================================
// Regression tests for the deterministic import repair (DECISIONS.md, the
// missing-import saga). The first test IS the confirmed repro: the JS
// Math.min/Math.max -> Dart case that survived four prompt-wording attempts.
//
// Safe to import from src/main here: translateImports.ts is deliberately pure
// and imports nothing, so it pulls in no `electron` and needs no mocking.
// ===========================================================================

describe('ensureRequiredImports - Dart dart:math', () => {
  it('prepends the import for the confirmed repro (math.min/math.max, no import)', () => {
    const translated = [
      'int maxArea(List<int> height) {',
      '  int left = 0;',
      '  int right = height.length - 1;',
      '  int best = 0;',
      '  while (left < right) {',
      '    int h = math.min(height[left], height[right]);',
      '    best = math.max(best, h * (right - left));',
      '    if (height[left] < height[right]) {',
      '      left++;',
      '    } else {',
      '      right--;',
      '    }',
      '  }',
      '  return best;',
      '}',
    ].join('\n');

    const result = ensureRequiredImports(translated, 'Dart');

    expect(result.startsWith("import 'dart:math' as math;\n\n")).toBe(true);
    expect(result).toContain('int maxArea(List<int> height) {');
    // Exactly one import added, not one per matched symbol.
    expect(result.match(/import 'dart:math' as math;/g)).toHaveLength(1);
  });

  it('does NOT add a duplicate when the aliased import is already present', () => {
    const translated = [
      "import 'dart:math' as math;",
      '',
      'void main() {',
      '  print(math.min(1, 2));',
      '}',
    ].join('\n');

    const result = ensureRequiredImports(translated, 'Dart');

    expect(result).toBe(translated);
    expect(result.match(/import 'dart:math' as math;/g)).toHaveLength(1);
  });

  it('is idempotent - running it on its own output changes nothing', () => {
    const once = ensureRequiredImports('void main() { print(math.sqrt(9)); }', 'Dart');
    const twice = ensureRequiredImports(once, 'Dart');

    expect(twice).toBe(once);
    expect(twice.match(/import 'dart:math' as math;/g)).toHaveLength(1);
  });

  it('covers sqrt and pow, not just min/max', () => {
    expect(ensureRequiredImports('var x = math.sqrt(2);', 'Dart')).toContain(
      "import 'dart:math' as math;",
    );
    expect(ensureRequiredImports('var x = math.pow(2, 8);', 'Dart')).toContain(
      "import 'dart:math' as math;",
    );
  });

  it('leaves code alone when no dart:math symbol is used', () => {
    const translated = 'void main() {\n  print("hello");\n}';
    expect(ensureRequiredImports(translated, 'Dart')).toBe(translated);
  });

  it('does not fire on a lookalike member access such as foo.math.min(', () => {
    const translated = 'var x = helper.math.min(1, 2);';
    expect(ensureRequiredImports(translated, 'Dart')).toBe(translated);
  });
});

describe('ensureRequiredImports - fenced output', () => {
  // Load-bearing: the renderer's extractTranslatedCode() keeps only what is
  // INSIDE the first fenced block when saving to a file, so an import placed
  // above the fence would be stripped back out at save time.
  it('inserts the import INSIDE a leading code fence, not above it', () => {
    const fenced = ['```dart', 'void main() {', '  print(math.max(1, 2));', '}', '```'].join('\n');

    const result = ensureRequiredImports(fenced, 'Dart');

    expect(result.startsWith("```dart\nimport 'dart:math' as math;\n\n")).toBe(true);
    // The fence itself must still be the very first thing in the string.
    expect(result.indexOf('```')).toBe(0);
  });

  it('still detects an import that is already inside the fence', () => {
    const fenced = [
      '```dart',
      "import 'dart:math' as math;",
      '',
      'void main() {',
      '  print(math.max(1, 2));',
      '}',
      '```',
    ].join('\n');

    expect(ensureRequiredImports(fenced, 'Dart')).toBe(fenced);
  });
});

describe('ensureRequiredImports - languages without rules', () => {
  it('returns JavaScript untouched even when it uses math.min', () => {
    const js = 'const x = math.min(1, 2);';
    expect(ensureRequiredImports(js, 'JavaScript')).toBe(js);
  });

  it.each(['C#', 'PHP', 'Python', 'Java', 'TypeScript'])(
    'returns %s untouched (no rules defined yet)',
    (language) => {
      const code = 'var x = math.min(1, 2);';
      expect(ensureRequiredImports(code, language)).toBe(code);
    },
  );

  it('normalizes language casing and surrounding whitespace', () => {
    const translated = 'var x = math.min(1, 2);';
    expect(ensureRequiredImports(translated, '  dart  ')).toContain(
      "import 'dart:math' as math;",
    );
    expect(ensureRequiredImports(translated, 'DART')).toContain("import 'dart:math' as math;");
  });

  it('handles empty output without throwing', () => {
    expect(ensureRequiredImports('', 'Dart')).toBe('');
  });
});

describe('ensureRequiredImports - bare dart:math import', () => {
  // A bare `import 'dart:math';` does not define the `math` prefix, so code
  // calling math.min alongside it still does not compile. Adding the aliased
  // import is intentional: importing one library twice under different
  // prefixes is legal Dart, and compiling beats tidy.
  it('adds the aliased import when only a non-aliased one is present', () => {
    const translated = ["import 'dart:math';", '', 'var x = math.min(1, 2);'].join('\n');

    const result = ensureRequiredImports(translated, 'Dart');

    expect(result.startsWith("import 'dart:math' as math;")).toBe(true);
    expect(result).toContain("import 'dart:math';");
  });
});
