import { describe, it, expect } from 'vitest';
import { T } from '@/data/tuning';
import { quantiseStick, analogStick } from '@/engine/gamepad';
import { fireRoots } from '@/engine/input';

describe('quantiseStick', () => {
  it('maps the eight compass directions', () => {
    const cases: [number, number, number, number][] = [
      [1, 0, 1, 0],
      [0.7, 0.7, 1, 1],
      [0, 1, 0, 1],
      [-0.7, 0.7, -1, 1],
      [-1, 0, -1, 0],
      [-0.7, -0.7, -1, -1],
      [0, -1, 0, -1],
      [0.7, -0.7, 1, -1],
    ];
    for (const [x, y, dx, dy] of cases) {
      const r = quantiseStick(x, y, null);
      expect([r.dx, r.dy], `stick (${x},${y})`).toEqual([dx, dy]);
    }
  });

  it('gives all eight directions an equal 45-degree wedge', () => {
    // Per-axis thresholding would make the diagonals far wider than the cardinals;
    // angle-based octants is what makes a stick feel like the cabinet's digital one.
    const counts = new Map<number, number>();
    for (let deg = 0; deg < 360; deg++) {
      const a = (deg * Math.PI) / 180;
      const r = quantiseStick(Math.cos(a), Math.sin(a), null);
      counts.set(r.octant!, (counts.get(r.octant!) ?? 0) + 1);
    }
    expect(counts.size).toBe(8);
    for (const n of counts.values()) expect(Math.abs(n - 45)).toBeLessThanOrEqual(1);
  });

  it('is neutral inside the deadzone', () => {
    const r = quantiseStick(0.2, 0.1, null);
    expect(r).toEqual({ dx: 0, dy: 0, octant: null });
  });

  it('holds a latched direction through the magnitude hysteresis band', () => {
    const mid = T.PAD_DEADZONE - T.PAD_HYSTERESIS / 2; // inside the band
    // Not engaged yet: too weak to start.
    expect(quantiseStick(mid, 0, null).octant).toBeNull();
    // Already engaged: stays engaged rather than strobing.
    expect(quantiseStick(mid, 0, 0).octant).toBe(0);
    // Below the release threshold it finally lets go.
    const below = T.PAD_DEADZONE - T.PAD_HYSTERESIS - 0.01;
    expect(quantiseStick(below, 0, 0).octant).toBeNull();
  });

  it('does not chatter when a stick rests on an octant boundary', () => {
    // 22.5 degrees is the E/SE boundary — the classic diagonal flicker.
    const a = Math.PI / 8;
    let oct: number | null = null;
    const seen = new Set<number | null>();
    for (let i = 0; i < 200; i++) {
      // jitter well under the hysteresis margin
      const j = (i % 2 === 0 ? 1 : -1) * 0.002;
      const r = quantiseStick(Math.cos(a + j), Math.sin(a + j), oct);
      oct = r.octant;
      seen.add(oct);
    }
    expect(seen.size).toBe(1);
  });

  it('still allows a deliberate change of direction', () => {
    let r = quantiseStick(1, 0, null);
    expect(r.octant).toBe(0);
    r = quantiseStick(0, 1, r.octant); // hard south
    expect(r.octant).toBe(2);
  });
});

describe('analogStick', () => {
  it('rescales past the deadzone so slow movement is reachable', () => {
    expect(analogStick(0.2, 0).dx).toBe(0);
    const r = analogStick(1, 0);
    expect(r.dx).toBeCloseTo(1, 5);
    const mid = analogStick(T.PAD_DEADZONE + (1 - T.PAD_DEADZONE) / 2, 0);
    expect(mid.dx).toBeGreaterThan(0.4);
    expect(mid.dx).toBeLessThan(0.6);
  });
});

describe('fireRoots', () => {
  it('arcade roots for as long as fire is held', () => {
    expect(fireRoots('arcade', true, 1)).toBe(true);
    expect(fireRoots('arcade', true, 999)).toBe(true);
  });

  it('release costs zero frames in every model', () => {
    for (const m of ['arcade', 'feathered', 'free', 'twinstick'] as const) {
      expect(fireRoots(m, false, 999), m).toBe(false);
    }
  });

  it('feathered gives a tap-while-running grace window, then roots', () => {
    for (let f = 1; f <= T.FIRE_FEATHER_FRAMES; f++) {
      expect(fireRoots('feathered', true, f), `frame ${f}`).toBe(false);
    }
    expect(fireRoots('feathered', true, T.FIRE_FEATHER_FRAMES + 1)).toBe(true);
  });

  it('free and twin-stick never root', () => {
    expect(fireRoots('free', true, 999)).toBe(false);
    expect(fireRoots('twinstick', true, 999)).toBe(false);
  });
});
