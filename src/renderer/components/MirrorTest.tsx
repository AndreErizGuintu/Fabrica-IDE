import { useState } from 'react';
import type { HTMLAttributes, ReactElement } from 'react';
import useFlutterDevices from '../hooks/useFlutterDevices';

/**
 * TEMPORARY test-only UI for the device mirroring feature
 * (src/main/mirrorProcess.ts). Deliberately unstyled and unpolished — this
 * exists only to visually confirm that the mirror actually renders inside the
 * app. It is a PLACEHOLDER for the real panel, which is John Peter's lane.
 * Safe to delete outright once that lands.
 */

// Electron's <webview> is not in React's intrinsic-element types, so the tag
// name is cast to a component rather than declared globally. Kept local on
// purpose: a `declare global` JSX augmentation would outlive this throwaway
// file and become one more thing to clean up later.
const WebView = 'webview' as unknown as (
  props: HTMLAttributes<HTMLElement> & { src: string },
) => ReactElement;

export default function MirrorTest() {
  const [port, setPort] = useState<number | null>(null);

  // Device detection (the 2s poll, the in-flight guard, the plug-in event) used
  // to live in this file and was the second, un-synced caller of
  // `flutter devices --machine`. It now comes from the shared hook, so this stub
  // and the run-target dropdown can no longer disagree about the same hardware.
  const { isAndroidPresent: hasAndroidDevice } = useFlutterDevices();

  // No in-flight guard on purpose: startMirrorServer() already coalesces
  // concurrent calls into one fork and returns the running server's port, so a
  // double-click cannot start two servers.
  const handleClick = async () => {
    if (port !== null) {
      try {
        await window.mirror.stop();
      } catch (err) {
        console.error('[MirrorTest] stop failed:', err);
      }
      setPort(null);
      return;
    }

    try {
      const result = await window.mirror.start();
      setPort(result.port);
    } catch (err) {
      // Throwaway UI — the real panel surfaces this text to the user. The main
      // process rejects with a diagnostic message (missing bundle, server
      // stderr, startup timeout), so log it whole rather than just a boolean.
      console.error('[MirrorTest] start failed:', err);
      setPort(null);
    }
  };

  // While a mirror is running the button always stays the Stop button, even if
  // the device drops off the device list. Polling made unplug-while-mirroring
  // detectable for the first time, and without this the button would disable
  // itself mid-session and leave no way to stop the server. Every state that
  // was reachable before the poll landed looks and behaves exactly as it did.
  const isMirroring = port !== null;
  const label = (() => {
    if (isMirroring) return 'Stop Mirror';
    return hasAndroidDevice ? 'Start Mirror' : 'Connect an Android device to mirror';
  })();

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={!hasAndroidDevice && !isMirroring}
      >
        {label}
      </button>

      {isMirroring && (
        <WebView src={`http://localhost:${port}`} style={{ width: 400, height: 800 }} />
      )}
    </div>
  );
}
