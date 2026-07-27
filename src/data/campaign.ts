import { validateLevel, type LevelData } from '@/game/level';
import d01 from './levels/d01.json';
import d02 from './levels/d02.json';
import d03 from './levels/d03.json';
import d04 from './levels/d04.json';
import d05 from './levels/d05.json';
import proving from './levels/proving.json';

const RAW: unknown[] = [d01, d02, d03, d04, d05];

/**
 * The campaign order.
 *
 * Past the authored set the list loops with a depth multiplier applied to generator
 * rates, matching the original's structure: there is no ending, only a score.
 *
 * These five are *development* levels. M5 brings the editor and the real content.
 */
export const CAMPAIGN: readonly LevelData[] = RAW.map((raw, i) => {
  const r = validateLevel(raw);
  if (!r.ok) throw new Error(`campaign[${i}] failed validation:\n  ${r.errors.join('\n  ')}`);
  return r.data;
});

/** Kept out of the campaign; reachable from the dev hotkeys for systems testing. */
export const PROVING: LevelData = (() => {
  const r = validateLevel(proving);
  if (!r.ok) throw new Error(`proving level failed validation:\n  ${r.errors.join('\n  ')}`);
  return r.data;
})();
