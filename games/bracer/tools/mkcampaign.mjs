#!/usr/bin/env node
/**
 * Builds the campaign: 7 intro levels, 40 dungeon levels, and treasure rooms.
 *
 * Each level is a short recipe of named patterns from tools/levelkit.mjs, which is the
 * §11 design vocabulary. Being straight about what this is: parameterised hand-design.
 * The patterns and their placement are chosen deliberately per level; the fine grain
 * inside a pattern is generated. That is a long way from noise and a long way from
 * forty individually hand-drawn mazes.
 *
 * The difficulty ramp is checked, not assumed — every level is scored for pressure and
 * the build fails if the curve goes backwards badly or if anything is unreachable.
 */
import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as K from './levelkit.mjs';
import {
  N, ds, dsExtent, analyse, relocateStrays, remotestCell, rng, finish, genFloor, foodFloor,
  maze, rubble, protectedCells, connectPockets,
} from './levelkit.mjs';

/**
 * Design space.
 *
 * Every recipe below is written on a 32x32 grid, because that is a size a person can hold
 * in their head while composing a level. The output grid is larger (see levelkit's N),
 * and these wrappers map one onto the other at the call site.
 *
 * What scales: positions and region extents. What does NOT scale: the grain inside a
 * pattern — lattice step, pillar pitch, corridor width, serpentine gap, wall thickness.
 * So a bigger grid gets MORE lattice, MORE pillars and MORE switchbacks rather than
 * bigger ones. Scaling the grain too would produce a level that is merely zoomed out:
 * identical content spread further apart, which plays worse than the small version.
 *
 * The alternative was re-authoring forty recipes by hand against a new grid, and then
 * again the next time the grid changes. This way the recipes describe intent at a size
 * that is legible, and the mapping is one function that can be tested.
 */

/** Positional keys in a pattern's options object, and how each is mapped. */
const POINT_KEYS = ['x', 'y', 'x0', 'y0', 'x1', 'y1', 'cx', 'cy', 'at'];
const PAIR_KEYS = ['keyAt'];

function scaleOpts(o) {
  const out = { ...o };
  for (const k of POINT_KEYS) if (typeof out[k] === 'number') out[k] = ds(out[k]);
  for (const k of PAIR_KEYS) {
    if (Array.isArray(out[k])) out[k] = [ds(out[k][0]), ds(out[k][1])];
  }
  // Extents are anchored, so a room's far edge lands exactly where that coordinate maps.
  if (typeof o.w === 'number') out.w = dsExtent(o.x, o.w);
  if (typeof o.h === 'number') out.h = dsExtent(o.y, o.h);
  if (o.door && typeof o.door.at === 'number') out.door = { ...o.door, at: ds(o.door.at) };
  return out;
}

// --- primitives, in design space
const set = (g, x, y, ch) => K.set(g, ds(x), ds(y), ch);
const fill = (g, x0, y0, x1, y1, ch) => K.fill(g, ds(x0), ds(y0), ds(x1), ds(y1), ch);
const box = (g, x0, y0, x1, y1, ch) => K.box(g, ds(x0), ds(y0), ds(x1), ds(y1), ch);
const vline = (g, x, y0, y1, ch) => K.vline(g, ds(x), ds(y0), ds(y1), ch);
const obj = (g, o) => K.obj(g, { ...o, x: ds(o.x), y: ds(o.y) });
const border = K.border;
const blank = K.blank;

// --- patterns, in design space
const nest = (g, o) => K.nest(g, { ...scaleOpts(o), count: nestCount(o.count ?? 4) });
const keyDoorGate = (g, o) => K.keyDoorGate(g, { ...scaleOpts(o), count: nestCount(o.count ?? 3) });
const coverLattice = (g, o) => K.coverLattice(g, scaleOpts(o));
const pillarField = (g, o) => K.pillarField(g, scaleOpts(o));
const lobberGallery = (g, o) => K.lobberGallery(g, scaleOpts(o));
const deathCorridor = (g, o) => K.deathCorridor(g, scaleOpts(o));
const foodGauntlet = (g, o) => K.foodGauntlet(g, scaleOpts(o));
const treasureVault = (g, o) => K.treasureVault(g, scaleOpts(o));
const serpentine = (g, o) => K.serpentine(g, scaleOpts(o));
const chamber = (g, o) => K.chamber(g, scaleOpts(o));
const corridorCross = (g, o) => K.corridorCross(g, scaleOpts(o));

/** A design-space point as an output-grid pair, for `start` and `exit` metadata. */
const P = (x, y) => [ds(x), ds(y)];

/**
 * Generator density.
 *
 * The campaign used to average under three generators a level, which is not enough to
 * make generators feel like the enemy — you clear one, and the level is over. Two things
 * caused it: nest() silently capped at six spots however many a recipe asked for, and the
 * recipes' own counts were written for a grid less than half this size.
 *
 * `nestCount` scales what a recipe asks for; `GEN_FLOOR` is the backstop, because some
 * recipes build their pressure out of loose monsters or a death corridor and would
 * otherwise ship a level at depth 35 with no generators at all.
 *
 * Intro levels are exempt from both — they are teaching one idea each, and a tutorial
 * that buries you is a tutorial nobody finishes.
 */
let depthNow = 0; // 0 = intro, no scaling

function nestCount(base) {
  if (!depthNow) return base;
  const ramp = 1.5 + (Math.min(depthNow, 40) / 40) * 1.3;
  return Math.max(base, Math.round(base * ramp));
}

// Density lives in levelkit so the editor's random generator uses the same numbers.
// Two copies of "how much should a level hold" drift, and these units are subtle.

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/levels');
const THEMES = ['stone', 'crypt', 'iron', 'ember', 'moss', 'bone'];

/** Level names. Forty of them, so the run has a sense of place rather than a counter. */
const NAMES = [
  'Threshold', 'The Cistern', 'Bone Yard', 'Vault', 'Crossroads', 'The Larder',
  'Shatterfall', 'Gallery', 'The Warrens', 'Iron Throat', 'Ossuary', 'The Cloister',
  'Deadfall', 'Smoulder', 'The Weir', 'Grindstone', 'Hollow', 'The Sump',
  'Ashwork', 'Mortuary', 'The Spindle', 'Rookery', 'Cold Store', 'The Gantry',
  'Slagpit', 'Reliquary', 'The Chine', 'Kiln', 'Undercroft', 'The Lattice',
  'Blackmarch', 'Furnace', 'The Cage', 'Charnel', 'Deepworks', 'The Scour',
  'Bellows', 'Catacomb', 'The Maw', 'Last Light',
];

const levels = [];
/** Where each hidden upgrade potion ended up, so the report can prove it is hidden. */
const hidden = [];
/** Floor signs for the level-select, written into the level so the game can paint them. */
const DOOR_SIGNS = [];

/** Intro levels occupy campaign depths 1..INTRO_COUNT. */
const INTRO_COUNT = 7;
/** A treasure room follows every TREASURE_EVERY'th dungeon level. */
const TREASURE_EVERY = 12;

/**
 * Is this 1-based campaign depth a treasure room?
 *
 * The k'th vault follows dungeon level k*TREASURE_EVERY, and the k-1 vaults before it
 * have each pushed everything down by one — so it sits at
 * INTRO_COUNT + k*TREASURE_EVERY + k. With the current numbers that is 20, 33, 46.
 *
 * Worth stating once here rather than counting on fingers at each call site: the offset
 * is easy to get wrong by one in either direction, and being wrong is silent.
 */
const isTreasureDepth = (depth) => {
  const after = depth - INTRO_COUNT;
  return after > 0 && after % (TREASURE_EVERY + 1) === 0;
};

/* ================================================================== intro levels */
/**
 * The seven intro levels.
 *
 * Their real job is teaching, one idea each, and then handing over the arcade's
 * level-select: the last one offers numbered exits so a returning player can start as
 * deep as they can handle instead of replaying the tutorial.
 */
function intro(i, build) {
  const g = blank();
  border(g);
  const meta = build(g, i);
  // Signs are level DATA, not renderer knowledge: the level says what is written where,
  // so the editor can show them and a hand-authored level could use them too.
  for (const sgn of DOOR_SIGNS) {
    K.obj(g, { t: 'sign', x: ds(sgn.x), y: ds(sgn.y), text: `LEVEL ${sgn.depth}` });
  }
  DOOR_SIGNS.length = 0;
  // `start` comes back in design space like everything else the recipe wrote.
  levels.push(
    finish(g, {
      id: `i0${i}`,
      name: meta.name,
      theme: 'stone',
      type: 'intro',
      start: P(...meta.start),
    }),
  );
}

intro(1, (g) => {
  // Just walking, and one thing to shoot.
  corridorCross(g, { cx: 15, cy: 15 });
  fill(g, 2, 2, 29, 29, '.');
  box(g, 10, 10, 21, 21, 'X');
  fill(g, 11, 11, 20, 20, '.');
  set(g, 15, 10, '.');
  obj(g, { t: 'mon', x: 15, y: 15, kind: 'grunt', lvl: 1 });
  obj(g, { t: 'food', x: 4, y: 4 });
  set(g, 29, 29, 'E');
  obj(g, { t: 'exit', x: 29, y: 29 });
  return { name: 'First Steps', start: [3, 3] };
});

intro(2, (g) => {
  // A generator: the thing you are actually fighting for the rest of the game.
  fill(g, 2, 2, 29, 29, '.');
  chamber(g, { x: 18, y: 6, w: 10, h: 10, opening: 'w', at: 5 });
  obj(g, { t: 'gen', x: 23, y: 11, kind: 'grunt', lvl: 1 });
  obj(g, { t: 'food', x: 4, y: 25 });
  obj(g, { t: 'food', x: 8, y: 25 });
  set(g, 2, 29, 'E');
  obj(g, { t: 'exit', x: 2, y: 29 });
  return { name: 'The Source', start: [3, 3] };
});

intro(3, (g) => {
  // Keys and doors.
  fill(g, 2, 2, 29, 29, '.');
  vline(g, 16, 1, 30, 'X');
  set(g, 16, 15, 'D');
  set(g, 16, 16, 'D');
  obj(g, { t: 'key', x: 6, y: 16 });
  obj(g, { t: 'gen', x: 24, y: 8, kind: 'grunt', lvl: 1 });
  obj(g, { t: 'food', x: 24, y: 24 });
  set(g, 29, 29, 'E');
  obj(g, { t: 'exit', x: 29, y: 29 });
  return { name: 'Locked', start: [4, 16] };
});

intro(4, (g) => {
  // Ghosts: they do not stop, and they hurt.
  fill(g, 2, 2, 29, 29, '.');
  pillarField(g, { x0: 6, y0: 6, x1: 26, y1: 26, step: 5 });
  obj(g, { t: 'gen', x: 16, y: 16, kind: 'ghost', lvl: 1 });
  obj(g, { t: 'food', x: 3, y: 28 });
  obj(g, { t: 'potion', x: 28, y: 3 });
  set(g, 29, 29, 'E');
  obj(g, { t: 'exit', x: 29, y: 29 });
  return { name: 'The Restless', start: [3, 3] };
});

intro(5, (g) => {
  // Cover: the diagonal lattice, and why your shot size matters.
  fill(g, 2, 2, 29, 29, '.');
  coverLattice(g, { x0: 8, y0: 6, x1: 26, y1: 26 });
  obj(g, { t: 'gen', x: 28, y: 4, kind: 'grunt', lvl: 2 });
  obj(g, { t: 'food', x: 3, y: 16 });
  obj(g, { t: 'potion', x: 3, y: 20 });
  set(g, 29, 29, 'E');
  obj(g, { t: 'exit', x: 29, y: 29 });
  return { name: 'Cover', start: [3, 3] };
});

intro(6, (g) => {
  // Potions, and the first real nest.
  fill(g, 2, 2, 29, 29, '.');
  keyDoorGate(g, {
    x: 16, y: 8, w: 13, h: 13, side: 'w', at: 13,
    keyAt: [5, 26], kinds: ['grunt', 'ghost'], level: 2, count: 4, r: rng(6),
  });
  obj(g, { t: 'potion', x: 5, y: 6 });
  obj(g, { t: 'potion', x: 9, y: 6 });
  foodGauntlet(g, { x0: 3, y: 29, x1: 13, count: 3 });
  set(g, 29, 29, 'E');
  obj(g, { t: 'exit', x: 29, y: 29 });
  return { name: 'The Nest', start: [3, 3] };
});

intro(7, (g) => {
  /**
   * The level-select, and the level a returning player lands on when they skip the
   * tutorial — so it is the last thing between them and the run, and the only place the
   * run's starting depth is chosen.
   *
   * Six doors rather than three, in two rows, reaching depth 38 of 43 dungeon levels. The
   * back half of the campaign was unreachable without playing through to it, which made
   * the deep levels effectively unplayable for anyone who wanted to practise them.
   *
   * Each door's destination is written on the floor in front of it (see DOOR_SIGNS): an
   * unlabelled door asks you to gamble on a number you cannot see, which is not a choice,
   * it is a shrug.
   *
   * The spacing is every six levels, EXCEPT that no door may open into a treasure room.
   * Evenly spaced, the third door landed on depth 20 — which is exactly where the first
   * treasure room sits, so the best opening move was to take door three and farm a room
   * full of free gold with no monsters in it before the run had properly started. That
   * made the choice between six doors a non-choice, and handed out a reward that is
   * supposed to be the thing you reach by surviving twelve levels.
   *
   * Skipping ahead should skip the reward too, so a colliding door steps PAST the vault
   * rather than short of it. Derived from the cadence rather than hardcoded around the
   * one collision, because the next person to change either number should not have to
   * rediscover this.
   */
  fill(g, 2, 2, 29, 29, '.');
  DOOR_SIGNS.length = 0;
  const depths = [8, 14, 20, 26, 32, 38].map((d) => (isTreasureDepth(d) ? d + 1 : d));
  const cols = [7, 16, 25];
  depths.forEach((depth, i) => {
    const x = cols[i % 3];
    const top = i < 3 ? 4 : 15;
    box(g, x - 3, top, x + 3, top + 7, 'X');
    fill(g, x - 2, top + 1, x + 2, top + 6, '.');
    set(g, x, top + 7, '.'); // way in, from below
    set(g, x, top + 2, 'E');
    // skipTo is a 1-based campaign depth; intro levels occupy 1..7.
    obj(g, { t: 'exit', x, y: top + 2, skipTo: depth });
    // Inside the vestibule, between the way in (bottom) and the exit tile (top), so you
    // walk over the label on the approach and read it BEFORE stepping on the exit.
    //
    // Not outside the room, which is where this sat first: the rooms are two rows deep,
    // and a sign below row one lands nearer row two's door than its own. The test caught
    // that by asserting each sign is nearest the door it names, which is the property
    // that matters — an absolute distance would just have been a number that happened to
    // pass.
    DOOR_SIGNS.push({ x, y: top + 5, depth });
  });

  obj(g, { t: 'food', x: 4, y: 27 });
  obj(g, { t: 'food', x: 28, y: 27 });
  obj(g, { t: 'potion', x: 16, y: 27 });
  return { name: 'Six Doors', start: [16, 29] };
});

/* ================================================================== dungeons */

/**
 * The forty. Each is a recipe; `d` is 1..40 and drives the ramp.
 *
 * Recipes are chosen so consecutive levels do not repeat a shape, and so each of the
 * §11 patterns recurs often enough to become familiar without becoming the only idea.
 */
const RECIPES = [
  // --- 1-8: single ideas, room to breathe
  (g, d, r) => {
    fill(g, 2, 2, 29, 29, '.');
    nest(g, { x: 17, y: 5, w: 11, h: 11, kinds: ['grunt'], level: lvl(d), count: 3, r });
    foodGauntlet(g, { x0: 3, y: 27, x1: 15, count: 3 });
    obj(g, { t: 'key', x: 4, y: 4 });
    return { start: [3, 16], exit: [29, 29] };
  },
  (g, d, r) => {
    fill(g, 2, 2, 29, 29, '.');
    serpentine(g, { x0: 3, y0: 5, x1: 26, y1: 25, gap: 4 });
    nest(g, { x: 20, y: 26, w: 8, h: 4, kinds: ['ghost'], level: lvl(d), count: 2, r });
    obj(g, { t: 'food', x: 5, y: 3 });
    obj(g, { t: 'potion', x: 28, y: 3 });
    return { start: [3, 3], exit: [3, 29] };
  },
  (g, d, r) => {
    fill(g, 2, 2, 29, 29, '.');
    coverLattice(g, { x0: 4, y0: 4, x1: 20, y1: 27 });
    nest(g, { x: 23, y: 10, w: 7, h: 12, kinds: ['grunt', 'demon'], level: lvl(d), count: 3, r });
    obj(g, { t: 'food', x: 3, y: 29 });
    return { start: [3, 3], exit: [29, 3] };
  },
  (g, d, r) => {
    fill(g, 2, 2, 29, 29, '.');
    keyDoorGate(g, {
      x: 6, y: 6, w: 20, h: 18, side: 'n', at: 10, keyAt: [3, 29],
      kinds: ['grunt', 'ghost'], level: lvl(d), count: 4, r,
    });
    foodGauntlet(g, { x0: 10, y: 15, x1: 22, count: 3 });
    return { start: [3, 3], exit: [29, 29] };
  },
  (g, d, r) => {
    fill(g, 2, 2, 29, 29, '.');
    corridorCross(g, { cx: 15, cy: 15 });
    for (const [qx, qy] of [[3, 3], [19, 3], [3, 19], [19, 19]]) {
      box(g, qx, qy, qx + 9, qy + 9, 'X');
      fill(g, qx + 1, qy + 1, qx + 8, qy + 8, '.');
      set(g, qx + 5, qy + 9, '.');
    }
    nest(g, { x: 19, y: 19, w: 9, h: 9, kinds: ['ghost'], level: lvl(d), count: 3, r });
    obj(g, { t: 'potion', x: 8, y: 8 });
    obj(g, { t: 'food', x: 24, y: 8 });
    return { start: [15, 29], exit: [8, 24] };
  },
  (g, d, r) => {
    fill(g, 2, 2, 29, 29, '.');
    lobberGallery(g, { x0: 4, y0: 3, x1: 27, y1: 6, level: lvl(d), count: 3 });
    nest(g, { x: 10, y: 18, w: 12, h: 10, kinds: ['grunt'], level: lvl(d), count: 3, r });
    obj(g, { t: 'food', x: 3, y: 16 });
    obj(g, { t: 'food', x: 28, y: 16 });
    return { start: [16, 12], exit: [29, 29] };
  },
  (g, d, r) => {
    fill(g, 2, 2, 29, 29, '.');
    pillarField(g, { x0: 4, y0: 4, x1: 27, y1: 27, step: 4 });
    nest(g, { x: 12, y: 12, w: 8, h: 8, kinds: ['sorcerer'], level: lvl(d), count: 2, r });
    obj(g, { t: 'potion', x: 3, y: 3 });
    foodGauntlet(g, { x0: 4, y: 29, x1: 27, count: 4 });
    return { start: [3, 29], exit: [29, 3] };
  },
  (g, d, r) => {
    fill(g, 2, 2, 29, 29, '.');
    treasureVault(g, { x: 11, y: 11, w: 10, h: 10, sealed: true, opensFrom: [4, 27] });
    nest(g, { x: 22, y: 4, w: 7, h: 7, kinds: ['grunt', 'demon'], level: lvl(d), count: 2, r });
    obj(g, { t: 'upgrade', x: 16, y: 16, kind: 'speed' });
    obj(g, { t: 'food', x: 28, y: 28 });
    return { start: [3, 3], exit: [29, 16] };
  },
  // --- 9-16: two ideas at once
  (g, d, r) => {
    fill(g, 2, 2, 29, 29, '.');
    coverLattice(g, { x0: 3, y0: 3, x1: 14, y1: 28 });
    keyDoorGate(g, {
      x: 17, y: 6, w: 12, h: 18, side: 'w', at: 14, keyAt: [4, 16],
      kinds: ['ghost', 'grunt'], level: lvl(d), count: 4, r,
    });
    obj(g, { t: 'potion', x: 8, y: 29 });
    return { start: [3, 29], exit: [29, 29] };
  },
  (g, d, r) => {
    fill(g, 2, 2, 29, 29, '.');
    deathCorridor(g, { x0: 12, y0: 14, x1: 26, y1: 17, count: 1 });
    box(g, 11, 13, 27, 18, 'X');
    fill(g, 12, 14, 26, 17, '.');
    set(g, 11, 15, '.');
    set(g, 27, 16, '.');
    nest(g, { x: 4, y: 4, w: 10, h: 8, kinds: ['grunt'], level: lvl(d), count: 3, r });
    obj(g, { t: 'potion', x: 4, y: 20 });
    obj(g, { t: 'potion', x: 7, y: 20 });
    obj(g, { t: 'food', x: 29, y: 29 });
    return { start: [3, 16], exit: [29, 3] };
  },
  (g, d, r) => {
    fill(g, 2, 2, 29, 29, '.');
    serpentine(g, { x0: 4, y0: 4, x1: 27, y1: 24, gap: 3 });
    lobberGallery(g, { x0: 5, y0: 26, x1: 26, y1: 28, level: lvl(d), count: 4 });
    obj(g, { t: 'food', x: 3, y: 3 });
    return { start: [3, 3], exit: [29, 25] };
  },
  (g, d, r) => {
    fill(g, 2, 2, 29, 29, '.');
    nest(g, { x: 3, y: 3, w: 11, h: 11, kinds: ['ghost'], level: lvl(d), count: 3, r });
    nest(g, { x: 18, y: 18, w: 11, h: 11, kinds: ['demon'], level: lvl(d), count: 3, r });
    coverLattice(g, { x0: 16, y0: 4, x1: 28, y1: 14 });
    obj(g, { t: 'potion', x: 16, y: 16 });
    obj(g, { t: 'food', x: 4, y: 20 });
    return { start: [16, 30], exit: [29, 3] };
  },
];

function lvl(d) {
  return d < 10 ? 1 : d < 22 ? 2 : 3;
}

for (let d = 1; d <= 40; d++) {
  const g = blank();
  border(g);
  const r = rng(1000 + d * 37);
  const recipe = RECIPES[(d - 1) % RECIPES.length];
  depthNow = d;
  const out = recipe(g, d, r);
  depthNow = 0;

  /**
   * Fill the empty space between the recipe's features.
   *
   * The vocabulary describes FEATURES; nothing described what lay between them, and the
   * answer had quietly been "nothing". Measured before this: 16% wall coverage of which
   * 8.2% was the outer border, so internal walls were about one tile in twelve. You could
   * cross most levels in a straight line without turning, where the original is a warren.
   *
   * Runs AFTER the recipe, not before — a recipe opens with fill('.') across the whole
   * interior and would erase a maze drawn first. It only ever builds on open ground, and
   * `protectedCells` keeps it off everything the recipe placed and out of every doorway
   * the recipe carved.
   */
  const structure = rng(9000 + d * 13);
  const keepClear = protectedCells(g, [P(...out.start), P(...out.exit)]);
  maze(g, {
    x0: 2, y0: 2, x1: N - 3, y1: N - 3,
    min: 2 + (d % 2), // alternates 2/3 so consecutive levels do not share a rhythm
    gaps: 2,
    r: structure,
    avoid: keepClear,
  });
  rubble(g, { x0: 3, y0: 3, x1: N - 4, y1: N - 4, count: 55 + (d % 20), r: structure, avoid: keepClear });
  // Rubble can seal an alcove. Repair rather than lowering the density — the density is
  // the point, and the build gate below is not a substitute for producing valid output.
  connectPockets(g, P(...out.start));

  // From here down we work in OUTPUT-grid coordinates, because everything below either
  // reads the finished tile grid (remotestCell) or lands in the level JSON. Mixing the
  // two spaces silently double-scales, so the switch happens once and is named.
  const start = P(...out.start);
  const exit = P(...out.exit);

  K.set(g, exit[0], exit[1], 'E');
  K.obj(g, { t: 'exit', x: exit[0], y: exit[1] });

  // --- generator density floor.
  //
  // Recipes express intent, not quotas, and some build their pressure out of loose
  // monsters or a death corridor — which used to mean a level at depth 35 shipping with
  // no generators at all. The floor tops the level up with standalone generators placed
  // far from the start and well apart from each other, so the extras open a second front
  // rather than thickening the fight the recipe already designed.
  const cells = analyse({ tiles: g.tiles.map((row) => row.join('')), start, objects: g.objects })
    .reachable.size;
  const have = g.objects.filter((o) => o.t === 'gen');
  const short = genFloor(d, cells) - have.length;
  if (short > 0) {
    const kinds = ['grunt', 'ghost', 'demon', 'sorcerer', 'lobber'];
    const spots = K.spreadCells(
      g,
      start,
      short,
      8,
      g.objects.filter((o) => o.t === 'gen' || o.t === 'exit').map((o) => [o.x, o.y]),
    );
    for (const [gx, gy] of spots) {
      K.obj(g, {
        t: 'gen',
        x: gx,
        y: gy,
        kind: kinds[Math.floor(r() * Math.min(kinds.length, 2 + Math.floor(d / 8)))],
        lvl: lvl(d),
      });
    }
  }

  // Every level must feed you something: the drain never stops, so a foodless level
  // is not "hard", it is a level you cannot survive arriving at with low health.
  // More generators means more incoming, so this scales with the pressure too.
  const foodShort = foodFloor(cells) - g.objects.filter((o) => o.t === 'food').length;
  if (foodShort > 0) {
    const spots = K.spreadCells(
      g,
      start,
      foodShort,
      7,
      g.objects.filter((o) => o.t !== 'treasure').map((o) => [o.x, o.y]),
    );
    for (const [fx, fy] of spots) K.obj(g, { t: 'food', x: fx, y: fy });
    if (!g.objects.some((o) => o.t === 'food')) {
      K.obj(g, { t: 'food', x: start[0], y: Math.min(N - 2, start[1] + 2) });
    }
  }

  // Upgrade potions appear on a schedule, so the run has landmarks.
  //
  // Placed at the cell FURTHEST from the start by step count, not two tiles above it as
  // they were — the announcer saying "a potion lies hidden here" about something already
  // in shot on the first frame is funny exactly once. Furthest-by-steps also beats
  // furthest-in-a-straight-line, which happily picks a spot on the other side of a wall
  // you walk past immediately.
  if ([3, 9, 14, 20, 26, 33].includes(d)) {
    const kinds = ['shotPower', 'speed', 'magic', 'armor', 'shotSpeed', 'fightPower'];
    const { cell, steps } = remotestCell(g, start, [exit]);
    K.obj(g, { t: 'upgrade', x: cell[0], y: cell[1], kind: kinds[d % kinds.length] });
    hidden.push({ id: `d${String(d).padStart(2, '0')}`, steps });
  }
  // The thief starts turning up once there is something worth stealing — but across the
  // map, not on top of you. Spawned at the start it robs you on frame one, before the
  // player has had a single frame to react, which is not difficulty, it is a coin flip.
  if (d >= 12 && d % 7 === 0) {
    K.obj(g, { t: 'thief', x: N - 1 - start[0], y: N - 1 - start[1] });
  }

  levels.push(
    finish(g, {
      id: `d${String(d).padStart(2, '0')}`,
      name: NAMES[(d - 1) % NAMES.length],
      theme: THEMES[Math.floor((d - 1) / 7) % THEMES.length],
      start,
    }),
  );

  // A treasure room every twelve levels: pure greed, on a clock.
  if (d % TREASURE_EVERY === 0) {
    // Written straight in grid space, not design space: the field is a checkerboard, and
    // a checkerboard is grain. Mapping it cell by cell would space the treasure out to
    // fit the bigger room and leave the count unchanged — a bigger room with the same
    // haul, which is the opposite of what a treasure room is for.
    const t = blank();
    border(t);
    K.fill(t, 2, 2, N - 3, N - 3, '.');
    for (let y = 4; y <= N - 5; y++) {
      for (let x = 4; x <= N - 5; x++) if ((x + y) % 2 === 0) K.obj(t, { t: 'treasure', x, y });
    }
    const mid = Math.round(N / 2);
    K.set(t, mid, N - 2, 'E');
    K.obj(t, { t: 'exit', x: mid, y: N - 2 });
    levels.push(
      finish(t, {
        id: `t${String(d).padStart(2, '0')}`,
        name: 'Treasure Room',
        theme: 'bone',
        type: 'treasure',
        start: [mid, 2],
      }),
    );
  }
}

/* ================================================================== write */

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) {
  if (/^(i0\d|d\d\d|t\d\d)\.json$/.test(f)) unlinkSync(resolve(OUT, f));
}

let failures = 0;
const report = [];

let totalMoved = 0;
for (const lv of levels) {
  // Relocate anything a pattern buried, then validate what actually shipped.
  const gg = { tiles: lv.tiles.map((r) => r.split('')), objects: lv.objects };
  const moved = relocateStrays(gg, analyse(lv).reachable);
  totalMoved += moved.length;
  const far = moved.filter((m) => m.dist > 3);
  const a = analyse(lv);
  const problems = [];
  if (!a.exitOk) problems.push('EXIT-UNREACHABLE');
  if (a.startSolid) problems.push('START-IN-WALL');
  if (a.stranded.length) problems.push(`stranded=${a.stranded.map((o) => `${o.t}@${o.x},${o.y}`).join(' ')}`);
  if (a.deadTraps.length) problems.push(`dead-traps=${a.deadTraps.length}`);
  if (lv.type === 'normal' && a.food === 0) problems.push('NO-FOOD');
  if (far.length) problems.push(`far-relocations=${far.length}`);

  if (problems.length) failures++;
  report.push(
    `${problems.length ? 'FAIL' : 'ok  '} ${lv.id.padEnd(5)} ${lv.name.padEnd(14)} ` +
      `cells=${String(a.reachable.size).padStart(4)} gens=${String(a.generators).padStart(2)} ` +
      `food=${a.food} pressure=${String(a.pressure).padStart(5)}` +
      (problems.length ? '  ' + problems.join(' ') : ''),
  );

  writeFileSync(resolve(OUT, `${lv.id}.json`), JSON.stringify(lv, null, 2) + '\n');
}

console.log(report.join('\n'));
console.log(`\n${levels.length} levels written to ${OUT}  (${totalMoved} objects nudged off walls)`);
if (hidden.length) {
  const worst = hidden.reduce((a, b) => (a.steps <= b.steps ? a : b));
  console.log(
    `hidden upgrades: ${hidden.map((h) => `${h.id}=${h.steps}`).join(' ')}  ` +
      `(nearest is ${worst.id} at ${worst.steps} steps from the start)`,
  );
}
if (failures) {
  console.error(`${failures} level(s) failed validation`);
  process.exit(1);
}
