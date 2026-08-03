import { T, ROCK_CRUSH_REACH } from '@/data/tuning';
import { Field } from './field';

export const enum RockState {
  /** Held up by the earth beneath it. The state a rock spends most of its life in. */
  Embedded = 0,
  /** Support just went. Wobbling, and about to fall. */
  Teetering = 1,
  Falling = 2,
  /** Landed. Debris on screen, no longer dangerous. */
  Shattering = 3,
  Gone = 4,
}

export interface Rock {
  /** Column, fixed for life — a rock only ever moves straight down. */
  cx: number;
  /** World centre. `y` is the only thing that changes. */
  x: number;
  y: number;
  state: RockState;
  /** Counts down through Teetering and Shattering. */
  timer: number;
}

export function makeRock(cx: number, cy: number): Rock {
  return {
    cx,
    x: cx * T.CELL + T.CELL / 2,
    y: cy * T.CELL + T.CELL / 2,
    state: RockState.Embedded,
    timer: 0,
  };
}

export const rockCell = (r: Rock): number => Math.floor(r.y / T.CELL);

/**
 * Whatever a falling rock can land on or kill. The player is one; enemies will be too.
 */
export interface Crushable {
  x: number;
  y: number;
  alive: boolean;
}

/** What happened to a rock this frame, so the caller can score it and make a noise. */
export interface RockEvents {
  startedFalling: boolean;
  landed: boolean;
  crushed: Crushable[];
}

/**
 * One rock, one rule.
 *
 * Supported by the cell beneath it until that cell becomes tunnel, then it falls, then
 * it lands and shatters. Anything caught on the way down dies.
 *
 * Deliberately not a physics body. There is no gravity in this game and no reason to
 * import one: a rock accelerates instantly to a fixed speed, travels in one axis, and
 * stops on contact with earth. Modelling it as anything more is borrowing complexity
 * from a genre this game is not in — see DESIGN.md §8.5, and the note in §7 about not
 * pulling Double Bubble's platformer core across for exactly this.
 *
 * The teeter is the interesting part and it is a fairness device. Digging out the cell
 * under a rock leaves you standing precisely where it is about to land, so without a
 * warning the only way to learn the mechanic would be to die to it once.
 */
export function stepRock(field: Field, r: Rock, crushables: readonly Crushable[]): RockEvents {
  const out: RockEvents = { startedFalling: false, landed: false, crushed: [] };
  if (r.state === RockState.Gone) return out;

  const cy = rockCell(r);

  switch (r.state) {
    case RockState.Embedded:
      if (field.isOpen(r.cx, cy + 1)) {
        r.state = RockState.Teetering;
        r.timer = T.ROCK_TEETER_F;
      }
      return out;

    case RockState.Teetering:
      // A rock cannot be un-teetered. Once the ground has gone it is coming down, and
      // there is nothing the player can do to put it back — which is what makes digging
      // under one a commitment rather than an experiment.
      if (--r.timer <= 0) {
        r.state = RockState.Falling;
        out.startedFalling = true;
      }
      return out;

    case RockState.Falling: {
      r.y += T.ROCK_FALL_SPEED;
      crush(r, crushables, out);

      // Land when the next cell down is solid, or at the floor of the world.
      const below = rockCell(r) + 1;
      if (below >= T.GRID_H || !field.isOpen(r.cx, below)) {
        r.y = rockCell(r) * T.CELL + T.CELL / 2; // settle onto the cell it stopped in

        /*
         * Check again, because the settle MOVES it.
         *
         * The rock stops the moment its centre crosses into the cell it will rest in, and
         * then snaps down to that cell's centre — up to half a cell of travel that nothing
         * was looking at. Anything standing exactly where it came to rest was therefore
         * missed: the last mid-air sample was taken half a cell short.
         *
         * It went unnoticed because the crush reach used to be wide enough to catch the
         * victim on that earlier sample anyway. Narrowing the reach to the rock's own
         * column, which is what stopped rocks killing people who had walked clear, took
         * the cover away and exposed this underneath.
         */
        crush(r, crushables, out);

        r.state = RockState.Shattering;
        r.timer = T.ROCK_SHATTER_F;
        out.landed = true;
      }
      return out;
    }

    case RockState.Shattering:
      if (--r.timer <= 0) r.state = RockState.Gone;
      return out;
  }
}

/**
 * Kill whatever is in the rock's column, right now.
 *
 * Its own column and nothing either side — see ROCK_CRUSH_REACH, which works out why a
 * body-contact radius is the wrong tool here and shows the arithmetic that made escaping
 * a rock you had undermined impossible. A rock falls down exactly one cell, so what it
 * lands on is whatever is in that cell.
 *
 * Called after every move AND after the settle, because the settle is a move too.
 */
function crush(r: Rock, crushables: readonly Crushable[], out: RockEvents): void {
  for (const c of crushables) {
    if (!c.alive) continue;
    if (Math.abs(c.x - r.x) < ROCK_CRUSH_REACH && Math.abs(c.y - r.y) < ROCK_CRUSH_REACH) {
      c.alive = false;
      out.crushed.push(c);
    }
  }
}

/** Is this rock currently a threat? Used by the renderer and, later, by enemy AI that
 *  ought to have the sense not to walk under one. */
export const rockIsDangerous = (r: Rock): boolean => r.state === RockState.Falling;
