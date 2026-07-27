import { validateLevel, type LevelData } from '@/game/level';
import proving from './levels/proving.json';

/** The M0-M3 systems proving ground. Not part of the campaign. */
export const PROVING: LevelData = (() => {
  const r = validateLevel(proving);
  if (!r.ok) throw new Error(`proving level failed validation:\n  ${r.errors.join('\n  ')}`);
  return r.data;
})();
