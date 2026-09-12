import { useCallback, useEffect, useRef, useState } from 'react';

type Suggestion = {
  scenario: 1 | 2 | 3 | 4 | 5;
  message: string;
  offersHint: boolean;
  autoDismissSeconds: number;
  // Scenario 5 only. `offersCorrection` is the escalation: the student hit the
  // same error category again after a guiding question already failed, so the
  // offer becomes a direct fix instead of another question.
  errorCategory?: string;
  offersCorrection?: boolean;
};

const CATEGORY_LABELS: Record<string, string> = {
  syntax: 'Syntax error',
  'undefined-reference': 'Undefined reference',
  'type-mismatch': 'Type mismatch',
  'null-reference': 'Null reference',
  'missing-import': 'Missing import',
  'runtime-exception': 'Runtime exception',
};

// Isolated, self-contained toast for the Adaptive Assistance Engine — reads
// its own code/language props to build the scenario-3 hint request, but
// otherwise owns no shared state and touches no other component's files.
export default function AdaptiveToast({
  currentCode,
  language,
}: {
  currentCode: string;
  language: string;
}) {
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  // Holds whichever of the two answers came back — the guiding hint or the
  // direct correction. Both replace the toast body the same way.
  const [hint, setHint] = useState<string | null>(null);
  const [hintLoading, setHintLoading] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentCodeRef = useRef(currentCode);
  const languageRef = useRef(language);

  currentCodeRef.current = currentCode;
  languageRef.current = language;

  const dismiss = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setSuggestion(null);
    setHint(null);
    setHintLoading(false);
    window.adaptive?.dismiss();
  }, []);

  useEffect(() => {
    const unsubscribe = window.adaptive?.onSuggest((next) => {
      setSuggestion(next);
      setHint(null);
      dismissTimerRef.current = setTimeout(dismiss, next.autoDismissSeconds * 1000);
    });
    return () => {
      unsubscribe?.();
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [dismiss]);

  const handleAcceptHint = useCallback(async () => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setHintLoading(true);
    const result = await window.adaptive.requestHint({
      code: currentCodeRef.current,
      language: languageRef.current,
    });
    setHintLoading(false);
    setHint(result.success && result.hint ? result.hint : 'Could not fetch a hint right now — try again in a moment.');
  }, []);

  const handleAcceptCorrection = useCallback(async () => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setHintLoading(true);
    const result = await window.adaptive.requestCorrection({
      code: currentCodeRef.current,
      language: languageRef.current,
    });
    setHintLoading(false);
    setHint(
      result.success && result.correction
        ? result.correction
        : 'Could not work out a fix right now — try again in a moment.',
    );
  }, []);

  if (!suggestion) return null;

  const categoryLabel = suggestion.errorCategory
    ? CATEGORY_LABELS[suggestion.errorCategory] ?? suggestion.errorCategory
    : null;

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-[2000] max-w-xs rounded-lg shadow-lg"
      style={{
        background: '#180C29',
        border: '1px solid #a855f7',
        color: '#ffffff',
        fontFamily: 'Segoe UI, sans-serif',
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
      }}
    >
      <div className="flex items-start gap-2 px-4 py-3">
        <span className="text-base leading-none inline-flex" style={{ color: '#a855f7' }}>
          <i className="codicon codicon-sparkle" style={{ fontSize: '16px' }} />
        </span>
        <div className="flex-1 min-w-0">
          {categoryLabel && !hint && (
            <p
              className="text-[10px] font-medium mb-1 uppercase tracking-wide"
              style={{ color: '#f59e0b' }}
            >
              {categoryLabel}
            </p>
          )}
          <p className="text-xs leading-snug whitespace-pre-wrap" style={{ color: '#F5F0FA' }}>
            {hint ?? suggestion.message}
          </p>
          {suggestion.offersCorrection && !hint && (
            <button
              type="button"
              onClick={handleAcceptCorrection}
              disabled={hintLoading}
              className="mt-2 text-[11px] px-3 py-1 rounded-md font-medium"
              style={{
                background: hintLoading ? '#1C0F30' : 'linear-gradient(135deg, #f59e0b, #d97706)',
                color: '#ffffff',
                cursor: hintLoading ? 'default' : 'pointer',
                border: 'none',
              }}
            >
              {hintLoading ? 'Working it out…' : 'Show me the fix'}
            </button>
          )}
          {suggestion.offersHint && !hint && (
            <button
              type="button"
              onClick={handleAcceptHint}
              disabled={hintLoading}
              className="mt-2 text-[11px] px-3 py-1 rounded-md font-medium"
              style={{
                background: hintLoading ? '#1C0F30' : 'linear-gradient(135deg, #a855f7, #7c3aed)',
                color: '#ffffff',
                cursor: hintLoading ? 'default' : 'pointer',
                border: 'none',
              }}
            >
              {hintLoading ? 'Thinking…' : 'Show me a hint'}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="text-[10px] shrink-0 hover:text-white transition-colors"
          style={{ color: '#B8AFC2' }}
          title="Dismiss"
        >
          <i className="codicon codicon-close" style={{ fontSize: '12px' }} />
        </button>
      </div>
    </div>
  );
}
