<script setup lang="ts">
import {
  ref, computed, onMounted, onBeforeUnmount, watch, nextTick,
} from 'vue';
import { Layers, Ban, Upload, Scan } from 'lucide-vue-next';
import {
  useMapStore, type AutoTileType,
} from '../stores/mapStore';
import AutoTileChooserDialog
  from '../components/AutoTileChooserDialog.vue';

const props = defineProps<{
  autoTileIndex: number;
}>();

const emit = defineEmits<{ close: [] }>();

const mapStore = useMapStore();
const canvas = ref<HTMLCanvasElement | null>(null);
const mode = ref<'picker' | 'depth' | 'collision'>('depth');
const replaceInput = ref<HTMLInputElement | null>(null);

const slot = computed(
  () => mapStore.autoTilePool[props.autoTileIndex],
);
const ts = computed(() => mapStore.tileSize);

const currentType = computed(
  () => slot.value?.type ?? 'A',
);

function changeType(type: AutoTileType) {
  mapStore.setAutoTileType(props.autoTileIndex, type);
}

// ── Expected dimensions for current type ─────────────────
function expectedSize(type: AutoTileType) {
  const t = ts.value;
  if (type === 'C') return { w: t * 2, h: t * 5 };
  if (type === 'B') return { w: t * 2, h: t * 3 };
  return { w: t * 3, h: t * 4 };
}

// ── Picker state ─────────────────────────────────────────
const pickerImage = ref<HTMLImageElement | null>(null);
/** Blob that pickerImage was created from (for source persistence). */
const pickerSourceBlob = ref<Blob | null>(null);
const pickerHovCol = ref(-1);
const pickerHovRow = ref(-1);
const pickerSelCol = ref(-1);
const pickerSelRow = ref(-1);

const pickerRegionW = computed(
  () => expectedSize(currentType.value).w,
);
const pickerRegionH = computed(
  () => expectedSize(currentType.value).h,
);

const activePickerImage = computed(
  () => pickerImage.value ?? slot.value?.image ?? null,
);

const pickerMaxCol = computed(() => {
  const img = activePickerImage.value;
  if (!img) return 0;
  return Math.max(
    0,
    Math.floor(
      (img.width - pickerRegionW.value) / ts.value,
    ),
  );
});
const pickerMaxRow = computed(() => {
  const img = activePickerImage.value;
  if (!img) return 0;
  return Math.max(
    0,
    Math.floor(
      (img.height - pickerRegionH.value) / ts.value,
    ),
  );
});

const canPick = computed(() => {
  const img = activePickerImage.value;
  if (!img) return false;
  const { w, h } = expectedSize(currentType.value);
  return img.width >= w && img.height >= h;
});

const hasPickerSelection = computed(
  () => pickerSelCol.value >= 0 && pickerSelRow.value >= 0,
);

// ── Replace image ────────────────────────────────────────
const showChooser = ref(false);

function triggerReplace() {
  showChooser.value = true;
}

function onChooserSelect(blob: Blob) {
  showChooser.value = false;
  loadReplaceBlob(blob);
}

function onChooserUpload() {
  showChooser.value = false;
  replaceInput.value?.click();
}

function handleReplace(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  (event.target as HTMLInputElement).value = '';
  loadReplaceBlob(file);
}

function loadReplaceBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const { w, h } = expectedSize(currentType.value);
    if (img.width === w && img.height === h) {
      // Exact size match — no source spritesheet needed; clear source info.
      mapStore.replaceAutoTile(props.autoTileIndex, blob);
      URL.revokeObjectURL(url);
      return;
    }
    if (pickerImage.value) {
      URL.revokeObjectURL(pickerImage.value.src);
    }
    pickerImage.value = img;
    pickerSourceBlob.value = blob;
    pickerSelCol.value = -1;
    pickerSelRow.value = -1;
    mode.value = 'picker';
  };
  img.src = url;
}

async function confirmPick() {
  const img = activePickerImage.value;
  if (!img || !hasPickerSelection.value) return;

  const t = ts.value;
  const rw = pickerRegionW.value;
  const rh = pickerRegionH.value;
  const offscreen = document.createElement('canvas');
  offscreen.width = rw;
  offscreen.height = rh;
  const ctx = offscreen.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    img,
    pickerSelCol.value * t,
    pickerSelRow.value * t,
    rw, rh,
    0, 0, rw, rh,
  );

  const blob = await new Promise<Blob>((resolve, reject) => {
    offscreen.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Failed to crop autotile region'));
    }, 'image/png');
  });

  // Capture source info before clearing picker state.
  const srcBlob = pickerSourceBlob.value ?? undefined;
  const srcCol = pickerSelCol.value;
  const srcRow = pickerSelRow.value;

  if (pickerImage.value) {
    URL.revokeObjectURL(pickerImage.value.src);
    pickerImage.value = null;
  }
  pickerSourceBlob.value = null;
  pickerSelCol.value = -1;
  pickerSelRow.value = -1;
  await mapStore.replaceAutoTile(
    props.autoTileIndex, blob, currentType.value,
    srcBlob, srcCol, srcRow,
  );
  mode.value = 'depth';
}

function cancelPick() {
  if (pickerImage.value) {
    URL.revokeObjectURL(pickerImage.value.src);
    pickerImage.value = null;
  }
  pickerSourceBlob.value = null;
  pickerSelCol.value = -1;
  pickerSelRow.value = -1;
  mode.value = 'depth';
}

// ── Depth/collision constants ────────────────────────────
const DEPTH_COLORS: Record<number, [string, string]> = {
  [-1]: ['rgba(59, 130, 246, 0.35)', '#3b82f6'],
  [1]: ['rgba(245, 158, 11, 0.35)', '#f59e0b'],
  [2]: ['rgba(239, 68, 68, 0.35)', '#ef4444'],
};
const DEPTH_LABELS: Record<number, string> = {
  [-1]: '-1', [1]: '+1', [2]: '+2',
};

// ── Unified canvas drawing ───────────────────────────────
function drawCanvas() {
  if (mode.value === 'picker') {
    drawPicker();
  } else {
    drawProps();
  }
}

function drawPicker() {
  const cvs = canvas.value;
  const img = activePickerImage.value;
  if (!cvs || !img) return;
  const ctx = cvs.getContext('2d');
  if (!ctx) return;

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  ctx.drawImage(img, 0, 0);

  const t = ts.value;
  const cols = Math.floor(img.width / t);
  const rows = Math.floor(img.height / t);
  const rw = pickerRegionW.value;
  const rh = pickerRegionH.value;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 0; c <= cols; c++) {
    ctx.moveTo(c * t, 0);
    ctx.lineTo(c * t, rows * t);
  }
  for (let r = 0; r <= rows; r++) {
    ctx.moveTo(0, r * t);
    ctx.lineTo(cols * t, r * t);
  }
  ctx.stroke();

  if (!canPick.value) return;

  if (
    pickerHovCol.value >= 0
    && pickerHovRow.value >= 0
    && (pickerHovCol.value !== pickerSelCol.value
      || pickerHovRow.value !== pickerSelRow.value)
  ) {
    ctx.fillStyle = 'rgba(59, 130, 246, 0.25)';
    ctx.fillRect(
      pickerHovCol.value * t,
      pickerHovRow.value * t,
      rw, rh,
    );
  }

  if (hasPickerSelection.value) {
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      pickerSelCol.value * t + 1,
      pickerSelRow.value * t + 1,
      rw - 2, rh - 2,
    );
    ctx.fillStyle = 'rgba(250, 204, 21, 0.15)';
    ctx.fillRect(
      pickerSelCol.value * t,
      pickerSelRow.value * t,
      rw, rh,
    );
  }
}

function drawProps() {
  const cvs = canvas.value;
  const img = slot.value?.image;
  if (!cvs || !img) return;
  const ctx = cvs.getContext('2d');
  if (!ctx) return;

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  ctx.drawImage(img, 0, 0);

  const t = ts.value;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= cvs.width; x += t) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, cvs.height);
  }
  for (let y = 0; y <= cvs.height; y += t) {
    ctx.moveTo(0, y);
    ctx.lineTo(cvs.width, y);
  }
  ctx.stroke();

  if (mode.value === 'depth') {
    const dm = slot.value?.depthMap ?? {};
    for (const [key, depth] of Object.entries(dm)) {
      const [cx, cy] = key.split(',').map(Number);
      if (cx === undefined || cy === undefined) continue;
      const colors = DEPTH_COLORS[depth];
      if (!colors) continue;
      ctx.fillStyle = colors[0];
      ctx.fillRect(cx * t, cy * t, t, t);
      ctx.fillStyle = colors[1];
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        DEPTH_LABELS[depth] ?? '',
        cx * t + t / 2,
        cy * t + t / 2,
      );
    }
  }

  if (mode.value === 'collision') {
    const cm = slot.value?.collisionMap ?? {};
    for (const key of Object.keys(cm)) {
      const [cx, cy] = key.split(',').map(Number);
      if (cx === undefined || cy === undefined) continue;
      ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
      ctx.fillRect(cx * t, cy * t, t, t);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      const pad = 4;
      ctx.beginPath();
      ctx.moveTo(cx * t + pad, cy * t + pad);
      ctx.lineTo(cx * t + t - pad, cy * t + t - pad);
      ctx.moveTo(cx * t + t - pad, cy * t + pad);
      ctx.lineTo(cx * t + pad, cy * t + t - pad);
      ctx.stroke();
    }
  }
}

// ── Canvas events ────────────────────────────────────────
function getPickerCoord(e: MouseEvent) {
  const cvs = canvas.value;
  if (!cvs) return null;
  const rect = cvs.getBoundingClientRect();
  const scaleX = cvs.width / rect.width;
  const scaleY = cvs.height / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;
  const t = ts.value;
  const col = Math.min(
    Math.floor(x / t), pickerMaxCol.value,
  );
  const row = Math.min(
    Math.floor(y / t), pickerMaxRow.value,
  );
  if (col < 0 || row < 0) return null;
  return { col, row };
}

function getPropsCoord(e: MouseEvent) {
  const cvs = canvas.value;
  const img = slot.value?.image;
  if (!cvs || !img) return null;
  const rect = cvs.getBoundingClientRect();
  const scaleX = cvs.width / rect.width;
  const scaleY = cvs.height / rect.height;
  const px = (e.clientX - rect.left) * scaleX;
  const py = (e.clientY - rect.top) * scaleY;
  const t = ts.value;
  const cols = Math.floor(img.width / t);
  const rows = Math.floor(img.height / t);
  const col = Math.floor(px / t);
  const row = Math.floor(py / t);
  if (col < 0 || col >= cols) return null;
  if (row < 0 || row >= rows) return null;
  return { col, row };
}

function onCanvasClick(e: MouseEvent) {
  if (mode.value === 'picker') {
    if (!canPick.value) return;
    const coord = getPickerCoord(e);
    if (coord) {
      pickerSelCol.value = coord.col;
      pickerSelRow.value = coord.row;
    }
    drawCanvas();
    return;
  }
  const coord = getPropsCoord(e);
  if (!coord) return;
  if (mode.value === 'depth') {
    mapStore.cycleAutoTileDepth(
      props.autoTileIndex, coord.col, coord.row,
    );
  } else {
    mapStore.toggleAutoTileCollision(
      props.autoTileIndex, coord.col, coord.row,
    );
  }
  drawCanvas();
}

function onCanvasMove(e: MouseEvent) {
  if (mode.value !== 'picker' || !canPick.value) return;
  const coord = getPickerCoord(e);
  if (coord) {
    pickerHovCol.value = coord.col;
    pickerHovRow.value = coord.row;
  } else {
    pickerHovCol.value = -1;
    pickerHovRow.value = -1;
  }
  drawCanvas();
}

function onCanvasLeave() {
  if (mode.value !== 'picker') return;
  pickerHovCol.value = -1;
  pickerHovRow.value = -1;
  drawCanvas();
}

// ── Canvas init ──────────────────────────────────────────
function sizeCanvas() {
  const cvs = canvas.value;
  if (!cvs) return;
  if (mode.value === 'picker') {
    const img = activePickerImage.value;
    if (!img) return;
    cvs.width = img.width;
    cvs.height = img.height;
  } else {
    const img = slot.value?.image;
    if (!img) return;
    cvs.width = img.width;
    cvs.height = img.height;
  }
}

function initCanvas() {
  sizeCanvas();
  drawCanvas();
}

onMounted(initCanvas);

onBeforeUnmount(() => {
  if (pickerImage.value) {
    URL.revokeObjectURL(pickerImage.value.src);
  }
});

watch(() => slot.value?.image, initCanvas);
watch(mode, async () => {
  // When entering picker mode with no active picker image, restore the
  // source spritesheet + selection from the slot if available.
  if (mode.value === 'picker' && !pickerImage.value) {
    const src = slot.value;
    if (
      src?.sourceBlob
      && src.sourceCol !== undefined
      && src.sourceRow !== undefined
    ) {
      const url = URL.createObjectURL(src.sourceBlob);
      const img = new Image();
      img.onload = () => {
        pickerImage.value = img;
        pickerSourceBlob.value = src.sourceBlob!;
        pickerSelCol.value = src.sourceCol!;
        pickerSelRow.value = src.sourceRow!;
        // watch(pickerImage) will call initCanvas
      };
      img.src = url;
      return; // initCanvas called by pickerImage watch
    }
  }
  await nextTick();
  initCanvas();
});
watch(
  () => [slot.value?.depthMap, slot.value?.collisionMap],
  drawCanvas,
  { deep: true },
);
watch(pickerImage, async () => {
  await nextTick();
  initCanvas();
});
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 bg-black/50 flex items-center
             justify-center z-50"
      @click.self="emit('close')"
    >
      <div
        class="bg-gray-800 p-6 rounded shadow-lg
               max-w-[90vw] max-h-[90vh] flex flex-col"
      >
        <h2 class="text-lg font-bold text-white mb-3">
          Autotile Properties
        </h2>

        <input
          ref="replaceInput"
          type="file"
          accept="image/png"
          class="hidden"
          @change="handleReplace"
        />

        <!-- Type selector + Replace image -->
        <div class="flex items-center gap-3 mb-3">
          <div class="flex items-center gap-1">
            <span class="text-xs text-gray-400 mr-1">Type</span>
            <button
              v-for="t in (['A', 'B', 'C'] as const)"
              :key="t"
              :class="[
                'px-2 py-0.5 text-xs font-bold rounded',
                'transition-colors',
                currentType === t
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
              ]"
              @click="changeType(t)"
            >
              {{ t }}
            </button>
          </div>
          <div class="border-l border-gray-600 h-4" />
          <button
            class="flex items-center gap-1 px-2 py-0.5
                   text-xs rounded bg-gray-700 text-gray-300
                   hover:bg-gray-600 hover:text-white
                   transition-colors"
            title="Replace autotile image"
            @click="triggerReplace"
          >
            <Upload :size="12" />
            Replace image
          </button>
        </div>

        <!-- Mode button group: Picker | Depth | Collision -->
        <div class="flex gap-2 mb-3">
          <button
            :class="[
              'p-1.5 rounded transition-colors flex gap-1',
              'items-center text-xs',
              mode === 'picker'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600',
            ]"
            title="Select region"
            @click="mode = 'picker'"
          >
            <Scan :size="14" />
            Region
          </button>
          <button
            :class="[
              'p-1.5 rounded transition-colors flex gap-1',
              'items-center text-xs',
              mode === 'depth'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600',
            ]"
            title="Depth mode"
            @click="mode = 'depth'"
          >
            <Layers :size="14" />
            Depth
          </button>
          <button
            :class="[
              'p-1.5 rounded transition-colors flex gap-1',
              'items-center text-xs',
              mode === 'collision'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600',
            ]"
            title="Collision mode"
            @click="mode = 'collision'"
          >
            <Ban :size="14" />
            Collision
          </button>
        </div>

        <!-- Help text -->
        <p class="text-xs text-gray-400 mb-3">
          <template v-if="mode === 'picker' && canPick">
            Click the {{ pickerRegionW }}&times;{{ pickerRegionH }}px
            region to use.
          </template>
          <template v-else-if="mode === 'picker'">
            Image matches expected size. Use
            <strong class="text-gray-300">Replace image</strong>
            to load a spritesheet.
          </template>
          <template v-else-if="mode === 'depth'">
            Click tiles to cycle depth:
            0 &rarr; +1 &rarr; +2 &rarr; -1 &rarr; 0
          </template>
          <template v-else>
            Click tiles to toggle collision.
          </template>
        </p>

        <!-- Single canvas area -->
        <div
          class="flex-1 overflow-auto border border-gray-600
                 bg-gray-900 min-h-0"
        >
          <canvas
            ref="canvas"
            class="block"
            :class="
              mode === 'picker' && canPick
                ? 'cursor-pointer'
                : mode !== 'picker'
                  ? 'cursor-pointer'
                  : 'cursor-default'
            "
            style="
              image-rendering: pixelated;
              image-rendering: crisp-edges;
            "
            @click="onCanvasClick"
            @mousemove="onCanvasMove"
            @mouseleave="onCanvasLeave"
          />
        </div>

        <!-- Footer -->
        <div class="flex justify-end gap-2 mt-4">
          <template v-if="mode === 'picker' && canPick">
            <button
              class="px-4 py-2 bg-gray-700 hover:bg-gray-600
                     rounded text-white transition-colors text-sm"
              @click="cancelPick"
            >
              Cancel
            </button>
            <button
              :disabled="!hasPickerSelection"
              :class="[
                'px-4 py-2 rounded text-white text-sm',
                'transition-colors',
                hasPickerSelection
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'bg-gray-600 cursor-not-allowed opacity-50',
              ]"
              @click="confirmPick"
            >
              Use Selection
            </button>
          </template>
          <button
            v-else
            class="px-4 py-2 bg-blue-600 hover:bg-blue-700
                   rounded text-white transition-colors text-sm"
            @click="emit('close')"
          >
            Done
          </button>
        </div>
      </div>
    </div>

    <AutoTileChooserDialog
      v-if="showChooser"
      @select="onChooserSelect"
      @upload="onChooserUpload"
      @cancel="showChooser = false"
    />
  </Teleport>
</template>
