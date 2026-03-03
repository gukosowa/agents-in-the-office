<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { Upload, X } from 'lucide-vue-next';
import {
  getAllAutoTileLibrary,
  removeFromAutoTileLibrary,
  type AutoTileLibraryEntry,
} from '../utils/db';

const emit = defineEmits<{
  select: [blob: Blob];
  upload: [];
  cancel: [];
}>();

interface LibraryItem extends AutoTileLibraryEntry {
  objectUrl: string;
}

const items = ref<LibraryItem[]>([]);

onMounted(async () => {
  const entries = await getAllAutoTileLibrary();
  items.value = entries.map(entry => ({
    ...entry,
    objectUrl: URL.createObjectURL(entry.blob),
  }));
});

onUnmounted(() => {
  for (const item of items.value) {
    URL.revokeObjectURL(item.objectUrl);
  }
});

function selectItem(item: LibraryItem) {
  emit('select', item.blob);
}

async function removeItem(item: LibraryItem, event: Event) {
  event.stopPropagation();
  if (item.id !== undefined) {
    await removeFromAutoTileLibrary(item.id);
  }
  URL.revokeObjectURL(item.objectUrl);
  items.value = items.value.filter(i => i !== item);
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center
             bg-black/60"
      @mousedown.self="emit('cancel')"
    >
      <div
        class="bg-gray-800 rounded-lg shadow-xl max-w-md w-full
               mx-4 max-h-[80vh] flex flex-col"
      >
        <div
          class="flex items-center justify-between p-4
                 border-b border-gray-700"
        >
          <h3 class="text-sm font-semibold text-white">
            Add Autotile
          </h3>
          <button
            class="text-gray-400 hover:text-white"
            @click="emit('cancel')"
          >
            <X :size="16" />
          </button>
        </div>

        <div class="p-4 overflow-y-auto flex-1">
          <button
            class="w-full mb-3 flex items-center justify-center
                   gap-2 px-3 py-2 text-sm rounded bg-purple-700
                   text-white hover:bg-purple-600 transition-colors"
            @click="emit('upload')"
          >
            <Upload :size="14" />
            Upload new image
          </button>

          <div v-if="items.length > 0" class="space-y-2">
            <label
              class="block text-xs font-medium text-gray-400"
            >
              Previously uploaded
            </label>
            <div class="grid grid-cols-4 gap-2">
              <div
                v-for="item in items"
                :key="item.id"
                role="button"
                tabindex="0"
                class="relative group rounded border-2
                       border-transparent hover:border-blue-500
                       overflow-hidden bg-gray-900 aspect-square
                       flex items-center justify-center cursor-pointer"
                @click="selectItem(item)"
                @keydown.enter.space.prevent="selectItem(item)"
              >
                <img
                  :src="item.objectUrl"
                  class="max-w-full max-h-full object-contain"
                  style="image-rendering: pixelated"
                />
                <button
                  class="absolute top-0.5 right-0.5 w-4 h-4
                         rounded-full bg-red-600 text-white
                         hidden group-hover:flex items-center
                         justify-center"
                  title="Remove from library"
                  @click="removeItem(item, $event)"
                >
                  <X :size="10" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
