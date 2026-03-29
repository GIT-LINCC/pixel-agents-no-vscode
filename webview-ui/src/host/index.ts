import { getDesktopHost, getRuntime } from '../runtime.js';
import type { HostBridge } from './bridge.js';
import type { DesktopHostApi } from './contracts.js';
import { createBrowserHostBridge } from './providers/browser.js';
import { createDesktopHostBridge } from './providers/desktop.js';
import { createVsCodeHostBridge } from './providers/vscode.js';

export function createHostBridgeForRuntime(
  currentRuntime: ReturnType<typeof getRuntime>,
  desktopHost?: DesktopHostApi,
): HostBridge {
  if (currentRuntime === 'desktop' && desktopHost) {
    return createDesktopHostBridge(desktopHost);
  }

  if (currentRuntime === 'vscode') {
    return createVsCodeHostBridge();
  }

  return createBrowserHostBridge();
}

function resolveHostBridge(): HostBridge {
  return createHostBridgeForRuntime(getRuntime(), getDesktopHost());
}

export const hostBridge: HostBridge = {
  get runtime() {
    return resolveHostBridge().runtime;
  },
  get features() {
    return resolveHostBridge().features;
  },
  postMessage(message) {
    resolveHostBridge().postMessage(message);
  },
  subscribe(listener) {
    return resolveHostBridge().subscribe(listener);
  },
};
