import { describe, it, expect } from 'vitest';
import { emptyActions, sampleActions, type Action } from '@/game/controls';
import type { Devices } from '@/engine/devices';

/**
 * A stand-in for Devices that reports whatever the test says.
 *
 * The real class attaches DOM listeners; the logic worth testing here is the reduction
 * to ActionState and the edge suppression, neither of which needs a browser.
 */
function fakeDevices(state: {
  held?: Partial<Record<Action, boolean>>;
  pressed?: Partial<Record<Action, boolean>>;
  moveX?: number;
}): Devices<Action> {
  return {
    held: (a: Action) => state.held?.[a] === true,
    pressed: (a: Action) => state.pressed?.[a] === true,
    moveX: () => state.moveX ?? 0,
    moveY: () => 0,
  } as unknown as Devices<Action>;
}

describe('sampleActions', () => {
  it('reduces held and pressed into the simulation state', () => {
    const d = fakeDevices({ moveX: -1, held: { blow: true }, pressed: { jump: true, blow: true } });
    const s = sampleActions(d, emptyActions(), 0);
    expect(s.moveX).toBe(-1);
    expect(s.blow).toBe(true);
    expect(s.jumpPressed).toBe(true);
    expect(s.blowPressed).toBe(true);
  });

  /**
   * The important one. When the loop catches up on a backlog it calls step() several
   * times for one poll; if edges fired on every step, one physical press would jump
   * twice. Held state must still be visible on catch-up steps — only edges are dropped.
   */
  it('fires edges only on the first step of a frame', () => {
    const d = fakeDevices({ held: { blow: true }, pressed: { jump: true, blow: true } });

    const first = sampleActions(d, emptyActions(), 0);
    expect(first.jumpPressed).toBe(true);
    expect(first.blowPressed).toBe(true);

    for (const step of [1, 2, 3, 4]) {
      const later = sampleActions(d, emptyActions(), step);
      expect(later.jumpPressed).toBe(false);
      expect(later.blowPressed).toBe(false);
      // ...but holding is not an edge, so it survives.
      expect(later.blow).toBe(true);
    }
  });

  it('suppresses menu edges on catch-up steps too', () => {
    const d = fakeDevices({ pressed: { pause: true, confirm: true, cancel: true, mute: true } });
    const later = sampleActions(d, emptyActions(), 1);
    expect(later.pausePressed).toBe(false);
    expect(later.confirmPressed).toBe(false);
    expect(later.cancelPressed).toBe(false);
    expect(later.mutePressed).toBe(false);
  });

  it('writes into the buffer it was given rather than allocating per step', () => {
    const buf = emptyActions();
    const d = fakeDevices({ moveX: 1 });
    expect(sampleActions(d, buf, 0)).toBe(buf);
  });
});
