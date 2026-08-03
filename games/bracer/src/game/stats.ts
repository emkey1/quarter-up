import type { CharacterClass, ClassStats, Roll, ByFamily, UpgradeId } from '@/data/classes';
import type { Rng } from '@cabinet/rng';

/** Which stats each upgrade potion promotes from `base` to `extra`. */
const UPGRADE_FIELDS: Record<UpgradeId, (keyof ClassStats)[]> = {
  armor: ['armor'],
  shotPower: ['shotStrength'],
  shotSpeed: ['shotSpeed'],
  magic: [
    'magicVsMonsters',
    'magicVsGenerators',
    'potionShotVsMonsters',
    'potionShotVsGenerators',
  ],
  fightPower: ['meleeVsMonsters', 'meleeGenMissChance'],
  speed: ['speed'],
};

/**
 * Resolve a class's effective stats given the upgrades taken.
 *
 * Each upgrade may be taken once; duplicates degrade to a plain potion, so this is a
 * set, not a count.
 */
export function resolveStats(cls: CharacterClass, upgrades: ReadonlySet<UpgradeId>): ClassStats {
  const out = { ...cls.base } as Record<keyof ClassStats, unknown>;
  for (const u of upgrades) {
    for (const f of UPGRADE_FIELDS[u]) out[f] = cls.extra[f];
  }
  return out as unknown as ClassStats;
}

/** Collapse a possibly-random stat to a concrete value. */
export function roll(v: Roll, rng: Rng): number {
  return typeof v === 'number' ? v : rng.range(v[0], v[1]);
}

/** Collapse a possibly-family-dependent stat. */
export function byFamily(v: ByFamily, family: 'bone' | 'block'): number {
  return typeof v === 'number' ? v : v[family];
}
