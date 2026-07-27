import { T, CAM_MAX_X, CAM_MAX_Y } from '@/data/tuning';

/**
 * The camera window is T.VIEW_W x T.VIEW_H *world units* and never changes size.
 * That is a gameplay constant, not a presentation one: generators are inert while
 * off-screen and potions are viewport-scoped (DESIGN.md §6.1).
 */
export class Camera {
  x = 0;
  y = 0;

  /** Centre on a point, clamped to the level. */
  follow(px: number, py: number): void {
    this.x = clamp(px - T.VIEW_W / 2, 0, CAM_MAX_X);
    this.y = clamp(py - T.VIEW_H / 2, 0, CAM_MAX_Y);
  }

  /** Is a world-space point inside the gameplay viewport (plus a margin)? */
  contains(wx: number, wy: number, margin = 0): boolean {
    return (
      wx >= this.x - margin &&
      wy >= this.y - margin &&
      wx <= this.x + T.VIEW_W + margin &&
      wy <= this.y + T.VIEW_H + margin
    );
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
