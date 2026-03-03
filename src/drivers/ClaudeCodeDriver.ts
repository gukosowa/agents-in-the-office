import type { AgentEvent, AgentType } from './types';
import type { Locale } from '../stores/localeStore';
import { BaseDriver } from './AgentDriver';
import { basename, truncate } from './activityMessages';

interface BubblePair {
  walking: string;
  arrived: string;
}

type ContextFn = (
  l: Locale,
  file: string | null,
  pattern: string | null,
  command: string | null,
  query: string | null,
) => BubblePair | null;

const CONTEXTUAL_EXTRACTORS: Record<string, ContextFn> = {
  Read: (l, file) =>
    file
      ? {
        walking: l === 'de'
          ? `Will lesen: ${file}`
          : `Going to read ${file}`,
        arrived: l === 'de'
          ? `Liest ${file}...`
          : `Reading ${file}...`,
      }
      : null,
  Edit: (l, file) =>
    file
      ? {
        walking: l === 'de'
          ? `Will bearbeiten: ${file}`
          : `Going to edit ${file}`,
        arrived: l === 'de'
          ? `Bearbeitet ${file}...`
          : `Editing ${file}...`,
      }
      : null,
  Write: (l, file) =>
    file
      ? {
        walking: l === 'de'
          ? `Will schreiben: ${file}`
          : `Going to write ${file}`,
        arrived: l === 'de'
          ? `Schreibt ${file}...`
          : `Writing ${file}...`,
      }
      : null,
  Grep: (l, _f, pattern) =>
    pattern
      ? {
        walking: l === 'de'
          ? `Will suchen: '${pattern}'`
          : `Going to search '${pattern}'`,
        arrived: l === 'de'
          ? `Sucht '${pattern}'...`
          : `Searching '${pattern}'...`,
      }
      : null,
  Glob: (l, _f, pattern) =>
    pattern
      ? {
        walking: l === 'de'
          ? `Sucht ${pattern}...`
          : `Finding ${pattern}...`,
        arrived: l === 'de'
          ? `Sucht ${pattern}...`
          : `Finding ${pattern}...`,
      }
      : null,
  Bash: (l, _f, _p, command) =>
    command
      ? {
        walking: l === 'de'
          ? `Will ausfuehren: ${command}`
          : `Going to run: ${command}`,
        arrived: `$ ${command}`,
      }
      : null,
  WebSearch: (l, _f, _p, _c, query) =>
    query
      ? {
        walking: l === 'de'
          ? `Will suchen: '${query}'`
          : `Going to search '${query}'`,
        arrived: l === 'de'
          ? `Sucht '${query}'...`
          : `Searching '${query}'...`,
      }
      : null,
  Task: (l) => ({
    walking: l === 'de'
      ? 'Delegiere Unteraufgabe...'
      : 'Delegating sub-task...',
    arrived: l === 'de'
      ? 'Delegiert Unteraufgabe...'
      : 'Delegating sub-task...',
  }),
};

export class ClaudeCodeDriver extends BaseDriver {
  agentType: AgentType = 'claude_code';
  displayName = 'Claude Code';

  constructor(sessionId: string) {
    super(sessionId);
    this.toolToObject = {
      ...this.toolToObject,
      Task: 'desk',
      Skill: 'computer',
    };
  }

  protected override onToolStart(event: AgentEvent): void {
    const toolName = String(
      event.payload['toolName'] ?? '',
    );

    const objectType = toolName.startsWith('mcp__')
      ? 'computer'
      : (this.toolToObject[toolName] ?? 'desk');

    const pair = this.toolBubblePair(
      toolName, event.payload,
    );

    this.npcHandle?.setToolBubble(
      pair.walking, pair.arrived,
    );
    this.npcHandle?.gotoObject(objectType);
  }

  protected override onPermissionWait(
    _event: AgentEvent,
  ): void {
    this.npcHandle?.setWaitingForApproval(true);
    const text = this.locale === 'de'
      ? 'Warte auf Erlaubnis...'
      : 'Waiting for approval...';
    this.npcHandle?.showBubble(text, 'speech', true);
  }

  protected override onToolEnd(_event: AgentEvent): void {
    const thoughts = this.locale === 'de'
      ? ['Hmm...', 'Mal sehen...', 'Okay...', 'So...']
      : ['Hmm...', 'Let me see...', 'Okay...', 'Right...'];
    const pick =
      thoughts[Math.floor(Math.random() * thoughts.length)]
      ?? thoughts[0]!;
    this.npcHandle?.showBubble(pick, 'thought');
  }

  protected override onTurnEnd(event: AgentEvent): void {
    const msg = event.payload['lastAssistantMessage'];
    if (typeof msg === 'string' && msg.length > 0) {
      this.npcHandle?.showBubble(
        truncate(msg, 50), 'speech',
      );
      return;
    }
    const text = this.locale === 'de'
      ? 'Denkt nach...'
      : 'Thinking...';
    this.npcHandle?.showBubble(text, 'thought');
  }

  protected override onSubagentEnd(
    event: AgentEvent,
  ): void {
    const msg = event.payload['lastAssistantMessage'];
    if (typeof msg === 'string' && msg.length > 0) {
      this.npcHandle?.showBubble(
        truncate(msg, 50), 'speech',
      );
      return;
    }
    const text = this.locale === 'de'
      ? 'Unteraufgabe erledigt'
      : 'Sub-task complete';
    this.npcHandle?.showBubble(text, 'thought');
  }

  protected override onSubagentStart(
    _event: AgentEvent,
  ): void {
    const text = this.locale === 'de'
      ? 'Delegiere Unteraufgabe...'
      : 'Delegating sub-task...';
    this.npcHandle?.showBubble(text, 'thought');
  }

  protected override onIdleNotification(
    _event: AgentEvent,
  ): void {
    this.npcHandle?.wander();
    const text = this.locale === 'de'
      ? 'Warte auf Eingabe...'
      : 'Waiting for input...';
    this.npcHandle?.showBubble(text, 'thought');
  }

  protected override onElicitationWait(
    _event: AgentEvent,
  ): void {
    this.npcHandle?.setWaitingForApproval(true);
    const text = this.locale === 'de'
      ? 'Warte auf deine Antwort...'
      : 'Waiting for your answer...';
    this.npcHandle?.showBubble(text, 'speech', true);
  }

  protected override onAuthSuccess(
    _event: AgentEvent,
  ): void {
    const text = this.locale === 'de'
      ? 'Authentifiziert!'
      : 'Authenticated!';
    this.npcHandle?.showBubble(text, 'speech');
  }

  protected override onWorktreeCreate(
    _event: AgentEvent,
  ): void {
    const text = this.locale === 'de'
      ? 'Richte Workspace ein...'
      : 'Setting up workspace...';
    this.npcHandle?.showBubble(text, 'thought');
  }

  protected override onWorktreeRemove(
    _event: AgentEvent,
  ): void {
    const text = this.locale === 'de'
      ? 'Räume Workspace auf...'
      : 'Cleaning up workspace...';
    this.npcHandle?.showBubble(text, 'thought');
  }

  protected override onTeammateIdle(
    _event: AgentEvent,
  ): void {
    const text = this.locale === 'de'
      ? 'Teamkollege wartet...'
      : 'Teammate is idle...';
    this.npcHandle?.showBubble(text, 'thought');
  }

  protected override onTaskCompleted(
    event: AgentEvent,
  ): void {
    const subject = typeof event.payload['taskSubject'] === 'string'
      ? event.payload['taskSubject']
      : null;
    const text = subject
      ? (this.locale === 'de'
        ? `Erledigt! ${truncate(subject, 40)}`
        : `Done! ${truncate(subject, 40)}`)
      : (this.locale === 'de'
        ? 'Aufgabe erledigt!'
        : 'Task complete!');
    this.npcHandle?.showBubble(text, 'speech');
  }

  private toolBubblePair(
    toolName: string,
    payload: Record<string, unknown>,
  ): BubblePair {
    const ctx = this.extractContext(toolName, payload);
    if (ctx) return ctx;
    const text = this.staticBubbleText(toolName);
    return { walking: text, arrived: text };
  }

  private extractContext(
    toolName: string,
    payload: Record<string, unknown>,
  ): BubblePair | null {
    const raw = payload['toolInput'];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      return null;
    const input = raw as Record<string, unknown>;
    const l = this.locale;

    const filePath = typeof input['file_path'] === 'string'
      ? basename(input['file_path'])
      : null;
    const pattern = typeof input['pattern'] === 'string'
      ? truncate(input['pattern'], 20)
      : null;
    const command = typeof input['command'] === 'string'
      ? truncate(input['command'], 20)
      : null;
    const query = typeof input['query'] === 'string'
      ? truncate(input['query'], 20)
      : null;

    return CONTEXTUAL_EXTRACTORS[toolName]?.(
      l, filePath, pattern, command, query,
    ) ?? this.mcpPair(toolName, l);
  }

  private mcpPair(
    toolName: string,
    l: Locale,
  ): BubblePair | null {
    if (!toolName.startsWith('mcp__')) return null;
    const service = toolName.split('__')[1] ?? 'service';
    const text = l === 'de'
      ? `Nutzt ${service}...`
      : `Using ${service}...`;
    return { walking: text, arrived: text };
  }

  private staticBubbleText(toolName: string): string {
    const l = this.locale;
    if (toolName.startsWith('mcp__')) {
      return this.mcpPair(toolName, l)?.walking ?? '';
    }
    const texts: Record<string, Record<Locale, string>> = {
      Bash: {
        en: 'Running a command...',
        de: 'Fuehrt Befehl aus...',
      },
      Write: {
        en: 'Writing code...',
        de: 'Schreibt Code...',
      },
      Edit: {
        en: 'Editing code...',
        de: 'Bearbeitet Code...',
      },
      Read: {
        en: 'Reading files...',
        de: 'Liest Dateien...',
      },
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
      Task: {
        en: 'Thinking it through...',
        de: 'Denkt nach...',
      },
      Skill: {
        en: 'Using a skill...',
        de: 'Nutzt einen Skill...',
      },
    };
    const entry = texts[toolName];
    if (entry) return entry[l];
    return l === 'de'
      ? `Nutzt ${toolName}...`
      : `Using ${toolName}...`;
  }
}
