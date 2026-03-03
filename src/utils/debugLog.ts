import {
  writeTextFile,
  readTextFile,
} from '@tauri-apps/plugin-fs';
import { homeDir } from '@tauri-apps/api/path';

const FLUSH_INTERVAL_MS = 500;

let logPath: string | null = null;
let buffer: string[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

function todayPrefix(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `[${y}-${m}-${day}`;
}

function timestamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${y}-${mo}-${day} ${hh}:${mm}:${ss}.${ms}`;
}

function truncateStr(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

export function debugLog(
  sessionId: string,
  tag: string,
  detail: string,
): void {
  const sid = sessionId.slice(0, 8);
  const line = truncateStr(
    `[${timestamp()}] [sid:${sid}] ${tag} ${detail}`,
    200,
  );
  buffer.push(line);
}

async function flush(): Promise<void> {
  if (buffer.length === 0 || !logPath) return;
  const chunk = buffer.join('\n') + '\n';
  buffer = [];
  try {
    await writeTextFile(logPath, chunk, {
      append: true,
      create: true,
    });
  } catch {
    // Silently drop — log must never break the app
  }
}

async function pruneOldEntries(): Promise<void> {
  if (!logPath) return;
  try {
    const content = await readTextFile(logPath);
    const prefix = todayPrefix();
    const kept = content
      .split('\n')
      .filter(line => line.startsWith(prefix))
      .join('\n');
    await writeTextFile(logPath, kept ? kept + '\n' : '');
  } catch {
    // File doesn't exist yet — fine
  }
}

export async function initDebugLog(): Promise<void> {
  const home = await homeDir();
  logPath = `${home}/.agents-in-the-office/log.txt`;
  await pruneOldEntries();
  flushTimer = setInterval(() => { void flush(); }, FLUSH_INTERVAL_MS);
}

export function stopDebugLog(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  void flush();
}

/** One-shot debug write — no session, no buffer. */
export async function debugLogDirect(
  tag: string,
  detail: string,
): Promise<void> {
  const line = `[${timestamp()}] ${tag} ${detail}`;
  console.debug(`[debug] ${tag} ${detail}`);
  try {
    const home = await homeDir();
    const path = `${home}/.agents-in-the-office/debug.txt`;
    await writeTextFile(path, line + '\n', {
      append: true, create: true,
    });
  } catch {
    // Debug log must never break the app
  }
}
