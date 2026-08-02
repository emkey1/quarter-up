import { T, ROOM_H } from '@/data/tuning';
import { Tile, isBlocking, isFloor, tileAt, type RoomData } from './room';

/**
 * Gravity, one-way platforms, and the vertical wrap.
 *
 * Per-axis resolution rather than a swept test. Nothing in this game moves faster than
 * T.FALL_SPEED_MAX (4 wu/frame) against an 8wu tile, so a body can never skip a cell in
 * one step and the simple form is exact. If anything ever exceeds half a tile per frame,
 * this file needs a sweep — there is a test pinning that assumption.
 */

export interface Body {
  /** Centre, in world units. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  halfW: number;
  halfH: number;
  /** Set by resolveY every step. Only true on the frame a floor is underfoot. */
  onGround: boolean;
  /** True on the step the body wrapped through the bottom of the room. */
  wrapped: boolean;
}

export function makeBody(x: number, y: number, halfW: number, halfH: number): Body {
  return { x, y, vx: 0, vy: 0, halfW, halfH, onGround: false, wrapped: false };
}

/** Tile column/row a world coordinate falls in. */
const tileOf = (wu: number): number => Math.floor(wu / T.TILE);

/**
 * A hair inside the trailing edge, so a body exactly TILE-aligned doesn't register as
 * overlapping the next cell along. Without it, a 12wu-wide body standing flush against
 * a wall reads as touching the tile beyond it and jitters.
 */
const EPS = 0.001;

export function applyGravity(b: Body): void {
  b.vy = Math.min(b.vy + T.GRAVITY, T.FALL_SPEED_MAX);
}

/**
 * Horizontal move. Only Solid tiles block — platforms are transparent sideways, which
 * is what lets you run off the end of one and drop.
 */
export function resolveX(room: RoomData, b: Body): void {
  if (b.vx === 0) return;

  const nx = b.x + b.vx;
  const ty0 = tileOf(b.y - b.halfH);
  const ty1 = tileOf(b.y + b.halfH - EPS);

  if (b.vx > 0) {
    const tx = tileOf(nx + b.halfW);
    for (let ty = ty0; ty <= ty1; ty++) {
      if (isBlocking(tileAt(room, tx, ty))) {
        b.x = tx * T.TILE - b.halfW;
        b.vx = 0;
        return;
      }
    }
  } else {
    const tx = tileOf(nx - b.halfW);
    for (let ty = ty0; ty <= ty1; ty++) {
      if (isBlocking(tileAt(room, tx, ty))) {
        b.x = (tx + 1) * T.TILE + b.halfW;
        b.vx = 0;
        return;
      }
    }
  }

  b.x = nx;
}

/**
 * Vertical move, and the one-way rule.
 *
 * A Platform stops a body only when the body's underside *crossed* the platform's top
 * edge during this step. A body already below it — mid-jump, or having dropped through —
 * passes straight up. That single condition is the whole one-way behaviour, and it is
 * what makes falling off the bottom of the room a traversal tool rather than a death.
 */
export function resolveY(room: RoomData, b: Body): void {
  const prevBottom = b.y + b.halfH;
  const ny = b.y + b.vy;
  const tx0 = tileOf(b.x - b.halfW);
  const tx1 = tileOf(b.x + b.halfW - EPS);

  b.onGround = false;

  if (b.vy > 0) {
    const bottom = ny + b.halfH;
    const ty = tileOf(bottom);
    for (let tx = tx0; tx <= tx1; tx++) {
      const t = tileAt(room, tx, ty);
      if (!isFloor(t)) continue;
      const surface = ty * T.TILE;
      // Already below the lip when the step began: pass through.
      if (t === Tile.Platform && prevBottom > surface) continue;
      b.y = surface - b.halfH;
      b.vy = 0;
      b.onGround = true;
      return;
    }
  } else if (b.vy < 0) {
    const top = ny - b.halfH;
    const ty = tileOf(top);
    for (let tx = tx0; tx <= tx1; tx++) {
      // Only Solid stops a rising body. Platforms are jumped through from below.
      if (isBlocking(tileAt(room, tx, ty))) {
        b.y = (ty + 1) * T.TILE + b.halfH;
        b.vy = 0;
        return;
      }
    }
  }

  b.y = ny;
}

/**
 * Wrap through the bottom of the room.
 *
 * Runs *after* resolution, never before. Wrapping first would place the body at the top
 * of the room and then immediately test it against geometry it had not actually reached,
 * so a player falling out of the bottom would tunnel into whatever sat on the top row.
 *
 * The offset keeps the motion continuous: a body whose top has just passed the bottom
 * edge re-enters with its bottom exactly at the top edge, so it slides in rather than
 * teleporting.
 */
export function wrapVertical(b: Body): void {
  b.wrapped = false;
  if (b.y - b.halfH > ROOM_H) {
    b.y -= ROOM_H + 2 * b.halfH;
    b.wrapped = true;
  }
}

/** One full step for a body under gravity. */
export function stepBody(room: RoomData, b: Body): void {
  applyGravity(b);
  resolveX(room, b);
  resolveY(room, b);
  wrapVertical(b);
}

/* ------------------------------------------------------------------ jump arithmetic */

export interface JumpShape {
  /** Peak height above the launch point, in world units. */
  apex: number;
  /** Frames of upward *movement*. Velocity then passes through exactly zero for one
   *  frame — still airborne, but displacing nothing — before the descent begins. */
  riseFrames: number;
  /** Frames the body is off the ground, which is what the meter counts and what a
   *  frame-stepped reference clip yields. */
  airborneFrames: number;
  /** Whether the closed form below is valid for these constants. */
  exact: boolean;
}

/**
 * What arc the current constants actually produce.
 *
 * Closed form, derived independently of the integrator rather than by running it, so it
 * can catch an integrator bug instead of agreeing with one.
 *
 * Two traps live here, both of which cost a frame or two — which is precisely the
 * margin a frame-by-frame comparison against footage is trying to resolve:
 *
 *   1. The apex is NOT v0^2/(2g). Gravity is applied before the position update, so a
 *      jump's first frame moves (v0 - g), and the series is sum_{k=1..K-1} (v0 - k*g),
 *      closing to g*K*(K-1)/2 — about 5% under the continuous value.
 *
 *   2. Counting frames by accumulating g*k in a loop drifts. With K=20 the descent sums
 *      to 31.99599999999997 against an apex of 31.996, so a naive `while (dropped <
 *      apex)` runs one iteration too many. The series is exactly symmetric, so there is
 *      no reason to sum it at all: the body spends K-1 frames rising, one at the peak,
 *      and K-1 falling, and the frame it regains contact is a landing rather than an
 *      airborne frame. That gives 2K-2.
 *
 * The symmetry holds only while the descent never reaches terminal velocity. It doesn't
 * with the current constants, and `exact` says so if a future tuning changes that.
 */
export function predictJump(v0: number = T.JUMP_VELOCITY, g: number = T.GRAVITY): JumpShape {
  const K = Math.round(v0 / g);
  const apex = (g * K * (K - 1)) / 2;
  const peakFallSpeed = g * (K - 1);

  return {
    apex,
    riseFrames: K - 1,
    airborneFrames: 2 * K - 2,
    exact: peakFallSpeed <= T.FALL_SPEED_MAX,
  };
}

/**
 * The inverse: constants that produce a given arc.
 *
 * This is the M1 fidelity pass in one call. Frame-step reference footage, count the apex
 * in tiles and the frames to reach it, and this hands back the two numbers to paste into
 * tuning.ts — without anyone having to rederive why it isn't v0^2/(2g) at 2am.
 */
export function solveJump(apexWu: number, riseFrames: number): { jumpVelocity: number; gravity: number } {
  if (riseFrames < 2) throw new Error('riseFrames must be at least 2');
  const gravity = (2 * apexWu) / (riseFrames * (riseFrames - 1));
  return { gravity, jumpVelocity: gravity * riseFrames };
}
