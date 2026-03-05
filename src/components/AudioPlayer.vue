<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { useSoundStore } from '../stores/soundStore';

const props = defineProps<{
  packName: string;
  category: string;
  filename: string;
  filePath: string;
}>();

const emit = defineEmits<{
  delete: [];
}>();

const soundStore = useSoundStore();

const trackKey = computed(() => `${props.category}/${props.filename}`);
const trackCfg = computed(() => soundStore.getTrackConfig(props.packName, trackKey.value));

const enabled = computed({
  get: () => trackCfg.value.enabled,
  set: (val: boolean) => {
    soundStore.setTrackConfig(props.packName, trackKey.value, {
      ...trackCfg.value,
      enabled: val,
    });
    void soundStore.saveConfig();
  },
});

const volume = computed({
  get: () => Math.round(trackCfg.value.volume * 100),
  set: (val: number) => {
    soundStore.setTrackConfig(props.packName, trackKey.value, {
      ...trackCfg.value,
      volume: val / 100,
    });
    void soundStore.saveConfig();
  },
});

// ---- Playback state ----
const isPlaying = ref(false);
let previewEndedUnlisten: UnlistenFn | null = null;

async function play() {
  stop();
  isPlaying.value = true;
  try {
    await invoke('play_preview', {
      path: props.filePath,
      volume: trackCfg.value.volume,
    });
  } catch (err) {
    console.warn('[AudioPlayer] play_preview failed:', err);
    isPlaying.value = false;
  }
}

function stop() {
  if (isPlaying.value) {
    void invoke('stop_preview');
    isPlaying.value = false;
  }
}

const displayName = computed(() => {
  const name = props.filename;
  return name.length > 30 ? `${name.slice(0, 27)}...` : name;
});

onMounted(async () => {
  previewEndedUnlisten = await listen('preview-ended', () => {
    isPlaying.value = false;
  });
});

onBeforeUnmount(() => {
  stop();
  if (previewEndedUnlisten) previewEndedUnlisten();
});
</script>

<template>
  <div class="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-700/40 text-xs">
    <!-- Enable checkbox -->
    <input
      type="checkbox"
      :checked="enabled"
      class="w-4 h-4 accent-indigo-400 cursor-pointer"
      @change="enabled = ($event.target as HTMLInputElement).checked"
    />

    <!-- Filename -->
    <span class="flex-1 truncate text-gray-300 min-w-0" :title="filename">{{ displayName }}</span>

    <!-- Play button (restarts if already playing) -->
    <button
      class="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-600 text-gray-300"
      title="Play"
      @click="play"
    >
      ▶
    </button>

    <!-- Stop button -->
    <button
      class="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-600 text-gray-300"
      :class="!isPlaying ? 'opacity-30' : ''"
      title="Stop"
      @click="stop"
    >
      ⏹
    </button>

    <!-- Volume slider -->
    <input
      type="range"
      min="0"
      max="100"
      :value="volume"
      class="w-16 accent-indigo-400 shrink-0"
      title="Volume"
      @input="volume = parseInt(($event.target as HTMLInputElement).value)"
    />
    <span class="w-7 text-right text-gray-400 shrink-0 tabular-nums">{{ volume }}%</span>

    <!-- Trash button -->
    <button
      class="w-6 h-6 flex items-center justify-center rounded hover:bg-red-700/60 text-gray-400 hover:text-red-300"
      title="Delete"
      @click="emit('delete')"
    >
      🗑
    </button>
  </div>
</template>
