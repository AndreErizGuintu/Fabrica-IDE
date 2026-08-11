/* eslint no-console: off */
import { generate } from './llm';
import { incrementAiCallCount } from './stats';
import { onAiCall } from './adaptiveEngine';
import config from './codeInference.config.json';

// ---------------------------------------------------------------------------
// Code Inference - confirmation-based boilerplate completion.
//
// FLOW (pivoted 2026-08-07, see DECISIONS.md):
//   1. The renderer notices a trigger-eligible buffer and asks
//      checkCodeInferenceTrigger() -- a pure string match, no model.
//   2. A small inline prompt offers to complete the file. Nothing has been
//      generated yet, and nothing will be unless the student says yes.
//   3. On explicit accept the renderer calls requestCodeInference(), which
//      runs the model once and returns finished text.
//   4. The renderer inserts that text at the cursor as a normal edit.
//
// The previous version registered a Monaco InlineCompletionsProvider and drew
// ghost text automatically as the student typed. That is gone. Everything it
// needed to survive racing against live typing -- keystroke-cancellation via
// AbortController, a dedupe memo, a post-generation cooldown -- is gone with
// it, because generation now only ever starts after typing has stopped and the
// student has explicitly asked.
//
// COUNTS AS AN AI CALL. This is a REVERSAL of the original opportunistic
// design, which deliberately bypassed every counter. Reaching the model now
// requires the student to click "Complete it", exactly like Scenario 3's hint
// accept, so it is real student-initiated help-seeking and belongs in
// aiCallCount / the Adaptive Engine's signals. See the call site below.
// ---------------------------------------------------------------------------

// ===========================================================================
// TEMPORARY DIAGNOSTIC LOGGING - kept through the pivot so the new
// confirmation flow can be traced on its first real run. REMOVE, or gate
// behind a real debug setting, before defense. Flip this one flag to silence
// the whole file.
// ===========================================================================
const CI_DEBUG = true;

const ciLog = (...args: unknown[]) => {
  if (CI_DEBUG) console.log('[CodeInference:core]', ...args);
};

// Keeps long code out of the console while still showing enough to tell which
// request a line belongs to.
const preview = (text: string, max = 80) =>
  JSON.stringify(text.length > max ? `${text.slice(0, max)}...` : text);

export type CodeInferenceRequest = {
  prefix: string;
  suffix: string;
  language: string;
};

type LanguageConfig = { patterns: string[] };

const LANGUAGES: Record<string, LanguageConfig> = config.languages;

// The renderer needs the cheap pre-filter limits so it can bail before ever
// hitting IPC, plus the debounce it uses to decide WHEN to offer. Patterns stay
// in main -- one source of truth for what actually counts as a trigger.
//
// NOTE on debounceMs: it no longer protects the model from anything. It used to
// be Monaco's inline-completion debounce, i.e. the thing standing between a
// keystroke and a generation. Now it only delays SHOWING THE OFFER so the
// prompt doesn't flicker in and out mid-keystroke. Purely cosmetic pacing.
export function getCodeInferenceConfig() {
  return {
    debounceMs: config.debounceMs,
    maxTriggerChars: config.maxTriggerChars,
    maxTriggerLines: config.maxTriggerLines,
  };
}

// --- Trigger pre-filter -----------------------------------------------------
// Cheap pattern match, NOT free-form AI inference. Fires only on fresh /
// near-empty files: this is scaffolding assistance at the start of a file, not
// a mid-project interruption.
//
// UNCHANGED BY THE PIVOT. This logic was never the problem -- it is the one
// part of the original build that tested clean and behaved correctly, so it is
// carried over verbatim.
// Split out from shouldTrigger() purely so the diagnostic logging can report
// WHICH condition rejected a request instead of just "false".
function triggerDecision(
  prefix: string,
  suffix: string,
  language: string,
): { ok: boolean; reason: string } {
  const languageConfig = LANGUAGES[language];
  if (!languageConfig) {
    return { ok: false, reason: `language "${language}" is not in the config` };
  }
  if (languageConfig.patterns.length === 0) {
    return {
      ok: false,
      reason: `language "${language}" has no configured patterns (wired but inert)`,
    };
  }

  const whole = prefix + suffix;
  // Something must already be typed -- we never scaffold a totally blank file,
  // and every configured pattern requires a real token to be present anyway.
  if (whole.trim().length === 0) {
    return { ok: false, reason: 'buffer is empty/whitespace only' };
  }
  if (whole.length > config.maxTriggerChars) {
    return {
      ok: false,
      reason: `buffer is ${whole.length} chars, over maxTriggerChars=${config.maxTriggerChars}`,
    };
  }
  const lineCount = whole.split('\n').length;
  if (lineCount > config.maxTriggerLines) {
    return {
      ok: false,
      reason: `buffer is ${lineCount} lines, over maxTriggerLines=${config.maxTriggerLines}`,
    };
  }

  const lines = whole.split('\n');
  const scanned = lines
    .slice(0, config.patternScanLines)
    .join('\n')
    .toLowerCase();

  const matched = languageConfig.patterns.find((pattern) =>
    scanned.includes(pattern),
  );
  if (!matched) {
    return {
      ok: false,
      reason: `none of ${JSON.stringify(languageConfig.patterns)} found in the first ${config.patternScanLines} lines (${preview(scanned)})`,
    };
  }

  // --- "near-empty" means near-empty, not merely short ---------------------
  // ADDED 2026-08-07 for Andre's repro: a PHP file with four lines of REAL code
  // ('<?php', a comment, an echo, '?>') still offered a completion with the
  // cursor on line 5.
  //
  // The char/line caps above were not broken and were not mis-ordered -- they
  // run BEFORE the pattern scan, exactly as intended. They were simply
  // calibrated to the wrong question. 400 chars / 6 lines describes a SHORT
  // FILE; a 4-line file with working code in it sits comfortably inside both
  // and passed legitimately. The spec's actual requirement is that there be
  // nothing in the file yet BUT the opening pattern, which no amount of
  // retuning those two numbers can express -- a 6-line cap that rejects this
  // repro would also reject '<?php' on its own followed by five blank lines.
  //
  // So this counts CONTENT rather than size: non-blank lines other than the one
  // the pattern matched on. The opener itself is excluded (it is the trigger,
  // not content), and a small allowance is kept because a student mid-scaffold
  // ('<!doctype html>' then '<html>') is still scaffolding, not a real file.
  // The allowance is a config value for the same reason the patterns are --
  // DECISIONS.md 2026-08-06 records that the adviser's official wording is
  // still pending, so "how empty is near-empty" must stay a config edit.
  const openerLineIndex = lines.findIndex((line) =>
    line.toLowerCase().includes(matched),
  );
  // -1 only when the pattern matched ACROSS a newline in the joined scan window
  // (e.g. 'void\nmain'). Nothing is excluded then, which counts the opener as
  // content and biases toward rejecting -- the safe direction for a guard whose
  // failure mode is firing on files it shouldn't.
  const contentLinesBeyondPattern = lines.filter(
    (line, index) => index !== openerLineIndex && line.trim().length > 0,
  ).length;

  if (contentLinesBeyondPattern > config.maxContentLinesBeyondPattern) {
    return {
      ok: false,
      reason:
        `file has ${contentLinesBeyondPattern} content line(s) beyond the "${matched}" opener, ` +
        `over maxContentLinesBeyondPattern=${config.maxContentLinesBeyondPattern} ` +
        '(not a near-empty file)',
    };
  }

  return { ok: true, reason: `matched pattern "${matched}"` };
}

function shouldTrigger(
  prefix: string,
  suffix: string,
  language: string,
): boolean {
  return triggerDecision(prefix, suffix, language).ok;
}

// Asked on a debounce while the student types, so it must stay cheap: string
// matching only, and it never touches the model, the lock, or any counter.
export function checkCodeInferenceTrigger(payload: CodeInferenceRequest): {
  triggered: boolean;
} {
  const decision = triggerDecision(
    payload.prefix,
    payload.suffix,
    payload.language,
  );
  ciLog(
    `checkTrigger language=${payload.language} -> ${decision.ok ? 'OFFER' : 'no offer'}`,
    `(${decision.reason})`,
  );
  return { triggered: decision.ok };
}

// --- Prompt construction ----------------------------------------------------
// UNCHANGED BY THE PIVOT. The FIM-style prompt shape was sound; what changed is
// only what causes it to be sent.
const SYSTEM_PROMPT =
  'You complete standard boilerplate in a code editor. Complete the standard boilerplate for this ' +
  'pattern only, nothing more. Output ONLY the raw code that belongs at the cursor. No explanation, ' +
  'no commentary, no markdown fencing, no backticks. Do not repeat code that already appears before ' +
  'or after the cursor.';

// Fill-in-the-middle shape: the code BEFORE the cursor and the code AFTER the
// cursor are sent as separate labelled sections, not as one whole-file blob.
//
// NOTE: this is FIM-STYLE PROMPTING, not the model's native FIM control tokens
// (<|fim_begin|> / <|fim_hole|> / <|fim_end|>). Native infill would need
// node-llama-cpp's LlamaCompletion.generateInfillCompletion() instead of the
// LlamaChatSession path generate() uses, and DECISIONS.md [2026-07-30] records
// that this GGUF's FIM control tokens have broken token_type metadata that
// llama.cpp only auto-corrects at load. Native FIM is logged as a v2 candidate.
//
// '###' section headers are used because DeepSeek Coder's own chat template is
// built on '### Instruction:' / '### Response:', so the model already reads
// them as structure. Backticks are avoided entirely so nothing in the prompt
// suggests that fenced output is wanted.
function buildFimPrompt(
  prefix: string,
  suffix: string,
  language: string,
): string {
  const boundedPrefix = prefix.slice(-config.maxPrefixChars);
  const boundedSuffix = suffix.slice(0, config.maxSuffixChars);

  return [
    '### Language:',
    language,
    '',
    '### Code before the cursor:',
    boundedPrefix,
    '',
    '### Code after the cursor:',
    boundedSuffix.trim() ? boundedSuffix : '(nothing after the cursor)',
    '',
    '### Task:',
    'Write only the code that goes at the cursor, continuing directly from the end of "Code before ' +
      'the cursor". Complete the standard boilerplate for this file type and then stop.',
  ].join('\n');
}

// Stop generation on a closing structural marker that is ALREADY present in the
// suffix -- if the model starts emitting the '}' / '</html>' / ');' that the
// file already has after the cursor, it has run past the hole and is about to
// duplicate existing code.
//
// '\n\n' is deliberately NOT a stop trigger here even though the spec stops on
// a double newline: a completion can legitimately OPEN with a blank line (e.g.
// 'using System;' -> '\n\nnamespace App'), and a raw trigger would cut it to
// nothing. That cut is applied in post-processing instead, where leading
// whitespace can be skipped first. See cutAtBlankLine().
const CLOSING_MARKER_PATTERN = /^(\}|\)|\]|\);|<\/[a-zA-Z][\w-]*>)/;

function buildStopTriggers(suffix: string): string[] {
  const firstMeaningfulLine = suffix
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  if (firstMeaningfulLine && CLOSING_MARKER_PATTERN.test(firstMeaningfulLine)) {
    return [firstMeaningfulLine];
  }
  return [];
}

// --- Completion post-processing --------------------------------------------
// DELIBERATELY KEPT THROUGH THE PIVOT, including the echo/overlap strippers.
// The pivot brief expected these to become unnecessary on the grounds that
// nothing echoes a live-typed prefix once generation starts after typing has
// stopped. That reasoning does not hold: the duplication bug of 2026-08-06 was
// never a typing race. The model restates (and case-normalizes) the prefix it
// was handed in the FIM prompt, so a student who typed '<!Doctype' still gets
// '<!DOCTYPE html>...' back, and inserting that at the cursor still produces
// '<!Doctype<!DOCTYPE html>'. Inserting real text has exactly the same exposure
// ghost text had. Removing these would reintroduce a confirmed, reproduced bug.
// See DECISIONS.md 2026-08-07 for the full reasoning.
function stripFences(text: string): string {
  if (!text.includes('```')) return text;
  const lines = text.split('\n');
  const opening = lines.findIndex((line) => line.trim().startsWith('```'));
  if (opening === -1) return text;
  const rest = lines.slice(opening + 1);
  const closing = rest.findIndex((line) => line.trim().startsWith('```'));
  return (closing === -1 ? rest : rest.slice(0, closing)).join('\n');
}

// --- Structural completeness -----------------------------------------------
// Supports cutAtBlankLine() below. Answers one question: if the completion
// stopped HERE, would it leave something open?
//
// HTML void elements never close, so counting them as open would make every
// document containing a <meta> look permanently unfinished.
const VOID_HTML_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// Matches '<tag ...>' and '</tag>' only. '<!doctype html>' and '<!-- ... -->'
// both fail the [a-zA-Z] after '<' and are skipped, which is correct: neither
// opens anything that needs closing.
const HTML_TAG_PATTERN = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g;

function netOpenHtmlTags(text: string): number {
  let depth = 0;
  for (const match of text.matchAll(HTML_TAG_PATTERN)) {
    const [, slash, rawName, attrs] = match;
    const name = rawName.toLowerCase();
    if (VOID_HTML_TAGS.has(name)) continue;
    if (attrs.trim().endsWith('/')) continue; // <div/>, <Foo />
    depth += slash === '/' ? -1 : 1;
  }
  return depth;
}

// Net brace/bracket/paren depth, skipping string literals and comments so that
// a '}' inside a string doesn't read as a real close.
//
// Two deliberate omissions:
// - '#' is NOT treated as a line comment. It is one in PHP, but it is also a
//   CSS id selector, and swallowing '#id {' would break the brace count on the
//   language whose braces matter most for CSS scaffolding later.
// - A lone apostrophe in HTML prose ('<title>Andre's Page</title>') does open a
//   phantom string here. Harmless by construction: markup completeness is
//   decided by netOpenHtmlTags(), and HTML boilerplate has no braces to
//   miscount. Keeping "'" as a delimiter matters for Dart/JS, where it is a
//   real string quote.
function netOpenBraces(text: string): number {
  let depth = 0;
  let inString: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') depth += 1;
    else if (ch === '}' || ch === ']' || ch === ')') depth -= 1;
  }

  return depth;
}

// Only ">0" counts as incomplete. A NEGATIVE depth means the completion closed
// more than it opened -- i.e. it closed something the prefix left open, which is
// exactly what a fill-in-the-middle completion is supposed to do, and is
// finished rather than unfinished.
function hasUnclosedStructure(text: string): boolean {
  return netOpenHtmlTags(text) > 0 || netOpenBraces(text) > 0;
}

// Stop at a double newline, but skip LEADING whitespace first so a completion
// that legitimately begins with a blank line isn't truncated to nothing.
//
// FIXED 2026-08-07 -- Andre's repro: '<!doctype html>' completions came back
// missing '</body>' and '</html>'. Raising maxTokens 48 -> 128 did not change
// it, because the token budget was never the cause. Standard HTML boilerplate
// carries a BLANK LINE inside '<body></body>' (the space where page content
// goes), and the old one-line implementation cut at the first '\n\n' it found
// unconditionally -- so it truncated at '<body>' every single time, at any token
// budget. That is why the bump appeared to do nothing: the model's output was
// most likely complete and this function was throwing the tail away.
//
// A blank line is only a reliable "the model has finished and started rambling"
// signal when what precedes it is STRUCTURALLY COMPLETE. When tags or braces
// are still open, the blank line is part of the code, not the end of it -- so
// keep scanning for a later blank line that IS a clean stopping point, and if
// none exists, keep the whole completion.
//
// Bias is deliberately toward NOT cutting: over-cutting silently corrupts the
// file (the reported bug), whereas under-cutting leaves trailing text that
// stripSuffixOverlap(), the length gate, and PROSE_PATTERN all still get a shot
// at. Structure is measured on the completion ALONE for the same reason -- if
// the completion opens '<html>' that the suffix already closes, that reads as
// "unclosed" here, we decline to cut, and stripSuffixOverlap() removes the
// duplicate afterwards.
function cutAtBlankLine(text: string): string {
  const leadingWhitespace = text.length - text.trimStart().length;
  let searchFrom = leadingWhitespace;

  while (searchFrom <= text.length) {
    const blankLineAt = text.indexOf('\n\n', searchFrom);
    if (blankLineAt === -1) return text;

    const candidate = text.slice(0, blankLineAt);
    if (!hasUnclosedStructure(candidate)) return candidate;

    // +1 rather than +2 so a run of three or more newlines is still examined at
    // every offset; it also guarantees forward progress, so this terminates.
    searchFrom = blankLineAt + 1;
  }

  return text;
}

// The model very often restates the code it was given before continuing, and it
// NORMALIZES as it restates: a student who typed '<!Doctype' gets a completion
// opening with the canonical '<!DOCTYPE'. Detected case-INSENSITIVELY, stripped
// case-PRESERVINGLY, so only the genuinely new tail is inserted and the
// student's own casing is left alone.
//
// Under the old ghost-text renderer that case-preservation was FORCED: Monaco's
// computeGhostText() bails out entirely the moment a suggestion would replace
// characters already in the buffer, so a range extending back over '<!Doctype'
// to swap in '<!DOCTYPE' would have rendered nothing at all. That constraint is
// now gone -- a plain editor edit can replace a range -- so canonicalizing the
// student's casing has become POSSIBLE. It is deliberately not done here:
// silently rewriting characters the student typed is a bigger behavioral
// change than this pivot is scoped for. Logged as a follow-up option instead.
// (Harmless in practice for the doctype case specifically: HTML doctypes are
// case-insensitive, so '<!Doctype html>' is valid.)
const MIN_PREFIX_ECHO = 2;

function prefixEchoLength(completion: string, prefix: string): number {
  const maxOverlap = Math.min(completion.length, prefix.length, 200);
  // Longest match wins, so a short coincidental overlap is only ever used when
  // there is no real echo. MIN_PREFIX_ECHO stops a single shared character -- a
  // genuine continuation that happens to begin with the letter the prefix ends
  // on -- from being mistaken for an echo and silently eaten.
  for (let k = maxOverlap; k >= MIN_PREFIX_ECHO; k -= 1) {
    if (
      prefix.slice(-k).toLowerCase() === completion.slice(0, k).toLowerCase()
    ) {
      return k;
    }
  }
  return 0;
}

function stripPrefixEcho(completion: string, prefix: string): string {
  return completion.slice(prefixEchoLength(completion, prefix));
}

// Trim any suffix-overlapping text before inserting: if the model regenerated
// code that already sits right after the cursor, cut the duplicate.
function stripSuffixOverlap(completion: string, suffix: string): string {
  if (!suffix.trim()) return completion;

  // Compared case-insensitively for the same reason as prefixEchoLength above:
  // the model normalizes case when it restates existing code, so a
  // case-sensitive match silently misses the duplicate it is meant to catch.
  const lowerCompletion = completion.toLowerCase();
  const lowerSuffix = suffix.toLowerCase();

  // (a) the completion's tail is the suffix's head
  const maxOverlap = Math.min(completion.length, suffix.length, 400);
  for (let k = maxOverlap; k >= 3; k -= 1) {
    if (lowerCompletion.endsWith(lowerSuffix.slice(0, k))) {
      return completion.slice(0, completion.length - k);
    }
  }

  // (b) the suffix's first real line reappears somewhere inside the completion
  const firstMeaningfulLine = suffix
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  if (firstMeaningfulLine && firstMeaningfulLine.length >= 3) {
    const at = lowerCompletion.indexOf(firstMeaningfulLine.toLowerCase());
    if (at !== -1) return completion.slice(0, at);
  }

  return completion;
}

// A 6.7B model asked for code will still occasionally answer in prose. Pasting
// an English sentence into the student's file is worse than doing nothing.
const PROSE_PATTERN =
  /^(sure|here|this|that|the following|certainly|of course|okay|ok|you can|i )\b/i;

function sanitize(raw: string, prefix: string, suffix: string): string | null {
  let completion = stripFences(raw);
  completion = stripPrefixEcho(completion, prefix);
  completion = cutAtBlankLine(completion);
  completion = stripSuffixOverlap(completion, suffix);
  completion = completion.replace(/\s+$/, '');

  if (!completion.trim()) return null;
  if (completion.length > config.maxCompletionChars) return null;
  if (PROSE_PATTERN.test(completion.trim())) return null;

  return completion;
}

// --- Request lifecycle ------------------------------------------------------
// No AbortController, no activeController, no cancel() export. Cancellation
// existed to kill a generation the student had never asked for the moment they
// resumed typing. Now they asked for it, so typing through it is not a reason
// to throw the work away -- and there is no auto-fired generation left to
// cancel in the first place.
export type CodeInferenceResult = {
  suggestion: string | null;
};

export async function requestCodeInference(
  payload: CodeInferenceRequest,
): Promise<CodeInferenceResult> {
  const { prefix, suffix, language } = payload;

  ciLog(
    `requestCodeInference() ENTRY (explicit accept) language=${language}`,
    `prefixLen=${prefix.length} suffixLen=${suffix.length}`,
    `prefixTail=${preview(prefix.slice(-40))}`,
  );

  // Re-checked in main rather than trusted from the renderer: the renderer's
  // offer was based on a trigger check that is now a few hundred ms old, and
  // main owns the patterns.
  const decision = triggerDecision(prefix, suffix, language);
  ciLog(
    `shouldTrigger -> ${decision.ok ? 'PASS' : 'REJECT'} (${decision.reason})`,
  );
  if (!decision.ok) {
    ciLog('EXIT: no generation attempted');
    return { suggestion: null };
  }

  const stopTriggers = buildStopTriggers(suffix);
  const prompt = buildFimPrompt(prefix, suffix, language);
  ciLog(
    'calling generate()',
    `maxTokens=${config.maxTokens} contextSize=${config.contextSize}`,
    `stopTriggers=${JSON.stringify(stopTriggers)}`,
  );
  ciLog(`--- prompt sent to the model ---\n${prompt}\n--- end prompt ---`);
  const startedAt = Date.now();

  let raw: string;
  try {
    raw = await generate(prompt, SYSTEM_PROMPT, undefined, {
      maxTokens: config.maxTokens,
      contextSize: config.contextSize,
      // REVERSED FROM THE ORIGINAL DESIGN: was 'opportunistic'. That priority
      // exists for generations the student never requested -- it fails fast
      // with ModelBusyError rather than queueing, and any explicit caller may
      // cancel it mid-flight. Neither is acceptable now: the student clicked a
      // button and is watching a spinner, so this call has to behave like
      // Ask/Plan/Hint and wait its turn instead of vanishing because the AI
      // panel happened to be busy. 'explicit' is also the default, so this is
      // now the same path every other caller takes.
      priority: 'explicit',
      stopTriggers,
    });
    ciLog(
      `generate() RESOLVED in ${Date.now() - startedAt}ms`,
      // 1000, not 200: at 200 the log truncates before the end of a standard
      // HTML boilerplate, so it could not answer the one question it was being
      // read for -- whether '</html>' actually arrived from the model, or the
      // sanitizer ate it. Raised 2026-08-07 while diagnosing the truncated
      // boilerplate. Goes away with the rest of CI_DEBUG before defense.
      `rawLen=${raw.length} raw=${preview(raw, 1000)}`,
    );
  } catch (err) {
    ciLog(
      `generate() REJECTED after ${Date.now() - startedAt}ms`,
      `errorName=${(err as Error)?.name} message=${(err as Error)?.message}`,
    );
    // ModelBusyError / GenerationAbortedError are no longer reachable here:
    // both are 'opportunistic'-only outcomes, and this caller is 'explicit',
    // so it waits for the lock and nothing cancels it. Anything landing here
    // is a genuine failure, and the renderer surfaces it as a short message
    // rather than silently doing nothing -- the student asked and deserves an
    // answer either way.
    console.warn('[codeInference] generation failed.', err);
    return { suggestion: null };
  }

  // COUNTS AS AN AI CALL -- deliberate reversal of the original design.
  // Placed here, after a generation that actually ran, rather than after
  // sanitize(): the student explicitly asked for help and the model was
  // genuinely spent on it, so it is real help-seeking whether or not the raw
  // output survived post-processing. Failures above don't count, because
  // nothing ran. incrementAiCallCount() also calls recordActivity() internally,
  // so the idle timer resets too -- correct now, since the student just acted.
  // Mirrors requestHint() in adaptiveEngine.ts, the other accept-gated call.
  incrementAiCallCount();
  onAiCall();

  const sanitized = sanitize(raw, prefix, suffix);
  ciLog(
    `sanitize() -> ${sanitized === null ? 'NULL (rejected)' : `${sanitized.length} chars ${preview(sanitized, 200)}`}`,
  );
  ciLog('EXIT: returning to IPC handler');

  return { suggestion: sanitized };
}

// --- Test-only exports ------------------------------------------------------
// Additive, zero production effect. Lets scripts/test-code-inference.mjs
// exercise the REAL trigger filter and the REAL sanitizer with no model and no
// Electron runtime -- same pattern and naming as adaptiveEngine.ts's
// __setClockForTesting()/__forceIdleExpiredForTesting().
export const __shouldTriggerForTesting = shouldTrigger;
export const __sanitizeForTesting = sanitize;
export const __buildStopTriggersForTesting = buildStopTriggers;
// Exposed 2026-08-07 so the blank-line truncation bug can be asserted directly
// on the function that caused it, not only through the full sanitize() pipeline
// where four other passes could mask or mimic the same symptom.
export const __cutAtBlankLineForTesting = cutAtBlankLine;
export const __triggerDecisionForTesting = triggerDecision;
export const __buildFimPromptForTesting = buildFimPrompt;
