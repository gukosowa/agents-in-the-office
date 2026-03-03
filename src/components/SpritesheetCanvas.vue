<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    image: HTMLImageElement;
    cellWidth: number;
    cellHeight: number;
    regionCols: number;
    regionRows: number;
    variableCols?: boolean;
    selectedCol?: number;
    selectedRow?: number;
    selectedCols?: number;
  }>(),
  {
    variableCols: false,
    selectedCol: -1,
    selectedRow: -1,
    selectedCols: undefined,
  },
);

const emit = defineEmits<{
  select: [col: number, row: number, cols: number];
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
const hoveredCol = ref(-1);
const hoveredRow = ref(-1);

// Drag state (variableCols mode)
const isDragging = ref(false);
const dragStartCol = ref(-1);
const dragCurrentCol = ref(-1);
const dragRow = ref(-1);

const totalCols = computed(
  () => Math.floor(props.image.width / props.cellWidth),
);
const totalRows = computed(
  () => Math.floor(props.image.height / props.cellHeight),
);

const regionPxH = computed(
  () => props.regionRows * props.cellHeight,
);

const maxCol = computed(() =>
  props.variableCols
    ? Math.max(0, totalCols.value - 1)
    : Math.max(0, totalCols.value - props.regionCols),
);
const maxRow = computed(
  () => Math.max(0, totalRows.value - props.regionRows),
);

const effectiveSelectedCols = computed(
  () => props.selectedCols ?? props.regionCols,
);

function draw() {
  const cvs = canvas.value;
  if (!cvs) return;
  const ctx = cvs.getContext('2d');
  if (!ctx) return;

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  ctx.drawImage(props.image, 0, 0);

  const cw = props.cellWidth;
  const ch = props.cellHeight;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 0; c <= totalCols.value; c++) {
    ctx.moveTo(c * cw, 0);
    ctx.lineTo(c * cw, totalRows.value * ch);
  }
  for (let r = 0; r <= totalRows.value; r++) {
    ctx.moveTo(0, r * ch);
    ctx.lineTo(totalCols.value * cw, r * ch);
  }
  ctx.stroke();

  const rph = regionPxH.value;

  // Drag preview
  if (isDragging.value) {
    const minC = Math.min(
      dragStartCol.value, dragCurrentCol.value,
    );
    const maxC = Math.max(
      dragStartCol.value, dragCurrentCol.value,
    );
    const dragW = (maxC - minC + 1) * cw;
    ctx.fillStyle = 'rgba(59, 130, 246, 0.35)';
    ctx.fillRect(minC * cw, dragRow.value * ch, dragW, rph);
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      minC * cw + 1, dragRow.value * ch + 1,
      dragW - 2, rph - 2,
    );
  } else if (
    hoveredCol.value >= 0
    && hoveredRow.value >= 0
    && (hoveredCol.value !== props.selectedCol
      || hoveredRow.value !== props.selectedRow)
  ) {
    const hoverW = props.variableCols
      ? cw
      : props.regionCols * cw;
    ctx.fillStyle = 'rgba(59, 130, 246, 0.25)';
    ctx.fillRect(
      hoveredCol.value * cw,
      hoveredRow.value * ch,
      hoverW,
      rph,
    );
  }

  if (props.selectedCol >= 0 && props.selectedRow >= 0) {
    const selW = effectiveSelectedCols.value * cw;
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      props.selectedCol * cw + 1,
      props.selectedRow * ch + 1,
      selW - 2,
      rph - 2,
    );
    ctx.fillStyle = 'rgba(250, 204, 21, 0.15)';
    ctx.fillRect(
      props.selectedCol * cw,
      props.selectedRow * ch,
      selW,
      rph,
    );
  }
}

function getCellCoord(e: MouseEvent) {
  const cvs = canvas.value;
  if (!cvs) return null;
  const rect = cvs.getBoundingClientRect();
  const scaleX = cvs.width / rect.width;
  const scaleY = cvs.height / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;
  const col = Math.min(
    Math.floor(x / props.cellWidth),
    maxCol.value,
  );
  const row = Math.min(
    Math.floor(y / props.cellHeight),
    maxRow.value,
  );
  if (col < 0 || row < 0) return null;
  return { col, row };
}

function getRawCol(e: MouseEvent): number {
  const cvs = canvas.value;
  if (!cvs) return -1;
  const rect = cvs.getBoundingClientRect();
  const scaleX = cvs.width / rect.width;
  const x = (e.clientX - rect.left) * scaleX;
  const col = Math.floor(x / props.cellWidth);
  return Math.max(0, Math.min(col, totalCols.value - 1));
}

function onMouseDown(e: MouseEvent) {
  if (!props.variableCols) return;
  const coord = getCellCoord(e);
  if (!coord) return;
  isDragging.value = true;
  dragStartCol.value = coord.col;
  dragCurrentCol.value = coord.col;
  dragRow.value = coord.row;
  draw();
}

function onMouseMove(e: MouseEvent) {
  if (isDragging.value) {
    dragCurrentCol.value = getRawCol(e);
  }
  const coord = getCellCoord(e);
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
  if (isDragging.value) {
    isDragging.value = false;
    const minC = Math.min(
      dragStartCol.value, dragCurrentCol.value,
    );
    const maxC = Math.max(
      dragStartCol.value, dragCurrentCol.value,
    );
    emit('select', minC, dragRow.value, maxC - minC + 1);
  }
  draw();
}

function onMouseUp() {
  if (!isDragging.value) return;
  isDragging.value = false;
  const minC = Math.min(
    dragStartCol.value, dragCurrentCol.value,
  );
  const maxC = Math.max(
    dragStartCol.value, dragCurrentCol.value,
  );
  emit('select', minC, dragRow.value, maxC - minC + 1);
  draw();
}

function onClick(e: MouseEvent) {
  if (props.variableCols) return;
  const coord = getCellCoord(e);
  if (coord) {
    emit('select', coord.col, coord.row, props.regionCols);
  }
  draw();
}

function syncCanvasSize() {
  const cvs = canvas.value;
  if (!cvs) return;
  cvs.width = props.image.width;
  cvs.height = props.image.height;
  draw();
}

onMounted(syncCanvasSize);

watch(() => props.image, syncCanvasSize);

watch(
  () => [
    props.cellWidth,
    props.cellHeight,
    props.regionCols,
    props.regionRows,
    props.selectedCol,
    props.selectedRow,
    props.selectedCols,
  ],
  draw,
);
</script>

<template>
  <canvas
    ref="canvas"
    class="block cursor-pointer"
    style="
      image-rendering: pixelated;
      image-rendering: crisp-edges;
    "
    @mousedown="onMouseDown"
    @mousemove="onMouseMove"
    @mouseleave="onMouseLeave"
    @mouseup="onMouseUp"
    @click="onClick"
  />
</template>
