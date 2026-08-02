import { T } from '@/data/tuning';
import type { Camera } from '@/game/camera';
import { Terrain, Tile, TileFlag } from '@/game/terrain';
import type { Layout } from '@/engine/display';
import { hash32 } from '@/engine/rng';
import { blobIndex, neighbourMask } from './autotile';
import { AtlasRow, FLOOR_VARIANTS, TileAtlas, tileCell, WALL_VARIANTS } from './tileatlas';
import type { Theme } from './theme';

/**
 * Blits the visible slice of the maze from the baked atlas.
 *
 * Only ~15x16 cells are ever on screen, so per-frame blitting beats caching a whole
 * 512x512 world at up to 6 device px per world unit (that would be a 3072^2 canvas).
 * The dirty-block machinery in Terrain still matters — it tells the *autotile* mask
 * cache when a door opens or a wall falls.
 */
export class TilemapRenderer {
  private atlas: TileAtlas;
  private maskCache: Int16Array;
  private cachedVersion = -1;

  constructor(theme: Theme, pxPerWu: number) {
    this.atlas = new TileAtlas(theme, pxPerWu);
    this.maskCache = new Int16Array(T.GRID * T.GRID).fill(-1);
  }

  onLayoutChange(theme: Theme, pxPerWu: number): void {
    this.atlas.rebuild(theme, pxPerWu);
  }

  private isWallFamily(t: Terrain, x: number, y: number): boolean {
    if (!t.inBounds(x, y)) return true; // beyond the level reads as more wall
    const tile = t.at(x, y);
    return tile === Tile.Wall || tile === Tile.Void;
  }

  private refreshMasks(t: Terrain): void {
    if (t.version === this.cachedVersion) return;
    this.cachedVersion = t.version;
    const same = (x: number, y: number) => this.isWallFamily(t, x, y);
    for (let cy = 0; cy < T.GRID; cy++) {
      for (let cx = 0; cx < T.GRID; cx++) {
        const tile = t.at(cx, cy);
        this.maskCache[t.idx(cx, cy)] =
          tile === Tile.Wall || tile === Tile.Void ? blobIndex(neighbourMask(cx, cy, same)) : -1;
      }
    }
    t.clearDirty();
  }

  draw(ctx: CanvasRenderingContext2D, t: Terrain, cam: Camera, layout: Layout): void {
    this.refreshMasks(t);

    const pf = layout.playfield;
    const px = layout.pxPerWu;
    // SOURCE is native (32px); DESTINATION is however many device pixels a 16wu block
    // occupies. Conflating the two put every tile in the wrong place and off-screen.
    void this.atlas.tilePx; // source size comes from src() below
    const dstPx = T.TILE * px;

    // Draw into WHATEVER rect we are given, centred on the camera. In play that rect is
    // exactly the locked gameplay viewport and the extras below are zero; the menus pass
    // a full-canvas rect so the dungeon fills the screen behind them instead of sitting
    // in a letterboxed column.
    const { originX, originY } = viewOrigin(cam, pf, px);
    const camX = Math.round(originX * px);
    const camY = Math.round(originY * px);

    const viewWu = pf.w / px;
    const viewHu = pf.h / px;
    const c0 = Math.max(0, Math.floor(originX / T.TILE));
    const c1 = Math.min(T.GRID - 1, Math.floor((originX + viewWu) / T.TILE));
    const r0 = Math.max(0, Math.floor(originY / T.TILE));
    const r1 = Math.min(T.GRID - 1, Math.floor((originY + viewHu) / T.TILE));

    ctx.save();
    ctx.imageSmoothingEnabled = false; // pixel art must never be interpolated
    ctx.beginPath();
    ctx.rect(pf.x, pf.y, pf.w, pf.h);
    ctx.clip();

    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const i = t.idx(cx, cy);
        const tile = t.at(cx, cy);
        const blob = this.maskCache[i];
        const doorOpen = (t.flags[i] & TileFlag.DoorOpen) !== 0;
        // Keyed by CELL, so a tile's appearance is a property of where it is and never
        // changes between frames or between runs.
        const variant = hash32(cx, cy, 'floor') % FLOOR_VARIANTS;
        const wallVariant = hash32(cx, cy, 'wall') % WALL_VARIANTS;

        const dx = pf.x + cx * dstPx - camX;
        const dy = pf.y + cy * dstPx - camY;

        // Everything sits on floor first, so partially transparent tiles (open doors,
        // teleport pads, traps) composite correctly.
        if (tile !== Tile.Wall && tile !== Tile.Void) {
          const [, fc] = [AtlasRow.Floor, variant] as const;
          const [sx, sy, sw, sh] = this.atlas.src(AtlasRow.Floor, fc);
          ctx.drawImage(this.atlas.canvas, sx, sy, sw, sh, dx, dy, dstPx, dstPx);
        }

        if (tile === Tile.Floor) continue;

        const [row, col] = tileCell(tile, blob < 0 ? 0 : blob, doorOpen, variant, wallVariant);
        const [sx, sy, sw, sh] = this.atlas.src(row, col);
        ctx.drawImage(this.atlas.canvas, sx, sy, sw, sh, dx, dy, dstPx, dstPx);
      }
    }

    ctx.restore();
  }
}

/**
 * Top-left of the world region a rect should show, in world units.
 *
 * In play the rect is exactly the locked gameplay viewport and this returns the camera
 * unchanged. The menus pass a bigger rect; clamping to the level bounds is what stops a
 * widened view sliding off the edge of the map and showing black margins.
 */
export function viewOrigin(
  cam: { x: number; y: number },
  pf: { w: number; h: number },
  px: number,
): { originX: number; originY: number } {
  const viewWu = pf.w / px;
  const viewHu = pf.h / px;
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(Math.max(0, hi), v));
  return {
    originX: clamp(cam.x + T.VIEW_W / 2 - viewWu / 2, T.WORLD - viewWu),
    originY: clamp(cam.y + T.VIEW_H / 2 - viewHu / 2, T.WORLD - viewHu),
  };
}
