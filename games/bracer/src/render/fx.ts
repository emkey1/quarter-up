import type { Layout, Rect } from '@cabinet/display';

/**
 * Screen-level feedback: shake, flash, vignette, impact punch.
 *
 * All render-only. In particular there is NO hit-stop, despite DESIGN.md §6.4 listing
 * it: stopping the simulation for two frames would change the fixed-step clock, and
 * therefore the health drain, every timer, and every recorded replay. The same feel is
 * delivered by a two-frame camera punch instead, which costs the simulation nothing.
 */
export class ScreenFx {
  /** Set false by prefers-reduced-motion. Flash and shake are the usual triggers for
   *  motion sensitivity, so they go together. */
  motionEnabled = true;

  private shake = 0;
  private shakeDecay = 0.86;
  private flash = 0;
  private flashColour = '#ffffff';
  private punch = 0;
  private vignette = 0;
  private phase = 0;

  reset(): void {
    this.shake = this.flash = this.punch = this.vignette = 0;
  }

  addShake(amount: number): void {
    if (!this.motionEnabled) return;
    this.shake = Math.min(12, this.shake + amount);
  }

  addFlash(amount: number, colour = '#ffffff'): void {
    if (!this.motionEnabled) return;
    this.flash = Math.min(1, this.flash + amount);
    this.flashColour = colour;
  }

  /** A brief scale punch. Reads like hit-stop without touching the clock. */
  addPunch(amount: number): void {
    if (!this.motionEnabled) return;
    this.punch = Math.min(1, this.punch + amount);
  }

  /** Red edge pulse on damage; kept even under reduced motion because it is
   *  information, not decoration — it just stops pulsing. */
  addVignette(amount: number): void {
    this.vignette = Math.min(1, this.vignette + amount);
  }

  update(): void {
    this.phase++;
    this.shake *= this.shakeDecay;
    if (this.shake < 0.05) this.shake = 0;
    this.flash *= 0.82;
    if (this.flash < 0.01) this.flash = 0;
    this.punch *= 0.7;
    if (this.punch < 0.01) this.punch = 0;
    this.vignette *= 0.9;
    if (this.vignette < 0.01) this.vignette = 0;
  }

  /** Offset to apply to the playfield origin this frame. */
  get offsetX(): number {
    return this.shake === 0 ? 0 : Math.sin(this.phase * 1.7) * this.shake;
  }

  get offsetY(): number {
    return this.shake === 0 ? 0 : Math.cos(this.phase * 2.3) * this.shake;
  }

  /** Extra scale for the punch, applied about the playfield centre. */
  get scale(): number {
    return 1 + this.punch * 0.012;
  }

  drawOverlays(ctx: CanvasRenderingContext2D, layout: Layout, pf: Rect): void {
    if (this.flash > 0) {
      ctx.save();
      ctx.globalAlpha = this.flash * 0.85;
      ctx.fillStyle = this.flashColour;
      ctx.fillRect(pf.x, pf.y, pf.w, pf.h);
      ctx.restore();
    }

    if (this.vignette > 0) {
      ctx.save();
      const g = ctx.createRadialGradient(
        pf.x + pf.w / 2,
        pf.y + pf.h / 2,
        Math.min(pf.w, pf.h) * 0.32,
        pf.x + pf.w / 2,
        pf.y + pf.h / 2,
        Math.max(pf.w, pf.h) * 0.72,
      );
      g.addColorStop(0, 'rgba(255,0,0,0)');
      g.addColorStop(1, `rgba(190,0,0,${this.vignette * 0.65})`);
      ctx.fillStyle = g;
      ctx.fillRect(pf.x, pf.y, pf.w, pf.h);
      ctx.restore();
    }
    void layout;
  }
}

/** Honour the OS setting rather than making people hunt for a toggle. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
