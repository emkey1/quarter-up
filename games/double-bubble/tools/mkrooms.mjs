#!/usr/bin/env node
/**
 * Generates src/data/rooms/*.json — the hundred campaign rooms and the three secret
 * rooms.
 *
 * Rooms are generated rather than hand-typed because a 32x28 grid drifts out of shape
 * the moment you edit it, and a row that ends up 31 characters wide fails validation
 * with a message about row 14 rather than about the edit you just made. Declaring
 * platforms as segments and letting the script lay out the grid means the source of
 * truth is the shape you meant, not the shape you typed.
 *
 * Everything here is DETERMINISTIC. A seeded generator means room 63 is the same room
 * on every machine and in every run, which is what lets a player learn it — and what
 * lets a bug report about room 63 mean anything.
 *
 *   node tools/mkrooms.mjs
 */
import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GRID_W = 32;
const GRID_H = 28;
const FINAL_ROOM = 100;

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/rooms');

/* ------------------------------------------------------------------ determinism */

/** splitmix32 — same generator the game uses, so rooms are reproducible anywhere. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return ((z ^ (z >>> 15)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];
const between = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const rows = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/* ------------------------------------------------------------------ layout */

function buildTiles({ walls = true, platforms = [], solids = [] }) {
  const grid = [];
  for (let y = 0; y < GRID_H; y++) {
    const row = new Array(GRID_W).fill('.');
    if (walls) {
      row[0] = '#';
      row[GRID_W - 1] = '#';
    }
    grid.push(row);
  }
  for (const [y, x0, x1] of solids) for (let x = x0; x <= x1; x++) grid[y][x] = '#';
  for (const [y, x0, x1] of platforms) for (let x = x0; x <= x1; x++) grid[y][x] = '=';
  return grid.map((r) => r.join(''));
}

function buildDrift({ right = [], left = [], up = [], down = [] } = {}) {
  const out = [];
  for (let y = 0; y < GRID_H; y++) {
    let ch = '.';
    if (right.includes(y)) ch = 'r';
    else if (left.includes(y)) ch = 'l';
    else if (up.includes(y)) ch = 'u';
    else if (down.includes(y)) ch = 'd';
    out.push(ch.repeat(GRID_W));
  }
  return out;
}

/**
 * TIER SPACING IS THREE OR FIVE-PLUS, NEVER FOUR.
 *
 * The jump apex is four tiles exactly, so a platform four rows up sits precisely at the
 * limit: the feet arrive level with the lip and whether you catch it comes down to float
 * noise. That reads as broken input, not as "you need a bubble for this one". Three
 * clears comfortably; five or more is unmistakably a bubble-riding problem.
 *
 * There is a test asserting no generated room contains a four-row gap.
 */
const GAPS = [3, 3, 3, 5, 6];

/**
 * Lay out the tiers.
 *
 * Alternating sides with a small horizontal step, because a jump covers roughly 4.75
 * tiles of ground and a tier you cannot reach sideways is as unreachable as one you
 * cannot reach upward.
 */
function tiers(r, { density }) {
  const platforms = [[25, 3, 28]]; // floor, short of the walls so the wrap is findable
  let y = 25;
  let side = 0;

  while (y > 6) {
    const gap = pick(r, GAPS);
    y -= gap;
    if (y < 5) break;

    const span = between(r, 6, 6 + density);
    // Alternate sides, with enough overlap that the staircase stays climbable.
    const x0 = side === 0 ? between(r, 3, 8) : between(r, GRID_W - 11 - density, GRID_W - 9);
    platforms.push([y, x0, Math.min(GRID_W - 3, x0 + span)]);

    // Every so often a second shelf on the same tier, to open a second route.
    if (r() < 0.42) {
      const bx = side === 0 ? between(r, 18, 22) : between(r, 6, 10);
      platforms.push([y, bx, Math.min(GRID_W - 3, bx + between(r, 4, 7))]);
    }
    side ^= 1;
  }
  return platforms;
}

/** Somewhere with floor under it, for a monster to stand on. */
function standingSpots(platforms) {
  const spots = [];
  for (const [y, x0, x1] of platforms) {
    for (let x = x0 + 1; x < x1; x += 3) spots.push({ x, y: y - 1 });
  }
  return spots;
}

/* ------------------------------------------------------------------ the roster */

/**
 * The introduction schedule, from DESIGN.md §3.5 — the original's, and well judged:
 * one new idea roughly every ten rooms, each invalidating a habit the last ten taught.
 */
const ROSTER = [
  { kind: 'zenchan', from: 1 },
  { kind: 'mighta', from: 6 },
  { kind: 'monsta', from: 10 },
  { kind: 'pulpul', from: 20 },
  { kind: 'banebou', from: 30 },
  { kind: 'hidegons', from: 40 },
  { kind: 'drunk', from: 50 },
  { kind: 'invader', from: 60 },
];

const unlocked = (room) => ROSTER.filter((m) => m.from <= room).map((m) => m.kind);

/**
 * A newly introduced type gets the room to itself for a few rooms.
 *
 * Meeting Monsta for the first time in a crowd teaches nothing; meeting two of them
 * alone teaches that the tier you are standing on is no longer safety.
 */
function castFor(r, room) {
  const available = unlocked(room);
  const fresh = ROSTER.find((m) => room >= m.from && room < m.from + 3);
  if (fresh) return [fresh.kind];
  return available;
}

/* ------------------------------------------------------------------ rooms */

/**
 * No monster may start within this many tiles of the player.
 *
 * Without it the generator put a monster inside the player's start position in room 29
 * and within two tiles in dozens of others — so the room opened with an instant death,
 * the respawn put the player back on the same monster, and three lives evaporated in a
 * couple of seconds before anyone touched a key. A player is owed the first moment of a
 * room to look at it.
 */
const SPAWN_SAFE_TILES = 9;

function makeRoom(n) {
  const r = rng(0x5eed + n * 2654435761);
  const density = Math.min(6, 1 + Math.floor(n / 18));
  const platforms = tiers(r, { density });
  const playerStart = { x: r() < 0.5 ? 4 : 27, y: 24 };

  const spots = standingSpots(platforms).filter(
    (s) => s.y > 6 && Math.hypot(s.x - playerStart.x, s.y - playerStart.y) >= SPAWN_SAFE_TILES,
  );

  const cast = castFor(r, n);
  const count = Math.min(spots.length, between(r, 2, Math.min(7, 2 + Math.floor(n / 12))));

  const spawns = [];
  const used = new Set();
  for (let i = 0; i < count && spots.length > 0; i++) {
    let idx = between(r, 0, spots.length - 1);
    for (let tries = 0; tries < 8 && used.has(idx); tries++) idx = between(r, 0, spots.length - 1);
    if (used.has(idx)) continue;
    used.add(idx);
    const s = spots[idx];
    spawns.push({ kind: pick(r, cast), x: s.x, y: s.y, dir: r() < 0.5 ? -1 : 1 });
  }
  // A room needs at least one monster to be clearable. If the safe radius swallowed
  // every standing spot, put one as far from the player as the room allows.
  if (spawns.length === 0) {
    const far = playerStart.x < GRID_W / 2 ? GRID_W - 4 : 3;
    spawns.push({ kind: cast[0], x: far, y: 24, dir: playerStart.x < GRID_W / 2 ? -1 : 1 });
  }

  // Currents: bands that alternate direction so a bubble weaves as it climbs. A field
  // is sparse by nature, and a room with almost no current leaves bubbles rising in
  // dead-straight columns.
  const bandTop = between(r, 0, 3);
  const drift = buildDrift({
    right: [...rows(bandTop, bandTop + 3), ...rows(17, 20)],
    left: rows(9, 12),
  });

  /*
   * Escape time varies per room, and more sharply than any other per-room value — the
   * original does this, and it is the main dial for how frantic a room feels. Later
   * rooms trend shorter, but the jitter matters more than the trend: a run of rooms
   * that all feel the same is worse than one that occasionally panics you.
   */
  const base = Math.max(180, 520 - n * 2.4);
  const escapeFrames = Math.round(base * (0.7 + r() * 0.6));

  const specials = [];
  if (n >= 8 && r() < 0.45) specials.push('water');
  if (n >= 18 && r() < 0.35) specials.push('lightning');
  if (n >= 28 && r() < 0.3) specials.push('fire');

  return {
    id: `r${String(n).padStart(3, '0')}`,
    tiles: buildTiles({ platforms }),
    drift,
    driftSpeed: 0.35 + r() * 0.2,
    playerStart,
    spawns,
    escapeFrames,
    timer: Math.max(900, 1800 - n * 6),
    specialBubbles: specials,
  };
}

/* ------------------------------------------------------------------ secret rooms */

/**
 * The cryptograms.
 *
 * The original hides its lore in encoded messages in the secret rooms, and a player who
 * bothers to decode them learns how the true ending works. Ours are our own text under
 * a simple substitution — the puzzle is the point, not the cipher's strength, and a
 * player who just wants the gems can ignore them entirely.
 */
const CIPHER_IN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CIPHER_OUT = 'ZYXWVUTSRQPONMLKJIHGFEDCBA';

const encode = (s) =>
  s
    .toUpperCase()
    .split('')
    .map((ch) => {
      const i = CIPHER_IN.indexOf(ch);
      return i < 0 ? ch : CIPHER_OUT[i];
    })
    .join('');

const SECRETS = [
  { at: 20, plain: 'THE CAVE KEEPS WHAT IT TAKES' },
  { at: 30, plain: 'THUNDER SLEEPS BENEATH THE HUNDREDTH ROOM' },
  { at: 40, plain: 'NO ONE LEAVES ALONE UNLESS THEY LEAVE PERFECT' },
];

/**
 * A secret room: a wide open vault, no monsters, and a lot to pick up.
 *
 * Deliberately shaped nothing like a fighting room. It is a reward, and it should read
 * as one the instant it loads.
 */
function makeSecret(spec) {
  const platforms = [
    [25, 2, 29],
    [20, 4, 27],
    [15, 4, 27],
    [10, 4, 27],
  ];
  return {
    id: `s${spec.at}`,
    tiles: buildTiles({ platforms }),
    drift: buildDrift({ right: rows(0, 3) }),
    driftSpeed: 0.3,
    playerStart: { x: 15, y: 24 },
    // Rooms need at least one monster to be valid, and a secret room has none — so it
    // gets the one thing that hunts you here, tucked in a corner. DESIGN.md §3.10.
    spawns: [{ kind: 'monsta', x: 28, y: 3, dir: -1 }],
    escapeFrames: 600,
    timer: 1500,
    specialBubbles: [],
    secret: { plain: spec.plain, cipher: encode(spec.plain) },
  };
}

/* ------------------------------------------------------------------ emit */

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith('.json')) unlinkSync(resolve(OUT, f));

/**
 * Room 100 — the boss arena.
 *
 * Open, symmetrical, and nothing like the ninety-nine rooms before it. Wide tiers with
 * clear sight lines, because the fight is about steering a lightning bolt across the
 * room and a cluttered arena would make that luck rather than aim.
 *
 * Only lightning drifts in here. Water and fire cannot hurt the boss, so offering them
 * would be a cruel joke on a player who has not yet worked out what does.
 */
function makeBossRoom() {
  // Rows 25 / 22 / 17: gaps of three and five. Four is the one spacing no room may have
  // — it sits exactly at the jump apex — and a hand-written room is just as bound by
  // that as a generated one.
  const platforms = [
    [25, 2, 29],
    [22, 2, 10],
    [22, 21, 29],
    [17, 12, 19],
  ];
  return {
    id: `r${FINAL_ROOM}`,
    tiles: buildTiles({ platforms }),
    drift: buildDrift({ right: rows(0, 3), left: rows(10, 13) }),
    driftSpeed: 0.4,
    playerStart: { x: 15, y: 24 },
    spawns: [],
    escapeFrames: 420,
    timer: 5400,
    specialBubbles: ['lightning'],
    boss: true,
  };
}

const all = [];
for (let n = 1; n < FINAL_ROOM; n++) all.push(makeRoom(n));
all.push(makeBossRoom());
for (const s of SECRETS) all.push(makeSecret(s));

for (const room of all) {
  // Grids one-per-line so a diff shows the room, not a reflowed blob.
  const json = JSON.stringify(room, null, 2).replace(
    /"(tiles|drift)": \[\s+([^\]]+?)\s+\]/g,
    (_m, key, body) => {
      const lines = body
        .split(',')
        .map((s) => s.trim())
        .join(',\n      ');
      return `"${key}": [\n      ${lines}\n    ]`;
    },
  );
  writeFileSync(resolve(OUT, `${room.id}.json`), json + '\n');
}

console.log(`wrote ${all.length} rooms to ${OUT}`);
