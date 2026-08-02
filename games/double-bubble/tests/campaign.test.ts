import { describe, it, expect } from 'vitest';
import { T } from '@/data/tuning';
import {
  advance,
  doorFor,
  FINAL_ROOM,
  GOLD_DOOR_ROOM,
  GOLD_DOOR_TARGET,
  isDeathless,
  newCampaign,
  recordDeath,
  secretRoomFor,
  SILVER_DOOR_ROOMS,
  speedScale,
} from '@/game/campaign';
import { emptyCounters } from '@/game/counters';
import { roomFor, secretRoom, ROOM_COUNT } from '@/data/rooms';
import { MONSTER_SPECS } from '@/data/roster';
import { isFloor, tileAt, validateRoom, MONSTER_KINDS } from '@/game/room';
import { predictJump } from '@/game/physics';
import { Player } from '@/game/player';
import { World } from '@/game/world';
import { initialScore } from '@/game/score';
import { emptyActions } from '@/game/controls';

const fresh = () => newCampaign(emptyCounters());

/* ------------------------------------------------------------------ progression */

describe('progression', () => {
  it('starts at room 1 with a clean sheet', () => {
    const c = fresh();
    expect(c.room).toBe(1);
    expect(isDeathless(c)).toBe(true);
    expect(c.superMode).toBe(false);
  });

  it('advances one room at a time', () => {
    const c = fresh();
    expect(advance(c)).toBe(2);
    expect(advance(c)).toBe(3);
  });

  it('skips ahead on an umbrella', () => {
    const c = fresh();
    c.room = 10;
    expect(advance(c, { warp: 5 })).toBe(15);
  });

  /** Round two is the same hundred rooms, faster — not a different hundred. */
  it('loops into Super Mode past the final room', () => {
    const c = fresh();
    c.room = FINAL_ROOM;
    expect(advance(c)).toBe(1);
    expect(c.superMode).toBe(true);
    expect(speedScale(c)).toBeGreaterThan(1);
  });
});

/* ------------------------------------------------------------------ the doors */

describe('secret doors', () => {
  /**
   * The whole reason the campaign layer exists. Doors are gated on having lost no lives
   * SINCE THE RUN BEGAN, so the tracking has to be live from room 1 — long before the
   * doors it feeds are reachable.
   */
  it('offers a silver door at each gate on a clean run', () => {
    for (const gate of SILVER_DOOR_ROOMS) {
      const c = fresh();
      c.room = gate;
      expect(doorFor(c), `room ${gate}`).toBe('silver');
    }
  });

  it('offers the gold door at room 50', () => {
    const c = fresh();
    c.room = GOLD_DOOR_ROOM;
    expect(doorFor(c)).toBe('gold');
  });

  it('offers nothing in an ordinary room', () => {
    const c = fresh();
    for (const room of [1, 19, 21, 35, 49, 51, 99]) {
      c.room = room;
      expect(doorFor(c), `room ${room}`).toBe(null);
    }
  });

  /** One death anywhere closes every door for the rest of the run. */
  it('closes every door permanently after a single death', () => {
    const c = fresh();
    c.room = 5;
    recordDeath(c);
    expect(isDeathless(c)).toBe(false);

    for (const gate of [...SILVER_DOOR_ROOMS, GOLD_DOOR_ROOM]) {
      c.room = gate;
      expect(doorFor(c), `room ${gate} after a death`).toBe(null);
    }
  });

  it('does not offer the same door twice', () => {
    const c = fresh();
    c.room = 20;
    expect(doorFor(c)).toBe('silver');
    advance(c, { door: 'silver' });
    expect(doorFor(c)).toBe(null);
  });

  /** The largest single reward in the game, and the reason to attempt a clean 50. */
  it('jumps twenty rooms through the gold door', () => {
    const c = fresh();
    c.room = GOLD_DOOR_ROOM;
    expect(advance(c, { door: 'gold' })).toBe(GOLD_DOOR_TARGET);
  });

  it('holds the room number while detouring through a secret room', () => {
    const c = fresh();
    c.room = 30;
    expect(advance(c, { door: 'silver' })).toBe(30);
    // Coming back out then moves on normally.
    expect(advance(c)).toBe(31);
  });

  it('maps each gate to its own secret room', () => {
    for (const gate of SILVER_DOOR_ROOMS) expect(secretRoomFor(gate)).toBe(`s${gate}`);
    expect(secretRoomFor(21)).toBe(null);
  });
});

/* ------------------------------------------------------------------ the rooms */

describe('the room library', () => {
  it('ships a hundred campaign rooms and three secret ones', () => {
    expect(ROOM_COUNT).toBe(FINAL_ROOM + SILVER_DOOR_ROOMS.length);
    for (let n = 1; n <= FINAL_ROOM; n++) expect(roomFor(n), `room ${n}`).toBeTruthy();
    for (const gate of SILVER_DOOR_ROOMS) expect(secretRoom(gate), `secret ${gate}`).toBeTruthy();
  });

  it('clamps out-of-range requests rather than throwing mid-run', () => {
    expect(roomFor(0).id).toBe('r001');
    expect(roomFor(999).id).toBe(`r${FINAL_ROOM}`);
  });

  /**
   * The level lint, applied to all hundred. A tier exactly four rows above another sits
   * precisely at the jump apex: the feet arrive level with the lip and catching it comes
   * down to float noise, which reads as broken input rather than as a platform meant to
   * need a bubble. Three is a hop, five is honestly out of reach, four is the one gap no
   * room may contain.
   */
  it('contains no four-row tier gap in any of the hundred rooms', () => {
    expect(predictJump().apex / T.TILE).toBeCloseTo(4, 1);

    for (let n = 1; n <= FINAL_ROOM; n++) {
      const room = roomFor(n);
      const rows: number[] = [];
      for (let y = 0; y < T.GRID_H; y++) {
        for (let x = 1; x < T.GRID_W - 1; x++) {
          if (isFloor(tileAt(room, x, y))) {
            rows.push(y);
            break;
          }
        }
      }
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i] - rows[i - 1], `room ${n}, rows ${rows[i - 1]}->${rows[i]}`).not.toBe(4);
      }
    }
  });

  /** A room with no monsters can never be cleared; one with a monster in a wall is
   *  unwinnable in a subtler way. */
  it('gives every room monsters, all of them inside the room', () => {
    for (let n = 1; n <= FINAL_ROOM; n++) {
      const room = roomFor(n);
      expect(room.spawns.length, `room ${n}`).toBeGreaterThan(0);
      for (const s of room.spawns) {
        expect(s.x).toBeGreaterThan(0);
        expect(s.x).toBeLessThan(T.GRID_W - 1);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeLessThan(T.GRID_H);
      }
    }
  });

  it('starts the player somewhere inside the room', () => {
    for (let n = 1; n <= FINAL_ROOM; n++) {
      const { playerStart: p } = roomFor(n);
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(T.GRID_W - 1);
    }
  });

  /**
   * The introduction schedule is the original's and is well judged: one new idea roughly
   * every ten rooms. A monster appearing before its room teaches the wrong lesson at the
   * wrong time — and worse, silently makes an early room far harder than intended.
   */
  it('never uses a monster before the room it is introduced in', () => {
    for (let n = 1; n <= FINAL_ROOM; n++) {
      for (const s of roomFor(n).spawns) {
        expect(MONSTER_SPECS[s.kind].firstRoom, `${s.kind} in room ${n}`).toBeLessThanOrEqual(n);
      }
    }
  });

  it('eventually uses every monster in the roster', () => {
    const seen = new Set<string>();
    for (let n = 1; n <= FINAL_ROOM; n++) for (const s of roomFor(n).spawns) seen.add(s.kind);
    for (const kind of MONSTER_KINDS) expect(seen.has(kind), `${kind} never appears`).toBe(true);
  });

  /** Rooms are generated from a seeded stream, so room 63 is the same room everywhere —
   *  which is what lets a player learn it and a bug report about it mean anything. */
  it('is deterministic: the same room number is always the same room', () => {
    expect(roomFor(63).tiles).toEqual(roomFor(63).tiles);
    expect(roomFor(63).id).toBe('r063');
  });

  it('varies escape time per room, which is the main dial for how frantic one feels', () => {
    const times = new Set<number>();
    for (let n = 1; n <= FINAL_ROOM; n++) times.add(roomFor(n).escapeFrames);
    expect(times.size).toBeGreaterThan(40);
  });

  it('gives every room a current somewhere, so bubbles are never static', () => {
    for (let n = 1; n <= FINAL_ROOM; n++) {
      const room = roomFor(n);
      expect([...room.drift].some((d) => d !== 0), `room ${n} has no current`).toBe(true);
    }
  });
});

describe('secret rooms', () => {
  it('carries a cryptogram that decodes to real text', () => {
    for (const gate of SILVER_DOOR_ROOMS) {
      const room = secretRoom(gate)!;
      expect(room.secret, `secret ${gate}`).toBeTruthy();
      expect(room.secret!.cipher.length).toBeGreaterThan(10);
      expect(room.secret!.cipher).not.toBe(room.secret!.plain);
      // Atbash is its own inverse, so encoding the cipher gives the plaintext back.
      const decode = (s: string) =>
        s.replace(/[A-Z]/g, (ch) =>
          String.fromCharCode(90 - (ch.charCodeAt(0) - 65)),
        );
      expect(decode(room.secret!.cipher)).toBe(room.secret!.plain.toUpperCase());
    }
  });

  it('is shaped like a reward rather than a fight', () => {
    for (const gate of SILVER_DOOR_ROOMS) {
      const room = secretRoom(gate)!;
      // One hunter and no more — a secret room is not a brawl. DESIGN.md §3.10.
      expect(room.spawns.length).toBe(1);
    }
  });
});

/* ------------------------------------------------------------------ a fair start */

/**
 * The room-opening death.
 *
 * Reported in play as "the second level is instant death". Three separate causes, all
 * compounding, and all invisible to every test that existed:
 *
 *   1. The generator placed monsters anywhere with floor under them — including the
 *      player's own start tile. Fifty of the hundred rooms had one within six tiles;
 *      room 29 had one at distance zero.
 *   2. Respawning put you back on the same monster with no grace, so one death cost
 *      every remaining life in about a second, with no input possible in between.
 *   3. The player always faced right, so a right-hand start looked at a wall with the
 *      room behind it. You cannot blow a bubble at something you are not facing.
 */
describe('a room opens fairly', () => {
  const SAFE_TILES = 9;

  it('never starts a monster on top of the player', () => {
    for (let n = 1; n <= FINAL_ROOM; n++) {
      const room = roomFor(n);
      for (const s of room.spawns) {
        const d = Math.hypot(s.x - room.playerStart.x, s.y - room.playerStart.y);
        expect(d, `room ${n}: ${s.kind} is ${d.toFixed(1)} tiles from the start`)
          .toBeGreaterThanOrEqual(SAFE_TILES);
      }
    }
  });

  it('faces the player into the room rather than at the nearest wall', () => {
    for (let n = 1; n <= FINAL_ROOM; n++) {
      const room = roomFor(n);
      const p = new Player(room.playerStart.x, room.playerStart.y);
      const expected = room.playerStart.x < T.GRID_W / 2 ? 1 : -1;
      expect(p.facing, `room ${n} starts at x=${room.playerStart.x}`).toBe(expected);
    }
  });

  it('gives a grace period on respawn, so one death cannot cost them all', () => {
    // A monster sitting exactly on the start point: the worst case the generator can no
    // longer produce, but a walking monster still can.
    const rows: string[][] = [];
    for (let y = 0; y < T.GRID_H; y++) {
      const r = new Array<string>(T.GRID_W).fill('.');
      r[0] = '#';
      r[T.GRID_W - 1] = '#';
      rows.push(r);
    }
    for (let x = 1; x <= 30; x++) rows[25][x] = '=';
    const parsed = validateRoom({
      id: 'ambush',
      tiles: rows.map((x) => x.join('')),
      playerStart: { x: 15, y: 24 },
      spawns: [{ kind: 'zenchan', x: 15, y: 24, dir: 1 }],
      timer: 1_000_000,
    });
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));

    const w = new World(parsed.data, 1, initialScore(), emptyCounters());
    const start = w.score.lives;

    // One death is expected. Losing more than one inside the grace window is the bug.
    for (let f = 0; f < T.RESPAWN_INVULN_FRAMES; f++) w.step(emptyActions());
    expect(start - w.score.lives).toBeLessThanOrEqual(1);
    expect(w.phase).not.toBe('dead');
  });
});
