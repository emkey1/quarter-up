import type { ActionState, ActionName } from './actions';
import { emptyActions, ACTION_NAMES } from './actions';
import { DEFAULT_KEY_BINDINGS, STANDARD_PROFILE, DPAD } from './controls';
import { PadLog } from './padlog';
import { Keyboard } from '@cabinet/keyboard';
import { GamepadInput } from '@cabinet/gamepad';
import { T } from '@/data/tuning';

export type DeviceKind = 'keyboard' | 'gamepad';

/**
 * Merges keyboard and gamepad into one ActionState. See DESIGN.md §5.4.
 *
 * poll() runs once per rendered frame; sample() may run several times (once per fixed
 * step). Button *edges* are reported only on the first step of a frame, so one physical
 * press can never fire twice when the loop catches up on a backlog.
 */
export class Input {
  readonly keyboard = new Keyboard<ActionName>(ACTION_NAMES, DEFAULT_KEY_BINDINGS);
  readonly gamepad = new GamepadInput<ActionName>(
    {
      deadzone: T.PAD_DEADZONE,
      hysteresis: T.PAD_HYSTERESIS,
      triggerThreshold: T.PAD_TRIGGER_THRESHOLD,
    },
    STANDARD_PROFILE,
    DPAD,
  );

  /** Persistent record of every pad ever seen — the diagnostic behind the pad-test
   *  screen. Attached to the device as an observer rather than living inside it. */
  readonly padLog = new PadLog();

  /** Which device the player last touched — drives the HUD prompt glyphs and the
   *  per-device fire-model default. */
  lastDevice: DeviceKind = 'keyboard';

  private readonly state: ActionState = emptyActions();

  attach(): void {
    this.keyboard.attach();
    this.gamepad.attach();
    this.gamepad.observer = this.padLog;
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

    const s = this.state;

    // --- movement: whichever device is providing input; gamepad takes precedence
    // while it is deflected, so a resting hand on the keyboard cannot fight the stick.
    const kx = (this.keyboard.held('right') ? 1 : 0) - (this.keyboard.held('left') ? 1 : 0);
    const ky = (this.keyboard.held('down') ? 1 : 0) - (this.keyboard.held('up') ? 1 : 0);
    if (this.gamepad.moveX !== 0 || this.gamepad.moveY !== 0) {
      s.moveX = this.gamepad.moveX;
      s.moveY = this.gamepad.moveY;
    } else {
      s.moveX = kx;
      s.moveY = ky;
    }

    // --- twin-stick aim (only read by that fire model)
    const ax = (this.keyboard.held('aimRight') ? 1 : 0) - (this.keyboard.held('aimLeft') ? 1 : 0);
    const ay = (this.keyboard.held('aimDown') ? 1 : 0) - (this.keyboard.held('aimUp') ? 1 : 0);
    if (this.gamepad.aimX !== 0 || this.gamepad.aimY !== 0) {
      s.aimX = this.gamepad.aimX;
      s.aimY = this.gamepad.aimY;
    } else {
      s.aimX = ax;
      s.aimY = ay;
    }

    s.fire = this.keyboard.held('fire') || this.gamepad.isHeld('fire');
    s.magic = this.keyboard.held('magic') || this.gamepad.isHeld('magic');
    s.faceLock = this.keyboard.held('faceLock') || this.gamepad.isHeld('faceLock');

    s.firePressed = this.keyboard.pressed('fire') || this.gamepad.isPressed('fire');
    s.magicPressed = this.keyboard.pressed('magic') || this.gamepad.isPressed('magic');
    s.pausePressed = this.keyboard.pressed('pause') || this.gamepad.isPressed('pause');
    s.mutePressed = this.keyboard.pressed('mute') || this.gamepad.isPressed('mute');
    s.confirmPressed = this.keyboard.pressed('confirm') || this.gamepad.isPressed('confirm');
    s.cancelPressed = this.keyboard.pressed('cancel') || this.gamepad.isPressed('cancel');
  }

  /**
   * The snapshot for one simulation step. Edges are suppressed on catch-up steps.
   * Returns a shared object — the simulation must not retain it across steps.
   */
  sample(stepIndex: number): Readonly<ActionState> {
    if (stepIndex === 0) return this.state;
    return {
      ...this.state,
      firePressed: false,
      magicPressed: false,
      pausePressed: false,
      mutePressed: false,
      confirmPressed: false,
      cancelPressed: false,
    };
  }
}

/* ------------------------------------------------------------------ fire models */

export type FireModel = 'arcade' | 'feathered' | 'free' | 'twinstick';

export const FIRE_MODELS: Record<
  FireModel,
  { label: string; note: string; leaderboard: 'eligible' | 'tagged' | 'ineligible' }
> = {
  arcade: {
    label: 'Arcade',
    note: 'Holding Fire roots you, exactly as the cabinet did. Tapping beats holding.',
    leaderboard: 'eligible',
  },
  feathered: {
    label: 'Feathered',
    note: `Roots you, but not for the first ${T.FIRE_FEATHER_FRAMES} frames of a press — a tap while running is free.`,
    leaderboard: 'tagged',
  },
  free: {
    label: 'Free fire',
    note: 'No rooting. Easier than the original.',
    leaderboard: 'ineligible',
  },
  twinstick: {
    label: 'Twin-stick',
    note: 'Move and aim independently. Substantially easier than the original.',
    leaderboard: 'ineligible',
  },
};

/**
 * Does the fire model suppress *translation* this step?
 *
 * Facing is never suppressed — you can always turn on the spot while firing. Without
 * that, Arcade is unplayable rather than merely demanding (DESIGN.md §5.2).
 *
 * `heldFrames` counts frames the current press has been held, including this one.
 * Returns false the instant the button is up, so release costs zero frames.
 */
export function fireRoots(model: FireModel, fireHeld: boolean, heldFrames: number): boolean {
  if (!fireHeld) return false;
  switch (model) {
    case 'arcade':
      return true;
    case 'feathered':
      return heldFrames > T.FIRE_FEATHER_FRAMES;
    case 'free':
    case 'twinstick':
      return false;
  }
}

/** Per-device default, per DESIGN.md §5.2. Settled for real by the M1 playtest gate. */
export function defaultFireModel(device: DeviceKind): FireModel {
  return device === 'gamepad' ? 'arcade' : 'feathered';
}
