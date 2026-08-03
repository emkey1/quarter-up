import { T } from '@/data/tuning';
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

      // Kill anything the rock's box now overlaps. Checked after the move, so a body
      // standing exactly where the rock lands is caught rather than spared by a
      // rounding accident.
      for (const c of crushables) {
        if (!c.alive) continue;
        if (Math.abs(c.x - r.x) < T.CELL / 2 && Math.abs(c.y - r.y) < T.CELL) {
          c.alive = false;
          out.crushed.push(c);
        }
      }

      // Land when the next cell down is solid, or at the floor of the world.
      const below = rockCell(r) + 1;
      if (below >= T.GRID_H || !field.isOpen(r.cx, below)) {
        r.y = rockCell(r) * T.CELL + T.CELL / 2; // settle onto the cell it stopped in
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

/** Is this rock currently a threat? Used by the renderer and, later, by enemy AI that
 *  ought to have the sense not to walk under one. */
export const rockIsDangerous = (r: Rock): boolean => r.state === RockState.Falling;
