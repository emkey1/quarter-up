import { describe, it, expect, vi, afterEach } from 'vitest';
import { Loop, type LoopHost } from '@/engine/loop';

/**
 * The loop's contract with input.
 *
 * Found in Double Bubble and present here too — see that game's copy of this test.
 * Bracer hid it because movement and fire are read as HELD; only edge-triggered actions
 * (pause, menu confirms, the setup and controller keys) were dropped.
 *
 * The cause is a cadence
 * mismatch rather than anything in the keyboard code: the simulation steps at 60Hz, but
 * `requestAnimationFrame` fires at the DISPLAY's rate. On a 120Hz panel — which every
 * recent Mac has — roughly every other frame accumulates less than one step's worth of
 * time and therefore runs ZERO steps.
 *
 * That matters because `poll()` moves "keys pressed since the last poll" into a
 * frame-local snapshot and clears the pending set. If no step runs, nothing reads the
 * snapshot, and the next poll overwrites it. The press is gone. Held keys are unaffected
 * — which is why movement felt fine and jump and fire did not.
 *
 * The invariant that fixes it: NEVER poll on a frame that will not step.
 */

/** Drives the loop with a synthetic clock and manual rAF, so cadence is exact. */
function harness(displayHz: number) {
  let now = 0;
  let pending: FrameRequestCallback | null = null;

  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    pending = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    pending = null;
  });

  const calls: string[] = [];
  const host: LoopHost = {
    poll: () => calls.push('poll'),
    step: () => calls.push('step'),
    draw: () => calls.push('draw'),
  };

  const loop = new Loop(host);
  loop.start();

  return {
    calls,
    /** Advance one display frame. */
    frame() {
      now += 1000 / displayHz;
      const cb = pending;
      pending = null;
      cb?.(now);
    },
    stop: () => loop.stop(),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('the frame loop', () => {
  it('never polls input on a frame that takes no simulation step', () => {
    // The whole bug in one assertion. A poll with no step behind it silently discards
    // whatever the player pressed during that frame.
    const h = harness(120);
    for (let i = 0; i < 60; i++) h.frame();
    h.stop();

    const polls = h.calls.filter((c) => c === 'poll').length;
    const steps = h.calls.filter((c) => c === 'step').length;
    expect(polls, 'more polls than steps means dropped input edges').toBeLessThanOrEqual(steps);

    // And structurally: every poll is immediately followed by at least one step.
    for (let i = 0; i < h.calls.length; i++) {
      if (h.calls[i] !== 'poll') continue;
      expect(h.calls[i + 1], `poll at ${i} was not followed by a step`).toBe('step');
    }
  });

  it('keeps polling at matched rates rather than starving input', () => {
    // The ordinary case must not regress. Not asserting one poll per frame: at 60Hz
    // against a 60Hz step the accumulator drifts by fractions of a millisecond, so the
    // odd frame takes none and the next takes two. That is correct, and demanding
    // steps === polls only encoded the float arithmetic of one particular run.
    const h = harness(60);
    for (let i = 0; i < 30; i++) h.frame();
    h.stop();
    const polls = h.calls.filter((c) => c === 'poll').length;
    const steps = h.calls.filter((c) => c === 'step').length;
    expect(polls, 'input is barely being sampled').toBeGreaterThan(25);
    expect(polls, 'a poll without a step drops the press').toBeLessThanOrEqual(steps);
  });

  it('polls once, not per step, when catching up on a slow frame', () => {
    // Two steps in one frame must still see ONE input snapshot, or an edge fires twice.
    const h = harness(20); // 50ms frames against a 16.7ms step
    for (let i = 0; i < 10; i++) h.frame();
    h.stop();
    const polls = h.calls.filter((c) => c === 'poll').length;
    const steps = h.calls.filter((c) => c === 'step').length;
    expect(steps).toBeGreaterThan(polls);
  });

  it('draws every frame even when it does not step', () => {
    // Rendering is not gated on stepping — at 120Hz half the frames only redraw, which
    // is exactly what interpolated motion needs.
    const h = harness(120);
    for (let i = 0; i < 20; i++) h.frame();
    h.stop();
    expect(h.calls.filter((c) => c === 'draw').length).toBe(20);
  });
});
