#!/usr/bin/env node
/**
 * Assembles every game into one static site:
 *
 *   dist/index.html   the cabinet-select page
 *   dist/<game>/…     that game's own Vite build, copied verbatim
 *
 * Each game keeps its own Vite config and builds to its own games/<game>/dist.
 * This script only stitches the results together, which is the point: a game is
 * always runnable and shippable on its own, and the arcade is a thin layer over
 * the top rather than something the games have to know about.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist');

const games = readdirSync(join(root, 'games'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(root, 'games', e.name, 'package.json')))
  .map((e) => e.name)
  .sort();

if (games.length === 0) {
  console.error('No games found under games/.');
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const game of games) {
  console.log(`\n=== building ${game} ===`);
  execFileSync('npm', ['run', 'build', '-w', `games/${game}`], { cwd: root, stdio: 'inherit' });

  const built = join(root, 'games', game, 'dist');
  if (!existsSync(built)) throw new Error(`${game}: build produced no dist/`);
  cpSync(built, join(outDir, game), { recursive: true });
}

cpSync(join(root, 'index.html'), join(outDir, 'index.html'));
console.log(`\nArcade assembled in dist/ — ${games.join(', ')}`);
