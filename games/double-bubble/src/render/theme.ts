import { ramp, palette, type Ramp } from './pixel';

/**
 * Room palettes.
 *
 * The original runs 100 rooms through a repeating set of colour schemes, which is most
 * of what stops a hundred single screens from reading as one screen. We do the same: a
 * band of rooms shares a scheme, and the scheme changes underneath you as you climb.
 */
export interface Theme {
  name: string;
  /** Structural blocks — the walls and platforms. */
  block: Ramp;
  /** Accent used for the platform's lit top edge and trim. */
  trim: Ramp;
  background: string;
  /** Slightly lifted background for the subtle backdrop pattern. */
  backdrop: string;
}

function theme(name: string, block: string, trim: string, bg: string, backdrop: string): Theme {
  return {
    name,
    block: ramp(block),
    trim: ramp(trim),
    background: bg,
    backdrop,
  };
}

export const THEMES: readonly Theme[] = [
  theme('moss', '#3f8f4e', '#8fd66a', '#06090c', '#0c1410'),
  theme('brick', '#b8543a', '#f0a25e', '#0a0607', '#170c0b'),
  theme('deep', '#3a63b8', '#6fc6f0', '#04060c', '#0b1020'),
  theme('bone', '#9a8f7a', '#e8dcc0', '#0a0908', '#161410'),
  theme('violet', '#7a46b8', '#c99cf0', '#08060c', '#130d1c'),
  theme('ember', '#b8963a', '#f0d872', '#0a0805', '#171208'),
];

/** Rooms change scheme every few rooms, so progress is visible without a counter. */
export function themeForRoom(roomNumber: number): Theme {
  return THEMES[Math.floor((roomNumber - 1) / 5) % THEMES.length];
}

/** The palette a tile or sprite is blitted with: block ramp first, trim second. */
export function themePalette(t: Theme): string[] {
  return palette(t.block, t.trim);
}
