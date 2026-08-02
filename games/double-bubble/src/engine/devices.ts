import type { PadConfig } from './config';
import { Keyboard, type Bindings } from './keyboard';
import { GamepadInput, type DpadActions, type PadProfile } from './gamepad';

export type DeviceKind = 'keyboard' | 'gamepad';

/**
 * Merges keyboard and gamepad into one set of action queries.
 *
 * Deliberately stops short of building a game-specific ActionState — the engine has no
 * idea whether this game has a jump button or a magic button. It answers "is action X
 * held / was it pressed", and the game assembles that into whatever shape its simulation
 * wants. See game/controls.ts.
 *
 * poll() runs once per rendered frame.
 */
export class Devices<A extends string> {
  readonly keyboard: Keyboard<A>;
  readonly gamepad: GamepadInput<A>;

  /** Which device the player last touched — drives HUD prompt glyphs. */
  lastDevice: DeviceKind = 'keyboard';

  constructor(opts: {
    actions: readonly A[];
    keyDefaults: Bindings<A>;
    padConfig: PadConfig;
    padProfile: PadProfile<A>;
    dpad: DpadActions<A>;
  }) {
    this.keyboard = new Keyboard(opts.actions, opts.keyDefaults);
    this.gamepad = new GamepadInput(opts.padConfig, opts.padProfile, opts.dpad);
  }

  attach(): void {
    this.keyboard.attach();
    this.gamepad.attach();
  }

  detach(): void {
    this.keyboard.detach();
    this.gamepad.detach();
  }

  poll(): void {
    this.keyboard.poll();
    this.gamepad.poll();

    if (this.gamepad.anyActivity()) this.lastDevice = 'gamepad';
    else if (this.keyboard.anyActivity()) this.lastDevice = 'keyboard';
  }

  held(action: A): boolean {
    return this.keyboard.held(action) || this.gamepad.isHeld(action);
  }

  pressed(action: A): boolean {
    return this.keyboard.pressed(action) || this.gamepad.isPressed(action);
  }

  /**
   * Horizontal movement from whichever device is providing it.
   *
   * The gamepad takes precedence while deflected, so a resting hand on the keyboard
   * cannot fight the stick.
   */
  moveX(left: A, right: A): number {
    if (this.gamepad.moveX !== 0) return this.gamepad.moveX;
    return (this.keyboard.held(right) ? 1 : 0) - (this.keyboard.held(left) ? 1 : 0);
  }

  moveY(up: A, down: A): number {
    if (this.gamepad.moveY !== 0) return this.gamepad.moveY;
    return (this.keyboard.held(down) ? 1 : 0) - (this.keyboard.held(up) ? 1 : 0);
  }
}
