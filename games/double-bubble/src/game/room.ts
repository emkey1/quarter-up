import { T } from '@/data/tuning';

/**
 * A room: one screen, no scrolling, no camera.
 *
 * Rooms are authored as text grids because they are 32x28 and a human has to read them
 * in a diff. See DESIGN.md §9.
 */

/** Tile legend. One character per cell, GRID_W per row, GRID_H rows. */
export const enum Tile {
  /** Open air. */
  Empty = 0,
  /** Solid from every side — outer walls and pillars. */
  Solid = 1,
  /**
   * One-way platform: jumped through from below, landed on from above.
   *
   * This is the default for interior geometry. Nearly every platform in the original is
   * one-way, and that is what makes the vertical wrap a traversal tool rather than a
   * hazard — you fall off the bottom, reappear at the top, and drop through the level.
   */
  Platform = 2,
}

const TILE_CHARS: Record<string, Tile> = {
  '.': Tile.Empty,
  '#': Tile.Solid,
  '=': Tile.Platform,
};

const CHAR_FOR_TILE = ['.', '#', '='] as const;

/** Bubble drift directions. `.` is still air. */
export const enum Drift {
  None = 0,
  Left = 1,
  Right = 2,
  Up = 3,
  Down = 4,
}

const DRIFT_CHARS: Record<string, Drift> = {
  '.': Drift.None,
  l: Drift.Left,
  r: Drift.Right,
  u: Drift.Up,
  d: Drift.Down,
};

export const DRIFT_DX = [0, -1, 1, 0, 0] as const;
export const DRIFT_DY = [0, 0, 0, -1, 1] as const;

export type MonsterKind =
  | 'zenchan'
  | 'mighta'
  | 'monsta'
  | 'pulpul'
  | 'banebou'
  | 'hidegons'
  | 'drunk'
  | 'invader';

export const MONSTER_KINDS: readonly MonsterKind[] = [
  'zenchan',
  'mighta',
  'monsta',
  'pulpul',
  'banebou',
  'hidegons',
  'drunk',
  'invader',
];

export type SpecialBubble = 'water' | 'lightning' | 'fire';

export interface Spawn {
  kind: MonsterKind;
  /** Tile coordinates. */
  x: number;
  y: number;
  /** -1 or 1. */
  dir: -1 | 1;
}

export interface RoomData {
  id: string;
  /** GRID_W * GRID_H, row-major. */
  tiles: Uint8Array;
  /** GRID_W * GRID_H, row-major. Absent in source JSON means "all still". */
  drift: Uint8Array;
  driftSpeed: number;
  spawns: Spawn[];
  playerStart: { x: number; y: number };
  /**
   * Frames a trapped monster stays caught, before it reddens and breaks out.
   *
   * Per-room rather than global: the original varies this per stage, and more sharply
   * than any other per-stage value. It is the main dial for how frantic a room feels.
   */
  escapeFrames: number;
  /** Frames before HURRY UP flashes and the Baron starts his approach. */
  timer: number;
  specialBubbles: SpecialBubble[];
  /**
   * Present only on secret rooms: an encoded message hinting at the true ending.
   *
   * The plaintext ships alongside the cipher deliberately. This is lore hidden behind a
   * puzzle, not a secret being kept from the process that renders it, and having both
   * means the game can offer a decoded version once the player has earned it.
   */
  secret?: { plain: string; cipher: string };
}

export type ValidationResult =
  | { ok: true; data: RoomData }
  | { ok: false; errors: string[] };

export function tileAt(room: RoomData, tx: number, ty: number): Tile {
  if (tx < 0 || ty < 0 || tx >= T.GRID_W || ty >= T.GRID_H) return Tile.Empty;
  return room.tiles[ty * T.GRID_W + tx] as Tile;
}

export function driftAt(room: RoomData, tx: number, ty: number): Drift {
  if (tx < 0 || ty < 0 || tx >= T.GRID_W || ty >= T.GRID_H) return Drift.None;
  return room.drift[ty * T.GRID_W + tx] as Drift;
}

/** Does this tile stop a body moving downward? Both kinds do. */
export function isFloor(t: Tile): boolean {
  return t === Tile.Solid || t === Tile.Platform;
}

/** Does this tile stop a body moving sideways or upward? Only Solid does. */
export function isBlocking(t: Tile): boolean {
  return t === Tile.Solid;
}

export function serialiseTiles(tiles: Uint8Array): string[] {
  const rows: string[] = [];
  for (let y = 0; y < T.GRID_H; y++) {
    let row = '';
    for (let x = 0; x < T.GRID_W; x++) row += CHAR_FOR_TILE[tiles[y * T.GRID_W + x]] ?? '.';
    rows.push(row);
  }
  return rows;
}

/**
 * Parse and check a room from untrusted JSON.
 *
 * The editor is a tool, not a trusted source, and a malformed room should say what is
 * wrong rather than crash the game or — worse — load into something unplayable.
 */
export function validateRoom(input: unknown): ValidationResult {
  const errors: string[] = [];
  const fail = (m: string): ValidationResult => ({ ok: false, errors: [...errors, m] });

  if (typeof input !== 'object' || input === null) return fail('room is not an object');
  const o = input as Record<string, unknown>;

  const id = typeof o.id === 'string' && o.id ? o.id : null;
  if (!id) errors.push('id: missing or not a string');

  const grid = parseGrid(o.tiles, TILE_CHARS, 'tiles', errors);
  const drift = o.drift === undefined
    ? new Uint8Array(T.GRID_W * T.GRID_H)
    : parseGrid(o.drift, DRIFT_CHARS, 'drift', errors);

  const spawns: Spawn[] = [];
  if (!Array.isArray(o.spawns)) {
    errors.push('spawns: missing or not an array');
  } else {
    o.spawns.forEach((raw, i) => {
      const s = raw as Record<string, unknown>;
      const kind = s?.kind;
      if (typeof kind !== 'string' || !MONSTER_KINDS.includes(kind as MonsterKind)) {
        errors.push(`spawns[${i}].kind: not a known monster (${String(kind)})`);
        return;
      }
      if (!inGrid(s.x, s.y)) {
        errors.push(`spawns[${i}]: position (${String(s.x)}, ${String(s.y)}) is outside the room`);
        return;
      }
      const dir = s.dir === -1 ? -1 : 1;
      spawns.push({ kind: kind as MonsterKind, x: s.x as number, y: s.y as number, dir });
    });
    // A room with no monsters can never be cleared: the exit condition is an empty room,
    // so it would complete on frame 1 or hang forever depending on how flow is written.
    if (o.spawns.length === 0) errors.push('spawns: a room needs at least one monster');
  }

  const ps = o.playerStart as Record<string, unknown> | undefined;
  if (!ps || !inGrid(ps.x, ps.y)) {
    errors.push('playerStart: missing or outside the room');
  }

  const specialBubbles: SpecialBubble[] = [];
  if (o.specialBubbles !== undefined) {
    if (!Array.isArray(o.specialBubbles)) {
      errors.push('specialBubbles: not an array');
    } else {
      for (const b of o.specialBubbles) {
        if (b === 'water' || b === 'lightning' || b === 'fire') specialBubbles.push(b);
        else errors.push(`specialBubbles: unknown kind ${String(b)}`);
      }
    }
  }

  const rawSecret = o.secret as Record<string, unknown> | undefined;
  let secret: { plain: string; cipher: string } | undefined;
  if (rawSecret !== undefined) {
    if (typeof rawSecret?.plain !== 'string' || typeof rawSecret?.cipher !== 'string') {
      errors.push('secret: needs both a plain and a cipher string');
    } else {
      secret = { plain: rawSecret.plain, cipher: rawSecret.cipher };
    }
  }

  if (errors.length > 0 || !grid || !drift || !id || !ps) return { ok: false, errors };

  return {
    ok: true,
    data: {
      id,
      tiles: grid,
      drift,
      driftSpeed: num(o.driftSpeed, 0.4),
      spawns,
      playerStart: { x: ps.x as number, y: ps.y as number },
      escapeFrames: num(o.escapeFrames, T.ESCAPE_FRAMES),
      timer: num(o.timer, T.ROOM_TIMER),
      specialBubbles,
      ...(secret ? { secret } : {}),
    },
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function inGrid(x: unknown, y: unknown): boolean {
  return (
    typeof x === 'number' &&
    typeof y === 'number' &&
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x < T.GRID_W &&
    y < T.GRID_H
  );
}

function parseGrid(
  raw: unknown,
  legend: Record<string, number>,
  field: string,
  errors: string[],
): Uint8Array | null {
  if (!Array.isArray(raw)) {
    errors.push(`${field}: missing or not an array of strings`);
    return null;
  }
  if (raw.length !== T.GRID_H) {
    errors.push(`${field}: ${raw.length} rows, expected ${T.GRID_H}`);
    return null;
  }
  const out = new Uint8Array(T.GRID_W * T.GRID_H);
  let bad = 0;
  for (let y = 0; y < T.GRID_H; y++) {
    const row = raw[y];
    if (typeof row !== 'string' || row.length !== T.GRID_W) {
      errors.push(`${field}[${y}]: ${typeof row === 'string' ? `${row.length} cells` : 'not a string'}, expected ${T.GRID_W}`);
      return null;
    }
    for (let x = 0; x < T.GRID_W; x++) {
      const v = legend[row[x]];
      if (v === undefined) {
        // Report the first few only — a wrong legend produces 896 identical errors.
        if (bad < 3) errors.push(`${field}[${y}][${x}]: unknown character '${row[x]}'`);
        bad++;
        continue;
      }
      out[y * T.GRID_W + x] = v;
    }
  }
  if (bad > 3) errors.push(`${field}: ${bad - 3} further unknown characters`);
  return bad > 0 ? null : out;
}
