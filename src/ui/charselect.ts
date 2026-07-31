import { CLASSES, CLASS_ORDER, CLASS_VERDICT, classBars, type ClassId } from '@/data/classes';
import type { Layout } from '@/engine/display';
import type { ActionState } from '@/engine/actions';
import { UI, centred, logo, sans, statBar, blink } from '@/render/ui';
import { sprites } from '@/render/sprites';
import { WALK_FRAMES } from '@/render/spritegen';
import { INTRO } from '@/data/campaign';
import type { Pointer } from '@/engine/pointer';
import { MenuInput, type Screen } from './screen';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

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
  /**
   * Whether to skip the seven intro levels.
   *
   * The arcade put this on the last tutorial level as numbered exits, and it still does
   * — but that only helps a player who has already walked through the tutorial to reach
   * it. Somebody on their fifth run wants the choice before it costs them seven levels,
   * so it is offered here too. Remembered between runs, because a returning player
   * asking to skip once is telling you something about every run after it.
   */
  skipTutorial = false;
  /** Card the cursor is over, or -1. Purely visual — hovering never changes the choice,
   *  so a mouse resting on the screen cannot fight the arrow keys. */
  private hover = -1;

  constructor(
    private readonly kbPressed: (code: string) => boolean,
    private readonly onChoose: (cls: ClassId, skipTutorial: boolean) => void,
    private readonly onBack: () => void,
    private readonly pointer: Pointer,
    private readonly getLayout: () => Layout,
  ) {}

  /**
   * Where everything sits, in canvas pixels.
   *
   * Shared by draw() and step() so a click lands on exactly the rectangle that was
   * drawn. Computing the layout twice — once to paint, once to hit-test — is how you get
   * a button that highlights in one place and responds in another.
   */
  private geometry(layout: Layout): {
    cards: Rect[];
    tutorial: Rect;
    dungeon: Rect;
    begin: Rect;
  } {
    const s = layout.uiScale;
    const cw = layout.canvasW;
    const ch = layout.canvasH;
    const n = CLASS_ORDER.length;
    const gap = 12 * s;
    const cardW = Math.min(200 * s, (cw - 60 * s - (n - 1) * gap) / n);
    const totalW = n * cardW + (n - 1) * gap;
    const x0 = (cw - totalW) / 2;
    const top = 112 * s;
    const cardH = Math.min(268 * s, ch - top - 210 * s);

    return {
      cards: CLASS_ORDER.map((_, i) => ({
        x: x0 + i * (cardW + gap),
        y: top,
        w: cardW,
        h: cardH,
      })),
      // Two side-by-side options rather than one line that toggles. A single line reads
      // as a caption describing the current state; you have to already know it is a
      // control to try it. Two boxes with one lit is unmistakably a choice.
      tutorial: { x: cw / 2 - 210 * s, y: ch - 78 * s, w: 205 * s, h: 34 * s },
      dungeon: { x: cw / 2 + 5 * s, y: ch - 78 * s, w: 205 * s, h: 34 * s },
      begin: { x: cw / 2 - 130 * s, y: ch - 40 * s, w: 260 * s, h: 30 * s },
    };
  }

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
    // Left/right picks the character; up/down works the start option. They used to both
    // change the character, which left no free axis for a second choice.
    if (this.menu.left) this.index = (this.index + n - 1) % n;
    if (this.menu.right) this.index = (this.index + 1) % n;
    if (this.menu.up || this.menu.down) this.skipTutorial = !this.skipTutorial;
    if (this.kbPressed('KeyT')) this.skipTutorial = !this.skipTutorial;

    // --- mouse. The cards look like buttons, so they are buttons.
    if (stepIndex === 0) {
      const g = this.geometry(this.getLayout());
      this.hover = g.cards.findIndex((r) => this.pointer.over(r.x, r.y, r.w, r.h));

      for (let i = 0; i < g.cards.length; i++) {
        const r = g.cards[i];
        if (!this.pointer.hit(r.x, r.y, r.w, r.h)) continue;
        // First click picks; clicking the one already picked commits. That way a click
        // is never an irreversible commitment made by accident, but choosing and starting
        // is still two clicks in the same place rather than a hunt for a button.
        if (i === this.index) {
          this.onChoose(this.selected, this.skipTutorial);
          return;
        }
        this.index = i;
      }

      // Each option sets its own value rather than toggling, so clicking the one that is
      // already lit is a no-op instead of silently flipping you to the other.
      if (this.pointer.hit(g.tutorial.x, g.tutorial.y, g.tutorial.w, g.tutorial.h)) {
        this.skipTutorial = false;
      }
      if (this.pointer.hit(g.dungeon.x, g.dungeon.y, g.dungeon.w, g.dungeon.h)) {
        this.skipTutorial = true;
      }
      if (this.pointer.hit(g.begin.x, g.begin.y, g.begin.w, g.begin.h)) {
        this.onChoose(this.selected, this.skipTutorial);
        return;
      }
    }

    if (this.menu.confirm) this.onChoose(this.selected, this.skipTutorial);
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

    const g = this.geometry(layout);
    CLASS_ORDER.forEach((id, i) => {
      const r = g.cards[i];
      this.card(ctx, s, r.x, r.y, r.w, r.h, id, i === this.index, i === this.hover);
    });

    // --- detail for the highlighted class
    const c = CLASSES[this.selected];
    let y = g.cards[0].y + g.cards[0].h + 34 * s;
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

    // --- where the run starts. Two visible options with one lit, not a line of text that
    // happens to toggle: a player who does not know the option exists will otherwise
    // replay the tutorial forever, which is exactly what happened.
    centred(ctx, 'START AT', cw / 2, g.tutorial.y - 8 * s, sans(8.5, s, 600), UI.faint, 2.4 * s);
    this.option(ctx, s, g.tutorial, 'TUTORIAL', `${INTRO.length} levels, one idea each`, !this.skipTutorial);
    this.option(ctx, s, g.dungeon, 'DUNGEON', `skip to depth ${INTRO.length + 1}`, this.skipTutorial);

    // The begin button is drawn as a button rather than as a blinking hint. A hint tells
    // you a key exists; a button tells you where to click, and this screen had four
    // card-shaped things that ignored every click aimed at them.
    const beginHot = this.pointer.over(g.begin.x, g.begin.y, g.begin.w, g.begin.h);
    this.button(ctx, s, g.begin, 'ENTER, FIRE or CLICK to begin', beginHot || blink() ? UI.gold : UI.dim, 12);

    centred(
      ctx,
      '← →  choose      ↑ ↓  start point      ESC  back      or use the mouse',
      cw / 2,
      ch - 6 * s,
      sans(9.5, s, 500),
      UI.faint,
    );
  }

  /** One side of the start-point choice. Lit when active, boxed on hover. */
  private option(
    ctx: CanvasRenderingContext2D,
    s: number,
    r: Rect,
    label: string,
    note: string,
    active: boolean,
  ): void {
    const hot = this.pointer.over(r.x, r.y, r.w, r.h);
    ctx.fillStyle = active ? 'rgba(255,215,106,.13)' : hot ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.02)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = active ? UI.gold : hot ? 'rgba(255,215,106,.5)' : 'rgba(255,255,255,.12)';
    ctx.lineWidth = Math.max(1, s * (active ? 1.4 : 0.8));
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

    centred(ctx, label, r.x + r.w / 2, r.y + 15 * s, sans(11, s, 800), active ? UI.gold : UI.dim, 1.6 * s);
    centred(ctx, note, r.x + r.w / 2, r.y + 27 * s, sans(8.5, s, 500), UI.faint);
  }

  /** A hit-testable label: box on hover, so what is clickable is visible before clicking. */
  private button(
    ctx: CanvasRenderingContext2D,
    s: number,
    r: Rect,
    text: string,
    colour: string,
    size: number,
  ): void {
    if (this.pointer.over(r.x, r.y, r.w, r.h)) {
      ctx.fillStyle = 'rgba(255,255,255,.07)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = 'rgba(255,215,106,.45)';
      ctx.lineWidth = Math.max(1, s);
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    }
    centred(ctx, text, r.x + r.w / 2, r.y + r.h * 0.68, sans(size, s, 800), colour, 1.2 * s);
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
    hot = false,
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
    // Hover lifts an unselected card so it is obvious the card is a control, not a poster.
    if (hot && !sel) {
      ctx.fillStyle = 'rgba(255,255,255,.06)';
      ctx.fillRect(x, y, w, h);
    }
    ctx.strokeStyle = sel ? c.colour : hot ? 'rgba(255,215,106,.55)' : 'rgba(255,255,255,.09)';
    ctx.lineWidth = sel ? Math.max(2, s * 1.6) : Math.max(1, s * (hot ? 1.2 : 0.6));
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
