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
};

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

console.log('\nPriority:');
test('scenario 2 wins over scenario 3 when both conditions are true simultaneously', priority_scenario2BeatsScenario3);

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
