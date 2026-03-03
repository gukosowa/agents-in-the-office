import type {
  AgentEvent,
  AgentType,
  NpcHandle,
} from './types';
import type { Locale } from '../stores/localeStore';
import { debugLog } from '../utils/debugLog';

export interface AgentDriver {
  agentType: AgentType;
  sessionId: string;
  displayName: string;
  attach(npc: NpcHandle): void;
  detach(): void;
  handleEvent(event: AgentEvent, locale?: Locale): void;
}

const TOOL_TO_OBJECT: Record<string, string> = {
  Bash: 'desk',
  Write: 'computer',
  Edit: 'computer',
  Read: 'books',
  Grep: 'books',
  Glob: 'books',
  WebSearch: 'books',
  WebFetch: 'computer',
};

const TOOL_BUBBLE_TEXTS: Record<
  string, Record<Locale, string>
> = {
  Bash: {
    en: 'Running a command...',
    de: 'Fuehrt Befehl aus...',
  },
  Write: { en: 'Writing code...', de: 'Schreibt Code...' },
  Edit: { en: 'Editing code...', de: 'Bearbeitet Code...' },
  Read: { en: 'Reading files...', de: 'Liest Dateien...' },
  Grep: {
    en: 'Searching code...',
    de: 'Durchsucht Code...',
  },
  Glob: {
    en: 'Looking for files...',
    de: 'Sucht Dateien...',
  },
  WebSearch: {
    en: 'Searching the web...',
    de: 'Sucht im Web...',
  },
  WebFetch: {
    en: 'Fetching a page...',
    de: 'Laedt eine Seite...',
  },
};

export abstract class BaseDriver implements AgentDriver {
  abstract agentType: AgentType;
  abstract displayName: string;

  sessionId: string;
  locale: Locale = 'en';
  protected npcHandle: NpcHandle | null = null;

  protected toolToObject: Record<string, string> = {
    ...TOOL_TO_OBJECT,
  };

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  attach(npc: NpcHandle): void {
    this.npcHandle = npc;
  }

  detach(): void {
    this.npcHandle = null;
  }

  handleEvent(event: AgentEvent, locale?: Locale): void {
    if (locale) this.locale = locale;
    if (
      event.type !== 'permission_wait'
      && event.type !== 'elicitation_wait'
    ) {
      this.clearWaitingState();
    }
    const hasHandle = this.npcHandle !== null;
    const handler = `on${event.type.replace(
      /(^|_)(\w)/g,
      (_, _p, c: string) => c.toUpperCase(),
    )}`;
    const tool = event.type === 'tool_start'
      || event.type === 'tool_end'
      ? ` tool=${String(event.payload['toolName'] ?? '?')}`
      : '';
    debugLog(
      this.sessionId, 'DRIVER_HANDLE',
      `type=${event.type} → ${handler}${tool} hasHandle=${hasHandle}`,
    );
    switch (event.type) {
      case 'session_start':
        this.onSessionStart(event);
        break;
      case 'session_end':
        this.onSessionEnd(event);
        break;
      case 'tool_start':
        this.onToolStart(event);
        break;
      case 'tool_end':
        this.onToolEnd(event);
        break;
      case 'turn_end':
        this.onTurnEnd(event);
        break;
      case 'prompt_submit':
        this.onPromptSubmit(event);
        break;
      case 'permission_wait':
        this.onPermissionWait(event);
        break;
      case 'subagent_start':
        this.onSubagentStart(event);
        break;
      case 'subagent_end':
        this.onSubagentEnd(event);
        break;
      case 'idle_notification':
        this.onIdleNotification(event);
        break;
      case 'elicitation_wait':
        this.onElicitationWait(event);
        break;
      case 'auth_success':
        this.onAuthSuccess(event);
        break;
      case 'worktree_create':
        this.onWorktreeCreate(event);
        break;
      case 'worktree_remove':
        this.onWorktreeRemove(event);
        break;
      case 'teammate_idle':
        this.onTeammateIdle(event);
        break;
      case 'task_completed':
        this.onTaskCompleted(event);
        break;
    }
  }

  protected clearWaitingState(): void {
    this.npcHandle?.setWaitingForApproval(false);
  }

  protected onSessionStart(_event: AgentEvent): void {
    // Default: no-op (NPC already spawned by store)
  }

  protected onSessionEnd(_event: AgentEvent): void {
    this.npcHandle?.leaveRoom();
  }

  protected onToolStart(event: AgentEvent): void {
    const toolName = String(
      event.payload['toolName'] ?? '',
    );
    const objectType =
      this.toolToObject[toolName] ?? 'desk';
    this.npcHandle?.gotoObject(objectType);

    const entry = TOOL_BUBBLE_TEXTS[toolName];
    const bubble = entry
      ? entry[this.locale]
      : (this.locale === 'de'
        ? `Nutzt ${toolName}...`
        : `Using ${toolName}...`);
    this.npcHandle?.showBubble(bubble, 'thought');
  }

  protected onToolEnd(_event: AgentEvent): void {
    // Default: no-op
  }

  protected onTurnEnd(_event: AgentEvent): void {
    // NPC stays at current position (idle) after turn ends.
    // No-op: the NPC is already idle or will become idle
    // when its current action finishes.
  }

  protected onPromptSubmit(_event: AgentEvent): void {
    this.npcHandle?.showBubble('Got it!', 'speech');
  }

  protected onPermissionWait(_event: AgentEvent): void {
    // Default: no-op (overridden by specific drivers)
  }

  protected onSubagentStart(_event: AgentEvent): void {
    // Default: no-op (overridden by specific drivers)
  }

  protected onSubagentEnd(_event: AgentEvent): void {
    // Default: no-op (overridden by specific drivers)
  }

  protected onIdleNotification(_event: AgentEvent): void {
    // Default: no-op
  }

  protected onElicitationWait(_event: AgentEvent): void {
    // Default: no-op
  }

  protected onAuthSuccess(_event: AgentEvent): void {
    // Default: no-op
  }

  protected onWorktreeCreate(_event: AgentEvent): void {
    // Default: no-op
  }

  protected onWorktreeRemove(_event: AgentEvent): void {
    // Default: no-op
  }

  protected onTeammateIdle(_event: AgentEvent): void {
    // Default: no-op
  }

  protected onTaskCompleted(_event: AgentEvent): void {
    // Default: no-op
  }
}
