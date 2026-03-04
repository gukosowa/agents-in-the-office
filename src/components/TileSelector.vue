<script setup lang="ts">
import {
  ref, computed, watch, onMounted, onUnmounted, nextTick,
} from 'vue';
import {
  Plus, MousePointer2, Layers, Ban, Zap,
} from 'lucide-vue-next';
import { OBJECT_TYPES, type Direction } from '../types';
import { useMapStore, type AutoTileType } from '../stores/mapStore';
import { useEditorStore } from '../stores/editorStore';
import { subTileToPixels } from '../utils/rmxpAutoTile';
import AutoTilePickerDialog
  from '../components/AutoTilePickerDialog.vue';
import AutoTilePropsDialog
  from '../components/AutoTilePropsDialog.vue';
import AutoTileChooserDialog
  from '../components/AutoTileChooserDialog.vue';
import ObjectDialog from '../components/ObjectDialog.vue';
import TileSizeScaleDialog from '../components/TileSizeScaleDialog.vue';
import { saveAutoTileToLibrary } from '../utils/db';

const mapStore = useMapStore();
const editorStore = useEditorStore();

// ── Scale dialog state ────────────────────────────────────────
const pendingTilesetFile = ref<{ file: File; slot: string } | null>(null);
const pendingAutoTileBlob = ref<Blob | null>(null);
const showScaleDialog = ref(false);
const scaleDialogTarget = ref<'tileset' | 'autotile'>('tileset');

async function scaleImageBlob(
  blob: Blob,
  sourceTileSize: number,
  targetTileSize: number,
  spacing: number,
): Promise<Blob> {
  if (sourceTileSize === targetTileSize && spacing === 0) return blob;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const stride = sourceTileSize + spacing;
        const cols = Math.floor((img.width + spacing) / stride);
        const rows = Math.floor((img.height + spacing) / stride);
        const canvas = document.createElement('canvas');
        canvas.width = cols * targetTileSize;
        canvas.height = rows * targetTileSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('no 2d context')); return; }
        ctx.imageSmoothingEnabled = false;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            ctx.drawImage(
              img,
              c * stride, r * stride, sourceTileSize, sourceTileSize,
              c * targetTileSize, r * targetTileSize,
              targetTileSize, targetTileSize,
            );
          }
        }
        canvas.toBlob(
          (b) => {
            if (b) resolve(b);
            else reject(new Error('toBlob returned null'));
          },
          'image/png',
        );
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function onScaleConfirm(sourceTileSize: number, spacing: number) {
  showScaleDialog.value = false;
  if (scaleDialogTarget.value === 'tileset' && pendingTilesetFile.value) {
    const { file, slot } = pendingTilesetFile.value;
    pendingTilesetFile.value = null;
    const scaled = await scaleImageBlob(
      file, sourceTileSize, mapStore.tileSize, spacing,
    );
    mapStore.setTilesetSlot(slot, scaled);
  } else if (
    scaleDialogTarget.value === 'autotile' && pendingAutoTileBlob.value
  ) {
    const blob = pendingAutoTileBlob.value;
    pendingAutoTileBlob.value = null;
    const scaled = await scaleImageBlob(
      blob, sourceTileSize, mapStore.tileSize, spacing,
    );
    saveAutoTileToLibrary(scaled);
    processAutoTileBlob(scaled);
  }
}

function onScaleCancel() {
  showScaleDialog.value = false;
  pendingTilesetFile.value = null;
  pendingAutoTileBlob.value = null;
}

const scaleDialogBlob = computed<Blob | null>(() => {
  if (scaleDialogTarget.value === 'tileset') {
    return pendingTilesetFile.value?.file ?? null;
  }
  return pendingAutoTileBlob.value;
});

const overlayCanvas = ref<HTMLCanvasElement | null>(null);
const isSelecting = ref(false);
const startX = ref(0);
const startY = ref(0);
const fileInput = ref<HTMLInputElement | null>(null);
const autoTileFileInput = ref<HTMLInputElement | null>(null);
const contextMenu = ref<{
  visible: boolean;
  x: number;
  y: number;
  slot: string;
  autoTileIndex: number;
}>({ visible: false, x: 0, y: 0, slot: '', autoTileIndex: -1 });

// ── Panel mode ───────────────────────────────────────────────
const panelMode = ref<
  'cursor' | 'depth' | 'collision' | 'interactive'
>('cursor');

const DIRECTION_ARROWS: Record<string, string> = {
  down: '\u2193', up: '\u2191', right: '\u2192', left: '\u2190',
};

const objectEmojiMap = new Map<string, string>(
  OBJECT_TYPES.map(t => [t.value, t.emoji]),
);

// ── Tile interactive dialog ─────────────────────────────────
const tileIntDialog = ref<{
  open: boolean;
  tileX: number;
  tileY: number;
  existing: boolean;
  initialType?: string;
  initialDirection?: Direction;
}>({ open: false, tileX: 0, tileY: 0, existing: false });

function openTileIntDialog(cx: number, cy: number) {
  const current = mapStore.getTileInteractive(
    editorStore.activeSlot, cx, cy,
  );
  tileIntDialog.value = {
    open: true,
    tileX: cx,
    tileY: cy,
    existing: current !== null,
    initialType: current?.type,
    initialDirection: current?.direction,
  };
}

function onTileIntSave(
  data: { type: string; direction: Direction },
) {
  mapStore.setTileInteractive(
    editorStore.activeSlot,
    tileIntDialog.value.tileX,
    tileIntDialog.value.tileY,
    { type: data.type, direction: data.direction },
  );
  tileIntDialog.value.open = false;
  drawOverlay();
}

function onTileIntRemove() {
  mapStore.setTileInteractive(
    editorStore.activeSlot,
    tileIntDialog.value.tileX,
    tileIntDialog.value.tileY,
    null,
  );
  tileIntDialog.value.open = false;
  drawOverlay();
}

function onTileIntCancel() {
  tileIntDialog.value.open = false;
}

// ── Zoom ─────────────────────────────────────────────────────
const zoomFit = ref(true);
const zoomPercent = ref(100);
const scrollContainer = ref<HTMLElement | null>(null);
const containerWidth = ref(300);
let resizeObserver: ResizeObserver | null = null;

const ZOOM_STEP = 50;
const ZOOM_MIN = 50;
const ZOOM_MAX = 400;

function zoomIn() {
  zoomFit.value = false;
  zoomPercent.value = Math.min(ZOOM_MAX, zoomPercent.value + ZOOM_STEP);
}

function zoomOut() {
  zoomFit.value = false;
  zoomPercent.value = Math.max(ZOOM_MIN, zoomPercent.value - ZOOM_STEP);
}

const zoomScale = computed(() => {
  const img = activeSlotImage.value;
  if (!img) return 1;
  if (zoomFit.value) return containerWidth.value / img.width;
  return zoomPercent.value / 100;
});

const isIOLayer = computed(
  () => editorStore.activeLayer >= mapStore.layers.length,
);

const isRestrictedMode = computed(
  () => isIOLayer.value || editorStore.showCollision,
);

const slots = computed(() =>
  Object.keys(mapStore.tilesetPool).sort(),
);

const activeSlotImage = computed(
  () => mapStore.getSlotImage(editorStore.activeSlot),
);

function selectSlot(slot: string) {
  editorStore.activeSlot = slot;
  const entry = mapStore.tilesetPool[slot];
  if (!entry?.image) {
    openFilePickerForSlot(slot);
  }
}

function openFilePickerForSlot(slot: string) {
  editorStore.activeSlot = slot;
  fileInput.value?.click();
}

function handleFileUpload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  (event.target as HTMLInputElement).value = '';
  pendingTilesetFile.value = { file, slot: editorStore.activeSlot };
  scaleDialogTarget.value = 'tileset';
  showScaleDialog.value = true;
}

function addSlot() {
  const newSlot = mapStore.addTilesetSlot();
  editorStore.activeSlot = newSlot;
}

function showContextMenu(e: MouseEvent, slot: string) {
  e.preventDefault();
  contextMenu.value = {
    visible: true,
    x: e.clientX,
    y: e.clientY,
    slot,
    autoTileIndex: -1,
  };
  window.addEventListener('click', hideContextMenu, { once: true });
}

function hideContextMenu() {
  contextMenu.value.visible = false;
}

function removeSlot() {
  const slot = contextMenu.value.slot;
  hideContextMenu();
  const removed = mapStore.removeTilesetSlot(slot);
  if (!removed) {
    console.warn(
      `Cannot remove slot ${slot}: tiles still reference it`,
    );
    return;
  }
  if (editorStore.activeSlot === slot) {
    editorStore.activeSlot = slots.value[0] ?? 'A';
  }
}

// ── Autotile chooser dialog ─────────────────────────────────

const showChooser = ref(false);

function onChooserSelect(blob: Blob) {
  showChooser.value = false;
  pendingAutoTileBlob.value = blob;
  scaleDialogTarget.value = 'autotile';
  showScaleDialog.value = true;
}

function onChooserUpload() {
  showChooser.value = false;
  autoTileFileInput.value?.click();
}

function onChooserCancel() {
  showChooser.value = false;
}

// ── Autotile picker dialog ──────────────────────────────────

const pickerImage = ref<HTMLImageElement | null>(null);
/** Original blob the picker image was loaded from (for source tracking). */
const pickerSourceBlob = ref<Blob | null>(null);

function processAutoTileBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = async () => {
    const ts = mapStore.tileSize;
    const typeAW = ts * 3;
    const typeAH = ts * 4;
    const typeBW = ts * 2;
    const typeBH = ts * 3;
    const typeCH = ts * 5;

    if (img.width === typeAW && img.height === typeAH) {
      const idx = await mapStore.addAutoTile(blob, 'A');
      openAutoTileProps(idx);
      URL.revokeObjectURL(url);
      return;
    }

    if (img.width === typeBW && img.height === typeCH) {
      const idx = await mapStore.addAutoTile(blob, 'C');
      openAutoTileProps(idx);
      URL.revokeObjectURL(url);
      return;
    }

    if (img.width === typeBW && img.height === typeBH) {
      const idx = await mapStore.addAutoTile(blob, 'B');
      openAutoTileProps(idx);
      URL.revokeObjectURL(url);
      return;
    }

    pickerSourceBlob.value = blob;
    pickerImage.value = img;
  };
  img.src = url;
}

function handleAutoTileFilePicked(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  (event.target as HTMLInputElement).value = '';
  pendingAutoTileBlob.value = file;
  scaleDialogTarget.value = 'autotile';
  showScaleDialog.value = true;
}

async function onPickerPick(
  blob: Blob, type: AutoTileType, col: number, row: number,
) {
  if (pickerImage.value) {
    URL.revokeObjectURL(pickerImage.value.src);
  }
  const srcBlob = pickerSourceBlob.value ?? undefined;
  pickerImage.value = null;
  pickerSourceBlob.value = null;
  const idx = await mapStore.addAutoTile(blob, type, srcBlob, col, row);
  openAutoTileProps(idx);
}

function onPickerCancel() {
  if (pickerImage.value) {
    URL.revokeObjectURL(pickerImage.value.src);
  }
  pickerImage.value = null;
  pickerSourceBlob.value = null;
}

// ── Autotile properties dialog ───────────────────────────────

const propsDialogIndex = ref<number | null>(null);

function openAutoTileProps(index: number) {
  propsDialogIndex.value = index;
}

function closeAutoTileProps() {
  propsDialogIndex.value = null;
}

// ── Autotile preview strip ──────────────────────────────────

const autoTilePreviews = ref<HTMLCanvasElement[]>([]);

function renderAutoTilePreview(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  type: AutoTileType,
) {
  const ts = mapStore.tileSize;
  const halfTile = ts / 2;
  canvas.width = ts;
  canvas.height = ts;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;

  if (type === 'B' || type === 'C') {
    ctx.drawImage(image, 0, 0, ts, ts, 0, 0, ts, ts);
    return;
  }

  const positions = [27, 28, 33, 34] as const;
  const destOffsets = [
    [0, 0], [halfTile, 0],
    [0, halfTile], [halfTile, halfTile],
  ];

  for (let i = 0; i < 4; i++) {
    const { srcX, srcY } = subTileToPixels(positions[i]!, halfTile);
    const dest = destOffsets[i]!;
    ctx.drawImage(
      image,
      srcX, srcY, halfTile, halfTile,
      dest[0]!, dest[1]!, halfTile, halfTile,
    );
  }
}


function selectAutoTile(index: number) {
  editorStore.setSelectedAutoTile({ autoTileIndex: index });
}

function showAutoTileContextMenu(
  e: MouseEvent, index: number,
) {
  e.preventDefault();
  contextMenu.value = {
    visible: true,
    x: e.clientX,
    y: e.clientY,
    slot: '',
    autoTileIndex: index,
  };
  window.addEventListener(
    'click', hideContextMenu, { once: true },
  );
}

function editAutoTileProps() {
  const index = contextMenu.value.autoTileIndex;
  hideContextMenu();
  openAutoTileProps(index);
}

function removeAutoTile() {
  const index = contextMenu.value.autoTileIndex;
  hideContextMenu();
  mapStore.removeAutoTile(index);
  if (
    editorStore.selectedAutoTile
    && editorStore.selectedAutoTile.autoTileIndex >= index
  ) {
    editorStore.selectedAutoTile = null;
  }
}

// Re-render autotile previews when pool changes
watch(
  () => mapStore.autoTilePool,
  async () => {
    await nextTick();
    for (let i = 0; i < mapStore.autoTilePool.length; i++) {
      const slot = mapStore.autoTilePool[i];
      const canvas = autoTilePreviews.value[i];
      if (slot?.image && canvas) {
        renderAutoTilePreview(canvas, slot.image, slot.type);
      }
    }
  },
);

watch(
  () => mapStore.tileSize,
  async () => {
    await nextTick();
    for (let i = 0; i < mapStore.autoTilePool.length; i++) {
      const slot = mapStore.autoTilePool[i];
      const canvas = autoTilePreviews.value[i];
      if (slot?.image && canvas) {
        renderAutoTilePreview(canvas, slot.image, slot.type);
      }
    }
  },
);

// ── Regular tileset overlay canvas ──────────────────────────

const onImageLoad = () => {
  resizeCanvas();
  drawOverlay();
};

const resizeCanvas = () => {
  const img = activeSlotImage.value;
  if (img && overlayCanvas.value) {
    overlayCanvas.value.width = img.width;
    overlayCanvas.value.height = img.height;
  }
};

const drawOverlay = () => {
  const ctx = overlayCanvas.value?.getContext('2d');
  const img = activeSlotImage.value;
  if (!ctx || !img) return;

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // Draw grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= ctx.canvas.width; x += mapStore.tileSize) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ctx.canvas.height);
  }
  for (
    let y = 0;
    y <= ctx.canvas.height;
    y += mapStore.tileSize
  ) {
    ctx.moveTo(0, y);
    ctx.lineTo(ctx.canvas.width, y);
  }
  ctx.stroke();

  // Draw depth markers for current slot
  const depthMap =
    mapStore.tileDepthMaps[editorStore.activeSlot];
  if (depthMap && panelMode.value === 'depth') {
    const ts = mapStore.tileSize;
    const depthColors: Record<number, [string, string]> = {
      [-1]: ['rgba(59, 130, 246, 0.35)', '#3b82f6'],
      [1]: ['rgba(245, 158, 11, 0.35)', '#f59e0b'],
      [2]: ['rgba(239, 68, 68, 0.35)', '#ef4444'],
    };
    const depthLabels: Record<number, string> = {
      [-1]: '-1', [1]: '+1', [2]: '+2',
    };
    for (const [key, depth] of Object.entries(depthMap)) {
      const [cx, cy] = key.split(',').map(Number);
      if (cx === undefined || cy === undefined) continue;
      const colors = depthColors[depth];
      if (!colors) continue;
      ctx.fillStyle = colors[0];
      ctx.fillRect(cx * ts, cy * ts, ts, ts);
      ctx.fillStyle = colors[1];
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        depthLabels[depth] ?? '',
        cx * ts + ts / 2,
        cy * ts + ts / 2,
      );
    }
  }

  // Draw collision markers for current slot
  const colMap =
    mapStore.tileCollisionMaps[editorStore.activeSlot];
  if (colMap && panelMode.value === 'collision') {
    const ts = mapStore.tileSize;
    for (const key of Object.keys(colMap)) {
      const [cx, cy] = key.split(',').map(Number);
      if (cx === undefined || cy === undefined) continue;
      ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
      ctx.fillRect(cx * ts, cy * ts, ts, ts);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      const pad = 4;
      ctx.beginPath();
      ctx.moveTo(cx * ts + pad, cy * ts + pad);
      ctx.lineTo(cx * ts + ts - pad, cy * ts + ts - pad);
      ctx.moveTo(cx * ts + ts - pad, cy * ts + pad);
      ctx.lineTo(cx * ts + pad, cy * ts + ts - pad);
      ctx.stroke();
    }
  }

  // Draw interactive markers for current slot
  const intMap =
    mapStore.tileInteractiveMaps[editorStore.activeSlot];
  if (intMap && panelMode.value === 'interactive') {
    const ts = mapStore.tileSize;
    for (const [key, def] of Object.entries(intMap)) {
      const [cx, cy] = key.split(',').map(Number);
      if (cx === undefined || cy === undefined) continue;
      ctx.fillStyle = 'rgba(16, 185, 129, 0.35)';
      ctx.fillRect(cx * ts, cy * ts, ts, ts);
      const emoji = objectEmojiMap.get(def.type) ?? '?';
      const fontSize = Math.max(8, ts * 0.45);
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(emoji, cx * ts + ts / 2, cy * ts + ts * 0.38);
      const arrow = DIRECTION_ARROWS[def.direction] ?? '';
      ctx.font = `bold ${Math.max(6, ts * 0.22)}px sans-serif`;
      ctx.fillStyle = '#6ee7b7';
      ctx.fillText(
        arrow, cx * ts + ts / 2, cy * ts + ts * 0.78,
      );
    }
  }

  // Draw selection highlight
  if (editorStore.selectedSelection) {
    const { x, y, w, h } = editorStore.selectedSelection;
    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      x * mapStore.tileSize,
      y * mapStore.tileSize,
      w * mapStore.tileSize,
      h * mapStore.tileSize,
    );
  } else if (editorStore.selectedTile) {
    const { x, y } = editorStore.selectedTile;
    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      x * mapStore.tileSize,
      y * mapStore.tileSize,
      mapStore.tileSize,
      mapStore.tileSize,
    );
  }
};

const getGridCoord = (e: MouseEvent) => {
  const img = activeSlotImage.value;
  if (!overlayCanvas.value || !img) return { x: 0, y: 0 };
  const rect = overlayCanvas.value.getBoundingClientRect();
  const maxX = Math.floor(img.width / mapStore.tileSize) - 1;
  const maxY = Math.floor(img.height / mapStore.tileSize) - 1;

  const scaleX = overlayCanvas.value.width / rect.width;
  const scaleY = overlayCanvas.value.height / rect.height;
  const canvasX = (e.clientX - rect.left) * scaleX;
  const canvasY = (e.clientY - rect.top) * scaleY;

  let x = Math.floor(canvasX / mapStore.tileSize);
  let y = Math.floor(canvasY / mapStore.tileSize);

  x = Math.max(0, Math.min(x, maxX));
  y = Math.max(0, Math.min(y, maxY));

  return { x, y };
};

const startSelection = (e: MouseEvent) => {
  const { x, y } = getGridCoord(e);

  if (panelMode.value === 'depth') {
    mapStore.cycleTileDepth(editorStore.activeSlot, x, y);
    drawOverlay();
    return;
  }

  if (panelMode.value === 'collision') {
    mapStore.toggleTileCollision(editorStore.activeSlot, x, y);
    drawOverlay();
    return;
  }

  if (panelMode.value === 'interactive') {
    openTileIntDialog(x, y);
    return;
  }

  isSelecting.value = true;
  startX.value = x;
  startY.value = y;

  editorStore.setSelectedTile({
    x,
    y,
    slot: editorStore.activeSlot,
  });
  drawOverlay();

  window.addEventListener('mousemove', updateSelection);
  window.addEventListener('mouseup', endSelection);
};

const updateSelection = (e: MouseEvent) => {
  if (!isSelecting.value) return;
  const { x, y } = getGridCoord(e);

  if (isRestrictedMode.value) {
    editorStore.setSelectedTile({
      x,
      y,
      slot: editorStore.activeSlot,
    });
    drawOverlay();
    return;
  }

  const minX = Math.min(startX.value, x);
  const minY = Math.min(startY.value, y);
  const maxX = Math.max(startX.value, x);
  const maxY = Math.max(startY.value, y);

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;

  if (w > 1 || h > 1) {
    editorStore.setSelectedSelection({
      x: minX,
      y: minY,
      w,
      h,
      slot: editorStore.activeSlot,
    });
  } else {
    editorStore.setSelectedTile({
      x: minX,
      y: minY,
      slot: editorStore.activeSlot,
    });
  }
  drawOverlay();
};

function isSelectionTransparent(): boolean {
  const img = activeSlotImage.value;
  if (!img) return false;
  const ts = mapStore.tileSize;
  let sx: number, sy: number, sw: number, sh: number;
  if (editorStore.selectedSelection) {
    const sel = editorStore.selectedSelection;
    sx = sel.x * ts; sy = sel.y * ts;
    sw = sel.w * ts; sh = sel.h * ts;
  } else if (editorStore.selectedTile) {
    const tile = editorStore.selectedTile;
    sx = tile.x * ts; sy = tile.y * ts;
    sw = ts; sh = ts;
  } else {
    return false;
  }
  const offscreen = document.createElement('canvas');
  offscreen.width = sw; offscreen.height = sh;
  const ctx = offscreen.getContext('2d');
  if (!ctx) return false;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const data = ctx.getImageData(0, 0, sw, sh).data;
  for (let i = 3; i < data.length; i += 4) {
    if ((data[i] ?? 0) > 0) return false;
  }
  return true;
}

const endSelection = () => {
  isSelecting.value = false;
  window.removeEventListener('mousemove', updateSelection);
  window.removeEventListener('mouseup', endSelection);
  if (isSelectionTransparent()) {
    editorStore.setTool('eraser');
    editorStore.selectedTile = null;
    editorStore.selectedSelection = null;
    drawOverlay();
  }
};

// ── Watchers ────────────────────────────────────────────────

watch(() => editorStore.selectedTile, drawOverlay);
watch(() => editorStore.selectedSelection, drawOverlay);
watch(panelMode, drawOverlay);
watch(() => mapStore.tileDepthMaps, drawOverlay, { deep: true });
watch(() => mapStore.tileCollisionMaps, drawOverlay, { deep: true });
watch(
  () => mapStore.tileInteractiveMaps, drawOverlay, { deep: true },
);
watch(() => mapStore.tileSize, () => {
  resizeCanvas();
  drawOverlay();
});
watch(activeSlotImage, (img) => {
  if (img) {
    setTimeout(() => {
      resizeCanvas();
      drawOverlay();
    }, 50);
  }
});

onMounted(() => {
  if (scrollContainer.value) {
    containerWidth.value = scrollContainer.value.clientWidth;
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerWidth.value = entry.contentRect.width;
      }
    });
    resizeObserver.observe(scrollContainer.value);
  }
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  window.removeEventListener('mousemove', updateSelection);
  window.removeEventListener('mouseup', endSelection);
});
</script>

<template>
  <div
    class="flex-1 min-h-0 flex flex-col bg-transparent
           text-white select-none transition-opacity"
    :class="{ 'opacity-30 pointer-events-none': isRestrictedMode }"
  >
    <!-- Hidden file inputs -->
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      class="hidden"
      @change="handleFileUpload"
    />
    <input
      ref="autoTileFileInput"
      type="file"
      accept="image/png"
      class="hidden"
      @change="handleAutoTileFilePicked"
    />

    <!-- Autotile preview strip -->
    <div
      v-if="mapStore.autoTilePool.length > 0"
      class="flex flex-col px-2 pt-1 pb-1.5 gap-1
             border-b border-gray-700 shrink-0"
    >
      <span class="text-[9px] leading-none text-gray-500">Autotiles</span>
      <div class="flex flex-wrap gap-1 items-center">
      <button
        v-for="(_atSlot, i) in mapStore.autoTilePool"
        :key="i"
        :class="[
          'relative rounded border-2 overflow-hidden',
          'transition-colors',
          editorStore.selectedAutoTile?.autoTileIndex === i
            ? 'border-yellow-400'
            : 'border-transparent hover:border-gray-500',
        ]"
        :title="`Autotile ${i}`"
        @click="selectAutoTile(i)"
        @contextmenu="showAutoTileContextMenu($event, i)"
      >
        <canvas
          :ref="(el: unknown) => {
            if (el) {
              const c = el as HTMLCanvasElement;
              autoTilePreviews[i] = c;
              const slot = mapStore.autoTilePool[i];
              if (slot?.image) {
                renderAutoTilePreview(c, slot.image, slot.type);
              }
            }
          }"
          :width="mapStore.tileSize"
          :height="mapStore.tileSize"
          class="block"
          :style="{
            width: mapStore.tileSize + 'px',
            height: mapStore.tileSize + 'px',
            imageRendering: 'pixelated',
          }"
        />
      </button>
      <button
        class="px-1.5 py-1 text-xs rounded bg-gray-700
               text-gray-400 hover:bg-gray-600
               hover:text-white transition-colors"
        title="Add autotile sheet"
        @click="showChooser = true"
      >
        <Plus :size="14" />
      </button>
    </div>
    </div>

    <!-- Add autotile button when no autotiles exist -->
    <div
      v-if="mapStore.autoTilePool.length === 0"
      class="flex items-center px-3 py-2
             border-b border-gray-700 shrink-0"
    >
      <button
        class="flex items-center gap-1 px-2 py-1 text-xs
               rounded bg-purple-700 text-white
               hover:bg-purple-600 transition-colors"
        title="Add autotile sheet"
        @click="showChooser = true"
      >
        <Plus :size="12" />
        Autotile
      </button>
    </div>

    <!-- Toolbar: mode toggle + zoom -->
    <div
      v-if="activeSlotImage"
      class="flex items-center gap-1 px-3 py-1
             border-b border-gray-700 shrink-0"
    >
      <button
        :class="[
          'p-1 rounded transition-colors',
          panelMode === 'cursor'
            ? 'bg-blue-600 text-white'
            : 'bg-gray-700 text-gray-400 hover:bg-gray-600',
        ]"
        title="Selection mode"
        @click="panelMode = 'cursor'"
      >
        <MousePointer2 :size="14" />
      </button>
      <button
        :class="[
          'p-1 rounded transition-colors',
          panelMode === 'depth'
            ? 'bg-blue-600 text-white'
            : 'bg-gray-700 text-gray-400 hover:bg-gray-600',
        ]"
        title="Depth override mode"
        @click="panelMode = 'depth'"
      >
        <Layers :size="14" />
      </button>
      <button
        :class="[
          'p-1 rounded transition-colors',
          panelMode === 'collision'
            ? 'bg-blue-600 text-white'
            : 'bg-gray-700 text-gray-400 hover:bg-gray-600',
        ]"
        title="Collision mode"
        @click="panelMode = 'collision'"
      >
        <Ban :size="14" />
      </button>
      <button
        :class="[
          'p-1 rounded transition-colors',
          panelMode === 'interactive'
            ? 'bg-blue-600 text-white'
            : 'bg-gray-700 text-gray-400 hover:bg-gray-600',
        ]"
        title="Interactive object mode (Shift+click: cycle direction)"
        @click="panelMode = 'interactive'"
      >
        <Zap :size="14" />
      </button>
      <div class="border-l border-gray-600 h-4 mx-1" />
      <button
        :class="[
          'px-2 py-0.5 text-xs rounded transition-colors',
          zoomFit
            ? 'bg-blue-600 text-white'
            : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
        ]"
        @click="zoomFit = true"
      >Fit</button>
      <button
        :class="[
          'px-2 py-0.5 text-xs rounded transition-colors',
          !zoomFit && zoomPercent === 100
            ? 'bg-blue-600 text-white'
            : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
        ]"
        @click="zoomFit = false; zoomPercent = 100"
      >100%</button>
      <button
        class="px-1.5 py-0.5 text-xs rounded bg-gray-700
               text-gray-300 hover:bg-gray-600 transition-colors
               disabled:opacity-40 disabled:cursor-not-allowed"
        :disabled="!zoomFit && zoomPercent <= ZOOM_MIN"
        @click="zoomOut"
      >−</button>
      <span class="text-xs text-gray-300 w-9 text-center tabular-nums">
        {{ zoomFit ? 'fit' : zoomPercent + '%' }}
      </span>
      <button
        class="px-1.5 py-0.5 text-xs rounded bg-gray-700
               text-gray-300 hover:bg-gray-600 transition-colors
               disabled:opacity-40 disabled:cursor-not-allowed"
        :disabled="!zoomFit && zoomPercent >= ZOOM_MAX"
        @click="zoomIn"
      >+</button>
    </div>

    <!-- Tileset slot tabs -->
    <div class="flex flex-wrap border-b border-gray-700 shrink-0">
      <button
        v-for="slot in slots"
        :key="slot"
        :class="[
          'px-3 py-2 text-sm font-bold transition-colors',
          'border-r border-gray-700',
          editorStore.activeSlot === slot
            ? 'bg-blue-600 text-white'
            : mapStore.tilesetPool[slot]?.image
              ? 'bg-gray-700 text-gray-200 hover:bg-gray-600'
              : 'bg-gray-800 text-gray-500 hover:bg-gray-700',
        ]"
        @click="selectSlot(slot)"
        @contextmenu="showContextMenu($event, slot)"
      >
        {{ slot }}
      </button>
      <button
        class="px-2 py-2 text-xs bg-gray-800 text-gray-500
               hover:bg-gray-700 hover:text-white transition-colors"
        title="Add tileset slot"
        @click="addSlot"
      >
        <Plus :size="12" />
      </button>
    </div>

    <!-- Tileset image area -->
    <div
      ref="scrollContainer"
      class="flex-1 overflow-auto relative bg-black/20"
    >
      <div
        class="relative inline-block min-w-full min-h-full"
        v-if="activeSlotImage"
      >
        <img
          :src="activeSlotImage.src"
          @load="onImageLoad"
          class="block max-w-none pointer-events-none"
          :style="{
            width: Math.round(activeSlotImage.width * zoomScale) + 'px',
            height: Math.round(activeSlotImage.height * zoomScale) + 'px',
            imageRendering: 'pixelated',
          }"
        />
        <canvas
          ref="overlayCanvas"
          class="absolute top-0 left-0"
          :class="panelMode !== 'cursor' ? 'cursor-pointer' : 'cursor-crosshair'"
          :style="{
            width: Math.round(activeSlotImage.width * zoomScale) + 'px',
            height: Math.round(activeSlotImage.height * zoomScale) + 'px',
            imageRendering: 'pixelated',
          }"
          @mousedown="startSelection"
          @contextmenu.prevent="startSelection"
        />
      </div>
      <div
        v-else
        class="h-full flex items-center justify-center p-4
               text-center text-gray-500 text-sm"
      >
        <span class="flex flex-col gap-2 items-center">
          <span>
            Click <kbd class="text-gray-400">{{ editorStore.activeSlot }}</kbd> above to upload a tileset image
          </span>
          <span class="text-xs text-gray-600">
            Right-click a tileset tab or autotile to edit or delete it
          </span>
        </span>
      </div>
    </div>

    <!-- Autotile chooser dialog -->
    <AutoTileChooserDialog
      v-if="showChooser"
      @select="onChooserSelect"
      @upload="onChooserUpload"
      @cancel="onChooserCancel"
    />

    <!-- Source tile size scale dialog -->
    <TileSizeScaleDialog
      v-if="showScaleDialog && scaleDialogBlob"
      :map-tile-size="mapStore.tileSize"
      :blob="scaleDialogBlob"
      @confirm="onScaleConfirm"
      @cancel="onScaleCancel"
    />

    <!-- Autotile picker dialog -->
    <AutoTilePickerDialog
      v-if="pickerImage"
      :image="pickerImage"
      :tile-size="mapStore.tileSize"
      @pick="onPickerPick"
      @cancel="onPickerCancel"
    />

    <!-- Context menu -->
    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="fixed z-50 bg-gray-800 border border-gray-600
               rounded shadow-lg py-1 min-w-[140px]"
        :style="{
          left: contextMenu.x + 'px',
          top: contextMenu.y + 'px',
        }"
      >
        <button
          v-if="contextMenu.slot"
          class="w-full text-left px-3 py-1.5 text-sm
                 text-gray-300 hover:bg-gray-700
                 hover:text-white"
          @click="() => { const s = contextMenu.slot; hideContextMenu(); openFilePickerForSlot(s); }"
        >
          Upload / Replace
        </button>
        <button
          v-if="contextMenu.slot"
          class="w-full text-left px-3 py-1.5 text-sm
                 text-gray-300 hover:bg-gray-700
                 hover:text-white"
          @click="removeSlot"
        >
          Remove slot {{ contextMenu.slot }}
        </button>
        <button
          v-if="contextMenu.autoTileIndex >= 0"
          class="w-full text-left px-3 py-1.5 text-sm
                 text-gray-300 hover:bg-gray-700
                 hover:text-white"
          @click="editAutoTileProps"
        >
          Edit properties
        </button>
        <button
          v-if="contextMenu.autoTileIndex >= 0"
          class="w-full text-left px-3 py-1.5 text-sm
                 text-gray-300 hover:bg-gray-700
                 hover:text-white"
          @click="removeAutoTile"
        >
          Remove autotile {{ contextMenu.autoTileIndex }}
        </button>
      </div>
    </Teleport>

    <!-- Tile interactive object dialog -->
    <ObjectDialog
      v-if="tileIntDialog.open"
      :initial-type="tileIntDialog.initialType"
      :initial-direction="tileIntDialog.initialDirection"
      :show-remove="tileIntDialog.existing"
      @save="onTileIntSave"
      @remove="onTileIntRemove"
      @cancel="onTileIntCancel"
    />

    <AutoTilePropsDialog
      v-if="propsDialogIndex !== null
        && mapStore.autoTilePool[propsDialogIndex]"
      :auto-tile-index="propsDialogIndex"
      @close="closeAutoTileProps"
    />
  </div>
</template>
