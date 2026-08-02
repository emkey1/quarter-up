#!/usr/bin/env node
/**
 * Generates src/data/rooms/*.json.
 *
 * Rooms are authored here rather than by hand because a 32x28 grid typed into JSON
 * drifts out of shape the moment you edit it, and a row that is 31 characters wide
 * fails validation with a message about row 14 rather than about the edit you just made.
 * Declaring platforms as segments and letting the script lay out the grid means the
 * source of truth is the shape you meant, not the shape you typed.
 *
 * This is the seed of the room generator proper (M5); for now it emits room 1.
 *
 *   node tools/mkrooms.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GRID_W = 32;
const GRID_H = 28;

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/rooms');

/** Lay out a grid from a declarative description. */
function buildTiles({ walls = true, platforms = [], solids = [] }) {
  const rows = [];
  for (let y = 0; y < GRID_H; y++) {
    const row = new Array(GRID_W).fill('.');
    if (walls) {
      row[0] = '#';
      row[GRID_W - 1] = '#';
    }
    rows.push(row);
  }
  for (const [y, x0, x1] of solids) {
    for (let x = x0; x <= x1; x++) rows[y][x] = '#';
  }
  for (const [y, x0, x1] of platforms) {
    for (let x = x0; x <= x1; x++) rows[y][x] = '=';
  }
  return rows.map((r) => r.join(''));
}

/** Drift field: rows listed in `right`/`left`/`up`/`down` flow that way, rest is still. */
function buildDrift({ right = [], left = [], up = [], down = [] } = {}) {
  const rows = [];
  for (let y = 0; y < GRID_H; y++) {
    let ch = '.';
    if (right.includes(y)) ch = 'r';
    else if (left.includes(y)) ch = 'l';
    else if (up.includes(y)) ch = 'u';
    else if (down.includes(y)) ch = 'd';
    rows.push(ch.repeat(GRID_W));
  }
  return rows;
}

/**
 * Room 1 — teaches nothing but the basics, which is the whole job.
 *
 * Four tiers of short platforms with generous gaps, and a floor that stops short of the
 * walls so the drop-through and the vertical wrap are discoverable in the first ten
 * seconds without anyone being told about them. Two Zen-Chans, the slowest monster,
 * placed on the same tier so a first chain pop is possible but not accidental.
 *
 * The ceiling band drifts right: bubbles that get away collect in the top-right corner
 * instead of scattering, which is the first hint that rooms have currents.
 */
const room001 = {
  id: 'r001',
  tiles: buildTiles({
    platforms: [
      [6, 4, 11],
      [6, 20, 27],
      [11, 2, 8],
      [11, 13, 18],
      [11, 23, 29],
      [16, 4, 11],
      [16, 20, 27],
      [21, 2, 8],
      [21, 13, 18],
      [21, 23, 29],
      [25, 3, 28],
    ],
  }),
  drift: buildDrift({ right: [0, 1, 2, 3] }),
  driftSpeed: 0.4,
  playerStart: { x: 15, y: 24 },
  spawns: [
    { kind: 'zenchan', x: 6, y: 10, dir: 1 },
    { kind: 'zenchan', x: 25, y: 10, dir: -1 },
  ],
  escapeFrames: 480,
  timer: 1800,
  specialBubbles: [],
};

const ROOMS = [room001];

mkdirSync(OUT, { recursive: true });
for (const room of ROOMS) {
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
  const path = resolve(OUT, `${room.id}.json`);
  writeFileSync(path, json + '\n');
  console.log(`wrote ${path}`);
}
