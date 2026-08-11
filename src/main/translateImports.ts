// ===========================================================================
// Deterministic post-generation import repair for TRANSLATE MODE ONLY.
//
// Closes the missing-import saga logged in DECISIONS.md (2026-08-08 onward).
// Short version of that history: translating JS `Math.min`/`Math.max` to Dart
// reliably produced `math.min`/`math.max` with no `import 'dart:math'`, so the
// output did not compile. Four prompt-wording attempts failed (soft mention ->
// directive -> directive + self-check -> re-test after the systemPrompt
// delivery fix). The 2026-08-10 diagnostic run settled the open question: the
// instruction IS delivered intact (`hasImportInstruction=true`, full text
// confirmed in the log), and the 6.7B model still drops the import. That makes
// it a model-COMPLIANCE limit, not a delivery or wiring bug -- and no amount of
// further wording will close it.
//
// So this module replaces model-steering with a mechanical guarantee. It is
// pure string/regex work: NO AI call, no network, no I/O, fully deterministic
// and unit-testable. Correct exactly as far as the table below is correct.
//
// SCOPE: Translate mode only. Code Inference has its own separate `sanitize()`
// and is deliberately untouched -- its output is a mid-file completion
// fragment, where prepending a top-of-file import would be actively wrong.
// ===========================================================================

export type ImportRule = {
  // Matches a usage in the OUTPUT that requires the import to exist.
  symbolPattern: RegExp;
  // The exact statement prepended when the symbol is used and the import is
  // absent.
  importStatement: string;
  // Matches an import that ALREADY satisfies `symbolPattern`. Deliberately a
  // separate pattern from `importStatement` rather than a substring check:
  // formatting varies (quote style, spacing), so this has to be looser than
  // the literal statement in some places and STRICTER in others -- see the
  // dart:math note below for a case where the strictness matters.
  presencePattern: RegExp;
};

// EXTENSION POINT. Add a language key, or a rule to an existing language, and
// nothing else in this file changes. Per the original scoping note in
// DECISIONS.md this does NOT need to be exhaustive on day one: cover what has
// actually been observed failing, and grow the table as new cases appear.
//
// Keys are lowercase; lookup normalizes, so the 'Dart' / 'C#' casing that
// AIPanel's LANGUAGES list sends still resolves.
//
// IMPORTANT for anyone adding a rule: do NOT put the `g` flag on these
// patterns. A `g` regex carries `lastIndex` across `.test()` calls, so a
// module-level one would silently alternate between matching and not matching
// on repeated calls.
export const IMPORT_RULES: Readonly<Record<string, readonly ImportRule[]>> = {
  dart: [
    {
      // Matches `math.min(`, `math . max (`, etc. Anchored on a word boundary
      // so `foo.math.min(` (a user object) does not trigger it.
      symbolPattern: /(^|[^\w.])math\s*\.\s*(min|max|sqrt|pow)\s*\(/,
      importStatement: "import 'dart:math' as math;",
      // Requires the `as math` PREFIX specifically, not merely any import of
      // dart:math. A bare `import 'dart:math';` does not define the `math`
      // prefix, so code calling `math.min` alongside it still does not compile
      // -- treating that as "already imported" would leave the exact breakage
      // this module exists to prevent. Consequence, accepted deliberately: if
      // the model emits a bare import AND uses the prefix, the output ends up
      // with both a bare and an aliased import of dart:math. That is legal
      // Dart (the same library may be imported twice under different
      // prefixes), it compiles, and compiling is the goal. Slightly untidy
      // beats broken.
      presencePattern: /^[ \t]*import\s+['"]dart:math['"]\s+as\s+math\s*;/m,
    },
  ],
};

// The opening fence of a markdown code block, if the response is fenced.
// Matched from the very start of the text only -- a fence appearing later is
// the start of a SECOND block (the duplicate-translation case documented in
// DECISIONS.md 2026-08-08), and the import belongs in the first one.
const LEADING_FENCE = /^[ \t]*```[^\n]*\n/;

/**
 * Prepend any import statements the translated code uses but does not declare.
 *
 * Returns the input unchanged (same string) when the language has no rules, no
 * rule's symbol appears, or every needed import is already present -- so it is
 * safe to call unconditionally on every Translate result.
 *
 * Idempotent: running it on its own output is a no-op, because the statement it
 * inserts satisfies the `presencePattern` that gates insertion.
 *
 * FENCE-AWARE, and that is load-bearing rather than a nicety. The model
 * frequently wraps output in a ```dart fence, and the renderer's
 * `extractTranslatedCode()` (EditorLayout.tsx) keeps only what is INSIDE the
 * first fenced block when saving to a file. An import prepended above the fence
 * would therefore be stripped back out at save time -- the fix would appear to
 * work in the panel and silently fail in the saved .dart file, which is the
 * single most confusing way this could break. So when the text opens with a
 * fence, the import goes inside it.
 *
 * KNOWN HEURISTIC LIMITS (both fail SAFE, hence accepted):
 * - No string/comment awareness. `// see math.min` in a comment can trigger an
 *   import that is not strictly needed. In Dart an unused import is a lint
 *   warning, not a compile error -- so the worst case is cosmetic, whereas the
 *   bug being fixed is a hard compile failure.
 * - Conversely, a commented-out `// import 'dart:math' as math;` reads as
 *   present and suppresses insertion.
 * - Dart requires `library` / `part of` directives to precede imports. Not
 *   handled, because translated snippets do not carry them.
 */
export const ensureRequiredImports = (code: string, language: string): string => {
  const rules = IMPORT_RULES[language.trim().toLowerCase()];
  if (!rules || rules.length === 0 || !code) return code;

  const missing: string[] = [];
  rules.forEach((rule) => {
    if (!rule.symbolPattern.test(code)) return;
    if (rule.presencePattern.test(code)) return;
    // Two rules may legitimately resolve to the same import statement.
    if (missing.includes(rule.importStatement)) return;
    missing.push(rule.importStatement);
  });

  if (missing.length === 0) return code;

  const block = `${missing.join('\n')}\n\n`;
  const fence = LEADING_FENCE.exec(code);

  if (fence) {
    const fenceLine = fence[0];
    return `${fenceLine}${block}${code.slice(fenceLine.length)}`;
  }

  return `${block}${code}`;
};
