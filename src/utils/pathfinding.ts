import {
  DIR_UP, DIR_RIGHT, DIR_DOWN, DIR_LEFT,
} from '../types';

export interface Point {
  x: number;
  y: number;
}

function getKey(p: Point): string {
  return `${p.x},${p.y}`;
}

function getPoint(key: string): Point {
  const [x, y] = key.split(',').map(Number);
  return { x: x || 0, y: y || 0 };
}

function heuristic(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Check if movement from (fromX,fromY) to (toX,toY) is allowed
 * by directional collision masks.
 * Returns true if passable, false if blocked.
 */
export function isDirPassable(
  grid: number[][],
  fromX: number, fromY: number,
  toX: number, toY: number,
): boolean {
  const dx = toX - fromX;
  const dy = toY - fromY;

  const srcMask = grid[fromY]?.[fromX] ?? 0;
  const dstMask = grid[toY]?.[toX] ?? 0;

  if (dx === 1) {
    if ((srcMask & DIR_RIGHT) || (dstMask & DIR_LEFT)) return false;
  } else if (dx === -1) {
    if ((srcMask & DIR_LEFT) || (dstMask & DIR_RIGHT)) return false;
  }

  if (dy === 1) {
    if ((srcMask & DIR_DOWN) || (dstMask & DIR_UP)) return false;
  } else if (dy === -1) {
    if ((srcMask & DIR_UP) || (dstMask & DIR_DOWN)) return false;
  }

  return true;
}

const MAX_NODES = 2000;

export function findPath(
  start: Point,
  end: Point,
  width: number,
  height: number,
  isWalkable: (
    x: number, y: number,
    fromX?: number, fromY?: number,
  ) => boolean,
): Point[] {
  const openSet = new Set<string>();
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();

  const startKey = getKey(start);
  const endKey = getKey(end);

  openSet.add(startKey);
  gScore.set(startKey, 0);
  fScore.set(startKey, heuristic(start, end));

  let visited = 0;

  while (openSet.size > 0) {
    if (++visited > MAX_NODES) return [];

    let currentKey = '';
    let lowestF = Infinity;

    for (const key of openSet) {
      const f = fScore.get(key) ?? Infinity;
      if (f < lowestF) {
        lowestF = f;
        currentKey = key;
      }
    }

    if (currentKey === '') break;

    if (currentKey === endKey) {
      const path: Point[] = [];
      let curr = currentKey;
      while (cameFrom.has(curr)) {
        path.unshift(getPoint(curr));
        curr = cameFrom.get(curr)!;
      }
      return path;
    }

    openSet.delete(currentKey);
    const current = getPoint(currentKey);

    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];

    for (const n of neighbors) {
      if (n.x < 0 || n.x >= width || n.y < 0 || n.y >= height) continue;
      if (!isWalkable(n.x, n.y, current.x, current.y)) continue;

      const nKey = getKey(n);
      const tentativeG = (gScore.get(currentKey) ?? Infinity) + 1;

      if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
        cameFrom.set(nKey, currentKey);
        gScore.set(nKey, tentativeG);
        fScore.set(nKey, tentativeG + heuristic(n, end));
        if (!openSet.has(nKey)) {
          openSet.add(nKey);
        }
      }
    }
  }

  return [];
}
