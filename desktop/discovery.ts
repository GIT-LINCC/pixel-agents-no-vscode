import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { DesktopAgentKind, DesktopMonitorSession, DesktopSessionStatus } from './bridge';

const DEFAULT_MAX_SESSIONS_PER_AGENT = 12;
const WATCHING_WINDOW_MS = 10 * 60 * 1000;
const STALE_WINDOW_MS = 24 * 60 * 60 * 1000;

interface SessionCandidate {
  transcriptPath: string;
  mtimeMs: number;
  size: number;
  projectKey?: string;
}

interface SessionMetaRecord {
  type?: string;
  payload?: Record<string, unknown>;
  cwd?: unknown;
  workspace?: unknown;
}

interface CodexSessionIndexEntry {
  threadName?: string;
  updatedAt?: string;
}

export interface DesktopDiscoveryOptions {
  homeDir?: string;
  maxSessionsPerAgent?: number;
  now?: number;
}

export interface DesktopDiscoverySnapshot {
  sessions: DesktopMonitorSession[];
  watchRoots: Partial<Record<DesktopAgentKind, string[]>>;
}

export function discoverDesktopMonitorState(
  options: DesktopDiscoveryOptions = {},
): DesktopDiscoverySnapshot {
  const homeDir = options.homeDir ?? os.homedir();
  const maxSessionsPerAgent = options.maxSessionsPerAgent ?? DEFAULT_MAX_SESSIONS_PER_AGENT;
  const now = options.now ?? Date.now();

  const watchRoots = getDesktopWatchRoots(homeDir);
  const sessions = [
    ...discoverClaudeSessions(watchRoots.claude ?? [], maxSessionsPerAgent, now),
    ...discoverCodexSessions(watchRoots.codex ?? [], maxSessionsPerAgent, now),
  ].sort(compareSessionsByRecency);

  return { sessions, watchRoots };
}

export function getDesktopWatchRoots(
  homeDir: string = os.homedir(),
): Partial<Record<DesktopAgentKind, string[]>> {
  const claudeRoot = path.join(homeDir, '.claude', 'projects');
  const codexRoot = path.join(homeDir, '.codex', 'sessions');

  return {
    claude: fs.existsSync(claudeRoot) ? [claudeRoot] : [],
    codex: fs.existsSync(codexRoot) ? [codexRoot] : [],
  };
}

function discoverClaudeSessions(
  roots: string[],
  maxSessionsPerAgent: number,
  now: number,
): DesktopMonitorSession[] {
  const sessions: DesktopMonitorSession[] = [];
  for (const root of roots) {
    for (const candidate of collectRecentJsonlFiles(root, maxSessionsPerAgent)) {
      const meta = readSessionMeta(candidate.transcriptPath);
      const sessionId = path.basename(candidate.transcriptPath, '.jsonl');
      const workspacePath = pickWorkspacePath(meta);
      const projectKey =
        candidate.projectKey ?? path.basename(path.dirname(candidate.transcriptPath));
      const labelBase = workspacePath ? path.basename(workspacePath) : projectKey;

      sessions.push({
        id: sessionId,
        agentKind: 'claude',
        label: `Claude ${labelBase}`,
        transcriptPath: candidate.transcriptPath,
        workspacePath,
        lastSeenAt: new Date(candidate.mtimeMs).toISOString(),
        status: classifySessionStatus(candidate.mtimeMs, now),
        readOnly: true,
      });
    }
  }
  return sessions;
}

function discoverCodexSessions(
  roots: string[],
  maxSessionsPerAgent: number,
  now: number,
): DesktopMonitorSession[] {
  const sessions: DesktopMonitorSession[] = [];
  for (const root of roots) {
    const sessionIndex = readCodexSessionIndex(path.dirname(root));
    for (const candidate of collectRecentJsonlFiles(root, maxSessionsPerAgent)) {
      const meta = readSessionMeta(candidate.transcriptPath);
      const payload = meta?.type === 'session_meta' ? meta.payload : undefined;
      const sessionId =
        (typeof payload?.id === 'string' && payload.id) ||
        path.basename(candidate.transcriptPath, '.jsonl');
      const indexEntry = sessionIndex.get(sessionId);
      const workspacePath = pickWorkspacePath(payload ?? meta);
      const label =
        indexEntry?.threadName ||
        (workspacePath
          ? `Codex ${path.basename(workspacePath)}`
          : `Codex ${sessionId.slice(0, 8)}`);
      const lastSeenAt = indexEntry?.updatedAt ?? new Date(candidate.mtimeMs).toISOString();
      const lastSeenMs = Date.parse(lastSeenAt);

      sessions.push({
        id: sessionId,
        agentKind: 'codex',
        label,
        transcriptPath: candidate.transcriptPath,
        workspacePath,
        lastSeenAt,
        status: classifySessionStatus(
          Number.isFinite(lastSeenMs) ? lastSeenMs : candidate.mtimeMs,
          now,
        ),
        readOnly: true,
      });
    }
  }
  return sessions;
}

function collectRecentJsonlFiles(root: string, limit: number): SessionCandidate[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  const files: SessionCandidate[] = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        stack.push({ dir: fullPath, depth: current.depth + 1 });
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
        continue;
      }

      try {
        const stat = fs.statSync(fullPath);
        files.push({
          transcriptPath: fullPath,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          projectKey: current.dir === root ? undefined : path.basename(path.dirname(fullPath)),
        });
      } catch {
        continue;
      }
    }
  }

  return files.sort(compareCandidatesByRecency).slice(0, limit);
}

function compareCandidatesByRecency(left: SessionCandidate, right: SessionCandidate): number {
  if (right.mtimeMs !== left.mtimeMs) {
    return right.mtimeMs - left.mtimeMs;
  }

  return left.transcriptPath.localeCompare(right.transcriptPath);
}

function compareSessionsByRecency(
  left: DesktopMonitorSession,
  right: DesktopMonitorSession,
): number {
  const leftTime = left.lastSeenAt ? Date.parse(left.lastSeenAt) : 0;
  const rightTime = right.lastSeenAt ? Date.parse(right.lastSeenAt) : 0;
  if (rightTime !== leftTime) {
    return rightTime - leftTime;
  }

  if (left.agentKind !== right.agentKind) {
    return left.agentKind.localeCompare(right.agentKind);
  }

  return left.transcriptPath.localeCompare(right.transcriptPath);
}

function readSessionMeta(filePath: string): SessionMetaRecord | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'r');
    const chunks: Buffer[] = [];
    const chunkSize = 8192;
    const maxBytes = 256 * 1024;
    let offset = 0;

    while (offset < maxBytes) {
      const buffer = Buffer.alloc(Math.min(chunkSize, maxBytes - offset));
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, offset);
      if (bytesRead <= 0) {
        break;
      }

      const chunk = buffer.subarray(0, bytesRead);
      chunks.push(chunk);
      offset += bytesRead;

      if (chunk.includes(0x0a)) {
        break;
      }
    }

    if (chunks.length === 0) {
      return null;
    }

    const firstLine = Buffer.concat(chunks)
      .toString('utf8')
      .split(/\r?\n/u)
      .find((line) => line.trim().length > 0);

    if (!firstLine) {
      return null;
    }

    return JSON.parse(firstLine) as SessionMetaRecord;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }
}

function readCodexSessionIndex(codexRoot: string): Map<string, CodexSessionIndexEntry> {
  const indexPath = path.join(codexRoot, 'session_index.jsonl');
  if (!fs.existsSync(indexPath)) {
    return new Map();
  }

  try {
    const raw = fs.readFileSync(indexPath, 'utf8');
    const entries = new Map<string, CodexSessionIndexEntry>();

    for (const line of raw.split(/\r?\n/u)) {
      if (!line.trim()) {
        continue;
      }

      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const id = typeof parsed.id === 'string' ? parsed.id : undefined;
        if (!id) {
          continue;
        }

        entries.set(id, {
          threadName: typeof parsed.thread_name === 'string' ? parsed.thread_name : undefined,
          updatedAt: typeof parsed.updated_at === 'string' ? parsed.updated_at : undefined,
        });
      } catch {
        continue;
      }
    }

    return entries;
  } catch {
    return new Map();
  }
}

function pickWorkspacePath(
  record: Record<string, unknown> | SessionMetaRecord | null | undefined,
): string | undefined {
  if (!record) {
    return undefined;
  }

  const candidates = [record.cwd, record.workspace];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return undefined;
}

function classifySessionStatus(mtimeMs: number, now: number): DesktopSessionStatus {
  const ageMs = Math.max(0, now - mtimeMs);
  if (ageMs <= WATCHING_WINDOW_MS) {
    return 'watching';
  }
  if (ageMs >= STALE_WINDOW_MS) {
    return 'stale';
  }
  return 'discovered';
}
