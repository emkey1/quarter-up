import { T } from '@/data/tuning';
import type { LevelData, LevelObject } from './level';

/**
 * Level analysis: is this maze actually playable?
 *
 * validateLevel() in level.ts answers "is this well-formed JSON of the right shape".
 * This answers the harder question — can the player reach the exit, is anything sealed
 * away, will they starve. It is deliberately separate because it is expensive and
 * structural, where validation is cheap and per-field.
 *
 * This lives in src/ rather than in the level tools so there is exactly one definition
 * of "playable". The editor shows its verdict live on every edit, and a test runs it
 * over every shipped level, so a level that the editor calls fine cannot be one CI
 * calls broken.
 */

const N = T.GRID;

/** Glyphs nothing can walk through, ever. */
const SOLID = new Set([' ', 'X']);

/**
 * Doors and breakable walls are NOT solid for reachability purposes. Neither can strand
 * anyone permanently: a door only needs a key, and a breakable wall falls to any shot.
 * Counting them as barriers would flag perfectly good levels.
 */

export interface LevelReport {
  /** False if the level has a problem that makes it unplayable. */
  ok: boolean;
  /** Unplayable-level problems. */
  errors: string[];
  /** Playable, but probably not what the author meant. */
  warnings: string[];
  /** `x,y` keys of every cell the player can get to. */
  reachable: ReadonlySet<string>;
  /** Total generator levels — a rough measure of how hard the level pushes. */
  pressure: number;
}

/** Objects that are pointless — or actively unfair — if the player cannot get to them. */
const MUST_REACH = new Set(['food', 'key', 'potion', 'treasure', 'upgrade', 'gen', 'mon', 'death', 'thief']);

function flood(tiles: string[][], from: [number, number]): Set<string> {
  const seen = new Set([from.join(',')]);
  const queue: [number, number][] = [from];
  for (let head = 0; head < queue.length; head++) {
    const [x, y] = queue[head];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const key = `${nx},${ny}`;
      if (seen.has(key) || SOLID.has(tiles[ny][nx])) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  return seen;
}

/**
 * Reachability with traps fired.
 *
 * A vault whose only entrance is opened by a pressure plate is sealed on a naive flood
 * fill, and calling that "broken" is how you end up adding an exemption — which is
 * exactly the mistake that once shipped a level with eighteen treasures walled in
 * forever. So instead of exempting anything, we simulate: fire every trap the player
 * can stand on, re-flood, repeat until nothing new opens. Anything still unreachable
 * after that is genuinely unreachable.
 */
export function analyseLevel(level: LevelData): LevelReport {
  const tiles = level.tiles.map((row) => row.split(''));
  const start: [number, number] = [level.start[0], level.start[1]];

  let reachable = flood(tiles, start);
  const fired = new Set<LevelObject>();
  for (;;) {
    let opened = false;
    for (const o of level.objects) {
      if (o.t !== 'trap' || fired.has(o) || !reachable.has(`${o.x},${o.y}`)) continue;
      fired.add(o);
      for (const [ox, oy] of o.opens ?? []) {
        if (ox >= 0 && oy >= 0 && ox < N && oy < N) tiles[oy][ox] = '.';
      }
      opened = true;
    }
    if (!opened) break;
    reachable = flood(tiles, start);
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const at = (o: { x: number; y: number }) => `${o.x},${o.y}`;

  if (SOLID.has(tiles[start[1]][start[0]])) errors.push('start is inside a solid tile');

  const exits: string[] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) if (tiles[y][x] === 'E') exits.push(`${x},${y}`);
  }
  if (exits.length === 0) errors.push('no exit tile');
  else if (!exits.some((e) => reachable.has(e))) errors.push('no exit is reachable from the start');

  for (const o of level.objects) {
    if (!MUST_REACH.has(o.t)) continue;
    if (SOLID.has(tiles[o.y][o.x])) errors.push(`${o.t} at ${at(o)} is inside a wall`);
    else if (!reachable.has(at(o))) errors.push(`${o.t} at ${at(o)} is unreachable`);
  }

  // Health drains constantly, so a normal level with no food is not hard, it is
  // unsurvivable. Treasure rooms are exempt: they run on a timer, not on health.
  if (level.type !== 'treasure' && !level.objects.some((o) => o.t === 'food')) {
    warnings.push('no food — health drains constantly on this level type');
  }

  // Death and the Thief cannot be fought off — one drains health per contact, the other
  // steals and runs. Spawning either on top of the player robs them before they have had
  // a frame to react, which is not difficulty, it is a coin flip. This caught a shipped
  // level with the Thief placed exactly on the start cell.
  for (const o of level.objects) {
    if (o.t !== 'death' && o.t !== 'thief') continue;
    const range = Math.max(Math.abs(o.x - start[0]), Math.abs(o.y - start[1]));
    if (range < 5) warnings.push(`${o.t} at ${at(o)} spawns ${range} cells from the player start`);
  }

  for (const o of level.objects) {
    if (o.t !== 'trap') continue;
    if (!(o.opens ?? []).length) warnings.push(`trap at ${at(o)} opens nothing`);
    else if (!fired.has(o)) warnings.push(`trap at ${at(o)} can never be stepped on`);
  }

  const pressure = level.objects.reduce((n, o) => (o.t === 'gen' ? n + (o.lvl ?? 1) : n), 0);

  return { ok: errors.length === 0, errors, warnings, reachable, pressure };
}
