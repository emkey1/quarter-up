#!/usr/bin/env node
/**
 * Generates the M2 development campaign: src/data/levels/d0*.json
 *
 * These are *development* levels, not shipped content — M5 brings the editor and the
 * real 40. Their job is to exercise every M2 system end to end, and each one is built
 * from the design vocabulary in DESIGN.md §11 so the shapes are the right ones:
 *
 *   d01 Threshold    key/door flood control, first generator, food
 *   d02 The Cistern  generator nest behind a door + cover lattice
 *   d03 Bone Yard    ghost generators and a food gauntlet
 *   d04 Vault        treasure vault, trap tile opening the route to the exit
 *   d05 Crossroads   teleporters, breakable walls, mixed nest, upgrade potion
 *
 * Every level is validated for reachability before being written: if the exit cannot
 * be walked to, the build fails rather than shipping a level nobody can finish.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const N = 32;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/levels');

function grid(fill = '.') {
  return Array.from({ length: N }, () => Array(N).fill(fill));
}

function api(g) {
  const set = (x, y, ch) => {
    if (x >= 0 && y >= 0 && x < N && y < N) g[y][x] = ch;
  };
  const hline = (x0, x1, y, ch) => {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) set(x, y, ch);
  };
  const vline = (x, y0, y1, ch) => {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) set(x, y, ch);
  };
  const box = (x0, y0, x1, y1, ch) => {
    hline(x0, x1, y0, ch);
    hline(x0, x1, y1, ch);
    vline(x0, y0, y1, ch);
    vline(x1, y0, y1, ch);
  };
  const fill = (x0, y0, x1, y1, ch) => {
    for (let y = y0; y <= y1; y++) hline(x0, x1, y, ch);
  };
  /** Diagonally adjacent block pairs: shootable-through cover for small/medium shots. */
  const lattice = (x0, y0, x1, y1, step = 3) => {
    for (let y = y0; y <= y1 - 1; y += step) {
      for (let x = x0; x <= x1 - 1; x += step) {
        set(x, y, 'X');
        set(x + 1, y + 1, 'X');
      }
    }
  };
  return { set, hline, vline, box, fill, lattice };
}

/**
 * Flood fill from start over walkable cells.
 *
 * Doors count as passable because they auto-open on the stalemate timer even without a
 * key, and breakable walls count as passable because every class can shoot them down.
 * Neither can permanently strand the player, so treating them as solid here would
 * report false failures on levels that are deliberately opened by force.
 */
function reachable(g, start) {
  const solid = new Set(['X', ' ']);
  const seen = new Set([start.join(',')]);
  const q = [start];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      const k = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N || seen.has(k)) continue;
      if (solid.has(g[ny][nx])) continue;
      seen.add(k);
      q.push([nx, ny]);
    }
  }
  return seen;
}

const levels = [];

/* ---------------------------------------------------------------- d01 Threshold */
{
  const g = grid();
  const { box, hline, vline, set, fill } = api(g);
  box(0, 0, N - 1, N - 1, 'X');
  // a spine wall splitting the level, with one door as the only easy way through
  vline(16, 1, 30, 'X');
  set(16, 15, 'D');
  set(16, 16, 'D');
  // small rooms west
  box(3, 3, 12, 11, 'X');
  hline(7, 9, 11, '.');
  box(3, 19, 12, 28, 'X');
  hline(7, 9, 19, '.');
  // east approach
  fill(20, 6, 28, 8, '.');

  levels.push({
    id: 'd01',
    name: 'Threshold',
    theme: 'stone',
    type: 'normal',
    start: [8, 15],
    tiles: g.map((r) => r.join('')),
    objects: [
      { t: 'key', x: 8, y: 7 },
      { t: 'food', x: 5, y: 24 },
      { t: 'food', x: 10, y: 24 },
      { t: 'potion', x: 8, y: 23 },
      { t: 'treasure', x: 6, y: 6 },
      { t: 'treasure', x: 10, y: 6 },
      { t: 'gen', x: 24, y: 12, kind: 'grunt', lvl: 1 },
      { t: 'mon', x: 20, y: 15, kind: 'grunt', lvl: 1 },
      { t: 'food', x: 26, y: 25 },
      { t: 'exit', x: 29, y: 29, skipTo: null },
    ],
  });
  set(29, 29, 'E');
  levels[0].tiles = g.map((r) => r.join(''));
}

/* ---------------------------------------------------------------- d02 The Cistern */
{
  const g = grid();
  const { box, hline, set, lattice, fill } = api(g);
  box(0, 0, N - 1, N - 1, 'X');
  // nest room, sealed but for a two-tile door
  box(17, 5, 29, 17, 'X');
  set(17, 10, 'D');
  set(17, 11, 'D');
  fill(18, 6, 28, 16, '.');
  // cover lattice on the approach, so a small shot can work the nest from outside
  lattice(6, 6, 14, 16);
  // south corridor to the exit
  hline(2, 29, 24, '.');
  box(20, 26, 28, 30, 'X');
  hline(23, 25, 26, '.');
  set(24, 29, 'E');

  levels.push({
    id: 'd02',
    name: 'The Cistern',
    theme: 'stone',
    type: 'normal',
    start: [3, 20],
    tiles: g.map((r) => r.join('')),
    objects: [
      { t: 'key', x: 4, y: 24 },
      { t: 'gen', x: 21, y: 9, kind: 'grunt', lvl: 2 },
      { t: 'gen', x: 26, y: 9, kind: 'ghost', lvl: 1 },
      { t: 'gen', x: 21, y: 14, kind: 'ghost', lvl: 2 },
      { t: 'gen', x: 26, y: 14, kind: 'grunt', lvl: 2 },
      { t: 'treasure', x: 23, y: 11 },
      { t: 'treasure', x: 24, y: 11 },
      { t: 'food', x: 2, y: 2 },
      { t: 'food', x: 12, y: 24 },
      { t: 'potion', x: 8, y: 24 },
      { t: 'potion', x: 16, y: 24 },
      { t: 'exit', x: 24, y: 29, skipTo: null },
    ],
  });
}

/* ---------------------------------------------------------------- d03 Bone Yard */
{
  const g = grid();
  const { box, hline, vline, set, fill } = api(g);
  box(0, 0, N - 1, N - 1, 'X');
  // three parallel galleries; ghosts pour down them
  for (const x of [8, 16, 24]) vline(x, 4, 27, 'X');
  hline(1, 30, 14, '.');
  for (const x of [8, 16, 24]) set(x, 14, '.');
  // food gauntlet along the bottom, deliberately behind the ghost flow
  fill(2, 28, 29, 29, '.');
  set(30, 2, 'E');

  levels.push({
    id: 'd03',
    name: 'Bone Yard',
    theme: 'stone',
    type: 'normal',
    start: [3, 3],
    tiles: g.map((r) => r.join('')),
    objects: [
      { t: 'gen', x: 4, y: 20, kind: 'ghost', lvl: 2 },
      { t: 'gen', x: 12, y: 20, kind: 'ghost', lvl: 2 },
      { t: 'gen', x: 20, y: 20, kind: 'ghost', lvl: 3 },
      { t: 'gen', x: 28, y: 20, kind: 'ghost', lvl: 1 },
      { t: 'food', x: 4, y: 29, breakable: true },
      { t: 'food', x: 12, y: 29 },
      { t: 'food', x: 20, y: 29, breakable: true },
      { t: 'food', x: 28, y: 29 },
      { t: 'potion', x: 16, y: 29 },
      { t: 'treasure', x: 2, y: 28 },
      { t: 'key', x: 29, y: 28 },
      { t: 'exit', x: 30, y: 2, skipTo: null },
    ],
  });
}

/* ---------------------------------------------------------------- d04 Vault */
{
  const g = grid();
  const { box, fill, set, hline } = api(g);
  box(0, 0, N - 1, N - 1, 'X');
  // sealed vault, no door at all: the trap tile is the only way in
  box(11, 11, 20, 20, 'X');
  fill(12, 12, 19, 19, '.');
  // ring corridor
  hline(1, 30, 4, '.');
  hline(1, 30, 27, '.');
  // trap sits out in the open, well away from the vault it opens.
  // MUST come after the corridors: drawing it first let hline erase it, which sealed
  // the vault permanently and stranded the upgrade inside.
  set(4, 27, '^');
  set(30, 30, 'E');

  const treasure = [];
  for (let y = 13; y <= 18; y += 1) {
    for (let x = 13; x <= 18; x += 1) {
      if ((x + y) % 2 === 0) treasure.push({ t: 'treasure', x, y });
    }
  }

  levels.push({
    id: 'd04',
    name: 'Vault',
    theme: 'stone',
    type: 'normal',
    start: [2, 2],
    tiles: g.map((r) => r.join('')),
    objects: [
      // stepping the trap punches a hole in the vault wall
      { t: 'trap', x: 4, y: 27, opens: [[15, 20], [16, 20]] },
      ...treasure,
      { t: 'gen', x: 26, y: 15, kind: 'grunt', lvl: 2 },
      { t: 'gen', x: 5, y: 15, kind: 'grunt', lvl: 2 },
      { t: 'food', x: 28, y: 4 },
      { t: 'food', x: 2, y: 27 },
      { t: 'potion', x: 28, y: 27 },
      { t: 'upgrade', x: 16, y: 16, kind: 'speed' },
      { t: 'exit', x: 30, y: 30, skipTo: null },
    ],
  });
}

/* ---------------------------------------------------------------- d05 Crossroads */
{
  const g = grid();
  const { box, hline, vline, set, lattice } = api(g);
  box(0, 0, N - 1, N - 1, 'X');
  hline(1, 30, 16, '.');
  vline(16, 1, 30, '.');
  // quadrant walls with breakable sections, so shots open shortcuts
  box(3, 3, 13, 13, 'X');
  set(8, 3, 'x');
  set(8, 13, 'x');
  box(18, 3, 28, 13, 'X');
  set(23, 3, 'x');
  lattice(19, 19, 28, 28);
  // a door gates the exit, so the keys lying around have a purpose
  vline(29, 12, 20, 'X');
  set(29, 16, 'D');
  set(29, 17, 'D');
  // teleporter pair across the map
  set(2, 30, '@');
  set(29, 2, '@');
  set(30, 16, 'E');

  levels.push({
    id: 'd05',
    name: 'Crossroads',
    theme: 'stone',
    type: 'normal',
    start: [16, 30],
    tiles: g.map((r) => r.join('')),
    objects: [
      { t: 'tele', x: 2, y: 30 },
      { t: 'tele', x: 29, y: 2 },
      { t: 'gen', x: 8, y: 8, kind: 'ghost', lvl: 2 },
      { t: 'gen', x: 23, y: 8, kind: 'grunt', lvl: 3 },
      { t: 'gen', x: 24, y: 24, kind: 'grunt', lvl: 2 },
      { t: 'key', x: 16, y: 20 },
      { t: 'key', x: 12, y: 16 },
      { t: 'potion', x: 20, y: 16 },
      { t: 'potion', x: 16, y: 8 },
      { t: 'food', x: 8, y: 8 },
      { t: 'food', x: 23, y: 8 },
      { t: 'food', x: 4, y: 20 },
      { t: 'treasure', x: 24, y: 20 },
      { t: 'upgrade', x: 4, y: 4, kind: 'shotPower' },
      { t: 'exit', x: 30, y: 16, skipTo: null },
    ],
  });
}

/* ---------------------------------------------------------------- write + validate */
mkdirSync(OUT, { recursive: true });
let failures = 0;

for (const lv of levels) {
  const g = lv.tiles.map((r) => r.split(''));

  // Trap-aware reachability: flood, fire any trap we can now stand on, flood again,
  // until nothing new opens. A sealed vault is only legitimate if a REACHABLE trap
  // opens it — an earlier hand-written "sealed by design" exemption here masked a real
  // bug where a corridor had erased the trap tile and stranded the vault's contents.
  let seen = reachable(g, lv.start);
  const fired = new Set();
  for (;;) {
    let changed = false;
    for (const o of lv.objects) {
      if (o.t !== 'trap' || fired.has(o) || !seen.has(`${o.x},${o.y}`)) continue;
      if (g[o.y][o.x] !== '^') {
        console.log(`     note: trap@${o.x},${o.y} is not a '^' tile (overwritten?)`);
        continue;
      }
      fired.add(o);
      for (const [ox, oy] of o.opens ?? []) g[oy][ox] = '.';
      changed = true;
    }
    if (!changed) break;
    seen = reachable(g, lv.start);
  }

  const exits = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (g[y][x] === 'E') exits.push([x, y]);

  const exitOk = exits.some(([x, y]) => seen.has(`${x},${y}`));
  const startSolid = ['X', ' '].includes(g[lv.start[1]][lv.start[0]]);

  // Everything placed must be reachable, with no exemptions.
  const mustBeOpen = new Set(['food', 'key', 'potion', 'treasure', 'upgrade', 'gen', 'mon']);
  const stranded = lv.objects.filter((o) => mustBeOpen.has(o.t) && !seen.has(`${o.x},${o.y}`));

  // A trap that is itself unreachable, or whose tile got overwritten, is dead content.
  const deadTraps = lv.objects.filter((o) => o.t === 'trap' && !fired.has(o));

  const ok = exitOk && !startSolid && stranded.length === 0 && deadTraps.length === 0;
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${lv.id} ${lv.name.padEnd(12)} cells=${String(seen.size).padStart(4)} exit=${exitOk} traps=${fired.size}` +
      (startSolid ? ' START-IN-WALL' : '') +
      (stranded.length ? ` stranded=${stranded.map((o) => `${o.t}@${o.x},${o.y}`).join(' ')}` : '') +
      (deadTraps.length ? ` DEAD-TRAPS=${deadTraps.map((o) => `${o.x},${o.y}`).join(' ')}` : ''),
  );

  writeFileSync(resolve(OUT, `${lv.id}.json`), JSON.stringify(lv, null, 2) + '\n');
}

if (failures) {
  console.error(`\n${failures} level(s) failed validation`);
  process.exit(1);
}
console.log(`\nwrote ${levels.length} levels to ${OUT}`);
