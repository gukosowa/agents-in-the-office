import { defineStore } from 'pinia';
import { ref } from 'vue';
import { homeDir } from '@tauri-apps/api/path';
import {
  readTextFile,
  writeTextFile,
  mkdir,
  exists,
  readDir,
  readFile,
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
  tracks: Record<string, Record<string, TrackConfig>>;
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


const DEFAULT_CONFIG: SoundConfig = {
  enabled: true,
  globalVolume: 0.8,
  cooldownSeconds: 2,
  activePacks: [],
  tracks: {},
};

const AUDIO_EXTENSIONS = new Set(['.mp3', '.ogg', '.wav', '.flac', '.m4a', '.webm']);

function hasAudioExtension(filename: string): boolean {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return false;
  return AUDIO_EXTENSIONS.has(filename.slice(dot).toLowerCase());
}

export const useSoundStore = defineStore('sound', () => {
  const config = ref<SoundConfig>({ ...DEFAULT_CONFIG, tracks: {} });
  const packs = ref<PackInfo[]>([]);

  // Reactive state for sound indicator (US-009)
  const lastPlayedSessionId = ref<string | null>(null);

  let soundPacksDir = '';
  let configPath = '';

  // AudioContext — lazy init on first playback
  let audioCtx: AudioContext | null = null;

  // Buffer cache: absolute file path → AudioBuffer
  const bufferCache = new Map<string, AudioBuffer>();

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
        config.value = { ...DEFAULT_CONFIG, ...JSON.parse(raw) as Partial<SoundConfig> };
      } catch {
        config.value = { ...DEFAULT_CONFIG, tracks: {} };
      }
    } else {
      config.value = { ...DEFAULT_CONFIG, tracks: {} };
      await saveConfig();
    }
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

      const manifest = await loadPackManifest(packName);
      const hasManifest = await exists(`${packPath}/manifest.json`);

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
  // Track config helpers
  // -------------------------------------------------------------------------

  function getTrackConfig(packName: string, categoryAndFile: string): TrackConfig {
    const packTracks = config.value.tracks[packName];
    if (packTracks) {
      const existing = packTracks[categoryAndFile];
      if (existing !== undefined) return existing;
    }
    const defaultTrack: TrackConfig = { enabled: true, volume: 1.0 };
    if (!config.value.tracks[packName]) {
      config.value.tracks[packName] = {};
    }
    config.value.tracks[packName][categoryAndFile] = defaultTrack;
    return defaultTrack;
  }

  function setTrackConfig(packName: string, categoryAndFile: string, track: TrackConfig): void {
    if (!config.value.tracks[packName]) {
      config.value.tracks[packName] = {};
    }
    config.value.tracks[packName][categoryAndFile] = track;
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
  // AudioContext helpers
  // -------------------------------------------------------------------------

  function getAudioContext(): AudioContext {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    return audioCtx;
  }

  async function loadBuffer(filePath: string): Promise<AudioBuffer | null> {
    const cached = bufferCache.get(filePath);
    if (cached !== undefined) return cached;

    try {
      const bytes = await readFile(filePath);
      const ctx = getAudioContext();
      const buffer = await ctx.decodeAudioData(bytes.buffer as ArrayBuffer);
      bufferCache.set(filePath, buffer);
      return buffer;
    } catch (err) {
      console.warn(`[soundStore] Failed to decode audio: ${filePath}`, err);
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Playback engine
  // -------------------------------------------------------------------------

  async function playForEvent(event: AgentEvent): Promise<void> {
    if (!config.value.enabled) return;

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
    const files = packInfo?.categories[category] ?? [];

    // Filter to enabled tracks
    const enabledFiles = files.filter((filename) => {
      const key = `${category}/${filename}`;
      return getTrackConfig(packName, key).enabled;
    });

    if (enabledFiles.length === 0) return;

    const randomFileIdx = Math.floor(Math.random() * enabledFiles.length);
    const chosenFile = enabledFiles[randomFileIdx];
    if (chosenFile === undefined) return;

    const filePath = `${soundPacksDir}/${packName}/${category}/${chosenFile}`;
    const buffer = await loadBuffer(filePath);
    if (!buffer) return;

    const trackKey = `${category}/${chosenFile}`;
    const trackCfg = getTrackConfig(packName, trackKey);
    const ctx = getAudioContext();

    const gainNode = ctx.createGain();
    gainNode.gain.value = config.value.globalVolume * trackCfg.volume;
    gainNode.connect(ctx.destination);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gainNode);

    playing = true;
    cooldownMap.set(category, now);
    lastPlayedSessionId.value = event.sessionId;

    source.onended = () => {
      playing = false;
    };

    source.start();
  }

  // -------------------------------------------------------------------------
  // Public AudioContext access (for AudioPlayer.vue)
  // -------------------------------------------------------------------------

  function getOrCreateAudioContext(): AudioContext {
    return getAudioContext();
  }

  function getBufferCache(): Map<string, AudioBuffer> {
    return bufferCache;
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
    getSoundPacksDir,
    playForEvent,
    getOrCreateAudioContext,
    getBufferCache,
    loadBuffer,
    getSessionPack,
    assignSessionPack,
  };
});
