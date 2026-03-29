import { createHostBridge, type HostBridge } from '../bridge.js';
import { DEFAULT_HOST_FEATURES, type HostCommand } from '../contracts.js';
import { getWindowHostEventSource, subscribeToWindowHostEvents } from '../windowEvents.js';

declare function acquireVsCodeApi(): { postMessage(message: HostCommand): void };

export function createVsCodeHostBridge(): HostBridge {
  const vscodeApi = acquireVsCodeApi();

  return createHostBridge({
    runtime: 'vscode',
    features: DEFAULT_HOST_FEATURES,
    postMessage(message: HostCommand) {
      vscodeApi.postMessage(message);
    },
    subscribe(listener) {
      return subscribeToWindowHostEvents(getWindowHostEventSource(), listener);
    },
  });
}
