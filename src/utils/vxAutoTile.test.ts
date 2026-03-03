import { describe, it, expect } from 'vitest';
import {
  computeAutoTileVariantB,
  subTileToPixelsB,
  VX_FULL_VARIANT,
  VX_UPPER_WALL_FULL,
  VX_LOWER_WALL_FULL,
  computeWallVariants,
  wallSubTileToPixels,
} from './vxAutoTile';
import type { NeighborFlags } from './rmxpAutoTile';

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

describe('VX_FULL_VARIANT', () => {
  it('is the interior block positions', () => {
    expect(VX_FULL_VARIANT).toEqual([19, 18, 15, 14]);
  });
});

describe('wall full variants', () => {
  it('upper = top edge + interior', () => {
    expect(VX_UPPER_WALL_FULL).toEqual([2, 3, 6, 7]);
  });
  it('lower = interior + bottom edge', () => {
    expect(VX_LOWER_WALL_FULL).toEqual([10, 11, 14, 15]);
  });
});

describe('computeAutoTileVariantB', () => {
  it('fully surrounded returns interior sub-tiles', () => {
    const result = computeAutoTileVariantB(allTrue());
    expect(result).toEqual([19, 18, 15, 14]);
  });

  it('isolated tile (no neighbors) returns outer corners', () => {
    const result = computeAutoTileVariantB(flags());
    expect(result).toEqual([9, 12, 21, 24]);
  });

  it('missing NW diagonal only returns inner corner for TL', () => {
    const f = allTrue();
    f.nw = false;
    const result = computeAutoTileVariantB(f);
    expect(result).toEqual([3, 18, 15, 14]);
  });

  it('missing NE diagonal only returns inner corner for TR', () => {
    const f = allTrue();
    f.ne = false;
    expect(computeAutoTileVariantB(f)).toEqual([19, 4, 15, 14]);
  });

  it('missing SW diagonal only returns inner corner for BL', () => {
    const f = allTrue();
    f.sw = false;
    expect(computeAutoTileVariantB(f)).toEqual([19, 18, 7, 14]);
  });

  it('missing SE diagonal only returns inner corner for BR', () => {
    const f = allTrue();
    f.se = false;
    expect(computeAutoTileVariantB(f)).toEqual([19, 18, 15, 8]);
  });

  it('all diagonals missing (cardinals present) = 4 inner corners', () => {
    const f = flags({
      n: true, e: true, s: true, w: true,
    });
    expect(computeAutoTileVariantB(f)).toEqual([3, 4, 7, 8]);
  });

  it('top edge (no N, all else present)', () => {
    const f = allTrue();
    f.n = false;
    f.ne = false;
    f.nw = false;
    const result = computeAutoTileVariantB(f);
    // TL: !N, W -> 11; TR: !N, E -> 10
    // BL: S, W, SW -> 15; BR: S, E, SE -> 14
    expect(result).toEqual([11, 10, 15, 14]);
  });

  it('left edge (no W, all else present)', () => {
    const f = allTrue();
    f.w = false;
    f.nw = false;
    f.sw = false;
    const result = computeAutoTileVariantB(f);
    // TL: N, !W -> 17; TR: N, E, NE -> 18
    // BL: S, !W -> 13; BR: S, E, SE -> 14
    expect(result).toEqual([17, 18, 13, 14]);
  });

  it('L-shape: N and E present, others absent', () => {
    const f = flags({ n: true, e: true });
    const result = computeAutoTileVariantB(f);
    // TL: N, !W -> 17; TR: N, E, !NE -> 4
    // BL: !S, !W -> 21; BR: !S, E -> 22
    expect(result).toEqual([17, 4, 21, 22]);
  });

  it('horizontal corridor (W+E only)', () => {
    const f = flags({ w: true, e: true });
    const result = computeAutoTileVariantB(f);
    // TL: !N, W -> 11; TR: !N, E -> 10
    // BL: !S, W -> 23; BR: !S, E -> 22
    expect(result).toEqual([11, 10, 23, 22]);
  });

  it('vertical corridor (N+S only)', () => {
    const f = flags({ n: true, s: true });
    const result = computeAutoTileVariantB(f);
    // TL: N, !W -> 17; TR: N, !E -> 20
    // BL: S, !W -> 13; BR: S, !E -> 16
    expect(result).toEqual([17, 20, 13, 16]);
  });

  it('dead end down (only S present)', () => {
    const f = flags({ s: true });
    const result = computeAutoTileVariantB(f);
    // TL: !N, !W -> 9; TR: !N, !E -> 12
    // BL: S, !W -> 13; BR: S, !E -> 16
    expect(result).toEqual([9, 12, 13, 16]);
  });
});

describe('subTileToPixelsB', () => {
  it('position 1 -> (0, 0)', () => {
    expect(subTileToPixelsB(1, 16)).toEqual({ srcX: 0, srcY: 0 });
  });

  it('position 4 -> last column of first row', () => {
    expect(subTileToPixelsB(4, 16)).toEqual({ srcX: 48, srcY: 0 });
  });

  it('position 11 -> top edge TL at (col 2, row 2)', () => {
    expect(subTileToPixelsB(11, 16)).toEqual({
      srcX: 2 * 16,
      srcY: 2 * 16,
    });
  });

  it('position 24 -> last position', () => {
    expect(subTileToPixelsB(24, 16)).toEqual({
      srcX: 3 * 16,
      srcY: 5 * 16,
    });
  });

  it('scales with halfTile size', () => {
    expect(subTileToPixelsB(11, 24)).toEqual({
      srcX: 2 * 24,
      srcY: 2 * 24,
    });
  });
});

describe('computeWallVariants', () => {
  it('fully surrounded = interior left/right, fixed top/bottom', () => {
    const r = computeWallVariants(allTrue());
    expect(r.upper).toEqual([2, 3, 6, 7]);
    expect(r.lower).toEqual([10, 11, 14, 15]);
  });

  it('isolated = all edges', () => {
    const r = computeWallVariants(flags());
    expect(r.upper).toEqual([1, 4, 5, 8]);
    expect(r.lower).toEqual([9, 12, 13, 16]);
  });

  it('N only — same as isolated (n/s ignored)', () => {
    const r = computeWallVariants(flags({ n: true }));
    expect(r.upper).toEqual([1, 4, 5, 8]);
    expect(r.lower).toEqual([9, 12, 13, 16]);
  });

  it('S only — same as isolated (n/s ignored)', () => {
    const r = computeWallVariants(flags({ s: true }));
    expect(r.upper).toEqual([1, 4, 5, 8]);
    expect(r.lower).toEqual([9, 12, 13, 16]);
  });

  it('W+E — interior left/right, fixed top/bottom', () => {
    const r = computeWallVariants(
      flags({ w: true, e: true }),
    );
    expect(r.upper).toEqual([2, 3, 6, 7]);
    expect(r.lower).toEqual([10, 11, 14, 15]);
  });

  it('N+S — same as isolated (n/s ignored)', () => {
    const r = computeWallVariants(
      flags({ n: true, s: true }),
    );
    expect(r.upper).toEqual([1, 4, 5, 8]);
    expect(r.lower).toEqual([9, 12, 13, 16]);
  });

  it('all cardinals = same as W+E (n/s ignored)', () => {
    const r = computeWallVariants(
      flags({ n: true, e: true, s: true, w: true }),
    );
    expect(r.upper).toEqual([2, 3, 6, 7]);
    expect(r.lower).toEqual([10, 11, 14, 15]);
  });

  it('ignores diagonal flags', () => {
    const f = flags({
      nw: true, ne: true, sw: true, se: true,
    });
    const r = computeWallVariants(f);
    expect(r.upper).toEqual([1, 4, 5, 8]);
    expect(r.lower).toEqual([9, 12, 13, 16]);
  });

  it('W only — no left edge, right edge present', () => {
    const r = computeWallVariants(flags({ w: true }));
    expect(r.upper).toEqual([2, 4, 6, 8]);
    expect(r.lower).toEqual([10, 12, 14, 16]);
  });

  it('N+W+E — same as W+E (n/s ignored)', () => {
    const r = computeWallVariants(
      flags({ n: true, w: true, e: true }),
    );
    expect(r.upper).toEqual([2, 3, 6, 7]);
    expect(r.lower).toEqual([10, 11, 14, 15]);
  });
});

describe('wallSubTileToPixels', () => {
  it('position 1 -> (0, 6*ht)', () => {
    expect(wallSubTileToPixels(1, 16)).toEqual({
      srcX: 0,
      srcY: 6 * 16,
    });
  });

  it('position 4 -> last column, first wall row', () => {
    expect(wallSubTileToPixels(4, 16)).toEqual({
      srcX: 3 * 16,
      srcY: 6 * 16,
    });
  });

  it('position 16 -> last wall position', () => {
    expect(wallSubTileToPixels(16, 16)).toEqual({
      srcX: 3 * 16,
      srcY: 9 * 16,
    });
  });

  it('scales with halfTile size', () => {
    expect(wallSubTileToPixels(6, 24)).toEqual({
      srcX: 1 * 24,
      srcY: 7 * 24,
    });
  });
});
