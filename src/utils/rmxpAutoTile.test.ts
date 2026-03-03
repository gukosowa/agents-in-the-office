import { describe, it, expect } from 'vitest';
import {
  computeAutoTileVariant,
  getNeighborFlags,
  subTileToPixels,
  AUTOTILE_CONSTRUCTION,
  type NeighborFlags,
} from './rmxpAutoTile';
import type { CellValue } from '../types';

function flags(overrides: Partial<NeighborFlags> = {}): NeighborFlags {
  return {
    n: false, ne: false, e: false, se: false,
    s: false, sw: false, w: false, nw: false,
    ...overrides,
  };
}

function allTrue(): NeighborFlags {
  return flags({
    n: true, ne: true, e: true, se: true,
    s: true, sw: true, w: true, nw: true,
  });
}

describe('AUTOTILE_CONSTRUCTION', () => {
  it('has 48 entries', () => {
    expect(AUTOTILE_CONSTRUCTION).toHaveLength(48);
  });

  it('all positions are between 1 and 48', () => {
    for (const entry of AUTOTILE_CONSTRUCTION) {
      for (const pos of entry) {
        expect(pos).toBeGreaterThanOrEqual(1);
        expect(pos).toBeLessThanOrEqual(48);
      }
    }
  });

  it('index 0 is the fully surrounded interior', () => {
    expect(AUTOTILE_CONSTRUCTION[0]).toEqual([27, 28, 33, 34]);
  });
});

describe('computeAutoTileVariant', () => {
  it('fully surrounded returns interior sub-tiles', () => {
    const result = computeAutoTileVariant(allTrue());
    expect(result).toEqual([27, 28, 33, 34]);
  });

  it('isolated tile (no neighbors) returns outer corners', () => {
    const result = computeAutoTileVariant(flags());
    // TL=13(D), TR=18(F), BL=43(J), BR=48(L) — all outer corners
    expect(result).toEqual([13, 18, 43, 48]);
  });

  it('missing NW diagonal only returns inner corner for TL', () => {
    const f = allTrue();
    f.nw = false;
    const result = computeAutoTileVariant(f);
    expect(result).toEqual([5, 28, 33, 34]);
  });

  it('missing NE diagonal only returns inner corner for TR', () => {
    const f = allTrue();
    f.ne = false;
    expect(computeAutoTileVariant(f)).toEqual([27, 6, 33, 34]);
  });

  it('missing SW diagonal only returns inner corner for BL', () => {
    const f = allTrue();
    f.sw = false;
    expect(computeAutoTileVariant(f)).toEqual([27, 28, 11, 34]);
  });

  it('missing SE diagonal only returns inner corner for BR', () => {
    const f = allTrue();
    f.se = false;
    expect(computeAutoTileVariant(f)).toEqual([27, 28, 33, 12]);
  });

  it('all diagonals missing (cardinals present) = 4 inner corners', () => {
    const f = flags({
      n: true, e: true, s: true, w: true,
    });
    expect(computeAutoTileVariant(f)).toEqual([5, 6, 11, 12]);
  });

  it('top edge only (no N, all else present)', () => {
    const f = allTrue();
    f.n = false;
    f.ne = false;
    f.nw = false;
    const result = computeAutoTileVariant(f);
    // TL: !N, W → 15; TR: !N, E → 16
    // BL: S, W, SW → 33; BR: S, E, SE → 34
    expect(result).toEqual([15, 16, 33, 34]);
  });

  it('left edge only (no W, all else present)', () => {
    const f = allTrue();
    f.w = false;
    f.nw = false;
    f.sw = false;
    const result = computeAutoTileVariant(f);
    // TL: N, !W → 25; TR: N, E, NE → 28
    // BL: S, !W → 31; BR: S, E, SE → 34
    expect(result).toEqual([25, 28, 31, 34]);
  });

  it('L-shape: N and E present, others absent', () => {
    const f = flags({ n: true, e: true });
    const result = computeAutoTileVariant(f);
    // TL: N, !W → 25; TR: N, E, !NE → 6 (inner corner)
    // BL: !S, !W → 43; BR: !S, E → 46
    expect(result).toEqual([25, 6, 43, 46]);
  });

  it('horizontal corridor (W+E only)', () => {
    const f = flags({ w: true, e: true });
    const result = computeAutoTileVariant(f);
    // TL: !N, W → 15; TR: !N, E → 16
    // BL: !S, W → 45; BR: !S, E → 46
    expect(result).toEqual([15, 16, 45, 46]);
  });

  it('vertical corridor (N+S only)', () => {
    const f = flags({ n: true, s: true });
    const result = computeAutoTileVariant(f);
    // TL: N, !W → 25; TR: N, !E → 30
    // BL: S, !W → 31; BR: S, !E → 36
    expect(result).toEqual([25, 30, 31, 36]);
  });

  it('dead end down (only S present)', () => {
    const f = flags({ s: true });
    const result = computeAutoTileVariant(f);
    // TL: !N, !W → 13; TR: !N, !E → 18
    // BL: S, !W → 31; BR: S, !E → 36
    expect(result).toEqual([13, 18, 31, 36]);
  });
});

describe('subTileToPixels', () => {
  it('position 1 → (0, 0)', () => {
    expect(subTileToPixels(1, 16)).toEqual({ srcX: 0, srcY: 0 });
  });

  it('position 6 → last column of first row', () => {
    expect(subTileToPixels(6, 16)).toEqual({ srcX: 80, srcY: 0 });
  });

  it('position 27 → interior TL at (col 2, row 4)', () => {
    expect(subTileToPixels(27, 16)).toEqual({
      srcX: 2 * 16,
      srcY: 4 * 16,
    });
  });

  it('position 48 → last position', () => {
    expect(subTileToPixels(48, 16)).toEqual({
      srcX: 5 * 16,
      srcY: 7 * 16,
    });
  });

  it('scales with halfTile size', () => {
    expect(subTileToPixels(27, 24)).toEqual({
      srcX: 2 * 24,
      srcY: 4 * 24,
    });
  });
});

describe('getNeighborFlags', () => {
  function makeLayer(
    width: number,
    height: number,
    cells: { x: number; y: number; idx: number }[],
  ): CellValue[][] {
    const layer: CellValue[][] = Array(height)
      .fill(null)
      .map(() => Array(width).fill(null));
    for (const c of cells) {
      layer[c.y]![c.x] = { autoTileIndex: c.idx };
    }
    return layer;
  }

  it('isolated cell with no neighbors', () => {
    const layer = makeLayer(5, 5, [{ x: 2, y: 2, idx: 0 }]);
    const f = getNeighborFlags(layer, 2, 2, 5, 5, 0);
    expect(f).toEqual(flags());
  });

  it('fully surrounded cell', () => {
    const cells = [];
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        cells.push({ x, y, idx: 0 });
      }
    }
    const layer = makeLayer(3, 3, cells);
    const f = getNeighborFlags(layer, 1, 1, 3, 3, 0);
    expect(f).toEqual(allTrue());
  });

  it('out-of-bounds neighbors count as matching', () => {
    const layer = makeLayer(1, 1, [{ x: 0, y: 0, idx: 0 }]);
    const f = getNeighborFlags(layer, 0, 0, 1, 1, 0);
    // All 8 neighbors are OOB → all true
    expect(f).toEqual(allTrue());
  });

  it('corner cell with partial OOB', () => {
    // 2x2 grid, only (0,0) is autotile index 0
    const layer = makeLayer(2, 2, [{ x: 0, y: 0, idx: 0 }]);
    const f = getNeighborFlags(layer, 0, 0, 2, 2, 0);
    // N, NW, NE, W → OOB → true
    // E(1,0)=null, SE(1,1)=null, S(0,1)=null, SW(-1,1)=OOB=true
    expect(f.n).toBe(true);
    expect(f.nw).toBe(true);
    expect(f.w).toBe(true);
    expect(f.sw).toBe(true);
    expect(f.ne).toBe(true);
    expect(f.e).toBe(false);
    expect(f.se).toBe(false);
    expect(f.s).toBe(false);
  });

  it('different autoTileIndex does not match', () => {
    const layer = makeLayer(3, 1, [
      { x: 0, y: 0, idx: 1 },
      { x: 1, y: 0, idx: 0 },
      { x: 2, y: 0, idx: 1 },
    ]);
    const f = getNeighborFlags(layer, 1, 0, 3, 1, 0);
    // W and E are different type → false
    expect(f.w).toBe(false);
    expect(f.e).toBe(false);
  });
});
