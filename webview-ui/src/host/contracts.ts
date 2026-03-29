import type {
  DesktopHostApi,
  HostCommand,
  HostEvent,
  HostFeatures,
  HostRuntime,
} from '../../../shared/host/types.ts';

export type { DesktopHostApi, HostCommand, HostEvent, HostFeatures, HostRuntime };

export const HOST_MESSAGE_EVENT = 'pixel-agents:host-message';

export const DEFAULT_HOST_FEATURES: HostFeatures = {
  launchAgents: true,
  focusAgents: true,
  closeAgents: true,
  diagnostics: true,
  openSessionsFolder: true,
  importExportLayout: true,
  externalAssets: true,
};

export const BROWSER_HOST_FEATURES: HostFeatures = {
  launchAgents: false,
  focusAgents: false,
  closeAgents: false,
  diagnostics: false,
  openSessionsFolder: false,
  importExportLayout: false,
  externalAssets: false,
};

export const DESKTOP_MONITOR_HOST_FEATURES: HostFeatures = {
  ...DEFAULT_HOST_FEATURES,
  launchAgents: false,
  focusAgents: false,
  closeAgents: false,
};

export function mergeHostFeatures(overrides?: Partial<HostFeatures>): HostFeatures {
  return {
    ...DEFAULT_HOST_FEATURES,
    ...overrides,
  };
}
