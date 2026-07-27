import { CLASSES, CLASS_ORDER, CLASS_VERDICT, classBars, type ClassId } from '@/data/classes';
import type { Layout } from '@/engine/display';
import type { ActionState } from '@/engine/actions';
import { UI, centred, logo, panel, sans, statBar, blink } from '@/render/ui';
import { MenuInput, type Screen } from './screen';

/**
 * Character select.
 *
 * The arcade let you pick by walking to a station; solo, this is where the one decision
 * that shapes a whole run gets made. So it shows the numbers rather than four names and
 * a vibe — and orders the bars by how much each actually decides the run, with magic vs
 * generators first, because that is the difference between a potion clearing a nest and
 * merely annoying it.
 */
export class CharSelectScreen implements Screen {
  readonly id = 'charselect' as const;
  private index = 3; // Elf: the strongest solo pick, so it is the sensible default
  private menu = new MenuInput();

  constructor(
    private readonly kbPressed: (code: string) => boolean,
    private readonly onChoose: (cls: ClassId) => void,
    private readonly onBack: () => void,
  ) {}

  enter(): void {
    this.menu = new MenuInput();
  }

  get selected(): ClassId {
    return CLASS_ORDER[this.index];
  }

  step(a: Readonly<ActionState>, stepIndex: number): void {
    this.menu.read(a, stepIndex, this.kbPressed);
    if (this.menu.left) this.index = (this.index + CLASS_ORDER.length - 1) % CLASS_ORDER.length;
    if (this.menu.right) this.index = (this.index + 1) % CLASS_ORDER.length;
    if (this.menu.up) this.index = (this.index + CLASS_ORDER.length - 1) % CLASS_ORDER.length;
    if (this.menu.down) this.index = (this.index + 1) % CLASS_ORDER.length;
    if (this.menu.confirm) this.onChoose(this.selected);
    if (this.menu.cancel) this.onBack();
  }

  draw(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const s = layout.uiScale;
    const cw = layout.canvasW;
    const ch = layout.canvasH;

    // Translucent, so the live dungeon behind stays visible.
    ctx.fillStyle = 'rgba(5,6,11,.88)';
    ctx.fillRect(0, 0, cw, ch);

    logo(ctx, cw / 2, 62 * s, s, 0.5);
    centred(ctx, 'CHOOSE YOUR CHARACTER', cw / 2, 92 * s, sans(12, s, 600), UI.dim, 3 * s);

    const n = CLASS_ORDER.length;
    const cardW = Math.min(190 * s, (cw - 40 * s) / n - 10 * s);
    const gap = 10 * s;
    const totalW = n * cardW + (n - 1) * gap;
    const x0 = (cw - totalW) / 2;
    const top = 120 * s;
    const cardH = Math.min(250 * s, ch - top - 150 * s);

    CLASS_ORDER.forEach((id, i) => {
      const c = CLASSES[id];
      const x = x0 + i * (cardW + gap);
      const sel = i === this.index;

      panel(ctx, { x, y: top, w: cardW, h: cardH }, s);
      if (sel) {
        ctx.save();
        ctx.strokeStyle = c.colour;
        ctx.lineWidth = Math.max(2, s * 1.6);
        ctx.strokeRect(x + 1, top + 1, cardW - 2, cardH - 2);
        ctx.restore();
      }

      // portrait: the class colour as a simple standing figure, matching in-game
      const px = x + cardW / 2;
      const py = top + 52 * s;
      ctx.save();
      ctx.globalAlpha = sel ? 1 : 0.55;
      ctx.fillStyle = c.colour;
      ctx.beginPath();
      ctx.arc(px, py - 16 * s, 13 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(px - 15 * s, py, 30 * s, 34 * s);
      ctx.restore();

      centred(ctx, c.name.toUpperCase(), px, top + 118 * s, sans(15, s, 700), sel ? c.colour : UI.dim);
      centred(ctx, c.hero, px, top + 134 * s, sans(10, s, 500), UI.faint);

      // shot collision box — the one stat that can never be upgraded
      centred(
        ctx,
        `${c.shotBox.toUpperCase()} SHOT`,
        px,
        top + 152 * s,
        sans(9, s, 600),
        c.shotBox === 'large' ? UI.bad : c.shotBox === 'small' ? UI.good : UI.dim,
      );

      const bars = classBars(c);
      let by = top + 172 * s;
      ctx.save();
      ctx.globalAlpha = sel ? 1 : 0.45;
      for (const b of bars.slice(0, 4)) {
        ctx.font = sans(8, s, 500);
        ctx.fillStyle = UI.faint;
        ctx.fillText(b.label, x + 12 * s, by);
        statBar(ctx, x + 12 * s, by + 3 * s, cardW - 24 * s, 5 * s, b.base, b.extra, b.max, c.colour);
        by += 17 * s;
      }
      ctx.restore();
    });

    // --- detail for the highlighted class
    const c = CLASSES[this.selected];
    const dy = top + cardH + 26 * s;
    centred(ctx, CLASS_VERDICT[this.selected], cw / 2, dy, sans(12, s, 600), c.colour);

    const bars = classBars(c);
    const bw = Math.min(360 * s, cw - 80 * s);
    let ly = dy + 24 * s;
    ctx.save();
    for (const b of bars) {
      ctx.font = sans(9, s, 500);
      ctx.fillStyle = UI.dim;
      ctx.fillText(b.label, cw / 2 - bw / 2, ly);
      ctx.textAlign = 'right';
      ctx.fillStyle = UI.faint;
      ctx.fillText(b.note, cw / 2 + bw / 2, ly);
      ctx.textAlign = 'left';
      statBar(ctx, cw / 2 - bw / 2, ly + 4 * s, bw, 5 * s, b.base, b.extra, b.max, c.colour);
      ly += 20 * s;
    }
    ctx.restore();

    centred(
      ctx,
      'lighter bar = with its upgrade potion',
      cw / 2,
      ly + 4 * s,
      sans(9, s, 500),
      UI.faint,
    );

    if (blink()) {
      centred(ctx, 'ENTER or FIRE to begin', cw / 2, ch - 34 * s, sans(13, s, 700), UI.gold);
    }
    centred(ctx, '← → to choose   •   ESC to go back', cw / 2, ch - 16 * s, sans(10, s, 500), UI.faint);
  }
}
