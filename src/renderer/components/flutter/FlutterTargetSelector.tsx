import { useCallback, useEffect, useRef, useState } from 'react';

export type FlutterTarget = { id: string; name: string; platform: string };

const WINDOWS_TARGET: FlutterTarget = { id: 'windows', name: 'Windows (desktop)', platform: 'windows' };

type FlutterTargetSelectorProps = {
  disabled?: boolean;
  isRunning?: boolean;
  onRun: (target: FlutterTarget) => void;
};

// Android Studio-style split run button: left side runs on the currently
// selected target, right side opens a dropdown to change the selection
// (selecting alone never triggers a run). Default selection is always
// Windows on load and is not persisted across sessions, per spec.
export default function FlutterTargetSelector({ disabled, isRunning, onRun }: FlutterTargetSelectorProps) {
  const [targets, setTargets] = useState<FlutterTarget[]>([WINDOWS_TARGET]);
  const [selected, setSelected] = useState<FlutterTarget>(WINDOWS_TARGET);
  const [isOpen, setIsOpen] = useState(false);
  const [usbNotReady, setUsbNotReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const mergeWithWindows = (devices: FlutterTarget[]) =>
    devices.some((d) => d.platform === 'windows') ? devices : [WINDOWS_TARGET, ...devices];

  const refreshDevices = useCallback(async () => {
    const result = await window.flutter.listDevices();
    if (result.success && result.devices) {
      setTargets(mergeWithWindows(result.devices));
      return result.devices;
    }
    return undefined;
  }, []);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  useEffect(() => {
    const off = window.flutter.onUsbConnected(() => {
      setUsbNotReady(true);
      // Give adb/Flutter a moment to enumerate the newly connected device
      // before re-checking — this is a best-effort nicety, not a hard guarantee.
      setTimeout(async () => {
        const devices = await refreshDevices();
        const hasAndroid = devices?.some((d) => d.platform.startsWith('android')) ?? false;
        setUsbNotReady(!hasAndroid);
      }, 3000);
    });
    return off;
  }, [refreshDevices]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSelect = (target: FlutterTarget) => {
    setSelected(target);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative flex items-center" style={{ opacity: disabled ? 0.4 : 1 }}>
      <button
        type="button"
        onClick={() => onRun(selected)}
        disabled={disabled}
        title={
          isRunning
            ? 'A process is already running — this will stop it and start a new one'
            : `Run on ${selected.name}`
        }
        className="flex items-center gap-2 pl-3 pr-2 py-1 rounded-l text-sm font-medium transition-colors hover:bg-white/10"
        style={{
          background: 'rgba(96, 165, 250, 0.15)',
          color: '#60a5fa',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
        <span>{selected.name}</span>
      </button>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        disabled={disabled}
        title="Select run target"
        aria-label="Select run target"
        className="flex items-center px-1.5 py-1 rounded-r text-sm transition-colors hover:bg-white/10"
        style={{
          background: 'rgba(96, 165, 250, 0.15)',
          color: '#60a5fa',
          borderLeft: '1px solid rgba(96, 165, 250, 0.3)',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="absolute top-full right-0 mt-1 rounded-lg overflow-hidden z-50"
          style={{
            background: '#2d1b4e',
            border: '1px solid #3d2b5e',
            minWidth: '220px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
          }}
        >
          {targets.map((target) => (
            <button
              key={target.id}
              type="button"
              onClick={() => handleSelect(target)}
              className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-white/10"
              style={{
                color: target.id === selected.id ? '#a855f7' : '#d4d4d4',
                background: target.id === selected.id ? 'rgba(168, 85, 247, 0.15)' : 'transparent',
              }}
            >
              {target.name}
              <span className="block text-[10px]" style={{ color: '#a7adc5' }}>
                {target.platform}
              </span>
            </button>
          ))}
          {usbNotReady && (
            <div
              className="w-full text-left px-3 py-2 text-xs"
              style={{ color: '#f59e0b', borderTop: '1px solid #3d2b5e' }}
            >
              Device connected, not debug-ready
            </div>
          )}
        </div>
      )}
    </div>
  );
}
