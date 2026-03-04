<script setup lang="ts">
import { computed } from 'vue';
import { useSoundStore } from '../stores/soundStore';
import { useAgentStore } from '../drivers/agentStore';
import SoundsDialog from './SoundsDialog.vue';

const props = defineProps<{
  showSettings: boolean;
}>();

const emit = defineEmits<{
  'update:showSettings': [value: boolean];
}>();

const soundStore = useSoundStore();
const agentStore = useAgentStore();

const muted = computed({
  get: () => !soundStore.config.enabled,
  set: (val: boolean) => {
    soundStore.config.enabled = !val;
    void soundStore.saveConfig();
  },
});

const globalVolume = computed({
  get: () => Math.round(soundStore.config.globalVolume * 100),
  set: (v: number) => {
    soundStore.config.globalVolume = v / 100;
    void soundStore.saveConfig();
  },
});

// Active sessions with their assigned pack names
const sessionPackEntries = computed(() => {
  const entries: Array<{ sessionId: string; packName: string | null }> = [];
  for (const [sessionId] of agentStore.sessions) {
    const packName = soundStore.getSessionPack(sessionId);
    entries.push({ sessionId: sessionId.slice(0, 8), packName: packName ?? null });
  }
  return entries;
});

function openSettings() {
  emit('update:showSettings', true);
}

function closeSettings() {
  emit('update:showSettings', false);
}
</script>

<template>
  <div class="bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-3 min-w-[200px] text-xs">
    <!-- Mute toggle -->
    <label class="flex items-center gap-2 cursor-pointer mb-2">
      <input
        type="checkbox"
        :checked="muted"
        class="w-5 h-5 accent-indigo-400"
        @change="muted = ($event.target as HTMLInputElement).checked"
      />
      <span class="text-gray-300">Mute</span>
    </label>

    <!-- Volume -->
    <div class="flex items-center gap-2 mb-2">
      <span class="text-gray-400 w-10">Vol</span>
      <input
        type="range"
        min="0"
        max="100"
        :value="globalVolume"
        class="flex-1 accent-indigo-400"
        @input="globalVolume = parseInt(($event.target as HTMLInputElement).value)"
      />
      <span class="w-7 text-right text-gray-300 tabular-nums">{{ globalVolume }}%</span>
    </div>

    <!-- Session packs -->
    <div v-if="sessionPackEntries.length > 0" class="mb-2 border-t border-gray-700 pt-2">
      <div class="text-gray-500 mb-1">Active sessions</div>
      <div
        v-for="entry in sessionPackEntries"
        :key="entry.sessionId"
        class="flex items-center gap-1 text-gray-400"
      >
        <span class="font-mono">{{ entry.sessionId }}</span>
        <span class="text-gray-600">→</span>
        <span class="text-gray-300">{{ entry.packName ?? '—' }}</span>
      </div>
    </div>

    <!-- Settings button -->
    <button
      class="w-full px-2 py-1 bg-gray-700/60 rounded hover:bg-gray-600/70 text-gray-200 text-center"
      @click="openSettings"
    >
      Settings
    </button>
  </div>

  <!-- SoundsDialog opened from here -->
  <SoundsDialog
    v-if="showSettings"
    @close="closeSettings"
  />
</template>
