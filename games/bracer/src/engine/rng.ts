/**
 * Seeded xorshift128. Deterministic and portable — the whole replay/testing story
 * (DESIGN.md §13) depends on this never using Math.random or Date.
 */
export class Rng {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;

  constructor(seed: number) {
    this.reseed(seed);
  }

  reseed(seed: number): void {
    // splitmix32 to spread a single 32-bit seed across the state
    let s = seed >>> 0;
    const next = (): number => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1;
  }

  /** Raw 32-bit unsigned. */
  u32(): number {
    const t = (this.b << 9) >>> 0;
    this.c = (this.c ^ this.a) >>> 0;
    this.d = (this.d ^ this.b) >>> 0;
    this.b = (this.b ^ this.c) >>> 0;
    this.a = (this.a ^ this.d) >>> 0;
    this.c = (this.c ^ t) >>> 0;
    this.d = ((this.d << 11) | (this.d >>> 21)) >>> 0;
    return this.d;
  }

  /** [0, 1) */
  float(): number {
    return this.u32() / 4294967296;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return n <= 0 ? 0 : this.u32() % n;
  }

  /** Integer in [lo, hi] inclusive. */
  range(lo: number, hi: number): number {
    return hi <= lo ? lo : lo + this.int(hi - lo + 1);
  }

  chance(p: number): boolean {
    return this.float() < p;
  }

  /** Snapshot/restore, so a save file can resume an identical stream. */
  save(): [number, number, number, number] {
    return [this.a, this.b, this.c, this.d];
  }

  load(s: readonly [number, number, number, number]): void {
    [this.a, this.b, this.c, this.d] = s;
  }
}

/** Stable 32-bit hash — used where a decision must be reproducible from identity
 *  rather than from stream position (e.g. rank-based food culling). */
export function hash32(...parts: (number | string)[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = typeof p === 'number' ? String(p) : p;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h = (h ^ 0x5f) >>> 0;
  }
  return h >>> 0;
}
