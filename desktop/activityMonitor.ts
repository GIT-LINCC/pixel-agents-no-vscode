import * as fs from 'node:fs';

import type { DesktopMonitorSession } from './bridge';
import { getRendererAgentId } from './rendererHost';
import type { HostEvent } from '../shared/host/types';

const MAX_READ_BYTES = 64 * 1024;
const CLAUDE_TEXT_IDLE_DELAY_MS = 5000;
const CLAUDE_PERMISSION_DELAY_MS = 7000;
const CLAUDE_PERMISSION_EXEMPT_TOOLS = new Set(['Task', 'Agent', 'AskUserQuestion']);

interface SessionWatchState {
  session: DesktopMonitorSession;
  fileOffset: number;
  lineBuffer: string;
  waitingTimer: ReturnType<typeof setTimeout> | null;
  permissionTimer: ReturnType<typeof setTimeout> | null;
  claudeTextIdleDelayMs: number;
  claudePermissionDelayMs: number;
  claudeState: ClaudeActivityState;
  codexState: CodexActivityState;
}

interface ClaudeActivityState {
  activeToolIds: Set<string>;
  activeToolNames: Map<string, string>;
  activeToolStatuses: Map<string, string>;
  activeSubagentToolIds: Map<string, Set<string>>;
  activeSubagentToolNames: Map<string, Map<string, string>>;
  backgroundAgentToolIds: Set<string>;
  permissionSent: boolean;
  waiting: boolean;
}

interface CodexActivityState {
  activeToolCalls: Map<string, string>;
  waiting: boolean;
}

interface CodexRecord {
  type?: string;
  payload?: Record<string, unknown>;
}

interface DesktopActivityMonitorOptions {
  claudeTextIdleDelayMs?: number;
  claudePermissionDelayMs?: number;
}

export class DesktopActivityMonitor {
  private readonly watchedSessions = new Map<string, SessionWatchState>();

  constructor(
    private readonly emitHostEvent: (event: HostEvent) => void,
    private readonly options: DesktopActivityMonitorOptions = {},
  ) {}

  stop(): void {
    for (const watchedSession of this.watchedSessions.values()) {
      clearClaudeWaitingTimer(watchedSession);
      clearClaudePermissionTimer(watchedSession);
    }
    this.watchedSessions.clear();
  }

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
        waitingTimer: null,
        permissionTimer: null,
        claudeTextIdleDelayMs: this.options.claudeTextIdleDelayMs ?? CLAUDE_TEXT_IDLE_DELAY_MS,
        claudePermissionDelayMs: this.options.claudePermissionDelayMs ?? CLAUDE_PERMISSION_DELAY_MS,
        claudeState: {
          activeToolIds: new Set(),
          activeToolNames: new Map(),
          activeToolStatuses: new Map(),
          activeSubagentToolIds: new Map(),
          activeSubagentToolNames: new Map(),
          backgroundAgentToolIds: new Set(),
          permissionSent: false,
          waiting: false,
        },
        codexState: {
          activeToolCalls: new Map(),
          waiting: false,
        },
      });
    }

    for (const transcriptPath of [...this.watchedSessions.keys()]) {
      if (!nextKeys.has(transcriptPath)) {
        const watchedSession = this.watchedSessions.get(transcriptPath);
        clearClaudeWaitingTimer(watchedSession);
        clearClaudePermissionTimer(watchedSession);
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

export function processClaudeTranscriptLine(
  session: DesktopMonitorSession,
  line: string,
  state: ClaudeActivityState,
): HostEvent[] {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return [];
  }

  const agentId = getRendererAgentId(session);
  const assistantContent =
    (record.message as Record<string, unknown> | undefined)?.content ?? record.content;

  if (record.type === 'assistant' && Array.isArray(assistantContent)) {
    const blocks = assistantContent as Array<{
      type: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
    const events: HostEvent[] = [];
    const hasToolUse = blocks.some((block) => block.type === 'tool_use');
    const hasText = blocks.some((block) => block.type === 'text');

    if (hasToolUse || hasText) {
      state.waiting = false;
      events.push({ type: 'agentStatus', id: agentId, status: 'active' });
    }

    for (const block of blocks) {
      if (block.type !== 'tool_use' || !block.id) {
        continue;
      }

      const toolName = block.name || '';
      const status = formatClaudeToolStatus(toolName, block.input || {});
      state.activeToolIds.add(block.id);
      state.activeToolNames.set(block.id, toolName);
      state.activeToolStatuses.set(block.id, status);
      events.push({
        type: 'agentToolStart',
        id: agentId,
        toolId: block.id,
        status,
      });
    }

    if (!hasToolUse && hasText) {
      return events;
    }

    return events;
  }

  if (
    record.type === 'assistant' &&
    typeof assistantContent === 'string' &&
    assistantContent.trim()
  ) {
    state.waiting = false;
    return [{ type: 'agentStatus', id: agentId, status: 'active' }];
  }

  if (record.type === 'progress') {
    return processClaudeProgressRecord(agentId, record, state);
  }

  if (record.type === 'user') {
    const content =
      (record.message as Record<string, unknown> | undefined)?.content ?? record.content;
    if (typeof content === 'string' && content.trim()) {
      return resetClaudeForNewTurn(agentId, state);
    }

    if (!Array.isArray(content)) {
      return [];
    }

    const blocks = content as Array<{
      type: string;
      tool_use_id?: string;
      content?: unknown;
    }>;
    const events: HostEvent[] = [];
    const hasToolResult = blocks.some((block) => block.type === 'tool_result');
    if (!hasToolResult) {
      return resetClaudeForNewTurn(agentId, state);
    }

    for (const block of blocks) {
      if (block.type !== 'tool_result' || !block.tool_use_id) {
        continue;
      }

      const toolId = block.tool_use_id;
      const toolName = state.activeToolNames.get(toolId);
      if (
        (toolName === 'Task' || toolName === 'Agent') &&
        isAsyncClaudeAgentResult(block.content)
      ) {
        state.backgroundAgentToolIds.add(toolId);
        continue;
      }

      if (toolName === 'Task' || toolName === 'Agent') {
        state.activeSubagentToolIds.delete(toolId);
        state.activeSubagentToolNames.delete(toolId);
        events.push({
          type: 'subagentClear',
          id: agentId,
          parentToolId: toolId,
        });
      }

      state.activeToolIds.delete(toolId);
      state.activeToolNames.delete(toolId);
      state.activeToolStatuses.delete(toolId);
      events.push({
        type: 'agentToolDone',
        id: agentId,
        toolId,
      });
    }

    return events;
  }

  if (record.type === 'queue-operation' && record.operation === 'enqueue') {
    const content = typeof record.content === 'string' ? record.content : '';
    const toolIdMatch = content.match(/<tool-use-id>(.*?)<\/tool-use-id>/u);
    if (!toolIdMatch) {
      return [];
    }

    const toolId = toolIdMatch[1];
    if (!state.backgroundAgentToolIds.has(toolId)) {
      return [];
    }

    state.backgroundAgentToolIds.delete(toolId);
    state.activeSubagentToolIds.delete(toolId);
    state.activeSubagentToolNames.delete(toolId);
    state.activeToolIds.delete(toolId);
    state.activeToolNames.delete(toolId);
    state.activeToolStatuses.delete(toolId);

    return [
      {
        type: 'subagentClear',
        id: agentId,
        parentToolId: toolId,
      },
      {
        type: 'agentToolDone',
        id: agentId,
        toolId,
      },
    ];
  }

  if (record.type === 'system' && record.subtype === 'turn_duration') {
    const events: HostEvent[] = [];
    const hasForegroundTools = state.activeToolIds.size > state.backgroundAgentToolIds.size;

    if (hasForegroundTools) {
      for (const toolId of [...state.activeToolIds]) {
        if (state.backgroundAgentToolIds.has(toolId)) {
          continue;
        }

        state.activeToolIds.delete(toolId);
        const toolName = state.activeToolNames.get(toolId);
        state.activeToolNames.delete(toolId);
        state.activeToolStatuses.delete(toolId);
        if (toolName === 'Task' || toolName === 'Agent') {
          state.activeSubagentToolIds.delete(toolId);
          state.activeSubagentToolNames.delete(toolId);
        }
      }

      events.push({ type: 'agentToolsClear', id: agentId });

      for (const toolId of state.backgroundAgentToolIds) {
        const status = state.activeToolStatuses.get(toolId);
        if (!status) {
          continue;
        }

        events.push({
          type: 'agentToolStart',
          id: agentId,
          toolId,
          status,
        });
      }
    } else if (state.activeToolIds.size > 0 && state.backgroundAgentToolIds.size === 0) {
      state.activeToolIds.clear();
      state.activeToolNames.clear();
      state.activeToolStatuses.clear();
      state.activeSubagentToolIds.clear();
      state.activeSubagentToolNames.clear();
      events.push({ type: 'agentToolsClear', id: agentId });
    }

    state.waiting = true;
    events.push({ type: 'agentStatus', id: agentId, status: 'waiting' });
    return events;
  }

  return [];
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

    if (watchedSession.session.agentKind === 'claude' && lines.some((line) => line.trim())) {
      clearClaudeWaitingTimer(watchedSession);
      clearClaudePermissionState(watchedSession, emitHostEvent);
    }

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      const events =
        watchedSession.session.agentKind === 'codex'
          ? processCodexTranscriptLine(watchedSession.session, line, watchedSession.codexState)
          : processClaudeTranscriptLine(watchedSession.session, line, watchedSession.claudeState);
      for (const event of events) {
        emitHostEvent(event);
      }

      if (watchedSession.session.agentKind === 'claude') {
        refreshClaudePermissionTimer(watchedSession, emitHostEvent);

        if (shouldScheduleClaudeWaiting(line)) {
          scheduleClaudeWaiting(watchedSession, emitHostEvent);
        }
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

function formatClaudeToolStatus(toolName: string, input: Record<string, unknown>): string {
  const baseName = (candidate: unknown) =>
    typeof candidate === 'string' ? candidate.split(/[\\/]/u).pop() || candidate : '';

  switch (toolName) {
    case 'Read':
      return `Reading ${baseName(input.file_path)}`;
    case 'Edit':
      return `Editing ${baseName(input.file_path)}`;
    case 'Write':
      return `Writing ${baseName(input.file_path)}`;
    case 'Bash': {
      const command = typeof input.command === 'string' ? input.command : '';
      return `Running: ${truncate(command)}`;
    }
    case 'Glob':
      return 'Searching files';
    case 'Grep':
      return 'Searching code';
    case 'WebFetch':
      return 'Fetching web content';
    case 'WebSearch':
      return 'Searching the web';
    case 'Task':
    case 'Agent': {
      const description = typeof input.description === 'string' ? input.description : '';
      return description ? `Subtask: ${truncate(description, 40)}` : 'Running subtask';
    }
    case 'AskUserQuestion':
      return 'Waiting for your answer';
    case 'EnterPlanMode':
      return 'Planning';
    case 'NotebookEdit':
      return 'Editing notebook';
    default:
      return `Using ${toolName}`;
  }
}

function processClaudeProgressRecord(
  agentId: number,
  record: Record<string, unknown>,
  state: ClaudeActivityState,
): HostEvent[] {
  const parentToolId =
    typeof record.parentToolUseID === 'string' ? record.parentToolUseID : undefined;
  if (!parentToolId) {
    return [];
  }

  const data =
    typeof record.data === 'object' && record.data !== null
      ? (record.data as Record<string, unknown>)
      : undefined;
  if (!data || data.type !== 'agent_progress') {
    return [];
  }

  const parentToolName = state.activeToolNames.get(parentToolId);
  if (parentToolName !== 'Task' && parentToolName !== 'Agent') {
    return [];
  }

  const msg =
    typeof data.message === 'object' && data.message !== null
      ? (data.message as Record<string, unknown>)
      : undefined;
  if (!msg) {
    return [];
  }

  const msgType = msg.type;
  const innerMessage =
    typeof msg.message === 'object' && msg.message !== null
      ? (msg.message as Record<string, unknown>)
      : undefined;
  const content = innerMessage?.content;
  if (!Array.isArray(content)) {
    return [];
  }

  if (msgType === 'assistant') {
    const events: HostEvent[] = [];
    for (const block of content as Array<{
      type: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>) {
      if (block.type !== 'tool_use' || !block.id) {
        continue;
      }

      let subToolIds = state.activeSubagentToolIds.get(parentToolId);
      if (!subToolIds) {
        subToolIds = new Set();
        state.activeSubagentToolIds.set(parentToolId, subToolIds);
      }
      subToolIds.add(block.id);

      let subToolNames = state.activeSubagentToolNames.get(parentToolId);
      if (!subToolNames) {
        subToolNames = new Map();
        state.activeSubagentToolNames.set(parentToolId, subToolNames);
      }
      subToolNames.set(block.id, block.name || '');

      events.push({
        type: 'subagentToolStart',
        id: agentId,
        parentToolId,
        toolId: block.id,
        status: formatClaudeToolStatus(block.name || '', block.input || {}),
      });
    }
    return events;
  }

  if (msgType === 'user') {
    const events: HostEvent[] = [];
    for (const block of content as Array<{ type: string; tool_use_id?: string }>) {
      if (block.type !== 'tool_result' || !block.tool_use_id) {
        continue;
      }

      const subToolIds = state.activeSubagentToolIds.get(parentToolId);
      if (subToolIds) {
        subToolIds.delete(block.tool_use_id);
      }

      const subToolNames = state.activeSubagentToolNames.get(parentToolId);
      if (subToolNames) {
        subToolNames.delete(block.tool_use_id);
      }

      events.push({
        type: 'subagentToolDone',
        id: agentId,
        parentToolId,
        toolId: block.tool_use_id,
      });
    }
    return events;
  }

  return [];
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

function isAsyncClaudeAgentResult(content: unknown): boolean {
  if (Array.isArray(content)) {
    for (const item of content) {
      if (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).text === 'string' &&
        ((item as Record<string, unknown>).text as string).startsWith(
          'Async agent launched successfully.',
        )
      ) {
        return true;
      }
    }
  } else if (typeof content === 'string') {
    return content.startsWith('Async agent launched successfully.');
  }

  return false;
}

function resetClaudeForNewTurn(agentId: number, state: ClaudeActivityState): HostEvent[] {
  const events: HostEvent[] = [];
  const hasToolState = state.activeToolIds.size > 0 || state.backgroundAgentToolIds.size > 0;

  if (state.backgroundAgentToolIds.size > 0) {
    for (const toolId of [...state.activeToolIds]) {
      if (state.backgroundAgentToolIds.has(toolId)) {
        continue;
      }

      const toolName = state.activeToolNames.get(toolId);
      state.activeToolIds.delete(toolId);
      state.activeToolNames.delete(toolId);
      state.activeToolStatuses.delete(toolId);
      if (toolName === 'Task' || toolName === 'Agent') {
        state.activeSubagentToolIds.delete(toolId);
        state.activeSubagentToolNames.delete(toolId);
      }
    }
  } else {
    state.activeToolIds.clear();
    state.activeToolNames.clear();
    state.activeToolStatuses.clear();
    state.activeSubagentToolIds.clear();
    state.activeSubagentToolNames.clear();
  }

  state.waiting = false;

  if (hasToolState) {
    events.push({ type: 'agentToolsClear', id: agentId });

    for (const toolId of state.backgroundAgentToolIds) {
      const status = state.activeToolStatuses.get(toolId);
      if (!status) {
        continue;
      }

      events.push({
        type: 'agentToolStart',
        id: agentId,
        toolId,
        status,
      });
    }
  }

  events.push({ type: 'agentStatus', id: agentId, status: 'active' });
  return events;
}

function refreshClaudePermissionTimer(
  watchedSession: SessionWatchState,
  emitHostEvent: (event: HostEvent) => void,
): void {
  if (!hasClaudePermissionCandidate(watchedSession.claudeState)) {
    clearClaudePermissionTimer(watchedSession);
    return;
  }

  scheduleClaudePermissionCheck(watchedSession, emitHostEvent);
}

function hasClaudePermissionCandidate(state: ClaudeActivityState): boolean {
  for (const toolId of state.activeToolIds) {
    const toolName = state.activeToolNames.get(toolId);
    if (toolName && !CLAUDE_PERMISSION_EXEMPT_TOOLS.has(toolName)) {
      return true;
    }
  }

  for (const parentToolIds of state.activeSubagentToolNames.values()) {
    for (const toolName of parentToolIds.values()) {
      if (!CLAUDE_PERMISSION_EXEMPT_TOOLS.has(toolName)) {
        return true;
      }
    }
  }

  return false;
}

function getClaudePermissionSubagentParents(state: ClaudeActivityState): string[] {
  const parentToolIds: string[] = [];

  for (const [parentToolId, subToolNames] of state.activeSubagentToolNames) {
    for (const toolName of subToolNames.values()) {
      if (!CLAUDE_PERMISSION_EXEMPT_TOOLS.has(toolName)) {
        parentToolIds.push(parentToolId);
        break;
      }
    }
  }

  return parentToolIds;
}

function scheduleClaudePermissionCheck(
  watchedSession: SessionWatchState,
  emitHostEvent: (event: HostEvent) => void,
): void {
  clearClaudePermissionTimer(watchedSession);
  watchedSession.permissionTimer = setTimeout(() => {
    watchedSession.permissionTimer = null;

    if (!hasClaudePermissionCandidate(watchedSession.claudeState)) {
      return;
    }

    watchedSession.claudeState.permissionSent = true;
    emitHostEvent({
      type: 'agentToolPermission',
      id: getRendererAgentId(watchedSession.session),
    });

    for (const parentToolId of getClaudePermissionSubagentParents(watchedSession.claudeState)) {
      emitHostEvent({
        type: 'subagentToolPermission',
        id: getRendererAgentId(watchedSession.session),
        parentToolId,
      });
    }
  }, watchedSession.claudePermissionDelayMs);
}

function clearClaudePermissionState(
  watchedSession: SessionWatchState,
  emitHostEvent: (event: HostEvent) => void,
): void {
  clearClaudePermissionTimer(watchedSession);
  if (!watchedSession.claudeState.permissionSent) {
    return;
  }

  watchedSession.claudeState.permissionSent = false;
  emitHostEvent({
    type: 'agentToolPermissionClear',
    id: getRendererAgentId(watchedSession.session),
  });
}

function shouldScheduleClaudeWaiting(line: string): boolean {
  try {
    const record = JSON.parse(line) as Record<string, unknown>;
    if (record.type !== 'assistant') {
      return false;
    }

    const assistantContent =
      (record.message as Record<string, unknown> | undefined)?.content ?? record.content;
    if (typeof assistantContent === 'string') {
      return assistantContent.trim().length > 0;
    }

    if (!Array.isArray(assistantContent)) {
      return false;
    }

    const hasText = assistantContent.some(
      (block) =>
        typeof block === 'object' &&
        block !== null &&
        (block as Record<string, unknown>).type === 'text',
    );
    const hasToolUse = assistantContent.some(
      (block) =>
        typeof block === 'object' &&
        block !== null &&
        (block as Record<string, unknown>).type === 'tool_use',
    );
    return hasText && !hasToolUse;
  } catch {
    return false;
  }
}

function scheduleClaudeWaiting(
  watchedSession: SessionWatchState,
  emitHostEvent: (event: HostEvent) => void,
): void {
  clearClaudeWaitingTimer(watchedSession);
  watchedSession.waitingTimer = setTimeout(() => {
    watchedSession.waitingTimer = null;
    watchedSession.claudeState.waiting = true;
    emitHostEvent({
      type: 'agentStatus',
      id: getRendererAgentId(watchedSession.session),
      status: 'waiting',
    });
  }, watchedSession.claudeTextIdleDelayMs);
}

function clearClaudeWaitingTimer(watchedSession: SessionWatchState | undefined): void {
  if (!watchedSession?.waitingTimer) {
    return;
  }

  clearTimeout(watchedSession.waitingTimer);
  watchedSession.waitingTimer = null;
}

function clearClaudePermissionTimer(watchedSession: SessionWatchState | undefined): void {
  if (!watchedSession?.permissionTimer) {
    return;
  }

  clearTimeout(watchedSession.permissionTimer);
  watchedSession.permissionTimer = null;
}
