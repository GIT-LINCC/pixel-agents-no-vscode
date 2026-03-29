import assert from 'node:assert/strict';
import { test } from 'node:test';

import { processCodexTranscriptLine } from './activityMonitor';
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
