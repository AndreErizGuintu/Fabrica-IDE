import { useCallback, useEffect, useRef, useState } from 'react';

// preload.d.ts declares AndroidSdkProgress/AndroidSdkStatus module-locally (the
// file is a module because of `declare global`), so they are not importable.
// Deriving them off the global bridge signature keeps this component in sync
// with preload.d.ts without editing it.
type AndroidSdkBridge = Window['androidSdk'];
type AndroidSdkProgress = Parameters<Parameters<AndroidSdkBridge['onProgress']>[0]>[0];

type Mode = 'idle' | 'installed' | 'working' | 'error';

function labelFor(progress: AndroidSdkProgress): string {
  switch (progress.phase) {
    case 'preflight':
      return 'Checking...';
    case 'downloading':
      return progress.percent === undefined
        ? 'Downloading'
        : `Downloading ${Math.round(progress.percent)}%`;
    case 'extracting':
      return 'Extracting';
    case 'licenses':
      return 'Licenses';
    case 'awaiting-license':
      return 'License required';
    case 'installing':
      return progress.packageName ? `Installing ${progress.packageName}` : 'Installing tools';
    case 'done':
      return 'Android SDK ✓';
    case 'cancelled':
      return 'Android SDK';
    case 'error':
      return 'SDK failed - retry';
    default:
      return 'Android SDK';
  }
}

export default function AndroidSdkButton() {
  const [mode, setMode] = useState<Mode>('idle');
  const [label, setLabel] = useState('Android SDK');
  const [licenseText, setLicenseText] = useState<string | null>(null);

  // onProgress fires from the main process and can outlive this component if
  // the toolbar unmounts mid-fetch; the ref lets cleanup detach the listener.
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    window.androidSdk
      .check()
      .then((status) => {
        if (!mountedRef.current) return;
        if (status.installed) {
          setMode('installed');
          setLabel('Android SDK ✓');
        }
      })
      .catch(() => {
        /* leave the button in its default "not installed" state */
      });

    return () => {
      mountedRef.current = false;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, []);

  const handleClick = useCallback(async () => {
    if (mode === 'installed' || mode === 'working') return;

    setMode('working');
    setLabel('Starting...');
    setLicenseText(null);

    unsubscribeRef.current?.();
    unsubscribeRef.current = window.androidSdk.onProgress((progress) => {
      if (!mountedRef.current) return;
      setLabel(labelFor(progress));
      setLicenseText(
        progress.phase === 'awaiting-license' ? progress.licenseText ?? '' : null,
      );
    });

    try {
      // Expected failures resolve with `error` set rather than throwing, so the
      // resolved status -- not the catch -- is the authority on the outcome.
      const status = await window.androidSdk.fetch();
      if (!mountedRef.current) return;
      if (status.installed) {
        setMode('installed');
        setLabel('Android SDK ✓');
      } else {
        setMode('error');
        setLabel('SDK failed - retry');
      }
    } catch {
      if (!mountedRef.current) return;
      setMode('error');
      setLabel('SDK failed - retry');
    } finally {
      if (mountedRef.current) setLicenseText(null);
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    }
  }, [mode]);

  const respond = useCallback((accepted: boolean) => {
    setLicenseText(null);
    void window.androidSdk.respondToLicense(accepted).catch(() => {
      /* the flow reports the outcome through onProgress / fetch() */
    });
  }, []);

  const active = mode === 'installed' || mode === 'working';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        disabled={mode === 'working'}
        className="text-xs px-3 py-1 rounded transition-all duration-200 hover:bg-[#a855f7]/10 flex items-center gap-1.5"
        style={{
          background: active ? 'rgba(168, 85, 247, 0.15)' : 'rgba(255, 255, 255, 0.05)',
          color: mode === 'error' ? '#f87171' : active ? '#a855f7' : '#B8AFC2',
          border: active ? '1px solid #a855f7' : '1px solid rgba(255, 255, 255, 0.08)',
          cursor: mode === 'working' ? 'default' : 'pointer',
        }}
        title="Download the Android SDK (needed for APK builds)"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M12 4v12m0 0l-4-4m4 4l4-4"
          />
        </svg>
        {label}
      </button>

      {licenseText !== null && (
        <div
          className="absolute right-0 top-full mt-1 z-50 w-96 rounded p-3 flex flex-col gap-2"
          style={{
            background: '#180C29',
            border: '1px solid #a855f7',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
          }}
        >
          <div className="text-xs" style={{ color: '#B8AFC2', fontFamily: 'Space Mono, monospace' }}>
            Android SDK license
          </div>
          <pre
            className="text-xs overflow-auto whitespace-pre-wrap"
            style={{
              maxHeight: '240px',
              color: '#ffffff',
              fontFamily: 'Space Mono, monospace',
              margin: 0,
            }}
          >
            {licenseText}
          </pre>
          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={() => respond(false)}
              className="text-xs px-3 py-1 rounded transition-all duration-200 hover:bg-[#a855f7]/10"
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#B8AFC2',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              Decline
            </button>
            <button
              type="button"
              onClick={() => respond(true)}
              className="text-xs px-3 py-1 rounded transition-all duration-200 hover:bg-[#a855f7]/10"
              style={{
                background: 'rgba(168, 85, 247, 0.15)',
                color: '#a855f7',
                border: '1px solid #a855f7',
              }}
            >
              Accept
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
