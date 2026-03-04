export type SpriteLayoutType = 'auto-3x3' | 'auto-3x4' | 'manual-4x4';

export interface SpriteRegion {
  col: number;
  row: number;
  cols: number;
  rows: number;
}

export interface ActionDefinition {
  id: string;
  name: string;
  region: SpriteRegion;
}

export interface CharacterDefinition {
  id: string;
  name: string;
  spriteBlob: Blob;
  cellWidth: number;
  cellHeight: number;
  layoutType: SpriteLayoutType;
  baseRegion: SpriteRegion;
  actions: ActionDefinition[];
  scale: number;
  isSubagent?: boolean;
  preferredPacks?: string[];
}
