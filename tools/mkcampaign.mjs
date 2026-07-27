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
import {
  blank, border, box, chamber, corridorCross, coverLattice, deathCorridor, fill,
  finish, foodGauntlet, keyDoorGate, lobberGallery, nest, obj, pillarField,
  relocateStrays, rng, serpentine, set, treasureVault, vline, analyse,
} from './levelkit.mjs';

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
  levels.push(finish(g, { id: `i0${i}`, name: meta.name, theme: 'stone', type: 'intro', start: meta.start }));
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
   * The level-select. Three numbered exits, exactly as the cabinet did it — a returning
   * player skips the tutorial and starts as deep as they think they can handle.
   */
  fill(g, 2, 2, 29, 29, '.');
  for (const [i, x] of [7, 16, 25].entries()) {
    box(g, x - 3, 6, x + 3, 14, 'X');
    fill(g, x - 2, 7, x + 2, 13, '.');
    set(g, x, 14, '.');
    set(g, x, 8, 'E');
    // skipTo is a 1-based campaign depth; intro levels occupy 1..7.
    obj(g, { t: 'exit', x, y: 8, skipTo: [8, 12, 16][i] });
  }
  obj(g, { t: 'food', x: 4, y: 26 });
  obj(g, { t: 'food', x: 28, y: 26 });
  obj(g, { t: 'potion', x: 16, y: 26 });
  return { name: 'Three Doors', start: [16, 28] };
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
  const out = recipe(g, d, r);

  const [ex, ey] = out.exit;
  set(g, ex, ey, 'E');
  obj(g, { t: 'exit', x: ex, y: ey });

  // Every level must feed you something: the drain never stops, so a foodless level
  // is not "hard", it is a level you cannot survive arriving at with low health.
  if (!g.objects.some((o) => o.t === 'food')) {
    obj(g, { t: 'food', x: out.start[0], y: Math.min(29, out.start[1] + 2) });
  }

  // Upgrade potions appear on a schedule, so the run has landmarks.
  if ([3, 9, 14, 20, 26, 33].includes(d)) {
    const kinds = ['shotPower', 'speed', 'magic', 'armor', 'shotSpeed', 'fightPower'];
    obj(g, { t: 'upgrade', x: out.start[0], y: Math.max(2, out.start[1] - 2), kind: kinds[d % kinds.length] });
  }
  // The thief starts turning up once there is something worth stealing — but across the
  // map, not on top of you. Spawned at the start it robs you on frame one, before the
  // player has had a single frame to react, which is not difficulty, it is a coin flip.
  if (d >= 12 && d % 7 === 0) {
    obj(g, { t: 'thief', x: 31 - out.start[0], y: 31 - out.start[1] });
  }

  levels.push(
    finish(g, {
      id: `d${String(d).padStart(2, '0')}`,
      name: NAMES[(d - 1) % NAMES.length],
      theme: THEMES[Math.floor((d - 1) / 7) % THEMES.length],
      start: out.start,
    }),
  );

  // A treasure room every twelve levels: pure greed, on a clock.
  if (d % 12 === 0) {
    const t = blank();
    border(t);
    fill(t, 2, 2, 29, 29, '.');
    for (let y = 4; y <= 27; y++) {
      for (let x = 4; x <= 27; x++) if ((x + y) % 2 === 0) obj(t, { t: 'treasure', x, y });
    }
    set(t, 16, 30, 'E');
    obj(t, { t: 'exit', x: 16, y: 30 });
    levels.push(
      finish(t, {
        id: `t${String(d).padStart(2, '0')}`,
        name: 'Treasure Room',
        theme: 'bone',
        type: 'treasure',
        start: [16, 2],
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
if (failures) {
  console.error(`${failures} level(s) failed validation`);
  process.exit(1);
}
