import { T } from '@/data/tuning';
import { Tile } from '@/game/terrain';
import { BLOB_COUNT, NB } from '@cabinet/autotile';
import type { Theme } from './theme';
import {
  TILE_PX,
  breakableTile,
  doorTile,
  exitTile,
  floorTile,
  teleportTile,
  themePalette,
  trapTile,
  wallTile,
} from './tilegen';

/**
 * Bakes every distinct tile appearance once at the current pixel scale, so the frame
 * loop is pure blitting. Rebuilt on layout change (pxPerWu is the only input that
 * matters) — cheap, and it keeps memory flat instead of caching a whole 512x512 world
 * at up to 6 device px per world unit.
 *
 * M0 draws procedurally. M4 replaces buildWall/buildFloor with atlas lookups; the
 * blob index and the rest of the pipeline are unchanged.
 */

/**
 * How many differently-weathered copies of each wall mask to bake.
 *
 * The atlas used to bake one tile per blob mask, always with salt 1, so every wall in the
 * game sharing a mask was pixel-identical. That was survivable when levels were mostly
 * open; at 27% wall coverage a screen holds dozens of them and the repeat is the first
 * thing you see. Three variants, chosen by cell position, breaks the pattern for the cost
 * of two extra atlas rows.
 */
export const WALL_VARIANTS = 3;
/** Floor stamps. Eight, because a level is 2000+ floor tiles and four reads as wallpaper. */
export const FLOOR_VARIANTS = 8;

/** Atlas rows. Walls occupy the first WALL_VARIANTS rows, one per weathering. */
export const AtlasRow = {
  Wall: 0,
  Floor: WALL_VARIANTS,
  Misc: WALL_VARIANTS + 1,
} as const;
export type AtlasRow = number;

export const MISC = {
  breakable: 0,
  doorClosed: 1,
  doorOpen: 2,
  exit: 3,
  teleport: 4,
  trap: 5,
} as const;

export class TileAtlas {
  canvas: HTMLCanvasElement;
  tilePx = 0;
  private theme: Theme;

  constructor(theme: Theme, pxPerWu: number) {
    this.theme = theme;
    this.canvas = document.createElement('canvas');
    this.rebuild(theme, pxPerWu);
  }

  /**
   * Bake at NATIVE resolution (32px per tile) and let the renderer scale up with
   * nearest-neighbour. Baking at display resolution was what made the old art smooth
   * and vector-ish; pixel art has to be authored at 1:1 or it is not pixel art.
   */
  rebuild(theme: Theme, _pxPerWu: number): void {
    this.theme = theme;
    this.tilePx = TILE_PX;
    const cols = Math.max(BLOB_COUNT, FLOOR_VARIANTS);
    this.canvas.width = cols * this.tilePx;
    this.canvas.height = (WALL_VARIANTS + 2) * this.tilePx;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const pal = themePalette(theme);
    for (let v = 0; v < WALL_VARIANTS; v++) {
      for (let i = 0; i < BLOB_COUNT; i++) {
        // Salt varies per variant AND per mask, so two variants of the same mask differ
        // and the same variant of two masks does not share its weathering either.
        wallTile(this.maskForIndex(i), 1 + v * 97 + i).blitTo(
          ctx,
          i * TILE_PX,
          (AtlasRow.Wall + v) * TILE_PX,
          pal,
        );
      }
    }
    for (let i = 0; i < FLOOR_VARIANTS; i++) {
      floorTile(i).blitTo(ctx, i * TILE_PX, AtlasRow.Floor * TILE_PX, pal);
    }
    const misc = [
      breakableTile(),
      doorTile(false),
      doorTile(true),
      exitTile(),
      teleportTile(),
      trapTile(),
    ];
    misc.forEach((px, i) => px.blitTo(ctx, i * TILE_PX, AtlasRow.Misc * TILE_PX, pal));
  }

  /** Source rect for a baked cell. */
  src(row: AtlasRow, col: number): [number, number, number, number] {
    return [col * this.tilePx, row * this.tilePx, this.tilePx, this.tilePx];
  }

  /** Reconstruct a representative mask for a blob index so the bevels read correctly. */
  private maskForIndex(index: number): number {
    // BLOB_INDEX maps reduced->index; invert lazily.
    if (!TileAtlas.inverse) {
      TileAtlas.inverse = new Map();
      // Rebuild by enumerating, same order the index was built in.
      const distinct = new Set<number>();
      for (let m = 0; m < 256; m++) {
        let r = m & (NB.N | NB.E | NB.S | NB.W);
        if (m & NB.NE && m & NB.N && m & NB.E) r |= NB.NE;
        if (m & NB.SE && m & NB.S && m & NB.E) r |= NB.SE;
        if (m & NB.SW && m & NB.S && m & NB.W) r |= NB.SW;
        if (m & NB.NW && m & NB.N && m & NB.W) r |= NB.NW;
        distinct.add(r);
      }
      [...distinct]
        .sort((a, b) => a - b)
        .forEach((v, i) => TileAtlas.inverse!.set(i, v));
    }
    return TileAtlas.inverse.get(index) ?? 0;
  }
  private static inverse: Map<number, number> | null = null;







}

/** Which atlas cell renders a given tile? */
export function tileCell(
  tile: Tile,
  blob: number,
  doorOpen: boolean,
  floorVariant: number,
  wallVariant = 0,
): [AtlasRow, number] {
  switch (tile) {
    case Tile.Wall:
      return [AtlasRow.Wall + (wallVariant % WALL_VARIANTS), blob];
    case Tile.Breakable:
      return [AtlasRow.Misc, MISC.breakable];
    case Tile.Door:
      return [AtlasRow.Misc, doorOpen ? MISC.doorOpen : MISC.doorClosed];
    case Tile.Exit:
      return [AtlasRow.Misc, MISC.exit];
    case Tile.Teleport:
      return [AtlasRow.Misc, MISC.teleport];
    case Tile.Trap:
      return [AtlasRow.Misc, MISC.trap];
    case Tile.Void:
      return [AtlasRow.Wall + (wallVariant % WALL_VARIANTS), blob];
    default:
      return [AtlasRow.Floor, floorVariant];
  }
}
