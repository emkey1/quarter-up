import type { MonsterKind } from '@/game/room';

/**
 * The monster roster.
 *
 * Data rather than a switch in the AI, because the eight types are genuinely variations
 * on a handful of axes — how they move, whether they can climb, whether they throw
 * something — rather than eight unrelated behaviours. Written as a table, the shape of
 * the roster is legible at a glance and a new monster is a row.
 *
 * The introduction schedule is the original's and is well judged: one new idea every
 * ten rooms, each one invalidating a habit the previous ten taught. See DESIGN.md §3.5.
 * All values are [i] — inferred from descriptions, not measured.
 */

export type Locomotion =
  /** Gravity, patrols a platform, turns at ledges and walls. */
  | 'walk'
  /** No gravity. Travels a fixed diagonal and bounces off geometry, ignoring platforms
   *  entirely — which is what lets it reach anywhere and makes it awkward to bubble. */
  | 'fly'
  /** No gravity. Long sweeping horizontal arcs with very little vertical movement. */
  | 'float'
  /** Gravity, but hops rather than walks — so its position is hard to predict. */
  | 'hop';

export type ProjectileKind = 'boulder' | 'fireball' | 'bottle';

export interface ProjectileSpec {
  kind: ProjectileKind;
  /** Frames between throws. */
  cooldown: number;
  speed: number;
  /** Bottles arc; boulders and fireballs fly flat. */
  arcs: boolean;
  /** Frames before it expires if it hits nothing. */
  life: number;
}

export interface MonsterSpec {
  kind: MonsterKind;
  label: string;
  /** Room this type first appears in. */
  firstRoom: number;
  locomotion: Locomotion;
  speed: number;
  angrySpeed: number;
  /** Jumps up through platforms to reach a player above. */
  climbs: boolean;
  /** Clears gaps rather than turning at a ledge. */
  clearsGaps: boolean;
  /** Per-frame chance of acting on the urge to climb, while the player is above. */
  climbChance: number;
  projectile: ProjectileSpec | null;
  /** Base colour, so the palette and the roster stay in one place. */
  colour: string;
}

export const MONSTER_SPECS: Record<MonsterKind, MonsterSpec> = {
  /** The baseline. Everything else is a deviation from this silhouette and this pace. */
  zenchan: {
    kind: 'zenchan',
    label: 'Zen-Chan',
    firstRoom: 1,
    locomotion: 'walk',
    speed: 0.55,
    angrySpeed: 0.95,
    climbs: true,
    clearsGaps: false,
    climbChance: 0.012,
    projectile: null,
    colour: '#4a7de8',
  },

  /** Walks less, and throws. The first monster that can hurt you from across the room. */
  mighta: {
    kind: 'mighta',
    label: 'Mighta',
    firstRoom: 6,
    locomotion: 'walk',
    speed: 0.42,
    angrySpeed: 0.8,
    climbs: true,
    clearsGaps: false,
    climbChance: 0.008,
    projectile: { kind: 'boulder', cooldown: 150, speed: 1.1, arcs: false, life: 300 },
    colour: '#d8d2c4',
  },

  /** Ignores the level. The first monster the room's geometry cannot protect you from. */
  monsta: {
    kind: 'monsta',
    label: 'Monsta',
    firstRoom: 10,
    locomotion: 'fly',
    speed: 0.9,
    angrySpeed: 1.4,
    climbs: false,
    clearsGaps: true,
    climbChance: 0,
    projectile: null,
    colour: '#a25cd8',
  },

  pulpul: {
    kind: 'pulpul',
    label: 'Pulpul',
    firstRoom: 20,
    locomotion: 'float',
    speed: 1.0,
    angrySpeed: 1.5,
    climbs: false,
    clearsGaps: true,
    climbChance: 0,
    projectile: null,
    colour: '#e88ab0',
  },

  /** Hops, so you cannot read where it will be — and it clears gaps you counted on. */
  banebou: {
    kind: 'banebou',
    label: 'Banebou',
    firstRoom: 30,
    locomotion: 'hop',
    speed: 0.7,
    angrySpeed: 1.1,
    climbs: true,
    clearsGaps: true,
    climbChance: 0.05,
    projectile: null,
    colour: '#5ad8a0',
  },

  /** The first *fast* projectile. Cover stops being reliable. */
  hidegons: {
    kind: 'hidegons',
    label: 'Hidegons',
    firstRoom: 40,
    locomotion: 'walk',
    speed: 0.5,
    angrySpeed: 0.9,
    climbs: true,
    clearsGaps: false,
    climbChance: 0.02,
    projectile: { kind: 'fireball', cooldown: 110, speed: 2.4, arcs: false, life: 240 },
    colour: '#e8734a',
  },

  /** Lobs bottles, so height is no longer safety. */
  drunk: {
    kind: 'drunk',
    label: 'Drunk',
    firstRoom: 50,
    locomotion: 'walk',
    speed: 0.5,
    angrySpeed: 0.95,
    climbs: true,
    clearsGaps: false,
    climbChance: 0.015,
    projectile: { kind: 'bottle', cooldown: 130, speed: 1.6, arcs: true, life: 300 },
    colour: '#7ad85a',
  },

  invader: {
    kind: 'invader',
    label: 'Invader',
    firstRoom: 60,
    locomotion: 'float',
    speed: 0.8,
    angrySpeed: 1.3,
    climbs: false,
    clearsGaps: true,
    climbChance: 0,
    projectile: { kind: 'fireball', cooldown: 95, speed: 2.0, arcs: false, life: 240 },
    colour: '#5ad8d8',
  },
};

/** Which types a given room may draw on, per the introduction schedule. */
export function unlockedBy(roomNumber: number): MonsterSpec[] {
  return Object.values(MONSTER_SPECS).filter((s) => s.firstRoom <= roomNumber);
}
