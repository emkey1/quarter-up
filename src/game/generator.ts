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
  };
}

export function family(g: Generator): 'bone' | 'block' {
  return familyOf(g.kind);
}

/** Frames between spawns. Faster at higher generator level and deeper in the dungeon. */
export function spawnPeriod(level: number, depth: number): number {
  const base = T.GEN_PERIOD_BASE[Math.max(0, Math.min(2, level - 1))];
  return Math.max(20, Math.round(base * Math.pow(T.GEN_PERIOD_DEPTH_SCALE, depth)));
}

export function generatorLevel(g: Generator): MonsterLevel {
  return Math.max(1, Math.min(3, g.level)) as MonsterLevel;
}
