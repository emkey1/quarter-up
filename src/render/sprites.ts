import { T } from '@/data/tuning';
import type { Player } from '@/game/player';
import type { Monster } from '@/game/monster';
import type { Generator } from '@/game/generator';
import type { Item } from '@/game/items';
import type { Projectile } from '@/game/projectile';
import type { Death, Thief } from '@/game/special';
import { buildSpriteAtlas, SPRITE, WALK_FRAMES, type Atlas } from './spritegen';

/**
 * Draws entities from the baked pixel atlas.
 *
 * Everything is blitted at NATIVE size scaled by an integer factor with smoothing off.
 * That is the whole point: the previous renderer drew shapes at display resolution and
 * therefore anti-aliased them into soft blobs, which is why the art never read as pixel
 * art whatever the palette did.
 */
export class Sprites {
  private atlas: Atlas | null = null;

  ensure(): Atlas {
    if (!this.atlas) this.atlas = buildSpriteAtlas();
    return this.atlas;
  }

  private blit(
    ctx: CanvasRenderingContext2D,
    key: string,
    sx: number,
    sy: number,
    px: number,
    alpha = 1,
  ): void {
    const atlas = this.ensure();
    const f = atlas.frames.get(key);
    if (!f) return;
    // A 16wu entity occupies 16 * pxPerWu on screen; the source is 32px native.
    const size = T.TILE * px;
    if (alpha !== 1) {
      ctx.save();
      ctx.globalAlpha = alpha;
    }
    ctx.drawImage(atlas.canvas, f.x, f.y, f.w, f.h, Math.round(sx - size / 2), Math.round(sy - size / 2), size, size);
    if (alpha !== 1) ctx.restore();
  }

  /** Ground shadow, drawn under everything so sprites sit on the floor. */
  private shadow(ctx: CanvasRenderingContext2D, sx: number, sy: number, px: number, w = 9): void {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.42)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 6 * px, w * px * 0.5, 3 * px * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  player(ctx: CanvasRenderingContext2D, p: Player, sx: number, sy: number, px: number, frame: number): void {
    this.shadow(ctx, sx, sy, px);
    // Only advance the walk cycle when actually moving; a marching-on-the-spot idle
    // is one of the clearest tells of cheap animation.
    const f = p.moved ? Math.floor(frame / 6) % WALK_FRAMES : 0;
    this.blit(ctx, `p:${p.classId}:${p.facing}:${f}`, sx, sy, px);
    if (p.rooted) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,225,120,.85)';
      ctx.lineWidth = Math.max(1, px);
      ctx.beginPath();
      ctx.moveTo(sx - 5 * px, sy + 8 * px);
      ctx.lineTo(sx + 5 * px, sy + 8 * px);
      ctx.stroke();
      ctx.restore();
    }
  }

  monster(ctx: CanvasRenderingContext2D, m: Monster, sx: number, sy: number, px: number, frame: number): void {
    const alpha = Math.min(1, m.age / 12) * (m.visible ? 1 : 0.25);
    if (m.kind !== 'ghost' && m.kind !== 'sorcerer') this.shadow(ctx, sx, sy, px, 8);
    const f = Math.floor(frame / 10) % 2;
    this.blit(ctx, `m:${m.kind}:${m.level}:${f}`, sx, sy, px, alpha);
    if (m.hurtFlash > 0) this.flash(ctx, sx, sy, px);
  }

  death(ctx: CanvasRenderingContext2D, d: Death, sx: number, sy: number, px: number, frame: number): void {
    this.blit(ctx, `death:${Math.floor(frame / 16) % 2}`, sx, sy, px);
    if (d.hurtFlash > 0) this.flash(ctx, sx, sy, px);
  }

  thief(ctx: CanvasRenderingContext2D, t: Thief, sx: number, sy: number, px: number, frame: number): void {
    this.shadow(ctx, sx, sy, px, 7);
    this.blit(ctx, `thief:${t.carrying ? 1 : 0}:${Math.floor(frame / 5) % 2}`, sx, sy, px);
  }

  generator(ctx: CanvasRenderingContext2D, g: Generator, sx: number, sy: number, px: number): void {
    // Keyed by monster KIND, not by family. Keying it by family meant grunt, demon,
    // sorcerer and lobber nests were the same four pixels, and which nest you rush first
    // is the main decision a crowded level asks you to make.
    const lvl = Math.max(1, Math.min(3, g.level));
    this.blit(ctx, `gen:${g.kind}:${lvl}`, sx, sy, px);
    if (g.hurtFlash > 0) this.flash(ctx, sx, sy, px);
  }

  item(ctx: CanvasRenderingContext2D, it: Item, sx: number, sy: number, px: number, frame: number): void {
    const bob = Math.round(Math.sin(frame * 0.06 + it.x * 0.05) * px * 0.8);
    const variant =
      it.kind === 'food' ? (it.breakable ? 1 : 0) : it.kind === 'potion' ? (it.breakable ? 0 : 1) : 0;
    this.blit(ctx, `it:${it.kind}:${variant}`, sx, sy + bob, px);
  }

  projectile(ctx: CanvasRenderingContext2D, p: Projectile, sx: number, sy: number, px: number): void {
    // Projectiles stay procedural: they are pure light, and a glow reads better than
    // a sprite at this size.
    let y = sy;
    if (p.kind === 'rock' && p.flight > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath();
      ctx.ellipse(sx, sy, 3 * px, 1.6 * px, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      y -= p.z * 14 * px;
    }
    const r = Math.max(px * 1.1, p.half * px * 0.9);
    ctx.save();
    ctx.translate(sx, y);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.8);
    g.addColorStop(0, p.fromPlayer ? 'rgba(255,255,225,.95)' : 'rgba(255,150,110,.95)');
    g.addColorStop(1, 'rgba(255,170,70,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.kind === 'rock' ? '#bcae90' : p.fromPlayer ? '#fffde8' : '#ffd2a8';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * A single sprite drawn large, for menus. Scaled by an integer factor with smoothing
   * off, so a portrait is the same art the game uses rather than a separate drawing
   * that can drift out of sync with it.
   */
  portrait(
    ctx: CanvasRenderingContext2D,
    key: string,
    sx: number,
    sy: number,
    scale: number,
    alpha = 1,
  ): void {
    const atlas = this.ensure();
    const f = atlas.frames.get(key);
    if (!f) return;
    const size = Math.round(SPRITE * scale);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = alpha;
    ctx.drawImage(
      atlas.canvas,
      f.x, f.y, f.w, f.h,
      Math.round(sx - size / 2), Math.round(sy - size / 2),
      size, size,
    );
    ctx.restore();
  }

  /** White hit flash: draw the sprite again as a solid silhouette. */
  private flash(ctx: CanvasRenderingContext2D, sx: number, sy: number, px: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(sx, sy, 7 * px, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** Shared instance: the atlas is deterministic and identical everywhere, so building
 *  it twice would only waste memory and time. */
export const sprites = new Sprites();
