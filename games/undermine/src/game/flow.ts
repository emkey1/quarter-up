import { T } from '@/data/tuning';
import { Field } from './field';

/**
 * A breadth-first distance field over open cells, for pathing through tunnels.
 *
 * Copied from Bracer's `ai.ts` and adapted, which DESIGN.md §7 predicted: there it was
 * written for one enemy, the Thief, who is the only thing in that game that needs to get
 * somewhere specific. Here every enemy uses it every frame, which is the difference
 * between a facility and a foundation.
 *
 * Two changes from the original. The field is rectangular rather than square, because
 * this cabinet is vertical. And "passable" is `Field.isOpen` rather than "not solid" —
 * the same idea against a different terrain model, which is exactly the sort of small
 * incompatibility that would have to be resolved to put this in `packages/`. Worth
 * noting for M6 rather than papering over now.
 *
 * Four-way, not eight: a diagonal that clips a corner is not a step anything here can
 * take, and following one puts an enemy back inside the earth.
 */
export class FlowField {
  /** Steps to the goal, or -1 for unreachable/solid. */
  private readonly dist: Int32Array;
  private readonly queue: Int32Array;

  constructor(
    private readonly w = T.GRID_W,
    private readonly h = T.GRID_H,
  ) {
    this.dist = new Int32Array(w * h);
    this.queue = new Int32Array(w * h);
  }

  recompute(field: Field, goalCx: number, goalCy: number): void {
    this.dist.fill(-1);
    if (!field.inBounds(goalCx, goalCy) || !field.isOpen(goalCx, goalCy)) return;

    let head = 0;
    let tail = 0;
    const start = goalCy * this.w + goalCx;
    this.dist[start] = 0;
    this.queue[tail++] = start;

    while (head < tail) {
      const cur = this.queue[head++];
      const cx = cur % this.w;
      const cy = (cur / this.w) | 0;
      const d = this.dist[cur] + 1;
      for (let i = 0; i < 4; i++) {
        const nx = cx + (i === 0 ? 1 : i === 1 ? -1 : 0);
        const ny = cy + (i === 2 ? 1 : i === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
        const ni = ny * this.w + nx;
        if (this.dist[ni] !== -1) continue;
        if (!field.isOpen(nx, ny)) continue;
        this.dist[ni] = d;
        this.queue[tail++] = ni;
      }
    }
  }

  /** Steps from this cell to the goal, or -1 if there is no route through tunnels. */
  distanceAt(cx: number, cy: number): number {
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return -1;
    return this.dist[cy * this.w + cx];
  }

  /**
   * The neighbouring cell one step closer to the goal, or null if there is no route.
   *
   * Returns a CELL rather than a direction so the caller can steer at its centre.
   * Steering at the goal instead is what makes a mover shave a corner and catch the
   * earth beside it — the same bug the Thief had in Bracer, and worth not repeating.
   */
  next(cx: number, cy: number): { cx: number; cy: number } | null {
    const here = this.distanceAt(cx, cy);
    if (here <= 0) return null;
    for (let i = 0; i < 4; i++) {
      const nx = cx + (i === 0 ? 1 : i === 1 ? -1 : 0);
      const ny = cy + (i === 2 ? 1 : i === 3 ? -1 : 0);
      const d = this.distanceAt(nx, ny);
      if (d >= 0 && d < here) return { cx: nx, cy: ny };
    }
    return null;
  }
}
