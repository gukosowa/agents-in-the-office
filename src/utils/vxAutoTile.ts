import type { NeighborFlags } from './rmxpAutoTile';

/**
 * VX Ace/MV-style (Type B) autotile engine.
 *
 * A Type B autotile sheet is a 4x6 grid of half-tiles (tileSize*2 wide,
 * tileSize*3 tall). Each full tile is composed of 4 quadrants (TL, TR,
 * BL, BR), each picked independently from the grid based on the 8
 * surrounding neighbors.
 *
 * Positions are 1-indexed (1-24) in row-major order:
 *   Row 0: 1  2  3  4
 *   Row 1: 5  6  7  8
 *   Row 2: 9 10 11 12
 *   Row 3: 13 14 15 16
 *   Row 4: 17 18 19 20
 *   Row 5: 21 22 23 24
 *
 * The sheet layout (per RPG Maker MZ FLOOR_AUTOTILE_TABLE):
 *         Cols 0-1        Cols 2-3
 * Rows 0-1: Preview        Inner corners
 * Rows 2-5: Bordered 2x2 rectangle (edges, corners, interior)
 *
 * The bottom 4×4 half-tiles form a bordered rectangle:
 *   9=OC_TL  10=TE_TR  11=TE_TL  12=OC_TR
 *  13=LE_BL  14=IN_BR  15=IN_BL  16=RE_BR
 *  17=LE_TL  18=IN_TR  19=IN_TL  20=RE_TR
 *  21=OC_BL  22=BE_BR  23=BE_BL  24=OC_BR
 * (OC=outer corner, TE/BE/LE/RE=edge, IN=interior)
 */

export const VX_FULL_VARIANT: [number, number, number, number] = [
  19, 18, 15, 14,
];

export const VX_UPPER_WALL_FULL: [number, number, number, number] = [
  2, 3, 6, 7,
];
export const VX_LOWER_WALL_FULL: [number, number, number, number] = [
  10, 11, 14, 15,
];

function tlSubTileB(
  n: boolean, w: boolean, nw: boolean,
): number {
  if (n && w && nw) return 19;
  if (n && w) return 3;
  if (n) return 17;
  if (w) return 11;
  return 9;
}

function trSubTileB(
  n: boolean, e: boolean, ne: boolean,
): number {
  if (n && e && ne) return 18;
  if (n && e) return 4;
  if (n) return 20;
  if (e) return 10;
  return 12;
}

function blSubTileB(
  s: boolean, w: boolean, sw: boolean,
): number {
  if (s && w && sw) return 15;
  if (s && w) return 7;
  if (s) return 13;
  if (w) return 23;
  return 21;
}

function brSubTileB(
  s: boolean, e: boolean, se: boolean,
): number {
  if (s && e && se) return 14;
  if (s && e) return 8;
  if (s) return 16;
  if (e) return 22;
  return 24;
}

/**
 * Compute the 4 sub-tile positions for a Type B autotile cell.
 * Returns [TL, TR, BL, BR] as 1-indexed positions in
 * the 4x6 half-tile grid.
 */
export function computeAutoTileVariantB(
  neighbors: NeighborFlags,
): [number, number, number, number] {
  return [
    tlSubTileB(neighbors.n, neighbors.w, neighbors.nw),
    trSubTileB(neighbors.n, neighbors.e, neighbors.ne),
    blSubTileB(neighbors.s, neighbors.w, neighbors.sw),
    brSubTileB(neighbors.s, neighbors.e, neighbors.se),
  ];
}

/**
 * Convert a 1-indexed sub-tile position to pixel coordinates
 * in the Type B autotile sheet (4 columns).
 */
export function subTileToPixelsB(
  pos: number,
  halfTile: number,
): { srcX: number; srcY: number } {
  return {
    srcX: ((pos - 1) % 4) * halfTile,
    srcY: Math.floor((pos - 1) / 4) * halfTile,
  };
}

// ── Type C wall face (cardinal-only) ──
//
// The wall portion of a Type C sheet is a 4×4 half-tile grid
// (rows 6-9 of the full sheet). The wall renders as TWO tiles
// tall: an upper tile at y+1 and a lower tile at y+2.
//
// Sheet layout (conventional edge/interior grid):
//   Col 0: left edge    Col 1-2: interior    Col 3: right edge
//   Row 0: top edge     Row 1-2: interior    Row 3: bottom edge
//
// Neighbor semantics: a present neighbor means the wall
// continues in that direction, so that side shows INTERIOR.
// An absent neighbor means this tile IS the edge.

export interface WallVariants {
  upper: [number, number, number, number];
  lower: [number, number, number, number];
}

/**
 * Compute wall-face sub-tile positions for a Type C autotile.
 * Only east/west neighbors affect the wall: they determine
 * left/right edge vs interior columns. The vertical edges
 * (top row 0, bottom row 3) are always present because the
 * wall cap above and the floor below are separate tiles.
 */
export function computeWallVariants(
  neighbors: NeighborFlags,
): WallVariants {
  const { e, w } = neighbors;
  const colL = w ? 1 : 0;
  const colR = e ? 2 : 3;

  return {
    upper: [
      0 * 4 + colL + 1,
      0 * 4 + colR + 1,
      1 * 4 + colL + 1,
      1 * 4 + colR + 1,
    ],
    lower: [
      2 * 4 + colL + 1,
      2 * 4 + colR + 1,
      3 * 4 + colL + 1,
      3 * 4 + colR + 1,
    ],
  };
}

/**
 * Convert a 1-indexed wall sub-tile position to pixel
 * coordinates in a Type C sheet. The wall portion starts
 * at row 6 (Y offset = halfTile * 6).
 */
export function wallSubTileToPixels(
  pos: number,
  halfTile: number,
): { srcX: number; srcY: number } {
  return {
    srcX: ((pos - 1) % 4) * halfTile,
    srcY: Math.floor((pos - 1) / 4) * halfTile + halfTile * 6,
  };
}
