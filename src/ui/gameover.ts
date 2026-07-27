import { CLASSES, type ClassId } from '@/data/classes';
import type { Layout } from '@/engine/display';
import type { ActionState } from '@/engine/actions';
import { tierOf, type Rules } from '@/data/rules';
import { UI, centred, panel, sans, mono, blink } from '@/render/ui';
import { MenuInput, type Screen } from './screen';
import {
  DEFAULT_INITIALS,
  insertScore,
  loadScores,
  qualifies,
  saveScores,
  sortScores,
  type ScoreEntry,
} from './highscores';

export interface RunResult {
  cls: ClassId;
  score: number;
  credits: number;
  deepestLevel: number;
  rules: Rules;
}

type Phase = 'continue' | 'initials' | 'table';

/**
 * Game over.
 *
 * Keeps the arcade's continue countdown, because it is the moment the whole credit
 * economy is built around: the machine offers you your run back for another coin, and
 * your score per credit is what pays for it.
 *
 * The table ranks on score-per-credit rather than raw score, so taking the continue is a
 * real cost rather than a free retry.
 */
export class GameOverScreen implements Screen {
  readonly id = 'gameover' as const;
  private phase: Phase = 'continue';
  private countdown = 10 * 60;
  private initials = DEFAULT_INITIALS.split('');
  private cursor = 0;
  private scores: ScoreEntry[] = [];
  private entry: ScoreEntry | null = null;
  private menu = new MenuInput();
  private result: RunResult | null = null;

  constructor(
    private readonly kbPressed: (code: string) => boolean,
    private readonly onContinue: () => void,
    private readonly onDone: () => void,
    private readonly allowContinue: () => boolean,
  ) {}

  setResult(r: RunResult): void {
    this.result = r;
    this.scores = loadScores();
    this.phase = this.allowContinue() ? 'continue' : this.initialsPhase();
    this.countdown = 10 * 60;
    this.initials = DEFAULT_INITIALS.split('');
    this.cursor = 0;
    this.entry = null;
  }

  private get scorePerCredit(): number {
    const r = this.result;
    if (!r) return 0;
    return Math.floor(r.score / Math.max(1, r.credits));
  }

  private initialsPhase(): Phase {
    return qualifies(this.scores, this.scorePerCredit) ? 'initials' : 'table';
  }

  private commit(): void {
    const r = this.result;
    if (!r || this.entry) return;
    this.entry = {
      initials: this.initials.join('').toUpperCase(),
      score: r.score,
      credits: r.credits,
      scorePerCredit: this.scorePerCredit,
      deepestLevel: r.deepestLevel,
      cls: r.cls,
      tier: tierOf(r.rules),
      date: new Date().toISOString().slice(0, 10),
    };
    this.scores = insertScore(this.scores, this.entry);
    saveScores(this.scores);
    this.phase = 'table';
  }

  step(a: Readonly<ActionState>, stepIndex: number): void {
    this.menu.read(a, stepIndex, this.kbPressed);

    if (this.phase === 'continue') {
      if (this.menu.confirm) {
        this.onContinue();
        return;
      }
      if (this.menu.cancel || --this.countdown <= 0) {
        this.phase = this.initialsPhase();
      }
      return;
    }

    if (this.phase === 'initials') {
      const A = 'A'.charCodeAt(0);
      if (this.menu.up) {
        const c = this.initials[this.cursor].charCodeAt(0);
        this.initials[this.cursor] = String.fromCharCode(((c - A + 1) % 26) + A);
      }
      if (this.menu.down) {
        const c = this.initials[this.cursor].charCodeAt(0);
        this.initials[this.cursor] = String.fromCharCode(((c - A + 25) % 26) + A);
      }
      if (this.menu.right) this.cursor = Math.min(2, this.cursor + 1);
      if (this.menu.left) this.cursor = Math.max(0, this.cursor - 1);
      if (this.menu.confirm) {
        if (this.cursor < 2) this.cursor++;
        else this.commit();
      }
      // Typing the letters directly is far quicker than nudging a wheel.
      for (let i = 0; i < 26; i++) {
        const code = `Key${String.fromCharCode(A + i)}`;
        if (this.kbPressed(code)) {
          this.initials[this.cursor] = String.fromCharCode(A + i);
          if (this.cursor < 2) this.cursor++;
        }
      }
      if (this.kbPressed('Enter') && this.cursor >= 2) this.commit();
      return;
    }

    if (this.menu.confirm || this.menu.cancel) this.onDone();
  }

  draw(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const s = layout.uiScale;
    const cw = layout.canvasW;
    const ch = layout.canvasH;
    const r = this.result;

    ctx.fillStyle = 'rgba(5,4,8,.93)';
    ctx.fillRect(0, 0, cw, ch);

    // Laid out from a computed origin rather than a fixed offset, so the block sits
    // balanced on a tall window instead of huddling at the top.
    const blockH = 300 * s + (this.phase === 'table' ? 240 * s : 130 * s);
    const originY = Math.max(60 * s, (ch - blockH) / 2);

    centred(ctx, 'GAME OVER', cw / 2, originY, sans(30, s, 800), UI.bad, 4 * s);

    if (r) {
      const cls = CLASSES[r.cls];
      centred(ctx, cls.name.toUpperCase(), cw / 2, originY + 26 * s, sans(13, s, 600), cls.colour);

      const bw = Math.min(340 * s, cw - 60 * s);
      const bx = cw / 2 - bw / 2;
      let y = originY + 52 * s;
      const stat = (k: string, v: string, colour = UI.fg) => {
        ctx.font = sans(11, s, 500);
        ctx.fillStyle = UI.dim;
        ctx.fillText(k, bx, y);
        ctx.font = mono(13, s, 700);
        ctx.fillStyle = colour;
        ctx.textAlign = 'right';
        ctx.fillText(v, bx + bw, y);
        ctx.textAlign = 'left';
        y += 22 * s;
      };
      stat('Score', String(r.score));
      stat('Credits used', String(r.credits));
      stat('Score per credit', String(this.scorePerCredit), UI.gold);
      stat('Deepest level', String(r.deepestLevel));

      const tier = tierOf(r.rules);
      if (tier !== 'arcade') {
        centred(
          ctx,
          tier === 'tagged' ? 'TAGGED RUN — rules modified' : 'RULES ALTERED — not a straight run',
          cw / 2,
          y + 2 * s,
          sans(10, s, 700),
          tier === 'tagged' ? UI.gold : UI.bad,
        );
        y += 20 * s;
      }
      y += 10 * s;

      if (this.phase === 'continue') this.drawContinue(ctx, layout, y);
      else if (this.phase === 'initials') this.drawInitials(ctx, layout, y);
      else this.drawTable(ctx, layout, y);
    }
  }

  private drawContinue(ctx: CanvasRenderingContext2D, layout: Layout, y: number): void {
    const s = layout.uiScale;
    const cw = layout.canvasW;
    const secs = Math.ceil(this.countdown / 60);
    centred(ctx, 'CONTINUE?', cw / 2, y + 24 * s, sans(22, s, 800), UI.fg);
    centred(ctx, String(secs), cw / 2, y + 66 * s, mono(34, s, 800), secs <= 3 ? UI.bad : UI.gold);
    centred(
      ctx,
      'FIRE or ENTER to continue — it costs a credit',
      cw / 2,
      y + 92 * s,
      sans(11, s, 600),
      UI.dim,
    );
    centred(ctx, 'ESC to end the run', cw / 2, y + 110 * s, sans(10, s, 500), UI.faint);
  }

  private drawInitials(ctx: CanvasRenderingContext2D, layout: Layout, y: number): void {
    const s = layout.uiScale;
    const cw = layout.canvasW;
    centred(ctx, 'A NEW HIGH SCORE', cw / 2, y + 22 * s, sans(14, s, 700), UI.gold);

    const boxW = 34 * s;
    const gap = 10 * s;
    const totalW = 3 * boxW + 2 * gap;
    const x0 = cw / 2 - totalW / 2;
    for (let i = 0; i < 3; i++) {
      const x = x0 + i * (boxW + gap);
      const sel = i === this.cursor;
      panel(ctx, { x, y: y + 36 * s, w: boxW, h: 42 * s }, s);
      if (sel && blink(600)) {
        ctx.fillStyle = 'rgba(255,215,106,.18)';
        ctx.fillRect(x, y + 36 * s, boxW, 42 * s);
      }
      centred(ctx, this.initials[i], x + boxW / 2, y + 68 * s, mono(24, s, 800), sel ? UI.gold : UI.fg);
    }
    centred(
      ctx,
      'type your initials, or ↑ ↓ to change   •   ENTER to confirm',
      cw / 2,
      y + 96 * s,
      sans(10, s, 500),
      UI.faint,
    );
  }

  private drawTable(ctx: CanvasRenderingContext2D, layout: Layout, y: number): void {
    const s = layout.uiScale;
    const cw = layout.canvasW;
    centred(ctx, 'HIGH SCORES', cw / 2, y + 18 * s, sans(12, s, 700), UI.dim, 3 * s);
    centred(ctx, 'ranked by score per credit', cw / 2, y + 32 * s, sans(9, s, 500), UI.faint);

    const list = sortScores(this.scores).slice(0, 10);
    const bw = Math.min(400 * s, cw - 60 * s);
    const bx = cw / 2 - bw / 2;
    let ry = y + 54 * s;

    list.forEach((e, i) => {
      const mine = this.entry === e;
      ctx.font = mono(11, s, mine ? 700 : 500);
      ctx.fillStyle = mine ? UI.gold : UI.dim;
      ctx.fillText(`${String(i + 1).padStart(2)} ${e.initials}`, bx, ry);
      ctx.fillStyle = mine ? UI.gold : UI.fg;
      ctx.textAlign = 'right';
      ctx.fillText(String(e.scorePerCredit), bx + bw * 0.55, ry);
      ctx.font = mono(9, s, 500);
      ctx.fillStyle = UI.faint;
      ctx.fillText(
        `${CLASSES[e.cls].name.slice(0, 3)}  L${e.deepestLevel}  ${e.credits}cr${
          e.tier === 'arcade' ? '' : e.tier === 'tagged' ? '  *' : '  ✕'
        }`,
        bx + bw,
        ry,
      );
      ctx.textAlign = 'left';
      ry += 18 * s;
    });

    if (!list.length) {
      centred(ctx, 'no scores yet', cw / 2, ry + 10 * s, sans(11, s, 500), UI.faint);
      ry += 26 * s;
    }

    if (blink()) {
      centred(ctx, 'ENTER to return to the title', cw / 2, ry + 24 * s, sans(12, s, 700), UI.gold);
    }
  }
}
