<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useMapStore } from '../stores/mapStore';
import {
  useLocaleStore,
  LOCALE_OPTIONS,
  type Locale,
} from '../stores/localeStore';
import { Character } from '../classes/Character';
import type { CharacterDefinition } from '../types/character';
import {
  DEFAULT_TILE_SIZE, DOOR_TYPES,
  isAutoTile, isRegularTile,
  type Direction,
  type DepthMap,
} from '../types';
import { subTileToPixels } from '../utils/rmxpAutoTile';
import { subTileToPixelsB, wallSubTileToPixels } from '../utils/vxAutoTile';
import type { WallVariants } from '../utils/vxAutoTile';
import type { AutoTileType } from '../stores/mapStore';
import { pruneOldEvents } from '../utils/db';
import { loadMapFromPath, AITO_FILE_PATH_KEY } from '../utils/fileIO';
import { invoke } from '@tauri-apps/api/core';
import { createFallbackDefinitions } from '../utils/spriteLoader';
import { getIdleConversation } from '../i18n/bubbleTexts';
import { useAgentStore, type AgentStatus } from '../drivers/agentStore';
import { createNpcHandle } from '../drivers/npcHandle';
import { truncate } from '../drivers/activityMessages';
import type {
  AgentEvent, SessionStateFile,
} from '../drivers/types';
import AgentActivityPanel from '../components/AgentActivityPanel.vue';
import SoundQuickPanel from '../components/SoundQuickPanel.vue';
import { Volume2, VolumeX, Settings } from 'lucide-vue-next';
import {
  initDebugLog,
  stopDebugLog,
  debugLog,
} from '../utils/debugLog';
import { useCharacterStore } from '../stores/characterStore';
import { useSoundStore } from '../stores/soundStore';
import { useEmojiStore } from '../stores/emojiStore';

const router = useRouter();
const mapStore = useMapStore();
const localeStore = useLocaleStore();
const agentStore = useAgentStore();
const characterStore = useCharacterStore();
const soundStore = useSoundStore();
const emojiStore = useEmojiStore();
const controlsExpanded = ref(false);
const controlsRef = ref<HTMLElement | null>(null);
const soundQuickPanelOpen = ref(false);
const soundSettingsOpen = ref(false);
let controlsCloseTimer: ReturnType<typeof setTimeout> | null = null;

function openControls() {
  if (controlsCloseTimer) {
    clearTimeout(controlsCloseTimer);
    controlsCloseTimer = null;
  }
  controlsExpanded.value = true;
}

function scheduleCloseControls() {
  if (controlsCloseTimer) clearTimeout(controlsCloseTimer);
  controlsCloseTimer = setTimeout(() => {
    controlsExpanded.value = false;
    controlsCloseTimer = null;
  }, 2000);
}

function flashControls() {
  openControls();
  scheduleCloseControls();
}
const LS_PREFIX = 'run-view-';
function loadBool(key: string, fallback: boolean): boolean {
  const v = localStorage.getItem(LS_PREFIX + key);
  return v === null ? fallback : v === 'true';
}
function loadNum(key: string, fallback: number): number {
  const v = localStorage.getItem(LS_PREFIX + key);
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function saveBool(key: string, val: boolean) {
  localStorage.setItem(LS_PREFIX + key, String(val));
}
function saveNum(key: string, val: number) {
  localStorage.setItem(LS_PREFIX + key, String(val));
}

const selectedSessionId = ref<string | null>(null);
const panelPinned = ref(loadBool('panelPinned', false));
const autoFollow = ref(loadBool('autoFollow', true));
const alwaysOnTop = ref(loadBool('alwaysOnTop', false));

async function toggleAlwaysOnTop() {
  alwaysOnTop.value = !alwaysOnTop.value;
  await getCurrentWindow().setAlwaysOnTop(alwaysOnTop.value);
}

watch(selectedSessionId, (val) => {
  if (!val) panelPinned.value = false;
});

watch(autoFollow, (val) => saveBool('autoFollow', val));
watch(panelPinned, (val) => saveBool('panelPinned', val));
watch(alwaysOnTop, (val) => saveBool('alwaysOnTop', val));

watch(() => soundStore.lastPlayedSessionId, (sessionId) => {
  if (!sessionId) return;
  const npcId = findNpcForSession(sessionId);
  if (!npcId) return;
  const ch = characters.find((c) => c.id === npcId);
  ch?.showSoundIndicator?.();
});

const SUBAGENT_NAME_MAX = 12;

function subagentNameTag(parentName: string): string {
  const base = parentName.length > SUBAGENT_NAME_MAX
    ? parentName.slice(0, SUBAGENT_NAME_MAX - 1) + '…'
    : parentName;
  return `[sub] ${base}`;
}

const activeAgentSessions = computed(() => {
  const entries: {
    sessionId: string;
    name: string;
    status: AgentStatus;
    dismissing: boolean;
    startedAt: number;
  }[] = [];
  for (const [sid, sess] of agentStore.sessions) {
    if (sess.parentSessionId) continue;
    if (sess.dismissing && !sess.npcId) continue;
    entries.push({
      sessionId: sid,
      name: sess.nameTag ?? `Agent ${sid.slice(0, 6)}`,
      status: sess.status,
      dismissing: sess.dismissing,
      startedAt: sess.startedAt,
    });
  }
  return entries.sort((a, b) => a.startedAt - b.startedAt);
});

function selectAgent(sessionId: string) {
  selectedSessionId.value = sessionId;
  panelPinned.value = true;
  const npcId = findNpcForSession(sessionId);
  if (npcId) {
    const ch = characters.find(c => c.id === npcId);
    if (ch && ch.state !== 'exited') followTarget = ch;
  }
}

function zoomToNpc(sessionId: string) {
  const npcId = findNpcForSession(sessionId);
  if (!npcId) return;
  const ch = characters.find(c => c.id === npcId);
  if (!ch || ch.state === 'exited') return;
  followTarget = ch;
  startupPanTarget = null;
  zoomTarget = null;
  followZoomTarget = Math.max(1.5, camZoom);
}

function cycleAgent(delta: number) {
  const list = activeAgentSessions.value;
  if (list.length === 0) return;
  const currentIdx = list.findIndex(
    a => a.sessionId === selectedSessionId.value,
  );
  const nextIdx = currentIdx === -1
    ? 0
    : (currentIdx + delta + list.length) % list.length;
  selectAgent(list[nextIdx]!.sessionId);
}

function findNpcForSession(sessionId: string): string | null {
  for (const [npcId, sid] of externalNpcSessions) {
    if (sid === sessionId) return npcId;
  }
  return null;
}

function dismissAgent(sessionId: string): void {
  const session = agentStore.sessions.get(sessionId);
  if (!session || session.status !== 'idle') return;
  session.dismissing = true;
  const npcId = findNpcForSession(sessionId);
  if (!npcId) return;
  const ch = characters.find(c => c.id === npcId);
  if (ch && ch.state !== 'exited') {
    ch.enqueueCommand({ type: 'leave_room' });
  }
}
const canvas = ref<HTMLCanvasElement | null>(null);
const MIN_STAY_SECONDS = 10;
const MAX_NPCS_PER_DOOR = 4;
const MAX_AUTONOMOUS_NPCS = 20;
const SPAWN_CHECK_INTERVAL = 2.0;
const LEAVE_CHANCE_PER_SECOND = 0.1;

let characters: Character[] = [];
const spriteImageCache = new Map<string, HTMLImageElement>();
let animationId: number;
let lastTime = 0;
let spawnTimer = 0;
let nextSpriteIndex = 0;
let nextSubagentSpriteIndex = 0;
let agentUnlisten: UnlistenFn | null = null;
let restoreUnlisten: UnlistenFn | null = null;
let staleCheckTimer = 0;
const APPROVAL_REFOCUS_INTERVAL = 5.0;
let approvalRefocusTimer = 0;
// npcId → sessionId for cleanup when external NPCs exit
const externalNpcSessions = new Map<string, string>();

async function loadDefinitionSprite(
  def: CharacterDefinition,
): Promise<void> {
  if (spriteImageCache.has(def.id)) return;
  const dataUrl = await new Promise<string>(
    (resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(def.spriteBlob);
    },
  );
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => {
      spriteImageCache.set(def.id, img);
      resolve();
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4.0;
let camZoom = loadNum('camZoom', 1.0);
let camPanX = loadNum('camPanX', 0);
let camPanY = loadNum('camPanY', 0);

const isDragging = ref(false);
let dragStartX = 0;
let dragStartY = 0;
let dragMoved = false;
const DRAG_THRESHOLD = 4;

let followTarget: Character | null = null;
const anyWaitingApproval = ref(false);
const CAM_LERP_SPEED = 4.0;
// Lookahead: smoothed velocity offset so the camera leads the character
let camLookaheadX = 0; // tiles
let camLookaheadY = 0; // tiles
let prevFollowX = 0;
let prevFollowY = 0;
const CAM_LOOKAHEAD_TILES = 0.5; // how far ahead to look at full speed
const CAM_LOOKAHEAD_LERP = 3.0; // how quickly lookahead builds/fades
const CHAR_MOVE_SPEED = 3.0; // must match Character.ts MOVE_SPEED
let prevFollowTarget: Character | null = null;

let startupPanTarget: { x: number; y: number } | null = null;
const STARTUP_PAN_DELAY_MS = 800;
let startupPanDelay = 0;

let zoomTarget: number | null = null;
let followZoomTarget: number | null = null;
let zoomPivotSX = 0;
let zoomPivotSY = 0;
let zoomPivotWX = 0;
let zoomPivotWY = 0;
const ZOOM_LERP_SPEED = 8.0;

// Auto-focus: camera snaps to the agent that last fired an event.
// Debounce window prevents rapid target switching when multiple
// agents fire hooks in quick succession.
const AUTO_FOCUS_DEBOUNCE_S = 3;
let autoFocusLockedUntil = 0;

const normalizeWheelDelta = (
  delta: number,
  deltaMode: number,
): number => {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * 100;
  return delta;
};

const applyZoom = (e: WheelEvent, dy: number) => {
  const rect = canvas.value!.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  const factor = Math.exp(-dy * 0.0015);
  const newZoom = Math.max(
    MIN_ZOOM,
    Math.min(MAX_ZOOM, camZoom * factor),
  );
  const worldX = (cx - camPanX) / camZoom;
  const worldY = (cy - camPanY) / camZoom;
  camPanX = cx - worldX * newZoom;
  camPanY = cy - worldY * newZoom;
  camZoom = newZoom;
};

const handleWheel = (e: WheelEvent) => {
  e.preventDefault();
  if (!canvas.value) return;

  followTarget = null;
  startupPanTarget = null;
  zoomTarget = null;
  followZoomTarget = null;

  const dx = normalizeWheelDelta(e.deltaX, e.deltaMode);
  const dy = normalizeWheelDelta(e.deltaY, e.deltaMode);

  if (e.ctrlKey) {
    // Trackpad pinch or Ctrl+scroll → zoom (5x sensitivity)
    applyZoom(e, dy * 5);
  } else if (e.shiftKey) {
    // Shift+scroll → pan
    camPanX -= dy;
    camPanY -= dx;
  } else if (dx !== 0) {
    // Two-finger trackpad scroll (has horizontal component) → pan
    camPanX -= dx;
    camPanY -= dy;
  } else {
    // Mouse wheel (vertical only, no modifier) → zoom
    applyZoom(e, dy);
  }
};

const screenToWorld = (sx: number, sy: number) => ({
  wx: (sx - camPanX) / camZoom,
  wy: (sy - camPanY) / camZoom,
});

const hitTestCharacter = (
  wx: number, wy: number,
): Character | null => {
  const ts = mapStore.tileSize;
  for (let i = characters.length - 1; i >= 0; i--) {
    const ch = characters[i]!;
    const cx = ch.x * ts;
    const cy = ch.y * ts;
    if (wx >= cx && wx < cx + ts && wy >= cy && wy < cy + ts) {
      return ch;
    }
  }
  return null;
};

const handlePointerDown = (e: PointerEvent) => {
  if (e.button !== 0) return;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  isDragging.value = true;
  dragMoved = false;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
};

const handlePointerMove = (e: PointerEvent) => {
  if (!isDragging.value) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;
  if (
    !dragMoved
    && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD
  ) {
    dragMoved = true;
    followTarget = null;
    startupPanTarget = null;
    zoomTarget = null;
    followZoomTarget = null;
  }
  if (dragMoved) {
    camPanX += e.movementX;
    camPanY += e.movementY;
  }
};

const handlePointerUp = (e: PointerEvent) => {
  if (!isDragging.value) return;
  isDragging.value = false;
  if (dragMoved || !canvas.value) return;

  const rect = canvas.value.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const { wx, wy } = screenToWorld(sx, sy);
  const hit = hitTestCharacter(wx, wy);
  followTarget = hit;
  if (hit?.controlMode === 'external') {
    const sid = externalNpcSessions.get(hit.id) ?? null;
    const sess = sid ? agentStore.sessions.get(sid) : undefined;
    selectedSessionId.value = sess?.parentSessionId ?? sid;
  } else {
    selectedSessionId.value = null;
  }
};

const DOUBLE_CLICK_ZOOM_FACTOR = 2.0;

const zoomAroundCenter = (factor: number) => {
  if (!canvas.value) return;
  const cx = canvas.value.width / 2;
  const cy = canvas.value.height / 2;
  zoomPivotSX = cx;
  zoomPivotSY = cy;
  zoomPivotWX = (cx - camPanX) / camZoom;
  zoomPivotWY = (cy - camPanY) / camZoom;
  zoomTarget = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camZoom * factor));
  followTarget = null;
  startupPanTarget = null;
  followZoomTarget = null;
};

const handleDoubleClick = (e: MouseEvent) => {
  if (!canvas.value) return;
  const rect = canvas.value.getBoundingClientRect();
  zoomPivotSX = e.clientX - rect.left;
  zoomPivotSY = e.clientY - rect.top;
  zoomPivotWX = (zoomPivotSX - camPanX) / camZoom;
  zoomPivotWY = (zoomPivotSY - camPanY) / camZoom;
  zoomTarget = Math.min(MAX_ZOOM, camZoom * DOUBLE_CLICK_ZOOM_FACTOR);
  followTarget = null;
  startupPanTarget = null;
};

const fitCameraToView = () => {
  if (!canvas.value) return;
  const vw = canvas.value.width;
  const vh = canvas.value.height;
  const mw = mapStore.width * mapStore.tileSize;
  const mh = mapStore.height * mapStore.tileSize;
  const fit = Math.max(
    MIN_ZOOM,
    Math.min(MAX_ZOOM, Math.min(vw / mw, vh / mh) * 0.9),
  );
  camZoom = fit;
  camPanX = (vw - mw * fit) / 2;
  camPanY = (vh - mh * fit) / 2;
};

const initStartupPan = () => {
  const ts = mapStore.tileSize;
  const doors = getDoors();
  const agentDoors = doors.filter(o => o.type === 'door_agent');
  const pick = agentDoors[0] ?? doors[0];
  if (!pick) return;
  startupPanTarget = {
    x: pick.x * ts + ts / 2,
    y: pick.y * ts + ts / 2,
  };
};

const resetCamera = () => {
  followTarget = null;
  fitCameraToView();
  saveCamera();
};

const hasSavedCamera =
  localStorage.getItem(LS_PREFIX + 'camZoom') !== null;

function saveCamera() {
  saveNum('camZoom', camZoom);
  saveNum('camPanX', camPanX);
  saveNum('camPanY', camPanY);
}

const getDoors = () =>
  mapStore.getEffectiveObjects().filter(
    o => DOOR_TYPES.has(o.type),
  );

const pickDefinition = (): CharacterDefinition => {
  const all = characterStore.characters;
  const regular = all.filter(d => !d.isSubagent);
  const defs = regular.length > 0 ? regular : all;
  const def = defs[nextSpriteIndex % defs.length]!;
  nextSpriteIndex++;
  return def;
};

const pickSubagentDefinition = (): CharacterDefinition | null => {
  const defs = characterStore.characters.filter(
    d => d.isSubagent,
  );
  if (defs.length === 0) return null;
  const def = defs[nextSubagentSpriteIndex % defs.length]!;
  nextSubagentSpriteIndex++;
  return def;
};

const spawnFromDoor = (
  door: { id: string; x: number; y: number; direction: Direction },
  controlMode: 'autonomous' | 'external' = 'autonomous',
  explicitDef?: CharacterDefinition,
): Character => {
  const def = explicitDef ?? pickDefinition();
  if (!spriteImageCache.has(def.id)) {
    void loadDefinitionSprite(def);
  }
  const ch = new Character(
    crypto.randomUUID(),
    door.x, door.y,
    def.id,
    def,
  );
  ch.spawnDoorId = door.id;
  ch.controlMode = controlMode;
  ch.startDoorEntry(door.direction);
  characters.push(ch);
  return ch;
};

const trySpawnFromDoors = () => {
  const autonomousCount = characters.filter(
    ch => ch.controlMode === 'autonomous'
      && ch.state !== 'exited',
  ).length;
  if (autonomousCount >= MAX_AUTONOMOUS_NPCS) return;

  const doors = getDoors().filter(o => o.type !== 'door_agent');
  const eligible = doors.filter(door =>
    characters.filter(ch => ch.spawnDoorId === door.id && ch.state !== 'exited').length < MAX_NPCS_PER_DOOR,
  );
  if (eligible.length === 0 || Math.random() < 0.5) return;
  const door = eligible[Math.floor(Math.random() * eligible.length)];
  if (!door) return;
  spawnFromDoor(door);
};

const initCharacters = () => {
  characters = [];
  spawnTimer = 0;
  nextSpriteIndex = 0;
  nextSubagentSpriteIndex = 0;

  if (characterStore.characters.length === 0) return;

  const doors = getDoors().filter(o => o.type !== 'door_agent');
  for (const door of doors) {
    spawnFromDoor(door);
  }

  const spawns = mapStore.spawnPoints;
  for (const sp of spawns) {
    const def = pickDefinition();
    const ch = new Character(
      crypto.randomUUID(),
      sp.x, sp.y,
      def.id,
      def,
    );
    characters.push(ch);
  }
};

const getOccupiedCells = (): Set<string> => {
  const cells = new Set<string>();
  for (const ch of characters) {
    cells.add(`${Math.round(ch.x)},${Math.round(ch.y)}`);
  }
  return cells;
};

const removeOrphanedNpc = (sessionId: string): void => {
  for (const [npcId, sid] of externalNpcSessions) {
    if (sid !== sessionId) continue;
    const old = characters.find(c => c.id === npcId);
    if (old) old.state = 'exited';
    externalNpcSessions.delete(npcId);
  }
};

const spawnAgentNpc = (sessionId: string): void => {
  removeOrphanedNpc(sessionId);
  const doors = getDoors();
  const agentDoors = doors.filter(o => o.type === 'door_agent');
  const pool = agentDoors.length > 0 ? agentDoors : doors;
  const agentDoor = pool[Math.floor(Math.random() * pool.length)];
  if (!agentDoor) return;
  const session = agentStore.sessions.get(sessionId);
  const subagentDef = session?.parentSessionId
    ? pickSubagentDefinition()
    : undefined;
  const ch = spawnFromDoor(
    agentDoor, 'external', subagentDef ?? undefined,
  );
  ch.debugSessionId = sessionId;
  const spawnedDef = characterStore.getCharacter(ch.characterDefinitionId);
  if (session?.parentSessionId) {
    const parentPack = soundStore.getSessionPack(session.parentSessionId);
    if (parentPack) {
      soundStore.assignSessionPack(sessionId, [parentPack]);
    } else {
      soundStore.assignSessionPack(sessionId, spawnedDef?.preferredPacks ?? []);
    }
    emojiStore.assignSessionEmoji(sessionId, session.parentSessionId);
    ch.badge = '🐔';
    const parent = agentStore.sessions.get(session.parentSessionId);
    const parentName = parent?.nameTag ?? 'Agent';
    ch.nameTag = subagentNameTag(parentName);
  } else {
    soundStore.assignSessionPack(sessionId, spawnedDef?.preferredPacks ?? []);
    emojiStore.assignSessionEmoji(sessionId);
    if (session?.nameTag) {
      ch.nameTag = session.nameTag;
    }
  }
  ch.sessionEmoji = emojiStore.getSessionEmoji(sessionId);
  ch.enqueueCommand({ type: 'wander' });
  const handle = createNpcHandle(ch, sessionId);
  externalNpcSessions.set(ch.id, sessionId);
  agentStore.registerNpc(sessionId, ch.id, handle);
  if (session?.parentSessionId && session.prompt) {
    handle.showBubble(truncate(session.prompt, 80), 'speech', true);
  }
  debugLog(
    sessionId, 'NPC_SPAWN',
    `npcId=${ch.id} door=${agentDoor.type}`,
  );
};

const focusOnSessionNpc = (
  sessionId: string,
  force = false,
): boolean => {
  const now = performance.now() / 1000;
  if (!force && now < autoFocusLockedUntil) return false;

  const session = agentStore.sessions.get(sessionId);
  if (!session?.npcId) return false;

  const ch = characters.find(c => c.id === session.npcId);
  if (!ch || ch.state === 'exited') return false;

  followTarget = ch;
  autoFocusLockedUntil = now + AUTO_FOCUS_DEBOUNCE_S;
  return true;
};

const handleSessionRestore = async (rawJson: string): Promise<void> => {
  let state: SessionStateFile;
  try {
    state = JSON.parse(rawJson) as SessionStateFile;
  } catch {
    return;
  }
  if (!state.sessionId) return;

  // Emit a synthetic session_start to spawn the NPC
  const startEvent: AgentEvent = {
    sessionId: state.sessionId,
    timestamp: state.timestamp,
    type: 'session_start',
    agentType: state.agentType,
    payload: state.payload,
  };
  await handleAgentEvent(JSON.stringify(startEvent));

  // Then replay the last event to put the NPC in
  // the right state (e.g. at a computer, waiting
  // for approval, idle after turn_end).
  if (
    state.lastEventType
    && state.lastEventType !== 'session_start'
  ) {
    const replayEvent: AgentEvent = {
      sessionId: state.sessionId,
      timestamp: state.timestamp,
      type: state.lastEventType,
      agentType: state.agentType,
      payload: state.payload,
    };
    await handleAgentEvent(JSON.stringify(replayEvent));
  }

  const session = agentStore.sessions.get(state.sessionId);
  if (session) {
    session.activityLog = await agentStore.replayActivityLog(
      state.sessionId, localeStore.locale,
    );
    await agentStore.ensurePromptFields(state.sessionId);
    void agentStore.generateNameTag(state.sessionId);
  }

  debugLog(
    state.sessionId, 'SESSION_RESTORE',
    `lastEvent=${state.lastEventType}`,
  );
};

const handleAgentEvent = async (rawJson: string): Promise<void> => {
  let event: AgentEvent;
  try {
    event = JSON.parse(rawJson) as AgentEvent;
  } catch (err) {
    debugLog(
      '????????', 'EVENT_ARRIVED',
      `PARSE_FAIL ${String(err).slice(0, 80)}`,
    );
    return;
  }
  const results = await agentStore.handleEvent(
    event, localeStore.locale,
  );
  for (const result of results) {
    debugLog(
      event.sessionId, 'EVENT_ARRIVED',
      `type=${event.type} → action=${result.action}`,
    );
    if (result.action === 'spawn' || result.action === 'respawn') {
      spawnAgentNpc(result.sessionId);
      void agentStore.ensurePromptFields(result.sessionId);
    }
    if (result.action === 'cancel_dismiss') {
      const sess = agentStore.sessions.get(result.sessionId);
      if (sess?.npcId) {
        const ch = characters.find(c => c.id === sess.npcId);
        ch?.cancelLeave();
      }
    }
    if (event.type === 'prompt_submit') {
      void agentStore.generateNameTag(result.sessionId);
    }
    if (
      result.action === 'update'
      && agentStore.sessions.get(result.sessionId)?.npcId
      && !characters.some(
        c => c.id === agentStore.sessions.get(result.sessionId)!.npcId,
      )
    ) {
      const session = agentStore.sessions.get(result.sessionId)!;
      session.driver.detach();
      session.npcId = null;
      spawnAgentNpc(result.sessionId);
    }
    const needsApproval = event.type === 'permission_wait';
    if (needsApproval) {
      focusOnSessionNpc(result.sessionId, true);
      selectedSessionId.value = result.sessionId;
    } else if (result.action !== 'despawn' && autoFollow.value) {
      if (!followTarget?.waitingForApproval) {
        const focused = focusOnSessionNpc(result.sessionId);
        if (focused) {
          const sess = agentStore.sessions.get(result.sessionId);
          selectedSessionId.value =
            sess?.parentSessionId ?? result.sessionId;
        }
      }
    }
  }
};

const tileDistance = (a: Character, b: Character): number =>
  Math.abs(a.tileX - b.tileX) + Math.abs(a.tileY - b.tileY);

const shuffle = <T>(arr: T[]): T[] => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
};

const pairIdleConversations = (
  mapData: Parameters<Character['update']>[0],
  occupied: Set<string>,
): void => {
  const candidates = characters.filter(
    ch => (ch.controlMode === 'autonomous'
        || (ch.controlMode === 'external' && ch.isCasualIdle))
      && ch.state === 'idle'
      && ch.idleElapsed >= 1
      && !ch.pendingConversationTarget
      && !ch.isLeaving,
  );

  const paired = new Set<Character>();
  for (const ch of shuffle(candidates)) {
    if (paired.has(ch)) continue;

    const nearby = candidates.find(
      other => other !== ch
        && !paired.has(other)
        && tileDistance(ch, other) <= 8,
    );
    if (!nearby) continue;

    paired.add(ch);
    paired.add(nearby);

    if (tileDistance(ch, nearby) <= 1) {
      const lines = getIdleConversation(
        localeStore.locale,
      );
      ch.startConversation(nearby, lines, 'initiator');
      nearby.startConversation(ch, lines, 'responder');
    } else {
      ch.walkToConversation(nearby, mapData, occupied);
    }
  }
};

const startPendingConversations = (): void => {
  for (const ch of characters) {
    const target = ch.pendingConversationTarget;
    if (!target) continue;
    if (ch.state !== 'idle') continue;

    if (
      target.state !== 'idle'
      || !(target.controlMode === 'autonomous'
        || (target.controlMode === 'external'
          && target.isCasualIdle))
      || target.isLeaving
    ) {
      ch.pendingConversationTarget = null;
      continue;
    }

    if (tileDistance(ch, target) <= 1) {
      const lines = getIdleConversation(
        localeStore.locale,
      );
      ch.startConversation(target, lines, 'initiator');
      target.startConversation(ch, lines, 'responder');
    }
  }
};

const MAX_DT_MS = 100;

const update = (time: number) => {
  const rawDt = time - lastTime;
  lastTime = time;
  const dt = Math.min(rawDt, MAX_DT_MS);

  const mapData = {
      width: mapStore.width,
      height: mapStore.height,
      layers: mapStore.layers,
      objects: mapStore.getEffectiveObjects(),
      collisionGrid: mapStore.getEffectiveCollisionGrid(),
      directionalCollisionGrid: mapStore.getEffectiveDirCollisionGrid(),
  };

  const occupied = getOccupiedCells();
  const occupiedObjIds = new Set<string>();
  for (const ch of characters) {
    if (ch.targetObjectId) occupiedObjIds.add(ch.targetObjectId);
  }
  for (const ch of characters) {
    ch.update(
      mapData, dt, occupied, occupiedObjIds,
      localeStore.locale,
    );
  }

  pairIdleConversations(mapData, occupied);
  startPendingConversations();

  const dtSec = dt / 1000;
  const hasDoors = getDoors().length > 0;

  if (hasDoors) {
    for (const ch of characters) {
      if (
        !ch.isLeaving
        && ch.controlMode !== 'external'
        && ch.spawnDoorId
        && ch.state === 'idle'
        && !ch.pendingConversationTarget
        && ch.aliveTime >= MIN_STAY_SECONDS
        && Math.random() < LEAVE_CHANCE_PER_SECOND * dtSec
      ) {
        ch.isLeaving = true;
      }
    }

    for (const ch of characters) {
      if (ch.state !== 'exited') continue;
      if (ch.conversationPartner) {
        ch.conversationPartner.finishConversing();
      }
      if (ch.controlMode === 'external') {
        const sessionId = externalNpcSessions.get(ch.id);
        if (sessionId) {
          const session = agentStore.sessions.get(sessionId);
          if (session?.dismissing) {
            session.npcId = null;
            session.driver.detach();
            if (selectedSessionId.value === sessionId) {
              selectedSessionId.value = null;
            }
          } else {
            if (selectedSessionId.value === sessionId) {
              selectedSessionId.value = null;
            }
            agentStore.removeSession(sessionId);
          }
          emojiStore.removeSessionEmoji(sessionId);
          externalNpcSessions.delete(ch.id);
        }
      }
    }

    if (followTarget?.state === 'exited') {
      followTarget = null;
    }

    characters = characters.filter(
      ch => ch.state !== 'exited',
    );

    spawnTimer += dtSec;
    if (spawnTimer >= SPAWN_CHECK_INTERVAL) {
      spawnTimer = 0;
      trySpawnFromDoors();
    }
  }

  staleCheckTimer += dtSec;
  if (staleCheckTimer >= 1) {
    staleCheckTimer = 0;
    void agentStore.checkStale();
  }

  approvalRefocusTimer += dtSec;
  if (approvalRefocusTimer >= APPROVAL_REFOCUS_INTERVAL) {
    approvalRefocusTimer = 0;
    for (const [sid, sess] of agentStore.sessions) {
      if (sess.status === 'waiting_approval' && sess.npcId) {
        focusOnSessionNpc(sid, true);
        selectedSessionId.value = sid;
        break;
      }
    }
  }

  anyWaitingApproval.value = characters.some(
    ch => ch.waitingForApproval && ch.state !== 'exited',
  );

  if (zoomTarget !== null) {
    const t = 1 - Math.exp(-ZOOM_LERP_SPEED * dt / 1000);
    camZoom += (zoomTarget - camZoom) * t;
    camPanX = zoomPivotSX - zoomPivotWX * camZoom;
    camPanY = zoomPivotSY - zoomPivotWY * camZoom;
    if (Math.abs(zoomTarget - camZoom) < 0.001) {
      camZoom = zoomTarget;
      camPanX = zoomPivotSX - zoomPivotWX * camZoom;
      camPanY = zoomPivotSY - zoomPivotWY * camZoom;
      zoomTarget = null;
    }
  }

  if (startupPanTarget && canvas.value) {
    startupPanDelay += dt;
    if (startupPanDelay >= STARTUP_PAN_DELAY_MS) {
      const goalX =
        canvas.value.width / 2 - startupPanTarget.x * camZoom;
      const goalY =
        canvas.value.height / 2 - startupPanTarget.y * camZoom;
      const t = 1 - Math.exp(-2.0 * dt / 1000);
      camPanX += (goalX - camPanX) * t;
      camPanY += (goalY - camPanY) * t;
      if (
        Math.abs(goalX - camPanX) < 0.5
        && Math.abs(goalY - camPanY) < 0.5
      ) {
        camPanX = goalX;
        camPanY = goalY;
        startupPanTarget = null;
      }
    }
  } else if (followTarget && canvas.value) {
    const ts = mapStore.tileSize;

    // Reset lookahead state when target changes
    if (followTarget !== prevFollowTarget) {
      prevFollowTarget = followTarget;
      prevFollowX = followTarget.x;
      prevFollowY = followTarget.y;
      camLookaheadX = 0;
      camLookaheadY = 0;
    }

    // Compute raw velocity (tiles/sec) from position delta
    const rawVx = dtSec > 0 ? (followTarget.x - prevFollowX) / dtSec : 0;
    const rawVy = dtSec > 0 ? (followTarget.y - prevFollowY) / dtSec : 0;
    prevFollowX = followTarget.x;
    prevFollowY = followTarget.y;

    // Smooth velocity toward current velocity; fades when character stops
    const lt = 1 - Math.exp(-CAM_LOOKAHEAD_LERP * dtSec);
    camLookaheadX += (rawVx / CHAR_MOVE_SPEED * CAM_LOOKAHEAD_TILES - camLookaheadX) * lt;
    camLookaheadY += (rawVy / CHAR_MOVE_SPEED * CAM_LOOKAHEAD_TILES - camLookaheadY) * lt;

    const targetWorldX = (followTarget.x + camLookaheadX) * ts + ts / 2;
    const targetWorldY = (followTarget.y + camLookaheadY) * ts + ts / 2;
    // Use final zoom for goal pan so the target doesn't shift while zoom animates
    const goalZoom = followZoomTarget ?? camZoom;
    const goalPanX =
      canvas.value.width / 2 - targetWorldX * goalZoom;
    const goalPanY =
      canvas.value.height / 2 - targetWorldY * goalZoom + ts * goalZoom * 1.0;
    const t = 1 - Math.exp(-CAM_LERP_SPEED * dt / 1000);
    camPanX += (goalPanX - camPanX) * t;
    camPanY += (goalPanY - camPanY) * t;

    if (followZoomTarget !== null) {
      const zt = 1 - Math.exp(-ZOOM_LERP_SPEED * dt / 1000);
      camZoom += (followZoomTarget - camZoom) * zt;
      if (Math.abs(followZoomTarget - camZoom) < 0.001) {
        camZoom = followZoomTarget;
        followZoomTarget = null;
      }
    }
  }

  for (const [npcId, sid] of externalNpcSessions) {
    const sess = agentStore.sessions.get(sid);
    if (!sess?.nameTag) continue;
    const ch = characters.find(c => c.id === npcId);
    if (ch && !ch.nameTag) {
      ch.nameTag = sess.nameTag;
    }
  }

  for (const [npcId, sid] of externalNpcSessions) {
    const sess = agentStore.sessions.get(sid);
    if (!sess?.parentSessionId) continue;
    const parent = agentStore.sessions.get(sess.parentSessionId);
    if (!parent?.nameTag) continue;
    const ch = characters.find(c => c.id === npcId);
    const expected = subagentNameTag(parent.nameTag);
    if (ch && ch.nameTag !== expected) {
      ch.nameTag = expected;
    }
  }

  render();
  animationId = requestAnimationFrame(update);
};

const render = () => {
  const ctx = canvas.value?.getContext('2d');
  if (!ctx || !canvas.value) return;

  ctx.imageSmoothingEnabled = false;

  // Clear in screen space
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.value.width, canvas.value.height);

  // Apply camera transform (snap to integer pixels to avoid sub-pixel shimmer)
  ctx.save();
  ctx.setTransform(
    camZoom, 0, 0, camZoom,
    Math.round(camPanX), Math.round(camPanY),
  );

  // Helpers: snap world coords to screen-pixel boundaries to prevent tile seams
  const snap = (n: number) => Math.round(n * camZoom) / camZoom;
  const snapSz = (a: number, b: number) =>
    (Math.round(b * camZoom) - Math.round(a * camZoom)) / camZoom;

  // Draw ground layer (first)
  if (mapStore.layers.length > 0) {
    drawLayer(ctx, 0);
  }

  const layerCount = mapStore.layers.length;
  const renderables: {
    y: number;
    draw: (c: CanvasRenderingContext2D) => void;
  }[] = [];

  // Middle layers (1+) contribute Y-sorted tiles with depth overrides
  for (let li = 1; li < layerCount; li++) {
    const midLayer = mapStore.layers[li];
    if (!midLayer) continue;
    for (let y = 0; y < mapStore.height; y++) {
      const row = midLayer[y];
      if (!row) continue;
      for (let x = 0; x < mapStore.width; x++) {
        const cell = row[x];
        if (!cell) continue;
        const tileY = y;
        const tileX = x;
        const ts = mapStore.tileSize;
        if (isRegularTile(cell)) {
          const img = mapStore.getSlotImage(cell.slot);
          if (img) {
            const depth = mapStore.getTileDepth(
              cell.slot, cell.x, cell.y,
            );
            let sortY: number;
            if (depth === -1) {
              sortY = -1;
            } else if (depth === 2) {
              sortY = mapStore.height * ts + ts + 1;
            } else if (depth === 1) {
              sortY = tileY * ts + ts * 2 - 1;
            } else {
              sortY = tileY * ts + ts;
            }
            renderables.push({
              y: sortY,
              draw: (c) => {
                drawTileTransformed(
                  c, img,
                  cell.x * ts, cell.y * ts, ts, ts,
                  snap(tileX * ts), snap(tileY * ts),
                  snapSz(tileX * ts, (tileX + 1) * ts),
                  snapSz(tileY * ts, (tileY + 1) * ts),
                  cell.flipX ?? false, cell.flipY ?? false, cell.rotation ?? 0,
                );
              },
            });
          }
        } else if (isAutoTile(cell)) {
          const atSlot = mapStore.autoTilePool[
            cell.autoTileIndex
          ];
          if (atSlot?.image) {
            const atImg = atSlot.image;
            const atType = atSlot.type;
            const atDepth = mapStore.getAutoTileDepth(
              cell.autoTileIndex,
            );
            const variant = mapStore.getAutoTileVariant(
              li, tileX, tileY, cell.autoTileIndex,
            );
            const wv = atType === 'C'
              ? mapStore.getWallVariant(
                li, tileX, tileY, cell.autoTileIndex,
              )
              : undefined;
            const mh = mapStore.height;
            let sortY: number;
            if (atDepth === -1 || (atDepth === 0 && atType === 'C')) {
              sortY = -1;
            } else if (atDepth === 2) {
              sortY = mh * ts + ts + 1;
            } else if (atDepth === 1) {
              sortY = tileY * ts + ts * 2 - 1;
            } else {
              sortY = tileY * ts + ts;
            }
            renderables.push({
              y: sortY,
              draw: (c) => {
                drawAutoTileCell(
                  c, atImg, variant,
                  snap(tileX * ts), snap(tileY * ts),
                  ts, atType, wv,
                  tileY, mh, camZoom, tileX,
                );
              },
            });
          }
        }
      }
    }
  }

  // Interactive objects are not rendered in run mode —
  // they exist only for agent interaction logic

  // Add Characters
  for (const ch of characters) {
    renderables.push({
      y: ch.y * mapStore.tileSize + mapStore.tileSize,
      draw: (c) => drawCharacter(c, ch),
    });
  }

  // Sort and draw
  renderables.sort((a, b) => a.y - b.y);
  renderables.forEach(r => r.draw(ctx));

  // Draw animated dotted lines from parent NPCs to subagent NPCs
  drawSubagentLinks(ctx, performance.now() / 1000);

  // Draw alert indicators, Zzz, and bubbles on top
  const ts = mapStore.tileSize;
  const now = performance.now() / 1000;
  for (const ch of characters) {
    const screenX = ch.x * ts;
    const chDh = ch.cellHeight * RENDER_SCALE * ch.renderScale;
    const destY = ch.y * ts + ts - chDh;
    const hasAlert = ch.waitingForApproval;
    const hasZzz = ch.showZzz && !hasAlert;

    if (hasAlert) {
      drawAlertIndicator(
        ctx,
        screenX + ts / 2,
        destY - 4,
        now,
      );
    }

    if (hasZzz) {
      drawIdleIndicator(
        ctx,
        screenX + ts / 2,
        destY - 4,
        now,
        ch.controlMode === 'external',
      );
    }

    if (ch.bubbleText) {
      const bubbleShift = hasAlert ? 14 : 0;
      drawBubble(
        ctx,
        screenX + ts / 2,
        destY - 2 - bubbleShift,
        ch.bubbleText,
        ch.bubbleType,
        now,
      );
    }

    if (
      ch.nameTag
      && !hasAlert && !hasZzz && !ch.bubbleText
    ) {
      drawNameTag(
        ctx, screenX + ts / 2, destY - 2, ch.nameTag,
      );
    }

    if (ch.badge) {
      const nameVisible = ch.nameTag
        && !hasAlert && !hasZzz && !ch.bubbleText;
      const badgeY = nameVisible ? destY - 16 : destY;
      ctx.save();
      ctx.font = `${ts * 0.6}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(ch.badge, screenX + ts / 2, badgeY);
      ctx.restore();
    }

    if (ch.sessionEmoji) {
      const r = 9;
      const cx = screenX - r + 2;
      const cy = destY + r + 1 + Math.sin(now * 2.5) * 3;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = 'black';
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.font = `11px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ch.sessionEmoji, cx, cy);
      ctx.restore();
    }

    if (ch.soundIndicatorTimer > 0) {
      const alpha = Math.min(1, ch.soundIndicatorTimer);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `${ts * 0.5}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('🔊', screenX + ts - 2, destY - 2);
      ctx.restore();
    }
  }

  ctx.restore();
};

const drawWallQuadrants = (
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  quad: [number, number, number, number],
  destX: number,
  destY: number,
  ht: number,
  zoom = 1,
  snapEndX?: number,
  snapEndY?: number,
) => {
  const midX = Math.round((destX + ht) * zoom) / zoom;
  const midY = Math.round((destY + ht) * zoom) / zoom;
  const endX = snapEndX ?? Math.round((destX + ht * 2) * zoom) / zoom;
  const endY = snapEndY ?? Math.round((destY + ht * 2) * zoom) / zoom;
  const xs = [destX, midX] as const;
  const ys = [destY, midY] as const;
  const ws = [midX - destX, endX - midX] as const;
  const hs = [midY - destY, endY - midY] as const;
  for (let qi = 0; qi < 4; qi++) {
    const pos = quad[qi]!;
    const { srcX, srcY } = wallSubTileToPixels(pos, ht);
    const xi = qi % 2;
    const yi = Math.floor(qi / 2);
    ctx.drawImage(
      image, srcX, srcY, ht, ht,
      xs[xi]!, ys[yi]!, ws[xi]!, hs[yi]!,
    );
  }
};

// Compute a grid-aligned snap to avoid compounding rounding errors.
// When gridCoord is provided, snapping is done from the original integer
// grid position rather than from an already-rounded destX/destY.
const gridSnap = (gridCoord: number, ts: number, offset: number, zoom: number) =>
  Math.round((gridCoord * ts + offset) * zoom) / zoom;

const drawAutoTileCell = (
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  variant: [number, number, number, number],
  destX: number,
  destY: number,
  ts: number,
  type: AutoTileType = 'A',
  wv?: WallVariants,
  gridY?: number,
  gridH?: number,
  zoom = 1,
  gridX?: number,
) => {
  const ht = ts / 2;
  const toPixels = type === 'B' || type === 'C'
    ? subTileToPixelsB : subTileToPixels;
  // Snap internal boundaries from original grid coords to avoid the
  // compounding error: Math.round(snap(x*ts) + ts) ≠ Math.round((x+1)*ts).
  const x1 = gridX !== undefined
    ? gridSnap(gridX, ts, ht, zoom)
    : Math.round((destX + ht) * zoom) / zoom;
  const y1 = gridY !== undefined
    ? gridSnap(gridY, ts, ht, zoom)
    : Math.round((destY + ht) * zoom) / zoom;
  const x2 = gridX !== undefined
    ? gridSnap(gridX + 1, ts, 0, zoom)
    : Math.round((destX + ts) * zoom) / zoom;
  const y2 = gridY !== undefined
    ? gridSnap(gridY + 1, ts, 0, zoom)
    : Math.round((destY + ts) * zoom) / zoom;
  const xs = [destX, x1] as const;
  const ys = [destY, y1] as const;
  const ws = [x1 - destX, x2 - x1] as const;
  const hs = [y1 - destY, y2 - y1] as const;
  for (let qi = 0; qi < 4; qi++) {
    const pos = variant[qi]!;
    const { srcX, srcY } = toPixels(pos, ht);
    const xi = qi % 2;
    const yi = Math.floor(qi / 2);
    ctx.drawImage(
      image, srcX, srcY, ht, ht,
      xs[xi]!, ys[yi]!, ws[xi]!, hs[yi]!,
    );
  }
  if (wv) {
    // y2 = snap((gridY+1)*ts) — correct start of upper wall row
    const wallUpperY = y2;
    const wallLowerY = gridY !== undefined
      ? gridSnap(gridY + 2, ts, 0, zoom)
      : Math.round((destY + ts * 2) * zoom) / zoom;
    const wallEndY = gridY !== undefined
      ? gridSnap(gridY + 3, ts, 0, zoom)
      : undefined;
    if (gridH === undefined || gridY === undefined
      || gridY + 1 < gridH) {
      drawWallQuadrants(
        ctx, image, wv.upper, destX, wallUpperY, ht, zoom, x2, wallLowerY,
      );
    }
    if (gridH === undefined || gridY === undefined
      || gridY + 2 < gridH) {
      drawWallQuadrants(
        ctx, image, wv.lower, destX, wallLowerY, ht, zoom, x2, wallEndY,
      );
    }
  }
};

const drawTileTransformed = (
  c: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  srcX: number, srcY: number, srcW: number, srcH: number,
  dx: number, dy: number, dw: number, dh: number,
  flipX: boolean, flipY: boolean, rotation: 0 | 90 | 180 | 270,
) => {
  if (!flipX && !flipY && rotation === 0) {
    c.drawImage(img, srcX, srcY, srcW, srcH, dx, dy, dw, dh);
    return;
  }
  c.save();
  c.translate(dx + dw / 2, dy + dh / 2);
  if (rotation !== 0) c.rotate((rotation * Math.PI) / 180);
  if (flipX) c.scale(-1, 1);
  if (flipY) c.scale(1, -1);
  c.drawImage(img, srcX, srcY, srcW, srcH, -dw / 2, -dh / 2, dw, dh);
  c.restore();
};

const drawLayer = (ctx: CanvasRenderingContext2D, layerIndex: number) => {
  const layer = mapStore.layers[layerIndex];
  if (!layer) return;

  const ts = mapStore.tileSize;
  const z = camZoom;
  const snap = (n: number) => Math.round(n * z) / z;
  const snapSz = (a: number, b: number) =>
    (Math.round(b * z) - Math.round(a * z)) / z;
  for (let y = 0; y < layer.length; y++) {
    const row = layer[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) {
      const cell = row[x];
      if (!cell) continue;
      if (isRegularTile(cell)) {
        const img = mapStore.getSlotImage(cell.slot);
        if (img) {
          drawTileTransformed(
            ctx, img,
            cell.x * ts, cell.y * ts, ts, ts,
            snap(x * ts), snap(y * ts),
            snapSz(x * ts, (x + 1) * ts),
            snapSz(y * ts, (y + 1) * ts),
            cell.flipX ?? false, cell.flipY ?? false, cell.rotation ?? 0,
          );
        }
      } else if (isAutoTile(cell)) {
        const atSlot = mapStore.autoTilePool[
          cell.autoTileIndex
        ];
        if (!atSlot?.image) continue;
        const variant = mapStore.getAutoTileVariant(
          layerIndex, x, y, cell.autoTileIndex,
        );
        const wv = atSlot.type === 'C'
          ? mapStore.getWallVariant(
            layerIndex, x, y, cell.autoTileIndex,
          )
          : undefined;
        drawAutoTileCell(
          ctx, atSlot.image, variant,
          snap(x * ts), snap(y * ts), ts, atSlot.type, wv,
          y, layer.length, z, x,
        );
      }
    }
  }
};

const RENDER_SCALE = 2;
const OUTLINE_PX = 2;

const outlineCanvas = document.createElement('canvas');
const outlineCtx = outlineCanvas.getContext('2d')!;
outlineCtx.imageSmoothingEnabled = false;

const OUTLINE_OFFSETS: [number, number][] = [
  [-1, -1], [0, -1], [1, -1],
  [-1,  0],          [1,  0],
  [-1,  1], [0,  1], [1,  1],
];

const drawSpriteToOffscreen = (
  sprite: HTMLImageElement,
  srcX: number, srcY: number,
  fw: number, fh: number,
  dw: number, dh: number,
  flipX: boolean,
) => {
  const oc = outlineCtx;
  const padX = OUTLINE_PX;
  const padY = OUTLINE_PX;

  const needW = dw + OUTLINE_PX * 2;
  const needH = dh + OUTLINE_PX * 2;
  if (
    outlineCanvas.width < needW
    || outlineCanvas.height < needH
  ) {
    outlineCanvas.width = needW;
    outlineCanvas.height = needH;
  }

  oc.imageSmoothingEnabled = false;
  oc.clearRect(
    0, 0, outlineCanvas.width, outlineCanvas.height,
  );

  for (const [ox, oy] of OUTLINE_OFFSETS) {
    oc.save();
    if (flipX) {
      oc.translate(padX + dw + ox, padY + oy);
      oc.scale(-1, 1);
    } else {
      oc.translate(padX + ox, padY + oy);
    }
    oc.drawImage(
      sprite, srcX, srcY, fw, fh,
      0, 0, dw, dh,
    );
    oc.restore();
  }

  oc.globalCompositeOperation = 'source-in';
  oc.fillStyle = 'white';
  oc.fillRect(0, 0, needW, needH);
  oc.globalCompositeOperation = 'source-over';

  oc.save();
  if (flipX) {
    oc.translate(padX + dw, padY);
    oc.scale(-1, 1);
  } else {
    oc.translate(padX, padY);
  }
  oc.drawImage(
    sprite, srcX, srcY, fw, fh,
    0, 0, dw, dh,
  );
  oc.restore();
};

const drawCharacter = (
  ctx: CanvasRenderingContext2D,
  ch: Character,
) => {
    const ts = mapStore.tileSize;
    const sprite = spriteImageCache.get(ch.characterDefinitionId);
    if (!sprite) return;

    const fw = ch.cellWidth;
    const fh = ch.cellHeight;
    const s = ch.renderScale;
    const dw = fw * RENDER_SCALE * s;
    const dh = fh * RENDER_SCALE * s;

    const { col, row, flipX } = ch.getSpriteFrame();
    const srcX = col * fw;
    const srcY = row * fh;

    const screenX = ch.x * ts;
    const destX = screenX + (ts - dw) / 2;
    const destY = ch.y * ts + ts - dh;

    if (followTarget === ch) {
      drawSpriteToOffscreen(
        sprite, srcX, srcY, fw, fh, dw, dh, flipX,
      );
      const ocW = dw + OUTLINE_PX * 2;
      const ocH = dh + OUTLINE_PX * 2;
      ctx.drawImage(
        outlineCanvas,
        0, 0, ocW, ocH,
        destX - OUTLINE_PX, destY - OUTLINE_PX,
        ocW, ocH,
      );
    } else {
      ctx.save();
      if (flipX) {
        ctx.translate(destX + dw, destY);
        ctx.scale(-1, 1);
        ctx.drawImage(
          sprite,
          srcX, srcY, fw, fh,
          0, 0, dw, dh,
        );
      } else {
        ctx.drawImage(
          sprite,
          srcX, srcY, fw, fh,
          destX, destY, dw, dh,
        );
      }
      ctx.restore();
    }

}

const drawIdleIndicator = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  time: number,
  isExternal: boolean,
) => {
  if (isExternal) {
    drawWaitingDots(ctx, x, y, time);
  } else {
    drawZzzText(ctx, x, y, time);
  }
};

const drawZzzText = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  time: number,
) => {
  const bob = Math.sin(time * 1.5) * 2;
  const cy = y + bob;

  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  ctx.strokeStyle = 'white';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeText('Zzz', x, cy);

  ctx.fillStyle = '#4f46e5';
  ctx.fillText('Zzz', x, cy);
  ctx.restore();
};

const DOT_COUNT = 3;
const DOT_RADIUS = 2.5;
const DOT_GAP = 6;
const DOT_PHASE_OFFSET = 0.6;

const drawWaitingDots = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  time: number,
) => {
  ctx.save();
  ctx.globalAlpha = 0.5;
  const totalW = (DOT_COUNT - 1) * DOT_GAP;
  const startX = x - totalW / 2;
  const baseY = y - 6;

  for (let i = 0; i < DOT_COUNT; i++) {
    const phase = time * 3 + i * DOT_PHASE_OFFSET;
    const bob = Math.sin(phase) * 3;
    const dx = startX + i * DOT_GAP;
    const dy = baseY + bob;

    ctx.beginPath();
    ctx.arc(dx, dy, DOT_RADIUS + 1.5, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(dx, dy, DOT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = '#4f46e5';
    ctx.fill();
  }
  ctx.restore();
};

const ALERT_ITEMS = 3;

const drawAlertIndicator = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  time: number,
) => {
  ctx.save();
  const totalW = (ALERT_ITEMS - 1) * DOT_GAP;
  const startX = x - totalW / 2;
  const baseY = y - 6;

  for (let i = 0; i < ALERT_ITEMS; i++) {
    const phase = time * 3 + i * DOT_PHASE_OFFSET;
    const bob = Math.sin(phase) * 3;
    const dx = startX + i * DOT_GAP;
    const dy = baseY + bob;

    if (i < 2) {
      ctx.beginPath();
      ctx.arc(dx, dy, DOT_RADIUS + 1.5, 0, Math.PI * 2);
      ctx.fillStyle = 'white';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(dx, dy, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = '#e11d48';
      ctx.fill();
    } else {
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeText('!', dx, dy);
      ctx.fillStyle = '#e11d48';
      ctx.fillText('!', dx, dy);
    }
  }
  ctx.restore();
};

const drawNameTag = (
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  text: string,
) => {
  ctx.save();
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  const padding = 4;
  const metrics = ctx.measureText(text);
  const w = metrics.width + padding * 2;
  const h = 14;

  const mapW = mapStore.width * mapStore.tileSize;
  const bx = Math.max(0, Math.min(x - w / 2, mapW - w));
  const by = y - h + 3;

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 3);
  ctx.fill();

  ctx.fillStyle = 'white';
  ctx.fillText(text, bx + w / 2, by + h - 2);
  ctx.restore();
};

const drawSubagentLinks = (
  ctx: CanvasRenderingContext2D,
  time: number,
) => {
  const ts = mapStore.tileSize;
  const scale = 1 / camZoom;
  for (const [, session] of agentStore.sessions) {
    if (session.subagentIds.length === 0) continue;
    const parent = session.npcId
      ? characters.find(c => c.id === session.npcId)
      : undefined;
    if (!parent) continue;
    for (const subId of session.subagentIds) {
      const subSession = agentStore.sessions.get(subId);
      const child = subSession?.npcId
        ? characters.find(c => c.id === subSession.npcId)
        : undefined;
      if (!child) continue;
      const px = parent.x * ts + ts / 2;
      const py = parent.y * ts + ts / 2;
      const cx = child.x * ts + ts / 2;
      const cy = child.y * ts + ts / 2;
      ctx.save();
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.35)';
      ctx.lineWidth = 2 * scale;
      ctx.setLineDash([6 * scale, 4 * scale]);
      ctx.lineDashOffset = -time * 30;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.restore();
    }
  }
};

const drawBubble = (
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  text: string,
  type: 'speech' | 'thought',
  time: number,
) => {
    ctx.font = 'bold 11px sans-serif';
    const padding = 8;
    const metrics = ctx.measureText(text);
    const w = metrics.width + padding * 2;
    const h = 22;

    const floatY = type === 'thought'
      ? Math.sin(time * 2.5) * 3
      : 0;

    // Clamp position so bubble stays within map bounds
    const mapW = mapStore.width * mapStore.tileSize;
    const bx = Math.max(2, Math.min(x - w / 2, mapW - w - 2));
    const by = Math.max(2, y - h - 10) + floatY;

    ctx.save();

    // Shadow for legibility
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;

    ctx.fillStyle = 'white';
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;

    ctx.beginPath();
    if (type === 'speech') {
        ctx.roundRect(bx, by, w, h, 6);
        ctx.fill();
        ctx.stroke();
        // Tail
        ctx.shadowColor = 'transparent';
        ctx.beginPath();
        ctx.moveTo(x - 4, by + h);
        ctx.lineTo(x, by + h + 6);
        ctx.lineTo(x + 4, by + h);
        ctx.closePath();
        ctx.fillStyle = 'white';
        ctx.fill();
        ctx.strokeStyle = '#555';
        ctx.stroke();
        // Cover inner tail border
        ctx.fillRect(x - 3, by + h - 1, 6, 2);
    } else {
        ctx.roundRect(bx, by, w, h, 10);
        ctx.fill();
        ctx.stroke();
        // Thought dots with cascading bob
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = 'white';
        ctx.strokeStyle = '#555';
        const dot1Y = Math.sin(time * 3.0) * 3;
        const dot2Y = Math.sin(time * 3.0 + 1.2) * 3;
        ctx.beginPath();
        ctx.arc(x - 1, by + h + 4 + dot1Y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + 3, by + h + 9 + dot2Y, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }

    ctx.restore();

    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + w / 2, by + h / 2);
}

onMounted(async () => {
  try {
    await initDebugLog();
  } catch (err) {
    console.error('[RunView] initDebugLog failed:', err);
  }
  void pruneOldEvents(24 * 60 * 60 * 1000);

  // If mapStore has no tilesets loaded (e.g. direct page refresh), load from file
  const hasPoolTileset = Object.values(mapStore.tilesetPool).some(
    s => s.blob !== null,
  );
  if (!hasPoolTileset) {
    const filePath = localStorage.getItem(AITO_FILE_PATH_KEY);
    if (filePath) {
      try {
        await invoke('allow_file_scope', { path: filePath });
        const result = await loadMapFromPath(filePath);

        mapStore.tileSize = result.mapData.tileSize ?? DEFAULT_TILE_SIZE;
        mapStore.width = result.mapData.width;
        mapStore.height = result.mapData.height;
        mapStore.layers = result.mapData.layers;
        mapStore.layerMeta = result.mapData.layerMeta
          ?? result.mapData.layers.map((_: unknown, i: number) => ({
            name: `Layer ${i + 1}`,
            visible: true,
          }));
        mapStore.objects = result.mapData.objects;
        mapStore.collisionGrid = result.mapData.collisionGrid
          ?? Array.from({ length: result.mapData.height }, () =>
              Array(result.mapData.width).fill(false) as boolean[],
            );
        mapStore.dirCollisionGrid =
          result.mapData.directionalCollisionGrid
          ?? Array.from({ length: result.mapData.height }, () =>
              new Array<number>(result.mapData.width).fill(0),
            );
        mapStore.tileDirCollisionMaps =
          result.mapData.tileDirCollisionMaps ?? {};
        mapStore.spawnPoints = result.mapData.spawnPoints ?? [];
        mapStore.tileDepthMaps = result.mapData.tileDepthMaps ?? {};
        mapStore.tileCollisionMaps =
          result.mapData.tileCollisionMaps ?? {};
        mapStore.tileInteractiveMaps =
          result.mapData.tileInteractiveMaps ?? {};

        const tilesetLoads: Promise<void>[] = [];
        for (const [slot, blob] of Object.entries(result.poolBlobs)) {
          if (blob) tilesetLoads.push(mapStore.setTilesetSlot(slot, blob));
        }
        await Promise.all(tilesetLoads);

        mapStore.autoTilePool = [];
        for (const entry of result.autoTileEntries) {
          if (entry.blob) {
            const atType = entry.type === 'B' ? 'B'
              : entry.type === 'C' ? 'C' : 'A';
            const idx = await mapStore.addAutoTile(
              entry.blob, atType,
              entry.sourceBlob, entry.sourceCol, entry.sourceRow,
            );
            if (entry.depthMap || entry.collisionMap) {
              const pool = [...mapStore.autoTilePool];
              const slot = pool[idx];
              if (slot) {
                pool[idx] = {
                  ...slot,
                  depthMap: (entry.depthMap ?? {}) as DepthMap,
                  collisionMap: entry.collisionMap ?? {},
                };
                mapStore.autoTilePool = pool;
              }
            }
          }
        }

        if (result.characterDefinitions) {
          characterStore.setCharacters(result.characterDefinitions);
        }
      } catch (err) {
        console.error('[RunView] file load failed:', err);
      }
    }
  }

  if (canvas.value) {
    canvas.value.width = window.innerWidth;
    canvas.value.height = window.innerHeight;
    canvas.value.addEventListener('wheel', handleWheel, { passive: false });
  }
  window.addEventListener('resize', () => {
    if (canvas.value) {
      canvas.value.width = window.innerWidth;
      canvas.value.height = window.innerHeight;
    }
  });

  if (characterStore.characters.length === 0) {
    const fallbacks = await createFallbackDefinitions();
    characterStore.setCharacters(fallbacks);
  }
  await Promise.all(
    characterStore.characters.map(loadDefinitionSprite),
  );
  initCharacters();
  if (!hasSavedCamera) {
    fitCameraToView();
    initStartupPan();
  }
  if (alwaysOnTop.value) {
    void getCurrentWindow().setAlwaysOnTop(true);
  }
  lastTime = performance.now();
  animationId = requestAnimationFrame(update);

  agentUnlisten = await listen<string>('agent-event', (e) => {
    void handleAgentEvent(e.payload);
  });
  restoreUnlisten = await listen<string>(
    'agent-session-restore', (e) => {
      void handleSessionRestore(e.payload);
    },
  );

  const staleSessionIds = agentStore.detachAllNpcs();
  for (const sessionId of staleSessionIds) {
    spawnAgentNpc(sessionId);
  }

  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (
      target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
    ) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void router.push('/');
    } else if (e.key === 'F5') {
      e.preventDefault();
      window.location.reload();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (selectedSessionId.value) {
        selectedSessionId.value = null;
        followTarget = null;
      }
    } else if (e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      autoFollow.value = !autoFollow.value;
      flashControls();
    } else if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      void toggleAlwaysOnTop();
      flashControls();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      cycleAgent(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      cycleAgent(-1);
    }
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', saveCamera);
  onUnmounted(() => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('beforeunload', saveCamera);
  });
});

function handleDocumentClick(e: MouseEvent) {
  if (controlsExpanded.value && controlsRef.value && !controlsRef.value.contains(e.target as Node)) {
    controlsExpanded.value = false;
    if (controlsCloseTimer) {
      clearTimeout(controlsCloseTimer);
      controlsCloseTimer = null;
    }
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleDocumentClick);
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleDocumentClick);
  saveCamera();
  cancelAnimationFrame(animationId);
  canvas.value?.removeEventListener('wheel', handleWheel);
  agentUnlisten?.();
  restoreUnlisten?.();
  if (controlsCloseTimer) clearTimeout(controlsCloseTimer);
  stopDebugLog();
});
</script>

<template>
  <div class="h-screen w-screen bg-black relative overflow-hidden select-none">
    <div data-tauri-drag-region class="absolute top-0 left-0 right-0 h-10 z-40" />
    <canvas
      ref="canvas"
      class="block"
      style="image-rendering: pixelated;"
      :style="{ cursor: isDragging ? 'grabbing' : 'grab' }"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerUp"
      @dblclick="handleDoubleClick"
    ></canvas>
    <div class="absolute top-12 left-4 z-50 flex flex-col items-start gap-1">
      <div
        ref="controlsRef"
        class="flex items-center gap-2"
        @mouseenter="openControls"
        @mouseleave="scheduleCloseControls"
      >
        <button
          v-if="!controlsExpanded"
          class="w-8 h-8 rounded-full text-white/50 flex items-center justify-center hover:text-white transition-colors text-base leading-none"
          style="filter: drop-shadow(0 1px 3px rgba(0,0,0,0.9));"
        >›</button>
        <Transition name="slide-controls">
          <div v-if="controlsExpanded" class="flex flex-wrap items-center gap-1.5 max-w-[calc(100vw-4rem)]">
          <router-link
            to="/"
            class="h-8 px-3 flex items-center bg-gray-800/80 text-white text-sm rounded border border-gray-600 hover:bg-gray-700 transition-colors whitespace-nowrap"
          >Back to Editor</router-link>
          <select
            :value="localeStore.locale"
            class="h-8 px-2 bg-gray-800/80 text-white rounded border border-gray-600 text-sm cursor-pointer hover:bg-gray-700 transition-colors"
            @change="(e: Event) => localeStore.setLocale((e.target as HTMLSelectElement).value as Locale)"
          >
            <option
              v-for="opt in LOCALE_OPTIONS"
              :key="opt.value"
              :value="opt.value"
            >{{ opt.label }}</option>
          </select>
          <button
            class="h-8 px-3 flex items-center bg-gray-800/80 text-white text-sm rounded border border-gray-600 hover:bg-gray-700 transition-colors whitespace-nowrap"
            @click="resetCamera"
          >Reset Camera</button>
          <button
            class="h-8 px-3 flex items-center text-sm rounded border transition-colors whitespace-nowrap"
            :class="autoFollow
              ? 'bg-indigo-600/80 text-white border-indigo-500 hover:bg-indigo-500/80'
              : 'bg-gray-800/80 text-gray-400 border-gray-600 hover:bg-gray-700/80'"
            @click="autoFollow = !autoFollow"
          >Auto</button>
          <button
            class="h-8 px-3 flex items-center text-sm rounded border transition-colors whitespace-nowrap"
            :class="alwaysOnTop
              ? 'bg-indigo-600/80 text-white border-indigo-500 hover:bg-indigo-500/80'
              : 'bg-gray-800/80 text-gray-400 border-gray-600 hover:bg-gray-700/80'"
            @click="toggleAlwaysOnTop"
          >Pin</button>
        </div>
        </Transition>
      </div>
      <button
        class="w-8 h-7 rounded-full text-white/50 flex items-center justify-center hover:text-white transition-colors text-sm leading-none"
        style="filter: drop-shadow(0 1px 3px rgba(0,0,0,0.9));"
        @click="zoomAroundCenter(DOUBLE_CLICK_ZOOM_FACTOR)"
      >+</button>
      <button
        class="w-8 h-7 rounded-full text-white/50 flex items-center justify-center hover:text-white transition-colors text-sm leading-none"
        style="filter: drop-shadow(0 1px 3px rgba(0,0,0,0.9));"
        @click="zoomAroundCenter(1 / DOUBLE_CLICK_ZOOM_FACTOR)"
      >−</button>
    </div>
    <div
      v-if="activeAgentSessions.length > 0"
      class="absolute top-2 right-2 z-50 flex flex-col items-end gap-0.5"
      style="text-shadow: 0 1px 3px rgba(0,0,0,0.8), 0 0 6px rgba(0,0,0,0.5);"
    >
      <div
        v-for="agent in activeAgentSessions"
        :key="agent.sessionId"
        class="flex items-center gap-1"
      >
        <span
          class="inline-block w-1.5 h-1.5 rounded-full shrink-0"
          :class="agent.status === 'working'
            ? 'bg-green-400'
            : 'bg-gray-400'"
        />
        <button
          class="font-mono text-xs transition-colors whitespace-nowrap"
          :class="selectedSessionId === agent.sessionId
            ? 'text-white'
            : 'text-gray-500 hover:text-gray-300'"
          @click="selectAgent(agent.sessionId)"
          @dblclick="zoomToNpc(agent.sessionId)"
        >{{ agent.name }}</button>
        <button
          v-if="agent.status === 'idle' && !agent.dismissing"
          class="text-gray-600 hover:text-red-400 text-xs leading-none"
          title="Dismiss agent"
          @click.stop="dismissAgent(agent.sessionId)"
        >&times;</button>
      </div>
    </div>
    <AgentActivityPanel
      v-if="selectedSessionId"
      :session-id="selectedSessionId"
      v-model:pinned="panelPinned"
    />
    <!-- Floating sound button (bottom-right) -->
    <div
      class="absolute bottom-3 right-3 z-[80] flex flex-col items-end gap-1 group"
    >
      <!-- Panel (opened via settings button) -->
      <div v-if="soundQuickPanelOpen" class="mb-1">
        <SoundQuickPanel
          :show-settings="soundSettingsOpen"
          @update:show-settings="soundSettingsOpen = $event"
        />
      </div>
      <!-- Settings button — appears on hover -->
      <button
        class="w-9 h-9 flex items-center justify-center rounded-full border transition-all shadow-md
               opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0
               bg-gray-800/90 text-gray-400 border-gray-600 hover:text-white hover:bg-gray-700"
        title="Sound settings"
        @click="soundQuickPanelOpen = !soundQuickPanelOpen"
      >
        <Settings :size="16" />
      </button>
      <!-- Speaker button — click to mute/unmute -->
      <button
        class="w-9 h-9 flex items-center justify-center rounded-full border transition-colors shadow-lg"
        :class="soundStore.config.enabled
          ? 'bg-gray-800/90 text-white border-gray-600 hover:bg-gray-700'
          : 'bg-gray-800/90 text-gray-500 border-gray-600 hover:bg-gray-700'"
        :title="soundStore.config.enabled ? 'Mute' : 'Unmute'"
        @click="soundStore.config.enabled = !soundStore.config.enabled; void soundStore.saveConfig()"
      >
        <Volume2 v-if="soundStore.config.enabled" :size="16" />
        <VolumeX v-else :size="16" />
      </button>
    </div>

    <Transition name="vignette">
      <div
        v-if="anyWaitingApproval"
        class="fixed inset-0 z-[9999] pointer-events-none vignette-pulse"
      />
    </Transition>
  </div>
</template>

<style scoped>
.slide-controls-enter-active,
.slide-controls-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.slide-controls-enter-from,
.slide-controls-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}

.vignette-pulse {
  box-shadow: inset 0 0 80px 30px rgba(220, 38, 38, 0.3);
  animation: vignette-throb 2s ease-in-out infinite;
}

@keyframes vignette-throb {
  0%, 100% { box-shadow: inset 0 0 80px 30px rgba(220, 38, 38, 0.25); }
  50% { box-shadow: inset 0 0 100px 40px rgba(220, 38, 38, 0.4); }
}

.vignette-enter-active { transition: opacity 0.5s ease; }
.vignette-leave-active { transition: opacity 0.8s ease; }
.vignette-enter-from,
.vignette-leave-to { opacity: 0; }
</style>
