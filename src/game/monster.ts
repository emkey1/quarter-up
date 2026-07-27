import { T } from '@/data/tuning';

export type MonsterKind = 'ghost' | 'grunt' | 'demon' | 'sorcerer' | 'lobber';
export type MonsterLevel = 1 | 2 | 3;

/** Which generator family spawns this kind. Bones spawn ghosts; blocks spawn the rest.
 *  The distinction is load-bearing: bones can be destroyed outright by lobber rocks and
 *  demon fire, blocks can only be weakened, and the Valkyrie's magic is stronger
 *  against blocks. */
export function familyOf(kind: MonsterKind): 'bone' | 'block' {
  return kind === 'ghost' ? 'bone' : 'block';
}

export interface Monster {
  kind: MonsterKind;
  level: MonsterLevel;
  x: number;
  y: number;
  half: number;
  hp: number;
  alive: boolean;
  facing: number;
  /** Frames until this monster may attack again. */
  attackCd: number;
  /** Render-only: counts down after taking a hit. */
  hurtFlash: number;
  /** Frames since spawn; used to fade in and to stop instant contact damage. */
  age: number;
}

export function makeMonster(kind: MonsterKind, level: MonsterLevel, x: number, y: number): Monster {
  return {
    kind,
    level,
    x,
    y,
    half: T.MONSTER_HALF,
    hp: T.MONSTER_HP_BY_LEVEL[level - 1],
    alive: true,
    facing: 2,
    attackCd: 0,
    hurtFlash: 0,
    age: 0,
  };
}

/** Contact/melee damage before the player's armour is applied. */
export function contactDamage(m: Monster): number {
  const i = m.level - 1;
  // Ghosts kamikaze, and hit far harder than anything else's melee — the reason they
  // are the most dangerous common enemy despite being the simplest.
  return m.kind === 'ghost' ? T.GHOST_DMG[i] : T.MELEE_DMG[i];
}

/** Movement speed in world units per frame. Higher-level monsters are not faster;
 *  they are tougher and hit harder. [i] */
export function monsterSpeed(m: Monster): number {
  switch (m.kind) {
    case 'ghost':
      return 0.9;
    case 'grunt':
      return 0.75;
    case 'demon':
      return 0.7;
    case 'sorcerer':
      return 0.8;
    case 'lobber':
      return 0.85;
  }
}

export const MONSTER_COLOURS: Record<MonsterKind, [string, string, string]> = {
  // one ramp per kind, indexed by level - palette swap rather than three sprite sets
  ghost: ['#d8b8d8', '#e084c8', '#f04070'],
  grunt: ['#7fb069', '#4f9d4f', '#2f7d3f'],
  demon: ['#e08050', '#e05030', '#c02020'],
  sorcerer: ['#9080d0', '#7050c0', '#5030a0'],
  lobber: ['#c0b070', '#a89040', '#907020'],
};
