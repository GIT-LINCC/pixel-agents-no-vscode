import type {
  HostCommand,
  HostEvent,
  HostFeatures,
  HostRuntime,
} from '../../../shared/host/types.ts';

export interface HostBridge {
  runtime: HostRuntime;
  features: HostFeatures;
  postMessage(message: HostCommand): void;
  subscribe(listener: (message: HostEvent) => void): () => void;
}

export interface HostBridgeOptions {
  runtime: HostRuntime;
  features: HostFeatures;
  postMessage(message: HostCommand): void;
  subscribe(listener: (message: HostEvent) => void): () => void;
}

export function createHostBridge(options: HostBridgeOptions): HostBridge {
  return {
    runtime: options.runtime,
    features: Object.freeze({ ...options.features }),
    postMessage(message) {
      options.postMessage(message);
    },
    subscribe(listener) {
      return options.subscribe(listener);
    },
  };
}
