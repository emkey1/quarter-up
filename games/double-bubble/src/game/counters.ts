import {
  COUNTER_NAMES,
  THRESHOLDS,
  tierFor,
  type CounterName,
  type ItemKind,
} from '@/data/items';
import { readJson, writeJson } from '@/engine/storage';

/**
 * The hidden counter array.
 *
 * Everything the player does increments something. At each room start the threshold
 * table is walked in order and the first counter at or over its bar wins: it is reset
 * to zero and its item is placed in the room. Nothing is random, and that is the whole
 * trick — a player who experiments can learn the entire reward system without ever
 * being told a single rule. DESIGN.md §3.9.
 */

export type Counters = Record<CounterName, number>;

const STORAGE_KEY = 'double-bubble.counters.v1';

export function emptyCounters(): Counters {
  const c = {} as Counters;
  for (const name of COUNTER_NAMES) c[name] = 0;
  return c;
}

/**
 * Load the counters saved from previous sessions.
 *
 * On the arcade these persisted across plays — the cabinet accumulated knowledge of
 * whoever had been feeding it. localStorage is the honest equivalent and costs nothing,
 * so the machine remembers *this* player between visits rather than resetting every
 * time the tab closes. It is also why the numbers below are per-player rather than
 * per-run: the reward for jumping a lot is meant to arrive eventually, not within one
 * particular life.
 *
 * Unknown keys in stored data are ignored and missing ones default to zero, so an older
 * save survives a change to the counter list.
 */
export function loadCounters(): Counters {
  const stored = readJson<Partial<Record<string, unknown>>>(STORAGE_KEY, {});
  const c = emptyCounters();
  for (const name of COUNTER_NAMES) {
    const v = stored[name];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) c[name] = Math.floor(v);
  }
  return c;
}

export function saveCounters(c: Counters): void {
  writeJson(STORAGE_KEY, c);
}

export function clearStoredCounters(): void {
  writeJson(STORAGE_KEY, emptyCounters());
}

export interface WalkResult {
  item: ItemKind | null;
  /** Which counter paid for it, for the debug overlay. */
  counter: CounterName | null;
}

/**
 * Walk the thresholds and award at most one item.
 *
 * Exactly one per room. Resetting the winner rather than decrementing it is what makes
 * items feel earned in bursts — a long stretch of jumping buys one sweet, not a stream
 * of them — and it is what keeps a single runaway counter from starving every other
 * item in the table.
 */
export function walkThresholds(c: Counters, roomNumber: number): WalkResult {
  const tier = tierFor(roomNumber);
  for (const t of THRESHOLDS) {
    if (c[t.counter] >= t.at[tier]) {
      c[t.counter] = 0;
      return { item: t.item, counter: t.counter };
    }
  }
  return { item: null, counter: null };
}

export interface CounterReading {
  counter: CounterName;
  value: number;
  /** The nearest threshold this counter feeds, at the current tier. */
  next: number;
  item: ItemKind;
  ready: boolean;
}

/**
 * What the debug overlay shows.
 *
 * Without a live view of the counters this system is untestable by hand — you cannot
 * tell whether jumping is being counted except by jumping thirty-five times and seeing
 * what happens. F2 makes it observable.
 */
export function readCounters(c: Counters, roomNumber: number): CounterReading[] {
  const tier = tierFor(roomNumber);
  const out: CounterReading[] = [];
  for (const t of THRESHOLDS) {
    out.push({
      counter: t.counter,
      value: c[t.counter],
      next: t.at[tier],
      item: t.item,
      ready: c[t.counter] >= t.at[tier],
    });
  }
  return out;
}
