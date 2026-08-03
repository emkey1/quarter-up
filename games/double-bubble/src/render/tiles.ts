import { Px, P } from '@cabinet/pixel';
import { T } from '@/data/tuning';
import { Tile } from '@/game/room';
import { themePalette, type Theme } from './theme';

/**
 * Procedural tile art.
 *
 * Tiles are authored at TILE * ART_SCALE (16x16) and blitted nearest-neighbour, so the
 * result is real pixel art rather than smoothed vector shapes. Generating rather than
 * drawing means a new room theme is a palette swap, not a new spritesheet.
 */

export const TILE_PX = T.TILE * T.ART_SCALE;

/** Which neighbours are the same kind, as a 4-bit mask. Drives the lit edges. */
export const enum Edge {
  Up = 1,
  Down = 2,
  Left = 4,
  Right = 8,
}

/**
 * A solid block: chunky, bevelled, lit from the top-left.
 *
 * The bevel is suppressed on any side that has a same-kind neighbour, so a run of blocks
 * reads as one mass with a lit rim rather than as a row of separate bricks. That single
 * rule is what makes 32x28 of 16px tiles look built rather than tiled.
 */
function solidBlock(mask: number): Px {
  const n = TILE_PX;
  const p = new Px(n, n);

  p.rect(0, 0, n, n, P.Base);

  // Interior speckle for texture — deterministic, so it never shimmers between frames.
  for (let y = 2; y < n - 2; y++) {
    for (let x = 2; x < n - 2; x++) {
      if (((x * 7 + y * 13) & 15) === 0) p.set(x, y, P.Dark);
      else if (((x * 11 + y * 5) & 15) === 3) p.set(x, y, P.Light);
    }
  }

  if (!(mask & Edge.Up)) p.rect(0, 0, n, 2, P.Light);
  if (!(mask & Edge.Left)) p.rect(0, 0, 2, n, P.Light);
  if (!(mask & Edge.Down)) p.rect(0, n - 2, n, 2, P.Darkest);
  if (!(mask & Edge.Right)) p.rect(n - 2, 0, 2, n, P.Darkest);

  // Corner where two lit edges meet reads brightest.
  if (!(mask & Edge.Up) && !(mask & Edge.Left)) p.rect(0, 0, 3, 3, P.Lightest);

  return p;
}

/**
 * A one-way platform: a thin slab with a bright top lip and nothing underneath.
 *
 * It has to be visually obvious that you can pass up through it, because that is the
 * single most important traversal rule in the game. The lit lip on top and the open
 * space below carry that without a tutorial.
 */
function platform(mask: number): Px {
  const n = TILE_PX;
  const p = new Px(n, n);

  const h = Math.round(n * 0.45);
  p.rect(0, 0, n, h, P.Base);
  p.rect(0, 0, n, 2, P.Base2); // trim ramp: the lip you land on
  p.rect(0, 2, n, 1, P.Light2);
  p.rect(0, h - 1, n, 1, P.Darkest);

  for (let x = 2; x < n - 2; x++) {
    if (((x * 7) & 7) === 0) p.set(x, h - 2, P.Dark);
  }

  if (!(mask & Edge.Left)) p.rect(0, 0, 1, h, P.Light);
  if (!(mask & Edge.Right)) p.rect(n - 1, 0, 1, h, P.Darkest);

  return p;
}

export interface TileSet {
  /** Indexed [kind][mask]. Kind 0 (Empty) is never drawn. */
  readonly canvases: (HTMLCanvasElement | null)[][];
}

/**
 * Build every tile variant for a theme, once, at room load.
 *
 * 2 kinds x 16 masks = 32 small canvases. Blitting a prepared canvas is an order of
 * magnitude cheaper than per-pixel work in the draw loop, and the draw loop runs 60
 * times a second over 896 cells.
 */
export function buildTileSet(theme: Theme): TileSet {
  const pal = themePalette(theme);
  const canvases: (HTMLCanvasElement | null)[][] = [];

  for (let kind = 0; kind <= Tile.Platform; kind++) {
    const row: (HTMLCanvasElement | null)[] = [];
    for (let mask = 0; mask < 16; mask++) {
      if (kind === Tile.Empty) {
        row.push(null);
        continue;
      }
      const px = kind === Tile.Solid ? solidBlock(mask) : platform(mask);
      row.push(px.toCanvas(pal));
    }
    canvases.push(row);
  }

  return { canvases };
}
