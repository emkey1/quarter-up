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

    // A turn onto the other axis is only legal near the lane it would join, and snaps
    // exactly onto it. Snapping is what keeps a tunnel one cell wide.
    const cross = horizontal ? this.y : this.x;
    const lane = Digger.laneCentre(cross);
    if (Math.abs(cross - lane) > T.TURN_SLACK) return;
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
