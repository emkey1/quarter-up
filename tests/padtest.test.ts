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

class FakeGamepad {
  /** null = nothing held. */
  held: { kind: 'button'; index: number } | null = null;
  bound: string[] = [];
  profiles: Record<string, unknown> = {};

  detect() {
    return this.held ? { padId: 'fake', padIndex: 0, source: this.held } : null;
  }
  anyControlActive() {
    return this.held !== null;
  }
  beginDetect() {}
  activePad() {
    return null;
  }
  bindAction(_padId: string, action: string) {
    this.bound.push(action);
  }
  resetProfile() {}
}

function fakeInput(kb: FakeKeyboard, gp: FakeGamepad = new FakeGamepad()): Input {
  return { keyboard: kb, gamepad: gp } as unknown as Input;
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

  describe('auto-map walkthrough', () => {
    const ACTIONS = ['up', 'down', 'left', 'right', 'fire', 'magic', 'faceLock', 'pause'];

    function startAutoMap(): { pt: PadTest; gp: FakeGamepad; kb: FakeKeyboard; input: Input } {
      const gp = new FakeGamepad();
      const kb = new FakeKeyboard();
      const input = fakeInput(kb, gp);
      const pt = new PadTest();
      pt.toggle();
      // cursor to the auto-map row (one past the last bindable action)
      for (let i = 0; i < ACTIONS.length; i++) {
        kb.press('ArrowDown');
        pt.update(input);
      }
      kb.press('Enter');
      pt.update(input);
      kb.press();
      return { pt, gp, kb, input };
    }

    it('does not let one held control bind every action at once', () => {
      const { pt, gp, input } = startAutoMap();
      gp.held = { kind: 'button', index: 3 };
      // Hold it down for many frames without ever releasing.
      for (let i = 0; i < 50; i++) pt.update(input);
      // It must still be waiting for a release, having bound nothing.
      expect(gp.bound).toEqual([]);
    });

    it('walks every action in order, one release-press cycle each', () => {
      const { pt, gp, input } = startAutoMap();
      for (let i = 0; i < ACTIONS.length; i++) {
        gp.held = null; // release
        pt.update(input);
        gp.held = { kind: 'button', index: i }; // press the control for this action
        pt.update(input);
      }
      expect(gp.bound).toEqual(ACTIONS);
    });

    it('can be abandoned with Escape without closing the screen', () => {
      const { pt, gp, kb, input } = startAutoMap();
      kb.press('Escape');
      pt.update(input);
      expect(pt.open).toBe(true);
      gp.held = { kind: 'button', index: 0 };
      pt.update(input);
      expect(gp.bound).toEqual([]); // no longer capturing
    });
  });

  it('moves the cursor with the arrow keys', () => {
    pt.toggle();
    const first = (pt as unknown as { cursor: number }).cursor;
    kb.press('ArrowDown');
    pt.update(input);
    expect((pt as unknown as { cursor: number }).cursor).toBe(first + 1);
  });
});
