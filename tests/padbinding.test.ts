import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GamepadInput } from '@/engine/gamepad';

/** Minimal fake Gamepad, shaped like the real thing. */
function makePad(over: Partial<Gamepad> & { id?: string } = {}): Gamepad {
  return {
    index: 0,
    id: 'Generic USB Arcade Stick',
    connected: true,
    mapping: '' as GamepadMappingType,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 12 }, () => ({ pressed: false, touched: false, value: 0 })),
    timestamp: 0,
    ...over,
  } as Gamepad;
}

let pad: Gamepad;

function setNavigator(value: unknown): void {
  // globalThis.navigator is an accessor in modern Node, so plain assignment throws.
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
}

function install(p: Gamepad): void {
  pad = p;
  setNavigator({ getGamepads: () => [pad] });
}

function press(i: number, down = true): void {
  (pad.buttons as unknown as { pressed: boolean; value: number }[])[i] = {
    pressed: down,
    value: down ? 1 : 0,
  };
}

function axis(i: number, v: number): void {
  (pad.axes as unknown as number[])[i] = v;
}

const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'navigator', original);
});

describe('non-standard pad rescue', () => {
  let gp: GamepadInput;

  beforeEach(() => {
    install(makePad());
    gp = new GamepadInput();
  });

  it('reports a non-standard pad as such rather than silently failing', () => {
    gp.poll();
    expect(gp.status.connected).toBe(true);
    expect(gp.status.standard).toBe(false);
  });

  it('reproduces the symptom: an unmapped button does nothing', () => {
    press(11);
    gp.poll();
    expect(gp.isHeld('fire')).toBe(false);
  });

  it('binds that button through the detection flow and then it works', () => {
    press(11);
    gp.beginDetect();
    const hit = gp.detect();
    expect(hit?.source).toEqual({ kind: 'button', index: 11 });

    gp.bindAction(hit!.padId, 'fire', hit!.source);
    gp.poll();
    expect(gp.isHeld('fire')).toBe(true);
  });

  it('does not mistake a stick returning to centre for a new deflection', () => {
    // Bind Right by pushing the stick right.
    gp.beginDetect();
    axis(2, 1);
    const right = gp.detect();
    expect(right?.source).toEqual({ kind: 'axis', index: 2, sign: 1 });
    gp.bindAction(right!.padId, 'right', right!.source);

    // Now begin the NEXT binding while the stick is still deflected, then release it
    // and push a different axis. The release must not be captured.
    gp.beginDetect();
    axis(2, 0); // released
    axis(3, 1); // deliberate new deflection
    const down = gp.detect();
    expect(down?.source).toEqual({ kind: 'axis', index: 3, sign: 1 });
  });

  it('promotes four axis bindings back to a quantised stick', () => {
    const bind = (action: 'left' | 'right' | 'up' | 'down', i: number, sign: number) => {
      gp.beginDetect();
      axis(0, 0);
      axis(1, 0);
      axis(2, 0);
      axis(3, 0);
      axis(i, sign);
      const hit = gp.detect();
      expect(hit, `${action} should detect axis ${i}`).toBeTruthy();
      gp.bindAction(hit!.padId, action, hit!.source);
    };
    bind('right', 2, 1);
    bind('left', 2, -1);
    bind('down', 3, 1);
    bind('up', 3, -1);

    expect(gp.profiles[pad.id]!.moveStick).toEqual({ x: 2, y: 3 });

    // And the promoted stick gets octant quantisation, not per-axis thresholding.
    axis(2, 0.72);
    axis(3, 0.69);
    gp.poll();
    expect([gp.moveX, gp.moveY]).toEqual([1, 1]);
  });

  it('drives movement from buttons when directions are bound to a d-pad', () => {
    const bind = (action: 'left' | 'right' | 'up' | 'down', btn: number) => {
      gp.beginDetect();
      press(btn);
      const hit = gp.detect();
      gp.bindAction(hit!.padId, action, hit!.source);
      press(btn, false);
    };
    bind('up', 4);
    bind('down', 5);
    bind('left', 6);
    bind('right', 7);

    expect(gp.profiles[pad.id]!.moveStick).toBeNull();
    press(7);
    gp.poll();
    expect([gp.moveX, gp.moveY]).toEqual([1, 0]);
  });

  it('finds a pad that never became active', () => {
    // The failure mode being fixed: binding must not require the pad to already be
    // the "active" one, because a pad that does nothing never becomes active.
    const fresh = new GamepadInput();
    press(3);
    fresh.beginDetect();
    expect(fresh.detect()?.source).toEqual({ kind: 'button', index: 3 });
  });
});
