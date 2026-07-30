import { useEffect, useState } from 'react';

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
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setError(null);
    try {
      const [current, agg, hist] = await Promise.all([
        window.stats.getCurrentSession(),
        window.stats.getAggregate(),
        projectPath ? window.stats.getSessionHistory(projectPath) : Promise.resolve([]),
      ]);
      setCurrentSession(current);
      setAggregate(agg);
      setHistory(hist);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleOpen = () => {
    setOpen(true);
    loadData();
  };

  // Live-refresh the current session + aggregate while the panel is open,
  // so idle time / AI call count visibly tick up without manual Refresh.
  useEffect(() => {
    if (!open) return undefined;
    const intervalId = setInterval(() => {
      Promise.all([window.stats.getCurrentSession(), window.stats.getAggregate()])
        .then(([current, agg]) => {
          setCurrentSession(current);
          setAggregate(agg);
        })
        .catch((err) => setError(String(err)));
    }, 1000);
    return () => clearInterval(intervalId);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        style={{
          position: 'fixed',
          bottom: 8,
          right: 8,
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
        Stats Debug
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
