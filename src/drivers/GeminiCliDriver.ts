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

const GEMINI_TOOL_TO_OBJECT: Record<string, string> = {
  read_file: 'books',
  write_file: 'computer',
  replace: 'computer',
  edit_file: 'computer',
  run_shell_command: 'desk',
  search_files: 'books',
  list_files: 'books',
  web_search: 'books',
  web_fetch: 'computer',
};

const CONTEXTUAL_EXTRACTORS: Record<string, ContextFn> = {
  read_file: (l, file) =>
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
  write_file: (l, file) =>
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
  replace: (l, file) =>
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
  edit_file: (l, file) =>
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
  search_files: (l, _f, pattern) =>
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
  list_files: (l, _f, pattern) =>
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
  run_shell_command: (l, _f, _p, command) =>
    command
      ? {
        walking: l === 'de'
          ? `Will ausfuehren: ${command}`
          : `Going to run: ${command}`,
        arrived: `$ ${command}`,
      }
      : null,
  web_search: (l, _f, _p, _c, query) =>
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
};

const STATIC_TEXTS: Record<
  string, Record<Locale, string>
> = {
  read_file: {
    en: 'Reading files...',
    de: 'Liest Dateien...',
  },
  write_file: {
    en: 'Writing code...',
    de: 'Schreibt Code...',
  },
  replace: {
    en: 'Editing code...',
    de: 'Bearbeitet Code...',
  },
  edit_file: {
    en: 'Editing code...',
    de: 'Bearbeitet Code...',
  },
  run_shell_command: {
    en: 'Running a command...',
    de: 'Fuehrt Befehl aus...',
  },
  search_files: {
    en: 'Searching code...',
    de: 'Durchsucht Code...',
  },
  list_files: {
    en: 'Looking for files...',
    de: 'Sucht Dateien...',
  },
  web_search: {
    en: 'Searching the web...',
    de: 'Sucht im Web...',
  },
  web_fetch: {
    en: 'Fetching a page...',
    de: 'Laedt eine Seite...',
  },
};

export class GeminiCliDriver extends BaseDriver {
  agentType: AgentType = 'gemini';
  displayName = 'Gemini CLI';

  constructor(sessionId: string) {
    super(sessionId);
    this.toolToObject = {
      ...GEMINI_TOOL_TO_OBJECT,
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

  protected override onIdleNotification(
    _event: AgentEvent,
  ): void {
    this.npcHandle?.wander();
    const text = this.locale === 'de'
      ? 'Warte auf Eingabe...'
      : 'Waiting for input...';
    this.npcHandle?.showBubble(text, 'thought');
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

    const filePath =
      typeof input['file_path'] === 'string'
        ? basename(input['file_path'])
        : typeof input['path'] === 'string'
          ? basename(input['path'])
          : null;
    const pattern =
      typeof input['pattern'] === 'string'
        ? truncate(input['pattern'], 20)
        : typeof input['regex'] === 'string'
          ? truncate(input['regex'], 20)
          : null;
    const command =
      typeof input['command'] === 'string'
        ? truncate(input['command'], 20)
        : null;
    const query =
      typeof input['query'] === 'string'
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
    const entry = STATIC_TEXTS[toolName];
    if (entry) return entry[l];
    return l === 'de'
      ? `Nutzt ${toolName}...`
      : `Using ${toolName}...`;
  }
}
