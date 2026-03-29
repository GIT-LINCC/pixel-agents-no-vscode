import { runtime } from '../runtime.js';
import type { HostBridge } from './bridge.js';
import { createBrowserHostBridge } from './providers/browser.js';
import { createDesktopHostBridge } from './providers/desktop.js';
import { createVsCodeHostBridge } from './providers/vscode.js';

function createDefaultHostBridge(): HostBridge {
  if (runtime === 'desktop' && window.pixelAgentsHost) {
    return createDesktopHostBridge(window.pixelAgentsHost);
  }

  if (runtime === 'vscode') {
    return createVsCodeHostBridge();
  }

  return createBrowserHostBridge();
}

export const hostBridge = createDefaultHostBridge();
