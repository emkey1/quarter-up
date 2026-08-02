import { T } from '@/data/tuning';
import { Tile, tileAt, type RoomData } from '@/game/room';
import { Edge, TILE_PX, type TileSet } from './tiles';
import type { Layout } from '@/engine/display';
import type { Theme } from './theme';

/**
 * Draws a room.
 *
 * There is no camera: the room is exactly one screen, so world (0,0) is the top-left of
 * the playfield and every position is a straight multiply by layout.pxPerWu.
 */

/** Same-kind neighbour mask, for the bevel suppression in tiles.ts. */
export function edgeMask(room: RoomData, tx: number, ty: number): number {
  const kind = tileAt(room, tx, ty);
  let m = 0;
  if (tileAt(room, tx, ty - 1) === kind) m |= Edge.Up;
  if (tileAt(room, tx, ty + 1) === kind) m |= Edge.Down;
  if (tileAt(room, tx - 1, ty) === kind) m |= Edge.Left;
  if (tileAt(room, tx + 1, ty) === kind) m |= Edge.Right;
  return m;
}

export function drawRoom(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  room: RoomData,
  tiles: TileSet,
  theme: Theme,
): void {
  const { playfield, pxPerWu } = layout;

  // The tile art is authored at TILE * ART_SCALE; on screen a tile occupies
  // TILE * pxPerWu. The ratio is exactly `scale`, so this stays integral and the
  // nearest-neighbour blit never lands on a half pixel.
  const dest = T.TILE * pxPerWu;

  ctx.save();
  ctx.beginPath();
  ctx.rect(playfield.x, playfield.y, playfield.w, playfield.h);
  ctx.clip();

  drawBackdrop(ctx, playfield, theme);

  ctx.imageSmoothingEnabled = false;
  for (let ty = 0; ty < T.GRID_H; ty++) {
    for (let tx = 0; tx < T.GRID_W; tx++) {
      const kind = tileAt(room, tx, ty);
      if (kind === Tile.Empty) continue;
      const art = tiles.canvases[kind]?.[edgeMask(room, tx, ty)];
      if (!art) continue;
      ctx.drawImage(
        art,
        0,
        0,
        TILE_PX,
        TILE_PX,
        playfield.x + tx * dest,
        playfield.y + ty * dest,
        dest,
        dest,
      );
    }
  }

  ctx.restore();
}

/**
 * A faint diagonal weave behind the geometry.
 *
 * Flat black reads as "unfinished" at this scale; a barely-there pattern gives the room
 * depth without competing with the sprites that have to stay legible on top of it.
 */
function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  pf: { x: number; y: number; w: number; h: number },
  theme: Theme,
): void {
  ctx.fillStyle = theme.background;
  ctx.fillRect(pf.x, pf.y, pf.w, pf.h);

  ctx.fillStyle = theme.backdrop;
  const cell = Math.max(8, Math.round(pf.w / 32));
  for (let y = 0; y < pf.h; y += cell) {
    for (let x = 0; x < pf.w; x += cell) {
      if ((Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0) continue;
      ctx.fillRect(pf.x + x, pf.y + y, cell, cell);
    }
  }
}

/** Placeholder marker for the player start, until M1 puts a real body there. */
export function drawStartMarker(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  room: RoomData,
  frame: number,
): void {
  const { playfield, pxPerWu } = layout;
  const size = T.TILE * pxPerWu;
  const x = playfield.x + room.playerStart.x * size;
  const y = playfield.y + room.playerStart.y * size;

  const pulse = 0.55 + 0.45 * Math.sin(frame / 22);
  ctx.save();
  ctx.globalAlpha = pulse;
  ctx.fillStyle = '#6fe3c4';
  ctx.fillRect(x, y - size, size * 2, size * 2);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#0b1a16';
  ctx.lineWidth = Math.max(1, pxPerWu / 2);
  ctx.strokeRect(x, y - size, size * 2, size * 2);
  ctx.restore();
}
