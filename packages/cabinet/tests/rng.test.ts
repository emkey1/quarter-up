import { describe, it, expect } from 'vitest';
import { Rng, hash32 } from '../src/rng';

/**
 * Determinism is load-bearing: the drift-path test in §12 asserts that a bubble released
 * at a fixed position follows an identical path every run, and the counter system in §8.3
 * has to be reproducible to be testable at all. If this file ever fails, those do too.
 */
describe('Rng', () => {
  it('produces the same stream from the same seed', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    for (let i = 0; i < 200; i++) expect(a.u32()).toBe(b.u32());
  });

  it('produces different streams from different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const sa = Array.from({ length: 16 }, () => a.u32());
    const sb = Array.from({ length: 16 }, () => b.u32());
    expect(sa).not.toEqual(sb);
  });

  it('survives a zero seed rather than locking to zero forever', () => {
    const r = new Rng(0);
    const vals = new Set(Array.from({ length: 32 }, () => r.u32()));
    expect(vals.size).toBeGreaterThan(1);
  });

  it('stays in range', () => {
    const r = new Rng(99);
    for (let i = 0; i < 500; i++) {
      const f = r.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = r.int(7);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
      const g = r.range(3, 5);
      expect(g).toBeGreaterThanOrEqual(3);
      expect(g).toBeLessThanOrEqual(5);
    }
  });

  it('round-trips its state, so a save can resume an identical stream', () => {
    const r = new Rng(7);
    for (let i = 0; i < 10; i++) r.u32();
    const snapshot = r.save();
    const expected = Array.from({ length: 10 }, () => r.u32());

    r.load(snapshot);
    expect(Array.from({ length: 10 }, () => r.u32())).toEqual(expected);
  });
});

describe('hash32', () => {
  it('is stable for the same inputs', () => {
    expect(hash32('room', 12)).toBe(hash32('room', 12));
  });

  it('separates inputs that concatenate to the same string', () => {
    // Without the per-part separator, ('a','bc') and ('ab','c') would collide — and
    // room ids plus indices are exactly the shape that trips that.
    expect(hash32('a', 'bc')).not.toBe(hash32('ab', 'c'));
  });
});
