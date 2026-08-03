import { Px, ramp, palette } from '@cabinet/pixel';
import { NB, reduceMask } from '@cabinet/autotile';

/** Art is authored at twice the field cell, as in the other two cabinets. */
export const TILE_PX = 32;

/**
 * The four earth bands, shallow to deep.
 *
 * Colour is the only thing that distinguishes them, and it is load-bearing rather than
 * decorative: the score for bursting something reads its band, so a player has to be
 * able to tell at a glance how deep they are. Warm and light at the top, cold and dark
 * at the bottom — the further down, the less it looks like anywhere you should be.
 */
export const BAND_RAMPS = [
  ramp('#b87a3c', { spread: 0.26 }), // topsoil
  ramp('#9a5a34', { spread: 0.26 }), // clay
  ramp('#6a4a52', { spread: 0.24 }), // shale
  ramp('#3e3a4e', { spread: 0.22 }), // bedrock
] as const;

const SKY = ramp('#1a2038', { spread: 0.3 });
const GRUB = ramp('#d24a4a', { spread: 0.3 });
const EMBER = ramp('#4ab86a', { spread: 0.3 });
const FLAME = ramp('#ffb03a', { spread: 0.4 });
/**
 * The digger gets its own ramp, and this is not cosmetic.
 *
 * It was drawn with the generic `P.*` palette enum, which resolves to the FIRST ramp in
 * the palette — topsoil. So the player character was rendered in precisely the colour of
 * the ground it spends the first band of every level standing in, and was very nearly
 * invisible. Caught by looking at a rendered frame; no test was ever going to ask.
 *
 * Cold and bright against four warm earth tones, so it separates at every depth.
 */
const DIGGER = ramp('#5fc8ff', { spread: 0.35 });

export const PALETTE = palette(
  BAND_RAMPS[0],
  BAND_RAMPS[1],
  BAND_RAMPS[2],
  BAND_RAMPS[3],
  SKY,
  GRUB,
  EMBER,
  FLAME,
  DIGGER,
);

/** Palette slots for band n, since `palette()` lays ramps out six entries at a time. */
export function bandSlots(band: number): { outline: number; darkest: number; dark: number; base: number; light: number } {
  const o = 1 + band * 6;
  return { outline: o, darkest: o + 1, dark: o + 2, base: o + 3, light: o + 4 };
}

export const SKY_SLOTS = bandSlots(4);

/** Cheap deterministic noise. Grain must be a property of WHERE a cell is, never of
 *  when it was drawn, or the earth shimmers as the field changes. */
function hash(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 1442695040888963407) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/**
 * One earth tile, with its exposed faces lit according to the blob mask.
 *
 * The mask says which neighbours are also earth; every side that is NOT earth is a cut
 * face, and gets a lighter lip so the tunnel beside it reads as carved rather than as
 * a colour change. That lip is most of what makes a grid of squares look like a tunnel
 * network, and it is why this is worth generating per-mask instead of drawing one
 * square per band.
 */
export function earthTile(band: number, mask: number): Px {
  const p = new Px(TILE_PX, TILE_PX);
  const s = bandSlots(band);
  const m = reduceMask(mask);

  p.rect(0, 0, TILE_PX, TILE_PX, s.base);

  // Grain, so a wall of earth is not a flat colour field.
  for (let y = 0; y < TILE_PX; y += 2) {
    for (let x = 0; x < TILE_PX; x += 2) {
      const t = hash(x, y, band * 7 + 1);
      if (t > 0.82) p.rect(x, y, 2, 2, s.light);
      else if (t < 0.16) p.rect(x, y, 2, 2, s.dark);
    }
  }

  // Cut faces. A lit lip on the open side, shading away from it.
  const LIP = 3;
  if (!(m & NB.N)) {
    p.rect(0, 0, TILE_PX, 1, s.outline);
    p.rect(0, 1, TILE_PX, LIP, s.light);
  }
  if (!(m & NB.S)) {
    p.rect(0, TILE_PX - 1, TILE_PX, 1, s.outline);
    p.rect(0, TILE_PX - 1 - LIP, TILE_PX, LIP, s.darkest);
  }
  if (!(m & NB.W)) {
    p.rect(0, 0, 1, TILE_PX, s.outline);
    p.rect(1, 0, LIP, TILE_PX, s.dark);
  }
  if (!(m & NB.E)) {
    p.rect(TILE_PX - 1, 0, 1, TILE_PX, s.outline);
    p.rect(TILE_PX - 1 - LIP, 0, LIP, TILE_PX, s.dark);
  }

  // Inside corners: where two cut faces meet, round the join off so the corner does not
  // read as a square notch punched out of the earth.
  const corner = (cx: number, cy: number, a: number, b: number) => {
    if (m & a || m & b) return;
    for (let j = 0; j < LIP + 1; j++) {
      for (let i = 0; i < LIP + 1 - j; i++) {
        p.set(cx === 0 ? i : TILE_PX - 1 - i, cy === 0 ? j : TILE_PX - 1 - j, s.outline);
      }
    }
  };
  corner(0, 0, NB.N, NB.W);
  corner(1, 0, NB.N, NB.E);
  corner(0, 1, NB.S, NB.W);
  corner(1, 1, NB.S, NB.E);

  return p;
}

/** Open tunnel: what is left once earth is removed. Dark, with a hint of the band it
 *  was cut from so the depth is still readable in an emptied-out level. */
export function tunnelTile(band: number): Px {
  const p = new Px(TILE_PX, TILE_PX);
  const s = bandSlots(Math.max(0, band));
  p.rect(0, 0, TILE_PX, TILE_PX, s.outline);
  for (let y = 0; y < TILE_PX; y += 4) {
    for (let x = 0; x < TILE_PX; x += 4) {
      if (hash(x, y, band * 13 + 5) > 0.88) p.rect(x, y, 2, 2, s.darkest);
    }
  }
  return p;
}

/** The strip above the earth line. */
export function skyTile(): Px {
  const p = new Px(TILE_PX, TILE_PX);
  p.rect(0, 0, TILE_PX, TILE_PX, SKY_SLOTS.base);
  for (let y = 0; y < TILE_PX; y += 2) {
    for (let x = 0; x < TILE_PX; x += 2) {
      if (hash(x, y, 99) > 0.94) p.rect(x, y, 1, 1, SKY_SLOTS.light);
    }
  }
  return p;
}

/** A first, honest digger sprite: M0 needs something on screen that faces four ways.
 *  Real art is M4. */
export function diggerSprite(dir: number): Px {
  const p = new Px(TILE_PX, TILE_PX);
  const s = bandSlots(8); // the digger's own ramp, not whichever earth it is standing in

  // Bigger than it was, and filling most of the cell. A 14-cell-wide playfield read at a
  // distance needs the thing you are steering to be the most legible object on screen.
  p.ellipse(TILE_PX / 2, TILE_PX / 2 + 3, 12, 11, s.base);
  p.ellipse(TILE_PX / 2 - 3, TILE_PX / 2 + 1, 6, 5, s.light);
  p.rect(6, 4, 20, 8, s.dark); // helmet
  p.rect(6, 11, 20, 2, s.outline);

  // A bright visor on the facing side, so which way it points is unambiguous at a glance.
  if (dir === 0) p.rect(11, 1, 10, 4, s.light);
  else if (dir === 1) p.rect(24, 14, 6, 6, s.light);
  else if (dir === 2) p.rect(11, 25, 10, 4, s.light);
  else p.rect(2, 14, 6, 6, s.light);

  p.outline(s.outline);
  return p;
}


/**
 * A boulder. Three appearances: at rest, teetering, and coming apart.
 *
 * The teetering frame is offset rather than redrawn — the wobble is what warns you, so
 * it has to be visible at a glance without being a different object.
 */
export function rockSprite(variant: 'rest' | 'teeter' | 'shatter'): Px {
  const p = new Px(TILE_PX, TILE_PX);
  const s = bandSlots(3); // bedrock tones, so a rock reads as harder than any earth
  const shift = variant === 'teeter' ? 2 : 0;

  if (variant === 'shatter') {
    // Broken into pieces, spreading outward.
    for (const [x, y, r] of [[8, 20, 4], [17, 21, 3], [22, 17, 3], [11, 13, 3], [20, 10, 2]] as const) {
      p.ellipse(x, y, r, r, s.base);
      p.ellipse(x, y - 1, r - 1, r - 1, s.light);
    }
    p.outline(s.outline);
    return p;
  }

  p.ellipse(TILE_PX / 2 + shift, TILE_PX / 2, 14, 13, s.base);
  p.ellipse(TILE_PX / 2 + shift - 4, TILE_PX / 2 - 4, 7, 6, s.light);
  p.ellipse(TILE_PX / 2 + shift + 4, TILE_PX / 2 + 5, 5, 4, s.dark);
  // A teetering rock is about to kill someone, so it is outlined in warning colour
  // rather than left to be spotted by its two-pixel wobble.
  p.outline(variant === 'teeter' ? bandSlots(7).light : s.outline);
  return p;
}


/**
 * An enemy. `ghost` is the same creature seen through earth.
 *
 * The ghost has to be unmistakable and still obviously the same thing: a player who
 * cannot tell a ghosting enemy from a solid one cannot make the decision the mechanic
 * exists to force. Hollowed out rather than recoloured, so it reads at a glance without
 * becoming a different sprite.
 */
export function enemySprite(kind: 'grub' | 'emberjaw', ghost: boolean): Px {
  const p = new Px(TILE_PX, TILE_PX);
  const slot = kind === 'grub' ? 5 : 6; // ramps 5 and 6, after the four bands and sky
  const s = bandSlots(slot);

  if (ghost) {
    // Outline and eyes only: something coming through the wall, not something standing
    // in front of it.
    // Hollow: fill, then punch the middle back out. Px has no ellipse-outline op and
    // one filled shape minus a smaller one is exactly what that would be anyway.
    p.ellipse(TILE_PX / 2, TILE_PX / 2, 11, 10, s.light);
    p.ellipse(TILE_PX / 2, TILE_PX / 2, 8, 7, 0);
    p.rect(11, 13, 3, 4, s.light);
    p.rect(19, 13, 3, 4, s.light);
    return p;
  }

  p.ellipse(TILE_PX / 2, TILE_PX / 2, 13, 12, s.base);
  p.ellipse(TILE_PX / 2 - 3, TILE_PX / 2 - 4, 6, 5, s.light);
  p.rect(10, 12, 5, 6, 0);
  p.rect(18, 12, 5, 6, 0);
  p.rect(11, 13, 3, 4, s.outline);
  p.rect(19, 13, 3, 4, s.outline);
  if (kind === 'emberjaw') {
    // A snout, so the thing that breathes fire looks like it might.
    p.rect(24, 15, 6, 5, s.dark);
    p.rect(28, 16, 3, 3, s.light);
  }
  p.outline(s.outline);
  return p;
}

/** One cell of flame. */
export function flameSprite(): Px {
  const p = new Px(TILE_PX, TILE_PX);
  const s = bandSlots(7);
  for (let i = 0; i < 5; i++) {
    const y = 4 + i * 5;
    const w = 26 - Math.abs(i - 2) * 4;
    p.rect(TILE_PX / 2 - w / 2, y, w, 4, i % 2 === 0 ? s.base : s.light);
  }
  p.outline(s.outline);
  return p;
}
