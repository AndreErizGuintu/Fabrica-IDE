import { useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import AppSidebar from '../components/AppSidebar';

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

const MAX_SESSIONS = 20;
const POLL_MS = 2000;

const COLOR_AI = '#a855f7';
const COLOR_RUNS = '#38bdf8';
const COLOR_IDLE = '#fbbf24';
const COLOR_ACTIVE = '#4ade80';
const CHART_GRID = 'rgba(168, 85, 247, 0.15)';
const CHART_AXIS = '#77718F';

const UI_FONT = 'Segoe UI, sans-serif';
const MONO_FONT = 'Space Mono, monospace';

const chartTooltipStyle = {
  backgroundColor: '#080719',
  border: '1px solid rgba(168, 85, 247, 0.3)',
  borderRadius: '8px',
  color: '#F4F1FF',
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
    + ' ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function toMinutes(ms: number): number {
  return Math.round((ms / 60000) * 10) / 10;
}

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

function Card({
  title, subtitle, icon, right, children,
}: {
  title: string; subtitle?: string; icon?: React.ReactNode;
  right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl p-5"
      style={{ backgroundColor: '#12102D', border: '1px solid #29204A' }}>
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2">
          {icon && <span style={{ color: '#a855f7' }}>{icon}</span>}
          <h2 className="text-base font-semibold" style={{ color: '#F4F1FF', fontFamily: UI_FONT }}>
            {title}
          </h2>
          {subtitle && (
            <span className="text-xs ml-2" style={{ color: '#A9A3C7', fontFamily: UI_FONT }}>
              {subtitle}
            </span>
          )}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function StatTile({
  label, value, accent, icon,
}: {
  label: string; value: string; accent: string; icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg px-4 py-3 flex items-center justify-between gap-3"
      style={{ backgroundColor: '#080719', border: '1px solid #29204A' }}>
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: 'rgba(168, 85, 247, 0.1)', color: '#a855f7', fontSize: 14 }}>
          {icon}
        </div>
        <span className="text-[10px] uppercase tracking-wider font-medium"
          style={{ color: '#A9A3C7', fontFamily: UI_FONT }}>
          {label}
        </span>
      </div>
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
      <div className="flex h-2.5 w-full rounded-full overflow-hidden" style={{ backgroundColor: '#080719' }}>
        <div style={{ width: activePct + '%', backgroundColor: COLOR_ACTIVE }} />
        <div style={{ width: idlePct + '%', backgroundColor: COLOR_IDLE }} />
      </div>
      <div className="flex items-center gap-5 mt-3 text-xs" style={{ fontFamily: UI_FONT }}>
        <span className="flex items-center gap-2" style={{ color: '#A9A3C7' }}>
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: COLOR_ACTIVE }} />
          Active <span style={{ color: '#F4F1FF', fontWeight: 600 }}>{Math.round(activePct)}%</span>
        </span>
        <span className="flex items-center gap-2" style={{ color: '#A9A3C7' }}>
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: COLOR_IDLE }} />
          Idle <span style={{ color: '#F4F1FF', fontWeight: 600 }}>{Math.round(idlePct)}%</span>
        </span>
      </div>
    </div>
  );
}

function CompareCell({ value, delta }: { value: string; delta?: string }) {
  return (
    <td className="py-2 px-2 text-sm"
      style={{
        color: '#F4F1FF',
        fontFamily: MONO_FONT,
        borderBottom: '1px solid #29204A',
      }}>
      {value}
      {delta && (
        <span className="ml-2 text-xs"
          style={{ color: delta.startsWith('-') ? COLOR_ACTIVE : '#A9A3C7' }}>
          {delta}
        </span>
      )}
    </td>
  );
}

export default function StatsDashboard({
  onBack, onOpenSettings, recentProjects,
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
    return () => { cancelled = true; };
  }, [recentProjects]);

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
      .catch((err) => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [selectedPath, reloadKey]);

  useEffect(() => {
    console.log(`[STATS][dashboard] live-poll effect mounted at=${new Date().toISOString()}`);
    const intervalId = setInterval(() => {
      console.log(`[STATS][dashboard] poll tick at=${new Date().toISOString()}`);
      Promise.all([window.stats.getCurrentSession(), window.stats.getAggregate()])
        .then(([current, agg]) => {
          console.log('[STATS][dashboard] poll result', { current, agg });
          setCurrentSession(current);
          setAggregate(agg);
        })
        .catch((err) => setError(String(err)));
    }, POLL_MS);
    return () => {
      console.log(`[STATS][dashboard] live-poll effect unmounted/cleaned up at=${new Date().toISOString()}`);
      clearInterval(intervalId);
    };
  }, []);

  const isLive = !!currentSession && currentSession.projectPath === selectedPath;

  const summary: SessionSummary | null = useMemo(() => {
    console.log(`[STATS][dashboard] summary recompute at=${new Date().toISOString()} isLive=${isLive}`);
    if (isLive && currentSession) {
      const { durationMs, idleMs, activeMs } = deriveDurations(currentSession.sessionStart, null, currentSession.idleTimeMs);
      return {
        label: 'Current session',
        live: true,
        startedAt: currentSession.sessionStart,
        durationMs, activeMs, idleMs,
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
      durationMs, activeMs, idleMs,
      aiCallCount: latest.aiCallCount,
      runCount: latest.runCount,
    };
  }, [isLive, currentSession, history]);

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
    backgroundColor: '#080719',
    color: '#F4F1FF',
    border: '1px solid #29204A',
    fontFamily: UI_FONT,
  };

  const renderComparisonRow = (label: string, valueA: string, valueB: string, delta?: string) => (
    <tr>
      <td className="py-2 px-2 text-xs"
        style={{
          color: '#A9A3C7',
          fontFamily: UI_FONT,
          borderBottom: '1px solid #29204A',
        }}>
        {label}
      </td>
      <CompareCell value={valueA} />
      <CompareCell value={valueB} delta={delta} />
    </tr>
  );

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#080719', color: '#F4F1FF' }}>
      <AppSidebar
        active="stats-dashboard"
        onNavigate={(screen) => {
          if (screen === 'main') onBack();
          if (screen === 'settings') onOpenSettings();
        }}
        bottomSlot={
          <>
            <div className="text-[10px] uppercase tracking-wider mb-1.5"
              style={{ color: '#77718F', fontFamily: UI_FONT }}>
              Tracked sessions
            </div>
            <div className="flex items-center justify-between px-3 py-1.5 rounded text-sm"
              style={{
                backgroundColor: '#080719',
                color: '#F4F1FF',
                fontFamily: MONO_FONT,
                border: '1px solid #29204A',
              }}>
              <span>{aggregate ? aggregate.totalSessionCount : '—'}</span>
              <span style={{ color: '#77718F', fontSize: 10 }}>all projects</span>
            </div>
          </>
        }
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-6 py-4 shrink-0"
          style={{ borderBottom: '1px solid #29204A' }}>
          <div className="flex items-center gap-3">
            <span style={{ color: '#a855f7', fontSize: 20 }}>📊</span>
            <h1 className="text-lg font-semibold" style={{ color: '#F4F1FF', fontFamily: UI_FONT }}>
              Stats Dashboard
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {projectOptions.length > 1 && (
              <select
                value={selectedPath ?? ''}
                onChange={(event) => setSelectedPath(event.target.value)}
                className="px-3 py-1.5 rounded-lg text-sm outline-none"
                style={selectStyle}>
                {projectOptions.map((project) => (
                  <option key={project.path} value={project.path}>{project.name}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => setReloadKey((key) => key + 1)}
              className="flex items-center gap-2 px-3.5 py-1.5 text-sm rounded-lg transition-colors hover:bg-white/5"
              style={{ color: '#c084fc', border: '1px solid rgba(168, 85, 247, 0.3)', fontFamily: UI_FONT }}>
              <span>⟳</span> Refresh
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="max-w-6xl mx-auto flex flex-col gap-5">
            {error && (
              <div className="rounded-lg px-4 py-3 text-sm"
                style={{
                  backgroundColor: 'rgba(248, 113, 113, 0.1)',
                  border: '1px solid #f87171',
                  color: '#f87171',
                  fontFamily: UI_FONT,
                }}>
                {error}
              </div>
            )}

            {loading && (
              <div className="text-sm" style={{ color: '#A9A3C7', fontFamily: UI_FONT }}>
                Loading stats…
              </div>
            )}

            {!loading && !selectedPath && (
              <div className="text-center py-16">
                <div className="text-4xl mb-3 opacity-30">📊</div>
                <div className="text-sm" style={{ color: '#A9A3C7', fontFamily: UI_FONT }}>
                  No tracked sessions yet
                </div>
                <div className="text-xs mt-1" style={{ color: '#77718F', fontFamily: UI_FONT }}>
                  Open a project and start coding — sessions are recorded automatically.
                </div>
              </div>
            )}

            {selectedPath && (
              <Card
                title={summary ? summary.label : 'Session summary'}
                icon={<span>●</span>}
                right={
                  summary && (
                    <span className="flex items-center gap-2 text-xs"
                      style={{ color: '#A9A3C7', fontFamily: UI_FONT }}>
                      <span className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: summary.live ? '#4ade80' : '#77718F' }} />
                      {summary.live ? 'Live' : 'Ended'} · {formatDateTime(summary.startedAt)}
                    </span>
                  )
                }>
                {summary ? (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      <StatTile label="Active time" value={formatDuration(summary.activeMs)} accent={COLOR_ACTIVE} icon={<span>🕐</span>} />
                      <StatTile label="Idle time" value={formatDuration(summary.idleMs)} accent={COLOR_IDLE} icon={<span>🌙</span>} />
                      <StatTile label="AI calls" value={String(summary.aiCallCount)} accent={COLOR_AI} icon={<span>✨</span>} />
                      <StatTile label="Runs" value={String(summary.runCount)} accent={COLOR_RUNS} icon={<span>▶</span>} />
                    </div>
                    <SplitBar activeMs={summary.activeMs} idleMs={summary.idleMs} />
                    <div className="text-[11px] mt-4" style={{ color: '#77718F', fontFamily: UI_FONT }}>
                      Total session length <span style={{ color: '#A9A3C7' }}>{formatDuration(summary.durationMs)}</span> · active
                      time is session length minus idle time (idle accrues after 15s of no editor, AI, or run
                      activity).
                    </div>
                  </>
                ) : (
                  <div className="text-sm" style={{ color: '#A9A3C7', fontFamily: UI_FONT }}>
                    No sessions recorded for this project yet.
                  </div>
                )}
              </Card>
            )}

            {selectedPath && (
              <Card
                title="Session trend"
                icon={<span>📈</span>}
                right={
                  <select className="px-3 py-1 rounded-lg text-xs outline-none"
                    style={{ ...selectStyle, fontSize: 11 }} defaultValue="20">
                    <option value="20">Last 20 sessions</option>
                    <option value="10">Last 10 sessions</option>
                    <option value="50">Last 50 sessions</option>
                  </select>
                }>
                {trendData.length === 0 ? (
                  <div className="text-sm" style={{ color: '#A9A3C7', fontFamily: UI_FONT }}>
                    No completed sessions yet — the trend appears once at least one session has been written.
                  </div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={260}>
                      <ComposedChart data={trendData} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
                        <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" stroke={CHART_AXIS} tick={{ fontSize: 10, fill: CHART_AXIS }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
                        <YAxis yAxisId="left" stroke={CHART_AXIS} tick={{ fontSize: 11, fill: CHART_AXIS }} allowDecimals={false} axisLine={false} tickLine={false} />
                        <YAxis yAxisId="right" orientation="right" stroke={CHART_AXIS} tick={{ fontSize: 11, fill: CHART_AXIS }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={chartTooltipStyle} cursor={{ fill: 'rgba(168, 85, 247, 0.08)' }} />
                        <Legend wrapperStyle={{ fontSize: 11, fontFamily: UI_FONT, paddingTop: 10 }} iconType="circle" iconSize={8} />
                        <Bar yAxisId="right" dataKey="idleMinutes" name="Idle (min)" fill={COLOR_IDLE} fillOpacity={0.85} radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={40} />
                        <Line yAxisId="left" type="monotone" dataKey="aiCalls" name="AI calls" stroke={COLOR_AI} strokeWidth={2} dot={{ r: 3, fill: '#080719', strokeWidth: 2 }} isAnimationActive={false} />
                        <Line yAxisId="left" type="monotone" dataKey="runs" name="Runs" stroke={COLOR_RUNS} strokeWidth={2} dot={{ r: 3, fill: '#080719', strokeWidth: 2 }} isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>

                    {trend && (
                      <div className="mt-4 px-4 py-2.5 rounded-lg text-xs"
                        style={{
                          backgroundColor: '#080719',
                          border: '1px solid #29204A',
                          color: '#A9A3C7',
                          fontFamily: UI_FONT,
                        }}>
                        AI calls per session averaged{' '}
                        <span style={{ color: COLOR_AI, fontFamily: MONO_FONT, fontWeight: 600 }}>{trend.earlier.toFixed(1)}</span>{' '}
                        across the earlier half and{' '}
                        <span style={{ color: COLOR_AI, fontFamily: MONO_FONT, fontWeight: 600 }}>{trend.later.toFixed(1)}</span>{' '}
                        across the later half —{' '}
                        <span style={{ color: trend.changePct < 0 ? COLOR_ACTIVE : '#F4F1FF', fontWeight: 600 }}>
                          {trend.changePct > 0 ? '+' : ''}{trend.changePct}%
                        </span>
                        {trend.changePct < 0 ? ' (reliance trending down).' : '.'}
                      </div>
                    )}
                  </>
                )}
              </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {selectedPath && history.length >= 2 && (
                <Card
                  title="Compare two sessions"
                  icon={<span>📋</span>}
                  right={
                    <span className="text-[10px]" style={{ color: '#77718F', fontFamily: UI_FONT }}>
                      Deltas vs. first
                    </span>
                  }>
                  <div className="flex items-center gap-3 mb-4">
                    <select value={compareA} onChange={(event) => setCompareA(event.target.value)}
                      className="flex-1 px-3 py-1.5 rounded-lg text-xs outline-none" style={selectStyle}>
                      {history.map((entry) => (
                        <option key={entry.fileName} value={entry.fileName}>{formatShortLabel(entry.sessionStart)}</option>
                      ))}
                    </select>
                    <span className="text-xs" style={{ color: '#77718F', fontFamily: UI_FONT }}>vs</span>
                    <select value={compareB} onChange={(event) => setCompareB(event.target.value)}
                      className="flex-1 px-3 py-1.5 rounded-lg text-xs outline-none" style={selectStyle}>
                      {history.map((entry) => (
                        <option key={entry.fileName} value={entry.fileName}>{formatShortLabel(entry.sessionStart)}</option>
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
                                <th className="text-left py-2 px-2 text-[10px] uppercase tracking-wider"
                                  style={{ color: '#77718F', fontFamily: UI_FONT }}>Metric</th>
                                <th className="text-left py-2 px-2 text-[11px]"
                                  style={{ color: '#F4F1FF', fontFamily: UI_FONT }}>{formatShortLabel(sessionA.sessionStart)}</th>
                                <th className="text-left py-2 px-2 text-[11px]"
                                  style={{ color: '#F4F1FF', fontFamily: UI_FONT }}>{formatShortLabel(sessionB.sessionStart)}</th>
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
                    <div className="text-sm" style={{ color: '#A9A3C7', fontFamily: UI_FONT }}>
                      Select two sessions to compare.
                    </div>
                  )}
                </Card>
              )}

              {aggregate && (
                <Card
                  title="All-time totals"
                  icon={<span>📊</span>}
                  right={
                    <span className="text-[10px]" style={{ color: '#77718F', fontFamily: UI_FONT }}>
                      Updated {formatDateTime(aggregate.lastUpdated)}
                    </span>
                  }>
                  <div className="grid grid-cols-2 gap-3">
                    <StatTile label="Sessions" value={String(aggregate.totalSessionCount)} accent="#F4F1FF" icon={<span>📅</span>} />
                    <StatTile label="Total idle" value={formatDuration(aggregate.totalIdleTimeMs)} accent={COLOR_IDLE} icon={<span>🕐</span>} />
                    <StatTile label="Total AI calls" value={String(aggregate.totalAiCallCount)} accent={COLOR_AI} icon={<span>✨</span>} />
                    <StatTile label="Total runs" value={String(aggregate.totalRunCount)} accent={COLOR_RUNS} icon={<span>▶</span>} />
                  </div>
                  <div className="text-[11px] mt-4" style={{ color: '#77718F', fontFamily: UI_FONT }}>
                    Totals span every project, not just the one selected above.
                  </div>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}