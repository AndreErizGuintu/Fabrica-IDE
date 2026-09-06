/* eslint no-console: off */
import { generate } from './llm';
import { incrementAiCallCount } from './stats';
import config from './adaptiveEngine.config.json';

export type Scenario = 1 | 2 | 3 | 4;

export type Suggestion = {
  scenario: Scenario;
  message: string;
  offersHint: boolean;
  autoDismissSeconds: number;
};

const COPY: Record<Scenario, string> = {
  1: "Jumping straight to the AI after a short pause — happy to help, just say the word if you want a hand.",
  2: "Lots of AI questions and no runs yet — want to try running your code to see where things stand?",
  3: 'Looks like you might be stuck — want a hint?',
  4: "You've been leaning on the AI assistant a lot compared to running your own code — no pressure, just flagging it in case it's useful to know.",
};

const IDLE_MS = () => config.idleThresholdSeconds * 1000;
const SCENARIO1_WINDOW_MS = () => config.scenario1_idleThenCall.callWithinSecondsAfterIdle * 1000;
const SCENARIO2_WINDOW_MS = () => config.scenario2_rapidCalls.windowMinutes * 60_000;
const COOLDOWN_MS = () => config.suggestion.cooldownMinutesAfterDismiss * 60_000;

type EngineState = {
  idleTimer: ReturnType<typeof setTimeout> | null;
  idleExpiredAt: number | null;
  consecutiveIdleResets: number;
  callTimestamps: number[];
  runTimestamps: number[];
  sessionCallCount: number;
  sessionRunCount: number;
  cooldownUntil: number;
  suggestionActive: Suggestion | null;
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
  suggestionActive: null,
  lastFiredSuggestion: null,
  scenarioFireCounts: { 1: 0, 2: 0, 3: 0, 4: 0 },
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

function tryFire(scenario: Scenario) {
  if (state.suggestionActive) return;
  const firedAt = now();
  if (firedAt < state.cooldownUntil) return;

  const suggestion: Suggestion = {
    scenario,
    message: COPY[scenario],
    offersHint: scenario === 3,
    autoDismissSeconds: config.suggestion.autoDismissSeconds,
  };
  state.suggestionActive = suggestion;
  state.lastFiredSuggestion = { scenario, firedAt };
  state.scenarioFireCounts[scenario] += 1;
  pushSuggestion?.(suggestion);
}

// Priority order when multiple scenarios are simultaneously true: 2 > 3 > 1 > 4.
function evaluate() {
  const nowMs = now();

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

export function startEngineSession() {
  state.idleExpiredAt = null;
  state.consecutiveIdleResets = 0;
  state.callTimestamps = [];
  state.runTimestamps = [];
  state.sessionCallCount = 0;
  state.sessionRunCount = 0;
  state.cooldownUntil = 0;
  state.suggestionActive = null;
  state.lastFiredSuggestion = null;
  state.scenarioFireCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
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
  state.cooldownUntil = now() + COOLDOWN_MS();
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

  let priorityWinner: Scenario | null = null;
  if (scenario2ConditionTrue) priorityWinner = 2;
  else if (scenario3ConditionTrue) priorityWinner = 3;
  else if (scenario1WindowOpen) priorityWinner = 1;
  else if (scenario4ConditionTrue) priorityWinner = 4;

  const cooldownActive = nowMs < state.cooldownUntil;

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

export async function requestHint(currentCode: string, language: string): Promise<string> {
  const prompt = `The student is working on a ${language} file. Here is the code around their cursor:\n\n${currentCode}\n\nGive one short, guiding hint — not the answer.`;

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
