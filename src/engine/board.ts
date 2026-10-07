import { DATA, type Resource } from './data';
import type { Board, Cell, GameState } from './types';
import { randInt, shuffle } from './rng';

export const TILE_SIZE = 6;

const RESOURCE_CODES: Record<string, Resource> = { C: 'clay', T: 'wood', I: 'ivory', D: 'diamonds' };

/** Rotate a square grid of strings 90 degrees clockwise `turns` times. */
export function rotateGrid(grid: string[], turns: number): string[] {
  let g = grid;
  for (let t = 0; t < ((turns % 4) + 4) % 4; t++) {
    const n = g.length;
    const out: string[] = [];
    for (let r = 0; r < n; r++) {
      let row = '';
      for (let c = 0; c < n; c++) row += g[n - 1 - c][r];
      out.push(row);
    }
    g = out;
  }
  return g;
}

function cellFromCode(code: string): Cell {
  const cell: Cell = { water: code === 'W', used: 0 };
  if (RESOURCE_CODES[code]) cell.resource = RESOURCE_CODES[code];
  if (code === 'S') cell.start = true;
  return cell;
}

/** Build a random map for the player count. Returns the board and the advanced RNG state. */
export function buildMap(players: number, rngIn: number): { board: Board; rng: number } {
  let rng = rngIn;
  const layout = DATA.mapLayouts[String(players)];
  if (!layout) throw new Error(`No map layout for ${players} players`);
  const others = Object.keys(DATA.tiles).filter((k) => !DATA.tiles[k].start);
  const startKey = Object.keys(DATA.tiles).find((k) => DATA.tiles[k].start)!;
  let order: string[];
  [order, rng] = shuffle(others, rng);

  const tileRows = layout.length;
  const tileCols = layout[0].length;
  const width = tileCols * TILE_SIZE;
  const height = tileRows * TILE_SIZE;
  const cells: (Cell | null)[] = new Array(width * height).fill(null);

  let next = 0;
  for (let tr = 0; tr < tileRows; tr++) {
    for (let tc = 0; tc < tileCols; tc++) {
      const slot = layout[tr][tc];
      if (slot === '-') continue;
      const key = slot === '*' ? startKey : order[next++];
      let turns: number;
      [turns, rng] = randInt(4, rng);
      const grid = rotateGrid(DATA.tiles[key].grid, turns);
      for (let r = 0; r < TILE_SIZE; r++) {
        for (let c = 0; c < TILE_SIZE; c++) {
          const y = tr * TILE_SIZE + r;
          const x = tc * TILE_SIZE + c;
          cells[y * width + x] = cellFromCode(grid[r][c]);
        }
      }
    }
  }
  const board: Board = { width, height, cells, waterArea: [] };
  computeWaterAreas(board);
  return { board, rng };
}

/** Build a board directly from rows of tile codes ('x' = off-map). Used by tests. */
export function boardFromRows(rows: string[]): Board {
  const height = rows.length;
  const width = rows[0].length;
  const cells: (Cell | null)[] = [];
  for (const row of rows) {
    for (const ch of row) cells.push(ch === 'x' ? null : cellFromCode(ch));
  }
  const board: Board = { width, height, cells, waterArea: [] };
  computeWaterAreas(board);
  return board;
}

export function computeWaterAreas(board: Board): void {
  const area = new Array(board.cells.length).fill(-1);
  let id = 0;
  for (let i = 0; i < board.cells.length; i++) {
    if (!board.cells[i]?.water || area[i] !== -1) continue;
    const stack = [i];
    area[i] = id;
    while (stack.length) {
      const cur = stack.pop()!;
      for (const n of orthNeighbors(board, cur)) {
        if (board.cells[n]?.water && area[n] === -1) {
          area[n] = id;
          stack.push(n);
        }
      }
    }
    id++;
  }
  board.waterArea = area;
}

export function xy(board: Board, i: number): [number, number] {
  return [i % board.width, Math.floor(i / board.width)];
}

export function idx(board: Board, x: number, y: number): number {
  return y * board.width + x;
}

export function inBoard(board: Board, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < board.width && y < board.height && board.cells[y * board.width + x] !== null;
}

export function orthNeighbors(board: Board, i: number): number[] {
  const [x, y] = xy(board, i);
  const out: number[] = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (inBoard(board, x + dx, y + dy)) out.push(idx(board, x + dx, y + dy));
  }
  return out;
}

export function neighbors8(board: Board, i: number): number[] {
  const [x, y] = xy(board, i);
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && inBoard(board, x + dx, y + dy)) out.push(idx(board, x + dx, y + dy));
    }
  }
  return out;
}

/** Empty land: not water, and no resource, start area, monument or craftsman. */
export function isEmptyLand(cell: Cell | null): boolean {
  return !!cell && !cell.water && !cell.resource && !cell.start && !cell.monument && cell.craftsman === undefined;
}

/**
 * Distances (in steps) from a set of source cells, up to `range`.
 * Steps go in 8 directions; moving within one continuous water area is free,
 * so a whole water area counts as a single step.
 * With `stopAtMonuments`, monument cells can be reached but not passed through
 * (passing a monument forces using it as a hub).
 */
export function distances(board: Board, sources: number[], range: number, stopAtMonuments: boolean): Map<number, number> {
  const dist = new Map<number, number>();
  const deque: number[] = [];
  const srcSet = new Set(sources);
  for (const s of sources) {
    dist.set(s, 0);
    deque.push(s);
  }
  // 0-1 BFS
  let head = 0;
  const front: number[] = [];
  while (front.length || head < deque.length) {
    const cur = front.length ? front.pop()! : deque[head++];
    const d = dist.get(cur)!;
    const cell = board.cells[cur]!;
    if (stopAtMonuments && cell.monument && !srcSet.has(cur)) continue;
    for (const n of neighbors8(board, cur)) {
      const nc = board.cells[n]!;
      const sameWater = cell.water && nc.water && board.waterArea[cur] === board.waterArea[n];
      const nd = d + (sameWater ? 0 : 1);
      if (nd > range) continue;
      const old = dist.get(n);
      if (old !== undefined && old <= nd) continue;
      dist.set(n, nd);
      if (sameWater) front.push(n);
      else deque.push(n);
    }
  }
  return dist;
}

/** Cells within range of the given cells (no hubs). */
export function cellsInRange(state: GameState, from: number[], range: number, stopAtMonuments = false): Set<number> {
  const key = `${stopAtMonuments ? 'm' : 'r'}${range}:${from.join(',')}`;
  const cache = rangeCache(state);
  let hit = cache.get(key);
  if (!hit) {
    hit = new Set(distances(state.board, from, range, stopAtMonuments).keys());
    cache.set(key, hit);
  }
  return hit;
}

const caches = new WeakMap<GameState, Map<string, Set<number>>>();
function rangeCache(state: GameState): Map<string, Set<number>> {
  let c = caches.get(state);
  if (!c) {
    c = new Map();
    caches.set(state, c);
  }
  return c;
}

/**
 * Minimum number of hubs (monuments of any owner) needed to reach any of
 * `target` cells from `from` cells. 0 = in direct range. Infinity = unreachable.
 */
export function hubsNeeded(state: GameState, from: number[], target: number[], range: number): number {
  const targetSet = new Set(target);
  const reached = (cells: Set<number>) => {
    for (const t of targetSet) if (cells.has(t)) return true;
    return false;
  };
  let frontier = [from];
  const seen = new Set<number>(from);
  for (let hubs = 0; frontier.length; hubs++) {
    const next: number[][] = [];
    for (const src of frontier) {
      const cells = cellsInRange(state, src, range, true);
      if (reached(cells)) return hubs;
      for (const c of cells) {
        if (state.board.cells[c]!.monument && !seen.has(c)) {
          seen.add(c);
          next.push([c]);
        }
      }
    }
    frontier = next;
  }
  return Infinity;
}

/** Forget cached ranges after the board changes. */
export function invalidateRanges(state: GameState): void {
  caches.delete(state);
}
