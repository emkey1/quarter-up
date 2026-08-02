import { T } from '@/data/tuning';
import { loadCounters, saveCounters, type Counters } from './counters';
import { initialScore, type ScoreState } from './score';

/**
 * The run: which room you are in, what you have kept, and what you have not lost.
 *
 * The deathless flags are the reason this exists as a layer above World. Secret rooms
 * are gated on reaching room 20, 30 or 40 *without having lost a life since the run
 * began* — so the tracking has to be live from room 1, long before the doors it feeds
 * are reachable. Bolting it on at room 19 would mean it had nothing to report.
 * DESIGN.md §3.10.
 */

export type DoorKind = 'silver' | 'gold';

/** Rooms that offer a silver door to a player who has not died. */
export const SILVER_DOOR_ROOMS: readonly number[] = [20, 30, 40];
/** Reaching this room deathless opens the gold door, which skips a long way ahead. */
export const GOLD_DOOR_ROOM = 50;
export const GOLD_DOOR_TARGET = 70;
export const FINAL_ROOM = 100;

export interface CampaignState {
  room: number;
  score: ScoreState;
  counters: Counters;
  /** Lives lost since the run began. Any death at all closes every secret door. */
  livesLost: number;
  /** Secret rooms already visited, so a door is not offered twice. */
  doorsTaken: number[];
  /** Second pass through the hundred rooms — faster, meaner. DESIGN.md §4. */
  superMode: boolean;
}

export function newCampaign(counters: Counters = loadCounters()): CampaignState {
  return {
    room: 1,
    score: initialScore(),
    counters,
    livesLost: 0,
    doorsTaken: [],
    superMode: false,
  };
}

/** Has the player kept a clean run? The single condition every secret door rests on. */
export function isDeathless(c: CampaignState): boolean {
  return c.livesLost === 0;
}

/**
 * Which door, if any, this room offers.
 *
 * Returns null unless the run is still clean and this room has not already been used.
 * A door is an *offer*, not an award: the player still has to reach it.
 */
export function doorFor(c: CampaignState): DoorKind | null {
  if (!isDeathless(c)) return null;
  if (c.doorsTaken.includes(c.room)) return null;
  if (SILVER_DOOR_ROOMS.includes(c.room)) return 'silver';
  if (c.room === GOLD_DOOR_ROOM) return 'gold';
  return null;
}

/** Which secret room a silver door leads to — one per gate, each with its own message. */
export function secretRoomFor(room: number): string | null {
  const i = SILVER_DOOR_ROOMS.indexOf(room);
  return i < 0 ? null : `s${SILVER_DOOR_ROOMS[i]}`;
}

export interface AdvanceOptions {
  /** Rooms to skip, from an umbrella. */
  warp?: number;
  /** The player went through a door rather than clearing the room. */
  door?: DoorKind;
}

/**
 * Move to the next room.
 *
 * Returns the room to load. A gold door is the big one: it jumps twenty rooms, which is
 * the largest single reward in the game and the reason a deathless run to 50 is worth
 * attempting at all.
 */
export function advance(c: CampaignState, opts: AdvanceOptions = {}): number {
  if (opts.door) {
    c.doorsTaken.push(c.room);
    if (opts.door === 'gold') {
      c.room = GOLD_DOOR_TARGET;
      return c.room;
    }
    // A silver door detours through its secret room; the caller loads that, and the
    // room number does not move until the player comes back out.
    return c.room;
  }

  c.room += Math.max(1, opts.warp ?? 1);

  if (c.room > FINAL_ROOM) {
    // Round two: the same hundred rooms, faster and meaner. The true ending lives at
    // the end of this pass — see §4 for why it is gated on mastery rather than on a
    // second player.
    c.superMode = true;
    c.room = 1;
  }
  return c.room;
}

/** Record a death. This is what closes the secret doors for the rest of the run. */
export function recordDeath(c: CampaignState): void {
  c.livesLost++;
}

export function persist(c: CampaignState): void {
  saveCounters(c.counters);
}

/**
 * How much harder Super Mode is.
 *
 * One multiplier rather than a second set of tuning: the original's second pass is the
 * same rooms run faster, not different rooms, and a single dial keeps it that way.
 */
export function speedScale(c: CampaignState): number {
  return c.superMode ? T.SUPER_MODE_SPEED : 1;
}
