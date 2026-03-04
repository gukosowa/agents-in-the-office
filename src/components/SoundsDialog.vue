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
  readFile,
  writeFile,
  exists,
} from '@tauri-apps/plugin-fs';
import JSZip from 'jszip';
import { useSoundStore, AGENT_EVENT_TYPES } from '../stores/soundStore';
import type { PackManifestSound } from '../stores/soundStore';
import type { AgentEventType } from '../drivers/types';
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

// ---- Event descriptions ----
const EVENT_DESCRIPTIONS: Record<string, string> = {
  session_start: 'Agent session begins.',
  session_end: 'Agent session ends or is interrupted.',
  prompt_submit: 'User submits a prompt to the agent.',
  tool_start: 'Agent begins executing a tool (e.g. Bash, Read, Edit).',
  tool_end: 'Agent finishes executing a tool.',
  turn_end: 'Agent completes a full response turn.',
  permission_wait: 'Agent pauses waiting for the user to approve a tool call.',
  subagent_start: 'A subagent is spawned by the parent agent.',
  subagent_end: 'A subagent finishes its work.',
  idle_notification: 'Agent has been idle and sends a nudge notification.',
  elicitation_wait: 'Agent pauses waiting for user input.',
  auth_success: 'Authentication to an external service succeeds.',
  worktree_create: 'A new git worktree is created.',
  worktree_remove: 'A git worktree is removed.',
  teammate_idle: "A teammate's agent session goes idle.",
  task_completed: 'Agent marks a task as completed.',
};

const activeInfoPopover = ref<string | null>(null);

function toggleInfoPopover(eventType: string) {
  activeInfoPopover.value = activeInfoPopover.value === eventType ? null : eventType;
}

// ---- Patchbay data ----
const selectedPackInfo = computed(() =>
  soundStore.packs.find((p) => p.name === selectedPack.value) ?? null,
);

function hasAssignments(eventType: AgentEventType): boolean {
  if (!selectedPackInfo.value) return false;
  return selectedPackInfo.value.manifest.assignments.some((a) => a.event === eventType);
}

// ---- Sound preview (left column) ----
let previewSource: AudioBufferSourceNode | null = null;
const previewFile = ref<string | null>(null);
const soundFileExists = ref<Map<string, boolean>>(new Map());
const hoveredSoundFile = ref<string | null>(null);

async function checkSoundFileExistence(packName: string): Promise<void> {
  const sounds = selectedPackInfo.value?.manifest.sounds ?? [];
  const baseDir = soundStore.getSoundPacksDir();
  const newMap = new Map<string, boolean>();
  await Promise.all(
    sounds.map(async (sound) => {
      const filePath = `${baseDir}/${packName}/${sound.file}`;
      const fileExists = await exists(filePath);
      newMap.set(sound.file, fileExists);
    }),
  );
  soundFileExists.value = newMap;
}

function stopPreview(): void {
  if (previewSource) {
    try { previewSource.stop(); } catch { /* already stopped */ }
    previewSource = null;
  }
  previewFile.value = null;
}

async function playPreview(filename: string): Promise<void> {
  if (!selectedPack.value) return;
  stopPreview();
  const baseDir = soundStore.getSoundPacksDir();
  const filePath = `${baseDir}/${selectedPack.value}/${filename}`;
  const buffer = await soundStore.loadBuffer(filePath);
  if (!buffer) return;
  const ctx = soundStore.getOrCreateAudioContext();
  const sound = selectedPackInfo.value?.manifest.sounds.find((s) => s.file === filename);
  const gainNode = ctx.createGain();
  gainNode.gain.value =
    soundStore.config.globalVolume * soundStore.effectiveVolume(selectedPack.value, filename, sound);
  gainNode.connect(ctx.destination);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(gainNode);
  previewFile.value = filename;
  previewSource = source;
  source.onended = () => {
    if (previewFile.value === filename) {
      previewFile.value = null;
      previewSource = null;
    }
  };
  source.start();
}

async function updateSoundVolume(sound: PackManifestSound, volume: number): Promise<void> {
  if (!selectedPack.value || !selectedPackInfo.value) return;
  sound.volume = volume;
  await soundStore.savePackManifest(selectedPack.value, selectedPackInfo.value.manifest);
}

async function updateSoundEnabled(sound: PackManifestSound, enabled: boolean): Promise<void> {
  if (!selectedPack.value || !selectedPackInfo.value) return;
  sound.enabled = enabled;
  await soundStore.savePackManifest(selectedPack.value, selectedPackInfo.value.manifest);
}

// Reset scroll + stop preview + check file existence on pack change
watch(selectedPack, async (packName) => {
  stopPreview();
  soundFileExists.value = new Map();
  if (packName) void checkSoundFileExistence(packName);
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

          <!-- Patchbay: Sounds + Events columns -->
          <div ref="rightPanel" class="flex flex-1 min-h-0 overflow-hidden">
            <!-- Sounds column -->
            <div class="flex-1 border-r border-gray-700 flex flex-col min-w-0">
              <div class="px-3 py-2 border-b border-gray-700 shrink-0">
                <span class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Sounds</span>
              </div>
              <div class="flex-1 overflow-y-auto">
                <div
                  v-if="!selectedPackInfo"
                  class="flex items-center justify-center h-full text-gray-600 text-sm"
                >
                  Select a pack
                </div>
                <div
                  v-else-if="selectedPackInfo.manifest.sounds.length === 0"
                  class="flex items-center justify-center h-full text-gray-600 text-sm"
                >
                  No sounds in this pack
                </div>
                <div
                  v-for="sound in selectedPackInfo.manifest.sounds"
                  v-else
                  :key="sound.file"
                  class="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800 hover:bg-gray-800/40"
                  @mouseenter="hoveredSoundFile = sound.file"
                  @mouseleave="hoveredSoundFile = null"
                >
                  <!-- Play button -->
                  <button
                    class="shrink-0 w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-gray-700 text-xs"
                    title="Play preview"
                    @click="playPreview(sound.file)"
                  >▶</button>

                  <!-- Filename -->
                  <span class="flex-1 text-xs font-mono text-gray-200 truncate min-w-0">{{ sound.file }}</span>

                  <!-- Broken link indicator -->
                  <span
                    v-if="soundFileExists.get(sound.file) === false"
                    class="shrink-0 text-red-400 text-xs"
                    title="File not found on disk"
                  >⚠</span>

                  <!-- Volume slider (visible on hover) -->
                  <input
                    v-show="hoveredSoundFile === sound.file"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    :value="sound.volume"
                    class="shrink-0 w-16 accent-indigo-400"
                    title="Volume"
                    @input="updateSoundVolume(sound, parseFloat(($event.target as HTMLInputElement).value))"
                  />

                  <!-- Enabled toggle -->
                  <input
                    type="checkbox"
                    :checked="sound.enabled"
                    class="shrink-0 w-4 h-4 accent-indigo-400 cursor-pointer"
                    title="Enable/disable this sound"
                    @change="updateSoundEnabled(sound, ($event.target as HTMLInputElement).checked)"
                  />

                  <!-- Stop button -->
                  <button
                    class="shrink-0 w-6 h-6 flex items-center justify-center rounded text-xs"
                    :class="previewFile === sound.file
                      ? 'text-red-400 hover:text-red-300 hover:bg-gray-700'
                      : 'text-gray-600 cursor-default'"
                    title="Stop preview"
                    @click="previewFile === sound.file ? stopPreview() : undefined"
                  >■</button>
                </div>
              </div>
            </div>

            <!-- Events column -->
            <div class="flex-1 flex flex-col min-w-0">
              <div class="px-3 py-2 border-b border-gray-700 shrink-0">
                <span class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Events</span>
              </div>
              <div class="flex-1 overflow-y-auto">
                <div
                  v-for="eventType in AGENT_EVENT_TYPES"
                  :key="eventType"
                  class="flex items-center gap-2 px-3 py-2 border-b border-gray-800 transition-opacity"
                  :class="hasAssignments(eventType) ? 'opacity-100' : 'opacity-40'"
                >
                  <span class="text-sm font-mono text-gray-300 flex-1">{{ eventType }}</span>
                  <!-- Info icon + popover -->
                  <span
                    v-if="EVENT_DESCRIPTIONS[eventType]"
                    class="relative shrink-0"
                    @click.stop
                  >
                    <span
                      class="w-4 h-4 flex items-center justify-center rounded-full border text-[10px] leading-none cursor-pointer select-none"
                      :class="activeInfoPopover === eventType
                        ? 'border-indigo-400 text-indigo-300 bg-indigo-900/40'
                        : 'border-gray-500 text-gray-400 hover:border-gray-300 hover:text-gray-200'"
                      @click="toggleInfoPopover(eventType)"
                    >i</span>
                    <div
                      v-if="activeInfoPopover === eventType"
                      class="absolute right-0 top-6 z-50 w-56 bg-gray-800 border border-gray-600 rounded shadow-lg px-3 py-2 text-xs text-gray-200 leading-relaxed"
                    >
                      {{ EVENT_DESCRIPTIONS[eventType] }}
                    </div>
                  </span>
                  <!-- US-006 will add assignment chips here -->
                </div>
              </div>
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
