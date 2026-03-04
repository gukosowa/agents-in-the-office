<script setup lang="ts">
import { computed } from 'vue';
import { useEditorStore } from '../stores/editorStore';
import type { ToolType } from '../types';
import {
  Pen, Eraser, PaintBucket, Ban, Compass,
  RectangleHorizontal, Slash,
  Move, UserRound, Pipette,
  FlipHorizontal2, FlipVertical2, RotateCw,
} from 'lucide-vue-next';

const props = defineProps<{ sidebarWidth?: number }>();
const editorStore = useEditorStore();

const drawTools: {
  id: ToolType; icon: typeof Pen;
  label: string; shortcut: string;
}[] = [
  { id: 'pen', icon: Pen, label: 'Pen', shortcut: 'Q' },
  { id: 'eraser', icon: Eraser, label: 'Eraser', shortcut: 'W' },
  { id: 'fill', icon: PaintBucket, label: 'Fill', shortcut: 'E' },
];

const otherTools: {
  id: ToolType; icon: typeof Pen;
  label: string; shortcut: string;
}[] = [
  { id: 'move', icon: Move, label: 'Move', shortcut: 'M' },
  { id: 'spawn', icon: UserRound, label: 'Spawn NPC', shortcut: '' },
];

const rectApplicable = computed(
  () => editorStore.selectedTool === 'pen'
    || editorStore.selectedTool === 'eraser',
);

const lineApplicable = computed(
  () => editorStore.selectedTool === 'pen'
    || editorStore.selectedTool === 'eraser',
);
</script>

<template>
  <div
    class="absolute top-10 bottom-0 w-11 z-10 border-r border-gray-700/50 bg-gray-800/60 backdrop-blur-md
           flex flex-col items-center py-2 gap-1 overflow-x-hidden overflow-y-auto"
    :style="{ left: (props.sidebarWidth ?? 320) + 'px' }"
  >
    <!-- Draw tools -->
    <button
      v-for="tool in drawTools"
      :key="tool.id"
      :title="`${tool.label} (${tool.shortcut})`"
      :class="
        editorStore.selectedTool === tool.id
          ? 'bg-blue-600 text-white'
          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
      "
      class="relative p-1.5 rounded transition-colors"
      @click="editorStore.setTool(tool.id)"
    >
      <component :is="tool.icon" :size="18" />
      <span class="shortcut-badge">{{ tool.shortcut }}</span>
    </button>

    <!-- Pick / eyedropper -->
    <button
      title="Pick tile (C)"
      :class="
        editorStore.selectedTool === 'pick'
          ? 'bg-blue-600 text-white'
          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
      "
      class="relative p-1.5 rounded transition-colors"
      @click="editorStore.setTool('pick')"
    >
      <Pipette :size="18" />
      <span class="shortcut-badge">C</span>
    </button>

    <!-- Collision toggle -->
    <button
      :title="
        editorStore.showCollision
          ? 'Hide Collision (T)'
          : 'Show Collision (T)'
      "
      :class="
        editorStore.showCollision
          ? 'bg-blue-600 text-white'
          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
      "
      class="relative p-1.5 rounded transition-colors"
      @click="
        editorStore.showCollision = !editorStore.showCollision;
        if (editorStore.showCollision) {
          editorStore.showDirCollision = false;
          editorStore.clearMultiSelections();
        }
      "
    >
      <Ban :size="18" />
      <span class="shortcut-badge">T</span>
    </button>

    <!-- Directional collision toggle -->
    <button
      :title="
        editorStore.showDirCollision
          ? 'Hide Dir Collision (Y)'
          : 'Show Dir Collision (Y)'
      "
      :class="
        editorStore.showDirCollision
          ? 'bg-blue-600 text-white'
          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
      "
      class="relative p-1.5 rounded transition-colors"
      @click="
        editorStore.showDirCollision = !editorStore.showDirCollision;
        if (editorStore.showDirCollision) {
          editorStore.showCollision = false;
          editorStore.clearMultiSelections();
        }
      "
    >
      <Compass :size="18" />
      <span class="shortcut-badge">Y</span>
    </button>

    <div class="border-t border-gray-600 w-5 my-0.5" />

    <!-- Rectangle mode toggle -->
    <button
      title="Rectangle mode (A)"
      :class="[
        editorStore.rectMode && rectApplicable
          ? 'bg-purple-600 text-white'
          : rectApplicable
            ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            : 'bg-gray-800 text-gray-500 cursor-not-allowed',
      ]"
      class="relative p-1.5 rounded transition-colors"
      :disabled="!rectApplicable"
      @click="
        editorStore.rectMode = !editorStore.rectMode;
        editorStore.lineMode = false;
      "
    >
      <RectangleHorizontal :size="18" />
      <span class="shortcut-badge">A</span>
    </button>

    <!-- Line mode toggle -->
    <button
      title="Line mode (S)"
      :class="[
        editorStore.lineMode && lineApplicable
          ? 'bg-purple-600 text-white'
          : lineApplicable
            ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            : 'bg-gray-800 text-gray-500 cursor-not-allowed',
      ]"
      class="relative p-1.5 rounded transition-colors"
      :disabled="!lineApplicable"
      @click="
        editorStore.lineMode = !editorStore.lineMode;
        editorStore.rectMode = false;
      "
    >
      <Slash :size="18" />
      <span class="shortcut-badge">S</span>
    </button>

    <div class="border-t border-gray-600 w-5 my-0.5" />

    <!-- Tile transforms: flip X, flip Y, rotate 90 -->
    <button
      title="Flip Horizontal (F)"
      :class="
        editorStore.tileFlipX
          ? 'bg-orange-600 text-white'
          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
      "
      class="relative p-1.5 rounded transition-colors"
      @click="editorStore.toggleFlipX()"
    >
      <FlipHorizontal2 :size="18" />
      <span class="shortcut-badge">F</span>
    </button>
    <button
      title="Flip Vertical (V)"
      :class="
        editorStore.tileFlipY
          ? 'bg-orange-600 text-white'
          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
      "
      class="relative p-1.5 rounded transition-colors"
      @click="editorStore.toggleFlipY()"
    >
      <FlipVertical2 :size="18" />
      <span class="shortcut-badge">V</span>
    </button>
    <button
      title="Rotate 90° CW (R)"
      :class="
        editorStore.tileRotation !== 0
          ? 'bg-orange-600 text-white'
          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
      "
      class="relative p-1.5 rounded transition-colors"
      @click="editorStore.rotateTile()"
    >
      <RotateCw :size="18" />
      <span class="shortcut-badge">R</span>
    </button>

    <div class="border-t border-gray-600 w-5 my-0.5" />

    <!-- Other tools: select / move / spawn -->
    <button
      v-for="tool in otherTools"
      :key="tool.id"
      :title="
        tool.shortcut
          ? `${tool.label} (${tool.shortcut})`
          : tool.label
      "
      :class="
        editorStore.selectedTool === tool.id
          ? 'bg-blue-600 text-white'
          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
      "
      class="relative p-1.5 rounded transition-colors"
      @click="editorStore.setTool(tool.id)"
    >
      <component :is="tool.icon" :size="18" />
      <span
        v-if="tool.shortcut"
        class="shortcut-badge"
      >{{ tool.shortcut }}</span>
    </button>

  </div>
</template>

<style scoped>
.shortcut-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  font-size: 9px;
  line-height: 1;
  padding: 1px 3px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.7);
  color: #a1a1aa;
  pointer-events: none;
}
</style>
