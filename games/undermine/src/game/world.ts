import { T } from '@/data/tuning';
import { Field } from './field';
import { Digger, Dir, type MoveIntent } from './digger';
import { makeRock, stepRock, RockState, type Crushable, type Rock } from './rock';

/** What happened this tick, for the presentation layer to make noise about. */
export interface WorldEvents {
  dug: boolean;
  rockStartedFalling: boolean;
  rockLanded: boolean;
  playerCrushed: boolean;
}

/**
 * The simulation.
 *
 * Same contract as the other two cabinets: `step()` advances exactly one fixed tick and
 * never draws; nothing in here may reference a screen pixel; no `Math.random` or `Date`,
 * so a run replays from its seed.
 *
 * M0 was the field and the digger. M1 adds rocks and the first way to die. Enemies (M2)
 * and the pump (M3) attach here next.
 */
export class World {
  readonly field = new Field();
  readonly digger: Digger;
  readonly rocks: Rock[] = [];

  frame = 0;
  /** Cleared by death, and the reason `step` stops advancing the digger. */
  playerAlive = true;

  /** The player as something a rock can land on. Enemies will join this list at M2. */
  private readonly crushable: Crushable;

  constructor() {
    // Start in the middle of the top earth band, in a short pre-cut tunnel — the
    // original opens the same way, and a digger that begins entombed cannot demonstrate
    // that moving through tunnel is faster than cutting.
    const startX = Math.floor(T.GRID_W / 2);
    const startY = T.SKY_ROWS + 1;
    this.digger = new Digger(startX, startY);

    for (let cx = startX - 1; cx <= startX + 1; cx++) this.field.dig(cx, startY);
    this.field.dig(startX, startY - 1); // a way up to the sky

    this.crushable = { x: this.digger.x, y: this.digger.y, alive: true };

    // A placeholder scatter until layouts arrive at M5. Deliberately not under the start
    // tunnel: the first thing a new player does is move, and being killed by geometry
    // they never touched teaches nothing.
    for (const [cx, cy] of [
      [2, 6],
      [11, 6],
      [4, 11],
      [9, 14],
    ] as const) {
      this.rocks.push(makeRock(cx, cy));
    }
  }

  step(intent: MoveIntent): WorldEvents {
    this.frame++;
    const events: WorldEvents = {
      dug: false,
      rockStartedFalling: false,
      rockLanded: false,
      playerCrushed: false,
    };

    if (this.playerAlive) {
      this.digger.step(this.field, intent);
      events.dug = this.digger.digging;
    }

    // The crushable view of the player is refreshed from the digger each tick rather
    // than the digger implementing the interface itself. The digger has no business
    // knowing that rocks exist.
    this.crushable.x = this.digger.x;
    this.crushable.y = this.digger.y;
    this.crushable.alive = this.playerAlive;

    const targets = [this.crushable];
    for (const r of this.rocks) {
      if (r.state === RockState.Gone) continue;
      const e = stepRock(this.field, r, targets);
      events.rockStartedFalling ||= e.startedFalling;
      events.rockLanded ||= e.landed;
      if (e.crushed.length) events.playerCrushed = true;
    }

    if (!this.crushable.alive) this.playerAlive = false;

    return events;
  }
}

export { Dir, RockState };
export type { MoveIntent, Rock };
