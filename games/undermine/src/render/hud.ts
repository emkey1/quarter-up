import type { Layout } from '@cabinet/display';
import { T } from '@/data/tuning';

/**
 * Score, lives, and whatever the game is currently telling you.
 *
 * A vertical cabinet on a landscape monitor leaves wide empty margins, and the HUD lives
 * in one of them rather than over the playfield. That is not just tidiness: the playfield
 * here is 14 cells wide and the player spends the whole game reading its geometry, so
 * anything drawn on top of it is covering the thing being played.
 *
 * At narrow widths there is no margin to use and the readout goes over the sky strip
 * instead, which is empty by construction — see `keepRightPanel: false` in main.ts, and
 * the flank policy the cabinet's display exposes for exactly this choice.
 */
export interface HudState {
  score: number;
  lives: number;
  enemiesLeft: number;
  /** Large centred message, or null. */
  banner: string | null;
  /** Small line under the banner — the level name, or a controls reminder. */
  subtitle: string | null;
}

export class Hud {
  draw(ctx: CanvasRenderingContext2D, layout: Layout, s: HudState): void {
    const pf = layout.playfield;
    const u = layout.uiScale;
    const panel = layout.rightPanel;

    ctx.save();
    ctx.textBaseline = 'top';

    const label = (text: string, value: string, x: number, y: number): void => {
      ctx.fillStyle = 'rgba(230,233,239,.55)';
      ctx.font = `${Math.round(7 * u)}px ui-monospace, Menlo, monospace`;
      ctx.fillText(text, x, y);
      ctx.fillStyle = '#ffe9a0';
      ctx.font = `${Math.round(13 * u)}px ui-monospace, Menlo, monospace`;
      ctx.fillText(value, x, y + Math.round(9 * u));
    };

    /*
     * The controls, written down.
     *
     * Reported from play as "how do I activate the pump" — which is a fair question when
     * nothing on screen says. A one-button game can afford to state its one button, and a
     * cabinet would have had it silkscreened on the panel.
     */
    if (panel && panel.w > 90 * u) {
      const x = panel.x + Math.round(14 * u);
      let y = panel.y + Math.round(16 * u);
      label('SCORE', String(s.score).padStart(6, '0'), x, y);
      y += Math.round(34 * u);
      label('LIVES', String(s.lives), x, y);
      y += Math.round(34 * u);
      label('LEFT', String(s.enemiesLeft), x, y);
      y += Math.round(44 * u);
      ctx.fillStyle = 'rgba(230,233,239,.45)';
      ctx.font = `${Math.round(7 * u)}px ui-monospace, Menlo, monospace`;
      ctx.fillText('ARROWS  DIG', x, y);
      ctx.fillText('SPACE   PUMP', x, y + Math.round(10 * u));
      ctx.fillText('P       PAUSE', x, y + Math.round(20 * u));
    } else {
      // No margin: put it over the sky, which is empty by construction.
      ctx.fillStyle = '#ffe9a0';
      ctx.font = `${Math.round(9 * u)}px ui-monospace, Menlo, monospace`;
      ctx.fillText(String(s.score).padStart(6, '0'), pf.x + 6 * u, pf.y + 4 * u);
      ctx.textAlign = 'right';
      ctx.fillText(`${s.lives}`, pf.x + pf.w - 6 * u, pf.y + 4 * u);
      ctx.textAlign = 'left';
    }

    if (s.banner) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      const h = Math.round(30 * u);
      ctx.fillRect(pf.x, pf.y + pf.h / 2 - h / 2, pf.w, h);
      ctx.fillStyle = '#ffe9a0';
      ctx.font = `${Math.round(14 * u)}px ui-monospace, Menlo, monospace`;
      ctx.fillText(s.banner, pf.x + pf.w / 2, pf.y + pf.h / 2 - Math.round(7 * u));
      if (s.subtitle) {
        ctx.fillStyle = 'rgba(230,233,239,.75)';
        ctx.font = `${Math.round(8 * u)}px ui-monospace, Menlo, monospace`;
        ctx.fillText(s.subtitle, pf.x + pf.w / 2, pf.y + pf.h / 2 + Math.round(9 * u));
      }
      ctx.textAlign = 'left';
    }

    ctx.restore();
  }

  /** Floating score numbers, so a burst tells you what it was worth where it happened. */
  drawFloaters(
    ctx: CanvasRenderingContext2D,
    layout: Layout,
    floaters: readonly { points: number; x: number; y: number; life: number }[],
  ): void {
    const pf = layout.playfield;
    const px = layout.pxPerWu;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `${Math.round(9 * layout.uiScale)}px ui-monospace, Menlo, monospace`;
    for (const f of floaters) {
      ctx.globalAlpha = Math.min(1, f.life / 30);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(
        String(f.points),
        pf.x + f.x * px,
        pf.y + (f.y - (T.CELL * (60 - f.life)) / 60) * px,
      );
    }
    ctx.restore();
  }
}
