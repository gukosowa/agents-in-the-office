import { defineStore } from 'pinia';
import { ref, computed, toRaw } from 'vue';
import type {
  TileLayer, CellValue, InteractiveObject,
  LayerMeta, SpawnPoint,
} from '../types';
import {
  useMapStore,
  createEmptyLayer,
} from './mapStore';

// --- Patch types (discriminated union) ---

export interface TilePatch {
  kind: 'tiles';
  layerIndex: number;
  cells: Map<string, { before: CellValue; after: CellValue }>;
}

export interface CollisionPatch {
  kind: 'collision';
  cells: Map<string, { before: boolean; after: boolean }>;
}

export interface ObjectsPatch {
  kind: 'objects';
  before: InteractiveObject[];
  after: InteractiveObject[];
  collisionBefore: boolean[][];
  collisionAfter: boolean[][];
}

export interface SpawnsPatch {
  kind: 'spawns';
  before: SpawnPoint[];
  after: SpawnPoint[];
}

export interface LayerAddPatch {
  kind: 'layerAdd';
  index: number;
}

export interface LayerRemovePatch {
  kind: 'layerRemove';
  index: number;
  data: TileLayer;
  meta: LayerMeta;
}

export interface LayerClearPatch {
  kind: 'layerClear';
  index: number;
  data: TileLayer;
}

export interface LayerMovePatch {
  kind: 'layerMove';
  fromIndex: number;
  toIndex: number;
}

export interface MapSnapshot {
  width: number;
  height: number;
  layers: TileLayer[];
  layerMeta: LayerMeta[];
  collisionGrid: boolean[][];
  objects: InteractiveObject[];
  spawnPoints: SpawnPoint[];
}

export interface MapSnapshotPatch {
  kind: 'snapshot';
  before: MapSnapshot;
  after: MapSnapshot;
}

export interface CompoundPatch {
  kind: 'compound';
  patches: UndoPatch[];
}

export type UndoPatch =
  | TilePatch
  | CollisionPatch
  | ObjectsPatch
  | SpawnsPatch
  | LayerAddPatch
  | LayerRemovePatch
  | LayerClearPatch
  | LayerMovePatch
  | MapSnapshotPatch
  | CompoundPatch;

export interface UndoEntry {
  label: string;
  patch: UndoPatch;
}

const MAX_STACK = 50;

// --- Helpers ---

function cellsEqual(a: CellValue, b: CellValue): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function cloneLayer(layer: TileLayer): TileLayer {
  return layer.map(row =>
    row.map(cell => (cell ? { ...cell } : null)),
  );
}

function cloneCollisionGrid(grid: boolean[][]): boolean[][] {
  return grid.map(row => [...row]);
}

function cloneObjects(objs: InteractiveObject[]): InteractiveObject[] {
  return objs.map(o => ({ ...o }));
}

function cloneSpawns(spawns: SpawnPoint[]): SpawnPoint[] {
  return spawns.map(s => ({ ...s }));
}

// --- Batch state (not reactive, internal) ---

interface TileBatch {
  type: 'tiles';
  label: string;
  layerIndex: number;
  cells: Map<string, { before: CellValue; after: CellValue }>;
  snapshot: MapSnapshot;
  startWidth: number;
  startHeight: number;
}

interface CollisionBatch {
  type: 'collision';
  label: string;
  cells: Map<string, { before: boolean; after: boolean }>;
  snapshot: MapSnapshot;
  startWidth: number;
  startHeight: number;
}

type ActiveBatch = TileBatch | CollisionBatch;

// --- Store ---

export const useUndoStore = defineStore('undo', () => {
  const undoStack = ref<UndoEntry[]>([]);
  const redoStack = ref<UndoEntry[]>([]);
  let activeBatch: ActiveBatch | null = null;

  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);

  function push(entry: UndoEntry) {
    undoStack.value.push(entry);
    if (undoStack.value.length > MAX_STACK) {
      undoStack.value.splice(0, undoStack.value.length - MAX_STACK);
    }
    redoStack.value = [];
  }

  function undo() {
    const entry = undoStack.value.pop();
    if (!entry) return;
    reversePatch(entry.patch);
    redoStack.value.push(entry);
    postApply();
  }

  function redo() {
    const entry = redoStack.value.pop();
    if (!entry) return;
    applyPatch(entry.patch);
    undoStack.value.push(entry);
    postApply();
  }

  function postApply() {
    const map = useMapStore();
    map.clearCaches();
    map.markDirty();
  }

  // --- Batching ---

  function captureSnapshot(): MapSnapshot {
    const map = useMapStore();
    const rawLayers = toRaw(map.layers) as TileLayer[];
    const rawMeta = toRaw(map.layerMeta) as LayerMeta[];
    const rawGrid = toRaw(map.collisionGrid) as boolean[][];
    const rawObjs = toRaw(map.objects) as InteractiveObject[];
    const rawSpawns = toRaw(map.spawnPoints) as SpawnPoint[];
    return {
      width: map.width,
      height: map.height,
      layers: rawLayers.map(l => cloneLayer(l)),
      layerMeta: rawMeta.map(m => ({ ...m })),
      collisionGrid: cloneCollisionGrid(rawGrid),
      objects: cloneObjects(rawObjs),
      spawnPoints: cloneSpawns(rawSpawns),
    };
  }

  function beginBatch(label: string, layerIndex: number) {
    const map = useMapStore();
    activeBatch = {
      type: 'tiles',
      label,
      layerIndex,
      cells: new Map(),
      snapshot: captureSnapshot(),
      startWidth: map.width,
      startHeight: map.height,
    };
  }

  function recordCell(
    x: number, y: number,
    before: CellValue, after: CellValue,
  ) {
    if (!activeBatch || activeBatch.type !== 'tiles') return;
    const key = `${x},${y}`;
    const existing = activeBatch.cells.get(key);
    if (existing) {
      existing.after = after;
    } else {
      activeBatch.cells.set(key, {
        before: before ? { ...before } : null,
        after: after ? { ...after } : null,
      });
    }
  }

  function beginCollisionBatch(label: string) {
    const map = useMapStore();
    activeBatch = {
      type: 'collision',
      label,
      cells: new Map(),
      snapshot: captureSnapshot(),
      startWidth: map.width,
      startHeight: map.height,
    };
  }

  function recordCollisionCell(
    x: number, y: number,
    before: boolean, after: boolean,
  ) {
    if (!activeBatch || activeBatch.type !== 'collision') return;
    const key = `${x},${y}`;
    const existing = activeBatch.cells.get(key);
    if (existing) {
      existing.after = after;
    } else {
      activeBatch.cells.set(key, { before, after });
    }
  }

  function commitBatch() {
    if (!activeBatch) return;
    const map = useMapStore();
    const dimensionsChanged =
      map.width !== activeBatch.startWidth
      || map.height !== activeBatch.startHeight;

    if (dimensionsChanged) {
      const afterSnapshot = captureSnapshot();
      push({
        label: activeBatch.label,
        patch: {
          kind: 'snapshot',
          before: activeBatch.snapshot,
          after: afterSnapshot,
        },
      });
      activeBatch = null;
      return;
    }

    if (activeBatch.type === 'tiles') {
      // Filter no-ops
      for (const [key, diff] of activeBatch.cells) {
        if (cellsEqual(diff.before, diff.after)) {
          activeBatch.cells.delete(key);
        }
      }
      if (activeBatch.cells.size === 0) {
        activeBatch = null;
        return;
      }
      push({
        label: activeBatch.label,
        patch: {
          kind: 'tiles',
          layerIndex: activeBatch.layerIndex,
          cells: activeBatch.cells,
        },
      });
    } else {
      for (const [key, diff] of activeBatch.cells) {
        if (diff.before === diff.after) {
          activeBatch.cells.delete(key);
        }
      }
      if (activeBatch.cells.size === 0) {
        activeBatch = null;
        return;
      }
      push({
        label: activeBatch.label,
        patch: {
          kind: 'collision',
          cells: activeBatch.cells,
        },
      });
    }
    activeBatch = null;
  }

  function discardBatch() {
    activeBatch = null;
  }

  function clear() {
    undoStack.value = [];
    redoStack.value = [];
    activeBatch = null;
  }

  // --- Apply / Reverse ---

  function applyPatch(patch: UndoPatch) {
    const map = useMapStore();
    switch (patch.kind) {
      case 'tiles':
        applyTilePatch(patch, false);
        break;
      case 'collision':
        applyCollisionPatch(patch, false);
        break;
      case 'objects':
        map.objects = cloneObjects(patch.after);
        map.collisionGrid = cloneCollisionGrid(patch.collisionAfter);
        break;
      case 'spawns':
        map.spawnPoints = cloneSpawns(patch.after);
        break;
      case 'layerAdd':
        map.layers.splice(
          patch.index, 0,
          createEmptyLayer(map.width, map.height),
        );
        map.layerMeta.splice(
          patch.index, 0,
          { name: `Layer ${map.layers.length}`, visible: true },
        );
        break;
      case 'layerRemove':
        map.layers.splice(patch.index, 1);
        map.layerMeta.splice(patch.index, 1);
        break;
      case 'layerClear': {
        const cleared = [...map.layers];
        cleared[patch.index] = createEmptyLayer(
          map.width, map.height,
        );
        map.layers = cleared;
        break;
      }
      case 'layerMove':
        moveLayerDirect(patch.fromIndex, patch.toIndex);
        break;
      case 'snapshot':
        restoreSnapshot(patch.after);
        break;
      case 'compound':
        for (const sub of patch.patches) {
          applyPatch(sub);
        }
        break;
    }
  }

  function reversePatch(patch: UndoPatch) {
    const map = useMapStore();
    switch (patch.kind) {
      case 'tiles':
        applyTilePatch(patch, true);
        break;
      case 'collision':
        applyCollisionPatch(patch, true);
        break;
      case 'objects':
        map.objects = cloneObjects(patch.before);
        map.collisionGrid = cloneCollisionGrid(patch.collisionBefore);
        break;
      case 'spawns':
        map.spawnPoints = cloneSpawns(patch.before);
        break;
      case 'layerAdd':
        map.layers.splice(patch.index, 1);
        map.layerMeta.splice(patch.index, 1);
        break;
      case 'layerRemove':
        map.layers.splice(
          patch.index, 0, cloneLayer(patch.data),
        );
        map.layerMeta.splice(
          patch.index, 0, { ...patch.meta },
        );
        break;
      case 'layerClear': {
        const restored = [...map.layers];
        restored[patch.index] = cloneLayer(patch.data);
        map.layers = restored;
        break;
      }
      case 'layerMove':
        moveLayerDirect(patch.toIndex, patch.fromIndex);
        break;
      case 'snapshot':
        restoreSnapshot(patch.before);
        break;
      case 'compound':
        for (let i = patch.patches.length - 1; i >= 0; i--) {
          reversePatch(patch.patches[i]!);
        }
        break;
    }
  }

  function applyTilePatch(patch: TilePatch, reverse: boolean) {
    const map = useMapStore();
    const layer = map.layers[patch.layerIndex];
    if (!layer) return;
    for (const [key, diff] of patch.cells) {
      const [xs, ys] = key.split(',');
      const x = Number(xs);
      const y = Number(ys);
      const row = layer[y];
      if (!row) continue;
      const val = reverse ? diff.before : diff.after;
      row[x] = val ? { ...val } : null;
    }
  }

  function applyCollisionPatch(
    patch: CollisionPatch, reverse: boolean,
  ) {
    const map = useMapStore();
    const grid = map.collisionGrid;
    for (const [key, diff] of patch.cells) {
      const [xs, ys] = key.split(',');
      const x = Number(xs);
      const y = Number(ys);
      const row = grid[y];
      if (!row) continue;
      row[x] = reverse ? diff.before : diff.after;
    }
  }

  function moveLayerDirect(from: number, to: number) {
    const map = useMapStore();
    const [layer] = map.layers.splice(from, 1);
    const [meta] = map.layerMeta.splice(from, 1);
    if (layer && meta) {
      map.layers.splice(to, 0, layer);
      map.layerMeta.splice(to, 0, meta);
    }
  }

  function restoreSnapshot(snap: MapSnapshot) {
    const map = useMapStore();
    map.width = snap.width;
    map.height = snap.height;
    map.layers = snap.layers.map(l => cloneLayer(l));
    map.layerMeta = snap.layerMeta.map(m => ({ ...m }));
    map.collisionGrid = cloneCollisionGrid(snap.collisionGrid);
    map.objects = cloneObjects(snap.objects);
    map.spawnPoints = cloneSpawns(snap.spawnPoints);
  }

  return {
    undoStack,
    redoStack,
    canUndo,
    canRedo,
    push,
    undo,
    redo,
    beginBatch,
    recordCell,
    beginCollisionBatch,
    recordCollisionCell,
    commitBatch,
    discardBatch,
    captureSnapshot,
    clear,
  };
});
