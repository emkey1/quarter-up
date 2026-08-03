import { BLOB_COUNT } from './autotile';
import { PALETTE, TILE_PX, earthTile, tunnelTile, skyTile, diggerSprite, rockSprite } from './tilegen';
import { BLOB_INDEX } from './autotile';
import { T } from '@/data/tuning';

/**
 * Every tile the field can show, drawn once into one canvas at boot.
 *
 * Four bands times 47 blob cases is 188 earth tiles, which sounds like a lot until you
 * notice it is 188 * 32 * 32 pixels — under a megabyte, generated in a few milliseconds,
 * and then never touched again. Blitting from one canvas beats re-deriving a tile's
 * appearance per frame by a wide margin, and it is the same approach both other cabinets
 * settled on.
 */

export const AtlasRow = {
  /** Rows 0..3: earth, one per band, 47 blob cases across. */
  Earth: 0,
  /** Row 4: tunnel, one per band. */
  Tunnel: T.BANDS,
  /** Row 5: sky, then the digger facing four ways. */
  Misc: T.BANDS + 1,
} as const;

export const MISC = {
  sky: 0,
  diggerUp: 1,
  diggerRight: 2,
  diggerDown: 3,
  diggerLeft: 4,
  rock: 5,
  rockTeeter: 6,
  rockShatter: 7,
} as const;

export class TileAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly tilePx = TILE_PX;

  constructor() {
    const cols = Math.max(BLOB_COUNT, 8);
    const rows = AtlasRow.Misc + 1;
    this.canvas = document.createElement('canvas');
    this.canvas.width = cols * TILE_PX;
    this.canvas.height = rows * TILE_PX;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    ctx.imageSmoothingEnabled = false;

    // Earth: every band, every distinct neighbour configuration.
    for (const [mask, col] of BLOB_INDEX) {
      for (let band = 0; band < T.BANDS; band++) {
        earthTile(band, mask).blitTo(ctx, col * TILE_PX, (AtlasRow.Earth + band) * TILE_PX, PALETTE);
      }
    }

    for (let band = 0; band < T.BANDS; band++) {
      tunnelTile(band).blitTo(ctx, band * TILE_PX, AtlasRow.Tunnel * TILE_PX, PALETTE);
    }

    const misc = [
      skyTile(),
      diggerSprite(0),
      diggerSprite(1),
      diggerSprite(2),
      diggerSprite(3),
      rockSprite('rest'),
      rockSprite('teeter'),
      rockSprite('shatter'),
    ];
    misc.forEach((px, i) => px.blitTo(ctx, i * TILE_PX, AtlasRow.Misc * TILE_PX, PALETTE));
  }

  src(row: number, col: number): [number, number, number, number] {
    return [col * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX];
  }
}
