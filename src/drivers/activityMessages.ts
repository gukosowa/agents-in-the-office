import type { Locale } from '../stores/localeStore';
import type { AgentEvent, ActivityMessage } from './types';

type LabelMap = Record<Locale, string>;

const EVENT_LABELS: Record<string, LabelMap & { side: 'agent' | 'user' }> = {
  session_start: {
    en: 'Session started',
    de: 'Sitzung gestartet',
    side: 'agent',
  },
  session_end: {
    en: 'Session ended',
    de: 'Sitzung beendet',
    side: 'agent',
  },
  turn_end: {
    en: 'Thinking...',
    de: 'Nachdenken...',
    side: 'agent',
  },
  permission_wait: {
    en: 'Waiting for permission',
    de: 'Warte auf Erlaubnis',
    side: 'user',
  },
  subagent_start: {
    en: 'Started sub-task',
    de: 'Sub-Aufgabe gestartet',
    side: 'agent',
  },
  subagent_end: {
    en: 'Sub-task complete',
    de: 'Sub-Aufgabe abgeschlossen',
    side: 'agent',
  },
  idle_notification: {
    en: 'Agent idle',
    de: 'Agent wartet',
    side: 'agent',
  },
  elicitation_wait: {
    en: 'Waiting for answer',
    de: 'Warte auf Antwort',
    side: 'user',
  },
  auth_success: {
    en: 'Authenticated',
    de: 'Authentifiziert',
    side: 'agent',
  },
  worktree_create: {
    en: 'Setting up workspace',
    de: 'Workspace wird eingerichtet',
    side: 'agent',
  },
  worktree_remove: {
    en: 'Cleaning up workspace',
    de: 'Workspace wird aufgeräumt',
    side: 'agent',
  },
  teammate_idle: {
    en: 'Teammate idle',
    de: 'Teamkollege wartet',
    side: 'agent',
  },
  task_completed: {
    en: 'Task completed',
    de: 'Aufgabe abgeschlossen',
    side: 'agent',
  },
};

const TOOL_LABELS: Record<string, LabelMap> = {
  // Claude Code tools
  Bash: { en: 'Running a command', de: 'Führt Befehl aus' },
  Read: { en: 'Reading files', de: 'Liest Dateien' },
  Edit: { en: 'Editing code', de: 'Bearbeitet Code' },
  Write: { en: 'Writing code', de: 'Schreibt Code' },
  Grep: { en: 'Searching code', de: 'Durchsucht Code' },
  Glob: { en: 'Looking for files', de: 'Sucht Dateien' },
  WebSearch: {
    en: 'Searching the web',
    de: 'Sucht im Web',
  },
  WebFetch: {
    en: 'Fetching a page',
    de: 'Lädt eine Seite',
  },
  Task: {
    en: 'Thinking it through',
    de: 'Denkt nach',
  },
  Skill: {
    en: 'Using a skill',
    de: 'Nutzt einen Skill',
  },
  // Gemini CLI tools
  run_shell_command: {
    en: 'Running a command',
    de: 'Führt Befehl aus',
  },
  read_file: { en: 'Reading files', de: 'Liest Dateien' },
  edit_file: { en: 'Editing code', de: 'Bearbeitet Code' },
  replace: { en: 'Editing code', de: 'Bearbeitet Code' },
  write_file: { en: 'Writing code', de: 'Schreibt Code' },
  search_files: {
    en: 'Searching code',
    de: 'Durchsucht Code',
  },
  list_files: {
    en: 'Looking for files',
    de: 'Sucht Dateien',
  },
  web_search: {
    en: 'Searching the web',
    de: 'Sucht im Web',
  },
  web_fetch: {
    en: 'Fetching a page',
    de: 'Lädt eine Seite',
  },
};

export function basename(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] ?? filePath;
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}

function getToolInput(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const input = payload['toolInput'];
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return null;
}

function formatToolLabel(
  toolName: string,
  locale: Locale,
  payload: Record<string, unknown>,
): string {
  const input = getToolInput(payload);

  const mcpPrefix = 'mcp__';
  if (toolName.startsWith(mcpPrefix)) {
    const service = toolName.split('__')[1] ?? 'service';
    return locale === 'de'
      ? `Nutzt ${service}...`
      : `Using ${service}...`;
  }

  const label = TOOL_LABELS[toolName];
  let text = label
    ? label[locale]
    : (locale === 'de'
      ? `Nutzt ${toolName}`
      : `Using ${toolName}`);

  if (input) {
    const filePath =
      typeof input['file_path'] === 'string'
        ? input['file_path']
        : typeof input['path'] === 'string'
          ? input['path']
          : null;
    const command =
      typeof input['command'] === 'string'
        ? input['command']
        : null;
    const pattern =
      typeof input['pattern'] === 'string'
        ? input['pattern']
        : typeof input['regex'] === 'string'
          ? input['regex']
          : null;

    const FILE_TOOLS = new Set([
      'Read', 'Edit', 'Write',
      'read_file', 'edit_file', 'write_file', 'replace',
    ]);
    const SHELL_TOOLS = new Set([
      'Bash', 'run_shell_command',
    ]);
    const SEARCH_TOOLS = new Set([
      'Grep', 'search_files',
    ]);

    if (FILE_TOOLS.has(toolName) && filePath) {
      text += ` · ${basename(filePath)}`;
    } else if (SHELL_TOOLS.has(toolName) && command) {
      text += ` · ${truncate(command, 30)}`;
    } else if (SEARCH_TOOLS.has(toolName) && pattern) {
      text += ` · ${pattern}`;
    }
  }

  return text;
}

export function formatActivityMessage(
  event: AgentEvent,
  locale: Locale,
  prefix?: string,
): ActivityMessage | null {
  if (event.type === 'tool_end') return null;

  const pfx = prefix ? `${prefix} ` : '';

  if (event.type === 'prompt_submit') {
    const prompt = typeof event.payload['prompt'] === 'string'
      ? event.payload['prompt']
      : null;
    if (!prompt) return null;
    return {
      id: crypto.randomUUID(),
      timestamp: event.timestamp,
      side: 'user',
      text: pfx + truncate(prompt, 200),
      fullText: prompt,
    };
  }

  if (event.type === 'tool_start') {
    const toolName = String(
      event.payload['toolName'] ?? '',
    );
    return {
      id: crypto.randomUUID(),
      timestamp: event.timestamp,
      side: 'agent',
      text: pfx + formatToolLabel(toolName, locale, event.payload),
    };
  }

  if (event.type === 'subagent_start') {
    const taskPrompt = typeof event.payload['taskPrompt'] === 'string'
      ? event.payload['taskPrompt']
      : null;
    const label = locale === 'de' ? 'Sub-Aufgabe' : 'Sub-task';
    const text = taskPrompt
      ? `${label}: ${truncate(taskPrompt, 60)}`
      : (locale === 'de' ? 'Sub-Aufgabe gestartet' : 'Started sub-task');
    return {
      id: crypto.randomUUID(),
      timestamp: event.timestamp,
      side: 'agent' as const,
      text: pfx + text,
      fullText: taskPrompt ?? undefined,
    };
  }

  if (event.type === 'turn_end' || event.type === 'subagent_end') {
    const msg = event.payload['lastAssistantMessage'];
    if (typeof msg === 'string' && msg.length > 0) {
      return {
        id: crypto.randomUUID(),
        timestamp: event.timestamp,
        side: 'agent' as const,
        text: pfx + truncate(msg, 200),
        fullText: msg,
      };
    }
  }

  const entry = EVENT_LABELS[event.type];
  if (!entry) return null;

  return {
    id: crypto.randomUUID(),
    timestamp: event.timestamp,
    side: entry.side,
    text: pfx + entry[locale],
  };
}
