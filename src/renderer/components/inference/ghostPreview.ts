// ---------------------------------------------------------------------------
// Ghost-text PREVIEW for Code Inference (added 2026-08-07, after the pivot).
//
// READ THIS BEFORE ASSUMING THE AUTO-GHOST-TEXT IS BACK. It is not.
//
// The version removed earlier tonight registered a Monaco
// InlineCompletionsProvider and fired generations on a debounce while the
// student typed. Every symptom it produced -- keystroke lag, duplicated text on
// accept, aborts with no clear cause -- came out of one structural fact: a 1-3s
// main-process generation racing live typing. That is still gone, and so is
// everything it needed to survive the race (AbortController cancellation, the
// dedupe memo, the post-generation cooldown).
//
// What this module does is the OPPOSITE end of the flow. It runs only AFTER
// generation has finished and sanitize() has produced a final, fixed string:
//
//   offer card -> accept -> generate -> sanitize -> [THIS] -> Tab commits
//                                                          -> Esc/typing discards
//
// There is nothing in flight while this is on screen. The text it renders is
// already decided and immutable, so there is no race to lose, nothing to cancel,
// and no reason to reach for Monaco's automatic trigger machinery. It is
// deliberately NOT an InlineCompletionsProvider: that API exists to answer
// "what should I suggest here?" on Monaco's own debounce, which is exactly the
// question this flow already answered before getting here. Registering one
// would re-couple us to the trigger system for zero benefit.
//
// So the rendering is plain and self-owned:
//   - line 1 of the completion goes in an IContentWidget anchored EXACTly at the
//     cursor, so it reads as a continuation of the line being typed;
//   - lines 2..n go in a view zone directly below that line, which is how
//     multi-line ghost text has to be drawn (a content widget is a single
//     absolutely-positioned box and cannot push document lines down).
// Both are painted in a muted foreground close to Monaco's own ghostTextForeground.
//
// MONACO IS NOT IMPORTED HERE, ON PURPOSE. Every Monaco-specific value this
// needs (the Tab/Esc key codes, the content-widget position preference, the
// editor's resolved font metrics) is injected by the caller, which already has
// the monaco namespace. That keeps this file a plain, deterministic module that
// scripts/test-code-inference.mjs can drive against a fake editor under plain
// node -- the same "test the real logic with no Electron and no model" approach
// the trigger filter and the sanitizer already use.
// ---------------------------------------------------------------------------

export type GhostPosition = { lineNumber: number; column: number };

export type GhostDisposable = { dispose(): void };

// Structural subsets of the Monaco types, declared locally so this module has
// no runtime import of monaco-editor. The real editor satisfies all of them.
export type GhostKeyboardEvent = {
  keyCode: number;
  preventDefault(): void;
  stopPropagation(): void;
};

export type GhostRange = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

export type GhostEdit = {
  range: GhostRange;
  text: string;
  forceMoveMarkers?: boolean;
};

export type GhostContentWidget = {
  getId(): string;
  getDomNode(): HTMLElement;
  getPosition(): {
    position: GhostPosition;
    preference: number[];
  } | null;
};

export type GhostViewZone = {
  afterLineNumber: number;
  heightInLines: number;
  domNode: HTMLElement;
};

export type GhostViewZoneAccessor = {
  addZone(zone: GhostViewZone): string;
  removeZone(id: string): void;
};

export type GhostEditorLike = {
  getModel(): { getVersionId(): number } | null;
  pushUndoStop(): unknown;
  executeEdits(source: string, edits: GhostEdit[]): unknown;
  setPosition(position: GhostPosition): void;
  revealPositionInCenterIfOutsideViewport(position: GhostPosition): void;
  focus(): void;
  addContentWidget(widget: GhostContentWidget): void;
  removeContentWidget(widget: GhostContentWidget): void;
  changeViewZones(callback: (accessor: GhostViewZoneAccessor) => void): void;
  onKeyDown(listener: (e: GhostKeyboardEvent) => void): GhostDisposable;
  onDidChangeModelContent(listener: () => void): GhostDisposable;
  onDidChangeCursorPosition(listener: () => void): GhostDisposable;
  onDidChangeModel(listener: () => void): GhostDisposable;
  onDidDispose(listener: () => void): GhostDisposable;
};

// Why a discard cause is carried rather than just "it went away": the caller
// suppresses re-offering differently depending on it, and the diagnostic log
// needs to distinguish "the student said no" from "the editor closed".
export type GhostDiscardCause =
  | 'escape' // Esc pressed
  | 'typing' // the buffer changed under it
  | 'cursor' // the caret moved off the preview point
  | 'model' // a different file was swapped into this editor
  | 'dispose' // the editor itself went away
  | 'stale' // the buffer moved between showing and committing
  | 'manual'; // the host tore it down (unmount, new offer)

export type GhostFont = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
};

export type GhostKeyCodes = { tab: number; escape: number };

export type GhostPreviewOptions = {
  editor: GhostEditorLike;
  // The FINAL sanitized completion. Fixed for the lifetime of the preview --
  // nothing streams into it and nothing regenerates it.
  text: string;
  position: GhostPosition;
  // The model version the completion was generated against. Commit refuses if
  // it no longer matches; belt-and-braces, since any content change discards
  // the preview outright before a commit could be attempted.
  versionId: number;
  keyCodes: GhostKeyCodes;
  // monaco.editor.ContentWidgetPositionPreference.EXACT, injected.
  contentWidgetPreference?: number[];
  font?: GhostFont | null;
  editSource?: string;
  onCommit?: (text: string) => void;
  onDiscard?: (cause: GhostDiscardCause) => void;
};

export type GhostPreviewHandle = {
  readonly text: string;
  isVisible(): boolean;
  commit(): boolean;
  discard(cause?: GhostDiscardCause): void;
};

// Close to Monaco's own editorGhostText.foreground on a dark theme (#ffffff56).
// Deliberately not a brand colour: this text is a preview of code, and reading
// as "not yet real" matters more than reading as Fabrica purple.
export const GHOST_TEXT_COLOR = 'rgba(255, 255, 255, 0.38)';

let widgetSequence = 0;

// Line 1 renders inline at the cursor; the rest render in a view zone below it.
// Exported for testing because "which part goes where" is the one piece of
// layout policy here, and it is what breaks if a completion legitimately opens
// with a blank line (the C# 'using System;' -> '\n\nnamespace App' shape).
export function splitGhostText(text: string): {
  inline: string;
  below: string[];
} {
  const lines = text.split('\n');
  return { inline: lines[0], below: lines.slice(1) };
}

// Where the cursor ends up after inserting `text` at (lineNumber, column).
// Moved here from CodeInferencePrompt.tsx along with the insert itself.
export function endOfInsertion(
  text: string,
  lineNumber: number,
  column: number,
): GhostPosition {
  const lines = text.split('\n');
  if (lines.length === 1) {
    return { lineNumber, column: column + text.length };
  }
  return {
    lineNumber: lineNumber + lines.length - 1,
    column: lines[lines.length - 1].length + 1,
  };
}

function applyGhostStyle(node: HTMLElement, font?: GhostFont | null): void {
  node.style.color = GHOST_TEXT_COLOR;
  // 'pre' so the completion's own indentation survives; without it the leading
  // spaces of '    <meta charset="UTF-8">' collapse and the preview no longer
  // looks like what Tab is about to insert.
  node.style.whiteSpace = 'pre';
  // The preview is not a target. Clicks must fall through to the editor, or
  // clicking "into" the ghost text would neither move the caret nor dismiss it.
  node.style.pointerEvents = 'none';
  node.style.userSelect = 'none';
  if (font) {
    node.style.fontFamily = font.fontFamily;
    node.style.fontSize = `${font.fontSize}px`;
    node.style.lineHeight = `${font.lineHeight}px`;
  }
}

export function showGhostPreview(
  options: GhostPreviewOptions,
): GhostPreviewHandle {
  const {
    editor,
    text,
    position,
    versionId,
    keyCodes,
    contentWidgetPreference = [0],
    font = null,
    editSource = 'code-inference',
    onCommit,
    onDiscard,
  } = options;

  const { inline, below } = splitGhostText(text);
  const listeners: GhostDisposable[] = [];
  let active = true;
  let zoneId: string | null = null;

  widgetSequence += 1;
  const widgetId = `fabrica.codeInference.ghost.${widgetSequence}`;

  const inlineNode = document.createElement('span');
  inlineNode.className = 'fabrica-ghost-text';
  inlineNode.textContent = inline;
  applyGhostStyle(inlineNode, font);

  const widget: GhostContentWidget = {
    getId: () => widgetId,
    getDomNode: () => inlineNode,
    getPosition: () => ({ position, preference: contentWidgetPreference }),
  };
  editor.addContentWidget(widget);

  if (below.length > 0) {
    const zoneNode = document.createElement('div');
    zoneNode.className = 'fabrica-ghost-text-block';
    zoneNode.textContent = below.join('\n');
    applyGhostStyle(zoneNode, font);
    editor.changeViewZones((accessor) => {
      zoneId = accessor.addZone({
        afterLineNumber: position.lineNumber,
        heightInLines: below.length,
        domNode: zoneNode,
      });
    });
  }

  // Idempotent, and the single place the preview stops existing. Returns false
  // if it had already been torn down, so commit/discard can't double-fire their
  // callbacks (Esc arriving in the same tick as a content change, say).
  const teardown = (): boolean => {
    if (!active) return false;
    active = false;
    listeners.forEach((listener) => listener.dispose());
    listeners.length = 0;
    editor.removeContentWidget(widget);
    if (zoneId !== null) {
      const id = zoneId;
      zoneId = null;
      editor.changeViewZones((accessor) => accessor.removeZone(id));
    }
    return true;
  };

  const discard = (cause: GhostDiscardCause = 'manual'): void => {
    if (!teardown()) return;
    onDiscard?.(cause);
  };

  const commit = (): boolean => {
    if (!active) return false;

    const model = editor.getModel();
    if (!model || model.getVersionId() !== versionId) {
      discard('stale');
      return false;
    }

    // Torn down BEFORE the edit, deliberately. executeEdits() fires a content
    // change, and this preview's own content-change listener discards on it --
    // so leaving the listeners attached would have the commit cancel itself
    // halfway through.
    teardown();

    // Byte-for-byte the direct-insert sequence the pre-preview flow used: one
    // undo stop either side of a single executeEdits, so Ctrl+Z removes the
    // whole completion in one press rather than unwinding it line by line.
    editor.pushUndoStop();
    editor.executeEdits(editSource, [
      {
        range: {
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        },
        text,
        forceMoveMarkers: true,
      },
    ]);
    editor.pushUndoStop();

    const end = endOfInsertion(text, position.lineNumber, position.column);
    editor.setPosition(end);
    editor.revealPositionInCenterIfOutsideViewport(end);
    editor.focus();

    onCommit?.(text);
    return true;
  };

  listeners.push(
    editor.onKeyDown((event) => {
      if (event.keyCode === keyCodes.tab) {
        // Both are needed. preventDefault() stops the browser moving focus out
        // of the editor; stopPropagation() stops the keydown reaching Monaco's
        // keybinding service, which would otherwise run its own 'tab' command
        // and indent the line underneath the insert.
        event.preventDefault();
        event.stopPropagation();
        commit();
      } else if (event.keyCode === keyCodes.escape) {
        event.preventDefault();
        event.stopPropagation();
        discard('escape');
      }
      // Every other key falls through untouched: the student types normally,
      // the content-change listener below notices, and the preview goes away.
    }),
  );
  listeners.push(editor.onDidChangeModelContent(() => discard('typing')));
  listeners.push(editor.onDidChangeCursorPosition(() => discard('cursor')));
  listeners.push(editor.onDidChangeModel(() => discard('model')));
  listeners.push(editor.onDidDispose(() => discard('dispose')));

  return {
    text,
    isVisible: () => active,
    commit,
    discard,
  };
}
