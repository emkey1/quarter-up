import { T } from '@/data/tuning';
import { CLASSES, type ClassId, type UpgradeId } from '@/data/classes';
import type { ActionState } from '@/engine/actions';
import { fireRoots, type FireModel } from '@/engine/input';
import { moveBody, type Body } from './collision';
import { resolveStats } from './stats';
import type { Terrain } from './terrain';

/** 8-way facing, matching the gamepad octants: 0=E, clockwise. */
export const FACE_DX = [1, 1, 0, -1, -1, -1, 0, 1] as const;
export const FACE_DY = [0, 1, 1, 1, 0, -1, -1, -1] as const;

export function facingFrom(dx: number, dy: number, fallback: number): number {
  if (dx === 0 && dy === 0) return fallback;
  const oct = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) & 7;
  return oct;
}

export class Player implements Body {
  x = 0;
  y = 0;
  readonly half = T.PLAYER_HALF;

  classId: ClassId;
  upgrades = new Set<UpgradeId>();
  /** Temporary invisibility; carries into the next level, per the original. */
  invisibleFrames = 0;

  facing = 2; // south, like every sprite sheet's idle frame
  // Explicit annotation: T is `as const`, so the initialiser's type is the literal 700
  // and would not widen on its own.
  health: number = T.START_HEALTH;
  score = 0;
  credits = 1;

  keys = 0;
  potions = 0;

  /** Frames the current Fire press has been held, including this one. 0 when up. */
  fireHeldFrames = 0;
  /** True while the fire model is suppressing translation — surfaced to the HUD/debug
   *  so the rooting is visible rather than feeling like dropped input. */
  rooted = false;

  /** Frames until the next melee swing may land. */
  meleeCd = 0;
  /** Brief grace after taking a hit, so a ghost stream cannot delete you in three
   *  frames. [i] — the arcade may not have had this; flagged for the fidelity pass. */
  invulnFrames = 0;
  /** Render-only feedback. */
  damageFlash = 0;
  /** Set while a shot of ours is alive: the one-shot-on-screen rule. */
  shotAlive = false;

  /** Sub-frame accumulator for the 1 hp/sec drain. */
  private drainAcc = 0;
  /** Frames of continuous stillness, for the 180s walls-become-exits rule. */
  stillFrames = 0;

  moved = false;
  assisted = false;
  /** Last frame's displacement. Lobbers lead their throws with this, which is why
   *  running in a straight line gets you hit and jinking does not. */
  lastVX = 0;
  lastVY = 0;

  constructor(classId: ClassId) {
    this.classId = classId;
  }

  get cls() {
    return CLASSES[this.classId];
  }

  get stats() {
    return resolveStats(this.cls, this.upgrades);
  }

  get speedWuPerFrame(): number {
    return this.stats.speed * T.SPEED_UNIT;
  }

  get inventoryUsed(): number {
    return this.keys + this.potions;
  }

  get inventoryFull(): boolean {
    return this.inventoryUsed >= T.INVENTORY_SLOTS;
  }

  step(
    terrain: Terrain,
    a: Readonly<ActionState>,
    fireModel: FireModel,
    rules?: { healthDrain: boolean; cornerAssist: boolean; fastDiagonals: boolean },
  ): void {
    // --- fire bookkeeping (the shot itself lands in M1)
    this.fireHeldFrames = a.fire ? this.fireHeldFrames + 1 : 0;
    this.rooted = fireRoots(fireModel, a.fire, this.fireHeldFrames);

    // --- facing: never suppressed. You can always turn on the spot while firing;
    // without this, Arcade mode is unplayable rather than merely demanding.
    if (fireModel === 'twinstick' && (a.aimX !== 0 || a.aimY !== 0)) {
      this.facing = facingFrom(a.aimX, a.aimY, this.facing);
    } else if (!a.faceLock && (a.moveX !== 0 || a.moveY !== 0)) {
      this.facing = facingFrom(a.moveX, a.moveY, this.facing);
    }

    // --- translation
    let vx = 0;
    let vy = 0;
    if (!this.rooted) {
      const speed = this.speedWuPerFrame;
      vx = a.moveX * speed;
      vy = a.moveY * speed;
      // [i] The original almost certainly applied each axis independently, making
      // diagonals ~1.41x faster. Flagged for the fidelity pass; togglable meanwhile.
      const normalise = rules ? !rules.fastDiagonals : T.DIAGONAL_NORMALISE;
      if (normalise && vx !== 0 && vy !== 0) {
        const k = Math.SQRT1_2;
        vx *= k;
        vy *= k;
      }
    }

    if (vx !== 0 || vy !== 0) {
      const r = moveBody(terrain, this, vx, vy);
      this.moved = r.movedX !== 0 || r.movedY !== 0;
      this.assisted = r.assisted;
      this.lastVX = r.movedX;
      this.lastVY = r.movedY;
    } else {
      this.moved = false;
      this.assisted = false;
      this.lastVX = 0;
      this.lastVY = 0;
    }

    // Stillness for the walls-become-exits trick counts *movement input*, not
    // displacement — you may shoot and turn freely while waiting it out.
    if (a.moveX !== 0 || a.moveY !== 0) this.stillFrames = 0;
    else this.stillFrames++;

    if (this.meleeCd > 0) this.meleeCd--;
    if (this.invulnFrames > 0) this.invulnFrames--;
    if (this.damageFlash > 0) this.damageFlash--;

    // --- the clock that makes Gauntlet Gauntlet
    if (rules && !rules.healthDrain) return;
    this.drainAcc += T.HEALTH_DRAIN_PER_SEC / T.STEP_HZ;
    if (this.drainAcc >= 1) {
      const whole = Math.floor(this.drainAcc);
      this.drainAcc -= whole;
      this.health -= whole;
    }
  }

  get dead(): boolean {
    return this.health <= 0;
  }
}
