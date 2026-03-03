<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  nextTick,
} from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useAgentStore } from '../drivers/agentStore';

const MINIMIZED_KEY = 'agent-panel-minimized';

const props = defineProps<{
  sessionId: string;
}>();

const pinned = defineModel<boolean>('pinned', {
  default: false,
});

const agentStore = useAgentStore();
const minimized = ref(
  localStorage.getItem(MINIMIZED_KEY) === 'true',
);

watch(minimized, (val) => {
  localStorage.setItem(MINIMIZED_KEY, String(val));
});
const chatContainer = ref<HTMLElement | null>(null);
const promptExpanded = ref(false);
const miniPromptExpanded = ref(false);
const expandedMessages = ref(new Set<string>());

const session = computed(
  () => agentStore.sessions.get(props.sessionId),
);

const displayName = computed(
  () => session.value?.driver.displayName ?? 'Agent',
);

const promptText = computed(
  () => session.value?.prompt ?? null,
);

const latestPromptText = computed(
  () => session.value?.latestPrompt
    ?? session.value?.prompt
    ?? null,
);

const latestPromptFirstLine = computed(() => {
  const text = latestPromptText.value;
  if (!text) return null;
  return text.replace(/\n+/g, ' ').trim() || null;
});

const agentStatus = computed(
  () => session.value?.status ?? 'idle',
);

const cwdLabel = computed(() => {
  const cwd = session.value?.cwd;
  if (!cwd) return '';
  const parts = cwd.split('/');
  return parts[parts.length - 1] ?? cwd;
});

const canFocusTerminal = computed(() => {
  const s = session.value;
  return Boolean(s?.termProgram && s?.cwd);
});

function focusTerminal(): void {
  const s = session.value;
  if (!s?.termProgram || !s?.cwd) return;
  invoke('focus_terminal_window', {
    termProgram: s.termProgram,
    cwd: s.cwd,
  }).catch((err) => {
    console.warn('focus_terminal_window failed:', err);
  });
}

const messages = computed(
  () => session.value?.activityLog ?? [],
);

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

watch(
  () => messages.value.length,
  async () => {
    await nextTick();
    if (chatContainer.value) {
      chatContainer.value.scrollTop =
        chatContainer.value.scrollHeight;
    }
  },
);

function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text).catch(() => {});
}

function togglePrompt(): void {
  if (promptText.value) copyToClipboard(promptText.value);
  promptExpanded.value = !promptExpanded.value;
}

function toggleMessage(msg: { id: string; fullText?: string; text: string }): void {
  copyToClipboard(msg.fullText ?? msg.text);
  if (expandedMessages.value.has(msg.id)) {
    expandedMessages.value.delete(msg.id);
  } else {
    expandedMessages.value.add(msg.id);
  }
}
</script>

<template>
  <div
    class="absolute bottom-4 left-4 z-50 max-w-[calc(100vw-2rem)]"
    @mousedown.stop
    @click.stop
  >
    <Transition name="panel">
      <div
        v-if="minimized"
        key="btn"
        class="flex items-center gap-2"
      >
        <button
          class="px-3 py-1 rounded-lg bg-gray-900/60 backdrop-blur border border-gray-700/40 text-gray-400 hover:text-white hover:bg-gray-800/70 transition-colors font-mono text-xs flex items-center justify-center shadow-lg shrink-0"
          @click="minimized = false"
        >Log</button>
        <div
          v-if="latestPromptFirstLine"
          class="rounded-lg bg-gray-800/70 hover:bg-blue-600/90 backdrop-blur border border-gray-600/40 hover:border-blue-500/30 text-white font-mono text-xs shadow-lg cursor-pointer transition-all overflow-hidden"
          :class="miniPromptExpanded
            ? 'px-3 py-2 max-w-[700px] max-h-[300px] overflow-y-auto whitespace-pre-wrap break-words'
            : 'px-3 py-1 min-w-0 flex-1 whitespace-nowrap overflow-hidden text-ellipsis'"
          @click="miniPromptExpanded = !miniPromptExpanded"
        >{{ miniPromptExpanded ? latestPromptText : latestPromptFirstLine }}</div>
        <div
          class="px-2 py-1 rounded-md font-mono text-[10px] font-bold uppercase tracking-wide shrink-0"
          :class="agentStatus === 'working'
            ? 'bg-green-500/80 text-white'
            : 'bg-gray-700/80 text-gray-400'"
        >{{ agentStatus }}</div>
      </div>

      <div
        v-else
        key="panel"
        class="w-[380px] max-h-[calc(100vh-8rem)] bg-gray-900/60 backdrop-blur border border-gray-700/40 rounded-lg shadow-lg flex flex-col overflow-hidden"
      >
        <div
          class="flex items-center gap-2 px-3 py-1.5 border-b border-gray-700/40"
        >
          <button
            class="w-6 h-6 rounded text-gray-400 hover:text-white hover:bg-gray-700/60 transition-colors font-mono text-sm flex items-center justify-center shrink-0"
            @click="minimized = true"
          >_</button>
          <span
            class="text-gray-300 text-xs font-mono truncate flex-1"
          >{{ displayName }}<template
              v-if="cwdLabel"
            > · {{ cwdLabel }}</template></span>
          <button
            class="w-6 h-6 rounded transition-colors flex items-center justify-center shrink-0"
            :class="pinned
              ? 'text-white bg-gray-600/60'
              : 'text-gray-400 hover:text-white hover:bg-gray-700/60'"
            :title="pinned ? 'Unpin panel' : 'Pin panel'"
            @click="pinned = !pinned"
          ><svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="w-3.5 h-3.5"
            ><rect
                x="5" y="2" width="6" height="7" rx="1"
                :fill="pinned ? 'currentColor' : 'none'"
              /><line x1="8" y1="9" x2="8" y2="14" /></svg></button>
          <button
            v-if="canFocusTerminal"
            class="w-6 h-6 rounded text-gray-400 hover:text-white hover:bg-gray-700/60 transition-colors flex items-center justify-center shrink-0"
            title="Focus terminal window"
            @click="focusTerminal"
          ><svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="w-3.5 h-3.5"
            ><path d="M9 2h5v5" /><path d="M14 2 7 9" /><path d="M12 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4" /></svg></button>
        </div>

        <div
          v-if="promptText"
          class="mx-2 mt-2 px-2 py-1.5 rounded bg-blue-600/80 text-white font-mono text-xs break-words overflow-hidden cursor-pointer hover:brightness-125 transition-[filter,max-height]"
          :class="promptExpanded ? 'max-h-[400px] overflow-y-auto' : 'max-h-[80px]'"
          @click="togglePrompt()"
        ><span class="text-[9px] text-blue-200 block leading-tight">Initial Prompt:</span>{{ promptText }}</div>

        <div
          ref="chatContainer"
          class="flex flex-col gap-1.5 overflow-y-auto p-2 max-h-[200px]"
        >
          <div
            v-for="msg in messages"
            :key="msg.id"
            class="flex items-end gap-2 font-mono text-xs"
            :class="msg.side === 'agent' ? 'self-start' : 'self-end flex-row-reverse'"
          >
            <div
              class="px-2 py-1 rounded max-w-[280px] break-words cursor-pointer hover:brightness-125 transition-[filter]"
              :class="[
                msg.side === 'agent'
                  ? 'bg-gray-700/90 text-gray-200'
                  : 'bg-blue-600/80 text-white',
                expandedMessages.has(msg.id) ? '' : 'line-clamp-4',
              ]"
              @click="toggleMessage(msg)"
            >{{ expandedMessages.has(msg.id) ? (msg.fullText ?? msg.text) : msg.text }}</div>
            <span
              class="text-[10px] text-gray-500 whitespace-nowrap shrink-0"
            >{{ formatTime(msg.timestamp) }}</span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.panel-enter-active,
.panel-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.panel-enter-from,
.panel-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.95);
}
</style>
