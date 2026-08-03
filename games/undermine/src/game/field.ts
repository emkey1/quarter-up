import { T, bandOf } from '@/data/tuning';

/**
 * The earth, and the tunnels cut through it.
 *
 * Adapted from Bracer's `terrain.ts` rather than written fresh, which was the bet in
 * DESIGN.md §7: a grid of cells that stop being solid is the same problem whether the
 * cells are walls you occasionally break or earth you mostly remove. What carried over
 * is the shape — flat typed arrays, a version counter, dirty tracking so the renderer
 * can re-cache only what changed. What did not is doors, traps, teleporters and blob
 * flags, none of which exist here.
 *
 * The inversion worth stating: in Bracer the terrain is authored and the player learns
 * it. Here the player *writes* it, every frame, and has to live in what they cut.
 */

export const enum Cell {
  /** Solid earth. The default state of nearly the whole field. */
  Earth = 0,
  /** Cut away. Walkable, and the only place most things travel. */
  Tunnel = 1,
  /** Open air above the earth line. Walkable, never diggable, never re-fills. */
  Sky = 2,
}

export class Field {
  readonly cells: Uint8Array;
  /** Bumped whenever a cell changes, so the renderer knows to re-autotile. */
  version = 0;
  /** Cell indices changed since the renderer last synced. */
  readonly dirty: number[] = [];

  constructor() {
    this.cells = new Uint8Array(T.GRID_W * T.GRID_H);
    for (let cy = 0; cy < T.GRID_H; cy++) {
      const row = cy < T.SKY_ROWS ? Cell.Sky : Cell.Earth;
      for (let cx = 0; cx < T.GRID_W; cx++) this.cells[this.idx(cx, cy)] = row;
    }
  }

  idx(cx: number, cy: number): number {
    return cy * T.GRID_W + cx;
  }

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < T.GRID_W && cy < T.GRID_H;
  }

  at(cx: number, cy: number): Cell {
    // Out of bounds reads as earth, so nothing walks off the edge of the world. The sky
    // rows are the only opening, and they are inside the grid.
    if (!this.inBounds(cx, cy)) return Cell.Earth;
    return this.cells[this.idx(cx, cy)] as Cell;
  }

  /** Can a body occupy this cell without digging? */
  isOpen(cx: number, cy: number): boolean {
    const c = this.at(cx, cy);
    return c === Cell.Tunnel || c === Cell.Sky;
  }

  /** Which band a cell sits in, 0 (shallow) to 3 (deep), or -1 for sky. Scoring reads
   *  this, which is why depth is worth money and why it lives here. */
  bandAt(cy: number): number {
    return bandOf(cy);
  }

  /**
   * Cut a cell open. Returns true if it actually changed anything.
   *
   * Sky is never converted: it is already open, and turning it into Tunnel would make
   * the escape strip autotile as though it had been dug, which it has not.
   */
  dig(cx: number, cy: number): boolean {
    if (!this.inBounds(cx, cy)) return false;
    const i = this.idx(cx, cy);
    if (this.cells[i] !== Cell.Earth) return false;
    this.cells[i] = Cell.Tunnel;
    this.markDirty(i);
    return true;
  }

  private markDirty(i: number): void {
    this.version++;
    this.dirty.push(i);
  }

  clearDirty(): void {
    this.dirty.length = 0;
  }

  /** How much of the field has been cut away. The bonus and the difficulty ramp both
   *  want this eventually; it is here so nothing else has to walk the grid. */
  tunnelCount(): number {
    let n = 0;
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i] === Cell.Tunnel) n++;
    return n;
  }
}
