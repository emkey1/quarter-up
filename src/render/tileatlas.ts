import { T } from '@/data/tuning';
import { Tile } from '@/game/terrain';
import { BLOB_COUNT, NB } from './autotile';
import type { Theme } from './theme';

/**
 * Bakes every distinct tile appearance once at the current pixel scale, so the frame
 * loop is pure blitting. Rebuilt on layout change (pxPerWu is the only input that
 * matters) — cheap, and it keeps memory flat instead of caching a whole 512x512 world
 * at up to 6 device px per world unit.
 *
 * M0 draws procedurally. M4 replaces buildWall/buildFloor with atlas lookups; the
 * blob index and the rest of the pipeline are unchanged.
 */

export const enum AtlasRow {
  Wall = 0, // BLOB_COUNT columns
  Floor = 1, // 4 variants
  Misc = 2, // breakable, door closed, door open, exit, teleport, trap
}

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

  rebuild(theme: Theme, pxPerWu: number): void {
    this.theme = theme;
    this.tilePx = Math.max(1, Math.round(T.TILE * pxPerWu));
    const cols = Math.max(BLOB_COUNT, 8);
    this.canvas.width = cols * this.tilePx;
    this.canvas.height = 3 * this.tilePx;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (let i = 0; i < BLOB_COUNT; i++) {
      ctx.save();
      ctx.translate(i * this.tilePx, AtlasRow.Wall * this.tilePx);
      this.drawWall(ctx, i);
      ctx.restore();
    }
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.translate(i * this.tilePx, AtlasRow.Floor * this.tilePx);
      this.drawFloor(ctx, i);
      ctx.restore();
    }
    const miscDraw: ((c: CanvasRenderingContext2D) => void)[] = [
      (c) => this.drawBreakable(c),
      (c) => this.drawDoor(c, false),
      (c) => this.drawDoor(c, true),
      (c) => this.drawExit(c),
      (c) => this.drawTeleport(c),
      (c) => this.drawTrap(c),
    ];
    miscDraw.forEach((fn, i) => {
      ctx.save();
      ctx.translate(i * this.tilePx, AtlasRow.Misc * this.tilePx);
      fn(ctx);
      ctx.restore();
    });
  }

  /** Source rect for a baked cell. */
  src(row: AtlasRow, col: number): [number, number, number, number] {
    return [col * this.tilePx, row * this.tilePx, this.tilePx, this.tilePx];
  }

  /* ---------------------------------------------------------------- procedural art */

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

  private drawWall(ctx: CanvasRenderingContext2D, index: number): void {
    const s = this.tilePx;
    const th = this.theme;
    const m = this.maskForIndex(index);
    const bevel = Math.max(1, Math.round(s / 10));

    ctx.fillStyle = th.wallFace;
    ctx.fillRect(0, 0, s, s);

    // Outside edges get a lit/shadowed bevel; inside edges get a subtle seam. That
    // difference is what makes a wall run read as one structure rather than N cubes.
    ctx.fillStyle = th.wallLight;
    if (!(m & NB.N)) ctx.fillRect(0, 0, s, bevel);
    if (!(m & NB.W)) ctx.fillRect(0, 0, bevel, s);

    ctx.fillStyle = th.wallDark;
    if (!(m & NB.S)) ctx.fillRect(0, s - bevel, s, bevel);
    if (!(m & NB.E)) ctx.fillRect(s - bevel, 0, bevel, s);

    ctx.fillStyle = th.wallSeam;
    const seam = Math.max(1, Math.round(s / 22));
    if (m & NB.N) ctx.fillRect(0, 0, s, seam);
    if (m & NB.W) ctx.fillRect(0, 0, seam, s);

    // Inside corners: where two cardinals are filled but the diagonal is not, the
    // structure has a notch. Drawing it is most of why blob tiling looks "built".
    ctx.fillStyle = th.wallDark;
    const n = Math.max(1, Math.round(s / 6));
    if (m & NB.N && m & NB.E && !(m & NB.NE)) ctx.fillRect(s - n, 0, n, n);
    if (m & NB.S && m & NB.E && !(m & NB.SE)) ctx.fillRect(s - n, s - n, n, n);
    if (m & NB.S && m & NB.W && !(m & NB.SW)) ctx.fillRect(0, s - n, n, n);
    if (m & NB.N && m & NB.W && !(m & NB.NW)) ctx.fillRect(0, 0, n, n);
  }

  private drawFloor(ctx: CanvasRenderingContext2D, variant: number): void {
    const s = this.tilePx;
    const th = this.theme;
    ctx.fillStyle = th.floorAlt[variant % th.floorAlt.length] ?? th.floorBase;
    ctx.fillRect(0, 0, s, s);

    // brick courses
    ctx.fillStyle = th.floorLine;
    const line = Math.max(1, Math.round(s / 24));
    const half = Math.round(s / 2);
    ctx.fillRect(0, half - line, s, line);
    ctx.fillRect(0, s - line, s, line);
    const offset = variant % 2 === 0 ? 0 : half;
    ctx.fillRect((offset + half) % s, 0, line, half);
    ctx.fillRect(offset % s, half, line, half);
  }

  private drawBreakable(ctx: CanvasRenderingContext2D): void {
    const s = this.tilePx;
    const th = this.theme;
    ctx.fillStyle = th.breakable;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = th.breakableLight;
    const b = Math.max(1, Math.round(s / 10));
    ctx.fillRect(0, 0, s, b);
    ctx.fillRect(0, 0, b, s);
    // cracks, so "shootable" is legible without a legend
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = Math.max(1, s / 20);
    ctx.beginPath();
    ctx.moveTo(s * 0.2, 0);
    ctx.lineTo(s * 0.45, s * 0.5);
    ctx.lineTo(s * 0.3, s);
    ctx.moveTo(s * 0.45, s * 0.5);
    ctx.lineTo(s * 0.85, s * 0.65);
    ctx.stroke();
  }

  private drawDoor(ctx: CanvasRenderingContext2D, open: boolean): void {
    const s = this.tilePx;
    const th = this.theme;
    if (open) {
      this.drawFloor(ctx, 0);
      ctx.fillStyle = 'rgba(201,164,90,.25)';
      ctx.fillRect(0, 0, s, s);
      return;
    }
    ctx.fillStyle = th.door;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = th.doorLight;
    const b = Math.max(1, Math.round(s / 10));
    ctx.fillRect(0, 0, s, b);
    ctx.fillRect(0, 0, b, s);
    ctx.fillRect(s * 0.42, s * 0.3, s * 0.16, s * 0.4);
  }

  private drawExit(ctx: CanvasRenderingContext2D): void {
    const s = this.tilePx;
    const th = this.theme;
    ctx.fillStyle = th.exit;
    ctx.fillRect(0, 0, s, s);
    const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s * 0.55);
    g.addColorStop(0, th.exitGlow);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }

  private drawTeleport(ctx: CanvasRenderingContext2D): void {
    const s = this.tilePx;
    const th = this.theme;
    this.drawFloor(ctx, 2);
    const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s * 0.5);
    g.addColorStop(0, th.teleportGlow);
    g.addColorStop(0.6, th.teleport);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawTrap(ctx: CanvasRenderingContext2D): void {
    const s = this.tilePx;
    this.drawFloor(ctx, 1);
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.lineWidth = Math.max(1, s / 16);
    ctx.strokeRect(s * 0.18, s * 0.18, s * 0.64, s * 0.64);
  }
}

/** Which atlas cell renders a given tile? */
export function tileCell(
  tile: Tile,
  blob: number,
  doorOpen: boolean,
  floorVariant: number,
): [AtlasRow, number] {
  switch (tile) {
    case Tile.Wall:
      return [AtlasRow.Wall, blob];
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
      return [AtlasRow.Wall, blob];
    default:
      return [AtlasRow.Floor, floorVariant];
  }
}
