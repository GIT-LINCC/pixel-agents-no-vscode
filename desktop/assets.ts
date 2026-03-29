import * as fs from 'node:fs';
import * as path from 'node:path';

import { buildFurnitureCatalog } from '../shared/assets/build';
import {
  decodeAllCharacters,
  decodeAllFloors,
  decodeAllFurniture,
  decodeAllWalls,
} from '../shared/assets/loader';
import type { HostEvent } from '../shared/host/types';

export interface DesktopBootstrapAssets {
  assetEvents: HostEvent[];
  layout: unknown | null;
  assetsRoot: string | null;
}

interface DesktopBootstrapAssetOptions {
  assetsRoot?: string;
}

let cachedAssets:
  | {
      assetsRoot: string;
      payload: DesktopBootstrapAssets;
    }
  | undefined;

export function loadDesktopBootstrapAssets(
  options: DesktopBootstrapAssetOptions = {},
): DesktopBootstrapAssets {
  const assetsRoot = options.assetsRoot
    ? path.resolve(options.assetsRoot)
    : resolveDesktopAssetsRoot();
  if (!assetsRoot) {
    return { assetEvents: [], layout: null, assetsRoot: null };
  }

  if (cachedAssets?.assetsRoot === assetsRoot) {
    return cachedAssets.payload;
  }

  const characters = decodeAllCharacters(assetsRoot);
  const floors = decodeAllFloors(assetsRoot);
  const walls = decodeAllWalls(assetsRoot);
  const catalog = buildFurnitureCatalog(assetsRoot);
  const sprites = decodeAllFurniture(assetsRoot, catalog);
  const layout = loadDefaultLayoutFromAssetsRoot(assetsRoot);

  const payload: DesktopBootstrapAssets = {
    assetEvents: [
      { type: 'characterSpritesLoaded', characters },
      { type: 'floorTilesLoaded', sprites: floors },
      { type: 'wallTilesLoaded', sets: walls },
      { type: 'furnitureAssetsLoaded', catalog, sprites },
    ],
    layout,
    assetsRoot,
  };

  cachedAssets = {
    assetsRoot,
    payload,
  };

  return payload;
}

export function resolveDesktopAssetsRoot(searchStartDir: string = __dirname): string | null {
  const candidates = [
    path.resolve(searchStartDir, '../webview/assets'),
    path.resolve(searchStartDir, '../../webview-ui/public/assets'),
    path.resolve(process.cwd(), 'dist/webview/assets'),
    path.resolve(process.cwd(), 'webview-ui/public/assets'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'characters'))) {
      return candidate;
    }
  }

  return null;
}

function loadDefaultLayoutFromAssetsRoot(assetsRoot: string): unknown | null {
  const defaultLayoutFile = pickDefaultLayoutFile(assetsRoot);
  if (!defaultLayoutFile) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(path.join(assetsRoot, defaultLayoutFile), 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function pickDefaultLayoutFile(assetsRoot: string): string | null {
  let bestRevision = -1;
  let bestFile: string | null = null;

  for (const entry of fs.readdirSync(assetsRoot)) {
    const match = /^default-layout-(\d+)\.json$/u.exec(entry);
    if (!match) {
      continue;
    }

    const revision = Number.parseInt(match[1], 10);
    if (revision > bestRevision) {
      bestRevision = revision;
      bestFile = entry;
    }
  }

  if (bestFile) {
    return bestFile;
  }

  return fs.existsSync(path.join(assetsRoot, 'default-layout.json')) ? 'default-layout.json' : null;
}
