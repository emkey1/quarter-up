/**
 * Difficulty.
 *
 * The cabinet shipped with operator DIP switches for difficulty, starting health and
 * monster speed, and arcade operators genuinely used them — the machine in your local
 * arcade was not tuned like the one across town. So a difficulty ladder is not a modern
 * concession bolted onto a faithful game; it is the part of the original that got left
 * out when the cabinet went away.
 *
 * Three knobs, all of them things a player can feel:
 *
 *  - **Health cap.** The original capped health, which changes how you play: once you
 *    cannot bank any more, food you walk past is wasted and the drain is a real clock
 *    again. Without a cap, a careful player just accumulates until nothing matters.
 *  - **Generator warm-up.** How long a generator waits after you first lay eyes on it.
 *    This is the difference between a room you can scout and a room that is already
 *    spilling monsters when you arrive.
 *  - **Spawn period and crowd caps.** How fast it keeps producing once awake, and how
 *    many monsters may exist at once, in total and around any one generator.
 *
 * Difficulty is part of the SIMULATION — it lives in `Rules`, so it is captured in run
 * state and replays, and shown on the score table. A score set on Apprentice must never
 * be able to look like one set on Nightmare.
 */

export type DifficultyId = 'apprentice' | 'squire' | 'veteran' | 'champion' | 'nightmare';

export interface Difficulty {
  id: DifficultyId;
  name: string;
  /** One line, in the player's terms, on the setup screen. */
  blurb: string;
  /** Ceiling on health. Food beyond this is wasted, exactly as in the original. */
  maxHealth: number;
  /**
   * Seconds a generator sits inert after the player FIRST sees it.
   *
   * Deliberately once per generator rather than every time it re-enters view: a
   * per-sighting timer would make peeking in and out of a doorway a free reset, which is
   * a worse game than either extreme.
   */
  warmupSec: number;
  /** Multiplier on the interval between spawns. Below 1 is faster, so harder. */
  periodScale: number;
  /** Multiplier on both the total and per-generator monster caps. */
  capScale: number;
}

/**
 * Five rungs. **Veteran is the default** and is the reference point the campaign's
 * pressure curve was authored against.
 *
 * Veteran spawns 15% faster than the raw arcade-reconstruction numbers in tuning.ts,
 * because playtesting said the reconstruction was too slow to threaten anyone. The
 * arcade values are still the arcade values; this scales them, and says so.
 */
export const DIFFICULTIES: readonly Difficulty[] = [
  {
    id: 'apprentice',
    name: 'Apprentice',
    blurb: 'Room to learn the maps. Generators wake slowly and health banks deep.',
    maxHealth: 2400,
    warmupSec: 4,
    periodScale: 1.5,
    capScale: 0.6,
  },
  {
    id: 'squire',
    name: 'Squire',
    blurb: 'Forgiving, but the drain still means it.',
    maxHealth: 1900,
    warmupSec: 2.5,
    periodScale: 1.2,
    capScale: 0.8,
  },
  {
    id: 'veteran',
    name: 'Veteran',
    blurb: 'The intended game. Health caps at 1500 and generators do not wait long.',
    maxHealth: 1500,
    warmupSec: 1.2,
    periodScale: 0.85,
    capScale: 1,
  },
  {
    id: 'champion',
    name: 'Champion',
    blurb: 'Generators wake almost on sight and crowd you fast. Bring potions.',
    maxHealth: 1100,
    warmupSec: 0.5,
    periodScale: 0.6,
    capScale: 1.35,
  },
  {
    id: 'nightmare',
    name: 'Nightmare',
    blurb: 'No warm-up at all. A nest seen is a nest already spawning.',
    maxHealth: 800,
    warmupSec: 0,
    periodScale: 0.4,
    capScale: 1.8,
  },
];

export const DEFAULT_DIFFICULTY: DifficultyId = 'veteran';

export function difficultyOf(id: DifficultyId): Difficulty {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[2];
}

/** Position on the ladder, so callers can compare two settings without a lookup table. */
export function difficultyRank(id: DifficultyId): number {
  const i = DIFFICULTIES.findIndex((d) => d.id === id);
  return i < 0 ? 2 : i;
}

/** The next rung up or down, clamped. Drives the setup screen's left/right. */
export function stepDifficulty(id: DifficultyId, dir: 1 | -1): DifficultyId {
  const i = Math.max(0, Math.min(DIFFICULTIES.length - 1, difficultyRank(id) + dir));
  return DIFFICULTIES[i].id;
}
