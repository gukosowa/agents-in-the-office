<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  nextTick,
  onMounted,
} from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import {
  mkdir,
  remove,
  copyFile,
  readFile,
  writeFile,
} from '@tauri-apps/plugin-fs';
import JSZip from 'jszip';
import { useSoundStore, AGENT_EVENT_TYPES } from '../stores/soundStore';
import AudioPlayer from './AudioPlayer.vue';
import PackContextMenu from './PackContextMenu.vue';

const emit = defineEmits<{ close: [] }>();

const soundStore = useSoundStore();

// ---- Global settings ----
const globalEnabled = computed({
  get: () => soundStore.config.enabled,
  set: (v: boolean) => { soundStore.config.enabled = v; void soundStore.saveConfig(); },
});
const globalVolume = computed({
  get: () => Math.round(soundStore.config.globalVolume * 100),
  set: (v: number) => { soundStore.config.globalVolume = v / 100; void soundStore.saveConfig(); },
});
const cooldown = computed({
  get: () => soundStore.config.cooldownSeconds,
  set: (v: number) => { soundStore.config.cooldownSeconds = v; void soundStore.saveConfig(); },
});

// ---- Pack list ----
const selectedPack = ref<string | null>(null);
const expandedCategories = ref(new Set<string>());
const rightPanel = ref<HTMLElement | null>(null);

onMounted(async () => {
  await soundStore.init();
  await soundStore.scanPacks();
  if (soundStore.packs.length > 0 && soundStore.packs[0]) {
    selectedPack.value = soundStore.packs[0].name;
  }
});

function isPackActive(packName: string): boolean {
  return soundStore.config.activePacks.includes(packName);
}

function togglePackActive(packName: string, active: boolean) {
  if (active) {
    if (!soundStore.config.activePacks.includes(packName)) {
      soundStore.config.activePacks.push(packName);
    }
  } else {
    soundStore.config.activePacks = soundStore.config.activePacks.filter(
      (p) => p !== packName,
    );
  }
  void soundStore.saveConfig();
}

function selectPack(name: string) {
  selectedPack.value = name;
  expandedCategories.value = new Set();
  void nextTick(() => {
    if (rightPanel.value) rightPanel.value.scrollTop = 0;
  });
}

// ---- Context menu ----
const ctxMenu = ref<{ packName: string; x: number; y: number } | null>(null);

function onPackRightClick(e: MouseEvent, packName: string) {
  e.preventDefault();
  ctxMenu.value = { packName, x: e.clientX, y: e.clientY };
}

function closeCtxMenu() {
  ctxMenu.value = null;
}

async function onPackRenamed(oldName: string, newName: string) {
  await soundStore.scanPacks();
  if (selectedPack.value === oldName) selectedPack.value = newName;
  closeCtxMenu();
}

async function onPackDuplicated() {
  await soundStore.scanPacks();
  closeCtxMenu();
}

async function onPackDeleted(name: string) {
  await soundStore.scanPacks();
  if (selectedPack.value === name) {
    selectedPack.value = soundStore.packs[0]?.name ?? null;
  }
  closeCtxMenu();
}

// ---- New pack ----
const newPackName = ref('');
const creatingPack = ref(false);
const newPackInput = ref<HTMLInputElement | null>(null);

function startCreatePack() {
  creatingPack.value = true;
  newPackName.value = '';
  void nextTick(() => newPackInput.value?.focus());
}

function cancelCreatePack() {
  creatingPack.value = false;
  newPackName.value = '';
}

async function confirmCreatePack() {
  const packName = newPackName.value.trim();
  if (!packName) return;
  creatingPack.value = false;
  newPackName.value = '';
  const baseDir = soundStore.getSoundPacksDir();
  const packPath = `${baseDir}/${packName}`;
  try {
    await mkdir(packPath, { recursive: true });
    for (const eventType of AGENT_EVENT_TYPES) {
      await mkdir(`${packPath}/${eventType}`, { recursive: true });
    }
    await soundStore.scanPacks();
    selectedPack.value = packName;
  } catch (err) {
    console.error('[SoundsDialog] createNewPack failed', err);
  }
}

// ---- Import zip ----
const dragOver = ref(false);

async function importZipBytes(filename: string, bytes: Uint8Array): Promise<void> {
  const dotIdx = filename.lastIndexOf('.');
  const packName = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
  const baseDir = soundStore.getSoundPacksDir();
  const packPath = `${baseDir}/${packName}`;

  const zip = await JSZip.loadAsync(bytes);
  for (const [relativePath, file] of Object.entries(zip.files)) {
    if (file.dir) {
      await mkdir(`${packPath}/${relativePath}`, { recursive: true });
    } else {
      const data = await file.async('uint8array');
      const dirPart = relativePath.includes('/')
        ? relativePath.slice(0, relativePath.lastIndexOf('/'))
        : '';
      if (dirPart) {
        await mkdir(`${packPath}/${dirPart}`, { recursive: true });
      }
      await writeFile(`${packPath}/${relativePath}`, data);
    }
  }

  await soundStore.scanPacks();
  selectedPack.value = packName;
}

async function openImportPicker() {
  const result = await open({
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
    multiple: false,
  });
  if (!result) return;
  const filePath = typeof result === 'string' ? result : result;
  if (!filePath) return;
  try {
    const bytes = await readFile(filePath);
    const filename = (filePath as string).split('/').pop() ?? 'pack.zip';
    await importZipBytes(filename, bytes);
  } catch (err) {
    console.error('[SoundsDialog] import failed', err);
  }
}

function onDragOver(e: DragEvent) {
  e.preventDefault();
  dragOver.value = true;
}

function onDragLeave() {
  dragOver.value = false;
}

async function onDrop(e: DragEvent) {
  e.preventDefault();
  dragOver.value = false;
  const file = e.dataTransfer?.files[0];
  if (!file) return;
  try {
    const arrayBuffer = await file.arrayBuffer();
    await importZipBytes(file.name, new Uint8Array(arrayBuffer));
  } catch (err) {
    console.error('[SoundsDialog] drop import failed', err);
  }
}

// ---- Right panel: categories ----
const selectedPackInfo = computed(() =>
  soundStore.packs.find((p) => p.name === selectedPack.value) ?? null,
);

const sortedCategories = computed(() => {
  const info = selectedPackInfo.value;
  if (!info) return [];
  const withFiles = AGENT_EVENT_TYPES.filter(
    (cat) => (info.categories[cat]?.length ?? 0) > 0,
  );
  const empty = AGENT_EVENT_TYPES.filter(
    (cat) => (info.categories[cat]?.length ?? 0) === 0,
  );
  return [...withFiles, ...empty];
});

function categoryAllEnabled(cat: string): boolean {
  const files = selectedPackInfo.value?.categories[cat] ?? [];
  if (files.length === 0) return false;
  return files.every((filename) => {
    const key = `${cat}/${filename}`;
    return soundStore.getTrackConfig(selectedPack.value!, key).enabled;
  });
}

function toggleCategoryEnabled(cat: string, val: boolean) {
  const files = selectedPackInfo.value?.categories[cat] ?? [];
  if (!selectedPack.value) return;
  for (const filename of files) {
    const key = `${cat}/${filename}`;
    const cfg = soundStore.getTrackConfig(selectedPack.value, key);
    soundStore.setTrackConfig(selectedPack.value, key, { ...cfg, enabled: val });
  }
  void soundStore.saveConfig();
}

function toggleCategory(cat: string) {
  if (expandedCategories.value.has(cat)) {
    expandedCategories.value.delete(cat);
  } else {
    expandedCategories.value.add(cat);
  }
}

async function addFilesToCategory(cat: string) {
  if (!selectedPack.value) return;
  const result = await open({
    filters: [
      { name: 'Audio', extensions: ['mp3', 'ogg', 'wav', 'flac', 'm4a', 'webm'] },
    ],
    multiple: true,
  });
  if (!result) return;
  const files = Array.isArray(result) ? result : [result];
  const baseDir = soundStore.getSoundPacksDir();
  const catPath = `${baseDir}/${selectedPack.value}/${cat}`;
  await mkdir(catPath, { recursive: true });

  for (const src of files) {
    const filename = (src as string).split('/').pop();
    if (!filename) continue;
    await copyFile(src as string, `${catPath}/${filename}`);
  }

  await soundStore.scanPacks();
}

async function deleteTrack(cat: string, filename: string) {
  if (!selectedPack.value) return;
  const baseDir = soundStore.getSoundPacksDir();
  const filePath = `${baseDir}/${selectedPack.value}/${cat}/${filename}`;
  try {
    await remove(filePath);
    // Remove from tracks config
    const key = `${cat}/${filename}`;
    const packTracks = soundStore.config.tracks[selectedPack.value];
    if (packTracks) {
      delete packTracks[key];
    }
    await soundStore.saveConfig();
    await soundStore.scanPacks();
  } catch (err) {
    console.error('[SoundsDialog] deleteTrack failed', err);
  }
}

function getFilePath(cat: string, filename: string): string {
  return `${soundStore.getSoundPacksDir()}/${selectedPack.value}/${cat}/${filename}`;
}

// Re-scan on selectedPack change (to keep categories fresh)
watch(selectedPack, async () => {
  expandedCategories.value = new Set();
  await nextTick(() => {
    if (rightPanel.value) rightPanel.value.scrollTop = 0;
  });
});
</script>

<template>
  <Teleport to="body">
    <!-- Backdrop -->
    <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <!-- Drop zone wrapper -->
      <div
        class="relative w-[960px] max-w-[90vw] h-[700px] max-h-[90vh] flex flex-col bg-gray-900 border border-gray-700 rounded-lg shadow-2xl overflow-hidden"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
      >
        <!-- Drag overlay -->
        <div
          v-if="dragOver"
          class="absolute inset-0 z-[150] flex items-center justify-center bg-indigo-900/80 border-2 border-dashed border-indigo-400 rounded-lg pointer-events-none"
        >
          <span class="text-indigo-200 text-lg font-semibold">Drop sound pack here</span>
        </div>

        <!-- Header -->
        <div class="flex items-center gap-4 px-4 py-3 border-b border-gray-700 shrink-0">
          <span class="text-gray-200 font-semibold text-sm">Sounds</span>

          <!-- Master enable -->
          <label class="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              :checked="globalEnabled"
              class="w-4 h-4 accent-indigo-400"
              @change="globalEnabled = ($event.target as HTMLInputElement).checked"
            />
            Enable
          </label>

          <!-- Global volume -->
          <label class="flex items-center gap-1.5 text-xs text-gray-300">
            Vol
            <input
              type="range"
              min="0"
              max="100"
              :value="globalVolume"
              class="w-24 accent-indigo-400"
              @input="globalVolume = parseInt(($event.target as HTMLInputElement).value)"
            />
            <span class="w-7 tabular-nums">{{ globalVolume }}%</span>
          </label>

          <!-- Cooldown -->
          <label class="flex items-center gap-1.5 text-xs text-gray-300">
            Cooldown
            <input
              type="range"
              min="0"
              max="10"
              step="0.5"
              :value="cooldown"
              class="w-20 accent-indigo-400"
              @input="cooldown = parseFloat(($event.target as HTMLInputElement).value)"
            />
            <span class="w-8 tabular-nums">{{ cooldown }}s</span>
          </label>
        </div>

        <!-- Body -->
        <div class="flex flex-1 min-h-0">
          <!-- Left panel: pack list -->
          <div class="w-60 shrink-0 border-r border-gray-700 flex flex-col">
            <div class="px-3 pt-2 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Packs
            </div>
            <div class="flex-1 overflow-y-auto">
              <div
                v-for="pack in soundStore.packs"
                :key="pack.name"
                class="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded mx-1"
                :class="selectedPack === pack.name ? 'bg-gray-700' : 'hover:bg-gray-800'"
                @click="selectPack(pack.name)"
                @contextmenu="onPackRightClick($event, pack.name)"
              >
                <input
                  type="checkbox"
                  :checked="isPackActive(pack.name)"
                  class="w-4 h-4 accent-indigo-400 cursor-pointer"
                  @click.stop
                  @change="togglePackActive(pack.name, ($event.target as HTMLInputElement).checked)"
                />
                <span class="text-sm text-gray-200 truncate flex-1">{{ pack.name }}</span>
              </div>
            </div>
            <!-- Buttons / new pack input -->
            <div class="flex flex-col gap-1 p-2 border-t border-gray-700">
              <div v-if="creatingPack" class="flex gap-1">
                <input
                  ref="newPackInput"
                  v-model="newPackName"
                  class="flex-1 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-xs text-gray-200 outline-none focus:border-indigo-400"
                  placeholder="Pack name…"
                  @keydown.enter="confirmCreatePack"
                  @keydown.escape="cancelCreatePack"
                />
                <button
                  class="px-2 py-1 bg-indigo-600/80 rounded hover:bg-indigo-500 text-xs text-white"
                  @click="confirmCreatePack"
                >OK</button>
              </div>
              <div class="flex gap-1">
                <button
                  class="flex-1 px-2 py-1 bg-gray-700/60 rounded hover:bg-gray-600/70 text-xs text-gray-200"
                  @click="startCreatePack"
                >
                  New Pack
                </button>
                <button
                  class="flex-1 px-2 py-1 bg-gray-700/60 rounded hover:bg-gray-600/70 text-xs text-gray-200"
                  @click="openImportPicker"
                >
                  Import
                </button>
              </div>
            </div>
          </div>

          <!-- Right panel: categories -->
          <div ref="rightPanel" class="flex-1 overflow-y-auto min-w-0">
            <template v-if="selectedPackInfo">
              <div
                v-for="cat in sortedCategories"
                :key="cat"
                class="border-b border-gray-800"
              >
                <!-- Category header -->
                <div
                  class="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-800/50 select-none"
                  @click="toggleCategory(cat)"
                >
                  <span class="text-gray-400 text-xs w-3">
                    {{ expandedCategories.has(cat) ? '▾' : '▸' }}
                  </span>
                  <input
                    type="checkbox"
                    class="w-4 h-4 accent-indigo-400 cursor-pointer"
                    :checked="categoryAllEnabled(cat)"
                    :disabled="(selectedPackInfo.categories[cat]?.length ?? 0) === 0"
                    @click.stop
                    @change="toggleCategoryEnabled(cat, ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="text-sm text-gray-300 font-mono flex-1">{{ cat }}</span>
                  <span
                    v-if="(selectedPackInfo.categories[cat]?.length ?? 0) > 0"
                    class="text-xs bg-gray-700 text-gray-300 rounded px-1.5 py-0.5"
                  >
                    {{ selectedPackInfo.categories[cat]?.length ?? 0 }}
                  </span>
                  <!-- Add files button -->
                  <button
                    class="w-5 h-5 flex items-center justify-center rounded hover:bg-gray-600 text-gray-400 hover:text-gray-200 text-sm"
                    title="Add audio files"
                    @click.stop="addFilesToCategory(cat)"
                  >
                    +
                  </button>
                </div>

                <!-- Expanded: file list -->
                <div v-if="expandedCategories.has(cat)" class="pb-1">
                  <AudioPlayer
                    v-for="filename in (selectedPackInfo.categories[cat] ?? [])"
                    :key="filename"
                    :pack-name="selectedPack!"
                    :category="cat"
                    :filename="filename"
                    :file-path="getFilePath(cat, filename)"
                    @delete="deleteTrack(cat, filename)"
                  />
                  <div
                    v-if="(selectedPackInfo.categories[cat]?.length ?? 0) === 0"
                    class="px-8 py-2 text-xs text-gray-600 italic"
                  >
                    No audio files. Click + to add.
                  </div>
                </div>
              </div>
            </template>
            <div v-else class="flex items-center justify-center h-full text-gray-600 text-sm">
              Select a pack to view its contents
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex justify-end px-4 py-3 border-t border-gray-700 shrink-0">
          <button
            class="px-4 py-1.5 bg-gray-700/60 rounded hover:bg-gray-600/70 text-sm text-gray-200"
            @click="emit('close')"
          >
            Close
          </button>
        </div>
      </div>
    </div>

    <!-- Context menu -->
    <PackContextMenu
      v-if="ctxMenu"
      :pack-name="ctxMenu.packName"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      @close="closeCtxMenu"
      @renamed="onPackRenamed"
      @duplicated="onPackDuplicated"
      @deleted="onPackDeleted"
    />
  </Teleport>
</template>
