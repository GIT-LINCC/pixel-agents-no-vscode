# Desktop Host Scaffold

This directory is the first no-VSCode desktop host stub for Pixel Agents.

## Scope

- Electron-style shell only
- Read-only Claude/Codex monitor MVP only
- No dependency changes at the repo root
- No renderer integration with `src/**` or `webview-ui/src/**` yet

## Files

- `main.ts`: minimal Electron main-process shell, IPC handler registration, and placeholder window boot
- `preload.ts`: secure preload bridge that exposes a typed `window.pixelAgentsDesktop` API
- `bridge.ts`: shared desktop bridge contract, request/response/event types, and bootstrap payload helpers
- `tsconfig.json`: isolated TypeScript config so this scaffold can be checked without touching root config

## Current Behavior

- If an Electron runtime loads `dist/main.js`, it opens a placeholder desktop window.
- If `PIXEL_AGENTS_DESKTOP_URL` is set, `main.ts` loads that renderer URL instead of the inline placeholder.
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
- The current desktop shell now streams basic Codex activity into the shared renderer contract:
  - `agentToolStart` / `agentToolDone`
  - `agentStatus`
  - `agentToolsClear`
- Claude is still discovery-only for now, so only Codex sessions get live tool/status updates in this scaffold.

## Why It Is Structured This Way

The goal here is to give the mainline branch a stable desktop seam without prematurely coupling Electron to the existing VS Code extension or webview runtime. The bridge contract is meant to survive the next steps:

1. wire a real renderer shell
2. add Claude transcript discovery
3. add Codex transcript discovery
4. adapt the current UI to consume a host-agnostic bridge

## Validation

From the repo root:

```powershell
npx tsc --noEmit -p desktop/tsconfig.json
node --import tsx --test desktop/*.test.ts
```

This validates the desktop discovery/renderer compatibility layer. It still does not start Electron, because Electron is not yet added as a dependency in this branch.

## Mainline Integration Still Needed

- add an Electron dependency and desktop-specific start/build scripts
- replace the placeholder HTML with a real desktop renderer entry
- add Claude transcript activity mapping to match the Codex desktop monitor path
- expose richer desktop diagnostics and monitor controls in the shared renderer
- decide whether desktop packaging lives here or in a later dedicated package/app directory
