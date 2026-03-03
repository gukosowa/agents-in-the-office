import type { CellValue, TileLayer } from '../types';
import { isAutoTile } from '../types';

/**
 * RMXP-style autotile engine.
 *
 * An RMXP autotile sheet is a 6×8 grid of half-tiles (tileSize*3 wide,
 * tileSize*4 tall). Each full tile is composed of 4 quadrants (TL, TR,
 * BL, BR), each picked independently from the grid based on the 8
 * surrounding neighbors.
 *
 * Positions are 1-indexed (1–48) in row-major order:
 *   Row 0: 1  2  3  4  5  6
 *   Row 1: 7  8  9 10 11 12
 *   ...
 *   Row 7: 43 44 45 46 47 48
 *
 * The sheet layout (2×2 half-tile blocks):
 *         Cols 0-1      Cols 2-3      Cols 4-5
 * Rows 0-1: (unused)     (unused)     InnerCorners [C]
 * Rows 2-3: NW corner[D] Top edge[E]  NE corner [F]
 * Rows 4-5: Left edge[G] Interior[H]  Right edge[I]
 * Rows 6-7: SW corner[J] Bot edge[K]  SE corner [L]
 */

export interface NeighborFlags {
  n: boolean;
  ne: boolean;
  e: boolean;
  se: boolean;
  s: boolean;
  sw: boolean;
  w: boolean;
  nw: boolean;
}

// 48-entry construction table. Each entry is [TL, TR, BL, BR]
// sub-tile positions (1-indexed) in the 6×8 half-tile grid.
export const AUTOTILE_CONSTRUCTION: readonly (
  readonly [number, number, number, number]
)[] = [
  [27, 28, 33, 34], [5, 28, 33, 34],
  [27, 6, 33, 34], [5, 6, 33, 34],
  [27, 28, 33, 12], [5, 28, 33, 12],
  [27, 6, 33, 12], [5, 6, 33, 12],
  [27, 28, 11, 34], [5, 28, 11, 34],
  [27, 6, 11, 34], [5, 6, 11, 34],
  [27, 28, 11, 12], [5, 28, 11, 12],
  [27, 6, 11, 12], [5, 6, 11, 12],
  [25, 26, 31, 32], [25, 6, 31, 32],
  [25, 26, 31, 12], [25, 6, 31, 12],
  [15, 16, 21, 22], [15, 16, 21, 12],
  [15, 16, 11, 22], [15, 16, 11, 12],
  [29, 30, 35, 36], [29, 30, 11, 36],
  [5, 30, 35, 36], [5, 30, 11, 36],
  [39, 40, 45, 46], [5, 40, 45, 46],
  [39, 6, 45, 46], [5, 6, 45, 46],
  [25, 30, 31, 36], [15, 16, 45, 46],
  [13, 14, 19, 20], [13, 14, 19, 12],
  [17, 18, 23, 24], [17, 18, 11, 24],
  [41, 42, 47, 48], [5, 42, 47, 48],
  [37, 38, 43, 44], [37, 6, 43, 44],
  [13, 18, 19, 24], [13, 14, 43, 44],
  [37, 42, 43, 48], [25, 26, 45, 46],
  [25, 30, 45, 46], [25, 30, 31, 36],
];

/*
 * Per-quadrant sub-tile selection.
 *
 * Each quadrant depends on its 2 adjacent cardinal neighbors and
 * the diagonal between them. The sub-tile is chosen from the
 * block in the sheet that matches the quadrant's edge state.
 *
 * Block positions (TL of each 2×2 block):
 *   C=5  D=13 E=15 F=17 G=25 H=27 I=29 J=37 K=39 L=41
 */

function tlSubTile(
  n: boolean, w: boolean, nw: boolean,
): number {
  if (n && w && nw) return 27;
  if (n && w) return 5;
  if (n) return 25;
  if (w) return 15;
  return 13;
}

function trSubTile(
  n: boolean, e: boolean, ne: boolean,
): number {
  if (n && e && ne) return 28;
  if (n && e) return 6;
  if (n) return 30;
  if (e) return 16;
  return 18;
}

function blSubTile(
  s: boolean, w: boolean, sw: boolean,
): number {
  if (s && w && sw) return 33;
  if (s && w) return 11;
  if (s) return 31;
  if (w) return 45;
  return 43;
}

function brSubTile(
  s: boolean, e: boolean, se: boolean,
): number {
  if (s && e && se) return 34;
  if (s && e) return 12;
  if (s) return 36;
  if (e) return 46;
  return 48;
}

/**
 * Compute the 4 sub-tile positions for an autotile cell.
 * Returns [TL, TR, BL, BR] as 1-indexed positions in
 * the 6×8 half-tile grid.
 */
export function computeAutoTileVariant(
  neighbors: NeighborFlags,
): [number, number, number, number] {
  return [
    tlSubTile(neighbors.n, neighbors.w, neighbors.nw),
    trSubTile(neighbors.n, neighbors.e, neighbors.ne),
    blSubTile(neighbors.s, neighbors.w, neighbors.sw),
    brSubTile(neighbors.s, neighbors.e, neighbors.se),
  ];
}

/**
 * Convert a 1-indexed sub-tile position to pixel coordinates
 * in the autotile sheet.
 */
export function subTileToPixels(
  pos: number,
  halfTile: number,
): { srcX: number; srcY: number } {
  return {
    srcX: ((pos - 1) % 6) * halfTile,
    srcY: Math.floor((pos - 1) / 6) * halfTile,
  };
}

/**
 * Check whether a neighboring cell matches the given autotile
 * type. Out-of-bounds cells count as matching (edges connect).
 */
function neighborMatches(
  layer: TileLayer,
  nx: number,
  ny: number,
  width: number,
  height: number,
  autoTileIndex: number,
): boolean {
  if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
    return true;
  }
  const cell: CellValue = layer[ny]?.[nx] ?? null;
  return isAutoTile(cell)
    && cell.autoTileIndex === autoTileIndex;
}

/**
 * Build neighbor flags for an autotile cell by checking its
 * 8 surrounding cells in the layer.
 */
export function getNeighborFlags(
  layer: TileLayer,
  x: number,
  y: number,
  width: number,
  height: number,
  autoTileIndex: number,
): NeighborFlags {
  const m = (nx: number, ny: number) =>
    neighborMatches(layer, nx, ny, width, height, autoTileIndex);

  return {
    n: m(x, y - 1),
    ne: m(x + 1, y - 1),
    e: m(x + 1, y),
    se: m(x + 1, y + 1),
    s: m(x, y + 1),
    sw: m(x - 1, y + 1),
    w: m(x - 1, y),
    nw: m(x - 1, y - 1),
  };
}
