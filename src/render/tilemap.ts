import { T } from '@/data/tuning';
import type { Camera } from '@/game/camera';
import { Terrain, Tile, TileFlag } from '@/game/terrain';
import type { Layout } from '@/engine/display';
import { hash32 } from '@/engine/rng';
import { blobIndex, neighbourMask } from './autotile';
import { AtlasRow, TileAtlas, tileCell } from './tileatlas';
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

    // Round the camera to whole device pixels; a fractional blit origin makes pixel art
    // shimmer as you walk.
    const camX = Math.round(cam.x * px);
    const camY = Math.round(cam.y * px);

    const c0 = Math.max(0, Math.floor(cam.x / T.TILE));
    const c1 = Math.min(T.GRID - 1, Math.floor((cam.x + T.VIEW_W) / T.TILE));
    const r0 = Math.max(0, Math.floor(cam.y / T.TILE));
    const r1 = Math.min(T.GRID - 1, Math.floor((cam.y + T.VIEW_H) / T.TILE));

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
        const variant = hash32(cx, cy, 'floor') % 4;

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

        const [row, col] = tileCell(tile, blob < 0 ? 0 : blob, doorOpen, variant);
        const [sx, sy, sw, sh] = this.atlas.src(row, col);
        ctx.drawImage(this.atlas.canvas, sx, sy, sw, sh, dx, dy, dstPx, dstPx);
      }
    }

    ctx.restore();
  }
}
