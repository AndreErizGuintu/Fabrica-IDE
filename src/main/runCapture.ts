/**
 * Server-side capture of a single terminal run's output.
 *
 * The integrated terminal types a command into a persistent cmd.exe pty, so the
 * pty's own exit event only fires when that shell closes — never when the run
 * itself finishes. To get a per-run completion signal, terminal:run appends a
 * sentinel echo to the command line; this module watches the same stream the
 * renderer receives, reassembles it into lines, strips the shell noise, and
 * reports { exitCode, output } once the sentinel appears.
 *
 * Deliberately imports nothing (no electron), like adaptiveEngine.ts: main.ts
 * owns the IPC send, this module only decides when there is something to send.
 * That also keeps it runnable under plain node for a future test harness.
 *
 * This is a read-only tap. The raw chunk forwarded to the renderer is never
 * modified by anything here — colour and cursor control must survive untouched
 * for the human looking at xterm. All stripping applies to the buffered copy.
 */

export const RUN_SENTINEL_TOKEN = '__FABRICA_EXIT__';

// `&` (not `&&`) so the echo runs whether the command succeeded or failed.
//
// `call echo` + `%^ERRORLEVEL%` reports the run's TRUE exit code. A plain
// `echo %ERRORLEVEL%` does not: cmd expands percent variables when it PARSES
// the line, before running anything, so it prints the errorlevel from BEFORE
// the command. The caret stops that first-pass expansion, and `call` forces a
// second parse after the command has finished, at which point the variable
// holds the real result.
//
// Verified across exit codes 0, 1, 2, 7, 42 and 255, each primed with a
// different prior errorlevel so a stale read would have been visible. Note the
// BATCH-file idiom `%%ERRORLEVEL%%` does NOT work here — typed into an
// interactive shell it prints the literal `%0%` — and `cmd /V:ON` with
// !ERRORLEVEL! was rejected deliberately, as it would change `!` handling for
// everything the student types.
// The sentinel exactly as it appears in the command line BEFORE cmd runs it:
// unexpanded, so it carries no digits. The shell echoes this verbatim when the
// command is typed, which makes it a reliable "the run has started" marker —
// see UNEXPANDED_SENTINEL's use as the capture gate below.
const UNEXPANDED_SENTINEL = `${RUN_SENTINEL_TOKEN}:%^ERRORLEVEL%`;

// Built FROM the marker so the two can never drift apart.
export const RUN_SENTINEL_SUFFIX = ` & call echo ${UNEXPANDED_SENTINEL}`;

// consumeLine() gates sentinel scanning on having seen a prompt first, which is
// what keeps the shell's echo of the command line from being read as a result.
// That gate is the load-bearing protection and must stay: the digit requirement
// here is only a secondary guard (the echoed line now shows the unexpanded
// `%^ERRORLEVEL%`, which carries no digits, but that is a property of the
// suffix above rather than something this pattern can rely on).
const SENTINEL_PATTERN = new RegExp(`${RUN_SENTINEL_TOKEN}:(-?\\d+)`);

// Removes the injected sentinel from a chunk on its way to the renderer, so the
// user never sees it: both the ` & call echo …%^ERRORLEVEL%` tail the shell
// echoes back on the command line, and the `__FABRICA_EXIT__:<code>` line it
// prints. Chunk-local by design — see stripSentinelForDisplay().
//
// `call` and the caret are optional in the match so this keeps working if
// RUN_SENTINEL_SUFFIX is revised again — this pattern MUST track that constant,
// or the sentinel becomes visible in the terminal.
const SENTINEL_DISPLAY_PATTERN = new RegExp(
  `\\s*&\\s*(?:call\\s+)?echo\\s+${RUN_SENTINEL_TOKEN}:%\\^?ERRORLEVEL%|${RUN_SENTINEL_TOKEN}:-?\\d+\\r?\\n?`,
  'g',
);

/**
 * Display-only filter for the raw renderer stream. Applied per chunk with no
 * buffering, so passthrough is never held back or reordered — the tradeoff is
 * that a sentinel straddling two pty chunks would still reach the terminal.
 * The capture path must keep receiving the UNFILTERED chunk, since the sentinel
 * is what tells it the run finished.
 */
export function stripSentinelForDisplay(text: string): string {
  return text.replace(SENTINEL_DISPLAY_PATTERN, '');
}

// OSC sequences get their OWN branch, placed FIRST in the alternation.
// cmd.exe sets the console title on every command (ESC ] 0 ; C:\Windows\
// SYSTEM32\cmd.exe - <command> BEL) and that payload contains backslashes and
// spaces. The CSI branch shares the ESC introducer and, left first, consumed
// only `ESC ] 0 ; C` -- the `C` falls inside its A-P terminator class -- which
// leaked the rest of the title into the buffer as visible text. The OSC payload
// here is "anything that is not a terminator", closed by either BEL or ST
// (ESC \), so both terminator forms are handled.
// eslint-disable-next-line no-control-regex
const OSC_PATTERN_SOURCE = '\\u001B\\][^\\u0007\\u001B]*(?:\\u0007|\\u001B\\\\)';

// CSI sequences (colour, cursor movement, erases).
//
// NOTE the intermediate class deliberately excludes `]`: with it, this branch
// matched a TRUNCATED OSC introducer (ESC ] 0 ; t -- `t` is in its q-u
// terminator range), destroying a sequence split across two pty chunks before
// the next chunk could complete it. ESC ] now belongs to the OSC branch alone.
// eslint-disable-next-line no-control-regex
const CSI_PATTERN_SOURCE = '[\\u001B\\u009B][[()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))';

const ANSI_PATTERN = new RegExp(`${OSC_PATTERN_SOURCE}|${CSI_PATTERN_SOURCE}`, 'g');

// Leftover control bytes after ANSI removal. Tab and newline are preserved.
// eslint-disable-next-line no-control-regex
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

// A cmd.exe prompt line: "C:\proj>" or a UNC "\\server\share>".
//
// COSMETIC ONLY. This was once the sentinel-safety gate; it is not any more.
// Live pty capture showed ConPTY redrawing the banner-to-prompt transition with
// cursor-positioning escapes instead of newlines, so the prompt text gets
// concatenated onto the end of the preceding text with no line break and this
// `^` anchor never matches. Gating on it meant sawPrompt never flipped and the
// real sentinel was skipped for the whole run. The gate now keys on
// UNEXPANDED_SENTINEL, which does not depend on line boundaries at all.
const PROMPT_PATTERN = /^(?:[A-Za-z]:\\|\\\\)[^>]*>/;

// cmd.exe's two-line startup banner, printed before the first prompt. Only
// filtered before a prompt has been seen, so a program that legitimately prints
// something similar mid-run is not swallowed.
const BANNER_PATTERNS = [/^Microsoft Windows \[/i, /Microsoft Corporation/i];

const MAX_OUTPUT_CHARS = 256 * 1024;

export type RunCompletion = {
  sessionId: string;
  // The run's real exit code, via the `call` + `%^ERRORLEVEL%` sentinel (see
  // RUN_SENTINEL_SUFFIX). 0 means the command genuinely succeeded, so
  // errorClassifier's `exitCode === 0 -> null` guard is now meaningful.
  // -1 is the sole synthetic value, used when the sentinel matched but its
  // digits could not be parsed.
  exitCode: number;
  output: string;
  truncated: boolean;
};

type Capture = {
  pending: string;
  lines: string[];
  charCount: number;
  truncated: boolean;
  // Opens sentinel scanning. Flips once the shell has echoed the unexpanded
  // command line, which is the only thing that can precede a real result.
  sawCommandEcho: boolean;
};

const captures = new Map<string, Capture>();

export function startCapture(sessionId: string) {
  captures.set(sessionId, {
    pending: '',
    lines: [],
    charCount: 0,
    truncated: false,
    sawCommandEcho: false,
  });
}

// Called when a run can no longer produce a sentinel: the pty exited, the user
// hit Stop, or the tab was closed. Drops the buffer WITHOUT reporting a
// completion, so a killed or still-looping run never fires a false result.
export function discardCapture(sessionId: string) {
  captures.delete(sessionId);
}

export function isCapturing(sessionId: string): boolean {
  return captures.has(sessionId);
}

// Removes complete OSC/CSI sequences only. Deliberately does NOT touch leftover
// control bytes: feedCapture runs this over the whole pending buffer, where a
// trailing ESC may be the start of a sequence the NEXT chunk completes. Killing
// that lone ESC early would orphan the rest of the sequence as visible garbage.
function stripEscapeSequences(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

// Leftover control bytes, applied per line once the line is known complete.
function stripControlBytes(text: string): string {
  return text.replace(CONTROL_PATTERN, '');
}

export function stripAnsi(text: string): string {
  return stripControlBytes(stripEscapeSequences(text));
}

/**
 * Collapse carriage-return rewrites within one line.
 *
 * MUST run only on text that has already had escape sequences removed. When it
 * ran first, a chunk like `__FABRICA_EXIT__:1\r<OSC title><CSI show-cursor>`
 * collapsed to the escape residue after the \r — which then stripped to nothing
 * — silently discarding the real sentinel that preceded it. Ordering is the
 * whole fix: strip first, collapse second.
 */
function collapseCarriageReturns(text: string): string {
  // A trailing CR is the CRLF terminator (feedCapture splits on \n), not a
  // rewrite marker.
  const withoutEol = text.endsWith('\r') ? text.slice(0, -1) : text;
  if (!withoutEol.includes('\r')) return withoutEol;

  // Progress bars and spinners rewrite one line repeatedly with \r; what the
  // user is left looking at is the last segment that actually drew something.
  // Walking back to the last NON-EMPTY segment (rather than blindly taking the
  // final one) is what stops a trailing rewrite-to-nothing from erasing real
  // content that preceded it.
  const segments = withoutEol.split('\r');
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (segments[i].trim() !== '') return segments[i];
  }
  return '';
}

function normalizeLine(raw: string): string {
  return stripControlBytes(collapseCarriageReturns(raw));
}

function pushLine(capture: Capture, line: string) {
  // Skip blank lines until there is real content, so output never starts with
  // the gap the shell leaves after its banner.
  if (!line && capture.lines.length === 0) return;
  if (capture.truncated) return;
  if (capture.charCount + line.length > MAX_OUTPUT_CHARS) {
    capture.truncated = true;
    return;
  }
  capture.lines.push(line);
  capture.charCount += line.length + 1;
}

function finalize(capture: Capture): string {
  const lines = [...capture.lines];
  while (lines.length > 0 && !lines[lines.length - 1].trim()) {
    lines.pop();
  }

  return lines.join('\n');
}

function consumeLine(sessionId: string, capture: Capture, line: string): RunCompletion | null {
  // The prompt check runs BEFORE the sentinel check, and sentinel scanning is
  // gated on having seen a prompt. Both matter:
  //
  // cmd.exe percent-expands the whole command line when it PARSES it, before
  // running anything, so the line it echoes back already reads
  // `... & echo __FABRICA_EXIT__:0` with a literal digit. Scanning that line
  // for the sentinel completed the capture instantly — before a single byte of
  // program output — reporting a stale exit code and an empty buffer. Dropping
  // the prompt line first, and refusing to scan anything before the first
  // prompt, makes the echoed copy structurally unreachable.
  // Cosmetic only — drops a well-formed prompt line from the buffered output.
  // No longer the safety gate; see PROMPT_PATTERN's note.
  if (PROMPT_PATTERN.test(line)) {
    return null;
  }

  // The echoed command line. Definitionally shell echo, never program output,
  // so it is dropped here too — which matters now that PROMPT_PATTERN cannot be
  // relied on to catch it when ConPTY concatenates the prompt onto other text.
  if (line.includes(UNEXPANDED_SENTINEL)) {
    return null;
  }

  const match = capture.sawCommandEcho ? line.match(SENTINEL_PATTERN) : null;
  if (match) {
    // A program whose last write had no trailing newline leaves its output on
    // the same line as the sentinel — keep that leading text, drop the sentinel.
    pushLine(capture, line.slice(0, match.index));

    const parsed = Number.parseInt(match[1], 10);
    captures.delete(sessionId);
    return {
      sessionId,
      exitCode: Number.isNaN(parsed) ? -1 : parsed,
      output: finalize(capture),
      truncated: capture.truncated,
    };
  }

  if (!capture.sawCommandEcho && BANNER_PATTERNS.some((pattern) => pattern.test(line))) {
    return null;
  }

  pushLine(capture, line);
  return null;
}

/**
 * Feed one raw pty chunk. Chunks arrive on arbitrary boundaries, so a partial
 * trailing line is carried over to the next call. Returns the completion once
 * the sentinel is seen (and retires the capture), otherwise null.
 */
export function feedCapture(sessionId: string, chunk: string): RunCompletion | null {
  const capture = captures.get(sessionId);
  if (!capture) return null;

  capture.pending += chunk;

  // Escape sequences come out of the WHOLE buffer first, before the line split
  // and before any \r collapsing. Order matters: an OSC title update sitting
  // after a \r used to make the collapse discard the real content in front of
  // it. Control bytes are left alone here — a trailing ESC may be the start of
  // a sequence the next chunk completes, and pending keeps it raw until then.
  capture.pending = stripEscapeSequences(capture.pending);

  // THE GATE. Opened by the shell echoing the unexpanded command line, found by
  // plain substring search over the whole buffer — no anchor, no line split, no
  // dependence on prompt format or on ConPTY emitting a newline where a human
  // would expect one. That last point is what broke the old prompt-anchored
  // gate: ConPTY redraws the banner-to-prompt transition with cursor-positioning
  // escapes rather than newlines, so the prompt never started a line and the
  // gate never opened, skipping the real sentinel for an entire run.
  //
  // Checked BEFORE the split, so it still sees text that is about to be emitted
  // as complete lines. Unterminated tails stay in `pending` across calls, so a
  // marker straddling two chunks is caught on the call that completes it.
  if (!capture.sawCommandEcho && capture.pending.includes(UNEXPANDED_SENTINEL)) {
    capture.sawCommandEcho = true;
  }

  const segments = capture.pending.split('\n');
  capture.pending = segments.pop() ?? '';

  for (let i = 0; i < segments.length; i += 1) {
    const completion = consumeLine(sessionId, capture, normalizeLine(segments[i]));
    if (completion) return completion;
  }

  // The sentinel echo is the last thing written and may land without a trailing
  // newline, so the partial tail has to be checked too or the run would never
  // be reported as complete.
  const tail = normalizeLine(capture.pending);
  if (SENTINEL_PATTERN.test(tail)) {
    capture.pending = '';
    return consumeLine(sessionId, capture, tail);
  }

  return null;
}
