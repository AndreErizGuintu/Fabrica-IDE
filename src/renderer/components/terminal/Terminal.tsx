import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export type TerminalRunPayload = { language: string; path: string };

export type TerminalHandle = {
  run: (payload: TerminalRunPayload) => Promise<void>;
  write: (text: string) => void;
};

type TerminalProps = {
  onClose?: () => void;
  onRunningChange?: (running: boolean) => void;
};

const Terminal = forwardRef<TerminalHandle, TerminalProps>(({ onClose, onRunningChange }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [running, setRunning] = useState(false);

  const setRunningState = useCallback((value: boolean) => {
    setRunning(value);
    onRunningChange?.(value);
  }, [onRunningChange]);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const term = new XTerm({
      convertEol: true,
      fontFamily: 'Consolas, monospace',
      fontSize: 12,
      theme: { background: '#1e1e2e', foreground: '#d4d4d4' },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    xtermRef.current = term;

    const dataSub = term.onData((data) => {
      if (sessionIdRef.current) {
        window.terminal.input(sessionIdRef.current, data);
      }
    });

    const pasteFromClipboard = () => {
      navigator.clipboard.readText().then((text) => {
        if (text && sessionIdRef.current) {
          window.terminal.input(sessionIdRef.current, text);
        }
      }).catch(() => {});
    };

    // xterm.js doesn't wire clipboard copy/paste on its own — intercept the
    // relevant key combos here, before xterm's default handling (which would
    // otherwise turn Ctrl+C into a SIGINT byte and Ctrl+V into a literal 'v').
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;

      const isCtrlC = event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'c';
      const isCtrlInsert = event.ctrlKey && event.key === 'Insert';
      const isCtrlV = event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'v';
      const isShiftInsert = event.shiftKey && event.key === 'Insert';

      if (isCtrlC || isCtrlInsert) {
        const selection = term.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection).catch(() => {});
          return false;
        }
        // Ctrl+Insert has no interrupt meaning — swallow it even with no selection.
        // Bare Ctrl+C with no selection falls through so xterm sends SIGINT as usual.
        return !isCtrlC;
      }

      if (isCtrlV || isShiftInsert) {
        pasteFromClipboard();
        return false;
      }

      return true;
    });

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      pasteFromClipboard();
    };
    containerRef.current.addEventListener('contextmenu', handleContextMenu);

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(containerRef.current);

    return () => {
      dataSub.dispose();
      resizeObserver.disconnect();
      containerRef.current?.removeEventListener('contextmenu', handleContextMenu);
      if (sessionIdRef.current) {
        window.terminal.stop(sessionIdRef.current);
      }
      term.dispose();
      xtermRef.current = null;
    };
  }, []);

  useEffect(() => {
    const removeOutput = window.terminal.onOutput((sessionId, data) => {
      if (sessionId === sessionIdRef.current) {
        xtermRef.current?.write(data);
      }
    });
    const removeExit = window.terminal.onExit((sessionId, exitCode) => {
      if (sessionId === sessionIdRef.current) {
        sessionIdRef.current = null;
        xtermRef.current?.write(`\r\n\x1b[35m● Process exited with code ${exitCode}\x1b[0m\r\n`);
        setRunningState(false);
      }
    });
    return () => {
      removeOutput();
      removeExit();
    };
  }, [setRunningState]);

  useImperativeHandle(ref, () => ({
    run: async (payload: TerminalRunPayload) => {
      const term = xtermRef.current;
      if (!term) return;

      if (sessionIdRef.current) {
        await window.terminal.stop(sessionIdRef.current);
        term.write('\r\n\x1b[33m[stopped previous run]\x1b[0m\r\n');
        sessionIdRef.current = null;
        setRunningState(false);
      }

      term.write(`\x1b[35m▶ Running...\x1b[0m\r\n`);

      const result = await window.terminal.run(payload);
      if (!result.success) {
        term.write(`\r\n\x1b[31m${result.error ?? 'Failed to start'}\x1b[0m\r\n`);
        return;
      }
      if (result.sessionId) {
        sessionIdRef.current = result.sessionId;
        setRunningState(true);
      }
    },
    write: (text: string) => {
      xtermRef.current?.write(text);
    },
  }), [setRunningState]);

  const handleStop = async () => {
    if (!sessionIdRef.current) return;
    await window.terminal.stop(sessionIdRef.current);
  };

  const handleClear = () => {
    xtermRef.current?.clear();
  };

  return (
    <div className="flex flex-col h-full" style={{ background: '#1e1e2e' }}>
      <div
        className="flex items-center justify-between px-3 py-1 shrink-0"
        style={{ background: '#252535', borderBottom: '1px solid #2d2d3a' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-medium"
            style={{
              color: '#6b7280',
              fontFamily: 'Segoe UI, sans-serif',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Terminal
          </span>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: running ? '#4ade80' : '#52525b' }} />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleStop}
            disabled={!running}
            className="text-[10px] px-2 py-0.5 rounded transition-colors"
            style={{
              color: running ? '#f87171' : '#3f3f46',
              border: `1px solid ${running ? '#f87171' : '#2d2d3a'}`,
              cursor: running ? 'pointer' : 'not-allowed',
              background: 'transparent',
            }}
          >
            ◼ Stop
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="text-[10px] transition-colors hover:text-white"
            style={{ color: '#52525b' }}
          >
            Clear
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-[10px] transition-colors hover:text-white"
              style={{ color: '#52525b' }}
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <div ref={containerRef} className="flex-1 overflow-hidden px-2 py-1" />
    </div>
  );
});

Terminal.displayName = 'Terminal';

export default Terminal;
