/**
 * What Bracer's controls actually are.
 *
 * The keyboard and gamepad devices themselves are shared with the other cabinets and
 * live in `@cabinet/*`. They are generic over the action set on purpose: the engine has
 * no opinion about what a game's actions are called, which is what let it move out. This
 * file is the other half — the vocabulary of actions, and what each device does to
 * produce them.
 */

import type { ActionName } from './actions';
import type { Bindings } from '@cabinet/keyboard';
import type { PadProfile, DpadActions } from '@cabinet/gamepad';

export type KeyBindings = Bindings<ActionName>;

/** Physical-key codes throughout (event.code), so layout never matters. */
export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  // Twin-stick aim (only read in that fire model); arrows double as aim when WASD moves.
  aimUp: ['ArrowUp'],
  aimDown: ['ArrowDown'],
  aimLeft: ['ArrowLeft'],
  aimRight: ['ArrowRight'],
  fire: ['Space', 'KeyJ'],
  /**
   * Enter, not Shift.
   *
   * Shift is a modifier, and a modifier is the wrong shape for an action key: held with
   * a direction it turns arrow keys into text selection, and five presses in a row makes
   * Windows offer to turn on Sticky Keys — mid-run, over the game. It also cannot be
   * reported honestly on a controls card, because "Shift" means two different physical
   * keys that behave differently under some OS accessibility settings.
   *
   * Enter overlaps `confirm` below, which is fine and already the established pattern:
   * Space is both fire and confirm. The two are never live at once — confirm is only
   * read by the menu screens, magic only during play.
   */
  magic: ['Enter', 'NumpadEnter', 'KeyK'],
  faceLock: ['AltLeft', 'AltRight', 'KeyL'],
  pause: ['KeyP', 'Escape'],
  mute: ['KeyM'],
  confirm: ['Enter', 'Space'],
  cancel: ['Escape'],
};

/**
 * W3C "standard" mapping. Anything reporting mapping === 'standard' gets this and
 * Just Works; everything else falls through to the detection flow (DESIGN.md §5.3).
 */
export const STANDARD_PROFILE: PadProfile<ActionName> = {
  match: 'standard',
  label: 'Standard gamepad',
  moveStick: { x: 0, y: 1 },
  aimStick: { x: 2, y: 3 },
  sources: {
    up: [{ kind: 'button', index: 12 }],
    down: [{ kind: 'button', index: 13 }],
    left: [{ kind: 'button', index: 14 }],
    right: [{ kind: 'button', index: 15 }],
    fire: [
      { kind: 'button', index: 0 }, // A / cross
      { kind: 'button', index: 7 }, // right trigger
    ],
    magic: [
      { kind: 'button', index: 1 }, // B / circle
      { kind: 'button', index: 6 }, // left trigger
    ],
    faceLock: [{ kind: 'button', index: 2 }], // X / square
    pause: [{ kind: 'button', index: 9 }], // start
    confirm: [{ kind: 'button', index: 0 }],
    cancel: [{ kind: 'button', index: 1 }],
    mute: [],
  },
};

/** Which of this game's actions mean "d-pad direction", so the pad can arbitrate
 *  between the hat and the stick. */
export const DPAD: DpadActions<ActionName> = {
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
};
