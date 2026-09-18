import { useCallback, useEffect, useRef, useState } from 'react';

// preload.d.ts declares AndroidBuildProgress/AndroidBuildResult module-locally
// (the file is a module because of `declare global`), so they are not
// importable. Deriving them off the global bridge signature keeps this
// component in sync with preload.d.ts without editing it -- same trick
// AndroidSdkButton.tsx uses for AndroidSdkProgress.
type AndroidBuildBridge = Window['androidBuild'];
type AndroidBuildProgress = Parameters<Parameters<AndroidBuildBridge['onProgress']>[0]>[0];

// 'idle' is kept only so `progress.phase` (typed against preload.d.ts's
// AndroidBuildPhase, which still includes 'idle') stays assignable to this
// union without a cast -- the main process never actually emits it.
type Phase = 'idle' | 'select' | 'checking' | 'building' | 'done' | 'error';
type BuildType = 'debug' | 'release' | null;

const MAX_LOG_LINES = 200;

// The exact URL main.ts's android:buildApk handler embeds in its
// missing-signing-key error message -- used to split that string so the URL
// renders as a real link instead of plain text.
const FLUTTER_SIGNING_DOCS_URL = 'https://docs.flutter.dev/deployment/android#signing-the-app';

function phaseLabel(phase: Phase, buildType: BuildType): string {
  switch (phase) {
    case 'idle':
      return 'Preparing...';
    case 'select':
      return 'Choose a build type';
    case 'checking':
      return 'Checking project...';
    case 'building':
      return buildType ? `Building ${buildType} APK...` : 'Building APK...';
    case 'done':
      return buildType ? `${buildType} build complete` : 'Build complete';
    case 'error':
      return 'Build failed';
    default:
      return '';
  }
}

// Renders `message` with the Flutter signing-docs URL (if present) broken out
// as a real, clickable anchor instead of inline text. Electron's renderer
// already forwards target="_blank" navigations to the OS browser via
// mainWindow.webContents.setWindowOpenHandler -> shell.openExternal in
// main.ts, so a plain anchor is enough here without any new IPC surface --
// this file cannot add one anyway, since main process files are out of scope
// for this component. This intentionally isn't the same call as the Report
// Issue link (window.appLinks.openIssues()), which only ever opens one fixed
// GitHub URL and has no way to take an arbitrary destination.
function renderErrorMessage(message: string) {
  const idx = message.indexOf(FLUTTER_SIGNING_DOCS_URL);
  if (idx === -1) return message;

  const before = message.slice(0, idx);
  const after = message.slice(idx + FLUTTER_SIGNING_DOCS_URL.length);
  return (
    <>
      {before}
      <a
        href={FLUTTER_SIGNING_DOCS_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#a855f7', textDecoration: 'underline' }}
      >
        {FLUTTER_SIGNING_DOCS_URL}
      </a>
      {after}
    </>
  );
}

type Props = {
  isOpen: boolean;
  projectPath: string;
  onClose: () => void;
};

export default function AndroidBuildApkModal({ isOpen, projectPath, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('select');
  const [buildType, setBuildType] = useState<BuildType>(null);
  const [log, setLog] = useState<string[]>([]);
  const [apkPath, setApkPath] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  // Same unsubscribeRef + mountedRef pattern as AndroidSdkButton.tsx: onProgress
  // fires from the main process and can outlive this component (the workspace
  // can close mid-build), and the ref lets cleanup detach the listener.
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, []);

  const appendLog = useCallback((message: string) => {
    setLog((prev) => {
      const next = [...prev, message];
      return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
    });
  }, []);

  // Reset to the build-type picker on every open. No onProgress subscription
  // and no build() call here anymore -- both only start once the student
  // actually picks debug or release, via startBuild() below.
  useEffect(() => {
    if (!isOpen) return;

    setPhase('select');
    setBuildType(null);
    setLog([]);
    setApkPath(null);
    setErrorMessage(null);
    setErrorCode(null);
  }, [isOpen]);

  // Auto-scroll the log box to the bottom as new lines arrive.
  useEffect(() => {
    const el = logContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  const startBuild = useCallback((type: 'debug' | 'release') => {
    setBuildType(type);
    setLog([]);
    setApkPath(null);
    setErrorMessage(null);
    setErrorCode(null);
    setPhase('checking');

    unsubscribeRef.current?.();
    unsubscribeRef.current = window.androidBuild.onProgress((progress: AndroidBuildProgress) => {
      if (!mountedRef.current) return;
      setPhase(progress.phase);
      appendLog(progress.message);
    });

    window.androidBuild
      .build(projectPath, type)
      .then((result) => {
        if (!mountedRef.current) return;
        if (result.success) {
          setPhase('done');
          setApkPath(result.apkPath ?? null);
        } else {
          setPhase('error');
          setErrorMessage(result.error ?? 'Build failed.');
          setErrorCode(result.errorCode ?? null);
          result.log?.forEach(appendLog);
        }
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        setPhase('error');
        setErrorMessage(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        unsubscribeRef.current?.();
        unsubscribeRef.current = null;
      });
  }, [projectPath, appendLog]);

  // Lets a student retry as debug (no signing key needed) without closing and
  // reopening the whole modal after a missing-signing-key release failure.
  const handleBackToSelect = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setPhase('select');
    setBuildType(null);
    setLog([]);
    setApkPath(null);
    setErrorMessage(null);
    setErrorCode(null);
  }, []);

  const revealApk = useCallback(() => {
    if (!apkPath) return;
    void window.androidBuild.revealApk(apkPath);
  }, [apkPath]);

  if (!isOpen) return null;

  // Only checking/building are ever in flight -- 'select', 'done' and 'error'
  // all leave nothing running, so closing is safe from any of them.
  const isBusy = phase === 'checking' || phase === 'building';

  const handleBackdropClick = () => {
    if (!isBusy) onClose();
  };

  const handleCloseClick = () => {
    if (!isBusy) onClose();
  };

  return (
    <div
      role="presentation"
      onClick={handleBackdropClick}
      className="fixed inset-0 flex items-center justify-center z-200"
      style={{ background: 'rgba(0,0,0,0.55)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-lg shadow-2xl px-6 py-5"
        style={{
          background: '#180C29',
          border: '1px solid #a855f7',
          width: 480,
          maxWidth: '90vw',
        }}
      >
        <h2
          className="text-sm font-semibold mb-1"
          style={{ color: '#ffffff', fontFamily: 'Space Grotesk, sans-serif' }}
        >
          Build APK
        </h2>
        <p className="text-xs mb-3" style={{ color: '#B8AFC2', fontFamily: 'Space Mono, monospace' }}>
          {phaseLabel(phase, buildType)}
        </p>

        {phase === 'select' ? (
          <div className="flex flex-col gap-3 mb-3">
            <div>
              <button
                type="button"
                onClick={() => startBuild('debug')}
                className="text-xs px-3 py-1.5 rounded transition-all duration-200 hover:bg-[#a855f7]/10 w-full text-left"
                style={{
                  background: 'rgba(168, 85, 247, 0.15)',
                  color: '#a855f7',
                  border: '1px solid #a855f7',
                }}
              >
                Build Debug APK
              </button>
              <p className="text-xs mt-1" style={{ color: '#77718F' }}>
                Quick, installable, uses an auto-generated key -- good for testing on a device.
              </p>
            </div>

            <div>
              <button
                type="button"
                onClick={() => startBuild('release')}
                className="text-xs px-3 py-1.5 rounded transition-all duration-200 hover:bg-[#a855f7]/10 w-full text-left"
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: '#B8AFC2',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                Build Release APK
              </button>
              <p className="text-xs mt-1" style={{ color: '#77718F' }}>
                Needs your own signing key already set up in the project -- produces the distributable build.
              </p>
            </div>
          </div>
        ) : (
          <div
            ref={logContainerRef}
            className="text-xs overflow-y-auto rounded p-2 mb-3"
            style={{
              maxHeight: 240,
              background: 'rgba(0, 0, 0, 0.3)',
              color: '#B8AFC2',
              fontFamily: 'Space Mono, monospace',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            {log.length === 0 ? (
              <div style={{ color: '#77718F' }}>Waiting for output...</div>
            ) : (
              log.map((line, index) => <div key={index}>{line}</div>)
            )}
          </div>
        )}

        {phase === 'done' && apkPath && (
          <div className="mb-3">
            <p
              className="text-xs mb-2"
              style={{ color: '#B8AFC2', fontFamily: 'Space Mono, monospace', wordBreak: 'break-all' }}
            >
              {apkPath}
            </p>
            <button
              type="button"
              onClick={revealApk}
              className="text-xs px-3 py-1 rounded transition-all duration-200 hover:bg-[#a855f7]/10"
              style={{
                background: 'rgba(168, 85, 247, 0.15)',
                color: '#a855f7',
                border: '1px solid #a855f7',
              }}
            >
              Reveal in Folder
            </button>
          </div>
        )}

        {phase === 'error' && errorMessage && (
          <div className="mb-3">
            <p className="text-xs mb-2" style={{ color: '#f87171' }}>
              {errorCode === 'missing-signing-key' ? renderErrorMessage(errorMessage) : errorMessage}
            </p>
            {errorCode === 'missing-signing-key' && (
              <button
                type="button"
                onClick={handleBackToSelect}
                className="text-xs px-3 py-1 rounded transition-colors"
                style={{
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  color: '#B8AFC2',
                }}
              >
                Back
              </button>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={handleCloseClick}
          disabled={isBusy}
          className="text-xs px-3 py-1 rounded transition-colors"
          style={{
            border: '1px solid rgba(255, 255, 255, 0.08)',
            color: '#B8AFC2',
            opacity: isBusy ? 0.4 : 1,
            cursor: isBusy ? 'not-allowed' : 'pointer',
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
