// ---------------------------------------------------------------------------
// "Do not offer again for THIS buffer state" -- the one piece of dismissal
// memory Code Inference keeps.
//
// This is NOT the dedupe/cooldown cache that was removed during the 2026-08-07
// pivot. That one existed to stop auto-fired generations chaining back to back
// while the student typed; it guarded the MODEL. Nothing auto-fires any more,
// so nothing needs guarding. This is a pure UI memo: it costs nothing, touches
// no model, no lock and no counter, and its only job is to stop the offer card
// reappearing for a buffer state the student has already said no to.
//
// Split out of CodeInferencePrompt.tsx on 2026-08-07 when the ghost preview
// gained a second way to say no (Esc, or resuming typing). Three call sites now
// write to the same memo -- "No thanks", Esc, and typing through a preview --
// and they must agree exactly on how a buffer state is named or a decline in
// one path silently fails to suppress in another.
// ---------------------------------------------------------------------------

export type SuppressionPosition = { lineNumber: number; column: number };

// Structural subset of Monaco's editor/model, for the same reason ghostPreview.ts
// declares its own: this file stays importable under plain node.
export type SuppressionEditorLike = {
  getModel(): {
    getValue(): string;
    getValueLength(): number;
    getOffsetAt(position: SuppressionPosition): number;
    getLanguageId(): string;
  } | null;
  getPosition(): SuppressionPosition | null;
};

// Ceiling on materializing the buffer just to name a state. The file was under
// maxTriggerChars when it was offered on, so in practice this is never close --
// it exists so a paste-into-a-huge-file the instant a preview is showing can't
// turn a dismissal into a whole-document getValue().
export const MAX_DECLINE_KEY_CHARS = 4000;

// A buffer state is identified by language + everything before the cursor +
// everything after it. The cursor split matters: '<!doctype html>|' and
// '|<!doctype html>' are the same text but not the same completion request.
export function bufferKey(
  language: string,
  prefix: string,
  suffix: string,
): string {
  return JSON.stringify([language, prefix, suffix]);
}

// The key for the buffer as it stands RIGHT NOW.
//
// Used when a ghost preview is discarded. For Esc this is identical to the
// offer's own key, since nothing changed. For a discard caused by the student
// resuming typing it is the POST-keystroke state -- which is the one that has
// to be suppressed, because the offer's own state is already in the past and
// suppressing it would achieve nothing.
//
// Null when it can't be read cheaply (no model, no cursor, or a buffer that has
// grown past the ceiling above); callers fall back to the offer's key.
export function readBufferKey(editor: SuppressionEditorLike): string | null {
  const model = editor.getModel();
  const position = editor.getPosition();
  if (!model || !position) return null;
  if (model.getValueLength() > MAX_DECLINE_KEY_CHARS) return null;
  const fullText = model.getValue();
  const offset = model.getOffsetAt(position);
  return bufferKey(
    model.getLanguageId(),
    fullText.slice(0, offset),
    fullText.slice(offset),
  );
}

// Deliberately an exact-match memo of ONE state rather than a growing set.
// Typing more produces a genuinely different file, and a genuinely different
// file is allowed to be offered on -- that is intended behaviour, not a leak.
// What it guarantees is the narrow thing that was actually wrong to do: coming
// straight back for the state the student just rejected.
export function isSuppressed(key: string, declinedKey: string | null): boolean {
  return declinedKey !== null && key === declinedKey;
}
