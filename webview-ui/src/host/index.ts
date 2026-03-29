import { runtime } from '../runtime.js';
import type { HostBridge } from './bridge.js';
import type { DesktopHostApi } from './contracts.js';
import { createBrowserHostBridge } from './providers/browser.js';
import { createDesktopHostBridge } from './providers/desktop.js';
import { createVsCodeHostBridge } from './providers/vscode.js';

function getDesktopHost(): DesktopHostApi | undefined {
  return (globalThis as typeof globalThis & { window?: { pixelAgentsHost?: DesktopHostApi } })
    .window?.pixelAgentsHost;
}

export function createHostBridgeForRuntime(
  currentRuntime: typeof runtime,
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

export const hostBridge = createHostBridgeForRuntime(runtime, getDesktopHost());
