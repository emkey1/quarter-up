import type { Layout } from '@/engine/display';
import type { ActionState } from '@/engine/actions';
import { UI, centred, sans } from '@/render/ui';
import { MenuInput, type Screen } from './screen';

/**
 * The between-levels card.
 *
 * Short and skippable. Its one real job is the yellow line: the arcade told you when a
 * level hid an upgrade potion, and that single sentence changes how you play the next
 * two minutes — you go looking instead of running for the exit.
 */
export class LevelIntroScreen implements Screen {
  readonly id = 'levelintro' as const;
  private t = 0;
  private menu = new MenuInput();

  depth = 1;
  levelName = '';
  hasHiddenUpgrade = false;
  /** Duration in frames; skippable at any point after a moment. */
  private readonly hold = 150;

  constructor(
    private readonly kbPressed: (code: string) => boolean,
    private readonly onDone: () => void,
  ) {}

  show(depth: number, levelName: string, hasHiddenUpgrade: boolean): void {
    this.depth = depth;
    this.levelName = levelName;
    this.hasHiddenUpgrade = hasHiddenUpgrade;
    this.t = 0;
  }

  enter(): void {
    this.t = 0;
    this.menu = new MenuInput();
  }

  step(a: Readonly<ActionState>, stepIndex: number): void {
    this.menu.read(a, stepIndex, this.kbPressed);
    this.t++;
    if (this.t > 20 && (this.menu.confirm || this.menu.cancel)) this.onDone();
    if (this.t >= this.hold) this.onDone();
  }

  draw(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const s = layout.uiScale;
    const cw = layout.canvasW;
    const ch = layout.canvasH;

    // Fade in and back out, so a transition never simply cuts.
    const fade =
      this.t < 12 ? this.t / 12 : this.t > this.hold - 18 ? Math.max(0, (this.hold - this.t) / 18) : 1;

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalAlpha = fade;

    centred(ctx, 'LEVEL', cw / 2, ch / 2 - 54 * s, sans(14, s, 600), UI.dim, 6 * s);
    centred(ctx, String(this.depth), cw / 2, ch / 2 + 6 * s, sans(56, s, 800), UI.fg);
    centred(ctx, this.levelName.toUpperCase(), cw / 2, ch / 2 + 34 * s, sans(15, s, 600), UI.dim, 3 * s);

    if (this.hasHiddenUpgrade) {
      centred(
        ctx,
        'FIND THE HIDDEN POTION!',
        cw / 2,
        ch / 2 + 74 * s,
        sans(15, s, 800),
        UI.gold,
        2 * s,
      );
    }

    ctx.globalAlpha = fade * 0.6;
    centred(ctx, 'press any key to continue', cw / 2, ch - 40 * s, sans(10, s, 500), UI.faint);
    ctx.restore();
  }
}
