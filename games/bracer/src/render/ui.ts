import type { Layout, Rect } from '@cabinet/display';

/** Shared chrome for the menu screens. Kept deliberately plain: this is a game about
 *  a dungeon, and the UI's job is to get out of the way quickly. */

export const UI: Record<string, string> = {
  fg: '#e8ebf0',
  dim: 'rgba(232,235,240,.5)',
  faint: 'rgba(232,235,240,.28)',
  gold: '#ffd76a',
  bad: '#ff6b5e',
  good: '#4fbf5f',
  panel: 'rgba(10,11,16,.82)',
  border: 'rgba(255,255,255,.10)',
};

export function sans(size: number, s: number, weight = 500): string {
  return `${weight} ${size * s}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
}

export function mono(size: number, s: number, weight = 500): string {
  return `${weight} ${size * s}px ui-monospace, SFMono-Regular, Menlo, monospace`;
}

export function dimScreen(ctx: CanvasRenderingContext2D, layout: Layout, alpha = 0.72): void {
  ctx.save();
  ctx.fillStyle = `rgba(4,5,9,${alpha})`;
  ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);
  ctx.restore();
}

export function panel(ctx: CanvasRenderingContext2D, r: Rect, s: number): void {
  ctx.save();
  ctx.fillStyle = UI.panel;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = UI.border;
  ctx.lineWidth = Math.max(1, s * 0.6);
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  ctx.restore();
}

export function centred(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  colour: string,
  letterSpacing = 0,
): void {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = colour;
  ctx.textAlign = 'center';
  if (letterSpacing) ctx.letterSpacing = `${letterSpacing}px`;
  ctx.fillText(text, x, y);
  ctx.letterSpacing = '0px';
  ctx.textAlign = 'left';
  ctx.restore();
}

/** The wordmark. Drawn rather than an image so it scales cleanly at any size. */
export function logo(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  s: number,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.font = sans(46, s, 800);
  ctx.letterSpacing = `${9 * s}px`;
  const grad = ctx.createLinearGradient(0, y - 40 * s, 0, y + 10 * s);
  grad.addColorStop(0, '#ffe9a0');
  grad.addColorStop(0.55, '#e8a13c');
  grad.addColorStop(1, '#8c4a18');
  ctx.fillStyle = grad;
  ctx.fillText('BRACER', cx, y);
  ctx.letterSpacing = '0px';
  ctx.textAlign = 'left';
  ctx.restore();
}

/** A 0..max stat bar with an optional lighter "with upgrade" extension. */
export function statBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  base: number,
  extra: number,
  max: number,
  colour: string,
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,.08)';
  ctx.fillRect(x, y, w, h);
  const clamp = (v: number) => Math.max(0, Math.min(1, v / max));
  // upgrade headroom first, so the base draws over it
  if (extra > base) {
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.fillRect(x, y, w * clamp(extra), h);
  }
  ctx.fillStyle = colour;
  ctx.fillRect(x, y, w * clamp(base), h);
  ctx.restore();
}

/** Blinking prompt. Uses wall time deliberately: it is chrome, not simulation. */
export function blink(period = 900): boolean {
  return (performance.now() % period) / period < 0.62;
}
