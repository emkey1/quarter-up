/**
 * Types for levelgen.mjs.
 *
 * Hand-written rather than generated because the module is plain JS on purpose: the level
 * tools run under bare Node with no build step, and the editor bundles the same file. One
 * implementation, two consumers, and this is the seam that lets the typed one import it.
 */
import type { LevelData } from '../src/game/level';

export interface LevelType {
  id: string;
  label: string;
  blurb: string;
}

export declare const LEVEL_TYPES: LevelType[];

export declare function generateLevel(opts?: {
  /** One of LEVEL_TYPES[].id. Anything unrecognised falls back to 'warren'. */
  type?: string;
  /** Drives monster roster, generator level and density. */
  depth?: number;
  /** Same type + depth + seed always produces the same level. */
  seed?: number;
  id?: string;
  name?: string;
}): LevelData;
