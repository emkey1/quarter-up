import type { Layout } from '@/engine/display';
import type { ActionState } from '@/engine/actions';
import { UI, centred, logo, sans, mono, blink } from '@/render/ui';
import type { Pointer } from '@/engine/pointer';
import { MenuInput, type Screen } from './screen';
import { loadScores, sortScores } from './highscores';
import { CLASSES, CLASS_ORDER } from '@/data/classes';
import { sprites } from '@/render/sprites';
import { WALK_FRAMES } from '@/render/spritegen';

const TIPS: readonly string[] = [
  'Generators are the real enemy. Kill the source, not the stream.',
  'Holding fire roots you in place. Tapping it does not.',
  'Two diagonally adjacent blocks can be shot between — unless your shot is Large.',
  'Ghosts destroy themselves on you. The next one is already there.',
  'Keys and potions share twelve slots. Carry two to four keys, no more.',
  'A full inventory is solid. Hoarding keys walls you out of corridors.',
  'Death cannot be killed. Only a potion stops it — any potion.',
  'Shoot Death six times before using a potion on it. Then count your points.',
  'Lobbers throw where you will be. Stop walking in straight lines.',
  'Demons fire through walls. So aim them at a generator.',
  "Remember: don't shoot the food.",
  'The richer you get, the less food appears. Greed is the difficulty curve.',
];

/**
 * Attract mode.
 *
 * An arcade cabinet is never idle — it is always showing you why to put a coin in. This
 * cycles the high scores and the tips that the cabinet's narrator used to shout, over a
 * dimmed live level so the game is visibly *running* rather than a static poster.
 */
export class AttractScreen implements Screen {
  readonly id = 'attract' as const;
  private menu = new MenuInput();
  private t = 0;
  private tipIndex = 0;
  private page: 'title' | 'scores' = 'title';

  constructor(
    private readonly kbPressed: (code: string) => boolean,
    private readonly onStart: () => void,
    private readonly pointer: Pointer,
  ) {}

  enter(): void {
    this.t = 0;
    this.menu = new MenuInput();
  }

  step(a: Readonly<ActionState>, stepIndex: number): void {
    this.menu.read(a, stepIndex, this.kbPressed);
    this.t++;
    // Alternate title and scoreboard, the way a cabinet does.
    const cycle = this.t % (16 * 60);
    this.page = cycle < 10 * 60 ? 'title' : 'scores';
    if (this.t % (5 * 60) === 0) this.tipIndex = (this.tipIndex + 1) % TIPS.length;
    // A click anywhere starts, like pressing anything else. The four characters on this
    // screen are decoration, but they look exactly like the ones you pick on the next
    // screen, so a click aimed at them has to do SOMETHING rather than nothing at all.
    if (this.menu.confirm || (stepIndex === 0 && this.pointer.clicked)) this.onStart();
  }

  draw(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const s = layout.uiScale;
    const cw = layout.canvasW;
    const ch = layout.canvasH;

    // The live dungeon is drawn underneath by the app. Darken it and vignette hard, so
    // it reads as atmosphere behind the type rather than competing with it.
    ctx.save();
    ctx.fillStyle = 'rgba(4,5,10,.74)';
    ctx.fillRect(0, 0, cw, ch);
    const vig = ctx.createRadialGradient(
      cw / 2, ch / 2, Math.min(cw, ch) * 0.15,
      cw / 2, ch / 2, Math.max(cw, ch) * 0.62,
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,.88)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();

    if (this.page === 'title') {
      logo(ctx, cw / 2, ch * 0.32, s * 1.35);
      centred(
        ctx,
        'A SINGLE-PLAYER DUNGEON CRAWL IN THE SPIRIT OF GAUNTLET',
        cw / 2,
        ch * 0.32 + 30 * s,
        sans(10, s, 600),
        UI.dim,
        2.5 * s,
      );

      // The four classes, walking, as a strip. Shows what the game looks like before
      // anyone has pressed anything.
      const n = CLASS_ORDER.length;
      const step = Math.min(120 * s, cw / (n + 2));
      const scale = Math.max(2, Math.round((2.6 * s) / 1.2));
      const py = ch * 0.5;
      CLASS_ORDER.forEach((id, i) => {
        const x = cw / 2 + (i - (n - 1) / 2) * step;
        const frame = Math.floor((this.t + i * 9) / 8) % WALK_FRAMES;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,.45)';
        ctx.beginPath();
        ctx.ellipse(x, py + 15 * scale, 10 * scale * 0.6, 3 * scale * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        sprites.portrait(ctx, `p:${id}:2:${frame}`, x, py + (frame === 1 ? -scale : 0), scale);
        centred(ctx, CLASSES[id].name.toUpperCase(), x, py + 22 * scale, sans(9, s, 700), CLASSES[id].colour, 1 * s);
      });

      if (blink()) {
        centred(ctx, 'PRESS ENTER OR CLICK', cw / 2, ch * 0.75, sans(20, s, 800), UI.gold, 2.5 * s);
      }

      centred(ctx, TIPS[this.tipIndex], cw / 2, ch * 0.84, sans(12, s, 600), UI.fg);
      centred(
        ctx,
        'TAB  setup       G  controller       arrows or a gamepad to play',
        cw / 2,
        ch - 28 * s,
        sans(10, s, 500),
        UI.faint,
      );
    } else {
      centred(ctx, 'HIGH SCORES', cw / 2, ch * 0.2, sans(22, s, 800), UI.gold, 5 * s);
      centred(
        ctx,
        'RANKED BY SCORE PER CREDIT, AS THE CABINET DID',
        cw / 2,
        ch * 0.2 + 24 * s,
        sans(9, s, 600),
        UI.faint,
        2 * s,
      );

      const list = sortScores(loadScores()).slice(0, 10);
      const bw = Math.min(460 * s, cw - 80 * s);
      const bx = cw / 2 - bw / 2;
      let y = ch * 0.2 + 58 * s;

      if (!list.length) {
        centred(ctx, 'no scores yet — be the first', cw / 2, y + 20 * s, sans(12, s, 500), UI.dim);
      }
      for (const [i, e] of list.entries()) {
        if (i % 2 === 0) {
          ctx.fillStyle = 'rgba(255,255,255,.035)';
          ctx.fillRect(bx - 8 * s, y - 12 * s, bw + 16 * s, 20 * s);
        }
        ctx.font = mono(14, s, 700);
        ctx.fillStyle = i === 0 ? UI.gold : UI.dim;
        ctx.fillText(`${String(i + 1).padStart(2)}`, bx, y);
        ctx.fillStyle = i === 0 ? UI.gold : UI.fg;
        ctx.fillText(e.initials, bx + 34 * s, y);
        ctx.textAlign = 'right';
        ctx.fillText(String(e.scorePerCredit), bx + bw * 0.62, y);
        ctx.font = mono(10, s, 500);
        ctx.fillStyle = CLASSES[e.cls].colour;
        ctx.fillText(CLASSES[e.cls].name, bx + bw * 0.85, y);
        ctx.fillStyle = UI.faint;
        ctx.fillText(`L${e.deepestLevel}`, bx + bw, y);
        ctx.textAlign = 'left';
        y += 22 * s;
      }

      if (blink()) {
        centred(ctx, 'PRESS ENTER OR CLICK', cw / 2, ch - 46 * s, sans(18, s, 800), UI.gold, 2.5 * s);
      }
    }
  }
}
