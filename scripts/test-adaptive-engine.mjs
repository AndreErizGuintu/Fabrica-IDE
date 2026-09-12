// Standalone, deterministic scenario tests for src/main/adaptiveEngine.ts.
//
// Replaces manual UI-timed testing (waiting real minutes for idle timers /
// cooldowns to elapse) with a fake clock injected via
// __setClockForTesting()/__setTimerSchedulingDisabledForTesting(). Those two
// hooks plus __forceIdleExpiredForTesting() are additive, test-only exports
// on adaptiveEngine.ts — no trigger logic, thresholds, or priority order
// were touched to make this possible.
//
// Runs the REAL evaluate()/tryFire()/onAiCall()/onRun()/onEditorActivity()
// code paths under fake time, not a reimplementation of the trigger logic
// and not direct pokes at private state — same pattern as
// scripts/test-gpu-layers.mjs / scripts/benchmark.mjs (plain Node, no
// Electron, fast iteration).
//
// Run: node scripts/test-adaptive-engine.mjs

import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// adaptiveEngine.ts is written for the Electron main process (webpack
// resolution, real 'electron' module). This loader lets it load under plain
// node — see adaptive-engine-test-loader.mjs for exactly what it stubs.
register(new URL('./adaptive-engine-test-loader.mjs', import.meta.url), import.meta.url);

const engine = await import(
  pathToFileURL(path.join(__dirname, '..', 'src', 'main', 'adaptiveEngine.ts')).href
);

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'adaptiveEngine.config.json'), 'utf8'),
);

const IDLE_MS = config.idleThresholdSeconds * 1000;
const SCENARIO1_WINDOW_MS = config.scenario1_idleThenCall.callWithinSecondsAfterIdle * 1000;
const SCENARIO2_WINDOW_MS = config.scenario2_rapidCalls.windowMinutes * 60_000;
const SCENARIO2_THRESHOLD = config.scenario2_rapidCalls.callCountThreshold;
const SCENARIO3_THRESHOLD = config.scenario3_silentStruggle.consecutiveIdleResetsThreshold;
const SCENARIO4_RATIO_THRESHOLD = config.scenario4_sessionRatio.callToRunRatioThreshold;
const SCENARIO4_MIN_RUNS = config.scenario4_sessionRatio.minimumRunsBeforeEvaluating;
const COOLDOWN_MS = config.suggestion.cooldownMinutesAfterDismiss * 60_000;

// Duplicated from adaptiveEngine.ts's private COPY map (not exported, and
// exporting it isn't worth widening the module's surface just for this) —
// update this alongside COPY if the suggestion text ever changes.
const EXPECTED_COPY = {
  1: 'Jumping straight to the AI after a short pause — happy to help, just say the word if you want a hand.',
  2: 'Lots of AI questions and no runs yet — want to try running your code to see where things stand?',
  3: 'Looks like you might be stuck — want a hint?',
  4: "You've been leaning on the AI assistant a lot compared to running your own code — no pressure, just flagging it in case it's useful to know.",
  5: "You've hit this kind of error again — want a hand working out what's going on?",
};

const SCENARIO5_THRESHOLD = config.scenario5_errorPattern.repeatThreshold;
const SCENARIO5_COOLDOWN_MS = config.scenario5_errorPattern.cooldownMinutesAfterDismiss * 60_000;

// --- Fake clock + engine harness --------------------------------------------

let fakeNow = 0;
let firedSuggestions = [];

engine.__setClockForTesting(() => fakeNow);
// Real setTimeout-based idle scheduling is disabled for the whole run so a
// background timer can never fire mid-test against the fake clock. Idle
// expiry is instead simulated explicitly via idleResetCycle()/forceIdle().
engine.__setTimerSchedulingDisabledForTesting(true);
engine.setSuggestionSink((suggestion) => firedSuggestions.push(suggestion));

function resetEngine(startTs = 1_700_000_000_000) {
  fakeNow = startTs;
  firedSuggestions = [];
  engine.startEngineSession();
}

function advance(ms) {
  fakeNow += ms;
}

// Simulates the idle timer actually expiring (as real setTimeout would after
// IDLE_MS of inactivity) followed by the student resuming activity with no
// AI call / run in between — one "idle-reset" cycle for Scenario 3.
function idleResetCycle() {
  advance(IDLE_MS);
  engine.__forceIdleExpiredForTesting();
  advance(1000); // small gap before the student resumes typing
  engine.onEditorActivity();
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg);
}

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
    console.log(`  PASS  ${name}`);
  } catch (err) {
    results.push({ name, pass: false, error: err.message });
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
  }
}

// --- Scenario 1: idle expires, call within/outside the follow-up window ----

function scenario1_firesWithinWindow() {
  resetEngine();
  advance(IDLE_MS);
  engine.__forceIdleExpiredForTesting();
  advance(SCENARIO1_WINDOW_MS - 2000); // comfortably inside the window
  engine.onAiCall();

  const debug = engine.getDebugState();
  assertTrue(debug.lastSuggestionFired !== null, 'expected a suggestion to have fired');
  assertEqual(debug.lastSuggestionFired.scenario, 1, 'expected scenario 1 to fire');
  const fired = firedSuggestions.at(-1);
  assertEqual(fired.scenario, 1, 'suggestion sink should have received scenario 1');
  assertEqual(fired.message, EXPECTED_COPY[1], 'scenario 1 copy mismatch');
}

function scenario1_noFireOutsideWindow() {
  resetEngine();
  advance(IDLE_MS);
  engine.__forceIdleExpiredForTesting();
  advance(SCENARIO1_WINDOW_MS + 5000); // well past the window
  engine.onAiCall();

  assertEqual(firedSuggestions.length, 0, 'no suggestion should have fired');
  assertEqual(engine.getDebugState().lastSuggestionFired, null, 'lastSuggestionFired should stay null');
}

// --- Scenario 2: N calls within window / no runs, vs. calls spread out -----

function scenario2_firesWithinWindow() {
  resetEngine();
  for (let i = 0; i < SCENARIO2_THRESHOLD; i += 1) {
    engine.onAiCall();
    advance(1000);
  }

  const debug = engine.getDebugState();
  assertEqual(debug.lastSuggestionFired?.scenario, 2, 'expected scenario 2 to fire');
  assertEqual(firedSuggestions.at(-1).message, EXPECTED_COPY[2], 'scenario 2 copy mismatch');
}

function scenario2_noFireWhenCallsSpreadOutsideWindow() {
  resetEngine();
  // Space every call just past the window so pruneOlderThan() drops the
  // previous one before the threshold is ever reached in-window. Advance
  // BEFORE each call (not after the last one), so the final call's own
  // timestamp is still fresh when we inspect state below.
  for (let i = 0; i < SCENARIO2_THRESHOLD; i += 1) {
    if (i > 0) advance(SCENARIO2_WINDOW_MS + 1000);
    engine.onAiCall();
  }

  assertEqual(firedSuggestions.length, 0, 'no suggestion should have fired');
  assertEqual(engine.getDebugState().scenario2.callCountInWindow, 1, 'window should only ever hold the latest call');
}

// --- Scenario 3: fresh trigger via consecutive idle-resets ------------------

function scenario3_freshTriggerFires() {
  resetEngine();
  for (let i = 0; i < SCENARIO3_THRESHOLD; i += 1) {
    idleResetCycle();
  }

  const debug = engine.getDebugState();
  assertEqual(debug.lastSuggestionFired?.scenario, 3, 'expected scenario 3 to fire');
  assertEqual(firedSuggestions.at(-1).message, EXPECTED_COPY[3], 'scenario 3 copy mismatch');
  assertEqual(debug.scenario3.consecutiveIdleResets, 0, 'counter should be reset to 0 at the moment it fires');
}

// --- Scenario 3: the real fixed bug — no immediate re-fire ------------------
//
// Regression test for the bug logged in DECISIONS.md 2026-08-04: before the
// fix, evaluate() checked `consecutiveIdleResets >= threshold` and fired,
// but never zeroed the counter at fire time. So once the streak crossed the
// threshold once, it stayed parked at/above it — a SINGLE later idle-resume
// cycle (with no AI call/run breaking the streak) would immediately
// re-cross the threshold and fire again, even though it wasn't a genuinely
// fresh 5-cycle streak.
//
// This test drives the real evaluate()/tryFire()/dismissSuggestion()
// pipeline end to end (not just a debug-state read) so a regression would
// show up as an actual second fire, not just a stale counter value:
//   1. Fire scenario 3 for real (5 idle-reset cycles).
//   2. Dismiss it (mirrors the renderer's auto-dismiss/close), which also
//      starts a cooldown — so we deliberately advance the fake clock past
//      the cooldown window before continuing. That isolates what's under
//      test to the counter-reset fix specifically, not cooldown gating.
//   3. Run exactly ONE more idle-reset cycle — no AI call, no run, no
//      extra edits in between.
//   4. Assert: still only ONE suggestion ever fired, and the counter reads
//      1 (a fresh single cycle), not 6 (the old parked-then-bumped value).
function scenario3_noImmediateRefireAfterFiring() {
  resetEngine();
  for (let i = 0; i < SCENARIO3_THRESHOLD; i += 1) {
    idleResetCycle();
  }
  assertEqual(firedSuggestions.length, 1, 'sanity check: scenario 3 should have fired once so far');
  assertEqual(firedSuggestions[0].scenario, 3, 'sanity check: the first fire should be scenario 3');

  engine.dismissSuggestion();
  advance(COOLDOWN_MS + 60_000); // clear cooldown so only the counter logic is being tested below

  idleResetCycle(); // the single post-fire idle->resume cycle, no call/run in between

  assertEqual(
    firedSuggestions.length,
    1,
    'a single idle-resume cycle right after firing must NOT immediately re-fire scenario 3',
  );
  assertEqual(
    engine.getDebugState().scenario3.consecutiveIdleResets,
    1,
    'counter should read 1 (a fresh single cycle) rather than staying parked at/above threshold',
  );
}

// --- Scenario 3: correctly reset by a run -----------------------------------

function scenario3_resetByRun() {
  resetEngine();
  const partialCycles = SCENARIO3_THRESHOLD - 2;
  for (let i = 0; i < partialCycles; i += 1) {
    idleResetCycle();
  }
  assertEqual(
    engine.getDebugState().scenario3.consecutiveIdleResets,
    partialCycles,
    'sanity check: counter should reflect partial accumulation before the run',
  );

  engine.onRun();

  assertEqual(engine.getDebugState().scenario3.consecutiveIdleResets, 0, 'a run event must reset the streak to 0');
}

// --- Scenario 4: session call/run ratio, gated by minimum runs -------------

function scenario4_firesWhenMinimumRunsMet() {
  resetEngine();
  for (let i = 0; i < SCENARIO4_MIN_RUNS; i += 1) {
    engine.onRun();
    advance(1000);
  }
  // sessionCallCount / sessionRunCount must exceed the threshold strictly.
  const callsNeeded = Math.floor(SCENARIO4_MIN_RUNS * SCENARIO4_RATIO_THRESHOLD) + 1;
  for (let i = 0; i < callsNeeded; i += 1) {
    engine.onAiCall();
    advance(1000);
  }

  const debug = engine.getDebugState();
  assertEqual(debug.lastSuggestionFired?.scenario, 4, 'expected scenario 4 to fire once the ratio is crossed');
  assertEqual(firedSuggestions.at(-1).message, EXPECTED_COPY[4], 'scenario 4 copy mismatch');
}

function scenario4_noFireWhenRunsBelowMinimum() {
  resetEngine();
  const runsBelowMinimum = SCENARIO4_MIN_RUNS - 1;
  for (let i = 0; i < runsBelowMinimum; i += 1) {
    engine.onRun();
    advance(1000);
  }
  // Same ratio (or higher) as the passing case, just with too few runs.
  const callsForSameRatio = Math.floor(runsBelowMinimum * SCENARIO4_RATIO_THRESHOLD) + 2;
  for (let i = 0; i < callsForSameRatio; i += 1) {
    engine.onAiCall();
    advance(1000);
  }

  assertEqual(firedSuggestions.length, 0, 'no suggestion should fire while below minimumRunsBeforeEvaluating');
  assertEqual(engine.getDebugState().scenario4.minimumRunsMet, false, 'sanity check: minimum-runs gate should read false');
}

// --- Priority: 2 > 3 > 1 > 4 when multiple conditions are true at once -----
//
// onAiCall() always zeroes consecutiveIdleResets before calling evaluate(),
// so scenario 2 and scenario 3's raw conditions can't both be freshly built
// via calls alone. But evaluate()'s scenario-2 branch returns immediately
// once true, WITHOUT ever reaching (or resetting) the scenario-3 branch —
// so once scenario 2's condition is true, idle-reset cycles can keep
// accumulating consecutiveIdleResets past the scenario-3 threshold
// completely unimpeded, since evaluate() never gets far enough to touch it.
//
// This test builds exactly that real state (not a debug-only construction):
// fire scenario 2 for real, then run scenario-3-threshold-many idle-reset
// cycles with NO cooldown/dismiss step (deliberately — Scenario 2's window
// is 5 minutes but the cooldown is 10, so clearing cooldown first would
// prune the calls back out of window before scenario 3 could be built up,
// invalidating the setup). The proof of priority is that the fired-
// suggestions history stays at exactly one entry (scenario 2) even once
// scenario 3's condition also goes true, and scenario 3's own counter is
// left untouched — both only possible if evaluate() really did return at
// the scenario-2 branch every time, never reaching scenario 3's branch.
function priority_scenario2BeatsScenario3() {
  resetEngine();
  for (let i = 0; i < SCENARIO2_THRESHOLD; i += 1) {
    engine.onAiCall();
    advance(1000);
  }
  assertEqual(firedSuggestions.at(-1)?.scenario, 2, 'sanity check: scenario 2 should have fired first');
  assertEqual(firedSuggestions.length, 1, 'sanity check: exactly one fire so far');

  for (let i = 0; i < SCENARIO3_THRESHOLD; i += 1) {
    idleResetCycle();
  }

  const debug = engine.getDebugState();
  assertTrue(debug.scenario2.conditionTrue, 'sanity check: scenario 2 condition should still be true (calls still in window, no runs)');
  assertTrue(debug.scenario3.conditionTrue, 'sanity check: scenario 3 condition should also be true by now');
  assertEqual(debug.priorityWinner, 2, 'priority winner among simultaneously-true conditions should be scenario 2');

  // The real proof: still only the original scenario-2 fire happened — no
  // scenario-3 suggestion was ever produced despite its condition being true.
  assertEqual(firedSuggestions.length, 1, 'scenario 3 must not have fired while scenario 2 still holds priority');
  assertEqual(firedSuggestions[0].scenario, 2, 'the one suggestion that fired should be scenario 2, not 3');
  assertEqual(
    debug.scenario3.consecutiveIdleResets,
    SCENARIO3_THRESHOLD,
    "scenario 3's counter should be untouched at exactly the threshold — its branch in evaluate() was never reached to reset it",
  );
}

// --- Cooldown: dismissal suppresses new fires until it clears --------------

function cooldown_blocksUntilCleared() {
  resetEngine();
  for (let i = 0; i < SCENARIO2_THRESHOLD; i += 1) {
    engine.onAiCall();
    advance(1000);
  }
  const firstFire = firedSuggestions.at(-1);
  assertEqual(firstFire.scenario, 2, 'sanity check: initial fire should be scenario 2');
  const firstFiredAt = engine.getDebugState().lastSuggestionFired.firedAt;

  engine.dismissSuggestion();

  // Still well within the cooldown window: build a fresh valid scenario-2
  // trigger (more calls, still no runs) and confirm it does NOT fire.
  advance(2 * 60_000);
  for (let i = 0; i < SCENARIO2_THRESHOLD; i += 1) {
    engine.onAiCall();
    advance(1000);
  }
  assertEqual(firedSuggestions.length, 1, 'a valid trigger during cooldown must not produce a new fire');
  assertEqual(
    engine.getDebugState().lastSuggestionFired.firedAt,
    firstFiredAt,
    'lastSuggestionFired should not have been overwritten while cooldown is active',
  );
  assertTrue(engine.getDebugState().cooldown.active, 'cooldown should still be active at this point');

  // Advance past the cooldown window, then trigger again — this time it
  // should fire.
  advance(COOLDOWN_MS);
  engine.onAiCall();
  advance(1000);
  engine.onAiCall();
  advance(1000);
  engine.onAiCall();

  assertEqual(firedSuggestions.length, 2, 'a valid trigger after cooldown clears should fire a new suggestion');
  assertTrue(!engine.getDebugState().cooldown.active, 'cooldown should be clear after the window elapsed');
}

// --- Run ---------------------------------------------------------------------

console.log('Adaptive Engine — scenario tests\n');

console.log('Scenario 1 (idle -> call):');
test('fires when the AI call lands within the follow-up window', scenario1_firesWithinWindow);
test('does NOT fire when the AI call lands outside the follow-up window', scenario1_noFireOutsideWindow);

console.log('\nScenario 2 (rapid calls, no runs):');
test('fires when N calls land within the window with zero runs', scenario2_firesWithinWindow);
test('does NOT fire when calls are spread outside the window', scenario2_noFireWhenCallsSpreadOutsideWindow);

console.log('\nScenario 3 (silent struggle via idle-resets):');
test('fires on a fresh streak of consecutive idle-resets', scenario3_freshTriggerFires);
test('does NOT immediately re-fire from a single post-fire idle-resume cycle (regression test)', scenario3_noImmediateRefireAfterFiring);
test('streak is reset to 0 by a run event', scenario3_resetByRun);

console.log('\nScenario 4 (session call/run ratio):');
test('fires once the ratio crosses threshold with minimumRunsBeforeEvaluating met', scenario4_firesWhenMinimumRunsMet);
test('does NOT fire at the same ratio when runs are below the minimum', scenario4_noFireWhenRunsBelowMinimum);

// --- Scenario 5: repeated classified run error ------------------------------

// A first occurrence of a category is normal and must not interrupt.
function scenario5_firstOccurrenceDoesNotFire() {
  resetEngine();
  engine.onRun();
  engine.onRunError('syntax', 'SyntaxError: Unexpected token');
  assertEqual(firedSuggestions.length, 0, 'a single error should not fire Scenario 5');
}

// The SAME category hit again at repeatThreshold fires, offering the hint path.
function scenario5_repeatFiresWithHintOffer() {
  resetEngine();
  for (let i = 0; i < SCENARIO5_THRESHOLD; i += 1) {
    engine.onRun();
    engine.onRunError('syntax', 'SyntaxError: Unexpected token');
  }
  assertEqual(firedSuggestions.length, 1, 'Scenario 5 should fire exactly once at threshold');
  assertEqual(firedSuggestions[0].scenario, 5, 'fired suggestion should be scenario 5');
  assertEqual(firedSuggestions[0].message, EXPECTED_COPY[5], 'scenario 5 copy mismatch');
  assertEqual(firedSuggestions[0].errorCategory, 'syntax', 'category should travel on the suggestion');
  assertEqual(firedSuggestions[0].offersHint, true, 'first fire should offer the guiding hint');
  assertTrue(!firedSuggestions[0].offersCorrection, 'first fire must NOT offer a correction');
}

// Two DIFFERENT categories are not a repeat — neither reaches the threshold.
function scenario5_differentCategoriesDoNotFire() {
  resetEngine();
  engine.onRun();
  engine.onRunError('syntax', 'SyntaxError');
  engine.onRun();
  engine.onRunError('null-reference', 'Cannot read properties of null');
  assertEqual(firedSuggestions.length, 0, 'distinct categories should not aggregate into a repeat');
}

// Hitting the same category AGAIN after the hint escalates to a direct fix.
// The dismiss+advance clears the suggestion and the post-dismiss cooldown so
// the escalation itself is what is being observed, not suppression.
function scenario5_escalatesToCorrection() {
  resetEngine();
  for (let i = 0; i < SCENARIO5_THRESHOLD; i += 1) {
    engine.onRun();
    engine.onRunError('null-reference', 'Cannot read properties of null');
  }
  assertEqual(firedSuggestions.length, 1, 'expected the threshold fire first');

  engine.dismissSuggestion();
  advance(COOLDOWN_MS + 1000);

  engine.onRun();
  engine.onRunError('null-reference', 'Cannot read properties of null');

  assertEqual(firedSuggestions.length, 2, 'a further repeat should fire again');
  assertEqual(firedSuggestions[1].scenario, 5, 'escalation should still be scenario 5');
  assertEqual(firedSuggestions[1].offersCorrection, true, 'escalation should offer a correction');
  assertEqual(firedSuggestions[1].offersHint, false, 'escalation should NOT also offer a hint');
}

// Counters are per-session: a new session starts the category tally at zero.
function scenario5_countsResetOnNewSession() {
  resetEngine();
  engine.onRun();
  engine.onRunError('syntax', 'SyntaxError');
  resetEngine();
  engine.onRun();
  engine.onRunError('syntax', 'SyntaxError');
  assertEqual(firedSuggestions.length, 0, 'category counts must not survive startEngineSession()');
}

// Scenario 5 outranks Scenario 3 when both are simultaneously true.
function priority_scenario5BeatsScenario3() {
  resetEngine();
  for (let i = 0; i < SCENARIO3_THRESHOLD; i += 1) {
    idleResetCycle();
  }
  firedSuggestions = [];
  engine.dismissSuggestion();
  advance(COOLDOWN_MS + 1000);

  // Rebuild the scenario-3 streak, then trigger a repeat error in the same tick.
  for (let i = 0; i < SCENARIO3_THRESHOLD; i += 1) {
    idleResetCycle();
  }
  firedSuggestions = [];
  engine.dismissSuggestion();
  advance(COOLDOWN_MS + 1000);

  for (let i = 0; i < SCENARIO5_THRESHOLD; i += 1) {
    engine.onRunError('type-mismatch', 'TypeError: x.map is not a function');
  }

  assertTrue(firedSuggestions.length > 0, 'expected a suggestion to fire');
  assertEqual(firedSuggestions[0].scenario, 5, 'scenario 5 should win priority over scenario 3');
}

// Every occurrence at or above the threshold fires, not just the first one to
// reach it exactly. Guards against the condition ever being narrowed to `===`.
// Cooldown is cleared between occurrences so the THRESHOLD is what is measured.
function scenario5_firesAtEveryCountAtOrAboveThreshold() {
  resetEngine();
  const seen = [];
  for (let i = 1; i <= SCENARIO5_THRESHOLD + 2; i += 1) {
    const before = firedSuggestions.length;
    engine.onRunError('syntax', 'boom');
    const didFire = firedSuggestions.length > before;
    const last = firedSuggestions.at(-1);
    seen.push({ count: i, didFire, offersCorrection: didFire ? !!last.offersCorrection : null });
    engine.dismissSuggestion();
    advance(COOLDOWN_MS + 1000);
  }

  for (const entry of seen) {
    if (entry.count < SCENARIO5_THRESHOLD) {
      assertEqual(entry.didFire, false, `count=${entry.count} is below threshold and must not fire`);
    } else {
      assertEqual(entry.didFire, true, `count=${entry.count} is at/above threshold and must fire`);
    }
  }

  assertEqual(seen[SCENARIO5_THRESHOLD - 1].offersCorrection, false, 'the first fire at threshold offers a hint');
  assertEqual(seen[SCENARIO5_THRESHOLD].offersCorrection, true, 'the next fire escalates to a correction');
  assertEqual(seen[SCENARIO5_THRESHOLD + 1].offersCorrection, true, 'and stays escalated thereafter');
}

// Documents the real reason a third consecutive failure can appear "not to
// fire": the post-dismiss cooldown, not the threshold comparison.
function scenario5_suppressedByCooldownNotThreshold() {
  resetEngine();
  for (let i = 0; i < SCENARIO5_THRESHOLD; i += 1) {
    engine.onRunError('syntax', 'boom');
  }
  assertEqual(firedSuggestions.length, 1, 'expected the threshold fire');

  engine.dismissSuggestion();
  advance(30_000); // well inside the 10-minute cooldown

  engine.onRunError('syntax', 'boom');
  assertEqual(firedSuggestions.length, 1, 'a repeat inside the cooldown is suppressed');

  // The very same occurrence fires once the cooldown has elapsed, proving the
  // threshold condition itself was satisfied all along.
  advance(COOLDOWN_MS + 1000);
  engine.onRunError('syntax', 'boom');
  assertEqual(firedSuggestions.length, 2, 'the same condition fires once cooldown clears');
  assertEqual(firedSuggestions.at(-1).offersCorrection, true, 'and it is the escalated correction');
}

// The debug snapshot must stay readable between ticks: pendingErrorCategory is
// consumed synchronously by evaluate(), so a poll-based panel keyed on it would
// always read false. Regression test for that panel bug.
function scenario5_debugStateReadableAfterEvaluate() {
  resetEngine();
  for (let i = 0; i < SCENARIO5_THRESHOLD; i += 1) {
    engine.onRunError('type-mismatch', 'boom');
  }
  const debug = engine.getDebugState();
  assertEqual(debug.scenario5.conditionTrue, true, 'conditionTrue must survive evaluate() consuming the pending category');
  assertEqual(debug.scenario5.lastErrorCategory, 'type-mismatch', 'lastErrorCategory should be reported');
  assertEqual(debug.scenario5.errorCategoryCounts['type-mismatch'], SCENARIO5_THRESHOLD, 'counts should be reported');
  assertEqual(debug.scenario5.wouldEscalateToCorrection, false, 'at threshold the next offer is a hint');
}

// Scenario 5 runs on its own, shorter cooldown clock. Verifies BOTH halves:
// that 5 recovers well before the shared window, and that Scenarios 1-4 are
// still held for the full shared window by that same dismissal.
function scenario5_hasItsOwnShorterCooldown() {
  assertTrue(
    SCENARIO5_COOLDOWN_MS < COOLDOWN_MS,
    `scenario 5 cooldown (${SCENARIO5_COOLDOWN_MS}ms) must be shorter than the shared one (${COOLDOWN_MS}ms)`,
  );

  resetEngine();
  for (let i = 0; i < SCENARIO5_THRESHOLD; i += 1) {
    engine.onRunError('syntax', 'boom');
  }
  assertEqual(firedSuggestions.length, 1, 'expected the threshold fire');
  engine.dismissSuggestion();

  // Still inside Scenario 5's own window — must stay suppressed.
  advance(SCENARIO5_COOLDOWN_MS - 5000);
  engine.onRunError('syntax', 'boom');
  assertEqual(firedSuggestions.length, 1, 'suppressed while scenario 5 cooldown is still running');

  // Past scenario 5's window but FAR short of the shared 10-minute one.
  advance(10_000);
  assertTrue(fakeNow < 1_700_000_000_000 + COOLDOWN_MS, 'sanity: still inside the shared window');
  engine.onRunError('syntax', 'boom');
  assertEqual(firedSuggestions.length, 2, 'scenario 5 fires again on its own shorter cooldown');
  assertEqual(firedSuggestions.at(-1).scenario, 5, 'the new fire is scenario 5');
}

// The same dismissal must NOT let scenarios 1-4 off early.
function scenario5_dismissalDoesNotShortenSharedCooldown() {
  resetEngine();
  for (let i = 0; i < SCENARIO5_THRESHOLD; i += 1) {
    engine.onRunError('syntax', 'boom');
  }
  assertEqual(firedSuggestions.at(-1).scenario, 5, 'expected scenario 5 to fire');
  engine.dismissSuggestion();

  // Past scenario 5's short window, still well inside the shared one.
  advance(SCENARIO5_COOLDOWN_MS + 5000);
  const before = firedSuggestions.length;

  // Build a scenario 2 trigger: threshold AI calls in-window with zero runs.
  // Runs are what onRunError implies, so start a clean streak by using calls only.
  for (let i = 0; i < SCENARIO2_THRESHOLD; i += 1) {
    engine.onAiCall();
    advance(1000);
  }
  assertEqual(
    firedSuggestions.length,
    before,
    'scenarios 1-4 must stay suppressed for the FULL shared cooldown after a scenario 5 dismissal',
  );

  // Once the shared window elapses, scenario 2 is free again. The earlier calls
  // have aged out of scenario 2's own 5-minute window by now, so the condition
  // has to be rebuilt with fresh calls rather than topped up with one more.
  advance(COOLDOWN_MS);
  for (let i = 0; i < SCENARIO2_THRESHOLD; i += 1) {
    engine.onAiCall();
    advance(1000);
  }
  assertTrue(firedSuggestions.length > before, 'scenario 2 fires once the shared cooldown clears');
  assertEqual(firedSuggestions.at(-1).scenario, 2, 'and it is scenario 2 that fires');
}

console.log('\nScenario 5 (repeated classified run error):');
test('a first occurrence of a category does NOT fire', scenario5_firstOccurrenceDoesNotFire);
test('a repeat of the SAME category fires and offers the guiding hint', scenario5_repeatFiresWithHintOffer);
test('two different categories do not aggregate into a repeat', scenario5_differentCategoriesDoNotFire);
test('a further repeat escalates from hint to direct correction', scenario5_escalatesToCorrection);
test('category counts reset on a new session', scenario5_countsResetOnNewSession);
test('fires at EVERY count at or above threshold, not just the first (>= not ===)', scenario5_firesAtEveryCountAtOrAboveThreshold);
test('a repeat inside the cooldown is suppressed by cooldown, not by the threshold', scenario5_suppressedByCooldownNotThreshold);
test('debug snapshot stays readable after evaluate() consumes the pending category', scenario5_debugStateReadableAfterEvaluate);
test('has its own shorter cooldown, independent of the shared one', scenario5_hasItsOwnShorterCooldown);
test('dismissing scenario 5 does NOT shorten the shared cooldown for scenarios 1-4', scenario5_dismissalDoesNotShortenSharedCooldown);

console.log('\nPriority:');
test('scenario 2 wins over scenario 3 when both conditions are true simultaneously', priority_scenario2BeatsScenario3);
test('scenario 5 wins over scenario 3 when both conditions are true simultaneously', priority_scenario5BeatsScenario3);

console.log('\nCooldown:');
test('a new valid trigger during cooldown does not fire until the cooldown clears', cooldown_blocksUntilCleared);

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;

console.log(`\n${'-'.repeat(60)}`);
console.log(`${passed}/${results.length} tests passed`);
if (failed > 0) {
  console.log(`\nFailures:`);
  for (const r of results.filter((r) => !r.pass)) {
    console.log(`  - ${r.name}`);
    console.log(`    ${r.error}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
