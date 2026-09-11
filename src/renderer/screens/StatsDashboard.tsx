import { useEffect, useMemo, useState } from 'react';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import logo from '../../assets/log.png';

/**
 * Stats Dashboard — product UI over the Stats layer (src/main/stats.ts).
 *
 * Reads only the three existing read-only IPC handlers (stats:getCurrentSession,
 * stats:getAggregate, stats:getSessionHistory). No main-process changes, no
 * Adaptive Engine internals (scenario booleans / cooldowns stay debug-only in
 * StatsDebugPanel.tsx).
 *
 * Styling follows the SettingsScreen/MainMenu convention in App.tsx: Tailwind
 * for layout, inline style only for brand hex colors and fonts.
 */

type RecentProjectLike = {
  name: string;
  path: string;
};

type SessionEntry = {
  fileName: string;
  projectPath: string;
  sessionStart: string;
  sessionEnd: string;
  idleTimeMs: number;
  aiCallCount: number;
  runCount: number;
};

type CurrentSession = {
  projectPath: string;
  sessionStart: string;
  idleTimeMs: number;
  aiCallCount: number;
  runCount: number;
} | null;

type Aggregate = {
  totalIdleTimeMs: number;
  totalAiCallCount: number;
  totalRunCount: number;
  totalSessionCount: number;
  lastUpdated: string;
} | null;

type SessionSummary = {
  label: string;
  live: boolean;
  startedAt: string;
  durationMs: number;
  activeMs: number;
  idleMs: number;
  aiCallCount: number;
  runCount: number;
};

// getSessionHistory() returns session files unsorted and uncapped, so the
// dashboard sorts newest-first and caps here rather than in main.
const MAX_SESSIONS = 20;
const POLL_MS = 2000;

const COLOR_AI = '#a855f7';
const COLOR_RUNS = '#38bdf8';
const COLOR_IDLE = '#fbbf24';
const COLOR_ACTIVE = '#4ade80';
const CHART_GRID = '#3d2b5e';
const CHART_AXIS = '#a7adc5';

const UI_FONT = 'Segoe UI, sans-serif';
const MONO_FONT = 'Space Mono, monospace';

const chartTooltipStyle = {
  backgroundColor: '#1a0a2e',
  border: '1px solid #3d2b5e',
  color: '#d4d4d4',
  fontSize: 12,
  fontFamily: UI_FONT,
};

function getLastPathSegment(targetPath: string): string {
  return targetPath.split(/[\\/]/).filter(Boolean).pop() ?? targetPath;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return hours + 'h ' + minutes + 'm';
  if (minutes > 0) return minutes + 'm ' + seconds + 's';
  return seconds + 's';
}

function formatDateTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toLocaleString();
}

function formatShortLabel(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  const date = new Date(parsed);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    + ' '
    + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function toMinutes(ms: number): number {
  return Math.round((ms / 60000) * 10) / 10;
}

// Session files written before runCount existed (see DECISIONS.md 2026-08-04)
// have no runCount field, so every numeric field is defaulted defensively.
function normalizeHistory(rows: SessionEntry[]): SessionEntry[] {
  return rows
    .map((row) => ({
      ...row,
      idleTimeMs: Number.isFinite(row.idleTimeMs) ? row.idleTimeMs : 0,
      aiCallCount: Number.isFinite(row.aiCallCount) ? row.aiCallCount : 0,
      runCount: Number.isFinite(row.runCount) ? row.runCount : 0,
    }))
    .sort((a, b) => Date.parse(b.sessionStart) - Date.parse(a.sessionStart))
    .slice(0, MAX_SESSIONS);
}

function deriveDurations(startIso: string, endIso: string | null, idleTimeMs: number) {
  const start = Date.parse(startIso);
  const end = endIso ? Date.parse(endIso) : Date.now();
  const durationMs = Number.isNaN(start) || Number.isNaN(end) ? 0 : Math.max(0, end - start);
  const idleMs = Math.min(Math.max(0, idleTimeMs), durationMs);
  return { durationMs, idleMs, activeMs: Math.max(0, durationMs - idleMs) };
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg p-4"
      style={{ backgroundColor: '#2d1b4e', border: '1px solid #3d2b5e' }}
    >
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold" style={{ color: '#ffffff', fontFamily: UI_FONT }}>
          {title}
        </h2>
        {subtitle && (
          <span className="text-xs" style={{ color: '#a7adc5', fontFamily: UI_FONT }}>
            {subtitle}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div
      className="rounded-lg px-4 py-3 flex flex-col gap-1"
      style={{ backgroundColor: '#1a0a2e', border: '1px solid #3d2b5e' }}
    >
      <span className="text-[11px] uppercase tracking-wide" style={{ color: '#a7adc5', fontFamily: UI_FONT }}>
        {label}
      </span>
      <span className="text-xl font-semibold" style={{ color: accent, fontFamily: MONO_FONT }}>
        {value}
      </span>
    </div>
  );
}

function SplitBar({ activeMs, idleMs }: { activeMs: number; idleMs: number }) {
  const total = activeMs + idleMs;
  const activePct = total > 0 ? (activeMs / total) * 100 : 0;
  const idlePct = total > 0 ? 100 - activePct : 0;

  return (
    <div className="mt-4">
      <div className="flex h-3 w-full rounded-full overflow-hidden" style={{ backgroundColor: '#1a0a2e' }}>
        <div style={{ width: activePct + '%', backgroundColor: COLOR_ACTIVE }} />
        <div style={{ width: idlePct + '%', backgroundColor: COLOR_IDLE }} />
      </div>
      <div className="flex items-center gap-4 mt-2 text-xs" style={{ fontFamily: UI_FONT }}>
        <span className="flex items-center gap-1.5" style={{ color: '#a7adc5' }}>
          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: COLOR_ACTIVE }} />
          Active {Math.round(activePct)}%
        </span>
        <span className="flex items-center gap-1.5" style={{ color: '#a7adc5' }}>
          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: COLOR_IDLE }} />
          Idle {Math.round(idlePct)}%
        </span>
      </div>
    </div>
  );
}

function CompareCell({ value, delta }: { value: string; delta?: string }) {
  return (
    <td className="py-2 px-3 text-sm" style={{ color: '#d4d4d4', fontFamily: MONO_FONT, borderBottom: '1px solid #3d2b5e' }}>
      {value}
      {delta && (
        <span className="ml-2 text-xs" style={{ color: delta.startsWith('-') ? COLOR_ACTIVE : '#a7adc5' }}>
          {delta}
        </span>
      )}
    </td>
  );
}

export default function StatsDashboard({
  onBack,
  onOpenSettings,
  recentProjects,
}: {
  onBack: () => void;
  onOpenSettings: () => void;
  recentProjects: RecentProjectLike[];
}) {
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined);
  const [projectOptions, setProjectOptions] = useState<RecentProjectLike[]>([]);
  const [currentSession, setCurrentSession] = useState<CurrentSession>(null);
  const [aggregate, setAggregate] = useState<Aggregate>(null);
  const [history, setHistory] = useState<SessionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');

  // Initial load: current session + aggregate, then probe each recent project
  // for session history so the dropdown only offers projects that have any.
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const [current, agg] = await Promise.all([
          window.stats.getCurrentSession(),
          window.stats.getAggregate(),
        ]);
        if (cancelled) return;
        setCurrentSession(current);
        setAggregate(agg);

        const probes = await Promise.all(
          recentProjects.map(async (project) => {
            try {
              const rows = await window.stats.getSessionHistory(project.path);
              return { project, count: rows.length };
            } catch {
              return { project, count: 0 };
            }
          }),
        );
        if (cancelled) return;

        const options = probes.filter((probe) => probe.count > 0).map((probe) => probe.project);

        // A live session's project may not be in recent-projects.json yet
        // (opened via Open Folder without being added), so surface it anyway.
        if (current && !options.some((option) => option.path === current.projectPath)) {
          options.unshift({ name: getLastPathSegment(current.projectPath), path: current.projectPath });
        }

        setProjectOptions(options);
        setSelectedPath(current?.projectPath ?? options[0]?.path ?? recentProjects[0]?.path);
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void init();
    return () => {
      cancelled = true;
    };
  }, [recentProjects]);

  // Session history for the selected project.
  useEffect(() => {
    if (!selectedPath) return undefined;
    let cancelled = false;

    window.stats
      .getSessionHistory(selectedPath)
      .then((rows) => {
        if (cancelled) return;
        const normalized = normalizeHistory(rows);
        setHistory(normalized);
        setCompareA(normalized[0]?.fileName ?? '');
        setCompareB(normalized[1]?.fileName ?? '');
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPath, reloadKey]);

  // Live refresh of the in-memory session (same polling shape as the debug
  // panel, at a product-appropriate 2s instead of 1s).
  useEffect(() => {
    const intervalId = setInterval(() => {
      Promise.all([window.stats.getCurrentSession(), window.stats.getAggregate()])
        .then(([current, agg]) => {
          setCurrentSession(current);
          setAggregate(agg);
        })
        .catch((err) => setError(String(err)));
    }, POLL_MS);

    return () => clearInterval(intervalId);
  }, []);

  const isLive = !!currentSession && currentSession.projectPath === selectedPath;

  const summary: SessionSummary | null = useMemo(() => {
    if (isLive && currentSession) {
      const { durationMs, idleMs, activeMs } = deriveDurations(currentSession.sessionStart, null, currentSession.idleTimeMs);
      return {
        label: 'Current session',
        live: true,
        startedAt: currentSession.sessionStart,
        durationMs,
        activeMs,
        idleMs,
        aiCallCount: currentSession.aiCallCount ?? 0,
        runCount: currentSession.runCount ?? 0,
      };
    }

    const latest = history[0];
    if (!latest) return null;
    const { durationMs, idleMs, activeMs } = deriveDurations(latest.sessionStart, latest.sessionEnd, latest.idleTimeMs);
    return {
      label: 'Most recent session',
      live: false,
      startedAt: latest.sessionStart,
      durationMs,
      activeMs,
      idleMs,
      aiCallCount: latest.aiCallCount,
      runCount: latest.runCount,
    };
  }, [isLive, currentSession, history]);

  // Oldest to newest so the x-axis reads left-to-right as time moving forward.
  const trendData = useMemo(
    () =>
      [...history].reverse().map((entry) => {
        const { activeMs, idleMs } = deriveDurations(entry.sessionStart, entry.sessionEnd, entry.idleTimeMs);
        return {
          key: entry.fileName,
          label: formatShortLabel(entry.sessionStart),
          aiCalls: entry.aiCallCount,
          runs: entry.runCount,
          idleMinutes: toMinutes(idleMs),
          activeMinutes: toMinutes(activeMs),
        };
      }),
    [history],
  );

  // Split-half mean of AI calls — the cheapest honest read on whether AI
  // reliance is trending down across the captured sessions.
  const trend = useMemo(() => {
    if (trendData.length < 4) return null;
    const midpoint = Math.floor(trendData.length / 2);
    const mean = (rows: typeof trendData) =>
      rows.reduce((sum, row) => sum + row.aiCalls, 0) / (rows.length || 1);
    const earlier = mean(trendData.slice(0, midpoint));
    const later = mean(trendData.slice(midpoint));
    if (earlier === 0) return null;
    const changePct = Math.round(((later - earlier) / earlier) * 100);
    return { earlier, later, changePct };
  }, [trendData]);

  const sessionA = history.find((entry) => entry.fileName === compareA) ?? null;
  const sessionB = history.find((entry) => entry.fileName === compareB) ?? null;

  const selectStyle = {
    backgroundColor: '#1a0a2e',
    color: '#d4d4d4',
    border: '1px solid #3d2b5e',
    fontFamily: UI_FONT,
  };

  const renderComparisonRow = (label: string, valueA: string, valueB: string, delta?: string) => (
    <tr>
      <td className="py-2 px-3 text-sm" style={{ color: '#a7adc5', fontFamily: UI_FONT, borderBottom: '1px solid #3d2b5e' }}>
        {label}
      </td>
      <CompareCell value={valueA} />
      <CompareCell value={valueB} delta={delta} />
    </tr>
  );

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#1a0a2e', color: '#d4d4d4' }}>
      {/* Sidebar — same shell as SettingsScreen / TemplatesScreen */}
      <div
        className="flex flex-col w-48 lg:w-56 shrink-0"
        style={{ backgroundColor: '#2d1b4e', borderRight: '1px solid #3d2b5e' }}
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <img src={logo} alt="Fabrica" className="w-6 h-6" />
          <span className="text-base font-semibold hidden sm:block" style={{ color: '#ffffff', fontFamily: UI_FONT }}>
            Fabrica
          </span>
        </div>

        <nav className="flex flex-col gap-0.5 px-2 mt-2">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded transition-colors hover:bg-white/5"
            style={{ color: '#a7adc5', fontFamily: UI_FONT }}
          >
            <span>📁</span> Projects
          </button>
          <div
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded"
            style={{
              backgroundColor: 'rgba(168, 85, 247, 0.15)',
              color: '#a855f7',
              fontFamily: UI_FONT,
              cursor: 'default',
            }}
          >
            <span>📊</span> Stats
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded transition-colors hover:bg-white/5"
            style={{ color: '#a7adc5', fontFamily: UI_FONT }}
          >
            <span>⚙️</span> Settings
          </button>
        </nav>

        <div className="mt-auto px-3 py-3">
          <div className="text-xs" style={{ color: '#a7adc5', fontFamily: UI_FONT, marginBottom: '4px' }}>
            Tracked sessions
          </div>
          <div
            className="flex items-center justify-between px-3 py-1.5 rounded text-sm"
            style={{
              backgroundColor: '#1a0a2e',
              color: '#d4d4d4',
              fontFamily: MONO_FONT,
              border: '1px solid #3d2b5e',
            }}
          >
            <span>{aggregate ? aggregate.totalSessionCount : '—'}</span>
            <span style={{ color: '#a7adc5' }}>all projects</span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div
          className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3 shrink-0"
          style={{ borderBottom: '1px solid #3d2b5e' }}
        >
          <h1 className="text-base sm:text-lg font-semibold" style={{ color: '#ffffff', fontFamily: UI_FONT }}>
            Stats Dashboard
          </h1>

          <div className="flex items-center gap-2">
            {projectOptions.length > 1 && (
              <select
                value={selectedPath ?? ''}
                onChange={(event) => setSelectedPath(event.target.value)}
                className="px-3 py-1.5 rounded text-sm outline-none"
                style={selectStyle}
              >
                {projectOptions.map((project) => (
                  <option key={project.path} value={project.path}>
                    {project.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => setReloadKey((key) => key + 1)}
              className="px-3 py-1.5 text-sm rounded transition-colors hover:bg-white/5"
              style={{ color: '#a7adc5', border: '1px solid #3d2b5e', fontFamily: UI_FONT }}
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
          <div className="max-w-5xl mx-auto flex flex-col gap-4">
            {error && (
              <div
                className="rounded-lg px-4 py-3 text-sm"
                style={{ backgroundColor: 'rgba(248, 113, 113, 0.1)', border: '1px solid #f87171', color: '#f87171', fontFamily: UI_FONT }}
              >
                {error}
              </div>
            )}

            {loading && (
              <div className="text-sm" style={{ color: '#a7adc5', fontFamily: UI_FONT }}>
                Loading stats…
              </div>
            )}

            {!loading && !selectedPath && (
              <div className="text-center py-16">
                <div className="text-4xl mb-3 opacity-30">📊</div>
                <div className="text-sm" style={{ color: '#a7adc5', fontFamily: UI_FONT }}>
                  No tracked sessions yet
                </div>
                <div className="text-xs mt-1" style={{ color: '#3d2b5e', fontFamily: UI_FONT }}>
                  Open a project and start coding — sessions are recorded automatically.
                </div>
              </div>
            )}

            {/* ── 1. Session summary ──────────────────────────── */}
            {selectedPath && (
              <Card
                title={summary ? summary.label : 'Session summary'}
                subtitle={summary ? (summary.live ? 'Live · started ' + formatDateTime(summary.startedAt) : formatDateTime(summary.startedAt)) : undefined}
              >
                {summary ? (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      <StatTile label="Active time" value={formatDuration(summary.activeMs)} accent={COLOR_ACTIVE} />
                      <StatTile label="Idle time" value={formatDuration(summary.idleMs)} accent={COLOR_IDLE} />
                      <StatTile label="AI calls" value={String(summary.aiCallCount)} accent={COLOR_AI} />
                      <StatTile label="Runs" value={String(summary.runCount)} accent={COLOR_RUNS} />
                    </div>
                    <SplitBar activeMs={summary.activeMs} idleMs={summary.idleMs} />
                    <div className="text-xs mt-3" style={{ color: '#a7adc5', fontFamily: UI_FONT }}>
                      Total session length {formatDuration(summary.durationMs)} · active time is session length minus idle time
                      (idle accrues after 15s of no editor, AI, or run activity).
                    </div>
                  </>
                ) : (
                  <div className="text-sm" style={{ color: '#a7adc5', fontFamily: UI_FONT }}>
                    No sessions recorded for this project yet.
                  </div>
                )}
              </Card>
            )}

            {/* ── 2. Session comparison — trend ───────────────── */}
            {selectedPath && (
              <Card
                title="Session trend"
                subtitle={trendData.length > 0 ? 'Last ' + trendData.length + ' sessions' : undefined}
              >
                {trendData.length === 0 ? (
                  <div className="text-sm" style={{ color: '#a7adc5', fontFamily: UI_FONT }}>
                    No completed sessions yet — the trend appears once at least one session has been written.
                  </div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={260}>
                      <ComposedChart data={trendData} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
                        <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" />
                        <XAxis dataKey="label" stroke={CHART_AXIS} tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                        <YAxis yAxisId="left" stroke={CHART_AXIS} tick={{ fontSize: 11 }} allowDecimals={false} />
                        <YAxis yAxisId="right" orientation="right" stroke={CHART_AXIS} tick={{ fontSize: 11 }} />
                        <Tooltip contentStyle={chartTooltipStyle} cursor={{ fill: 'rgba(168, 85, 247, 0.08)' }} />
                        <Legend wrapperStyle={{ fontSize: 11, fontFamily: UI_FONT }} />
                        <Bar yAxisId="right" dataKey="idleMinutes" name="Idle (min)" fill={COLOR_IDLE} fillOpacity={0.5} isAnimationActive={false} />
                        <Line yAxisId="left" type="monotone" dataKey="aiCalls" name="AI calls" stroke={COLOR_AI} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                        <Line yAxisId="left" type="monotone" dataKey="runs" name="Runs" stroke={COLOR_RUNS} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>

                    {trend && (
                      <div
                        className="mt-3 px-3 py-2 rounded text-xs"
                        style={{ backgroundColor: '#1a0a2e', border: '1px solid #3d2b5e', color: '#d4d4d4', fontFamily: UI_FONT }}
                      >
                        AI calls per session averaged{' '}
                        <span style={{ color: COLOR_AI, fontFamily: MONO_FONT }}>{trend.earlier.toFixed(1)}</span>{' '}
                        across the earlier half and{' '}
                        <span style={{ color: COLOR_AI, fontFamily: MONO_FONT }}>{trend.later.toFixed(1)}</span>{' '}
                        across the later half —{' '}
                        <span style={{ color: trend.changePct < 0 ? COLOR_ACTIVE : '#a7adc5' }}>
                          {trend.changePct > 0 ? '+' : ''}{trend.changePct}%
                        </span>
                        {trend.changePct < 0 ? ' (reliance trending down).' : '.'}
                      </div>
                    )}
                  </>
                )}
              </Card>
            )}

            {/* ── 3. Session comparison — side by side ────────── */}
            {selectedPath && history.length >= 2 && (
              <Card title="Compare two sessions" subtitle="Deltas shown against the first session">
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <select
                    value={compareA}
                    onChange={(event) => setCompareA(event.target.value)}
                    className="px-3 py-1.5 rounded text-sm outline-none"
                    style={selectStyle}
                  >
                    {history.map((entry) => (
                      <option key={entry.fileName} value={entry.fileName}>
                        {formatShortLabel(entry.sessionStart)}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs" style={{ color: '#a7adc5', fontFamily: UI_FONT }}>vs</span>
                  <select
                    value={compareB}
                    onChange={(event) => setCompareB(event.target.value)}
                    className="px-3 py-1.5 rounded text-sm outline-none"
                    style={selectStyle}
                  >
                    {history.map((entry) => (
                      <option key={entry.fileName} value={entry.fileName}>
                        {formatShortLabel(entry.sessionStart)}
                      </option>
                    ))}
                  </select>
                </div>

                {sessionA && sessionB ? (
                  (() => {
                    const a = deriveDurations(sessionA.sessionStart, sessionA.sessionEnd, sessionA.idleTimeMs);
                    const b = deriveDurations(sessionB.sessionStart, sessionB.sessionEnd, sessionB.idleTimeMs);
                    const delta = (valueA: number, valueB: number) => {
                      const diff = valueB - valueA;
                      if (diff === 0) return '±0';
                      return (diff > 0 ? '+' : '') + diff;
                    };

                    return (
                      <div className="overflow-x-auto">
                        <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                          <thead>
                            <tr>
                              <th className="text-left py-2 px-3 text-xs uppercase tracking-wide" style={{ color: '#a7adc5', fontFamily: UI_FONT, borderBottom: '1px solid #3d2b5e' }}>
                                Metric
                              </th>
                              <th className="text-left py-2 px-3 text-xs" style={{ color: '#ffffff', fontFamily: UI_FONT, borderBottom: '1px solid #3d2b5e' }}>
                                {formatShortLabel(sessionA.sessionStart)}
                              </th>
                              <th className="text-left py-2 px-3 text-xs" style={{ color: '#ffffff', fontFamily: UI_FONT, borderBottom: '1px solid #3d2b5e' }}>
                                {formatShortLabel(sessionB.sessionStart)}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {renderComparisonRow('Session length', formatDuration(a.durationMs), formatDuration(b.durationMs))}
                            {renderComparisonRow('Active time', formatDuration(a.activeMs), formatDuration(b.activeMs))}
                            {renderComparisonRow('Idle time', formatDuration(a.idleMs), formatDuration(b.idleMs))}
                            {renderComparisonRow('AI calls', String(sessionA.aiCallCount), String(sessionB.aiCallCount), delta(sessionA.aiCallCount, sessionB.aiCallCount))}
                            {renderComparisonRow('Runs', String(sessionA.runCount), String(sessionB.runCount), delta(sessionA.runCount, sessionB.runCount))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()
                ) : (
                  <div className="text-sm" style={{ color: '#a7adc5', fontFamily: UI_FONT }}>
                    Select two sessions to compare.
                  </div>
                )}
              </Card>
            )}

            {/* ── 4. All-time totals ──────────────────────────── */}
            {aggregate && (
              <Card title="All-time totals" subtitle={'Updated ' + formatDateTime(aggregate.lastUpdated)}>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <StatTile label="Sessions" value={String(aggregate.totalSessionCount)} accent="#ffffff" />
                  <StatTile label="Total idle" value={formatDuration(aggregate.totalIdleTimeMs)} accent={COLOR_IDLE} />
                  <StatTile label="Total AI calls" value={String(aggregate.totalAiCallCount)} accent={COLOR_AI} />
                  <StatTile label="Total runs" value={String(aggregate.totalRunCount)} accent={COLOR_RUNS} />
                </div>
                <div className="text-xs mt-3" style={{ color: '#a7adc5', fontFamily: UI_FONT }}>
                  Totals span every project, not just the one selected above.
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
