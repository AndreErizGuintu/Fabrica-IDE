import { useEffect, useState } from 'react';

// The device vocabulary lives here, with the poll that produces it, rather than
// in FlutterTargetSelector — that component consumes this hook, so defining the
// type and predicate there and importing them back would close an import cycle.
// FlutterTargetSelector re-exports both, so existing consumers are unaffected.
export type FlutterTarget = { id: string; name: string; platform: string };

// Single home for "is this a physical Android target".
export const isAndroidPlatform = (platform: string) =>
  platform.startsWith('android');

// Single source of truth for "what devices does Flutter currently see".
//
// Every call to `flutter devices --machine` spawns cmd.exe and then adb, so
// having each component run its own poll meant two independent process storms
// racing each other and disagreeing about the same hardware. One poll, one
// answer, shared by every consumer.
const POLL_INTERVAL_MS = 2000;

// A failed query is NOT evidence that a device is absent -- `flutter devices`
// can time out or fail transiently while the phone is sitting there perfectly
// authorized. Callers that would otherwise treat "no devices" as a verdict need
// to be able to tell a real empty answer from a failed one, so the outcome of
// the last poll is reported rather than flattened into the list alone.
export type DevicePollStatus = 'pending' | 'ok' | 'error';

export type FlutterDevices = {
  targets: FlutterTarget[];
  isAndroidPresent: boolean;
  status: DevicePollStatus;
};

export default function useFlutterDevices(): FlutterDevices {
  const [targets, setTargets] = useState<FlutterTarget[]>([]);
  const [status, setStatus] = useState<DevicePollStatus>('pending');

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const check = async () => {
      // `flutter devices --machine` shells out to adb and can take longer than
      // one tick, so overlapping calls are skipped rather than queued. Without
      // this, a slow host would stack up spawns until it fell over.
      if (cancelled || inFlight) return;
      inFlight = true;

      try {
        const result = await window.flutter.listDevices();
        if (cancelled) return;
        if (result.success && result.devices) {
          setTargets(result.devices);
          setStatus('ok');
        } else {
          // Deliberately keeps the last known good list instead of clearing it:
          // one failed tick should not make a present device blink out of the
          // dropdown, and `status` already tells callers this tick was no news.
          setStatus('error');
        }
      } catch {
        // Swallowed deliberately: this runs every 2s, so logging a transient
        // bridge failure would flood the console for no benefit.
        if (!cancelled) setStatus('error');
      } finally {
        inFlight = false;
      }
    };

    void check();
    const interval = setInterval(() => {
      void check();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return {
    targets,
    isAndroidPresent: targets.some((d) => isAndroidPlatform(d.platform)),
    status,
  };
}
