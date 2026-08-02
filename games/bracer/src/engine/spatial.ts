import { T } from '@/data/tuning';

/**
 * Uniform-grid broadphase over the 512x512 world.
 *
 * Monsters block each other — that is what produces the traffic jams at chokepoints
 * that the original's tactics depend on — so monster-vs-monster queries run every frame
 * for every monster. Brute force would be ~90^2; this makes it ~9 buckets.
 */
export interface HasPos {
  x: number;
  y: number;
}

const CELL = T.TILE; // one bucket per block
const COLS = Math.ceil(T.WORLD / CELL);

export class SpatialGrid<Item extends HasPos> {
  private buckets: Item[][] = [];

  constructor() {
    for (let i = 0; i < COLS * COLS; i++) this.buckets.push([]);
  }

  clear(): void {
    for (const b of this.buckets) b.length = 0;
  }

  private index(x: number, y: number): number {
    const cx = Math.min(COLS - 1, Math.max(0, Math.floor(x / CELL)));
    const cy = Math.min(COLS - 1, Math.max(0, Math.floor(y / CELL)));
    return cy * COLS + cx;
  }

  insert(item: Item): void {
    this.buckets[this.index(item.x, item.y)].push(item);
  }

  rebuild(items: readonly Item[], accept: (i: Item) => boolean): void {
    this.clear();
    for (const it of items) if (accept(it)) this.insert(it);
  }

  /** Everything in the buckets overlapping a square of half-extent `radius`. */
  query(x: number, y: number, radius: number, out: Item[]): Item[] {
    out.length = 0;
    const c0 = Math.max(0, Math.floor((x - radius) / CELL));
    const c1 = Math.min(COLS - 1, Math.floor((x + radius) / CELL));
    const r0 = Math.max(0, Math.floor((y - radius) / CELL));
    const r1 = Math.min(COLS - 1, Math.floor((y + radius) / CELL));
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const b = this.buckets[cy * COLS + cx];
        for (let i = 0; i < b.length; i++) out.push(b[i]);
      }
    }
    return out;
  }
}
