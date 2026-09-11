// ===========================================================================
// Deterministic error classification for terminal run output.
//
// Consumes the { exitCode, output } half of runCapture.ts's RunCompletion
// payload (delivered to the renderer as `terminal:run-complete`) and buckets a
// failed run into one coarse category. Intended as the first input to the
// Adaptive Assistance Engine's error-pattern scenario (DECISIONS.md 2026-07-29
// full-scope item), which is NOT built here.
//
// Pure string/regex work: NO AI call, no model, no network, no I/O, no
// electron import. Fully deterministic and unit-testable standalone, same
// contract as translateImports.ts.
//
// FAIL-SAFE PRINCIPLE, inherited from translateImports.ts: when nothing matches
// confidently, return null rather than guess. A wrong category is worse than no
// category here — it would put actively misleading guidance in front of a
// student ("check your syntax" for a missing import), whereas null simply means
// the engine says nothing.
//
// CONFIDENCE WARNING: the patterns below are derived from general knowledge of
// how each runtime reports errors, NOT from captured output of the runtimes
// actually bundled in resources/runtimes/. Today's investigation confirmed this
// repo contains no .php/.cs/.dart fixtures to verify against. Every rule
// carries a `confidence` field; treat 'low' as provisional until checked
// against real output. Correcting a rule means editing one array entry.
// ===========================================================================

export type ErrorCategory =
  | 'syntax'
  | 'undefined-reference'
  | 'type-mismatch'
  | 'null-reference'
  | 'missing-import'
  | 'runtime-exception';

export type ErrorRule = {
  category: ErrorCategory;
  // Matched against the whole cleaned output, not line by line, so patterns
  // may span context. Use the `m` flag where anchoring to a line matters.
  pattern: RegExp;
  // Why this rule exists / what it is keyed on. Read this before editing.
  note: string;
  // 'high'   — signature is distinctive and stable across versions.
  // 'medium' — signature is right in shape but wording may vary by version.
  // 'low'    — provisional; the category is a judgement call, or the wording
  //            is a guess. These are the ones to verify first.
  confidence: 'high' | 'medium' | 'low';
};

export type ClassifyInput = {
  language: string;
  output: string;
  exitCode: number;
};

// IMPORTANT for anyone adding a rule: do NOT put the `g` flag on these
// patterns. A `g` regex carries `lastIndex` across `.test()` calls, so a
// module-level one would silently alternate between matching and not matching
// on repeated calls. (Same hazard documented in translateImports.ts.)

// --- PHP -------------------------------------------------------------------
const PHP_RULES: readonly ErrorRule[] = [
  {
    category: 'syntax',
    pattern: /(?:PHP )?Parse error/i,
    note: 'PHP prints "PHP Parse error:" on stderr and "Parse error:" on stdout.',
    confidence: 'high',
  },
  {
    category: 'missing-import',
    pattern: /Failed opening required|failed to open stream: No such file or directory/i,
    note: 'require/include of a path that does not exist.',
    confidence: 'medium',
  },
  {
    category: 'undefined-reference',
    pattern: /Call to undefined (?:function|method)/i,
    note: 'Distinctive PHP wording. Must precede the generic Fatal error rule.',
    confidence: 'high',
  },
  {
    category: 'null-reference',
    pattern: /Call to a member function \w+\(\) on null/i,
    note: 'PHP’s null-dereference shape; checked before undefined-reference wording.',
    confidence: 'high',
  },
  {
    category: 'type-mismatch',
    pattern: /Uncaught TypeError|must be of type \w+, \w+ given/i,
    note: 'PHP 8 typed-argument failures.',
    confidence: 'medium',
  },
  {
    category: 'undefined-reference',
    pattern: /Undefined (?:variable|constant|index|array key)|Class "[^"]*" not found/i,
    note: 'Undefined variable is only a WARNING in PHP 8 (exit 0), so it reaches '
      + 'here only when something else already failed the run.',
    confidence: 'medium',
  },
  {
    category: 'runtime-exception',
    pattern: /(?:PHP )?Fatal error|Uncaught \w*(?:Error|Exception)/i,
    note: 'Fallback for real PHP failures with no more specific signature.',
    confidence: 'high',
  },
];

// --- Node / JavaScript / TypeScript ----------------------------------------
const NODE_RULES: readonly ErrorRule[] = [
  {
    category: 'missing-import',
    pattern: /Cannot find module|ERR_MODULE_NOT_FOUND|Cannot find package/,
    note: 'Reported as "Error: Cannot find module", so must precede the generic '
      + 'Error: rule below or it would be swallowed as runtime-exception.',
    confidence: 'high',
  },
  {
    category: 'syntax',
    pattern: /\bSyntaxError\b|ERR_INVALID_TYPESCRIPT_SYNTAX/,
    note: 'ERR_INVALID_TYPESCRIPT_SYNTAX comes from Node’s native .ts type-stripping, '
      + 'which does NOT typecheck — so .ts runs never produce type diagnostics here.',
    confidence: 'high',
  },
  {
    category: 'undefined-reference',
    pattern: /\bReferenceError\b/,
    note: 'Covers "x is not defined".',
    confidence: 'high',
  },
  {
    category: 'null-reference',
    pattern: /TypeError:[^\n]*(?:Cannot read propert(?:y|ies)[^\n]*of (?:null|undefined)|of (?:null|undefined))/,
    note: 'Node reports null dereference as a TypeError, so this MUST precede the '
      + 'generic TypeError rule or every null deref would land in type-mismatch.',
    confidence: 'high',
  },
  {
    category: 'type-mismatch',
    pattern: /\bTypeError\b/,
    note: 'Remaining TypeErrors: not a function, not iterable, not a constructor.',
    confidence: 'high',
  },
  {
    category: 'runtime-exception',
    pattern: /\bRangeError\b|\bEvalError\b|\bURIError\b|\bAssertionError\b/,
    note: 'Real errors with no better bucket in the category set.',
    confidence: 'high',
  },
  {
    category: 'runtime-exception',
    pattern: /^\s*at\s+\S+[^\n]*:\d+:\d+\)?$/m,
    note: 'A V8 stack frame. Generic fallback — last, so specific names win.',
    confidence: 'medium',
  },
  {
    category: 'runtime-exception',
    pattern: /^[A-Z]\w*Error:|\bError:/m,
    note: 'Any remaining named Error. Broadest Node rule, deliberately last.',
    confidence: 'medium',
  },
];

// --- C# / .NET -------------------------------------------------------------
const CSHARP_RULES: readonly ErrorRule[] = [
  {
    category: 'null-reference',
    pattern: /NullReferenceException|Object reference not set to an instance/i,
    note: 'Checked first: it is a runtime exception but has a more specific bucket.',
    confidence: 'high',
  },
  {
    category: 'undefined-reference',
    pattern: /error CS0103|does not exist in the current context/,
    note: 'CS0103 = "The name ‘x’ does not exist in the current context".',
    confidence: 'high',
  },
  {
    category: 'undefined-reference',
    pattern: /error CS1061|does not contain a definition for/,
    note: 'CS1061 = member not found on a type. Added explicitly so it does not '
      + 'fall into the generic-CS bucket and get mislabelled as syntax.',
    confidence: 'high',
  },
  {
    category: 'missing-import',
    pattern: /error CS0246|The type or namespace name [^\n]* could not be found/,
    note: 'CS0246 is almost always a missing `using` directive or package reference.',
    confidence: 'medium',
  },
  {
    category: 'type-mismatch',
    pattern: /error CS0029|error CS1503|error CS0266|Cannot implicitly convert type|cannot convert from/,
    note: 'The common conversion/argument-type codes.',
    confidence: 'high',
  },
  {
    category: 'type-mismatch',
    pattern: /InvalidCastException/,
    note: 'Runtime cast failure.',
    confidence: 'high',
  },
  {
    category: 'syntax',
    pattern: /error CS1002|error CS1003|error CS1022|error CS1026|error CS1513|error CS\d+:[^\n]*expected/,
    note: 'The "; expected" / "} expected" family.',
    confidence: 'high',
  },
  {
    category: 'syntax',
    pattern: /error CS\d{4}/,
    note: 'LOWEST-CONFIDENCE RULE. Any compile error whose code is not listed above '
      + 'is bucketed as syntax because it is definitely a compile-time failure and '
      + '"syntax" is the only compile-time category available. Many CS codes are '
      + 'really type errors. Fix by adding the specific code to a rule above.',
    confidence: 'low',
  },
  {
    category: 'runtime-exception',
    pattern: /Unhandled exception|System\.\w*Exception/,
    note: 'Generic .NET runtime failure, after the specific exception types.',
    confidence: 'high',
  },
];

// --- Dart ------------------------------------------------------------------
const DART_RULES: readonly ErrorRule[] = [
  {
    category: 'null-reference',
    pattern: /Null check operator used on a null value|method '[^']*' was called on null|NoSuchMethodError:[^\n]*on null/,
    note: 'Dart surfaces null dereference as NoSuchMethodError on null, so this '
      + 'MUST precede the general NoSuchMethodError rule.',
    confidence: 'high',
  },
  {
    category: 'undefined-reference',
    pattern: /NoSuchMethodError/,
    note: 'Remaining NoSuchMethodError: a real method genuinely not found.',
    confidence: 'high',
  },
  {
    category: 'undefined-reference',
    pattern: /Undefined name|isn't defined for the (?:class|type)|The (?:method|getter|setter) '[^']*' isn't defined/,
    note: 'Dart front-end wording for unresolved identifiers and members.',
    confidence: 'medium',
  },
  {
    category: 'missing-import',
    pattern: /Target of URI doesn't exist|Couldn't resolve the package|Error when reading '[^']*': The system cannot find/,
    note: 'Unresolvable import URI or package.',
    confidence: 'medium',
  },
  {
    category: 'type-mismatch',
    pattern: /A value of type '[^']*' can't be assigned to|can't be assigned to (?:a variable of type|the parameter type)|type '[^']*' is not a subtype of type/,
    note: 'Covers both the compile-time assignment error and the runtime subtype error.',
    confidence: 'medium',
  },
  {
    category: 'syntax',
    pattern: /Error:[^\n]*[Ee]xpected/,
    note: 'e.g. "Error: Expected ‘;’ after this."',
    confidence: 'high',
  },
  {
    category: 'syntax',
    pattern: /^[^\s:]+\.dart:\d+:\d+: Error:/m,
    note: 'LOW CONFIDENCE. Any remaining Dart compile error located at file:line:col. '
      + 'Dart reports every front-end error as "Error:", so this bucket also catches '
      + 'type errors that the rules above did not name. Classified as syntax per the '
      + 'agreed spec, but it is the second rule to verify against real output.',
    confidence: 'low',
  },
  {
    category: 'runtime-exception',
    pattern: /^Unhandled exception:/m,
    note: 'Dart runtime failure banner, after the specific exception shapes.',
    confidence: 'high',
  },
];

// --- Flutter ---------------------------------------------------------------
// Framework-runtime shapes that have no Dart equivalent go FIRST; the shared
// Dart compile rules go next (a Flutter compile error IS a Dart compile error);
// the Gradle/tooling build banners go LAST, because they are only a summary —
// the real cause is a Dart error earlier in the same output.
const FLUTTER_RUNTIME_RULES: readonly ErrorRule[] = [
  {
    category: 'runtime-exception',
    pattern: /Exception caught by (?:widgets|rendering|animation|gesture|services) library|The following assertion was thrown|RenderFlex overflowed/,
    note: 'Flutter boxes framework errors in a banner rather than a bare stack trace.',
    confidence: 'medium',
  },
];

const FLUTTER_BUILD_FALLBACK_RULES: readonly ErrorRule[] = [
  {
    category: 'runtime-exception',
    pattern: /Target \w+ failed|FAILURE: Build failed with an exception|Gradle task \w+ failed/,
    note: 'LOW CONFIDENCE as a category. This is a build-failure SUMMARY, not a '
      + 'diagnosis — it only fires when no Dart rule matched, which usually means '
      + 'the real error was outside the captured window.',
    confidence: 'low',
  },
];

// EXTENSION POINT. Add a language key, or a rule to an existing language, and
// nothing else in this file changes.
export const ERROR_RULES: Readonly<Record<string, readonly ErrorRule[]>> = {
  php: PHP_RULES,
  node: NODE_RULES,
  csharp: CSHARP_RULES,
  dart: DART_RULES,
  flutter: [...FLUTTER_RUNTIME_RULES, ...DART_RULES, ...FLUTTER_BUILD_FALLBACK_RULES],
};

// Maps every spelling the app can produce onto an ERROR_RULES key. getRunConfig
// in main.ts sends 'php' | 'js' | 'ts' | 'cs' | 'dart' | 'flutter'; the AI
// panel's language list uses display names like 'C#' and 'JavaScript'.
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  php: 'php',
  js: 'node',
  jsx: 'node',
  javascript: 'node',
  ts: 'node',
  tsx: 'node',
  typescript: 'node',
  node: 'node',
  nodejs: 'node',
  cs: 'csharp',
  'c#': 'csharp',
  csharp: 'csharp',
  dotnet: 'csharp',
  dart: 'dart',
  flutter: 'flutter',
};

// Language-agnostic evidence that the output describes a REAL failure. Used
// only when no language rule matched, to decide between the generic
// runtime-exception bucket and null. Deliberately narrow: a non-zero exit code
// on its own is NOT evidence (a program may exit 3 as a normal result), and the
// word "error" appearing somewhere in ordinary output is not either.
const GENERIC_ERROR_EVIDENCE: readonly RegExp[] = [
  /^Unhandled exception/im,
  /\bUncaught\b/,
  /\bFatal error\b/i,
  /\bStack trace:/i,
  /\bTraceback\b/,
  /\bSegmentation fault\b/i,
  /\bcore dumped\b/i,
];

export function normalizeLanguage(language: string): string | null {
  if (!language) return null;
  return LANGUAGE_ALIASES[language.trim().toLowerCase()] ?? null;
}

/**
 * Classify one finished run.
 *
 * Returns null — meaning "say nothing" — when:
 *  - the run succeeded (exitCode 0), even if the output contains the word
 *    "error" (PHP warnings and linter chatter both exit 0);
 *  - the output is empty;
 *  - the language is unknown to the table;
 *  - no rule matched and there is no language-agnostic evidence of a failure.
 *
 * Truncated output is handled implicitly: the classifier only ever sees the
 * text it is given, so a signature appearing before the truncation point
 * classifies normally, and one lost to truncation degrades to null rather than
 * to a wrong answer.
 */
export function classifyError({ language, output, exitCode }: ClassifyInput): ErrorCategory | null {
  if (exitCode === 0) return null;
  if (!output || !output.trim()) return null;

  const key = normalizeLanguage(language);
  if (!key) return null;

  const rules = ERROR_RULES[key];
  if (!rules || rules.length === 0) return null;

  const matched = rules.find((rule) => rule.pattern.test(output));
  if (matched) return matched.category;

  if (GENERIC_ERROR_EVIDENCE.some((pattern) => pattern.test(output))) {
    return 'runtime-exception';
  }

  return null;
}