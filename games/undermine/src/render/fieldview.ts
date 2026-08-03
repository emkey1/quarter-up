import type { Layout } from '@cabinet/display';
import { T, bandOf } from '@/data/tuning';
import { Cell, Field } from '@/game/field';
import { Digger } from '@/game/digger';
import { blobIndex, neighbourMask } from './autotile';
import { AtlasRow, MISC, TileAtlas } from './atlas';

/**
 * Draws the field.
 *
 * The blob masks are cached and rebuilt only when the field's version changes, which
 * matters more here than it did in Bracer: there, terrain changed a handful of times a
 * level, and here it changes on almost every frame the player is moving. Rebuilding 252
 * masks per frame would be affordable but pointless, and the version check makes a
 * standing-still frame free.
 */
export class FieldView {
  private readonly maskCache = new Int16Array(T.GRID_W * T.GRID_H);
  private cachedVersion = -1;

  constructor(private readonly atlas: TileAtlas) {}

  private refreshMasks(f: Field): void {
    if (f.version === this.cachedVersion) return;
    this.cachedVersion = f.version;
    // Sky is not earth, so the earth line autotiles as a proper surface rather than as
    // a seam between two kinds of solid.
    const isEarth = (x: number, y: number) =>
      !f.inBounds(x, y) ? y >= T.SKY_ROWS : f.at(x, y) === Cell.Earth;

    for (let cy = 0; cy < T.GRID_H; cy++) {
      for (let cx = 0; cx < T.GRID_W; cx++) {
        this.maskCache[f.idx(cx, cy)] =
          f.at(cx, cy) === Cell.Earth ? blobIndex(neighbourMask(cx, cy, isEarth)) : -1;
      }
    }
    f.clearDirty();
  }

  draw(ctx: CanvasRenderingContext2D, f: Field, digger: Digger, layout: Layout): void {
    this.refreshMasks(f);

    const pf = layout.playfield;
    const px = layout.pxPerWu;
    const dst = T.CELL * px;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.beginPath();
    ctx.rect(pf.x, pf.y, pf.w, pf.h);
    ctx.clip();

    for (let cy = 0; cy < T.GRID_H; cy++) {
      for (let cx = 0; cx < T.GRID_W; cx++) {
        const cell = f.at(cx, cy);
        const band = Math.max(0, bandOf(cy));
        const dx = pf.x + cx * dst;
        const dy = pf.y + cy * dst;

        let row: number;
        let col: number;
        if (cell === Cell.Sky) {
          row = AtlasRow.Misc;
          col = MISC.sky;
        } else if (cell === Cell.Tunnel) {
          row = AtlasRow.Tunnel;
          col = band;
        } else {
          row = AtlasRow.Earth + band;
          col = Math.max(0, this.maskCache[f.idx(cx, cy)]);
        }

        const [sx, sy, sw, sh] = this.atlas.src(row, col);
        ctx.drawImage(this.atlas.canvas, sx, sy, sw, sh, dx, dy, dst, dst);
      }
    }

    // The digger, drawn on top and positioned by its centre rather than its cell, so
    // motion between cells is smooth instead of stepping a whole tile at a time.
    const face = [MISC.diggerUp, MISC.diggerRight, MISC.diggerDown, MISC.diggerLeft];
    const [sx, sy, sw, sh] = this.atlas.src(AtlasRow.Misc, face[Math.max(0, digger.facing)]);
    ctx.drawImage(
      this.atlas.canvas,
      sx, sy, sw, sh,
      Math.round(pf.x + (digger.x - T.CELL / 2) * px),
      Math.round(pf.y + (digger.y - T.CELL / 2) * px),
      dst, dst,
    );

    ctx.restore();
  }
}
