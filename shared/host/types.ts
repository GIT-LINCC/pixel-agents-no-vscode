import type { CharacterDirectionSprites } from '../assets/types.js';

export type HostRuntime = 'vscode' | 'desktop' | 'browser';

export interface HostFeatures {
  launchAgents: boolean;
  focusAgents: boolean;
  closeAgents: boolean;
  diagnostics: boolean;
  openSessionsFolder: boolean;
  importExportLayout: boolean;
  externalAssets: boolean;
}

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

export interface SavedAgentSeat {
  palette: number;
  hueShift?: number;
  seatId: string | null;
}

export interface ExistingAgentMeta {
  palette?: number;
  hueShift?: number;
  seatId?: string;
}

export interface WorkspaceFolderInfo {
  name: string;
  path: string;
}

export interface AgentDiagnostics {
  id: number;
  projectDir: string;
  projectDirExists: boolean;
  jsonlFile: string;
  jsonlExists: boolean;
  fileSize: number;
  fileOffset: number;
  lastDataAt: number;
  linesProcessed: number;
}

export interface FurnitureCatalogItem {
  id: string;
  label: string;
  category: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  name?: string;
  groupId?: string;
  canPlaceOnWalls?: boolean;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  orientation?: string;
  state?: string;
  mirrorSide?: boolean;
  rotationScheme?: string;
  animationGroup?: string;
  frame?: number;
}

export interface DesktopHostApi {
  runtime?: 'desktop';
  features?: Partial<HostFeatures>;
  postMessage(message: HostCommand): void;
  subscribe?(listener: (message: HostEvent) => void): (() => void) | void;
}

export const HOST_MESSAGE_EVENT = 'pixel-agents:host-message';

export type HostCommand =
  | { type: 'launchAgent'; folderPath?: string; bypassPermissions?: boolean }
  | { type: 'focusAgent'; id: number }
  | { type: 'closeAgent'; id: number }
  | { type: 'saveAgentSeats'; seats: Record<number, SavedAgentSeat> }
  | { type: 'saveLayout'; layout: unknown }
  | { type: 'setSoundEnabled'; enabled: boolean }
  | { type: 'setLastSeenVersion'; version: string }
  | { type: 'webviewReady' }
  | { type: 'requestDiagnostics' }
  | { type: 'openSessionsFolder' }
  | { type: 'exportLayout' }
  | { type: 'importLayout' }
  | { type: 'addExternalAssetDirectory' }
  | { type: 'removeExternalAssetDirectory'; path: string };

export type HostEvent =
  | { type: 'layoutLoaded'; layout: unknown; wasReset?: boolean }
  | { type: 'agentCreated'; id: number; folderName?: string }
  | { type: 'agentClosed'; id: number }
  | {
      type: 'existingAgents';
      agents: number[];
      agentMeta?: Record<number, ExistingAgentMeta>;
      folderNames?: Record<number, string>;
    }
  | { type: 'agentSelected'; id: number }
  | { type: 'agentToolStart'; id: number; toolId: string; status: string }
  | { type: 'agentToolDone'; id: number; toolId: string }
  | { type: 'agentToolsClear'; id: number }
  | { type: 'agentStatus'; id: number; status: string }
  | { type: 'agentToolPermission'; id: number }
  | { type: 'subagentToolPermission'; id: number; parentToolId: string }
  | { type: 'agentToolPermissionClear'; id: number }
  | { type: 'subagentToolStart'; id: number; parentToolId: string; toolId: string; status: string }
  | { type: 'subagentToolDone'; id: number; parentToolId: string; toolId: string }
  | { type: 'subagentClear'; id: number; parentToolId: string }
  | { type: 'characterSpritesLoaded'; characters: CharacterDirectionSprites[] }
  | { type: 'floorTilesLoaded'; sprites: string[][][] }
  | { type: 'wallTilesLoaded'; sets: string[][][][] }
  | {
      type: 'furnitureAssetsLoaded';
      catalog: FurnitureCatalogItem[];
      sprites: Record<string, string[][]>;
    }
  | { type: 'workspaceFolders'; folders: WorkspaceFolderInfo[] }
  | {
      type: 'settingsLoaded';
      soundEnabled: boolean;
      externalAssetDirectories?: string[];
      lastSeenVersion?: string;
      extensionVersion?: string;
    }
  | { type: 'externalAssetDirectoriesUpdated'; dirs: string[] }
  | { type: 'agentDiagnostics'; agents: AgentDiagnostics[] };

const HOST_COMMAND_TYPES = [
  'launchAgent',
  'focusAgent',
  'closeAgent',
  'saveAgentSeats',
  'saveLayout',
  'setSoundEnabled',
  'setLastSeenVersion',
  'webviewReady',
  'requestDiagnostics',
  'openSessionsFolder',
  'exportLayout',
  'importLayout',
  'addExternalAssetDirectory',
  'removeExternalAssetDirectory',
] as const satisfies ReadonlyArray<HostCommand['type']>;

const HOST_EVENT_TYPES = [
  'layoutLoaded',
  'agentCreated',
  'agentClosed',
  'existingAgents',
  'agentSelected',
  'agentToolStart',
  'agentToolDone',
  'agentToolsClear',
  'agentStatus',
  'agentToolPermission',
  'subagentToolPermission',
  'agentToolPermissionClear',
  'subagentToolStart',
  'subagentToolDone',
  'subagentClear',
  'characterSpritesLoaded',
  'floorTilesLoaded',
  'wallTilesLoaded',
  'furnitureAssetsLoaded',
  'workspaceFolders',
  'settingsLoaded',
  'externalAssetDirectoriesUpdated',
  'agentDiagnostics',
] as const satisfies ReadonlyArray<HostEvent['type']>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasKnownType<T extends string>(
  value: unknown,
  allowedTypes: readonly T[],
): value is { type: T } & Record<string, unknown> {
  return (
    isRecord(value) && typeof value.type === 'string' && allowedTypes.includes(value.type as T)
  );
}

export function normalizeHostCommand(value: unknown): HostCommand | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null;
  }

  if (value.type === 'openClaude') {
    return {
      type: 'launchAgent',
      folderPath: typeof value.folderPath === 'string' ? value.folderPath : undefined,
      bypassPermissions:
        typeof value.bypassPermissions === 'boolean' ? value.bypassPermissions : undefined,
    };
  }

  if (!hasKnownType(value, HOST_COMMAND_TYPES)) {
    return null;
  }

  return value as HostCommand;
}

export function isHostCommand(value: unknown): value is HostCommand {
  return normalizeHostCommand(value) !== null;
}

export function isHostEvent(value: unknown): value is HostEvent {
  return hasKnownType(value, HOST_EVENT_TYPES);
}
