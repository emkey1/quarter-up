#!/usr/bin/env node
/**
 * Builds the fifteen layouts.
 *
 * Same approach as Bracer's campaign generator, and the same honesty about what it is:
 * parameterised hand-design. Each layout is a short recipe over a named vocabulary —
 * galleries, shafts, chambers, staircases — chosen deliberately per level. The fine
 * grain inside a shape is generated; the composition is not.
 *
 * Every layout is validated before it is written, and the build fails rather than
 * shipping one that is broken. The checks are the ones that actually matter here:
 *
 *   - the player starts somewhere open, with a way to the surface
 *   - every enemy starts somewhere open, or it ghosts from frame one and never stops
 *   - no rock starts unsupported, or it falls before the player has done anything
 *   - no rock sits on the player's head at spawn
 *   - there is at least one rock, because the bonus is gated on dropping two
 *
 * Run: node tools/mklayouts.mjs
 */
import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 14;
const H = 18;
const SKY = 2;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/layouts');

const EARTH = '#';
const CUT = '.';
const SKYCH = ' ';

/* ------------------------------------------------------------------ primitives */

const blank = () =>
  Array.from({ length: H }, (_, y) => Array.from({ length: W }, () => (y < SKY ? SKYCH : EARTH)));

const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

function cut(g, x, y) {
  if (inb(x, y) && g[y][x] === EARTH) g[y][x] = CUT;
}

/** A horizontal gallery. The bread and butter: somewhere to be chased along. */
function gallery(g, y, x0, x1) {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) cut(g, x, y);
}

/** A vertical shaft, usually the way down from the surface. */
function shaft(g, x, y0, y1) {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) cut(g, x, y);
}

/** An open room. Space to be caught in, and the only place a crowd can form. */
function chamber(g, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cut(g, x, y);
}

/** A descending zig-zag: gallery, drop, gallery back the other way. */
function stair(g, x0, x1, y0, steps, drop) {
  let y = y0;
  let left = true;
  for (let i = 0; i < steps; i++) {
    gallery(g, y, left ? x0 : x1, left ? x1 : x0);
    const turn = left ? x1 : x0;
    shaft(g, turn, y, Math.min(H - 1, y + drop));
    y += drop;
    left = !left;
    if (y >= H) break;
  }
}

/** A pocket for one enemy to start in, so it is not entombed. */
function pocket(g, x, y) {
  cut(g, x, y);
}

/* ------------------------------------------------------------------ the recipes */

const NAMES = [
  'First Cut', 'Crosscut', 'The Gallery', 'Downshaft', 'Deadfall',
  'The Warren', 'Overburden', 'Switchback', 'The Cistern', 'Longwall',
  'The Drift', 'Stope', 'Backfill', 'The Sump', 'Bedrock',
];

/**
 * Each recipe returns { rocks, enemies } and mutates the grid.
 *
 * The progression is deliberate rather than "more of everything": the early layouts hand
 * the player a network so they learn that tunnels are worth having, and the later ones
 * hand them almost nothing so they have to cut their own under pressure.
 */
const RECIPES = [
  // 1 — a generous starting network. Teaching: tunnels are fast, earth is slow.
  (g) => {
    gallery(g, 3, 2, 11);
    shaft(g, 7, 2, 6);
    gallery(g, 6, 4, 10);
    [3, 10].forEach((x) => pocket(g, x, 6));
    return { rocks: [[5, 9], [10, 12]], enemies: [['grub', 3, 6], ['grub', 10, 6]] };
  },
  // 2 — a cross. Two ways out of the middle, which is one more than you need.
  (g) => {
    gallery(g, 4, 1, 12);
    shaft(g, 7, 2, 13);
    [2, 12].forEach((x) => pocket(g, x, 4));
    pocket(g, 7, 12);
    return { rocks: [[4, 7], [10, 7], [7, 15]], enemies: [['grub', 2, 4], ['grub', 12, 4], ['emberjaw', 7, 12]] };
  },
  // 3 — one long gallery and nothing else. The first level that is mostly digging.
  (g) => {
    gallery(g, 5, 1, 12);
    shaft(g, 7, 2, 5);
    [1, 12].forEach((x) => pocket(g, x, 5));
    pocket(g, 6, 11);
    return { rocks: [[3, 8], [9, 8], [6, 13]], enemies: [['grub', 1, 5], ['emberjaw', 12, 5], ['grub', 6, 11]] };
  },
  // 4 — deep shafts, shallow galleries. Vertical thinking.
  (g) => {
    gallery(g, 3, 3, 10);
    [4, 9].forEach((x) => shaft(g, x, 3, 12));
    gallery(g, 12, 4, 9);
    return {
      rocks: [[6, 6], [7, 9], [2, 11]],
      enemies: [['grub', 4, 12], ['grub', 9, 12], ['emberjaw', 6, 3]],
    };
  },
  // 5 — rocks over the only obvious route. The level that teaches you to look up.
  (g) => {
    gallery(g, 4, 2, 11);
    shaft(g, 7, 2, 4);
    gallery(g, 9, 2, 11);
    shaft(g, 2, 4, 9);
    return {
      rocks: [[4, 7], [6, 7], [9, 7], [11, 7]],
      enemies: [['grub', 2, 9], ['grub', 11, 9], ['emberjaw', 6, 9]],
    };
  },
  // 6 — a warren of small chambers.
  (g) => {
    shaft(g, 7, 2, 4);
    chamber(g, 2, 4, 4, 6);
    chamber(g, 9, 4, 11, 6);
    chamber(g, 5, 9, 8, 11);
    gallery(g, 4, 4, 9);
    return {
      rocks: [[6, 7], [3, 12], [10, 12]],
      enemies: [['grub', 3, 5], ['grub', 10, 5], ['emberjaw', 6, 10], ['grub', 7, 10]],
    };
  },
  // 7 — everything is near the surface, and all the value is deep.
  (g) => {
    gallery(g, 3, 1, 12);
    shaft(g, 7, 2, 3);
    [1, 6, 12].forEach((x) => pocket(g, x, 3));
    return {
      rocks: [[3, 8], [7, 10], [11, 8], [5, 14]],
      enemies: [['grub', 1, 3], ['grub', 6, 3], ['emberjaw', 12, 3], ['grub', 9, 14]],
    };
  },
  // 8 — a switchback all the way down.
  //
  // The rocks sit on rows 5, 9 and 13 rather than 6, 10 and 14, because the staircase
  // cuts galleries along 3, 7, 11 and 15 and a rock one row above an open gallery is a
  // rock that falls before the player has moved. The validator caught all three.
  (g) => {
    shaft(g, 7, 2, 3);
    stair(g, 2, 11, 3, 4, 4);
    return {
      rocks: [[5, 5], [8, 9], [4, 13]],
      enemies: [['grub', 2, 7], ['grub', 11, 11], ['emberjaw', 2, 15], ['grub', 11, 3]],
    };
  },
  // 9 — one big room, and no cover in it.
  (g) => {
    shaft(g, 7, 2, 6);
    chamber(g, 3, 6, 10, 10);
    return {
      rocks: [[3, 12], [7, 12], [11, 12], [5, 4], [9, 4]],
      enemies: [['grub', 4, 7], ['grub', 9, 7], ['emberjaw', 6, 9], ['grub', 8, 9]],
    };
  },
  // 10 — a single long gallery at the very bottom. Everything worth having is far away.
  (g) => {
    shaft(g, 7, 2, 3);
    gallery(g, 16, 1, 12);
    shaft(g, 1, 12, 16);
    return {
      rocks: [[4, 6], [10, 6], [7, 9], [3, 13]],
      enemies: [['grub', 2, 16], ['grub', 11, 16], ['emberjaw', 6, 16], ['grub', 9, 16]],
    };
  },
  // 11 — two parallel drifts, no connection. You make the connection.
  (g) => {
    gallery(g, 5, 1, 6);
    gallery(g, 11, 7, 12);
    shaft(g, 7, 2, 5);
    return {
      rocks: [[3, 8], [9, 8], [5, 14], [11, 14]],
      enemies: [['grub', 1, 5], ['emberjaw', 12, 11], ['grub', 8, 11], ['grub', 4, 5]],
    };
  },
  // 12 — rocks in a column over a chamber. Set it up and it pays for the level.
  (g) => {
    shaft(g, 7, 2, 5);
    gallery(g, 5, 3, 11);
    chamber(g, 4, 12, 10, 14);
    return {
      rocks: [[5, 8], [6, 8], [7, 8], [8, 8], [9, 8]],
      enemies: [['grub', 5, 13], ['grub', 9, 13], ['emberjaw', 7, 13], ['grub', 3, 5]],
    };
  },
  // 13 — dragons on the horizontals, so every gallery is a firing line.
  (g) => {
    shaft(g, 7, 2, 4);
    [4, 8, 12].forEach((y) => gallery(g, y, 2, 11));
    shaft(g, 2, 4, 12);
    return {
      rocks: [[5, 6], [9, 10], [6, 14]],
      enemies: [['emberjaw', 11, 4], ['emberjaw', 11, 8], ['emberjaw', 11, 12], ['grub', 2, 12]],
    };
  },
  // 14 — a sump: one way in, one way out, and it is the same way.
  (g) => {
    shaft(g, 7, 2, 9);
    chamber(g, 5, 9, 9, 13);
    return {
      rocks: [[6, 7], [8, 7], [2, 12], [12, 12]],
      enemies: [['grub', 5, 12], ['grub', 9, 12], ['emberjaw', 7, 12], ['grub', 7, 10]],
    };
  },
  // 15 — bedrock. Almost nothing given, everything deep, five rocks and no room.
  (g) => {
    shaft(g, 7, 2, 3);
    return {
      rocks: [[3, 6], [10, 6], [6, 10], [9, 13], [4, 15]],
      enemies: [['grub', 2, 8], ['emberjaw', 11, 8], ['grub', 5, 13], ['emberjaw', 8, 16], ['grub', 12, 15]],
    };
  },
];

/* ------------------------------------------------------------------ build */

function build(i) {
  const g = blank();
  const start = [7, SKY + 1];
  // Every layout gets a landing: the start cell and a way up to the sky.
  cut(g, start[0], start[1]);
  cut(g, start[0], start[1] - 1);

  const { rocks, enemies } = RECIPES[i](g);
  for (const [, x, y] of enemies) pocket(g, x, y);

  return {
    id: `L${String(i + 1).padStart(2, '0')}`,
    name: NAMES[i],
    start,
    rows: g.map((r) => r.join('')),
    rocks,
    enemies: enemies.map(([kind, x, y]) => ({ kind, x, y })),
  };
}

function validate(l) {
  const errs = [];
  const at = (x, y) => (inb(x, y) ? l.rows[y][x] : EARTH);
  const open = (x, y) => at(x, y) === CUT || at(x, y) === SKYCH;

  if (!open(l.start[0], l.start[1])) errs.push('player starts inside earth');
  if (!open(l.start[0], l.start[1] - 1)) errs.push('player has no way to the surface');

  for (const e of l.enemies) {
    if (!open(e.x, e.y)) errs.push(`${e.kind} at ${e.x},${e.y} starts entombed`);
    if (e.y < SKY) errs.push(`${e.kind} at ${e.x},${e.y} starts in the sky`);
  }

  for (const [x, y] of l.rocks) {
    if (open(x, y)) errs.push(`rock at ${x},${y} sits in open air`);
    if (open(x, y + 1)) errs.push(`rock at ${x},${y} is unsupported and falls at once`);
    if (x === l.start[0] && y < l.start[1]) errs.push(`rock at ${x},${y} is directly over the start`);
    if (y < SKY) errs.push(`rock at ${x},${y} is in the sky`);
  }

  if (l.rocks.length < 2) errs.push('fewer than two rocks; the bonus can never appear');
  if (l.enemies.length === 0) errs.push('no enemies');

  return errs;
}

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (/^L\d\d\.json$/.test(f)) unlinkSync(resolve(OUT, f));

let failures = 0;
for (let i = 0; i < RECIPES.length; i++) {
  const l = build(i);
  const errs = validate(l);
  const cutCells = l.rows.join('').split(CUT).length - 1;
  if (errs.length) {
    failures++;
    console.error(`FAIL ${l.id}  ${l.name}`);
    for (const e of errs) console.error(`       ${e}`);
    continue;
  }
  writeFileSync(resolve(OUT, `${l.id}.json`), JSON.stringify(l, null, 2) + '\n');
  console.log(
    `ok   ${l.id}  ${l.name.padEnd(12)} pre-cut=${String(cutCells).padStart(3)}  ` +
      `rocks=${l.rocks.length}  enemies=${l.enemies.length}`,
  );
}

if (failures) {
  console.error(`\n${failures} layout(s) failed validation`);
  process.exit(1);
}
console.log(`\n${RECIPES.length} layouts written to ${OUT}`);
