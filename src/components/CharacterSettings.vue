<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  onMounted,
  onUnmounted,
  nextTick,
  onBeforeMount,
} from 'vue';
import { Trash2, Pencil, Plus, Copy, Dices } from 'lucide-vue-next';
import SpritesheetCanvas from './SpritesheetCanvas.vue';
import ActionPickerDialog from './ActionPickerDialog.vue';
import { useCharacterStore } from '../stores/characterStore';
import { useSoundStore } from '../stores/soundStore';
import { generateFunnyName } from '../utils/nameGenerator';
import type {
  SpriteLayoutType,
  ActionDefinition,
  CharacterDefinition,
} from '../types/character';

const props = defineProps<{
  characterId: string;
}>();

const emit = defineEmits<{
  duplicated: [id: string];
}>();

const characterStore = useCharacterStore();
const soundStore = useSoundStore();
const packsExpanded = ref(false);

onBeforeMount(async () => {
  if (soundStore.packs.length === 0) {
    await soundStore.init();
    await soundStore.scanPacks();
  }
});
const duplicateFileInput = ref<HTMLInputElement | null>(null);

const character = computed(
  () => characterStore.getCharacter(props.characterId),
);

// --- Spritesheet image from blob ---
const spriteImage = ref<HTMLImageElement | null>(null);
const objectUrl = ref<string | null>(null);

function revokeUrl() {
  if (objectUrl.value) {
    URL.revokeObjectURL(objectUrl.value);
    objectUrl.value = null;
  }
}

function loadSpriteImage(blob: Blob) {
  revokeUrl();
  const url = URL.createObjectURL(blob);
  objectUrl.value = url;
  const img = new Image();
  img.onload = () => {
    spriteImage.value = img;
  };
  img.src = url;
}

watch(
  () => character.value?.spriteBlob,
  (blob) => {
    if (blob) {
      loadSpriteImage(blob);
    } else {
      spriteImage.value = null;
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  revokeUrl();
  stopAnimation();
});

// --- Cell size presets ---
const PRESETS = [
  { label: '16\u00d716', w: 16, h: 16 },
  { label: '16\u00d732', w: 16, h: 32 },
  { label: '32\u00d732', w: 32, h: 32 },
  { label: '48\u00d748', w: 48, h: 48 },
] as const;

const isCustomSize = ref(false);

watch(
  () => props.characterId,
  () => {
    const char = character.value;
    if (!char) return;
    isCustomSize.value = !PRESETS.some(
      (p) => p.w === char.cellWidth && p.h === char.cellHeight,
    );
  },
  { immediate: true },
);

function selectPreset(w: number, h: number) {
  isCustomSize.value = false;
  characterStore.updateCharacter(props.characterId, {
    cellWidth: w,
    cellHeight: h,
  });
}

function enableCustom() {
  isCustomSize.value = true;
}

// --- Event handlers ---
function onNameInput(e: Event) {
  const value = (e.target as HTMLInputElement).value;
  characterStore.updateCharacter(props.characterId, { name: value });
}

function handleRandomName() {
  const existingNames = new Set(
    characterStore.characters.map((c) => c.name),
  );
  const name = generateFunnyName(existingNames);
  characterStore.updateCharacter(props.characterId, { name });
}

function handleDuplicateClick() {
  duplicateFileInput.value?.click();
}

async function handleDuplicateFileSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (files.length === 0) return;
  input.value = '';

  const char = character.value;
  if (!char) return;

  const existingNames = new Set(
    characterStore.characters.map((c) => c.name),
  );

  let lastId = '';
  for (const file of files) {
    const name = generateFunnyName(existingNames);
    existingNames.add(name);

    const def: CharacterDefinition = {
      id: crypto.randomUUID(),
      name,
      spriteBlob: file,
      cellWidth: char.cellWidth,
      cellHeight: char.cellHeight,
      layoutType: char.layoutType,
      baseRegion: { ...char.baseRegion },
      actions: char.actions.map((a) => ({
        id: crypto.randomUUID(),
        name: a.name,
        region: { ...a.region },
      })),
      scale: char.scale,
      isSubagent: char.isSubagent,
    };
    characterStore.addCharacter(def);
    lastId = def.id;
  }

  if (lastId) {
    emit('duplicated', lastId);
  }
}

function onCellWidthInput(e: Event) {
  const value = parseInt(
    (e.target as HTMLInputElement).value,
    10,
  );
  if (value > 0) {
    characterStore.updateCharacter(props.characterId, {
      cellWidth: value,
    });
  }
}

function onCellHeightInput(e: Event) {
  const value = parseInt(
    (e.target as HTMLInputElement).value,
    10,
  );
  if (value > 0) {
    characterStore.updateCharacter(props.characterId, {
      cellHeight: value,
    });
  }
}

function onLayoutChange(layout: SpriteLayoutType) {
  characterStore.updateCharacter(props.characterId, {
    layoutType: layout,
  });
}

function onScaleInput(e: Event) {
  const value = parseFloat(
    (e.target as HTMLInputElement).value,
  );
  if (value >= 0.5 && value <= 4) {
    characterStore.updateCharacter(props.characterId, {
      scale: value,
    });
  }
}

// --- Region derived from layout type ---
const regionCols = computed(() =>
  character.value?.layoutType === 'manual-4x4' ? 4 : 3,
);
const regionRows = computed(() =>
  character.value?.layoutType === 'auto-3x3' ? 3 : 4,
);

const hasBaseRegion = computed(
  () => (character.value?.baseRegion.cols ?? 0) > 0,
);

function onBaseRegionSelect(
  col: number, row: number, _cols: number,
) {
  characterStore.updateCharacter(props.characterId, {
    baseRegion: {
      col,
      row,
      cols: regionCols.value,
      rows: regionRows.value,
    },
  });
}

// --- Animated preview canvas ---
const previewCanvas = ref<HTMLCanvasElement | null>(null);
const animFrame = ref(0);
const animDirIdx = ref(0);
let animStep = 0;
let animTick = 0;
let animInterval: ReturnType<typeof setInterval> | null = null;

// Bounce sequence: 1→[0], 2→[0,1], 3→[0,1,2,1], …
function bounceSeq(cols: number): number[] {
  if (cols <= 1) return [0];
  const seq: number[] = [];
  for (let i = 0; i < cols; i++) seq.push(i);
  for (let i = cols - 2; i > 0; i--) seq.push(i);
  return seq;
}

interface DirStep { row: number; flip: boolean }

// Direction order: down → left → up → right
// 3-row: down=0, up=1, right=2, left=2 flipped
const DIR_SEQ_3: DirStep[] = [
  { row: 0, flip: false },
  { row: 2, flip: true },
  { row: 1, flip: false },
  { row: 2, flip: false },
];
// 4-row (RPG Maker MV): down=0, left=1, right=2, up=3
const DIR_SEQ_4: DirStep[] = [
  { row: 0, flip: false },
  { row: 1, flip: false },
  { row: 3, flip: false },
  { row: 2, flip: false },
];

function getDirStep(rows: number, dirIdx: number): DirStep {
  const seq = rows === 3 ? DIR_SEQ_3 : DIR_SEQ_4;
  return seq[dirIdx % seq.length]!;
}

const TICKS_PER_ROW = 10; // 10 × 200ms = 2s per direction

const previewScale = computed(() => {
  if (!character.value) return 3;
  return character.value.cellWidth <= 32 ? 3 : 2;
});

function startAnimation() {
  stopAnimation();
  animStep = 0;
  animTick = 0;
  animFrame.value = 0;
  animDirIdx.value = 0;
  animInterval = setInterval(() => {
    const cols = regionCols.value;
    if (cols <= 0) return;
    const seq = bounceSeq(cols);
    animStep = (animStep + 1) % seq.length;
    animFrame.value = seq[animStep]!;
    animTick++;
    if (animTick >= TICKS_PER_ROW) {
      animTick = 0;
      animDirIdx.value = (animDirIdx.value + 1) % 4;
    }
  }, 200);
}

function stopAnimation() {
  if (animInterval !== null) {
    clearInterval(animInterval);
    animInterval = null;
  }
}

function drawCellFlip(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  srcX: number, srcY: number,
  w: number, h: number,
  dstW: number, dstH: number,
  flip: boolean,
) {
  if (flip) {
    ctx.save();
    ctx.translate(dstW, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, srcX, srcY, w, h, 0, 0, dstW, dstH);
    ctx.restore();
  } else {
    ctx.drawImage(img, srcX, srcY, w, h, 0, 0, dstW, dstH);
  }
}

function drawPreview() {
  const cvs = previewCanvas.value;
  if (!cvs) return;
  const ctx = cvs.getContext('2d');
  if (!ctx) return;
  const char = character.value;
  const img = spriteImage.value;
  if (!char || !img) return;

  const { baseRegion, cellWidth, cellHeight } = char;
  const scale = previewScale.value;

  cvs.width = cellWidth * scale;
  cvs.height = cellHeight * scale;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cvs.width, cvs.height);

  if (baseRegion.cols === 0 || baseRegion.rows === 0) return;

  const frame = animFrame.value;
  const dir = getDirStep(baseRegion.rows, animDirIdx.value);
  drawCellFlip(
    ctx, img,
    (baseRegion.col + frame) * cellWidth,
    (baseRegion.row + dir.row) * cellHeight,
    cellWidth, cellHeight,
    cellWidth * scale, cellHeight * scale,
    dir.flip,
  );
}

watch(
  [
    spriteImage,
    () => character.value?.baseRegion,
    () => character.value?.cellWidth,
    () => character.value?.cellHeight,
    previewScale,
    animFrame,
    animDirIdx,
  ],
  () => nextTick(drawPreview),
);

watch(hasBaseRegion, (has) => {
  if (has) {
    startAnimation();
  } else {
    stopAnimation();
  }
}, { immediate: true });

onMounted(() => nextTick(drawPreview));

// --- Actions ---
const showActionPicker = ref(false);
const editingActionId = ref<string | null>(null);

const editingAction = computed(() => {
  if (!editingActionId.value || !character.value) return undefined;
  return character.value.actions.find(
    (a) => a.id === editingActionId.value,
  );
});

function openAddAction() {
  editingActionId.value = null;
  showActionPicker.value = true;
}

function openEditAction(actionId: string) {
  editingActionId.value = actionId;
  showActionPicker.value = true;
}

function onActionPickerConfirm(
  names: string[],
  col: number,
  row: number,
  cols: number,
) {
  const char = character.value;
  if (!char) return;

  const region = {
    col, row, cols,
    rows: regionRows.value,
  };

  if (editingActionId.value) {
    const name = names[0]!;
    const updated = char.actions.map((a) =>
      a.id === editingActionId.value
        ? { ...a, name, region }
        : a,
    );
    characterStore.updateCharacter(props.characterId, {
      actions: updated,
    });
  } else {
    const newActions: ActionDefinition[] = names.map(
      (name) => ({
        id: crypto.randomUUID(),
        name,
        region,
      }),
    );
    characterStore.updateCharacter(props.characterId, {
      actions: [...char.actions, ...newActions],
    });
  }

  showActionPicker.value = false;
  editingActionId.value = null;
}

function onActionPickerCancel() {
  showActionPicker.value = false;
  editingActionId.value = null;
}

function deleteAction(actionId: string) {
  const char = character.value;
  if (!char) return;
  characterStore.updateCharacter(props.characterId, {
    actions: char.actions.filter((a) => a.id !== actionId),
  });
}

const actionCanvasRefs = new Map<string, HTMLCanvasElement>();

function setActionCanvasRef(
  el: HTMLCanvasElement | null,
  actionId: string,
) {
  if (el) {
    actionCanvasRefs.set(actionId, el);
  } else {
    actionCanvasRefs.delete(actionId);
  }
}

function drawActionThumbs() {
  const img = spriteImage.value;
  const char = character.value;
  if (!img || !char) return;

  const { cellWidth, cellHeight } = char;
  const scale = 2;
  const frame = animFrame.value;

  for (const action of char.actions) {
    const cvs = actionCanvasRefs.get(action.id);
    if (!cvs) continue;
    const ctx = cvs.getContext('2d');
    if (!ctx) continue;

    cvs.width = cellWidth * scale;
    cvs.height = cellHeight * scale;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cvs.width, cvs.height);

    const cols = action.region.cols;
    const rows = action.region.rows;
    const seq = bounceSeq(cols);
    const f = seq[frame % seq.length]!;
    const dir = getDirStep(rows, animDirIdx.value);

    drawCellFlip(
      ctx, img,
      (action.region.col + f) * cellWidth,
      (action.region.row + dir.row) * cellHeight,
      cellWidth, cellHeight,
      cellWidth * scale, cellHeight * scale,
      dir.flip,
    );
  }
}

watch(
  [animFrame, animDirIdx],
  () => nextTick(drawActionThumbs),
);
</script>

<template>
  <div v-if="character" class="space-y-5">
    <!-- Name -->
    <div>
      <label class="block text-sm font-medium text-gray-300 mb-1">
        Name
      </label>
      <div class="flex gap-2">
        <input
          type="text"
          :value="character.name"
          class="flex-1 bg-gray-700 text-white px-2 py-1.5
                 rounded border border-gray-600 text-sm
                 focus:outline-none focus:border-blue-500"
          @input="onNameInput"
        />
        <button
          class="p-1.5 bg-gray-700 hover:bg-gray-600 rounded
                 text-gray-300 transition-colors shrink-0
                 border border-gray-600"
          title="Random name"
          @click="handleRandomName"
        >
          <Dices :size="14" />
        </button>
        <button
          class="flex items-center gap-1 px-2.5 py-1.5 text-xs
                 bg-gray-700 hover:bg-gray-600 rounded
                 text-gray-300 transition-colors shrink-0
                 border border-gray-600"
          title="Duplicate with different sprite"
          @click="handleDuplicateClick"
        >
          <Copy :size="13" />
          Duplicate
        </button>
      </div>
      <input
        ref="duplicateFileInput"
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        @change="handleDuplicateFileSelected"
      />
    </div>

    <!-- Sub-agent flag -->
    <label class="flex items-center gap-2 text-sm text-gray-300">
      <input
        type="checkbox"
        :checked="character.isSubagent"
        class="accent-blue-500"
        @change="(e: Event) => characterStore.updateCharacter(
          characterId,
          { isSubagent: (e.target as HTMLInputElement).checked },
        )"
      />
      Sub-agent character
    </label>

    <!-- Preferred sound packs -->
    <div>
      <button
        class="flex items-center gap-1.5 text-sm font-medium text-gray-300 w-full text-left"
        @click="packsExpanded = !packsExpanded"
      >
        <span class="text-gray-500 text-xs">{{ packsExpanded ? '▾' : '▸' }}</span>
        Preferred Sound Packs
        <span class="text-xs font-normal text-gray-500 ml-1">(empty = random any)</span>
      </button>
      <div v-if="packsExpanded" class="mt-1.5">
        <div
          v-if="soundStore.packs.length === 0"
          class="text-xs text-gray-500 italic"
        >
          No sound packs found.
        </div>
        <div v-else class="flex flex-col gap-1">
          <label
            v-for="pack in soundStore.packs"
            :key="pack.name"
            class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer"
          >
            <input
              type="checkbox"
              :checked="(character.preferredPacks ?? []).includes(pack.name)"
              class="accent-blue-500"
              @change="(e: Event) => {
                const checked = (e.target as HTMLInputElement).checked;
                const current = character?.preferredPacks ?? [];
                characterStore.updateCharacter(characterId, {
                  preferredPacks: checked
                    ? [...current, pack.name]
                    : current.filter(p => p !== pack.name),
                });
              }"
            />
            {{ pack.name }}
          </label>
        </div>
      </div>
    </div>

    <!-- Cell Size -->
    <div>
      <label class="block text-sm font-medium text-gray-300 mb-1">
        Cell Size
      </label>
      <div class="flex flex-wrap gap-1.5 mb-2">
        <button
          v-for="preset in PRESETS"
          :key="preset.label"
          :class="[
            'px-2.5 py-1 text-xs rounded transition-colors',
            !isCustomSize
              && character.cellWidth === preset.w
              && character.cellHeight === preset.h
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
          ]"
          @click="selectPreset(preset.w, preset.h)"
        >
          {{ preset.label }}
        </button>
        <button
          :class="[
            'px-2.5 py-1 text-xs rounded transition-colors',
            isCustomSize
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
          ]"
          @click="enableCustom"
        >
          Custom
        </button>
      </div>
      <div v-if="isCustomSize" class="flex items-center gap-2">
        <input
          type="number"
          :value="character.cellWidth"
          min="1"
          max="256"
          class="w-16 bg-gray-700 text-white px-1.5 py-1
                 rounded border border-gray-600 text-xs
                 focus:outline-none focus:border-blue-500"
          @input="onCellWidthInput"
        />
        <span class="text-gray-400 text-xs">&times;</span>
        <input
          type="number"
          :value="character.cellHeight"
          min="1"
          max="256"
          class="w-16 bg-gray-700 text-white px-1.5 py-1
                 rounded border border-gray-600 text-xs
                 focus:outline-none focus:border-blue-500"
          @input="onCellHeightInput"
        />
        <span class="text-gray-500 text-xs">px</span>
      </div>
    </div>

    <!-- Layout Type -->
    <div>
      <div class="flex items-center gap-3 mb-1">
        <label class="text-sm font-medium text-gray-300">
          Layout Type
        </label>
        <div class="flex items-center gap-1">
          <input
            type="number"
            :value="character.scale"
            min="0.5"
            max="4"
            step="0.5"
            class="w-14 bg-gray-700 text-white px-1.5 py-0.5
                   rounded border border-gray-600 text-xs
                   focus:outline-none focus:border-blue-500"
            @input="onScaleInput"
          />
          <span class="text-gray-400 text-xs">&times;</span>
        </div>
      </div>
      <div class="flex gap-2">
        <label
          :class="[
            'flex items-center gap-2 px-3 py-2 rounded',
            'cursor-pointer transition-colors text-sm',
            character.layoutType === 'auto-3x3'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
          ]"
        >
          <input
            type="radio"
            name="layout-type"
            value="auto-3x3"
            :checked="character.layoutType === 'auto-3x3'"
            class="sr-only"
            @change="onLayoutChange('auto-3x3')"
          />
          3&times;3
        </label>
        <label
          :class="[
            'flex items-center gap-2 px-3 py-2 rounded',
            'cursor-pointer transition-colors text-sm',
            character.layoutType === 'auto-3x4'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
          ]"
        >
          <input
            type="radio"
            name="layout-type"
            value="auto-3x4"
            :checked="character.layoutType === 'auto-3x4'"
            class="sr-only"
            @change="onLayoutChange('auto-3x4')"
          />
          3&times;4
        </label>
        <label
          :class="[
            'flex items-center gap-2 px-3 py-2 rounded',
            'cursor-pointer transition-colors text-sm',
            character.layoutType === 'manual-4x4'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
          ]"
        >
          <input
            type="radio"
            name="layout-type"
            value="manual-4x4"
            :checked="character.layoutType === 'manual-4x4'"
            class="sr-only"
            @change="onLayoutChange('manual-4x4')"
          />
          4&times;4
        </label>
      </div>
      <p class="text-xs text-gray-500 mt-1">
        <template v-if="character.layoutType === 'auto-3x3'">
          3 frames &times; 3 directions (down/up/right, left = flip)
        </template>
        <template v-else-if="character.layoutType === 'auto-3x4'">
          3 frames &times; 4 directions (down/right/up/left)
        </template>
        <template v-else>
          4 frames &times; 4 directions (down/right/up/left)
        </template>
      </p>
    </div>

    <!-- Base Region -->
    <div v-if="spriteImage">
      <label class="block text-sm font-medium text-gray-300 mb-1">
        Base Region
        <span
          v-if="spriteImage"
          class="text-xs text-gray-500 font-normal ml-2"
        >
          {{ spriteImage.naturalWidth }}&times;{{ spriteImage.naturalHeight }} px
        </span>
      </label>
      <div
        class="overflow-auto bg-gray-900 border border-gray-600
               rounded p-2 max-h-64"
      >
        <SpritesheetCanvas
          :image="spriteImage"
          :cell-width="character.cellWidth"
          :cell-height="character.cellHeight"
          :region-cols="regionCols"
          :region-rows="regionRows"
          :selected-col="hasBaseRegion ? character.baseRegion.col : -1"
          :selected-row="hasBaseRegion ? character.baseRegion.row : -1"
          @select="onBaseRegionSelect"
        />
      </div>

      <!-- Preview -->
      <div v-if="hasBaseRegion" class="mt-3">
        <label class="block text-xs text-gray-400 mb-1">
          Preview ({{ previewScale }}&times;)
        </label>
        <div
          class="inline-block bg-gray-900 border border-gray-600
                 rounded p-2"
        >
          <canvas
            ref="previewCanvas"
            style="
              image-rendering: pixelated;
              image-rendering: crisp-edges;
            "
          />
        </div>
      </div>

      <!-- Actions -->
      <div class="mt-5">
        <div class="flex items-center justify-between mb-2">
          <label class="text-sm font-medium text-gray-300">
            Actions
          </label>
          <button
            class="flex items-center gap-1 px-2 py-1 text-xs
                   bg-gray-700 hover:bg-gray-600 rounded
                   text-gray-300 transition-colors"
            @click="openAddAction"
          >
            <Plus :size="12" />
            Add Action
          </button>
        </div>

        <div
          v-if="character.actions.length === 0"
          class="text-xs text-gray-500 py-2"
        >
          No actions defined yet.
        </div>

        <div
          v-for="action in character.actions"
          :key="action.id"
          class="flex items-center gap-2 py-1.5 px-2
                 bg-gray-700/40 rounded mb-1.5"
        >
          <!-- Animated thumbnail -->
          <canvas
            :ref="(el) => setActionCanvasRef(el as HTMLCanvasElement | null, action.id)"
            class="shrink-0 bg-gray-900 rounded"
            style="
              image-rendering: pixelated;
              image-rendering: crisp-edges;
            "
            :width="character.cellWidth * 2"
            :height="character.cellHeight * 2"
          />

          <!-- Action name -->
          <span class="flex-1 min-w-0 text-white text-sm px-1">
            {{ action.name }}
          </span>

          <!-- Region label -->
          <span class="text-xs text-gray-500 shrink-0">
            {{ action.region.cols }}&times;{{ action.region.rows }}
          </span>

          <!-- Edit button -->
          <button
            class="p-1 rounded text-gray-400 hover:text-blue-400
                   hover:bg-gray-600 transition-colors shrink-0"
            title="Edit region"
            @click="openEditAction(action.id)"
          >
            <Pencil :size="13" />
          </button>

          <!-- Delete button -->
          <button
            class="p-1 rounded text-gray-400 hover:text-red-400
                   hover:bg-gray-600 transition-colors shrink-0"
            title="Delete action"
            @click="deleteAction(action.id)"
          >
            <Trash2 :size="13" />
          </button>
        </div>
      </div>
    </div>

    <!-- Action Picker Dialog -->
    <ActionPickerDialog
      v-if="showActionPicker && spriteImage"
      :image="spriteImage"
      :cell-width="character.cellWidth"
      :cell-height="character.cellHeight"
      :region-rows="regionRows"
      :existing-names="character.actions.map((a) => a.name)"
      :initial-name="editingAction?.name"
      :initial-col="editingAction?.region.col"
      :initial-row="editingAction?.region.row"
      :initial-cols="editingAction?.region.cols"
      @confirm="onActionPickerConfirm"
      @cancel="onActionPickerCancel"
    />
  </div>
</template>
