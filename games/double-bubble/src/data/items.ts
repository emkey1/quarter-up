/**
 * Items, and the hidden counters that decide when they appear.
 *
 * THIS IS THE HEART OF THE GAME. See DESIGN.md §3.9.
 *
 * The original does not randomise its rewards. It keeps a large array of counters
 * tracking everything the player does, and at each room start it walks a threshold list
 * in a fixed order. The FIRST counter over its threshold is reset to zero and its item
 * is placed in the room. The result reads as mysterious, is entirely deterministic, and
 * — the point — teaches itself to anyone who experiments. Jump a lot and sweets start
 * appearing; fall down the bottom of the screen repeatedly and potions do.
 *
 * Two properties this table has to preserve:
 *
 *   1. WALK ORDER IS SIGNIFICANT. It establishes item priority when several counters
 *      are over at once, so it is an explicit ordered array rather than an object whose
 *      key order is incidental.
 *   2. Thresholds scale with a hidden difficulty tier. The published tables give four
 *      values per item but not the rule that selects between them — see `tierFor`.
 *
 * Published numbers disagree in places (the sweets are cited as both 35 and 51). These
 * are ours: a starting point taken from the sources, to be tuned by play.
 */

export type CounterName =
  | 'jumps'
  | 'bubblesBlown'
  | 'emptyPops'
  | 'screenCrossings'
  | 'falls'
  | 'hurryUps'
  | 'fruitEaten'
  | 'sweetsYellow'
  | 'sweetsBlue'
  | 'sweetsPurple'
  | 'waterPops'
  | 'lightningPops'
  | 'firePops'
  | 'drownedMonsters'
  | 'specialItemsTaken';

export const COUNTER_NAMES: readonly CounterName[] = [
  'jumps',
  'bubblesBlown',
  'emptyPops',
  'screenCrossings',
  'falls',
  'hurryUps',
  'fruitEaten',
  'sweetsYellow',
  'sweetsBlue',
  'sweetsPurple',
  'waterPops',
  'lightningPops',
  'firePops',
  'drownedMonsters',
  'specialItemsTaken',
];

export type ItemKind =
  | 'sweetYellow'
  | 'sweetBlue'
  | 'sweetPurple'
  | 'shoe'
  | 'clock'
  | 'heart'
  | 'bell'
  | 'ringPurple'
  | 'ringRed'
  | 'ringBlue'
  | 'umbrellaOrange'
  | 'umbrellaRed'
  | 'umbrellaPurple'
  | 'potion'
  | 'bomb'
  | 'crossBlue'
  | 'crossRed'
  | 'diamond'
  | 'doorSilver'
  | 'doorGold'
  /** Dropped by chains, not by counters. */
  | 'extend'
  /** Dropped by dead monsters. */
  | 'fruit';

export interface ItemSpec {
  kind: ItemKind;
  label: string;
  points: number;
  colour: string;
  /** One line, shown when it is collected. The game explains itself sparingly. */
  note: string;
}

export const ITEM_SPECS: Record<ItemKind, ItemSpec> = {
  sweetYellow: { kind: 'sweetYellow', label: 'Yellow sweet', points: 100, colour: '#ffd24a', note: 'RAPID BUBBLES' },
  sweetBlue: { kind: 'sweetBlue', label: 'Blue sweet', points: 100, colour: '#4ac8ff', note: 'FAST BUBBLES' },
  sweetPurple: { kind: 'sweetPurple', label: 'Purple sweet', points: 100, colour: '#c07aff', note: 'LONG BUBBLES' },
  shoe: { kind: 'shoe', label: 'Red shoe', points: 100, colour: '#ff4a4a', note: 'FAST FEET' },
  clock: { kind: 'clock', label: 'Clock', points: 200, colour: '#e8e4d8', note: 'TIME STOPS' },
  heart: { kind: 'heart', label: 'Heart', points: 3000, colour: '#ff6b9d', note: 'UNTOUCHABLE' },
  bell: { kind: 'bell', label: 'Silver bell', points: 1000, colour: '#c8d0d8', note: 'SOMETHING IS COMING' },
  ringPurple: { kind: 'ringPurple', label: 'Purple ring', points: 1000, colour: '#a24aff', note: 'POINTS PER JUMP' },
  ringRed: { kind: 'ringRed', label: 'Red ring', points: 1000, colour: '#ff4a7a', note: 'POINTS PER BUBBLE' },
  ringBlue: { kind: 'ringBlue', label: 'Blue ring', points: 1000, colour: '#4affd8', note: 'POINTS PER STEP' },
  umbrellaOrange: { kind: 'umbrellaOrange', label: 'Orange umbrella', points: 200, colour: '#ff9a3d', note: 'SKIP 3 ROOMS' },
  umbrellaRed: { kind: 'umbrellaRed', label: 'Red umbrella', points: 200, colour: '#ff5a3d', note: 'SKIP 5 ROOMS' },
  umbrellaPurple: { kind: 'umbrellaPurple', label: 'Purple umbrella', points: 200, colour: '#b03dff', note: 'SKIP 7 ROOMS' },
  potion: { kind: 'potion', label: 'Potion', points: 500, colour: '#7affc8', note: 'A SHOWER OF FRUIT' },
  bomb: { kind: 'bomb', label: 'Bomb', points: 200, colour: '#5a5f68', note: 'EVERYTHING BURNS' },
  crossBlue: { kind: 'crossBlue', label: 'Blue cross', points: 3000, colour: '#4a9cff', note: 'THE ROOM FLOODS' },
  crossRed: { kind: 'crossRed', label: 'Red cross', points: 3000, colour: '#ff5a4a', note: 'THE ROOM BURNS' },
  diamond: { kind: 'diamond', label: 'Diamond', points: 7000, colour: '#9ce8ff', note: '' },
  doorSilver: { kind: 'doorSilver', label: 'Silver door', points: 1000, colour: '#c8d0d8', note: 'A WAY THROUGH' },
  doorGold: { kind: 'doorGold', label: 'Gold door', points: 3000, colour: '#ffd166', note: 'A LONG WAY THROUGH' },
  extend: { kind: 'extend', label: 'EXTEND letter', points: 500, colour: '#ffd166', note: '' },
  fruit: { kind: 'fruit', label: 'Fruit', points: 0, colour: '#7ad85a', note: '' },
};

export interface Threshold {
  item: ItemKind;
  counter: CounterName;
  /** One value per difficulty tier. */
  at: readonly [number, number, number, number];
}

/**
 * The walk, in priority order.
 *
 * Read top to bottom at each room start; the first counter at or over its threshold
 * wins, is reset to zero, and places its item. Reordering this changes which item a
 * player gets when several are due, so the order is part of the design rather than an
 * implementation detail.
 *
 * The cheap, discoverable ones come first deliberately: a new player who is jumping and
 * blowing constantly should trip those early and learn that behaviour causes items at
 * all, before the rarer ones ever come into play.
 */
export const THRESHOLDS: readonly Threshold[] = [
  { item: 'sweetYellow', counter: 'jumps', at: [35, 40, 45, 51] },
  { item: 'sweetPurple', counter: 'bubblesBlown', at: [35, 40, 45, 51] },
  { item: 'sweetBlue', counter: 'emptyPops', at: [35, 40, 45, 51] },
  { item: 'shoe', counter: 'screenCrossings', at: [15, 18, 21, 24] },

  /*
   * TIERED ITEMS SHARING A COUNTER MUST BE LISTED HIGHEST-THRESHOLD FIRST.
   *
   * The walk resets the counter it pays from, so listing the cheap umbrella first means
   * the count hits 15, buys orange, resets to zero, and never reaches 20 or 25 — red
   * and purple become permanently unreachable while looking perfectly well configured.
   * Descending order makes the biggest prize you have earned the one you get.
   *
   * Now on their real trigger — popping water bubbles — rather than the stand-in they
   * used before special bubbles existed.
   */
  { item: 'umbrellaPurple', counter: 'waterPops', at: [25, 30, 35, 40] },
  { item: 'umbrellaRed', counter: 'waterPops', at: [20, 24, 28, 32] },
  { item: 'umbrellaOrange', counter: 'waterPops', at: [15, 18, 21, 24] },

  { item: 'ringPurple', counter: 'sweetsYellow', at: [3, 3, 4, 4] },
  { item: 'ringRed', counter: 'sweetsPurple', at: [3, 3, 4, 4] },
  { item: 'ringBlue', counter: 'sweetsBlue', at: [3, 3, 4, 4] },

  /*
   * The deep end. You cannot reach these without first learning that special bubbles
   * exist, that a bolt is aimed by choosing which side to pop from, and that what you
   * kill a monster WITH decides what it leaves behind. That is the counter system's
   * whole argument in one block: the rarest rewards are gated on understanding, not on
   * patience.
   */
  { item: 'crossRed', counter: 'drownedMonsters', at: [4, 5, 6, 7] },
  { item: 'crossBlue', counter: 'specialItemsTaken', at: [10, 11, 12, 13] },
  { item: 'bomb', counter: 'firePops', at: [10, 13, 16, 19] },
  /** Back on its documented trigger now that lightning bubbles exist. */
  { item: 'clock', counter: 'lightningPops', at: [12, 14, 16, 18] },

  /** Source-accurate: potions are bought by falling out of the bottom of the room. */
  { item: 'potion', counter: 'falls', at: [15, 16, 17, 18] },
  { item: 'bell', counter: 'hurryUps', at: [8, 10, 12, 14] },
  { item: 'heart', counter: 'fruitEaten', at: [50, 55, 60, 65] },
];

/**
 * Which threshold column applies.
 *
 * The original's tier-selection rule is not documented anywhere I could find — the
 * published tables give four values per item and no way to know which is in force
 * (DESIGN.md §13). This is OURS, not a reconstruction: the tier steps every 25 rooms,
 * so a run gets steadily stingier as it goes. Documented as an invention so nobody
 * later mistakes it for a sourced fact.
 */
export function tierFor(roomNumber: number): 0 | 1 | 2 | 3 {
  const t = Math.floor((roomNumber - 1) / 25);
  return Math.max(0, Math.min(3, t)) as 0 | 1 | 2 | 3;
}
