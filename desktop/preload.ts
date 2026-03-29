import {
  createDesktopBridge,
  DESKTOP_BRIDGE_NAME,
  type DesktopBridgeApi,
  type DesktopBridgeRequest,
  type DesktopBridgeResponse,
  type DesktopHostEvent,
  dispatchDesktopHostEvent,
  IPC_CHANNELS,
} from './bridge';
import {
  buildRendererBootstrapEvents,
  buildRendererDiagnostics,
  buildRendererSessionUpdateEvents,
} from './rendererHost';

const RENDERER_HOST_BRIDGE_NAME = 'pixelAgentsHost';
const RENDERER_HOST_EVENT = 'pixel-agents:host-message';

interface IpcRendererLike {
  invoke(channel: string, request: DesktopBridgeRequest): Promise<DesktopBridgeResponse>;
  on(channel: string, listener: (_event: unknown, payload: DesktopHostEvent) => void): void;
}

interface ContextBridgeLike {
  exposeInMainWorld<T>(apiKey: string, api: T): void;
}

interface ElectronPreloadModule {
  contextBridge: ContextBridgeLike;
  ipcRenderer: IpcRendererLike;
}

interface RendererHostFeatures {
  launchAgents: boolean;
  focusAgents: boolean;
  closeAgents: boolean;
  diagnostics: boolean;
  openSessionsFolder: boolean;
  importExportLayout: boolean;
  externalAssets: boolean;
}

interface RendererHostCommand {
  type: string;
  [key: string]: unknown;
}

interface RendererHostEvent {
  type: string;
  [key: string]: unknown;
}

interface RendererHostApi {
  features: RendererHostFeatures;
  postMessage(message: RendererHostCommand): void;
  subscribe(listener: (message: RendererHostEvent) => void): () => void;
}

declare global {
  interface Window {
    pixelAgentsDesktop: DesktopBridgeApi;
    pixelAgentsHost: RendererHostApi;
  }
}

const electron = require('electron') as ElectronPreloadModule;
const listeners = new Set<(event: DesktopHostEvent) => void>();
const rendererHostListeners = new Set<(event: RendererHostEvent) => void>();
let rendererSessions = [] as Array<{
  id: string;
  agentKind: 'claude' | 'codex';
  label: string;
  transcriptPath: string;
  workspacePath?: string;
  lastSeenAt?: string;
  status: 'discovered' | 'watching' | 'stale' | 'unknown';
  readOnly: true;
}>;

const rendererHostFeatures: RendererHostFeatures = {
  launchAgents: false,
  focusAgents: false,
  closeAgents: false,
  diagnostics: true,
  openSessionsFolder: false,
  importExportLayout: false,
  externalAssets: false,
};

function emitRendererHostEvent(event: RendererHostEvent): void {
  for (const listener of rendererHostListeners) {
    listener(event);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<RendererHostEvent>(RENDERER_HOST_EVENT, {
        detail: event,
      }),
    );
  }
}

function emitRendererCompatibilityEvents(events: RendererHostEvent[]): void {
  for (const event of events) {
    emitRendererHostEvent(event);
  }
}

electron.ipcRenderer.on(IPC_CHANNELS.hostEvent, (_event, payload) => {
  for (const listener of listeners) {
    listener(payload);
  }

  if (typeof window !== 'undefined') {
    dispatchDesktopHostEvent(window, payload);
  }

  if (payload.type === 'desktop.renderer.event') {
    emitRendererHostEvent(payload.event);
    return;
  }

  if (payload.type === 'desktop.sessions.updated') {
    emitRendererCompatibilityEvents(
      buildRendererSessionUpdateEvents(rendererSessions, payload.sessions),
    );
    rendererSessions = payload.sessions;
  }
});

const api = createDesktopBridge({
  invoke(request: DesktopBridgeRequest): Promise<DesktopBridgeResponse> {
    return electron.ipcRenderer.invoke(IPC_CHANNELS.invoke, request);
  },
  subscribe(listener: (event: DesktopHostEvent) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
});

async function emitBootstrapToRenderer(): Promise<void> {
  const response = await api.invoke({ type: 'desktop.bootstrap' });
  if (response.type !== 'desktop.bootstrap.result') {
    return;
  }

  rendererSessions = response.payload.sessions;
  emitRendererCompatibilityEvents(buildRendererBootstrapEvents(rendererSessions));
  await api.invoke({ type: 'desktop.monitor.start' });
}

const rendererHostApi: RendererHostApi = {
  features: rendererHostFeatures,
  postMessage(message: RendererHostCommand): void {
    switch (message.type) {
      case 'webviewReady':
        void emitBootstrapToRenderer();
        return;
      case 'requestDiagnostics':
        emitRendererHostEvent({
          type: 'agentDiagnostics',
          agents: buildRendererDiagnostics(rendererSessions),
        });
        return;
      case 'setSoundEnabled':
      case 'setLastSeenVersion':
      case 'saveLayout':
      case 'saveAgentSeats':
        return;
      default:
        console.warn(
          `[Pixel Agents Desktop] Unsupported shared renderer command in scaffold: ${message.type}`,
        );
    }
  },
  subscribe(listener: (message: RendererHostEvent) => void): () => void {
    rendererHostListeners.add(listener);
    return () => {
      rendererHostListeners.delete(listener);
    };
  },
};

electron.contextBridge.exposeInMainWorld(DESKTOP_BRIDGE_NAME, api);
electron.contextBridge.exposeInMainWorld(RENDERER_HOST_BRIDGE_NAME, rendererHostApi);
