import { T } from '@/data/tuning';
import type { ActionState } from './controls';
import type { RoomData } from './room';
import { makeBody, stepBody, type Body, type Ridable } from './physics';

export type PlayerPose = 'idle' | 'run' | 'rise' | 'fall';

/**
 * Records the shape of the last completed jump, in the units the fidelity pass measures.
 *
 * M1's gate is "the jump arc matches reference footage frame for frame" (DESIGN.md §12),
 * and you cannot hit a target you cannot read. This puts apex and airtime on screen so
 * a constant can be changed and the effect seen in the same breath — and gives the
 * measurement test something to assert against that isn't a magic number copied from
 * the implementation it is meant to be checking.
 */
export interface JumpMeter {
  /** Frames since leaving the ground. */
  airborne: number;
  /** Peak height above the launch point, in world units. */
  apex: number;
  /** Last completed jump. Frozen at touchdown so it stays readable. */
  lastApex: number;
  lastAirtime: number;
}

/** Which way to look from a given start column: inward, never at the nearest wall. */
export function facingInto(tileX: number): -1 | 1 {
  return tileX < T.GRID_W / 2 ? 1 : -1;
}

export class Player {
  readonly body: Body;
  facing: -1 | 1 = 1;
  pose: PlayerPose = 'idle';
  /** Advances only while moving, so the walk cycle doesn't animate on the spot. */
  animFrame = 0;

  // These are annotated `number` on purpose: T is `as const`, so a field initialised
  // from it infers the literal type and every upgrade becomes a type error.
  /** Raised by the red shoe. See DESIGN.md §3.9. */
  speed: number = T.RUN_SPEED;
  /** Shortened by the yellow sweet. */
  blowCooldown: number = T.BUBBLE_COOLDOWN;
  /** Lengthened by the purple sweet. */
  bubbleRange: 'normal' | 'far' = 'normal';
  /** Set by the blue sweet: bubbles travel faster without travelling further. */
  fastBubbles = false;
  /** Counts down while a heart is in effect. Nothing can touch the player. */
  invulnFrames = 0;
  /**
   * Rings pay points for ordinary actions for the rest of the room.
   *
   * Worth far more than they look: a ring turns a habit the player already has into
   * score, which is the same lesson the counter system teaches from the other side.
   */
  readonly rings = { jump: false, pop: false, step: false };

  readonly jump: JumpMeter = { airborne: 0, apex: 0, lastApex: 0, lastAirtime: 0 };
  private launchY = 0;

  constructor(startTileX: number, startTileY: number) {
    this.facing = facingInto(startTileX);
    // Spawn standing ON the given tile: its centre column, its top edge under our feet.
    this.body = makeBody(
      startTileX * T.TILE + T.TILE / 2,
      (startTileY + 1) * T.TILE - T.PLAYER_HALF_H,
      T.PLAYER_HALF_W,
      T.PLAYER_HALF_H,
    );
  }

  /**
   * Put the player back at the room's start, keeping upgrades but clearing motion.
   *
   * Facing is derived from where in the room you land, not fixed. Always facing right
   * means a right-hand start has you looking at a wall with the room — and whatever is
   * coming out of it — behind you. You cannot blow a bubble at something you are not
   * facing, so the first thing a player did on those rooms was turn around, and on a
   * bad one they were dead before they managed it.
   */
  respawn(tileX: number, tileY: number): void {
    const b = this.body;
    b.x = tileX * T.TILE + T.TILE / 2;
    b.y = (tileY + 1) * T.TILE - T.PLAYER_HALF_H;
    b.vx = 0;
    b.vy = 0;
    b.onGround = false;
    b.ridingIndex = -1;
    this.facing = facingInto(tileX);
    this.pose = 'idle';
    this.jump.airborne = 0;
    this.jump.apex = 0;
  }

  step(room: RoomData, a: ActionState, ridables: readonly Ridable[] = []): void {
    const b = this.body;

    // Instant acceleration, no friction. This is an arcade platformer of 1986, not a
    // momentum one — the cabinet's stick was digital and the response was immediate.
    b.vx = a.moveX * this.speed;
    if (a.moveX !== 0) this.facing = a.moveX > 0 ? 1 : -1;

    // Fixed-height jump, edge-triggered. There is deliberately no variable height and
    // no coyote time: bubble riding depends on the arc being the same every time.
    if (a.jumpPressed && b.onGround) {
      b.vy = -T.JUMP_VELOCITY;
      this.launchY = b.y;
      this.jump.airborne = 0;
      this.jump.apex = 0;
    }

    const wasOnGround = b.onGround;
    stepBody(room, b, ridables);

    this.measure(wasOnGround);
    this.updatePose(a);
  }

  private measure(wasOnGround: boolean): void {
    const b = this.body;
    const j = this.jump;

    if (b.onGround) {
      if (!wasOnGround && j.airborne > 0) {
        j.lastApex = j.apex;
        j.lastAirtime = j.airborne;
      }
      j.airborne = 0;
      return;
    }

    j.airborne++;
    // A wrap moves y by a room's height; height-above-launch is meaningless across it.
    if (b.wrapped) this.launchY = b.y;
    j.apex = Math.max(j.apex, this.launchY - b.y);
  }

  private updatePose(a: ActionState): void {
    const b = this.body;
    if (!b.onGround) {
      this.pose = b.vy < 0 ? 'rise' : 'fall';
    } else if (a.moveX !== 0) {
      this.pose = 'run';
      this.animFrame++;
    } else {
      this.pose = 'idle';
    }
  }
}
