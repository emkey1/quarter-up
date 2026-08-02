import type { MonsterKind } from '@/game/monster';
import { DEFAULT_DIFFICULTY, difficultyRank, type DifficultyId } from './difficulty';

/**
 * Feature toggles. See DESIGN.md §6.6.
 *
 * These are the descendants of the cabinet's operator DIP switches, which set difficulty,
 * starting health and monster speed. The only change is who holds the screwdriver.
 *
 * Rules are part of the SIMULATION, not of presentation: they are captured in run state
 * and in replays, so a recorded run replays under the rules it was played with.
 */
export interface Rules {
  /**
   * Difficulty rung. Unlike everything else here this is not a boolean, because
   * difficulty was never a switch — the cabinet's DIP settings picked a level.
   */
  difficulty: DifficultyId;

  // --- monster families. Disabling one also removes its generators (§6.6).
  ghosts: boolean;
  grunts: boolean;
  demons: boolean;
  sorcerers: boolean;
  lobbers: boolean;
  death: boolean;
  thief: boolean;

  // --- pressure: the things that make a run finite
  healthDrain: boolean;
  rankCurve: boolean;
  offscreenGenerators: boolean;

  // --- reconstructed mechanics, all tagged [i] in tuning.ts
  cornerSqueeze: boolean;
  inventoryBlocks: boolean;
  doorAutoOpen: boolean;
  wallsBecomeExits: boolean;
  cornerAssist: boolean;
  fastDiagonals: boolean;
}

export const DEFAULT_RULES: Rules = {
  difficulty: DEFAULT_DIFFICULTY,
  ghosts: true,
  grunts: true,
  demons: true,
  sorcerers: true,
  lobbers: true,
  death: true,
  thief: true,
  healthDrain: true,
  rankCurve: true,
  offscreenGenerators: true,
  cornerSqueeze: true,
  inventoryBlocks: true,
  doorAutoOpen: true,
  wallsBecomeExits: true,
  cornerAssist: true,
  fastDiagonals: true,
};

/**
 * Only the boolean rules are toggles. Difficulty lives in `Rules` too, but it is a
 * ladder, not a switch, so keeping it out of this type is what stops the setup screen
 * from cheerfully assigning `!'veteran'` to it.
 */
export type RuleKey = { [K in keyof Rules]: Rules[K] extends boolean ? K : never }[keyof Rules];
export type Tier = 'arcade' | 'tagged' | 'ineligible';

export interface RuleMeta {
  key: RuleKey;
  group: 'Monsters' | 'Pressure' | 'Mechanics';
  label: string;
  /** What turning it OFF does, in one line. */
  note: string;
  /** Tier this run drops to when the rule differs from its default. */
  tier: Exclude<Tier, 'arcade'>;
}

export const RULE_META: readonly RuleMeta[] = [
  { key: 'ghosts', group: 'Monsters', label: 'Ghosts', note: 'Kamikaze; the most punishing common enemy.', tier: 'ineligible' },
  { key: 'grunts', group: 'Monsters', label: 'Grunts', note: 'Basic melee attacker.', tier: 'ineligible' },
  { key: 'demons', group: 'Monsters', label: 'Demons', note: 'Fire through walls; can damage generators for you.', tier: 'ineligible' },
  { key: 'sorcerers', group: 'Monsters', label: 'Sorcerers', note: 'Phase out; shots pass through while invisible.', tier: 'ineligible' },
  { key: 'lobbers', group: 'Monsters', label: 'Lobbers', note: 'Arc rocks over walls. Their rocks destroy bone generators.', tier: 'ineligible' },
  { key: 'death', group: 'Monsters', label: 'Death', note: 'Unkillable; drains 200 health on contact. Only a potion stops it.', tier: 'ineligible' },
  { key: 'thief', group: 'Monsters', label: 'Thief', note: 'Steals an upgrade or potion and runs for the exit.', tier: 'ineligible' },

  { key: 'healthDrain', group: 'Pressure', label: 'Health drain', note: 'The 1/sec clock. Without it a run never has to end.', tier: 'ineligible' },
  { key: 'rankCurve', group: 'Pressure', label: 'Rank curve', note: 'Food thins as your score climbs. The real difficulty curve.', tier: 'ineligible' },
  { key: 'offscreenGenerators', group: 'Pressure', label: 'Off-screen generators idle', note: 'Off: generators spawn even unseen. Much harder, not easier.', tier: 'ineligible' },

  { key: 'cornerSqueeze', group: 'Mechanics', label: 'Diagonal cover rule', note: 'Small and medium shots thread diagonal corners; Large cannot.', tier: 'tagged' },
  { key: 'inventoryBlocks', group: 'Mechanics', label: 'Full inventory blocks', note: 'Items you cannot carry are solid and barricade you.', tier: 'tagged' },
  { key: 'doorAutoOpen', group: 'Mechanics', label: 'Doors give up', note: 'Open on their own after 90s with no fighting (180s holding keys).', tier: 'tagged' },
  { key: 'wallsBecomeExits', group: 'Mechanics', label: 'Walls become exits', note: 'Standing still for 180s converts every wall to an exit.', tier: 'tagged' },
  { key: 'cornerAssist', group: 'Mechanics', label: 'Corner assist', note: 'Rounds corners you nearly cleared instead of stopping dead.', tier: 'tagged' },
  { key: 'fastDiagonals', group: 'Mechanics', label: 'Fast diagonals', note: 'Full speed on each axis, so diagonals are ~1.41x faster.', tier: 'tagged' },
];

/** Which monster families are currently permitted. */
export function monsterAllowed(rules: Rules, kind: MonsterKind): boolean {
  switch (kind) {
    case 'ghost':
      return rules.ghosts;
    case 'grunt':
      return rules.grunts;
    case 'demon':
      return rules.demons;
    case 'sorcerer':
      return rules.sorcerers;
    case 'lobber':
      return rules.lobbers;
  }
}

/**
 * Derived, never stored — so the badge can never drift from what is actually enabled.
 * An easier run must not be able to look like a real one.
 */
export function tierOf(rules: Rules): Tier {
  let tier: Tier = 'arcade';

  // Difficulty is asymmetric on purpose. Playing ABOVE the default is not a way to get
  // an easier score, so it stays fully eligible; playing below it is, so it is marked.
  // Treating both directions as "altered" would punish the players doing the hard thing.
  if (difficultyRank(rules.difficulty) < difficultyRank(DEFAULT_RULES.difficulty)) {
    tier = 'tagged';
  }

  for (const m of RULE_META) {
    if (rules[m.key] === DEFAULT_RULES[m.key]) continue;
    if (m.tier === 'ineligible') return 'ineligible';
    tier = 'tagged';
  }
  return tier;
}

export function changedRules(rules: Rules): RuleMeta[] {
  return RULE_META.filter((m) => rules[m.key] !== DEFAULT_RULES[m.key]);
}

export const PRESETS: Record<string, () => Rules> = {
  Arcade: () => ({ ...DEFAULT_RULES }),
  /** Everything off that hurts: a scratchpad for learning the maps. */
  Sandbox: () => ({
    ...DEFAULT_RULES,
    difficulty: 'apprentice' as DifficultyId,
    death: false,
    thief: false,
    healthDrain: false,
    rankCurve: false,
  }),
};

export function cloneRules(r: Rules): Rules {
  return { ...r };
}
