import { save, open } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import type {
  MapData, DepthMap, TileCollisionMap,
} from '../types';
import type { AutoTileType } from '../stores/mapStore';
import type {
  CharacterDefinition,
  SpriteLayoutType,
  SpriteRegion,
  ActionDefinition,
} from '../types/character';

interface AutoTilePoolEntry {
  blob: string;
  type: AutoTileType;
  depthMap?: DepthMap;
  collisionMap?: TileCollisionMap;
  sourceBlob?: string;
  sourceCol?: number;
  sourceRow?: number;
}

export interface SerializedCharacterDefinition {
  id: string;
  name: string;
  spriteBlob: string;
  cellWidth: number;
  cellHeight: number;
  layoutType: SpriteLayoutType;
  baseRegion: SpriteRegion;
  actions: ActionDefinition[];
  scale: number;
  isSubagent?: boolean;
}

interface AitoFile {
  version: 1;
  mapData: MapData;
  tilesetPool?: Record<string, string | null>;
  autoTilePool?: (string | AutoTilePoolEntry | null)[];
  characterDefinitions?: SerializedCharacterDefinition[];
}

function isTauri(): boolean {
  return typeof window !== 'undefined'
    && '__TAURI_INTERNALS__' in window;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToBlob(
  base64: string,
  type = 'image/png',
): Blob {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    arr[i] = bytes.charCodeAt(i);
  }
  return new Blob([arr], { type });
}

export interface AutoTileEntry {
  blob: Blob | null;
  type: AutoTileType;
  depthMap?: DepthMap;
  collisionMap?: TileCollisionMap;
  sourceBlob?: Blob;
  sourceCol?: number;
  sourceRow?: number;
}

export async function saveMapToFile(
  mapData: MapData,
  poolBlobs: Record<string, Blob | null>,
  autoTileEntries: AutoTileEntry[],
  targetPath?: string,
  characterDefinitions?: CharacterDefinition[],
): Promise<string | null> {
  const json = await serializeMapToJson(
    mapData, poolBlobs, autoTileEntries, characterDefinitions,
  );

  if (isTauri()) {
    const filePath = targetPath ?? await save({
      filters: [{ name: 'AITO Map', extensions: ['aito'] }],
      defaultPath: 'map.aito',
    });
    if (!filePath) return null;
    await writeTextFile(filePath, json);
    return filePath;
  }

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'map.aito';
  a.click();
  URL.revokeObjectURL(url);
  return 'map.aito';
}

export async function serializeMapToJson(
  mapData: MapData,
  poolBlobs: Record<string, Blob | null>,
  autoTileEntries: AutoTileEntry[],
  characterDefinitions?: CharacterDefinition[],
): Promise<string> {
  const tilesetPool: Record<string, string | null> = {};
  for (const [slot, blob] of Object.entries(poolBlobs)) {
    tilesetPool[slot] = blob ? await blobToBase64(blob) : null;
  }

  const autoTilePool: (AutoTilePoolEntry | null)[] = [];
  for (const entry of autoTileEntries) {
    if (entry.blob) {
      autoTilePool.push({
        blob: await blobToBase64(entry.blob),
        type: entry.type,
        depthMap: entry.depthMap,
        collisionMap: entry.collisionMap,
        sourceBlob: entry.sourceBlob
          ? await blobToBase64(entry.sourceBlob)
          : undefined,
        sourceCol: entry.sourceCol,
        sourceRow: entry.sourceRow,
      });
    } else {
      autoTilePool.push(null);
    }
  }

  let serializedChars: SerializedCharacterDefinition[] | undefined;
  if (characterDefinitions && characterDefinitions.length > 0) {
    serializedChars = [];
    for (const def of characterDefinitions) {
      serializedChars.push({
        id: def.id,
        name: def.name,
        spriteBlob: await blobToBase64(def.spriteBlob),
        cellWidth: def.cellWidth,
        cellHeight: def.cellHeight,
        layoutType: def.layoutType,
        baseRegion: def.baseRegion,
        actions: def.actions,
        scale: def.scale,
        ...(def.isSubagent ? { isSubagent: true } : {}),
      });
    }
  }

  const file: AitoFile = {
    version: 1,
    mapData,
    tilesetPool,
    autoTilePool,
    characterDefinitions: serializedChars,
  };

  return JSON.stringify(file);
}

export const AITO_FILE_PATH_KEY = 'aito-file-path';

export interface LoadedMap {
  mapData: MapData;
  poolBlobs: Record<string, Blob | null>;
  autoTileEntries: AutoTileEntry[];
  characterDefinitions?: CharacterDefinition[];
}

export interface LoadedMapWithPath extends LoadedMap {
  filePath: string;
}

export async function loadMapFromPath(
  path: string,
): Promise<LoadedMap> {
  const content = await readTextFile(path);
  return deserializeMapFromJson(content);
}

export async function saveMapToPath(
  path: string,
  mapData: MapData,
  poolBlobs: Record<string, Blob | null>,
  autoTileEntries: AutoTileEntry[],
  characterDefinitions?: CharacterDefinition[],
): Promise<void> {
  const json = await serializeMapToJson(
    mapData, poolBlobs, autoTileEntries, characterDefinitions,
  );
  await writeTextFile(path, json);
}

export async function loadMapFromFile():
  Promise<LoadedMapWithPath | null> {
  if (isTauri()) {
    const filePath = await open({
      filters: [{ name: 'AITO Map', extensions: ['aito'] }],
      multiple: false,
    });
    if (!filePath) return null;
    const content = await readTextFile(filePath as string);
    return {
      ...deserializeMapFromJson(content),
      filePath: filePath as string,
    };
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.aito';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const content = await file.text();
      resolve({
        ...deserializeMapFromJson(content),
        filePath: file.name,
      });
    };
    input.click();
  });
}

export function migrateObjects(data: MapData): void {
  for (const obj of data.objects) {
    const raw = obj as unknown as Record<string, unknown>;
    if (!raw['direction']) {
      raw['direction'] = 'down';
    }
    delete raw['tile'];
  }
}

export function deserializeMapFromJson(
  json: string,
): LoadedMap {
  const file = JSON.parse(json) as AitoFile;
  migrateObjects(file.mapData);

  const poolBlobs: Record<string, Blob | null> = {};

  if (file.tilesetPool) {
    for (
      const [slot, b64] of Object.entries(file.tilesetPool)
    ) {
      poolBlobs[slot] = b64 ? base64ToBlob(b64) : null;
    }
  }

  const autoTileEntries: AutoTileEntry[] = [];
  if (file.autoTilePool) {
    for (const entry of file.autoTilePool) {
      if (entry === null) {
        autoTileEntries.push({ blob: null, type: 'A' });
      } else if (typeof entry === 'string') {
        autoTileEntries.push({
          blob: base64ToBlob(entry),
          type: 'A',
        });
      } else {
        autoTileEntries.push({
          blob: base64ToBlob(entry.blob),
          type: entry.type,
          depthMap: entry.depthMap,
          collisionMap: entry.collisionMap,
          sourceBlob: entry.sourceBlob
            ? base64ToBlob(entry.sourceBlob)
            : undefined,
          sourceCol: entry.sourceCol,
          sourceRow: entry.sourceRow,
        });
      }
    }
  }

  let characterDefinitions: CharacterDefinition[] | undefined;
  if (file.characterDefinitions && file.characterDefinitions.length > 0) {
    characterDefinitions = file.characterDefinitions.map((s) => ({
      id: s.id,
      name: s.name,
      spriteBlob: base64ToBlob(s.spriteBlob),
      cellWidth: s.cellWidth,
      cellHeight: s.cellHeight,
      layoutType: s.layoutType,
      baseRegion: s.baseRegion,
      actions: s.actions,
      scale: s.scale ?? 1,
      isSubagent: s.isSubagent ?? false,
    }));
  }

  return {
    mapData: file.mapData,
    poolBlobs,
    autoTileEntries,
    characterDefinitions,
  };
}
