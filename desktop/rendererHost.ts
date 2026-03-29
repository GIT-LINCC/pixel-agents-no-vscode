import * as fs from 'node:fs';
import * as path from 'node:path';

import type { DesktopMonitorSession } from './bridge';
import type { AgentDiagnostics, HostEvent } from '../shared/host/types';

export function getRendererAgentId(session: DesktopMonitorSession): number {
  const value = `${session.agentKind}:${session.id}:${session.transcriptPath}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) & 0x7fffffff;
}

export function buildRendererBootstrapEvents(sessions: DesktopMonitorSession[]): HostEvent[] {
  return [
    {
      type: 'settingsLoaded',
      soundEnabled: false,
      lastSeenVersion: '',
      extensionVersion: 'desktop-monitor',
      externalAssetDirectories: [],
    },
    { type: 'layoutLoaded', layout: null, wasReset: false },
    createExistingAgentsEvent(sessions),
    createDiagnosticsEvent(sessions),
  ];
}

export function buildRendererSessionUpdateEvents(
  previousSessions: DesktopMonitorSession[],
  nextSessions: DesktopMonitorSession[],
): HostEvent[] {
  const previousIds = new Set(previousSessions.map(getRendererAgentId));
  const nextIds = new Set(nextSessions.map(getRendererAgentId));
  const events: HostEvent[] = [];

  for (const session of previousSessions) {
    const agentId = getRendererAgentId(session);
    if (!nextIds.has(agentId)) {
      events.push({ type: 'agentClosed', id: agentId });
    }
  }

  for (const session of nextSessions) {
    const agentId = getRendererAgentId(session);
    if (!previousIds.has(agentId)) {
      events.push({
        type: 'agentCreated',
        id: agentId,
        folderName: getWorkspaceFolderName(session),
      });
    }
  }

  events.push(createDiagnosticsEvent(nextSessions));
  return events;
}

export function createExistingAgentsEvent(sessions: DesktopMonitorSession[]): HostEvent {
  const orderedSessions = [...sessions].sort(
    (left, right) => getRendererAgentId(left) - getRendererAgentId(right),
  );
  const folderNames: Record<number, string> = {};

  for (const session of orderedSessions) {
    const folderName = getWorkspaceFolderName(session);
    if (folderName) {
      folderNames[getRendererAgentId(session)] = folderName;
    }
  }

  return {
    type: 'existingAgents',
    agents: orderedSessions.map(getRendererAgentId),
    folderNames: Object.keys(folderNames).length > 0 ? folderNames : undefined,
  };
}

export function createDiagnosticsEvent(sessions: DesktopMonitorSession[]): HostEvent {
  return {
    type: 'agentDiagnostics',
    agents: buildRendererDiagnostics(sessions),
  };
}

export function buildRendererDiagnostics(sessions: DesktopMonitorSession[]): AgentDiagnostics[] {
  return [...sessions]
    .sort((left, right) => getRendererAgentId(left) - getRendererAgentId(right))
    .map((session) => {
      const stat = safeStat(session.transcriptPath);
      const lastDataAt = session.lastSeenAt ? Date.parse(session.lastSeenAt) : 0;
      const projectDir = session.workspacePath ?? path.dirname(session.transcriptPath);
      return {
        id: getRendererAgentId(session),
        projectDir,
        projectDirExists: fs.existsSync(projectDir),
        jsonlFile: session.transcriptPath,
        jsonlExists: stat !== null,
        fileSize: stat?.size ?? 0,
        fileOffset: 0,
        lastDataAt: Number.isFinite(lastDataAt) ? lastDataAt : 0,
        linesProcessed: 0,
      };
    });
}

function getWorkspaceFolderName(session: DesktopMonitorSession): string | undefined {
  if (!session.workspacePath) {
    return undefined;
  }

  const baseName = path.basename(session.workspacePath);
  return baseName || undefined;
}

function safeStat(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}
