<script setup lang="ts">
import { ref } from 'vue';
import { OBJECT_TYPES, type Direction } from '../types';

const DIRECTIONS: { value: Direction; label: string; arrow: string }[] = [
  { value: 'up', label: 'Up', arrow: '\u2191' },
  { value: 'down', label: 'Down', arrow: '\u2193' },
  { value: 'left', label: 'Left', arrow: '\u2190' },
  { value: 'right', label: 'Right', arrow: '\u2192' },
];

const props = defineProps<{
  initialType?: string;
  initialDirection?: Direction;
  showRemove?: boolean;
}>();

const emit = defineEmits<{
  save: [data: { type: string; direction: Direction }];
  remove: [];
  cancel: [];
}>();

const type = ref(props.initialType ?? 'computer');
const direction = ref<Direction>(props.initialDirection ?? 'down');

const save = () => {
  emit('save', {
    type: type.value,
    direction: direction.value,
  });
};
</script>

<template>
  <div
    class="fixed inset-0 bg-black/50 flex items-center
           justify-center z-50"
  >
    <div
      class="bg-gray-800 p-6 rounded shadow-lg w-80"
    >
      <h2 class="text-xl font-bold mb-4">Add/Edit Object</h2>

      <fieldset class="mb-4">
        <legend
          class="block text-sm font-medium mb-2 text-gray-300"
        >
          Type
        </legend>
        <div class="grid grid-cols-2 gap-2">
          <label
            v-for="opt in OBJECT_TYPES"
            :key="opt.value"
            :class="[
              'flex items-center gap-2 px-3 py-2 rounded',
              'cursor-pointer transition-colors text-sm',
              type === opt.value
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
            ]"
          >
            <input
              v-model="type"
              type="radio"
              name="object-type"
              :value="opt.value"
              class="sr-only"
            />
            <span>{{ opt.emoji }}</span>
            <span>{{ opt.label }}</span>
          </label>
        </div>
      </fieldset>

      <fieldset class="mb-4">
        <legend
          class="block text-sm font-medium mb-2 text-gray-300"
        >
          Direction
        </legend>
        <div class="flex gap-2">
          <label
            v-for="dir in DIRECTIONS"
            :key="dir.value"
            :class="[
              'flex-1 flex items-center justify-center gap-1',
              'px-2 py-2 rounded cursor-pointer',
              'transition-colors text-sm',
              direction === dir.value
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
            ]"
          >
            <input
              v-model="direction"
              type="radio"
              name="object-direction"
              :value="dir.value"
              class="sr-only"
            />
            <span>{{ dir.arrow }}</span>
            <span>{{ dir.label }}</span>
          </label>
        </div>
      </fieldset>

      <div class="flex justify-end gap-2 mt-4">
        <button
          v-if="props.showRemove"
          class="px-4 py-2 bg-red-700 hover:bg-red-600
                 rounded text-white transition-colors mr-auto"
          @click="$emit('remove')"
        >
          Remove
        </button>
        <button
          class="px-4 py-2 bg-gray-700 hover:bg-gray-600
                 rounded text-white transition-colors"
          @click="$emit('cancel')"
        >
          Cancel
        </button>
        <button
          class="px-4 py-2 bg-blue-600 hover:bg-blue-700
                 rounded text-white transition-colors"
          @click="save"
        >
          Save
        </button>
      </div>
    </div>
  </div>
</template>
