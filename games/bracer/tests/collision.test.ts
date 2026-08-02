import { describe, it, expect } from 'vitest';
import { T } from '@/data/tuning';
import { Terrain, Tile } from '@/game/terrain';
import { boxHitsSolid, moveBody } from '@/game/collision';

function emptyTerrain(): Terrain {
  const t = new Terrain();
  t.tiles.fill(Tile.Floor);
  return t;
}

function wallAt(t: Terrain, cx: number, cy: number): void {
  t.tiles[t.idx(cx, cy)] = Tile.Wall;
}

describe('boxHitsSolid', () => {
  it('detects overlap only when the box actually enters a solid cell', () => {
    const t = emptyTerrain();
    wallAt(t, 1, 1); // world [16,32) x [16,32)

    // box [4,16] x [4,16] — flush against the wall's top-left corner, not inside it
    expect(boxHitsSolid(t, 10, 10, 6)).toBe(false);
    // one unit further in
    expect(boxHitsSolid(t, 11, 11, 6)).toBe(true);
  });

  it('treats out of bounds as solid', () => {
    const t = emptyTerrain();
    expect(boxHitsSolid(t, -4, 100, 6)).toBe(true);
    expect(boxHitsSolid(t, T.WORLD + 4, 100, 6)).toBe(true);
  });
});

describe('moveBody', () => {
  it('slides along a wall instead of stopping dead', () => {
    const t = emptyTerrain();
    for (let cy = 0; cy < T.GRID; cy++) wallAt(t, 1, cy); // vertical wall at col 1

    // Wall column 1 spans world x [16,32), so the furthest a half-6 body can get is x=10.
    const b = { x: 9, y: 40, half: 6 };
    const r = moveBody(t, b, 2, 2); // push diagonally into the wall
    expect(r.blockedX).toBe(true);
    expect(b.y).toBeCloseTo(42, 5); // vertical component still applied
    expect(b.x).toBeCloseTo(10, 3); // snapped flush, not stopped short or overlapping
  });

  it('never tunnels through a wall no matter how long you push', () => {
    const t = emptyTerrain();
    for (let cy = 0; cy < T.GRID; cy++) wallAt(t, 2, cy);

    const b = { x: 8, y: 40, half: 6 };
    for (let i = 0; i < 600; i++) moveBody(t, b, 2.5, 0);
    // wall starts at x=32, so the body centre can never exceed 32 - half
    expect(b.x).toBeLessThanOrEqual(32 - 6);
    expect(boxHitsSolid(t, b.x, b.y, b.half)).toBe(false);
  });

  it('corner-assists when the clip is within CORNER_ASSIST', () => {
    const t = emptyTerrain();
    wallAt(t, 1, 1); // world [16,32) x [16,32)

    // y = 15 puts the box bottom at 21 — 5wu into the wall row, exactly at the limit.
    const b = { x: 10, y: 15, half: 6 };
    const r = moveBody(t, b, 1.5, 0);
    expect(r.assisted).toBe(true);
    expect(b.y).toBeCloseTo(15 - T.CORNER_ASSIST_SPEED, 5); // nudged clear, not stopped
  });

  it('does NOT corner-assist a squarely blocked run', () => {
    const t = emptyTerrain();
    wallAt(t, 1, 1);

    // y = 24 is dead centre of the wall row: both leading corners are solid.
    const b = { x: 10, y: 24, half: 6 };
    const r = moveBody(t, b, 1.5, 0);
    expect(r.assisted).toBe(false);
    expect(r.blockedX).toBe(true);
    expect(b.y).toBeCloseTo(24, 5);
  });

  it('does not squeeze through a one-tile gap it should not fit', () => {
    const t = emptyTerrain();
    // a solid wall with no gap at all
    for (let cy = 0; cy < T.GRID; cy++) wallAt(t, 3, cy);
    const b = { x: 40, y: 40, half: 6 };
    for (let i = 0; i < 300; i++) moveBody(t, b, 2, 0);
    expect(b.x).toBeLessThanOrEqual(48 - 6);
  });

  it('rounds a corner over several frames and then proceeds', () => {
    const t = emptyTerrain();
    wallAt(t, 1, 1);

    const b = { x: 10, y: 14, half: 6 };
    let assistedFrames = 0;
    for (let i = 0; i < 60; i++) {
      const r = moveBody(t, b, 1.5, 0);
      if (r.assisted) assistedFrames++;
    }
    expect(assistedFrames).toBeGreaterThan(0);
    // having cleared the corner, it should be well past the wall column
    expect(b.x).toBeGreaterThan(32);
    expect(boxHitsSolid(t, b.x, b.y, b.half)).toBe(false);
  });
});
