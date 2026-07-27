import { NB } from './autotile';
import { Px, palette, ramp } from './pixel';
import type { Theme } from './theme';

/**
 * Procedural tile art at native resolution.
 *
 * Walls and floor fill most of the screen, so this is where pixel-level craft pays back
 * hardest. Three things do the heavy lifting:
 *
 *   1. STONE COURSES. A wall is not a flat rectangle; it is blocks with mortar lines,
 *      offset row to row. That single texture is most of the difference between "a
 *      coloured square" and "a wall".
 *   2. BEVELS DRIVEN BY THE BLOB MASK. An edge with no neighbour gets a lit top-left
 *      and a shadowed bottom-right; an edge that continues gets a mortar seam instead.
 *      Inside corners get a notch. This is what makes a wall run read as one structure.
 *   3. DETERMINISTIC NOISE. Speckle and cracks come from a positional hash, so a given
 *      tile always looks the same and the maze does not shimmer as you walk.
 */

export const TILE_PX = 32;

const S = { o: 1, dk: 2, d: 3, b: 4, l: 5, ll: 6 }; // stone
const M = { o: 7, dk: 8, d: 9, b: 10, l: 11, ll: 12 }; // mortar / accent

function hash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Speckle a region so flat fills stop looking flat. */
function speckle(p: Px, x0: number, y0: number, w: number, h: number, salt: number, light: number, dark: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (p.at(x, y) === 0) continue;
      const n = hash(x, y, salt);
      if (n > 0.90) p.set(x, y, light);
      else if (n < 0.10) p.set(x, y, dark);
    }
  }
}

/**
 * A wall tile for one blob mask.
 *
 * The mask decides where the structure continues, and therefore where a lit bevel
 * belongs versus a mortar seam.
 */
export function wallTile(mask: number, salt: number): Px {
  const p = new Px(TILE_PX, TILE_PX);
  p.rect(0, 0, TILE_PX, TILE_PX, S.b);

  // --- stone courses, offset every other row like real masonry
  const courseH = 8;
  for (let row = 0; row < TILE_PX / courseH; row++) {
    const y = row * courseH;
    const offset = row % 2 === 0 ? 0 : 8;
    p.rect(0, y + courseH - 1, TILE_PX, 1, S.dk); // horizontal mortar
    for (let bx = offset; bx < TILE_PX; bx += 16) {
      p.rect(bx, y, 1, courseH - 1, S.dk); // vertical mortar
    }
    // subtle per-block tone variation
    for (let bx = offset - 16; bx < TILE_PX; bx += 16) {
      const t = hash(bx, y, salt);
      if (t > 0.72) p.rect(bx + 1, y, 15, courseH - 1, S.l);
      else if (t < 0.28) p.rect(bx + 1, y, 15, courseH - 1, S.d);
    }
  }

  speckle(p, 0, 0, TILE_PX, TILE_PX, salt + 7, S.l, S.d);

  // --- edges: lit where the structure ends, seamed where it continues
  const open = (bit: number) => (mask & bit) === 0;
  if (open(NB.N)) {
    p.rect(0, 0, TILE_PX, 2, S.ll);
    p.rect(0, 2, TILE_PX, 1, S.l);
  } else {
    p.rect(0, 0, TILE_PX, 1, S.dk);
  }
  if (open(NB.W)) {
    p.rect(0, 0, 2, TILE_PX, S.l);
  } else {
    p.rect(0, 0, 1, TILE_PX, S.dk);
  }
  if (open(NB.S)) {
    p.rect(0, TILE_PX - 3, TILE_PX, 3, S.dk);
    p.rect(0, TILE_PX - 1, TILE_PX, 1, S.o);
  }
  if (open(NB.E)) {
    p.rect(TILE_PX - 3, 0, 3, TILE_PX, S.dk);
    p.rect(TILE_PX - 1, 0, 1, TILE_PX, S.o);
  }

  // --- inside corners: two cardinals present but the diagonal missing means the
  // structure turns here, and a notch is what makes that legible.
  const notch = 5;
  const inside = (a: number, b: number, diag: number) =>
    (mask & a) !== 0 && (mask & b) !== 0 && (mask & diag) === 0;
  if (inside(NB.N, NB.E, NB.NE)) p.rect(TILE_PX - notch, 0, notch, notch, S.dk);
  if (inside(NB.S, NB.E, NB.SE)) p.rect(TILE_PX - notch, TILE_PX - notch, notch, notch, S.dk);
  if (inside(NB.S, NB.W, NB.SW)) p.rect(0, TILE_PX - notch, notch, notch, S.dk);
  if (inside(NB.N, NB.W, NB.NW)) p.rect(0, 0, notch, notch, S.l);

  return p;
}

/** Floor: flagstones with grout, plus occasional cracks and grit. */
export function floorTile(variant: number): Px {
  const p = new Px(TILE_PX, TILE_PX);
  p.rect(0, 0, TILE_PX, TILE_PX, M.b);

  const half = TILE_PX / 2;
  const offset = variant % 2 === 0 ? 0 : half;
  p.rect(0, half - 1, TILE_PX, 1, M.dk);
  p.rect(0, TILE_PX - 1, TILE_PX, 1, M.dk);
  p.rect(offset, 0, 1, half, M.dk);
  p.rect((offset + half) % TILE_PX, half, 1, half, M.dk);

  speckle(p, 0, 0, TILE_PX, TILE_PX, variant * 31 + 3, M.l, M.d);

  // a crack on some stones, so a big floor is not a repeating stamp
  if (variant % 4 === 1) {
    p.line(6, 4, 11, 12, M.d);
    p.line(11, 12, 9, 20, M.d);
  }
  if (variant % 4 === 3) {
    p.line(20, 18, 27, 24, M.d);
  }
  // top-lit grout so the floor has a light direction like everything else
  p.rect(0, half, TILE_PX, 1, M.l);
  return p;
}

export function breakableTile(): Px {
  const p = wallTile(0, 99);
  // Same masonry, visibly failing: it must read as "shoot me" without a legend.
  p.line(8, 0, 14, 12, S.o);
  p.line(14, 12, 10, 31, S.o);
  p.line(14, 12, 26, 17, S.o);
  p.line(20, 0, 23, 9, S.o);
  p.rect(13, 11, 3, 3, S.dk);
  speckle(p, 0, 0, TILE_PX, TILE_PX, 55, S.d, S.o);
  return p;
}

export function doorTile(open: boolean): Px {
  const p = new Px(TILE_PX, TILE_PX);
  if (open) {
    p.rect(0, 0, TILE_PX, 4, M.d);
    p.rect(0, TILE_PX - 4, TILE_PX, 4, M.d);
    return p;
  }
  p.rect(0, 0, TILE_PX, TILE_PX, M.b);
  // vertical planks with iron banding
  for (let x = 0; x < TILE_PX; x += 8) p.rect(x, 0, 1, TILE_PX, M.dk);
  p.rect(0, 5, TILE_PX, 3, S.d);
  p.rect(0, TILE_PX - 8, TILE_PX, 3, S.d);
  p.rect(0, 5, TILE_PX, 1, S.l);
  p.rect(0, TILE_PX - 8, TILE_PX, 1, S.l);
  p.ellipse(22, 16, 2, 2, S.ll); // handle
  speckle(p, 0, 0, TILE_PX, TILE_PX, 11, M.l, M.d);
  p.rect(0, 0, TILE_PX, 1, M.l);
  p.rect(0, TILE_PX - 1, TILE_PX, 1, M.o);
  return p;
}

export function exitTile(): Px {
  const p = new Px(TILE_PX, TILE_PX);
  p.rect(0, 0, TILE_PX, TILE_PX, S.dk);
  // an arch of light
  p.ellipse(16, 20, 11, 14, M.b);
  p.ellipse(16, 22, 8, 11, M.l);
  p.ellipse(16, 24, 5, 8, M.ll);
  p.rect(0, 0, TILE_PX, 2, S.l);
  return p;
}

export function teleportTile(): Px {
  const p = floorTile(2);
  // concentric rings; the pad should look like it is doing something
  for (let r = 12; r > 2; r -= 4) {
    p.ellipse(16, 16, r, r * 0.6, r % 8 === 0 ? M.ll : S.l);
  }
  p.ellipse(16, 16, 3, 2, M.ll);
  return p;
}

export function trapTile(): Px {
  const p = floorTile(1);
  p.rect(6, 6, 20, 20, M.l);
  p.rect(8, 8, 16, 16, M.b);
  p.rect(10, 10, 12, 12, M.ll);
  p.rect(12, 12, 8, 8, M.b);
  return p;
}

export function themePalette(t: Theme): readonly string[] {
  return palette(ramp(t.wallFace, { spread: 1.2 }), ramp(t.floorBase, { spread: 0.8 }));
}

/** Extra themes, so the campaign is not one colour for forty levels. */
export const THEME_TINTS: { id: string; wall: string; floor: string }[] = [
  { id: 'stone', wall: '#3f6f9f', floor: '#4a382c' },
  { id: 'crypt', wall: '#5a5060', floor: '#37323c' },
  { id: 'iron', wall: '#5c6470', floor: '#3a3e44' },
  { id: 'ember', wall: '#8c4030', floor: '#402420' },
  { id: 'moss', wall: '#3f7050', floor: '#2e3a2c' },
  { id: 'bone', wall: '#9a8f74', floor: '#4a4438' },
];
