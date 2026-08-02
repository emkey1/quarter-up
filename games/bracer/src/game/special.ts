import { T } from '@/data/tuning';
import type { UpgradeId } from '@/data/classes';

/**
 * Death and the Thief: the two entities that are never generated, only placed.
 *
 * Both are exceptions to the ordinary damage model, so they live apart from Monster
 * rather than being special cases threaded through it.
 */

export interface Death {
  x: number;
  y: number;
  half: number;
  alive: boolean;
  /** Health drained from the player so far. At DEATH_TOTAL_DRAIN it vanishes. */
  drained: number;
  /**
   * Index into the potion-kill score cycle. Every shot that hits Death advances it —
   * which is why the optimal play is to shoot it exactly six times and then throw a
   * potion, for 8000 instead of 1000.
   */
  valueIndex: number;
  hurtFlash: number;
}

export function makeDeath(x: number, y: number): Death {
  return { x, y, half: T.DEATH_HALF, alive: true, drained: 0, valueIndex: 0, hurtFlash: 0 };
}

/** What a potion is currently worth against this Death. */
export function deathPotionValue(d: Death): number {
  const cycle = T.SCORE.deathPotionCycle;
  return cycle[d.valueIndex % cycle.length];
}

/** Shooting Death cannot kill it — it scores a single point and cycles the value. */
export function shootDeath(d: Death): number {
  d.valueIndex = (d.valueIndex + 1) % T.SCORE.deathPotionCycle.length;
  d.hurtFlash = 4;
  return T.SCORE.deathShot;
}

export type StolenKind = 'upgrade' | 'potion' | 'key' | 'score' | 'nothing';

export interface Stolen {
  kind: StolenKind;
  upgrade?: UpgradeId;
  amount?: number;
}

export interface Thief {
  x: number;
  y: number;
  half: number;
  alive: boolean;
  /** Set once he has robbed you; he then runs for the nearest exit. */
  carrying: Stolen | null;
  fleeing: boolean;
  facing: number;
  hurtFlash: number;
  /** Frames left before he despawns if he cannot find a way out. */
  patience: number;
}

export function makeThief(x: number, y: number): Thief {
  return {
    x,
    y,
    half: T.MONSTER_HALF,
    alive: true,
    carrying: null,
    fleeing: false,
    facing: 2,
    hurtFlash: 0,
    patience: T.THIEF_PATIENCE_F,
  };
}

/**
 * What the Thief takes, in strict priority order.
 *
 * Upgrades first, because that is the theft that actually hurts: a stolen upgrade is
 * downgraded to an ordinary potion even if you kill him for it, so the permanent boost
 * is gone for the rest of the run.
 */
export function chooseTheft(inv: {
  upgrades: UpgradeId[];
  potions: number;
  keys: number;
  score: number;
}): Stolen {
  if (inv.upgrades.length) {
    return { kind: 'upgrade', upgrade: inv.upgrades[inv.upgrades.length - 1] };
  }
  if (inv.potions > 0) return { kind: 'potion' };
  if (inv.keys > 0) return { kind: 'key' };
  if (inv.score > 0) return { kind: 'score', amount: Math.min(inv.score, T.THIEF_SCORE_THEFT) };
  return { kind: 'nothing' };
}
