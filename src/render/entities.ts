import { CLASSES } from '@/data/classes';
import { FACE_DX, FACE_DY, type Player } from '@/game/player';

/**
 * M0 placeholder art, drawn procedurally.
 *
 * There is exactly one entity on screen right now, so baking an atlas would be
 * premature; M4 replaces this with 32x32 hand-drawn frames (8 facings, 6-frame walk)
 * behind the same call signature.
 *
 * What it does need to do today is read *facing* unambiguously, because facing is the
 * thing the fire models are all about.
 */
export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  p: Player,
  sx: number,
  sy: number,
  px: number,
  frame: number,
): void {
  const cls = CLASSES[p.classId];
  const size = 16 * px; // nominal entity footprint in device px
  const bob = p.moved ? Math.sin(frame * 0.35) * (px * 0.5) : 0;

  ctx.save();
  ctx.translate(sx, sy);

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.beginPath();
  ctx.ellipse(0, size * 0.42, size * 0.3, size * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(0, bob);

  // body
  ctx.fillStyle = cls.colour;
  roundRect(ctx, -size * 0.28, -size * 0.18, size * 0.56, size * 0.6, size * 0.14);
  ctx.fill();

  // head
  ctx.fillStyle = shade(cls.colour, 1.35);
  ctx.beginPath();
  ctx.arc(0, -size * 0.3, size * 0.2, 0, Math.PI * 2);
  ctx.fill();

  // facing indicator: the weapon, out along the facing octant. Reading facing at a
  // glance is non-negotiable given the fire models depend on it.
  const fx = FACE_DX[p.facing];
  const fy = FACE_DY[p.facing];
  const len = size * 0.5;
  ctx.strokeStyle = '#f2f2f2';
  ctx.lineWidth = Math.max(1, px * 1.5);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(fx * size * 0.16, fy * size * 0.16 - size * 0.05);
  ctx.lineTo(fx * len, fy * len - size * 0.05);
  ctx.stroke();

  // rooted indicator: a small brace under the feet while the fire model is holding
  // you still, so it reads as a stance rather than as dropped input.
  if (p.rooted) {
    ctx.strokeStyle = 'rgba(255,225,120,.9)';
    ctx.lineWidth = Math.max(1, px);
    ctx.beginPath();
    ctx.moveTo(-size * 0.3, size * 0.44);
    ctx.lineTo(size * 0.3, size * 0.44);
    ctx.stroke();
  }

  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * k));
  const b = Math.min(255, Math.round((n & 255) * k));
  return `rgb(${r},${g},${b})`;
}
