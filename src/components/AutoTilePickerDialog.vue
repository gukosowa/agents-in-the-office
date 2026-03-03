<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import type { AutoTileType } from '../stores/mapStore';

const props = defineProps<{
  image: HTMLImageElement;
  tileSize: number;
}>();

const emit = defineEmits<{
  pick: [blob: Blob, type: AutoTileType, col: number, row: number];
  cancel: [];
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
const LS_KEY = 'autotile-last-type';

function loadLastType(): AutoTileType {
  const stored = localStorage.getItem(LS_KEY);
  if (stored === 'A' || stored === 'B' || stored === 'C') {
    return stored;
  }
  return 'A';
}

const selectedType = ref<AutoTileType>(loadLastType());

const regionW = computed(() => {
  const t = selectedType.value;
  if (t === 'B' || t === 'C') return props.tileSize * 2;
  return props.tileSize * 3;
});
const regionH = computed(() => {
  const t = selectedType.value;
  if (t === 'C') return props.tileSize * 5;
  if (t === 'B') return props.tileSize * 3;
  return props.tileSize * 4;
});

const tileCols = computed(
  () => Math.floor(props.image.width / props.tileSize),
);
const tileRows = computed(
  () => Math.floor(props.image.height / props.tileSize),
);

const maxCol = computed(
  () => Math.floor(
    (props.image.width - regionW.value) / props.tileSize,
  ),
);
const maxRow = computed(
  () => Math.floor(
    (props.image.height - regionH.value) / props.tileSize,
  ),
);

const hoveredCol = ref(-1);
const hoveredRow = ref(-1);
const selectedCol = ref(-1);
const selectedRow = ref(-1);

function draw() {
  const cvs = canvas.value;
  if (!cvs) return;
  const ctx = cvs.getContext('2d');
  if (!ctx) return;

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  ctx.drawImage(props.image, 0, 0);

  const rw = regionW.value;
  const rh = regionH.value;
  const ts = props.tileSize;

  // Grid lines at tile-size intervals
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 0; c <= tileCols.value; c++) {
    ctx.moveTo(c * ts, 0);
    ctx.lineTo(c * ts, tileRows.value * ts);
  }
  for (let r = 0; r <= tileRows.value; r++) {
    ctx.moveTo(0, r * ts);
    ctx.lineTo(tileCols.value * ts, r * ts);
  }
  ctx.stroke();

  // Hovered region (region-sized, tile-snapped)
  if (
    hoveredCol.value >= 0
    && hoveredRow.value >= 0
    && (hoveredCol.value !== selectedCol.value
      || hoveredRow.value !== selectedRow.value)
  ) {
    ctx.fillStyle = 'rgba(59, 130, 246, 0.25)';
    ctx.fillRect(
      hoveredCol.value * ts,
      hoveredRow.value * ts,
      rw,
      rh,
    );
  }

  // Selected region (region-sized, tile-snapped)
  if (selectedCol.value >= 0 && selectedRow.value >= 0) {
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      selectedCol.value * ts + 1,
      selectedRow.value * ts + 1,
      rw - 2,
      rh - 2,
    );
    ctx.fillStyle = 'rgba(250, 204, 21, 0.15)';
    ctx.fillRect(
      selectedCol.value * ts,
      selectedRow.value * ts,
      rw,
      rh,
    );
  }
}

function getTileCoord(e: MouseEvent) {
  const cvs = canvas.value;
  if (!cvs) return null;
  const rect = cvs.getBoundingClientRect();
  const scaleX = cvs.width / rect.width;
  const scaleY = cvs.height / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;
  const ts = props.tileSize;
  const col = Math.min(Math.floor(x / ts), maxCol.value);
  const row = Math.min(Math.floor(y / ts), maxRow.value);
  if (col < 0 || row < 0) return null;
  return { col, row };
}

function onMouseMove(e: MouseEvent) {
  const coord = getTileCoord(e);
  if (coord) {
    hoveredCol.value = coord.col;
    hoveredRow.value = coord.row;
  } else {
    hoveredCol.value = -1;
    hoveredRow.value = -1;
  }
  draw();
}

function onMouseLeave() {
  hoveredCol.value = -1;
  hoveredRow.value = -1;
  draw();
}

function onClick(e: MouseEvent) {
  const coord = getTileCoord(e);
  if (coord) {
    selectedCol.value = coord.col;
    selectedRow.value = coord.row;
  }
  draw();
}

function cropRegion(): Promise<Blob> {
  const rw = regionW.value;
  const rh = regionH.value;
  const ts = props.tileSize;
  const offscreen = document.createElement('canvas');
  offscreen.width = rw;
  offscreen.height = rh;
  const ctx = offscreen.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    props.image,
    selectedCol.value * ts,
    selectedRow.value * ts,
    rw,
    rh,
    0,
    0,
    rw,
    rh,
  );
  return new Promise((resolve, reject) => {
    offscreen.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to crop autotile region'));
      },
      'image/png',
    );
  });
}

async function confirm() {
  if (selectedCol.value < 0 || selectedRow.value < 0) return;
  const blob = await cropRegion();
  emit('pick', blob, selectedType.value, selectedCol.value, selectedRow.value);
}

function cancel() {
  emit('cancel');
}

onMounted(() => {
  const cvs = canvas.value;
  if (cvs) {
    cvs.width = props.image.width;
    cvs.height = props.image.height;
    draw();
  }
});

watch(() => props.image, () => {
  const cvs = canvas.value;
  if (cvs) {
    cvs.width = props.image.width;
    cvs.height = props.image.height;
    draw();
  }
});

watch(selectedType, () => {
  localStorage.setItem(LS_KEY, selectedType.value);
  selectedCol.value = -1;
  selectedRow.value = -1;
  draw();
});
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 bg-black/50 flex items-center
             justify-center z-50"
      @click.self="cancel"
    >
      <div
        class="bg-gray-800 p-6 rounded shadow-lg
               max-w-[90vw] max-h-[90vh] flex flex-col"
      >
        <h2 class="text-lg font-bold text-white mb-3">
          Select Autotile Region
        </h2>
        <div class="flex gap-2 mb-3">
          <button
            v-for="t in (['A', 'B', 'C'] as const)"
            :key="t"
            :class="[
              'px-3 py-1 text-xs font-bold rounded',
              'transition-colors',
              selectedType === t
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
            ]"
            @click="selectedType = t"
          >
            Type {{ t }}
          </button>
        </div>

        <p class="text-sm text-gray-400 mb-3">
          Click on the {{ regionW }}&times;{{ regionH }}px
          autotile region you want to add.
        </p>

        <div
          class="flex-1 overflow-auto border border-gray-600
                 bg-gray-900 min-h-0"
        >
          <canvas
            ref="canvas"
            class="block cursor-pointer"
            style="
              image-rendering: pixelated;
              image-rendering: crisp-edges;
            "
            @mousemove="onMouseMove"
            @mouseleave="onMouseLeave"
            @click="onClick"
          />
        </div>

        <div class="flex justify-end gap-2 mt-4">
          <button
            class="px-4 py-2 bg-gray-700 hover:bg-gray-600
                   rounded text-white transition-colors text-sm"
            @click="cancel"
          >
            Cancel
          </button>
          <button
            :disabled="selectedCol < 0 || selectedRow < 0"
            :class="[
              'px-4 py-2 rounded text-white transition-colors',
              'text-sm',
              selectedCol >= 0 && selectedRow >= 0
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-gray-600 cursor-not-allowed opacity-50',
            ]"
            @click="confirm"
          >
            Add Autotile
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
