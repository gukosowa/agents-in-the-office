import { defineStore } from 'pinia';
import { ref } from 'vue';
import { homeDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  readTextFile,
  writeTextFile,
  mkdir,
  exists,
  readDir,
  readFile,
  writeFile,
  remove,
} from '@tauri-apps/plugin-fs';
import type { AgentEvent, AgentEventType } from '../drivers/types';

export const AGENT_EVENT_TYPES: AgentEventType[] = [
  'session_start',
  'session_end',
  'prompt_submit',
  'tool_start',
  'tool_end',
  'turn_end',
  'permission_wait',
  'subagent_start',
  'subagent_end',
  'idle_notification',
  'elicitation_wait',
  'auth_success',
  'worktree_create',
  'worktree_remove',
  'teammate_idle',
  'task_completed',
];

export interface TrackConfig {
  enabled: boolean;
  volume: number;
}

export interface SoundConfig {
  enabled: boolean;
  globalVolume: number;
  cooldownSeconds: number;
  activePacks: string[];
  /** Per-sound overrides, key: "<packName>/<filename>" */
  soundOverrides: Record<string, { volume: number; enabled: boolean }>;
  /** Event types hidden from the patchbay UI */
  hiddenEvents: string[];
  /** Legacy field — read for migration only, not written on save */
  tracks?: Record<string, Record<string, TrackConfig>>;
}

export interface PackManifestSound {
  file: string;
  volume: number;
  enabled: boolean;
}

export interface PackManifestAssignment {
  file: string;
  event: AgentEventType;
}

export interface PackManifest {
  sounds: PackManifestSound[];
  assignments: PackManifestAssignment[];
}

export interface PackInfo {
  name: string;
  categories: Record<string, string[]>;
  manifest: PackManifest;
  hasManifest: boolean;
}


const DEFAULT_HIDDEN_EVENTS: string[] = [
  'idle_notification',
  'elicitation_wait',
  'auth_success',
  'worktree_create',
  'worktree_remove',
  'teammate_idle',
  'task_completed',
];

const DEFAULT_CONFIG: SoundConfig = {
  enabled: true,
  globalVolume: 0.8,
  cooldownSeconds: 2,
  activePacks: [],
  soundOverrides: {},
  hiddenEvents: [...DEFAULT_HIDDEN_EVENTS],
};

function migrateTracksToSoundOverrides(
  tracks: Record<string, Record<string, TrackConfig>>,
): Record<string, { volume: number; enabled: boolean }> {
  const overrides: Record<string, { volume: number; enabled: boolean }> = {};
  for (const [packName, packTracks] of Object.entries(tracks)) {
    for (const [categoryAndFile, trackCfg] of Object.entries(packTracks)) {
      const slashIdx = categoryAndFile.indexOf('/');
      const filename = slashIdx >= 0 ? categoryAndFile.slice(slashIdx + 1) : categoryAndFile;
      const overrideKey = `${packName}/${filename}`;
      if (!(overrideKey in overrides)) {
        overrides[overrideKey] = { volume: trackCfg.volume, enabled: trackCfg.enabled };
      }
    }
  }
  return overrides;
}

const AUDIO_EXTENSIONS = new Set(['.mp3', '.ogg', '.wav', '.flac', '.m4a']);

function hasAudioExtension(filename: string): boolean {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return false;
  return AUDIO_EXTENSIONS.has(filename.slice(dot).toLowerCase());
}

export const useSoundStore = defineStore('sound', () => {
  const config = ref<SoundConfig>({ ...DEFAULT_CONFIG, soundOverrides: {} });
  const packs = ref<PackInfo[]>([]);

  // Reactive state for sound indicator (US-009)
  const lastPlayedSessionId = ref<string | null>(null);

  let soundPacksDir = '';
  let configPath = '';

  // Per-category cooldown timestamps (category → last played ms)
  const cooldownMap = new Map<string, number>();

  // Whether any sound is currently playing
  let playing = false;

  // Per-session pack assignment
  const sessionPacks = new Map<string, string>();

  // -------------------------------------------------------------------------
  // Init / persistence
  // -------------------------------------------------------------------------

  async function init(): Promise<void> {
    const home = await homeDir();
    soundPacksDir = `${home}/.agents-in-the-office/sound-packs`;
    configPath = `${soundPacksDir}/config.json`;

    const dirExists = await exists(soundPacksDir);
    if (!dirExists) {
      await mkdir(soundPacksDir, { recursive: true });
    }

    const cfgExists = await exists(configPath);
    if (cfgExists) {
      try {
        const raw = await readTextFile(configPath);
        const parsed = JSON.parse(raw) as Partial<SoundConfig>;
        // Migrate legacy tracks field to soundOverrides
        if (!parsed.soundOverrides && parsed.tracks) {
          parsed.soundOverrides = migrateTracksToSoundOverrides(parsed.tracks);
        }
        const { tracks: _tracks, ...rest } = parsed;
        void _tracks; // consumed by migration above, drop from config
        config.value = { ...DEFAULT_CONFIG, ...rest };
        // Apply default hidden events for configs that predate the feature
        if (!parsed.hiddenEvents) {
          config.value.hiddenEvents = [...DEFAULT_HIDDEN_EVENTS];
        }
      } catch {
        config.value = { ...DEFAULT_CONFIG, soundOverrides: {} };
      }
    } else {
      config.value = { ...DEFAULT_CONFIG, soundOverrides: {} };
      await saveConfig();
    }

    // Listen for sound-ended from Rust to reset playing flag
    await listen('sound-ended', () => {
      playing = false;
    });
  }

  async function saveConfig(): Promise<void> {
    await writeTextFile(configPath, JSON.stringify(config.value, null, 2));
  }

  // -------------------------------------------------------------------------
  // Pack manifest read/write
  // -------------------------------------------------------------------------

  async function loadPackManifest(packName: string): Promise<PackManifest> {
    const manifestPath = `${soundPacksDir}/${packName}/manifest.json`;
    const manifestExists = await exists(manifestPath);
    if (!manifestExists) return { sounds: [], assignments: [] };
    try {
      const raw = await readTextFile(manifestPath);
      const parsed = JSON.parse(raw) as Partial<PackManifest>;
      return {
        sounds: Array.isArray(parsed.sounds) ? parsed.sounds : [],
        assignments: Array.isArray(parsed.assignments) ? parsed.assignments : [],
      };
    } catch {
      return { sounds: [], assignments: [] };
    }
  }

  async function savePackManifest(packName: string, manifest: PackManifest): Promise<void> {
    const manifestPath = `${soundPacksDir}/${packName}/manifest.json`;
    await writeTextFile(manifestPath, JSON.stringify(manifest, null, 2));
  }

  // -------------------------------------------------------------------------
  // Pack scanning
  // -------------------------------------------------------------------------

  async function autoMigratePack(
    packName: string,
    packPath: string,
  ): Promise<PackManifest> {
    const eventTypes = new Set<string>(AGENT_EVENT_TYPES);
    const manifest: PackManifest = { sounds: [], assignments: [] };
    const seenFiles = new Set<string>();
    const dirsToRemove: string[] = [];

    const entries = await readDir(packPath);
    for (const entry of entries) {
      if (!entry.isDirectory || entry.name === undefined) continue;
      const folderName = entry.name;
      const folderPath = `${packPath}/${folderName}`;
      const isEventFolder = eventTypes.has(folderName);
      const fileEntries = await readDir(folderPath);

      for (const fileEntry of fileEntries) {
        if (fileEntry.isDirectory || fileEntry.name === undefined) continue;
        const filename = fileEntry.name;
        if (!hasAudioExtension(filename)) continue;
        const srcPath = `${folderPath}/${filename}`;
        const dstPath = `${packPath}/${filename}`;

        const alreadyAtRoot = await exists(dstPath);
        if (!alreadyAtRoot) {
          const data = await readFile(srcPath);
          await writeFile(`${dstPath}`, data);
        }
        await remove(srcPath);

        if (!seenFiles.has(filename)) {
          seenFiles.add(filename);
          manifest.sounds.push({ file: filename, volume: 1.0, enabled: true });
        }

        if (isEventFolder) {
          manifest.assignments.push({
            file: filename,
            event: folderName as AgentEventType,
          });
        }
      }

      dirsToRemove.push(folderPath);
    }

    for (const dirPath of dirsToRemove) {
      try {
        await remove(dirPath, { recursive: true });
      } catch { /* ignore if already removed */ }
    }

    await savePackManifest(packName, manifest);
    return manifest;
  }

  async function scanPacks(): Promise<PackInfo[]> {
    const discovered: PackInfo[] = [];

    const dirExists = await exists(soundPacksDir);
    if (!dirExists) return discovered;

    const entries = await readDir(soundPacksDir);
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      if (entry.name === undefined || entry.name.startsWith('.')) continue;
      const packName = entry.name;
      const packPath = `${soundPacksDir}/${packName}`;
      const categories: Record<string, string[]> = {};

      let hasManifest = await exists(`${packPath}/manifest.json`);
      let manifest: PackManifest;

      if (hasManifest) {
        manifest = await loadPackManifest(packName);
      } else {
        manifest = await autoMigratePack(packName, packPath);
        hasManifest = true;
      }

      const catEntries = await readDir(packPath);
      for (const cat of catEntries) {
        if (!cat.isDirectory) continue;
        if (cat.name === undefined || cat.name.startsWith('.')) continue;
        const catName = cat.name;
        const catPath = `${packPath}/${catName}`;
        const fileEntries = await readDir(catPath);
        const audioFiles = fileEntries
          .filter((f) => !f.isDirectory && f.name !== undefined && hasAudioExtension(f.name))
          .map((f) => f.name as string);
        if (audioFiles.length > 0 || AGENT_EVENT_TYPES.includes(catName as AgentEventType)) {
          categories[catName] = audioFiles.sort();
        }
      }

      for (const eventType of AGENT_EVENT_TYPES) {
        if (!(eventType in categories)) {
          categories[eventType] = [];
        }
      }

      discovered.push({ name: packName, categories, manifest, hasManifest });
    }

    packs.value = discovered;
    return discovered;
  }

  // -------------------------------------------------------------------------
  // Sound override helpers (two-layer: soundOverrides → manifest default)
  // -------------------------------------------------------------------------

  /** Extract filename from "category/filename" or plain "filename" key. */
  function extractFilename(categoryAndFile: string): string {
    const slashIdx = categoryAndFile.indexOf('/');
    return slashIdx >= 0 ? categoryAndFile.slice(slashIdx + 1) : categoryAndFile;
  }

  /**
   * Effective volume for a sound: soundOverrides → manifest default → 1.0
   */
  function effectiveVolume(packName: string, filename: string, manifestSound?: PackManifestSound): number {
    const override = config.value.soundOverrides[`${packName}/${filename}`];
    if (override !== undefined) return override.volume;
    return manifestSound?.volume ?? 1.0;
  }

  /**
   * Effective enabled state: soundOverrides → manifest default → true
   */
  function isEnabled(packName: string, filename: string, manifestSound?: PackManifestSound): boolean {
    const override = config.value.soundOverrides[`${packName}/${filename}`];
    if (override !== undefined) return override.enabled;
    return manifestSound?.enabled ?? true;
  }

  /**
   * Get track config for a sound. Accepts legacy "category/filename" key format.
   * Reads from soundOverrides using packName/filename key.
   */
  function getTrackConfig(packName: string, categoryAndFile: string): TrackConfig {
    const filename = extractFilename(categoryAndFile);
    const override = config.value.soundOverrides[`${packName}/${filename}`];
    return override ?? { enabled: true, volume: 1.0 };
  }

  /**
   * Set track config for a sound. Accepts legacy "category/filename" key format.
   * Writes to soundOverrides using packName/filename key.
   */
  function setTrackConfig(packName: string, categoryAndFile: string, track: TrackConfig): void {
    const filename = extractFilename(categoryAndFile);
    config.value.soundOverrides[`${packName}/${filename}`] = track;
  }

  function getSoundPacksDir(): string {
    return soundPacksDir;
  }

  function getSessionPack(sessionId: string): string | undefined {
    return sessionPacks.get(sessionId);
  }

  function assignSessionPack(sessionId: string, preferredPacks: string[]): void {
    const pool = preferredPacks.length > 0 ? preferredPacks : config.value.activePacks;
    if (pool.length === 0) return;
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    if (chosen !== undefined) {
      sessionPacks.set(sessionId, chosen);
    }
  }

  // -------------------------------------------------------------------------
  // Playback engine (delegates to Rust/rodio via Tauri commands)
  // -------------------------------------------------------------------------

  async function playForEvent(event: AgentEvent): Promise<void> {
    if (!config.value.enabled) return;
    if (config.value.hiddenEvents.includes(event.type)) return;

    // Session pack assignment on session_start
    if (event.type === 'session_start') {
      const { activePacks } = config.value;
      if (activePacks.length > 0) {
        const randomIdx = Math.floor(Math.random() * activePacks.length);
        const chosen = activePacks[randomIdx];
        if (chosen !== undefined) {
          sessionPacks.set(event.sessionId, chosen);
        }
      }
    }

    const packName = sessionPacks.get(event.sessionId);
    if (!packName) return;

    const category = event.type;
    const now = Date.now();
    const cooldownMs = config.value.cooldownSeconds * 1000;
    const lastPlayed = cooldownMap.get(category) ?? 0;
    if (now - lastPlayed < cooldownMs) return;

    if (playing) return;

    // Find the pack info
    const packInfo = packs.value.find((p) => p.name === packName);
    if (!packInfo) return;

    // Look up manifest assignments for this event type
    const assignedFiles = packInfo.manifest.assignments
      .filter((a) => a.event === event.type)
      .map((a) => a.file);

    // Build a lookup map for manifest sound defaults
    const manifestSoundMap = new Map(packInfo.manifest.sounds.map((s) => [s.file, s]));

    // Filter to enabled files using two-layer rule (soundOverrides → manifest default)
    const enabledFiles = assignedFiles.filter((filename) =>
      isEnabled(packName, filename, manifestSoundMap.get(filename)),
    );

    if (enabledFiles.length === 0) return;

    const randomFileIdx = Math.floor(Math.random() * enabledFiles.length);
    const chosenFile = enabledFiles[randomFileIdx];
    if (chosenFile === undefined) return;

    // Files live at pack root, not in category subdirectories
    const filePath = `${soundPacksDir}/${packName}/${chosenFile}`;

    // Skip missing file with a warning — no crash
    const fileOnDisk = await exists(filePath);
    if (!fileOnDisk) {
      console.warn(`[soundStore] Sound file not found on disk, skipping: ${filePath}`);
      return;
    }

    const manifestSound = manifestSoundMap.get(chosenFile);
    const vol = effectiveVolume(packName, chosenFile, manifestSound);

    playing = true;
    cooldownMap.set(category, now);
    lastPlayedSessionId.value = event.sessionId;

    try {
      await invoke('play_sound', {
        path: filePath,
        volume: config.value.globalVolume * vol,
      });
    } catch (err) {
      console.warn(`[soundStore] play_sound failed:`, err);
      playing = false;
    }
  }

  return {
    config,
    packs,
    lastPlayedSessionId,
    init,
    saveConfig,
    scanPacks,
    loadPackManifest,
    savePackManifest,
    getTrackConfig,
    setTrackConfig,
    effectiveVolume,
    isEnabled,
    getSoundPacksDir,
    playForEvent,
    getSessionPack,
    assignSessionPack,
  };
});
