// Standalone, deterministic tests for src/main/deprecatedApiGuard.ts: the
// per-language prompt guard block and the post-generation regex fix table.
// No model, no Electron, no app launch.
//
// For each of the four guarded languages (PHP, JS, C#, Dart), this prints a
// BEFORE sample containing the exact deprecated pattern from the task spec,
// runs it through applyDeprecatedApiFixes(), and prints AFTER -- so the patch
// firing is visible in real terminal output, not just asserted silently.
//
// Reuses scripts/adaptive-engine-test-loader.mjs as-is (see that file for why
// it's needed even though this module has zero imports of its own: it's the
// same loader every other scripts/test-*.mjs script registers).
//
// Run: node scripts/test-deprecated-api-guard.mjs

import { register } from 'node:module';
import assert from 'node:assert/strict';

register(new URL('./adaptive-engine-test-loader.mjs', import.meta.url), import.meta.url);

const {
  getDeprecatedApiGuardBlock,
  appendDeprecatedApiGuard,
  applyDeprecatedApiFixes,
} = await import(new URL('../src/main/deprecatedApiGuard.ts', import.meta.url).href);

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`  PASS: ${label}`);
}

function showFix(label, language, before) {
  const after = applyDeprecatedApiFixes(before, language);
  console.log(`\n--- ${label} (${language}) ---`);
  console.log('BEFORE:');
  console.log(before);
  console.log('AFTER:');
  console.log(after);
  assert.notEqual(after, before, `${label}: expected the fix pass to change the output`);
  return after;
}

console.log('=== Guard block: only the targeted language gets a block ===');
check('PHP guard mentions mysqli/PDO', () => {
  const block = getDeprecatedApiGuardBlock('PHP');
  assert.ok(block && block.includes('mysqli') && block.includes('PDO'));
});
check('JavaScript guard mentions let/const', () => {
  const block = getDeprecatedApiGuardBlock('JavaScript');
  assert.ok(block && block.includes('let or const'));
});
check('C# guard mentions HttpClient', () => {
  const block = getDeprecatedApiGuardBlock('C#');
  assert.ok(block && block.includes('HttpClient'));
});
check('Dart guard mentions Material 3 / withValues', () => {
  const block = getDeprecatedApiGuardBlock('Dart');
  assert.ok(block && block.includes('Material 3') && block.includes('withValues'));
});
check('Unguarded language (Python) gets no block, prompt unchanged', () => {
  const block = getDeprecatedApiGuardBlock('Python');
  assert.equal(block, null);
  const prompt = appendDeprecatedApiGuard('base prompt', 'Python');
  assert.equal(prompt, 'base prompt');
});
check('appendDeprecatedApiGuard appends only the ONE matching block', () => {
  const prompt = appendDeprecatedApiGuard('base prompt', 'PHP');
  assert.ok(prompt.startsWith('base prompt'));
  assert.ok(prompt.includes('mysqli'));
  assert.ok(!prompt.includes('HttpClient'), 'must not leak the C# block into a PHP call');
  assert.ok(!prompt.includes('Material 3'), 'must not leak the Dart block into a PHP call');
});

console.log('\n=== Regex fix pass: before/after per language ===');

showFix('PHP: mysql_* -> mysqli_*', 'PHP', [
  '<?php',
  '$conn = mysql_connect("localhost", "root", "");',
  '$result = mysql_query("SELECT * FROM users", $conn);',
  'while ($row = mysql_fetch_assoc($result)) {',
  '  echo $row["name"];',
  '}',
  'mysql_close($conn);',
].join('\n'));

showFix('JS: var + new Buffer()', 'JavaScript', [
  'function makeHeader(text) {',
  '  var buf = new Buffer(text);',
  '  var padding = new Buffer(16);',
  '  return Buffer.concat([padding, buf]);',
  '}',
].join('\n'));

console.log('\n--- C#: WebClient (guard-only, no regex table -- see file header) ---');
check('C# regex pass is a deliberate no-op (WebClient/BinaryFormatter have no safe 1:1 rename)', () => {
  const before = [
    'using System.Net;',
    '',
    'var client = new WebClient();',
    'string html = client.DownloadString("https://example.com");',
  ].join('\n');
  const after = applyDeprecatedApiFixes(before, 'C#');
  assert.equal(after, before, 'C# has no regex rules by design; only the prompt guard applies');
  console.log('BEFORE === AFTER (unchanged), as designed:');
  console.log(before);
});

console.log('\n=== Dart: TextTheme + withOpacity ===');
showFix('Dart: legacy TextTheme + withOpacity', 'Dart', [
  'Text(',
  "  'Title',",
  '  style: Theme.of(context).textTheme.headline4?.copyWith(',
  '    color: Colors.blue.withOpacity(0.6),',
  '  ),',
  ')',
].join('\n'));

console.log(`\n${passed} guard-block assertions passed.`);
console.log('All regex fix-pass samples above changed BEFORE -> AFTER as shown.');
