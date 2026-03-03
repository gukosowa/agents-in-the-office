<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { homeDir } from '@tauri-apps/api/path';
import {
  readTextFile,
  writeTextFile,
  mkdir,
  remove,
} from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';

const emit = defineEmits<{ close: [] }>();

type HookStatus = 'loading' | 'present' | 'missing' | 'error';

const claudeStatus = ref<HookStatus>('loading');
const claudeErrorMsg = ref('');
const geminiStatus = ref<HookStatus>('loading');
const geminiErrorMsg = ref('');
const busy = ref(false);

const MARKER = 'agents-in-the-office';

interface HookCommand {
  type: 'command';
  command: string;
  async?: boolean;
  timeout?: number;
}

interface HookEntry {
  matcher?: string;
  hooks: HookCommand[];
}

interface SettingsFile {
  hooks?: Record<string, HookEntry[]>;
  [key: string]: unknown;
}

async function readSettings(settingsPath: string): Promise<SettingsFile> {
  try {
    const content = await readTextFile(settingsPath);
    return JSON.parse(content) as SettingsFile;
  } catch {
    return {};
  }
}

async function checkMarkerInFile(path: string): Promise<boolean> {
  try {
    const content = await readTextFile(path);
    return content.includes(MARKER);
  } catch {
    return false;
  }
}

function mergeHookEntries(
  settings: SettingsFile,
  entries: Record<string, HookEntry[]>,
): void {
  if (!settings.hooks) settings.hooks = {};
  for (const [event, newEntries] of Object.entries(entries)) {
    const existing = settings.hooks[event] ?? [];
    const filtered = existing.filter(
      (e) => !JSON.stringify(e).includes(MARKER),
    );
    settings.hooks[event] = [...filtered, ...newEntries];
  }
}

function removeMarkerEntries(settings: SettingsFile): void {
  if (!settings.hooks) return;
  for (const event of Object.keys(settings.hooks)) {
    settings.hooks[event] = (settings.hooks[event] ?? []).filter(
      (e) => !JSON.stringify(e).includes(MARKER),
    );
    if (settings.hooks[event]!.length === 0) {
      delete settings.hooks[event];
    }
  }
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }
}

// --- Claude Code hooks ---

function buildClaudeHookEntries(
  scriptPath: string,
): Record<string, HookEntry[]> {
  const asyncEntry = (
    event: string, hasMatcher: boolean,
  ): HookEntry => ({
    ...(hasMatcher ? { matcher: '' } : {}),
    hooks: [{
      type: 'command',
      command: `${scriptPath} ${event}`,
      async: true,
    }],
  });
  const syncEntry = (event: string): HookEntry => ({
    hooks: [{
      type: 'command',
      command: `${scriptPath} ${event}`,
    }],
  });
  return {
    PreToolUse: [asyncEntry('PreToolUse', true)],
    PostToolUse: [asyncEntry('PostToolUse', true)],
    SessionStart: [syncEntry('SessionStart')],
    SessionEnd: [asyncEntry('SessionEnd', false)],
    Stop: [asyncEntry('Stop', false)],
    Notification: [asyncEntry('Notification', false)],
    UserPromptSubmit: [asyncEntry('UserPromptSubmit', false)],
    SubagentStart: [asyncEntry('SubagentStart', false)],
    SubagentStop: [asyncEntry('SubagentStop', false)],
    WorktreeCreate: [syncEntry('WorktreeCreate')],
    WorktreeRemove: [asyncEntry('WorktreeRemove', false)],
    TeammateIdle: [asyncEntry('TeammateIdle', false)],
    TaskCompleted: [asyncEntry('TaskCompleted', false)],
  };
}

function buildClaudeScriptContent(): string {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'HOOK_NAME="${1:-}"',
    'INPUT=$(cat)',
    '',
    'SESSION_ID=""',
    'SESSION_ID=$(printf \'%s\' "$INPUT" | jq -r \'.session_id // empty\' 2>/dev/null) \\',
    '  || SESSION_ID=""',
    '[ -z "$SESSION_ID" ] && exit 0',
    '',
    'EVENT_TYPE=""',
    'case "$HOOK_NAME" in',
    '  SessionStart)     EVENT_TYPE="session_start" ;;',
    '  SessionEnd)       EVENT_TYPE="session_end" ;;',
    '  Stop)             EVENT_TYPE="turn_end" ;;',
    '  PreToolUse)       EVENT_TYPE="tool_start" ;;',
    '  PostToolUse)      EVENT_TYPE="tool_end" ;;',
    '  UserPromptSubmit) EVENT_TYPE="prompt_submit" ;;',
    '  SubagentStart)    EVENT_TYPE="subagent_start" ;;',
    '  SubagentStop)     EVENT_TYPE="subagent_end" ;;',
    '  Notification)',
    '    NT=$(printf \'%s\' "$INPUT" | jq -r \'.notification_type // empty\' 2>/dev/null) || NT=""',
    '    case "$NT" in',
    '      permission_prompt)   EVENT_TYPE="permission_wait" ;;',
    '      idle_prompt)         EVENT_TYPE="idle_notification" ;;',
    '      elicitation_dialog)  EVENT_TYPE="elicitation_wait" ;;',
    '      auth_success)        EVENT_TYPE="auth_success" ;;',
    '      *) exit 0 ;;',
    '    esac',
    '    ;;',
    '  WorktreeCreate)  EVENT_TYPE="worktree_create" ;;',
    '  WorktreeRemove)  EVENT_TYPE="worktree_remove" ;;',
    '  TeammateIdle)    EVENT_TYPE="teammate_idle" ;;',
    '  TaskCompleted)   EVENT_TYPE="task_completed" ;;',
    '  *) exit 0 ;;',
    'esac',
    '',
    'jq_field() {',
    '  local val=""',
    '  val=$(printf \'%s\' "$INPUT" | jq -r --arg k "$1" \'.[$k] // empty\' 2>/dev/null) \\',
    '    || val=""',
    '  printf \'%s\' "$val"',
    '}',
    '',
    'WORKTREE_PATH=""',
    'if [ "$HOOK_NAME" = "WorktreeCreate" ]; then',
    '  WT_CWD=$(jq_field "cwd")',
    '  WT_NAME=$(jq_field "name")',
    '  [ -z "$WT_NAME" ] && WT_NAME="wt-$(date +%s)"',
    '  WT_PATH="$WT_CWD/.claude/worktrees/$WT_NAME"',
    '  git -C "$WT_CWD" worktree add -b "$WT_NAME" "$WT_PATH" HEAD 2>/dev/null',
    '  printf \'%s\\n\' "$WT_PATH"',
    '  WORKTREE_PATH="$WT_PATH"',
    'fi',
    '',
    'if [ "$HOOK_NAME" = "WorktreeRemove" ]; then',
    '  WT_PATH=$(jq_field "worktree_path")',
    '  [ -n "$WT_PATH" ] && git worktree remove --force "$WT_PATH" 2>/dev/null || true',
    '  WORKTREE_PATH="$WT_PATH"',
    'fi',
    '',
    'BASE_DIR="$HOME/.agents-in-the-office"',
    'EVENTS_DIR="$BASE_DIR/events"',
    'SESSIONS_DIR="$BASE_DIR/sessions"',
    'mkdir -p "$EVENTS_DIR" "$SESSIONS_DIR"',
    '',
    'TS_SEC=$(date +%s)',
    'TS="${TS_SEC}000"',
    'PREFIX="${SESSION_ID:0:8}"',
    'FILE="$EVENTS_DIR/${TS}-${PREFIX}-${EVENT_TYPE}.json"',
    '',
    'TOOL_NAME=$(jq_field "tool_name")',
    'CWD=$(jq_field "cwd")',
    'TRANSCRIPT_PATH=$(jq_field "transcript_path")',
    'PROMPT=$(jq_field "prompt")',
    'TERM_APP="${TERM_PROGRAM:-}"',
    'AGENT_ID=$(jq_field "agent_id")',
    'AGENT_TRANSCRIPT_PATH=$(jq_field "agent_transcript_path")',
    'LAST_MSG=$(jq_field "last_assistant_message")',
    'NOTIF_MSG=$(jq_field "message")',
    'TEAMMATE_NAME=$(jq_field "teammate_name")',
    'TEAM_NAME=$(jq_field "team_name")',
    'TASK_ID=$(jq_field "task_id")',
    'TASK_SUBJECT=$(jq_field "task_subject")',
    '',
    'TOOL_INPUT=$(printf \'%s\' "$INPUT" | jq -c \'.tool_input // empty\' 2>/dev/null) || TOOL_INPUT=""',
    '[ "$TOOL_INPUT" = "null" ] || [ "$TOOL_INPUT" = "" ] && TOOL_INPUT=""',
    '',
    'PAYLOAD=$(jq -n \\',
    '  --arg toolName "$TOOL_NAME" \\',
    '  --arg cwd "$CWD" \\',
    '  --arg transcriptPath "$TRANSCRIPT_PATH" \\',
    '  --arg prompt "$PROMPT" \\',
    '  --arg termProgram "$TERM_APP" \\',
    '  --arg toolInput "$TOOL_INPUT" \\',
    '  --arg agentId "$AGENT_ID" \\',
    '  --arg agentTranscriptPath "$AGENT_TRANSCRIPT_PATH" \\',
    '  --arg lastAssistantMessage "$LAST_MSG" \\',
    '  --arg worktreePath "$WORKTREE_PATH" \\',
    '  --arg notificationMessage "$NOTIF_MSG" \\',
    '  --arg teammateName "$TEAMMATE_NAME" \\',
    '  --arg teamName "$TEAM_NAME" \\',
    '  --arg taskId "$TASK_ID" \\',
    '  --arg taskSubject "$TASK_SUBJECT" \\',
    "  '{",
    '    toolName: (if $toolName != "" then $toolName else null end),',
    '    cwd: (if $cwd != "" then $cwd else null end),',
    '    transcriptPath: (if $transcriptPath != "" then $transcriptPath else null end),',
    '    prompt: (if $prompt != "" then $prompt else null end),',
    '    termProgram: (if $termProgram != "" then $termProgram else null end),',
    '    toolInput: (if $toolInput != "" then ($toolInput | fromjson) else null end),',
    '    agentId: (if $agentId != "" then $agentId else null end),',
    '    agentTranscriptPath: (if $agentTranscriptPath != "" then $agentTranscriptPath else null end),',
    '    lastAssistantMessage: (if $lastAssistantMessage != "" then $lastAssistantMessage else null end),',
    '    worktreePath: (if $worktreePath != "" then $worktreePath else null end),',
    '    notificationMessage: (if $notificationMessage != "" then $notificationMessage else null end),',
    '    teammateName: (if $teammateName != "" then $teammateName else null end),',
    '    teamName: (if $teamName != "" then $teamName else null end),',
    '    taskId: (if $taskId != "" then $taskId else null end),',
    '    taskSubject: (if $taskSubject != "" then $taskSubject else null end)',
    "  } | with_entries(select(.value != null))')",
    '',
    'jq -n \\',
    '  --arg sessionId "$SESSION_ID" \\',
    '  --argjson timestamp "$TS" \\',
    '  --arg type "$EVENT_TYPE" \\',
    '  --argjson payload "$PAYLOAD" \\',
    "  '{",
    '    sessionId: $sessionId,',
    '    timestamp: $timestamp,',
    '    type: $type,',
    '    agentType: "claude_code",',
    '    payload: $payload',
    "  }' > \"$FILE\"",
    '',
    'SESSION_FILE="$SESSIONS_DIR/${SESSION_ID}.json"',
    'if [ "$EVENT_TYPE" = "session_end" ]; then',
    '  rm -f "$SESSION_FILE"',
    'else',
    '  jq -n \\',
    '    --arg sessionId "$SESSION_ID" \\',
    '    --argjson timestamp "$TS" \\',
    '    --arg lastEventType "$EVENT_TYPE" \\',
    '    --argjson payload "$PAYLOAD" \\',
    "    '{",
    '      sessionId: $sessionId,',
    '      timestamp: $timestamp,',
    '      lastEventType: $lastEventType,',
    '      agentType: "claude_code",',
    '      payload: $payload',
    "    }' > \"$SESSION_FILE\"",
    'fi',
    '',
  ].join('\n');
}

// --- Gemini CLI hooks ---

function buildGeminiHookEntries(
  scriptPath: string,
): Record<string, HookEntry[]> {
  const entry = (
    event: string, hasMatcher: boolean,
  ): HookEntry => ({
    ...(hasMatcher ? { matcher: '' } : {}),
    hooks: [{
      type: 'command',
      command: `${scriptPath} ${event}`,
      timeout: 5000,
    }],
  });
  return {
    BeforeTool: [entry('BeforeTool', true)],
    AfterTool: [entry('AfterTool', true)],
    SessionStart: [entry('SessionStart', false)],
    SessionEnd: [entry('SessionEnd', false)],
    BeforeAgent: [entry('BeforeAgent', false)],
    AfterAgent: [entry('AfterAgent', false)],
    Notification: [entry('Notification', false)],
  };
}

function buildGeminiScriptContent(): string {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'HOOK_NAME="${1:-}"',
    'INPUT=$(cat)',
    '',
    '# Gemini CLI provides session_id in stdin JSON and',
    '# GEMINI_SESSION_ID as env var. Prefer stdin.',
    'SESSION_ID=""',
    'SESSION_ID=$(printf \'%s\' "$INPUT" | jq -r \'.session_id // empty\' 2>/dev/null) \\',
    '  || SESSION_ID=""',
    '[ -z "$SESSION_ID" ] && SESSION_ID="${GEMINI_SESSION_ID:-}"',
    '[ -z "$SESSION_ID" ] && exit 0',
    '',
    '# Map Gemini CLI hook names to app event types',
    'EVENT_TYPE=""',
    'case "$HOOK_NAME" in',
    '  SessionStart)  EVENT_TYPE="session_start" ;;',
    '  SessionEnd)    EVENT_TYPE="session_end" ;;',
    '  BeforeTool)    EVENT_TYPE="tool_start" ;;',
    '  AfterTool)     EVENT_TYPE="tool_end" ;;',
    '  BeforeAgent)   EVENT_TYPE="prompt_submit" ;;',
    '  AfterAgent)    EVENT_TYPE="turn_end" ;;',
    '  Notification)',
    '    NT=$(printf \'%s\' "$INPUT" | jq -r \'.notification_type // empty\' 2>/dev/null) || NT=""',
    '    case "$NT" in',
    '      ToolPermission) EVENT_TYPE="permission_wait" ;;',
    '      *) exit 0 ;;',
    '    esac',
    '    ;;',
    '  *) exit 0 ;;',
    'esac',
    '',
    'jq_field() {',
    '  local val=""',
    '  val=$(printf \'%s\' "$INPUT" | jq -r --arg k "$1" \'.[$k] // empty\' 2>/dev/null) \\',
    '    || val=""',
    '  printf \'%s\' "$val"',
    '}',
    '',
    'BASE_DIR="$HOME/.agents-in-the-office"',
    'EVENTS_DIR="$BASE_DIR/events"',
    'SESSIONS_DIR="$BASE_DIR/sessions"',
    'mkdir -p "$EVENTS_DIR" "$SESSIONS_DIR"',
    '',
    'TS_SEC=$(date +%s)',
    'TS="${TS_SEC}000"',
    'PREFIX="${SESSION_ID:0:8}"',
    'FILE="$EVENTS_DIR/${TS}-${PREFIX}-${EVENT_TYPE}.json"',
    '',
    '# Extract fields from Gemini CLI input',
    'TOOL_NAME=$(jq_field "tool_name")',
    'CWD="${GEMINI_CWD:-}"',
    '[ -z "$CWD" ] && CWD=$(jq_field "cwd")',
    'TRANSCRIPT_PATH=$(jq_field "transcript_path")',
    'PROMPT=$(jq_field "prompt")',
    'LAST_MSG=$(jq_field "prompt_response")',
    'NOTIF_MSG=$(jq_field "message")',
    'TERM_APP="${TERM_PROGRAM:-}"',
    '',
    '# Extract tool_input as raw JSON object',
    'TOOL_INPUT=$(printf \'%s\' "$INPUT" | jq -c \'.tool_input // empty\' 2>/dev/null) || TOOL_INPUT=""',
    '[ "$TOOL_INPUT" = "null" ] || [ "$TOOL_INPUT" = "" ] && TOOL_INPUT=""',
    '',
    'PAYLOAD=$(jq -n \\',
    '  --arg toolName "$TOOL_NAME" \\',
    '  --arg cwd "$CWD" \\',
    '  --arg transcriptPath "$TRANSCRIPT_PATH" \\',
    '  --arg prompt "$PROMPT" \\',
    '  --arg termProgram "$TERM_APP" \\',
    '  --arg toolInput "$TOOL_INPUT" \\',
    '  --arg lastAssistantMessage "$LAST_MSG" \\',
    '  --arg notificationMessage "$NOTIF_MSG" \\',
    "  '{",
    '    toolName: (if $toolName != "" then $toolName else null end),',
    '    cwd: (if $cwd != "" then $cwd else null end),',
    '    transcriptPath: (if $transcriptPath != "" then $transcriptPath else null end),',
    '    prompt: (if $prompt != "" then $prompt else null end),',
    '    termProgram: (if $termProgram != "" then $termProgram else null end),',
    '    toolInput: (if $toolInput != "" then ($toolInput | fromjson) else null end),',
    '    lastAssistantMessage: (if $lastAssistantMessage != "" then $lastAssistantMessage else null end),',
    '    notificationMessage: (if $notificationMessage != "" then $notificationMessage else null end)',
    "  } | with_entries(select(.value != null))')",
    '',
    '# Write event file and output empty JSON to stdout (Gemini requires JSON)',
    'jq -n \\',
    '  --arg sessionId "$SESSION_ID" \\',
    '  --argjson timestamp "$TS" \\',
    '  --arg type "$EVENT_TYPE" \\',
    '  --argjson payload "$PAYLOAD" \\',
    "  '{",
    '    sessionId: $sessionId,',
    '    timestamp: $timestamp,',
    '    type: $type,',
    '    agentType: "gemini",',
    '    payload: $payload',
    "  }' > \"$FILE\"",
    '',
    '# Session state file',
    'SESSION_FILE="$SESSIONS_DIR/${SESSION_ID}.json"',
    'if [ "$EVENT_TYPE" = "session_end" ]; then',
    '  rm -f "$SESSION_FILE"',
    'else',
    '  jq -n \\',
    '    --arg sessionId "$SESSION_ID" \\',
    '    --argjson timestamp "$TS" \\',
    '    --arg lastEventType "$EVENT_TYPE" \\',
    '    --argjson payload "$PAYLOAD" \\',
    "    '{",
    '      sessionId: $sessionId,',
    '      timestamp: $timestamp,',
    '      lastEventType: $lastEventType,',
    '      agentType: "gemini",',
    '      payload: $payload',
    "    }' > \"$SESSION_FILE\"",
    'fi',
    '',
    '# Gemini hooks must output JSON to stdout',
    'printf \'{}\\n\'',
    '',
  ].join('\n');
}

// --- Shared add/remove logic ---

async function refreshClaude(): Promise<void> {
  claudeStatus.value = 'loading';
  try {
    const home = await homeDir();
    const present = await checkMarkerInFile(
      `${home}/.claude/settings.json`,
    );
    claudeStatus.value = present ? 'present' : 'missing';
  } catch (e) {
    claudeStatus.value = 'error';
    claudeErrorMsg.value = String(e);
  }
}

async function refreshGemini(): Promise<void> {
  geminiStatus.value = 'loading';
  try {
    const home = await homeDir();
    const present = await checkMarkerInFile(
      `${home}/.gemini/settings.json`,
    );
    geminiStatus.value = present ? 'present' : 'missing';
  } catch (e) {
    geminiStatus.value = 'error';
    geminiErrorMsg.value = String(e);
  }
}

async function refresh(): Promise<void> {
  await Promise.all([refreshClaude(), refreshGemini()]);
}

async function addClaudeHooks(): Promise<void> {
  busy.value = true;
  try {
    const home = await homeDir();
    const hooksDir = `${home}/.agents-in-the-office/hooks`;
    const scriptPath = `${hooksDir}/claude-code.sh`;
    const settingsPath = `${home}/.claude/settings.json`;

    await mkdir(hooksDir, { recursive: true });
    await writeTextFile(scriptPath, buildClaudeScriptContent());
    await invoke('set_executable', { path: scriptPath });

    const settings = await readSettings(settingsPath);
    mergeHookEntries(settings, buildClaudeHookEntries(scriptPath));

    await mkdir(`${home}/.claude`, { recursive: true });
    await writeTextFile(
      settingsPath, JSON.stringify(settings, null, 2),
    );

    await refreshClaude();
  } catch (e) {
    claudeStatus.value = 'error';
    claudeErrorMsg.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function removeClaudeHooks(): Promise<void> {
  busy.value = true;
  try {
    const home = await homeDir();
    const scriptPath = `${home}/.agents-in-the-office/hooks/claude-code.sh`;
    const settingsPath = `${home}/.claude/settings.json`;

    const settings = await readSettings(settingsPath);
    removeMarkerEntries(settings);
    await writeTextFile(
      settingsPath, JSON.stringify(settings, null, 2),
    );

    try { await remove(scriptPath); } catch { /* may not exist */ }

    await refreshClaude();
  } catch (e) {
    claudeStatus.value = 'error';
    claudeErrorMsg.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function addGeminiHooks(): Promise<void> {
  busy.value = true;
  try {
    const home = await homeDir();
    const hooksDir = `${home}/.agents-in-the-office/hooks`;
    const scriptPath = `${hooksDir}/gemini-cli.sh`;
    const settingsPath = `${home}/.gemini/settings.json`;

    await mkdir(hooksDir, { recursive: true });
    await writeTextFile(scriptPath, buildGeminiScriptContent());
    await invoke('set_executable', { path: scriptPath });

    const settings = await readSettings(settingsPath);
    mergeHookEntries(settings, buildGeminiHookEntries(scriptPath));

    await mkdir(`${home}/.gemini`, { recursive: true });
    await writeTextFile(
      settingsPath, JSON.stringify(settings, null, 2),
    );

    await refreshGemini();
  } catch (e) {
    geminiStatus.value = 'error';
    geminiErrorMsg.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function removeGeminiHooks(): Promise<void> {
  busy.value = true;
  try {
    const home = await homeDir();
    const scriptPath = `${home}/.agents-in-the-office/hooks/gemini-cli.sh`;
    const settingsPath = `${home}/.gemini/settings.json`;

    const settings = await readSettings(settingsPath);
    removeMarkerEntries(settings);
    await writeTextFile(
      settingsPath, JSON.stringify(settings, null, 2),
    );

    try { await remove(scriptPath); } catch { /* may not exist */ }

    await refreshGemini();
  } catch (e) {
    geminiStatus.value = 'error';
    geminiErrorMsg.value = String(e);
  } finally {
    busy.value = false;
  }
}

onMounted(refresh);
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      @click.self="emit('close')"
    >
      <div class="bg-gray-800 rounded shadow-lg w-[440px] max-h-[90vh] flex flex-col">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h2 class="text-base font-bold text-white">Setup Agents</h2>
          <button
            class="text-gray-400 hover:text-white transition-colors text-xl leading-none"
            @click="emit('close')"
          >
            &times;
          </button>
        </div>

        <!-- Body -->
        <div class="px-5 py-4 overflow-y-auto flex-1">
          <!-- Claude Code section -->
          <div class="mb-6">
            <h3 class="text-sm font-semibold text-gray-200 mb-3">Claude Code</h3>

            <div class="flex items-center gap-2 mb-4">
              <template v-if="claudeStatus === 'loading'">
                <span class="text-gray-400 text-sm">Checking...</span>
              </template>
              <template v-else-if="claudeStatus === 'present'">
                <span class="text-green-400 text-lg">&#10003;</span>
                <span class="text-sm text-gray-300">Hooks are configured</span>
              </template>
              <template v-else-if="claudeStatus === 'missing'">
                <span class="text-red-400 text-lg">&#10007;</span>
                <span class="text-sm text-gray-300">Hooks not configured</span>
              </template>
              <template v-else>
                <span class="text-red-400 text-lg">&#10007;</span>
                <span class="text-sm text-red-400">{{ claudeErrorMsg }}</span>
              </template>
            </div>

            <p class="text-xs text-gray-400 mb-4">
              Adds hooks to <code class="text-gray-300">~/.claude/settings.json</code> that
              write event files when Claude Code uses tools.
            </p>

            <div class="flex gap-2">
              <button
                class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-white
                       text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="busy || claudeStatus === 'loading'"
                @click="addClaudeHooks"
              >
                Add Hooks
              </button>
              <button
                class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-white
                       text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="busy || claudeStatus === 'loading' || claudeStatus === 'missing'"
                @click="removeClaudeHooks"
              >
                Remove Hooks
              </button>
            </div>
          </div>

          <!-- Gemini CLI section -->
          <div class="mb-4">
            <h3 class="text-sm font-semibold text-gray-200 mb-3">Gemini CLI</h3>

            <div class="flex items-center gap-2 mb-4">
              <template v-if="geminiStatus === 'loading'">
                <span class="text-gray-400 text-sm">Checking...</span>
              </template>
              <template v-else-if="geminiStatus === 'present'">
                <span class="text-green-400 text-lg">&#10003;</span>
                <span class="text-sm text-gray-300">Hooks are configured</span>
              </template>
              <template v-else-if="geminiStatus === 'missing'">
                <span class="text-red-400 text-lg">&#10007;</span>
                <span class="text-sm text-gray-300">Hooks not configured</span>
              </template>
              <template v-else>
                <span class="text-red-400 text-lg">&#10007;</span>
                <span class="text-sm text-red-400">{{ geminiErrorMsg }}</span>
              </template>
            </div>

            <p class="text-xs text-gray-400 mb-4">
              Adds hooks to <code class="text-gray-300">~/.gemini/settings.json</code> that
              write event files when Gemini CLI uses tools.
            </p>

            <div class="flex gap-2">
              <button
                class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-white
                       text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="busy || geminiStatus === 'loading'"
                @click="addGeminiHooks"
              >
                Add Hooks
              </button>
              <button
                class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-white
                       text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="busy || geminiStatus === 'loading' || geminiStatus === 'missing'"
                @click="removeGeminiHooks"
              >
                Remove Hooks
              </button>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex justify-end px-5 py-3 border-t border-gray-700">
          <button
            class="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-white
                   text-sm transition-colors"
            @click="emit('close')"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
