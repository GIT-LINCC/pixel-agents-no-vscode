import { createHostBridge, type HostBridge } from '../bridge.js';
import { BROWSER_HOST_FEATURES, type HostCommand } from '../contracts.js';
import { subscribeToWindowHostEvents } from '../windowEvents.js';

export function createBrowserHostBridge(): HostBridge {
  return createHostBridge({
    runtime: 'browser',
    features: BROWSER_HOST_FEATURES,
    postMessage(message: HostCommand) {
      console.log('[pixel-agents/browser host command]', message);
    },
    subscribe(listener) {
      return subscribeToWindowHostEvents(window, listener);
    },
  });
}
