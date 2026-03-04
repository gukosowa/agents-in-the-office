import { defineStore } from 'pinia';
import { ref } from 'vue';
import { homeDir } from '@tauri-apps/api/path';
import {
  readTextFile,
  writeTextFile,
  mkdir,
  exists,
  readDir,
} from '@tauri-apps/plugin-fs';
import type { AgentEventType } from '../drivers/types';

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

export interface PackInfo {
  name: string;
  categories: Record<string, string[]>;
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
  let soundPacksDir = '';
  let configPath = '';

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

      // Read category subdirectories (matching AgentEventType values)
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

      // Ensure all 16 event type category slots exist in the result
      for (const eventType of AGENT_EVENT_TYPES) {
        if (!(eventType in categories)) {
          categories[eventType] = [];
        }
      }

      discovered.push({ name: packName, categories });
    }

    packs.value = discovered;
    return discovered;
  }

  function getTrackConfig(packName: string, categoryAndFile: string): TrackConfig {
    const packTracks = config.value.tracks[packName];
    if (packTracks) {
      const existing = packTracks[categoryAndFile];
      if (existing !== undefined) return existing;
    }
    // Default on first access
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

  return {
    config,
    packs,
    init,
    saveConfig,
    scanPacks,
    getTrackConfig,
    setTrackConfig,
    getSoundPacksDir,
  };
});
