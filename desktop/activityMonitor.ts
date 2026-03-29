import * as fs from 'node:fs';

import type { DesktopMonitorSession } from './bridge';
import { getRendererAgentId } from './rendererHost';
import type { HostEvent } from '../shared/host/types';

const MAX_READ_BYTES = 64 * 1024;

interface SessionWatchState {
  session: DesktopMonitorSession;
  fileOffset: number;
  lineBuffer: string;
  codexState: CodexActivityState;
}

interface CodexActivityState {
  activeToolCalls: Map<string, string>;
  waiting: boolean;
}

interface CodexRecord {
  type?: string;
  payload?: Record<string, unknown>;
}

export class DesktopActivityMonitor {
  private readonly watchedSessions = new Map<string, SessionWatchState>();

  constructor(private readonly emitHostEvent: (event: HostEvent) => void) {}

  syncSessions(sessions: DesktopMonitorSession[]): void {
    const nextKeys = new Set(sessions.map((session) => session.transcriptPath));

    for (const session of sessions) {
      const existing = this.watchedSessions.get(session.transcriptPath);
      if (existing) {
        existing.session = session;
        continue;
      }

      this.watchedSessions.set(session.transcriptPath, {
        session,
        fileOffset: getInitialFileOffset(session.transcriptPath),
        lineBuffer: '',
        codexState: {
          activeToolCalls: new Map(),
          waiting: false,
        },
      });
    }

    for (const transcriptPath of [...this.watchedSessions.keys()]) {
      if (!nextKeys.has(transcriptPath)) {
        this.watchedSessions.delete(transcriptPath);
      }
    }
  }

  poll(): void {
    for (const watchedSession of this.watchedSessions.values()) {
      readNewLines(watchedSession, this.emitHostEvent);
    }
  }
}

export function processCodexTranscriptLine(
  session: DesktopMonitorSession,
  line: string,
  state: CodexActivityState,
): HostEvent[] {
  let record: CodexRecord;
  try {
    record = JSON.parse(line) as CodexRecord;
  } catch {
    return [];
  }

  const payload = record.payload;
  if (!payload || typeof payload.type !== 'string') {
    return [];
  }

  const agentId = getRendererAgentId(session);
  const events: HostEvent[] = [];

  switch (`${record.type}:${payload.type}`) {
    case 'event_msg:user_message':
    case 'event_msg:task_started':
    case 'event_msg:agent_message':
      if (state.waiting) {
        events.push({ type: 'agentStatus', id: agentId, status: 'active' });
        state.waiting = false;
      }
      return events;
    case 'response_item:function_call':
    case 'response_item:custom_tool_call': {
      const toolId = typeof payload.call_id === 'string' ? payload.call_id : undefined;
      if (!toolId || state.activeToolCalls.has(toolId)) {
        return events;
      }

      const status = formatCodexToolStatus(payload);
      state.activeToolCalls.set(toolId, status);
      events.push({ type: 'agentToolStart', id: agentId, toolId, status });
      if (state.waiting) {
        events.push({ type: 'agentStatus', id: agentId, status: 'active' });
        state.waiting = false;
      }
      return events;
    }
    case 'response_item:function_call_output':
    case 'response_item:custom_tool_call_output': {
      const toolId = typeof payload.call_id === 'string' ? payload.call_id : undefined;
      if (!toolId || !state.activeToolCalls.has(toolId)) {
        return events;
      }

      state.activeToolCalls.delete(toolId);
      events.push({ type: 'agentToolDone', id: agentId, toolId });
      return events;
    }
    case 'event_msg:task_complete':
      if (state.activeToolCalls.size > 0) {
        state.activeToolCalls.clear();
        events.push({ type: 'agentToolsClear', id: agentId });
      }
      if (!state.waiting) {
        events.push({ type: 'agentStatus', id: agentId, status: 'waiting' });
        state.waiting = true;
      }
      return events;
    default:
      return events;
  }
}

function readNewLines(
  watchedSession: SessionWatchState,
  emitHostEvent: (event: HostEvent) => void,
): void {
  try {
    const stat = fs.statSync(watchedSession.session.transcriptPath);
    if (stat.size <= watchedSession.fileOffset) {
      return;
    }

    const bytesToRead = Math.min(stat.size - watchedSession.fileOffset, MAX_READ_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    const fd = fs.openSync(watchedSession.session.transcriptPath, 'r');
    fs.readSync(fd, buffer, 0, buffer.length, watchedSession.fileOffset);
    fs.closeSync(fd);
    watchedSession.fileOffset += bytesToRead;

    const text = watchedSession.lineBuffer + buffer.toString('utf8');
    const lines = text.split('\n');
    watchedSession.lineBuffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      if (watchedSession.session.agentKind !== 'codex') {
        continue;
      }

      const events = processCodexTranscriptLine(
        watchedSession.session,
        line,
        watchedSession.codexState,
      );
      for (const event of events) {
        emitHostEvent(event);
      }
    }
  } catch {
    return;
  }
}

function formatCodexToolStatus(payload: Record<string, unknown>): string {
  if (payload.type === 'function_call') {
    const name = typeof payload.name === 'string' ? payload.name : 'tool';
    const argumentsText =
      typeof payload.arguments === 'string' ? safeParseArguments(payload.arguments) : undefined;

    if (name === 'shell_command' && argumentsText?.command) {
      return `Running: ${truncate(argumentsText.command)}`;
    }

    if (name === 'apply_patch') {
      return 'Editing files';
    }

    if (name === 'multi_tool_use.parallel') {
      return 'Running multiple tools';
    }

    return `Using ${humanizeToolName(name)}`;
  }

  if (payload.type === 'custom_tool_call') {
    const name = typeof payload.name === 'string' ? payload.name : 'tool';
    if (name === 'apply_patch') {
      return 'Editing files';
    }
    return `Using ${humanizeToolName(name)}`;
  }

  return 'Working';
}

function safeParseArguments(argumentsText: string): Record<string, string> | null {
  try {
    return JSON.parse(argumentsText) as Record<string, string>;
  } catch {
    return null;
  }
}

function truncate(value: string, maxLength: number = 48): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function humanizeToolName(name: string): string {
  const mcpMatch = /^mcp__([^_]+)__(.+)$/u.exec(name);
  if (mcpMatch) {
    return `${mcpMatch[1]} ${mcpMatch[2].replaceAll('_', ' ')}`;
  }

  return name.replaceAll('_', ' ');
}

function getInitialFileOffset(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}
