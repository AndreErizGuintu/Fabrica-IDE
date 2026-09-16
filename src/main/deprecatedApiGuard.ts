// ===========================================================================
// Per-language deprecated-API guardrails for AI code generation.
//
// Two independent layers, both keyed off the SAME per-call language string:
//   1. A short prompt-side guard block, appended to the system prompt ONLY
//      for the language actually targeted by that call -- not all four every
//      time. Every extra system-prompt token costs time-to-first-token on the
//      6.7B model, so this stays language-scoped by construction.
//   2. A deterministic, post-generation regex substitution pass -- pure
//      string work, no AI call, no network, no I/O. Runs unconditionally on
//      the finalized output regardless of whether the prompt guard worked,
//      same "mechanical guarantee over prompt wording" reasoning as
//      translateImports.ts's ensureRequiredImports().
//
// SCOPE, deliberately narrower than "every deprecated API in the bullet
// list": only mappings that are a true 1:1 textual substitution are in
// DEPRECATED_FIX_RULES. A few of the requested patterns (PHP each() /
// create_function(), JS escape()/unescape(), C# WebClient / BinaryFormatter)
// do NOT have a safe drop-in replacement -- the real fix requires restructuring
// (a loop, a closure, an async call shape), not renaming a token. Auto-rewriting
// those by regex risks producing code that looks fixed but does not compile,
// which is the opposite of the error-reduction goal this exists for. Those
// stay prompt-guard-only; see the per-language comments below for exactly
// which patterns that applies to and why.
//
// SCOPE, callers: only wired into call sites where the target language is
// known with certainty for that specific call -- Translate mode (explicit
// dropdown) and Code Inference (Monaco's own model.getLanguageId()). Ask,
// Plan, and Explain are deliberately NOT wired in: none of the three passes a
// language at all (Ask/Plan send one opaque prompt string built client-side;
// Explain is description-only and is not code generation in the first place),
// so there is no safe way to pick a table -- guessing wrong is actively
// dangerous here (JS's `var` is deprecated; Dart's `var` is normal, idiomatic
// Dart, and rewriting it would corrupt otherwise-correct output).
// ===========================================================================

export type GuardedLanguage = 'php' | 'javascript' | 'csharp' | 'dart';

// Accepts both naming conventions actually seen in this codebase: Translate
// mode sends AIPanel's display strings ('PHP', 'JavaScript', 'C#', 'Dart'),
// Code Inference sends Monaco's lowercase language ids ('php', 'javascript',
// 'csharp', 'dart'). Lookup normalizes so both resolve to the same table.
function normalizeLanguage(language: string): GuardedLanguage | null {
  const key = language.trim().toLowerCase();
  if (key === 'php') return 'php';
  if (key === 'javascript' || key === 'js') return 'javascript';
  if (key === 'c#' || key === 'csharp' || key === 'cs') return 'csharp';
  if (key === 'dart') return 'dart';
  return null;
}

// --- Layer 1: prompt-side guard blocks --------------------------------------

const GUARD_BLOCKS: Readonly<Record<GuardedLanguage, string>> = {
  php:
    'Deprecated-API guardrail: never use mysql_* functions (mysql_connect, mysql_query, etc.) -- ' +
    'use mysqli_* or PDO instead. Never use each() or create_function() -- both were removed in PHP 8.',
  javascript:
    'Deprecated-API guardrail: never declare variables with var -- use let or const. ' +
    'Never use new Buffer() -- use Buffer.from() or Buffer.alloc(). Never use escape() or unescape().',
  csharp:
    'Deprecated-API guardrail: never use WebClient -- use HttpClient. Never use BinaryFormatter. ' +
    'Target modern C# syntax unless told otherwise.',
  dart:
    'Deprecated-API guardrail: target Flutter 3.x with Material 3. TextTheme must use displayLarge/' +
    'Medium/Small, headlineLarge/Medium/Small, titleLarge/Medium/Small, bodyLarge/Medium/Small, ' +
    'labelLarge/Medium/Small -- never headline1-6, subtitle1-2, bodyText1-2, caption, button, or ' +
    'overline. Never use withOpacity -- use withValues.',
};

export function getDeprecatedApiGuardBlock(language: string): string | null {
  const key = normalizeLanguage(language);
  return key ? GUARD_BLOCKS[key] : null;
}

/**
 * Appends the guard block for `language` to `systemPrompt`, or returns
 * `systemPrompt` unchanged when the language isn't one of the four guarded
 * ones. Safe to call unconditionally on every call site that has a language.
 */
export function appendDeprecatedApiGuard(systemPrompt: string, language: string): string {
  const guard = getDeprecatedApiGuardBlock(language);
  return guard ? `${systemPrompt}\n\n${guard}` : systemPrompt;
}

// --- Layer 2: deterministic post-generation fixups --------------------------

type FixRule = {
  // MUST carry the `g` flag -- these are all consumed via String.replace(),
  // which resets lastIndex to 0 at the start of each call for a global regex,
  // so reusing a module-level RegExp across calls is safe here (unlike the
  // .test()/.exec() case translateImports.ts's IMPORT_RULES comment warns
  // about -- this file never calls .test()/.exec() on a `g` pattern).
  pattern: RegExp;
  replacement: string;
  note: string;
};

export const DEPRECATED_FIX_RULES: Readonly<Record<GuardedLanguage, readonly FixRule[]>> = {
  php: [
    {
      // `(?<!\$)` excludes a PHP variable NAMED like a call, e.g. $mysql_conn
      // used as a variable-variable -- vanishingly rare, but cheap to exclude.
      // Requiring the trailing `(` anchors this to an actual function call.
      // mysqli's function names mirror mysql's 1:1 by suffix (mysql_connect ->
      // mysqli_connect, mysql_query -> mysqli_query, ...), so a plain prefix
      // swap produces real, correct mysqli_* identifiers for the whole family.
      pattern: /(?<!\$)\bmysql_(\w+)\s*\(/g,
      replacement: 'mysqli_$1(',
      note: 'mysql_* -> mysqli_* (prefix swap; connection-argument differences are not addressed)',
    },
    // each() and create_function() are deliberately NOT here. Neither has a
    // 1:1 token replacement: each() requires restructuring into a foreach
    // loop, create_function() into a real closure. Prompt-guard-only.
  ],
  javascript: [
    {
      // `\bvar\b` already cannot match inside `variable`/`covariant` etc. --
      // `\b` requires a word/non-word transition, and "var" is followed by
      // another word character in both. No string/comment awareness (matches
      // `var` inside a string or `//` comment too); accepted for the same
      // reason translateImports.ts accepts its comment-blind heuristic: worst
      // case is a cosmetic no-op rewrite inside text, not broken code.
      pattern: /\bvar\b/g,
      replacement: 'let',
      note: 'var -> let',
    },
    {
      // Numeric-literal-argument case FIRST and more specific: `new Buffer(10)`
      // means "allocate 10 zeroed bytes", which is Buffer.alloc(10) --
      // Buffer.from(10) is a different (and in modern Node, throwing) call.
      pattern: /\bnew\s+Buffer\s*\(\s*(\d+)\s*\)/g,
      replacement: 'Buffer.alloc($1)',
      note: 'new Buffer(<number>) -> Buffer.alloc(<number>)',
    },
    {
      // Runs second, so it only catches what the numeric rule above did not
      // already convert. Covers the string/array/buffer-argument constructor
      // shape, which Buffer.from() is the direct replacement for.
      pattern: /\bnew\s+Buffer\s*\(/g,
      replacement: 'Buffer.from(',
      note: 'new Buffer(<non-numeric>) -> Buffer.from(<non-numeric>)',
    },
    // escape()/unescape() are deliberately NOT here. The correct replacement
    // is ambiguous (encodeURIComponent vs encodeURI) and depends on what the
    // original call was actually encoding. Prompt-guard-only.
  ],
  csharp: [
    // No entries. WebClient -> HttpClient is not a rename: HttpClient's API
    // shape differs (async Task<string> GetStringAsync(...) vs sync
    // DownloadString(...)), so a text substitution would produce code that
    // fails to compile rather than code that works. Same reasoning for
    // BinaryFormatter, which has no drop-in class at all. Prompt-guard-only.
  ],
  dart: [
    // Flutter's own official Material 3 TextTheme migration mapping -- a
    // genuine 1:1 rename, safe as pure text substitution. Anchored on a
    // leading `.` so a match requires property-access position (e.g.
    // `textTheme.headline1`), not a coincidental identifier elsewhere.
    { pattern: /\.headline1\b/g, replacement: '.displayLarge', note: 'headline1 -> displayLarge' },
    { pattern: /\.headline2\b/g, replacement: '.displayMedium', note: 'headline2 -> displayMedium' },
    { pattern: /\.headline3\b/g, replacement: '.displaySmall', note: 'headline3 -> displaySmall' },
    { pattern: /\.headline4\b/g, replacement: '.headlineLarge', note: 'headline4 -> headlineLarge' },
    { pattern: /\.headline5\b/g, replacement: '.headlineMedium', note: 'headline5 -> headlineMedium' },
    { pattern: /\.headline6\b/g, replacement: '.headlineSmall', note: 'headline6 -> headlineSmall' },
    { pattern: /\.subtitle1\b/g, replacement: '.titleMedium', note: 'subtitle1 -> titleMedium' },
    { pattern: /\.subtitle2\b/g, replacement: '.titleSmall', note: 'subtitle2 -> titleSmall' },
    { pattern: /\.bodyText1\b/g, replacement: '.bodyLarge', note: 'bodyText1 -> bodyLarge' },
    { pattern: /\.bodyText2\b/g, replacement: '.bodyMedium', note: 'bodyText2 -> bodyMedium' },
    { pattern: /\.caption\b/g, replacement: '.bodySmall', note: 'caption -> bodySmall' },
    { pattern: /\.button\b/g, replacement: '.labelLarge', note: 'button -> labelLarge' },
    { pattern: /\.overline\b/g, replacement: '.labelSmall', note: 'overline -> labelSmall' },
    {
      // Same scale (0.0-1.0) on both sides, so this is a clean rewrite as long
      // as the argument has no nested parens -- `[^()]*` deliberately does not
      // handle `withOpacity(computeOpacity())`; that rarer case is left alone
      // rather than risk mismatched parens.
      pattern: /\.withOpacity\(([^()]*)\)/g,
      replacement: '.withValues(alpha: $1)',
      note: 'withOpacity(x) -> withValues(alpha: x)',
    },
  ],
};

/**
 * Runs the deterministic fix table for `language` over `code` and returns the
 * result. Returns `code` unchanged when the language isn't guarded or has no
 * matching rules -- safe to call unconditionally on every generation result,
 * regardless of whether the prompt guard fired.
 */
export function applyDeprecatedApiFixes(code: string, language: string): string {
  const key = normalizeLanguage(language);
  if (!key || !code) return code;

  const rules = DEPRECATED_FIX_RULES[key];
  let result = code;
  for (const rule of rules) {
    result = result.replace(rule.pattern, rule.replacement);
  }
  return result;
}
