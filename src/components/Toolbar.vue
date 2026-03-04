<script setup lang="ts">
import { ref, watch, onBeforeUnmount, nextTick } from 'vue';
import { useMapStore } from '../stores/mapStore';
import { useEditorStore } from '../stores/editorStore';
import { useUndoStore } from '../stores/undoStore';
import {
  Save, HardDriveDownload, FolderOpen,
  FilePlus2, Grid3x3, Undo2, Redo2, Keyboard,
} from 'lucide-vue-next';

const editorStore = useEditorStore();
const mapStore = useMapStore();
const undoStore = useUndoStore();
const emit = defineEmits(['new-map', 'save', 'export', 'open-file']);
defineProps<{ isDirty?: boolean }>();

const GRID_PRESETS = [16, 32, 48];
const gridSizeOption = ref(String(mapStore.tileSize));
const customGridSize = ref(mapStore.tileSize);

watch(() => mapStore.tileSize, (val) => {
  if (GRID_PRESETS.includes(val)) {
    gridSizeOption.value = String(val);
  } else {
    gridSizeOption.value = 'custom';
    customGridSize.value = val;
  }
});

const onGridSizeChange = (value: string) => {
  gridSizeOption.value = value;
  if (value !== 'custom') {
    mapStore.tileSize = Number(value);
  }
};

const onCustomGridSizeInput = (event: Event) => {
  const raw = (event.target as HTMLInputElement).valueAsNumber;
  if (Number.isNaN(raw)) return;
  const clamped = Math.max(8, Math.min(128, raw));
  customGridSize.value = clamped;
  mapStore.tileSize = clamped;
};

// --- Confirm popover ---
const POPOVER_W = 224;
const POPOVER_H = 104;
const MARGIN = 8;

const newMapBtnRef = ref<HTMLButtonElement | null>(null);
const showConfirm = ref(false);
const popoverStyle = ref({ top: '0px', left: '0px' });
const placement = ref<'bottom' | 'top'>('bottom');

function computePosition() {
  if (!newMapBtnRef.value) return;
  const r = newMapBtnRef.value.getBoundingClientRect();

  const fitsBelow = r.bottom + MARGIN + POPOVER_H <= window.innerHeight;
  placement.value = fitsBelow ? 'bottom' : 'top';

  const top = fitsBelow
    ? r.bottom + MARGIN
    : r.top - MARGIN - POPOVER_H;

  const idealLeft = r.left + r.width / 2 - POPOVER_W / 2;
  const left = Math.max(MARGIN, Math.min(window.innerWidth - POPOVER_W - MARGIN, idealLeft));

  popoverStyle.value = { top: `${Math.round(top)}px`, left: `${Math.round(left)}px` };
}

function openConfirm() {
  showConfirm.value = true;
  void nextTick(computePosition);
}

function closeConfirm() {
  showConfirm.value = false;
}

function confirm() {
  closeConfirm();
  emit('new-map');
}

function onResize() {
  if (showConfirm.value) computePosition();
}

watch(showConfirm, (open) => {
  if (open) window.addEventListener('resize', onResize);
  else window.removeEventListener('resize', onResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
});

const showShortcuts = ref(false);

const toolShortcuts = [
  { key: 'Q', label: 'Pen' },
  { key: 'W', label: 'Eraser' },
  { key: 'E', label: 'Fill' },
  { key: 'C', label: 'Pick tile (eyedropper)' },
  { key: 'M', label: 'Move selection' },
  { key: 'Space (hold)', label: 'Pan canvas' },
];

const modeShortcuts = [
  { key: 'A', label: 'Toggle rectangle mode' },
  { key: 'S', label: 'Toggle line mode' },
];

const transformShortcuts = [
  { key: 'F', label: 'Flip horizontal' },
  { key: 'V', label: 'Flip vertical' },
  { key: 'R', label: 'Rotate 90° CW' },
];

const viewShortcuts = [
  { key: 'G', label: 'Toggle grid' },
  { key: 'T', label: 'Toggle collision overlay' },
  { key: 'X', label: 'Cycle to next autotile' },
  { key: 'Y', label: 'Cycle to next tileset' },
];

const selectionShortcuts = [
  { key: 'Esc', label: 'Deselect / clear selection' },
  { key: 'Del / ⌫', label: 'Delete selected tiles' },
  { key: '⌘C', label: 'Copy selection' },
  { key: '⌘V', label: 'Paste' },
];

const fileShortcuts = [
  { key: '⌘N', label: 'New map' },
  { key: '⌘S', label: 'Save' },
  { key: '⌘⇧S', label: 'Save as' },
  { key: '⌘O', label: 'Open file' },
  { key: '⌘Z', label: 'Undo' },
  { key: '⌘⇧Z', label: 'Redo' },
];
</script>

<template>
  <div class="flex gap-1.5 items-center">
    <button
      ref="newMapBtnRef"
      class="p-1.5 rounded bg-blue-700 text-white hover:bg-blue-600"
      title="New Map (Cmd+N)"
      @click="openConfirm"
    >
      <FilePlus2 :size="18" />
    </button>
    <button
      class="relative p-1.5 rounded bg-green-700 text-white
             hover:bg-green-600"
      title="Save to file (Cmd+S)"
      @click="$emit('save')"
    >
      <Save :size="18" />
      <span
        v-if="isDirty"
        class="absolute top-0 right-0.5 text-[10px] leading-none
               text-white font-bold pointer-events-none"
      >*</span>
    </button>
    <button
      class="p-1.5 rounded bg-teal-700 text-white
             hover:bg-teal-600"
      title="Save As (Cmd+Shift+S)"
      @click="$emit('export')"
    >
      <HardDriveDownload :size="18" />
    </button>
    <button
      class="p-1.5 rounded bg-yellow-700 text-white
             hover:bg-yellow-600"
      title="Open File (Cmd+O)"
      @click="$emit('open-file')"
    >
      <FolderOpen :size="18" />
    </button>

    <div class="border-l border-gray-600 mx-1 h-5" />

    <button
      class="p-1.5 rounded transition-colors"
      :class="undoStore.canUndo
        ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
        : 'bg-gray-800 text-gray-600 cursor-not-allowed'"
      title="Undo (Ctrl+Z)"
      :disabled="!undoStore.canUndo"
      @click="undoStore.undo()"
    >
      <Undo2 :size="18" />
    </button>
    <button
      class="p-1.5 rounded transition-colors"
      :class="undoStore.canRedo
        ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
        : 'bg-gray-800 text-gray-600 cursor-not-allowed'"
      title="Redo (Ctrl+Shift+Z)"
      :disabled="!undoStore.canRedo"
      @click="undoStore.redo()"
    >
      <Redo2 :size="18" />
    </button>

    <div class="border-l border-gray-600 mx-1 h-5" />

    <div class="flex items-center gap-1.5 text-xs text-gray-300">
      <span>Grid:</span>
      <select
        :value="gridSizeOption"
        class="bg-gray-700 text-white px-1.5 py-0.5 rounded
               border border-gray-600 text-xs
               focus:outline-none focus:border-blue-500"
        @change="
          onGridSizeChange(
            ($event.target as HTMLSelectElement).value,
          )
        "
      >
        <option value="16">16px</option>
        <option value="32">32px</option>
        <option value="48">48px</option>
        <option value="custom">Custom</option>
      </select>
      <input
        v-if="gridSizeOption === 'custom'"
        type="number"
        :value="customGridSize"
        min="8"
        max="128"
        class="w-14 bg-gray-700 text-white px-1.5 py-0.5
               rounded border border-gray-600 text-xs
               focus:outline-none focus:border-blue-500"
        @input="onCustomGridSizeInput"
      />
      <button
        :title="
          editorStore.showGrid
            ? 'Hide Grid (G)'
            : 'Show Grid (G)'
        "
        :class="
          editorStore.showGrid
            ? 'bg-blue-600 text-white'
            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
        "
        class="relative p-1 rounded transition-colors"
        @click="editorStore.showGrid = !editorStore.showGrid"
      >
        <Grid3x3 :size="14" />
      </button>
    </div>

    <div class="border-l border-gray-600 mx-1 h-5" />

    <button
      title="Keyboard Shortcuts"
      class="flex items-center gap-1.5 px-2 py-1 rounded text-xs
             bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
      @click="showShortcuts = true"
    >
      <Keyboard :size="14" />
      Shortcuts
    </button>
  </div>

  <!-- Shortcuts dialog -->
  <Teleport to="body">
    <div
      v-if="showShortcuts"
      class="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center"
      @mousedown.self="showShortcuts = false"
    >
      <div
        class="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl
               w-[560px] max-h-[80vh] overflow-y-auto"
      >
        <div class="flex items-center justify-between px-5 py-3.5
                    border-b border-gray-700 sticky top-0 bg-gray-900">
          <span class="text-sm font-semibold text-white flex items-center gap-2">
            <Keyboard :size="16" />
            Keyboard Shortcuts
          </span>
          <button
            class="text-gray-400 hover:text-white transition-colors"
            @click="showShortcuts = false"
          >✕</button>
        </div>
        <div class="p-5 grid grid-cols-2 gap-x-6 gap-y-5">

          <section>
            <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Tools
            </h3>
            <ul class="space-y-1.5">
              <li v-for="row in toolShortcuts" :key="row.key" class="flex justify-between text-sm">
                <span class="text-gray-300">{{ row.label }}</span>
                <kbd class="shortcut-key">{{ row.key }}</kbd>
              </li>
            </ul>
          </section>

          <section>
            <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Draw Modes
            </h3>
            <ul class="space-y-1.5">
              <li v-for="row in modeShortcuts" :key="row.key" class="flex justify-between text-sm">
                <span class="text-gray-300">{{ row.label }}</span>
                <kbd class="shortcut-key">{{ row.key }}</kbd>
              </li>
            </ul>
          </section>

          <section>
            <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Tile Transforms
            </h3>
            <ul class="space-y-1.5">
              <li v-for="row in transformShortcuts" :key="row.key" class="flex justify-between text-sm">
                <span class="text-gray-300">{{ row.label }}</span>
                <kbd class="shortcut-key">{{ row.key }}</kbd>
              </li>
            </ul>
          </section>

          <section>
            <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              View
            </h3>
            <ul class="space-y-1.5">
              <li v-for="row in viewShortcuts" :key="row.key" class="flex justify-between text-sm">
                <span class="text-gray-300">{{ row.label }}</span>
                <kbd class="shortcut-key">{{ row.key }}</kbd>
              </li>
            </ul>
          </section>

          <section>
            <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Selection
            </h3>
            <ul class="space-y-1.5">
              <li v-for="row in selectionShortcuts" :key="row.key" class="flex justify-between text-sm">
                <span class="text-gray-300">{{ row.label }}</span>
                <kbd class="shortcut-key">{{ row.key }}</kbd>
              </li>
            </ul>
          </section>

          <section>
            <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              File &amp; History
            </h3>
            <ul class="space-y-1.5">
              <li v-for="row in fileShortcuts" :key="row.key" class="flex justify-between text-sm">
                <span class="text-gray-300">{{ row.label }}</span>
                <kbd class="shortcut-key">{{ row.key }}</kbd>
              </li>
            </ul>
          </section>

        </div>
      </div>
    </div>
  </Teleport>

  <!-- New-map confirm popover -->
  <Teleport to="body">
    <!-- Backdrop -->
    <div
      v-if="showConfirm"
      class="fixed inset-0 z-[49] bg-black/50"
      @mousedown="closeConfirm"
    />
    <Transition
      :name="placement === 'bottom' ? 'pop-down' : 'pop-up'"
    >
      <div
        v-if="showConfirm"
        :style="popoverStyle"
        class="fixed z-50 w-56 bg-gray-800 border border-gray-700
               rounded-lg shadow-2xl p-4 space-y-3"
      >
        <p class="text-sm text-white font-semibold">Create a new map?</p>
        <p class="text-xs text-gray-400">Unsaved changes will be lost.</p>
        <div class="flex justify-end gap-2">
          <button
            class="px-3 py-1.5 text-xs rounded bg-gray-700
                   text-gray-300 hover:bg-gray-600 transition-colors"
            @click="closeConfirm"
          >
            Cancel
          </button>
          <button
            class="px-3 py-1.5 text-xs rounded bg-red-600
                   text-white hover:bg-red-500 transition-colors"
            @click="confirm"
          >
            Create new
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.shortcut-key {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 4px;
  background: #374151;
  border: 1px solid #4b5563;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: #d1d5db;
  white-space: nowrap;
  flex-shrink: 0;
}

.pop-down-enter-active,
.pop-down-leave-active,
.pop-up-enter-active,
.pop-up-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.pop-down-enter-from,
.pop-down-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.pop-up-enter-from,
.pop-up-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
