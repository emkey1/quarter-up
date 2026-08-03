import { Devices } from '@/engine/devices';
import type { Bindings } from '@cabinet/keyboard';
import type { DpadActions, PadProfile } from '@cabinet/gamepad';
import { T } from '@/data/tuning';

/**
 * This game's action set.
 *
 * Deliberately small. A single-screen platformer needs left, right, jump and blow —
 * everything else is menu furniture. `up` and `down` exist only so the d-pad can drive
 * menus and so the pad's stick arbitration has a vertical axis to reason about; the
 * simulation never reads them.
 */
export type Action =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'jump'
  | 'blow'
  | 'pause'
  | 'mute'
  | 'confirm'
  | 'cancel';

export const ACTIONS: readonly Action[] = [
  'left',
  'right',
  'up',
  'down',
  'jump',
  'blow',
  'pause',
  'mute',
  'confirm',
  'cancel',
];

/** Physical-key codes (event.code), so layout never matters. */
export const DEFAULT_KEYS: Bindings<Action> = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  jump: ['Space', 'ArrowUp', 'KeyW'],
  blow: ['KeyJ', 'KeyZ', 'ControlLeft'],
  pause: ['KeyP', 'Escape'],
  mute: ['KeyM'],
  confirm: ['Enter', 'Space'],
  cancel: ['Escape'],
};

export const DPAD: DpadActions<Action> = {
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
};

/** W3C "standard" mapping. Anything reporting mapping === 'standard' gets this and
 *  Just Works; everything else falls through to the detection flow. */
export const STANDARD_PROFILE: PadProfile<Action> = {
  match: 'standard',
  label: 'Standard gamepad',
  moveStick: { x: 0, y: 1 },
  // Nothing to aim: you face where you walk, and bubbles go that way.
  aimStick: null,
  sources: {
    up: [{ kind: 'button', index: 12 }],
    down: [{ kind: 'button', index: 13 }],
    left: [{ kind: 'button', index: 14 }],
    right: [{ kind: 'button', index: 15 }],
    jump: [{ kind: 'button', index: 0 }], // A / cross
    blow: [
      { kind: 'button', index: 2 }, // X / square
      { kind: 'button', index: 7 }, // right trigger
    ],
    pause: [{ kind: 'button', index: 9 }], // start
    confirm: [{ kind: 'button', index: 0 }],
    cancel: [{ kind: 'button', index: 1 }],
    mute: [],
  },
};

/**
 * The only thing the simulation ever sees of an input device.
 *
 * Keyboard and gamepad both reduce to this before step(), so a keyboard replay and a
 * gamepad replay are the same artefact.
 */
export interface ActionState {
  /** -1, 0 or 1. There is no vertical movement axis — this is a platformer. */
  moveX: number;

  /** Jump is edge-triggered only. Holding it does nothing, because the jump is fixed
   *  height (T.JUMP_VELOCITY) and hold-to-jump-higher would break bubble riding. */
  jumpPressed: boolean;
  blow: boolean;
  blowPressed: boolean;

  pausePressed: boolean;
  mutePressed: boolean;
  confirmPressed: boolean;
  cancelPressed: boolean;
}

export function emptyActions(): ActionState {
  return {
    moveX: 0,
    jumpPressed: false,
    blow: false,
    blowPressed: false,
    pausePressed: false,
    mutePressed: false,
    confirmPressed: false,
    cancelPressed: false,
  };
}

export function createDevices(): Devices<Action> {
  return new Devices<Action>({
    actions: ACTIONS,
    keyDefaults: DEFAULT_KEYS,
    padConfig: {
      deadzone: T.PAD_DEADZONE,
      hysteresis: T.PAD_HYSTERESIS,
      triggerThreshold: T.PAD_TRIGGER_THRESHOLD,
    },
    padProfile: STANDARD_PROFILE,
    dpad: DPAD,
  });
}

/**
 * Reduce the devices to one frame's ActionState.
 *
 * Button *edges* are reported only on the first step of a frame, so one physical press
 * can never fire twice when the loop catches up on a backlog. That matters more here
 * than it did in Bracer: a doubled jump edge is a double jump.
 */
export function sampleActions(d: Devices<Action>, out: ActionState, stepIndex: number): ActionState {
  out.moveX = d.moveX('left', 'right');
  out.blow = d.held('blow');

  const firstStep = stepIndex === 0;
  out.jumpPressed = firstStep && d.pressed('jump');
  out.blowPressed = firstStep && d.pressed('blow');
  out.pausePressed = firstStep && d.pressed('pause');
  out.mutePressed = firstStep && d.pressed('mute');
  out.confirmPressed = firstStep && d.pressed('confirm');
  out.cancelPressed = firstStep && d.pressed('cancel');

  return out;
}
