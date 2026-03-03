import type { TileLayer, CellValue } from '../types';
import { isAutoTile, isRegularTile } from '../types';

export function tilesMatch(
  t1: CellValue | undefined,
  t2: CellValue | undefined,
): boolean {
  if (!t1 && !t2) return true;
  if (!t1 || !t2) return false;
  if (isRegularTile(t1) && isRegularTile(t2)) {
    return t1.x === t2.x && t1.y === t2.y && t1.slot === t2.slot;
  }
  if (isAutoTile(t1) && isAutoTile(t2)) {
    return t1.autoTileIndex === t2.autoTileIndex;
  }
  return false;
}

export function getFloodFillCells(
  layer: TileLayer,
  startX: number,
  startY: number,
  width: number,
  height: number,
): { x: number; y: number }[] {
  if (!layer || !layer[startY]) return [];
  const targetTile = layer[startY][startX];
  const stack: { x: number; y: number }[] = [{ x: startX, y: startY }];
  const visited = new Set<string>();
  const result: { x: number; y: number }[] = [];

  const key = (x: number, y: number) => `${x},${y}`;

  visited.add(key(startX, startY));

  while (stack.length > 0) {
    const { x, y } = stack.pop()!;
    result.push({ x, y });

    const neighbors = [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 },
    ];

    for (const n of neighbors) {
      if (
        n.x >= 0 &&
        n.x < width &&
        n.y >= 0 &&
        n.y < height &&
        !visited.has(key(n.x, n.y))
      ) {
        if (tilesMatch(layer[n.y]?.[n.x], targetTile)) {
          visited.add(key(n.x, n.y));
          stack.push(n);
        }
      }
    }
  }

  return result;
}
