// Standalone, deterministic tests for the pure logic in src/main/codeInference.ts:
// the trigger pre-filter, the FIM prompt construction, and the completion
// sanitizer. No model, no Electron, no app launch -- runs in well under a second.
//
// These are where the real bugs live (the sanitizer in particular has several
// interacting cut/trim passes), and they are otherwise only observable by
// typing into a live editor and hoping.
//
// UPDATED 2026-08-07 for the pivot from Monaco ghost text to a
// confirmation-based flow. What changed in this file:
//   - Trigger and sanitizer coverage is unchanged. Both functions survived the
//     pivot untouched, so their tests did too.
//   - The '<!Doctype' duplication repros are KEPT, and are no longer
//     ghost-text-specific. The duplication was never a rendering artifact: the
//     model restates and case-normalizes the prefix it was given, so inserting
//     the raw completion as ordinary text duplicates it exactly as ghost text
//     did. Only the assertions' wording changed -- 'on accept' now means a
//     normal editor edit rather than a Tab-accepted inline suggestion.
//   - Assertions that encoded MONACO's constraints rather than this module's
//     behavior are gone: nothing here depends on computeGhostText() refusing a
//     replacing range any more.
//   - Added prompt-construction coverage, which was previously untested.
//
// Reuses scripts/adaptive-engine-test-loader.mjs as-is -- it is a generic
// "load a main-process .ts under plain node" loader (stubs 'electron',
// resolves extensionless relative imports, injects JSON import attributes),
// not adaptiveEngine-specific despite the name.
//
// Run: node scripts/test-code-inference.mjs

import { register } from 'node:module';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

register(new URL('./adaptive-engine-test-loader.mjs', import.meta.url), import.meta.url);

// Read the config as plain JSON rather than through a new production export.
// The token budget is a config value, so the test asserts against the config
// file itself -- if someone drops maxTokens back down, these fail.
const config = JSON.parse(
  readFileSync(new URL('../src/main/codeInference.config.json', import.meta.url), 'utf8'),
);

const {
  __shouldTriggerForTesting: shouldTrigger,
  __sanitizeForTesting: sanitize,
  __buildStopTriggersForTesting: buildStopTriggers,
  __buildFimPromptForTesting: buildFimPrompt,
  // Added 2026-08-07: the reason string, so a rejection test can assert WHICH
  // guard fired rather than just that the answer was false.
  __triggerDecisionForTesting: triggerDecision,
  // Added 2026-08-07: the blank-line cut, asserted directly as well as through
  // sanitize(), since four other passes could mask the same symptom.
  __cutAtBlankLineForTesting: cutAtBlankLine,
  // Not a test-only export -- this is the real IPC entry point the renderer
  // calls on every typing pause, so it is worth asserting its shape directly.
  checkCodeInferenceTrigger: checkTrigger,
} = await import(new URL('../src/main/codeInference.ts', import.meta.url).href);

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message.split('\n').join('\n        ')}`);
  }
}

console.log('\n--- trigger pre-filter ---');

check('HTML doctype in a near-empty file fires', () => {
  assert.equal(shouldTrigger('<!DOCTYPE html>', '', 'html'), true);
});

check('HTML <html tag fires', () => {
  assert.equal(shouldTrigger('<html', '', 'html'), true);
});

// --- PHP dropped from Code Inference triggers, 2026-08-07 -------------------
// WAS: check('PHP open tag fires') asserting true. Inverted, not deleted, so the
// removal is visible as a deliberate decision rather than as missing coverage.
//
// Confirmed by a real test run, and it is STRUCTURAL rather than a prompt-wording
// problem. '<?php' triggered correctly and the model had nothing to complete --
// raw output was:
//
//   "<?php\n\n// Your code goes here\n\n?>\n"
//
// a generic placeholder, not code. HTML, C# and Dart each have ONE canonical
// opening skeleton. A PHP file can be a database script, a form handler, a class,
// or an API endpoint, so there is no single boilerplate to offer -- every prompt
// can only produce a wrong guess or a safe non-answer like the above. Same
// category as JS/CSS below: wired, but no meaningful universal opener.
//
// PHP support elsewhere is untouched -- execution and the AI panel modes still
// treat it as a first-class language. This is only the trigger list.
check('PHP no longer fires (no universal boilerplate -- see DECISIONS.md)', () => {
  assert.equal(shouldTrigger('<?php', '', 'php'), false);
});

check('PHP is inert by empty pattern list, not by being unsupported', () => {
  // Distinguishes "deliberately inert" from "accidentally deleted". The language
  // key must still exist -- dropping it entirely would report PHP as an unknown
  // language, which is a different (and wrong) statement about the project.
  const decision = triggerDecision('<?php', '', 'php');
  assert.equal(decision.ok, false);
  assert.ok(
    decision.reason.includes('no configured patterns'),
    `expected the inert-language branch, got: ${decision.reason}`,
  );
  assert.ok(
    !decision.reason.includes('not in the config'),
    'php was removed from the config entirely rather than left inert',
  );
});

check('C# using System fires', () => {
  assert.equal(shouldTrigger('using System;', '', 'csharp'), true);
});

check('C# namespace fires', () => {
  assert.equal(shouldTrigger('namespace App', '', 'csharp'), true);
});

check('Dart void main fires', () => {
  assert.equal(shouldTrigger('void main', '', 'dart'), true);
});

check('Dart import fires', () => {
  assert.equal(shouldTrigger("import 'dart:io';", '', 'dart'), true);
});

check('completely empty file does NOT fire', () => {
  assert.equal(shouldTrigger('', '', 'html'), false);
});

check('whitespace-only file does NOT fire', () => {
  assert.equal(shouldTrigger('   \n  ', '', 'html'), false);
});

// These three used '<?php' purely as a vehicle for reaching the size/scan gates.
// RE-POINTED AT HTML 2026-08-07: with PHP's pattern list now empty they would
// still have returned false, but for the WRONG reason -- rejected at the
// inert-language branch before ever reaching the gate each one is named after,
// leaving the size caps silently untested. The language has to be one that still
// triggers for these to mean anything.
check('file with substantial existing content does NOT fire (char cap)', () => {
  const big = `<!doctype html>\n${'<!-- filler comment line -->\n'.repeat(40)}`;
  assert.ok(big.length > config.maxTriggerChars, 'fixture no longer exceeds the char cap');
  assert.equal(shouldTrigger(big, '', 'html'), false);
});

check('file with too many lines does NOT fire (line cap)', () => {
  const manyLines = '<!doctype html>\na\nb\nc\nd\ne\nf\ng\n';
  assert.ok(manyLines.length <= config.maxTriggerChars, 'fixture trips the char cap first');
  assert.ok(
    manyLines.split('\n').length > config.maxTriggerLines,
    'fixture no longer exceeds the line cap',
  );
  assert.equal(shouldTrigger(manyLines, '', 'html'), false);
});

check('pattern below the scan window does NOT fire', () => {
  // '<!doctype html>' on line 5 is past patternScanLines, so it is not a
  // fresh-file opening pattern even though the file is still short.
  assert.equal(shouldTrigger('a\nb\nc\nd\n<!doctype html>', '', 'html'), false);
});

check('JS has no configured pattern, so does NOT fire', () => {
  assert.equal(shouldTrigger('const x = 1;', '', 'javascript'), false);
});

check('CSS has no configured pattern, so does NOT fire', () => {
  assert.equal(shouldTrigger('body {', '', 'css'), false);
});

check('unsupported language does NOT fire', () => {
  assert.equal(shouldTrigger('import os', '', 'python'), false);
});

// --- Andre's exact repro, 2026-08-07 (BUG 1) --------------------------------
// A PHP file with four lines of REAL code still offered a completion with the
// cursor on the blank line 5:
//
//   1  <?php
//   2  // a comment
//   3  echo "something";
//   4  ?>
//   5  |cursor
//
// Per spec Code Inference fires on NEAR-EMPTY files only. This file is 45-odd
// chars over 5 lines, so it cleared maxTriggerChars=400 and maxTriggerLines=6
// legitimately -- those caps were never wrong, they were answering "is this
// file short?" when the spec asks "is this file empty apart from the opener?".
//
// The buffer is split at the cursor exactly as the renderer sends it: everything
// before the cursor is the prefix, so line 5 being blank means the prefix ends
// with a trailing newline and the suffix is empty.
const PHP_REPRO_PREFIX = '<?php\n// a comment\necho "something";\n?>\n';

check('REPRO: 4-line PHP file with real code does NOT fire', () => {
  assert.equal(shouldTrigger(PHP_REPRO_PREFIX, '', 'php'), false);
});

check('REPRO: PHP is now rejected twice over -- inert language AND real content', () => {
  // AMENDED 2026-08-07, same day: PHP was dropped from the trigger list a few
  // hours after this repro was fixed, so the ORIGINAL assertion here ("rejected
  // by the content gate, not by the size caps") can no longer hold for a PHP
  // buffer -- the inert-language branch now short-circuits first, before any
  // gate the content rule lives in.
  //
  // Kept rather than deleted because the repro is still a real historical bug
  // and this file is the record of it. The content-gate assertion it used to
  // carry moved to the HTML analogue below, in a language that still triggers.
  const decision = triggerDecision(PHP_REPRO_PREFIX, '', 'php');
  assert.equal(decision.ok, false);
  assert.ok(
    decision.reason.includes('no configured patterns'),
    `expected the inert-language branch to reject this first, got: ${decision.reason}`,
  );
  // The repro's defining property is unchanged and still worth asserting: it
  // clears both size caps, which is why the caps could never have fixed BUG 1.
  assert.ok(
    PHP_REPRO_PREFIX.length <= config.maxTriggerChars,
    'repro no longer clears the char cap -- it is no longer the reported repro',
  );
  assert.ok(
    PHP_REPRO_PREFIX.split('\n').length <= config.maxTriggerLines,
    'repro no longer clears the line cap -- it is no longer the reported repro',
  );
});

check('REPRO: the same file via the real IPC entry point reports no offer', () => {
  assert.deepEqual(
    checkTrigger({ prefix: PHP_REPRO_PREFIX, suffix: '', language: 'php' }),
    { triggered: false },
  );
});

// --- BUG 1's content gate, ported to HTML -----------------------------------
// The structural twin of the PHP repro in a language that still triggers: four
// lines, real content, cursor on the blank line 5.
//
//   1  <!doctype html>
//   2  <html>
//   3  <body>Hello</body>
//   4  </html>
//   5  |cursor
//
// This is now where BUG 1's fix is actually verified. Without it, dropping PHP
// would have silently retired the only reason-asserting coverage of the
// near-empty content gate.
const HTML_CONTENT_REPRO = '<!doctype html>\n<html>\n<body>Hello</body>\n</html>\n';

check('a 4-line HTML file with real content does NOT fire', () => {
  assert.equal(shouldTrigger(HTML_CONTENT_REPRO, '', 'html'), false);
});

check('...and is rejected by the content gate, not by the size caps', () => {
  // Asserts WHICH guard fired. Without this, the test above could pass for the
  // wrong reason -- a future retune of maxTriggerChars/maxTriggerLines could
  // reject this incidentally while leaving the near-empty rule broken.
  const decision = triggerDecision(HTML_CONTENT_REPRO, '', 'html');
  assert.equal(decision.ok, false);
  assert.ok(
    decision.reason.includes('content line'),
    `expected the near-empty content gate to reject this, got: ${decision.reason}`,
  );
  // Sanity: prove it really does clear both size caps, so the content gate is
  // doing load-bearing work rather than shadowing an existing check.
  assert.ok(
    HTML_CONTENT_REPRO.length <= config.maxTriggerChars,
    'fixture no longer clears the char cap',
  );
  assert.ok(
    HTML_CONTENT_REPRO.split('\n').length <= config.maxTriggerLines,
    'fixture no longer clears the line cap',
  );
});

check('a genuinely fresh file with the cursor on line 2 STILL fires', () => {
  // The guard has to reject the repro without killing the feature's only real
  // use case. This is the case Code Inference exists for.
  assert.equal(shouldTrigger('<!doctype html>\n', '', 'html'), true);
});

check('a lone opener followed by blank lines STILL fires', () => {
  // Why retuning maxTriggerLines could never have fixed BUG 1: this file is as
  // many lines as the repro but contains no content at all.
  assert.equal(shouldTrigger('<!doctype html>\n\n\n\n', '', 'html'), true);
});

check('mid-scaffold HTML (doctype + <html>) STILL fires', () => {
  // One content line beyond the opener is still scaffolding, not a real file.
  assert.equal(shouldTrigger('<!doctype html>\n<html>\n', '', 'html'), true);
});

check('a C# file with one real statement does NOT fire', () => {
  // The tightest boundary case in the repro's direction: a single statement past
  // the opener is still real code, not boilerplate to scaffold.
  const cs = 'using System;\nConsole.WriteLine("hi");\nsomething();\n';
  assert.equal(shouldTrigger(cs, '', 'csharp'), false);
});

check('a Dart file with real code beyond the import does NOT fire', () => {
  // Third language, to prove the gate is not HTML-specific -- 'import' matched
  // on line 1 while lines 2-4 are a real program.
  const dart = "import 'dart:io';\nvoid main() {\n  print('hi');\n}\n";
  assert.equal(shouldTrigger(dart, '', 'dart'), false);
});

console.log('\n--- checkCodeInferenceTrigger (the IPC entry point) ---');

check('an eligible buffer reports triggered: true', () => {
  // Was '<?php'/php until 2026-08-07; PHP is no longer an eligible language, so
  // this needed a language that still triggers or it would assert the opposite
  // of its own name.
  assert.deepEqual(checkTrigger({ prefix: '<!doctype html>', suffix: '', language: 'html' }), {
    triggered: true,
  });
});

check('an ineligible buffer reports triggered: false', () => {
  assert.deepEqual(checkTrigger({ prefix: 'const x = 1;', suffix: '', language: 'javascript' }), {
    triggered: false,
  });
});

console.log('\n--- FIM prompt construction ---');

// NOTE on 'php' appearing below: buildFimPrompt() is language-agnostic -- the
// language is a string it labels a section with, not something it branches on --
// so these still test exactly what they say they test. They are deliberately NOT
// re-pointed after PHP was dropped from the trigger list on 2026-08-07: 'php'
// here is an arbitrary language label, and rewriting five assertions to say
// 'csharp' would be churn that proves nothing new. The same applies to the
// '<?php' strings used as prefix fixtures in the sanitizer section -- sanitize()
// never consults the language either.

check('prompt sends prefix and suffix as separate labelled sections', () => {
  const prompt = buildFimPrompt('<?php\n', '\n?>', 'php');
  assert.ok(prompt.includes('### Code before the cursor:'), 'missing prefix section');
  assert.ok(prompt.includes('### Code after the cursor:'), 'missing suffix section');
  // Order matters: the model continues from the end of the prefix section, so
  // the suffix must come after it, not before.
  assert.ok(
    prompt.indexOf('### Code before the cursor:') < prompt.indexOf('### Code after the cursor:'),
    'prefix section must precede suffix section',
  );
  assert.ok(prompt.includes('### Language:\nphp'), 'language not declared');
});

check('an empty suffix is labelled explicitly, not left blank', () => {
  // A blank section reads as "there is code here that I am not showing you".
  const prompt = buildFimPrompt('<?php', '', 'php');
  assert.ok(prompt.includes('(nothing after the cursor)'));
});

check('prompt contains no backticks (nothing suggests fenced output)', () => {
  const prompt = buildFimPrompt('<!DOCTYPE html>', '\n</html>', 'html');
  assert.ok(!prompt.includes('`'), 'a backtick invites a fenced-code answer');
});

check('an over-long prefix is truncated from the LEFT, keeping the cursor end', () => {
  // The characters nearest the cursor are the ones that matter; dropping the
  // tail instead of the head would remove exactly the context being completed.
  const longPrefix = `${'x'.repeat(5000)}<?php`;
  const prompt = buildFimPrompt(longPrefix, '', 'php');
  assert.ok(prompt.includes('<?php'), 'the text at the cursor was truncated away');
  assert.ok(prompt.length < longPrefix.length, 'prefix was not bounded at all');
});

console.log('\n--- sanitizer ---');

check('C# completion opening with a blank line survives (regression)', () => {
  // The naive "cut at the first \n\n" reading of the spec would truncate this
  // to an empty string, because the completion legitimately STARTS with a
  // blank line. cutAtBlankLine() skips leading whitespace first.
  const out = sanitize('\n\nnamespace App\n{\n}', 'using System;', '');
  assert.equal(out, '\n\nnamespace App\n{\n}');
});

check('trailing prose after a blank line is cut', () => {
  const out = sanitize('<html>\n</html>\n\nThis creates a page.', '<!DOCTYPE html>', '');
  assert.equal(out, '<html>\n</html>');
});

check('markdown fences are stripped', () => {
  const out = sanitize('```html\n<html>\n</html>\n```', '<!DOCTYPE html>', '');
  assert.equal(out, '<html>\n</html>');
});

check('suffix-overlapping tail is trimmed', () => {
  const out = sanitize('<html>\n<body>\n</body>\n</html>', '<!DOCTYPE html>\n', '\n</html>');
  assert.equal(out, '<html>\n<body>\n</body>');
});

check('suffix first line reappearing inside the completion is cut', () => {
  const out = sanitize('<head>\n</head>\n<body>', '<html>\n', '\n<body>\n</body>');
  assert.equal(out, '<head>\n</head>');
});

check('echoed prefix is stripped', () => {
  const out = sanitize('<?php\necho "hi";', '<?php', '');
  assert.equal(out, '\necho "hi";');
});

// --- Andre's exact repro, 2026-08-06 ---------------------------------------
// Typed '<!Doc' + 'type' in a fresh .html file, accepted the suggestion, got
// '<!Doctype<!DOCTYPE html>'. The model restated the doctype in canonical
// uppercase, and the then case-SENSITIVE echo strip did not match it, so the
// whole thing landed after the typed text.
//
// STILL RELEVANT AFTER THE 2026-08-07 PIVOT, which is why these four checks
// were kept rather than retired with the ghost-text code. The bug was never a
// rendering artifact or a typing race -- it is what the MODEL returns when the
// FIM prompt hands it a prefix. A confirmation-based flow inserts that same
// text at the same cursor, so removing the echo strip would reproduce the bug
// exactly.
//
// The completion is inserted at the cursor, so the document afterwards is
// exactly `prefix + completion` -- that concatenation is asserted directly
// rather than just the completion, because the duplication is only visible in
// the joined result.
check('REPRO: mixed-case doctype echo does not duplicate on accept', () => {
  const prefix = '<!Doctype';
  const out = sanitize('<!DOCTYPE html>', prefix, '');
  assert.equal(out, ' html>');
  assert.equal(prefix + out, '<!Doctype html>');
});

check('REPRO: same, with the model returning the full boilerplate', () => {
  const prefix = '<!Doctype';
  const raw = '<!DOCTYPE html>\n<html>\n<head>\n</head>\n</html>';
  const out = sanitize(raw, prefix, '');
  const document = prefix + out;
  const doctypeCount = document.toLowerCase().split('<!doctype').length - 1;
  assert.equal(doctypeCount, 1, `expected exactly one doctype, got: ${document}`);
  assert.equal(document, '<!Doctype html>\n<html>\n<head>\n</head>\n</html>');
});

check("REPRO: the student's own casing is preserved, not rewritten", () => {
  // Under ghost text this was FORCED: Monaco refused to render a suggestion
  // that replaced already-typed characters. Post-pivot a plain editor edit
  // could canonicalize '<!Doctype' to '<!DOCTYPE', so this is now a deliberate
  // choice rather than a constraint -- silently rewriting what the student
  // typed is a bigger behavioral change than the pivot is scoped for. The
  // assertion is kept to lock that choice in until it is revisited.
  const out = sanitize('<!DOCTYPE html>', '<!Doctype', '');
  assert.ok(!out.includes('<!DOCTYPE'), 'completion must not restate the doctype');
  assert.ok(out.startsWith(' '), 'completion must continue from the cursor');
});

check('echo strip is case-insensitive for C# too, keeping the blank line', () => {
  const out = sanitize('using system;\n\nnamespace App\n{\n}', 'using System;', '');
  assert.equal(out, '\n\nnamespace App\n{\n}');
});

check('a single coincidental shared character is NOT treated as an echo', () => {
  // 'abc' ends with 'c' and 'cde' starts with 'c', but that is a continuation,
  // not a restatement -- eating the 'c' would silently corrupt the insert.
  assert.equal(sanitize('cde', 'abc', ''), 'cde');
});

check('suffix overlap is matched case-insensitively', () => {
  const out = sanitize('<head>\n</head>\n<BODY>', '<html>\n', '\n<body>\n</body>');
  assert.equal(out, '<head>\n</head>');
});

check('prose answer is rejected', () => {
  assert.equal(sanitize("Sure, here is the standard boilerplate.", '<?php', ''), null);
});

check('empty completion is rejected', () => {
  assert.equal(sanitize('   \n  ', '<?php', ''), null);
});

check('over-length completion is rejected', () => {
  assert.equal(sanitize('x'.repeat(700), '<?php', ''), null);
});

check('trailing whitespace is trimmed', () => {
  assert.equal(sanitize('<html>   \n\t', '<!DOCTYPE html>', ''), '<html>');
});

console.log('\n--- blank-line cut (BUG 2: truncated HTML boilerplate) ---');

// --- Andre's exact repro, 2026-08-07 (BUG 2) --------------------------------
// A '<!doctype html>' completion came back missing '</body>' and '</html>'.
// Raising maxTokens 48 -> 128 changed NOTHING -- the output was byte-identical
// to before the bump, which ruled the token budget out entirely.
//
// Cause: standard HTML boilerplate contains a BLANK LINE inside
// '<body></body>' -- the empty space where page content goes. cutAtBlankLine()
// treated the first '\n\n' as "the model has finished talking" and truncated
// there unconditionally, so the completion was cut at '<body>' at ANY token
// budget. The budget was never in the path.
//
// Written as the raw text the model returns, blank line included, so the test
// exercises the real shape rather than a tidied-up one.
const HTML_REPRO_RAW = [
  '',
  '<html lang="en">',
  '<head>',
  '    <meta charset="UTF-8">',
  '    <title>Document</title>',
  '</head>',
  '<body>',
  '',
  '</body>',
  '</html>',
].join('\n');

check('REPRO: doctype completion keeps </body> and </html>', () => {
  const out = sanitize(HTML_REPRO_RAW, '<!doctype html>', '');
  assert.ok(out !== null, 'the completion was rejected outright');
  assert.ok(out.includes('</body>'), 'closing </body> was cut');
  assert.ok(out.includes('</html>'), 'closing </html> was cut');
});

check('REPRO: the blank line inside <body> is preserved, not collapsed', () => {
  // The fix must keep the blank line rather than stitch the tags together --
  // that empty line is where the student types, and it is the thing the old
  // implementation mistook for an end-of-output marker.
  const out = sanitize(HTML_REPRO_RAW, '<!doctype html>', '');
  assert.ok(
    out.includes('<body>\n\n</body>'),
    `expected the body's blank line to survive, got: ${JSON.stringify(out)}`,
  );
});

check('REPRO: the inserted document is a complete HTML file', () => {
  // Asserted on prefix + completion, because "complete" is a property of the
  // resulting file, not of the completion in isolation.
  const prefix = '<!doctype html>';
  const document = prefix + sanitize(HTML_REPRO_RAW, prefix, '');
  assert.ok(document.trimEnd().endsWith('</html>'), `document is unfinished: ${document}`);
  for (const tag of ['<html', '<head>', '</head>', '<body>', '</body>', '</html>']) {
    assert.ok(document.includes(tag), `document is missing ${tag}`);
  }
});

check('trailing prose is STILL cut when the markup before it is complete', () => {
  // The other half of the fix. Making cutAtBlankLine() structure-aware must not
  // turn it off -- a blank line after BALANCED markup is still a real stopping
  // point, and prose after it must not land in the student's file.
  const raw = '<html>\n<body>\n\n</body>\n</html>\n\nThis creates a basic page.';
  const out = sanitize(raw, '<!doctype html>', '');
  assert.equal(out, '<html>\n<body>\n\n</body>\n</html>');
  assert.ok(!out.includes('This creates'), 'prose leaked into the completion');
});

check('REPRO (braces): C# completion keeps both closing braces', () => {
  // Same bug, brace-structured language: the blank line inside the class body
  // truncated the completion and lost '}' and '}'.
  const raw = '\n\nnamespace App\n{\n    class Program\n    {\n\n    }\n}';
  const out = sanitize(raw, 'using System;', '');
  assert.equal(out, raw, 'a structurally incomplete cut point was used');
  assert.ok(out.trimEnd().endsWith('}\n}'), 'closing braces were cut');
});

// Focused unit checks on cutAtBlankLine() itself, so a regression is reported
// against the function that owns the behavior rather than as a vague
// sanitize() diff.
check('cutAtBlankLine does NOT cut while an HTML tag is unclosed', () => {
  assert.equal(cutAtBlankLine('<body>\n\n</body>'), '<body>\n\n</body>');
});

check('cutAtBlankLine does NOT cut while a brace is unclosed', () => {
  assert.equal(cutAtBlankLine('function f() {\n\n}'), 'function f() {\n\n}');
});

check('cutAtBlankLine DOES cut when the text is balanced', () => {
  assert.equal(cutAtBlankLine('<p>hi</p>\n\ntrailing'), '<p>hi</p>');
});

check('cutAtBlankLine cuts when the completion only CLOSES tags', () => {
  // Negative depth -- the completion closed what the prefix left open. That is
  // a finished fill-in-the-middle completion, not an unfinished one.
  assert.equal(cutAtBlankLine('</body>\n</html>\n\ntrailing'), '</body>\n</html>');
});

check('a void element does not count as an unclosed tag', () => {
  // Counting <meta>/<br>/<link> as open would make every real document look
  // permanently unfinished and disable the cut entirely.
  assert.equal(cutAtBlankLine('<meta charset="UTF-8">\n\ntrailing'), '<meta charset="UTF-8">');
});

check('a self-closing tag does not count as an unclosed tag', () => {
  assert.equal(cutAtBlankLine('<br />\n\ntrailing'), '<br />');
});

check('a brace inside a string literal does not count as unclosed', () => {
  assert.equal(cutAtBlankLine('echo "{";\n\ntrailing'), 'echo "{";');
});

check('a brace inside a comment does not count as unclosed', () => {
  assert.equal(cutAtBlankLine('// note {\n\ntrailing'), '// note {');
});

check('a completion opening with a blank line is still not truncated to nothing', () => {
  // The original reason cutAtBlankLine() skips leading whitespace. Re-asserted
  // here because the rewrite could plausibly have regressed it.
  assert.equal(cutAtBlankLine('\n\nnamespace App\n{\n}'), '\n\nnamespace App\n{\n}');
});

console.log('\n--- stop triggers from suffix ---');

check('closing brace in suffix becomes a stop trigger', () => {
  assert.deepEqual(buildStopTriggers('\n}'), ['}']);
});

check('closing tag in suffix becomes a stop trigger', () => {
  assert.deepEqual(buildStopTriggers('\n</html>'), ['</html>']);
});

check('non-closing suffix yields no stop trigger', () => {
  assert.deepEqual(buildStopTriggers('\nconsole.log(1);'), []);
});

check('empty suffix yields no stop trigger', () => {
  assert.deepEqual(buildStopTriggers(''), []);
});

console.log('\n--- token budget (regression: truncated HTML boilerplate) ---');

// Andre's repro, 2026-08-07: a fresh .html file completed via Code Inference
// came back missing '</body>' and '</html>' -- cut off mid-boilerplate. The
// budget was raised 48 -> 128 on the theory that it was too small.
//
// CORRECTED 2026-08-07 (later the same day): the bump did NOT fix it. The output
// came back identical, which ruled the budget out. The real cause was
// cutAtBlankLine() truncating at the blank line inside '<body></body>', and is
// covered by the 'BUG 2' section above. 48 was still genuinely too tight for a
// real boilerplate, so the bump stays and these checks stay with it -- but they
// were never testing the reported bug, and this section is NOT the regression
// test for it.
//
// These are BUDGET-ARITHMETIC checks, not model checks. Nothing here runs the
// model, so nothing here can prove the model actually emits a complete file --
// only that the budget and the sanitizer's length gate are no longer the thing
// standing in the way. What they do catch is the config silently regressing.

// A representative standard HTML boilerplate: the text the model is expected to
// return for a fresh file whose prefix is just the doctype. Indented, because
// that is what actually comes back and the indentation costs real tokens.
//
// WHY THIS FIXTURE MISSED BUG 2, worth recording: it has '<h1>Hello</h1>' inside
// the body, so it contains NO blank line anywhere -- and 'a full boilerplate
// survives the sanitizer uncut' below therefore passed cleanly the whole time
// the truncation bug was live. Real model output leaves the body EMPTY, which
// puts a '\n\n' in exactly the spot this fixture fills in. Left as-is (it is a
// valid token-budget fixture) with HTML_REPRO_RAW above carrying the blank line.
// The lesson is the general one: a fixture tidier than real output can hide the
// bug it was meant to catch.
const HTML_BOILERPLATE = [
  '<html lang="en">',
  '  <head>',
  '    <meta charset="UTF-8" />',
  '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
  '    <title>Document</title>',
  '  </head>',
  '  <body>',
  '    <h1>Hello</h1>',
  '  </body>',
  '</html>',
].join('\n');

// Deliberately pessimistic: llama-family tokenizers average roughly 3-4 chars
// per token on markup, so dividing by the LOW end over-estimates how many
// tokens the text needs. A budget that clears the pessimistic estimate clears
// the real one. (Sanity: at the old maxTokens=48 this estimate does not clear,
// which is exactly the reported bug.)
const CHARS_PER_TOKEN_LOW = 3;
const CHARS_PER_TOKEN_HIGH = 4;
const estimateTokens = (text) => Math.ceil(text.length / CHARS_PER_TOKEN_LOW);

check('maxTokens fits a standard HTML boilerplate, with headroom', () => {
  const needed = estimateTokens(HTML_BOILERPLATE);
  assert.ok(
    config.maxTokens >= needed,
    `maxTokens=${config.maxTokens} cannot hold a ~${HTML_BOILERPLATE.length}-char boilerplate ` +
      `(needs ~${needed} tokens) -- completions will be cut off mid-file`,
  );
  // Real files carry more than the minimum (a stylesheet link, a script tag, a
  // longer title), so a budget that only just fits is still a truncation bug
  // waiting to happen.
  assert.ok(
    config.maxTokens >= needed * 1.5,
    `maxTokens=${config.maxTokens} leaves no headroom over ~${needed} tokens`,
  );
});

check('the old 48-token budget would NOT have fit it (locks in the repro)', () => {
  // Guards the estimate itself: if this ever passes, estimateTokens has drifted
  // so far that the check above proves nothing.
  assert.ok(
    estimateTokens(HTML_BOILERPLATE) > 48,
    'the estimator no longer reproduces the truncation the bump was made to fix',
  );
});

check('a full boilerplate survives the sanitizer uncut', () => {
  // The budget is only half the story -- maxCompletionChars can discard a
  // completion the budget legitimately allowed. Rough length check plus the two
  // tags that were actually missing, not an exact text match.
  const prefix = '<!DOCTYPE html>\n';
  const out = sanitize(HTML_BOILERPLATE, prefix, '');
  assert.ok(out !== null, 'a complete boilerplate was rejected outright');
  assert.ok(out.includes('</body>'), 'closing </body> was cut');
  assert.ok(out.includes('</html>'), 'closing </html> was cut');
  assert.ok(
    out.length >= HTML_BOILERPLATE.length * 0.9,
    `completion lost ${HTML_BOILERPLATE.length - out.length} chars in post-processing`,
  );
});

check('maxCompletionChars can hold everything maxTokens can emit', () => {
  // If the budget can produce more text than the sanitizer's length gate
  // accepts, every long completion is silently thrown away and the student sees
  // nothing at all -- a worse failure than truncation. Uses the HIGH
  // chars-per-token end, the pessimistic direction for this check.
  const maxEmittableChars = config.maxTokens * CHARS_PER_TOKEN_HIGH;
  assert.ok(
    config.maxCompletionChars >= maxEmittableChars,
    `maxTokens=${config.maxTokens} can emit ~${maxEmittableChars} chars but ` +
      `maxCompletionChars=${config.maxCompletionChars} rejects above that -- ` +
      'long completions would be dropped instead of shown',
  );
});

// ===========================================================================
// GHOST PREVIEW (added 2026-08-07)
//
// The final step of the confirmation flow: once generation has finished and
// sanitize() has produced the final text, that text is PREVIEWED as grey ghost
// text at the cursor instead of being inserted immediately. Tab commits it, Esc
// or resuming typing throws it away.
//
// READ THE MODULE HEADER IN ghostPreview.ts BEFORE ASSUMING THE AUTO-FIRED
// GHOST TEXT IS BACK. It is not. Nothing here talks to the model, nothing is in
// flight while a preview is on screen, and no InlineCompletionsProvider is
// involved -- these tests drive a fixed, already-generated string.
//
// Testable under plain node because ghostPreview.ts never imports
// monaco-editor: every Monaco-specific value (key codes, the content-widget
// position preference, font metrics) is injected by the caller. So the fake
// editor below is a real test of the real logic, not a mock of a mock.
// ===========================================================================

const {
  showGhostPreview,
  splitGhostText,
  endOfInsertion,
} = await import(
  new URL('../src/renderer/components/inference/ghostPreview.ts', import.meta.url).href
);

const {
  bufferKey,
  readBufferKey,
  isSuppressed,
  MAX_DECLINE_KEY_CHARS,
} = await import(
  new URL('../src/renderer/components/inference/offerSuppression.ts', import.meta.url).href
);

// ghostPreview.ts calls document.createElement for the widget and view-zone
// nodes. Stubbed rather than injected: keeping the real DOM code path under
// test is worth more than one more constructor parameter, and the surface it
// actually uses is four properties wide.
globalThis.document = {
  createElement: (tagName) => ({ tagName, className: '', textContent: '', style: {} }),
};

// In production these come from monaco.KeyCode.Tab / .Escape. The values are
// injected precisely so this file does not have to know or hardcode Monaco's
// enum -- any two distinct numbers exercise the same branch.
const KEY = { tab: 2, escape: 9 };

function createFakeEditor({ versionId = 1 } = {}) {
  const calls = [];
  const buckets = { key: [], content: [], cursor: [], model: [], dispose: [] };
  const contentWidgets = new Map();
  const viewZones = new Map();
  let version = versionId;
  let zoneSeq = 0;

  const subscribe = (bucket) => (fn) => {
    bucket.push(fn);
    return {
      dispose() {
        const at = bucket.indexOf(fn);
        if (at !== -1) bucket.splice(at, 1);
      },
    };
  };
  // Copied before iterating, because a listener disposing itself mid-emit is
  // exactly what commit() does -- Monaco tolerates it and so must this.
  const emit = (bucket, arg) => [...bucket].forEach((fn) => fn(arg));

  return {
    calls,
    contentWidgets,
    viewZones,

    getModel: () => ({ getVersionId: () => version }),
    pushUndoStop: () => calls.push({ op: 'pushUndoStop' }),
    executeEdits: (source, edits) => {
      calls.push({ op: 'executeEdits', source, edits });
      // Real Monaco bumps the version and fires a content change here. Modelled
      // deliberately: it is the thing that would make a commit cancel itself
      // halfway through if the preview did not dispose its own listeners first.
      version += 1;
      emit(buckets.content);
      return true;
    },
    setPosition: (position) => {
      calls.push({ op: 'setPosition', position });
      emit(buckets.cursor);
    },
    revealPositionInCenterIfOutsideViewport: (position) =>
      calls.push({ op: 'reveal', position }),
    focus: () => calls.push({ op: 'focus' }),
    addContentWidget: (widget) => {
      calls.push({ op: 'addContentWidget' });
      contentWidgets.set(widget.getId(), widget);
    },
    removeContentWidget: (widget) => {
      calls.push({ op: 'removeContentWidget' });
      contentWidgets.delete(widget.getId());
    },
    changeViewZones: (callback) =>
      callback({
        addZone: (zone) => {
          zoneSeq += 1;
          const id = `zone-${zoneSeq}`;
          viewZones.set(id, zone);
          calls.push({ op: 'addZone' });
          return id;
        },
        removeZone: (id) => {
          viewZones.delete(id);
          calls.push({ op: 'removeZone' });
        },
      }),
    onKeyDown: subscribe(buckets.key),
    onDidChangeModelContent: subscribe(buckets.content),
    onDidChangeCursorPosition: subscribe(buckets.cursor),
    onDidChangeModel: subscribe(buckets.model),
    onDidDispose: subscribe(buckets.dispose),

    // --- test drivers, not part of the editor surface ---------------------
    ops: () => calls.map((call) => call.op),
    edits: () => calls.filter((call) => call.op === 'executeEdits'),
    // Just the undo/edit sequence, which is what "one undo step" is a claim about.
    undoSequence: () =>
      calls
        .filter((call) => call.op === 'pushUndoStop' || call.op === 'executeEdits')
        .map((call) => call.op),
    press(keyCode) {
      const event = {
        keyCode,
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopPropagation() {
          this.propagationStopped = true;
        },
      };
      emit(buckets.key, event);
      return event;
    },
    type() {
      version += 1;
      emit(buckets.content);
    },
    moveCursor: () => emit(buckets.cursor),
    swapModel: () => emit(buckets.model),
    // An edit this preview never saw -- the only way to reach commit()'s stale
    // guard, since any change it DID see would have discarded it first.
    bumpVersionSilently: () => {
      version += 1;
    },
  };
}

// The doctype continuation, post-sanitize: what the model actually returns for
// a fresh .html file once stripPrefixEcho has removed the restated '<!DOCTYPE'.
const DOCTYPE_COMPLETION = ' html>\n<html>\n<body>\n</body>\n</html>';
const AT = { lineNumber: 1, column: 16 };

function showAt(editor, text = DOCTYPE_COMPLETION, extra = {}) {
  return showGhostPreview({
    editor,
    text,
    position: AT,
    versionId: 1,
    keyCodes: KEY,
    contentWidgetPreference: [0],
    editSource: 'code-inference',
    ...extra,
  });
}

console.log('\n--- ghost preview: appearance ---');

check('the preview renders the sanitized completion, split across widget + view zone', () => {
  const editor = createFakeEditor();
  const handle = showAt(editor);

  assert.equal(editor.contentWidgets.size, 1, 'no content widget was added');
  const [widget] = [...editor.contentWidgets.values()];
  assert.equal(
    widget.getDomNode().textContent,
    ' html>',
    'the inline part must be line 1 of the completion',
  );

  assert.equal(editor.viewZones.size, 1, 'no view zone for the remaining lines');
  const [zone] = [...editor.viewZones.values()];
  assert.equal(zone.domNode.textContent, '<html>\n<body>\n</body>\n</html>');
  assert.equal(zone.heightInLines, 4, 'view zone must be as tall as the lines it holds');
  assert.equal(zone.afterLineNumber, AT.lineNumber, 'view zone is not under the cursor line');

  assert.equal(handle.isVisible(), true);
});

check('what is previewed reconstructs to EXACTLY the generated text', () => {
  // The whole point of a preview is that it shows what Tab will insert. If the
  // split loses or adds a character, the preview is lying.
  const { inline, below } = splitGhostText(DOCTYPE_COMPLETION);
  assert.equal([inline, ...below].join('\n'), DOCTYPE_COMPLETION);
});

check('the preview is anchored at the cursor the completion was generated for', () => {
  const editor = createFakeEditor();
  showAt(editor);
  const [widget] = [...editor.contentWidgets.values()];
  assert.deepEqual(widget.getPosition().position, AT);
  assert.deepEqual(widget.getPosition().preference, [0]);
});

check('showing a preview inserts nothing', () => {
  // The defining property of the whole change: generation finishing no longer
  // writes to the file.
  const editor = createFakeEditor();
  showAt(editor);
  assert.deepEqual(editor.edits(), [], 'text was inserted before the student pressed Tab');
});

check('a single-line completion needs no view zone', () => {
  const editor = createFakeEditor();
  showAt(editor, ' html>');
  assert.equal(editor.contentWidgets.size, 1);
  assert.equal(editor.viewZones.size, 0, 'an empty view zone was added anyway');
});

check('a completion that OPENS with a blank line previews correctly', () => {
  // The C# shape: 'using System;' -> '\n\nnamespace App\n{\n}'. Line 1 is empty,
  // so the inline widget is empty and everything real lives in the view zone.
  // Same fixture that broke cutAtBlankLine(), for the same reason -- a leading
  // blank line is a real thing the model produces.
  const editor = createFakeEditor();
  const text = '\n\nnamespace App\n{\n}';
  showAt(editor, text);
  const [widget] = [...editor.contentWidgets.values()];
  const [zone] = [...editor.viewZones.values()];
  assert.equal(widget.getDomNode().textContent, '');
  assert.equal(zone.domNode.textContent, '\nnamespace App\n{\n}');
  assert.equal(zone.heightInLines, 4);
});

check('preview nodes are styled as muted, non-interactive text', () => {
  const editor = createFakeEditor();
  showAt(editor);
  const [widget] = [...editor.contentWidgets.values()];
  const style = widget.getDomNode().style;
  assert.ok(style.color, 'ghost text has no explicit colour, so it would read as real code');
  // 'pre' is load-bearing, not cosmetic: without it the indentation of
  // '    <meta charset="UTF-8">' collapses and the preview stops matching what
  // Tab inserts.
  assert.equal(style.whiteSpace, 'pre');
  assert.equal(style.pointerEvents, 'none', 'clicks would not reach the editor');
});

console.log('\n--- ghost preview: Tab commits ---');

check('Tab inserts the previewed text as a single undo step', () => {
  const editor = createFakeEditor();
  let committed = null;
  let discarded = null;
  const handle = showAt(editor, DOCTYPE_COMPLETION, {
    onCommit: (text) => {
      committed = text;
    },
    onDiscard: (cause) => {
      discarded = cause;
    },
  });

  editor.press(KEY.tab);

  // The claim being locked in: pushUndoStop -> ONE executeEdits -> pushUndoStop,
  // byte-for-byte the sequence the pre-preview direct insert used. Ctrl+Z after
  // this removes the whole completion in one press instead of unwinding it.
  assert.deepEqual(editor.undoSequence(), ['pushUndoStop', 'executeEdits', 'pushUndoStop']);
  assert.equal(editor.edits().length, 1, 'the completion was inserted in more than one edit');

  const [{ source, edits }] = editor.edits();
  assert.equal(source, 'code-inference');
  assert.equal(edits.length, 1);
  assert.equal(edits[0].text, DOCTYPE_COMPLETION, 'inserted text differs from what was previewed');
  assert.equal(edits[0].forceMoveMarkers, true);
  // A zero-width range: an INSERT at the cursor, not a replace. This is what
  // keeps the student's own typed characters (and their casing) untouched --
  // see the '<!Doctype' repro above.
  assert.deepEqual(edits[0].range, {
    startLineNumber: AT.lineNumber,
    startColumn: AT.column,
    endLineNumber: AT.lineNumber,
    endColumn: AT.column,
  });

  assert.equal(committed, DOCTYPE_COMPLETION, 'onCommit did not report the committed text');
  assert.equal(discarded, null, 'committing also fired a discard');
  assert.equal(handle.isVisible(), false);
});

check('Tab is swallowed, so Monaco does not also indent the line', () => {
  const editor = createFakeEditor();
  showAt(editor);
  const event = editor.press(KEY.tab);
  assert.equal(event.defaultPrevented, true, 'focus would leave the editor');
  assert.equal(event.propagationStopped, true, "Monaco's own tab command would still run");
});

check('committing removes the preview before editing', () => {
  // Order matters. executeEdits fires a content change, and the preview's own
  // content-change listener discards on it -- so a commit that left its
  // listeners attached would cancel itself halfway through. The fake editor
  // fires that event for real, so this test would fail if the order regressed.
  const editor = createFakeEditor();
  showAt(editor);
  editor.press(KEY.tab);
  assert.equal(editor.contentWidgets.size, 0, 'ghost widget survived the commit');
  assert.equal(editor.viewZones.size, 0, 'ghost view zone survived the commit');
  const ops = editor.ops();
  assert.ok(
    ops.indexOf('removeContentWidget') < ops.indexOf('executeEdits'),
    'the widget was removed after the edit, not before',
  );
});

check('the cursor lands at the end of the inserted text', () => {
  const editor = createFakeEditor();
  showAt(editor);
  editor.press(KEY.tab);
  const setPosition = editor.calls.find((call) => call.op === 'setPosition');
  assert.ok(setPosition, 'the cursor was left where it was, inside the old text');
  assert.deepEqual(
    setPosition.position,
    endOfInsertion(DOCTYPE_COMPLETION, AT.lineNumber, AT.column),
  );
  // Multi-line completion, so the cursor must have moved DOWN, not just right.
  assert.equal(setPosition.position.lineNumber, AT.lineNumber + 4);
});

check('a second Tab cannot insert the completion twice', () => {
  const editor = createFakeEditor();
  const handle = showAt(editor);
  editor.press(KEY.tab);
  editor.press(KEY.tab);
  assert.equal(editor.edits().length, 1);
  assert.equal(handle.commit(), false, 'commit() succeeded on a preview that is gone');
});

check('commit refuses on a buffer that moved underneath it', () => {
  const editor = createFakeEditor();
  let discarded = null;
  const handle = showAt(editor, DOCTYPE_COMPLETION, {
    onDiscard: (cause) => {
      discarded = cause;
    },
  });
  editor.bumpVersionSilently();
  assert.equal(handle.commit(), false);
  assert.deepEqual(editor.edits(), [], 'stale text was inserted anyway');
  assert.equal(discarded, 'stale');
});

console.log('\n--- ghost preview: Esc and typing discard ---');

check('Esc discards without inserting anything', () => {
  const editor = createFakeEditor();
  let committed = null;
  let discarded = null;
  const handle = showAt(editor, DOCTYPE_COMPLETION, {
    onCommit: (text) => {
      committed = text;
    },
    onDiscard: (cause) => {
      discarded = cause;
    },
  });

  const event = editor.press(KEY.escape);

  assert.deepEqual(editor.edits(), [], 'Esc inserted text');
  assert.deepEqual(editor.undoSequence(), [], 'Esc touched the undo stack');
  assert.equal(discarded, 'escape');
  assert.equal(committed, null);
  assert.equal(handle.isVisible(), false);
  assert.equal(editor.contentWidgets.size, 0, 'ghost widget was left on screen');
  assert.equal(editor.viewZones.size, 0, 'ghost view zone was left on screen');
  assert.equal(event.defaultPrevented, true);
});

check('resuming normal typing discards without inserting anything', () => {
  const editor = createFakeEditor();
  let discarded = null;
  const handle = showAt(editor, DOCTYPE_COMPLETION, {
    onDiscard: (cause) => {
      discarded = cause;
    },
  });

  editor.type();

  assert.deepEqual(editor.edits(), [], 'typing through a preview inserted the completion');
  assert.equal(discarded, 'typing');
  assert.equal(handle.isVisible(), false);
  assert.equal(editor.contentWidgets.size, 0);
  assert.equal(editor.viewZones.size, 0);
});

check('Tab after typing it away does nothing', () => {
  // The preview is a preview of a buffer state that no longer exists. Once it
  // is gone the key handler must be gone with it, or a late Tab would paste a
  // completion built for different code.
  const editor = createFakeEditor();
  showAt(editor);
  editor.type();
  editor.press(KEY.tab);
  assert.deepEqual(editor.edits(), []);
});

check('moving the caret away discards the preview', () => {
  const editor = createFakeEditor();
  let discarded = null;
  showAt(editor, DOCTYPE_COMPLETION, {
    onDiscard: (cause) => {
      discarded = cause;
    },
  });
  editor.moveCursor();
  assert.equal(discarded, 'cursor');
  assert.deepEqual(editor.edits(), []);
});

check('switching the file out from under the preview discards it', () => {
  const editor = createFakeEditor();
  let discarded = null;
  showAt(editor, DOCTYPE_COMPLETION, {
    onDiscard: (cause) => {
      discarded = cause;
    },
  });
  editor.swapModel();
  assert.equal(discarded, 'model');
  assert.equal(editor.contentWidgets.size, 0);
});

check('discarding twice fires the callback once', () => {
  // Esc landing in the same tick as a content change must not double-report,
  // or the decline memo would be written twice with two different keys.
  const editor = createFakeEditor();
  const causes = [];
  const handle = showAt(editor, DOCTYPE_COMPLETION, {
    onDiscard: (cause) => causes.push(cause),
  });
  editor.press(KEY.escape);
  handle.discard('manual');
  editor.type();
  assert.deepEqual(causes, ['escape']);
});

console.log('\n--- ghost preview: a discarded preview does not re-offer ---');

// Mirrors what CodeInferencePrompt.tsx does in onDiscard: name the buffer state
// as it stands at discard time and put it in the same memo "No thanks" writes
// to. evaluate() then refuses to offer for that state.
function createFakeBuffer(text, cursorOffset, language = 'html') {
  return {
    getModel: () => ({
      getValue: () => text,
      getValueLength: () => text.length,
      getOffsetAt: () => cursorOffset,
      getLanguageId: () => language,
    }),
    getPosition: () => ({ lineNumber: 1, column: 1 }),
  };
}

const OFFER_TEXT = '<!doctype html>\n';
const OFFER_KEY = bufferKey('html', OFFER_TEXT, '');

check('Esc suppresses the exact state the preview was shown for', () => {
  const editor = createFakeEditor();
  const buffer = createFakeBuffer(OFFER_TEXT, OFFER_TEXT.length);
  let declinedKey = null;

  showAt(editor, DOCTYPE_COMPLETION, {
    onDiscard: () => {
      declinedKey = readBufferKey(buffer) ?? OFFER_KEY;
    },
  });
  editor.press(KEY.escape);

  assert.equal(declinedKey, OFFER_KEY, 'Esc named a different state than the one on screen');
  assert.equal(
    isSuppressed(OFFER_KEY, declinedKey),
    true,
    'the offer would come straight back for the state just rejected',
  );
});

check('typing it away suppresses the POST-keystroke state', () => {
  // The state that must not re-offer after a typing-discard is the one the
  // keystroke produced, not the one the offer was made against -- that one is
  // already in the past and suppressing it would achieve nothing.
  const editor = createFakeEditor();
  const typedText = `${OFFER_TEXT}<`;
  const buffer = createFakeBuffer(typedText, typedText.length);
  let declinedKey = null;

  showAt(editor, DOCTYPE_COMPLETION, {
    onDiscard: () => {
      declinedKey = readBufferKey(buffer) ?? OFFER_KEY;
    },
  });
  editor.type();

  assert.equal(declinedKey, bufferKey('html', typedText, ''));
  assert.equal(
    isSuppressed(bufferKey('html', typedText, ''), declinedKey),
    true,
    'the keystroke that dismissed the preview would immediately re-offer',
  );
});

check('a genuinely different buffer state is still allowed to offer', () => {
  // Deliberate, and identical to what "No thanks" has always done: the memo is
  // one exact state, not a permanent opt-out. Typing more produces a different
  // file, and a different file may be offered on.
  const declinedKey = OFFER_KEY;
  assert.equal(isSuppressed(bufferKey('html', `${OFFER_TEXT}<html>`, ''), declinedKey), false);
});

check('the cursor split is part of a state\'s identity', () => {
  // Same characters, different cursor -- a different completion request, so it
  // must not be suppressed by the other one's decline.
  assert.notEqual(bufferKey('html', '<!doctype html>', ''), bufferKey('html', '', '<!doctype html>'));
});

check('nothing is suppressed before anything has been declined', () => {
  assert.equal(isSuppressed(OFFER_KEY, null), false);
});

check('an oversized buffer yields no key, so the caller falls back', () => {
  // Guard against a paste-into-a-huge-file the instant a preview is showing
  // turning a dismissal into a whole-document getValue().
  const huge = 'x'.repeat(MAX_DECLINE_KEY_CHARS + 1);
  assert.equal(readBufferKey(createFakeBuffer(huge, 0)), null);
});

check('a closed editor yields no key rather than throwing', () => {
  assert.equal(readBufferKey({ getModel: () => null, getPosition: () => null }), null);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
