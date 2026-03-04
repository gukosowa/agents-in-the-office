<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import {
  rename,
  remove,
  mkdir,
  readDir,
  readFile,
  writeFile,
} from '@tauri-apps/plugin-fs';
import { useSoundStore } from '../stores/soundStore';

const props = defineProps<{
  packName: string;
  x: number;
  y: number;
}>();

const emit = defineEmits<{
  close: [];
  renamed: [oldName: string, newName: string];
  duplicated: [newName: string];
  deleted: [name: string];
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

    // Move tracks config entry
    const oldTracks = soundStore.config.tracks[props.packName];
    if (oldTracks !== undefined) {
      soundStore.config.tracks[newName] = oldTracks;
      delete soundStore.config.tracks[props.packName];
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

async function deletePack() {
  const baseDir = soundStore.getSoundPacksDir();
  const packPath = `${baseDir}/${props.packName}`;

  try {
    await remove(packPath, { recursive: true });

    // Remove from activePacks
    soundStore.config.activePacks = soundStore.config.activePacks.filter(
      (p) => p !== props.packName,
    );

    // Remove from tracks
    delete soundStore.config.tracks[props.packName];

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
