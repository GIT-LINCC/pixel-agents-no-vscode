import assert from 'node:assert/strict';
import { test } from 'node:test';

import { processClaudeTranscriptLine, processCodexTranscriptLine } from './activityMonitor';
import type { DesktopMonitorSession } from './bridge';
import { getRendererAgentId } from './rendererHost';

const session: DesktopMonitorSession = {
  id: 'session-1',
  agentKind: 'codex',
  label: 'Codex pixel-agents',
  transcriptPath: 'H:\\pixel-agents\\codex-session.jsonl',
  workspacePath: 'H:\\pixel-agents',
  lastSeenAt: new Date().toISOString(),
  status: 'watching',
  readOnly: true,
};

test('processCodexTranscriptLine emits tool lifecycle and waiting state', () => {
  const state = {
    activeToolCalls: new Map<string, string>(),
    waiting: false,
  };
  const agentId = getRendererAgentId(session);

  const startEvents = processCodexTranscriptLine(
    session,
    JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'function_call',
        call_id: 'call-1',
        name: 'shell_command',
        arguments: JSON.stringify({ command: 'npm run build' }),
      },
    }),
    state,
  );
  assert.deepEqual(startEvents, [
    {
      type: 'agentToolStart',
      id: agentId,
      toolId: 'call-1',
      status: 'Running: npm run build',
    },
  ]);

  const doneEvents = processCodexTranscriptLine(
    session,
    JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call-1',
      },
    }),
    state,
  );
  assert.deepEqual(doneEvents, [{ type: 'agentToolDone', id: agentId, toolId: 'call-1' }]);

  const waitEvents = processCodexTranscriptLine(
    session,
    JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'task_complete',
      },
    }),
    state,
  );
  assert.deepEqual(waitEvents, [{ type: 'agentStatus', id: agentId, status: 'waiting' }]);
});

test('processCodexTranscriptLine clears waiting and formats custom tool calls', () => {
  const state = {
    activeToolCalls: new Map<string, string>(),
    waiting: true,
  };
  const agentId = getRendererAgentId(session);

  const commentaryEvents = processCodexTranscriptLine(
    session,
    JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'agent_message',
        phase: 'commentary',
      },
    }),
    state,
  );
  assert.deepEqual(commentaryEvents, [{ type: 'agentStatus', id: agentId, status: 'active' }]);

  const patchEvents = processCodexTranscriptLine(
    session,
    JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        call_id: 'patch-1',
        name: 'apply_patch',
      },
    }),
    state,
  );
  assert.deepEqual(patchEvents, [
    {
      type: 'agentToolStart',
      id: agentId,
      toolId: 'patch-1',
      status: 'Editing files',
    },
  ]);
});

test('processClaudeTranscriptLine emits tool, subagent, and waiting events', () => {
  const claudeSession: DesktopMonitorSession = {
    id: 'claude-session',
    agentKind: 'claude',
    label: 'Claude pixel-agents',
    transcriptPath: 'H:\\pixel-agents\\claude-session.jsonl',
    workspacePath: 'H:\\pixel-agents',
    lastSeenAt: new Date().toISOString(),
    status: 'watching',
    readOnly: true,
  };
  const state = {
    activeToolIds: new Set<string>(),
    activeToolNames: new Map<string, string>(),
    activeToolStatuses: new Map<string, string>(),
    activeSubagentToolIds: new Map<string, Set<string>>(),
    activeSubagentToolNames: new Map<string, Map<string, string>>(),
    backgroundAgentToolIds: new Set<string>(),
    waiting: false,
  };
  const agentId = getRendererAgentId(claudeSession);

  const startEvents = processClaudeTranscriptLine(
    claudeSession,
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'task-1',
            name: 'Task',
            input: {
              description: 'Plan renderer host bridge',
            },
          },
        ],
      },
    }),
    state,
  );
  assert.deepEqual(startEvents, [
    { type: 'agentStatus', id: agentId, status: 'active' },
    {
      type: 'agentToolStart',
      id: agentId,
      toolId: 'task-1',
      status: 'Subtask: Plan renderer host bridge',
    },
  ]);

  const subagentStartEvents = processClaudeTranscriptLine(
    claudeSession,
    JSON.stringify({
      type: 'progress',
      parentToolUseID: 'task-1',
      data: {
        type: 'agent_progress',
        message: {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'sub-bash-1',
                name: 'Bash',
                input: {
                  command: 'npm run build',
                },
              },
            ],
          },
        },
      },
    }),
    state,
  );
  assert.deepEqual(subagentStartEvents, [
    {
      type: 'subagentToolStart',
      id: agentId,
      parentToolId: 'task-1',
      toolId: 'sub-bash-1',
      status: 'Running: npm run build',
    },
  ]);

  const subagentDoneEvents = processClaudeTranscriptLine(
    claudeSession,
    JSON.stringify({
      type: 'progress',
      parentToolUseID: 'task-1',
      data: {
        type: 'agent_progress',
        message: {
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'sub-bash-1',
              },
            ],
          },
        },
      },
    }),
    state,
  );
  assert.deepEqual(subagentDoneEvents, [
    {
      type: 'subagentToolDone',
      id: agentId,
      parentToolId: 'task-1',
      toolId: 'sub-bash-1',
    },
  ]);

  const doneEvents = processClaudeTranscriptLine(
    claudeSession,
    JSON.stringify({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'task-1',
          },
        ],
      },
    }),
    state,
  );
  assert.deepEqual(doneEvents, [
    {
      type: 'subagentClear',
      id: agentId,
      parentToolId: 'task-1',
    },
    {
      type: 'agentToolDone',
      id: agentId,
      toolId: 'task-1',
    },
  ]);

  const waitEvents = processClaudeTranscriptLine(
    claudeSession,
    JSON.stringify({
      type: 'system',
      subtype: 'turn_duration',
    }),
    state,
  );
  assert.deepEqual(waitEvents, [{ type: 'agentStatus', id: agentId, status: 'waiting' }]);
});

test('processClaudeTranscriptLine preserves async background task state across turn end', () => {
  const claudeSession: DesktopMonitorSession = {
    id: 'claude-async',
    agentKind: 'claude',
    label: 'Claude async',
    transcriptPath: 'H:\\pixel-agents\\claude-async.jsonl',
    workspacePath: 'H:\\pixel-agents',
    lastSeenAt: new Date().toISOString(),
    status: 'watching',
    readOnly: true,
  };
  const state = {
    activeToolIds: new Set<string>(),
    activeToolNames: new Map<string, string>(),
    activeToolStatuses: new Map<string, string>(),
    activeSubagentToolIds: new Map<string, Set<string>>(),
    activeSubagentToolNames: new Map<string, Map<string, string>>(),
    backgroundAgentToolIds: new Set<string>(),
    waiting: false,
  };
  const agentId = getRendererAgentId(claudeSession);

  processClaudeTranscriptLine(
    claudeSession,
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'task-async',
            name: 'Task',
            input: { description: 'Background work' },
          },
        ],
      },
    }),
    state,
  );

  const asyncLaunchEvents = processClaudeTranscriptLine(
    claudeSession,
    JSON.stringify({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'task-async',
            content: 'Async agent launched successfully.',
          },
        ],
      },
    }),
    state,
  );
  assert.deepEqual(asyncLaunchEvents, []);

  const turnEndEvents = processClaudeTranscriptLine(
    claudeSession,
    JSON.stringify({
      type: 'system',
      subtype: 'turn_duration',
    }),
    state,
  );
  assert.deepEqual(turnEndEvents, [{ type: 'agentStatus', id: agentId, status: 'waiting' }]);

  const queueEvents = processClaudeTranscriptLine(
    claudeSession,
    JSON.stringify({
      type: 'queue-operation',
      operation: 'enqueue',
      content: '<tool-use-id>task-async</tool-use-id>',
    }),
    state,
  );
  assert.deepEqual(queueEvents, [
    {
      type: 'subagentClear',
      id: agentId,
      parentToolId: 'task-async',
    },
    {
      type: 'agentToolDone',
      id: agentId,
      toolId: 'task-async',
    },
  ]);
});

test('processClaudeTranscriptLine clears waiting for text-only assistant and user prompts', () => {
  const claudeSession: DesktopMonitorSession = {
    id: 'claude-text',
    agentKind: 'claude',
    label: 'Claude text',
    transcriptPath: 'H:\\pixel-agents\\claude-text.jsonl',
    workspacePath: 'H:\\pixel-agents',
    lastSeenAt: new Date().toISOString(),
    status: 'watching',
    readOnly: true,
  };
  const state = {
    activeToolIds: new Set<string>(),
    activeToolNames: new Map<string, string>(),
    activeToolStatuses: new Map<string, string>(),
    activeSubagentToolIds: new Map<string, Set<string>>(),
    activeSubagentToolNames: new Map<string, Map<string, string>>(),
    backgroundAgentToolIds: new Set<string>(),
    waiting: true,
  };
  const agentId = getRendererAgentId(claudeSession);

  const assistantEvents = processClaudeTranscriptLine(
    claudeSession,
    JSON.stringify({
      type: 'assistant',
      message: {
        content: 'Here is a plain text update.',
      },
    }),
    state,
  );
  assert.deepEqual(assistantEvents, [{ type: 'agentStatus', id: agentId, status: 'active' }]);

  state.waiting = true;
  const userPromptEvents = processClaudeTranscriptLine(
    claudeSession,
    JSON.stringify({
      type: 'user',
      message: {
        content: 'Please continue.',
      },
    }),
    state,
  );
  assert.deepEqual(userPromptEvents, [{ type: 'agentStatus', id: agentId, status: 'active' }]);
});

test('processClaudeTranscriptLine clears waiting for assistant text blocks', () => {
  const claudeSession: DesktopMonitorSession = {
    id: 'claude-text-blocks',
    agentKind: 'claude',
    label: 'Claude text blocks',
    transcriptPath: 'H:\\pixel-agents\\claude-text-blocks.jsonl',
    workspacePath: 'H:\\pixel-agents',
    lastSeenAt: new Date().toISOString(),
    status: 'watching',
    readOnly: true,
  };
  const state = {
    activeToolIds: new Set<string>(),
    activeToolNames: new Map<string, string>(),
    activeToolStatuses: new Map<string, string>(),
    activeSubagentToolIds: new Map<string, Set<string>>(),
    activeSubagentToolNames: new Map<string, Map<string, string>>(),
    backgroundAgentToolIds: new Set<string>(),
    waiting: true,
  };
  const agentId = getRendererAgentId(claudeSession);

  const assistantEvents = processClaudeTranscriptLine(
    claudeSession,
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'text',
            text: 'Here is a structured text update.',
          },
        ],
      },
    }),
    state,
  );

  assert.deepEqual(assistantEvents, [{ type: 'agentStatus', id: agentId, status: 'active' }]);
});
