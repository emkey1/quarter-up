/**
 * The four classes, transcribed from StrategyWiki's arcade "final revision" measurements.
 * See DESIGN.md §3.3. `base` / `extra` = before / after the matching Extra-* upgrade potion.
 *
 * Ranges (`2~3`) are [min, max] inclusive, rolled per use.
 * Valkyrie's dual values (`2/3`) are [vsBone, vsBlock] — her magic does +1 against
 * block-family generators and their spawn.
 */

export type ClassId = 'warrior' | 'valkyrie' | 'wizard' | 'elf';
export type ShotBox = 'small' | 'medium' | 'large';

/** A stat that may be a fixed value or a random range. */
export type Roll = number | readonly [number, number];

/** A stat that may differ by generator family. */
export type ByFamily = number | { readonly bone: number; readonly block: number };

export interface ClassStats {
  readonly armor: number; // fraction of damage removed
  readonly shotStrength: Roll; // HP
  readonly shotSpeed: number; // 1..5 stat points
  readonly magicVsMonsters: ByFamily;
  readonly magicVsGenerators: ByFamily;
  readonly potionShotVsMonsters: ByFamily;
  readonly potionShotVsGenerators: ByFamily;
  readonly meleeVsMonsters: Roll;
  readonly meleeGenMissChance: number; // 0..1
  readonly speed: number; // 1..5 stat points
}

export interface CharacterClass {
  readonly id: ClassId;
  readonly name: string;
  readonly hero: string;
  readonly colour: string; // HUD colour, matches the arcade panel
  readonly colourCb: string; // colour-blind-safe alternate
  readonly shotBox: ShotBox; // NOT upgradeable — the one permanent curse
  readonly blurb: string;
  readonly base: ClassStats;
  readonly extra: ClassStats;
}

export const CLASSES: Readonly<Record<ClassId, CharacterClass>> = {
  warrior: {
    id: 'warrior',
    name: 'Warrior',
    hero: 'Thor',
    colour: '#e2413c',
    colourCb: '#e66100',
    shotBox: 'large',
    blurb: 'Brute force. Unequalled in melee, but his magic cannot touch a generator.',
    base: {
      armor: 0.2,
      shotStrength: 2,
      shotSpeed: 2,
      magicVsMonsters: 2,
      magicVsGenerators: 0,
      potionShotVsMonsters: 1,
      potionShotVsGenerators: 0,
      meleeVsMonsters: [2, 3],
      meleeGenMissChance: 0.15,
      speed: 1,
    },
    extra: {
      armor: 0.3,
      shotStrength: [2, 3],
      shotSpeed: 3,
      magicVsMonsters: 3,
      magicVsGenerators: 1,
      potionShotVsMonsters: 3,
      potionShotVsGenerators: 1,
      meleeVsMonsters: 3,
      meleeGenMissChance: 0,
      speed: 3,
    },
  },

  valkyrie: {
    id: 'valkyrie',
    name: 'Valkyrie',
    hero: 'Thyra',
    colour: '#4aa3e8',
    colourCb: '#5d3fd3',
    shotBox: 'medium',
    blurb: 'The strongest armour, and thin shots that thread diagonal cover.',
    base: {
      armor: 0.3,
      shotStrength: 1,
      shotSpeed: 3,
      magicVsMonsters: { bone: 2, block: 3 },
      magicVsGenerators: { bone: 0, block: 1 },
      potionShotVsMonsters: { bone: 1, block: 2 },
      potionShotVsGenerators: 0,
      meleeVsMonsters: 2,
      meleeGenMissChance: 0.35,
      speed: 2,
    },
    extra: {
      armor: 0.4,
      shotStrength: 2,
      shotSpeed: 3.5,
      magicVsMonsters: 3,
      magicVsGenerators: { bone: 1, block: 2 },
      potionShotVsMonsters: 3,
      potionShotVsGenerators: 1,
      meleeVsMonsters: 3,
      meleeGenMissChance: 0,
      speed: 3,
    },
  },

  wizard: {
    id: 'wizard',
    name: 'Wizard',
    hero: 'Merlin',
    colour: '#e8d44a',
    colourCb: '#f0e442',
    shotBox: 'medium',
    blurb: 'Magic annihilates monsters and generators alike. Everything else is a liability.',
    base: {
      armor: 0,
      shotStrength: [1, 2],
      shotSpeed: 3.5,
      magicVsMonsters: 3,
      magicVsGenerators: 3,
      potionShotVsMonsters: 3,
      potionShotVsGenerators: 2,
      meleeVsMonsters: 1,
      meleeGenMissChance: 1,
      speed: 1,
    },
    extra: {
      armor: 0.1,
      shotStrength: 2,
      shotSpeed: 5,
      magicVsMonsters: 3,
      magicVsGenerators: 3,
      potionShotVsMonsters: 3,
      potionShotVsGenerators: 3,
      meleeVsMonsters: 2,
      meleeGenMissChance: 1,
      speed: 3,
    },
  },

  elf: {
    id: 'elf',
    name: 'Elf',
    hero: 'Questor',
    colour: '#4fbf5f',
    colourCb: '#009e73',
    shotBox: 'small',
    blurb: 'Fastest by far, with near-Wizard magic. The strongest solo pick.',
    base: {
      armor: 0.1,
      shotStrength: 1,
      shotSpeed: 3.5,
      magicVsMonsters: 3,
      magicVsGenerators: 2,
      potionShotVsMonsters: 3,
      potionShotVsGenerators: 1,
      meleeVsMonsters: [1, 2],
      meleeGenMissChance: 1,
      speed: 3,
    },
    extra: {
      armor: 0.2,
      shotStrength: 2,
      shotSpeed: 5,
      magicVsMonsters: 3,
      magicVsGenerators: 3,
      potionShotVsMonsters: 3,
      potionShotVsGenerators: 2,
      meleeVsMonsters: [2, 3],
      meleeGenMissChance: 0.75,
      speed: 5,
    },
  },
};

export const CLASS_ORDER: readonly ClassId[] = ['warrior', 'valkyrie', 'wizard', 'elf'];

/** The six permanent upgrades. Each may be taken once per run. */
export const UPGRADES = ['armor', 'magic', 'shotPower', 'shotSpeed', 'speed', 'fightPower'] as const;
export type UpgradeId = (typeof UPGRADES)[number];
