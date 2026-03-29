export const DESKTOP_BRIDGE_NAME = 'pixelAgentsDesktop';
export const DESKTOP_HOST_EVENT = 'pixel-agents-desktop:host-event';

export const IPC_CHANNELS = {
  invoke: 'pixel-agents-desktop:invoke',
  hostEvent: 'pixel-agents-desktop:host-event',
} as const;

export type DesktopAgentKind = 'claude' | 'codex';
export type DesktopSessionStatus = 'discovered' | 'watching' | 'stale' | 'unknown';

export interface DesktopHostFeatures {
  launchSessions: false;
  focusSessions: false;
  closeSessions: false;
  attachToIdeWindow: false;
  sharedRendererBridge: 'pending';
  readOnlyMonitor: true;
  supportedAgents: readonly DesktopAgentKind[];
}

export interface DesktopMonitorSession {
  id: string;
  agentKind: DesktopAgentKind;
  label: string;
  transcriptPath: string;
  workspacePath?: string;
  lastSeenAt?: string;
  status: DesktopSessionStatus;
  readOnly: true;
}

export interface DesktopDiagnostics {
  generatedAt: string;
  monitorRunning: boolean;
  watchRoots: Partial<Record<DesktopAgentKind, string[]>>;
  notes: string[];
}

export interface DesktopBootstrapPayload {
  runtime: 'desktop';
  mode: 'read-only-monitor';
  features: DesktopHostFeatures;
  sessions: DesktopMonitorSession[];
  diagnostics: DesktopDiagnostics;
  notes: string[];
}

export type DesktopBridgeRequest =
  | { type: 'desktop.bootstrap' }
  | { type: 'desktop.monitor.start' }
  | { type: 'desktop.monitor.stop' }
  | { type: 'desktop.sessions.list' }
  | { type: 'desktop.diagnostics.get' };

export type DesktopBridgeResponse =
  | { type: 'desktop.bootstrap.result'; payload: DesktopBootstrapPayload }
  | { type: 'desktop.monitor.state'; running: boolean }
  | { type: 'desktop.sessions.result'; sessions: DesktopMonitorSession[] }
  | { type: 'desktop.diagnostics.result'; payload: DesktopDiagnostics };

export type DesktopHostEvent =
  | { type: 'desktop.monitor.state-changed'; running: boolean }
  | { type: 'desktop.sessions.updated'; sessions: DesktopMonitorSession[] }
  | { type: 'desktop.diagnostics.updated'; payload: DesktopDiagnostics };

export interface DesktopBridgeApi {
  invoke(request: DesktopBridgeRequest): Promise<DesktopBridgeResponse>;
  onHostEvent(listener: (event: DesktopHostEvent) => void): () => void;
}

export interface DesktopBridgeHooks {
  invoke(request: DesktopBridgeRequest): Promise<DesktopBridgeResponse>;
  subscribe(listener: (event: DesktopHostEvent) => void): () => void;
}

export const READ_ONLY_MONITOR_FEATURES: DesktopHostFeatures = {
  launchSessions: false,
  focusSessions: false,
  closeSessions: false,
  attachToIdeWindow: false,
  sharedRendererBridge: 'pending',
  readOnlyMonitor: true,
  supportedAgents: ['claude', 'codex'],
};

export function createDesktopBridge(hooks: DesktopBridgeHooks): DesktopBridgeApi {
  return {
    invoke: hooks.invoke,
    onHostEvent: hooks.subscribe,
  };
}

export function dispatchDesktopHostEvent(target: EventTarget, event: DesktopHostEvent): void {
  target.dispatchEvent(
    new CustomEvent<DesktopHostEvent>(DESKTOP_HOST_EVENT, {
      detail: event,
    }),
  );
}

export function createDesktopBootstrapPayload(options?: {
  sessions?: DesktopMonitorSession[];
  monitorRunning?: boolean;
  watchRoots?: Partial<Record<DesktopAgentKind, string[]>>;
  notes?: string[];
  diagnosticNotes?: string[];
}): DesktopBootstrapPayload {
  const sessions = options?.sessions ?? [];
  const monitorRunning = options?.monitorRunning ?? false;
  const watchRoots = options?.watchRoots ?? {};

  return {
    runtime: 'desktop',
    mode: 'read-only-monitor',
    features: READ_ONLY_MONITOR_FEATURES,
    sessions,
    diagnostics: {
      generatedAt: new Date().toISOString(),
      monitorRunning,
      watchRoots,
      notes: options?.diagnosticNotes ?? [
        'No filesystem monitor is wired yet.',
        'Claude and Codex adapters should plug in here without changing the renderer contract.',
      ],
    },
    notes: options?.notes ?? [
      'This scaffold intentionally does not create, close, or focus Claude/Codex sessions.',
      'Future work should reuse this bridge from the desktop renderer adapter instead of reaching Electron APIs directly.',
    ],
  };
}
