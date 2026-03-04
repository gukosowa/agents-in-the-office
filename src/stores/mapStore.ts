import { defineStore } from 'pinia';
import { ref, toRaw, triggerRef } from 'vue';
import type {
  TileLayer,
  CellValue,
  InteractiveObject,
  LayerMeta,
  SpawnPoint,
  TileDepth,
  DepthMap,
  TileCollisionMap,
  TileDirCollisionMap,
  TileInteractiveMap,
  TileInteractiveDef,
  Direction,
} from '../types';
import { DEFAULT_TILE_SIZE, isAutoTile, isRegularTile } from '../types';
import { getFloodFillCells, tilesMatch } from '../utils/fill';
import {
  computeAutoTileVariant,
  getNeighborFlags,
} from '../utils/rmxpAutoTile';
import {
  computeAutoTileVariantB,
  computeWallVariants,
} from '../utils/vxAutoTile';
import type { WallVariants } from '../utils/vxAutoTile';

export type AutoTileType = 'A' | 'B' | 'C';

const GRID_PADDING = 4;
export const MIN_GRID_WIDTH = 10;
export const MIN_GRID_HEIGHT = 8;

export interface ContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ShrinkResult {
  leftTrimmed: number;
  topTrimmed: number;
}

export interface TilesetSlot {
  image: HTMLImageElement | null;
  blob: Blob | null;
}

export interface AutoTileSlot {
  image: HTMLImageElement | null;
  blob: Blob | null;
  type: AutoTileType;
  depthMap: DepthMap;
  collisionMap: TileCollisionMap;
  /** Original spritesheet blob the autotile was cropped from, if any. */
  sourceBlob?: Blob;
  /** Column in the source spritesheet where the crop starts (tile units). */
  sourceCol?: number;
  /** Row in the source spritesheet where the crop starts (tile units). */
  sourceRow?: number;
}

export function createEmptyLayer(
  w: number, h: number,
): TileLayer {
  return Array(h).fill(null).map(() => Array(w).fill(null));
}

export function createEmptyCollisionGrid(
  w: number, h: number,
): boolean[][] {
  return Array(h).fill(null).map(() => Array(w).fill(false));
}

export function createEmptyDirCollisionGrid(
  w: number, h: number,
): number[][] {
  return Array.from(
    { length: h },
    () => new Array<number>(w).fill(0),
  );
}

export const useMapStore = defineStore('map', () => {
  const tileSize = ref(DEFAULT_TILE_SIZE);
  const width = ref(20);
  const height = ref(15);
  const layers = ref<TileLayer[]>([
    createEmptyLayer(20, 15),
    createEmptyLayer(20, 15),
    createEmptyLayer(20, 15),
  ]);
  const layerMeta = ref<LayerMeta[]>([
    { name: 'Ground', visible: true },
    { name: 'Objects (low)', visible: true },
    { name: 'Objects (high)', visible: true },
  ]);
  const objects = ref<InteractiveObject[]>([]);
  const spawnPoints = ref<SpawnPoint[]>([]);
  const collisionGrid = ref<boolean[][]>(createEmptyCollisionGrid(20, 15));
  const dirCollisionGrid = ref<number[][]>(createEmptyDirCollisionGrid(20, 15));

  const tilesetPool = ref<Record<string, TilesetSlot>>({
    A: { image: null, blob: null },
    B: { image: null, blob: null },
    C: { image: null, blob: null },
    D: { image: null, blob: null },
  });

  const autoTilePool = ref<AutoTileSlot[]>([]);
  const tileDepthMaps = ref<Record<string, DepthMap>>({});
  const tileCollisionMaps = ref<Record<string, TileCollisionMap>>({});
  const tileDirCollisionMaps = ref<Record<string, TileDirCollisionMap>>({});
  const tileInteractiveMaps = ref<Record<string, TileInteractiveMap>>({});

  // Bumped on every mutation; watched instead of deep-traversing data
  const dirtyVersion = ref(0);
  function markDirty() { dirtyVersion.value++; }

  let cachedCollisionVersion = -1;
  let cachedCollisionGrid: boolean[][] = [];
  let cachedObjectsVersion = -1;
  let cachedObjects: InteractiveObject[] = [];

  const autoTileCache = new Map<
    string, [number, number, number, number]
  >();

  function cacheKey(
    li: number, x: number, y: number,
  ): string {
    return `${li},${x},${y}`;
  }

  function invalidateAutoTileAt(
    li: number, x: number, y: number,
  ) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const k = cacheKey(li, x + dx, y + dy);
        autoTileCache.delete(k);
        wallCache.delete(k);
      }
    }
  }

  function getAutoTileType(index: number): AutoTileType {
    return autoTilePool.value[index]?.type ?? 'A';
  }

  function getAutoTileVariant(
    layerIndex: number,
    x: number,
    y: number,
    autoTileIndex: number,
    rawLayer?: TileLayer,
  ): [number, number, number, number] {
    const key = cacheKey(layerIndex, x, y);
    const cached = autoTileCache.get(key);
    if (cached) return cached;

    const layer = rawLayer ?? layers.value[layerIndex];
    if (!layer) return [27, 28, 33, 34];

    const flags = getNeighborFlags(
      layer, x, y,
      width.value, height.value, autoTileIndex,
    );
    const atType = getAutoTileType(autoTileIndex);
    const variant = atType === 'B' || atType === 'C'
      ? computeAutoTileVariantB(flags)
      : computeAutoTileVariant(flags);
    autoTileCache.set(key, variant);
    return variant;
  }

  const wallCache = new Map<string, WallVariants>();

  const ISOLATED_WALL: WallVariants = {
    upper: [11, 10, 7, 6],
    lower: [11, 10, 7, 6],
  };

  function getWallVariant(
    layerIndex: number,
    x: number,
    y: number,
    autoTileIndex: number,
    rawLayer?: TileLayer,
  ): WallVariants {
    const key = cacheKey(layerIndex, x, y);
    const cached = wallCache.get(key);
    if (cached) return cached;

    const layer = rawLayer ?? layers.value[layerIndex];
    if (!layer) return ISOLATED_WALL;

    const flags = getNeighborFlags(
      layer, x, y,
      width.value, height.value, autoTileIndex,
    );
    const variant = computeWallVariants(flags);
    wallCache.set(key, variant);
    return variant;
  }


  function resizeMap(newWidth: number, newHeight: number) {
    // Resize layers
    layers.value = layers.value.map(layer => {
      const newLayer = createEmptyLayer(newWidth, newHeight);
      for (let y = 0; y < Math.min(layer.length, newHeight); y++) {
        const row = layer[y];
        if (!row) continue;
        for (let x = 0; x < Math.min(row.length, newWidth); x++) {
          if (newLayer[y]) {
             newLayer[y]![x] = row[x] ?? null;
          }
        }
      }
      return newLayer;
    });

    // Resize collision grid
    const newGrid = createEmptyCollisionGrid(newWidth, newHeight);
    for (let y = 0; y < Math.min(collisionGrid.value.length, newHeight); y++) {
      const row = collisionGrid.value[y];
      if (!row) continue;
      for (let x = 0; x < Math.min(row.length, newWidth); x++) {
        if (newGrid[y]) newGrid[y]![x] = row[x] ?? false;
      }
    }
    collisionGrid.value = newGrid;

    // Resize directional collision grid
    const newDirGrid = createEmptyDirCollisionGrid(newWidth, newHeight);
    for (let y = 0; y < Math.min(dirCollisionGrid.value.length, newHeight); y++) {
      const row = dirCollisionGrid.value[y];
      if (!row) continue;
      for (let x = 0; x < Math.min(row.length, newWidth); x++) {
        if (newDirGrid[y]) newDirGrid[y]![x] = row[x] ?? 0;
      }
    }
    dirCollisionGrid.value = newDirGrid;

    // Filter out of bounds objects and spawn points
    objects.value = objects.value.filter(obj => obj.x < newWidth && obj.y < newHeight);
    spawnPoints.value = spawnPoints.value.filter(sp => sp.x < newWidth && sp.y < newHeight);

    width.value = newWidth;
    height.value = newHeight;
    autoTileCache.clear();
    wallCache.clear();
    markDirty();
  }

  function setTile(layerIndex: number, x: number, y: number, tile: CellValue) {
    if (x >= 0 && x < width.value && y >= 0 && y < height.value) {
      const layer = layers.value[layerIndex];
      if (layer && layer[y]) {
        layer[y][x] = tile ? { ...tile } : null;
        invalidateAutoTileAt(layerIndex, x, y);
        markDirty();
      }
    }
  }

  /**
   * Batch-fill a rectangle with tiles. Writes directly to the layer
   * and invalidates the autotile cache once for the whole region.
   */
  function fillRect(
    layerIndex: number,
    ox: number, oy: number,
    w: number, h: number,
    getTile: (dx: number, dy: number) => CellValue,
  ) {
    // Use raw array to bypass Vue proxy — avoids per-cell
    // reactive trigger/traverse that dominates large fills.
    const rawLayers = toRaw(layers.value);
    const layer = rawLayers[layerIndex];
    if (!layer) return;
    const mw = width.value;
    const mh = height.value;
    for (let dy = 0; dy < h; dy++) {
      const y = oy + dy;
      if (y < 0 || y >= mh) continue;
      const row = layer[y];
      if (!row) continue;
      for (let dx = 0; dx < w; dx++) {
        const x = ox + dx;
        if (x < 0 || x >= mw) continue;
        const tile = getTile(dx, dy);
        row[x] = tile ? { ...tile } : null;
      }
    }
    // Invalidate autotile cache once for the affected region + border
    for (let y = oy - 2; y < oy + h + 2; y++) {
      for (let x = ox - 2; x < ox + w + 2; x++) {
        const k = cacheKey(layerIndex, x, y);
        autoTileCache.delete(k);
        wallCache.delete(k);
      }
    }
    triggerRef(layers);
    markDirty();
  }

  function addObject(obj: InteractiveObject) {
    objects.value.push(obj);
    setCollision(obj.x, obj.y, true);
    markDirty();
  }

  function removeObject(id: string) {
    const obj = objects.value.find(o => o.id === id);
    if (obj) setCollision(obj.x, obj.y, false);
    objects.value = objects.value.filter(o => o.id !== id);
    markDirty();
  }

  function removeObjectAt(x: number, y: number) {
    setCollision(x, y, false);
    objects.value = objects.value.filter(o => o.x !== x || o.y !== y);
    markDirty();
  }

  function setCollision(x: number, y: number, blocked: boolean) {
    if (x < 0 || x >= width.value || y < 0 || y >= height.value) return;
    const row = collisionGrid.value[y];
    if (!row || row[x] === blocked) return;
    row[x] = blocked;
    markDirty();
  }

  function toggleCollision(x: number, y: number) {
    if (x < 0 || x >= width.value || y < 0 || y >= height.value) return;
    const row = collisionGrid.value[y];
    if (row) row[x] = !row[x];
    markDirty();
  }

  function setDirCollision(x: number, y: number, mask: number) {
    if (x < 0 || x >= width.value || y < 0 || y >= height.value) return;
    const row = dirCollisionGrid.value[y];
    if (!row || row[x] === mask) return;
    row[x] = mask;
    markDirty();
  }

  function toggleDirCollisionBit(x: number, y: number, bit: number) {
    if (x < 0 || x >= width.value || y < 0 || y >= height.value) return;
    const row = dirCollisionGrid.value[y];
    if (!row) return;
    row[x] = (row[x] ?? 0) ^ bit;
    markDirty();
  }

  function getDirCollision(x: number, y: number): number {
    if (x < 0 || x >= width.value || y < 0 || y >= height.value) return 0;
    return dirCollisionGrid.value[y]?.[x] ?? 0;
  }

  function fillCollision(x: number, y: number, blocked: boolean) {
    const w = width.value;
    const h = height.value;
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const rawGrid = toRaw(collisionGrid.value);
    const startRow = rawGrid[y];
    if (!startRow) return;
    const target = startRow[x];
    if (target === blocked) return;

    const visited = new Set<number>();
    const queue: { x: number; y: number }[] = [{ x, y }];
    while (queue.length > 0) {
      const cell = queue.shift()!;
      const key = cell.y * w + cell.x;
      if (visited.has(key)) continue;
      visited.add(key);
      const row = rawGrid[cell.y];
      if (!row || row[cell.x] !== target) continue;
      row[cell.x] = blocked;
      for (const n of [
        { x: cell.x + 1, y: cell.y },
        { x: cell.x - 1, y: cell.y },
        { x: cell.x, y: cell.y + 1 },
        { x: cell.x, y: cell.y - 1 },
      ]) {
        if (n.x >= 0 && n.x < w && n.y >= 0 && n.y < h) {
          queue.push(n);
        }
      }
    }
    triggerRef(collisionGrid);
    markDirty();
  }

  function getEffectiveCollisionGrid(): boolean[][] {
    const ver = dirtyVersion.value;
    if (ver === cachedCollisionVersion) {
      return cachedCollisionGrid;
    }

    const w = width.value;
    const h = height.value;
    const rawGrid = toRaw(collisionGrid.value);
    const rawLayers = toRaw(layers.value);
    const colMaps = tileCollisionMaps.value;
    const pool = autoTilePool.value;
    const grid: boolean[][] = Array.from(
      { length: h },
      () => new Array<boolean>(w).fill(false),
    );

    // First pass: mark Type C wall autotile face cells.
    // Type C walls render 2 extra rows below the cell,
    // so collision must extend downward.
    for (const layer of rawLayers) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const cell = layer?.[y]?.[x];
          if (!cell || !isAutoTile(cell)) continue;
          const slot = pool[cell.autoTileIndex];
          if (
            slot?.type !== 'C'
            || !getAutoTileCollision(cell.autoTileIndex)
          ) continue;
          for (let dy = 1; dy <= 2; dy++) {
            const wy = y + dy;
            if (wy < h) grid[wy]![x] = true;
          }
        }
      }
    }

    // Second pass: manual grid, tile collision, autotile collision
    for (let y = 0; y < h; y++) {
      const manualRow = rawGrid[y];
      for (let x = 0; x < w; x++) {
        if (grid[y]![x]) continue;
        if (manualRow?.[x]) {
          grid[y]![x] = true;
          continue;
        }
        for (const layer of rawLayers) {
          const cell = layer?.[y]?.[x];
          if (!cell) continue;
          if (isRegularTile(cell)) {
            const colMap = colMaps[cell.slot];
            if (colMap?.[`${cell.x},${cell.y}`]) {
              grid[y]![x] = true;
              break;
            }
          } else if (isAutoTile(cell)) {
            if (getAutoTileCollision(cell.autoTileIndex)) {
              grid[y]![x] = true;
              break;
            }
          }
        }
      }
    }
    cachedCollisionVersion = ver;
    cachedCollisionGrid = grid;
    return grid;
  }

  let cachedDirCollisionVersion = -1;
  let cachedDirCollisionGrid: number[][] = [];

  function getEffectiveDirCollisionGrid(): number[][] {
    const ver = dirtyVersion.value;
    if (ver === cachedDirCollisionVersion) {
      return cachedDirCollisionGrid;
    }

    const w = width.value;
    const h = height.value;
    const rawDirGrid = toRaw(dirCollisionGrid.value);
    const rawLayers = toRaw(layers.value);
    const dirMaps = tileDirCollisionMaps.value;
    const grid: number[][] = Array.from(
      { length: h },
      () => new Array<number>(w).fill(0),
    );

    for (let y = 0; y < h; y++) {
      const manualRow = rawDirGrid[y];
      for (let x = 0; x < w; x++) {
        let mask = manualRow?.[x] ?? 0;
        for (const layer of rawLayers) {
          const cell = layer?.[y]?.[x];
          if (!cell || !isRegularTile(cell)) continue;
          const dirMap = dirMaps[cell.slot];
          if (!dirMap) continue;
          const tileMask = dirMap[`${cell.x},${cell.y}`];
          if (tileMask) mask |= tileMask;
        }
        grid[y]![x] = mask;
      }
    }

    cachedDirCollisionVersion = ver;
    cachedDirCollisionGrid = grid;
    return grid;
  }

  function expandMap(
    left: number, top: number, right: number, bottom: number,
  ) {
    if (left <= 0 && top <= 0 && right <= 0 && bottom <= 0) return;
    const el = Math.max(0, left);
    const et = Math.max(0, top);
    const er = Math.max(0, right);
    const eb = Math.max(0, bottom);
    if (el === 0 && et === 0 && er === 0 && eb === 0) return;

    const newWidth = width.value + el + er;
    const newHeight = height.value + et + eb;

    layers.value = layers.value.map(layer => {
      const newLayer = createEmptyLayer(newWidth, newHeight);
      for (let y = 0; y < layer.length; y++) {
        const row = layer[y];
        if (!row) continue;
        for (let x = 0; x < row.length; x++) {
          const nr = newLayer[y + et];
          if (nr) nr[x + el] = row[x] ?? null;
        }
      }
      return newLayer;
    });

    const newGrid = createEmptyCollisionGrid(newWidth, newHeight);
    for (let y = 0; y < collisionGrid.value.length; y++) {
      const row = collisionGrid.value[y];
      if (!row) continue;
      for (let x = 0; x < row.length; x++) {
        const nr = newGrid[y + et];
        if (nr) nr[x + el] = row[x] ?? false;
      }
    }
    collisionGrid.value = newGrid;

    const newDirGrid = createEmptyDirCollisionGrid(newWidth, newHeight);
    for (let y = 0; y < dirCollisionGrid.value.length; y++) {
      const row = dirCollisionGrid.value[y];
      if (!row) continue;
      for (let x = 0; x < row.length; x++) {
        const nr = newDirGrid[y + et];
        if (nr) nr[x + el] = row[x] ?? 0;
      }
    }
    dirCollisionGrid.value = newDirGrid;

    if (el > 0 || et > 0) {
      objects.value = objects.value.map(obj => ({
        ...obj, x: obj.x + el, y: obj.y + et,
      }));
      spawnPoints.value = spawnPoints.value.map(sp => ({
        ...sp, x: sp.x + el, y: sp.y + et,
      }));
    }

    width.value = newWidth;
    height.value = newHeight;
    autoTileCache.clear();
    wallCache.clear();
    markDirty();
  }

  function addLayer(afterIndex: number) {
    const insertAt = Math.min(afterIndex + 1, layers.value.length);
    const newLayer = createEmptyLayer(
      width.value, height.value,
    );
    layers.value.splice(insertAt, 0, newLayer);
    layerMeta.value.splice(insertAt, 0, {
      name: `Layer ${layers.value.length}`,
      visible: true,
    });
    autoTileCache.clear();
    wallCache.clear();
    markDirty();
    return insertAt;
  }

  function removeLayer(index: number) {
    if (layers.value.length <= 1) return;
    if (index < 0 || index >= layers.value.length) return;
    layers.value.splice(index, 1);
    layerMeta.value.splice(index, 1);
    autoTileCache.clear();
    wallCache.clear();
    markDirty();
  }

  function moveLayer(fromIndex: number, toIndex: number) {
    if (
      fromIndex < 0
      || fromIndex >= layers.value.length
      || toIndex < 0
      || toIndex >= layers.value.length
      || fromIndex === toIndex
    ) return;
    const [layer] = layers.value.splice(fromIndex, 1);
    const [meta] = layerMeta.value.splice(fromIndex, 1);
    if (layer && meta) {
      layers.value.splice(toIndex, 0, layer);
      layerMeta.value.splice(toIndex, 0, meta);
    }
    autoTileCache.clear();
    wallCache.clear();
    markDirty();
  }

  function clearLayer(index: number) {
    if (index < 0 || index >= layers.value.length) return;
    layers.value[index] = createEmptyLayer(
      width.value, height.value,
    );
    autoTileCache.clear();
    wallCache.clear();
    markDirty();
  }

  function renameLayer(index: number, name: string) {
    const meta = layerMeta.value[index];
    if (meta) {
      meta.name = name;
      markDirty();
    }
  }

  function toggleLayerVisibility(index: number) {
    const meta = layerMeta.value[index];
    if (meta) {
      meta.visible = !meta.visible;
      markDirty();
    }
  }

  function addSpawnPoint(x: number, y: number) {
    const existing = spawnPoints.value.find(
      sp => sp.x === x && sp.y === y,
    );
    if (existing) return;
    spawnPoints.value.push({ id: crypto.randomUUID(), x, y });
    markDirty();
  }

  function removeSpawnPointAt(x: number, y: number) {
    spawnPoints.value = spawnPoints.value.filter(
      sp => sp.x !== x || sp.y !== y,
    );
    markDirty();
  }

  function fillLayer(
    layerIndex: number,
    x: number,
    y: number,
    newTile: CellValue,
  ) {
    if (layerIndex >= layers.value.length) return;
    const rawLayers = toRaw(layers.value);
    const layer = rawLayers[layerIndex];
    if (!layer || !layer[y]) return;

    if (x < 0 || x >= width.value || y < 0 || y >= height.value) return;

    const targetTile = layer[y][x];
    if (tilesMatch(targetTile, newTile)) return;

    const cells = getFloodFillCells(layer, x, y, width.value, height.value);

    for (const cell of cells) {
      if (layer[cell.y]) {
        layer[cell.y]![cell.x] = newTile ? { ...newTile } : null;
      }
    }
    autoTileCache.clear();
    wallCache.clear();
    triggerRef(layers);
    markDirty();
  }

  function fillLayerWithPattern(
    layerIndex: number,
    x: number,
    y: number,
    pattern: { x: number; y: number; w: number; h: number; slot: string },
    flipX = false,
    flipY = false,
    rotation: 0 | 90 | 180 | 270 = 0,
  ) {
    if (layerIndex >= layers.value.length) return;
    const rawLayers = toRaw(layers.value);
    const layer = rawLayers[layerIndex];
    if (!layer || !layer[y]) return;
    if (x < 0 || x >= width.value || y < 0 || y >= height.value) return;

    const firstTile = { x: pattern.x, y: pattern.y, slot: pattern.slot };
    const targetTile = layer[y]![x];
    if (tilesMatch(targetTile, firstTile)) return;

    const cells = getFloodFillCells(
      layer, x, y, width.value, height.value,
    );

    const pw = pattern.w;
    const ph = pattern.h;
    const swapped = rotation === 90 || rotation === 270;
    const ew = swapped ? ph : pw;
    const eh = swapped ? pw : ph;

    for (const cell of cells) {
      if (!layer[cell.y]) continue;
      const dx = ((cell.x - x) % ew + ew) % ew;
      const dy = ((cell.y - y) % eh + eh) % eh;
      let sx: number;
      let sy: number;
      switch (rotation) {
        case 0: sx = dx; sy = dy; break;
        case 90: sx = dy; sy = ph - 1 - dx; break;
        case 180: sx = pw - 1 - dx; sy = ph - 1 - dy; break;
        case 270: sx = pw - 1 - dy; sy = dx; break;
      }
      if (flipX) sx = pw - 1 - sx;
      if (flipY) sy = ph - 1 - sy;
      layer[cell.y]![cell.x] = {
        x: pattern.x + sx,
        y: pattern.y + sy,
        slot: pattern.slot,
        flipX: flipX || undefined,
        flipY: flipY || undefined,
        rotation: rotation || undefined,
      };
    }
    autoTileCache.clear();
    wallCache.clear();
    triggerRef(layers);
    markDirty();
  }

  function getTileDepth(
    slot: string, cx: number, cy: number,
  ): TileDepth {
    return tileDepthMaps.value[slot]?.[`${cx},${cy}`] ?? 0;
  }

  function cycleTileDepth(
    slot: string, cx: number, cy: number,
  ) {
    const key = `${cx},${cy}`;
    const map = tileDepthMaps.value[slot] ?? {};
    const current = map[key] ?? 0;
    const DEPTH_CYCLE: TileDepth[] = [0, 1, 2, -1];
    const idx = DEPTH_CYCLE.indexOf(current);
    const next = DEPTH_CYCLE[(idx + 1) % DEPTH_CYCLE.length]!;
    if (next === 0) {
      delete map[key];
    } else {
      map[key] = next;
    }
    tileDepthMaps.value = {
      ...tileDepthMaps.value,
      [slot]: { ...map },
    };
    markDirty();
  }

  function getTileCollision(
    slot: string, cx: number, cy: number,
  ): boolean {
    return tileCollisionMaps.value[slot]?.[`${cx},${cy}`] ?? false;
  }

  function toggleTileCollision(
    slot: string, cx: number, cy: number,
  ) {
    const key = `${cx},${cy}`;
    const map = tileCollisionMaps.value[slot] ?? {};
    if (map[key]) {
      delete map[key];
    } else {
      map[key] = true;
    }
    tileCollisionMaps.value = {
      ...tileCollisionMaps.value,
      [slot]: { ...map },
    };
    markDirty();
  }

  function getTileDirCollision(
    slot: string, cx: number, cy: number,
  ): number {
    return tileDirCollisionMaps.value[slot]?.[`${cx},${cy}`] ?? 0;
  }

  function toggleTileDirCollisionBit(
    slot: string, cx: number, cy: number, bit: number,
  ) {
    const key = `${cx},${cy}`;
    const map = { ...(tileDirCollisionMaps.value[slot] ?? {}) };
    const current = map[key] ?? 0;
    const next = current ^ bit;
    if (next === 0) {
      delete map[key];
    } else {
      map[key] = next;
    }
    tileDirCollisionMaps.value = {
      ...tileDirCollisionMaps.value,
      [slot]: map,
    };
    markDirty();
  }

  function getTileInteractive(
    slot: string, cx: number, cy: number,
  ): TileInteractiveDef | null {
    return tileInteractiveMaps.value[slot]?.[`${cx},${cy}`] ?? null;
  }

  function setTileInteractive(
    slot: string, cx: number, cy: number,
    def: TileInteractiveDef | null,
  ) {
    const key = `${cx},${cy}`;
    const map = tileInteractiveMaps.value[slot] ?? {};
    if (def) {
      map[key] = def;
    } else {
      delete map[key];
    }
    tileInteractiveMaps.value = {
      ...tileInteractiveMaps.value,
      [slot]: { ...map },
    };
    markDirty();
  }

  function cycleTileInteractiveType(
    slot: string, cx: number, cy: number,
  ) {
    const TYPES = [
      'computer', 'books', 'coffee', 'plant', 'desk', 'chair',
    ];
    const current = getTileInteractive(slot, cx, cy);
    if (!current) {
      setTileInteractive(slot, cx, cy, {
        type: TYPES[0]!,
        direction: 'down' as Direction,
      });
      return;
    }
    const idx = TYPES.indexOf(current.type);
    const nextIdx = idx + 1;
    if (nextIdx >= TYPES.length) {
      setTileInteractive(slot, cx, cy, null);
    } else {
      setTileInteractive(slot, cx, cy, {
        type: TYPES[nextIdx]!,
        direction: current.direction,
      });
    }
  }

  function cycleTileInteractiveDirection(
    slot: string, cx: number, cy: number,
  ) {
    const DIRS: Direction[] = ['down', 'up', 'right', 'left'];
    const current = getTileInteractive(slot, cx, cy);
    if (!current) return;
    const idx = DIRS.indexOf(current.direction);
    const next = DIRS[(idx + 1) % DIRS.length]!;
    setTileInteractive(slot, cx, cy, {
      type: current.type,
      direction: next,
    });
  }

  function getEffectiveObjects(): InteractiveObject[] {
    const ver = dirtyVersion.value;
    if (ver === cachedObjectsVersion) {
      return cachedObjects;
    }

    const manualObjects = toRaw(objects.value);
    const manualPositions = new Set(
      manualObjects.map(o => `${o.x},${o.y}`),
    );
    const derived: InteractiveObject[] = [];
    const rawLayers = toRaw(layers.value);
    const intMaps = tileInteractiveMaps.value;
    const w = width.value;
    const h = height.value;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (manualPositions.has(`${x},${y}`)) continue;
        for (const layer of rawLayers) {
          const cell = layer?.[y]?.[x];
          if (cell && isRegularTile(cell)) {
            const intMap = intMaps[cell.slot];
            const def = intMap?.[`${cell.x},${cell.y}`];
            if (def) {
              derived.push({
                id: `tile-${x}-${y}`,
                x,
                y,
                type: def.type,
                direction: def.direction,
              });
              break;
            }
          }
        }
      }
    }
    const result = [...manualObjects, ...derived];
    cachedObjectsVersion = ver;
    cachedObjects = result;
    return result;
  }

  function addTilesetSlot(): string {
    const labels = Object.keys(tilesetPool.value).sort();
    const last = labels[labels.length - 1];
    const next = last
      ? String.fromCharCode(last.charCodeAt(0) + 1)
      : 'A';
    tilesetPool.value = {
      ...tilesetPool.value,
      [next]: { image: null, blob: null },
    };
    return next;
  }

  async function setTilesetSlot(
    slot: string,
    blob: Blob,
  ): Promise<void> {
    if (!tilesetPool.value[slot]) {
      tilesetPool.value[slot] = { image: null, blob: null };
    }
    tilesetPool.value[slot]!.blob = blob;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const img = new Image();
    return new Promise((resolve) => {
      img.onload = () => {
        tilesetPool.value = {
          ...tilesetPool.value,
          [slot]: { image: img, blob },
        };
        resolve();
      };
      img.onerror = () => {
        console.error(
          `[tileset:${slot}] image load failed`
          + ` (blobSize=${blob.size},`
          + ` type="${blob.type}")`,
        );
        resolve();
      };
      img.src = dataUrl;
    });
  }

  function removeTilesetSlot(slotKey: string): boolean {
    const rawLayers = toRaw(layers.value);
    for (const layer of rawLayers) {
      for (const row of layer) {
        if (!row) continue;
        for (const cell of row) {
          if (isRegularTile(cell) && cell.slot === slotKey) {
            return false;
          }
        }
      }
    }
    const { [slotKey]: _, ...rest } = tilesetPool.value;
    tilesetPool.value = rest;
    delete tileDepthMaps.value[slotKey];
    delete tileCollisionMaps.value[slotKey];
    delete tileDirCollisionMaps.value[slotKey];
    delete tileInteractiveMaps.value[slotKey];
    return true;
  }

  function getSlotImage(slot?: string): HTMLImageElement | null {
    if (slot && tilesetPool.value[slot]?.image) {
      return tilesetPool.value[slot]!.image;
    }
    for (const key of Object.keys(tilesetPool.value).sort()) {
      const entry = tilesetPool.value[key];
      if (entry?.image) return entry.image;
    }
    return null;
  }

  async function addAutoTile(
    blob: Blob,
    type: AutoTileType = 'A',
    sourceBlob?: Blob,
    sourceCol?: number,
    sourceRow?: number,
  ): Promise<number> {
    const index = autoTilePool.value.length;
    autoTilePool.value = [
      ...autoTilePool.value,
      {
        image: null, blob, type,
        depthMap: {}, collisionMap: {},
        sourceBlob, sourceCol, sourceRow,
      },
    ];
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const img = new Image();
    return new Promise((resolve) => {
      img.onload = () => {
        const ts = tileSize.value;
        let expectedW: number;
        let expectedH: number;
        if (type === 'B') {
          expectedW = ts * 2;
          expectedH = ts * 3;
        } else if (type === 'C') {
          expectedW = ts * 2;
          expectedH = ts * 5;
        } else {
          expectedW = ts * 3;
          expectedH = ts * 4;
        }
        if (
          img.width !== expectedW
          || img.height !== expectedH
        ) {
          console.warn(
            `[autotile:${index}] dimensions`
            + ` ${img.width}x${img.height}`
            + ` != expected Type ${type}`
            + ` ${expectedW}x${expectedH}`,
          );
        }
        const pool = [...autoTilePool.value];
        const prev = pool[index];
        pool[index] = {
          image: img, blob, type,
          depthMap: prev?.depthMap ?? {},
          collisionMap: prev?.collisionMap ?? {},
          sourceBlob: prev?.sourceBlob,
          sourceCol: prev?.sourceCol,
          sourceRow: prev?.sourceRow,
        };
        autoTilePool.value = pool;
        resolve(index);
      };
      img.onerror = () => {
        console.error(
          `[autotile:${index}] image load failed`
          + ` (blobSize=${blob.size},`
          + ` type="${blob.type}")`,
        );
        resolve(index);
      };
      img.src = dataUrl;
    });
  }

  async function replaceAutoTile(
    index: number,
    blob: Blob,
    type?: AutoTileType,
    sourceBlob?: Blob,
    sourceCol?: number,
    sourceRow?: number,
  ): Promise<void> {
    const slot = autoTilePool.value[index];
    if (!slot) return;

    const newType = type ?? slot.type;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const img = new Image();
    return new Promise((resolve) => {
      img.onload = () => {
        const pool = [...autoTilePool.value];
        pool[index] = {
          image: img,
          blob,
          type: newType,
          depthMap: slot.depthMap,
          collisionMap: slot.collisionMap,
          sourceBlob,
          sourceCol,
          sourceRow,
        };
        autoTilePool.value = pool;
        autoTileCache.clear();
        wallCache.clear();
        markDirty();
        resolve();
      };
      img.onerror = () => {
        console.error(
          `[autotile:${index}] replace image load failed`
          + ` (blobSize=${blob.size},`
          + ` type="${blob.type}")`,
        );
        resolve();
      };
      img.src = dataUrl;
    });
  }

  function setAutoTileType(
    index: number, type: AutoTileType,
  ) {
    const slot = autoTilePool.value[index];
    if (!slot || slot.type === type) return;
    const pool = [...autoTilePool.value];
    pool[index] = { ...slot, type };
    autoTilePool.value = pool;
    autoTileCache.clear();
    wallCache.clear();
    markDirty();
  }

  function getContentBounds(): ContentBounds | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const rawLayers = toRaw(layers.value);
    for (const layer of rawLayers) {
      for (let y = 0; y < layer.length; y++) {
        const row = layer[y];
        if (!row) continue;
        for (let x = 0; x < row.length; x++) {
          if (row[x] !== null) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
    }

    const rawGrid = toRaw(collisionGrid.value);
    for (let y = 0; y < rawGrid.length; y++) {
      const row = rawGrid[y];
      if (!row) continue;
      for (let x = 0; x < row.length; x++) {
        if (row[x]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    for (const obj of toRaw(objects.value)) {
      if (obj.x < minX) minX = obj.x;
      if (obj.x > maxX) maxX = obj.x;
      if (obj.y < minY) minY = obj.y;
      if (obj.y > maxY) maxY = obj.y;
    }

    for (const sp of toRaw(spawnPoints.value)) {
      if (sp.x < minX) minX = sp.x;
      if (sp.x > maxX) maxX = sp.x;
      if (sp.y < minY) minY = sp.y;
      if (sp.y > maxY) maxY = sp.y;
    }

    if (minX === Infinity) return null;
    return { minX, minY, maxX, maxY };
  }

  function shrinkMap(): ShrinkResult {
    const bounds = getContentBounds();

    if (!bounds) {
      const newW = Math.min(width.value, MIN_GRID_WIDTH);
      const newH = Math.min(height.value, MIN_GRID_HEIGHT);
      if (newW < width.value || newH < height.value) {
        resizeMap(newW, newH);
      }
      return { leftTrimmed: 0, topTrimmed: 0 };
    }

    const desiredLeft = Math.max(0, bounds.minX - GRID_PADDING);
    const desiredTop = Math.max(0, bounds.minY - GRID_PADDING);
    const desiredRight = bounds.maxX + GRID_PADDING;
    const desiredBottom = bounds.maxY + GRID_PADDING;

    let newW = desiredRight - desiredLeft + 1;
    let newH = desiredBottom - desiredTop + 1;
    newW = Math.max(newW, MIN_GRID_WIDTH);
    newH = Math.max(newH, MIN_GRID_HEIGHT);

    if (newW >= width.value && newH >= height.value) {
      return { leftTrimmed: 0, topTrimmed: 0 };
    }

    const trimLeft = desiredLeft;
    const trimTop = desiredTop;
    newW = Math.min(newW, width.value - trimLeft);
    newH = Math.min(newH, height.value - trimTop);

    const rawLayers = toRaw(layers.value);
    layers.value = rawLayers.map(layer => {
      const newLayer = createEmptyLayer(newW, newH);
      for (let y = 0; y < newH; y++) {
        const srcRow = layer[y + trimTop];
        if (!srcRow) continue;
        const destRow = newLayer[y];
        if (!destRow) continue;
        for (let x = 0; x < newW; x++) {
          destRow[x] = srcRow[x + trimLeft] ?? null;
        }
      }
      return newLayer;
    });

    const rawGrid = toRaw(collisionGrid.value);
    const newGrid = createEmptyCollisionGrid(newW, newH);
    for (let y = 0; y < newH; y++) {
      const srcRow = rawGrid[y + trimTop];
      if (!srcRow) continue;
      const destRow = newGrid[y];
      if (!destRow) continue;
      for (let x = 0; x < newW; x++) {
        destRow[x] = srcRow[x + trimLeft] ?? false;
      }
    }
    collisionGrid.value = newGrid;

    const rawDirGrid = toRaw(dirCollisionGrid.value);
    const newDirGrid = createEmptyDirCollisionGrid(newW, newH);
    for (let y = 0; y < newH; y++) {
      const srcRow = rawDirGrid[y + trimTop];
      if (!srcRow) continue;
      const destRow = newDirGrid[y];
      if (!destRow) continue;
      for (let x = 0; x < newW; x++) {
        destRow[x] = srcRow[x + trimLeft] ?? 0;
      }
    }
    dirCollisionGrid.value = newDirGrid;

    if (trimLeft > 0 || trimTop > 0) {
      objects.value = objects.value.map(obj => ({
        ...obj, x: obj.x - trimLeft, y: obj.y - trimTop,
      }));
      spawnPoints.value = spawnPoints.value.map(sp => ({
        ...sp, x: sp.x - trimLeft, y: sp.y - trimTop,
      }));
    }

    width.value = newW;
    height.value = newH;
    autoTileCache.clear();
    wallCache.clear();
    markDirty();

    return { leftTrimmed: trimLeft, topTrimmed: trimTop };
  }

  function resizeToRect(
    srcOffsetX: number,
    srcOffsetY: number,
    newWidth: number,
    newHeight: number,
  ) {
    const nw = Math.max(MIN_GRID_WIDTH, newWidth);
    const nh = Math.max(MIN_GRID_HEIGHT, newHeight);
    if (
      nw === width.value && nh === height.value
      && srcOffsetX === 0 && srcOffsetY === 0
    ) return;

    layers.value = layers.value.map(layer => {
      const newLayer = createEmptyLayer(nw, nh);
      for (let ny = 0; ny < nh; ny++) {
        const oy = ny + srcOffsetY;
        if (oy < 0 || oy >= height.value) continue;
        const srcRow = layer[oy];
        if (!srcRow) continue;
        const destRow = newLayer[ny];
        if (!destRow) continue;
        for (let nx = 0; nx < nw; nx++) {
          const ox = nx + srcOffsetX;
          if (ox < 0 || ox >= width.value) continue;
          destRow[nx] = srcRow[ox] ?? null;
        }
      }
      return newLayer;
    });

    const newGrid = createEmptyCollisionGrid(nw, nh);
    for (let ny = 0; ny < nh; ny++) {
      const oy = ny + srcOffsetY;
      if (oy < 0 || oy >= height.value) continue;
      const srcRow = collisionGrid.value[oy];
      if (!srcRow) continue;
      const destRow = newGrid[ny];
      if (!destRow) continue;
      for (let nx = 0; nx < nw; nx++) {
        const ox = nx + srcOffsetX;
        if (ox < 0 || ox >= width.value) continue;
        destRow[nx] = srcRow[ox] ?? false;
      }
    }
    collisionGrid.value = newGrid;

    const newDirGrid = createEmptyDirCollisionGrid(nw, nh);
    for (let ny = 0; ny < nh; ny++) {
      const oy = ny + srcOffsetY;
      if (oy < 0 || oy >= height.value) continue;
      const srcRow = dirCollisionGrid.value[oy];
      if (!srcRow) continue;
      const destRow = newDirGrid[ny];
      if (!destRow) continue;
      for (let nx = 0; nx < nw; nx++) {
        const ox = nx + srcOffsetX;
        if (ox < 0 || ox >= width.value) continue;
        destRow[nx] = srcRow[ox] ?? 0;
      }
    }
    dirCollisionGrid.value = newDirGrid;

    objects.value = objects.value
      .map(obj => ({
        ...obj,
        x: obj.x - srcOffsetX,
        y: obj.y - srcOffsetY,
      }))
      .filter(obj =>
        obj.x >= 0 && obj.x < nw
        && obj.y >= 0 && obj.y < nh,
      );

    spawnPoints.value = spawnPoints.value
      .map(sp => ({
        ...sp,
        x: sp.x - srcOffsetX,
        y: sp.y - srcOffsetY,
      }))
      .filter(sp =>
        sp.x >= 0 && sp.x < nw
        && sp.y >= 0 && sp.y < nh,
      );

    width.value = nw;
    height.value = nh;
    autoTileCache.clear();
    wallCache.clear();
    markDirty();
  }

  function clearCaches() {
    autoTileCache.clear();
    wallCache.clear();
  }

  function removeAutoTile(index: number): void {
    if (
      index < 0
      || index >= autoTilePool.value.length
    ) return;

    const rawLayers = toRaw(layers.value);

    autoTilePool.value = autoTilePool.value.filter(
      (_, i) => i !== index,
    );

    let modified = false;
    for (const layer of rawLayers) {
      for (const row of layer) {
        if (!row) continue;
        for (let x = 0; x < row.length; x++) {
          const cell = row[x] ?? null;
          if (!isAutoTile(cell)) continue;
          if (cell.autoTileIndex === index) {
            row[x] = null;
            modified = true;
          } else if (cell.autoTileIndex > index) {
            row[x] = {
              autoTileIndex: cell.autoTileIndex - 1,
            };
            modified = true;
          }
        }
      }
    }

    autoTileCache.clear();
    wallCache.clear();
    if (modified) triggerRef(layers);
    markDirty();
  }

  function cycleAutoTileDepth(
    index: number, cx: number, cy: number,
  ) {
    const slot = autoTilePool.value[index];
    if (!slot) return;
    const key = `${cx},${cy}`;
    const current = slot.depthMap[key] ?? 0;
    const cycle: TileDepth[] = [0, 1, 2, -1];
    const next = cycle[
      (cycle.indexOf(current) + 1) % cycle.length
    ]!;
    const pool = [...autoTilePool.value];
    const dm = { ...slot.depthMap };
    if (next === 0) {
      delete dm[key];
    } else {
      dm[key] = next;
    }
    pool[index] = { ...slot, depthMap: dm };
    autoTilePool.value = pool;
    markDirty();
  }

  function toggleAutoTileCollision(
    index: number, cx: number, cy: number,
  ) {
    const slot = autoTilePool.value[index];
    if (!slot) return;
    const key = `${cx},${cy}`;
    const pool = [...autoTilePool.value];
    const cm = { ...slot.collisionMap };
    if (cm[key]) {
      delete cm[key];
    } else {
      cm[key] = true;
    }
    pool[index] = { ...slot, collisionMap: cm };
    autoTilePool.value = pool;
    markDirty();
  }

  function getAutoTileDepth(index: number): TileDepth {
    const slot = autoTilePool.value[index];
    if (!slot) return 0;
    const values = Object.values(slot.depthMap);
    if (values.length === 0) return 0;
    return values[0] ?? 0;
  }

  function getAutoTileCollision(index: number): boolean {
    const slot = autoTilePool.value[index];
    if (!slot) return false;
    return Object.keys(slot.collisionMap).length > 0;
  }

  return {
    tileSize,
    width,
    height,
    layers,
    layerMeta,
    objects,
    spawnPoints,
    collisionGrid,
    dirCollisionGrid,
    tilesetPool,
    autoTilePool,
    resizeMap,
    resizeToRect,
    expandMap,
    dirtyVersion,
    markDirty,
    setTile,
    fillRect,
    addLayer,
    removeLayer,
    clearLayer,
    moveLayer,
    renameLayer,
    toggleLayerVisibility,
    addObject,
    removeObject,
    removeObjectAt,
    addSpawnPoint,
    removeSpawnPointAt,
    fillLayer,
    fillLayerWithPattern,
    addTilesetSlot,
    setTilesetSlot,
    removeTilesetSlot,
    getSlotImage,
    addAutoTile,
    replaceAutoTile,
    setAutoTileType,
    removeAutoTile,
    cycleAutoTileDepth,
    toggleAutoTileCollision,
    getAutoTileDepth,
    getAutoTileCollision,
    getAutoTileVariant,
    getWallVariant,
    getAutoTileType,
    setCollision,
    toggleCollision,
    fillCollision,
    setDirCollision,
    toggleDirCollisionBit,
    getDirCollision,
    getEffectiveCollisionGrid,
    shrinkMap,
    tileDepthMaps,
    getTileDepth,
    cycleTileDepth,
    tileCollisionMaps,
    getTileCollision,
    toggleTileCollision,
    tileDirCollisionMaps,
    getTileDirCollision,
    toggleTileDirCollisionBit,
    getEffectiveDirCollisionGrid,
    tileInteractiveMaps,
    getTileInteractive,
    setTileInteractive,
    cycleTileInteractiveType,
    cycleTileInteractiveDirection,
    getEffectiveObjects,
    clearCaches,
  };
});
