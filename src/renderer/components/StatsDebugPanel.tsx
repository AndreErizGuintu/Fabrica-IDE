import { useEffect, useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
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
const MAX_SAMPLES = 60; // ~60s rolling window at the existing 1s poll

const CHART_GRID = '#333';
const CHART_AXIS = '#888';
const COLOR_CALLS = '#a855f7'; // brand purple
const COLOR_RUNS = '#38bdf8';  // sky, distinct on the dark card
const SCENARIO_COLORS = ['#a855f7', '#38bdf8', '#fbbf24', '#f472b6']; // scenarios 1..4
const chartTooltip: React.CSSProperties = { background: '#1a1a1a', border: '1px solid #333', color: '#eee', fontSize: 12 };

function formatSeconds(s: number | null): string {
  if (s === null) return '—';
  return `${s.toFixed(1)}s`;
}

function Indicator({ on }: { on: boolean }) {
  return (
    <span style={{ color: on ? '#86efac' : '#666', fontWeight: 700 }}>
      {on ? 'YES' : 'no'}
    </span>
  );
}

function StatusBadge({ label, active, text, activeColor = '#86efac' }:
  { label: string; active: boolean; text: string; activeColor?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ color: '#888', minWidth: 90 }}>{label}</span>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px',
        borderRadius: 999, fontSize: 12, fontWeight: 700,
        background: active ? 'rgba(255,255,255,0.06)' : '#222',
        color: active ? activeColor : '#666',
        border: `1px solid ${active ? activeColor : '#333'}`,
      }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: active ? activeColor : '#666' }} />
        {text}
      </span>
    </div>
  );
}

function formatMs(ms: number): string {
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }
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

const sectionStyle: React.CSSProperties = {
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: 6,
  padding: 12,
  marginBottom: 16,
};

const headingStyle: React.CSSProperties = {
  margin: '0 0 8px 0',
  fontSize: 13,
  color: '#a78bfa',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const thStyle: React.CSSProperties = {
  border: '1px solid #333',
  padding: '6px 8px',
  background: '#222',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  border: '1px solid #333',
  padding: '6px 8px',
  whiteSpace: 'nowrap',
};

export default function StatsDebugPanel({ projectPath }: { projectPath?: string }) {
  const [open, setOpen] = useState(false);
  const [currentSession, setCurrentSession] = useState<CurrentSession>(null);
  const [aggregate, setAggregate] = useState<Aggregate | null>(null);
  const [history, setHistory] = useState<SessionHistoryEntry[]>([]);
  const [adaptive, setAdaptive] = useState<Awaited<ReturnType<typeof window.adaptive.getDebugState>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<StatsSample[]>([]);

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

  const handleOpen = () => {
    setOpen(true);
    setSamples([]);
    loadData();
  };

  // Live-refresh the current session + aggregate while the panel is open,
  // so idle time / AI call count visibly tick up without manual Refresh.
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
  const eventsData = [
    { name: 'AI calls', value: adaptive?.scenario4.sessionCallCount ?? 0 },
    { name: 'Runs', value: adaptive?.scenario4.sessionRunCount ?? 0 },
  ];
  const fireCounts = adaptive?.scenarioFireCounts ?? { 1: 0, 2: 0, 3: 0, 4: 0 };
  const scenarioData = ([1, 2, 3, 4] as const).map((n) => ({ name: `Scenario ${n}`, value: fireCounts[n] }));
  const scenarioTotal = scenarioData.reduce((sum, d) => sum + d.value, 0);

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        style={{
          position: 'fixed',
          bottom: 8,
          right: 8,
          top: 'auto',
          left: 'auto',
          zIndex: 9999,
          fontSize: 11,
          padding: '4px 8px',
          background: '#333',
          color: '#fff',
          border: '1px solid #666',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        ⓘ
      </button>

      {open && (
        <div
          style={{
            position: 'fixed',
            top: '5%',
            left: '5%',
            width: '90%',
            height: '90%',
            zIndex: 10000,
            background: '#111',
            color: '#eee',
            border: '2px solid #666',
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
            fontFamily: 'Consolas, monospace',
            fontSize: 13,
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          }}
        >
          {/* Sticky header, always visible — no scrolling needed to see it */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 16px',
              borderBottom: '1px solid #333',
              flexShrink: 0,
            }}
          >
            <strong style={{ fontSize: 14 }}>Stats Debug</strong>
            <div>
              <button
                type="button"
                onClick={loadData}
                style={{
                  marginRight: 8,
                  padding: '4px 10px',
                  background: '#2d2d3a',
                  color: '#eee',
                  border: '1px solid #555',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  padding: '4px 10px',
                  background: '#4c1d1d',
                  color: '#eee',
                  border: '1px solid #663',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>

          {/* Scrollable body */}
          <div style={{ overflow: 'auto', padding: 16 }}>
            {error && (
              <pre style={{ color: '#f87171', whiteSpace: 'pre-wrap' }}>{error}</pre>
            )}

            {/* ── Charts ─────────────────────────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 16 }}>
              {/* Activity Over Time — line, from rolling buffer */}
              <div style={sectionStyle}>
                <h3 style={headingStyle}>Activity Over Time</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={activityData} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
                    <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" />
                    <XAxis dataKey="elapsed" unit="s" stroke={CHART_AXIS} tick={{ fontSize: 11 }} />
                    <YAxis stroke={CHART_AXIS} tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip contentStyle={chartTooltip} labelStyle={{ color: '#a78bfa' }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="sessionCalls" name="AI calls" stroke={COLOR_CALLS} strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="sessionRuns" name="Runs" stroke={COLOR_RUNS} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
                {samples.length === 0 && <p style={{ color: '#888', margin: '4px 0 0' }}>Collecting… (samples every 1s while open)</p>}
              </div>

              {/* Actions / Events — latest calls vs runs, two bars */}
              <div style={sectionStyle}>
                <h3 style={headingStyle}>Actions / Events (current)</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={eventsData} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
                    <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" />
                    <XAxis dataKey="name" stroke={CHART_AXIS} tick={{ fontSize: 11 }} />
                    <YAxis stroke={CHART_AXIS} tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip contentStyle={chartTooltip} cursor={{ fill: 'rgba(168,85,247,0.1)' }} />
                    <Bar dataKey="value" isAnimationActive={false}>
                      {eventsData.map((_, i) => <Cell key={i} fill={i === 0 ? COLOR_CALLS : COLOR_RUNS} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Activity Categories — scenario-fire distribution doughnut */}
              <div style={sectionStyle}>
                <h3 style={headingStyle}>Activity Categories (scenario fires)</h3>
                {scenarioTotal > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={scenarioData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2} isAnimationActive={false}>
                        {scenarioData.map((_, i) => <Cell key={i} fill={SCENARIO_COLORS[i]} stroke="#1a1a1a" />)}
                      </Pie>
                      <Tooltip contentStyle={chartTooltip} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p style={{ color: '#888', margin: 0 }}>No scenarios fired yet this session.</p>
                )}
              </div>

              {/* Session Status — badge, not a chart */}
              <div style={sectionStyle}>
                <h3 style={headingStyle}>Session Status</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  <StatusBadge
                    label="Suggestion"
                    active={!!adaptive?.suggestionActive}
                    text={adaptive?.suggestionActive ? `Active — Scenario ${adaptive.suggestionActive.scenario}` : 'Idle'}
                  />
                  <StatusBadge
                    label="Cooldown"
                    active={!!adaptive?.cooldown.active}
                    activeColor="#fbbf24"
                    text={adaptive?.cooldown.active ? `Cooling — ${formatSeconds(adaptive.cooldown.remainingSeconds)}` : 'Ready'}
                  />
                </div>
              </div>
            </div>

            <div style={sectionStyle}>
              <h3 style={headingStyle}>Current Session (in-memory)</h3>
              {currentSession ? (
                <table style={{ borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <td style={{ ...tdStyle, color: '#888' }}>Project</td>
                      <td style={tdStyle}>{currentSession.projectPath}</td>
                    </tr>
                    <tr>
                      <td style={{ ...tdStyle, color: '#888' }}>Started</td>
                      <td style={tdStyle}>{formatTime(currentSession.sessionStart)}</td>
                    </tr>
                    <tr>
                      <td style={{ ...tdStyle, color: '#888' }}>Idle time</td>
                      <td style={tdStyle}>{formatMs(currentSession.idleTimeMs)}</td>
                    </tr>
                    <tr>
                      <td style={{ ...tdStyle, color: '#888' }}>AI calls</td>
                      <td style={tdStyle}>{currentSession.aiCallCount}</td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <p style={{ color: '#888', margin: 0 }}>No active session.</p>
              )}
            </div>

            <div style={sectionStyle}>
              <h3 style={headingStyle}>Adaptive Engine (src/main/adaptiveEngine.ts)</h3>
              {adaptive ? (
                <>
                  <table style={{ borderCollapse: 'collapse', marginBottom: 10 }}>
                    <tbody>
                      <tr>
                        <td style={{ ...tdStyle, color: '#888' }}>Priority winner (raw, pre-suppression)</td>
                        <td style={tdStyle}>{adaptive.priorityWinner ?? 'none'}</td>
                      </tr>
                      <tr>
                        <td style={{ ...tdStyle, color: '#888' }}>Suggestion active</td>
                        <td style={tdStyle}>
                          {adaptive.suggestionActive
                            ? `Scenario ${adaptive.suggestionActive.scenario}`
                            : 'none'}
                        </td>
                      </tr>
                      <tr>
                        <td style={{ ...tdStyle, color: '#888' }}>Cooldown</td>
                        <td style={tdStyle}>
                          {adaptive.cooldown.active
                            ? `active, ${formatSeconds(adaptive.cooldown.remainingSeconds)} remaining`
                            : 'not active'}
                        </td>
                      </tr>
                      <tr>
                        <td style={{ ...tdStyle, color: '#888' }}>Last suggestion fired</td>
                        <td style={tdStyle}>
                          {adaptive.lastSuggestionFired
                            ? `Scenario ${adaptive.lastSuggestionFired.scenario} @ ${formatTime(new Date(adaptive.lastSuggestionFired.firedAt).toISOString())}`
                            : 'none this session'}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Scenario</th>
                          <th style={thStyle}>Would fire now</th>
                          <th style={thStyle}>Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td style={tdStyle}>1 — idle→call</td>
                          <td style={tdStyle}><Indicator on={adaptive.scenario1.conditionTrue} /></td>
                          <td style={tdStyle}>
                            last idle-expiry:{' '}
                            {adaptive.scenario1.lastIdleExpiredAt
                              ? formatTime(new Date(adaptive.scenario1.lastIdleExpiredAt).toISOString())
                              : 'none'}
                            {' | '}window open: {adaptive.scenario1.windowOpen ? 'yes' : 'no'}
                            {' | '}remaining: {formatSeconds(adaptive.scenario1.windowRemainingSeconds)}
                          </td>
                        </tr>
                        <tr>
                          <td style={tdStyle}>2 — rapid calls</td>
                          <td style={tdStyle}><Indicator on={adaptive.scenario2.conditionTrue} /></td>
                          <td style={tdStyle}>
                            {adaptive.scenario2.callCountInWindow}/{adaptive.scenario2.threshold} calls in window
                            {' | '}runs in window: {adaptive.scenario2.runCountInWindow}
                            {' | '}window resets in: {formatSeconds(adaptive.scenario2.windowRemainingSeconds)}
                          </td>
                        </tr>
                        <tr>
                          <td style={tdStyle}>3 — silent struggle</td>
                          <td style={tdStyle}><Indicator on={adaptive.scenario3.conditionTrue} /></td>
                          <td style={tdStyle}>
                            consecutiveIdleResets: {adaptive.scenario3.consecutiveIdleResets}/{adaptive.scenario3.threshold}
                          </td>
                        </tr>
                        <tr>
                          <td style={tdStyle}>4 — session ratio</td>
                          <td style={tdStyle}><Indicator on={adaptive.scenario4.conditionTrue} /></td>
                          <td style={tdStyle}>
                            calls:runs = {adaptive.scenario4.sessionCallCount}:{adaptive.scenario4.sessionRunCount}
                            {' | '}ratio: {adaptive.scenario4.ratio !== null ? adaptive.scenario4.ratio.toFixed(2) : '—'} / {adaptive.scenario4.threshold}
                            {' | '}min runs met: {adaptive.scenario4.minimumRunsMet ? 'yes' : `no (need ${adaptive.scenario4.minimumRunsBeforeEvaluating})`}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p style={{ color: '#888', margin: 0 }}>Loading...</p>
              )}
            </div>

            <div style={sectionStyle}>
              <h3 style={headingStyle}>Aggregate (aggregate.json)</h3>
              {aggregate ? (
                <table style={{ borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <td style={{ ...tdStyle, color: '#888' }}>Total idle time</td>
                      <td style={tdStyle}>{formatMs(aggregate.totalIdleTimeMs)}</td>
                    </tr>
                    <tr>
                      <td style={{ ...tdStyle, color: '#888' }}>Total AI calls</td>
                      <td style={tdStyle}>{aggregate.totalAiCallCount}</td>
                    </tr>
                    <tr>
                      <td style={{ ...tdStyle, color: '#888' }}>Total sessions</td>
                      <td style={tdStyle}>{aggregate.totalSessionCount}</td>
                    </tr>
                    <tr>
                      <td style={{ ...tdStyle, color: '#888' }}>Last updated</td>
                      <td style={tdStyle}>{formatTime(aggregate.lastUpdated)}</td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <p style={{ color: '#888', margin: 0 }}>Loading...</p>
              )}
            </div>

            <div style={sectionStyle}>
              <h3 style={headingStyle}>
                Session History {projectPath ? `— ${projectPath}` : '(no project open)'}
              </h3>
              {history.length === 0 ? (
                <p style={{ color: '#888', margin: 0 }}>No session files found.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>File</th>
                        <th style={thStyle}>Start</th>
                        <th style={thStyle}>End</th>
                        <th style={thStyle}>Idle</th>
                        <th style={thStyle}>AI Calls</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((entry) => (
                        <tr key={entry.fileName}>
                          <td style={{ ...tdStyle, color: '#888' }}>{entry.fileName}</td>
                          <td style={tdStyle}>{formatTime(entry.sessionStart)}</td>
                          <td style={tdStyle}>{formatTime(entry.sessionEnd)}</td>
                          <td style={tdStyle}>{formatMs(entry.idleTimeMs)}</td>
                          <td style={tdStyle}>{entry.aiCallCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
