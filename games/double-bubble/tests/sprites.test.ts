import { describe, it, expect } from 'vitest';
import { buildPlayerFrames, SPRITE_PX } from '@/render/sprites';
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
