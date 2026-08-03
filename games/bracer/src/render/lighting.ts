import type { Rect } from '@cabinet/display';

export interface Light {
  x: number; // screen px
  y: number;
  radius: number;
  /** 0..1 */
  strength: number;
  colour?: string;
}

/**
 * Darkness with holes punched in it.
 *
 * Rendered at half resolution because it is a soft gradient — nobody can see the
 * difference, and it quarters the fill cost. The buffer is filled with the ambient
 * darkness, then each light is subtracted with `destination-out`, then the whole thing
 * is composited over the playfield.
 *
 * This is the one part of the presentation that changes how the game *reads*: a
 * generator brightens as its spawn timer fills, so pressure is visible before it
 * arrives. The arcade's fixed palette could not do that.
 */
export class Lighting {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private w = 0;
  private h = 0;

  enabled = true;
  /** 0 = no darkness at all, 1 = pitch black between lights. */
  ambient = 0.55;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
  }

  private ensure(pf: Rect): boolean {
    const w = Math.max(1, Math.ceil(pf.w / 2));
    const h = Math.max(1, Math.ceil(pf.h / 2));
    if (w !== this.w || h !== this.h) {
      this.w = w;
      this.h = h;
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return !!this.ctx;
  }

  draw(target: CanvasRenderingContext2D, pf: Rect, lights: readonly Light[]): void {
    if (!this.enabled || this.ambient <= 0) return;
    if (!this.ensure(pf) || !this.ctx) return;
    const c = this.ctx;

    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = `rgba(6,5,14,${this.ambient})`;
    c.fillRect(0, 0, this.w, this.h);

    c.globalCompositeOperation = 'destination-out';
    for (const l of lights) {
      const lx = (l.x - pf.x) / 2;
      const ly = (l.y - pf.y) / 2;
      const r = Math.max(1, l.radius / 2);
      if (lx + r < 0 || ly + r < 0 || lx - r > this.w || ly - r > this.h) continue;
      const g = c.createRadialGradient(lx, ly, 0, lx, ly, r);
      const s = Math.max(0, Math.min(1, l.strength));
      g.addColorStop(0, `rgba(0,0,0,${s})`);
      g.addColorStop(0.55, `rgba(0,0,0,${s * 0.55})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(lx, ly, r, 0, Math.PI * 2);
      c.fill();
    }
    c.globalCompositeOperation = 'source-over';

    target.save();
    target.imageSmoothingEnabled = true; // the one place smoothing is wanted
    target.drawImage(this.canvas, 0, 0, this.w, this.h, pf.x, pf.y, pf.w, pf.h);
    target.restore();
  }
}
