/* eslint no-console: off */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';

const IDLE_THRESHOLD_MS = 15_000;
const TICK_MS = 1_000;

type SessionState = {
  projectPath: string;
  projectHash: string;
  sessionStart: string;
  lastActivityAt: number;
  lastTickAt: number;
  idleTimeMs: number;
  aiCallCount: number;
  runCount: number;
  intervalId: ReturnType<typeof setInterval>;
};

type SessionFile = {
  projectPath: string;
  sessionStart: string;
  sessionEnd: string;
  idleTimeMs: number;
  aiCallCount: number;
  runCount: number;
};

type AggregateFile = {
  totalIdleTimeMs: number;
  totalAiCallCount: number;
  totalRunCount: number;
  totalSessionCount: number;
  lastUpdated: string;
};

let current: SessionState | null = null;

const getStatsRoot = () => path.join(app.getPath('userData'), 'stats');
const getProjectsRoot = () => path.join(getStatsRoot(), 'projects');
const getAggregatePath = () => path.join(getStatsRoot(), 'aggregate.json');

function hashProjectPath(projectPath: string): string {
  return crypto.createHash('sha256').update(path.resolve(projectPath)).digest('hex').slice(0, 12);
}

function atomicWriteJson(filePath: string, data: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

function readAggregate(): AggregateFile {
  const aggregatePath = getAggregatePath();
  if (!fs.existsSync(aggregatePath)) {
    return {
      totalIdleTimeMs: 0,
      totalAiCallCount: 0,
      totalRunCount: 0,
      totalSessionCount: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  try {
    return JSON.parse(fs.readFileSync(aggregatePath, 'utf-8'));
  } catch (err) {
    console.warn(`Failed to parse ${aggregatePath}, reinitializing aggregate stats.`, err);
    return {
      totalIdleTimeMs: 0,
      totalAiCallCount: 0,
      totalRunCount: 0,
      totalSessionCount: 0,
      lastUpdated: new Date().toISOString(),
    };
  }
}

function updateAggregate(session: SessionFile) {
  const aggregate = readAggregate();
  aggregate.totalIdleTimeMs += session.idleTimeMs;
  aggregate.totalAiCallCount += session.aiCallCount;
  aggregate.totalRunCount += session.runCount ?? 0;
  aggregate.totalSessionCount += 1;
  aggregate.lastUpdated = new Date().toISOString();
  atomicWriteJson(getAggregatePath(), aggregate);
}

// Reset-based idle timer: each tick, if the gap since the last recorded
// activity has already crossed the threshold, the elapsed time since the
// last tick counts as idle. Any activity (editor change, AI call, run
// command) resets lastActivityAt, so the running total only grows while
// nothing has happened for 15s+ straight.
function tick() {
  if (!current) return;
  const now = Date.now();
  if (now - current.lastActivityAt > IDLE_THRESHOLD_MS) {
    current.idleTimeMs += now - current.lastTickAt;
  }
  current.lastTickAt = now;
}

export function startSession(projectPath: string) {
  if (current) {
    // eslint-disable-next-line no-use-before-define
    endSession();
  }

  const now = Date.now();
  current = {
    projectPath,
    projectHash: hashProjectPath(projectPath),
    sessionStart: new Date(now).toISOString(),
    lastActivityAt: now,
    lastTickAt: now,
    idleTimeMs: 0,
    aiCallCount: 0,
    runCount: 0,
    intervalId: setInterval(tick, TICK_MS),
  };
}

export function recordActivity() {
  if (!current) return;
  current.lastActivityAt = Date.now();
}

export function incrementAiCallCount() {
  if (!current) return;
  current.aiCallCount += 1;
  recordActivity();
}

export function incrementRunCount() {
  if (!current) return;
  current.runCount += 1;
  recordActivity();
}

export function getCurrentSession() {
  if (!current) return null;
  return {
    projectPath: current.projectPath,
    sessionStart: current.sessionStart,
    idleTimeMs: current.idleTimeMs,
    aiCallCount: current.aiCallCount,
    runCount: current.runCount,
  };
}

export function getAggregate(): AggregateFile {
  return readAggregate();
}

export function getSessionHistory(projectPath: string): Array<SessionFile & { fileName: string }> {
  const projectDir = path.join(getProjectsRoot(), hashProjectPath(projectPath));
  if (!fs.existsSync(projectDir)) return [];

  return fs
    .readdirSync(projectDir)
    .filter((fileName) => fileName.startsWith('session-') && fileName.endsWith('.json'))
    .map((fileName) => {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(projectDir, fileName), 'utf-8'));
        return { fileName, ...parsed };
      } catch (err) {
        console.warn(`Failed to parse session file ${fileName}.`, err);
        return null;
      }
    })
    .filter((entry): entry is SessionFile & { fileName: string } => entry !== null);
}

export function endSession() {
  if (!current) return;

  tick();
  clearInterval(current.intervalId);

  const sessionFile: SessionFile = {
    projectPath: current.projectPath,
    sessionStart: current.sessionStart,
    sessionEnd: new Date().toISOString(),
    idleTimeMs: current.idleTimeMs,
    aiCallCount: current.aiCallCount,
    runCount: current.runCount,
  };

  const fileTimestamp = current.sessionStart.replace(/[:.]/g, '-');
  const sessionFilePath = path.join(
    getProjectsRoot(),
    current.projectHash,
    `session-${fileTimestamp}.json`,
  );

  try {
    atomicWriteJson(sessionFilePath, sessionFile);
    updateAggregate(sessionFile);
  } catch (err) {
    console.warn('Failed to write stats session file.', err);
  }

  current = null;
}
