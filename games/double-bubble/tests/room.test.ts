import { describe, it, expect } from 'vitest';
import {
  Drift,
  Tile,
  driftAt,
  isBlocking,
  isFloor,
  tileAt,
  validateRoom,
  serialiseTiles,
} from '@/game/room';
import { T } from '@/data/tuning';
import room001 from '@/data/rooms/r001.json';

/** A minimal valid room, so each test can break exactly one thing. */
function goodRoom(over: Record<string, unknown> = {}): Record<string, unknown> {
  const rows: string[] = [];
  for (let y = 0; y < T.GRID_H; y++) {
    rows.push(y === T.GRID_H - 2 ? '#'.repeat(T.GRID_W) : '#' + '.'.repeat(T.GRID_W - 2) + '#');
  }
  return {
    id: 'test',
    tiles: rows,
    playerStart: { x: 4, y: T.GRID_H - 3 },
    spawns: [{ kind: 'zenchan', x: 8, y: T.GRID_H - 3, dir: 1 }],
    ...over,
  };
}

describe('validateRoom', () => {
  it('accepts the bundled room 1', () => {
    const r = validateRoom(room001);
    if (!r.ok) throw new Error(`r001 should be valid:\n${r.errors.join('\n')}`);
    expect(r.data.id).toBe('r001');
    expect(r.data.tiles.length).toBe(T.GRID_W * T.GRID_H);
    expect(r.data.spawns.length).toBe(2);
  });

  it('round-trips a tile grid through serialise', () => {
    const r = validateRoom(room001);
    if (!r.ok) throw new Error('unreachable');
    expect(serialiseTiles(r.data.tiles)).toEqual(room001.tiles);
  });

  it('defaults the drift field to still air when absent', () => {
    const r = validateRoom(goodRoom());
    if (!r.ok) throw new Error(r.errors.join('\n'));
    expect(r.data.drift.length).toBe(T.GRID_W * T.GRID_H);
    expect([...r.data.drift].every((d) => d === Drift.None)).toBe(true);
  });

  it('reads the drift field when present', () => {
    const r = validateRoom(room001);
    if (!r.ok) throw new Error('unreachable');
    // Room 1 runs a rightward current along the top four rows.
    expect(driftAt(r.data, 10, 0)).toBe(Drift.Right);
    expect(driftAt(r.data, 10, 3)).toBe(Drift.Right);
    expect(driftAt(r.data, 10, 4)).toBe(Drift.None);
  });

  it('applies tuning defaults for the optional clocks', () => {
    const r = validateRoom(goodRoom());
    if (!r.ok) throw new Error(r.errors.join('\n'));
    expect(r.data.escapeFrames).toBe(T.ESCAPE_FRAMES);
    expect(r.data.timer).toBe(T.ROOM_TIMER);
  });

  it('keeps a per-room escape time over the default', () => {
    const r = validateRoom(goodRoom({ escapeFrames: 120 }));
    if (!r.ok) throw new Error(r.errors.join('\n'));
    expect(r.data.escapeFrames).toBe(120);
  });

  it('rejects a grid with the wrong number of rows, naming the count', () => {
    const r = validateRoom(goodRoom({ tiles: ['#'.repeat(T.GRID_W)] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join()).toMatch(/1 rows, expected 28/);
  });

  it('rejects a short row, naming the row and its width', () => {
    const rows = (goodRoom().tiles as string[]).slice();
    rows[13] = '.'.repeat(T.GRID_W - 1);
    const r = validateRoom(goodRoom({ tiles: rows }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join()).toMatch(/tiles\[13\]: 31 cells, expected 32/);
  });

  it('reports unknown characters but caps the flood', () => {
    const rows = new Array(T.GRID_H).fill('?'.repeat(T.GRID_W));
    const r = validateRoom(goodRoom({ tiles: rows }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // 896 bad cells must not become 896 error lines.
    expect(r.errors.length).toBeLessThan(8);
    expect(r.errors.join()).toMatch(/further unknown characters/);
  });

  it('rejects a room with no monsters, because it could never be cleared', () => {
    const r = validateRoom(goodRoom({ spawns: [] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join()).toMatch(/at least one monster/);
  });

  it('rejects a spawn outside the grid', () => {
    const r = validateRoom(goodRoom({ spawns: [{ kind: 'zenchan', x: 99, y: 2, dir: 1 }] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join()).toMatch(/outside the room/);
  });

  it('rejects an unknown monster kind', () => {
    const r = validateRoom(goodRoom({ spawns: [{ kind: 'goomba', x: 4, y: 2, dir: 1 }] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join()).toMatch(/not a known monster/);
  });

  it('rejects garbage without throwing', () => {
    for (const bad of [null, 42, 'room', [], undefined]) {
      expect(validateRoom(bad).ok).toBe(false);
    }
  });
});

describe('tile queries', () => {
  it('treats out-of-bounds as empty rather than throwing', () => {
    const r = validateRoom(room001);
    if (!r.ok) throw new Error('unreachable');
    expect(tileAt(r.data, -1, 0)).toBe(Tile.Empty);
    expect(tileAt(r.data, 0, -1)).toBe(Tile.Empty);
    expect(tileAt(r.data, T.GRID_W, 0)).toBe(Tile.Empty);
    expect(tileAt(r.data, 0, T.GRID_H)).toBe(Tile.Empty);
  });

  it('makes platforms floors but not walls — this is the one-way rule', () => {
    expect(isFloor(Tile.Platform)).toBe(true);
    expect(isBlocking(Tile.Platform)).toBe(false);
    expect(isFloor(Tile.Solid)).toBe(true);
    expect(isBlocking(Tile.Solid)).toBe(true);
    expect(isFloor(Tile.Empty)).toBe(false);
    expect(isBlocking(Tile.Empty)).toBe(false);
  });

  it('leaves the floor short of the walls, so the vertical wrap is reachable', () => {
    const r = validateRoom(room001);
    if (!r.ok) throw new Error('unreachable');
    // Room 1's floor is row 25. Columns 1-2 and 29-30 must be open, or a player can
    // never fall off the bottom and the wrap is undiscoverable.
    expect(tileAt(r.data, 1, 25)).toBe(Tile.Empty);
    expect(tileAt(r.data, 30, 25)).toBe(Tile.Empty);
    expect(tileAt(r.data, 16, 25)).toBe(Tile.Platform);
  });
});
