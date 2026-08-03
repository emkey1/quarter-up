import type { Layout } from '@cabinet/display';
import type { Input } from '@/engine/input';
import type { ActionName } from '@/engine/actions';
import { padUsable, buttonPressed, buttonValue, type PadSource } from '@cabinet/gamepad';
import { shapeOf } from '@/engine/padlog';
import { T } from '@/data/tuning';
import { saveSettings } from '@/engine/storage';

const BINDABLE: { action: ActionName; label: string }[] = [
  { action: 'up', label: 'Up' },
  { action: 'down', label: 'Down' },
  { action: 'left', label: 'Left' },
  { action: 'right', label: 'Right' },
  { action: 'fire', label: 'Fire' },
  { action: 'magic', label: 'Magic' },
  { action: 'faceLock', label: 'Face lock' },
  { action: 'pause', label: 'Pause' },
];

const FG = '#d7dbe0';
const DIM = 'rgba(215,219,224,.45)';
const OK = '#4fbf5f';
const WARN = '#e8c34a';
const BAD = '#ff6b5e';

/**
 * Controller setup and diagnostics.
 *
 * This exists because "I pressed everything and nothing happened" is unactionable.
 * It answers, in order: does the browser expose the API, does it see a pad, is the pad
 * active, what is it actually reporting, and what is each action bound to. Then it lets
 * you rebind anything, which is what makes non-standard pads and arcade sticks usable.
 */
export class PadTest {
  open = false;
  private cursor = 0;
  private awaiting: ActionName | null = null;
  private lastBound = '';
  /** Remaining steps of the auto-map walkthrough. */
  private queue: ActionName[] = [];
  /** After a bind, the control must be released before the next step arms, or one
   *  held button binds every remaining action in a single frame each. */
  private waitingForRelease = false;

  toggle(): void {
    this.open = !this.open;
    this.awaiting = null;
    this.queue = [];
    this.waitingForRelease = false;
  }

  private armNext(input: Input): void {
    const next = this.queue.shift();
    this.awaiting = next ?? null;
    if (next) {
      this.waitingForRelease = true;
    } else {
      this.lastBound = 'auto-map complete';
    }
    void input;
  }

  /**
   * Navigation and rebinding only.
   *
   * Deliberately does NOT handle the toggle key: the caller owns that. Handling it in
   * both places made one press open and close the overlay inside a single frame.
   *
   * Returns true if it consumed the input (so the world should not step).
   */
  update(input: Input): boolean {
    if (!this.open) return false;
    const kb = input.keyboard;

    if (this.awaiting) {
      if (kb.wasCodePressed('Escape')) {
        this.awaiting = null;
        this.queue = [];
        return true;
      }
      if (this.waitingForRelease) {
        if (!input.gamepad.anyControlActive()) {
          this.waitingForRelease = false;
          input.gamepad.beginDetect(); // re-baseline from the true resting position
        }
        return true;
      }
      const hit = input.gamepad.detect();
      if (hit) {
        input.gamepad.bindAction(hit.padId, this.awaiting, hit.source);
        this.lastBound = `${this.awaiting} -> ${describe(hit.source)}`;
        saveSettings({ padProfiles: input.gamepad.profiles });
        if (this.queue.length) this.armNext(input);
        else this.awaiting = null;
      }
      return true;
    }

    const rows = BINDABLE.length + 1; // + the auto-map row
    if (kb.wasCodePressed('ArrowDown')) this.cursor = (this.cursor + 1) % rows;
    if (kb.wasCodePressed('ArrowUp')) this.cursor = (this.cursor - 1 + rows) % rows;
    if (kb.wasCodePressed('Enter')) {
      if (this.cursor === BINDABLE.length) {
        // Auto-map: walk every action in order. Far less fiddly than eight separate
        // rebinds, and it produces a working pad in about fifteen seconds whatever
        // the browser decided to report.
        this.queue = BINDABLE.map((b) => b.action);
        this.armNext(input);
      } else {
        this.awaiting = BINDABLE[this.cursor]!.action;
        this.waitingForRelease = true;
      }
    }
    if (kb.wasCodePressed('Backspace')) {
      const pad = input.gamepad.activePad();
      if (pad) {
        input.gamepad.resetProfile(pad.id);
        this.lastBound = 'reset to standard mapping';
        saveSettings({ padProfiles: input.gamepad.profiles });
      }
    }
    if (kb.wasCodePressed('Escape')) this.open = false;
    return true;
  }

  /**
   * A diagnostic that crashes when the thing it is diagnosing is unusual is worse than
   * useless — it looks like "no controller detected". Any render error is caught and
   * shown instead of blanking the screen.
   */
  draw(ctx: CanvasRenderingContext2D, layout: Layout, input: Input): void {
    if (!this.open) return;
    try {
      this.drawInner(ctx, layout, input);
    } catch (e) {
      ctx.restore();
      const s = layout.uiScale;
      ctx.fillStyle = 'rgba(5,6,9,.96)';
      ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);
      ctx.fillStyle = BAD;
      ctx.font = `600 ${13 * s}px ui-monospace, Menlo, monospace`;
      ctx.fillText('Controller setup failed to render:', 24 * s, 40 * s);
      ctx.fillText(String((e as Error)?.message ?? e).slice(0, 120), 24 * s, 60 * s);
      ctx.fillText('This is a bug — please report it.', 24 * s, 90 * s);
    }
  }

  private drawInner(ctx: CanvasRenderingContext2D, layout: Layout, input: Input): void {
    const s = layout.uiScale;
    const gp = input.gamepad;
    const pads = gp.allPads();
    const connected = pads.filter(padUsable);

    ctx.save();
    ctx.fillStyle = 'rgba(5,6,9,.94)';
    ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);

    const x = Math.max(24 * s, (layout.canvasW - 620 * s) / 2);
    let y = 44 * s;
    const col2 = x + 190 * s;

    const text = (t: string, size: number, colour: string, weight = 500, tx = x) => {
      ctx.fillStyle = colour;
      ctx.font = `${weight} ${size * s}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillText(t, tx, y);
    };
    const mono = (t: string, size: number, colour: string, tx: number) => {
      ctx.fillStyle = colour;
      ctx.font = `500 ${size * s}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.fillText(t, tx, y);
    };
    const head = (t: string) => {
      y += 22 * s;
      ctx.fillStyle = 'rgba(215,219,224,.35)';
      ctx.font = `600 ${9 * s}px ui-sans-serif, system-ui, sans-serif`;
      ctx.letterSpacing = `${1.6 * s}px`;
      ctx.fillText(t.toUpperCase(), x, y);
      ctx.letterSpacing = '0px';
      y += 16 * s;
    };
    const row = (k: string, v: string, colour = FG) => {
      text(k, 11, DIM);
      mono(v, 11, colour, col2);
      y += 15 * s;
    };

    text('CONTROLLER SETUP', 17, FG, 700);
    mono('G or ESC to close', 10, DIM, x + 200 * s);

    /* ---------------------------------------------------------------- detection */
    head('detection');
    row('Gamepad API', gp.apiAvailable ? 'available' : 'MISSING', gp.apiAvailable ? OK : BAD);
    row('Window focused', document.hasFocus() ? 'yes' : 'NO', document.hasFocus() ? OK : BAD);
    row(
      'Page visible',
      document.visibilityState,
      document.visibilityState === 'visible' ? OK : BAD,
    );
    row('Pads reported', String(connected.length), connected.length ? OK : WARN);
    row('Raw slots', String(gp.rawSlotCount), gp.rawSlotCount ? FG : WARN);
    row(
      'Connect events',
      gp.connectEvents ? `${gp.connectEvents}  ${gp.lastEventId.slice(0, 30)}` : 'none yet',
      gp.connectEvents ? OK : WARN,
    );
    row('Secure context', String(window.isSecureContext), window.isSecureContext ? OK : WARN);

    // Every slot, including the empty ones. The Gamepad API exposes four, and "is it
    // just looking at the wrong one?" should be answerable by eye rather than by faith.
    head('slots');
    const all = gp.allPads();
    const slotCount = Math.max(4, all.length);
    for (let i = 0; i < slotCount; i++) {
      const p = all[i];
      const usable = padUsable(p);
      row(
        `  slot ${i}`,
        usable ? `${(p!.id || '(unnamed)').slice(0, 34)}` : 'empty',
        usable ? (i === gp.status.slot ? OK : FG) : 'rgba(215,219,224,.3)',
      );
      if (usable && typeof p!.index === 'number' && p!.index !== i) {
        row('', `reports index ${p!.index} — mismatch`, WARN);
      }
    }

    for (const p of connected) {
      // Every property here is treated as possibly absent. A pad reporting `buttons`,
      // `axes` or `id` as undefined used to throw and blank this whole screen.
      const buttons: readonly unknown[] = (p.buttons as readonly unknown[] | undefined) ?? [];
      const axes: readonly number[] = (p.axes as readonly number[] | undefined) ?? [];
      const id = typeof p.id === 'string' && p.id ? p.id : '(unnamed)';
      row(`  [${p.index ?? '?'}]`, id.slice(0, 40), p.index === gp.status.index ? OK : FG);
      row(
        '       mapping',
        `${p.mapping || 'non-standard'}  axes ${axes.length}  btns ${buttons.length}`,
        p.mapping === 'standard' ? OK : WARN,
      );
      // What shape does this engine return for a button? Engines have shipped objects
      // and plain numbers; reading the wrong one makes every button look un-pressed.
      row('       button shape', shapeOf(buttons[0]), typeof buttons[0] === 'object' ? OK : WARN);
      let maxNow = 0;
      for (const b of buttons) maxNow = Math.max(maxNow, buttonValue(b));
      row('       max value now', maxNow.toFixed(2), maxNow > 0 ? OK : DIM);
    }

    if (!connected.length) {
      y += 6 * s;
      ctx.fillStyle = WARN;
      ctx.font = `500 ${11 * s}px ui-sans-serif, system-ui, sans-serif`;
      for (const line of [
        'No controller visible to the browser. In order of likelihood:',
        '  1. Press a button ON THE CONTROLLER with this window focused.',
        '     Browsers hide gamepads until a button is pressed, and never',
        '     expose them to a background or unfocused tab.',
        '  2. Click once on the page first, then press a controller button.',
        '  3. Bluetooth pads: confirm it is paired and awake, not just powered.',
        '  4. Safari is stricter than Chrome here — try Chrome to isolate.',
      ]) {
        ctx.fillText(line, x, y);
        y += 14 * s;
      }
    }

    /* ------------------------------------------------- history (survives reloads) */
    const sightings = Object.values(input.padLog.sightings);
    if (sightings.length) {
      head('ever seen  (persisted across reloads)');
      for (const sg of sightings) {
        row(`  ${sg.id.slice(0, 26)}`, `${sg.mapping}  ${sg.buttons}btn/${sg.axes}ax`, FG);
        row(
          '       input ever seen',
          sg.inputSeen
            ? `YES  btn ${sg.maxButtonEver.toFixed(2)}  axis ${sg.maxAxisEver.toFixed(2)}`
            : 'NEVER — no button or axis has ever moved',
          sg.inputSeen ? OK : BAD,
        );
      }
      if (input.padLog.events.length) {
        for (const e of input.padLog.events.slice(0, 5)) {
          mono(`${new Date(e.t).toLocaleTimeString()}  ${e.text.slice(0, 64)}`, 9, DIM, x);
          y += 12 * s;
        }
      }
      y += 4 * s;
      mono('bracer.padReport() in the console prints all of this as copyable text', 9, DIM, x);
      y += 14 * s;
    }

    /* ---------------------------------------------------------------- live input */
    const pad = gp.activePad() ?? connected[0] ?? null;
    if (pad) {
      head(`live input — pad ${pad.index ?? '?'}`);

      const barW = 120 * s;
      const liveAxes: readonly number[] = (pad.axes as readonly number[] | undefined) ?? [];
      const liveButtons: readonly unknown[] = (pad.buttons as readonly unknown[] | undefined) ?? [];
      liveAxes.forEach((v, i) => {
        mono(`axis ${i}`, 10, DIM, x);
        const bx = x + 60 * s;
        ctx.fillStyle = 'rgba(255,255,255,.08)';
        ctx.fillRect(bx, y - 8 * s, barW, 9 * s);
        ctx.fillStyle = Math.abs(v) > 0.2 ? OK : 'rgba(255,255,255,.3)';
        const mid = bx + barW / 2;
        ctx.fillRect(Math.min(mid, mid + (v * barW) / 2), y - 8 * s, Math.abs((v * barW) / 2), 9 * s);
        mono(v.toFixed(2), 10, Math.abs(v) > 0.2 ? OK : DIM, bx + barW + 10 * s);
        y += 13 * s;
      });

      y += 6 * s;
      mono('buttons', 10, DIM, x);
      const bx0 = x + 60 * s;
      const cell = 17 * s;
      liveButtons.forEach((b, i) => {
        const cx = bx0 + (i % 12) * cell;
        const cy = y - 9 * s + Math.floor(i / 12) * cell;
        const on = buttonPressed(b, T.PAD_TRIGGER_THRESHOLD);
        ctx.fillStyle = on ? OK : 'rgba(255,255,255,.07)';
        ctx.fillRect(cx, cy, cell - 3 * s, cell - 3 * s);
        ctx.fillStyle = on ? '#06210b' : 'rgba(255,255,255,.3)';
        ctx.font = `600 ${8 * s}px ui-monospace, Menlo, monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(String(i), cx + (cell - 3 * s) / 2, cy + (cell - 3 * s) * 0.68);
        ctx.textAlign = 'left';
      });
      y += cell * Math.ceil(liveButtons.length / 12) + 4 * s;
    }

    /* ---------------------------------------------------------------- action map */
    head('action map');
    BINDABLE.forEach((b, i) => {
      const sel = i === this.cursor;
      const src = gp.profile.sources[b.action]?.[0];
      const live = gp.isHeld(b.action);
      if (sel) {
        ctx.fillStyle = 'rgba(255,255,255,.07)';
        ctx.fillRect(x - 6 * s, y - 11 * s, 420 * s, 15 * s);
      }
      text(`${sel ? '>' : ' '} ${b.label}`, 11, sel ? FG : DIM);
      mono(src ? describe(src) : 'unbound', 11, src ? FG : WARN, col2);
      if (live) mono('  ACTIVE', 11, OK, col2 + 130 * s);
      y += 15 * s;
    });

    // auto-map row
    {
      const sel = this.cursor === BINDABLE.length;
      if (sel) {
        ctx.fillStyle = 'rgba(255,255,255,.07)';
        ctx.fillRect(x - 6 * s, y - 11 * s, 420 * s, 15 * s);
      }
      text(`${sel ? '>' : ' '} Auto-map all controls`, 11, sel ? OK : DIM, 600);
      y += 18 * s;
    }

    y += 10 * s;
    if (this.awaiting) {
      if (this.waitingForRelease) {
        text('Release the controller…', 12, DIM, 600);
      } else {
        const step = this.queue.length ? ` (${BINDABLE.length - this.queue.length}/${BINDABLE.length})` : '';
        text(`Press the control for "${this.awaiting}"${step}   ESC to cancel`, 12, WARN, 600);
      }
    } else {
      text('Enter rebinds  •  Backspace resets this pad  •  Arrows move', 10, DIM);
      y += 14 * s;
      text(
        'If the button lights above respond but the game does not, the mapping is wrong — use Auto-map.',
        10,
        DIM,
      );
    }
    if (this.lastBound) {
      y += 15 * s;
      text(this.lastBound, 10, OK);
    }

    ctx.restore();
  }
}

function describe(s: PadSource): string {
  switch (s.kind) {
    case 'button':
      return `button ${s.index}`;
    case 'axis':
      return `axis ${s.index}${s.sign > 0 ? '+' : '-'}`;
    case 'hat':
      return `hat ${s.index} @ ${s.value.toFixed(2)}`;
  }
}
