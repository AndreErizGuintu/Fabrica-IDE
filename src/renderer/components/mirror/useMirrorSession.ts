import { useCallback, useState } from 'react';

// Owns the lifecycle of one mirror server for whichever component uses it:
// `port` is the running server's port, or null when nothing is mirroring.
//
// Extracted from MirrorTest.tsx rather than reimplemented, so the toolbar entry
// point and the old stub cannot drift apart on the start/stop contract. Device
// DETECTION is deliberately not part of this hook: MirrorTest polls for device
// presence, while the toolbar button keys off the selected run target instead —
// same server, different trigger.
export type MirrorSession = {
  port: number | null;
  isMirroring: boolean;
  error: string | null;
  toggle: () => Promise<void>;
};

export default function useMirrorSession(): MirrorSession {
  const [port, setPort] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // No in-flight guard on purpose: startMirrorServer() already coalesces
  // concurrent calls into one fork and returns the running server's port, so a
  // double-click cannot start two servers.
  const toggle = useCallback(async () => {
    console.log('[MIRROR:toggle-start] Toggle invoked, current port:', port);
    
    if (port !== null) {
      console.log('[MIRROR:toggle-stopping] Port is set, stopping server:', port);
      try {
        await window.mirror.stop();
        console.log('[MIRROR:toggle-stopped] Server stop completed');
      } catch (err) {
        // A failed stop still leaves the UI with no way forward if we keep
        // showing the mirror, so the panel closes either way and the reason is
        // logged rather than surfaced.
        console.error('[mirror] stop failed:', err);
      }
      console.log('[MIRROR:toggle-cleanup] Setting port to null');
      setPort(null);
      setError(null);
      return;
    }

    console.log('[MIRROR:toggle-starting] Port is null, starting server');
    try {
      const result = await window.mirror.start();
      console.log('[MIRROR:toggle-started] Server started, got port:', result.port);
      setPort(result.port);
      setError(null);
    } catch (err) {
      // window.mirror REJECTS with diagnostic text (missing bundle, server
      // stderr, startup timeout) instead of resolving { success: false }, so the
      // message is worth showing to the user, not just logging.
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[MIRROR:toggle-start-error] Failed to start server:', errorMsg);
      setError(errorMsg);
      setPort(null);
    }
  }, [port]);

  return { port, isMirroring: port !== null, error, toggle };
}
