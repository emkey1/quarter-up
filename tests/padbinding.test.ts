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

  it('reads buttons reported as plain numbers instead of GamepadButton objects', () => {
    // Some engines return numbers here. `b.pressed || b.value >= 0.5` yields undefined
    // for both on a number, so every button reads as never-pressed: the pad enumerates
    // perfectly and no input ever arrives.
    install(makePad({ buttons: [0, 0, 0, 0, 0, 0, 0, 0] as unknown as readonly GamepadButton[] }));
    const g = new GamepadInput();
    g.poll();
    expect(g.status.connected).toBe(true);

    (pad.buttons as unknown as number[])[0] = 1;
    g.poll();
    expect(g.isHeld('fire')).toBe(true);

    g.beginDetect();
    expect(g.detect()?.source).toEqual({ kind: 'button', index: 0 });
  });

  it('reads buttons that expose pressed but no value', () => {
    install(
      makePad({
        buttons: Array.from({ length: 8 }, () => ({ pressed: false })) as unknown as readonly GamepadButton[],
      }),
    );
    const g = new GamepadInput();
    (pad.buttons as unknown as { pressed: boolean }[])[0] = { pressed: true };
    g.poll();
    expect(g.isHeld('fire')).toBe(true);
  });

  it('treats a pad with no `connected` property as usable', () => {
    // A missing property must not be read as "disconnected", or the pad enumerates in
    // diagnostics while every input path silently discards it.
    const p = makePad();
    delete (p as unknown as Record<string, unknown>).connected;
    install(p);
    const g = new GamepadInput();
    press(0);
    g.poll();
    expect(g.status.connected).toBe(true);
    expect(g.isHeld('fire')).toBe(true);
  });

  it('finds a controller sitting in slot 3 with slots 0-2 empty', () => {
    // The Gamepad API exposes four slots and a controller may land in any of them.
    setNavigator({ getGamepads: () => [null, null, null, pad] });
    const g = new GamepadInput();
    press(0);
    g.poll();
    expect(g.status.connected, 'a pad in slot 3 must still be found').toBe(true);
    expect(g.status.slot).toBe(3);
    expect(g.isHeld('fire')).toBe(true);
    expect(g.activePad()).toBe(pad);
  });

  it('survives a pad whose reported index does not match its array slot', () => {
    // Nothing in the spec ties Gamepad.index to the array position. Storing the
    // reported index and then indexing the array with it reads the wrong slot — the
    // live readout and the binding flow both go blind while the pad still enumerates.
    install(makePad({ index: 0 } as Partial<Gamepad>));
    setNavigator({ getGamepads: () => [null, null, pad] }); // reports 0, actually slot 2
    const g = new GamepadInput();
    press(0);
    g.poll();
    expect(g.status.connected).toBe(true);
    expect(g.status.slot, 'must track the real slot').toBe(2);
    expect(g.activePad(), 'activePad drives the live readout and detection').toBe(pad);
    expect(g.isHeld('fire')).toBe(true);

    g.beginDetect();
    expect(g.detect()?.source).toEqual({ kind: 'button', index: 0 });
  });

  it('prefers whichever of several pads is actually being touched', () => {
    const quiet = makePad({ id: 'Quiet Pad' });
    const busy = makePad({ id: 'Busy Pad' });
    setNavigator({ getGamepads: () => [quiet, busy] });
    const g = new GamepadInput();
    g.poll();
    expect(g.status.id).toBe('Quiet Pad'); // first usable wins by default

    (busy.buttons as unknown as { pressed: boolean; value: number }[])[5] = {
      pressed: true,
      value: 1,
    };
    g.poll();
    expect(g.status.id, 'activity should hand over').toBe('Busy Pad');
    expect(g.status.slot).toBe(1);
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
