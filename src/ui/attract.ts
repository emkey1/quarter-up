import type { Layout } from '@/engine/display';
import type { ActionState } from '@/engine/actions';
import { UI, centred, logo, sans, mono, blink } from '@/render/ui';
import { MenuInput, type Screen } from './screen';
import { loadScores, sortScores } from './highscores';
import { CLASSES } from '@/data/classes';

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
    if (this.menu.confirm) this.onStart();
  }

  draw(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const s = layout.uiScale;
    const cw = layout.canvasW;
    const ch = layout.canvasH;

    // The live level is drawn underneath by the app; darken it heavily so the text
    // stays legible over whatever chaos is happening back there.
    ctx.fillStyle = 'rgba(4,5,9,.80)';
    ctx.fillRect(0, 0, cw, ch);

    if (this.page === 'title') {
      logo(ctx, cw / 2, ch * 0.34, s);
      centred(
        ctx,
        'a single-player dungeon crawl in the spirit of Gauntlet',
        cw / 2,
        ch * 0.34 + 26 * s,
        sans(11, s, 500),
        UI.dim,
      );

      if (blink()) {
        centred(ctx, 'PRESS ENTER', cw / 2, ch * 0.56, sans(18, s, 800), UI.gold, 2 * s);
      }

      centred(ctx, TIPS[this.tipIndex], cw / 2, ch * 0.68, sans(12, s, 600), UI.fg);
      centred(
        ctx,
        'TAB setup   •   G controller   •   arrows or a gamepad to play',
        cw / 2,
        ch - 26 * s,
        sans(10, s, 500),
        UI.faint,
      );
    } else {
      centred(ctx, 'HIGH SCORES', cw / 2, ch * 0.24, sans(16, s, 800), UI.gold, 4 * s);
      centred(
        ctx,
        'ranked by score per credit, as the cabinet did',
        cw / 2,
        ch * 0.24 + 20 * s,
        sans(10, s, 500),
        UI.faint,
      );

      const list = sortScores(loadScores()).slice(0, 10);
      const bw = Math.min(400 * s, cw - 60 * s);
      const bx = cw / 2 - bw / 2;
      let y = ch * 0.24 + 48 * s;

      if (!list.length) {
        centred(ctx, 'no scores yet — be the first', cw / 2, y + 20 * s, sans(12, s, 500), UI.dim);
      }
      for (const [i, e] of list.entries()) {
        ctx.font = mono(12, s, 600);
        ctx.fillStyle = i === 0 ? UI.gold : UI.dim;
        ctx.fillText(`${String(i + 1).padStart(2)}  ${e.initials}`, bx, y);
        ctx.textAlign = 'right';
        ctx.fillStyle = i === 0 ? UI.gold : UI.fg;
        ctx.fillText(String(e.scorePerCredit), bx + bw * 0.6, y);
        ctx.font = mono(9, s, 500);
        ctx.fillStyle = UI.faint;
        ctx.fillText(`${CLASSES[e.cls].name.slice(0, 3)}  L${e.deepestLevel}`, bx + bw, y);
        ctx.textAlign = 'left';
        y += 19 * s;
      }

      if (blink()) {
        centred(ctx, 'PRESS ENTER', cw / 2, ch - 44 * s, sans(15, s, 800), UI.gold, 2 * s);
      }
    }
  }
}
