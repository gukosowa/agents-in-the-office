<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import {
  rename,
  remove,
  mkdir,
  readDir,
  readFile,
  writeFile,
  exists,
} from '@tauri-apps/plugin-fs';
import { useSoundStore, AGENT_EVENT_TYPES } from '../stores/soundStore';
import type { AgentEventType } from '../drivers/types';
import type { PackManifest } from '../stores/soundStore';

const props = defineProps<{
  packName: string;
  x: number;
  y: number;
  hasManifest: boolean;
}>();

const emit = defineEmits<{
  close: [];
  renamed: [oldName: string, newName: string];
  duplicated: [newName: string];
  deleted: [name: string];
  migrated: [name: string];
}>();

const soundStore = useSoundStore();
const renaming = ref(false);
const renameValue = ref(props.packName);
const renameInput = ref<HTMLInputElement | null>(null);

function close() {
  emit('close');
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close();
}

function onOutsideClick(e: MouseEvent) {
  const el = document.getElementById('pack-context-menu');
  if (el && !el.contains(e.target as Node)) close();
}

onMounted(() => {
  document.addEventListener('mousedown', onOutsideClick);
  document.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onOutsideClick);
  document.removeEventListener('keydown', onKeydown);
});

function startRename() {
  renaming.value = true;
  renameValue.value = props.packName;
  // Focus the input next tick
  setTimeout(() => renameInput.value?.select(), 0);
}

async function confirmRename() {
  const newName = renameValue.value.trim();
  if (!newName || newName === props.packName) {
    renaming.value = false;
    close();
    return;
  }

  const baseDir = soundStore.getSoundPacksDir();
  const oldPath = `${baseDir}/${props.packName}`;
  const newPath = `${baseDir}/${newName}`;

  try {
    await rename(oldPath, newPath);

    // Update activePacks in config
    const idx = soundStore.config.activePacks.indexOf(props.packName);
    if (idx >= 0) {
      soundStore.config.activePacks[idx] = newName;
    }

    // Move soundOverrides entries to new pack name
    const oldPrefix = `${props.packName}/`;
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
    emit('renamed', props.packName, newName);
  } catch (err) {
    console.error('[PackContextMenu] rename failed', err);
  }

  close();
}

async function copyDir(srcPath: string, dstPath: string): Promise<void> {
  await mkdir(dstPath, { recursive: true });
  const entries = await readDir(srcPath);
  for (const entry of entries) {
    if (entry.name === undefined) continue;
    const srcEntry = `${srcPath}/${entry.name}`;
    const dstEntry = `${dstPath}/${entry.name}`;
    if (entry.isDirectory) {
      await copyDir(srcEntry, dstEntry);
    } else {
      const data = await readFile(srcEntry);
      await writeFile(dstEntry, data);
    }
  }
}

async function duplicate() {
  const baseDir = soundStore.getSoundPacksDir();
  const srcPath = `${baseDir}/${props.packName}`;
  const copyName = `${props.packName} (copy)`;
  const dstPath = `${baseDir}/${copyName}`;

  try {
    await copyDir(srcPath, dstPath);
    emit('duplicated', copyName);
  } catch (err) {
    console.error('[PackContextMenu] duplicate failed', err);
  }

  close();
}

async function migratePack(): Promise<void> {
  const baseDir = soundStore.getSoundPacksDir();
  const packPath = `${baseDir}/${props.packName}`;
  const eventTypes = new Set<string>(AGENT_EVENT_TYPES);
  const manifest: PackManifest = { sounds: [], assignments: [] };
  const seenFiles = new Set<string>();
  const dirsToRemove: string[] = [];

  const entries = await readDir(packPath);
  for (const entry of entries) {
    if (!entry.isDirectory || entry.name === undefined) continue;
    const folderName = entry.name;
    const folderPath = `${packPath}/${folderName}`;
    const isEventFolder = eventTypes.has(folderName);
    const fileEntries = await readDir(folderPath);

    for (const fileEntry of fileEntries) {
      if (fileEntry.isDirectory || fileEntry.name === undefined) continue;
      const filename = fileEntry.name;
      const srcPath = `${folderPath}/${filename}`;
      const dstPath = `${packPath}/${filename}`;

      // Move file to pack root (skip if already exists there)
      const alreadyAtRoot = await exists(dstPath);
      if (!alreadyAtRoot) {
        const data = await readFile(srcPath);
        await writeFile(dstPath, data);
      }
      await remove(srcPath);

      if (!seenFiles.has(filename)) {
        seenFiles.add(filename);
        manifest.sounds.push({
          file: filename,
          volume: 1.0,
          enabled: true,
        });
      }

      if (isEventFolder) {
        manifest.assignments.push({
          file: filename,
          event: folderName as AgentEventType,
        });
      }
    }

    dirsToRemove.push(folderPath);
  }

  // Remove empty subdirectories
  for (const dirPath of dirsToRemove) {
    try {
      await remove(dirPath, { recursive: true });
    } catch { /* ignore if already removed */ }
  }

  // Write manifest
  await soundStore.savePackManifest(props.packName, manifest);
  emit('migrated', props.packName);
  close();
}

async function deletePack() {
  const baseDir = soundStore.getSoundPacksDir();
  const packPath = `${baseDir}/${props.packName}`;

  try {
    await remove(packPath, { recursive: true });

    // Remove from activePacks
    soundStore.config.activePacks = soundStore.config.activePacks.filter(
      (p) => p !== props.packName,
    );

    // Remove soundOverrides entries for this pack
    const prefix = `${props.packName}/`;
    for (const key of Object.keys(soundStore.config.soundOverrides)) {
      if (key.startsWith(prefix)) {
        delete soundStore.config.soundOverrides[key];
      }
    }

    await soundStore.saveConfig();
    emit('deleted', props.packName);
  } catch (err) {
    console.error('[PackContextMenu] delete failed', err);
  }

  close();
}
</script>

<template>
  <Teleport to="body">
    <div
      id="pack-context-menu"
      class="fixed z-[200] bg-gray-800 border border-gray-600 rounded shadow-lg py-1 min-w-[140px] text-sm"
      :style="{ left: `${x}px`, top: `${y}px` }"
    >
      <template v-if="renaming">
        <div class="px-3 py-1">
          <input
            ref="renameInput"
            v-model="renameValue"
            class="w-full bg-gray-700 border border-gray-500 rounded px-1 py-0.5 text-gray-200 text-xs outline-none"
            @keydown.enter.prevent="confirmRename"
            @keydown.escape.prevent="close"
            @blur="confirmRename"
          />
        </div>
      </template>
      <template v-else>
        <button
          v-if="!hasManifest"
          class="w-full text-left px-3 py-1.5 hover:bg-gray-700 text-amber-300"
          @click="migratePack"
        >
          Migrate to new format
        </button>
        <button
          class="w-full text-left px-3 py-1.5 hover:bg-gray-700 text-gray-200"
          @click="startRename"
        >
          Rename
        </button>
        <button
          class="w-full text-left px-3 py-1.5 hover:bg-gray-700 text-gray-200"
          @click="duplicate"
        >
          Duplicate
        </button>
        <button
          class="w-full text-left px-3 py-1.5 hover:bg-gray-700 text-red-400"
          @click="deletePack"
        >
          Delete
        </button>
      </template>
    </div>
  </Teleport>
</template>
