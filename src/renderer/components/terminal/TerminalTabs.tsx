import {
  createRef,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type RefObject,
} from 'react';
import Terminal, { TerminalHandle, TerminalRunPayload } from './Terminal';

/**
 * VS Code-style multi-tab terminal.
 *
 * Every tab keeps its own xterm instance and its own pty sessionId, and every
 * tab stays MOUNTED while hidden (hidden via display:none, not unmounted) so
 * switching tabs never destroys scrollback or kills the shell.
 *
 * This component re-exposes the same TerminalHandle the single Terminal did, so
 * existing callers (EditorLayout's run / flutter run / git output writes) keep
 * working unchanged. Those calls are routed to the dedicated "run" tab rather
 * than to whichever tab happens to be active, so hitting Run can never kill a
 * blank shell the user opened with "+".
 */

type TabKind = 'run' | 'shell';

type TerminalTab = {
  id: string;
  title: string;
  kind: TabKind;
};

type TerminalTabsProps = {
  onClose?: () => void;
  onRunningChange?: (running: boolean) => void;
  cwd?: string;
};

let tabSequence = 0;
function nextTabId(): string {
  tabSequence += 1;
  return 'term-' + tabSequence;
}

// Monotonic so closing "cmd 1" can't make the next tab "cmd 1" again.
let shellSequence = 0;
function nextShellTitle(): string {
  shellSequence += 1;
  return 'cmd ' + shellSequence;
}

const RUN_TAB_TITLE = 'Terminal';

const TerminalTabs = forwardRef<TerminalHandle, TerminalTabsProps>(({ onClose, onRunningChange, cwd }, ref) => {
  // One id shared by both initializers so the first tab is active on the very
  // first render (no blank frame before an effect could seed it).
  const initialTabRef = useRef<TerminalTab | null>(null);
  if (!initialTabRef.current) {
    initialTabRef.current = { id: nextTabId(), title: RUN_TAB_TITLE, kind: 'run' };
  }

  const [tabs, setTabs] = useState<TerminalTab[]>(() => [initialTabRef.current as TerminalTab]);
  const [activeId, setActiveId] = useState<string>(() => (initialTabRef.current as TerminalTab).id);
  const [runningByTab, setRunningByTab] = useState<Record<string, boolean>>({});

  // Stable per-tab ref objects: a ref callback would fire on every render and
  // re-trigger the pending-run flush below.
  const handleRefs = useRef(new Map<string, RefObject<TerminalHandle | null>>());
  const runningHandlers = useRef(new Map<string, (running: boolean) => void>());
  const pendingRunRef = useRef<{ tabId: string; payload: TerminalRunPayload } | null>(null);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const onRunningChangeRef = useRef(onRunningChange);
  onRunningChangeRef.current = onRunningChange;

  // Seed the active tab once the initial tab exists.
  useEffect(() => {
    if (!activeId && tabs.length > 0) {
      setActiveId(tabs[0].id);
    }
  }, [activeId, tabs]);

  const refFor = (id: string) => {
    let tabRef = handleRefs.current.get(id);
    if (!tabRef) {
      tabRef = createRef<TerminalHandle>();
      handleRefs.current.set(id, tabRef);
    }
    return tabRef;
  };

  // Only the run tab's running state drives the parent (EditorLayout's Run
  // button); a user's blank shell being "running" must not make Run look busy.
  const runningHandlerFor = (id: string) => {
    let handler = runningHandlers.current.get(id);
    if (!handler) {
      handler = (running: boolean) => {
        setRunningByTab((prev) => ({ ...prev, [id]: running }));
        const runTab = tabsRef.current.find((tab) => tab.kind === 'run');
        if (runTab && runTab.id === id) {
          onRunningChangeRef.current?.(running);
        }
      };
      runningHandlers.current.set(id, handler);
    }
    return handler;
  };

  const addShellTab = useCallback(() => {
    const id = nextTabId();
    setTabs((prev) => [...prev, { id, title: nextShellTitle(), kind: 'shell' }]);
    setActiveId(id);
    return id;
  }, []);

  const closeTab = useCallback(async (id: string) => {
    // Kill this tab's pty session specifically, by its own sessionId.
    await handleRefs.current.get(id)?.current?.kill();

    const current = tabsRef.current;
    const index = current.findIndex((tab) => tab.id === id);
    const remaining = current.filter((tab) => tab.id !== id);

    handleRefs.current.delete(id);
    runningHandlers.current.delete(id);

    setTabs(remaining);
    setRunningByTab((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    if (activeIdRef.current === id) {
      const fallback = remaining[index] ?? remaining[index - 1] ?? remaining[0];
      setActiveId(fallback ? fallback.id : '');
    }
  }, []);

  // A run issued while no run tab exists (user closed it) creates one and fires
  // once that Terminal has mounted — refs are attached before effects run.
  useEffect(() => {
    const pending = pendingRunRef.current;
    if (!pending) return;
    const handle = handleRefs.current.get(pending.tabId)?.current;
    if (!handle) return;
    pendingRunRef.current = null;
    void handle.run(pending.payload);
  }, [tabs]);

  useImperativeHandle(ref, () => ({
    run: async (payload: TerminalRunPayload) => {
      const runTab = tabsRef.current.find((tab) => tab.kind === 'run');

      if (!runTab) {
        const id = nextTabId();
        pendingRunRef.current = { tabId: id, payload };
        setTabs((prev) => [{ id, title: RUN_TAB_TITLE, kind: 'run' as TabKind }, ...prev]);
        setActiveId(id);
        return;
      }

      setActiveId(runTab.id);
      await handleRefs.current.get(runTab.id)?.current?.run(payload);
    },
    write: (text: string) => {
      const runTab = tabsRef.current.find((tab) => tab.kind === 'run');
      const targetId = runTab ? runTab.id : activeIdRef.current;
      handleRefs.current.get(targetId)?.current?.write(text);
    },
    kill: async () => {
      const runTab = tabsRef.current.find((tab) => tab.kind === 'run');
      const targetId = runTab ? runTab.id : activeIdRef.current;
      await handleRefs.current.get(targetId)?.current?.kill();
    },
    clear: () => {
      handleRefs.current.get(activeIdRef.current)?.current?.clear();
    },
    focus: () => {
      handleRefs.current.get(activeIdRef.current)?.current?.focus();
    },
  }), []);

  const activeRunning = !!runningByTab[activeId];

  const handleStopActive = async () => {
    await handleRefs.current.get(activeId)?.current?.kill();
  };

  const handleClearActive = () => {
    handleRefs.current.get(activeId)?.current?.clear();
  };

  return (
    <div className="flex flex-col h-full" style={{ background: '#1e1e2e' }}>
      {/* Combined tab bar + controls — one chrome row, the panel is only 160px tall */}
      <div
        className="flex items-stretch justify-between shrink-0"
        style={{ background: '#252535', borderBottom: '1px solid #2d2d3a' }}
      >
        <div className="flex items-stretch min-w-0 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = tab.id === activeId;
            return (
              <div
                key={tab.id}
                role="button"
                tabIndex={0}
                onClick={() => setActiveId(tab.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') setActiveId(tab.id);
                }}
                className="group flex items-center gap-1.5 px-3 py-1 cursor-pointer transition-colors shrink-0"
                style={{
                  background: isActive ? '#1e1e2e' : 'transparent',
                  borderTop: '2px solid ' + (isActive ? '#a855f7' : 'transparent'),
                  borderRight: '1px solid #2d2d3a',
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: runningByTab[tab.id] ? '#4ade80' : '#52525b' }}
                />
                <span
                  className="text-[10px] font-medium whitespace-nowrap"
                  style={{
                    color: isActive ? '#ffffff' : '#6b7280',
                    fontFamily: 'Segoe UI, sans-serif',
                  }}
                >
                  {tab.title}
                </span>
                <button
                  type="button"
                  aria-label={'Close ' + tab.title}
                  onClick={(event) => {
                    event.stopPropagation();
                    void closeTab(tab.id);
                  }}
                  className="text-[10px] rounded px-0.5 transition-colors hover:text-white hover:bg-white/10"
                  style={{ color: isActive ? '#6b7280' : '#3f3f46' }}
                >
                  <i className="codicon codicon-close" style={{ fontSize: '10px' }} />
                </button>
              </div>
            );
          })}

          <button
            type="button"
            aria-label="New terminal"
            onClick={addShellTab}
            className="flex items-center px-2 transition-colors hover:text-white hover:bg-white/5 shrink-0"
            style={{ color: '#6b7280' }}
            title="New terminal"
          >
            <i className="codicon codicon-add" style={{ fontSize: '12px' }} />
          </button>
        </div>

        <div className="flex items-center gap-2 px-3 shrink-0">
          <button
            type="button"
            onClick={handleStopActive}
            disabled={!activeRunning}
            className="text-[10px] px-2 py-0.5 rounded transition-colors"
            style={{
              color: activeRunning ? '#f87171' : '#3f3f46',
              border: '1px solid ' + (activeRunning ? '#f87171' : '#2d2d3a'),
              cursor: activeRunning ? 'pointer' : 'not-allowed',
              background: 'transparent',
            }}
          >
            <span className="inline-flex items-center gap-1">
              <i className="codicon codicon-debug-stop" style={{ fontSize: '11px' }} /> Stop
            </span>
          </button>
          <button
            type="button"
            onClick={handleClearActive}
            className="text-[10px] transition-colors hover:text-white"
            style={{ color: '#52525b' }}
          >
            Clear
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close terminal panel"
              className="text-[10px] transition-colors hover:text-white"
              style={{ color: '#52525b' }}
            >
              <i className="codicon codicon-close" style={{ fontSize: '12px' }} />
            </button>
          )}
        </div>
      </div>

      {/* Every tab stays mounted; only the active one is displayed. */}
      <div className="flex-1 min-h-0 relative">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="absolute inset-0"
            style={{ display: tab.id === activeId ? 'block' : 'none' }}
          >
            <Terminal
              ref={refFor(tab.id)}
              visible={tab.id === activeId}
              showHeader={false}
              autoStartShell={tab.kind === 'shell'}
              cwd={cwd}
              onRunningChange={runningHandlerFor(tab.id)}
            />
          </div>
        ))}

        {tabs.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <span className="text-[11px]" style={{ color: '#6b7280', fontFamily: 'Segoe UI, sans-serif' }}>
              No open terminals
            </span>
            <button
              type="button"
              onClick={addShellTab}
              className="text-[10px] px-3 py-1 rounded transition-colors hover:bg-white/5"
              style={{
                color: '#a855f7',
                border: '1px solid rgba(168, 85, 247, 0.4)',
                fontFamily: 'Segoe UI, sans-serif',
              }}
            >
              New terminal
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

TerminalTabs.displayName = 'TerminalTabs';

export default TerminalTabs;