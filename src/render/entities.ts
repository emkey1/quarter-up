import { CLASSES } from '@/data/classes';
import { FACE_DX, FACE_DY, type Player } from '@/game/player';
import { MONSTER_COLOURS, familyOf, type Monster } from '@/game/monster';
import type { Generator } from '@/game/generator';
import type { Projectile } from '@/game/projectile';

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

/** M1 placeholder monster art. Level reads as colour ramp + size, which is the same
 *  palette-swap approach the real art uses (DESIGN.md §6.4). */
export function drawMonster(
  ctx: CanvasRenderingContext2D,
  m: Monster,
  sx: number,
  sy: number,
  px: number,
  frame: number,
): void {
  const size = 16 * px;
  const colour = MONSTER_COLOURS[m.kind][m.level - 1];
  const wobble = Math.sin(frame * 0.2 + m.x * 0.1) * px * 0.6;

  ctx.save();
  ctx.translate(sx, sy);
  // spawn fade-in, so a monster popping out of a generator is legible
  ctx.globalAlpha = Math.min(1, m.age / 12);

  ctx.fillStyle = 'rgba(0,0,0,.4)';
  ctx.beginPath();
  ctx.ellipse(0, size * 0.4, size * 0.26, size * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = m.hurtFlash > 0 ? '#ffffff' : colour;

  if (m.kind === 'ghost') {
    // wavy sheet, no legs — reads as "does not stop, cannot be meleed"
    ctx.beginPath();
    ctx.arc(0, -size * 0.05 + wobble * 0.3, size * 0.28, Math.PI, 0);
    ctx.lineTo(size * 0.28, size * 0.28);
    for (let i = 3; i >= 0; i--) {
      ctx.lineTo(size * (-0.28 + 0.1867 * i) + size * 0.02, size * (i % 2 ? 0.36 : 0.24));
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1a1020';
    ctx.fillRect(-size * 0.15, -size * 0.12, size * 0.09, size * 0.1);
    ctx.fillRect(size * 0.06, -size * 0.12, size * 0.09, size * 0.1);
  } else {
    roundRect(ctx, -size * 0.26, -size * 0.16 + wobble * 0.15, size * 0.52, size * 0.54, size * 0.1);
    ctx.fill();
    ctx.fillStyle = m.hurtFlash > 0 ? '#ffffff' : shade(colour, 1.3);
    ctx.beginPath();
    ctx.arc(0, -size * 0.26 + wobble * 0.15, size * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#12100e';
    ctx.fillRect(-size * 0.1, -size * 0.3, size * 0.06, size * 0.06);
    ctx.fillRect(size * 0.04, -size * 0.3, size * 0.06, size * 0.06);
  }

  ctx.restore();
}

export function drawGenerator(
  ctx: CanvasRenderingContext2D,
  g: Generator,
  sx: number,
  sy: number,
  px: number,
  frame: number,
): void {
  const size = 16 * px;
  const colour = MONSTER_COLOURS[g.kind][Math.max(0, Math.min(2, g.level - 1))];
  const bone = familyOf(g.kind) === 'bone';

  ctx.save();
  ctx.translate(sx, sy);

  // Charge glow: brightens as the next spawn approaches. The arcade could not
  // telegraph this; it costs nothing here and makes generator pressure readable.
  const pulse = 0.25 + g.charge * 0.75;
  const glow = ctx.createRadialGradient(0, 0, size * 0.05, 0, 0, size * 0.85);
  glow.addColorStop(0, `rgba(255,120,80,${0.5 * pulse})`);
  glow.addColorStop(1, 'rgba(255,120,80,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-size, -size, size * 2, size * 2);

  ctx.fillStyle = g.hurtFlash > 0 ? '#ffffff' : colour;
  if (bone) {
    // skull-ish pile
    ctx.beginPath();
    ctx.arc(0, -size * 0.05, size * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-size * 0.32, size * 0.1, size * 0.64, size * 0.22);
    ctx.fillStyle = '#1a1018';
    ctx.fillRect(-size * 0.17, -size * 0.12, size * 0.11, size * 0.12);
    ctx.fillRect(size * 0.06, -size * 0.12, size * 0.11, size * 0.12);
  } else {
    roundRect(ctx, -size * 0.36, -size * 0.36, size * 0.72, size * 0.72, size * 0.08);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(-size * 0.22, -size * 0.22, size * 0.44, size * 0.44);
    ctx.fillStyle = `rgba(255,190,120,${pulse})`;
    const n = size * 0.1 + Math.sin(frame * 0.12) * size * 0.02;
    ctx.fillRect(-n, -n, n * 2, n * 2);
  }

  // remaining level as pips, so "how much more does this need" is visible
  ctx.fillStyle = '#ffe9a0';
  for (let i = 0; i < g.level; i++) {
    ctx.fillRect(-size * 0.3 + i * size * 0.22, size * 0.38, size * 0.14, size * 0.08);
  }

  ctx.restore();
}

export function drawProjectile(
  ctx: CanvasRenderingContext2D,
  p: Projectile,
  sx: number,
  sy: number,
  px: number,
): void {
  const r = Math.max(px * 1.2, p.half * px);
  ctx.save();
  ctx.translate(sx, sy);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.6);
  g.addColorStop(0, p.fromPlayer ? 'rgba(255,255,220,.95)' : 'rgba(255,160,120,.95)');
  g.addColorStop(1, 'rgba(255,180,80,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r * 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = p.fromPlayer ? '#fffce0' : '#ffd0a0';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
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
