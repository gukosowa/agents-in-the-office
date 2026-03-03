<script setup lang="ts">
import { ref, computed } from 'vue';
import SpritesheetCanvas from './SpritesheetCanvas.vue';

const props = defineProps<{
  image: HTMLImageElement;
  cellWidth: number;
  cellHeight: number;
  regionRows: number;
  existingNames?: string[];
  initialName?: string;
  initialCol?: number;
  initialRow?: number;
  initialCols?: number;
}>();

const emit = defineEmits<{
  confirm: [
    names: string[], col: number, row: number, cols: number,
  ];
  cancel: [];
}>();

const PREDEFINED_NAMES = [
  'programming',
  'reading',
  'writing',
  'looking',
  'talking',
  'sitting',
];

const isEditing = computed(() => !!props.initialName);

const allNames = computed(() => {
  const set = new Set(PREDEFINED_NAMES);
  for (const name of props.existingNames ?? []) {
    set.add(name);
  }
  return [...set];
});

// Names already on this character (disabled unless editing that name)
const disabledNames = computed(() => {
  const set = new Set(props.existingNames ?? []);
  if (props.initialName) set.delete(props.initialName);
  return set;
});

const selectedNames = ref<Set<string>>(new Set(
  props.initialName ? [props.initialName] : [],
));
const selectedCol = ref(props.initialCol ?? -1);
const selectedRow = ref(props.initialRow ?? -1);
const selectedCols = ref(props.initialCols ?? 1);

const canConfirm = computed(
  () => selectedNames.value.size > 0
    && selectedCol.value >= 0
    && selectedRow.value >= 0,
);

function toggleActionName(name: string) {
  if (disabledNames.value.has(name)) return;
  if (isEditing.value) {
    selectedNames.value = new Set([name]);
    return;
  }
  const next = new Set(selectedNames.value);
  if (next.has(name)) {
    next.delete(name);
  } else {
    next.add(name);
  }
  selectedNames.value = next;
}

function onRegionSelect(
  col: number, row: number, cols: number,
) {
  selectedCol.value = col;
  selectedRow.value = row;
  selectedCols.value = cols;
}

function handleConfirm() {
  if (!canConfirm.value) return;
  emit(
    'confirm',
    [...selectedNames.value],
    selectedCol.value,
    selectedRow.value,
    selectedCols.value,
  );
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 bg-black/50 flex items-center
             justify-center z-[60]"
      @click.self="emit('cancel')"
    >
      <div
        class="bg-gray-800 p-6 rounded shadow-lg
               max-w-[90vw] max-h-[90vh] flex flex-col"
      >
        <h2 class="text-lg font-bold text-white mb-3">
          {{ isEditing ? 'Edit Action' : 'Add Actions' }}
        </h2>

        <!-- Action names -->
        <div class="mb-3">
          <label
            class="block text-sm font-medium text-gray-300 mb-1"
          >
            {{ isEditing ? 'Action' : 'Actions' }}
          </label>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="name in allNames"
              :key="name"
              :disabled="disabledNames.has(name)"
              :class="[
                'px-2.5 py-1 text-xs rounded transition-colors',
                disabledNames.has(name)
                  ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                  : selectedNames.has(name)
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
              ]"
              @click="toggleActionName(name)"
            >
              {{ name }}
            </button>
          </div>
        </div>

        <p class="text-sm text-gray-400 mb-3">
          Click and drag columns to select the action region
          ({{ regionRows }} rows).
        </p>

        <!-- Spritesheet canvas -->
        <div
          class="flex-1 overflow-auto border border-gray-600
                 bg-gray-900 min-h-0"
        >
          <SpritesheetCanvas
            :image="image"
            :cell-width="cellWidth"
            :cell-height="cellHeight"
            :region-cols="1"
            :region-rows="regionRows"
            :variable-cols="true"
            :selected-col="selectedCol"
            :selected-row="selectedRow"
            :selected-cols="selectedCols"
            @select="onRegionSelect"
          />
        </div>

        <!-- Footer -->
        <div class="flex justify-end gap-2 mt-4">
          <button
            class="px-4 py-2 bg-gray-700 hover:bg-gray-600
                   rounded text-white transition-colors text-sm"
            @click="emit('cancel')"
          >
            Cancel
          </button>
          <button
            :disabled="!canConfirm"
            :class="[
              'px-4 py-2 rounded text-white transition-colors',
              'text-sm',
              canConfirm
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-gray-600 cursor-not-allowed opacity-50',
            ]"
            @click="handleConfirm"
          >
            {{ isEditing ? 'Save' : 'Add' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
