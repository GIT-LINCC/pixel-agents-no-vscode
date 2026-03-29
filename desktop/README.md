# Desktop Host Scaffold

This directory contains the no-VSCode desktop host for Pixel Agents.

## Scope

- Electron shell only
- Read-only Claude/Codex monitor MVP only
- Shared `webview-ui` renderer reused through a desktop compatibility bridge

## Files

- `main.ts`: Electron main-process shell, IPC handler registration, session refresh loop, and renderer window boot
- `preload.ts`: secure preload bridge that exposes a typed `window.pixelAgentsDesktop` API
- `bridge.ts`: shared desktop bridge contract, request/response/event types, and bootstrap payload helpers
- `rendererHost.ts`: adapter that maps discovered desktop sessions and bootstrap payloads onto the shared renderer contract
- `activityMonitor.ts`: read-only transcript polling for Claude and Codex activity updates
- `assets.ts`: desktop bootstrap loader for sprites, furniture catalog, and default layout
- `tsconfig.json`: isolated TypeScript config for desktop-only type checks

## Current Behavior

- `npm run desktop:start` builds the shared renderer plus the desktop main/preload bundles, then launches Electron.
- By default, the desktop app loads the built shared renderer at `dist/webview/index.html`.
- If `PIXEL_AGENTS_DESKTOP_URL` is set, `main.ts` loads that renderer URL instead of the built file.
- The preload bridge exposes:

```ts
window.pixelAgentsDesktop.invoke({ type: 'desktop.bootstrap' });
window.pixelAgentsDesktop.onHostEvent((event) => {
  // future renderer adapter hook
});
```

- It also exposes a temporary compatibility bridge for the shared renderer:

```ts
window.pixelAgentsHost.postMessage({ type: 'webviewReady' });
window.pixelAgentsHost.subscribe((event) => {
  // settingsLoaded / layoutLoaded / existingAgents
});
```

- The host intentionally reports a read-only capability set:
  - launch: off
  - focus: off
  - close: off
  - IDE attach: off
  - shared renderer reuse: planned, not wired

- The main process now discovers recent local session transcripts and exposes them through the desktop bridge:
  - Claude: `~/.claude/projects/**/*.jsonl`
  - Codex: `~/.codex/sessions/**/*.jsonl`
- The compatibility bridge translates those discovered sessions into the current shared renderer contract:
  - `existingAgents`
  - `agentCreated` / `agentClosed`
  - `workspaceFolders`
  - `agentDiagnostics`
- The current desktop shell now streams basic Claude and Codex activity into the shared renderer contract:
  - `agentToolStart` / `agentToolDone`
  - `agentStatus`
  - `agentToolsClear`
  - `agentToolPermission` / `agentToolPermissionClear`
  - `subagentToolStart` / `subagentToolDone` / `subagentClear` for Claude task progress
  - `subagentToolPermission` for Claude task progress that appears stuck on approval
- Activity coverage is intentionally lightweight:
  - Codex: `function_call`, `function_call_output`, `task_complete`
  - Claude: `tool_use`, `tool_result`, `turn_duration`, `agent_progress`, lightweight permission wait timers
  - Neither path reconstructs the full in-flight state from the entire transcript history yet; monitoring starts from the current file tail.

## Run It

From the repo root:

```powershell
npm install
npm run desktop:start
```

This launches a read-only desktop window that reuses the existing Pixel Agents UI and discovers local sessions from:

- `~/.codex/sessions/**/*.jsonl`
- `~/.claude/projects/**/*.jsonl`

Current desktop capabilities:

- monitor discovered Codex and Claude sessions
- render the same office UI used by the VS Code extension
- show tool activity, waiting state, and Claude permission/sub-agent bubbles

Current desktop limitations:

- no agent launch from the UI
- no focus/close session actions
- no layout persistence or external asset directory management
- no IDE/window attach behavior

## Why It Is Structured This Way

The goal here is to give the mainline branch a stable desktop seam without coupling Electron to the VS Code extension host. The bridge contract is meant to survive the next steps:

1. wire a real renderer shell
2. deepen transcript activity coverage beyond the current minimal event set
3. adapt the current UI to consume a host-agnostic bridge without compatibility shims
4. decide how desktop packaging and distribution should live alongside the extension

## Validation

From the repo root:

```powershell
npx tsc --noEmit -p desktop/tsconfig.json
node --import tsx --test desktop/*.test.ts
```

To validate the runnable desktop path:

```powershell
npm run test:desktop
npm run desktop:build
```

## Mainline Integration Still Needed

- deepen Codex activity mapping and Claude transcript coverage beyond the current lightweight timer-based model
- expose richer desktop diagnostics and monitor controls in the shared renderer
- add writable desktop host features such as launch/focus/close when the no-VSCode workflow is ready for them
- decide whether desktop packaging lives here or in a later dedicated package/app directory
