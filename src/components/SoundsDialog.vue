<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  nextTick,
  onMounted,
  onUnmounted,
} from 'vue';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import {
  mkdir,
  readFile,
  writeFile,
  exists,
  rename,
  remove,
} from '@tauri-apps/plugin-fs';
import JSZip from 'jszip';
import { useSoundStore, AGENT_EVENT_TYPES } from '../stores/soundStore';
import type { PackManifestSound } from '../stores/soundStore';
import type { AgentEvent, AgentEventType } from '../drivers/types';
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
  agentEventUnlisten = await listen<string>(
    'agent-event',
    (e) => {
      try {
        const parsed = JSON.parse(e.payload) as AgentEvent;
        flashEventRow(parsed.type);
      } catch { /* ignore parse errors */ }
    },
  );
});

onUnmounted(() => {
  if (agentEventUnlisten) agentEventUnlisten();
  if (flashTimeout) clearTimeout(flashTimeout);
  if (importErrorTimeout) clearTimeout(importErrorTimeout);
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
const ctxMenu = ref<{ packName: string; x: number; y: number; hasManifest: boolean } | null>(null);

function onPackRightClick(e: MouseEvent, packName: string) {
  e.preventDefault();
  const pack = soundStore.packs.find((p) => p.name === packName);
  ctxMenu.value = { packName, x: e.clientX, y: e.clientY, hasManifest: pack?.hasManifest ?? true };
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

async function onPackMigrated() {
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

// ---- New pack / inline rename ----
const editingPackName = ref<string | null>(null);
const editPackNameValue = ref('');
const editPackInput = ref<HTMLInputElement | null>(null);
const isNewPack = ref(false);

function generatePackName(): string {
  const existingNames = new Set(soundStore.packs.map((p) => p.name));
  const base = 'New Pack';
  if (!existingNames.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base} ${i}`;
    if (!existingNames.has(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}

async function startCreatePack(): Promise<void> {
  const packName = generatePackName();
  const baseDir = soundStore.getSoundPacksDir();
  const packPath = `${baseDir}/${packName}`;
  try {
    await mkdir(packPath, { recursive: true });
    await soundStore.savePackManifest(packName, { sounds: [], assignments: [] });
    await soundStore.scanPacks();
    selectedPack.value = packName;
    isNewPack.value = true;
    editingPackName.value = packName;
    editPackNameValue.value = packName;
    void nextTick(() => editPackInput.value?.select());
  } catch (err) {
    console.error('[SoundsDialog] createNewPack failed', err);
  }
}

async function confirmEditPackName(): Promise<void> {
  const oldName = editingPackName.value;
  if (!oldName) return;
  const newName = editPackNameValue.value.trim();
  editingPackName.value = null;
  isNewPack.value = false;

  if (!newName || newName === oldName) return;

  const baseDir = soundStore.getSoundPacksDir();
  try {
    await rename(`${baseDir}/${oldName}`, `${baseDir}/${newName}`);
    // Update activePacks
    const idx = soundStore.config.activePacks.indexOf(oldName);
    if (idx >= 0) soundStore.config.activePacks[idx] = newName;
    // Move soundOverrides entries
    const oldPrefix = `${oldName}/`;
    const newPrefix = `${newName}/`;
    for (const key of Object.keys(soundStore.config.soundOverrides)) {
      if (key.startsWith(oldPrefix)) {
        const filename = key.slice(oldPrefix.length);
        soundStore.config.soundOverrides[`${newPrefix}${filename}`] =
          soundStore.config.soundOverrides[key]!;
        delete soundStore.config.soundOverrides[key];
      }
    }
    await soundStore.saveConfig();
    await soundStore.scanPacks();
    if (selectedPack.value === oldName) selectedPack.value = newName;
  } catch (err) {
    console.error('[SoundsDialog] rename pack failed', err);
  }
}

async function cancelEditPackName(): Promise<void> {
  const oldName = editingPackName.value;
  const wasNew = isNewPack.value;
  editingPackName.value = null;
  isNewPack.value = false;

  if (wasNew && oldName) {
    const baseDir = soundStore.getSoundPacksDir();
    try {
      await remove(`${baseDir}/${oldName}`, { recursive: true });
      await soundStore.scanPacks();
      if (selectedPack.value === oldName) {
        selectedPack.value = soundStore.packs[0]?.name ?? null;
      }
    } catch (err) {
      console.error('[SoundsDialog] cancel new pack failed', err);
    }
  }
}

// ---- Import zip ----
const dragOver = ref(false);
const importError = ref<string | null>(null);
let importErrorTimeout: ReturnType<typeof setTimeout> | null = null;

function showImportError(message: string): void {
  importError.value = message;
  if (importErrorTimeout) clearTimeout(importErrorTimeout);
  importErrorTimeout = setTimeout(() => {
    importError.value = null;
    importErrorTimeout = null;
  }, 5000);
}

async function importZipBytes(filename: string, bytes: Uint8Array): Promise<void> {
  const dotIdx = filename.lastIndexOf('.');
  const packName = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;

  const zip = await JSZip.loadAsync(bytes);

  // Find manifest.json — could be at root or inside a single top-level folder
  let manifestFile = zip.file('manifest.json');
  let stripPrefix = '';
  if (!manifestFile) {
    const topDirs = Object.keys(zip.files).filter(
      (p) => p.endsWith('/') && !p.slice(0, -1).includes('/'),
    );
    if (topDirs.length === 1 && topDirs[0]) {
      stripPrefix = topDirs[0];
      manifestFile = zip.file(`${stripPrefix}manifest.json`);
    }
  }

  if (!manifestFile) {
    showImportError(
      'This ZIP does not contain a manifest.json. Please use the new pack format.',
    );
    return;
  }

  const baseDir = soundStore.getSoundPacksDir();
  const packPath = `${baseDir}/${packName}`;
  await mkdir(packPath, { recursive: true });

  // Write manifest.json
  const manifestData = await manifestFile.async('uint8array');
  await writeFile(`${packPath}/manifest.json`, manifestData);

  // Extract audio files to pack root (flat — no subdirectories)
  for (const [relativePath, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    let effectivePath = relativePath;
    if (stripPrefix && effectivePath.startsWith(stripPrefix)) {
      effectivePath = effectivePath.slice(stripPrefix.length);
    }
    if (effectivePath === 'manifest.json') continue;
    // Only extract files at the root level (no subdirectories)
    if (effectivePath.includes('/')) continue;
    const data = await file.async('uint8array');
    await writeFile(`${packPath}/${effectivePath}`, data);
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

// ---- Assignment chips (right column) ----
function assignmentsForEvent(eventType: AgentEventType): string[] {
  if (!selectedPackInfo.value) return [];
  return selectedPackInfo.value.manifest.assignments
    .filter((a) => a.event === eventType)
    .map((a) => a.file);
}

function truncateFilename(name: string, max = 20): string {
  if (name.length <= max) return name;
  return name.slice(0, max - 1) + '\u2026';
}

async function removeAssignment(
  file: string,
  eventType: AgentEventType,
): Promise<void> {
  if (!selectedPack.value || !selectedPackInfo.value) return;
  const manifest = selectedPackInfo.value.manifest;
  manifest.assignments = manifest.assignments.filter(
    (a) => !(a.file === file && a.event === eventType),
  );
  await soundStore.savePackManifest(selectedPack.value, manifest);
}

// ---- Drag-and-drop: sound → event row ----
const draggingSoundFile = ref<string | null>(null);
const dragOverEventType = ref<AgentEventType | null>(null);

// ---- Drag-and-drop: chip → sound row (re-assign) ----
const draggingChip = ref<{ file: string; event: AgentEventType } | null>(null);
const dragOverSoundFile = ref<string | null>(null);

function onSoundDragStart(e: DragEvent, filename: string): void {
  draggingSoundFile.value = filename;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', filename);
  }
}

function onSoundDragEnd(): void {
  draggingSoundFile.value = null;
  dragOverEventType.value = null;
}

function onEventDragOver(e: DragEvent, eventType: AgentEventType): void {
  if (!draggingSoundFile.value) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  dragOverEventType.value = eventType;
}

function onEventDragLeaveRow(): void {
  dragOverEventType.value = null;
}

async function onEventDrop(
  e: DragEvent,
  eventType: AgentEventType,
): Promise<void> {
  e.preventDefault();
  dragOverEventType.value = null;
  const file = draggingSoundFile.value;
  draggingSoundFile.value = null;
  if (!file) return;
  await addAssignment(file, eventType);
}

async function addAssignment(
  file: string,
  eventType: AgentEventType,
): Promise<void> {
  if (!selectedPack.value || !selectedPackInfo.value) return;
  const manifest = selectedPackInfo.value.manifest;
  const alreadyExists = manifest.assignments.some(
    (a) => a.file === file && a.event === eventType,
  );
  if (alreadyExists) return;
  manifest.assignments.push({ file, event: eventType });
  await soundStore.savePackManifest(selectedPack.value, manifest);
}

// ---- Chip drag handlers (re-assign chip to different sound) ----
function onChipDragStart(
  e: DragEvent,
  file: string,
  eventType: AgentEventType,
): void {
  draggingChip.value = { file, event: eventType };
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', file);
  }
}

function onChipDragEnd(): void {
  draggingChip.value = null;
  dragOverSoundFile.value = null;
}

function onSoundRowDragOver(e: DragEvent, filename: string): void {
  if (!draggingChip.value) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  dragOverSoundFile.value = filename;
}

function onSoundRowDragLeave(): void {
  dragOverSoundFile.value = null;
}

async function onSoundRowDrop(
  e: DragEvent,
  newFile: string,
): Promise<void> {
  e.preventDefault();
  dragOverSoundFile.value = null;
  const chip = draggingChip.value;
  draggingChip.value = null;
  if (!chip || !selectedPack.value || !selectedPackInfo.value) return;
  if (chip.file === newFile) return;
  const manifest = selectedPackInfo.value.manifest;
  manifest.assignments = manifest.assignments.filter(
    (a) => !(a.file === chip.file && a.event === chip.event),
  );
  const alreadyExists = manifest.assignments.some(
    (a) => a.file === newFile && a.event === chip.event,
  );
  if (!alreadyExists) {
    manifest.assignments.push({ file: newFile, event: chip.event });
  }
  await soundStore.savePackManifest(selectedPack.value, manifest);
}

// ---- Live highlight on incoming agent events ----
const flashingEvent = ref<AgentEventType | null>(null);
let flashTimeout: ReturnType<typeof setTimeout> | null = null;
let agentEventUnlisten: UnlistenFn | null = null;

function flashEventRow(eventType: AgentEventType): void {
  flashingEvent.value = eventType;
  if (flashTimeout) clearTimeout(flashTimeout);
  flashTimeout = setTimeout(() => {
    flashingEvent.value = null;
    flashTimeout = null;
  }, 200);
}

// ---- Add audio files to pack (OS drag + file picker) ----
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.webm']);
const audioDragOver = ref(false);

function isAudioFile(filename: string): boolean {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return false;
  return AUDIO_EXTENSIONS.has(filename.slice(dot).toLowerCase());
}

async function addAudioFilesFromBlobs(
  files: { name: string; bytes: Uint8Array }[],
): Promise<void> {
  if (!selectedPack.value || !selectedPackInfo.value) return;
  const baseDir = soundStore.getSoundPacksDir();
  const packPath = `${baseDir}/${selectedPack.value}`;
  const manifest = selectedPackInfo.value.manifest;
  let changed = false;

  for (const file of files) {
    if (!isAudioFile(file.name)) continue;
    await writeFile(`${packPath}/${file.name}`, file.bytes);
    const alreadyInManifest = manifest.sounds.some(
      (s) => s.file === file.name,
    );
    if (!alreadyInManifest) {
      manifest.sounds.push({
        file: file.name,
        volume: 1.0,
        enabled: true,
      });
      changed = true;
    }
  }

  if (changed) {
    await soundStore.savePackManifest(selectedPack.value, manifest);
  }
  if (selectedPack.value) {
    void checkSoundFileExistence(selectedPack.value);
  }
}

function onAudioDragOver(e: DragEvent): void {
  if (!selectedPack.value) return;
  e.preventDefault();
  e.stopPropagation();
  audioDragOver.value = true;
}

function onAudioDragLeave(): void {
  audioDragOver.value = false;
}

async function onAudioDrop(e: DragEvent): Promise<void> {
  e.preventDefault();
  e.stopPropagation();
  audioDragOver.value = false;
  if (!selectedPack.value) return;
  const dataFiles = e.dataTransfer?.files;
  if (!dataFiles || dataFiles.length === 0) return;

  const blobs: { name: string; bytes: Uint8Array }[] = [];
  for (let i = 0; i < dataFiles.length; i++) {
    const f = dataFiles[i];
    if (!f || !isAudioFile(f.name)) continue;
    const buf = await f.arrayBuffer();
    blobs.push({ name: f.name, bytes: new Uint8Array(buf) });
  }
  if (blobs.length > 0) {
    await addAudioFilesFromBlobs(blobs);
  }
}

async function openAddFilePicker(): Promise<void> {
  if (!selectedPack.value) return;
  const result = await open({
    filters: [{
      name: 'Audio',
      extensions: ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'webm'],
    }],
    multiple: true,
  });
  if (!result) return;
  const paths = Array.isArray(result) ? result : [result];
  const blobs: { name: string; bytes: Uint8Array }[] = [];
  for (const filePath of paths) {
    if (!filePath) continue;
    const filename = filePath.split('/').pop() ?? '';
    if (!isAudioFile(filename)) continue;
    const bytes = await readFile(filePath);
    blobs.push({ name: filename, bytes });
  }
  if (blobs.length > 0) {
    await addAudioFilesFromBlobs(blobs);
  }
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

        <!-- Import error toast -->
        <div
          v-if="importError"
          class="absolute top-3 left-1/2 -translate-x-1/2 z-[160] px-4 py-2 bg-red-900/90 border border-red-500 rounded-lg text-red-200 text-sm max-w-md text-center shadow-lg"
        >
          {{ importError }}
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
                <input
                  v-if="editingPackName === pack.name"
                  ref="editPackInput"
                  v-model="editPackNameValue"
                  class="flex-1 min-w-0 px-1 py-0.5 bg-gray-800 border border-indigo-400 rounded text-xs text-gray-200 outline-none"
                  @click.stop
                  @keydown.enter.prevent="confirmEditPackName"
                  @keydown.escape.prevent="cancelEditPackName"
                  @blur="confirmEditPackName"
                />
                <span v-else class="text-sm text-gray-200 truncate flex-1">{{ pack.name }}</span>
                <span
                  v-if="!pack.hasManifest"
                  class="shrink-0 text-[10px] px-1 py-0.5 rounded bg-amber-700/60 text-amber-200 leading-none"
                  title="Old format — right-click to migrate"
                >old</span>
              </div>
            </div>
            <!-- Buttons -->
            <div class="flex gap-1 p-2 border-t border-gray-700">
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

          <!-- Patchbay: Sounds + Events columns -->
          <div ref="rightPanel" class="flex flex-1 min-h-0 overflow-hidden">
            <!-- Sounds column -->
            <div
              class="flex-1 border-r border-gray-700 flex flex-col min-w-0"
              @dragover="onAudioDragOver"
              @dragleave="onAudioDragLeave"
              @drop="onAudioDrop"
            >
              <div class="flex items-center gap-2 px-3 py-2 border-b border-gray-700 shrink-0">
                <span class="text-xs font-semibold text-gray-400 uppercase tracking-wide flex-1">Sounds</span>
                <button
                  v-if="selectedPack"
                  class="px-2 py-0.5 bg-gray-700/60 rounded hover:bg-gray-600/70 text-xs text-gray-300"
                  @click="openAddFilePicker"
                >Add file</button>
              </div>
              <div class="flex-1 overflow-y-auto relative">
                <!-- Audio file drop overlay -->
                <div
                  v-if="audioDragOver && selectedPack"
                  class="absolute inset-0 z-10 flex items-center justify-center bg-indigo-900/60 border-2 border-dashed border-indigo-400 rounded pointer-events-none"
                >
                  <span class="text-indigo-200 text-sm font-semibold">Drop audio files here</span>
                </div>
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
                  draggable="true"
                  class="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800 hover:bg-gray-800/40 cursor-grab transition-colors duration-150"
                  :class="[
                    draggingSoundFile === sound.file ? 'opacity-50' : '',
                    dragOverSoundFile === sound.file ? 'bg-indigo-500/20' : '',
                    draggingChip ? 'opacity-100' : '',
                  ]"
                  @mouseenter="hoveredSoundFile = sound.file"
                  @mouseleave="hoveredSoundFile = null"
                  @dragstart="onSoundDragStart($event, sound.file)"
                  @dragend="onSoundDragEnd"
                  @dragover="onSoundRowDragOver($event, sound.file)"
                  @dragleave="onSoundRowDragLeave"
                  @drop="onSoundRowDrop($event, sound.file)"
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
                  class="px-3 py-2 border-b border-gray-800 transition-all duration-200"
                  :class="[
                    hasAssignments(eventType) ? 'opacity-100' : 'opacity-40',
                    flashingEvent === eventType ? 'bg-indigo-600/30' : '',
                    dragOverEventType === eventType ? 'bg-indigo-500/20 opacity-100' : '',
                    draggingSoundFile ? 'opacity-100' : '',
                  ]"
                  @dragover="onEventDragOver($event, eventType)"
                  @dragleave="onEventDragLeaveRow"
                  @drop="onEventDrop($event, eventType)"
                >
                  <div class="flex items-center gap-2">
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
                  </div>
                  <!-- Assignment chips -->
                  <div
                    v-if="assignmentsForEvent(eventType).length > 0"
                    class="flex flex-wrap gap-1 mt-1"
                  >
                    <span
                      v-for="file in assignmentsForEvent(eventType)"
                      :key="file"
                      draggable="true"
                      class="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-700/80 rounded text-xs text-gray-200 cursor-grab hover:bg-gray-600/80"
                      :class="draggingChip?.file === file && draggingChip?.event === eventType ? 'opacity-50' : ''"
                      :title="file"
                      @click="playPreview(file)"
                      @dragstart.stop="onChipDragStart($event, file, eventType)"
                      @dragend="onChipDragEnd"
                    >
                      {{ truncateFilename(file) }}
                      <button
                        class="ml-0.5 text-gray-400 hover:text-red-400 leading-none"
                        title="Remove assignment"
                        @click.stop="removeAssignment(file, eventType)"
                      >&times;</button>
                    </span>
                  </div>
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
      :has-manifest="ctxMenu.hasManifest"
      @close="closeCtxMenu"
      @renamed="onPackRenamed"
      @duplicated="onPackDuplicated"
      @deleted="onPackDeleted"
      @migrated="onPackMigrated"
    />
  </Teleport>
</template>
