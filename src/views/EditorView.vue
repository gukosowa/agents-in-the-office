<script setup lang="ts">
import TileSelector from "../components/TileSelector.vue";
import GridCanvas from "../components/GridCanvas.vue";
import LayerControl from "../components/LayerControl.vue";
import Toolbar from "../components/Toolbar.vue";
import VerticalToolbar from "../components/VerticalToolbar.vue";
import ObjectDialog from "../components/ObjectDialog.vue";
import AgentSetupDialog from "../components/AgentSetupDialog.vue";
import CharacterEditorDialog from "../components/CharacterEditorDialog.vue";
import { useEditorStore } from "../stores/editorStore";
import { useMapStore } from "../stores/mapStore";
import { useUndoStore } from "../stores/undoStore";
import { useCharacterStore } from "../stores/characterStore";
import { DEFAULT_TILE_SIZE, type MapData, type Direction, type DepthMap } from "../types";
import {
  saveMapToFile, loadMapFromFile, loadMapFromPath,
  saveMapToPath, AITO_FILE_PATH_KEY,
} from "../utils/fileIO";
import { invoke } from "@tauri-apps/api/core";
import { onMounted, onUnmounted, ref, watch, toRaw, computed } from "vue";
import { useRouter } from "vue-router";
import { Maximize } from "lucide-vue-next";

const router = useRouter();
const editorStore = useEditorStore();
const mapStore = useMapStore();
const undoStore = useUndoStore();
const characterStore = useCharacterStore();
const canvasContainer = ref<HTMLElement | null>(null);
const agentSetupOpen = ref(false);
const characterEditorOpen = ref(false);
const savedFilePath = ref<string | null>(
  localStorage.getItem(AITO_FILE_PATH_KEY),
);
function persistFilePath(path: string | null) {
  savedFilePath.value = path;
  if (path) localStorage.setItem(AITO_FILE_PATH_KEY, path);
  else localStorage.removeItem(AITO_FILE_PATH_KEY);
}

const handleObjectSave = (data: {
  type: string;
  direction: Direction;
}) => {
  const { x, y } = editorStore.dialogState;
  const objsBefore = mapStore.objects.map(o => ({ ...o }));
  const colBefore = mapStore.collisionGrid.map(r => [...r]);

  mapStore.removeObjectAt(x, y);
  mapStore.addObject({
    id: crypto.randomUUID(),
    x,
    y,
    type: data.type,
    direction: data.direction,
  });

  undoStore.push({
    label: 'Object',
    patch: {
      kind: 'objects',
      before: objsBefore,
      after: mapStore.objects.map(o => ({ ...o })),
      collisionBefore: colBefore,
      collisionAfter: mapStore.collisionGrid.map(r => [...r]),
    },
  });
  editorStore.closeDialog();
};

function getMapData(): MapData {
  return JSON.parse(JSON.stringify({
    width: mapStore.width,
    height: mapStore.height,
    tileSize: mapStore.tileSize,
    layers: mapStore.layers,
    layerMeta: mapStore.layerMeta,
    objects: mapStore.objects,
    collisionGrid: mapStore.collisionGrid,
    spawnPoints: mapStore.spawnPoints,
    tileDepthMaps: mapStore.tileDepthMaps,
    tileCollisionMaps: mapStore.tileCollisionMaps,
    tileInteractiveMaps: mapStore.tileInteractiveMaps,
  })) as MapData;
}

async function restoreFromPool(
  poolBlobs: Record<string, Blob | null>,
) {
  // Reset pool to match incoming data
  const pool: Record<string, { image: null; blob: null }> = {};
  const labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; i < 4; i++) {
    pool[labels[i]!] = { image: null, blob: null };
  }
  mapStore.tilesetPool = pool;

  const loads: Promise<void>[] = [];
  for (const [slot, blob] of Object.entries(poolBlobs)) {
    if (blob) {
      loads.push(mapStore.setTilesetSlot(slot, blob));
    }
  }
  await Promise.all(loads);
}

function restoreMapData(data: MapData) {
  mapStore.tileSize = data.tileSize ?? DEFAULT_TILE_SIZE;
  mapStore.width = data.width;
  mapStore.height = data.height;
  mapStore.layers = data.layers;
  mapStore.layerMeta = data.layerMeta
    ?? data.layers.map((_: unknown, i: number) => ({
      name: `Layer ${i + 1}`,
      visible: true,
    }));
  mapStore.objects = data.objects;
  mapStore.collisionGrid = data.collisionGrid
    ?? Array.from({ length: data.height }, () =>
        Array(data.width).fill(false) as boolean[],
      );
  mapStore.spawnPoints = data.spawnPoints ?? [];
  mapStore.tileDepthMaps = data.tileDepthMaps ?? {};
  mapStore.tileCollisionMaps = data.tileCollisionMaps ?? {};
  mapStore.tileInteractiveMaps = data.tileInteractiveMaps ?? {};
}

function getPoolBlobs(): Record<string, Blob | null> {
  const result: Record<string, Blob | null> = {};
  for (const [slot, entry] of Object.entries(mapStore.tilesetPool)) {
    result[slot] = entry.blob;
  }
  return result;
}

function getAutoTileEntries() {
  return toRaw(mapStore.autoTilePool).map(entry => {
    const raw = toRaw(entry);
    return {
      blob: raw.blob,
      type: raw.type,
      depthMap: toRaw(raw.depthMap),
      collisionMap: toRaw(raw.collisionMap),
      sourceBlob: raw.sourceBlob,
      sourceCol: raw.sourceCol,
      sourceRow: raw.sourceRow,
    };
  });
}

interface AutoTileEntry {
  blob: Blob | null;
  type?: string;
  depthMap?: Record<string, number>;
  collisionMap?: Record<string, boolean>;
  sourceBlob?: Blob;
  sourceCol?: number;
  sourceRow?: number;
}

async function restoreAutoTilePool(entries: AutoTileEntry[]) {
  mapStore.autoTilePool = [];
  for (const entry of entries) {
    if (entry.blob) {
      const atType = entry.type === 'B' ? 'B'
        : entry.type === 'C' ? 'C' : 'A';
      const idx = await mapStore.addAutoTile(
        entry.blob, atType,
        entry.sourceBlob,
        entry.sourceCol,
        entry.sourceRow,
      );
      const slot = mapStore.autoTilePool[idx];
      if (slot) {
        const pool = [...mapStore.autoTilePool];
        pool[idx] = {
          ...slot,
          depthMap: (entry.depthMap ?? {}) as DepthMap,
          collisionMap: entry.collisionMap ?? {},
        };
        mapStore.autoTilePool = pool;
      }
    }
  }
}

const emptyLayer = (w: number, h: number) =>
  Array.from({ length: h }, () => Array(w).fill(null));

const emptyCollision = (w: number, h: number) =>
  Array.from({ length: h }, () => Array(w).fill(false) as boolean[]);

const handleNewMap = () => {
  if (!confirm('Create a new map? Unsaved changes will be lost.')) {
    return;
  }
  mapStore.tileSize = DEFAULT_TILE_SIZE;
  mapStore.width = 20;
  mapStore.height = 15;
  mapStore.layers = [
    emptyLayer(20, 15),
    emptyLayer(20, 15),
    emptyLayer(20, 15),
  ];
  mapStore.layerMeta = [
    { name: 'Ground', visible: true },
    { name: 'Objects (low)', visible: true },
    { name: 'Objects (high)', visible: true },
  ];
  mapStore.objects = [];
  mapStore.spawnPoints = [];
  mapStore.collisionGrid = emptyCollision(20, 15);
  mapStore.tilesetPool = {
    A: { image: null, blob: null },
    B: { image: null, blob: null },
    C: { image: null, blob: null },
    D: { image: null, blob: null },
  };
  mapStore.autoTilePool = [];
  mapStore.tileDepthMaps = {};
  mapStore.tileCollisionMaps = {};
  mapStore.tileInteractiveMaps = {};
  characterStore.setCharacters([]);
  persistFilePath(null);
  mapStore.markDirty();
  undoStore.clear();
};

const rawCharacters = computed(() =>
  toRaw(characterStore.characters).map(c => toRaw(c)),
);

const handleSave = async () => {
  if (savedFilePath.value) {
    await saveMapToPath(
      savedFilePath.value, getMapData(), getPoolBlobs(),
      getAutoTileEntries(), rawCharacters.value,
    );
    return;
  }
  await handleExport();
};

// Save As — always opens picker, updates saved path
const handleExport = async () => {
  const path = await saveMapToFile(
    getMapData(), getPoolBlobs(), getAutoTileEntries(),
    undefined,
    rawCharacters.value,
  );
  if (path) persistFilePath(path);
};

const handleOpenFile = async () => {
  const result = await loadMapFromFile();
  if (!result) return;

  restoreMapData(result.mapData);
  await restoreFromPool(result.poolBlobs);
  await restoreAutoTilePool(result.autoTileEntries);
  if (result.characterDefinitions) {
    characterStore.setCharacters(result.characterDefinitions);
  }
  persistFilePath(result.filePath);
  undoStore.clear();
};

// Debounced auto-save to file on changes
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let autoSaveInterval: ReturnType<typeof setInterval> | null = null;
const AUTO_SAVE_DELAY = 3000;
const AUTO_SAVE_INTERVAL = 30_000;
let autoSaveInFlight = false;
let lastSavedVersion = 0;

async function autoSave() {
  if (!savedFilePath.value || autoSaveInFlight) return;
  autoSaveInFlight = true;
  try {
    await saveMapToPath(
      savedFilePath.value, getMapData(), getPoolBlobs(),
      getAutoTileEntries(), rawCharacters.value,
    );
    lastSavedVersion = mapStore.dirtyVersion
      + characterStore.dirtyVersion;
  } finally {
    autoSaveInFlight = false;
  }
}

function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(autoSave, AUTO_SAVE_DELAY);
}

async function playMode() {
  await autoSave();
  router.push('/run');
}

watch(
  () => mapStore.dirtyVersion + characterStore.dirtyVersion,
  scheduleAutoSave,
);

const handleKeyDown = (e: KeyboardEvent) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key === 's' && e.shiftKey) {
    e.preventDefault();
    handleExport();
    return;
  }
  if (e.key === 's') {
    e.preventDefault();
    handleSave();
    return;
  }
  if (e.key === 'o') {
    e.preventDefault();
    handleOpenFile();
    return;
  }
  if (e.key === 'n') {
    e.preventDefault();
    handleNewMap();
    return;
  }
  if (e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undoStore.undo();
    return;
  }
  if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
    e.preventDefault();
    undoStore.redo();
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    playMode();
  }
};

// Left sidebar (w-80 = 320px) + vertical toolbar (w-11 = 44px), header (h-10 = 40px)
const SIDEBAR_WIDTH = 320 + 44;
const HEADER_HEIGHT = 40;

const handleFitToView = () => {
  if (!canvasContainer.value) return;
  const vw = canvasContainer.value.clientWidth - SIDEBAR_WIDTH;
  const vh = canvasContainer.value.clientHeight - HEADER_HEIGHT;
  const mw = mapStore.width * mapStore.tileSize;
  const mh = mapStore.height * mapStore.tileSize;
  editorStore.fitToView(vw, vh, mw, mh, SIDEBAR_WIDTH, HEADER_HEIGHT);
};

onMounted(async () => {
  window.addEventListener('keydown', handleKeyDown);

  // Periodic auto-save every 30s if there are unsaved changes
  const combinedVersion = () =>
    mapStore.dirtyVersion + characterStore.dirtyVersion;
  autoSaveInterval = setInterval(() => {
    if (combinedVersion() > lastSavedVersion) {
      void autoSave();
    }
  }, AUTO_SAVE_INTERVAL);

  // Skip file load when store already has images
  // (e.g. returning from RunView). Resetting images to null and
  // async-reloading causes a blank canvas flash.
  const hasImages =
    Object.values(mapStore.tilesetPool).some(s => s.image !== null)
    || mapStore.autoTilePool.some(s => s.image !== null);

  if (!hasImages && savedFilePath.value) {
    try {
      await invoke('allow_file_scope', {
        path: savedFilePath.value,
      });
      const result = await loadMapFromPath(savedFilePath.value);
      restoreMapData(result.mapData);
      await restoreFromPool(result.poolBlobs);
      await restoreAutoTilePool(result.autoTileEntries);
      if (result.characterDefinitions) {
        characterStore.setCharacters(result.characterDefinitions);
      }
      undoStore.clear();
    } catch (err) {
      console.error('[EditorView] file load failed:', err);
      persistFilePath(null);
    }
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  if (autoSaveInterval) clearInterval(autoSaveInterval);
});
</script>

<template>
  <div class="h-screen w-screen relative bg-gray-950 text-white select-none overflow-hidden">
    <!-- Canvas fills full screen -->
    <div ref="canvasContainer" class="absolute inset-0">
      <GridCanvas />
    </div>

    <!-- Header -->
    <div
      data-tauri-drag-region
      class="absolute top-0 left-0 right-0 h-10 z-20 px-3 pl-20
             border-b border-gray-700/50 bg-gray-900/60 backdrop-blur-md
             flex items-center"
    >
      <h1 data-tauri-drag-region class="text-sm font-bold whitespace-nowrap shrink-0">Agents in the Office</h1>
      <div data-tauri-drag-region class="flex-1 min-w-0 overflow-x-auto flex items-center gap-3 mx-3 scrollbar-hide">
        <div data-tauri-drag-region class="border-l border-gray-600 h-5 shrink-0"></div>
        <Toolbar @new-map="handleNewMap" @save="handleSave" @export="handleExport" @open-file="handleOpenFile" />
        <div class="ml-auto shrink-0 flex items-center gap-2">
          <button
            class="px-3 py-1 bg-gray-700/60 rounded hover:bg-gray-600/70 text-sm font-semibold whitespace-nowrap"
            @click="characterEditorOpen = true"
          >Characters</button>
          <div class="border-l border-gray-600 h-5"></div>
          <button
            class="px-3 py-1 bg-gray-700/60 rounded hover:bg-gray-600/70 text-sm font-semibold whitespace-nowrap"
            @click="agentSetupOpen = true"
          >Setup Agents</button>
        </div>
      </div>
      <button
        class="px-3 py-1 bg-green-600/80 rounded hover:bg-green-700/90 text-sm font-semibold whitespace-nowrap shrink-0"
        @click="playMode"
      >Play Mode</button>
    </div>

    <!-- Left sidebar -->
    <div
      class="absolute left-0 top-10 bottom-0 w-80 z-10
             border-r border-gray-700/50 bg-gray-900/90
             flex flex-col overflow-hidden"
    >
      <TileSelector />
      <LayerControl />
    </div>

    <!-- Vertical tool strip -->
    <VerticalToolbar />

    <ObjectDialog
      v-if="editorStore.dialogState.isOpen"
      :initial-type="editorStore.dialogState.initialType"
      :initial-direction="editorStore.dialogState.initialDirection"
      @save="handleObjectSave"
      @cancel="editorStore.closeDialog"
    />

    <AgentSetupDialog
      v-if="agentSetupOpen"
      @close="agentSetupOpen = false"
    />

    <CharacterEditorDialog
      v-if="characterEditorOpen"
      @close="characterEditorOpen = false"
    />

    <!-- Zoom controls - floating bottom right -->
    <div
      class="absolute bottom-4 right-4 z-20 flex items-center gap-2
             bg-black/30 rounded px-2 py-1 text-xs text-gray-400"
    >
      <span>{{ Math.round(editorStore.zoom * 100) }}%</span>
      <button
        class="p-1 rounded text-gray-400 hover:text-gray-200 transition-colors"
        title="Fit to view"
        @click="handleFitToView"
      >
        <Maximize :size="14" />
      </button>
    </div>
  </div>
</template>
