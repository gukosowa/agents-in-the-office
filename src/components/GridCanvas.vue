<script setup lang="ts">
import {
  ref, computed, onMounted, onUnmounted, watch, toRaw,
} from 'vue';
import {
  useMapStore, MIN_GRID_WIDTH, MIN_GRID_HEIGHT,
} from '../stores/mapStore';
import { useEditorStore } from '../stores/editorStore';
import { useUndoStore } from '../stores/undoStore';
import type {
  CellValue, TileLayer, LayerMeta, SpawnPoint, InteractiveObject,
} from '../types';
import {
  isAutoTile, isRegularTile, OBJECT_TYPES,
  DIR_UP, DIR_RIGHT, DIR_DOWN, DIR_LEFT,
} from '../types';
import type { AutoTileSlot, AutoTileType } from '../stores/mapStore';
import { subTileToPixels } from '../utils/rmxpAutoTile';
import {
  subTileToPixelsB,
  VX_FULL_VARIANT,
  VX_UPPER_WALL_FULL,
  VX_LOWER_WALL_FULL,
  wallSubTileToPixels,
} from '../utils/vxAutoTile';
import type { WallVariants } from '../utils/vxAutoTile';

const mapStore = useMapStore();
const editorStore = useEditorStore();
const undoStore = useUndoStore();

const previewVariant = (
  type: AutoTileType,
): [number, number, number, number] => {
  if (type === 'B' || type === 'C') return [...VX_FULL_VARIANT];
  return [27, 28, 33, 34];
};

const PREVIEW_WALL: WallVariants = {
  upper: [...VX_UPPER_WALL_FULL],
  lower: [...VX_LOWER_WALL_FULL],
};

const previewWallVariant = (
  type: AutoTileType,
): WallVariants | undefined => {
  if (type === 'C') return PREVIEW_WALL;
  return undefined;
};

const edgeCursor = ref<string | null>(null);

const canvasCursor = computed(() => {
  if (edgeCursor.value) return edgeCursor.value;
  const tool = editorStore.selectedTool;
  if (tool === 'select' || tool === 'move' || tool === 'spawn') {
    return 'default';
  }
  return 'crosshair';
});
const canvas = ref<HTMLCanvasElement | null>(null);

let animationId: number;
let isPanning = false;
let lastPanX = 0;
let lastPanY = 0;
let lastMouseX = 0;
let lastMouseY = 0;

// Keyboard modifier state for trackpad workflows
let isSpaceHeld = false;
let isCKeyHeld = false;

// Select tool drag state
let isSelecting = false;
let selectStartX = 0;
let selectStartY = 0;

// Move drag state
let isMovingTiles = false;
let moveGrabOffsetX = 0;
let moveGrabOffsetY = 0;
let moveTiles: CellValue[][] | null = null;
let moveCurrentX = 0;
let moveCurrentY = 0;
let moveSnapshotBefore: ReturnType<typeof undoStore.captureSnapshot> | null = null;

// Right-click eyedropper drag state
let isRightDragging = false;
let rightDragStartX = 0;
let rightDragStartY = 0;

// Tiles picked from canvas via right-click (arbitrary layout)
const pickedBrush = ref<CellValue[][] | null>(null);

let isInitialPlacement = false;
let multiTileAnchorX = 0;
let multiTileAnchorY = 0;
const eraserBrushW = ref(1);
const eraserBrushH = ref(1);

// Clear canvas-picked brush when palette selection changes.
// flush:'sync' ensures the watch runs before any subsequent pickedBrush assignment.
watch(
  [
    () => editorStore.selectedTile,
    () => editorStore.selectedAutoTile,
    () => editorStore.selectedSelection,
  ],
  () => { pickedBrush.value = null; },
  { flush: 'sync' },
);

// Clear canvas-picked brush when switching to the interactive object layer.
watch(
  () => editorStore.activeLayer >= mapStore.layers.length,
  (isIO) => { if (isIO) pickedBrush.value = null; },
);

// Rectangle tool drag state
let isRectDragging = false;
let rectStartX = 0;
let rectStartY = 0;

// Line tool drag state
let isLineDragging = false;
let lineStartX = 0;
let lineStartY = 0;

const bresenhamLine = (
  x0: number, y0: number, x1: number, y1: number,
): { x: number; y: number }[] => {
  const points: { x: number; y: number }[] = [];
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0;
  let cy = y0;
  for (;;) {
    points.push({ x: cx, y: cy });
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx) { err += dx; cy += sy; }
  }
  return points;
};

// Marching ants animation offset
let marchOffset = 0;

// Grid border resize state
type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
let isResizing = false;
let resizeEdge: ResizeEdge | null = null;
let resizePreviewLeft = 0;
let resizePreviewTop = 0;
let resizePreviewRight = 0;
let resizePreviewBottom = 0;

const EDGE_THRESHOLD = 8;

const detectResizeEdge = (e: MouseEvent): ResizeEdge | null => {
  if (!canvas.value) return null;
  const rect = canvas.value.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const { wx, wy } = screenToWorld(sx, sy);

  const ts = mapStore.tileSize;
  const mapW = mapStore.width * ts;
  const mapH = mapStore.height * ts;
  const thr = Math.min(
    EDGE_THRESHOLD / editorStore.zoom,
    ts * 0.5,
  );

  const nearL = Math.abs(wx) < thr;
  const nearR = Math.abs(wx - mapW) < thr;
  const nearT = Math.abs(wy) < thr;
  const nearB = Math.abs(wy - mapH) < thr;
  const inH = wx > -thr && wx < mapW + thr;
  const inV = wy > -thr && wy < mapH + thr;

  if (nearT && nearL) return 'nw';
  if (nearT && nearR) return 'ne';
  if (nearB && nearL) return 'sw';
  if (nearB && nearR) return 'se';
  if (nearL && inV) return 'w';
  if (nearR && inV) return 'e';
  if (nearT && inH) return 'n';
  if (nearB && inH) return 's';
  return null;
};

const cursorForEdge = (
  edge: ResizeEdge | null,
): string | null => {
  switch (edge) {
    case 'n': case 's': return 'ns-resize';
    case 'e': case 'w': return 'ew-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'nw': case 'se': return 'nwse-resize';
    default: return null;
  }
};

const updateResizePreview = (e: MouseEvent) => {
  if (!canvas.value || !resizeEdge) return;
  const rect = canvas.value.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const { wx, wy } = screenToWorld(sx, sy);
  const ts = mapStore.tileSize;
  const tileX = Math.round(wx / ts);
  const tileY = Math.round(wy / ts);

  if (resizeEdge.includes('e')) {
    resizePreviewRight = Math.max(
      resizePreviewLeft + MIN_GRID_WIDTH, tileX,
    );
  }
  if (resizeEdge.includes('w')) {
    resizePreviewLeft = Math.min(
      resizePreviewRight - MIN_GRID_WIDTH, tileX,
    );
  }
  if (resizeEdge.includes('s')) {
    resizePreviewBottom = Math.max(
      resizePreviewTop + MIN_GRID_HEIGHT, tileY,
    );
  }
  if (resizeEdge.includes('n')) {
    resizePreviewTop = Math.min(
      resizePreviewBottom - MIN_GRID_HEIGHT, tileY,
    );
  }
};

const screenToWorld = (
  screenX: number,
  screenY: number,
): { wx: number; wy: number } => {
  const wx = (screenX - editorStore.panX) / editorStore.zoom;
  const wy = (screenY - editorStore.panY) / editorStore.zoom;
  return { wx, wy };
};

const normalizeWheelDelta = (
  delta: number,
  deltaMode: number,
): number => {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * 100;
  return delta;
};

const getGridCoord = (e: MouseEvent) => {
  if (!canvas.value) return { x: 0, y: 0 };
  const rect = canvas.value.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const { wx, wy } = screenToWorld(sx, sy);
  const x = Math.floor(wx / mapStore.tileSize);
  const y = Math.floor(wy / mapStore.tileSize);
  return { x, y };
};

/**
 * Auto-expand the map so that the rectangle (x,y,w,h) is within bounds.
 * Returns the adjusted top-left coordinate after expansion.
 */
const autoExpandForDraw = (
  x: number, y: number, w = 1, h = 1,
): { x: number; y: number } => {
  const expandLeft = x < 0 ? -x : 0;
  const expandTop = y < 0 ? -y : 0;
  const expandRight = Math.max(0, x + w - mapStore.width);
  const expandBottom = Math.max(0, y + h - mapStore.height);

  if (expandLeft || expandTop || expandRight || expandBottom) {
    mapStore.expandMap(expandLeft, expandTop, expandRight, expandBottom);
    if (expandLeft > 0 || expandTop > 0) {
      const ts = mapStore.tileSize;
      editorStore.setPan(
        editorStore.panX - expandLeft * ts * editorStore.zoom,
        editorStore.panY - expandTop * ts * editorStore.zoom,
      );
    }
    return { x: x + expandLeft, y: y + expandTop };
  }

  return { x, y };
};

const autoShrinkAfterErase = () => {
  const result = mapStore.shrinkMap();
  if (result.leftTrimmed > 0 || result.topTrimmed > 0) {
    const ts = mapStore.tileSize;
    editorStore.setPan(
      editorStore.panX + result.leftTrimmed * ts * editorStore.zoom,
      editorStore.panY + result.topTrimmed * ts * editorStore.zoom,
    );
  }
};

/** Copy tiles from the active layer within a rectangle */
const copyTilesFromMap = (
  x: number, y: number, w: number, h: number,
): CellValue[][] => {
  const layerIdx = editorStore.activeLayer;
  const layer = mapStore.layers[layerIdx];
  const result: CellValue[][] = [];
  for (let dy = 0; dy < h; dy++) {
    const row: CellValue[] = [];
    for (let dx = 0; dx < w; dx++) {
      const cell = layer?.[y + dy]?.[x + dx] ?? null;
      row.push(cell ? { ...cell } : null);
    }
    result.push(row);
  }
  return result;
};

/** Clear tiles on the active layer within a rectangle */
const clearTilesOnMap = (
  x: number, y: number, w: number, h: number,
) => {
  mapStore.fillRect(editorStore.activeLayer, x, y, w, h, () => null);
};

/** Place tiles onto the active layer at a position */
const placeTilesOnMap = (
  tiles: CellValue[][],
  destX: number, destY: number,
): { x: number; y: number } => {
  const layerIdx = editorStore.activeLayer;
  const w = tiles[0]?.length ?? 0;
  const h = tiles.length;
  const adj = autoExpandForDraw(destX, destY, w, h);
  mapStore.fillRect(
    layerIdx, adj.x, adj.y, w, h,
    (dx, dy) => tiles[dy]?.[dx] ?? null,
  );
  return adj;
};

/**
 * Returns a tileset selection rect if all cells in the stamp are regular tiles
 * from the same slot and their tileset positions form a perfect contiguous
 * rectangle matching the stamp layout. Returns null otherwise.
 */
const tryExtractTilesetRect = (
  tiles: CellValue[][],
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number; slot: string } | null => {
  const first = tiles[0]?.[0] ?? null;
  if (!isRegularTile(first)) return null;
  const slot = first.slot;
  const baseX = first.x;
  const baseY = first.y;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const cell = tiles[dy]?.[dx] ?? null;
      if (
        !isRegularTile(cell)
        || cell.slot !== slot
        || cell.x !== baseX + dx
        || cell.y !== baseY + dy
      ) return null;
    }
  }
  return { x: baseX, y: baseY, w, h, slot };
};

/**
 * Right-click eyedropper: pick tile(s) from canvas.
 * Copies the actual CellValue grid so tiles from different
 * slots/autotiles are preserved exactly.
 * Empty area clears the brush (pen draws nothing).
 */
const pickTilesFromMap = (e: MouseEvent) => {
  const { x, y } = getGridCoord(e);
  const minX = Math.min(rightDragStartX, x);
  const minY = Math.min(rightDragStartY, y);
  const w = Math.abs(x - rightDragStartX) + 1;
  const h = Math.abs(y - rightDragStartY) + 1;

  if (editorStore.showCollision) {
    let hasAny = false;
    for (let dy = 0; dy < h && !hasAny; dy++) {
      const row = mapStore.collisionGrid[minY + dy];
      for (let dx = 0; dx < w && !hasAny; dx++) {
        if (row?.[minX + dx]) hasAny = true;
      }
    }
    editorStore.setTool(hasAny ? 'pen' : 'eraser');
    return;
  }

  if (editorStore.activeLayer >= mapStore.layers.length) return;

  const tiles = copyTilesFromMap(minX, minY, w, h);
  const hasAny = tiles.some(row => row.some(cell => cell !== null));

  if (hasAny) {
    // Null these first so the sync watch clears pickedBrush before we set it.
    editorStore.selectedTile = null;
    editorStore.selectedAutoTile = null;
    editorStore.selectedSelection = null;
    // Switch to the tileset slot of the first regular tile and hint scroll.
    outer: for (const row of tiles) {
      for (const cell of row) {
        if (isRegularTile(cell)) {
          editorStore.activeSlot = cell.slot;
          editorStore.tileScrollHint = { x: cell.x, y: cell.y };
          break outer;
        }
      }
    }
    // If all tiles form a perfect contiguous rectangle in the tileset,
    // show the yellow selection marker in the tileset panel.
    // Set this before pickedBrush so the sync watch fires while brush is still null.
    const tilesetRect = tryExtractTilesetRect(tiles, w, h);
    if (tilesetRect) {
      editorStore.selectedSelection = tilesetRect;
      editorStore.selectionPulse++;
    }
    pickedBrush.value = tiles;
    editorStore.setTool('pen');
  } else {
    pickedBrush.value = null;
    eraserBrushW.value = w;
    eraserBrushH.value = h;
    editorStore.setTool('eraser');
  }
};

/**
 * Commit the rectangle tool: fill the dragged rectangle with the
 * currently selected tile/brush, tiling the pattern to cover the area.
 */
const commitRectangle = (e: MouseEvent) => {
  const { x, y } = getGridCoord(e);
  const minX = Math.min(rectStartX, x);
  const minY = Math.min(rectStartY, y);
  const w = Math.abs(x - rectStartX) + 1;
  const h = Math.abs(y - rectStartY) + 1;

  if (editorStore.showCollision) {
    const val = editorStore.selectedTool === 'pen';
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        mapStore.setCollision(minX + dx, minY + dy, val);
      }
    }
    return;
  }

  if (editorStore.activeLayer >= mapStore.layers.length) return;

  const li = editorStore.activeLayer;

  if (editorStore.selectedTool === 'eraser') {
    clearTilesOnMap(minX, minY, w, h);
    autoShrinkAfterErase();
    return;
  }

  const adj = autoExpandForDraw(minX, minY, w, h);
  const ox = adj.x;
  const oy = adj.y;

  if (pickedBrush.value) {
    const brush = pickedBrush.value;
    const bw = brush[0]?.length ?? 1;
    const bh = brush.length;
    mapStore.fillRect(li, ox, oy, w, h, (dx, dy) =>
      brush[dy % bh]?.[dx % bw] ?? null,
    );
  } else if (editorStore.selectedSelection) {
    const sel = editorStore.selectedSelection;
    const fX = editorStore.tileFlipX;
    const fY = editorStore.tileFlipY;
    const rot = editorStore.tileRotation;
    mapStore.fillRect(li, ox, oy, w, h, (dx, dy) => {
      const { sx, sy } = selectionSourceCoord(
        dx % sel.w, dy % sel.h,
        sel.w, sel.h, fX, fY, rot,
      );
      return {
        x: sel.x + sx, y: sel.y + sy,
        slot: sel.slot,
        flipX: fX, flipY: fY, rotation: rot,
      };
    });
  } else if (editorStore.selectedAutoTile) {
    const at = {
      autoTileIndex:
        editorStore.selectedAutoTile.autoTileIndex,
    };
    mapStore.fillRect(li, ox, oy, w, h, () => at);
  } else if (editorStore.selectedTile) {
    const tile = editorStore.selectedTile;
    mapStore.fillRect(li, ox, oy, w, h, () => ({
      ...tile,
      flipX: editorStore.tileFlipX,
      flipY: editorStore.tileFlipY,
      rotation: editorStore.tileRotation,
    }));
  }
};

const commitLine = (e: MouseEvent) => {
  const { x, y } = getGridCoord(e);
  const points = bresenhamLine(lineStartX, lineStartY, x, y);

  if (editorStore.showCollision) {
    const val = editorStore.selectedTool === 'pen';
    for (const p of points) {
      mapStore.setCollision(p.x, p.y, val);
    }
    return;
  }

  if (editorStore.activeLayer >= mapStore.layers.length) return;
  const li = editorStore.activeLayer;

  if (editorStore.selectedTool === 'eraser') {
    for (const p of points) {
      mapStore.setTile(li, p.x, p.y, null);
    }
    autoShrinkAfterErase();
    return;
  }

  if (pickedBrush.value) {
    const brush = pickedBrush.value;
    const bw = brush[0]?.length ?? 1;
    const bh = brush.length;
    for (const p of points) {
      const adj = autoExpandForDraw(p.x, p.y);
      const oX = ((adj.x - lineStartX) % bw + bw) % bw;
      const oY = ((adj.y - lineStartY) % bh + bh) % bh;
      mapStore.setTile(
        li, adj.x, adj.y, brush[oY]?.[oX] ?? null,
      );
    }
  } else if (editorStore.selectedSelection) {
    const sel = editorStore.selectedSelection;
    const fX = editorStore.tileFlipX;
    const fY = editorStore.tileFlipY;
    const rot = editorStore.tileRotation;
    const { ew, eh } = effectiveDims(sel.w, sel.h, rot);
    for (const p of points) {
      const adj = autoExpandForDraw(p.x, p.y);
      const oX = ((adj.x - lineStartX) % ew + ew) % ew;
      const oY = ((adj.y - lineStartY) % eh + eh) % eh;
      const { sx, sy } = selectionSourceCoord(
        oX, oY, sel.w, sel.h, fX, fY, rot,
      );
      mapStore.setTile(li, adj.x, adj.y, {
        x: sel.x + sx, y: sel.y + sy, slot: sel.slot,
        flipX: fX, flipY: fY, rotation: rot,
      });
    }
  } else if (editorStore.selectedAutoTile) {
    const at = {
      autoTileIndex:
        editorStore.selectedAutoTile.autoTileIndex,
    };
    for (const p of points) {
      const adj = autoExpandForDraw(p.x, p.y);
      mapStore.setTile(li, adj.x, adj.y, at);
    }
  } else if (editorStore.selectedTile) {
    const tile = editorStore.selectedTile;
    for (const p of points) {
      const adj = autoExpandForDraw(p.x, p.y);
      mapStore.setTile(li, adj.x, adj.y, {
        ...tile,
        flipX: editorStore.tileFlipX,
        flipY: editorStore.tileFlipY,
        rotation: editorStore.tileRotation,
      });
    }
  }
};

/** Check if a grid coordinate is inside the current map selection */
const isInsideSelection = (gx: number, gy: number): boolean => {
  const sel = editorStore.mapSelection;
  if (!sel) return false;
  return gx >= sel.x && gx < sel.x + sel.w
    && gy >= sel.y && gy < sel.y + sel.h;
};

/**
 * Draw a preview of the tiles that would fill the rectangle area.
 * Mirrors the logic in commitRectangle but renders at reduced opacity.
 */
const drawRectPreviewTiles = (
  ctx: CanvasRenderingContext2D,
  rx: number, ry: number, rw: number, rh: number,
  ts: number,
) => {
  ctx.globalAlpha = 0.5;

  if (pickedBrush.value) {
    const brush = pickedBrush.value;
    const bw = brush[0]?.length ?? 1;
    const bh = brush.length;
    for (let dy = 0; dy < rh; dy++) {
      for (let dx = 0; dx < rw; dx++) {
        const cell = brush[dy % bh]?.[dx % bw];
        if (!cell) continue;
        const px = (rx + dx) * ts;
        const py = (ry + dy) * ts;
        if (isRegularTile(cell)) {
          const img = mapStore.getSlotImage(cell.slot);
          if (img) {
            ctx.drawImage(
              img,
              cell.x * ts, cell.y * ts, ts, ts,
              px, py, ts, ts,
            );
          }
        } else if (isAutoTile(cell)) {
          const atSlot = mapStore.autoTilePool[
            cell.autoTileIndex
          ];
          if (atSlot?.image) {
            drawAutoTileCell(
              ctx, atSlot.image,
              previewVariant(atSlot.type),
              px, py, ts, atSlot.type,
              dy === rh - 1 ? previewWallVariant(atSlot.type) : undefined,
              ry + dy, undefined, editorStore.zoom, rx + dx,
            );
          }
        }
      }
    }
  } else if (editorStore.selectedSelection) {
    const sel = editorStore.selectedSelection;
    const fX = editorStore.tileFlipX;
    const fY = editorStore.tileFlipY;
    const rot = editorStore.tileRotation;
    const img = mapStore.getSlotImage(sel.slot);
    if (img) {
      for (let dy = 0; dy < rh; dy++) {
        for (let dx = 0; dx < rw; dx++) {
          const { sx, sy } = selectionSourceCoord(
            dx % sel.w, dy % sel.h,
            sel.w, sel.h, fX, fY, rot,
          );
          drawTileTransformed(
            ctx, img,
            (sel.x + sx) * ts, (sel.y + sy) * ts, ts, ts,
            (rx + dx) * ts, (ry + dy) * ts, ts, ts,
            fX, fY, rot,
          );
        }
      }
    }
  } else if (editorStore.selectedAutoTile) {
    const atIdx = editorStore.selectedAutoTile.autoTileIndex;
    const atSlot = mapStore.autoTilePool[atIdx];
    if (atSlot?.image) {
      const pv = previewVariant(atSlot.type);
      const wv = previewWallVariant(atSlot.type);
      for (let dy = 0; dy < rh; dy++) {
        for (let dx = 0; dx < rw; dx++) {
          drawAutoTileCell(
            ctx, atSlot.image, pv,
            (rx + dx) * ts, (ry + dy) * ts, ts,
            atSlot.type, dy === rh - 1 ? wv : undefined,
            ry + dy, undefined, editorStore.zoom, rx + dx,
          );
        }
      }
    }
  } else if (editorStore.selectedTile) {
    const tile = editorStore.selectedTile;
    const img = mapStore.getSlotImage(tile.slot);
    if (img) {
      for (let dy = 0; dy < rh; dy++) {
        for (let dx = 0; dx < rw; dx++) {
          drawTileTransformed(
            ctx, img,
            tile.x * ts, tile.y * ts, ts, ts,
            (rx + dx) * ts, (ry + dy) * ts, ts, ts,
            editorStore.tileFlipX, editorStore.tileFlipY, editorStore.tileRotation,
          );
        }
      }
    }
  } else {
    // No tile selected — fallback to purple fill
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#a78bfa';
    ctx.fillRect(rx * ts, ry * ts, rw * ts, rh * ts);
  }
};

/**
 * Draw a hover rect with a dark shadow behind the colored stroke so it remains
 * visible on both light and dark tiles.  All dimensions are in world (map) units.
 * `lw` is already zoom-compensated (i.e. 2 / zoom).
 */
const strokeHoverRect = (
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  color: string,
  lw: number,
) => {
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = lw * 2;
  ctx.strokeRect(x + lw, y + lw, w - lw * 2, h - lw * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw);
};

const render = () => {
  const ctx = canvas.value?.getContext('2d');
  if (!ctx || !canvas.value) return;

  const cw = canvas.value.width;
  const ch = canvas.value.height;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, cw, ch);

  const dpr = window.devicePixelRatio;
  ctx.setTransform(
    editorStore.zoom * dpr, 0, 0, editorStore.zoom * dpr,
    Math.round(editorStore.panX * dpr), Math.round(editorStore.panY * dpr),
  );
  ctx.imageSmoothingEnabled = false;

  const ts = mapStore.tileSize;
  const rawLayers = toRaw(mapStore.layers) as TileLayer[];
  const rawLayerMeta = toRaw(mapStore.layerMeta) as LayerMeta[];
  const rawCollisionGrid = mapStore.getEffectiveCollisionGrid();
  const rawObjects = mapStore.getEffectiveObjects();
  const rawSpawnPoints = toRaw(mapStore.spawnPoints) as SpawnPoint[];
  const rawAutoTilePool = toRaw(mapStore.autoTilePool) as AutoTileSlot[];

  if (editorStore.previewMode) {
    // Layer 0: draw directly (ground)
    const layer0 = rawLayers[0];
    if (layer0 && rawLayerMeta[0]?.visible !== false) {
      drawLayerContent(ctx, 0, layer0, rawAutoTilePool, ts, editorStore.zoom);
    }
    // Layers 1+: depth Y-sorted, mirrors RunView rendering
    const previewRenderables: Renderable[] = [];
    for (let i = 1; i < rawLayers.length; i++) {
      const meta = rawLayerMeta[i];
      if (meta && !meta.visible) continue;
      const layer = rawLayers[i];
      if (!layer) continue;
      previewRenderables.push(
        ...collectPreviewRenderables(i, layer, rawAutoTilePool, ts, editorStore.zoom),
      );
    }
    previewRenderables.sort((a, b) => a.y - b.y);
    for (const r of previewRenderables) r.draw(ctx);
  } else {
    // Pass 1: wall autotiles from all layers first (always render behind)
    for (let i = 0; i < rawLayers.length; i++) {
      drawLayer(ctx, i, rawLayers, rawLayerMeta, rawAutoTilePool, ts, 'walls');
    }
    // Pass 2: everything else in layer order
    for (let i = 0; i < rawLayers.length; i++) {
      drawLayer(ctx, i, rawLayers, rawLayerMeta, rawAutoTilePool, ts, 'no-walls');
    }
  }
  if (editorStore.showInteractiveLayer) {
    drawObjects(ctx, rawObjects, ts);
  }

  ctx.globalAlpha = 1.0;
  ctx.filter = 'none';

  if (editorStore.showCollision) {
    drawCollisionOverlay(ctx, rawCollisionGrid, ts);
  }

  if (editorStore.showDirCollision) {
    drawDirCollisionOverlay(
      ctx, mapStore.getEffectiveDirCollisionGrid(), ts,
    );
  }

  if (editorStore.showInteractiveLayer) {
    drawSpawnMarkers(ctx, rawSpawnPoints, ts);
  }
  const mapW = mapStore.width * ts;
  const mapH = mapStore.height * ts;

  if (editorStore.showGrid) {
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1 / editorStore.zoom;
    ctx.beginPath();
    for (let x = 0; x <= mapW; x += ts) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, mapH);
    }
    for (let y = 0; y <= mapH; y += ts) {
      ctx.moveTo(0, y);
      ctx.lineTo(mapW, y);
    }
    ctx.stroke();
  }

  ctx.strokeStyle = '#555';
  ctx.lineWidth = 2 / editorStore.zoom;
  ctx.strokeRect(0, 0, mapW, mapH);

  // Resize preview
  if (isResizing) {
    ctx.save();
    const nl = resizePreviewLeft;
    const nt = resizePreviewTop;
    const nr = resizePreviewRight;
    const nb = resizePreviewBottom;
    const ow = mapStore.width;
    const oh = mapStore.height;

    // Red shade on areas that will be removed
    const il = Math.max(0, nl);
    const it = Math.max(0, nt);
    const ir = Math.min(ow, nr);
    const ib = Math.min(oh, nb);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#ef4444';
    if (il > 0) {
      ctx.fillRect(0, 0, il * ts, oh * ts);
    }
    if (ir < ow) {
      ctx.fillRect(ir * ts, 0, (ow - ir) * ts, oh * ts);
    }
    if (it > 0) {
      ctx.fillRect(il * ts, 0, (ir - il) * ts, it * ts);
    }
    if (ib < oh) {
      ctx.fillRect(
        il * ts, ib * ts,
        (ir - il) * ts, (oh - ib) * ts,
      );
    }

    // Dashed cyan border for new grid
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2 / editorStore.zoom;
    ctx.setLineDash([
      6 / editorStore.zoom, 4 / editorStore.zoom,
    ]);
    ctx.strokeRect(
      nl * ts, nt * ts,
      (nr - nl) * ts, (nb - nt) * ts,
    );
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Hover preview (only for drawing tools, not select/move)
  const tool = editorStore.selectedTool;
  const isCollisionErase = (editorStore.showCollision
    || editorStore.showDirCollision) && tool === 'eraser';
  const hoverColor = editorStore.showCollision
    ? '#60a5fa'          // blue for collision
    : editorStore.showDirCollision
    ? '#f87171'          // red for dir collision
    : tool === 'eraser'
      ? '#f87171'        // red for eraser
      : tool === 'fill'
        ? '#a78bfa'      // purple for fill
        : '#e2e8f0';     // light slate for pen/other
  if (
    hoverX.value >= 0
    && hoverY.value >= 0
    && !isResizing
    && !isRightDragging
    && tool !== 'select'
    && tool !== 'move'
  ) {
    ctx.save();
    const lw = 2 / editorStore.zoom;
    ctx.lineWidth = lw;
    if (tool === 'spawn') {
      // Green circle preview for spawn tool
      const cx = hoverX.value * ts + ts / 2;
      const cy = hoverY.value * ts + ts / 2;
      const r = ts * 0.35;
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = '#22c55e';
      ctx.stroke();
    } else if (pickedBrush.value && tool === 'pen') {
      const brush = pickedBrush.value;
      const bw = brush[0]?.length ?? 1;
      const bh = brush.length;
      const sx = hoverX.value;
      const sy = hoverY.value;
      if (!isDrawing.value) {
        ctx.globalAlpha = 0.5;
        for (let dy = 0; dy < bh; dy++) {
          for (let dx = 0; dx < bw; dx++) {
            const cell = brush[dy]?.[dx];
            if (!cell) continue;
            const px = (sx + dx) * ts;
            const py = (sy + dy) * ts;
            if (isRegularTile(cell)) {
              const img = mapStore.getSlotImage(cell.slot);
              if (img) {
                ctx.drawImage(
                  img,
                  cell.x * ts, cell.y * ts, ts, ts,
                  px, py, ts, ts,
                );
              }
            } else if (isAutoTile(cell)) {
              const atSlot = mapStore.autoTilePool[
                cell.autoTileIndex
              ];
              if (atSlot?.image) {
                drawAutoTileCell(
                  ctx, atSlot.image,
                  previewVariant(atSlot.type),
                  px, py, ts, atSlot.type,
                  dy === bh - 1 ? previewWallVariant(atSlot.type) : undefined,
                  sy + dy, undefined, editorStore.zoom, sx + dx,
                );
              }
            }
          }
        }
        ctx.globalAlpha = 1.0;
      }
      strokeHoverRect(ctx, sx * ts, sy * ts, bw * ts, bh * ts, hoverColor, lw);
    } else if (
      editorStore.selectedAutoTile
      && tool === 'pen'
    ) {
      const atIdx = editorStore.selectedAutoTile.autoTileIndex;
      const atSlot = mapStore.autoTilePool[atIdx];
      if (atSlot?.image) {
        ctx.globalAlpha = 0.5;
        drawAutoTileCell(
          ctx, atSlot.image,
          previewVariant(atSlot.type),
          hoverX.value * ts, hoverY.value * ts, ts,
          atSlot.type,
          previewWallVariant(atSlot.type),
          hoverY.value, undefined, editorStore.zoom, hoverX.value,
        );
      }
      ctx.globalAlpha = 1.0;
      strokeHoverRect(ctx, hoverX.value * ts, hoverY.value * ts, ts, ts, '#eab308', lw);
    } else if (
      editorStore.selectedSelection
      && tool === 'pen'
    ) {
      const { x: tx, y: ty, w, h, slot } = editorStore.selectedSelection;
      const fX = editorStore.tileFlipX;
      const fY = editorStore.tileFlipY;
      const rot = editorStore.tileRotation;
      const { ew, eh } = effectiveDims(w, h, rot);
      const sx = hoverX.value;
      const sy = hoverY.value;
      if (!isDrawing.value) {
        const hoverImg = mapStore.getSlotImage(slot);
        if (hoverImg) {
          ctx.globalAlpha = 0.5;
          for (let dy = 0; dy < eh; dy++) {
            for (let dx = 0; dx < ew; dx++) {
              const { sx: srcDx, sy: srcDy } =
                selectionSourceCoord(dx, dy, w, h, fX, fY, rot);
              drawTileTransformed(
                ctx, hoverImg,
                (tx + srcDx) * ts, (ty + srcDy) * ts, ts, ts,
                (sx + dx) * ts, (sy + dy) * ts, ts, ts,
                fX, fY, rot,
              );
            }
          }
          ctx.globalAlpha = 1.0;
        }
      }
      strokeHoverRect(ctx, sx * ts, sy * ts, ew * ts, eh * ts, hoverColor, lw);
    } else if (editorStore.selectedTile && tool === 'pen') {
      const tile = editorStore.selectedTile;
      const img = mapStore.getSlotImage(tile.slot);
      if (img && !isDrawing.value) {
        ctx.globalAlpha = 0.5;
        drawTileTransformed(
          ctx, img,
          tile.x * ts, tile.y * ts, ts, ts,
          hoverX.value * ts, hoverY.value * ts, ts, ts,
          editorStore.tileFlipX, editorStore.tileFlipY, editorStore.tileRotation,
        );
      }
      ctx.globalAlpha = 1.0;
      strokeHoverRect(ctx, hoverX.value * ts, hoverY.value * ts, ts, ts, hoverColor, lw);
    } else {
      strokeHoverRect(
        ctx, hoverX.value * ts, hoverY.value * ts,
        eraserBrushW.value * ts, eraserBrushH.value * ts,
        hoverColor, lw,
      );
    }
    // Mode badge in top-right corner of hovered cell
    const badgeSize = Math.max(6, ts * 0.25);
    const badgePad = 2 / editorStore.zoom;
    const badgeX = (hoverX.value + 1) * ts;
    const badgeY = hoverY.value * ts;
    if (editorStore.rectMode || editorStore.lineMode) {
      ctx.strokeStyle = hoverColor;
      ctx.lineWidth = 1.5 / editorStore.zoom;
      if (editorStore.rectMode) {
        ctx.strokeRect(
          badgeX - badgeSize - badgePad, badgeY + badgePad,
          badgeSize, badgeSize * 0.7,
        );
      } else {
        ctx.beginPath();
        ctx.moveTo(
          badgeX - badgeSize - badgePad,
          badgeY + badgePad + badgeSize * 0.7,
        );
        ctx.lineTo(badgeX - badgePad, badgeY + badgePad);
        ctx.stroke();
      }
    }
    if (isCollisionErase) {
      const fontSize = Math.max(8, ts * 0.35);
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(
        '\u{1F9F9}', badgeX - badgePad, badgeY + badgePad,
      );
    }
    ctx.restore();
  }

  // Draw floating move preview
  if (isMovingTiles && moveTiles) {
    ctx.save();
    ctx.globalAlpha = 0.6;
    for (let dy = 0; dy < moveTiles.length; dy++) {
      const row = moveTiles[dy];
      if (!row) continue;
      for (let dx = 0; dx < row.length; dx++) {
        const cell = row[dx];
        if (!cell) continue;
        const px = (moveCurrentX + dx) * ts;
        const py = (moveCurrentY + dy) * ts;
        if (isRegularTile(cell)) {
          const img = mapStore.getSlotImage(cell.slot);
          if (img) {
            ctx.drawImage(
              img,
              cell.x * ts, cell.y * ts, ts, ts,
              px, py, ts, ts,
            );
          }
        } else if (isAutoTile(cell)) {
          const atSlot = mapStore.autoTilePool[
            cell.autoTileIndex
          ];
          if (atSlot?.image) {
            drawAutoTileCell(
              ctx, atSlot.image,
              previewVariant(atSlot.type),
              px, py, ts, atSlot.type,
              previewWallVariant(atSlot.type),
              moveCurrentY + dy, undefined, editorStore.zoom,
              moveCurrentX + dx,
            );
          }
        }
      }
    }
    ctx.globalAlpha = 1.0;
    // Outline around move preview
    const pw = (moveTiles[0]?.length ?? 0) * ts;
    const ph = moveTiles.length * ts;
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2 / editorStore.zoom;
    ctx.setLineDash([6 / editorStore.zoom, 4 / editorStore.zoom]);
    ctx.strokeRect(moveCurrentX * ts, moveCurrentY * ts, pw, ph);
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Draw right-click pick rectangle
  if (isRightDragging && hoverX.value >= 0 && hoverY.value >= 0) {
    const rx = Math.min(rightDragStartX, hoverX.value);
    const ry = Math.min(rightDragStartY, hoverY.value);
    const rw = Math.abs(hoverX.value - rightDragStartX) + 1;
    const rh = Math.abs(hoverY.value - rightDragStartY) + 1;
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#60a5fa';
    ctx.fillRect(rx * ts, ry * ts, rw * ts, rh * ts);
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2 / editorStore.zoom;
    ctx.strokeRect(rx * ts, ry * ts, rw * ts, rh * ts);
    ctx.restore();
  }

  // Draw rectangle mode preview with tile content
  if (isRectDragging && hoverX.value >= 0 && hoverY.value >= 0) {
    const rx = Math.min(rectStartX, hoverX.value);
    const ry = Math.min(rectStartY, hoverY.value);
    const rw = Math.abs(hoverX.value - rectStartX) + 1;
    const rh = Math.abs(hoverY.value - rectStartY) + 1;
    const isErasing = editorStore.selectedTool === 'eraser';
    ctx.save();

    if (editorStore.showCollision) {
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = isErasing ? '#f87171' : '#3b82f6';
      ctx.fillRect(rx * ts, ry * ts, rw * ts, rh * ts);
    } else if (isErasing) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#f87171';
      ctx.fillRect(rx * ts, ry * ts, rw * ts, rh * ts);
    } else {
      drawRectPreviewTiles(ctx, rx, ry, rw, rh, ts);
    }

    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = editorStore.showCollision
      ? (isErasing ? '#ef4444' : '#3b82f6')
      : (isErasing ? '#ef4444' : '#8b5cf6');
    ctx.lineWidth = 2 / editorStore.zoom;
    ctx.setLineDash([6 / editorStore.zoom, 4 / editorStore.zoom]);
    ctx.strokeRect(rx * ts, ry * ts, rw * ts, rh * ts);
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Draw line mode preview
  if (isLineDragging && hoverX.value >= 0 && hoverY.value >= 0) {
    const points = bresenhamLine(
      lineStartX, lineStartY, hoverX.value, hoverY.value,
    );
    const isErasing = editorStore.selectedTool === 'eraser';
    ctx.save();

    if (editorStore.showCollision) {
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = isErasing ? '#f87171' : '#3b82f6';
      for (const p of points) {
        ctx.fillRect(p.x * ts, p.y * ts, ts, ts);
      }
    } else if (isErasing) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#f87171';
      for (const p of points) {
        ctx.fillRect(p.x * ts, p.y * ts, ts, ts);
      }
    } else {
      ctx.globalAlpha = 0.5;
      for (const p of points) {
        drawRectPreviewTiles(ctx, p.x, p.y, 1, 1, ts);
      }
    }

    // Dashed guide line from start to end
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = editorStore.showCollision
      ? (isErasing ? '#ef4444' : '#3b82f6')
      : (isErasing ? '#ef4444' : '#8b5cf6');
    ctx.lineWidth = 2 / editorStore.zoom;
    ctx.setLineDash([6 / editorStore.zoom, 4 / editorStore.zoom]);
    ctx.beginPath();
    ctx.moveTo(
      (lineStartX + 0.5) * ts, (lineStartY + 0.5) * ts,
    );
    ctx.lineTo(
      (hoverX.value + 0.5) * ts, (hoverY.value + 0.5) * ts,
    );
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Draw map selection with marching ants
  if (editorStore.mapSelection && !isMovingTiles) {
    const sel = editorStore.mapSelection;
    const sx = sel.x * ts;
    const sy = sel.y * ts;
    const sw = sel.w * ts;
    const sh = sel.h * ts;
    const lw = 2 / editorStore.zoom;
    const dash = 6 / editorStore.zoom;
    const gap = 4 / editorStore.zoom;

    ctx.save();
    ctx.lineWidth = lw;
    // White dashes
    ctx.strokeStyle = 'white';
    ctx.setLineDash([dash, gap]);
    ctx.lineDashOffset = -marchOffset / editorStore.zoom;
    ctx.strokeRect(sx, sy, sw, sh);
    // Black dashes (offset for contrast)
    ctx.strokeStyle = 'black';
    ctx.lineDashOffset = -(marchOffset + 5) / editorStore.zoom;
    ctx.strokeRect(sx, sy, sw, sh);
    ctx.setLineDash([]);
    ctx.restore();

    marchOffset = (marchOffset + 0.3) % 20;
  }

  animationId = requestAnimationFrame(render);
};

const drawWallQuadrants = (
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  quad: [number, number, number, number],
  destX: number,
  destY: number,
  ht: number,
  zoom = 1,
  snapEndX?: number,
  snapEndY?: number,
) => {
  const midX = Math.round((destX + ht) * zoom) / zoom;
  const midY = Math.round((destY + ht) * zoom) / zoom;
  const endX = snapEndX ?? Math.round((destX + ht * 2) * zoom) / zoom;
  const endY = snapEndY ?? Math.round((destY + ht * 2) * zoom) / zoom;
  const xs = [destX, midX] as const;
  const ys = [destY, midY] as const;
  const ws = [midX - destX, endX - midX] as const;
  const hs = [midY - destY, endY - midY] as const;
  for (let qi = 0; qi < 4; qi++) {
    const pos = quad[qi]!;
    const { srcX, srcY } = wallSubTileToPixels(pos, ht);
    const xi = qi % 2;
    const yi = Math.floor(qi / 2);
    ctx.drawImage(
      image, srcX, srcY, ht, ht,
      xs[xi]!, ys[yi]!, ws[xi]!, hs[yi]!,
    );
  }
};

const gridSnap = (gridCoord: number, ts: number, offset: number, zoom: number) =>
  Math.round((gridCoord * ts + offset) * zoom) / zoom;

const drawAutoTileCell = (
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  variant: [number, number, number, number],
  destX: number,
  destY: number,
  ts: number,
  type: AutoTileType = 'A',
  wv?: WallVariants,
  gridY?: number,
  gridH?: number,
  zoom = 1,
  gridX?: number,
) => {
  const ht = ts / 2;
  const toPixels = type === 'B' || type === 'C'
    ? subTileToPixelsB : subTileToPixels;
  const x1 = gridX !== undefined
    ? gridSnap(gridX, ts, ht, zoom)
    : Math.round((destX + ht) * zoom) / zoom;
  const y1 = gridY !== undefined
    ? gridSnap(gridY, ts, ht, zoom)
    : Math.round((destY + ht) * zoom) / zoom;
  const x2 = gridX !== undefined
    ? gridSnap(gridX + 1, ts, 0, zoom)
    : Math.round((destX + ts) * zoom) / zoom;
  const y2 = gridY !== undefined
    ? gridSnap(gridY + 1, ts, 0, zoom)
    : Math.round((destY + ts) * zoom) / zoom;
  const xs = [destX, x1] as const;
  const ys = [destY, y1] as const;
  const ws = [x1 - destX, x2 - x1] as const;
  const hs = [y1 - destY, y2 - y1] as const;
  for (let qi = 0; qi < 4; qi++) {
    const pos = variant[qi]!;
    const { srcX, srcY } = toPixels(pos, ht);
    const xi = qi % 2;
    const yi = Math.floor(qi / 2);
    ctx.drawImage(
      image, srcX, srcY, ht, ht,
      xs[xi]!, ys[yi]!, ws[xi]!, hs[yi]!,
    );
  }
  if (wv) {
    const wallUpperY = y2;
    const wallLowerY = gridY !== undefined
      ? gridSnap(gridY + 2, ts, 0, zoom)
      : Math.round((destY + ts * 2) * zoom) / zoom;
    const wallEndY = gridY !== undefined
      ? gridSnap(gridY + 3, ts, 0, zoom)
      : undefined;
    if (gridH === undefined || gridY === undefined
      || gridY + 1 < gridH) {
      drawWallQuadrants(
        ctx, image, wv.upper, destX, wallUpperY, ht, zoom, x2, wallLowerY,
      );
    }
    if (gridH === undefined || gridY === undefined
      || gridY + 2 < gridH) {
      drawWallQuadrants(
        ctx, image, wv.lower, destX, wallLowerY, ht, zoom, x2, wallEndY,
      );
    }
  }
};

const drawTileTransformed = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  srcX: number, srcY: number, srcW: number, srcH: number,
  dx: number, dy: number, dw: number, dh: number,
  flipX: boolean, flipY: boolean, rotation: 0 | 90 | 180 | 270,
) => {
  if (!flipX && !flipY && rotation === 0) {
    ctx.drawImage(img, srcX, srcY, srcW, srcH, dx, dy, dw, dh);
    return;
  }
  ctx.save();
  ctx.translate(dx + dw / 2, dy + dh / 2);
  if (rotation !== 0) ctx.rotate((rotation * Math.PI) / 180);
  if (flipX) ctx.scale(-1, 1);
  if (flipY) ctx.scale(1, -1);
  ctx.drawImage(img, srcX, srcY, srcW, srcH, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
};

/**
 * Map a destination cell (dx,dy) back to the source tile in
 * the original selection, accounting for flip and rotation.
 */
const selectionSourceCoord = (
  dx: number, dy: number,
  w: number, h: number,
  flipX: boolean, flipY: boolean,
  rotation: 0 | 90 | 180 | 270,
): { sx: number; sy: number } => {
  let sx: number;
  let sy: number;
  switch (rotation) {
    case 0: sx = dx; sy = dy; break;
    case 90: sx = dy; sy = h - 1 - dx; break;
    case 180: sx = w - 1 - dx; sy = h - 1 - dy; break;
    case 270: sx = w - 1 - dy; sy = dx; break;
  }
  if (flipX) sx = w - 1 - sx;
  if (flipY) sy = h - 1 - sy;
  return { sx, sy };
};

/** Effective placement dimensions after rotation. */
const effectiveDims = (
  w: number, h: number,
  rotation: 0 | 90 | 180 | 270,
): { ew: number; eh: number } => {
  return (rotation === 90 || rotation === 270)
    ? { ew: h, eh: w }
    : { ew: w, eh: h };
};

type DrawPass = 'all' | 'walls' | 'no-walls';

const drawLayerContent = (
  ctx: CanvasRenderingContext2D,
  layerIndex: number,
  layer: CellValue[][],
  rawAutoTilePool: AutoTileSlot[],
  ts: number,
  zoom = 1,
  pass: DrawPass = 'all',
) => {
  const snap = (n: number) => Math.round(n * zoom) / zoom;
  const snapSz = (a: number, b: number) =>
    (Math.round(b * zoom) - Math.round(a * zoom)) / zoom;
  for (let y = 0; y < layer.length; y++) {
    const row = layer[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) {
      const cell = row[x];
      if (!cell) continue;
      if (isRegularTile(cell)) {
        if (pass === 'walls') continue;
        const img = mapStore.getSlotImage(cell.slot);
        if (img) {
          const dx = snap(x * ts);
          const dy = snap(y * ts);
          const dw = snapSz(x * ts, (x + 1) * ts);
          const dh = snapSz(y * ts, (y + 1) * ts);
          drawTileTransformed(
            ctx, img,
            cell.x * ts, cell.y * ts, ts, ts,
            dx, dy, dw, dh,
            cell.flipX ?? false, cell.flipY ?? false, cell.rotation ?? 0,
          );
        }
      } else if (isAutoTile(cell)) {
        const atSlot = rawAutoTilePool[cell.autoTileIndex];
        if (!atSlot?.image) continue;
        const isWall = atSlot.type === 'C';
        if (pass === 'walls' && !isWall) continue;
        if (pass === 'no-walls' && isWall) continue;
        const variant = mapStore.getAutoTileVariant(
          layerIndex, x, y, cell.autoTileIndex, layer,
        );
        const wv = isWall
          ? mapStore.getWallVariant(
            layerIndex, x, y, cell.autoTileIndex, layer,
          )
          : undefined;
        drawAutoTileCell(
          ctx, atSlot.image, variant,
          snap(x * ts), snap(y * ts), ts, atSlot.type, wv,
          y, layer.length, zoom, x,
        );
      }
    }
  }
};

type Renderable = { y: number; draw: (c: CanvasRenderingContext2D) => void };

const collectPreviewRenderables = (
  layerIndex: number,
  layer: CellValue[][],
  rawAutoTilePool: AutoTileSlot[],
  ts: number,
  zoom: number,
): Renderable[] => {
  const snap = (n: number) => Math.round(n * zoom) / zoom;
  const snapSz = (a: number, b: number) =>
    (Math.round(b * zoom) - Math.round(a * zoom)) / zoom;
  const renderables: Renderable[] = [];
  const mh = mapStore.height;
  for (let y = 0; y < layer.length; y++) {
    const row = layer[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) {
      const cell = row[x];
      if (!cell) continue;
      const tileX = x;
      const tileY = y;
      if (isRegularTile(cell)) {
        const img = mapStore.getSlotImage(cell.slot);
        if (!img) continue;
        const depth = mapStore.getTileDepth(cell.slot, cell.x, cell.y);
        let sortY: number;
        if (depth === -1) {
          sortY = -1;
        } else if (depth === 2) {
          sortY = mh * ts + ts + 1;
        } else if (depth === 1) {
          sortY = tileY * ts + ts * 2 - 1;
        } else {
          sortY = tileY * ts + ts;
        }
        const { flipX, flipY, rotation } = cell;
        renderables.push({
          y: sortY,
          draw: (c) => {
            drawTileTransformed(
              c, img,
              cell.x * ts, cell.y * ts, ts, ts,
              snap(tileX * ts), snap(tileY * ts),
              snapSz(tileX * ts, (tileX + 1) * ts),
              snapSz(tileY * ts, (tileY + 1) * ts),
              flipX ?? false, flipY ?? false, rotation ?? 0,
            );
          },
        });
      } else if (isAutoTile(cell)) {
        const atSlot = rawAutoTilePool[cell.autoTileIndex];
        if (!atSlot?.image) continue;
        const atImg = atSlot.image;
        const atType = atSlot.type;
        const atDepth = mapStore.getAutoTileDepth(cell.autoTileIndex);
        const variant = mapStore.getAutoTileVariant(
          layerIndex, tileX, tileY, cell.autoTileIndex, layer,
        );
        const wv = atType === 'C'
          ? mapStore.getWallVariant(layerIndex, tileX, tileY, cell.autoTileIndex, layer)
          : undefined;
        let sortY: number;
        if (atDepth === -1 || (atDepth === 0 && atType === 'C')) {
          sortY = -1;
        } else if (atDepth === 2) {
          sortY = mh * ts + ts + 1;
        } else if (atDepth === 1) {
          sortY = tileY * ts + ts * 2 - 1;
        } else {
          sortY = tileY * ts + ts;
        }
        renderables.push({
          y: sortY,
          draw: (c) => {
            drawAutoTileCell(
              c, atImg, variant,
              snap(tileX * ts), snap(tileY * ts),
              ts, atType, wv,
              tileY, mh, zoom, tileX,
            );
          },
        });
      }
    }
  }
  return renderables;
};

let offscreenCanvas: OffscreenCanvas | null = null;

const drawLayer = (
  ctx: CanvasRenderingContext2D,
  layerIndex: number,
  rawLayers: TileLayer[],
  rawLayerMeta: LayerMeta[],
  rawAutoTilePool: AutoTileSlot[],
  ts: number,
  pass: DrawPass = 'all',
) => {
  const meta = rawLayerMeta[layerIndex];
  if (meta && !meta.visible) return;
  const layer = rawLayers[layerIndex];
  if (!layer) return;

  const activeLayer = editorStore.activeLayer;
  const isActive = layerIndex === activeLayer;
  const alpha = editorStore.previewMode || isActive ? 1.0
    : layerIndex < activeLayer ? 0.4 : 0.3;

  if (isActive || editorStore.previewMode) {
    ctx.save();
    ctx.globalAlpha = 1.0;
    ctx.filter = 'none';
    drawLayerContent(
      ctx, layerIndex, layer, rawAutoTilePool, ts, editorStore.zoom, pass,
    );
    ctx.restore();
    return;
  }

  const mapW = mapStore.width * ts;
  const mapH = mapStore.height * ts;
  if (!offscreenCanvas
    || offscreenCanvas.width !== mapW
    || offscreenCanvas.height !== mapH) {
    offscreenCanvas = new OffscreenCanvas(mapW, mapH);
  }
  const offCtx = offscreenCanvas.getContext('2d');
  if (!offCtx) return;
  offCtx.clearRect(0, 0, mapW, mapH);
  offCtx.imageSmoothingEnabled = false;

  drawLayerContent(
    offCtx as unknown as CanvasRenderingContext2D,
    layerIndex, layer, rawAutoTilePool, ts, 1, pass,
  );

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.filter = 'none';
  ctx.drawImage(offscreenCanvas, 0, 0);
  ctx.restore();
};

const drawCollisionOverlay = (
  ctx: CanvasRenderingContext2D,
  rawCollisionGrid: boolean[][],
  ts: number,
) => {
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = '#3b82f6';
  ctx.filter = 'none';
  for (let y = 0; y < rawCollisionGrid.length; y++) {
    const row = rawCollisionGrid[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) {
      if (row[x]) {
        ctx.fillRect(x * ts, y * ts, ts, ts);
      }
    }
  }
  ctx.restore();
};

const drawDirCollisionOverlay = (
  ctx: CanvasRenderingContext2D,
  dirGrid: number[][],
  ts: number,
) => {
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = '#ef4444';
  const cx = ts / 2;
  const cy = ts / 2;
  for (let y = 0; y < dirGrid.length; y++) {
    const row = dirGrid[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) {
      const mask = row[x];
      if (!mask) continue;
      const px = x * ts;
      const py = y * ts;
      if (mask & DIR_UP) {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + ts, py);
        ctx.lineTo(px + cx, py + cy);
        ctx.closePath();
        ctx.fill();
      }
      if (mask & DIR_RIGHT) {
        ctx.beginPath();
        ctx.moveTo(px + ts, py);
        ctx.lineTo(px + ts, py + ts);
        ctx.lineTo(px + cx, py + cy);
        ctx.closePath();
        ctx.fill();
      }
      if (mask & DIR_DOWN) {
        ctx.beginPath();
        ctx.moveTo(px, py + ts);
        ctx.lineTo(px + ts, py + ts);
        ctx.lineTo(px + cx, py + cy);
        ctx.closePath();
        ctx.fill();
      }
      if (mask & DIR_LEFT) {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px, py + ts);
        ctx.lineTo(px + cx, py + cy);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  ctx.restore();
};

const DIRECTION_ARROWS: Record<string, string> = {
  up: '\u25B2',
  down: '\u25BC',
  left: '\u25C0',
  right: '\u25B6',
};

const objectEmojiMap = new Map<string, string>(
  OBJECT_TYPES.map(t => [t.value, t.emoji]),
);

const drawObjects = (
  ctx: CanvasRenderingContext2D,
  rawObjects: InteractiveObject[],
  ts: number,
) => {
  const layerCount = mapStore.layers.length;
  const isActive = editorStore.activeLayer >= layerCount;

  ctx.save();
  ctx.globalAlpha = isActive || editorStore.previewMode ? 1.0 : 0.3;

  for (const obj of rawObjects) {
    const px = obj.x * ts;
    const py = obj.y * ts;

    ctx.fillStyle = obj.id.startsWith('tile-')
      ? 'rgba(234, 179, 8, 0.35)'   // yellowish — derived from tile
      : 'rgba(59, 130, 246, 0.35)'; // blue — manually placed
    ctx.fillRect(px, py, ts, ts);

    const emoji = objectEmojiMap.get(obj.type) ?? '?';
    const fontSize = Math.max(12, ts * 0.55);
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(emoji, px + ts / 2, py + ts * 0.42);

    if (isActive) {
      const arrow = DIRECTION_ARROWS[obj.direction] ?? '';
      ctx.font = `bold ${Math.max(8, ts * 0.25)}px sans-serif`;
      ctx.fillStyle = '#93c5fd';
      ctx.fillText(arrow, px + ts / 2, py + ts * 0.82);
    }
  }

  ctx.restore();
};

const drawSpawnMarkers = (
  ctx: CanvasRenderingContext2D,
  rawSpawnPoints: SpawnPoint[],
  ts: number,
) => {
  ctx.save();
  ctx.globalAlpha = 0.85;

  for (const sp of rawSpawnPoints) {
    const cx = sp.x * ts + ts / 2;
    const cy = sp.y * ts + ts / 2;
    const r = ts * 0.35;

    // Green filled circle
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // White border
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2 / editorStore.zoom;
    ctx.stroke();

    // Person silhouette (head + body)
    ctx.fillStyle = '#fff';
    const headR = r * 0.28;
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.18, headR, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.32, r * 0.4, Math.PI, 0);
    ctx.fill();
  }

  ctx.restore();
};

const isDrawing = ref(false);
const hoverX = ref(-1);
const hoverY = ref(-1);

const handleWheel = (e: WheelEvent) => {
  e.preventDefault();
  if (!canvas.value) return;

  const dx = normalizeWheelDelta(e.deltaX, e.deltaMode);
  const dy = normalizeWheelDelta(e.deltaY, e.deltaMode);

  if (e.ctrlKey) {
    // Trackpad pinch-to-zoom (5× sensitivity vs mouse wheel)
    const rect = canvas.value.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = Math.exp(-dy * 0.0075);
    editorStore.setZoom(editorStore.zoom * factor, cx, cy);
  } else if (e.shiftKey) {
    // Shift+scroll → swap axes pan
    editorStore.setPan(
      editorStore.panX - dy,
      editorStore.panY - dx,
    );
  } else if (dx !== 0) {
    // Two-finger trackpad scroll → pan both axes
    editorStore.setPan(
      editorStore.panX - dx,
      editorStore.panY - dy,
    );
  } else {
    // Mouse wheel (vertical only) → zoom
    const rect = canvas.value.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = Math.exp(-dy * 0.0015);
    editorStore.setZoom(editorStore.zoom * factor, cx, cy);
  }
};

const handlePointerDown = (e: PointerEvent) => {
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  if (e.button === 1) {
    isPanning = true;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    e.preventDefault();
    return;
  }

  const isPickActive = isCKeyHeld || editorStore.selectedTool === 'pick';

  if (
    e.button === 2
    || (e.button === 0 && isPickActive)
  ) {
    const { x, y } = getGridCoord(e);
    isRightDragging = true;
    rightDragStartX = x;
    rightDragStartY = y;
    return;
  }

  if (e.button === 0 && isSpaceHeld) {
    isPanning = true;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    e.preventDefault();
    return;
  }

  if (e.button !== 0) return;

  // Grid border resize
  if (!isPickActive) {
    const edge = detectResizeEdge(e);
    if (edge) {
      isResizing = true;
      resizeEdge = edge;
      resizePreviewLeft = 0;
      resizePreviewTop = 0;
      resizePreviewRight = mapStore.width;
      resizePreviewBottom = mapStore.height;
      edgeCursor.value = cursorForEdge(edge);
      e.preventDefault();
      return;
    }
  }

  const { x, y } = getGridCoord(e);
  const currentTool = editorStore.selectedTool;

  // Select / Move tool handling
  if (currentTool === 'select' || currentTool === 'move') {
    if (editorStore.mapSelection && isInsideSelection(x, y)) {
      // Start moving the selection
      moveSnapshotBefore = undoStore.captureSnapshot();
      const sel = editorStore.mapSelection;
      moveTiles = copyTilesFromMap(sel.x, sel.y, sel.w, sel.h);
      clearTilesOnMap(sel.x, sel.y, sel.w, sel.h);
      moveGrabOffsetX = x - sel.x;
      moveGrabOffsetY = y - sel.y;
      moveCurrentX = sel.x;
      moveCurrentY = sel.y;
      isMovingTiles = true;
    } else {
      // Start new selection (clear old one)
      editorStore.clearMapSelection();
      isSelecting = true;
      selectStartX = x;
      selectStartY = y;
      editorStore.setMapSelection({ x, y, w: 1, h: 1 });
    }
    return;
  }

  // Spawn tool handling — toggle add/remove
  if (currentTool === 'spawn') {
    const before = mapStore.spawnPoints.map(s => ({ ...s }));
    const existing = mapStore.spawnPoints.find(
      sp => sp.x === x && sp.y === y,
    );
    if (existing) {
      mapStore.removeSpawnPointAt(x, y);
    } else {
      mapStore.addSpawnPoint(x, y);
    }
    undoStore.push({
      label: 'Spawn',
      patch: {
        kind: 'spawns',
        before,
        after: mapStore.spawnPoints.map(s => ({ ...s })),
      },
    });
    return;
  }

  // Rectangle mode: start drag for pen or eraser
  if (
    editorStore.rectMode
    && (currentTool === 'pen' || currentTool === 'eraser')
  ) {
    isRectDragging = true;
    rectStartX = x;
    rectStartY = y;
    return;
  }

  // Line mode: start drag for pen or eraser
  if (
    editorStore.lineMode
    && (currentTool === 'pen' || currentTool === 'eraser')
  ) {
    isLineDragging = true;
    lineStartX = x;
    lineStartY = y;
    return;
  }

  // Eraser removes spawn points too
  if (currentTool === 'eraser') {
    mapStore.removeSpawnPointAt(x, y);
  }

  // Clear map selection when switching to other tools and clicking
  if (editorStore.mapSelection) {
    editorStore.clearMapSelection();
  }

  if (editorStore.showCollision) {
    if (currentTool === 'fill') {
      const snap = undoStore.captureSnapshot();
      const row = mapStore.collisionGrid[y];
      const current = row ? (row[x] ?? false) : false;
      mapStore.fillCollision(x, y, !current);
      undoStore.push({
        label: 'Collision Fill',
        patch: {
          kind: 'snapshot',
          before: snap,
          after: undoStore.captureSnapshot(),
        },
      });
    } else {
      undoStore.beginCollisionBatch('Collision');
      isDrawing.value = true;
      handleCollisionDraw(e);
    }
    return;
  }

  if (editorStore.showDirCollision) {
    undoStore.beginDirCollisionBatch('Dir Collision');
    isDrawing.value = true;
    handleDirCollisionDraw(e);
    return;
  }

  if (currentTool === 'fill') {
    if (editorStore.activeLayer < mapStore.layers.length) {
      const snap = undoStore.captureSnapshot();
      const adj = autoExpandForDraw(x, y);
      if (editorStore.selectedSelection) {
        const sel = editorStore.selectedSelection;
        mapStore.fillLayerWithPattern(
          editorStore.activeLayer,
          adj.x, adj.y,
          sel,
          editorStore.tileFlipX,
          editorStore.tileFlipY,
          editorStore.tileRotation,
        );
      } else {
        let fillValue: CellValue = null;
        if (editorStore.selectedAutoTile) {
          fillValue = {
            autoTileIndex:
              editorStore.selectedAutoTile.autoTileIndex,
          };
        } else if (editorStore.selectedTile) {
          fillValue = {
            ...editorStore.selectedTile,
            flipX: editorStore.tileFlipX,
            flipY: editorStore.tileFlipY,
            rotation: editorStore.tileRotation,
          };
        }
        mapStore.fillLayer(
          editorStore.activeLayer,
          adj.x, adj.y,
          fillValue,
        );
        if (!fillValue) autoShrinkAfterErase();
      }
      undoStore.push({
        label: 'Fill',
        patch: {
          kind: 'snapshot',
          before: snap,
          after: undoStore.captureSnapshot(),
        },
      });
    }
  } else if (
    editorStore.activeLayer >= mapStore.layers.length
    && currentTool === 'pen'
  ) {
    const existing = mapStore.objects.find(
      o => o.x === x && o.y === y,
    );
    editorStore.openDialog(
      x, y,
      existing?.type,
      existing?.direction,
    );
  } else {
    if (editorStore.activeLayer < mapStore.layers.length) {
      undoStore.beginBatch(
        currentTool === 'eraser' ? 'Erase' : 'Paint',
        editorStore.activeLayer,
      );
    }
    isDrawing.value = true;
    isInitialPlacement = true;
    handleDraw(e);
  }
};

const handlePointerMove = (e: PointerEvent) => {
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  if (isPanning) {
    const dx = e.clientX - lastPanX;
    const dy = e.clientY - lastPanY;
    editorStore.setPan(
      editorStore.panX + dx,
      editorStore.panY + dy,
    );
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    return;
  }

  const { x, y } = getGridCoord(e);
  hoverX.value = x;
  hoverY.value = y;

  if (isResizing) {
    updateResizePreview(e);
    return;
  }

  if (isRightDragging || isRectDragging || isLineDragging) {
    return;
  }

  if (isSelecting) {
    const minX = Math.min(selectStartX, x);
    const minY = Math.min(selectStartY, y);
    const maxX = Math.max(selectStartX, x);
    const maxY = Math.max(selectStartY, y);
    editorStore.setMapSelection({
      x: minX,
      y: minY,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
    });
    return;
  }

  if (isMovingTiles) {
    moveCurrentX = x - moveGrabOffsetX;
    moveCurrentY = y - moveGrabOffsetY;
    return;
  }

  if (isDrawing.value) {
    if (editorStore.showCollision) {
      handleCollisionDraw(e);
    } else if (editorStore.showDirCollision) {
      handleDirCollisionDraw(e);
    } else {
      handleDraw(e);
    }
  }

  // Edge hover detection for resize cursor
  if (!isDrawing.value) {
    edgeCursor.value = cursorForEdge(detectResizeEdge(e));
  } else {
    edgeCursor.value = null;
  }
};

// Tracks the toggle direction for the current collision drag (pen mode)
let collisionDragValue: boolean | null = null;

const handleCollisionDraw = (e: MouseEvent) => {
  const { x, y } = getGridCoord(e);
  if (x < 0 || x >= mapStore.width || y < 0 || y >= mapStore.height) return;

  if (editorStore.selectedTool === 'eraser') {
    const row = mapStore.collisionGrid[y];
    const before = row ? (row[x] ?? false) : false;
    mapStore.setCollision(x, y, false);
    undoStore.recordCollisionCell(x, y, before, false);
  } else if (editorStore.selectedTool === 'pen') {
    if (collisionDragValue === null) {
      const row = mapStore.collisionGrid[y];
      collisionDragValue = row ? !row[x] : true;
    }
    const row = mapStore.collisionGrid[y];
    const before = row ? (row[x] ?? false) : false;
    mapStore.setCollision(x, y, collisionDragValue);
    undoStore.recordCollisionCell(x, y, before, collisionDragValue);
  }
};

/** Determine which direction bit was clicked based on quadrant */
const getDirBitFromQuadrant = (
  e: MouseEvent, gx: number, gy: number,
): number => {
  const cvs = canvas.value;
  if (!cvs) return 0;
  const rect = cvs.getBoundingClientRect();
  const ts = mapStore.tileSize * editorStore.zoom;
  const px = (e.clientX - rect.left - editorStore.panX) - gx * ts;
  const py = (e.clientY - rect.top - editorStore.panY) - gy * ts;
  const relX = px / ts - 0.5;
  const relY = py / ts - 0.5;
  if (Math.abs(relX) > Math.abs(relY)) {
    return relX > 0 ? DIR_RIGHT : DIR_LEFT;
  }
  return relY > 0 ? DIR_DOWN : DIR_UP;
};

const handleDirCollisionDraw = (e: MouseEvent) => {
  const { x, y } = getGridCoord(e);
  if (x < 0 || x >= mapStore.width || y < 0 || y >= mapStore.height) return;
  const bit = getDirBitFromQuadrant(e, x, y);
  if (!bit) return;
  const before = mapStore.getDirCollision(x, y);
  if (editorStore.selectedTool === 'eraser') {
    const after = before & ~bit;
    mapStore.setDirCollision(x, y, after);
    undoStore.recordDirCollisionCell(x, y, before, after);
  } else {
    const after = before ^ bit;
    mapStore.setDirCollision(x, y, after);
    undoStore.recordDirCollisionCell(x, y, before, after);
  }
};

/** Read current cell from layer for undo recording */
const readCell = (li: number, gx: number, gy: number): CellValue => {
  const cell = mapStore.layers[li]?.[gy]?.[gx] ?? null;
  return cell ? { ...cell } : null;
};

/** Record cells in a region before a fillRect, then do the fill */
const fillRectWithUndo = (
  li: number, ox: number, oy: number,
  w: number, h: number,
  getTile: (dx: number, dy: number) => CellValue,
) => {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const gx = ox + dx;
      const gy = oy + dy;
      const before = readCell(li, gx, gy);
      const after = getTile(dx, dy);
      undoStore.recordCell(gx, gy, before, after);
    }
  }
  mapStore.fillRect(li, ox, oy, w, h, getTile);
};

/** Record a single cell write */
const setTileWithUndo = (
  li: number, gx: number, gy: number, tile: CellValue,
) => {
  const before = readCell(li, gx, gy);
  undoStore.recordCell(gx, gy, before, tile);
  mapStore.setTile(li, gx, gy, tile);
};

const handleDraw = (e: MouseEvent) => {
  let { x, y } = getGridCoord(e);

  if (editorStore.activeLayer >= mapStore.layers.length) {
    if (editorStore.selectedTool === 'eraser') {
      const hasObject = mapStore.objects.some(o => o.x === x && o.y === y);
      if (hasObject) {
        const objsBefore = mapStore.objects.map(o => ({ ...o }));
        const colBefore = mapStore.collisionGrid.map(r => [...r]);
        mapStore.removeObjectAt(x, y);
        undoStore.push({
          label: 'Erase Object',
          patch: {
            kind: 'objects',
            before: objsBefore,
            after: mapStore.objects.map(o => ({ ...o })),
            collisionBefore: colBefore,
            collisionAfter: mapStore.collisionGrid.map(r => [...r]),
          },
        });
      }
    }
    return;
  }

  const li = editorStore.activeLayer;

  if (editorStore.selectedTool === 'pen') {
    if (pickedBrush.value) {
      const brush = pickedBrush.value;
      const bw = brush[0]?.length ?? 1;
      const bh = brush.length;
      if (isInitialPlacement) {
        isInitialPlacement = false;
        multiTileAnchorX = x;
        multiTileAnchorY = y;
      }
      const adj = autoExpandForDraw(x, y, bw, bh);
      // Shift anchor if map expanded left/top
      multiTileAnchorX += adj.x - x;
      multiTileAnchorY += adj.y - y;
      fillRectWithUndo(
        li, adj.x, adj.y, bw, bh,
        (dx, dy) => {
          const oX = ((adj.x - multiTileAnchorX + dx) % bw + bw) % bw;
          const oY = ((adj.y - multiTileAnchorY + dy) % bh + bh) % bh;
          return brush[oY]?.[oX] ?? null;
        },
      );
    } else if (editorStore.selectedSelection) {
      const { x: tx, y: ty, w, h, slot } = editorStore.selectedSelection;
      const fX = editorStore.tileFlipX;
      const fY = editorStore.tileFlipY;
      const rot = editorStore.tileRotation;
      const { ew, eh } = effectiveDims(w, h, rot);
      if (isInitialPlacement) {
        isInitialPlacement = false;
        multiTileAnchorX = x;
        multiTileAnchorY = y;
      }
      const adj = autoExpandForDraw(x, y, ew, eh);
      multiTileAnchorX += adj.x - x;
      multiTileAnchorY += adj.y - y;
      fillRectWithUndo(
        li, adj.x, adj.y, ew, eh,
        (dx, dy) => {
          const oX = ((adj.x - multiTileAnchorX + dx) % ew + ew) % ew;
          const oY = ((adj.y - multiTileAnchorY + dy) % eh + eh) % eh;
          const { sx, sy } = selectionSourceCoord(
            oX, oY, w, h, fX, fY, rot,
          );
          return {
            x: tx + sx, y: ty + sy, slot,
            flipX: fX, flipY: fY, rotation: rot,
          };
        },
      );
    } else if (editorStore.selectedAutoTile) {
      const adj = autoExpandForDraw(x, y);
      x = adj.x;
      y = adj.y;
      setTileWithUndo(
        li, x, y,
        { autoTileIndex: editorStore.selectedAutoTile.autoTileIndex },
      );
    } else if (editorStore.selectedTile) {
      const adj = autoExpandForDraw(x, y);
      x = adj.x;
      y = adj.y;
      setTileWithUndo(li, x, y, {
        ...editorStore.selectedTile,
        flipX: editorStore.tileFlipX,
        flipY: editorStore.tileFlipY,
        rotation: editorStore.tileRotation,
      });
    }
  } else if (editorStore.selectedTool === 'eraser') {
    const ew = eraserBrushW.value;
    const eh = eraserBrushH.value;
    if (ew > 1 || eh > 1) {
      const adj = autoExpandForDraw(x, y, ew, eh);
      fillRectWithUndo(li, adj.x, adj.y, ew, eh, () => null);
    } else {
      setTileWithUndo(li, x, y, null);
    }
  }
};

const pickTileAtCursor = (e: MouseEvent) => {
  pickedBrush.value = null;
  const { x, y } = getGridCoord(e);

  if (editorStore.showCollision) {
    const row = mapStore.collisionGrid[y];
    const hasCollision = row ? (row[x] ?? false) : false;
    editorStore.setTool(hasCollision ? 'pen' : 'eraser');
    return;
  }

  if (editorStore.showDirCollision) {
    const mask = mapStore.getDirCollision(x, y);
    editorStore.setTool(mask ? 'pen' : 'eraser');
    return;
  }

  const layerIdx = editorStore.activeLayer;
  const cell = mapStore.layers[layerIdx]?.[y]?.[x] ?? null;
  if (isAutoTile(cell)) {
    editorStore.setSelectedAutoTile(
      { autoTileIndex: cell.autoTileIndex },
    );
    editorStore.setTool('pen');
  } else if (isRegularTile(cell)) {
    editorStore.activeSlot = cell.slot;
    editorStore.setSelectedTile({ ...cell });
    editorStore.selectionPulse++;
    editorStore.setTool('pen');
  } else {
    eraserBrushW.value = 1;
    eraserBrushH.value = 1;
    editorStore.setTool('eraser');
  }
};

const handlePointerUp = (e: PointerEvent) => {
  if (e.button === 1) {
    isPanning = false;
    return;
  }

  if (e.button === 2) {
    isRightDragging = false;
    const { x, y } = getGridCoord(e);
    if (x === rightDragStartX && y === rightDragStartY) {
      pickTileAtCursor(e);
    } else {
      pickTilesFromMap(e);
    }
    return;
  }

  if (isPanning) {
    isPanning = false;
    return;
  }

  if (isResizing) {
    isResizing = false;
    const srcX = resizePreviewLeft;
    const srcY = resizePreviewTop;
    const nw = resizePreviewRight - resizePreviewLeft;
    const nh = resizePreviewBottom - resizePreviewTop;
    resizeEdge = null;
    edgeCursor.value = null;

    if (
      nw !== mapStore.width || nh !== mapStore.height
      || srcX !== 0 || srcY !== 0
    ) {
      const snap = undoStore.captureSnapshot();
      mapStore.resizeToRect(srcX, srcY, nw, nh);
      const ts = mapStore.tileSize;
      editorStore.setPan(
        editorStore.panX + srcX * ts * editorStore.zoom,
        editorStore.panY + srcY * ts * editorStore.zoom,
      );
      undoStore.push({
        label: 'Resize',
        patch: {
          kind: 'snapshot',
          before: snap,
          after: undoStore.captureSnapshot(),
        },
      });
    }
    return;
  }

  if (isRightDragging) {
    isRightDragging = false;
    const { x, y } = getGridCoord(e);
    if (x === rightDragStartX && y === rightDragStartY) {
      pickTileAtCursor(e);
    } else {
      pickTilesFromMap(e);
    }
    return;
  }

  if (isRectDragging) {
    isRectDragging = false;
    const snap = undoStore.captureSnapshot();
    commitRectangle(e);
    undoStore.push({
      label: 'Rectangle',
      patch: {
        kind: 'snapshot',
        before: snap,
        after: undoStore.captureSnapshot(),
      },
    });
    return;
  }

  if (isLineDragging) {
    isLineDragging = false;
    const snap = undoStore.captureSnapshot();
    commitLine(e);
    undoStore.push({
      label: 'Line',
      patch: {
        kind: 'snapshot',
        before: snap,
        after: undoStore.captureSnapshot(),
      },
    });
    return;
  }

  if (isSelecting) {
    isSelecting = false;
    return;
  }

  if (isMovingTiles && moveTiles) {
    const adj = placeTilesOnMap(moveTiles, moveCurrentX, moveCurrentY);
    editorStore.setMapSelection({
      x: adj.x,
      y: adj.y,
      w: moveTiles[0]?.length ?? 0,
      h: moveTiles.length,
    });
    undoStore.push({
      label: 'Move',
      patch: {
        kind: 'snapshot',
        before: moveSnapshotBefore!,
        after: undoStore.captureSnapshot(),
      },
    });
    moveTiles = null;
    isMovingTiles = false;
    return;
  }

  const wasErasing = editorStore.selectedTool === 'eraser';
  isDrawing.value = false;
  collisionDragValue = null;
  undoStore.commitBatch();
  if (wasErasing) autoShrinkAfterErase();
};

const handleContextMenu = (e: MouseEvent) => {
  e.preventDefault();
};

const handlePointerLeave = () => {
  hoverX.value = -1;
  hoverY.value = -1;
  if (!isDrawing.value && !isPanning && !isResizing) {
    edgeCursor.value = null;
  }
};

const handleKeyDown = (e: KeyboardEvent) => {
  if (e.repeat) return;
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return;
  }

  if (e.key === ' ') {
    isSpaceHeld = true;
    isPanning = true;
    lastPanX = lastMouseX;
    lastPanY = lastMouseY;
    e.preventDefault();
    return;
  }

  if (e.key === 'c' && !e.metaKey && !e.ctrlKey) {
    isCKeyHeld = true;
    editorStore.setTool('pick');
    return;
  }

  // Tool switching (ignore when typing in inputs)
  if (!e.metaKey && !e.ctrlKey && !e.altKey) {
    switch (e.key) {
      case 'q':
        editorStore.setTool('pen');
        editorStore.rectMode = false;
        editorStore.lineMode = false;
        return;
      case 'w':
        editorStore.setTool('eraser');
        editorStore.rectMode = false;
        editorStore.lineMode = false;
        return;
      case 'e':
        editorStore.setTool('fill');
        editorStore.rectMode = false;
        editorStore.lineMode = false;
        return;
      case 'a':
        editorStore.rectMode = !editorStore.rectMode;
        editorStore.lineMode = false;
        if (
          editorStore.rectMode
          && editorStore.selectedTool !== 'pen'
          && editorStore.selectedTool !== 'eraser'
        ) {
          editorStore.setTool('pen');
        }
        return;
      case 's':
        editorStore.lineMode = !editorStore.lineMode;
        editorStore.rectMode = false;
        if (
          editorStore.lineMode
          && editorStore.selectedTool !== 'pen'
          && editorStore.selectedTool !== 'eraser'
        ) {
          editorStore.setTool('pen');
        }
        return;
      case 't':
        editorStore.showCollision = !editorStore.showCollision;
        if (editorStore.showCollision) {
          editorStore.showDirCollision = false;
          editorStore.clearMultiSelections();
        }
        return;
      case 'y':
        editorStore.showDirCollision = !editorStore.showDirCollision;
        if (editorStore.showDirCollision) {
          editorStore.showCollision = false;
          editorStore.clearMultiSelections();
        }
        return;
      case 'x': {
        const loadedAT = mapStore.autoTilePool
          .map((slot, i) => ({ slot, i }))
          .filter(({ slot }) => slot.image !== null);
        if (loadedAT.length === 0) return;
        const curIdx = editorStore.selectedAutoTile?.autoTileIndex ?? -1;
        const pos = loadedAT.findIndex(({ i }) => i === curIdx);
        const next = loadedAT[(pos + 1) % loadedAT.length]!;
        editorStore.setSelectedAutoTile({ autoTileIndex: next.i });
        return;
      }
      case 'y': {
        const loadedSlots = Object.keys(mapStore.tilesetPool)
          .sort()
          .filter((k) => mapStore.tilesetPool[k]?.image !== null);
        if (loadedSlots.length === 0) return;
        const cur = loadedSlots.indexOf(editorStore.activeSlot);
        const next = loadedSlots[(cur + 1) % loadedSlots.length]!;
        editorStore.activeSlot = next;
        return;
      }
      case 'g':
        editorStore.showGrid = !editorStore.showGrid;
        return;
      case 'f':
        editorStore.toggleFlipX();
        return;
      case 'v':
        editorStore.toggleFlipY();
        return;
      case 'r':
        editorStore.rotateTile();
        return;
      default: break;
    }
  }

  // Selection shortcuts (select/move tools only)
  if (e.key === 'Escape' && (
    pickedBrush.value
    || editorStore.selectedTile
    || editorStore.selectedSelection
    || editorStore.selectedAutoTile
  )) {
    pickedBrush.value = null;
    editorStore.selectedTile = null;
    editorStore.selectedSelection = null;
    editorStore.selectedAutoTile = null;
    eraserBrushW.value = 1;
    eraserBrushH.value = 1;
    editorStore.setTool('eraser');
    e.preventDefault();
    return;
  }

  const currentTool = editorStore.selectedTool;
  if (currentTool !== 'select' && currentTool !== 'move') return;

  if (e.key === 'Escape') {
    editorStore.clearMapSelection();
    e.preventDefault();
    return;
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    const sel = editorStore.mapSelection;
    if (sel) {
      const snap = undoStore.captureSnapshot();
      clearTilesOnMap(sel.x, sel.y, sel.w, sel.h);
      autoShrinkAfterErase();
      undoStore.push({
        label: 'Delete',
        patch: {
          kind: 'snapshot',
          before: snap,
          after: undoStore.captureSnapshot(),
        },
      });
      editorStore.clearMapSelection();
      e.preventDefault();
    }
    return;
  }

  if (e.key === 'c' && (e.metaKey || e.ctrlKey)) {
    const sel = editorStore.mapSelection;
    if (sel) {
      editorStore.clipboard = copyTilesFromMap(
        sel.x, sel.y, sel.w, sel.h,
      );
      e.preventDefault();
    }
    return;
  }

  if (e.key === 'v' && (e.metaKey || e.ctrlKey)) {
    const clip = editorStore.clipboard;
    if (clip && clip.length > 0) {
      const snap = undoStore.captureSnapshot();
      const sel = editorStore.mapSelection;
      const px = sel ? sel.x + 1 : 0;
      const py = sel ? sel.y + 1 : 0;
      const adj = placeTilesOnMap(clip, px, py);
      editorStore.setMapSelection({
        x: adj.x,
        y: adj.y,
        w: clip[0]?.length ?? 0,
        h: clip.length,
      });
      undoStore.push({
        label: 'Paste',
        patch: {
          kind: 'snapshot',
          before: snap,
          after: undoStore.captureSnapshot(),
        },
      });
      e.preventDefault();
    }
    return;
  }
};

const handleKeyUp = (e: KeyboardEvent) => {
  if (e.key === ' ') {
    isSpaceHeld = false;
    if (isPanning) isPanning = false;
  }
  if (e.key === 'c') {
    isCKeyHeld = false;
  }
};

const resizeCanvas = () => {
  if (canvas.value && canvas.value.parentElement) {
    const parent = canvas.value.parentElement;
    const dpr = window.devicePixelRatio;
    canvas.value.width = Math.round(parent.clientWidth * dpr);
    canvas.value.height = Math.round(parent.clientHeight * dpr);
    canvas.value.style.width = parent.clientWidth + 'px';
    canvas.value.style.height = parent.clientHeight + 'px';
  }
};

watch(
  () => [mapStore.width, mapStore.height, mapStore.tileSize],
  resizeCanvas,
);

onMounted(() => {
  mapStore.clearCaches();
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  resizeCanvas();
  render();
});

onUnmounted(() => {
  window.removeEventListener('resize', resizeCanvas);
  window.removeEventListener('keydown', handleKeyDown);
  window.removeEventListener('keyup', handleKeyUp);
  cancelAnimationFrame(animationId);
});
</script>

<template>
  <div class="w-full h-full bg-gray-950 overflow-hidden relative">
    <canvas
      ref="canvas"
      class="block"
      style="image-rendering: pixelated"
      :style="{ cursor: canvasCursor }"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerUp"
      @pointerleave="handlePointerLeave"
      @wheel.prevent="handleWheel"
      @contextmenu="handleContextMenu"
    />
  </div>
</template>
