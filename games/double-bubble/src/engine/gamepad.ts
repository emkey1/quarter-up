import type { PadConfig } from './config';

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
 *   - angular: once an octant is latched, the stick must travel `hysteresis` of an
 *     octant PAST the boundary to switch, so holding a diagonal doesn't flicker.
 *
 * Pure function — no browser needed, so tests can hit it directly.
 */
export function quantiseStick(
  x: number,
  y: number,
  prev: number | null,
  deadzone: number,
  hysteresis: number,
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

/* ------------------------------------------------------------------ profiles */

export type PadSource =
  | { kind: 'button'; index: number }
  | { kind: 'axis'; index: number; sign: 1 | -1; threshold?: number }
  | { kind: 'hat'; index: number; value: number; epsilon?: number };

export interface PadProfile<A extends string> {
  /** Matcher: a substring of Gamepad.id, or 'standard' for the W3C standard mapping. */
  match: string;
  label: string;
  moveStick: { x: number; y: number } | null;
  sources: Partial<Record<A, PadSource[]>>;
}

/** The four action names that mean "d-pad direction", so the pad can arbitrate between
 *  the hat and the stick. The game names its own actions, so it has to say which. */
export interface DpadActions<A extends string> {
  up: A;
  down: A;
  left: A;
  right: A;
}

/* ------------------------------------------------------------------ device */

export interface PadStatus {
  connected: boolean;
  id: string;
  label: string;
  standard: boolean;
  /** The pad's self-reported index. Display only. */
  index: number;
  /** Where it actually sits in getGamepads(). This is what we index by. */
  slot: number;
}

export class GamepadInput<A extends string> {
  profile: PadProfile<A>;
  /** Per-device-id overrides captured through the Options detection flow. */
  profiles: Record<string, PadProfile<A>> = {};

  /**
   * ARRAY POSITION of the active pad in getGamepads(), not its reported `index`.
   *
   * These are normally identical but nothing in the spec ties them together, and every
   * lookup here is `pads[slot]`. Storing the reported index and indexing the array with
   * it silently reads the wrong slot — or null — whenever a pad reports an index that
   * does not match where the browser actually put it.
   */
  private activeSlot = -1;
  private held = new Map<A, boolean>();
  private prevHeld = new Map<A, boolean>();
  private moveOct: number | null = null;

  moveX = 0;
  moveY = 0;

  rumbleEnabled = false;

  status: PadStatus = { connected: false, id: '', label: '', standard: false, index: -1, slot: -1 };
  /** Set for a few seconds after a connect/disconnect so the HUD can toast it. */
  statusChangedAt = -1;

  private detectBaseline: Map<number, number[]> | null = null;

  constructor(
    private readonly cfg: PadConfig,
    private readonly standardProfile: PadProfile<A>,
    private readonly dpad: DpadActions<A>,
  ) {
    this.profile = standardProfile;
  }

  attach(): void {
    window.addEventListener('gamepadconnected', this.onConnect);
    window.addEventListener('gamepaddisconnected', this.onDisconnect);
  }

  detach(): void {
    window.removeEventListener('gamepadconnected', this.onConnect);
    window.removeEventListener('gamepaddisconnected', this.onDisconnect);
  }

  /** Diagnostics: has the browser ever fired a connect event for anything? */
  connectEvents = 0;
  lastEventId = '';

  private onConnect = (e: GamepadEvent): void => {
    this.connectEvents++;
    this.lastEventId = e.gamepad.id;
    this.statusChangedAt = performance.now();
  };

  private onDisconnect = (e: GamepadEvent): void => {
    this.activeSlot = -1; // re-resolved on the next poll by scanning every slot
    this.lastEventId = `disconnected: ${e.gamepad.id}`;
    this.statusChangedAt = performance.now();
  };

  /** How many slots getGamepads() returns, regardless of how many are populated.
   *  Chrome returns 4 nulls when it has the API but has not been shown a pad yet;
   *  an empty array means something quite different. */
  get rawSlotCount(): number {
    return this.pads().length;
  }

  private pads(): (Gamepad | null)[] {
    return typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  }

  /* --------------------------------------------------------------- diagnostics */

  /** Is the Gamepad API present at all? False on very old or locked-down browsers. */
  get apiAvailable(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
  }

  /** Raw pad list, for the controller-setup screen. */
  allPads(): (Gamepad | null)[] {
    return this.pads();
  }

  activePad(): Gamepad | null {
    return this.activeSlot >= 0 ? (this.pads()[this.activeSlot] ?? null) : null;
  }

  /** Is any control currently deflected? Used to require a release between steps of the
   *  auto-map walkthrough, so one held button cannot bind several actions. */
  anyControlActive(): boolean {
    for (const p of this.pads()) if (padUsable(p) && this.hasActivity(p)) return true;
    return false;
  }

  /** Any pad the browser will admit to, active or not. */
  anyPadConnected(): boolean {
    for (const p of this.pads()) if (padUsable(p)) return true;
    return false;
  }

  /** Set once if a malformed pad ever made polling throw; surfaced in the diagnostic. */
  pollError = '';

  /**
   * Called exactly once per rendered frame.
   *
   * Must never throw. This runs before step() and draw(), so an exception here freezes
   * the whole game behind a stale canvas — which reads as "everything is broken", not
   * "one controller is odd".
   */
  poll(): void {
    try {
      this.pollInner();
    } catch (e) {
      if (!this.pollError) {
        this.pollError = String((e as Error)?.message ?? e);
        console.error('[double-bubble] gamepad poll failed; input from pads disabled:', e);
      }
      this.moveX = this.moveY = 0;
      this.held = new Map();
    }
  }

  private pollInner(): void {
    const pads = this.pads();

    // Pick the pad the player is actually touching; fall back to the first usable one.
    // Every slot is scanned, so a controller in slot 3 with slots 0-2 empty is found.
    let pad = this.activeSlot >= 0 ? (pads[this.activeSlot] ?? null) : null;
    if (!padUsable(pad)) {
      pad = null;
      this.activeSlot = -1;
    }
    for (let slot = 0; slot < pads.length; slot++) {
      const p = pads[slot];
      if (!padUsable(p)) continue;
      if (!pad) {
        pad = p;
        this.activeSlot = slot;
      } else if (slot !== this.activeSlot && this.hasActivity(p)) {
        pad = p;
        this.activeSlot = slot;
        this.statusChangedAt = performance.now();
      }
    }

    this.prevHeld = this.held;
    this.held = new Map();

    if (!pad) {
      if (this.status.connected) this.statusChangedAt = performance.now();
      this.status = { connected: false, id: '', label: '', standard: false, index: -1, slot: -1 };
      this.moveX = this.moveY = 0;
      this.moveOct = null;
      return;
    }

    const standard = pad.mapping === 'standard';
    const padId = safePadId(pad, this.activeSlot);
    this.profile = this.profiles[padId] ?? this.standardProfile;
    this.status = {
      connected: true,
      id: padId,
      label: this.profiles[padId]?.label ?? (standard ? 'Standard gamepad' : padId),
      standard,
      index: typeof pad.index === 'number' ? pad.index : this.activeSlot,
      slot: this.activeSlot,
    };

    for (const [action, sources] of Object.entries(this.profile.sources) as [A, PadSource[]][]) {
      this.held.set(
        action,
        sources.some((s) => this.readSource(pad, s)),
      );
    }

    // D-pad wins over the stick whenever it is touched, so the two never fight.
    const { up, down, left, right } = this.dpad;
    const dpadTouched =
      this.held.get(up) || this.held.get(down) || this.held.get(left) || this.held.get(right);
    if (dpadTouched) {
      this.moveX = (this.held.get(right) ? 1 : 0) - (this.held.get(left) ? 1 : 0);
      this.moveY = (this.held.get(down) ? 1 : 0) - (this.held.get(up) ? 1 : 0);
      this.moveOct = null;
    } else if (this.profile.moveStick) {
      const ax = padAxes(pad)[this.profile.moveStick.x] ?? 0;
      const ay = padAxes(pad)[this.profile.moveStick.y] ?? 0;
      const r = quantiseStick(ax, ay, this.moveOct, this.cfg.deadzone, this.cfg.hysteresis);
      this.moveX = r.dx;
      this.moveY = r.dy;
      this.moveOct = r.octant;
    } else {
      this.moveX = this.moveY = 0;
    }
  }

  isHeld(action: A): boolean {
    return this.held.get(action) === true;
  }

  isPressed(action: A): boolean {
    return this.held.get(action) === true && this.prevHeld.get(action) !== true;
  }

  anyActivity(): boolean {
    if (this.moveX !== 0 || this.moveY !== 0) return true;
    for (const v of this.held.values()) if (v) return true;
    return false;
  }

  /* --------------------------------------------------------------- binding detection */

  /**
   * Options flow: "press the control you want". Snapshot every pad's resting axis values
   * first (triggers commonly rest at -1, hats at some odd constant), then report the
   * first thing that moves. This is what makes arcade sticks and older pads bindable.
   *
   * Scans ALL pads, not just the active one — when a controller "does nothing", the
   * usual cause is that it never became active, so binding must not require it to be.
   */
  beginDetect(): void {
    this.detectBaseline = new Map();
    const pads = this.pads();
    for (let slot = 0; slot < pads.length; slot++) {
      const p = pads[slot];
      if (padUsable(p)) this.detectBaseline.set(slot, Array.from(padAxes(p)));
    }
  }

  detect(): { padId: string; padIndex: number; source: PadSource } | null {
    const pads = this.pads();
    for (let slot = 0; slot < pads.length; slot++) {
      const pad = pads[slot];
      if (!padUsable(pad)) continue;

      const btns = padButtons(pad);
      for (let i = 0; i < btns.length; i++) {
        if (this.buttonPressed(btns[i])) {
          this.activeSlot = slot;
          return {
            padId: safePadId(pad, slot),
            padIndex: slot,
            source: { kind: 'button', index: i },
          };
        }
      }

      const base = this.detectBaseline?.get(slot);
      const axs = padAxes(pad);
      for (let i = 0; i < axs.length; i++) {
        const v = axs[i] ?? 0;
        const rest = base?.[i] ?? 0;
        if (Math.abs(v - rest) < 0.3) continue;
        // An axis *returning to centre* is a large change but not a deflection. Without
        // this, binding Right and then releasing the stick immediately re-binds the next
        // action to that same axis with a meaningless sign.
        if (Math.abs(v) < 0.35 && Math.abs(rest) > 0.5) continue;
        this.activeSlot = slot;
        // A hat reports as an axis that snaps to a set of odd constants rather than
        // sweeping; treat a non-extreme resting-offset value as a hat position.
        const source: PadSource =
          Math.abs(v) < 0.98 && Math.abs(v) > 0.02
            ? { kind: 'hat', index: i, value: v, epsilon: 0.08 }
            : { kind: 'axis', index: i, sign: v > 0 ? 1 : -1 };
        return { padId: safePadId(pad, slot), padIndex: slot, source };
      }
    }
    return null;
  }

  /** Record a binding into this pad's profile, creating one from the standard map. */
  bindAction(padId: string, action: A, source: PadSource): void {
    const existing = this.profiles[padId];
    const profile: PadProfile<A> = existing ?? {
      match: padId,
      label: `Custom — ${padId.slice(0, 28)}`,
      moveStick: this.standardProfile.moveStick,
      sources: structuredClone(this.standardProfile.sources),
    };
    profile.sources[action] = [source];
    this.deriveMoveStick(profile);
    this.profiles[padId] = profile;
  }

  resetProfile(padId: string): void {
    delete this.profiles[padId];
  }

  /**
   * If left/right ended up bound to opposite halves of one axis and up/down likewise,
   * that's a stick, not four buttons — promote it back to `moveStick` so it gets octant
   * quantisation instead of per-axis thresholding. Per-axis would make the diagonal
   * wedges twice as wide as the cardinals, which feels nothing like the cabinet.
   */
  private deriveMoveStick(p: PadProfile<A>): void {
    const axisOf = (a: A): { index: number; sign: number } | null => {
      const s = p.sources[a]?.[0];
      return s && s.kind === 'axis' ? { index: s.index, sign: s.sign } : null;
    };
    const l = axisOf(this.dpad.left);
    const r = axisOf(this.dpad.right);
    const u = axisOf(this.dpad.up);
    const d = axisOf(this.dpad.down);
    if (l && r && u && d && l.index === r.index && u.index === d.index && l.sign !== r.sign) {
      p.moveStick = { x: r.index, y: d.index };
    } else {
      // Bound to buttons or a hat: drive movement from those, not from a stick.
      p.moveStick = null;
    }
  }

  /* --------------------------------------------------------------- rumble */

  rumble(duration: number, weak: number, strong: number): void {
    if (!this.rumbleEnabled || this.activeSlot < 0) return;
    const pad = this.pads()[this.activeSlot];
    const actuator = (pad as (Gamepad & { vibrationActuator?: GamepadHapticActuator }) | null)
      ?.vibrationActuator;
    if (!actuator?.playEffect) return;
    void actuator
      .playEffect('dual-rumble', { duration, strongMagnitude: strong, weakMagnitude: weak })
      .catch(() => {
        /* not all browsers support dual-rumble; silently skip */
      });
  }

  /* --------------------------------------------------------------- raw reads */

  private buttonPressed(b: unknown): boolean {
    return buttonValue(b) >= this.cfg.triggerThreshold;
  }

  private readSource(pad: Gamepad, s: PadSource): boolean {
    switch (s.kind) {
      case 'button':
        return this.buttonPressed(padButtons(pad)[s.index]);
      case 'axis': {
        const v = padAxes(pad)[s.index] ?? 0;
        return v * s.sign >= (s.threshold ?? this.cfg.deadzone);
      }
      case 'hat': {
        const v = padAxes(pad)[s.index] ?? 0;
        return Math.abs(v - s.value) <= (s.epsilon ?? 0.08);
      }
    }
  }

  private hasActivity(pad: Gamepad): boolean {
    for (const b of padButtons(pad)) if (this.buttonPressed(b)) return true;
    for (const a of padAxes(pad)) if (Math.abs(a) >= this.cfg.deadzone) return true;
    return false;
  }
}

/**
 * Read a button regardless of what shape the engine returns.
 *
 * The spec says GamepadButton objects, but engines have shipped plain numbers, and
 * objects with `pressed` but no `value` (and vice versa). Reading `b.pressed || b.value`
 * against a number yields undefined for both, so every button reads as never-pressed —
 * the pad enumerates perfectly and no input ever arrives, which is indistinguishable
 * from a dead controller.
 */
export function buttonValue(b: unknown): number {
  if (typeof b === 'number') return b;
  if (b && typeof b === 'object') {
    const o = b as { value?: unknown; pressed?: unknown };
    if (o.pressed === true) return 1;
    if (typeof o.value === 'number') return o.value;
    if (o.pressed === false) return 0;
  }
  return 0;
}

/** A stable identity even when the pad reports no usable id. */
export function safePadId(p: Gamepad, slot: number): string {
  const id = (p as { id?: unknown }).id;
  return typeof id === 'string' && id ? id : `(unnamed pad ${slot})`;
}

/** A pad slot is usable unless the engine explicitly says it is disconnected.
 *  Some engines omit `connected` entirely; a missing property must not mean "no". */
export function padUsable(p: Gamepad | null | undefined): p is Gamepad {
  return !!p && (p as { connected?: unknown }).connected !== false;
}

/** Missing or short arrays are normal in the wild; never index them blind. */
export function padButtons(p: Gamepad): readonly unknown[] {
  return (p.buttons as readonly unknown[] | undefined) ?? [];
}

export function padAxes(p: Gamepad): readonly number[] {
  return (p.axes as readonly number[] | undefined) ?? [];
}
