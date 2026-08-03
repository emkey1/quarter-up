import { T } from '@/data/tuning';
import { Field } from './field';

export const enum Dir {
  None = -1,
  Up = 0,
  Right = 1,
  Down = 2,
  Left = 3,
}

export const DIR_DX = [0, 1, 0, -1] as const;
export const DIR_DY = [-1, 0, 1, 0] as const;

/** What the player asked for this frame. Four-way: no diagonals, ever. */
export interface MoveIntent {
  dir: Dir;
  /** True only on the frame the button went down. The pump is jabbed, not held — see
   *  game/pump.ts for why that distinction is load-bearing. */
  pump?: boolean;
}

/**
 * The player, and the digging.
 *
 * Movement is **lane-locked**: travelling horizontally pins y to a row's centre line,
 * travelling vertically pins x to a column's. Turning onto the other axis is only
 * allowed within `TURN_SLACK` of the target lane, and snaps exactly onto it.
 *
 * That rule is doing more work than it looks. Without it, four-way movement on a grid
 * either drifts off-lane — so the digger straddles two rows and carves a two-cell-wide
 * trench, which looks nothing like a tunnel — or corner-cuts a turn and ends up inside
 * earth it never removed. Lane-locking makes a tunnel exactly one cell wide by
 * construction rather than by luck, which is also what lets the autotiler produce
 * something that reads as a tunnel.
 *
 * Digging is not a separate action. Moving into earth removes it, and moving into earth
 * is slower than moving through tunnel — DESIGN.md §8.2. The player is always either
 * spending time to make a route or spending less time using one they already made.
 */
export class Digger {
  x = 0;
  y = 0;
  /** Which way the sprite points. Never None once the game has started. */
  facing: Dir = Dir.Down;
  /** The direction actually being travelled this frame, or None when stationary. */
  moving: Dir = Dir.None;
  /** True on any frame the digger removed earth — drives the dig sound and the
   *  slower speed. */
  digging = false;

  constructor(cx: number, cy: number) {
    this.x = cx * T.CELL + T.CELL / 2;
    this.y = cy * T.CELL + T.CELL / 2;
  }

  get cellX(): number {
    return Math.floor(this.x / T.CELL);
  }

  get cellY(): number {
    return Math.floor(this.y / T.CELL);
  }

  /** Centre of the lane nearest a world coordinate. */
  private static laneCentre(v: number): number {
    return Math.floor(v / T.CELL) * T.CELL + T.CELL / 2;
  }

  step(field: Field, intent: MoveIntent): void {
    this.digging = false;
    this.moving = Dir.None;

    const dir = intent.dir;
    if (dir === Dir.None) return;

    const horizontal = dir === Dir.Left || dir === Dir.Right;

    /*
     * Turning onto the other axis: slide onto the lane, never refuse.
     *
     * Reported from play as "I can't seem to go up or down", and it was worse than
     * intermittent. The rule used to be a flat rejection — if the digger was further than
     * TURN_SLACK from the lane it wanted to join, the input did nothing. Nothing ever
     * moved it back onto a lane either, so stopping anywhere but a cell centre left the
     * perpendicular axis permanently dead. Measured across a cell: 9 of 16 positions
     * could never turn at all.
     *
     * The fix is what every grid game of this era actually does. Asking for a
     * perpendicular direction while off-lane spends the frame CORNERING — sliding along
     * the current axis toward the nearest lane centre — and the turn happens once it
     * arrives. The digger visibly slides a few pixels sideways before setting off, which
     * is exactly how cornering looks in the originals.
     *
     * The slide is always along a lane the digger is already standing in, so it can never
     * push into earth, and it is bounded by half a cell.
     */
    const cross = horizontal ? this.y : this.x;
    const lane = Digger.laneCentre(cross);
    const off = cross - lane;

    if (Math.abs(off) > T.TURN_SLACK) {
      const slide = Math.min(T.MOVE_SPEED, Math.abs(off)) * (off > 0 ? -1 : 1);
      if (horizontal) this.y += slide;
      else this.x += slide;
      this.facing = dir;
      return;
    }

    if (horizontal) this.y = lane;
    else this.x = lane;

    /*
     * Speed is decided by the cell the CENTRE is heading into — not by what is under the
     * leading edge.
     *
     * The difference is the whole cost of digging. Probing ahead of the leading edge and
     * clearing that cell on contact means the digger removes a cell before it has
     * entered it, and then crosses the now-open cell at full speed: cutting costs one
     * frame per cell instead of the sixteen world units it should, and DIG_SPEED barely
     * shows up in the result. Caught by the test that measures the two speeds against
     * each other — it came out at 0.93 wu/frame against an intended 0.5.
     *
     * Against the centre, the digger pays the slow rate for the entire traversal of a
     * fresh cell, and the cell opens as the centre arrives in it. The body visibly
     * presses into earth on the way, which is what cutting should look like anyway.
     */
    const dx = DIR_DX[dir];
    const dy = DIR_DY[dir];
    const nextCx = this.cellX + dx;
    const nextCy = this.cellY + dy;

    if (!field.inBounds(nextCx, nextCy)) {
      this.facing = dir;
      return; // the edge of the world; sky is inside the grid, so this is a hard stop
    }

    const speed = field.isOpen(nextCx, nextCy) ? T.MOVE_SPEED : T.DIG_SPEED;

    this.x += dx * speed;
    this.y += dy * speed;
    this.facing = dir;
    this.moving = dir;

    // Clear whatever the centre now sits in. Every cell the centre passes through gets
    // cleared, so a run can never leave a plug of earth inside a finished tunnel.
    if (field.dig(this.cellX, this.cellY)) this.digging = true;
  }
}
