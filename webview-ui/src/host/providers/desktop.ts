import { createHostBridge, type HostBridge } from '../bridge.js';
import {
  DESKTOP_MONITOR_HOST_FEATURES,
  type DesktopHostApi,
  type HostCommand,
  mergeHostFeatures,
} from '../contracts.js';
import { getWindowHostEventSource, subscribeToWindowHostEvents } from '../windowEvents.js';

declare global {
  interface Window {
    pixelAgentsHost?: DesktopHostApi;
  }
}

export function createDesktopHostBridge(hostApi: DesktopHostApi): HostBridge {
  return createHostBridge({
    runtime: 'desktop',
    features: mergeHostFeatures({
      ...DESKTOP_MONITOR_HOST_FEATURES,
      ...hostApi.features,
    }),
    postMessage(message: HostCommand) {
      hostApi.postMessage(message);
    },
    subscribe(listener) {
      if (typeof hostApi.subscribe === 'function') {
        const unsubscribe = hostApi.subscribe(listener);
        return typeof unsubscribe === 'function' ? unsubscribe : () => undefined;
      }
      return subscribeToWindowHostEvents(getWindowHostEventSource(), listener);
    },
  });
}
