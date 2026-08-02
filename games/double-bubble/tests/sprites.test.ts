import { describe, it, expect } from 'vitest';
import { buildMonsterFrames, buildPlayerFrames, SPRITE_PX } from '@/render/sprites';
import { Px, TRANSPARENT } from '@/render/pixel';
import { T } from '@/data/tuning';

/** Tight bounding box of everything painted. */
function bounds(px: Px): { w: number; h: number; x0: number; y1: number } {
  let x0 = px.w;
  let x1 = -1;
  let y0 = px.h;
  let y1 = -1;
  for (let y = 0; y < px.h; y++) {
    for (let x = 0; x < px.w; x++) {
      if (px.at(x, y) === TRANSPARENT) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, x0, y1 };
}

/**
 * The nastiest bug class in the whole renderer, because it fails silently and in only
 * one direction. A fractional coordinate makes `data[y * w + x]` a fractional index,
 * which a Uint8Array discards without complaint — so a shape drawn at a fractional
 * centre does not land half a pixel off, it disappears. `ellipse` floors internally and
 * survives; `rect` and `line` write straight through `set` and do not. It cost a
 * Zen-Chan its entire body and left two eyes hanging in mid-air.
 */
describe('Px coordinate rounding', () => {
  it('paints at fractional coordinates instead of dropping the write', () => {
    const p = new Px(8, 8);
    p.set(3.4, 4.6, 5);
    expect(p.at(3, 5)).toBe(5);
  });

  it('fills a rect placed at a fractional origin', () => {
    const p = new Px(16, 16);
    p.rect(2, 4.92, 6, 6, 3);
    let painted = 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (p.at(x, y) !== 0) painted++;
    expect(painted).toBe(36);
  });

  it('draws a line from a fractional start', () => {
    const p = new Px(16, 16);
    p.line(1.5, 2.5, 9.5, 2.5, 4);
    let painted = 0;
    for (let x = 0; x < 16; x++) if (p.at(x, 3) !== 0) painted++;
    expect(painted).toBeGreaterThan(5);
  });

  it('still rejects genuinely out-of-bounds writes', () => {
    const p = new Px(4, 4);
    p.set(-1, 2, 7);
    p.set(2, 99, 7);
    for (let i = 0; i < p.data.length; i++) expect(p.data[i]).toBe(0);
  });
});

describe('monster art', () => {
  it('draws a body, not just the eyes', () => {
    for (const px of buildMonsterFrames()) {
      let painted = 0;
      for (let y = 0; y < px.h; y++) {
        for (let x = 0; x < px.w; x++) if (px.at(x, y) !== 0) painted++;
      }
      // The body alone is 24x24; anything near the size of the eyes alone means the
      // fractional-coordinate bug is back.
      expect(painted).toBeGreaterThan(400);
    }
  });
});

describe('player art', () => {
  const frames = buildPlayerFrames();

  it('generates every pose', () => {
    expect(Object.keys(frames).sort()).toEqual(['fall', 'idle', 'rise', 'run']);
    expect(frames.run.length).toBe(2);
    for (const list of Object.values(frames)) {
      for (const px of list) {
        expect(px.w).toBe(SPRITE_PX);
        expect(px.h).toBe(SPRITE_PX);
      }
    }
  });

  /**
   * The one that matters. A rising body stretches vertically and a falling one flattens;
   * getting the sign backwards draws a launch as a pancake, which reads as a landing.
   * It is invisible to the type checker and easy to invert while editing.
   */
  it('stretches the rise frame taller than the idle frame, and flattens the fall frame', () => {
    const idle = bounds(frames.idle[0]);
    const rise = bounds(frames.rise[0]);
    const fall = bounds(frames.fall[0]);

    expect(rise.h).toBeGreaterThan(idle.h);
    expect(rise.w).toBeLessThan(idle.w);

    expect(fall.h).toBeLessThan(idle.h);
    expect(fall.w).toBeGreaterThan(idle.w);

    // And say it the way a person would: rising is the tallest silhouette of the three.
    expect(rise.h / rise.w).toBeGreaterThan(idle.h / idle.w);
    expect(fall.h / fall.w).toBeLessThan(idle.h / idle.w);
  });

  it('keeps every frame inside the sprite box', () => {
    for (const list of Object.values(frames)) {
      for (const px of list) {
        const b = bounds(px);
        expect(b.x0).toBeGreaterThanOrEqual(0);
        expect(b.y1).toBeLessThan(SPRITE_PX);
      }
    }
  });

  /**
   * The renderer aligns the art box by its bottom edge plus a fixed inset (see
   * ui/app.ts FOOT_INSET_WU). If the drawn feet drift far from the box's bottom, the
   * creature floats above the floor or sinks into it.
   */
  it('draws the feet close to the bottom of the sprite box', () => {
    const idle = bounds(frames.idle[0]);
    const gapPx = SPRITE_PX - 1 - idle.y1;
    expect(gapPx).toBeLessThanOrEqual(2 * T.ART_SCALE);
  });

  it('gives the run cycle two visibly different frames', () => {
    const [a, b] = frames.run;
    let differing = 0;
    for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) differing++;
    expect(differing).toBeGreaterThan(0);
  });
});
