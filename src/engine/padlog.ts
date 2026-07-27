/**
 * Persistent record of what the browser has ever shown us about a gamepad.
 *
 * Exists because a controller that appears for a few seconds and then vanishes is
 * otherwise unobservable — by the time you look, the evidence is gone, and a reload
 * clears the Gamepad API's state anyway.
 *
 * The single most diagnostic fact it captures is `inputSeen`: whether ANY button or
 * axis has ever moved. That one bit separates "the browser is not delivering state"
 * from "the mapping is wrong", which are indistinguishable from the symptom alone.
 *
 * Diagnostics only — never read by the simulation, so wall-clock time is fine here.
 */

export interface PadSighting {
  id: string;
  index: number;
  mapping: string;
  axes: number;
  buttons: number;
  buttonShape: string;
  /** Largest button value ever observed, across the whole history. */
  maxButtonEver: number;
  /** Largest absolute axis deflection ever observed. */
  maxAxisEver: number;
  inputSeen: boolean;
  firstSeen: number;
  lastSeen: number;
}

export interface PadEvent {
  t: number;
  text: string;
}

const KEY = 'bracer.padlog.v1';
const MAX_EVENTS = 12;

export class PadLog {
  sightings: Record<string, PadSighting> = {};
  events: PadEvent[] = [];
  private present = new Set<string>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as { sightings?: Record<string, PadSighting>; events?: PadEvent[] };
      if (d.sightings) this.sightings = d.sightings;
      if (d.events) this.events = d.events;
    } catch {
      /* diagnostics must never break the game */
    }
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ sightings: this.sightings, events: this.events }));
    } catch {
      /* ignore */
    }
  }

  private event(text: string): void {
    this.events.unshift({ t: Date.now(), text });
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS;
  }

  clear(): void {
    this.sightings = {};
    this.events = [];
    this.present.clear();
    this.save();
  }

  /** Called once per poll. Tolerates any shape the engine hands us. */
  observe(pads: readonly (Gamepad | null)[]): void {
    const nowPresent = new Set<string>();
    let dirty = false;

    for (const p of pads) {
      if (!p) continue;
      const id = safeId(p);
      nowPresent.add(id);

      const buttons: readonly unknown[] = (p.buttons as readonly unknown[] | undefined) ?? [];
      const axes: readonly number[] = (p.axes as readonly number[] | undefined) ?? [];

      let s = this.sightings[id];
      if (!s) {
        s = {
          id,
          index: typeof p.index === 'number' ? p.index : -1,
          mapping: p.mapping || 'non-standard',
          axes: axes.length,
          buttons: buttons.length,
          buttonShape: shapeOf(buttons[0]),
          maxButtonEver: 0,
          maxAxisEver: 0,
          inputSeen: false,
          firstSeen: Date.now(),
          lastSeen: Date.now(),
        };
        this.sightings[id] = s;
        this.event(`appeared: ${id.slice(0, 32)} (${s.mapping}, ${s.buttons}btn/${s.axes}ax, ${s.buttonShape})`);
        dirty = true;
      }
      s.lastSeen = Date.now();

      for (const b of buttons) {
        const v = numericButton(b);
        if (v > s.maxButtonEver) {
          s.maxButtonEver = v;
          dirty = true;
          if (!s.inputSeen && v > 0.5) {
            s.inputSeen = true;
            this.event(`FIRST INPUT from ${id.slice(0, 32)} (button ${v.toFixed(2)})`);
          }
        }
      }
      for (const a of axes) {
        const v = Math.abs(typeof a === 'number' ? a : 0);
        if (v > s.maxAxisEver) {
          s.maxAxisEver = v;
          dirty = true;
          if (!s.inputSeen && v > 0.5) {
            s.inputSeen = true;
            this.event(`FIRST INPUT from ${id.slice(0, 32)} (axis ${v.toFixed(2)})`);
          }
        }
      }
    }

    for (const id of this.present) {
      if (!nowPresent.has(id)) {
        this.event(`vanished: ${id.slice(0, 32)}`);
        dirty = true;
      }
    }
    this.present = nowPresent;
    if (dirty) this.save();
  }

  /** Copyable plain-text summary — canvas text cannot be selected. */
  report(): string {
    const lines: string[] = ['=== Bracer controller report ==='];
    lines.push(`ua: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'}`);
    lines.push(
      `api: ${typeof navigator !== 'undefined' && !!navigator.getGamepads}  secure: ${typeof window !== 'undefined' && window.isSecureContext}`,
    );
    const ids = Object.keys(this.sightings);
    lines.push(`sightings: ${ids.length}`);
    for (const id of ids) {
      const s = this.sightings[id]!;
      lines.push(
        `  "${s.id}" idx=${s.index} mapping=${s.mapping} btns=${s.buttons} axes=${s.axes} shape=${s.buttonShape}`,
      );
      lines.push(
        `     inputSeen=${s.inputSeen} maxButtonEver=${s.maxButtonEver.toFixed(2)} maxAxisEver=${s.maxAxisEver.toFixed(2)}`,
      );
    }
    lines.push('events (newest first):');
    for (const e of this.events) lines.push(`  ${new Date(e.t).toLocaleTimeString()}  ${e.text}`);
    return lines.join('\n');
  }
}

function safeId(p: Gamepad): string {
  const id = (p as { id?: unknown }).id;
  return typeof id === 'string' && id ? id : `(unnamed pad ${p.index ?? '?'})`;
}

function numericButton(b: unknown): number {
  if (typeof b === 'number') return b;
  if (b && typeof b === 'object') {
    const o = b as { value?: unknown; pressed?: unknown };
    if (o.pressed === true) return 1;
    if (typeof o.value === 'number') return o.value;
  }
  return 0;
}

export function shapeOf(b: unknown): string {
  if (b === undefined) return 'none';
  if (typeof b === 'number') return 'number (non-spec)';
  if (b && typeof b === 'object') return `object{${Object.keys(b).slice(0, 3).join(',')}}`;
  return typeof b;
}
