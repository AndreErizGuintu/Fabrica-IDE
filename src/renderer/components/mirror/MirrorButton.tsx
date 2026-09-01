import type { HTMLAttributes, ReactElement, Ref } from 'react';
import { useEffect, useRef } from 'react';
import useMirrorSession from './useMirrorSession';

// Electron's <webview> is not in React's intrinsic-element types, so the tag
// name is cast to a component rather than declared globally — same approach the
// MirrorTest stub uses, kept local for the same reason (a `declare global` JSX
// augmentation would be one more thing to unpick later).
//
// `allowpopups` is typed as a string, not a boolean, on purpose: React refuses
// to write `true` to an attribute it does not know is boolean (it warns and
// drops it), and Electron only tests for the attribute's PRESENCE. A string
// value renders the attribute and satisfies both.
const WebView = 'webview' as unknown as (
  props: HTMLAttributes<HTMLElement> & {
    src: string;
    allowpopups?: string;
    partition?: string;
    key?: string;
    ref?: Ref<HTMLElement>;
  },
) => ReactElement;

// Panel geometry. Sized to the window rather than to fixed pixels: the webview
// then fills the panel outright, so ws-scrcpy always gets the largest viewport
// the app can hand it. The previous fixed 500x900 was both smaller than the
// available space AND taller than the window, which is why the panel scrolled.
// Clamped so it stays usable on a small laptop and does not swallow the whole
// editor on a wide monitor.
const PANEL_WIDTH = 'clamp(440px, 42vw, 780px)';

// Deep-links straight into ws-scrcpy's stream view, skipping its device-tracker
// landing page and the "Configure stream" step.
//
// The `ws` parameter carries an entire URL as its value, so it is encoded as one
// unit. That is precisely what turns `remote`'s own `tcp%3A8886` into
// `tcp%253A8886` in the final string: the colon is encoded once inside the ws
// URL, then the whole ws URL is encoded again when embedded. That double
// encoding is load-bearing and matches what ws-scrcpy generates for itself —
// collapsing it to a single `%3A` breaks the stream. Do not "tidy" it.
function buildStreamUrl(port: number, udid: string): string {
  const ws = `ws://localhost:${port}/?action=proxy-adb&remote=${encodeURIComponent(
    'tcp:8886',
  )}&udid=${udid}`;

  const url = `http://localhost:${port}/#!action=stream&udid=${udid}&player=webcodecs&ws=${encodeURIComponent(
    ws,
  )}&fitToScreen=true`;
  
  console.log('[MIRROR:buildStreamUrl] Built stream URL for device:', { port, udid, url });
  return url;
}

type MirrorButtonProps = {
  // The adb serial of the device to mirror. Comes from the selected run
  // target's id, which for a physical Android device IS the adb serial.
  udid: string;
};

// Toolbar entry point for device mirroring. Rendering is the caller's decision:
// EditorLayout mounts this only while an Android device is the SELECTED run
// target, so this component never has to ask whether a device is present.
export default function MirrorButton({ udid }: MirrorButtonProps) {
  const { port, isMirroring, error, toggle } = useMirrorSession();
  const webviewRef = useRef<HTMLElement | null>(null);

  console.log('[MIRROR:component-render] MirrorButton render:', { udid, port, isMirroring });

  const streamUrl = port !== null ? buildStreamUrl(port, udid) : null;
  console.log('[MIRROR:streamUrl-computed] Stream URL computed:', { port, udid, streamUrl });

  // Attach a dom-ready listener purely for diagnostic logging, so we can
  // confirm from console output whether a fresh webview element is mounting
  // and loading the src attribute. The actual URL loading is handled by React
  // setting the src={streamUrl} attribute on the <WebView> JSX element;
  // key={streamUrl} forces a fresh mount on each URL change.
  useEffect(() => {
    if (!webviewRef.current) return;

    const handleDomReady = () => {
      console.log('[MIRROR:webview-dom-ready] Webview dom-ready event fired for URL:', { streamUrl });
    };

    const webview = webviewRef.current as HTMLElement & { addEventListener: Function };
    webview.addEventListener('dom-ready', handleDomReady);

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady);
    };
  }, [streamUrl]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          console.log('[MIRROR:toggle-click] Toggle clicked, current state:', { port, isMirroring, udid });
          void toggle();
        }}
        title={
          isMirroring
            ? 'Stop mirroring the selected device'
            : 'Mirror the selected device'
        }
        className="text-sm px-4 py-1.5 rounded-lg transition-all duration-200 hover:bg-white/10"
        style={{
          background: isMirroring ? 'rgba(168, 85, 247, 0.2)' : 'transparent',
          color: isMirroring ? '#a855f7' : '#a7adc5',
          border: isMirroring ? '1px solid #a855f7' : 'none',
        }}
      >
        <span className="flex items-center gap-2">
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
          </svg>
          {isMirroring ? 'Stop Mirror' : 'Mirror'}
        </span>
      </button>

      {/* Narrowed on `port` rather than `isMirroring` (which is defined as
          exactly this check) so the port is a number for the URL builder
          below. Same condition, same behavior. */}
      {port !== null && streamUrl !== null && (
        <div
          className="fixed rounded-lg overflow-hidden flex flex-col z-50"
          style={{
            top: '56px',
            right: '16px',
            // top + bottom rather than a maxHeight: this gives the panel a
            // DEFINITE height, which is what lets the webview below resolve
            // height: 100% instead of collapsing.
            bottom: '16px',
            width: PANEL_WIDTH,
            background: '#2d1b4e',
            border: '1px solid #3d2b5e',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
          }}
        >
          <div
            className="flex items-center justify-between px-3 py-1.5 shrink-0"
            style={{ borderBottom: '1px solid #3d2b5e' }}
          >
            <span
              className="text-xs"
              style={{ color: '#a7adc5', fontFamily: 'Space Mono, monospace' }}
            >
              Device Mirror
            </span>
            <button
              type="button"
              onClick={() => {
                console.log('[MIRROR:close-button] Close button clicked, stopping mirror');
                void toggle();
              }}
              aria-label="Stop mirroring"
              className="w-5 h-5 rounded flex items-center justify-center transition-colors hover:bg-white/10"
              style={{ color: '#a7adc5' }}
            >
              <svg
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          {/* Positioning context for the webview below. min-h-0 is what lets
              this flex child actually shrink to the panel's height. */}
          <div className="flex-1 min-h-0 relative">
            <WebView
              ref={webviewRef}
              src={streamUrl}
              allowpopups="true"
              key={streamUrl}
              // A `persist:` prefix is what makes the session survive app
              // restarts; without it the storage is in-memory and ws-scrcpy's
              // saved player/quality settings reset to blank every launch.
              // Electron only reads this when the webview is first attached, so
              // it must be set here at mount — the panel unmounts and remounts
              // with each start/stop, which is exactly when it takes effect.
              partition="persist:mirror"
              // NEVER set `display` on a webview. Electron renders the real
              // content in an internal shadow-DOM iframe sized `100%/100%`,
              // which only stretches while the host keeps its default
              // `inline-flex`. Forcing `display: block` collapses that iframe
              // to its ~300x150 default and the element silently ignores any
              // width/height you give it — which is exactly what made the
              // mirror render as a short band no matter how large the panel got.
              //
              // Absolutely positioning against the relative parent above gives
              // the host a definite box without relying on percentage-height
              // resolution through the flex chain.
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
      )}

      {error && (
        <div
          className="fixed rounded-lg px-3 py-2 text-xs z-50"
          style={{
            top: '56px',
            right: '16px',
            maxWidth: '360px',
            background: '#2d1b1b',
            border: '1px solid #f87171',
            color: '#f87171',
            whiteSpace: 'pre-wrap',
          }}
        >
          {error}
        </div>
      )}
    </>
  );
}
