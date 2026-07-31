import { T } from '@/data/tuning';
import { validateLevel, type LevelData } from '@/game/level';
import proving from './levels/proving.json';

/**
 * The M0-M3 systems proving ground. Not part of the campaign.
 *
 * Hand-built, with every mechanic laid out at a known coordinate so tests and manual
 * checks can address them directly — the teleporter is at a specific tile, the breakable
 * row is at a specific row, and a good many assertions say so out loud.
 *
 * Which is why it is PADDED to the current grid rather than regenerated for it. Growing
 * the level grid would otherwise silently invalidate every coordinate in the harness that
 * exists to verify the grid, and "the test fixture moved" is the last thing you want to
 * be debugging when the thing you changed is the world size. Padding is walls on the new
 * edges: the proving ground keeps its exact geometry and simply sits in the corner of a
 * larger canvas.
 */
function padToGrid(raw: unknown): unknown {
  const d = raw as { tiles: string[]; [k: string]: unknown };
  if (!Array.isArray(d?.tiles) || d.tiles.length >= T.GRID) return raw;

  const width = d.tiles[0]?.length ?? 0;
  const pad = T.GRID - width;
  const tiles = d.tiles.map((row) => row + 'X'.repeat(Math.max(0, pad)));
  while (tiles.length < T.GRID) tiles.push('X'.repeat(T.GRID));
  return { ...d, tiles };
}

export const PROVING: LevelData = (() => {
  const r = validateLevel(padToGrid(proving));
  if (!r.ok) throw new Error(`proving level failed validation:\n  ${r.errors.join('\n  ')}`);
  return r.data;
})();
