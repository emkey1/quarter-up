import { describe, it, expect } from 'vitest';
import { quantiseStick, buttonValue, padUsable, padAxes, padButtons } from '@/engine/gamepad';
import { T } from '@/data/tuning';

const DZ = T.PAD_DEADZONE;
const HY = T.PAD_HYSTERESIS;

describe('quantiseStick', () => {
  it('is neutral inside the deadzone', () => {
    expect(quantiseStick(0, 0, null, DZ, HY).octant).toBe(null);
    expect(quantiseStick(0.2, 0.1, null, DZ, HY).octant).toBe(null);
  });

  it('snaps to the eight compass directions', () => {
    expect(quantiseStick(1, 0, null, DZ, HY)).toMatchObject({ dx: 1, dy: 0 });
    expect(quantiseStick(-1, 0, null, DZ, HY)).toMatchObject({ dx: -1, dy: 0 });
    expect(quantiseStick(0, 1, null, DZ, HY)).toMatchObject({ dx: 0, dy: 1 });
    expect(quantiseStick(0, -1, null, DZ, HY)).toMatchObject({ dx: 0, dy: -1 });
    expect(quantiseStick(0.7, 0.7, null, DZ, HY)).toMatchObject({ dx: 1, dy: 1 });
  });

  /** Magnitude hysteresis: a thumb resting near the edge must not strobe. */
  it('releases at a lower magnitude than it engages', () => {
    const between = DZ - HY / 2;
    // Not enough to engage from neutral...
    expect(quantiseStick(between, 0, null, DZ, HY).octant).toBe(null);
    // ...but enough to stay engaged once latched.
    expect(quantiseStick(between, 0, 0, DZ, HY).octant).toBe(0);
  });

  /** Angular hysteresis: holding a diagonal must not flicker to a cardinal. */
  it('stays latched to an octant until the stick clears the boundary', () => {
    const justPastBoundary = quantiseStick(0.93, 0.38, 0, DZ, HY);
    expect(justPastBoundary.octant).toBe(0);
    // Well into the next octant, it does switch.
    expect(quantiseStick(0.7, 0.72, 0, DZ, HY).octant).toBe(1);
  });
});

/**
 * These guard the "pad enumerates perfectly but no input ever arrives" failure, which
 * is indistinguishable from a dead controller and was worth a lot of debugging in
 * Bracer. Engines have shipped every one of these shapes.
 */
describe('defensive pad reads', () => {
  it('reads a button whatever shape the engine returns', () => {
    expect(buttonValue(1)).toBe(1);
    expect(buttonValue(0.5)).toBe(0.5);
    expect(buttonValue({ pressed: true })).toBe(1);
    expect(buttonValue({ pressed: false })).toBe(0);
    expect(buttonValue({ value: 0.75 })).toBe(0.75);
    expect(buttonValue({ pressed: false, value: 0.9 })).toBe(0.9);
    expect(buttonValue(null)).toBe(0);
    expect(buttonValue(undefined)).toBe(0);
    expect(buttonValue({})).toBe(0);
  });

  it('treats a pad with no `connected` property as usable', () => {
    expect(padUsable({} as Gamepad)).toBe(true);
    expect(padUsable({ connected: true } as Gamepad)).toBe(true);
    expect(padUsable({ connected: false } as Gamepad)).toBe(false);
    expect(padUsable(null)).toBe(false);
    expect(padUsable(undefined)).toBe(false);
  });

  it('never indexes a missing axes or buttons array', () => {
    expect(padAxes({} as Gamepad)).toEqual([]);
    expect(padButtons({} as Gamepad)).toEqual([]);
  });
});
