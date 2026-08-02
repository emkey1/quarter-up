import { T, ROOM_W } from '@/data/tuning';
import { MONSTER_SPECS } from '@/data/roster';
import { spawnProjectile, type Projectile } from './projectile';

/**
 * The thing at the bottom of the cave.
 *
 * Room 100. It drifts rather than walks, lobs bottles constantly, and — the part that
 * matters — CANNOT BE BUBBLED. Every tool the player has spent ninety-nine rooms
 * learning stops working, and the only thing that hurts it is lightning, which is the
 * rarest and least practised of the three special bubbles.
 *
 * That is the fight's whole argument, and it is the original's: the boss is not a bigger
 * monster, it is an exam on the one mechanic you were least likely to have bothered
 * with. Beat it down with lightning and it finally becomes bubbleable — at which point
 * the ordinary verb works again, and popping it is the last thing you do.
 */

export type BossState = 'fighting' | 'bubbled' | 'dead';

export interface Boss {
  x: number;
  y: number;
  vx: number;
  vy: number;
  half: number;
  hp: number;
  readonly maxHp: number;
  state: BossState;
  /** Frames until the next bottle. */
  throwCooldown: number;
  /** Counts down after a hit, for the flash. */
  hitFlash: number;
  /** While bubbled: frames before it breaks out and the fight resumes. */
  bubbleFrames: number;
  age: number;
}

export function spawnBoss(): Boss {
  return {
    x: ROOM_W / 2,
    y: T.TILE * 6,
    vx: T.BOSS_SPEED,
    vy: T.BOSS_SPEED * 0.55,
    half: T.BOSS_HALF,
    hp: T.BOSS_HP,
    maxHp: T.BOSS_HP,
    state: 'fighting',
    throwCooldown: T.BOSS_THROW_COOLDOWN,
    hitFlash: 0,
    bubbleFrames: 0,
    age: 0,
  };
}

export interface BossStepResult {
  threw: Projectile | null;
  /** True on the frame it breaks back out of its bubble. */
  brokeFree: boolean;
}

/**
 * Drift, bounce, and throw.
 *
 * It stays in the upper part of the room and never touches the floor, so the player
 * always has ground to work from — a boss that can corner you on your own tier is a
 * different and much less interesting fight.
 */
export function stepBoss(b: Boss, playerX: number, playerY: number): BossStepResult {
  b.age++;
  if (b.hitFlash > 0) b.hitFlash--;

  if (b.state === 'bubbled') {
    // Held, but not for long. Fail to pop it and the fight simply resumes.
    if (--b.bubbleFrames <= 0) {
      b.state = 'fighting';
      return { threw: null, brokeFree: true };
    }
    return { threw: null, brokeFree: false };
  }

  if (b.state === 'dead') return { threw: null, brokeFree: false };

  b.x += b.vx;
  b.y += b.vy;

  // Bounce off the walls and off an invisible floor partway down the room.
  const lowest = T.TILE * T.BOSS_FLOOR_ROW;
  if (b.x - b.half < T.TILE) {
    b.x = T.TILE + b.half;
    b.vx = Math.abs(b.vx);
  } else if (b.x + b.half > ROOM_W - T.TILE) {
    b.x = ROOM_W - T.TILE - b.half;
    b.vx = -Math.abs(b.vx);
  }
  if (b.y - b.half < T.TILE) {
    b.y = T.TILE + b.half;
    b.vy = Math.abs(b.vy);
  } else if (b.y + b.half > lowest) {
    b.y = lowest - b.half;
    b.vy = -Math.abs(b.vy);
  }

  /*
   * It throws faster as it weakens, so the last hits are the hardest to land.
   *
   * The cooldown scales WITH remaining health: full health is the full interval, and it
   * shortens as the bar empties. Writing this the other way round — which I did first —
   * makes the boss most dangerous when it is untouched and gentlest as you finish it,
   * so the fight relaxes exactly when it should tighten.
   */
  const health = b.hp / b.maxHp;
  const interval = T.BOSS_THROW_MIN + (T.BOSS_THROW_COOLDOWN - T.BOSS_THROW_MIN) * health;
  if (--b.throwCooldown <= 0) {
    b.throwCooldown = Math.round(interval);
    const dir: -1 | 1 = playerX < b.x ? -1 : 1;
    const spec = MONSTER_SPECS.drunk.projectile;
    if (spec) {
      void playerY;
      return {
        threw: spawnProjectile(spec, b.x + dir * (b.half + 2), b.y + b.half * 0.4, dir),
        brokeFree: false,
      };
    }
  }

  return { threw: null, brokeFree: false };
}

/**
 * A lightning hit.
 *
 * Nothing else touches it. Returns true if this was the blow that brought it down to
 * bubbleable — the moment the fight changes shape.
 */
export function zap(b: Boss): boolean {
  if (b.state !== 'fighting') return false;
  b.hitFlash = T.BOSS_HIT_FLASH;
  if (--b.hp > 0) return false;

  b.hp = 0;
  b.state = 'bubbled';
  b.bubbleFrames = T.BOSS_BUBBLE_FRAMES;
  return true;
}

/** Burst it while it is held. This is the end of the game. */
export function finish(b: Boss): boolean {
  if (b.state !== 'bubbled') return false;
  b.state = 'dead';
  return true;
}

export function bossHits(
  b: Boss,
  x: number,
  y: number,
  halfW: number,
  halfH: number,
): boolean {
  if (b.state !== 'fighting') return false;
  return Math.abs(b.x - x) < b.half + halfW && Math.abs(b.y - y) < b.half + halfH;
}
