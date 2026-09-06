import { useEffect, useMemo, useRef, useState } from 'react';
import useFlutterDevices, {
  FlutterTarget,
  isAndroidPlatform,
} from '../../hooks/useFlutterDevices';

export type { FlutterTarget };
export { isAndroidPlatform };

export const WINDOWS_TARGET: FlutterTarget = { 
  id: 'windows', 
  name: 'Windows (desktop)', 
  platform: 'windows' 
};

type FlutterTargetSelectorProps = {
  disabled?: boolean;
  isRunning?: boolean;
  selected?: FlutterTarget;
  onTargetChange?: (target: FlutterTarget) => void;
  onRun?: (target: FlutterTarget) => void;
};

export default function FlutterTargetSelector({
  disabled,
  isRunning,
  selected: externalSelected,
  onTargetChange,
  onRun,
}: FlutterTargetSelectorProps) {
  const { targets: devices } = useFlutterDevices();
  const [isOpen, setIsOpen] = useState(false);
  const [internalSelected, setInternalSelected] = useState<FlutterTarget>(WINDOWS_TARGET);
  const containerRef = useRef<HTMLDivElement>(null);

  // Use external selected if provided, otherwise use internal state
  const selected = externalSelected || internalSelected;

  const targets = useMemo(
    () =>
      devices.some((d) => d.platform?.startsWith('windows'))
        ? devices
        : [WINDOWS_TARGET, ...devices],
    [devices],
  );

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
    if (onTargetChange) {
      onTargetChange(target);
    } else {
      setInternalSelected(target);
    }
    setIsOpen(false);
  };

  const handleRun = () => {
    if (onRun && selected) {
      onRun(selected);
    }
  };

  // If disabled or no targets
  if (disabled) {
    return (
      <button
        type="button"
        disabled
        className="flex items-center gap-2 pl-3 pr-2 py-1 rounded-l text-sm font-medium opacity-40"
        style={{
          background: 'rgba(96, 165, 250, 0.05)',
          color: '#6b7280',
          cursor: 'not-allowed',
        }}
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
        <span>No devices</span>
      </button>
    );
  }

  return (
    <div ref={containerRef} className="relative flex items-center" style={{ opacity: disabled ? 0.4 : 1 }}>
      <button
        type="button"
        onClick={handleRun}
        disabled={disabled || !selected || isRunning}
        title={
          isRunning
            ? 'A process is already running'
            : selected ? `Run on ${selected.name}` : 'No target selected'
        }
        className="flex items-center gap-2 pl-3 pr-2 py-1 rounded-l text-sm font-medium transition-colors hover:bg-white/10"
        style={{
          background: isRunning ? 'transparent' : 'rgba(96, 165, 250, 0.15)',
          color: isRunning ? '#6b7280' : '#60a5fa',
          border: isRunning ? '1px solid #2d2d3a' : 'none',
          cursor: disabled || !selected || isRunning ? 'not-allowed' : 'pointer',
        }}
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
        <span>{selected ? selected.name : 'Select target'}</span>
      </button>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        disabled={disabled || targets.length === 0 || isRunning}
        title="Select run target"
        aria-label="Select run target"
        className="flex items-center px-1.5 py-1 rounded-r text-sm transition-colors hover:bg-white/10"
        style={{
          background: isRunning ? 'transparent' : 'rgba(96, 165, 250, 0.15)',
          color: isRunning ? '#6b7280' : '#60a5fa',
          border: isRunning ? '1px solid #2d2d3a' : 'none',
          borderLeft: isRunning ? 'none' : '1px solid rgba(96, 165, 250, 0.3)',
          cursor: disabled || targets.length === 0 || isRunning ? 'not-allowed' : 'pointer',
        }}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && targets.length > 0 && (
        <div
          className="absolute top-full right-0 mt-1 rounded-lg overflow-hidden z-50"
          style={{
            background: '#1e1e2e',
            border: '1px solid #2d2d3a',
            minWidth: '220px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
          }}
        >
          {targets.map((target) => (
            <button
              key={target.id}
              type="button"
              onClick={() => handleSelect(target)}
              className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-white/5"
              style={{
                color: target.id === selected?.id ? '#a78bfa' : '#d4d4d4',
                background: target.id === selected?.id ? 'rgba(167, 139, 250, 0.1)' : 'transparent',
                fontFamily: 'Segoe UI, sans-serif',
              }}
            >
              {target.name}
              <span className="block text-[10px]" style={{ color: '#6b7280' }}>
                {target.platform || 'device'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}