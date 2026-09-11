/* eslint no-console: off */
import { generate } from './llm';
import { incrementAiCallCount } from './stats';
import type { ErrorCategory } from './errorClassifier';
import config from './adaptiveEngine.config.json';

export type Scenario = 1 | 2 | 3 | 4 | 5;

export type Suggestion = {
  scenario: Scenario;
  message: string;
  offersHint: boolean;
  autoDismissSeconds: number;
  // Scenario 5 only. `errorCategory` is the repeated category that triggered
  // it; `offersCorrection` is the escalation flag — see ESCALATION below.
  errorCategory?: ErrorCategory;
  offersCorrection?: boolean;
};

const COPY: Record<Scenario, string> = {
  1: "Jumping straight to the AI after a short pause — happy to help, just say the word if you want a hand.",
  2: "Lots of AI questions and no runs yet — want to try running your code to see where things stand?",
  3: 'Looks like you might be stuck — want a hint?',
  4: "You've been leaning on the AI assistant a lot compared to running your own code — no pressure, just flagging it in case it's useful to know.",
  // Deliberately does NOT name the category inline. Keeping one static string
  // per scenario preserves the hand-duplicated EXPECTED_COPY convention in
  // scripts/test-adaptive-engine.mjs; the category travels on the suggestion's
  // `errorCategory` field for the renderer to surface.
  // Count-agnostic on purpose: this one string is reused at every occurrence
  // from the threshold onward, so it must read correctly on the 2nd, 3rd and
  // 10th alike. The earlier "twice in a row" wording went stale the moment the
  // escalation fired. Which stage the student is in is signalled by the ACTION
  // offered (hint vs correction), never by this text.
  5: "You've hit this kind of error again — want a hand working out what's going on?",
};

// Human-facing labels for the classifier's categories, used when building the
// hint/correction prompts. Kept here rather than in errorClassifier.ts so that
// module stays a pure classifier with no presentation concerns.
const CATEGORY_LABELS: Record<ErrorCategory, string> = {
  syntax: 'a syntax error',
  'undefined-reference': 'an undefined variable or function',
  'type-mismatch': 'a type mismatch',
  'null-reference': 'a null/undefined value being used',
  'missing-import': 'a missing import or module',
  'runtime-exception': 'an uncaught runtime exception',
};

const IDLE_MS = () => config.idleThresholdSeconds * 1000;
const SCENARIO1_WINDOW_MS = () => config.scenario1_idleThenCall.callWithinSecondsAfterIdle * 1000;
const SCENARIO2_WINDOW_MS = () => config.scenario2_rapidCalls.windowMinutes * 60_000;
const COOLDOWN_MS = () => config.suggestion.cooldownMinutesAfterDismiss * 60_000;
const ERROR_REPEAT_THRESHOLD = () => config.scenario5_errorPattern.repeatThreshold;

// Scenario 5 runs on its OWN cooldown clock, deliberately much shorter than the
// shared one. It is the only scenario backed by direct evidence that the student
// is stuck (the same classified error, twice), so making it wait out the full
// anti-nagging window meant a student iterating on one error got told once and
// then nothing for ten minutes — the exact moment the help is most wanted.
//
// Both clocks are set on EVERY dismissal, so dismissing a Scenario 5 toast still
// silences Scenarios 1-4 for the full shared window. Only Scenario 5 recovers early.
const SCENARIO5_COOLDOWN_MS = () => config.scenario5_errorPattern.cooldownMinutesAfterDismiss * 60_000;

// Cap on how much of the failing run's output is retained for the correction
// prompt. The model's hint context is only 1024 tokens, so anything longer is
// wasted and risks crowding out the student's own code.
const MAX_RETAINED_ERROR_OUTPUT = 2000;

type EngineState = {
  idleTimer: ReturnType<typeof setTimeout> | null;
  idleExpiredAt: number | null;
  consecutiveIdleResets: number;
  callTimestamps: number[];
  runTimestamps: number[];
  sessionCallCount: number;
  sessionRunCount: number;
  // Scenarios 1-4.
  cooldownUntil: number;
  // Scenario 5 only — see SCENARIO5_COOLDOWN_MS.
  scenario5CooldownUntil: number;
  suggestionActive: Suggestion | null;
  // Scenario 5. Per-session, in-memory only, never persisted — same lifecycle
  // as sessionCallCount/sessionRunCount, cleared by startEngineSession().
  errorCategoryCounts: Partial<Record<ErrorCategory, number>>;
  // The category whose repeat is waiting to be evaluated. Cleared when
  // Scenario 5 fires, so a later evaluate() from an unrelated call/run can't
  // re-fire on a stale error (same reasoning as scenario 3's streak reset).
  pendingErrorCategory: ErrorCategory | null;
  // Context for requestCorrection(), so the renderer doesn't have to carry the
  // failing output back across IPC just to ask for a fix.
  lastErrorCategory: ErrorCategory | null;
  lastErrorOutput: string | null;
  // Debug-only — not read by any trigger logic, purely for getDebugState().
  lastFiredSuggestion: { scenario: Scenario; firedAt: number } | null;
  // Debug-only — cumulative per-scenario fire tally for this session, for the
  // Stats Debug doughnut. Not read by any trigger logic.
  scenarioFireCounts: Record<Scenario, number>;
};

const state: EngineState = {
  idleTimer: null,
  idleExpiredAt: null,
  consecutiveIdleResets: 0,
  callTimestamps: [],
  runTimestamps: [],
  sessionCallCount: 0,
  sessionRunCount: 0,
  cooldownUntil: 0,
  scenario5CooldownUntil: 0,
  suggestionActive: null,
  errorCategoryCounts: {},
  pendingErrorCategory: null,
  lastErrorCategory: null,
  lastErrorOutput: null,
  lastFiredSuggestion: null,
  scenarioFireCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
};

let pushSuggestion: ((suggestion: Suggestion) => void) | null = null;

export function setSuggestionSink(sink: (suggestion: Suggestion) => void) {
  pushSuggestion = sink;
}

// --- Test-only clock/timer injection ---------------------------------------
// Additive only, no effect on production behavior unless explicitly invoked
// by a test harness. Lets scripts/test-adaptive-engine.mjs exercise the real
// scheduleIdleTimer()/onIdleExpired()/evaluate() code paths under a
// deterministic fake clock instead of waiting on real wall-clock time.
let clockOverride: (() => number) | null = null;
let timerSchedulingDisabled = false;

function now(): number {
  return clockOverride ? clockOverride() : Date.now();
}

export function __setClockForTesting(fn: (() => number) | null) {
  clockOverride = fn;
}

export function __setTimerSchedulingDisabledForTesting(disabled: boolean) {
  timerSchedulingDisabled = disabled;
}

export function __forceIdleExpiredForTesting() {
  onIdleExpired();
}

function pruneOlderThan(timestamps: number[], now: number, windowMs: number) {
  while (timestamps.length && now - timestamps[0] > windowMs) {
    timestamps.shift();
  }
}

function tryFire(scenario: Scenario, errorCategory?: ErrorCategory) {
  if (state.suggestionActive) return;
  const firedAt = now();
  // Scenario 5 answers to its own, shorter clock; everything else to the shared one.
  const cooldownUntil = scenario === 5 ? state.scenario5CooldownUntil : state.cooldownUntil;
  if (firedAt < cooldownUntil) return;

  // ESCALATION (the adaptive switch). At exactly repeatThreshold the student
  // gets a guiding question — the same hint path Scenario 3 uses. If they hit
  // the SAME category again after that, asking another question has already
  // demonstrably not unblocked them, so the offer becomes a direct correction.
  const repeatCount = errorCategory ? state.errorCategoryCounts[errorCategory] ?? 0 : 0;
  const escalateToCorrection = scenario === 5 && repeatCount > ERROR_REPEAT_THRESHOLD();

  const suggestion: Suggestion = {
    scenario,
    message: COPY[scenario],
    offersHint: scenario === 3 || (scenario === 5 && !escalateToCorrection),
    autoDismissSeconds: config.suggestion.autoDismissSeconds,
    ...(errorCategory ? { errorCategory } : {}),
    ...(escalateToCorrection ? { offersCorrection: true } : {}),
  };
  state.suggestionActive = suggestion;
  state.lastFiredSuggestion = { scenario, firedAt };
  state.scenarioFireCounts[scenario] += 1;
  pushSuggestion?.(suggestion);
}

// Priority order when multiple scenarios are simultaneously true:
// 5 > 2 > 3 > 1 > 4.
//
// Scenario 5 goes first because it is the only trigger backed by DIRECT
// evidence of a concrete, identified problem — the student ran their code and
// hit the same classified error twice — rather than by a behavioural proxy
// (timing gaps, call/run ratios) that merely correlates with being stuck. Most
// specific wins, the same ordering principle errorClassifier.ts uses.
//
// It is also near-mutually-exclusive with Scenario 2 in practice: 2 requires
// zero runs in its window, and a run error necessarily put a run in that
// window, so the two rarely contend at all.
function evaluate() {
  const nowMs = now();

  if (state.pendingErrorCategory) {
    const category = state.pendingErrorCategory;
    const count = state.errorCategoryCounts[category] ?? 0;
    if (count >= ERROR_REPEAT_THRESHOLD()) {
      // Cleared BEFORE firing, matching scenario 3's streak reset: the trigger
      // is consumed whether or not the fire is suppressed by cooldown or an
      // already-active suggestion, so it can't re-fire later out of context.
      state.pendingErrorCategory = null;
      tryFire(5, category);
      return;
    }
    // Below threshold — a first occurrence is normal and must not interrupt.
    state.pendingErrorCategory = null;
  }

  pruneOlderThan(state.callTimestamps, nowMs, SCENARIO2_WINDOW_MS());
  pruneOlderThan(state.runTimestamps, nowMs, SCENARIO2_WINDOW_MS());
  const scenario2 =
    state.callTimestamps.length >= config.scenario2_rapidCalls.callCountThreshold &&
    state.runTimestamps.length === 0;
  if (scenario2) {
    tryFire(2);
    return;
  }

  const scenario3 = state.consecutiveIdleResets >= config.scenario3_silentStruggle.consecutiveIdleResetsThreshold;
  if (scenario3) {
    // Reset the streak on fire, not just on the next call/run. Without this,
    // once the counter crosses the threshold once it stays parked at/above
    // it (a call/run resets it to 0, but a single idle-resume afterward
    // re-crosses the threshold immediately instead of needing a fresh
    // streak) — looks like "the intervening call didn't matter" when really
    // the streak was never cleared at the moment it actually fired.
    state.consecutiveIdleResets = 0;
    tryFire(3);
    return;
  }

  // Scenario 1 is edge-triggered from onAiCall() directly (see below), not
  // re-checked here, since it depends on the exact idle->call timing gap.

  const scenario4 =
    state.sessionRunCount >= config.scenario4_sessionRatio.minimumRunsBeforeEvaluating &&
    state.sessionCallCount / state.sessionRunCount > config.scenario4_sessionRatio.callToRunRatioThreshold;
  if (scenario4) {
    tryFire(4);
  }
}

function scheduleIdleTimer() {
  if (state.idleTimer) clearTimeout(state.idleTimer);
  state.idleTimer = null;
  // Disabled under test so a real setTimeout can't fire mid-test and
  // corrupt state while the fake clock is being driven independently —
  // tests trigger idle expiry explicitly via __forceIdleExpiredForTesting().
  if (timerSchedulingDisabled) return;
  state.idleTimer = setTimeout(onIdleExpired, IDLE_MS());
}

function onIdleExpired() {
  state.idleExpiredAt = now();
  state.idleTimer = null;
}

export function onEditorActivity() {
  if (state.idleExpiredAt !== null) {
    // Idle had already crossed the threshold and the student resumed on
    // their own (typing), without calling AI or running code in between.
    state.consecutiveIdleResets += 1;
    state.idleExpiredAt = null;
    evaluate();
  }
  scheduleIdleTimer();
}

export function onAiCall() {
  const callAt = now();

  if (
    state.idleExpiredAt !== null &&
    callAt - state.idleExpiredAt <= SCENARIO1_WINDOW_MS()
  ) {
    tryFire(1);
  }

  // Reset on any AI-call activity — this is what distinguishes "actually
  // stuck" (Scenario 3) from "actively using the AI, with idle gaps between
  // attempts."
  state.idleExpiredAt = null;
  state.consecutiveIdleResets = 0;
  state.callTimestamps.push(callAt);
  state.sessionCallCount += 1;
  scheduleIdleTimer();
  evaluate();
}

export function onRun() {
  const runAt = now();
  // Reset on any run activity too — running code, same as calling the AI,
  // is evidence the student isn't silently stuck.
  state.idleExpiredAt = null;
  state.consecutiveIdleResets = 0;
  state.runTimestamps.push(runAt);
  state.sessionRunCount += 1;
  scheduleIdleTimer();
  evaluate();
}

/**
 * Scenario 5's input hook. Called from main.ts's terminal:run-complete site
 * ONLY when classifyError() returned a category — never for a clean run and
 * never for an unclassifiable failure.
 *
 * Deliberately separate from and additional to onRun(): onRun() still fires
 * unconditionally for every run exactly as before, so Scenarios 2 and 4 see an
 * unchanged run signal. This hook adds information, it does not reinterpret
 * the existing one. It also does NOT touch the idle timer or the
 * consecutiveIdleResets streak — onRun() already did that for this same run,
 * and doing it twice would distort Scenarios 1 and 3.
 */
export function onRunError(category: ErrorCategory, output?: string) {
  state.errorCategoryCounts[category] = (state.errorCategoryCounts[category] ?? 0) + 1;
  state.pendingErrorCategory = category;
  state.lastErrorCategory = category;
  state.lastErrorOutput = output ? output.slice(-MAX_RETAINED_ERROR_OUTPUT) : null;
  evaluate();
}

export function startEngineSession() {
  state.idleExpiredAt = null;
  state.consecutiveIdleResets = 0;
  state.callTimestamps = [];
  state.runTimestamps = [];
  state.sessionCallCount = 0;
  state.sessionRunCount = 0;
  state.cooldownUntil = 0;
  state.scenario5CooldownUntil = 0;
  state.suggestionActive = null;
  state.errorCategoryCounts = {};
  state.pendingErrorCategory = null;
  state.lastErrorCategory = null;
  state.lastErrorOutput = null;
  state.lastFiredSuggestion = null;
  state.scenarioFireCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  scheduleIdleTimer();
}

export function stopEngineSession() {
  if (state.idleTimer) clearTimeout(state.idleTimer);
  state.idleTimer = null;
}

// Called when a suggestion is dismissed in the renderer, whether by explicit
// close or auto-expiry — both suppress all further suggestions for the
// configured cooldown window.
export function dismissSuggestion() {
  state.suggestionActive = null;
  // Both clocks are armed on every dismissal, whichever scenario was showing.
  // That keeps the anti-nagging guarantee for Scenarios 1-4 intact — dismissing
  // a Scenario 5 toast does not let them fire early — while Scenario 5 alone
  // recovers on its shorter window.
  const dismissedAt = now();
  state.cooldownUntil = dismissedAt + COOLDOWN_MS();
  state.scenario5CooldownUntil = dismissedAt + SCENARIO5_COOLDOWN_MS();
}

export type AdaptiveDebugState = {
  now: number;
  scenario1: {
    lastIdleExpiredAt: number | null;
    windowOpen: boolean;
    windowRemainingSeconds: number | null;
    conditionTrue: boolean;
  };
  scenario2: {
    callCountInWindow: number;
    runCountInWindow: number;
    threshold: number;
    windowRemainingSeconds: number | null;
    conditionTrue: boolean;
  };
  scenario3: {
    consecutiveIdleResets: number;
    threshold: number;
    conditionTrue: boolean;
  };
  scenario4: {
    sessionCallCount: number;
    sessionRunCount: number;
    ratio: number | null;
    threshold: number;
    minimumRunsBeforeEvaluating: number;
    minimumRunsMet: boolean;
    conditionTrue: boolean;
  };
  scenario5: {
    errorCategoryCounts: Partial<Record<ErrorCategory, number>>;
    lastErrorCategory: ErrorCategory | null;
    repeatThreshold: number;
    conditionTrue: boolean;
    wouldEscalateToCorrection: boolean;
    // Scenario 5's OWN cooldown, not the shared one reported by `cooldown`.
    cooldownActive: boolean;
    cooldownRemainingSeconds: number | null;
    cooldownMinutes: number;
  };
  lastSuggestionFired: { scenario: Scenario; firedAt: number } | null;
  cooldown: {
    active: boolean;
    remainingSeconds: number | null;
  };
  suggestionActive: Suggestion | null;
  // Which scenario would actually win priority (2 > 3 > 1 > 4) among those
  // whose raw condition is currently true, ignoring cooldown/active-suggestion
  // suppression — lets the debug panel show "condition true, but scenario N
  // has priority" vs. "condition not met" without guessing.
  priorityWinner: Scenario | null;
  scenarioFireCounts: Record<Scenario, number>;
};

// Read-only snapshot for the debug panel — must never mutate engine state
// or call tryFire/evaluate, so pulling it up cannot change trigger behavior.
export function getDebugState(): AdaptiveDebugState {
  const nowMs = now();

  const callsInWindow = state.callTimestamps.filter((t) => nowMs - t <= SCENARIO2_WINDOW_MS());
  const runsInWindow = state.runTimestamps.filter((t) => nowMs - t <= SCENARIO2_WINDOW_MS());
  const oldestCallInWindow = callsInWindow.length > 0 ? callsInWindow[0] : null;

  const scenario1WindowOpen =
    state.idleExpiredAt !== null && nowMs - state.idleExpiredAt <= SCENARIO1_WINDOW_MS();

  const scenario2ConditionTrue =
    callsInWindow.length >= config.scenario2_rapidCalls.callCountThreshold && runsInWindow.length === 0;

  const scenario3ConditionTrue =
    state.consecutiveIdleResets >= config.scenario3_silentStruggle.consecutiveIdleResetsThreshold;

  const minimumRunsMet = state.sessionRunCount >= config.scenario4_sessionRatio.minimumRunsBeforeEvaluating;
  const ratio = state.sessionRunCount > 0 ? state.sessionCallCount / state.sessionRunCount : null;
  const scenario4ConditionTrue =
    minimumRunsMet && ratio !== null && ratio > config.scenario4_sessionRatio.callToRunRatioThreshold;

  // Keyed on lastErrorCategory, NOT pendingErrorCategory.
  //
  // pendingErrorCategory is consumed synchronously inside evaluate(), which
  // runs on the same tick as onRunError() — so by the time the debug panel's
  // 1s poll arrives it is ALWAYS null, and a panel keyed on it could never
  // report true. That made the panel read "repeat error: no" even with
  // counts.syntax=3, which looks exactly like a broken threshold check.
  // lastErrorCategory persists, so this answers the question the panel is
  // actually asking: is the most recent error category at or over threshold?
  const lastCategory = state.lastErrorCategory;
  const lastCategoryCount = lastCategory ? state.errorCategoryCounts[lastCategory] ?? 0 : 0;
  const scenario5ConditionTrue = lastCategory !== null && lastCategoryCount >= ERROR_REPEAT_THRESHOLD();
  const scenario5WouldEscalate = lastCategory !== null && lastCategoryCount > ERROR_REPEAT_THRESHOLD();

  let priorityWinner: Scenario | null = null;
  if (scenario5ConditionTrue) priorityWinner = 5;
  else if (scenario2ConditionTrue) priorityWinner = 2;
  else if (scenario3ConditionTrue) priorityWinner = 3;
  else if (scenario1WindowOpen) priorityWinner = 1;
  else if (scenario4ConditionTrue) priorityWinner = 4;

  const cooldownActive = nowMs < state.cooldownUntil;
  const scenario5CooldownActive = nowMs < state.scenario5CooldownUntil;

  return {
    now: nowMs,
    scenario1: {
      lastIdleExpiredAt: state.idleExpiredAt,
      windowOpen: scenario1WindowOpen,
      windowRemainingSeconds:
        scenario1WindowOpen && state.idleExpiredAt !== null
          ? Math.max(0, (SCENARIO1_WINDOW_MS() - (nowMs - state.idleExpiredAt)) / 1000)
          : null,
      conditionTrue: scenario1WindowOpen,
    },
    scenario2: {
      callCountInWindow: callsInWindow.length,
      runCountInWindow: runsInWindow.length,
      threshold: config.scenario2_rapidCalls.callCountThreshold,
      windowRemainingSeconds:
        oldestCallInWindow !== null
          ? Math.max(0, (SCENARIO2_WINDOW_MS() - (nowMs - oldestCallInWindow)) / 1000)
          : null,
      conditionTrue: scenario2ConditionTrue,
    },
    scenario3: {
      consecutiveIdleResets: state.consecutiveIdleResets,
      threshold: config.scenario3_silentStruggle.consecutiveIdleResetsThreshold,
      conditionTrue: scenario3ConditionTrue,
    },
    scenario4: {
      sessionCallCount: state.sessionCallCount,
      sessionRunCount: state.sessionRunCount,
      ratio,
      threshold: config.scenario4_sessionRatio.callToRunRatioThreshold,
      minimumRunsBeforeEvaluating: config.scenario4_sessionRatio.minimumRunsBeforeEvaluating,
      minimumRunsMet,
      conditionTrue: scenario4ConditionTrue,
    },
    scenario5: {
      errorCategoryCounts: { ...state.errorCategoryCounts },
      lastErrorCategory: state.lastErrorCategory,
      repeatThreshold: ERROR_REPEAT_THRESHOLD(),
      conditionTrue: scenario5ConditionTrue,
      wouldEscalateToCorrection: scenario5WouldEscalate,
      cooldownActive: scenario5CooldownActive,
      cooldownRemainingSeconds: scenario5CooldownActive
        ? Math.max(0, (state.scenario5CooldownUntil - nowMs) / 1000)
        : null,
      cooldownMinutes: config.scenario5_errorPattern.cooldownMinutesAfterDismiss,
    },
    lastSuggestionFired: state.lastFiredSuggestion,
    cooldown: {
      active: cooldownActive,
      remainingSeconds: cooldownActive ? Math.max(0, (state.cooldownUntil - nowMs) / 1000) : null,
    },
    suggestionActive: state.suggestionActive,
    priorityWinner,
    scenarioFireCounts: { ...state.scenarioFireCounts },
  };
}

const HINT_MAX_TOKENS = 80;
const HINT_CONTEXT_SIZE = 1024;
const HINT_CODE_BLOCK_PATTERN = /```/;
const GENERIC_HINT_FALLBACK =
  "Try breaking the problem into smaller steps and checking one piece at a time — that's usually where the next clue shows up.";

const HINT_SYSTEM_PROMPT =
  'You are a supportive coding tutor. The student appears stuck. Give a SHORT nudge (1-3 sentences) ' +
  'pointing them toward the next thing to check or think about. Never provide a full solution, a complete ' +
  'function, or a fenced code block. Ask a guiding question or name a concept/area to look at, nothing more.';

// The OTHER half of the adaptive switch. Where HINT_SYSTEM_PROMPT forbids
// solutions outright, this one requires a specific fix — reached only after a
// guiding question has already failed to unblock the student on the same error
// category (see ESCALATION in tryFire).
// Backstop on length, in case the prompt alone doesn't hold the model to the
// format. Sized to fit the target shape with room to spare: a fix line (~15
// tokens) + a 3-4 line fenced code block (~60) + a why clause (~20) lands near
// 95. 150 leaves headroom so a slightly longer code block finishes cleanly —
// deliberately NOT tighter, because truncating mid-code-block hands the student
// broken code, which is worse than a sentence too many.
//
// Also shrinks the per-call allocation slightly: this reservation is part of
// the CORRECTION_CONTEXT_SIZE budget below, which is VRAM-constrained.
const CORRECTION_MAX_TOKENS = 150;

// CONSTRAINED BY VRAM, NOT BY PROMPT SIZE. Do not raise this without measuring
// on the lowest-end target GPU.
//
// At 2048 this threw "A context size of 2048 is too large for the available
// VRAM" on a 6GB card with the model's 33 layers already resident, and every
// correction silently degraded to CORRECTION_FALLBACK. The hint path has always
// used 1024 on the same hardware without trouble, so this now matches it.
//
// Headroom is not the issue: a measured real correction prompt (code + error
// output + system prompt) came to ~277 tokens, comfortably inside 1024. The
// binding limit is what is left on the GPU after the weights, which is why
// raising this to fit a bigger prompt is the wrong move — trim
// MAX_RETAINED_ERROR_OUTPUT or the code window instead.
const CORRECTION_CONTEXT_SIZE = 1024;
const CORRECTION_FALLBACK =
  "I couldn't work out a specific fix for that one. Check the exact line the error names, and compare it against a working example of the same construct.";

// Tuned for terseness. The previous version asked for "1-3 sentences of plain
// language BEFORE the code", which actively instructed the preamble that made
// demo output read as a lecture — the model dutifully re-explained the error
// before ever reaching the fix. This one caps the WHOLE answer, leads with the
// fix, and carries a worked example, which a 6.7B follows far more reliably
// than an abstract style description.
const CORRECTION_SYSTEM_PROMPT =
  'You are a coding tutor giving a student the direct fix for an error they have now hit twice. ' +
  'Answer in at most 3 short sentences TOTAL, including any code.\n\n' +
  'Lead with the fix, then the corrected code, then at most one short clause on why. ' +
  'Exactly this shape:\n' +
  'Missing closing quote. Fix: echo "Hello, World"; — the string needs matching quotes to close it.\n\n' +
  'Use a fenced code block only if the fix spans more than one line; otherwise keep the code inline.\n\n' +
  'Never restate or re-explain the error message — the student has already read it. ' +
  'Never explain general language concepts unless the concept IS the cause. ' +
  'No greeting, no preamble, no closing summary, no encouragement. ' +
  'Do not rewrite their whole program and do not suggest unrelated improvements. ' +
  'Show only the line or few lines that actually change.';

/**
 * Direct-correction counterpart to requestHint(). Same shape and same call
 * accounting — both increment the AI call counter and feed onAiCall(), because
 * both are student-initiated AI usage and Scenarios 2/4 must see them.
 *
 * Pulls the failing category and output from engine state rather than taking
 * them as arguments, so the renderer doesn't have to carry the error text back
 * across IPC just to ask for a fix.
 */
export async function requestCorrection(currentCode: string, language: string): Promise<string> {
  // TEMP DEBUG
  console.log('[TEMP DEBUG] C1. requestCorrection CALLED', {
    language,
    lastErrorCategory: state.lastErrorCategory,
    codeChars: currentCode.length,
    errorOutputChars: state.lastErrorOutput?.length ?? 0,
    contextSize: CORRECTION_CONTEXT_SIZE,
    maxTokens: CORRECTION_MAX_TOKENS,
  });

  const category = state.lastErrorCategory;
  const categoryLabel = category ? CATEGORY_LABELS[category] : 'an error';
  const errorSection = state.lastErrorOutput
    ? `\n\nThe run failed with this output:\n\n${state.lastErrorOutput}`
    : '';

  const prompt =
    `The student is working on a ${language} file and has now hit ${categoryLabel} twice.`
    + `${errorSection}\n\nHere is the code around their cursor:\n\n${currentCode}\n\n`
    + 'Tell them exactly what to change and why.';

  // TEMP DEBUG — prompt size is the leading suspect for the fallback, so this
  // reports the full budget going in, not just the pieces.
  console.log('[TEMP DEBUG] C2. correction prompt built', {
    promptChars: prompt.length,
    systemPromptChars: CORRECTION_SYSTEM_PROMPT.length,
    totalChars: prompt.length + CORRECTION_SYSTEM_PROMPT.length,
    roughTokenEstimate: Math.ceil((prompt.length + CORRECTION_SYSTEM_PROMPT.length) / 3.5),
    contextSize: CORRECTION_CONTEXT_SIZE,
    reservedForOutput: CORRECTION_MAX_TOKENS,
  });

  let result: string;
  try {
    result = await generate(prompt, CORRECTION_SYSTEM_PROMPT, undefined, {
      maxTokens: CORRECTION_MAX_TOKENS,
      contextSize: CORRECTION_CONTEXT_SIZE,
    });
  } catch (err) {
    // TEMP DEBUG
    console.log('[TEMP DEBUG] C3. correction generate() THREW -> fallback', {
      error: String(err),
      errorName: err instanceof Error ? err.name : typeof err,
    });
    console.warn('[adaptiveEngine] correction generation failed, using fallback.', err);
    return CORRECTION_FALLBACK;
  }

  // TEMP DEBUG — the RAW model output, before any trimming or rejection.
  console.log('[TEMP DEBUG] C4. correction RAW model output', {
    rawLength: result.length,
    trimmedLength: result.trim().length,
    isEmptyAfterTrim: result.trim().length === 0,
    hasCodeFence: result.includes('```'),
    raw: JSON.stringify(result.slice(0, 600)),
  });

  const trimmed = result.trim();
  // Deliberately NO code-block rejection here — unlike the hint path, a fenced
  // block is the expected and desired output. Only an empty result falls back.
  if (!trimmed) {
    // TEMP DEBUG
    console.log('[TEMP DEBUG] C5. correction REJECTED: empty after trim -> fallback');
    return CORRECTION_FALLBACK;
  }

  incrementAiCallCount();
  onAiCall();
  return trimmed;
}

export async function requestHint(currentCode: string, language: string): Promise<string> {
  // TEMP DEBUG
  console.log('[TEMP DEBUG] H1. requestHint CALLED', {
    language,
    lastErrorCategory: state.lastErrorCategory,
    codeChars: currentCode.length,
    contextSize: HINT_CONTEXT_SIZE,
    maxTokens: HINT_MAX_TOKENS,
  });

  // When Scenario 5 raised the hint, name the category so the nudge points at
  // the actual problem instead of being generically encouraging.
  const categoryContext = state.lastErrorCategory
    ? ` Their last run failed with ${CATEGORY_LABELS[state.lastErrorCategory]}.`
    : '';
  const prompt = `The student is working on a ${language} file.${categoryContext} Here is the code around their cursor:\n\n${currentCode}\n\nGive one short, guiding hint — not the answer.`;

  let result: string;
  try {
    result = await generate(prompt, HINT_SYSTEM_PROMPT, undefined, {
      maxTokens: HINT_MAX_TOKENS,
      contextSize: HINT_CONTEXT_SIZE,
    });
  } catch (err) {
    console.warn('[adaptiveEngine] hint generation failed, using fallback.', err);
    return GENERIC_HINT_FALLBACK;
  }

  const trimmed = result.trim();
  if (!trimmed || HINT_CODE_BLOCK_PATTERN.test(trimmed) || trimmed.length > 400) {
    return GENERIC_HINT_FALLBACK;
  }

  incrementAiCallCount();
  onAiCall();
  return trimmed;
}
