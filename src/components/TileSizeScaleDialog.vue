<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { X } from 'lucide-vue-next';

const props = defineProps<{
  mapTileSize: number;
  blob: Blob;
}>();

const emit = defineEmits<{
  confirm: [sourceTileSize: number, spacing: number];
  cancel: [];
}>();

const COMMON_SIZES = [16, 32, 48, 64, 96, 128] as const;

const selectedSize = ref(props.mapTileSize);
const spacing = ref(0);

const scaleRatio = computed(() => {
  if (selectedSize.value === props.mapTileSize) return null;
  return (props.mapTileSize / selectedSize.value).toFixed(2);
});

// ── Preview canvas ────────────────────────────────────────────

const previewCanvas = ref<HTMLCanvasElement | null>(null);
const previewImage = ref<HTMLImageElement | null>(null);

function drawPreview() {
  const canvas = previewCanvas.value;
  const img = previewImage.value;
  if (!canvas || !img) return;

  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.imageSmoothingEnabled = false;

  const ts = selectedSize.value;
  const sp = Math.max(0, spacing.value);
  const stride = ts + sp;
  const cols = Math.floor((img.width + sp) / stride);
  const rows = Math.floor((img.height + sp) / stride);

  if (sp === 0) {
    ctx.drawImage(img, 0, 0);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= img.width; x += ts) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, img.height);
    }
    for (let y = 0; y <= img.height; y += ts) {
      ctx.moveTo(0, y);
      ctx.lineTo(img.width, y);
    }
    ctx.stroke();
  } else {
    ctx.drawImage(img, 0, 0);
    ctx.fillStyle = 'rgba(220, 40, 40, 0.45)';
    ctx.fillRect(0, 0, img.width, img.height);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const sx = c * stride;
        const sy = r * stride;
        ctx.drawImage(img, sx, sy, ts, ts, sx, sy, ts, ts);
      }
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.strokeRect(c * stride + 0.5, r * stride + 0.5, ts - 1, ts - 1);
      }
    }
  }
}

watch([selectedSize, spacing], drawPreview);

onMounted(() => {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      previewImage.value = img;
      drawPreview();
    };
    img.src = reader.result as string;
  };
  reader.readAsDataURL(props.blob);
});

// ── Resize ────────────────────────────────────────────────────

const MIN_W = 280;
const MIN_H = 320;
const MAX_W = 900;
const MAX_H = 900;

const dialogW = ref(680);
const dialogH = ref(680);

function onResizePointerDown(e: PointerEvent) {
  e.preventDefault();
  const startX = e.clientX;
  const startY = e.clientY;
  const startW = dialogW.value;
  const startH = dialogH.value;

  function onMove(ev: PointerEvent) {
    dialogW.value = Math.max(MIN_W, Math.min(MAX_W, startW + ev.clientX - startX));
    dialogH.value = Math.max(MIN_H, Math.min(MAX_H, startH + ev.clientY - startY));
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      @mousedown.self="emit('cancel')"
    >
      <div
        :style="{ width: `${dialogW}px`, height: `${dialogH}px` }"
        class="bg-gray-800 rounded-lg shadow-xl flex flex-col relative select-none"
      >
        <!-- Header -->
        <div
          class="flex items-center justify-between p-4
                 border-b border-gray-700 shrink-0"
        >
          <h3 class="text-sm font-semibold text-white">
            Source tile size
          </h3>
          <button
            class="text-gray-400 hover:text-white"
            @click="emit('cancel')"
          >
            <X :size="16" />
          </button>
        </div>

        <!-- Preview area — grows to fill available height -->
        <div
          class="flex-1 overflow-auto bg-black/40 min-h-0
                 flex items-center justify-center"
        >
          <canvas
            ref="previewCanvas"
            class="max-w-full max-h-full"
            style="image-rendering: pixelated;"
          />
        </div>

        <!-- Controls -->
        <div class="p-4 space-y-3 shrink-0">
          <p class="text-xs text-gray-400">
            Map grid:
            <strong class="text-gray-200">{{ mapTileSize }}px</strong>
          </p>

          <div class="flex flex-wrap gap-2">
            <button
              v-for="size in COMMON_SIZES"
              :key="size"
              :class="[
                'px-3 py-1.5 text-xs rounded border transition-colors',
                selectedSize === size
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600',
              ]"
              @click="selectedSize = size"
            >
              {{ size }}
              <span
                v-if="size === mapTileSize"
                class="ml-1 text-[10px] text-gray-400"
              >
                map
              </span>
            </button>
          </div>

          <div class="flex items-center gap-2">
            <label class="text-xs text-gray-400 shrink-0">
              Spacing between tiles
            </label>
            <input
              v-model.number="spacing"
              type="number"
              min="0"
              class="w-14 px-2 py-1 text-xs bg-gray-700 border
                     border-gray-600 rounded text-gray-200 text-right
                     focus:outline-none focus:border-blue-500"
            />
            <span class="text-xs text-gray-500">px</span>
          </div>

          <p
            v-if="scaleRatio !== null"
            class="text-xs text-amber-400"
          >
            &rarr; scale {{ scaleRatio }}&times;
            <span v-if="spacing > 0"> · spacing stripped</span>
          </p>
          <p
            v-else-if="spacing > 0"
            class="text-xs text-amber-400"
          >
            &rarr; spacing stripped
          </p>
          <p
            v-else
            class="text-xs text-gray-500"
          >
            No changes (1:1, no spacing)
          </p>

          <div class="flex justify-end gap-2 pt-1">
            <button
              class="px-3 py-1.5 text-xs rounded bg-gray-700
                     text-gray-300 hover:bg-gray-600 transition-colors"
              @click="emit('cancel')"
            >
              Cancel
            </button>
            <button
              class="px-3 py-1.5 text-xs rounded bg-blue-600
                     text-white hover:bg-blue-500 transition-colors"
              @click="emit('confirm', selectedSize, spacing)"
            >
              Confirm
            </button>
          </div>
        </div>

        <!-- Resize grip -->
        <div
          class="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize
                 flex items-end justify-end pb-0.5 pr-0.5"
          @pointerdown="onResizePointerDown"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M9 1L1 9M9 5L5 9M9 9" stroke="rgba(156,163,175,0.5)" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
      </div>
    </div>
  </Teleport>
</template>
