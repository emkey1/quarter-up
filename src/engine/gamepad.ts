import { T } from '@/data/tuning';
import type { ActionName } from './actions';

/* ------------------------------------------------------------------ stick quantisation */

/** Octant 0 = East, increasing clockwise (screen coords, +y down). */
const OCT_DX = [1, 1, 0, -1, -1, -1, 0, 1] as const;
const OCT_DY = [0, 1, 1, 1, 0, -1, -1, -1] as const;
const OCTANT = Math.PI / 4;

function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export interface StickResult {
  dx: number;
  dy: number;
  /** 0..7, or null when neutral. Feed back in as `prev` next call. */
  octant: number | null;
}

/**
 * Reduce an analog stick to the 8 compass directions the cabinet's digital stick had.
 *
 * Two separate hysteresis bands, because they fix two different chattering bugs:
 *   - magnitude: engages at `deadzone`, releases at `deadzone - hysteresis`, so resting
 *     a thumb near the edge doesn't strobe neutral/active.
 *   - angular: once an octant is latched, the stick must travel `hysteresis` of an octant
 *     PAST the boundary to switch, so holding a diagonal doesn't flicker between
 *     diagonal and cardinal.
 *
 * Pure function — no browser needed, so tests/input.test.ts can hit it directly.
 */
export function quantiseStick(
  x: number,
  y: number,
  prev: number | null,
  deadzone: number = T.PAD_DEADZONE,
  hysteresis: number = T.PAD_HYSTERESIS,
): StickResult {
  const mag = Math.hypot(x, y);

  const engageAt = deadzone;
  const releaseAt = Math.max(0, deadzone - hysteresis);
  if (prev === null ? mag < engageAt : mag < releaseAt) {
    return { dx: 0, dy: 0, octant: null };
  }

  const angle = Math.atan2(y, x);
  let oct = Math.round(angle / OCTANT) & 7;

  if (prev !== null && oct !== prev) {
    // Stay latched until we clear the boundary by the hysteresis margin.
    const margin = hysteresis * (OCTANT / 2);
    if (Math.abs(angleDiff(angle, prev * OCTANT)) <= OCTANT / 2 + margin) oct = prev;
  }

  return { dx: OCT_DX[oct], dy: OCT_DY[oct], octant: oct };
}

/** Radial deadzone with rescaling, for the opt-in `analogMovement` deviation. */
export function analogStick(x: number, y: number, deadzone: number = T.PAD_DEADZONE): StickResult {
  const mag = Math.hypot(x, y);
  if (mag < deadzone) return { dx: 0, dy: 0, octant: null };
  const scaled = Math.min(1, (mag - deadzone) / (1 - deadzone));
  return { dx: (x / mag) * scaled, dy: (y / mag) * scaled, octant: null };
}

/* ------------------------------------------------------------------ profiles */

export type PadSource =
  | { kind: 'button'; index: number }
  | { kind: 'axis'; index: number; sign: 1 | -1; threshold?: number }
  | { kind: 'hat'; index: number; value: number; epsilon?: number };

export interface PadProfile {
  /** Matcher: a substring of Gamepad.id, or 'standard' for the W3C standard mapping. */
  match: string;
  label: string;
  moveStick: { x: number; y: number } | null;
  aimStick: { x: number; y: number } | null;
  sources: Partial<Record<ActionName, PadSource[]>>;
}

/**
 * W3C "standard" mapping. Anything reporting mapping === 'standard' gets this and
 * Just Works; everything else falls through to the detection flow (DESIGN.md §5.3).
 */
export const STANDARD_PROFILE: PadProfile = {
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

const DPAD_ACTIONS: ActionName[] = ['up', 'down', 'left', 'right'];

/* ------------------------------------------------------------------ device */

export interface PadStatus {
  connected: boolean;
  id: string;
  label: string;
  standard: boolean;
  index: number;
}

export class GamepadInput {
  profile: PadProfile = STANDARD_PROFILE;
  /** Per-device-id overrides captured through the Options detection flow. */
  profiles: Record<string, PadProfile> = {};

  analogMovement = false;
  rumbleEnabled = false;

  private activeIndex = -1;
  private held = new Map<ActionName, boolean>();
  private prevHeld = new Map<ActionName, boolean>();
  private moveOct: number | null = null;
  private aimOct: number | null = null;

  moveX = 0;
  moveY = 0;
  aimX = 0;
  aimY = 0;

  status: PadStatus = { connected: false, id: '', label: '', standard: false, index: -1 };
  /** Set for a few seconds after a connect/disconnect so the HUD can toast it. */
  statusChangedAt = -1;

  private detectBaseline: number[] | null = null;

  attach(): void {
    window.addEventListener('gamepadconnected', this.onConnect);
    window.addEventListener('gamepaddisconnected', this.onDisconnect);
  }

  detach(): void {
    window.removeEventListener('gamepadconnected', this.onConnect);
    window.removeEventListener('gamepaddisconnected', this.onDisconnect);
  }

  private onConnect = (e: GamepadEvent): void => {
    if (this.activeIndex < 0) this.activeIndex = e.gamepad.index;
    this.statusChangedAt = performance.now();
  };

  private onDisconnect = (e: GamepadEvent): void => {
    if (this.activeIndex === e.gamepad.index) this.activeIndex = -1;
    this.statusChangedAt = performance.now();
  };

  private pads(): (Gamepad | null)[] {
    return typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  }

  /** Called exactly once per rendered frame. */
  poll(): void {
    const pads = this.pads();

    // Pick the pad the player is actually touching; fall back to the first connected.
    let pad = this.activeIndex >= 0 ? pads[this.activeIndex] : null;
    if (!pad || !pad.connected) {
      pad = null;
      this.activeIndex = -1;
    }
    for (const p of pads) {
      if (!p || !p.connected) continue;
      if (!pad) {
        pad = p;
        this.activeIndex = p.index;
      } else if (p.index !== this.activeIndex && hasActivity(p)) {
        pad = p;
        this.activeIndex = p.index;
        this.statusChangedAt = performance.now();
      }
    }

    this.prevHeld = this.held;
    this.held = new Map();

    if (!pad) {
      if (this.status.connected) this.statusChangedAt = performance.now();
      this.status = { connected: false, id: '', label: '', standard: false, index: -1 };
      this.moveX = this.moveY = this.aimX = this.aimY = 0;
      this.moveOct = this.aimOct = null;
      return;
    }

    const standard = pad.mapping === 'standard';
    this.profile = this.profiles[pad.id] ?? STANDARD_PROFILE;
    this.status = {
      connected: true,
      id: pad.id,
      label: this.profiles[pad.id]?.label ?? (standard ? 'Standard gamepad' : pad.id),
      standard,
      index: pad.index,
    };

    for (const [action, sources] of Object.entries(this.profile.sources) as [
      ActionName,
      PadSource[],
    ][]) {
      this.held.set(action, sources.some((s) => readSource(pad, s)));
    }

    // D-pad wins over the stick whenever it is touched, so the two never fight.
    const dpad = DPAD_ACTIONS.some((a) => this.held.get(a));
    if (dpad) {
      this.moveX = (this.held.get('right') ? 1 : 0) - (this.held.get('left') ? 1 : 0);
      this.moveY = (this.held.get('down') ? 1 : 0) - (this.held.get('up') ? 1 : 0);
      this.moveOct = null;
    } else if (this.profile.moveStick) {
      const ax = pad.axes[this.profile.moveStick.x] ?? 0;
      const ay = pad.axes[this.profile.moveStick.y] ?? 0;
      const r = this.analogMovement
        ? analogStick(ax, ay)
        : quantiseStick(ax, ay, this.moveOct);
      this.moveX = r.dx;
      this.moveY = r.dy;
      this.moveOct = r.octant;
    } else {
      this.moveX = this.moveY = 0;
    }

    if (this.profile.aimStick) {
      const ax = pad.axes[this.profile.aimStick.x] ?? 0;
      const ay = pad.axes[this.profile.aimStick.y] ?? 0;
      const r = quantiseStick(ax, ay, this.aimOct);
      this.aimX = r.dx;
      this.aimY = r.dy;
      this.aimOct = r.octant;
    }
  }

  isHeld(action: ActionName): boolean {
    return this.held.get(action) === true;
  }

  isPressed(action: ActionName): boolean {
    return this.held.get(action) === true && this.prevHeld.get(action) !== true;
  }

  anyActivity(): boolean {
    if (this.moveX !== 0 || this.moveY !== 0) return true;
    for (const v of this.held.values()) if (v) return true;
    return false;
  }

  /* --------------------------------------------------------------- binding detection */

  /**
   * Options flow: "press the control you want". Snapshot the resting axis values first
   * (triggers commonly rest at -1, hats at some odd constant), then report the first
   * thing that moves. This is what makes arcade sticks and older pads bindable.
   */
  beginDetect(): void {
    const pad = this.activeIndex >= 0 ? this.pads()[this.activeIndex] : null;
    this.detectBaseline = pad ? Array.from(pad.axes) : null;
  }

  detect(): PadSource | null {
    const pad = this.activeIndex >= 0 ? this.pads()[this.activeIndex] : null;
    if (!pad) return null;

    for (let i = 0; i < pad.buttons.length; i++) {
      const b = pad.buttons[i];
      if (b && (b.pressed || b.value >= T.PAD_TRIGGER_THRESHOLD)) {
        return { kind: 'button', index: i };
      }
    }

    const base = this.detectBaseline;
    for (let i = 0; i < pad.axes.length; i++) {
      const v = pad.axes[i] ?? 0;
      const rest = base?.[i] ?? 0;
      if (Math.abs(v - rest) < 0.6) continue;
      // A hat reports as an axis that snaps to a set of odd constants rather than
      // sweeping; treat a non-extreme resting-offset value as a hat position.
      if (Math.abs(v) < 0.98 && Math.abs(v) > 0.02) {
        return { kind: 'hat', index: i, value: v, epsilon: 0.08 };
      }
      return { kind: 'axis', index: i, sign: v > 0 ? 1 : -1 };
    }
    return null;
  }

  /* --------------------------------------------------------------- rumble */

  rumble(duration: number, weak: number, strong: number): void {
    if (!this.rumbleEnabled || this.activeIndex < 0) return;
    const pad = this.pads()[this.activeIndex];
    const actuator = (pad as (Gamepad & { vibrationActuator?: GamepadHapticActuator }) | null)
      ?.vibrationActuator;
    if (!actuator?.playEffect) return;
    void actuator
      .playEffect('dual-rumble', {
        duration,
        strongMagnitude: strong,
        weakMagnitude: weak,
      })
      .catch(() => {
        /* not all browsers support dual-rumble; silently skip */
      });
  }
}

function readSource(pad: Gamepad, s: PadSource): boolean {
  switch (s.kind) {
    case 'button': {
      const b = pad.buttons[s.index];
      return !!b && (b.pressed || b.value >= T.PAD_TRIGGER_THRESHOLD);
    }
    case 'axis': {
      const v = pad.axes[s.index] ?? 0;
      return v * s.sign >= (s.threshold ?? T.PAD_DEADZONE);
    }
    case 'hat': {
      const v = pad.axes[s.index] ?? 0;
      return Math.abs(v - s.value) <= (s.epsilon ?? 0.08);
    }
  }
}

function hasActivity(pad: Gamepad): boolean {
  for (const b of pad.buttons) if (b.pressed || b.value >= T.PAD_TRIGGER_THRESHOLD) return true;
  for (const a of pad.axes) if (Math.abs(a) >= T.PAD_DEADZONE) return true;
  return false;
}
