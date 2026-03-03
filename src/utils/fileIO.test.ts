import { describe, it, expect } from 'vitest';
import {
  serializeMapToJson,
  deserializeMapFromJson,
  migrateObjects,
} from './fileIO';
import type { MapData } from '../types';

function makeBlob(content: string): Blob {
  return new Blob(
    [new TextEncoder().encode(content)],
    { type: 'image/png' },
  );
}

async function blobToText(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await blob.arrayBuffer());
}

describe('fileIO round-trip', () => {
  it('round-trips map with tilesetPool and autoTilePool', async () => {
    const mapData: MapData = {
      width: 3,
      height: 2,
      tileSize: 32,
      layers: [
        [
          [
            { x: 0, y: 0, slot: 'A' },
            { autoTileIndex: 0 },
            null,
          ],
          [
            null,
            { x: 1, y: 2, slot: 'B' },
            { autoTileIndex: 1 },
          ],
        ],
      ],
      objects: [],
    };

    const poolBlobs: Record<string, Blob | null> = {
      A: makeBlob('tileset-A-data'),
      B: makeBlob('tileset-B-data'),
      C: null,
    };

    const autoTileEntries = [
      { blob: makeBlob('autotile-0-data'), type: 'A' as const },
      { blob: makeBlob('autotile-1-data'), type: 'B' as const },
    ];

    const json = await serializeMapToJson(
      mapData, poolBlobs, autoTileEntries,
    );
    const loaded = deserializeMapFromJson(json);

    // MapData matches
    expect(loaded.mapData.width).toBe(3);
    expect(loaded.mapData.height).toBe(2);
    expect(loaded.mapData.tileSize).toBe(32);
    expect(loaded.mapData.layers).toHaveLength(1);

    const layer = loaded.mapData.layers[0]!;
    expect(layer[0]![0]).toEqual({ x: 0, y: 0, slot: 'A' });
    expect(layer[0]![1]).toEqual({ autoTileIndex: 0 });
    expect(layer[0]![2]).toBeNull();
    expect(layer[1]![0]).toBeNull();
    expect(layer[1]![1]).toEqual({ x: 1, y: 2, slot: 'B' });
    expect(layer[1]![2]).toEqual({ autoTileIndex: 1 });

    // Tileset pool blobs match
    expect(Object.keys(loaded.poolBlobs)).toEqual(['A', 'B', 'C']);
    expect(
      await blobToText(loaded.poolBlobs['A']!),
    ).toBe('tileset-A-data');
    expect(
      await blobToText(loaded.poolBlobs['B']!),
    ).toBe('tileset-B-data');
    expect(loaded.poolBlobs['C']).toBeNull();

    // Autotile pool entries match
    expect(loaded.autoTileEntries).toHaveLength(2);
    expect(loaded.autoTileEntries[0]!.type).toBe('A');
    expect(
      await blobToText(loaded.autoTileEntries[0]!.blob!),
    ).toBe('autotile-0-data');
    expect(loaded.autoTileEntries[1]!.type).toBe('B');
    expect(
      await blobToText(loaded.autoTileEntries[1]!.blob!),
    ).toBe('autotile-1-data');
  });

  it('handles empty autoTilePool', async () => {
    const mapData: MapData = {
      width: 1,
      height: 1,
      layers: [[[null]]],
      objects: [],
    };

    const json = await serializeMapToJson(mapData, {}, []);
    const loaded = deserializeMapFromJson(json);

    expect(loaded.autoTileEntries).toHaveLength(0);
    expect(Object.keys(loaded.poolBlobs)).toHaveLength(0);
  });

  it('round-trips objects with direction', async () => {
    const mapData: MapData = {
      width: 2,
      height: 2,
      layers: [[[null, null], [null, null]]],
      objects: [
        {
          id: 'obj-1',
          x: 0,
          y: 1,
          type: 'computer',
          direction: 'right',
        },
      ],
    };

    const json = await serializeMapToJson(mapData, {}, []);
    const loaded = deserializeMapFromJson(json);

    expect(loaded.mapData.objects).toHaveLength(1);
    const obj = loaded.mapData.objects[0]!;
    expect(obj.type).toBe('computer');
    expect(obj.direction).toBe('right');
    expect(obj).not.toHaveProperty('tile');
  });
});

describe('migrateObjects', () => {
  it('adds direction "down" to legacy objects with tile', () => {
    const data = {
      width: 1,
      height: 1,
      layers: [[[null]]],
      objects: [
        {
          id: 'old-1',
          x: 0,
          y: 0,
          type: 'books',
          tile: { x: 2, y: 3, slot: 'A' },
        },
      ],
    } as unknown as MapData;

    migrateObjects(data);

    const obj = data.objects[0]!;
    expect(obj.direction).toBe('down');
    expect(obj).not.toHaveProperty('tile');
  });

  it('preserves existing direction', () => {
    const data: MapData = {
      width: 1,
      height: 1,
      layers: [[[null]]],
      objects: [
        {
          id: 'new-1',
          x: 0,
          y: 0,
          type: 'coffee',
          direction: 'left',
        },
      ],
    };

    migrateObjects(data);

    expect(data.objects[0]!.direction).toBe('left');
  });
});
