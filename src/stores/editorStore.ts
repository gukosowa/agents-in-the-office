import { defineStore } from 'pinia';
import { ref } from 'vue';
import type {
  Tile, AutoTile, CellValue, Direction, ToolType,
} from '../types';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4.0;

export const useEditorStore = defineStore('editor', () => {
  const selectedTool = ref<ToolType>('pen');
  const activeLayer = ref(0); // 0, 1, 2 for drawing, 3 for interactive
  const selectedTile = ref<Tile | null>(null);
  const selectedSelection = ref<{x: number, y: number, w: number, h: number, slot: string} | null>(null);
  const selectedAutoTile = ref<AutoTile | null>(null);
  const activeSlot = ref('A');

  const zoom = ref(1.0);
  const panX = ref(0);
  const panY = ref(0);

  const dialogState = ref<{
    isOpen: boolean;
    x: number;
    y: number;
    initialType?: string;
    initialDirection?: Direction;
  }>({ isOpen: false, x: 0, y: 0 });

  const isDrawing = ref(false);
  const rectMode = ref(false);
  const lineMode = ref(false);
  const showCollision = ref(false);
  const showGrid = ref(true);
  const showInteractiveLayer = ref(false);

  /** Rectangle selected on the map canvas (grid coords) */
  const mapSelection = ref<{
    x: number; y: number; w: number; h: number;
  } | null>(null);

  /** Tiles copied to clipboard via Ctrl+C */
  const clipboard = ref<CellValue[][] | null>(null);

  function openDialog(
    x: number,
    y: number,
    initialType?: string,
    initialDirection?: Direction,
  ) {
    dialogState.value = {
      isOpen: true, x, y, initialType, initialDirection,
    };
  }

  function closeDialog() {
    dialogState.value.isOpen = false;
  }

  function setTool(tool: ToolType) {
    if (tool !== 'select' && tool !== 'move') {
      mapSelection.value = null;
    }
    selectedTool.value = tool;
  }

  function setLayer(layer: number) {
    if (layer >= 0) {
      activeLayer.value = layer;
    }
  }

  function setSelectedTile(tile: Tile) {
    selectedTile.value = tile;
    selectedSelection.value = null;
    selectedAutoTile.value = null;
  }

  function setSelectedSelection(rect: {x: number, y: number, w: number, h: number, slot: string}) {
    selectedSelection.value = rect;
    selectedTile.value = null;
    selectedAutoTile.value = null;
  }

  function setSelectedAutoTile(autoTile: AutoTile) {
    selectedAutoTile.value = autoTile;
    selectedTile.value = null;
    selectedSelection.value = null;
  }

  function clearMultiSelections() {
    selectedSelection.value = null;
    selectedAutoTile.value = null;
  }

  function setZoom(
    newZoom: number,
    centerX?: number,
    centerY?: number,
  ) {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    if (centerX !== undefined && centerY !== undefined) {
      const worldX = (centerX - panX.value) / zoom.value;
      const worldY = (centerY - panY.value) / zoom.value;
      panX.value = centerX - worldX * clamped;
      panY.value = centerY - worldY * clamped;
    }
    zoom.value = clamped;
  }

  function setPan(x: number, y: number) {
    panX.value = x;
    panY.value = y;
  }

  function setMapSelection(
    rect: { x: number; y: number; w: number; h: number } | null,
  ) {
    mapSelection.value = rect;
  }

  function clearMapSelection() {
    mapSelection.value = null;
  }

  function fitToView(
    viewWidth: number,
    viewHeight: number,
    mapPixelWidth: number,
    mapPixelHeight: number,
    offsetX = 0,
    offsetY = 0,
  ) {
    const scaleX = viewWidth / mapPixelWidth;
    const scaleY = viewHeight / mapPixelHeight;
    const fit = Math.max(
      MIN_ZOOM,
      Math.min(MAX_ZOOM, Math.min(scaleX, scaleY) * 0.9),
    );
    zoom.value = fit;
    panX.value = offsetX + (viewWidth - mapPixelWidth * fit) / 2;
    panY.value = offsetY + (viewHeight - mapPixelHeight * fit) / 2;
  }

  return {
    selectedTool,
    activeLayer,
    selectedTile,
    selectedSelection,
    selectedAutoTile,
    activeSlot,
    showCollision,
    showGrid,
    showInteractiveLayer,
    zoom,
    panX,
    panY,
    dialogState,
    isDrawing,
    rectMode,
    lineMode,
    mapSelection,
    clipboard,
    openDialog,
    closeDialog,
    setTool,
    setLayer,
    setSelectedTile,
    setSelectedSelection,
    setSelectedAutoTile,
    clearMultiSelections,
    setMapSelection,
    clearMapSelection,
    setZoom,
    setPan,
    fitToView,
  };
});
