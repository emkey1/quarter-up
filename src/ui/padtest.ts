import type { Layout } from '@/engine/display';
import type { Input } from '@/engine/input';
import type { ActionName } from '@/engine/actions';
import type { PadSource } from '@/engine/gamepad';
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

  toggle(): void {
    this.open = !this.open;
    this.awaiting = null;
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
      const hit = input.gamepad.detect();
      if (hit) {
        input.gamepad.bindAction(hit.padId, this.awaiting, hit.source);
        this.lastBound = `${this.awaiting} -> ${describe(hit.source)}`;
        this.awaiting = null;
        saveSettings({ padProfiles: input.gamepad.profiles });
      }
      if (kb.wasCodePressed('Escape')) this.awaiting = null;
      return true;
    }

    if (kb.wasCodePressed('ArrowDown')) this.cursor = (this.cursor + 1) % BINDABLE.length;
    if (kb.wasCodePressed('ArrowUp'))
      this.cursor = (this.cursor - 1 + BINDABLE.length) % BINDABLE.length;
    if (kb.wasCodePressed('Enter')) {
      this.awaiting = BINDABLE[this.cursor]!.action;
      input.gamepad.beginDetect();
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

  draw(ctx: CanvasRenderingContext2D, layout: Layout, input: Input): void {
    if (!this.open) return;
    const s = layout.uiScale;
    const gp = input.gamepad;
    const pads = gp.allPads();
    const connected = pads.filter((p): p is Gamepad => !!p?.connected);

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

    for (const p of connected) {
      row(
        `  [${p.index}]`,
        `${p.id.slice(0, 40)}`,
        p.index === gp.status.index ? OK : FG,
      );
      row('       mapping', `${p.mapping || 'non-standard'}  axes ${p.axes.length}  btns ${p.buttons.length}`, p.mapping === 'standard' ? OK : WARN);
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

    /* ---------------------------------------------------------------- live input */
    const pad = gp.activePad() ?? connected[0] ?? null;
    if (pad) {
      head(`live input — pad ${pad.index}`);

      const barW = 120 * s;
      pad.axes.forEach((v, i) => {
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
      pad.buttons.forEach((b, i) => {
        const cx = bx0 + (i % 12) * cell;
        const cy = y - 9 * s + Math.floor(i / 12) * cell;
        const on = b.pressed || b.value >= 0.5;
        ctx.fillStyle = on ? OK : 'rgba(255,255,255,.07)';
        ctx.fillRect(cx, cy, cell - 3 * s, cell - 3 * s);
        ctx.fillStyle = on ? '#06210b' : 'rgba(255,255,255,.3)';
        ctx.font = `600 ${8 * s}px ui-monospace, Menlo, monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(String(i), cx + (cell - 3 * s) / 2, cy + (cell - 3 * s) * 0.68);
        ctx.textAlign = 'left';
      });
      y += cell * Math.ceil(pad.buttons.length / 12) + 4 * s;
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

    y += 10 * s;
    if (this.awaiting) {
      text(`Press the control for "${this.awaiting}"  (ESC to cancel)`, 12, WARN, 600);
    } else {
      text('Enter rebinds  •  Backspace resets this pad  •  Arrows move', 10, DIM);
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
