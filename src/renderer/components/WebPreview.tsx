import type { HTMLAttributes, ReactElement, Ref } from 'react';
import { useRef } from 'react';

// Electron's <webview> is not in React's intrinsic-element types, so the tag
// name is cast to a component rather than declared globally — same approach
// src/renderer/components/mirror/MirrorButton.tsx uses.
const WebView = 'webview' as unknown as (
  props: HTMLAttributes<HTMLElement> & {
    src: string;
    key?: string;
    ref?: Ref<HTMLElement>;
  },
) => ReactElement;

export const DEFAULT_URL = 'http://localhost/';

// Normalizes bare input ("localhost:3000", "example.com") into a loadable URL
// the same way a browser address bar does, so the webview is never handed a
// string with no scheme.
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_URL;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

interface WebPreviewProps {
  committedUrl: string;
  inputValue: string;
  onCommittedUrlChange: (url: string) => void;
  onInputValueChange: (value: string) => void;
}

// Renders the standalone header EditorLayout wraps every floating panel
// with (ToolWindowHeader) is that component's own composition, not this
// one's — this only ever provides the address bar + <webview> content, same
// division AIPanel/Preview already keep with their header chrome.
//
// Controlled by EditorLayout rather than owning its own useState: EditorLayout
// renders this component from two mutually exclusive conditional blocks
// (docked vs. floating), and minimize/detach/redock all flip which one is
// active -- unmounting whichever instance was live. Local state would reset
// to DEFAULT_URL on every one of those transitions, so the URL lives one
// level up, in state that survives the swap.
export default function WebPreview({
  committedUrl, inputValue, onCommittedUrlChange, onInputValueChange,
}: WebPreviewProps) {
  const webviewRef = useRef<HTMLElement | null>(null);

  const navigate = () => {
    onCommittedUrlChange(normalizeUrl(inputValue));
  };

  return (
    <div className="flex flex-col h-full w-full">
      <div
        className="flex items-center gap-2 px-2 py-1.5 shrink-0"
        style={{ borderBottom: '1px solid rgba(168, 85, 247, 0.24)' }}
      >
        <input
          type="text"
          value={inputValue}
          onChange={(e) => onInputValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigate();
          }}
          placeholder="http://localhost/"
          className="flex-1 text-xs px-2 py-1 rounded outline-none min-w-0"
          style={{
            background: 'rgba(255,255,255,0.06)',
            color: '#E4DEF0',
            border: '1px solid rgba(168, 85, 247, 0.24)',
            fontFamily: 'Space Mono, monospace',
          }}
        />
        <button
          type="button"
          onClick={navigate}
          className="text-xs px-3 py-1 rounded transition-colors shrink-0"
          style={{
            background: 'rgba(168, 85, 247, 0.2)',
            color: '#a855f7',
            border: '1px solid #a855f7',
          }}
        >
          Go
        </button>
      </div>
      {/* Positioning context for the webview below, same pattern as
          MirrorButton's panel — min-h-0 lets this flex child actually shrink. */}
      <div className="flex-1 min-h-0 relative">
        <WebView
          ref={webviewRef}
          src={committedUrl}
          key={committedUrl}
          // NEVER set `display` on a webview — Electron renders its real
          // content in an internal shadow-DOM iframe sized 100%/100%, which
          // only stretches while the host keeps its default `inline-flex`.
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            border: 0,
          }}
        />
      </div>
    </div>
  );
}
