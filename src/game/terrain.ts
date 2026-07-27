import { T } from '@/data/tuning';

export const enum Tile {
  Floor = 0,
  Wall = 1,
  Breakable = 2,
  Door = 3,
  Exit = 4,
  Teleport = 5,
  Trap = 6,
  Void = 7,
}

/** Per-tile mutable flags, parallel to the tile array. */
export const enum TileFlag {
  None = 0,
  DoorOpen = 1 << 0,
  TrapTriggered = 1 << 1,
  /** Set when the 180s stillness timer converts walls to exits. */
  WallBecameExit = 1 << 2,
}

export const TILE_GLYPHS: Readonly<Record<string, Tile>> = {
  '.': Tile.Floor,
  X: Tile.Wall,
  x: Tile.Breakable,
  D: Tile.Door,
  E: Tile.Exit,
  '@': Tile.Teleport,
  '^': Tile.Trap,
  ' ': Tile.Void,
};

export class Terrain {
  readonly tiles: Uint8Array;
  readonly flags: Uint8Array;
  /** Bumped whenever a tile changes, so the renderer knows to re-cache. */
  version = 0;
  /** Blocks changed since the renderer last synced. */
  readonly dirty: number[] = [];

  constructor() {
    this.tiles = new Uint8Array(T.GRID * T.GRID);
    this.flags = new Uint8Array(T.GRID * T.GRID);
  }

  idx(cx: number, cy: number): number {
    return cy * T.GRID + cx;
  }

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < T.GRID && cy < T.GRID;
  }

  at(cx: number, cy: number): Tile {
    if (!this.inBounds(cx, cy)) return Tile.Void;
    return this.tiles[this.idx(cx, cy)] as Tile;
  }

  flagsAt(cx: number, cy: number): number {
    if (!this.inBounds(cx, cy)) return 0;
    return this.flags[this.idx(cx, cy)];
  }

  set(cx: number, cy: number, tile: Tile): void {
    if (!this.inBounds(cx, cy)) return;
    const i = this.idx(cx, cy);
    if (this.tiles[i] === tile) return;
    this.tiles[i] = tile;
    this.markDirty(i);
  }

  setFlag(cx: number, cy: number, flag: TileFlag): void {
    if (!this.inBounds(cx, cy)) return;
    const i = this.idx(cx, cy);
    if ((this.flags[i] & flag) === flag) return;
    this.flags[i] |= flag;
    this.markDirty(i);
  }

  private markDirty(i: number): void {
    this.version++;
    // Neighbours too: autotiling means one changed block restyles the ring around it.
    const cx = i % T.GRID;
    const cy = (i / T.GRID) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (this.inBounds(nx, ny)) this.dirty.push(this.idx(nx, ny));
      }
    }
  }

  clearDirty(): void {
    this.dirty.length = 0;
  }

  /** Blocks movement for players and monsters. */
  solidAtCell(cx: number, cy: number): boolean {
    if (!this.inBounds(cx, cy)) return true; // outside the level is solid
    const t = this.at(cx, cy);
    switch (t) {
      case Tile.Wall:
      case Tile.Breakable:
      case Tile.Void:
        return true;
      case Tile.Door:
        return (this.flagsAt(cx, cy) & TileFlag.DoorOpen) === 0;
      default:
        return false;
    }
  }

  /** Blocks projectiles. Doors block shots whether open or shut; walls obviously do. */
  shotBlockedAtCell(cx: number, cy: number): boolean {
    if (!this.inBounds(cx, cy)) return true;
    const t = this.at(cx, cy);
    return t === Tile.Wall || t === Tile.Breakable || t === Tile.Door || t === Tile.Void;
  }

  /** World-unit position -> cell. */
  cellOf(wu: number): number {
    return Math.floor(wu / T.TILE);
  }

  solidAt(wx: number, wy: number): boolean {
    return this.solidAtCell(Math.floor(wx / T.TILE), Math.floor(wy / T.TILE));
  }
}
