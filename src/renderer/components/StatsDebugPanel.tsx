import { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Area, AreaChart,
} from 'recharts';

/**
 * TEMPORARY debug-only UI for inspecting the Stats layer (src/main/stats.ts).
 * Not part of the product UI — safe to delete before defense.
 */

type CurrentSession = {
  projectPath: string;
  sessionStart: string;
  idleTimeMs: number;
  aiCallCount: number;
} | null;

type Aggregate = {
  totalIdleTimeMs: number;
  totalAiCallCount: number;
  totalSessionCount: number;
  lastUpdated: string;
};

type SessionHistoryEntry = {
  fileName: string;
  projectPath: string;
  sessionStart: string;
  sessionEnd: string;
  idleTimeMs: number;
  aiCallCount: number;
};

type StatsSample = { t: number; sessionCalls: number; sessionRuns: number };
const MAX_SAMPLES = 60;

// ── Theme tokens ─────────────────────────────────────────────
const BG_APP = '#0d0618';
const BG_CARD = 'linear-gradient(180deg, rgba(45, 27, 78, 0.35) 0%, rgba(24, 12, 41, 0.6) 100%)';
const BG_INSET = 'rgba(10, 5, 20, 0.5)';
const BORDER = 'rgba(168, 85, 247, 0.18)';
const BORDER_SOFT = 'rgba(168, 85, 247, 0.1)';
const TEXT_PRIMARY = '#F5F0FA';
const TEXT_MUTED = '#B8AFC2';
const TEXT_DIM = '#81748F';
const ACCENT = '#a855f7';

const CHART_GRID = 'rgba(168, 85, 247, 0.1)';
const CHART_AXIS = '#5a4a6e';
const COLOR_CALLS = '#a855f7';
const COLOR_RUNS = '#38bdf8';
const COLOR_GREEN = '#4ade80';
const COLOR_YELLOW = '#fbbf24';
const COLOR_PINK = '#f472b6';

const UI_FONT = 'Segoe UI, sans-serif';
const MONO_FONT = 'Space Mono, monospace';

const tooltipStyle: React.CSSProperties = {
  background: '#0a0514',
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  color: TEXT_PRIMARY,
  fontSize: 12,
  fontFamily: UI_FONT,
  padding: '8px 12px',
};

function formatSeconds(s: number | null): string {
  if (s === null) return '—';
  return `${s.toFixed(1)}s`;
}

function formatMs(ms: number): string {
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds - minutes * 60).toFixed(1);
  return `${minutes}m ${seconds}s`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ── Reusable UI pieces ──────────────────────────────────────
function ChartCard({
  title,
  icon,
  legend,
  children,
  delay = 0,
  isEntering,
}: {
  title: string;
  icon: React.ReactNode;
  legend?: React.ReactNode;
  children: React.ReactNode;
  delay?: number;
  isEntering: boolean;
}) {
  return (
    <div
      style={{
        background: BG_CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 14,
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 260,
        opacity: isEntering ? 0 : 1,
        transform: isEntering ? 'translateY(12px)' : 'translateY(0)',
        transition: `opacity 0.4s ease-out ${delay}ms, transform 0.4s cubic-bezier(0.4, 0, 0.2, 1) ${delay}ms`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ color: ACCENT, fontSize: 15 }}>{icon}</span>
        <span
          style={{
            color: TEXT_PRIMARY,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
            fontFamily: UI_FONT,
          }}
        >
          {title}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
      {legend && <div style={{ marginTop: 10 }}>{legend}</div>}
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        background: color,
        display: 'inline-block',
        marginRight: 6,
      }}
    />
  );
}

function ChartLegend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div style={{ display: 'flex', gap: 20, justifyContent: 'center', paddingTop: 4 }}>
      {items.map((it) => (
        <span
          key={it.label}
          style={{ color: TEXT_MUTED, fontSize: 11, fontFamily: UI_FONT, display: 'inline-flex', alignItems: 'center' }}
        >
          <Dot color={it.color} /> {it.label}
        </span>
      ))}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────
interface StatsDebugPanelProps {
  projectPath?: string;
  open: boolean;
  onClose: () => void;
}

export default function StatsDebugPanel({ projectPath, open, onClose }: StatsDebugPanelProps) {
  const [currentSession, setCurrentSession] = useState<CurrentSession>(null);
  const [aggregate, setAggregate] = useState<Aggregate | null>(null);
  const [history, setHistory] = useState<SessionHistoryEntry[]>([]);
  const [adaptive, setAdaptive] = useState<Awaited<ReturnType<typeof window.adaptive.getDebugState>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<StatsSample[]>([]);

  // Panel open animation — staggered reveal of all cards
  const [isEntering, setIsEntering] = useState(false);
  useEffect(() => {
    if (open) {
      setIsEntering(true);
      const t = setTimeout(() => setIsEntering(false), 420);
      return () => clearTimeout(t);
    }
    setIsEntering(false);
    return undefined;
  }, [open]);

  const loadData = async () => {
    setError(null);
    try {
      const [current, agg, hist, adaptiveState] = await Promise.all([
        window.stats.getCurrentSession(),
        window.stats.getAggregate(),
        projectPath ? window.stats.getSessionHistory(projectPath) : Promise.resolve([]),
        window.adaptive.getDebugState(),
      ]);
      setCurrentSession(current);
      setAggregate(agg);
      setHistory(hist);
      setAdaptive(adaptiveState);
    } catch (err) {
      setError(String(err));
    }
  };

  useEffect(() => {
    if (open) {
      setSamples([]);
      loadData();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const intervalId = setInterval(() => {
      Promise.all([window.stats.getCurrentSession(), window.stats.getAggregate(), window.adaptive.getDebugState()])
        .then(([current, agg, adaptiveState]) => {
          setCurrentSession(current);
          setAggregate(agg);
          setAdaptive(adaptiveState);
          setSamples((prev) => [
            ...prev,
            {
              t: Date.now(),
              sessionCalls: adaptiveState.scenario4.sessionCallCount,
              sessionRuns: adaptiveState.scenario4.sessionRunCount,
            },
          ].slice(-MAX_SAMPLES));
        })
        .catch((err) => setError(String(err)));
    }, 1000);
    return () => clearInterval(intervalId);
  }, [open]);

  const t0 = samples.length ? samples[0].t : 0;
  const activityData = samples.map((s) => ({
    elapsed: Math.round((s.t - t0) / 1000),
    sessionCalls: s.sessionCalls,
    sessionRuns: s.sessionRuns,
  }));

  const historyTrendData = [...history]
    .reverse()
    .map((entry) => {
      const d = new Date(entry.sessionStart);
      return {
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        aiCalls: entry.aiCallCount,
        idleMinutes: Math.round((entry.idleTimeMs / 60000) * 10) / 10,
      };
    });

  if (!open) return null;

  const headerIconBtn: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 14px',
    borderRadius: 10,
    border: `1px solid ${BORDER}`,
    background: 'transparent',
    color: TEXT_MUTED,
    fontSize: 12,
    fontFamily: UI_FONT,
    cursor: 'pointer',
    transition: 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease',
  };

  const tableLabelStyle: React.CSSProperties = {
    padding: '10px 14px',
    color: TEXT_DIM,
    fontFamily: UI_FONT,
    fontSize: 12,
    borderBottom: `1px solid ${BORDER_SOFT}`,
    width: 200,
  };
  const tableValueStyle: React.CSSProperties = {
    padding: '10px 14px',
    color: TEXT_PRIMARY,
    fontFamily: MONO_FONT,
    fontSize: 12,
    borderBottom: `1px solid ${BORDER_SOFT}`,
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: BG_APP,
        color: TEXT_PRIMARY,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: UI_FONT,
        fontSize: 13,
        overflow: 'hidden',
        opacity: isEntering ? 0 : 1,
        transform: isEntering ? 'scale(0.985) translateY(10px)' : 'scale(1) translateY(0)',
        transition: 'opacity 0.3s ease-out, transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {/* ── Top bar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          padding: '12px 24px',
          borderBottom: `1px solid ${BORDER}`,
          opacity: isEntering ? 0 : 1,
          transform: isEntering ? 'translateY(-8px)' : 'translateY(0)',
          transition: 'opacity 0.35s ease-out 60ms, transform 0.35s cubic-bezier(0.4, 0, 0.2, 1) 60ms',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 12px',
              borderRadius: 999,
              background: 'rgba(74, 222, 128, 0.08)',
              border: `1px solid ${COLOR_GREEN}`,
              color: COLOR_GREEN,
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: COLOR_GREEN,
                display: 'inline-block',
                animation: 'fabricaPulse 2s ease-in-out infinite',
              }}
            />
            {' '}Live
          </span>
          <button type="button" onClick={loadData} style={headerIconBtn}>
            ⟳ Refresh
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              ...headerIconBtn,
              color: '#f87171',
              borderColor: 'rgba(248, 113, 113, 0.35)',
            }}
          >
            ✕ Close
          </button>
        </div>
      </div>

      {/* ── Panel title ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '20px 24px 4px',
          opacity: isEntering ? 0 : 1,
          transform: isEntering ? 'translateY(-6px)' : 'translateY(0)',
          transition: 'opacity 0.35s ease-out 100ms, transform 0.35s cubic-bezier(0.4, 0, 0.2, 1) 100ms',
        }}
      >
        <span style={{ color: ACCENT, fontSize: 18 }}>📈</span>
        <span style={{ fontWeight: 700, fontSize: 20, color: TEXT_PRIMARY }}>Stats Debug</span>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 24px' }}>
        {error && (
          <pre
            style={{
              color: '#f87171',
              background: 'rgba(248, 113, 113, 0.06)',
              border: '1px solid rgba(248, 113, 113, 0.3)',
              borderRadius: 10,
              padding: 12,
              whiteSpace: 'pre-wrap',
              fontFamily: MONO_FONT,
              fontSize: 12,
              marginBottom: 16,
            }}
          >
            {error}
          </pre>
        )}

        {/* Row 1 — 4 cards with staggered entrance */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 16,
            marginBottom: 16,
          }}
        >
          <ChartCard
            title="Activity Over Time"
            icon={<span>📈</span>}
            delay={140}
            isEntering={isEntering}
            legend={
              <ChartLegend
                items={[
                  { color: COLOR_CALLS, label: 'AI calls' },
                  { color: COLOR_RUNS, label: 'Idle min' },
                ]}
              />
            }
          >
            {historyTrendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={170}>
                <AreaChart data={historyTrendData} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
                  <defs>
                    <linearGradient id="aiGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLOR_CALLS} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={COLOR_CALLS} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="idleGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLOR_RUNS} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={COLOR_RUNS} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke={CHART_AXIS} tick={{ fontSize: 10, fill: CHART_AXIS }} axisLine={false} tickLine={false} />
                  <YAxis stroke={CHART_AXIS} tick={{ fontSize: 10, fill: CHART_AXIS }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area type="monotone" dataKey="aiCalls" name="AI calls" stroke={COLOR_CALLS} strokeWidth={2} fill="url(#aiGrad)" animationDuration={900} animationEasing="ease-out" />
                  <Area type="monotone" dataKey="idleMinutes" name="Idle (min)" stroke={COLOR_RUNS} strokeWidth={2} fill="url(#idleGrad)" animationDuration={900} animationEasing="ease-out" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ color: TEXT_DIM, fontSize: 12, padding: '40px 0', textAlign: 'center' }}>
                No session history yet.
              </div>
            )}
          </ChartCard>

          {/* ── Actions / Events — animated vertical bars ── */}
          <ChartCard title="Actions / Events (current)" icon={<span>⚡</span>} delay={220} isEntering={isEntering}>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'space-around',
                height: 170,
                padding: '24px 20px 12px',
                gap: 20,
              }}
            >
              {[
                { label: 'Actions', value: adaptive?.scenario4.sessionCallCount ?? 0, color: COLOR_CALLS },
                { label: 'Events', value: adaptive?.scenario4.sessionRunCount ?? 0, color: COLOR_RUNS },
              ].map((bar, idx) => {
                const max = Math.max(
                  adaptive?.scenario4.sessionCallCount ?? 0,
                  adaptive?.scenario4.sessionRunCount ?? 0,
                  1,
                );
                const pct = bar.value === 0 ? 8 : Math.max((bar.value / max) * 100, 20);
                return (
                  <div
                    key={bar.label}
                    style={{
                      flex: 1,
                      maxWidth: 100,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 10,
                      height: '100%',
                      justifyContent: 'flex-end',
                    }}
                  >
                    <span
                      style={{
                        color: bar.color,
                        fontSize: 26,
                        fontFamily: MONO_FONT,
                        fontWeight: 700,
                        lineHeight: 1,
                        transition: 'color 0.3s ease',
                      }}
                    >
                      {bar.value}
                    </span>
                    <div
                      style={{
                        width: '100%',
                        height: `${pct}%`,
                        minHeight: 12,
                        background: `linear-gradient(180deg, ${bar.color} 0%, ${bar.color}80 100%)`,
                        borderRadius: 12,
                        boxShadow: `0 0 16px ${bar.color}40`,
                        opacity: bar.value > 0 ? 1 : 0.3,
                        transition: `height 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) ${idx * 80}ms, opacity 0.4s ease`,
                      }}
                    />
                    <span
                      style={{
                        color: TEXT_MUTED,
                        fontSize: 11,
                        fontFamily: UI_FONT,
                        fontWeight: 600,
                        letterSpacing: 0.6,
                        textTransform: 'uppercase',
                      }}
                    >
                      {bar.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </ChartCard>

          <ChartCard title="Activity Categories (session files)" icon={<span>📁</span>} delay={300} isEntering={isEntering}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 6 }}>
              {[
                { label: 'Total sessions', value: aggregate?.totalSessionCount ?? 0, color: COLOR_CALLS },
                { label: 'Total AI calls', value: aggregate?.totalAiCallCount ?? 0, color: COLOR_RUNS },
                { label: 'Active minutes', value: Math.round((aggregate?.totalIdleTimeMs ?? 0) / 60000), color: COLOR_GREEN },
                { label: 'Idle minutes', value: Math.round((currentSession?.idleTimeMs ?? 0) / 60000), color: COLOR_PINK },
              ].map((row, idx) => (
                <div
                  key={row.label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    opacity: isEntering ? 0 : 1,
                    transform: isEntering ? 'translateX(-6px)' : 'translateX(0)',
                    transition: `opacity 0.35s ease-out ${380 + idx * 60}ms, transform 0.35s cubic-bezier(0.4, 0, 0.2, 1) ${380 + idx * 60}ms`,
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', color: TEXT_PRIMARY, fontSize: 13 }}>
                    <Dot color={row.color} /> {row.label}
                  </span>
                  <span style={{ color: TEXT_PRIMARY, fontFamily: MONO_FONT, fontSize: 13, fontWeight: 600 }}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </ChartCard>

          <ChartCard title="Session Status" icon={<span>📡</span>} delay={380} isEntering={isEntering}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: TEXT_PRIMARY, fontSize: 13 }}>Suspension</span>
                <span
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '5px 14px', borderRadius: 999,
                    background: adaptive?.suggestionActive ? 'rgba(74,222,128,0.1)' : 'rgba(129,116,143,0.12)',
                    border: `1px solid ${adaptive?.suggestionActive ? COLOR_GREEN : 'rgba(129,116,143,0.3)'}`,
                    color: adaptive?.suggestionActive ? COLOR_GREEN : TEXT_MUTED,
                    fontSize: 12, fontWeight: 600,
                    transition: 'background 0.3s ease, border-color 0.3s ease, color 0.3s ease',
                  }}
                >
                  <Dot color={adaptive?.suggestionActive ? COLOR_GREEN : TEXT_MUTED} />
                  {adaptive?.suggestionActive ? `Active — S${adaptive.suggestionActive.scenario}` : 'Idle'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: TEXT_PRIMARY, fontSize: 13 }}>Cooldown</span>
                <span
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '5px 14px', borderRadius: 999,
                    background: adaptive?.cooldown.active ? 'rgba(251,191,36,0.1)' : 'rgba(74,222,128,0.1)',
                    border: `1px solid ${adaptive?.cooldown.active ? COLOR_YELLOW : COLOR_GREEN}`,
                    color: adaptive?.cooldown.active ? COLOR_YELLOW : COLOR_GREEN,
                    fontSize: 12, fontWeight: 600,
                    transition: 'background 0.3s ease, border-color 0.3s ease, color 0.3s ease',
                  }}
                >
                  <Dot color={adaptive?.cooldown.active ? COLOR_YELLOW : COLOR_GREEN} />
                  {adaptive?.cooldown.active ? `Cooling ${formatSeconds(adaptive.cooldown.remainingSeconds)}` : 'Ready'}
                </span>
              </div>
            </div>
          </ChartCard>
        </div>

        {/* Row 2 — Current Session */}
        <div
          style={{
            background: BG_CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 14,
            padding: '18px 20px',
            marginBottom: 16,
            opacity: isEntering ? 0 : 1,
            transform: isEntering ? 'translateY(12px)' : 'translateY(0)',
            transition: 'opacity 0.4s ease-out 440ms, transform 0.4s cubic-bezier(0.4, 0, 0.2, 1) 440ms',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <span style={{ color: ACCENT, fontSize: 15 }}>🖥️</span>
            <span style={{ color: TEXT_PRIMARY, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase' }}>
              Current Session (in-memory)
            </span>
          </div>
          {currentSession ? (
            <table style={{ borderCollapse: 'collapse', width: '100%', background: BG_INSET, borderRadius: 10, overflow: 'hidden' }}>
              <tbody>
                <tr>
                  <td style={tableLabelStyle}>Project</td>
                  <td style={tableValueStyle}>{currentSession.projectPath}</td>
                </tr>
                <tr>
                  <td style={tableLabelStyle}>Started</td>
                  <td style={tableValueStyle}>{formatTime(currentSession.sessionStart)}</td>
                </tr>
                <tr>
                  <td style={tableLabelStyle}>Idle time</td>
                  <td style={tableValueStyle}>{formatMs(currentSession.idleTimeMs)}</td>
                </tr>
                <tr>
                  <td style={{ ...tableLabelStyle, borderBottom: 'none' }}>AI calls</td>
                  <td style={{ ...tableValueStyle, borderBottom: 'none' }}>{currentSession.aiCallCount}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p style={{ color: TEXT_DIM, margin: 0, fontSize: 12 }}>No active session.</p>
          )}
        </div>

        {/* Row 3 — Analytics Engine */}
        <div
          style={{
            background: BG_CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 14,
            padding: '18px 20px',
            marginBottom: 16,
            opacity: isEntering ? 0 : 1,
            transform: isEntering ? 'translateY(12px)' : 'translateY(0)',
            transition: 'opacity 0.4s ease-out 520ms, transform 0.4s cubic-bezier(0.4, 0, 0.2, 1) 520ms',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: ACCENT, fontSize: 15 }}>⚙️</span>
              <span style={{ color: TEXT_PRIMARY, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                Analytics Engine
              </span>
              <span style={{ color: TEXT_DIM, fontSize: 11, fontFamily: UI_FONT }}>
                Performance, accuracy, and system metrics for the AI engine.
              </span>
            </div>
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '5px 14px', borderRadius: 999,
                background: adaptive ? 'rgba(168,85,247,0.1)' : 'rgba(129,116,143,0.12)',
                border: `1px solid ${adaptive ? ACCENT : 'rgba(129,116,143,0.3)'}`,
                color: adaptive ? ACCENT : TEXT_MUTED,
                fontSize: 11, fontWeight: 600,
                transition: 'background 0.3s ease, border-color 0.3s ease, color 0.3s ease',
              }}
            >
              <Dot color={adaptive ? ACCENT : TEXT_MUTED} /> {adaptive ? 'Active' : 'Idle'}
            </span>
          </div>

          {adaptive ? (
            <>
              <table style={{ borderCollapse: 'collapse', width: '100%', background: BG_INSET, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
                <tbody>
                  <tr>
                    <td style={tableLabelStyle}>System status</td>
                    <td style={tableValueStyle}>
                      <span style={{ color: COLOR_GREEN, display: 'inline-flex', alignItems: 'center' }}>
                        <Dot color={COLOR_GREEN} /> Online
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td style={tableLabelStyle}>Priority winner</td>
                    <td style={tableValueStyle}>{adaptive.priorityWinner ?? 'none'}</td>
                  </tr>
                  <tr>
                    <td style={tableLabelStyle}>Cooldown</td>
                    <td style={tableValueStyle}>
                      {adaptive.cooldown.active ? `active, ${formatSeconds(adaptive.cooldown.remainingSeconds)} remaining` : 'not active'}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ ...tableLabelStyle, borderBottom: 'none' }}>Last suggestion time</td>
                    <td style={{ ...tableValueStyle, borderBottom: 'none' }}>
                      {adaptive.lastSuggestionFired
                        ? `${formatTime(new Date(adaptive.lastSuggestionFired.firedAt).toISOString())} (S${adaptive.lastSuggestionFired.scenario})`
                        : 'None this session'}
                    </td>
                  </tr>
                </tbody>
              </table>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', background: BG_INSET, borderRadius: 10, overflow: 'hidden' }}>
                  <thead>
                    <tr>
                      <th style={{ ...tableLabelStyle, color: TEXT_DIM, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>Scenario</th>
                      <th style={{ ...tableLabelStyle, color: TEXT_DIM, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, width: 100 }}>Would fire</th>
                      <th style={{ ...tableLabelStyle, color: TEXT_DIM, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={tableValueStyle}>1 — idle→call</td>
                      <td style={tableValueStyle}>
                        <span style={{ color: adaptive.scenario1.conditionTrue ? COLOR_GREEN : TEXT_DIM, fontWeight: 700 }}>
                          {adaptive.scenario1.conditionTrue ? 'YES' : 'no'}
                        </span>
                      </td>
                      <td style={{ ...tableValueStyle, fontFamily: UI_FONT, fontSize: 11 }}>
                        last idle-expiry: {adaptive.scenario1.lastIdleExpiredAt ? formatTime(new Date(adaptive.scenario1.lastIdleExpiredAt).toISOString()) : 'none'}
                        {' · '}window open: {adaptive.scenario1.windowOpen ? 'yes' : 'no'}
                        {' · '}remaining: {formatSeconds(adaptive.scenario1.windowRemainingSeconds)}
                      </td>
                    </tr>
                    <tr>
                      <td style={tableValueStyle}>2 — rapid calls</td>
                      <td style={tableValueStyle}>
                        <span style={{ color: adaptive.scenario2.conditionTrue ? COLOR_GREEN : TEXT_DIM, fontWeight: 700 }}>
                          {adaptive.scenario2.conditionTrue ? 'YES' : 'no'}
                        </span>
                      </td>
                      <td style={{ ...tableValueStyle, fontFamily: UI_FONT, fontSize: 11 }}>
                        {adaptive.scenario2.callCountInWindow}/{adaptive.scenario2.threshold} calls · runs: {adaptive.scenario2.runCountInWindow} · resets: {formatSeconds(adaptive.scenario2.windowRemainingSeconds)}
                      </td>
                    </tr>
                    <tr>
                      <td style={tableValueStyle}>3 — silent struggle</td>
                      <td style={tableValueStyle}>
                        <span style={{ color: adaptive.scenario3.conditionTrue ? COLOR_GREEN : TEXT_DIM, fontWeight: 700 }}>
                          {adaptive.scenario3.conditionTrue ? 'YES' : 'no'}
                        </span>
                      </td>
                      <td style={{ ...tableValueStyle, fontFamily: UI_FONT, fontSize: 11 }}>
                        consecutiveIdleResets: {adaptive.scenario3.consecutiveIdleResets}/{adaptive.scenario3.threshold}
                      </td>
                    </tr>
                    <tr>
                      <td style={tableValueStyle}>4 — session ratio</td>
                      <td style={tableValueStyle}>
                        <span style={{ color: adaptive.scenario4.conditionTrue ? COLOR_GREEN : TEXT_DIM, fontWeight: 700 }}>
                          {adaptive.scenario4.conditionTrue ? 'YES' : 'no'}
                        </span>
                      </td>
                      <td style={{ ...tableValueStyle, fontFamily: UI_FONT, fontSize: 11 }}>
                        {adaptive.scenario4.sessionCallCount}:{adaptive.scenario4.sessionRunCount} · ratio: {adaptive.scenario4.ratio !== null ? adaptive.scenario4.ratio.toFixed(2) : '—'}/{adaptive.scenario4.threshold}
                        {' · '}min runs: {adaptive.scenario4.minimumRunsMet ? 'yes' : `no (need ${adaptive.scenario4.minimumRunsBeforeEvaluating})`}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ ...tableValueStyle, borderBottom: 'none' }}>5 — repeat error</td>
                      <td style={{ ...tableValueStyle, borderBottom: 'none' }}>
                        <span style={{ color: adaptive.scenario5.conditionTrue ? COLOR_GREEN : TEXT_DIM, fontWeight: 700 }}>
                          {adaptive.scenario5.conditionTrue ? 'YES' : 'no'}
                        </span>
                      </td>
                      <td style={{ ...tableValueStyle, fontFamily: UI_FONT, fontSize: 11, borderBottom: 'none' }}>
                        last category: {adaptive.scenario5.lastErrorCategory ?? 'none'}
                        {' · '}threshold: {adaptive.scenario5.repeatThreshold}
                        {' · '}cooldown: {adaptive.scenario5.cooldownActive ? `suppressed, ${formatSeconds(adaptive.scenario5.cooldownRemainingSeconds)} left` : 'ready'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p style={{ color: TEXT_DIM, margin: 0, fontSize: 12 }}>Loading...</p>
          )}
        </div>

        {/* Row 4 — Aggregate + Session History */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 16,
          }}
        >
          <div
            style={{
              background: BG_CARD,
              border: `1px solid ${BORDER}`,
              borderRadius: 14,
              padding: '18px 20px',
              opacity: isEntering ? 0 : 1,
              transform: isEntering ? 'translateY(12px)' : 'translateY(0)',
              transition: 'opacity 0.4s ease-out 600ms, transform 0.4s cubic-bezier(0.4, 0, 0.2, 1) 600ms',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ color: ACCENT, fontSize: 15 }}>🗄️</span>
              <span style={{ color: TEXT_PRIMARY, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                Aggregate (aggregate.json)
              </span>
            </div>
            {aggregate ? (
              <table style={{ borderCollapse: 'collapse', width: '100%', background: BG_INSET, borderRadius: 10, overflow: 'hidden' }}>
                <tbody>
                  <tr>
                    <td style={tableLabelStyle}>Total idle time</td>
                    <td style={tableValueStyle}>{formatMs(aggregate.totalIdleTimeMs)}</td>
                  </tr>
                  <tr>
                    <td style={tableLabelStyle}>Total AI calls</td>
                    <td style={tableValueStyle}>{aggregate.totalAiCallCount}</td>
                  </tr>
                  <tr>
                    <td style={tableLabelStyle}>Total sessions</td>
                    <td style={tableValueStyle}>{aggregate.totalSessionCount}</td>
                  </tr>
                  <tr>
                    <td style={{ ...tableLabelStyle, borderBottom: 'none' }}>Last updated</td>
                    <td style={{ ...tableValueStyle, borderBottom: 'none' }}>{formatTime(aggregate.lastUpdated)}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <p style={{ color: TEXT_DIM, margin: 0, fontSize: 12 }}>Loading...</p>
            )}
          </div>

          <div
            style={{
              background: BG_CARD,
              border: `1px solid ${BORDER}`,
              borderRadius: 14,
              padding: '18px 20px',
              opacity: isEntering ? 0 : 1,
              transform: isEntering ? 'translateY(12px)' : 'translateY(0)',
              transition: 'opacity 0.4s ease-out 680ms, transform 0.4s cubic-bezier(0.4, 0, 0.2, 1) 680ms',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ color: ACCENT, fontSize: 15 }}>🕐</span>
              <span style={{ color: TEXT_PRIMARY, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                Session History {projectPath ? `— ${projectPath}` : ''}
              </span>
            </div>
            {history.length === 0 ? (
              <p style={{ color: TEXT_DIM, margin: 0, fontSize: 12 }}>No session files found.</p>
            ) : (
              <div style={{ overflowX: 'auto', maxHeight: 260 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', background: BG_INSET, borderRadius: 10, overflow: 'hidden' }}>
                  <thead>
                    <tr>
                      <th style={{ ...tableLabelStyle, color: TEXT_DIM, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>File</th>
                      <th style={{ ...tableLabelStyle, color: TEXT_DIM, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>Start</th>
                      <th style={{ ...tableLabelStyle, color: TEXT_DIM, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>Idle</th>
                      <th style={{ ...tableLabelStyle, color: TEXT_DIM, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>AI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((entry, idx) => (
                      <tr
                        key={entry.fileName}
                        style={{
                          opacity: isEntering ? 0 : 1,
                          transform: isEntering ? 'translateX(-6px)' : 'translateX(0)',
                          transition: `opacity 0.35s ease-out ${720 + idx * 40}ms, transform 0.35s cubic-bezier(0.4, 0, 0.2, 1) ${720 + idx * 40}ms`,
                        }}
                      >
                        <td style={{ ...tableValueStyle, color: TEXT_MUTED, fontFamily: UI_FONT, fontSize: 11 }}>{entry.fileName}</td>
                        <td style={{ ...tableValueStyle, fontSize: 11 }}>{formatTime(entry.sessionStart)}</td>
                        <td style={{ ...tableValueStyle, fontSize: 11 }}>{formatMs(entry.idleTimeMs)}</td>
                        <td style={{ ...tableValueStyle, fontSize: 11 }}>{entry.aiCallCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Global keyframes ── */}
      <style>{`
        @keyframes fabricaPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
        @keyframes fabricaShimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
    </div>
  );
}