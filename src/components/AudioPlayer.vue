<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue';
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
type PlayState = 'stopped' | 'playing' | 'paused';
const playState = ref<PlayState>('stopped');
let buffer: AudioBuffer | null = null;
let source: AudioBufferSourceNode | null = null;
let gainNode: GainNode | null = null;

async function loadBuffer(): Promise<AudioBuffer | null> {
  if (buffer) return buffer;
  const loaded = await soundStore.loadBuffer(props.filePath);
  if (loaded) buffer = loaded;
  return buffer;
}

function detachSource() {
  if (source) {
    source.onended = null;
    try { source.stop(); } catch { /* already stopped */ }
    source.disconnect();
    source = null;
  }
  if (gainNode) {
    gainNode.disconnect();
    gainNode = null;
  }
}

async function play() {
  const buf = await loadBuffer();
  if (!buf) return;

  const ctx = soundStore.getOrCreateAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();

  detachSource();

  gainNode = ctx.createGain();
  gainNode.gain.value = trackCfg.value.volume;
  gainNode.connect(ctx.destination);

  source = ctx.createBufferSource();
  source.buffer = buf;
  source.connect(gainNode);
  source.onended = () => {
    if (playState.value === 'playing') playState.value = 'stopped';
  };

  source.start(0, 0);
  playState.value = 'playing';
}

async function pause() {
  if (playState.value !== 'playing') return;
  detachSource();
  playState.value = 'paused';
}

function stop() {
  detachSource();
  playState.value = 'stopped';
}

const displayName = computed(() => {
  const name = props.filename;
  return name.length > 30 ? `${name.slice(0, 27)}...` : name;
});

onBeforeUnmount(() => {
  stop();
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

    <!-- Pause button -->
    <button
      class="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-600 text-gray-300"
      :class="playState !== 'playing' ? 'opacity-30' : ''"
      title="Pause"
      @click="pause"
    >
      ⏸
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
