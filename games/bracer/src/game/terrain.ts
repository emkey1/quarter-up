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
  /** Remaining health of each breakable wall. 0 means "untouched", not "destroyed" —
   *  a cell is only ever read here while its tile is still Breakable. */
  private readonly damage: Uint8Array;
  /** Bumped whenever a tile changes, so the renderer knows to re-cache. */
  version = 0;
  /** Blocks changed since the renderer last synced. */
  readonly dirty: number[] = [];

  constructor() {
    this.tiles = new Uint8Array(T.GRID * T.GRID);
    this.flags = new Uint8Array(T.GRID * T.GRID);
    this.damage = new Uint8Array(T.GRID * T.GRID);
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

  /**
   * Blocks projectiles.
   *
   * A CLOSED door blocks shots; an open one does not. It used to block either way, so a
   * doorway you had just unlocked and could walk through was still a wall to your own
   * arrows — you could stand in the opening and be unable to shoot down the corridor you
   * had just paid a key to reach. Walls and breakables block regardless (shooting a
   * breakable is how you remove it), and out of bounds always blocks.
   */
  shotBlockedAtCell(cx: number, cy: number): boolean {
    if (!this.inBounds(cx, cy)) return true;
    const t = this.at(cx, cy);
    if (t === Tile.Door) return (this.flagsAt(cx, cy) & TileFlag.DoorOpen) === 0;
    return t === Tile.Wall || t === Tile.Breakable || t === Tile.Void;
  }

  /** World-unit position -> cell. */
  cellOf(wu: number): number {
    return Math.floor(wu / T.TILE);
  }

  solidAt(wx: number, wy: number): boolean {
    return this.solidAtCell(Math.floor(wx / T.TILE), Math.floor(wy / T.TILE));
  }

  isDoorClosed(cx: number, cy: number): boolean {
    return this.at(cx, cy) === Tile.Door && (this.flagsAt(cx, cy) & TileFlag.DoorOpen) === 0;
  }

  /**
   * Open every door tile touching (cx, cy).
   *
   * One key opens a whole door, however many tiles it spans — which is what makes a
   * door a flood-control gate rather than a toll booth. Orthogonal connectivity only.
   */
  openDoorGroup(cx: number, cy: number): number {
    if (!this.isDoorClosed(cx, cy)) return 0;
    const stack: [number, number][] = [[cx, cy]];
    let opened = 0;
    while (stack.length) {
      const [x, y] = stack.pop()!;
      if (!this.isDoorClosed(x, y)) continue;
      this.setFlag(x, y, TileFlag.DoorOpen);
      opened++;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return opened;
  }

  /** The 18s / 36s stalemate timer firing: every door in the level gives up at once. */
  openAllDoors(): number {
    let opened = 0;
    for (let cy = 0; cy < T.GRID; cy++) {
      for (let cx = 0; cx < T.GRID; cx++) {
        if (this.isDoorClosed(cx, cy)) {
          this.setFlag(cx, cy, TileFlag.DoorOpen);
          opened++;
        }
      }
    }
    return opened;
  }

  /**
   * Damage a breakable wall. Returns 'miss', 'hit' or 'destroyed'.
   *
   * A breakable takes several shots rather than one. That is how the original read — a
   * soft wall flashes under fire and comes down after a few hits — and it is what makes
   * one a decision rather than a free door: standing still to chip a wall is time your
   * health drain and everything on the level are charging you for.
   *
   * Damage is the shooter's shot strength, so the wall is a different obstacle depending
   * on who is holding the gun, exactly as generators already are. A Warrior punches
   * through; a Wizard takes longer and would rather go round.
   *
   * Health lives in `damage` rather than in the tile, because the tile byte is a Tile and
   * the flags byte is a bitfield; neither has room for a counter, and widening either to
   * carry one would put wall health in front of every tile lookup in the game.
   */
  hitBreakable(cx: number, cy: number, power: number): 'miss' | 'hit' | 'destroyed' {
    if (this.at(cx, cy) !== Tile.Breakable) return 'miss';
    const i = this.idx(cx, cy);
    const left = (this.damage[i] || T.BREAKABLE_HP) - Math.max(1, power);
    if (left <= 0) {
      this.damage[i] = 0;
      this.set(cx, cy, Tile.Floor);
      return 'destroyed';
    }
    this.damage[i] = left;
    this.markDirty(i);
    return 'hit';
  }

  /** How battered this wall looks, 0 (untouched) to 1 (about to go). Renderer only. */
  breakableWear(cx: number, cy: number): number {
    if (this.at(cx, cy) !== Tile.Breakable) return 0;
    const left = this.damage[this.idx(cx, cy)] || T.BREAKABLE_HP;
    return 1 - left / T.BREAKABLE_HP;
  }

  /** The 180-second stand-still trick: every wall in the level becomes an exit. */
  convertWallsToExits(): number {
    let n = 0;
    for (let cy = 0; cy < T.GRID; cy++) {
      for (let cx = 0; cx < T.GRID; cx++) {
        if (this.at(cx, cy) === Tile.Wall) {
          this.set(cx, cy, Tile.Exit);
          this.setFlag(cx, cy, TileFlag.WallBecameExit);
          n++;
        }
      }
    }
    return n;
  }

  cellsOf(tile: Tile): [number, number][] {
    const out: [number, number][] = [];
    for (let cy = 0; cy < T.GRID; cy++) {
      for (let cx = 0; cx < T.GRID; cx++) {
        if (this.at(cx, cy) === tile) out.push([cx, cy]);
      }
    }
    return out;
  }
}
