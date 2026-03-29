import {
  createDesktopBridge,
  DESKTOP_BRIDGE_NAME,
  dispatchDesktopHostEvent,
  IPC_CHANNELS,
  type DesktopBridgeApi,
  type DesktopBridgeRequest,
  type DesktopBridgeResponse,
  type DesktopHostEvent,
} from './bridge';

interface IpcRendererLike {
  invoke(channel: string, request: DesktopBridgeRequest): Promise<DesktopBridgeResponse>;
  on(channel: string, listener: (_event: unknown, payload: DesktopHostEvent) => void): void;
}

interface ContextBridgeLike {
  exposeInMainWorld(apiKey: string, api: DesktopBridgeApi): void;
}

interface ElectronPreloadModule {
  contextBridge: ContextBridgeLike;
  ipcRenderer: IpcRendererLike;
}

declare global {
  interface Window {
    pixelAgentsDesktop: DesktopBridgeApi;
  }
}

const electron = require('electron') as ElectronPreloadModule;
const listeners = new Set<(event: DesktopHostEvent) => void>();

electron.ipcRenderer.on(IPC_CHANNELS.hostEvent, (_event, payload) => {
  for (const listener of listeners) {
    listener(payload);
  }

  if (typeof window !== 'undefined') {
    dispatchDesktopHostEvent(window, payload);
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

electron.contextBridge.exposeInMainWorld(DESKTOP_BRIDGE_NAME, api);
