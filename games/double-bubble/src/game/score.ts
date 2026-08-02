import { T } from '@/data/tuning';

/**
 * Scoring.
 *
 * The exponential chain curve is not decoration — it is the reason the game is about
 * herding rather than shooting. A player who pops monsters one at a time is playing a
 * different and much poorer game than the one this curve was written for, and the whole
 * design of bubble pushing exists to make the alternative reachable. DESIGN.md §3.8.
 */

/** Points for popping `n` bubbled monsters in a single chain: 2^(n-1) x 1000. */
export function chainScore(n: number): number {
  if (n <= 0) return 0;
  return Math.pow(2, n - 1) * T.CHAIN_BASE;
}

/**
 * EXTEND letters dropped by a chain of `n`.
 *
 * A separate curve from the score, and a much steeper threshold: two monsters at once
 * drops nothing at all. Collecting E-X-T-E-N-D grants a life *and ends the room*, so
 * the letters have to be worth setting up rather than something you accumulate by
 * playing normally.
 */
export function extendLetters(n: number): number {
  const table = T.EXTEND_LETTERS;
  if (n <= 0) return 0;
  return table[Math.min(n, table.length - 1)];
}

/** The six letters, in order. */
export const EXTEND_WORD = ['E', 'X', 'T', 'E', 'N', 'D'] as const;

export interface ScoreState {
  points: number;
  /** Bitmask of collected EXTEND letters — index 0 is the first E. */
  extend: number;
  lives: number;
}

export function initialScore(): ScoreState {
  return { points: 0, extend: 0, lives: T.STARTING_LIVES };
}

export function hasLetter(s: ScoreState, index: number): boolean {
  return (s.extend & (1 << index)) !== 0;
}

export function collectedCount(s: ScoreState): number {
  let n = 0;
  for (let i = 0; i < EXTEND_WORD.length; i++) if (hasLetter(s, i)) n++;
  return n;
}

/**
 * Take a letter. Returns true if that completed the word, which both grants a life and
 * ends the room — the caller has to handle both.
 */
export function collectLetter(s: ScoreState, index: number): boolean {
  s.extend |= 1 << index;
  if (collectedCount(s) < EXTEND_WORD.length) return false;
  s.lives++;
  s.extend = 0;
  return true;
}
