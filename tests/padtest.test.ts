import { describe, it, expect, beforeEach } from 'vitest';
import { PadTest } from '@/ui/padtest';
import type { Input } from '@/engine/input';

/**
 * Regression guard for a bug that made the controller setup screen appear completely
 * dead: the toggle key was handled BOTH by the caller and by PadTest.update(), so a
 * single press opened and then closed the overlay inside one frame.
 *
 * The invariant: PadTest.update() must never act on the toggle key. The caller owns it.
 */

class FakeKeyboard {
  private pressed = new Set<string>();
  press(...codes: string[]): void {
    this.pressed = new Set(codes);
  }
  wasCodePressed(code: string): boolean {
    return this.pressed.has(code);
  }
}

function fakeInput(kb: FakeKeyboard): Input {
  return {
    keyboard: kb,
    gamepad: {
      detect: () => null,
      beginDetect: () => {},
      activePad: () => null,
      profiles: {},
      bindAction: () => {},
      resetProfile: () => {},
    },
  } as unknown as Input;
}

describe('PadTest', () => {
  let pt: PadTest;
  let kb: FakeKeyboard;
  let input: Input;

  beforeEach(() => {
    pt = new PadTest();
    kb = new FakeKeyboard();
    input = fakeInput(kb);
  });

  it('does not close itself when the toggle key is still down this frame', () => {
    // Simulates one frame: the caller toggled it open, then calls update() with the
    // SAME keypress still latched. This is the exact sequence that broke it.
    pt.toggle();
    expect(pt.open).toBe(true);
    kb.press('KeyG');
    pt.update(input);
    expect(pt.open).toBe(true);
  });

  it('toggles open and closed across two separate presses', () => {
    pt.toggle();
    expect(pt.open).toBe(true);
    pt.toggle();
    expect(pt.open).toBe(false);
  });

  it('closes on Escape', () => {
    pt.toggle();
    kb.press('Escape');
    pt.update(input);
    expect(pt.open).toBe(false);
  });

  it('consumes input while open so the world does not step', () => {
    expect(pt.update(input)).toBe(false);
    pt.toggle();
    expect(pt.update(input)).toBe(true);
  });

  it('Escape cancels a pending rebind rather than closing the screen', () => {
    pt.toggle();
    kb.press('Enter');
    pt.update(input); // now awaiting a control
    kb.press('Escape');
    pt.update(input);
    expect(pt.open).toBe(true); // cancelled the bind, stayed open
    kb.press('Escape');
    pt.update(input);
    expect(pt.open).toBe(false); // second Escape closes
  });

  it('moves the cursor with the arrow keys', () => {
    pt.toggle();
    const first = (pt as unknown as { cursor: number }).cursor;
    kb.press('ArrowDown');
    pt.update(input);
    expect((pt as unknown as { cursor: number }).cursor).toBe(first + 1);
  });
});
