# Pixel Agents No VSCode

<p align="center">
  <img src="webview-ui/public/banner.png" alt="Pixel Agents No VSCode banner">
</p>

<p align="center">
  A desktop-first fork of Pixel Agents that keeps the pixel office UI, but removes the VS Code dependency.
</p>

<p align="center">
  <img src="webview-ui/public/Screenshot.jpg" alt="Pixel Agents office screenshot" width="900">
</p>

## What This Repository Is

This repository is a focused fork of [Pixel Agents](https://github.com/pablodelucca/pixel-agents) aimed at a no-VSCode desktop workflow.

The current goal is practical and narrow:

- run Pixel Agents as a standalone desktop app
- monitor local Codex and Claude sessions without relying on VS Code
- keep the existing office visualization and shared renderer
- prioritize a stable read-only monitor before adding desktop control features

This is not a generic rebrand of the upstream project. It is a product-direction fork centered on the desktop monitor path.

## Current Status

The project is now in a genuinely usable state for desktop monitoring.

What works today:

- standalone Electron window
- shared Pixel Agents office UI outside VS Code
- local session discovery for:
  - `~/.codex/sessions/**/*.jsonl`
  - `~/.claude/projects/**/*.jsonl`
- visible agent characters for discovered sessions
- live read-only activity updates
- Codex tool lifecycle visualization
- Claude tool, waiting, permission, and sub-agent activity visualization
- office layout rendering with bundled assets

What is intentionally not in scope yet:

- launching agents from the desktop UI
- focusing existing terminal/app windows from the desktop UI
- closing sessions from the desktop UI
- IDE/window attachment as a core interaction model
- desktop-first authoring flows beyond monitoring

## Quick Start

### Requirements

- Node.js 20 or newer recommended
- npm
- local Codex and/or Claude transcripts on the machine you want to monitor

### Install

```bash
git clone https://github.com/GIT-LINCC/pixel-agents-no-vscode.git
cd pixel-agents-no-vscode
npm install
```

### Run the Desktop App

```bash
npm run desktop:start
```

This builds the shared webview UI, builds the Electron main/preload bundles, and launches the desktop monitor.

### Useful Commands

```bash
npm run desktop:build
npm run desktop:run
npm run test:desktop
cd webview-ui && npm test
```

## Desktop Architecture

The current desktop path keeps the original renderer and adds a host bridge around it.

- `desktop/main.ts`
  Electron main process, window boot, IPC, polling loop, diagnostics
- `desktop/preload.ts`
  secure desktop bridge and renderer compatibility adapter
- `desktop/bridge.ts`
  typed desktop request/response/event contracts
- `desktop/discovery.ts`
  local Claude/Codex transcript discovery
- `desktop/activityMonitor.ts`
  lightweight activity streaming from transcript updates
- `desktop/rendererHost.ts`
  translation layer from desktop session state into the shared renderer event model
- `webview-ui/`
  existing Pixel Agents React/canvas office UI reused by the desktop app

The important design choice is that the desktop app does not reimplement the office UI. It reuses the shared renderer and feeds it desktop-compatible host events.

## How Monitoring Works

The desktop host watches transcript files and maps them into the office simulation.

For Codex:

- recent session files are discovered from `~/.codex/sessions`
- transcript metadata is used to derive session identity, label, workspace, and recency
- tool activity is inferred from response items and task lifecycle events

For Claude:

- recent project transcripts are discovered from `~/.claude/projects`
- assistant/user/progress records drive tool activity and waiting state
- permission waits and task sub-agents are surfaced visually

The monitor is observational. It does not need to patch Codex or Claude.

## Why This Fork Exists

Upstream Pixel Agents is still primarily a VS Code extension product. This fork exists because the desktop direction has different priorities:

- desktop-first instead of editor-first
- monitor-first instead of embedded workflow-first
- Codex parity matters, not just Claude integration
- VS Code attachment is optional, not foundational

That means some upstream assumptions are intentionally being removed here, especially where they make the product harder to use outside an editor host.

## Roadmap

Near-term priorities:

- improve Codex activity mapping fidelity
- add a `desktop:dev` workflow for faster iteration
- surface richer diagnostics inside the desktop UI
- make the desktop runtime more robust across Windows/Linux/macOS

Later possibilities:

- optional focus/open session actions
- desktop-native layout persistence and settings flows
- attach-adjacent workflows beside Codex or other agent apps
- broader agent/runtime adapters beyond the current transcript-based monitor

## Troubleshooting

If the desktop app opens but does not reflect local sessions, run with tracing enabled:

```powershell
$env:PIXEL_AGENTS_DESKTOP_TRACE = "1"
npm run desktop:start
```

This writes trace output to `desktop-trace.log` in the repo root.

You can also verify the local desktop pipeline directly:

```bash
npm run test:desktop
npm run desktop:build
```

## Relationship To Upstream

This repository builds on the upstream Pixel Agents project and keeps reusing major parts of its renderer, assets, and office model.

Upstream repository:

- [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents)

This fork is focused on pushing the standalone desktop/no-VSCode path into a real product surface.

## License

This project remains licensed under the [MIT License](LICENSE).
