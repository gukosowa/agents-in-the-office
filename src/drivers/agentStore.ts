import { defineStore } from 'pinia';
import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { AgentDriver } from './AgentDriver';
import type {
  AgentEvent,
  AgentEventType,
  AgentType,
  ActivityMessage,
  NpcHandle,
} from './types';
import type { Locale } from '../stores/localeStore';
import { ClaudeCodeDriver } from './ClaudeCodeDriver';
import { GeminiCliDriver } from './GeminiCliDriver';
import {
  formatActivityMessage,
  truncate,
} from './activityMessages';
import { debugLog } from '../utils/debugLog';
import {
  persistEvent,
  getSessionEvents,
  pruneSessionEvents,
} from '../utils/db';
import { useSoundStore } from '../stores/soundStore';

const ACTIVITY_LOG_MAX = 100;

export type AgentStatus = 'idle' | 'working' | 'waiting_approval';

export interface AgentSession {
  driver: AgentDriver;
  npcId: string | null;
  cwd: string | null;
  termProgram: string | null;
  transcriptPath: string | null;
  prompt: string | null;
  latestPrompt: string | null;
  nameTag: string | null;
  pendingSubagentPrompt: string | null;
  dismissing: boolean;
  status: AgentStatus;
  startedAt: number;
  lastEventAt: number;
  activityLog: ActivityMessage[];
  parentSessionId?: string;
  subagentIds: string[];
}

export type HandleEventResult = {
  action: 'spawn' | 'despawn' | 'respawn' | 'update' | 'cancel_dismiss';
  sessionId: string;
};

const STALE_TIMEOUT_MS = 2 * 60 * 1000;

function createDriverForAgent(
  event: AgentEvent,
): AgentDriver {
  switch (event.agentType) {
    case 'claude_code':
      return new ClaudeCodeDriver(event.sessionId);
    case 'gemini':
      return new GeminiCliDriver(event.sessionId);
    default:
      return new ClaudeCodeDriver(event.sessionId);
  }
}

function statusFromEvent(type: AgentEventType): AgentStatus {
  switch (type) {
    case 'permission_wait':
    case 'elicitation_wait':
      return 'waiting_approval';
    case 'turn_end':
    case 'session_start':
    case 'idle_notification':
      return 'idle';
    default:
      return 'working';
  }
}

export const useAgentStore = defineStore('agent', () => {
  const sessions = ref(
    new Map<string, AgentSession>(),
  );

  function createSession(
    sessionId: string,
    event: AgentEvent,
  ): void {
    const driver = createDriverForAgent(event);
    const cwd = typeof event.payload.cwd === 'string'
      ? event.payload.cwd
      : null;
    const termProgram =
      typeof event.payload.termProgram === 'string'
        ? event.payload.termProgram
        : null;
    const transcriptPath =
      typeof event.payload.transcriptPath === 'string'
        ? event.payload.transcriptPath
        : null;
    sessions.value.set(sessionId, {
      driver,
      npcId: null,
      cwd,
      termProgram,
      transcriptPath,
      prompt: null,
      latestPrompt: null,
      nameTag: null,
      pendingSubagentPrompt: null,
      dismissing: false,
      status: 'idle',
      startedAt: event.timestamp,
      lastEventAt: event.timestamp,
      activityLog: [],
      subagentIds: [],
    });
  }

  function registerNpc(
    sessionId: string,
    npcId: string,
    handle: NpcHandle,
  ): void {
    const session = sessions.value.get(sessionId);
    if (!session) return;
    session.npcId = npcId;
    session.driver.attach(handle);
  }

  function removeSession(sessionId: string): void {
    sessions.value.delete(sessionId);
  }

  function pushActivity(
    session: AgentSession,
    event: AgentEvent,
    locale: Locale,
  ): void {
    // For subagent sessions, route activity to the parent's log with [sub] prefix
    if (session.parentSessionId) {
      const parent = sessions.value.get(session.parentSessionId);
      if (parent) {
        const msg = formatActivityMessage(event, locale, '[sub]');
        if (!msg) return;
        parent.activityLog.push(msg);
        if (parent.activityLog.length > ACTIVITY_LOG_MAX) {
          parent.activityLog.shift();
        }
        return;
      }
    }
    const msg = formatActivityMessage(event, locale);
    if (!msg) return;
    session.activityLog.push(msg);
    if (session.activityLog.length > ACTIVITY_LOG_MAX) {
      session.activityLog.shift();
    }
  }

  async function replayActivityLog(
    sessionId: string,
    locale: Locale,
  ): Promise<ActivityMessage[]> {
    const events = await getSessionEvents(sessionId);
    return events
      .map(event => formatActivityMessage(event, locale))
      .filter((msg): msg is ActivityMessage => msg !== null);
  }

  async function spawnSubagent(
    parentSessionId: string,
    nativeAgentId: string,
    parentTranscriptPath: string | null,
    taskPrompt: string | null = null,
  ): Promise<HandleEventResult> {
    const subagentSessionId =
      `${parentSessionId.slice(0, 8)}-sub-${nativeAgentId}`;

    const parent = sessions.value.get(parentSessionId);
    const parentType = parent?.driver.agentType ?? 'claude_code';
    const subDriver = createDriverForAgent({
      sessionId: subagentSessionId,
      timestamp: Date.now(),
      type: 'session_start',
      agentType: parentType,
      payload: {},
    });
    sessions.value.set(subagentSessionId, {
      driver: subDriver,
      npcId: null,
      cwd: null,
      termProgram: null,
      transcriptPath: null,
      prompt: taskPrompt ?? null,
      latestPrompt: null,
      nameTag: null,
      pendingSubagentPrompt: null,
      dismissing: false,
      status: 'working',
      startedAt: Date.now(),
      lastEventAt: Date.now(),
      activityLog: [],
      parentSessionId,
      subagentIds: [],
    });

    if (parent) {
      parent.subagentIds.push(subagentSessionId);
    }

    if (parentTranscriptPath) {
      const parentBase =
        parentTranscriptPath.replace(/\.jsonl$/, '');
      const transcriptPath =
        `${parentBase}/subagents/agent-${nativeAgentId}.jsonl`;
      await invoke('start_transcript_poll', {
        subagentId: subagentSessionId,
        sessionId: subagentSessionId,
        transcriptPath,
      });
    }

    return { action: 'spawn', sessionId: subagentSessionId };
  }

  async function despawnSubagent(
    subagentSessionId: string,
  ): Promise<HandleEventResult> {
    void invoke('stop_transcript_poll', {
      subagentId: subagentSessionId,
    });

    const subSession = sessions.value.get(subagentSessionId);
    if (subSession?.parentSessionId) {
      const parent = sessions.value.get(subSession.parentSessionId);
      if (parent) {
        parent.subagentIds = parent.subagentIds.filter(
          id => id !== subagentSessionId,
        );
      }
    }

    const agentType = subSession?.driver.agentType ?? 'claude_code';
    const results = await handleEvent({
      sessionId: subagentSessionId,
      timestamp: Date.now(),
      type: 'session_end',
      agentType,
      payload: { reason: 'subagent_ended' },
    });
    return results[0] ?? { action: 'despawn', sessionId: subagentSessionId };
  }

  async function handleEvent(
    event: AgentEvent,
    locale: Locale = 'en',
  ): Promise<HandleEventResult[]> {
    const { sessionId } = event;

    void persistEvent(event);
    void useSoundStore().playForEvent(event);

    if (event.type === 'session_start') {
      debugLog(
        sessionId, 'STORE_ROUTE',
        'path=new_session',
      );
      void pruneSessionEvents(sessionId, 1000);
      createSession(sessionId, event);
      const session = sessions.value.get(sessionId)!;
      pushActivity(session, event, locale);
      return [{ action: 'spawn', sessionId }];
    }

    const session = sessions.value.get(sessionId);

    if (!session && event.type !== 'session_end') {
      debugLog(
        sessionId, 'STORE_ROUTE',
        'path=reconnect (no session, not session_end)',
      );
      createSession(sessionId, event);
      const reconnected = sessions.value.get(sessionId)!;
      reconnected.driver.handleEvent(event, locale);
      pushActivity(reconnected, event, locale);
      return [{ action: 'spawn', sessionId }];
    }

    if (event.type === 'session_end') {
      debugLog(
        sessionId, 'STORE_ROUTE',
        `path=session_end hasSession=${!!session}`,
      );
      if (session) {
        session.dismissing = false;
        // Despawn all subagents before the parent exits
        const subIds = [...session.subagentIds];
        await Promise.all(subIds.map(subId => despawnSubagent(subId)));
        session.driver.handleEvent(event, locale);
        session.driver.detach();
        session.npcId = null;
        session.lastEventAt = event.timestamp;
        pushActivity(session, event, locale);
      }
      return [{ action: 'despawn', sessionId }];
    }

    if (session) {
      if (event.type === 'subagent_start') {
        const agentId =
          typeof event.payload.agentId === 'string'
            ? event.payload.agentId
            : null;

        const taskPrompt = session.pendingSubagentPrompt;
        session.pendingSubagentPrompt = null;

        session.driver.handleEvent(event, locale);
        session.lastEventAt = event.timestamp;
        const displayEvent = taskPrompt
          ? { ...event, payload: { ...event.payload, taskPrompt } }
          : event;
        pushActivity(session, displayEvent, locale);
        debugLog(
          sessionId, 'STORE_ROUTE',
          `path=subagent_start agentId=${agentId ?? 'null'} taskPrompt=${taskPrompt ?? 'null'}`,
        );

        if (agentId) {
          const parentTranscriptPath =
            session.transcriptPath
            ?? (typeof event.payload.transcriptPath === 'string'
              ? event.payload.transcriptPath : null);
          const subResult = await spawnSubagent(
            sessionId, agentId, parentTranscriptPath, taskPrompt,
          );
          return [{ action: 'update', sessionId }, subResult];
        }
        return [{ action: 'update', sessionId }];
      }

      if (event.type === 'subagent_end') {
        const agentId =
          typeof event.payload.agentId === 'string'
            ? event.payload.agentId
            : null;

        session.driver.handleEvent(event, locale);
        session.lastEventAt = event.timestamp;
        pushActivity(session, event, locale);
        debugLog(
          sessionId, 'STORE_ROUTE',
          `path=subagent_end agentId=${agentId ?? 'null'}`,
        );

        if (agentId) {
          const subSessionId = session.subagentIds.find(
            id => id.endsWith(`-sub-${agentId}`),
          );
          if (subSessionId) {
            const despawnResult = await despawnSubagent(subSessionId);
            return [{ action: 'update', sessionId }, despawnResult];
          }
        }
        return [{ action: 'update', sessionId }];
      }

      const needsRespawn = !session.npcId && !session.parentSessionId;
      const hasHandle = !!session.npcId;
      debugLog(
        sessionId, 'STORE_ROUTE',
        `path=normal npcId=${session.npcId ?? 'null'} hasHandle=${hasHandle}`,
      );
      session.driver.handleEvent(event, locale);
      session.lastEventAt = event.timestamp;
      pushActivity(session, event, locale);
      if (
        !session.cwd
        && typeof event.payload.cwd === 'string'
      ) {
        session.cwd = event.payload.cwd;
      }
      if (
        !session.termProgram
        && typeof event.payload.termProgram === 'string'
      ) {
        session.termProgram = event.payload.termProgram;
      }
      if (
        !session.transcriptPath
        && typeof event.payload.transcriptPath === 'string'
      ) {
        session.transcriptPath = event.payload.transcriptPath;
      }
      if (
        event.type === 'prompt_submit'
        && typeof event.payload.prompt === 'string'
      ) {
        if (!session.prompt) {
          session.prompt = event.payload.prompt;
        }
        session.latestPrompt = event.payload.prompt;
      }
      if (event.type === 'tool_start') {
        const toolName = String(event.payload.toolName ?? '');
        if (toolName === 'Task' || toolName === 'Agent') {
          const input = event.payload.toolInput;
          if (input && typeof input === 'object' && !Array.isArray(input)) {
            const inp = input as Record<string, unknown>;
            const desc = typeof inp['description'] === 'string'
              ? inp['description'] : null;
            const prompt = typeof inp['prompt'] === 'string'
              ? inp['prompt'] : null;
            session.pendingSubagentPrompt = desc ?? prompt;
          }
        }
      }
      session.status = statusFromEvent(event.type);
      if (session.dismissing) {
        session.dismissing = false;
        if (session.npcId) {
          return [{ action: 'cancel_dismiss', sessionId }];
        }
        // NPC already exited — needsRespawn handles it
      }
      if (needsRespawn) {
        return [{ action: 'respawn', sessionId }];
      }
    }
    return [{ action: 'update', sessionId }];
  }

  async function checkStale(): Promise<HandleEventResult[]> {
    const now = Date.now();
    const staleIds: { sessionId: string; agentType: AgentType }[] = [];
    const orphanIds: { sessionId: string; agentType: AgentType }[] = [];

    for (const [sessionId, session] of sessions.value) {
      if (session.parentSessionId) {
        if (!sessions.value.has(session.parentSessionId)) {
          orphanIds.push({
            sessionId,
            agentType: session.driver.agentType,
          });
        }
        continue;
      }
      if (now - session.lastEventAt > STALE_TIMEOUT_MS) {
        staleIds.push({
          sessionId,
          agentType: session.driver.agentType,
        });
      }
    }

    const orphanResults = await Promise.all(
      orphanIds.map(({ sessionId }) =>
        despawnSubagent(sessionId),
      ),
    );

    const staleResults = await Promise.all(
      staleIds.map(({ sessionId, agentType }) =>
        handleEvent({
          sessionId,
          timestamp: now,
          type: 'session_end',
          agentType,
          payload: { reason: 'stale' },
        }),
      ),
    );
    return [...orphanResults, ...staleResults.flat()];
  }

  function getSessionCwd(
    sessionId: string,
  ): string | null {
    return sessions.value.get(sessionId)?.cwd ?? null;
  }

  function getSessionTermProgram(
    sessionId: string,
  ): string | null {
    return (
      sessions.value.get(sessionId)?.termProgram ?? null
    );
  }

  async function ensurePromptFields(
    sessionId: string,
  ): Promise<void> {
    const session = sessions.value.get(sessionId);
    if (!session || session.parentSessionId) return;

    const userMessages = session.activityLog.filter(
      m => m.side === 'user',
    );
    if (userMessages.length > 0) {
      const first = userMessages[0]!;
      if (!session.prompt) {
        session.prompt = first.fullText ?? first.text;
      }
      const last = userMessages[userMessages.length - 1]!;
      if (!session.latestPrompt) {
        session.latestPrompt = last.fullText ?? last.text;
      }
      return;
    }

    if (!session.transcriptPath) return;
    let prompt: string | null = null;
    try {
      prompt = await invoke<string | null>(
        'read_initial_prompt',
        { transcriptPath: session.transcriptPath },
      );
    } catch {
      return;
    }
    if (!prompt) return;

    if (!session.prompt) session.prompt = prompt;
    if (!session.latestPrompt) session.latestPrompt = prompt;
    session.activityLog.unshift({
      id: crypto.randomUUID(),
      timestamp: session.startedAt,
      side: 'user',
      text: truncate(prompt, 200),
      fullText: prompt,
    });
  }

  const FILLER_RE = /^(?:please|can you|could you|i want(?: you)? to|i need(?: you)? to|let'?s|hey|hi|hello|ok|okay|sure)\s+/i;

  function defaultNameTag(prompt: string): string {
    let text = prompt.trim();
    let prev = '';
    while (text !== prev) {
      prev = text;
      text = text.replace(FILLER_RE, '');
    }
    if (!text) text = prompt.trim();
    const words = text.split(/\s+/).slice(0, 4);
    const raw = words.join(' ');
    return raw.length > 18 ? `${raw.slice(0, 15)}...` : raw;
  }

  function generateNameTag(sessionId: string): void {
    const session = sessions.value.get(sessionId);
    if (!session || session.parentSessionId) return;
    if (!session.prompt) return;
    if (session.nameTag) return;
    session.nameTag = defaultNameTag(session.prompt);
  }

  function detachAllNpcs(): string[] {
    const sessionIds: string[] = [];
    for (const [sessionId, session] of sessions.value) {
      if (session.npcId) {
        session.driver.detach();
        session.npcId = null;
        sessionIds.push(sessionId);
      }
    }
    return sessionIds;
  }

  return {
    sessions,
    handleEvent,
    replayActivityLog,
    spawnSubagent,
    despawnSubagent,
    createSession,
    registerNpc,
    removeSession,
    checkStale,
    getSessionCwd,
    getSessionTermProgram,
    ensurePromptFields,
    generateNameTag,
    detachAllNpcs,
  };
});
