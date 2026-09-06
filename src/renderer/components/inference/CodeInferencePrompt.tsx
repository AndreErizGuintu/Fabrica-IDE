import { useCallback, useEffect, useRef, useState } from 'react';
import { useMonaco } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import {
  showGhostPreview,
  type GhostEditorLike,
  type GhostPreviewHandle,
} from './ghostPreview';
import {
  bufferKey,
  isSuppressed,
  readBufferKey,
  type SuppressionEditorLike,
} from './offerSuppression';

// ---------------------------------------------------------------------------
// Code Inference - confirmation-based boilerplate completion.
//
// Replaces CodeInferenceProvider.tsx, which registered a Monaco
// InlineCompletionsProvider and drew ghost text automatically. See DECISIONS.md
// 2026-08-07 for why that approach was scrapped: it put a 1-3s main-process
// generation in a permanent race with live typing, and every symptom
// (keystroke lag, duplicated text on accept, aborts with no clear cause) came
// out of that one structural fact rather than out of tuning.
//
// The flow here has no race to lose. Nothing reaches the model until the
// student clicks "Complete it", by which point typing has already stopped:
//   typing pause -> cheap trigger check (no model) -> offer -> accept
//     -> generate -> GHOST PREVIEW -> Tab inserts / Esc or typing discards.
//
// THE GHOST PREVIEW IS NOT A RETURN TO AUTO-FIRED GHOST TEXT. It is the last
// step, not the first: it renders a completion that has ALREADY been generated
// and sanitized, so the string it shows is fixed and nothing is in flight while
// it is on screen. See ghostPreview.ts for the full argument. The distinction
// that matters is which question is being asked -- the removed version asked
// the model "what goes here?" on a keystroke debounce; this asks the student
// "here is what I would insert, yes or no?" after the model has already
// answered.
//
// WHAT IS STILL GONE, AND WHY IT IS SAFE TO BE GONE:
//   - Monaco's InlineCompletionsProvider registration and its automatic
//     trigger/debounce machinery. The preview is a plain content widget plus a
//     view zone that this feature owns outright.
//   - AbortController / cancel-on-new-input. It existed to kill a generation
//     the student never asked for. They ask for this one, and by the time the
//     preview exists the generation has already finished -- there is nothing
//     left to abort.
//   - The dedupe memo and the post-generation cooldown. Both existed to stop
//     auto-fired generations chaining back to back while the student typed.
//     Nothing auto-fires, so there is nothing to chain.
//
// WHAT IS KEPT: the O(1) guards below, and a short debounce -- but the debounce
// is now purely cosmetic (see SETTINGS), not a model-protection mechanism.
//
// This does NOT reuse AdaptiveToast. That component is wired directly to
// window.adaptive (its own onSuggest subscription, dismiss IPC and hint call),
// so sharing it would mean making it generic over two unrelated feature
// backends. Its VISUAL language is copied deliberately instead -- same panel
// colour, accent border, gradient action button, corner dismiss -- so the two
// read as the same family of nudge without being coupled.
// ---------------------------------------------------------------------------

// Fallbacks used only if the config fetch from main fails. Main's
// codeInference.config.json is the real source of truth.
const FALLBACK_DEBOUNCE_MS = 500;
const FALLBACK_MAX_TRIGGER_CHARS = 400;
const FALLBACK_MAX_TRIGGER_LINES = 6;

// ===========================================================================
// TEMPORARY DIAGNOSTIC LOGGING - kept through the pivot so the new flow can be
// traced on its first real run. REMOVE, or gate behind a real debug setting,
// before defense. Flip this one flag to silence it.
// ===========================================================================
const CI_DEBUG = true;

const ciLog = (...args: unknown[]) => {
  if (CI_DEBUG) console.log('[CodeInference:renderer]', ...args);
};

const preview = (text: string, max = 60) =>
  JSON.stringify(text.length > max ? `${text.slice(0, max)}...` : text);

// Cosmetic only: how the language is named in the offer copy. A language
// missing from here still works, it just shows its raw Monaco id.
const LANGUAGE_LABELS: Record<string, string> = {
  html: 'HTML',
  css: 'CSS',
  php: 'PHP',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  csharp: 'C#',
  dart: 'Dart',
};

type Settings = {
  debounceMs: number;
  maxTriggerChars: number;
  maxTriggerLines: number;
};

type Offer = {
  editor: Monaco.editor.ICodeEditor;
  language: string;
  prefix: string;
  suffix: string;
  lineNumber: number;
  column: number;
  // The document state the offer was computed against. If it no longer matches
  // at insert time, the completion was written for a file that no longer
  // exists and must not be pasted in blind.
  versionId: number;
  // Viewport coords of the line the cursor was on, so the card can sit next to
  // it instead of in a fixed corner. Null means "fall back to the corner".
  screen: { top: number; left: number } | null;
};

// Cursor position in viewport coordinates, for placing the card near the code
// it is talking about.
function locateCursor(
  editor: Monaco.editor.ICodeEditor,
  position: Monaco.IPosition,
): { top: number; left: number } | null {
  const dom = editor.getDomNode();
  const visible = editor.getScrolledVisiblePosition(position);
  if (!dom || !visible) return null;
  const rect = dom.getBoundingClientRect();
  return {
    top: rect.top + visible.top + visible.height + 6,
    left: rect.left + visible.left,
  };
}

// Where the "Tab to insert" affordance sits: below the WHOLE preview, not below
// the cursor line, or it would cover the ghost text it is describing. The
// preview occupies one line at the cursor plus one view-zone line per remaining
// line of the completion.
function ghostHintPlacement(
  editor: Monaco.editor.ICodeEditor,
  position: Monaco.IPosition,
  text: string,
): { top: number; left: number } | null {
  const anchor = locateCursor(editor, position);
  if (!anchor) return null;
  const extraLines = text.split('\n').length - 1;
  const visible = editor.getScrolledVisiblePosition(position);
  const lineHeight = visible?.height ?? 19;
  return { top: anchor.top + extraLines * lineHeight, left: anchor.left };
}

// Reads the current buffer state's key. Cast for the same reason as the ghost
// editor below: offerSuppression.ts declares its own minimal editor surface so
// it never imports monaco-editor, and Monaco's ICodeEditor satisfies it
// structurally.
function currentBufferKey(editor: Monaco.editor.ICodeEditor): string | null {
  return readBufferKey(editor as unknown as SuppressionEditorLike);
}

export default function CodeInferencePrompt() {
  const monaco = useMonaco();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read by the editor listeners, which are subscribed once and must not close
  // over a stale `busy`. A generation in flight suppresses re-evaluation
  // entirely -- the student is watching a spinner, the card must not move or
  // disappear underneath them.
  const busyRef = useRef(false);
  // The one piece of dismissal state kept. NOT the old dedupe cache (which
  // existed to avoid spending the MODEL twice on one context, and is gone with
  // the auto-firing). This is a UI memo: it costs nothing, touches no model,
  // and stops the offer reappearing for the exact buffer state the student just
  // declined. Typing more produces a new state, and a new state may offer
  // again -- that is intended, the file genuinely changed.
  const declinedKeyRef = useRef<string | null>(null);

  // A ghost preview on screen suppresses re-evaluation exactly the way an
  // in-flight generation does. Same reason as busyRef: the editor listeners are
  // subscribed once and must not close over stale React state, and an offer
  // card must never appear on top of a preview the student is deciding on.
  const ghostRef = useRef<GhostPreviewHandle | null>(null);
  const ghostActiveRef = useRef(false);
  // Placement for the "Tab to insert" affordance, mirroring Offer.screen. Null
  // whenever no preview is showing.
  const [ghostHint, setGhostHint] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const dismiss = useCallback(() => {
    if (offer) {
      declinedKeyRef.current = bufferKey(
        offer.language,
        offer.prefix,
        offer.suffix,
      );
      ciLog(
        'DISMISSED by student; will not re-offer for this exact buffer state',
      );
    }
    setOffer(null);
    setError(null);
  }, [offer]);

  const accept = useCallback(async () => {
    if (!monaco || !offer || busyRef.current || ghostActiveRef.current) return;

    busyRef.current = true;
    setBusy(true);
    setError(null);
    ciLog(
      'ACCEPTED - requesting generation',
      `language=${offer.language} prefixLen=${offer.prefix.length}`,
      `prefixTail=${preview(offer.prefix.slice(-40))}`,
    );
    const startedAt = Date.now();

    try {
      const result = await window.codeInference.request({
        prefix: offer.prefix,
        suffix: offer.suffix,
        language: offer.language,
      });
      ciLog(
        'generation returned',
        `elapsed=${Date.now() - startedAt}ms`,
        `success=${result?.success}`,
        `suggestion=${result?.suggestion ? preview(result.suggestion, 120) : 'null'}`,
      );

      if (!result?.success || !result.suggestion) {
        setError("Couldn't generate a completion for this file — try again.");
        return;
      }

      const model = offer.editor.getModel();
      if (!model) {
        setError('That editor is no longer open.');
        return;
      }
      // No streaming and no partial insert: the text goes in once, complete, or
      // not at all. If the student edited while it generated, the completion
      // was built against a buffer that no longer exists -- inserting it at a
      // now-meaningless offset could land it mid-token, so it is discarded and
      // said so out loud rather than silently pasted or silently dropped.
      if (model.getVersionId() !== offer.versionId) {
        ciLog('DISCARDED: buffer changed while generating');
        setError(
          'Your code changed while this was generating — dismiss and try again.',
        );
        return;
      }

      const { suggestion } = result;

      // --- The one step the 2026-08-07 preview change touches ---------------
      // Everything above this point is unchanged: same trigger, same accept,
      // same generate(), same sanitize() on the main side. What used to happen
      // here was an immediate executeEdits. Now the finished text is PREVIEWED
      // first and only inserted on Tab.
      //
      // Nothing is generating any more at this point, so this preview cannot
      // race typing the way the removed auto-fired ghost text did. The string
      // below is final; the preview is just asking about it.

      // Focus goes back to the editor BEFORE the preview exists. The student
      // clicked a button, so focus is on that button -- without this, Tab would
      // move browser focus instead of reaching the editor's key handler, and
      // the preview would be uncommittable.
      offer.editor.focus();

      const fontInfo = offer.editor.getOption(
        monaco.editor.EditorOption.fontInfo,
      );
      const previewPosition = {
        lineNumber: offer.lineNumber,
        column: offer.column,
      };

      ghostActiveRef.current = true;
      setOffer(null);
      setGhostHint(
        ghostHintPlacement(offer.editor, previewPosition, suggestion),
      );

      ghostRef.current = showGhostPreview({
        // Monaco's ICodeEditor structurally satisfies GhostEditorLike, but the
        // cast is explicit: ghostPreview.ts declares its own minimal editor
        // surface precisely so it never imports monaco-editor, and pretending
        // the two nominal types are the same would defeat that.
        editor: offer.editor as unknown as GhostEditorLike,
        text: suggestion,
        position: previewPosition,
        versionId: offer.versionId,
        keyCodes: {
          tab: monaco.KeyCode.Tab,
          escape: monaco.KeyCode.Escape,
        },
        contentWidgetPreference: [
          monaco.editor.ContentWidgetPositionPreference.EXACT,
        ],
        font: {
          fontFamily: fontInfo.fontFamily,
          fontSize: fontInfo.fontSize,
          lineHeight: fontInfo.lineHeight,
        },
        editSource: 'code-inference',
        onCommit: () => {
          // The content and cursor events the commit's edit fires land while
          // ghostActiveRef is still true, so schedule() ignores them and no
          // re-evaluation is queued -- the same suppression the direct insert
          // used to get from busyRef. Finishing a completion should not
          // immediately offer another one; the next real keystroke restarts the
          // cycle.
          ghostRef.current = null;
          ghostActiveRef.current = false;
          setGhostHint(null);
          ciLog(
            `COMMITTED ${suggestion.length} chars at ${offer.lineNumber}:${offer.column}`,
          );
        },
        onDiscard: (cause) => {
          ghostRef.current = null;
          ghostActiveRef.current = false;
          setGhostHint(null);
          // Treated exactly like "No thanks": the state the student just said
          // no to goes in the same memo, so it cannot come straight back.
          // currentBufferKey() rather than the offer's key because for a
          // typing-caused discard the state that must be suppressed is the
          // post-keystroke one, not the one the offer was made against. For Esc
          // the two are identical.
          declinedKeyRef.current =
            currentBufferKey(offer.editor) ??
            bufferKey(offer.language, offer.prefix, offer.suffix);
          ciLog(
            `DISCARDED (${cause}); nothing inserted, and this buffer state will not re-offer`,
          );
        },
      });

      ciLog(
        `PREVIEWING ${suggestion.length} chars at ${offer.lineNumber}:${offer.column}`,
      );
    } catch (err) {
      ciLog('generation call threw', String(err));
      setError("Couldn't reach the model — try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [monaco, offer]);

  useEffect(() => {
    if (!monaco) return undefined;

    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const disposables: Monaco.IDisposable[] = [];
    const settings: Settings = {
      debounceMs: FALLBACK_DEBOUNCE_MS,
      maxTriggerChars: FALLBACK_MAX_TRIGGER_CHARS,
      maxTriggerLines: FALLBACK_MAX_TRIGGER_LINES,
    };

    const evaluate = async (editor: Monaco.editor.ICodeEditor) => {
      if (busyRef.current || ghostActiveRef.current) return;

      const model = editor.getModel();
      if (!model) {
        setOffer(null);
        return;
      }

      // --- O(1) guards, before the buffer is materialized -------------------
      // getLineCount() and getValueLength() are both cheap on Monaco's piece
      // tree. getValue() is NOT -- it builds a JS string of the whole buffer,
      // so it must never run on a large file just to find out it is large.
      // (This ordering came out of the 2026-08-06 delete-lag investigation and
      // is worth keeping regardless of what triggers what.)
      if (model.getLineCount() > settings.maxTriggerLines) {
        setOffer(null);
        return;
      }
      const valueLength = model.getValueLength();
      if (valueLength === 0 || valueLength > settings.maxTriggerChars) {
        setOffer(null);
        return;
      }

      const position = editor.getPosition();
      if (!position) {
        setOffer(null);
        return;
      }

      // Never offer mid-word or mid-expression: require the cursor to sit at
      // the end of its line, with only whitespace to its right. This is what
      // keeps '<?ph|p' from offering while '<?php|' still does.
      const lineContent = model.getLineContent(position.lineNumber);
      if (lineContent.slice(position.column - 1).trim().length > 0) {
        setOffer(null);
        return;
      }

      // Bounded by the length guard above, so this is a small string.
      const fullText = model.getValue();
      if (!fullText.trim()) {
        setOffer(null);
        return;
      }

      const offset = model.getOffsetAt(position);
      const prefix = fullText.slice(0, offset);
      const suffix = fullText.slice(offset);
      const language = model.getLanguageId();
      const key = bufferKey(language, prefix, suffix);

      if (isSuppressed(key, declinedKeyRef.current)) {
        ciLog('no offer: this exact buffer state was already declined');
        return;
      }

      // Main owns the patterns, so the eligibility question goes there. This is
      // a string match with no model, no lock and no counter behind it -- the
      // language list is deliberately NOT duplicated in the renderer, so
      // adding a language stays a one-file config edit.
      const versionId = model.getVersionId();
      let triggered = false;
      try {
        const result = await window.codeInference.checkTrigger({
          prefix,
          suffix,
          language,
        });
        triggered = Boolean(result?.triggered);
      } catch (err) {
        ciLog('trigger check failed', String(err));
        setOffer(null);
        return;
      }

      if (cancelled || busyRef.current || ghostActiveRef.current) return;
      if (!triggered) {
        setOffer(null);
        return;
      }
      // The buffer moved on while we asked. Not a race worth handling
      // elaborately -- the next typing pause re-evaluates from scratch.
      if (model.getVersionId() !== versionId) return;

      ciLog(
        `OFFERING completion for ${language}`,
        `at ${position.lineNumber}:${position.column}`,
        `prefixTail=${preview(prefix.slice(-40))}`,
      );
      setOffer({
        editor,
        language,
        prefix,
        suffix,
        lineNumber: position.lineNumber,
        column: position.column,
        versionId,
        screen: locateCursor(editor, position),
      });
    };

    const attach = (editor: Monaco.editor.ICodeEditor) => {
      // Hide first, then re-evaluate after the pause. An offer carries the
      // cursor position it was built for, so a stale one must never survive an
      // edit -- and the debounce is what stops the card flickering back in
      // between keystrokes. That is the debounce's ONLY remaining job: nothing
      // downstream of it reaches the model on its own any more.
      const schedule = () => {
        // A live ghost preview suppresses this outright, and that is what makes
        // "discarding by typing does not immediately re-offer" true rather than
        // merely likely. This listener is registered at attach time, so it runs
        // BEFORE the preview's own content-change listener (Monaco fires in
        // registration order) -- meaning on the keystroke that discards, the
        // flag is still set and no re-evaluation is queued at all. The memo set
        // in onDiscard then covers that resulting buffer state as well.
        if (busyRef.current || ghostActiveRef.current) return;
        setOffer(null);
        setError(null);
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (cancelled) return;
          evaluate(editor).catch((err) =>
            ciLog('evaluate failed', String(err)),
          );
        }, settings.debounceMs);
      };

      disposables.push(editor.onDidChangeModelContent(schedule));
      disposables.push(editor.onDidChangeCursorPosition(schedule));
      disposables.push(editor.onDidChangeModel(schedule));
      disposables.push(editor.onDidDispose(() => setOffer(null)));
      // Also evaluate on attach, so reopening a file that already begins with
      // '<?php' offers without needing a keystroke first.
      schedule();
    };

    const start = async () => {
      ciLog('monaco ready; fetching config from main...');
      try {
        const config = await window.codeInference.getConfig();
        ciLog('config received', JSON.stringify(config));
        if (config) {
          settings.debounceMs = config.debounceMs ?? settings.debounceMs;
          settings.maxTriggerChars =
            config.maxTriggerChars ?? settings.maxTriggerChars;
          settings.maxTriggerLines =
            config.maxTriggerLines ?? settings.maxTriggerLines;
        }
      } catch (err) {
        ciLog('config fetch FAILED, using fallbacks', String(err));
      }
      if (cancelled) return;

      monaco.editor.getEditors().forEach(attach);
      disposables.push(monaco.editor.onDidCreateEditor(attach));
      ciLog('watching editors with settings', JSON.stringify(settings));
    };

    start().catch((err) => ciLog('startup failed', String(err)));

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      disposables.forEach((d) => d.dispose());
      // A preview left mounted after teardown would be an orphaned content
      // widget and view zone with no key handler behind them -- grey text the
      // student cannot accept or dismiss.
      ghostRef.current?.discard('manual');
      ghostRef.current = null;
      ghostActiveRef.current = false;
      ciLog('detached from editors');
    };
  }, [monaco]);

  if (ghostHint) {
    // Shown only while a preview is on screen. Deliberately tiny and
    // non-interactive: the preview itself is the message, this just names the
    // two keys, since ghost text with no affordance reads as an artifact.
    return (
      <div
        className="fixed z-[2000] rounded-md px-2 py-1 pointer-events-none"
        style={{
          top: Math.max(8, Math.min(ghostHint.top, window.innerHeight - 40)),
          left: Math.max(8, Math.min(ghostHint.left, window.innerWidth - 220)),
          background: '#2d1b4e',
          border: '1px solid #a855f7',
          color: '#a7adc5',
          fontFamily: 'Space Mono, monospace',
          fontSize: 10,
          boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
        }}
      >
        Tab to insert · Esc to discard
      </div>
    );
  }

  if (!offer) return null;

  // Clamped so the card can't hang off the right or bottom edge when the cursor
  // is near either. Falls back to the bottom-right corner (AdaptiveToast's
  // position) if the cursor could not be located in the viewport.
  const CARD_WIDTH = 300;
  const placement = offer.screen
    ? {
        top: Math.min(offer.screen.top, window.innerHeight - 120),
        left: Math.min(offer.screen.left, window.innerWidth - CARD_WIDTH - 16),
      }
    : {
        top: window.innerHeight - 140,
        left: window.innerWidth - CARD_WIDTH - 16,
      };

  const label = LANGUAGE_LABELS[offer.language] ?? offer.language;

  return (
    <div
      role="status"
      className="fixed z-[2000] rounded-lg shadow-lg"
      style={{
        top: Math.max(8, placement.top),
        left: Math.max(8, placement.left),
        width: CARD_WIDTH,
        background: '#2d1b4e',
        border: '1px solid #a855f7',
        color: '#ffffff',
        fontFamily: 'Segoe UI, sans-serif',
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
      }}
    >
      <div className="flex items-start gap-2 px-3 py-2.5">
        <span className="text-base leading-none inline-flex" style={{ color: '#a855f7' }}>
          <i className="codicon codicon-sparkle" style={{ fontSize: '16px' }} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs leading-snug" style={{ color: '#e5e7eb' }}>
            {error ??
              `Looks like you're building a ${label} file — want me to complete it?`}
          </p>
          {!error && (
            <div className="flex items-center gap-2 mt-2">
              <button
                type="button"
                onClick={accept}
                disabled={busy}
                className="text-[11px] px-3 py-1 rounded-md font-medium"
                style={{
                  background: busy
                    ? '#3d2b5e'
                    : 'linear-gradient(135deg, #a855f7, #7c3aed)',
                  color: '#ffffff',
                  cursor: busy ? 'default' : 'pointer',
                  border: 'none',
                }}
              >
                {busy ? 'Generating…' : 'Complete it'}
              </button>
              {!busy && (
                <button
                  type="button"
                  onClick={dismiss}
                  className="text-[11px] px-2 py-1 rounded-md"
                  style={{
                    background: 'transparent',
                    color: '#a7adc5',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  No thanks
                </button>
              )}
            </div>
          )}
        </div>
        {!busy && (
          <button
            type="button"
            onClick={dismiss}
            className="text-[10px] shrink-0 hover:text-white transition-colors"
            style={{ color: '#a7adc5' }}
            title="Dismiss"
          >
            <i className="codicon codicon-close" style={{ fontSize: '12px' }} />
          </button>
        )}
      </div>
    </div>
  );
}
