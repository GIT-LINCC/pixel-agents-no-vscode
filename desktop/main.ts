import { join } from 'node:path';

import {
  createDesktopBootstrapPayload,
  IPC_CHANNELS,
  type DesktopBridgeRequest,
  type DesktopBridgeResponse,
  type DesktopHostEvent,
  type DesktopMonitorSession,
} from './bridge';
import { DesktopActivityMonitor } from './activityMonitor';
import { discoverDesktopMonitorState } from './discovery';

type BrowserWindowInstance = {
  loadURL(url: string): Promise<void>;
  on(event: 'ready-to-show' | 'closed', listener: () => void): void;
  show(): void;
  isDestroyed(): boolean;
  webContents: {
    send(channel: string, payload: DesktopHostEvent): void;
    openDevTools(options?: { mode: 'detach' | 'undocked' }): void;
  };
};

type BrowserWindowConstructor = {
  new (options: Record<string, unknown>): BrowserWindowInstance;
  getAllWindows(): BrowserWindowInstance[];
};

interface AppLike {
  whenReady(): Promise<void>;
  on(event: 'activate' | 'window-all-closed', listener: () => void): void;
  quit(): void;
}

interface IpcMainLike {
  handle(
    channel: string,
    listener: (
      _event: unknown,
      request: DesktopBridgeRequest,
    ) => DesktopBridgeResponse | Promise<DesktopBridgeResponse>,
  ): void;
  removeHandler(channel: string): void;
}

interface ElectronMainModule {
  app: AppLike;
  BrowserWindow: BrowserWindowConstructor;
  ipcMain: IpcMainLike;
}

const electron = require('electron') as ElectronMainModule;

const PLACEHOLDER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Pixel Agents Desktop</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(74, 222, 128, 0.24), transparent 32rem),
          linear-gradient(180deg, #111827 0%, #020617 100%);
        color: #e2e8f0;
      }
      main {
        width: min(52rem, calc(100vw - 3rem));
        padding: 2rem;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 1.25rem;
        background: rgba(2, 6, 23, 0.78);
        box-shadow: 0 18px 40px rgba(15, 23, 42, 0.4);
      }
      h1 {
        margin-top: 0;
        font-size: clamp(2rem, 3vw, 2.6rem);
      }
      p, li {
        line-height: 1.6;
        color: #cbd5e1;
      }
      code {
        color: #86efac;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Pixel Agents Desktop Scaffold</h1>
      <p>
        This Electron host is a no-VSCode placeholder for the read-only Claude/Codex monitor MVP.
      </p>
      <ul>
        <li>The current window only proves the shell, preload bridge, and IPC contract.</li>
        <li>No session launch/focus/close flows are implemented here by design.</li>
        <li>A future renderer should call <code>window.pixelAgentsDesktop.invoke(...)</code>.</li>
      </ul>
    </main>
  </body>
</html>`;

const rendererUrlFromEnv = process.env.PIXEL_AGENTS_DESKTOP_URL;
const preloadPath = join(__dirname, 'preload.js');
const monitorPollIntervalMs = Number(process.env.PIXEL_AGENTS_DESKTOP_POLL_MS ?? 5000);

let mainWindow: BrowserWindowInstance | null = null;
let monitorRunning = false;
let monitorTimer: ReturnType<typeof setInterval> | null = null;
let watchRoots = {
  claude: [] as string[],
  codex: [] as string[],
};
let sessions: DesktopMonitorSession[] = [];
const activityMonitor = new DesktopActivityMonitor((event) => {
  emitHostEvent({ type: 'desktop.renderer.event', event });
});

function createMainWindow(): BrowserWindowInstance {
  const windowInstance = new electron.BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    title: 'Pixel Agents Desktop',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });

  windowInstance.on('ready-to-show', () => {
    windowInstance.show();
  });

  windowInstance.on('closed', () => {
    if (mainWindow === windowInstance) {
      mainWindow = null;
    }
  });

  void windowInstance.loadURL(
    rendererUrlFromEnv ?? `data:text/html;charset=utf-8,${encodeURIComponent(PLACEHOLDER_HTML)}`,
  );

  if (process.env.PIXEL_AGENTS_DESKTOP_DEVTOOLS === '1') {
    windowInstance.webContents.openDevTools({ mode: 'detach' });
  }

  return windowInstance;
}

function emitHostEvent(event: DesktopHostEvent): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send(IPC_CHANNELS.hostEvent, event);
}

function refreshSessions(emitUpdates: boolean): void {
  const snapshot = discoverDesktopMonitorState();
  const nextWatchRoots = {
    claude: [...(snapshot.watchRoots.claude ?? [])],
    codex: [...(snapshot.watchRoots.codex ?? [])],
  };
  const nextSessions = snapshot.sessions;
  const watchRootsChanged = JSON.stringify(watchRoots) !== JSON.stringify(nextWatchRoots);
  const sessionsChanged = JSON.stringify(sessions) !== JSON.stringify(nextSessions);

  watchRoots = nextWatchRoots;
  sessions = nextSessions;
  activityMonitor.syncSessions(sessions);

  if (!emitUpdates) {
    return;
  }

  if (sessionsChanged) {
    emitHostEvent({ type: 'desktop.sessions.updated', sessions });
  }

  if (sessionsChanged || watchRootsChanged) {
    emitHostEvent({
      type: 'desktop.diagnostics.updated',
      payload: createDesktopBootstrapPayload({
        sessions,
        monitorRunning,
        watchRoots,
      }).diagnostics,
    });
  }
}

function startMonitor(): void {
  monitorRunning = true;
  refreshSessions(true);
  if (monitorTimer) {
    return;
  }

  monitorTimer = setInterval(() => {
    refreshSessions(true);
    activityMonitor.poll();
  }, monitorPollIntervalMs);
}

function stopMonitor(): void {
  monitorRunning = false;
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}

function buildBootstrapResponse(): DesktopBridgeResponse {
  refreshSessions(false);
  return {
    type: 'desktop.bootstrap.result',
    payload: createDesktopBootstrapPayload({
      sessions,
      monitorRunning,
      watchRoots,
      notes: [
        'Main process desktop monitor is active.',
        'Renderer compatibility mode maps discovered Claude and Codex sessions onto the existing Pixel Agents webview contract.',
      ],
    }),
  };
}

function buildDiagnosticsResponse(): DesktopBridgeResponse {
  refreshSessions(false);
  return {
    type: 'desktop.diagnostics.result',
    payload: createDesktopBootstrapPayload({
      sessions,
      monitorRunning,
      watchRoots,
    }).diagnostics,
  };
}

function handleBridgeRequest(request: DesktopBridgeRequest): DesktopBridgeResponse {
  switch (request.type) {
    case 'desktop.bootstrap':
      return buildBootstrapResponse();
    case 'desktop.monitor.start':
      startMonitor();
      emitHostEvent({ type: 'desktop.monitor.state-changed', running: true });
      return { type: 'desktop.monitor.state', running: true };
    case 'desktop.monitor.stop':
      stopMonitor();
      emitHostEvent({ type: 'desktop.monitor.state-changed', running: false });
      return { type: 'desktop.monitor.state', running: false };
    case 'desktop.sessions.list':
      refreshSessions(false);
      return { type: 'desktop.sessions.result', sessions };
    case 'desktop.diagnostics.get':
      return buildDiagnosticsResponse();
    default:
      return assertNever(request);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled desktop bridge request: ${JSON.stringify(value)}`);
}

function registerIpcHandlers(): void {
  electron.ipcMain.removeHandler(IPC_CHANNELS.invoke);
  electron.ipcMain.handle(IPC_CHANNELS.invoke, (_event, request) => handleBridgeRequest(request));
}

async function bootstrap(): Promise<void> {
  await electron.app.whenReady();

  registerIpcHandlers();
  refreshSessions(false);
  mainWindow = createMainWindow();

  electron.app.on('activate', () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });

  electron.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      electron.app.quit();
    }
  });
}

void bootstrap();
