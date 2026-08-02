/**
 * The only thing the simulation ever sees of an input device. See DESIGN.md §5.4.
 *
 * Keyboard and gamepad both reduce to this before step(), so a keyboard replay and a
 * gamepad replay are the same artefact.
 */
export interface ActionState {
  /** [-1, 1]. Exactly -1/0/1 unless `analogMovement` is enabled (a documented deviation). */
  moveX: number;
  moveY: number;
  /** Twin-stick aim. Equals facing when the fire model is not twin-stick. */
  aimX: number;
  aimY: number;

  fire: boolean;
  firePressed: boolean;
  magic: boolean;
  magicPressed: boolean;
  faceLock: boolean;

  pausePressed: boolean;
  mutePressed: boolean;
  confirmPressed: boolean;
  cancelPressed: boolean;
}

export function emptyActions(): ActionState {
  return {
    moveX: 0,
    moveY: 0,
    aimX: 0,
    aimY: 0,
    fire: false,
    firePressed: false,
    magic: false,
    magicPressed: false,
    faceLock: false,
    pausePressed: false,
    mutePressed: false,
    confirmPressed: false,
    cancelPressed: false,
  };
}

export type ActionName =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'aimUp'
  | 'aimDown'
  | 'aimLeft'
  | 'aimRight'
  | 'fire'
  | 'magic'
  | 'faceLock'
  | 'pause'
  | 'mute'
  | 'confirm'
  | 'cancel';

export const ACTION_NAMES: readonly ActionName[] = [
  'up',
  'down',
  'left',
  'right',
  'aimUp',
  'aimDown',
  'aimLeft',
  'aimRight',
  'fire',
  'magic',
  'faceLock',
  'pause',
  'mute',
  'confirm',
  'cancel',
];
