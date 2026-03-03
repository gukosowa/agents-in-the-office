<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import { Trash2, Plus } from 'lucide-vue-next';
import { useCharacterStore } from '../stores/characterStore';
import CharacterSettings from './CharacterSettings.vue';
import type { CharacterDefinition } from '../types/character';

const emit = defineEmits<{ close: [] }>();

const characterStore = useCharacterStore();
const selectedId = ref<string | null>(null);
const confirmDeleteId = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const selectedCharacter = computed(() => {
  if (!selectedId.value) return undefined;
  return characterStore.getCharacter(selectedId.value);
});

const thumbnails = ref<Record<string, string>>({});

function createThumbnail(
  char: CharacterDefinition,
): string | null {
  const url = URL.createObjectURL(char.spriteBlob);
  return url;
}

function refreshThumbnails() {
  for (const url of Object.values(thumbnails.value)) {
    URL.revokeObjectURL(url);
  }
  const next: Record<string, string> = {};
  for (const char of characterStore.characters) {
    const url = createThumbnail(char);
    if (url) next[char.id] = url;
  }
  thumbnails.value = next;
}

watch(
  () => characterStore.characters.length,
  refreshThumbnails,
  { immediate: true },
);

onUnmounted(() => {
  for (const url of Object.values(thumbnails.value)) {
    URL.revokeObjectURL(url);
  }
});

function selectCharacter(id: string) {
  selectedId.value = id;
  confirmDeleteId.value = null;
}

function handleAddClick() {
  fileInput.value?.click();
}

async function handleFileSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';

  const def: CharacterDefinition = {
    id: crypto.randomUUID(),
    name: file.name.replace(/\.[^.]+$/, ''),
    spriteBlob: file,
    cellWidth: 16,
    cellHeight: 32,
    layoutType: 'auto-3x3',
    baseRegion: { col: 0, row: 0, cols: 0, rows: 0 },
    actions: [],
    scale: 1,
  };
  characterStore.addCharacter(def);
  selectedId.value = def.id;
}

function requestDelete(id: string) {
  confirmDeleteId.value = id;
}

function cancelDelete() {
  confirmDeleteId.value = null;
}

function confirmDelete(id: string) {
  characterStore.removeCharacter(id);
  confirmDeleteId.value = null;
  if (selectedId.value === id) {
    selectedId.value = null;
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 bg-black/50 flex items-center
             justify-center z-50"
      @click.self="emit('close')"
    >
      <div
        class="bg-gray-800 rounded shadow-lg
               w-[800px] max-w-[90vw] h-[600px] max-h-[90vh]
               flex flex-col"
      >
        <!-- Body: two panels -->
        <div class="flex flex-1 min-h-0">
          <!-- Left panel: character list -->
          <div
            class="w-60 shrink-0 flex flex-col
                   border-r border-gray-700"
          >
            <div
              class="flex items-center justify-between
                     px-4 py-3 border-b border-gray-700"
            >
              <h2 class="text-sm font-bold text-white">
                Characters
              </h2>
              <button
                class="p-1 rounded text-gray-400
                       hover:text-white hover:bg-gray-700
                       transition-colors"
                title="Add character"
                @click="handleAddClick"
              >
                <Plus :size="16" />
              </button>
            </div>

            <div class="flex-1 overflow-y-auto">
              <button
                v-for="char in characterStore.characters"
                :key="char.id"
                class="w-full flex items-center gap-2 px-3 py-2
                       text-left text-sm transition-colors"
                :class="[
                  selectedId === char.id
                    ? 'bg-gray-700 text-white'
                    : 'text-gray-300 hover:bg-gray-700/50',
                ]"
                @click="selectCharacter(char.id)"
              >
                <!-- Thumbnail -->
                <div
                  class="w-8 h-8 shrink-0 bg-gray-900
                         rounded overflow-hidden flex
                         items-center justify-center"
                >
                  <img
                    v-if="thumbnails[char.id]"
                    :src="thumbnails[char.id]"
                    class="max-w-full max-h-full object-contain"
                    style="image-rendering: pixelated"
                  />
                </div>
                <span
                  v-if="char.isSubagent"
                  class="shrink-0 text-sm"
                >🐔</span>
                <span class="flex-1 truncate">
                  {{ char.name }}
                </span>

                <!-- Delete button -->
                <div
                  v-if="confirmDeleteId === char.id"
                  class="flex items-center gap-1 shrink-0"
                  @click.stop
                >
                  <button
                    class="px-1.5 py-0.5 text-xs bg-red-600
                           hover:bg-red-700 rounded text-white
                           transition-colors"
                    @click="confirmDelete(char.id)"
                  >
                    Delete
                  </button>
                  <button
                    class="px-1.5 py-0.5 text-xs bg-gray-600
                           hover:bg-gray-500 rounded text-white
                           transition-colors"
                    @click="cancelDelete"
                  >
                    Cancel
                  </button>
                </div>
                <button
                  v-else
                  class="p-1 rounded text-gray-500
                         hover:text-red-400 hover:bg-gray-600
                         transition-colors shrink-0 opacity-0
                         group-hover:opacity-100"
                  :class="{
                    'opacity-100': selectedId === char.id,
                  }"
                  title="Delete character"
                  @click.stop="requestDelete(char.id)"
                >
                  <Trash2 :size="14" />
                </button>
              </button>
            </div>
          </div>

          <!-- Right panel: settings or placeholder -->
          <div class="flex-1 flex flex-col min-w-0">
            <div
              v-if="!selectedCharacter"
              class="flex-1 flex items-center justify-center
                     text-gray-500 text-sm"
            >
              Select or add a character
            </div>
            <div
              v-else
              class="flex-1 overflow-y-auto p-4"
            >
              <CharacterSettings
                :character-id="selectedCharacter.id"
                @duplicated="selectedId = $event"
              />
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div
          class="flex justify-end px-5 py-3
                 border-t border-gray-700"
        >
          <button
            class="px-4 py-1.5 bg-gray-700 hover:bg-gray-600
                   rounded text-white text-sm transition-colors"
            @click="emit('close')"
          >
            Close
          </button>
        </div>
      </div>
    </div>

    <!-- Hidden file input for adding characters -->
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      class="hidden"
      @change="handleFileSelected"
    />
  </Teleport>
</template>
