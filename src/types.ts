export const DEFAULT_TILE_SIZE = 32;

export interface Tile {
  x: number;
  y: number;
  slot: string;
}

export interface AutoTile {
  autoTileIndex: number;
}

export type CellValue = Tile | AutoTile | null;

export function isAutoTile(cell: CellValue): cell is AutoTile {
  return cell !== null && 'autoTileIndex' in cell;
}

export function isRegularTile(cell: CellValue): cell is Tile {
  return cell !== null && 'slot' in cell;
}

export type TileLayer = CellValue[][];

export interface LayerMeta {
  name: string;
  visible: boolean;
}

export type Direction = 'down' | 'up' | 'right' | 'left';

export interface InteractiveObject {
  id: string;
  x: number; // grid x
  y: number; // grid y
  type: string;
  direction: Direction;
  properties?: Record<string, unknown>;
}

export const OBJECT_TYPES = [
  { value: 'door', label: 'Door', emoji: '\uD83D\uDEAA' },
  { value: 'door_agent', label: 'Door (Agent)', emoji: '\uD83E\uDDD1\u200D\uD83D\uDCBB' },
  { value: 'computer', label: 'Computer', emoji: '\uD83D\uDCBB' },
  { value: 'books', label: 'Books', emoji: '\uD83D\uDCDA' },
  { value: 'coffee', label: 'Coffee Machine', emoji: '\u2615' },
  { value: 'plant', label: 'Plant', emoji: '\uD83C\uDF31' },
  { value: 'desk', label: 'Desk', emoji: '\uD83D\uDECB\uFE0F' },
  { value: 'chair', label: 'Chair', emoji: '\uD83E\uDE91' },
] as const;

export const DOOR_TYPES = new Set(['door', 'door_agent']);

export interface SpawnPoint {
  id: string;
  x: number; // grid x
  y: number; // grid y
}

export interface MapData {
  width: number; // in tiles
  height: number; // in tiles
  tileSize?: number; // pixels per tile (default 32)
  layers: TileLayer[];
  layerMeta?: LayerMeta[];
  objects: InteractiveObject[];
  collisionGrid?: boolean[][]; // per-cell blocked flag (true = blocked)
  spawnPoints?: SpawnPoint[];
  tileDepthMaps?: Record<string, DepthMap>; // slot -> DepthMap
  tileCollisionMaps?: Record<string, TileCollisionMap>;
  tileInteractiveMaps?: Record<string, TileInteractiveMap>;
}

export type TileDepth = -1 | 0 | 1 | 2;
export type DepthMap = Record<string, TileDepth>; // "x,y" -> depth
export type TileCollisionMap = Record<string, boolean>; // "x,y" -> blocked

export interface TileInteractiveDef {
  type: string;
  direction: Direction;
}
export type TileInteractiveMap = Record<string, TileInteractiveDef>;

export type ToolType = 'pen' | 'eraser' | 'fill' | 'select' | 'move' | 'spawn' | 'pick';

export interface Selection {
  x: number;
  y: number;
  width: number;
  height: number;
  tiles: CellValue[][];
}
