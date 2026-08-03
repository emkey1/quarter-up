import type { Bindings } from '@cabinet/keyboard';
import type { PadProfile, DpadActions } from '@cabinet/gamepad';

/**
 * What Undermine's controls are. Four directions and one button.
 *
 * The whole reason this game was chosen: it is comfortable on a keyboard and needs no
 * pad at all. Pad support is a nice-to-have here rather than a requirement.
 */
export const ACTION_NAMES = ['up', 'down', 'left', 'right', 'pump', 'pause', 'confirm', 'cancel'] as const;
export type Action = (typeof ACTION_NAMES)[number];

export type KeyBindings = Bindings<Action>;

/**
 * Physical-key codes (event.code), so keyboard layout never matters.
 *
 * Bracer's lesson, applied rather than relearned: no action sits on a bare modifier, and
 * every key here with a browser default of its own is in the cabinet's swallow list.
 */
export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  pump: ['Space', 'KeyJ'],
  pause: ['KeyP', 'Escape'],
  confirm: ['Enter', 'Space'],
  cancel: ['Escape'],
};

export const STANDARD_PROFILE: PadProfile<Action> = {
  match: 'standard',
  label: 'Standard gamepad',
  moveStick: { x: 0, y: 1 },
  aimStick: null, // nothing to aim: the pump fires along the way you face
  sources: {
    up: [{ kind: 'button', index: 12 }],
    down: [{ kind: 'button', index: 13 }],
    left: [{ kind: 'button', index: 14 }],
    right: [{ kind: 'button', index: 15 }],
    pump: [
      { kind: 'button', index: 0 },
      { kind: 'button', index: 7 },
    ],
    pause: [{ kind: 'button', index: 9 }],
    confirm: [{ kind: 'button', index: 0 }],
    cancel: [{ kind: 'button', index: 1 }],
  },
};

export const DPAD: DpadActions<Action> = { up: 'up', down: 'down', left: 'left', right: 'right' };
