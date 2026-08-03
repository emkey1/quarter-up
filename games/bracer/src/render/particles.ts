import type { Rect } from '@cabinet/display';

/**
 * Pooled particles. Render-only: never stepped by the simulation, never read by it.
 *
 * That separation matters more than it looks. Particles are driven by events the
 * simulation emits, so they cannot feed back into gameplay, cannot desynchronise a
 * replay, and can be dropped entirely under prefers-reduced-motion without changing a
 * single frame of the game.
 */

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  colour: string;
  gravity: number;
  fade: boolean;
  alive: boolean;
}

const MAX = 400;

export class Particles {
  private pool: Particle[] = [];
  private cursor = 0;
  enabled = true;

  constructor() {
    for (let i = 0; i < MAX; i++) {
      this.pool.push({
        x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1,
        size: 1, colour: '#fff', gravity: 0, fade: true, alive: false,
      });
    }
  }

  get liveCount(): number {
    let n = 0;
    for (const p of this.pool) if (p.alive) n++;
    return n;
  }

  clear(): void {
    for (const p of this.pool) p.alive = false;
  }

  private take(): Particle {
    // Ring buffer: at the cap, the oldest particle is recycled rather than the new one
    // being dropped, so a big explosion always reads as a big explosion.
    for (let i = 0; i < MAX; i++) {
      const p = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % MAX;
      if (!p.alive) return p;
    }
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % MAX;
    return p;
  }

  spawn(
    x: number,
    y: number,
    count: number,
    opts: {
      speed?: number;
      spread?: number;
      angle?: number;
      life?: number;
      size?: number;
      colours?: string[];
      gravity?: number;
      seed?: number;
    } = {},
  ): void {
    if (!this.enabled) return;
    const {
      speed = 1.2,
      spread = Math.PI * 2,
      angle = 0,
      life = 30,
      size = 2,
      colours = ['#ffffff'],
      gravity = 0,
    } = opts;

    // Deterministic-looking scatter without touching the simulation's RNG.
    let seed = (opts.seed ?? Math.floor(x * 7 + y * 13)) | 0;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let i = 0; i < count; i++) {
      const p = this.take();
      const a = angle + (rnd() - 0.5) * spread;
      const sp = speed * (0.4 + rnd() * 0.9);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.maxLife = life * (0.6 + rnd() * 0.8);
      p.life = p.maxLife;
      p.size = size * (0.6 + rnd() * 0.8);
      p.colour = colours[Math.floor(rnd() * colours.length)] ?? '#fff';
      p.gravity = gravity;
      p.fade = true;
      p.alive = true;
    }
  }

  update(): void {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.vx *= 0.96;
      p.vy *= 0.96;
      if (--p.life <= 0) p.alive = false;
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    pf: Rect,
    toX: (wx: number) => number,
    toY: (wy: number) => number,
    px: number,
  ): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(pf.x, pf.y, pf.w, pf.h);
    ctx.clip();
    for (const p of this.pool) {
      if (!p.alive) continue;
      const a = p.fade ? Math.max(0, p.life / p.maxLife) : 1;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.colour;
      const s = Math.max(1, p.size * px * a);
      ctx.fillRect(toX(p.x) - s / 2, toY(p.y) - s / 2, s, s);
    }
    ctx.restore();
  }
}

/** Palettes keyed to what died, so an explosion tells you what it was. */
export const FX_COLOURS = {
  ghost: ['#f0b8e8', '#ffffff', '#c060a0'],
  monster: ['#ffd090', '#ff8040', '#ffffff'],
  generator: ['#ffb060', '#ff6020', '#ffe0a0', '#804020'],
  spark: ['#fffbe0', '#ffd060'],
  dust: ['#a89878', '#6a5c48'],
  /** A breakable wall coming down: masonry, not sparks. */
  rubble: ['#8a7a4a', '#6a5c48', '#b8a878', '#4a4030'],
  blood: ['#ff4040', '#c02020'],
  magic: ['#d8b0ff', '#ffffff', '#9060e0'],
  pickup: ['#ffe9a0', '#ffffff'],
} as const;
