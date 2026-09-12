import { useCallback, useEffect, useRef, useState } from 'react';

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
  // Unconditional teardown, for callers that know the session must end and are
  // not toggling a button: the device went away, the panel is closing. Separate
  // from `toggle` because toggle would START a server when none is running,
  // which is the opposite of what those callers want.
  stop: () => Promise<void>;
};

export default function useMirrorSession(): MirrorSession {
  const [port, setPort] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mirrors `port` for the unmount cleanup below. A cleanup function captures
  // the state from the render it was created in, so reading `port` there would
  // see whatever it was when the effect last ran -- null, on the mount pass.
  // The ref always reads current.
  const portRef = useRef<number | null>(null);
  portRef.current = port;

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

  const stop = useCallback(async () => {
    if (portRef.current === null) return;

    console.log('[MIRROR:stop] Explicit stop requested, port:', portRef.current);
    try {
      await window.mirror.stop();
    } catch (err) {
      // Same reasoning as toggle's stop path: the UI has to close either way.
      console.error('[mirror] stop failed:', err);
    }
    setPort(null);
    setError(null);
  }, []);

  // Teardown on unmount. Without this, anything that removes this hook's owner
  // from the tree -- the user leaving the editor screen, the selected run target
  // changing to a non-Android device, a device disconnect that unmounts the
  // button -- would take the panel away while leaving the forked ws-scrcpy
  // server running, holding both its port and the phone's scrcpy connection
  // with no UI left to stop it. This is the renderer-side counterpart to
  // main.ts's `before-quit` handler in mirrorProcess.ts: same rule (nothing may
  // dangle), applied at the other end of the lifecycle.
  //
  // Deliberately fire-and-forget: a cleanup function cannot await, and
  // `mirror:stop` is a no-op when nothing is running, so a redundant call from
  // a race with an explicit stop is harmless.
  useEffect(
    () => () => {
      if (portRef.current === null) return;
      console.log('[MIRROR:unmount] Owner unmounted while mirroring, stopping server');
      void window.mirror.stop().catch((err: unknown) => {
        console.error('[mirror] stop on unmount failed:', err);
      });
    },
    [],
  );

  return { port, isMirroring: port !== null, error, toggle, stop };
}
