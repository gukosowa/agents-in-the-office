<script setup lang="ts">
import { ref, watch } from 'vue';
import { useMapStore } from '../stores/mapStore';
import { useEditorStore } from '../stores/editorStore';
import { useUndoStore } from '../stores/undoStore';
import {
  Save, HardDriveDownload, FolderOpen,
  FilePlus2, Grid3x3, Undo2, Redo2,
} from 'lucide-vue-next';

const editorStore = useEditorStore();
const mapStore = useMapStore();
const undoStore = useUndoStore();
defineEmits(['new-map', 'save', 'export', 'open-file']);

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
</script>

<template>
  <div class="flex gap-1.5 items-center">
    <button
      class="p-1.5 rounded bg-blue-700 text-white
             hover:bg-blue-600"
      title="New Map (Cmd+N)"
      @click="$emit('new-map')"
    >
      <FilePlus2 :size="18" />
    </button>
    <button
      class="p-1.5 rounded bg-green-700 text-white
             hover:bg-green-600"
      title="Save to file (Cmd+S)"
      @click="$emit('save')"
    >
      <Save :size="18" />
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

    <div
      class="flex items-center gap-1.5 text-xs text-gray-300"
    >
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

  </div>
</template>

