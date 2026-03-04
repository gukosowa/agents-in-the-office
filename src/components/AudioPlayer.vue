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
const currentTime = ref(0);
const duration = ref(0);
let buffer: AudioBuffer | null = null;
let source: AudioBufferSourceNode | null = null;
let gainNode: GainNode | null = null;
let startOffset = 0;
let startedAt = 0;
let rafId: ReturnType<typeof requestAnimationFrame> | null = null;

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const currentTimeDisplay = computed(() => formatTime(currentTime.value));
const durationDisplay = computed(() => formatTime(duration.value));

function tickRaf() {
  if (playState.value !== 'playing' || !buffer) return;
  const ctx = soundStore.getOrCreateAudioContext();
  currentTime.value = Math.min(
    startOffset + (ctx.currentTime - startedAt),
    buffer.duration,
  );
  rafId = requestAnimationFrame(tickRaf);
}

function stopRaf() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

async function loadBuffer(): Promise<AudioBuffer | null> {
  if (buffer) return buffer;
  const loaded = await soundStore.loadBuffer(props.filePath);
  if (loaded) {
    buffer = loaded;
    duration.value = loaded.duration;
  }
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
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  detachSource();

  gainNode = ctx.createGain();
  gainNode.gain.value = trackCfg.value.volume;
  gainNode.connect(ctx.destination);

  source = ctx.createBufferSource();
  source.buffer = buf;
  source.connect(gainNode);
  source.onended = () => {
    if (playState.value === 'playing') {
      playState.value = 'stopped';
      currentTime.value = 0;
      startOffset = 0;
      stopRaf();
    }
  };

  startedAt = ctx.currentTime;
  source.start(0, startOffset);
  playState.value = 'playing';
  rafId = requestAnimationFrame(tickRaf);
}

async function pause() {
  if (playState.value !== 'playing' || !buffer) return;
  const ctx = soundStore.getOrCreateAudioContext();
  startOffset = Math.min(
    startOffset + (ctx.currentTime - startedAt),
    buffer.duration,
  );
  stopRaf();
  detachSource();
  playState.value = 'paused';
}

function stop() {
  stopRaf();
  detachSource();
  playState.value = 'stopped';
  currentTime.value = 0;
  startOffset = 0;
}

async function togglePlayPause() {
  if (playState.value === 'playing') {
    await pause();
  } else {
    await play();
  }
}

async function seek(event: MouseEvent) {
  const buf = await loadBuffer();
  if (!buf) return;
  const el = event.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const targetTime = ratio * buf.duration;

  const wasPlaying = playState.value === 'playing';
  startOffset = targetTime;
  currentTime.value = targetTime;

  if (wasPlaying) {
    stopRaf();
    detachSource();
    await play();
  }
}

const seekerPercent = computed(() => {
  if (!buffer || buffer.duration === 0) return 0;
  return (currentTime.value / buffer.duration) * 100;
});

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
      class="accent-indigo-400 cursor-pointer"
      @change="enabled = ($event.target as HTMLInputElement).checked"
    />

    <!-- Filename -->
    <span class="w-32 truncate text-gray-300 shrink-0" :title="filename">{{ displayName }}</span>

    <!-- Play/Pause button -->
    <button
      class="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-600 text-gray-300"
      :title="playState === 'playing' ? 'Pause' : 'Play'"
      @click="togglePlayPause"
    >
      <span v-if="playState === 'playing'">⏸</span>
      <span v-else>▶</span>
    </button>

    <!-- Stop button -->
    <button
      class="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-600 text-gray-300"
      title="Stop"
      @click="stop"
    >
      ⏹
    </button>

    <!-- Seeker bar -->
    <div
      class="flex-1 h-2 bg-gray-600 rounded cursor-pointer relative min-w-0"
      @click="seek"
    >
      <div
        class="h-full bg-indigo-400 rounded transition-none"
        :style="{ width: `${seekerPercent}%` }"
      />
    </div>

    <!-- Time display -->
    <span class="w-20 text-center text-gray-400 shrink-0 tabular-nums">
      {{ currentTimeDisplay }} / {{ durationDisplay }}
    </span>

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
