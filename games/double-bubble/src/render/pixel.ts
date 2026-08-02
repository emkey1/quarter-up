/**
 * A tiny indexed-colour pixel buffer.
 *
 * Everything here works on palette INDICES, not colours, so a sprite can be recoloured
 * (monster kinds, angry states, bubble tints) by swapping a ramp rather than redrawing
 * it — which is what keeps the art budget sane.
 *
 * Copied from Bracer unchanged. It has no game-specific knowledge at all and is the
 * strongest candidate for packages/cabinet at M6.
 */

export const TRANSPARENT = 0;

/**
 * A shade ramp. Index 1 is always the outline, and the rest run dark → light.
 * Five steps is the sweet spot at this size: enough to model a form, few enough to stay
 * readable when the sprite is 16 pixels tall and moving.
 */
export interface Ramp {
  outline: string;
  darkest: string;
  dark: string;
  base: string;
  light: string;
  lightest: string;
}

export function ramp(base: string, opts: { outline?: string; spread?: number } = {}): Ramp {
  const spread = opts.spread ?? 1;
  return {
    outline: opts.outline ?? shade(base, 0.22),
    darkest: shade(base, 0.45 - 0.05 * spread),
    dark: shade(base, 0.68),
    base,
    light: shade(base, 1.28),
    lightest: shade(base, 1.55),
  };
}

export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp255(((n >> 16) & 255) * k);
  const g = clamp255(((n >> 8) & 255) * k);
  const b = clamp255((n & 255) * k);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Palette slots, in the order every ramp is registered. */
export const enum P {
  Clear = 0,
  Outline = 1,
  Darkest = 2,
  Dark = 3,
  Base = 4,
  Light = 5,
  Lightest = 6,
  /** Second ramp starts here — used for trim, highlight, metal, etc. */
  Outline2 = 7,
  Darkest2 = 8,
  Dark2 = 9,
  Base2 = 10,
  Light2 = 11,
  Lightest2 = 12,
  Outline3 = 13,
  Darkest3 = 14,
  Dark3 = 15,
  Base3 = 16,
  Light3 = 17,
  Lightest3 = 18,
}

export function palette(...ramps: Ramp[]): string[] {
  const out: string[] = ['rgba(0,0,0,0)'];
  for (const r of ramps) {
    out.push(r.outline, r.darkest, r.dark, r.base, r.light, r.lightest);
  }
  return out;
}

export class Px {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h);
  }

  clone(): Px {
    const p = new Px(this.w, this.h);
    p.data.set(this.data);
    return p;
  }

  at(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return TRANSPARENT;
    return this.data[y * this.w + x];
  }

  set(x: number, y: number, c: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[y * this.w + x] = c;
  }

  /** Only paint where nothing has been painted yet — for layering behind. */
  setIfClear(x: number, y: number, c: number): void {
    if (this.at(x, y) === TRANSPARENT) this.set(x, y, c);
  }

  rect(x: number, y: number, w: number, h: number, c: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  /** Filled ellipse. The workhorse: heads, bodies, blobs, bubbles. */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: number): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / Math.max(0.5, rx);
        const dy = (y - cy) / Math.max(0.5, ry);
        if (dx * dx + dy * dy <= 1.02) this.set(x, y, c);
      }
    }
  }

  /** Unfilled ellipse — the bubble outline, which must stay see-through. */
  ellipseOutline(cx: number, cy: number, rx: number, ry: number, c: number): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / Math.max(0.5, rx);
        const dy = (y - cy) / Math.max(0.5, ry);
        const d = dx * dx + dy * dy;
        if (d <= 1.02 && d >= 0.55) this.set(x, y, c);
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: number): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    for (;;) {
      this.set(x, y, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /** Checkerboard between two indices — the classic way to fake a gradient step. */
  dither(x: number, y: number, w: number, h: number, a: number, b: number, phase = 0): void {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (this.at(x + i, y + j) === TRANSPARENT) continue;
        this.set(x + i, y + j, (i + j + phase) % 2 === 0 ? a : b);
      }
    }
  }

  /**
   * Wrap the silhouette in a 1px outline.
   *
   * This single pass is most of what separates "pixel art" from "coloured shapes": it
   * gives the sprite a hard edge that survives being drawn over a busy background.
   */
  outline(c: number, diagonal = true): void {
    const src = this.data.slice();
    const solid = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < this.w && y < this.h && src[y * this.w + x] !== TRANSPARENT;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (solid(x, y)) continue;
        const n =
          solid(x - 1, y) ||
          solid(x + 1, y) ||
          solid(x, y - 1) ||
          solid(x, y + 1) ||
          (diagonal &&
            (solid(x - 1, y - 1) ||
              solid(x + 1, y - 1) ||
              solid(x - 1, y + 1) ||
              solid(x + 1, y + 1)));
        if (n) this.set(x, y, c);
      }
    }
  }

  /**
   * Light from the top-left: lift pixels whose up-left neighbour is empty, darken those
   * whose down-right neighbour is empty. Applied to whole ramps so it works on any
   * recolour.
   */
  shadePass(rampStart: number): void {
    const src = this.data.slice();
    const inRamp = (v: number) => v >= rampStart + 2 && v <= rampStart + 5;
    const get = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < this.w && y < this.h ? src[y * this.w + x] : TRANSPARENT;

    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const v = get(x, y);
        if (!inRamp(v)) continue;
        const upLeftEmpty = get(x - 1, y - 1) === TRANSPARENT || get(x, y - 1) === TRANSPARENT;
        const downRightEmpty = get(x + 1, y + 1) === TRANSPARENT || get(x, y + 1) === TRANSPARENT;
        if (upLeftEmpty && !downRightEmpty) this.set(x, y, Math.min(rampStart + 5, v + 1));
        else if (downRightEmpty && !upLeftEmpty) this.set(x, y, Math.max(rampStart + 2, v - 1));
      }
    }
  }

  mirrorX(): Px {
    const p = new Px(this.w, this.h);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) p.set(this.w - 1 - x, y, this.at(x, y));
    }
    return p;
  }

  /** Shift the whole sprite; used for walk-cycle bob. */
  offset(dx: number, dy: number): Px {
    const p = new Px(this.w, this.h);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) p.set(x + dx, y + dy, this.at(x, y));
    }
    return p;
  }

  /** Render to an offscreen canvas once, so the hot path blits instead of per-pixel. */
  toCanvas(pal: readonly string[]): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.h;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    const img = ctx.createImageData(this.w, this.h);
    for (let i = 0; i < this.data.length; i++) {
      const v = this.data[i];
      if (v === TRANSPARENT) continue;
      const hex = pal[v] ?? '#ff00ff';
      const n = parseInt(hex.slice(1), 16);
      img.data[i * 4] = (n >> 16) & 255;
      img.data[i * 4 + 1] = (n >> 8) & 255;
      img.data[i * 4 + 2] = n & 255;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
}
