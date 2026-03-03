import char0 from '../assets/characters/char_0.png';
import char1 from '../assets/characters/char_1.png';
import char2 from '../assets/characters/char_2.png';
import char3 from '../assets/characters/char_3.png';
import char4 from '../assets/characters/char_4.png';
import char5 from '../assets/characters/char_5.png';
import type { CharacterDefinition } from '../types/character';

const SPRITE_URLS = [
  char0, char1, char2, char3, char4, char5,
];

async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch sprite: ${url}`);
  }
  return res.blob();
}

let cached: Promise<CharacterDefinition[]> | null = null;

export function createFallbackDefinitions():
  Promise<CharacterDefinition[]> {
  if (!cached) {
    cached = Promise.all(
      SPRITE_URLS.map(async (url, i) => {
        const blob = await fetchBlob(url);
        const def: CharacterDefinition = {
          id: `fallback-${i}`,
          name: `Character ${i + 1}`,
          spriteBlob: blob,
          cellWidth: 16,
          cellHeight: 32,
          layoutType: 'auto-3x3',
          baseRegion: {
            col: 0, row: 0, cols: 3, rows: 3,
          },
          actions: [
            {
              id: `fallback-${i}-prog`,
              name: 'programming',
              region: {
                col: 3, row: 0, cols: 2, rows: 3,
              },
            },
            {
              id: `fallback-${i}-read`,
              name: 'reading',
              region: {
                col: 5, row: 0, cols: 2, rows: 3,
              },
            },
          ],
          scale: 1,
        };
        return def;
      }),
    );
  }
  return cached;
}
