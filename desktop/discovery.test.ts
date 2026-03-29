import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, test } from 'node:test';

import { discoverDesktopMonitorState } from './discovery';
import {
  buildRendererBootstrapEvents,
  buildRendererDiagnostics,
  buildRendererSessionUpdateEvents,
  getRendererAgentId,
} from './rendererHost';
import type { DesktopMonitorSession } from './bridge';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test('discoverDesktopMonitorState parses Codex session metadata and Claude transcript roots', () => {
  const homeDir = createTempHome();
  const codexRoot = path.join(homeDir, '.codex', 'sessions', '2026', '03', '29');
  const claudeRoot = path.join(homeDir, '.claude', 'projects', 'H--repo');
  fs.mkdirSync(codexRoot, { recursive: true });
  fs.mkdirSync(claudeRoot, { recursive: true });

  const codexPath = path.join(
    codexRoot,
    'rollout-2026-03-29T12-15-29-019d37cd-d566-7da0-b038-c4f52e05433e.jsonl',
  );
  const claudePath = path.join(claudeRoot, 'session-123.jsonl');
  const now = Date.UTC(2026, 2, 29, 12, 30, 0);

  fs.writeFileSync(
    codexPath,
    `${JSON.stringify({
      type: 'session_meta',
      payload: {
        id: '019d37cd-d566-7da0-b038-c4f52e05433e',
        cwd: 'H:\\pixel-agents',
      },
    })}\n`,
    'utf8',
  );
  fs.writeFileSync(
    claudePath,
    `${JSON.stringify({
      cwd: 'H:\\workspace\\claude-project',
      type: 'assistant',
    })}\n`,
    'utf8',
  );

  fs.utimesSync(codexPath, new Date(now - 60_000), new Date(now - 60_000));
  fs.utimesSync(claudePath, new Date(now - 2 * 60_000), new Date(now - 2 * 60_000));

  const result = discoverDesktopMonitorState({ homeDir, now });
  const codexSession = result.sessions.find((session) => session.agentKind === 'codex');
  const claudeSession = result.sessions.find((session) => session.agentKind === 'claude');

  assert.deepEqual(result.watchRoots, {
    claude: [path.join(homeDir, '.claude', 'projects')],
    codex: [path.join(homeDir, '.codex', 'sessions')],
  });
  assert.ok(codexSession);
  assert.equal(codexSession?.id, '019d37cd-d566-7da0-b038-c4f52e05433e');
  assert.equal(codexSession?.workspacePath, 'H:\\pixel-agents');
  assert.equal(codexSession?.status, 'watching');
  assert.ok(codexSession?.label.includes('pixel-agents'));

  assert.ok(claudeSession);
  assert.equal(claudeSession?.id, 'session-123');
  assert.equal(claudeSession?.workspacePath, 'H:\\workspace\\claude-project');
  assert.equal(claudeSession?.status, 'watching');
});

test('discoverDesktopMonitorState marks old sessions as stale', () => {
  const homeDir = createTempHome();
  const codexRoot = path.join(homeDir, '.codex', 'sessions', '2026', '03', '29');
  fs.mkdirSync(codexRoot, { recursive: true });

  const transcriptPath = path.join(codexRoot, 'rollout-old.jsonl');
  const now = Date.UTC(2026, 2, 29, 12, 30, 0);

  fs.writeFileSync(
    transcriptPath,
    `${JSON.stringify({
      type: 'session_meta',
      payload: {
        id: 'old-session',
      },
    })}\n`,
    'utf8',
  );
  fs.utimesSync(
    transcriptPath,
    new Date(now - 2 * 24 * 60 * 60 * 1000),
    new Date(now - 2 * 24 * 60 * 60 * 1000),
  );

  const result = discoverDesktopMonitorState({ homeDir, now });
  assert.equal(result.sessions[0]?.status, 'stale');
});

test('renderer host mapping emits bootstrap and incremental agent updates', () => {
  const tempDir = createTempHome();
  const transcriptA = path.join(tempDir, 'a.jsonl');
  const transcriptB = path.join(tempDir, 'b.jsonl');
  fs.writeFileSync(transcriptA, '{"type":"session_meta"}\n', 'utf8');
  fs.writeFileSync(transcriptB, '{"type":"session_meta"}\n', 'utf8');

  const previousSessions: DesktopMonitorSession[] = [
    {
      id: 'claude-a',
      agentKind: 'claude',
      label: 'Claude repo-a',
      transcriptPath: transcriptA,
      workspacePath: 'H:\\repo-a',
      lastSeenAt: new Date().toISOString(),
      status: 'watching',
      readOnly: true,
    },
  ];
  const nextSessions: DesktopMonitorSession[] = [
    {
      id: 'codex-b',
      agentKind: 'codex',
      label: 'Codex repo-b',
      transcriptPath: transcriptB,
      workspacePath: 'H:\\repo-b',
      lastSeenAt: new Date().toISOString(),
      status: 'watching',
      readOnly: true,
    },
  ];

  const bootstrapEvents = buildRendererBootstrapEvents(previousSessions);
  assert.equal(bootstrapEvents[0]?.type, 'settingsLoaded');
  assert.equal(bootstrapEvents[1]?.type, 'layoutLoaded');
  assert.deepEqual(bootstrapEvents[2], {
    type: 'existingAgents',
    agents: [getRendererAgentId(previousSessions[0])],
    folderNames: { [getRendererAgentId(previousSessions[0])]: 'repo-a' },
  });

  const updateEvents = buildRendererSessionUpdateEvents(previousSessions, nextSessions);
  assert.deepEqual(updateEvents[0], {
    type: 'agentClosed',
    id: getRendererAgentId(previousSessions[0]),
  });
  assert.deepEqual(updateEvents[1], {
    type: 'agentCreated',
    id: getRendererAgentId(nextSessions[0]),
    folderName: 'repo-b',
  });
  assert.equal(updateEvents[2]?.type, 'agentDiagnostics');

  const diagnostics = buildRendererDiagnostics(nextSessions);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.jsonlExists, true);
  assert.equal(diagnostics[0]?.projectDir, 'H:\\repo-b');
});

function createTempHome(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-agents-desktop-'));
  tempDirs.push(tempDir);
  return tempDir;
}
