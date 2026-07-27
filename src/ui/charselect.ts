import { CLASSES, CLASS_ORDER, CLASS_VERDICT, classBars, type ClassId } from '@/data/classes';
import type { Layout } from '@/engine/display';
import type { ActionState } from '@/engine/actions';
import { UI, centred, logo, sans, statBar, blink } from '@/render/ui';
import { sprites } from '@/render/sprites';
import { WALK_FRAMES } from '@/render/spritegen';
import { MenuInput, type Screen } from './screen';

/**
 * Character select.
 *
 * Solo, this is where the one decision that shapes a whole run gets made, so it shows
 * the numbers rather than four names and a vibe. The bars are ordered by how much each
 * actually decides the run — magic vs generators leads, because that is the difference
 * between a potion clearing a nest and merely annoying it.
 *
 * The portraits are the REAL sprites from the game's atlas, and the highlighted one
 * walks. That matters for more than looks: what you see here is exactly what you will
 * be looking at for the next ten minutes, and it cannot drift out of sync with the game
 * the way a separately-drawn portrait would.
 */
export class CharSelectScreen implements Screen {
  readonly id = 'charselect' as const;
  private index = 3; // Elf: the strongest solo pick, so it is the sensible default
  private menu = new MenuInput();
  private t = 0;

  constructor(
    private readonly kbPressed: (code: string) => boolean,
    private readonly onChoose: (cls: ClassId) => void,
    private readonly onBack: () => void,
  ) {}

  enter(): void {
    this.menu = new MenuInput();
    this.t = 0;
  }

  get selected(): ClassId {
    return CLASS_ORDER[this.index];
  }

  step(a: Readonly<ActionState>, stepIndex: number): void {
    this.menu.read(a, stepIndex, this.kbPressed);
    this.t++;
    const n = CLASS_ORDER.length;
    if (this.menu.left || this.menu.up) this.index = (this.index + n - 1) % n;
    if (this.menu.right || this.menu.down) this.index = (this.index + 1) % n;
    if (this.menu.confirm) this.onChoose(this.selected);
    if (this.menu.cancel) this.onBack();
  }

  draw(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const s = layout.uiScale;
    const cw = layout.canvasW;
    const ch = layout.canvasH;

    // Heavy scrim plus a vignette. The live dungeon behind should read as atmosphere,
    // never as competing detail.
    ctx.save();
    ctx.fillStyle = 'rgba(4,5,10,.86)';
    ctx.fillRect(0, 0, cw, ch);
    const vig = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.2, cw / 2, ch / 2, Math.max(cw, ch) * 0.7);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,.75)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();

    logo(ctx, cw / 2, 58 * s, s, 0.42);
    centred(ctx, 'CHOOSE YOUR CHARACTER', cw / 2, 84 * s, sans(11, s, 600), UI.dim, 3.5 * s);

    const n = CLASS_ORDER.length;
    const gap = 12 * s;
    const cardW = Math.min(200 * s, (cw - 60 * s - (n - 1) * gap) / n);
    const totalW = n * cardW + (n - 1) * gap;
    const x0 = (cw - totalW) / 2;
    const top = 112 * s;
    const cardH = Math.min(268 * s, ch - top - 210 * s);

    CLASS_ORDER.forEach((id, i) => {
      const c = CLASSES[id];
      const x = x0 + i * (cardW + gap);
      const sel = i === this.index;
      this.card(ctx, s, x, top, cardW, cardH, id, sel);
      void c;
    });

    // --- detail for the highlighted class
    const c = CLASSES[this.selected];
    let y = top + cardH + 34 * s;
    centred(ctx, CLASS_VERDICT[this.selected], cw / 2, y, sans(13, s, 700), c.colour);
    y += 26 * s;

    const bars = classBars(c);
    const bw = Math.min(420 * s, cw - 100 * s);
    const bx = cw / 2 - bw / 2;
    for (const b of bars) {
      ctx.font = sans(9.5, s, 600);
      ctx.fillStyle = UI.dim;
      ctx.fillText(b.label, bx, y);
      ctx.textAlign = 'right';
      ctx.font = sans(9, s, 400);
      ctx.fillStyle = UI.faint;
      ctx.fillText(b.note, bx + bw, y);
      ctx.textAlign = 'left';
      statBar(ctx, bx, y + 5 * s, bw, 6 * s, b.base, b.extra, b.max, c.colour);
      y += 21 * s;
    }

    centred(ctx, 'lighter bar = with its upgrade potion', cw / 2, y + 6 * s, sans(9, s, 500), UI.faint);

    if (blink()) {
      centred(ctx, 'ENTER or FIRE to begin', cw / 2, ch - 36 * s, sans(14, s, 800), UI.gold, 1.5 * s);
    }
    centred(ctx, '← →  choose      ESC  back', cw / 2, ch - 16 * s, sans(10, s, 500), UI.faint);
  }

  private card(
    ctx: CanvasRenderingContext2D,
    s: number,
    x: number,
    y: number,
    w: number,
    h: number,
    id: ClassId,
    sel: boolean,
  ): void {
    const c = CLASSES[id];

    ctx.save();
    // A lit alcove for the selected character, so the eye lands before it reads.
    if (sel) {
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, hexA(c.colour, 0.18));
      g.addColorStop(0.55, 'rgba(10,11,16,.9)');
      g.addColorStop(1, 'rgba(10,11,16,.9)');
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = 'rgba(9,10,15,.78)';
    }
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = sel ? c.colour : 'rgba(255,255,255,.09)';
    ctx.lineWidth = sel ? Math.max(2, s * 1.6) : Math.max(1, s * 0.6);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();

    // --- the actual game sprite, walking when highlighted
    const px = x + w / 2;
    const py = y + 78 * s;
    const scale = Math.max(2, Math.round((3.4 * s) / 1.2));
    const frame = sel ? Math.floor(this.t / 7) % WALK_FRAMES : 0;

    // pedestal shadow
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.beginPath();
    ctx.ellipse(px, py + 15 * scale, 11 * scale * 0.6, 3.2 * scale * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Facing south so you see the face, and bobbing with the walk.
    const bob = sel && frame === 1 ? -scale : 0;
    sprites.portrait(ctx, `p:${id}:2:${frame}`, px, py + bob, scale, sel ? 1 : 0.5);

    let ty = y + 132 * s;
    centred(ctx, c.name.toUpperCase(), px, ty, sans(16, s, 800), sel ? c.colour : UI.dim, 1.5 * s);
    ty += 16 * s;
    centred(ctx, c.hero, px, ty, sans(10, s, 500), UI.faint);
    ty += 20 * s;

    // The one stat that can never be upgraded, called out as such.
    const boxColour = c.shotBox === 'large' ? UI.bad : c.shotBox === 'small' ? UI.good : UI.dim;
    centred(ctx, `${c.shotBox.toUpperCase()} SHOT`, px, ty, sans(9.5, s, 700), sel ? boxColour : UI.faint, 1 * s);
    ty += 10 * s;
    centred(ctx, 'cannot be upgraded', px, ty, sans(8, s, 400), UI.faint);
    ty += 18 * s;

    const bars = classBars(c).slice(0, 4);
    ctx.save();
    ctx.globalAlpha = sel ? 1 : 0.42;
    for (const b of bars) {
      ctx.font = sans(8, s, 500);
      ctx.fillStyle = UI.faint;
      ctx.fillText(b.label, x + 14 * s, ty);
      statBar(ctx, x + 14 * s, ty + 3 * s, w - 28 * s, 4.5 * s, b.base, b.extra, b.max, c.colour);
      ty += 16 * s;
    }
    ctx.restore();
  }
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
