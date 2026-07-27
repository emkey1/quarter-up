#!/usr/bin/env node
/**
 * Generates src/data/levels/proving.json — the M0 development level.
 *
 * This is a *proving ground*, not shipped content: each quadrant isolates one thing
 * that needs to be verifiable by eye.
 *
 *   NW  serpentine corridors ......... corner assist, wall slide
 *   NE  diagonal block pairs ......... the seam-shot rule (M1), monster impassability
 *   SW  pillar field ................. open-field cornering, camera feel
 *   SE  sealed room .................. door + breakable wall + exit
 *   cross corridors .................. long straight runs for speed measurement
 *
 * Real content comes from the level editor at M5.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const N = 32;
const g = Array.from({ length: N }, () => Array(N).fill('.'));

const set = (x, y, ch) => {
  if (x >= 0 && y >= 0 && x < N && y < N) g[y][x] = ch;
};
const hline = (x0, x1, y, ch) => {
  for (let x = x0; x <= x1; x++) set(x, y, ch);
};
const vline = (x, y0, y1, ch) => {
  for (let y = y0; y <= y1; y++) set(x, y, ch);
};
const box = (x0, y0, x1, y1, ch) => {
  hline(x0, x1, y0, ch);
  hline(x0, x1, y1, ch);
  vline(x0, y0, y1, ch);
  vline(x1, y0, y1, ch);
};

// --- border
box(0, 0, N - 1, N - 1, 'X');

// --- NW: serpentine corridors (corner assist)
for (let r = 3, i = 0; r <= 13; r += 2, i++) {
  hline(2, 13, r, 'X');
  // alternate which end is open, forcing a full switchback run
  if (i % 2 === 0) set(13, r, '.');
  else set(2, r, '.');
}

// --- NE: diagonally adjacent block pairs (seam-shot proving ground)
for (let cy = 2; cy <= 12; cy += 3) {
  for (let cx = 18; cx <= 28; cx += 3) {
    set(cx, cy, 'X');
    set(cx + 1, cy + 1, 'X');
  }
}

// --- SW: pillar field
for (let cy = 18; cy <= 29; cy += 3) {
  for (let cx = 2; cx <= 13; cx += 3) {
    set(cx, cy, 'X');
  }
}

// --- SE: sealed room with a door, a breakable wall, and the exit
box(18, 18, 29, 29, 'X');
set(18, 23, 'D');
set(18, 24, 'D');
set(23, 18, 'x');
set(24, 18, 'x');
set(28, 28, 'E');

// --- cross corridors, punched last so they connect every quadrant
for (let y = 1; y <= N - 2; y++) {
  set(15, y, '.');
  set(16, y, '.');
}
for (let x = 1; x <= N - 2; x++) {
  set(x, 15, '.');
  set(x, 16, '.');
}

// --- a teleporter pair and a trap tile, so their rendering is exercised
set(15, 2, '@');
set(16, 29, '@');
set(16, 15, '^');

const level = {
  id: 'proving',
  name: 'Proving Ground',
  theme: 'stone',
  type: 'normal',
  start: [15, 20],
  tiles: g.map((row) => row.join('')),
  objects: [
    { t: 'trap', x: 16, y: 15, opens: [[23, 18], [24, 18]] },
    { t: 'tele', x: 15, y: 2 },
    { t: 'tele', x: 16, y: 29 },
    { t: 'exit', x: 28, y: 28, skipTo: null },
  ],
};

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/levels/proving.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(level, null, 2) + '\n');

// Sanity: the start cell must be reachable floor, and the maze must be connected
// enough that the exit is reachable from the start.
const solid = new Set(['X', 'x', ' ']);
const seen = new Set();
const q = [level.start.join(',')];
seen.add(q[0]);
while (q.length) {
  const [x, y] = q.shift().split(',').map(Number);
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
    // treat doors as passable for the reachability check (they auto-open)
    if (solid.has(g[ny][nx])) continue;
    seen.add(k);
    q.push(k);
  }
}
const reachable = seen.has('28,28');
console.log(`wrote ${out}`);
console.log(`  ${seen.size} reachable cells; exit reachable: ${reachable}`);
if (!reachable) {
  console.error('  FAIL: exit is walled off');
  process.exit(1);
}
