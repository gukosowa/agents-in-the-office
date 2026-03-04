import {
  DOOR_TYPES,
  type Direction, type InteractiveObject, type MapData,
} from '../types';
import { findPath, isDirPassable, type Point } from '../utils/pathfinding';
import type { Locale } from '../stores/localeStore';
import {
  getWalkingThoughts,
  getArrivalSpeech,
  getWanderThoughts,
  getLeavingThoughts,
} from '../i18n/bubbleTexts';
import {
  type NpcCommand,
  isMovementCommand,
} from '../drivers/types';
import { debugLog } from '../utils/debugLog';
import type {
  SpriteLayoutType,
  SpriteRegion,
  ActionDefinition,
} from '../types/character';

const OBJECT_TYPE_TO_ACTION: Record<string, string> = {
  computer: 'programming',
  desk: 'programming',
  books: 'reading',
  book: 'reading',
  chair: 'sitting',
  coffee: 'looking',
  plant: 'looking',
  phone: 'talking',
};

const MOVE_SPEED = 3.0;
const WALK_FRAME_DURATION = 0.15;
const INTERACT_FRAME_DURATION = 0.4;
const IDLE_TIME_MIN = 2.0;
const IDLE_TIME_MAX = 8.0;
const INTERACT_TIME_MIN = 3.0;
const INTERACT_TIME_MAX = 6.0;
const BUBBLE_DURATION = 3.0;
const PERSIST_BUBBLE_TIMEOUT = 30.0;
const ZZZ_DELAY = 2.0;
const ZZZ_SHOW_DURATION = 3.0;
const ZZZ_HIDE_DURATION = 10.0;
const CONVERSATION_LINE_DURATION = 2.5;
const STUCK_THRESHOLD = 4.0;
const GHOST_DURATION = 2.0;
const SHUFFLE_CHECK_INTERVAL = 4.0;
const SHUFFLE_MAX_TILES = 3;
const EXTERNAL_IDLE_THRESHOLD = 5.0;
const WANDER_RADIUS = 8;
const MAX_COMMAND_QUEUE = 16;

const CASUAL_OBJECT_TYPES = new Set([
  'coffee', 'chair', 'plant',
]);

const OBJECT_FALLBACK_CHAIN = [
  'desk', 'books', 'computer', 'chair',
];

const WALK_CYCLE = [1, 0, 1, 2];

const WALK_ONTO_TYPES = new Set(['chair', ...DOOR_TYPES]);

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randomRange(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

type CharacterState =
  | 'idle' | 'walking' | 'interacting'
  | 'conversing' | 'exited';

export interface SpriteFrame {
  col: number;
  row: number;
  flipX: boolean;
}

const OPPOSITE_DIR: Record<Direction, Direction> = {
  down: 'up',
  up: 'down',
  left: 'right',
  right: 'left',
};

const DIR_OFFSET: Record<Direction, Point> = {
  down: { x: 0, y: 1 },
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  left: { x: -1, y: 0 },
};

export class Character {
  id: string;
  x: number;
  y: number;
  tileX: number;
  tileY: number;

  state: CharacterState = 'idle';
  direction: Direction = 'down';
  characterDefinitionId: string;
  cellWidth: number;
  cellHeight: number;
  layoutType: SpriteLayoutType;
  baseRegion: SpriteRegion;
  actions: ActionDefinition[];
  targetObjectId: string | null = null;
  spawnDoorId: string | null = null;
  aliveTime = 0;
  isLeaving = false;
  controlMode: 'autonomous' | 'external' = 'autonomous';
  isCasualIdle = false;
  debugSessionId = '';

  animFrame = 0;
  animTimer = 0;

  bubbleText: string | null = null;
  bubbleType: 'speech' | 'thought' = 'speech';
  bubbleTimer = 0;
  bubblePersist = false;
  persistBubbleElapsed = 0;
  bubbleAge = 0;
  externalBubble: {
    walking: string;
    arrived: string;
  } | null = null;
  waitingForApproval = false;
  badge: string | undefined = undefined;
  nameTag: string | null = null;
  soundIndicatorTimer = 0;
  renderScale = 1;

  idleElapsed = 0;
  showZzz = false;

  conversationPartner: Character | null = null;
  conversationLines: string[] = [];
  conversationIndex = 0;
  conversationRole: 'initiator' | 'responder' = 'initiator';
  pendingConversationTarget: Character | null = null;

  private locale: Locale = 'en';
  private conversationTimer = 0;
  private path: Point[] = [];
  private pathDest: Point | null = null;
  private targetObjectType: string | null = null;
  private targetObjectDirection: Direction | null = null;
  private idleTimer: number;
  private interactionTimer = 0;
  private interactionDuration: number | null = null;
  private stallTimer = 0;
  private noProgressTimer = 0;
  private ghostTimer = 0;
  private commandQueue: NpcCommand[] = [];
  private lastQueueEmptyLog = 0;
  private shuffleTimer = 0;
  private shuffleTiles = new Set<string>();

  get commandQueueLength(): number {
    return this.commandQueue.length;
  }

  private get ignoresCharacterCollision(): boolean {
    return this.isLeaving || this.ghostTimer > 0;
  }

  constructor(
    id: string,
    x: number,
    y: number,
    characterDefinitionId: string,
    def: {
      cellWidth: number;
      cellHeight: number;
      layoutType: SpriteLayoutType;
      baseRegion: SpriteRegion;
      actions: ActionDefinition[];
      scale: number;
    },
  ) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.tileX = x;
    this.tileY = y;
    this.characterDefinitionId = characterDefinitionId;
    this.cellWidth = def.cellWidth;
    this.cellHeight = def.cellHeight;
    this.layoutType = def.layoutType;
    this.baseRegion = def.baseRegion;
    this.actions = def.actions;
    this.renderScale = def.scale;
    this.idleTimer = randomRange(IDLE_TIME_MIN, IDLE_TIME_MAX);
  }

  getSpriteFrame(): SpriteFrame {
    const br = this.baseRegion;

    if (this.state === 'walking') {
      const cycle = this.walkCycle();
      const step = cycle[this.animFrame % cycle.length]!;
      return this.baseFrame(br.col + step, br.row);
    }

    if (this.state === 'interacting') {
      const actionName = OBJECT_TYPE_TO_ACTION[
        this.targetObjectType ?? ''
      ];
      const action = actionName
        ? this.actions.find(a => a.name === actionName)
        : undefined;
      if (action) {
        const cols = Math.max(action.region.cols, 1);
        const col = action.region.col
          + (this.animFrame % cols);
        return this.baseFrame(col, action.region.row);
      }
      return this.baseFrame(br.col + Math.min(1, br.cols - 1), br.row);
    }

    return this.baseFrame(br.col + Math.min(1, br.cols - 1), br.row);
  }

  private walkCycle(): number[] {
    const cols = this.baseRegion.cols;
    if (cols <= 1) return [0];
    if (cols === 2) return [0, 1, 0, 1];
    return WALK_CYCLE;
  }

  private baseFrame(col: number, baseRow: number): SpriteFrame {
    if (this.layoutType === 'auto-3x3') {
      switch (this.direction) {
        case 'down':
          return { col, row: baseRow, flipX: false };
        case 'up':
          return { col, row: baseRow + 1, flipX: false };
        case 'right':
          return { col, row: baseRow + 2, flipX: false };
        case 'left':
          return { col, row: baseRow + 2, flipX: true };
      }
    }
    // auto-3x4 / manual-4x4
    switch (this.direction) {
      case 'down':
        return { col, row: baseRow, flipX: false };
      case 'left':
        return { col, row: baseRow + 1, flipX: false };
      case 'right':
        return { col, row: baseRow + 2, flipX: false };
      case 'up':
        return { col, row: baseRow + 3, flipX: false };
    }
  }

  update(
    mapData: MapData,
    dtMs: number,
    occupiedCells: Set<string>,
    occupiedObjectIds: Set<string>,
    locale: Locale = 'en',
  ): void {
    const dt = dtMs / 1000;
    this.locale = locale;
    this.aliveTime += dt;
    if (this.ghostTimer > 0) this.ghostTimer -= dt;
    if (this.soundIndicatorTimer > 0) this.soundIndicatorTimer -= dt;

    if (this.state === 'exited') return;

    if (this.bubbleText) {
      this.bubbleAge += dt;
    }
    if (this.bubbleTimer > 0) {
      this.bubbleTimer -= dt;
      if (this.bubbleTimer <= 0) {
        this.bubbleText = null;
        this.bubblePersist = false;
        this.bubbleAge = 0;
      }
    }
    if (this.bubblePersist) {
      this.persistBubbleElapsed += dt;
      if (this.persistBubbleElapsed >= PERSIST_BUBBLE_TIMEOUT) {
        this.clearBubble();
      }
    }

    this.advanceAnimation(dt);

    if (this.state === 'idle') {
      if (this.controlMode === 'external') {
        this.processCommandQueue(
          mapData, occupiedCells, occupiedObjectIds,
        );
        if (
          this.state === 'idle'
          && this.commandQueue.length === 0
        ) {
          this.idleElapsed += dt;
          this.showZzz = this.calcShowZzz();
          if (this.idleElapsed >= EXTERNAL_IDLE_THRESHOLD) {
            this.pickCasualTask(
              mapData, occupiedCells, occupiedObjectIds,
            );
          }
        }
      } else {
        this.idleElapsed += dt;
        this.showZzz = this.calcShowZzz();
        this.idleTimer -= dt;
        if (this.idleTimer <= 0) {
          this.pickNewTask(
            mapData, occupiedCells, occupiedObjectIds,
          );
        }
      }
    } else if (this.state === 'walking') {
      if (
        this.controlMode === 'external'
        && this.externalBubble
        && this.bubbleTimer < 1
      ) {
        this.bubbleTimer = BUBBLE_DURATION;
      }
      const prevTX = this.tileX;
      const prevTY = this.tileY;
      this.walk(dt, mapData, occupiedCells);
      if (this.tileX !== prevTX || this.tileY !== prevTY) {
        this.noProgressTimer = 0;
      } else if (this.state === 'walking') {
        this.noProgressTimer += dt;
        if (
          !this.ignoresCharacterCollision
          && this.noProgressTimer >= STUCK_THRESHOLD
        ) {
          this.ghostTimer = GHOST_DURATION;
          this.noProgressTimer = 0;
        }
      }
      if (this.state === 'walking') {
        this.shuffleTiles.add(
          `${this.tileX},${this.tileY}`,
        );
        this.shuffleTimer += dt;
        if (this.shuffleTimer >= SHUFFLE_CHECK_INTERVAL) {
          if (
            this.pathDest
            && !this.ignoresCharacterCollision
            && this.shuffleTiles.size <= SHUFFLE_MAX_TILES
          ) {
            this.ghostTimer = GHOST_DURATION;
          }
          this.shuffleTimer = 0;
          this.shuffleTiles.clear();
        }
      }
    } else if (this.state === 'conversing') {
      this.updateConversation(dt);
    } else if (this.state === 'interacting') {
      this.interactionTimer -= dt;
      if (this.interactionTimer <= 0) {
        this.finishInteracting();
      }
    }
  }

  private finishInteracting(): void {
    this.state = 'idle';
    this.targetObjectId = null;
    this.targetObjectType = null;
    this.targetObjectDirection = null;
    this.pathDest = null;
    this.interactionDuration = null;
    this.isCasualIdle = false;
    this.idleTimer = randomRange(
      IDLE_TIME_MIN, IDLE_TIME_MAX,
    );
    this.clearIdle();
  }

  private advanceAnimation(dt: number): void {
    const frameDur = this.state === 'interacting'
      ? INTERACT_FRAME_DURATION
      : WALK_FRAME_DURATION;

    this.animTimer += dt;
    if (this.animTimer >= frameDur) {
      this.animTimer -= frameDur;
      this.animFrame++;
    }
  }

  private walk(
    dt: number,
    mapData: MapData,
    occupiedCells: Set<string>,
  ): void {
    if (this.path.length === 0) {
      this.noProgressTimer = 0;
      if (this.isLeaving && DOOR_TYPES.has(this.targetObjectType ?? '')) {
        this.state = 'exited';
        return;
      }
      if (this.targetObjectType) {
        this.arriveAtObject();
      } else {
        this.state = 'idle';
        this.idleTimer = randomRange(
          IDLE_TIME_MIN, IDLE_TIME_MAX,
        );
        this.clearIdle();
      }
      return;
    }

    const next = this.path[0]!;
    const nextKey = `${next.x},${next.y}`;
    const myKey = `${this.tileX},${this.tileY}`;
    if (
      !this.ignoresCharacterCollision
      && nextKey !== myKey
      && occupiedCells.has(nextKey)
    ) {
      this.stallTimer += dt;
      if (this.stallTimer >= 0.5) {
        this.reroute(mapData, occupiedCells);
      }
      return;
    }

    this.stallTimer = 0;
    const dx = next.x - this.x;
    const dy = next.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const step = MOVE_SPEED * dt;

    if (dist <= step) {
      this.x = next.x;
      this.y = next.y;
      this.path.shift();
    } else {
      this.x += (dx / dist) * step;
      this.y += (dy / dist) * step;
    }

    this.updateDirection(dx, dy);
    this.tileX = Math.round(this.x);
    this.tileY = Math.round(this.y);
  }

  private reroute(
    mapData: MapData,
    occupiedCells: Set<string>,
  ): void {
    this.stallTimer = 0;

    if (!this.pathDest) {
      this.abandonPath();
      return;
    }

    const dest = this.pathDest;
    const sitInside = WALK_ONTO_TYPES.has(
      this.targetObjectType ?? '',
    );
    const start = { x: this.tileX, y: this.tileY };
    const newPath = findPath(
      start, dest,
      mapData.width, mapData.height,
      (x, y, fx, fy) => {
        if (sitInside && x === dest.x && y === dest.y) {
          return true;
        }
        return this.isCellWalkable(
          mapData, x, y, occupiedCells, fx, fy,
        );
      },
    );

    if (newPath.length > 0) {
      this.path = newPath;
    } else {
      this.abandonPath();
    }
  }

  private abandonPath(): void {
    this.path = [];
    this.pathDest = null;
    this.targetObjectId = null;
    this.targetObjectType = null;
    this.targetObjectDirection = null;
    this.interactionDuration = null;
    this.noProgressTimer = 0;
    this.ghostTimer = 0;
    this.shuffleTimer = 0;
    this.shuffleTiles.clear();
    this.isCasualIdle = false;
    this.state = 'idle';
    this.idleTimer = randomRange(0.5, 1.5);
    this.clearIdle();
  }

  private updateDirection(dx: number, dy: number): void {
    if (Math.abs(dx) > Math.abs(dy)) {
      this.direction = dx > 0 ? 'right' : 'left';
    } else if (dy !== 0) {
      this.direction = dy > 0 ? 'down' : 'up';
    }
  }

  private arriveAtObject(): void {
    this.state = 'interacting';
    this.animFrame = 0;
    this.animTimer = 0;
    this.noProgressTimer = 0;
    this.interactionTimer = this.interactionDuration
      ?? randomRange(INTERACT_TIME_MIN, INTERACT_TIME_MAX);
    this.interactionDuration = null;

    const objType = this.targetObjectType ?? '';
    if (objType === 'book' || objType === 'books') {
      this.direction = 'down';
    } else if (this.targetObjectDirection) {
      const sitInside = WALK_ONTO_TYPES.has(objType);
      this.direction = sitInside
        ? this.targetObjectDirection
        : OPPOSITE_DIR[this.targetObjectDirection];
    }

    if (
      this.controlMode === 'external'
      && this.externalBubble
    ) {
      this.bubbleType = 'thought';
      this.bubbleText = this.externalBubble.arrived;
      this.bubbleTimer = BUBBLE_DURATION;
      this.bubbleAge = 0;
      this.externalBubble = null;
    } else if (
      this.controlMode === 'autonomous'
      || this.isCasualIdle
    ) {
      this.showArrivalBubble();
    }
  }

  pickNewTask(
    mapData: MapData,
    occupiedCells: Set<string>,
    occupiedObjectIds: Set<string>,
  ): void {
    if (this.isLeaving) {
      this.pickExitTask(mapData, occupiedCells);
      return;
    }

    const goToObject =
      mapData.objects.length > 0 && Math.random() < 0.6;

    if (goToObject) {
      this.pickObjectTask(
        mapData, occupiedCells, occupiedObjectIds,
      );
    } else {
      this.pickWanderTask(mapData, occupiedCells);
    }
  }

  private pickCasualTask(
    mapData: MapData,
    occupiedCells: Set<string>,
    occupiedObjectIds: Set<string>,
  ): void {
    this.isCasualIdle = true;
    const goToObject =
      mapData.objects.length > 0 && Math.random() < 0.5;
    if (goToObject) {
      this.pickObjectTask(
        mapData, occupiedCells, occupiedObjectIds,
      );
    } else {
      this.pickWanderTask(mapData, occupiedCells);
    }
  }

  enqueueCommand(cmd: NpcCommand): void {
    if (this.isCasualIdle) {
      this.abandonPath();
    }
    if (isMovementCommand(cmd)) {
      this.commandQueue = this.commandQueue.filter(
        c => !isMovementCommand(c),
      );
    }
    if (this.commandQueue.length >= MAX_COMMAND_QUEUE) {
      this.commandQueue.shift();
    }
    this.commandQueue.push(cmd);
  }

  processCommandQueue(
    mapData: MapData,
    occupiedCells: Set<string>,
    occupiedObjectIds: Set<string>,
  ): void {
    const sid = this.debugSessionId;
    if (this.commandQueue.length === 0) {
      if (sid) {
        const now = performance.now();
        if (now - this.lastQueueEmptyLog > 5000) {
          this.lastQueueEmptyLog = now;
          debugLog(
            sid, 'CHAR_QUEUE_EMPTY',
            `(idle, no commands) state=${this.state}`,
          );
        }
      }
      return;
    }
    this.isCasualIdle = false;
    const cmd = this.commandQueue.shift()!;
    const extra = 'objectType' in cmd
      ? ` objectType=${cmd.objectType}`
      : '';
    if (sid) {
      debugLog(
        sid, 'CHAR_DEQUEUE',
        `cmd=${cmd.type}${extra}`,
      );
    }

    switch (cmd.type) {
      case 'goto_object':
        this.pickSpecificObjectTask(
          cmd.objectType, mapData,
          occupiedCells, occupiedObjectIds,
        );
        break;
      case 'enter_room':
        // Handled by startDoorEntry externally
        break;
      case 'leave_room':
        this.isLeaving = true;
        this.pickExitTask(mapData, occupiedCells);
        break;
      case 'wander':
        this.pickWanderTask(mapData, occupiedCells);
        break;
      case 'set_interacting': {
        this.pickSpecificObjectTask(
          cmd.objectType, mapData,
          occupiedCells, occupiedObjectIds,
          cmd.duration,
        );
        break;
      }
    }
  }

  pickSpecificObjectTask(
    objectType: string,
    mapData: MapData,
    occupiedCells: Set<string>,
    occupiedObjectIds: Set<string>,
    duration?: number,
  ): void {
    if (this.tryWalkToObjectType(
      objectType, mapData, occupiedCells,
      occupiedObjectIds, duration,
    )) return;

    for (const fallback of OBJECT_FALLBACK_CHAIN) {
      if (fallback === objectType) continue;
      if (this.tryWalkToObjectType(
        fallback, mapData, occupiedCells,
        occupiedObjectIds, duration,
      )) return;
    }

    if (this.controlMode === 'autonomous') {
      this.showWaitingBubble();
    } else {
      this.interactInPlace(duration);
    }
  }

  private tryWalkToObjectType(
    objectType: string,
    mapData: MapData,
    occupiedCells: Set<string>,
    occupiedObjectIds: Set<string>,
    duration?: number,
  ): boolean {
    const available = mapData.objects.filter(
      o => o.type === objectType
        && !occupiedObjectIds.has(o.id)
        && !DOOR_TYPES.has(o.type),
    );
    return this.walkToRandomObject(
      available, mapData, occupiedCells, duration,
    );
  }

  private interactInPlace(duration?: number): void {
    this.state = 'interacting';
    this.animFrame = 0;
    this.animTimer = 0;
    this.noProgressTimer = 0;
    this.interactionTimer = duration
      ?? randomRange(INTERACT_TIME_MIN, INTERACT_TIME_MAX);
    this.interactionDuration = null;
    this.targetObjectType = 'books';
    this.direction = 'down';

    if (this.externalBubble) {
      this.bubbleType = 'thought';
      this.bubbleText = this.externalBubble.arrived;
      this.bubbleTimer = BUBBLE_DURATION;
      this.bubbleAge = 0;
      this.externalBubble = null;
    }
  }

  private pickObjectTask(
    mapData: MapData,
    occupiedCells: Set<string>,
    occupiedObjectIds: Set<string>,
  ): void {
    const available = mapData.objects.filter(
      o => !occupiedObjectIds.has(o.id)
        && !DOOR_TYPES.has(o.type)
        && CASUAL_OBJECT_TYPES.has(o.type),
    );
    if (!this.walkToRandomObject(
      available, mapData, occupiedCells,
    )) {
      this.pickWanderTask(mapData, occupiedCells);
    }
  }

  private walkToRandomObject(
    candidates: InteractiveObject[],
    mapData: MapData,
    occupiedCells: Set<string>,
    duration?: number,
  ): boolean {
    if (candidates.length === 0) return false;

    const targetObj = pickRandom(candidates);
    const sitInside = WALK_ONTO_TYPES.has(targetObj.type);
    const dest = sitInside
      ? { x: targetObj.x, y: targetObj.y }
      : this.getFrontCell(mapData, targetObj, occupiedCells);
    if (!dest) return false;

    const start = {
      x: Math.round(this.x),
      y: Math.round(this.y),
    };
    const path = findPath(
      start, dest,
      mapData.width, mapData.height,
      (x, y, fx, fy) => {
        if (
          sitInside
          && x === targetObj.x && y === targetObj.y
        ) return true;
        return this.isCellWalkable(
          mapData, x, y, occupiedCells, fx, fy,
        );
      },
    );

    if (path.length === 0) return false;

    this.targetObjectId = targetObj.id;
    if (duration !== undefined) {
      this.interactionDuration = duration;
    }
    this.startWalking(
      path,
      targetObj.type,
      targetObj.direction ?? 'down',
    );
    if (
      this.controlMode === 'autonomous'
      || this.isCasualIdle
    ) {
      this.showThoughtBubble(targetObj.type);
    }
    return true;
  }

  private showWaitingBubble(): void {
    this.bubbleType = 'thought';
    this.bubbleText = 'Waiting...';
    this.bubbleTimer = BUBBLE_DURATION;
    this.idleTimer = randomRange(0.5, 1.5);
  }

  private pickWanderTask(
    mapData: MapData,
    occupiedCells: Set<string>,
  ): void {
    const start = {
      x: Math.round(this.x),
      y: Math.round(this.y),
    };

    for (let attempt = 0; attempt < 10; attempt++) {
      const tx = start.x + Math.floor(
        Math.random() * (WANDER_RADIUS * 2 + 1),
      ) - WANDER_RADIUS;
      const ty = start.y + Math.floor(
        Math.random() * (WANDER_RADIUS * 2 + 1),
      ) - WANDER_RADIUS;
      if (
        tx < 0 || tx >= mapData.width
        || ty < 0 || ty >= mapData.height
      ) continue;
      if (
        !this.isCellWalkable(mapData, tx, ty, occupiedCells)
      ) continue;
      if (tx === start.x && ty === start.y) continue;

      const path = findPath(
        start, { x: tx, y: ty },
        mapData.width, mapData.height,
        (x, y, fx, fy) => this.isCellWalkable(
          mapData, x, y, occupiedCells, fx, fy,
        ),
      );
      if (path.length > 0) {
        this.startWalking(path, null);
        if (this.controlMode === 'autonomous') {
          this.bubbleType = 'thought';
          this.bubbleText = pickRandom(
            getWanderThoughts(this.locale),
          );
          this.bubbleTimer = BUBBLE_DURATION;
        }
        return;
      }
    }
    this.idleTimer = randomRange(0.5, 1.5);
  }

  private pickExitTask(
    mapData: MapData,
    occupiedCells: Set<string>,
  ): void {
    const doors = mapData.objects.filter(
      o => DOOR_TYPES.has(o.type),
    );
    if (doors.length === 0) {
      this.isLeaving = false;
      this.idleTimer = randomRange(0.5, 1.5);
      return;
    }

    const spawnDoor = this.spawnDoorId
      ? doors.find(d => d.id === this.spawnDoorId)
      : undefined;
    if (this.spawnDoorId && !spawnDoor) {
      this.spawnDoorId = null;
    }
    const targetDoor = spawnDoor ?? pickRandom(doors);
    const dest = { x: targetDoor.x, y: targetDoor.y };
    const start = {
      x: Math.round(this.x),
      y: Math.round(this.y),
    };

    const path = findPath(
      start, dest,
      mapData.width, mapData.height,
      (x, y, fx, fy) => {
        if (x === dest.x && y === dest.y) return true;
        return this.isCellWalkable(
          mapData, x, y, occupiedCells, fx, fy,
        );
      },
    );

    if (path.length > 0) {
      this.targetObjectId = targetDoor.id;
      this.startWalking(
        path, targetDoor.type, targetDoor.direction,
      );
      this.showLeavingBubble();
    } else {
      this.idleTimer = randomRange(0.5, 1.5);
    }
  }

  startDoorEntry(doorDir: Direction): void {
    const offset = DIR_OFFSET[doorDir];
    const dest = {
      x: this.tileX + offset.x,
      y: this.tileY + offset.y,
    };
    this.direction = doorDir;
    this.path = [dest];
    this.pathDest = dest;
    this.state = 'walking';
    this.animFrame = 0;
    this.animTimer = 0;
    this.stallTimer = 0;
    this.noProgressTimer = 0;
    this.ghostTimer = 0;
    this.targetObjectId = null;
    this.targetObjectType = null;
    this.targetObjectDirection = null;
    this.interactionDuration = null;
  }

  private startWalking(
    path: Point[],
    objectType: string | null,
    objectDirection: Direction | null = null,
  ): void {
    this.path = path;
    this.pathDest = path[path.length - 1] ?? null;
    this.state = 'walking';
    this.animFrame = 0;
    this.animTimer = 0;
    this.stallTimer = 0;
    this.targetObjectType = objectType;
    this.targetObjectDirection = objectDirection;
    this.shuffleTimer = 0;
    this.shuffleTiles.clear();
    this.clearIdle();
  }

  private getFrontCell(
    mapData: MapData,
    obj: InteractiveObject,
    occupiedCells: Set<string>,
  ): Point | null {
    const dir = obj.direction ?? 'down';
    const offset = DIR_OFFSET[dir];
    const front = {
      x: obj.x + offset.x,
      y: obj.y + offset.y,
    };
    if (
      this.isCellWalkable(
        mapData, front.x, front.y, occupiedCells,
      )
    ) {
      return front;
    }
    return null;
  }

  private showThoughtBubble(objectType: string): void {
    const thoughts = getWalkingThoughts(
      this.locale, objectType,
    );
    this.bubbleType = 'thought';
    this.bubbleText = pickRandom(thoughts);
    this.bubbleTimer = BUBBLE_DURATION;
  }

  private showArrivalBubble(): void {
    if (this.targetObjectType) {
      const lines = getArrivalSpeech(
        this.locale, this.targetObjectType,
      );
      this.bubbleType = 'speech';
      this.bubbleText = pickRandom(lines);
      this.bubbleTimer = BUBBLE_DURATION;
    }
  }

  private showLeavingBubble(): void {
    const lines = getLeavingThoughts(this.locale);
    this.bubbleType = 'thought';
    this.bubbleText = pickRandom(lines);
    this.bubbleTimer = BUBBLE_DURATION;
  }

  private isCellWalkable(
    mapData: MapData,
    x: number,
    y: number,
    occupiedCells: Set<string>,
    fromX?: number,
    fromY?: number,
  ): boolean {
    if (
      x < 0 || x >= mapData.width
      || y < 0 || y >= mapData.height
    ) return false;

    if (mapData.collisionGrid) {
      const row = mapData.collisionGrid[y];
      if (row && row[x]) return false;
    } else {
      const layer1 = mapData.layers[1];
      if (layer1?.[y]?.[x]) return false;
      if (mapData.objects.some(o => o.x === x && o.y === y)) {
        return false;
      }
    }

    if (
      fromX !== undefined && fromY !== undefined
      && mapData.directionalCollisionGrid
    ) {
      if (!isDirPassable(
        mapData.directionalCollisionGrid,
        fromX, fromY, x, y,
      )) return false;
    }

    if (!this.ignoresCharacterCollision) {
      const myKey =
        `${Math.round(this.x)},${Math.round(this.y)}`;
      const cellKey = `${x},${y}`;
      if (cellKey !== myKey && occupiedCells.has(cellKey)) {
        return false;
      }
    }

    return true;
  }

  private calcShowZzz(): boolean {
    if (this.idleElapsed < ZZZ_DELAY) return false;
    const period = ZZZ_SHOW_DURATION + ZZZ_HIDE_DURATION;
    const cycleTime = (this.idleElapsed - ZZZ_DELAY) % period;
    return cycleTime < ZZZ_SHOW_DURATION;
  }

  private clearIdle(): void {
    this.idleElapsed = 0;
    this.showZzz = false;
  }

  private faceToward(tx: number, ty: number): void {
    const dx = tx - this.tileX;
    const dy = ty - this.tileY;
    if (Math.abs(dx) > Math.abs(dy)) {
      this.direction = dx > 0 ? 'right' : 'left';
    } else if (dy !== 0) {
      this.direction = dy > 0 ? 'down' : 'up';
    }
  }

  setBubble(text: string, type: 'speech' | 'thought'): void {
    this.bubbleText = text;
    this.bubbleType = type;
    this.bubblePersist = true;
    this.persistBubbleElapsed = 0;
    this.bubbleTimer = 1;
  }

  cancelLeave(): void {
    if (!this.isLeaving) return;
    this.isLeaving = false;
    this.abandonPath();
    this.clearBubble();
  }

  clearBubble(): void {
    this.bubbleText = null;
    this.bubblePersist = false;
    this.persistBubbleElapsed = 0;
    this.bubbleTimer = 0;
    this.bubbleAge = 0;
  }

  showSoundIndicator(): void {
    this.soundIndicatorTimer = 1.0;
  }

  startConversation(
    partner: Character,
    lines: string[],
    role: 'initiator' | 'responder',
  ): void {
    this.state = 'conversing';
    this.conversationPartner = partner;
    this.conversationLines = lines;
    this.conversationIndex = 0;
    this.conversationRole = role;
    this.conversationTimer = CONVERSATION_LINE_DURATION;
    this.clearIdle();
    this.faceToward(partner.tileX, partner.tileY);
    this.advanceConversationLine();
  }

  private updateConversation(dt: number): void {
    const partner = this.conversationPartner;
    if (
      !partner
      || partner.state === 'exited'
      || partner.conversationPartner !== this
    ) {
      this.finishConversing();
      return;
    }

    if (this.conversationRole !== 'initiator') return;

    this.conversationTimer -= dt;
    if (this.conversationTimer > 0) return;

    this.conversationIndex++;
    partner.conversationIndex = this.conversationIndex;

    if (this.conversationIndex >= this.conversationLines.length) {
      this.endConversation();
      return;
    }

    this.conversationTimer = CONVERSATION_LINE_DURATION;
    this.advanceConversationLine();
    partner.advanceConversationLine();
  }

  advanceConversationLine(): void {
    const isInitiatorTurn =
      this.conversationIndex % 2 === 0;
    const isSpeaker =
      (this.conversationRole === 'initiator') === isInitiatorTurn;
    const line =
      this.conversationLines[this.conversationIndex];

    if (isSpeaker && line) {
      this.setBubble(line, 'speech');
    } else {
      this.clearBubble();
    }
  }

  private endConversation(): void {
    const partner = this.conversationPartner;
    this.finishConversing();
    partner?.finishConversing();
  }

  finishConversing(): void {
    this.conversationPartner = null;
    this.conversationLines = [];
    this.conversationIndex = 0;
    this.conversationRole = 'initiator';
    this.conversationTimer = 0;
    this.pendingConversationTarget = null;
    this.clearBubble();
    this.state = 'idle';
    this.idleTimer = randomRange(IDLE_TIME_MIN, IDLE_TIME_MAX);
    this.clearIdle();
  }

  walkToConversation(
    target: Character,
    mapData: MapData,
    occupiedCells: Set<string>,
  ): boolean {
    const dest = { x: target.tileX, y: target.tileY };
    const offsets: Point[] = [
      { x: 0, y: -1 }, { x: 0, y: 1 },
      { x: -1, y: 0 }, { x: 1, y: 0 },
    ];
    const adjacentCells = offsets
      .map(o => ({ x: dest.x + o.x, y: dest.y + o.y }))
      .filter(
        p => this.isCellWalkable(mapData, p.x, p.y, occupiedCells),
      );
    if (adjacentCells.length === 0) return false;

    const start = { x: this.tileX, y: this.tileY };
    for (const cell of adjacentCells) {
      const path = findPath(
        start, cell,
        mapData.width, mapData.height,
        (x, y, fx, fy) => this.isCellWalkable(
          mapData, x, y, occupiedCells, fx, fy,
        ),
      );
      if (path.length > 0 && path.length <= 15) {
        this.pendingConversationTarget = target;
        this.startWalking(path, null);
        return true;
      }
    }
    return false;
  }
}
