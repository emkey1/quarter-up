import { T } from '@/data/tuning';
import { Terrain, Tile, TILE_GLYPHS } from './terrain';

export type LevelType = 'normal' | 'intro' | 'treasure';

export interface LevelObject {
  t: string;
  x: number;
  y: number;
  kind?: string;
  lvl?: number;
  breakable?: boolean;
  skipTo?: number | null;
  opens?: [number, number][];
  /** Text painted on the floor at this cell. Used by the level-select to say where each
   *  door goes — an unlabelled door asks you to gamble on a number you cannot see. */
  text?: string;
}

export interface LevelData {
  id: string;
  name: string;
  theme: string;
  type: LevelType;
  start: [number, number];
  tiles: string[];
  objects: LevelObject[];
}

/**
 * Validates rather than trusts. Every shipped level runs through this in CI
 * (DESIGN.md §13), so a malformed maze fails the build instead of the player.
 */
export function validateLevel(data: unknown): { ok: true; data: LevelData } | { ok: false; errors: string[] } {
  const e: string[] = [];
  const d = data as Partial<LevelData>;

  if (typeof d?.id !== 'string' || !d.id) e.push('id must be a non-empty string');
  if (typeof d?.name !== 'string') e.push('name must be a string');
  if (typeof d?.theme !== 'string') e.push('theme must be a string');
  if (d?.type !== 'normal' && d?.type !== 'intro' && d?.type !== 'treasure') {
    e.push('type must be normal | intro | treasure');
  }

  if (!Array.isArray(d?.tiles) || d.tiles.length !== T.GRID) {
    e.push(`tiles must be ${T.GRID} rows (got ${Array.isArray(d?.tiles) ? d!.tiles.length : 'none'})`);
  } else {
    d.tiles.forEach((row, y) => {
      if (typeof row !== 'string' || row.length !== T.GRID) {
        e.push(`tiles[${y}] must be ${T.GRID} chars (got ${row?.length ?? 'none'})`);
        return;
      }
      for (let x = 0; x < row.length; x++) {
        const g = row[x];
        if (!(g in TILE_GLYPHS)) e.push(`tiles[${y}][${x}]: unknown glyph ${JSON.stringify(g)}`);
      }
    });
  }

  if (
    !Array.isArray(d?.start) ||
    d.start.length !== 2 ||
    !d.start.every((n) => Number.isInteger(n) && n >= 0 && n < T.GRID)
  ) {
    e.push('start must be [cx, cy] within the grid');
  }

  if (!Array.isArray(d?.objects)) e.push('objects must be an array');
  else {
    d.objects.forEach((o, i) => {
      if (!o || typeof o.t !== 'string') e.push(`objects[${i}].t must be a string`);
      if (!Number.isInteger(o?.x) || o.x < 0 || o.x >= T.GRID) e.push(`objects[${i}].x out of range`);
      if (!Number.isInteger(o?.y) || o.y < 0 || o.y >= T.GRID) e.push(`objects[${i}].y out of range`);
    });
  }

  if (e.length) return { ok: false, errors: e };

  // Start must not be inside a wall — the single most likely authoring mistake.
  const full = d as LevelData;
  const startGlyph = full.tiles[full.start[1]]![full.start[0]];
  const startTile = TILE_GLYPHS[startGlyph!];
  if (startTile === Tile.Wall || startTile === Tile.Void || startTile === Tile.Breakable) {
    return { ok: false, errors: [`start [${full.start}] is inside a solid tile`] };
  }

  return { ok: true, data: full };
}

export function buildTerrain(data: LevelData): Terrain {
  const t = new Terrain();
  for (let cy = 0; cy < T.GRID; cy++) {
    const row = data.tiles[cy]!;
    for (let cx = 0; cx < T.GRID; cx++) {
      t.tiles[t.idx(cx, cy)] = TILE_GLYPHS[row[cx]!] ?? Tile.Void;
    }
  }
  t.clearDirty();
  return t;
}

/** Cell centre in world units. */
export function cellCentre(cx: number, cy: number): [number, number] {
  return [cx * T.TILE + T.TILE / 2, cy * T.TILE + T.TILE / 2];
}
