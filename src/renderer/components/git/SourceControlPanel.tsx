import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// How often to re-run `git status` while the panel is on screen. Saves inside
// Fabrica refresh immediately via the refreshToken prop, so this interval only
// has to catch changes made *outside* the editor — a terminal command, an
// external editor, a build writing output. 3s is responsive enough for that
// without spawning a git process every second during normal editing.
const POLL_INTERVAL_MS = 3000;

// Source Control panel, modelled on VS Code's staging flow: a "Changes" list
// (working tree) and a separate "Staged Changes" list, per-file stage/unstage,
// and a single Sync (pull-then-push) or Publish action depending on whether a
// remote exists.
//
// Deliberately NOT built here (out of scope): hunk-level staging, diff view,
// merge-conflict UI, AI commit messages, ahead/behind counts.
//
// The panel stays mounted even while hidden so the file-tree decorations in
// Sidebar.tsx keep receiving status updates via onStatusChange when the panel
// is closed — that mirrors the previous behaviour, where refreshGitStatus ran
// independently of the panel's visibility.

type GitResult = { success: boolean; output: string; error?: string };

export type SourceControlPanelProps = {
  /** Repository root. Everything is disabled while undefined. */
  cwd?: string;
  /** Panel renders nothing when false, but keeps refreshing status. */
  visible: boolean;
  /** Raw git output sink — the terminal, so power users still see everything. */
  onLog: (text: string) => void;
  onNotify: (message: string, type?: 'info' | 'success' | 'error' | 'warning') => void;
  /** Raw porcelain lines, for the Sidebar's per-file badges. */
  onStatusChange?: (porcelainLines: string[]) => void;
  /**
   * Bump to force an immediate refresh. EditorLayout increments this on save,
   * so a saved file shows up in Changes straight away instead of waiting for
   * the next poll tick. Refreshes even while the panel is hidden, which also
   * keeps the Sidebar's badges current.
   */
  refreshToken?: number;
};

type FileEntry = { code: string; path: string };

// Porcelain v1: column 1 is the index (staged) state, column 2 the working-tree
// state, then a space, then the path. Two shapes need care and are both covered
// by parsePorcelainLine below:
//   - a path containing a space is emitted quoted:  M "my file.txt"
//   - a rename is emitted as a pair:                R  old.txt -> new.txt
function unquotePath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parsePorcelainLine(
  line: string,
): { staged?: FileEntry; unstaged?: FileEntry } | null {
  if (line.length < 3) return null;

  const indexCode = line[0] ?? ' ';
  const worktreeCode = line[1] ?? ' ';
  const rest = line.slice(3);
  if (!rest) return null;

  // For a rename the second half is the current path — the one git will accept
  // back as an argument to add/reset.
  const arrow = rest.indexOf(' -> ');
  const path = unquotePath(arrow === -1 ? rest : rest.slice(arrow + 4));
  if (!path) return null;

  // Untracked files are '??' and are entirely working-tree side.
  if (indexCode === '?' && worktreeCode === '?') {
    return { unstaged: { code: '?', path } };
  }

  return {
    staged: indexCode !== ' ' ? { code: indexCode, path } : undefined,
    unstaged: worktreeCode !== ' ' ? { code: worktreeCode, path } : undefined,
  };
}

// Turns a raw git failure into something a student can act on. Falls back to
// the first non-empty line of git's own output rather than inventing wording
// for cases we haven't specifically handled.
function humanError(action: string, result: GitResult): string {
  const raw = `${result.output ?? ''}\n${result.error ?? ''}`.toLowerCase();

  if (raw.includes('could not read from remote repository') || raw.includes('repository not found')) {
    return `${action} failed: the remote could not be reached. Check the URL and your access.`;
  }
  if (raw.includes('authentication failed') || raw.includes('invalid username or password')) {
    return `${action} failed: authentication was rejected by the remote.`;
  }
  if (raw.includes('please tell me who you are') || raw.includes('empty ident name')) {
    return `${action} failed: git has no identity set. Run git config user.name and user.email.`;
  }
  if (raw.includes('conflict')) {
    return `${action} failed: there are merge conflicts to resolve first.`;
  }
  if (raw.includes('no upstream branch') || raw.includes('has no upstream')) {
    return `${action} failed: this branch has no upstream yet. Use Publish first.`;
  }
  if (raw.includes('nothing to commit')) {
    return 'Nothing to commit — stage some changes first.';
  }
  if (raw.includes('not a git repository')) {
    return `${action} failed: this folder is not a git repository yet.`;
  }

  const firstLine = `${result.error ?? ''}\n${result.output ?? ''}`
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)[0];
  return firstLine ? `${action} failed: ${firstLine}` : `${action} failed.`;
}

export default function SourceControlPanel({
  cwd,
  visible,
  onLog,
  onNotify,
  onStatusChange,
  refreshToken = 0,
}: SourceControlPanelProps) {
  const [statusLines, setStatusLines] = useState<string[]>([]);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [commitMessage, setCommitMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // Mirrors `busy` for the poll closure, which deliberately does not list busy
  // in its deps (that would tear down and restart the interval on every git
  // action) and so would otherwise read a stale value.
  const busyRef = useRef(false);
  const [hasRemote, setHasRemote] = useState(false);
  const [branch, setBranch] = useState('');
  const [changesOpen, setChangesOpen] = useState(true);
  const [stagedOpen, setStagedOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [publishUrl, setPublishUrl] = useState('');
  const [showPublishInput, setShowPublishInput] = useState(false);

  // Guards for the poll: inFlightRef stops overlapping git calls stacking up on
  // a slow host, and seqRef makes sure an older in-flight refresh can never
  // overwrite a newer one's results if they land out of order.
  const inFlightRef = useRef(false);
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!cwd) {
      setStatusLines([]);
      setLogLines([]);
      setHasRemote(false);
      setBranch('');
      onStatusChange?.([]);
      return;
    }

    seqRef.current += 1;
    const seq = seqRef.current;
    inFlightRef.current = true;

    try {
      const [status, history, remotes, current] = await Promise.all([
        window.git.statusFiles(cwd),
        window.git.log(cwd),
        window.git.remotes(cwd),
        window.git.currentBranch(cwd),
      ]);

      // A newer refresh already committed its results; drop these.
      if (seq !== seqRef.current) return;

      const toLines = (result: GitResult) =>
        result.success
          ? result.output
              .split('\n')
              .map((l) => l.trimEnd())
              .filter((l) => l.trim().length > 0)
          : [];

      const nextStatus = toLines(status);
      setStatusLines(nextStatus);
      onStatusChange?.(nextStatus);
      setLogLines(toLines(history));
      // `git remote -v` exits 0 with empty stdout when nothing is configured.
      setHasRemote(remotes.success && remotes.output.trim().length > 0);
      setBranch(current.success ? current.output.trim() : '');
    } finally {
      inFlightRef.current = false;
    }
  }, [cwd, onStatusChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (visible) void refresh();
  }, [visible, refresh]);

  // Immediate refresh when the host reports a save.
  useEffect(() => {
    if (refreshToken > 0) void refresh();
  }, [refreshToken, refresh]);

  // Catches edits made outside the editor. Only runs while the panel is on
  // screen — there is no reason to spawn git processes during normal editing
  // with Source Control closed, and saves are covered by refreshToken anyway.
  useEffect(() => {
    if (!visible || !cwd) return undefined;

    const tick = () => {
      // Skip rather than queue: a git command in progress refreshes on its own
      // when it finishes, and an overlapping status call would race it.
      if (inFlightRef.current || busyRef.current) return;
      void refresh();
    };

    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [visible, cwd, refresh]);

  // Every mutating action funnels through here so raw output always reaches the
  // terminal while the panel itself only ever shows the readable summary.
  const run = useCallback(
    async (action: string, fn: () => Promise<GitResult>): Promise<boolean> => {
      if (!cwd) return false;
      busyRef.current = true;
      setBusy(true);
      onLog(`⎇ ${action}...\n`);
      try {
        const result = await fn();
        onLog(`${result.output || result.error || '(no output)'}\n`);
        if (result.success) {
          onLog('✓ Done\n');
        } else {
          onLog('✗ Failed\n');
          onNotify(humanError(action, result), 'error');
        }
        return result.success;
      } finally {
        busyRef.current = false;
        setBusy(false);
        await refresh();
      }
    },
    [cwd, onLog, onNotify, refresh],
  );

  const { staged, unstaged } = useMemo(() => {
    const stagedList: FileEntry[] = [];
    const unstagedList: FileEntry[] = [];
    statusLines.forEach((line) => {
      const parsed = parsePorcelainLine(line);
      if (!parsed) return;
      if (parsed.staged) stagedList.push(parsed.staged);
      if (parsed.unstaged) unstagedList.push(parsed.unstaged);
    });
    return { staged: stagedList, unstaged: unstagedList };
  }, [statusLines]);

  const disabled = !cwd || busy;

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    if (staged.length === 0) {
      onNotify('Nothing staged — stage a file before committing.', 'warning');
      return;
    }
    const ok = await run('Commit', () => window.git.commit(cwd!, commitMessage.trim()));
    if (ok) {
      setCommitMessage('');
      onNotify('Committed staged changes', 'success');
    }
  };

  // Pull first so a push can't be rejected for being behind; a failed pull
  // stops the sequence rather than pushing on top of an unresolved state.
  const handleSync = async () => {
    const pulled = await run('Pull', () => window.git.pull(cwd!));
    if (!pulled) return;
    const pushed = await run('Push', () => window.git.push(cwd!));
    if (pushed) onNotify('Sync complete', 'success');
  };

  const handlePublish = async () => {
    const url = publishUrl.trim();
    if (!url) return;
    const added = await run('Add remote', () => window.git.remoteAdd(cwd!, url));
    if (!added) return;
    const target = branch || 'master';
    const pushed = await run('Publish', () => window.git.pushSetUpstream(cwd!, target));
    if (pushed) {
      onNotify(`Published to origin/${target}`, 'success');
      setShowPublishInput(false);
      setPublishUrl('');
    }
  };

  if (!visible) return null;

  const codeColor = (code: string) => {
    if (code === 'M') return '#fbbf24';
    if (code === 'A' || code === '?') return '#4ade80';
    if (code === 'D') return '#f87171';
    if (code === 'R') return '#60a5fa';
    return '#81748F';
  };

  const sectionHeaderStyle = {
    color: '#81748F',
    fontFamily: 'Segoe UI, sans-serif',
    background: '#0F0616',
    borderTop: '1px solid rgba(168, 85, 247, 0.16)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  };

  const renderRow = (
    item: FileEntry,
    key: string,
    actionIcon: string,
    actionTitle: string,
    onAction: () => void,
  ) => (
    <div
      key={key}
      className="group flex items-center gap-2 px-4 py-0.5 text-xs transition-colors hover:bg-[#a855f7]/10"
      style={{ fontFamily: 'Segoe UI, sans-serif', color: codeColor(item.code) }}
    >
      <span className="shrink-0 text-[10px] font-medium w-4">{item.code}</span>
      <span className="truncate flex-1" title={item.path}>
        {item.path}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={onAction}
        title={actionTitle}
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hover:text-white"
        style={{ color: '#81748F', cursor: disabled ? 'not-allowed' : 'pointer' }}
      >
        <i className={`codicon ${actionIcon}`} style={{ fontSize: '12px' }} />
      </button>
    </div>
  );

  return (
    <div
      className="flex flex-col shrink-0 overflow-hidden border-l"
      style={{ width: '260px', background: '#0F0616', borderColor: 'rgba(168, 85, 247, 0.16)' }}
    >
      <div
        className="px-4 py-2 text-[10px] font-medium tracking-wider shrink-0 flex items-center justify-between"
        style={{
          color: '#B8AFC2',
          fontFamily: 'Segoe UI, sans-serif',
          borderBottom: '1px solid rgba(168, 85, 247, 0.16)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        <span className="flex items-center gap-2">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          Source Control
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          className="transition-colors hover:text-white"
          style={{ color: '#81748F' }}
          title="Refresh"
        >
          <i className="codicon codicon-refresh" style={{ fontSize: '13px' }} />
        </button>
      </div>

      {/* Commit — acts on staged files only */}
      <div className="px-4 pt-2 pb-2 shrink-0 flex flex-col gap-1.5 border-b" style={{ borderColor: 'rgba(168, 85, 247, 0.16)' }}>
        <input
          type="text"
          placeholder="Message (Ctrl+Enter to commit)"
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) void handleCommit();
          }}
          className="w-full text-[10px] px-2.5 py-1.5 rounded transition-all duration-200 focus:ring-1 focus:ring-[#a855f7]"
          style={{
            background: '#0F0616',
            color: '#F5F0FA',
            border: '1px solid rgba(168, 85, 247, 0.16)',
            fontFamily: 'Segoe UI, sans-serif',
            outline: 'none',
          }}
        />
        <button
          type="button"
          disabled={disabled || !commitMessage.trim() || staged.length === 0}
          onClick={() => void handleCommit()}
          className="text-[10px] px-3 py-1.5 rounded font-medium transition-all duration-200"
          style={{
            background:
              disabled || !commitMessage.trim() || staged.length === 0 ? 'rgba(168, 85, 247, 0.16)' : '#a855f7',
            color:
              disabled || !commitMessage.trim() || staged.length === 0 ? '#81748F' : '#ffffff',
            cursor:
              disabled || !commitMessage.trim() || staged.length === 0
                ? 'not-allowed'
                : 'pointer',
            border: 'none',
          }}
          title={staged.length === 0 ? 'Stage a file first' : 'Commit staged changes'}
        >
          {staged.length > 0 ? `Commit ${staged.length} staged` : 'Commit'}
        </button>

        {/* Primary remote action: Sync when a remote exists, Publish when not */}
        {hasRemote ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void handleSync()}
            className="text-[10px] px-3 py-1.5 rounded font-medium transition-all duration-200 flex items-center justify-center gap-1.5"
            style={{
              background: '#0F0616',
              color: disabled ? '#81748F' : '#a855f7',
              border: '1px solid #a855f7',
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontFamily: 'Segoe UI, sans-serif',
            }}
            title="Pull, then push"
          >
            <i className="codicon codicon-sync" style={{ fontSize: '11px' }} />
            Sync Changes
          </button>
        ) : (
          <>
            {!showPublishInput ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => setShowPublishInput(true)}
                className="text-[10px] px-3 py-1.5 rounded font-medium transition-all duration-200 flex items-center justify-center gap-1.5"
                style={{
                  background: '#0F0616',
                  color: disabled ? '#81748F' : '#4ade80',
                  border: '1px solid #4ade80',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  fontFamily: 'Segoe UI, sans-serif',
                }}
                title="Add a remote and push for the first time"
              >
                <i className="codicon codicon-cloud-upload" style={{ fontSize: '11px' }} />
                Publish
              </button>
            ) : (
              <div className="flex flex-col gap-1">
                <input
                  type="text"
                  autoFocus
                  placeholder="https://github.com/user/repo.git"
                  value={publishUrl}
                  onChange={(e) => setPublishUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handlePublish();
                    if (e.key === 'Escape') setShowPublishInput(false);
                  }}
                  className="w-full text-[10px] px-2.5 py-1.5 rounded focus:ring-1 focus:ring-[#4ade80]"
                  style={{
                    background: '#0F0616',
                    color: '#F5F0FA',
                    border: '1px solid rgba(168, 85, 247, 0.16)',
                    fontFamily: 'Segoe UI, sans-serif',
                    outline: 'none',
                  }}
                />
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={disabled || !publishUrl.trim()}
                    onClick={() => void handlePublish()}
                    className="flex-1 text-[10px] py-1 rounded font-medium"
                    style={{
                      background: disabled || !publishUrl.trim() ? '#1C0F30' : '#4ade80',
                      color: disabled || !publishUrl.trim() ? '#81748F' : '#0F0616',
                      border: 'none',
                      cursor: disabled || !publishUrl.trim() ? 'not-allowed' : 'pointer',
                      fontFamily: 'Segoe UI, sans-serif',
                    }}
                  >
                    Publish
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPublishInput(false)}
                    className="flex-1 text-[10px] py-1 rounded"
                    style={{
                      background: '#0F0616',
                      color: '#81748F',
                      border: '1px solid rgba(168, 85, 247, 0.16)',
                      fontFamily: 'Segoe UI, sans-serif',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Secondary/advanced: the raw porcelain commands, kept available */}
        <div className="flex gap-1">
          {[
            { label: 'init', fn: () => window.git.init(cwd!) },
            { label: 'push', fn: () => window.git.push(cwd!) },
            { label: 'pull', fn: () => window.git.pull(cwd!) },
          ].map(({ label, fn }) => (
            <button
              key={label}
              type="button"
              disabled={disabled}
              onClick={() => void run(label, fn)}
              className="flex-1 text-[9px] py-1 rounded transition-all duration-200 hover:bg-[#a855f7]/10"
              style={{
                background: '#0F0616',
                color: '#81748F',
                border: '1px solid rgba(168, 85, 247, 0.16)',
                opacity: disabled ? 0.4 : 1,
                fontFamily: 'Segoe UI, sans-serif',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Staged Changes */}
        <div className="shrink-0">
          <div
            className="w-full flex items-center gap-1 px-4 py-1 text-[10px] font-medium"
            style={{ ...sectionHeaderStyle, borderBottom: stagedOpen ? '1px solid rgba(168, 85, 247, 0.16)' : 'none' }}
          >
            <button
              type="button"
              onClick={() => setStagedOpen((p) => !p)}
              className="flex items-center gap-1 flex-1 text-left"
              style={{ color: 'inherit', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              <i
                className={`codicon ${stagedOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`}
                style={{ fontSize: '11px' }}
              />
              Staged Changes
            </button>
            {staged.length > 0 && (
              <span
                className="text-[9px] px-1.5 py-0.5 rounded-full"
                style={{ background: '#4ade80', color: '#0F0616' }}
              >
                {staged.length}
              </span>
            )}
          </div>
          {stagedOpen && (
            <div>
              {staged.length === 0 ? (
                <div className="px-4 py-1.5 text-xs" style={{ color: '#81748F', fontFamily: 'Segoe UI, sans-serif' }}>
                  Nothing staged
                </div>
              ) : (
                staged.map((item, i) =>
                  renderRow(item, `staged-${item.path}-${i}`, 'codicon-remove', 'Unstage', () => {
                    void run('Unstage', () => window.git.unstageFile(cwd!, item.path));
                  }),
                )
              )}
            </div>
          )}
        </div>

        {/* Changes (working tree) */}
        <div className="shrink-0">
          <div
            className="w-full flex items-center gap-1 px-4 py-1 text-[10px] font-medium"
            style={{ ...sectionHeaderStyle, borderBottom: changesOpen ? '1px solid rgba(168, 85, 247, 0.16)' : 'none' }}
          >
            <button
              type="button"
              onClick={() => setChangesOpen((p) => !p)}
              className="flex items-center gap-1 flex-1 text-left"
              style={{ color: 'inherit', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              <i
                className={`codicon ${changesOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`}
                style={{ fontSize: '11px' }}
              />
              Changes
            </button>
            {unstaged.length > 0 && (
              <>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void run('Stage all', () => window.git.add(cwd!))}
                  title="Stage all changes"
                  className="transition-colors hover:text-white"
                  style={{ color: '#81748F', cursor: disabled ? 'not-allowed' : 'pointer' }}
                >
                  <i className="codicon codicon-add" style={{ fontSize: '12px' }} />
                </button>
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full"
                  style={{ background: '#a855f7', color: '#0F0616' }}
                >
                  {unstaged.length}
                </span>
              </>
            )}
          </div>
          {changesOpen && (
            <div>
              {unstaged.length === 0 ? (
                <div className="px-4 py-1.5 text-xs" style={{ color: '#81748F', fontFamily: 'Segoe UI, sans-serif' }}>
                  {cwd ? 'No changes' : 'No folder open'}
                </div>
              ) : (
                unstaged.map((item, i) =>
                  renderRow(item, `unstaged-${item.path}-${i}`, 'codicon-add', 'Stage', () => {
                    void run('Stage', () => window.git.addFile(cwd!, item.path));
                  }),
                )
              )}
            </div>
          )}
        </div>

        {/* History */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={() => setHistoryOpen((p) => !p)}
            className="w-full flex items-center gap-1 px-4 py-1 text-[10px] font-medium transition-colors hover:bg-[#a855f7]/10"
            style={{ ...sectionHeaderStyle, borderBottom: historyOpen ? '1px solid rgba(168, 85, 247, 0.16)' : 'none' }}
          >
            <i
              className={`codicon ${historyOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`}
              style={{ fontSize: '11px' }}
            />
            History
          </button>
          {historyOpen && (
            <div>
              {logLines.length === 0 ? (
                <div className="px-4 py-1.5 text-xs" style={{ color: '#81748F', fontFamily: 'Segoe UI, sans-serif' }}>
                  No commits
                </div>
              ) : (
                logLines.map((line, i) => (
                  <div
                    key={`${line}-${i}`}
                    className="flex items-start gap-2 px-4 py-0.5 text-xs hover:bg-[#a855f7]/10"
                    style={{ fontFamily: 'Segoe UI, sans-serif' }}
                  >
                    <span
                      className="shrink-0 px-1.5 py-0.5 rounded"
                      style={{ background: '#180C29', color: '#a855f7', fontSize: '9px' }}
                    >
                      {line.slice(0, 7)}
                    </span>
                    <span className="truncate" style={{ color: '#81748F' }}>
                      {line.slice(8)}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
