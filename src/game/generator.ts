import { T } from '@/data/tuning';
import { familyOf, type MonsterKind, type MonsterLevel } from './monster';

export interface Generator {
  kind: MonsterKind;
  /** Level doubles as hit points. Damage lowers it, which also lowers the level of
   *  everything it subsequently spawns — chipping a generator is real progress even
   *  when you cannot finish it. */
  level: number;
  cx: number;
  cy: number;
  x: number;
  y: number;
  /** Generators are physical: blocks and bone piles you cannot walk through. */
  half: number;
  timer: number;
  alive: boolean;
  hurtFlash: number;
  /** 0..1, how close the next spawn is. Drives a glow pulse — free telegraphing that
   *  the arcade's fixed palette could not do. */
  charge: number;
  spawnOffset: number;
  /**
   * Set the first time the player lays eyes on this generator.
   *
   * The difficulty warm-up is spent once, here, rather than on every sighting: a timer
   * that restarted each time the generator left view would turn peeking in and out of a
   * doorway into a free reset, which is a worse game than either no warm-up or a long one.
   */
  seen: boolean;
}

export function makeGenerator(
  kind: MonsterKind,
  level: number,
  cx: number,
  cy: number,
): Generator {
  return {
    kind,
    level: Math.max(1, Math.min(3, level)),
    cx,
    cy,
    x: cx * T.TILE + T.TILE / 2,
    y: cy * T.TILE + T.TILE / 2,
    half: T.TILE / 2,
    timer: spawnPeriod(level, 1),
    alive: true,
    hurtFlash: 0,
    charge: 0,
    spawnOffset: 0,
    seen: false,
  };
}

export function family(g: Generator): 'bone' | 'block' {
  return familyOf(g.kind);
}

/**
 * Frames between spawns. Faster at higher generator level, deeper in the dungeon, and
 * on a higher difficulty.
 *
 * `scale` is the difficulty multiplier; the floor of 12 frames stops Nightmare at depth
 * 50 from collapsing into a monster fountain that spawns faster than anything can be
 * killed, which is not difficulty, just a wall.
 */
export function spawnPeriod(level: number, depth: number, scale = 1): number {
  const base = T.GEN_PERIOD_BASE[Math.max(0, Math.min(2, level - 1))];
  return Math.max(12, Math.round(base * scale * Math.pow(T.GEN_PERIOD_DEPTH_SCALE, depth)));
}

export function generatorLevel(g: Generator): MonsterLevel {
  return Math.max(1, Math.min(3, g.level)) as MonsterLevel;
}
