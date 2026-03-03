<script setup lang="ts">
import { nextTick, ref } from 'vue';
import {
  Eye,
  EyeOff,
  GripVertical,
  Plus,
  Trash2,
  XCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-vue-next';
import { useEditorStore } from '../stores/editorStore';
import { useMapStore } from '../stores/mapStore';
import { useUndoStore } from '../stores/undoStore';

const editorStore = useEditorStore();
const mapStore = useMapStore();
const undoStore = useUndoStore();

const editingIndex = ref<number | null>(null);
const editName = ref('');
const renameInput = ref<HTMLInputElement | null>(null);
const collapsed = ref(false);
const dragFromIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);

const interactiveLayerIndex = () => mapStore.layers.length;

function handleAddLayer() {
  const activeIdx = Math.min(
    editorStore.activeLayer,
    mapStore.layers.length - 1,
  );
  const newIdx = mapStore.addLayer(activeIdx);
  undoStore.push({
    label: 'Add Layer',
    patch: { kind: 'layerAdd', index: newIdx },
  });
  editorStore.setLayer(newIdx);
}

function handleDeleteLayer(index: number) {
  if (mapStore.layers.length <= 1) return;
  if (!confirm('Delete this layer?')) return;
  const layerData = mapStore.layers[index]!.map(
    row => row.map(c => (c ? { ...c } : null)),
  );
  const meta = { ...mapStore.layerMeta[index]! };
  mapStore.removeLayer(index);
  undoStore.push({
    label: 'Delete Layer',
    patch: { kind: 'layerRemove', index, data: layerData, meta },
  });
  if (editorStore.activeLayer >= mapStore.layers.length) {
    editorStore.setLayer(mapStore.layers.length - 1);
  }
}

function handleClearLayer(index: number) {
  const meta = mapStore.layerMeta[index];
  const name = meta?.name ?? `Layer ${index}`;
  if (!confirm(`Clear all tiles from "${name}"?`)) return;
  const snap = undoStore.captureSnapshot();
  mapStore.clearLayer(index);
  mapStore.shrinkMap();
  undoStore.push({
    label: 'Clear Layer',
    patch: {
      kind: 'snapshot',
      before: snap,
      after: undoStore.captureSnapshot(),
    },
  });
}

async function startRename(index: number) {
  const meta = mapStore.layerMeta[index];
  if (!meta) return;
  editingIndex.value = index;
  editName.value = meta.name;
  await nextTick();
  renameInput.value?.focus();
  renameInput.value?.select();
}

function commitRename() {
  if (editingIndex.value !== null && editName.value.trim()) {
    mapStore.renameLayer(
      editingIndex.value,
      editName.value.trim(),
    );
  }
  editingIndex.value = null;
}

function handleDragStart(index: number) {
  dragFromIndex.value = index;
}

function handleDragOver(
  e: DragEvent,
  index: number,
) {
  e.preventDefault();
  dragOverIndex.value = index;
}

function handleDrop(toIndex: number) {
  if (
    dragFromIndex.value !== null
    && dragFromIndex.value !== toIndex
  ) {
    const fromIdx = dragFromIndex.value;
    const wasActive = editorStore.activeLayer === fromIdx;
    mapStore.moveLayer(fromIdx, toIndex);
    undoStore.push({
      label: 'Move Layer',
      patch: {
        kind: 'layerMove',
        fromIndex: fromIdx,
        toIndex,
      },
    });
    if (wasActive) {
      editorStore.setLayer(toIndex);
    } else if (
      editorStore.activeLayer >= fromIdx
      && editorStore.activeLayer <= toIndex
    ) {
      editorStore.setLayer(editorStore.activeLayer - 1);
    } else if (
      editorStore.activeLayer <= fromIdx
      && editorStore.activeLayer >= toIndex
    ) {
      editorStore.setLayer(editorStore.activeLayer + 1);
    }
  }
  dragFromIndex.value = null;
  dragOverIndex.value = null;
}

function handleDragEnd() {
  dragFromIndex.value = null;
  dragOverIndex.value = null;
}

</script>

<template>
  <div class="shrink-0 border-t border-gray-700/50 bg-transparent flex flex-col max-h-[40%]">
    <div
      class="flex items-center justify-between px-4 pt-1.5 pb-1 cursor-pointer select-none"
      @click="collapsed = !collapsed"
    >
      <div class="flex items-center gap-1 text-gray-400">
        <component :is="collapsed ? ChevronRight : ChevronDown" :size="12" />
        <h3 class="text-xs font-semibold uppercase">Layers</h3>
      </div>
      <button
        v-if="!collapsed"
        class="p-1 rounded hover:bg-gray-600 text-gray-400
               hover:text-white transition-colors"
        title="Add layer"
        @click.stop="handleAddLayer"
      >
        <Plus :size="14" />
      </button>
    </div>
    <div v-if="!collapsed" class="flex flex-col gap-1 overflow-y-auto px-4 pb-3">
      <div
        v-for="(meta, i) in mapStore.layerMeta"
        :key="i"
        draggable="true"
        :class="[
          'flex items-center gap-1 px-2 py-1.5 rounded',
          'text-sm transition-colors cursor-pointer',
          editorStore.activeLayer === i
            ? 'bg-blue-600 text-white'
            : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
          dragOverIndex === i
            ? 'border-t-2 border-blue-400'
            : 'border-t-2 border-transparent',
        ]"
        @click="editorStore.setLayer(i); editorStore.showInteractiveLayer = false"
        @dragstart="handleDragStart(i)"
        @dragover="handleDragOver($event, i)"
        @drop="handleDrop(i)"
        @dragend="handleDragEnd"
      >
        <GripVertical
          :size="14"
          class="shrink-0 text-gray-500 cursor-grab"
        />
        <span
          v-if="editingIndex !== i"
          class="flex-1 truncate select-none"
          @dblclick.stop="startRename(i)"
        >{{ meta.name }}</span>
        <input
          v-else
          ref="renameInput"
          v-model="editName"
          class="flex-1 bg-gray-900 text-white text-sm
                 px-1 py-0 rounded border border-gray-500
                 outline-none"
          @blur="commitRename"
          @keydown.enter="commitRename"
          @keydown.escape="editingIndex = null"
          @click.stop
        />
        <button
          class="p-0.5 rounded hover:bg-gray-500
                 transition-colors shrink-0"
          :title="meta.visible ? 'Hide layer' : 'Show layer'"
          @click.stop="mapStore.toggleLayerVisibility(i)"
        >
          <Eye
            v-if="meta.visible"
            :size="14"
          />
          <EyeOff
            v-else
            :size="14"
            class="text-gray-500"
          />
        </button>
        <button
          class="p-0.5 rounded hover:bg-yellow-600
                 transition-colors shrink-0"
          title="Clear all tiles"
          @click.stop="handleClearLayer(i)"
        >
          <XCircle :size="14" />
        </button>
        <button
          v-if="mapStore.layers.length > 1"
          class="p-0.5 rounded hover:bg-red-600
                 transition-colors shrink-0"
          title="Delete layer"
          @click.stop="handleDeleteLayer(i)"
        >
          <Trash2 :size="14" />
        </button>
      </div>

      <!-- Interactive Objects layer (always at bottom) -->
      <div class="border-t border-gray-600 mt-1 pt-1">
        <button
          :class="[
            'w-full flex items-center gap-1 px-2 py-1.5',
            'rounded text-sm transition-colors text-left',
            editorStore.activeLayer === interactiveLayerIndex()
              ? 'bg-purple-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
          ]"
          @click="
            editorStore.setLayer(interactiveLayerIndex());
            editorStore.showInteractiveLayer = true;
            editorStore.clearMultiSelections();
            editorStore.setTool('pen');
            editorStore.rectMode = false;
            editorStore.lineMode = false;
          "
        >
          <span class="flex-1">Interactive Objects</span>
          <span
            role="button"
            tabindex="0"
            class="p-0.5 rounded transition-colors shrink-0"
            :class="editorStore.showInteractiveLayer
              ? 'hover:bg-purple-500'
              : 'hover:bg-gray-500'"
            :title="editorStore.showInteractiveLayer
              ? 'Hide on canvas'
              : 'Show on canvas'"
            @click.stop="editorStore.showInteractiveLayer = !editorStore.showInteractiveLayer"
            @keydown.enter.stop="editorStore.showInteractiveLayer = !editorStore.showInteractiveLayer"
            @keydown.space.stop.prevent="editorStore.showInteractiveLayer = !editorStore.showInteractiveLayer"
          >
            <Eye
              v-if="editorStore.showInteractiveLayer"
              :size="14"
            />
            <EyeOff
              v-else
              :size="14"
              class="text-gray-400"
            />
          </span>
        </button>
      </div>
    </div>
  </div>
</template>
