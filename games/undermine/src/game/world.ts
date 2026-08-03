import { T } from '@/data/tuning';
import { Field } from './field';
import { Digger, Dir, type MoveIntent } from './digger';

/**
 * The simulation.
 *
 * Same contract as the other two cabinets: `step()` advances exactly one fixed tick and
 * never draws; nothing in here may reference a screen pixel; no `Math.random` or `Date`,
 * so a run replays from its seed.
 *
 * M0 is the field and the digger. Enemies (M2), the pump (M3) and rocks (M1) attach here.
 */
export class World {
  readonly field = new Field();
  readonly digger: Digger;

  frame = 0;

  constructor() {
    // Start in the middle of the top earth band, in a short pre-cut tunnel — the
    // original opens the same way, and a digger that begins entombed cannot demonstrate
    // that moving through tunnel is faster than cutting.
    const startX = Math.floor(T.GRID_W / 2);
    const startY = T.SKY_ROWS + 1;
    this.digger = new Digger(startX, startY);

    for (let cx = startX - 1; cx <= startX + 1; cx++) this.field.dig(cx, startY);
    this.field.dig(startX, startY - 1); // a way up to the sky
  }

  step(intent: MoveIntent): void {
    this.frame++;
    this.digger.step(this.field, intent);
  }
}

export { Dir };
export type { MoveIntent };
