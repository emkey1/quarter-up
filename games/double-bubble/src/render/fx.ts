import { T } from '@/data/tuning';
import type { Layout } from '@cabinet/display';
import type { WorldEvent } from '@/game/world';

/**
 * Transient effects: bursts, sparks, and score pops.
 *
 * Purely presentational and deliberately outside the simulation. Nothing here feeds
 * back into the world, so a replay cannot depend on how many sparks were drawn, and the
 * step function never grows a reference to a particle system.
 *
 * These are not decoration. Without them a burst bubble simply ceases to exist, and a
 * four-chain looks exactly like four separate pops — which hides the one mechanic the
 * whole scoring curve is built around. The size of the flash IS the feedback that the
 * chain was worth something.
 *
 * No RNG anywhere: spark angles are evenly spaced and offset by the spawn position, so
 * two bursts in the same place look the same and neighbouring ones do not rhyme.
 */

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  colour: string;
}

interface Ring {
  x: number;
  y: number;
  from: number;
  to: number;
  life: number;
  maxLife: number;
  colour: string;
  width: number;
}

interface Pop {
  x: number;
  y: number;
  text: string;
  life: number;
  maxLife: number;
  colour: string;
  scale: number;
}

const RING_FRAMES = 15;
const SPARK_FRAMES = 26;
const POP_FRAMES = 52;
/** Sparks fall, but far more gently than a body — they are foam, not rocks. */
const SPARK_GRAVITY = T.GRAVITY * 0.35;

export class Fx {
  private readonly rings: Ring[] = [];
  private readonly sparks: Spark[] = [];
  private readonly pops: Pop[] = [];

  get count(): number {
    return this.rings.length + this.sparks.length + this.pops.length;
  }

  clear(): void {
    this.rings.length = 0;
    this.sparks.length = 0;
    this.pops.length = 0;
  }

  /** Turn one frame's worth of world events into effects. */
  consume(events: WorldEvent[]): void {
    for (const e of events) {
      switch (e.kind) {
        case 'bubblePop':
          this.burst(e.x, e.y, '#bff4ff', 6, 1.1);
          break;
        case 'monsterPop':
          // Bigger, and in the monster's own colour, so a loaded pop is unmistakably
          // worth more than an empty one at a glance.
          this.burst(e.x, e.y, e.colour, 10, 1.7);
          this.rings.push({
            x: e.x,
            y: e.y,
            from: T.BUBBLE_RADIUS,
            to: T.BUBBLE_RADIUS * 2.6,
            life: RING_FRAMES,
            maxLife: RING_FRAMES,
            colour: '#ffffff',
            width: 2,
          });
          break;
        case 'escape':
          // Red and ragged: an escape is a loss, and must not read like a kill.
          this.burst(e.x, e.y, '#ff5b4a', 8, 1.3);
          break;
        case 'chain':
          if (e.monsters > 0) {
            this.pops.push({
              x: e.x,
              y: e.y,
              text: e.points.toLocaleString(),
              life: POP_FRAMES,
              maxLife: POP_FRAMES,
              colour: e.monsters >= 3 ? '#ffd166' : '#cfd2d6',
              // A big chain shouts. This is the only place the player is told the
              // difference between 4,000 and 32,000 in the moment it happens.
              scale: 1 + Math.min(1.2, (e.monsters - 1) * 0.28),
            });
          }
          break;
      }
    }
    events.length = 0;
  }

  private burst(x: number, y: number, colour: string, n: number, speed: number): void {
    this.rings.push({
      x,
      y,
      from: T.BUBBLE_RADIUS * 0.6,
      to: T.BUBBLE_RADIUS * 1.9,
      life: RING_FRAMES,
      maxLife: RING_FRAMES,
      colour,
      width: 1.5,
    });

    // Evenly spaced, offset by position: repeatable, and neighbours do not rhyme.
    const phase = ((Math.round(x * 3 + y * 5) % 64) / 64) * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = phase + (i / n) * Math.PI * 2;
      const s = speed * (0.65 + ((i * 7) % 5) * 0.14);
      this.sparks.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 0.35, // biased upward, like foam coming off
        life: SPARK_FRAMES,
        maxLife: SPARK_FRAMES,
        colour,
      });
    }
  }

  step(): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      if (--this.rings[i].life <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.x += s.vx;
      s.y += s.vy;
      s.vy += SPARK_GRAVITY;
      if (--s.life <= 0) this.sparks.splice(i, 1);
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.y -= 0.28;
      if (--p.life <= 0) this.pops.splice(i, 1);
    }
  }

  draw(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const { playfield, pxPerWu } = layout;
    const sx = (wx: number) => playfield.x + wx * pxPerWu;
    const sy = (wy: number) => playfield.y + wy * pxPerWu;

    ctx.save();

    for (const r of this.rings) {
      const t = 1 - r.life / r.maxLife;
      const radius = r.from + (r.to - r.from) * t;
      ctx.globalAlpha = (1 - t) * 0.85;
      ctx.strokeStyle = r.colour;
      ctx.lineWidth = Math.max(1, r.width * pxPerWu * (1 - t * 0.6));
      ctx.beginPath();
      ctx.arc(sx(r.x), sy(r.y), radius * pxPerWu, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const s of this.sparks) {
      const t = s.life / s.maxLife;
      ctx.globalAlpha = t;
      ctx.fillStyle = s.colour;
      const size = Math.max(1, 1.6 * pxPerWu * t);
      ctx.fillRect(sx(s.x) - size / 2, sy(s.y) - size / 2, size, size);
    }

    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.pops) {
      const t = p.life / p.maxLife;
      // Hold full opacity most of the way, then fade — a number that starts fading
      // immediately is hard to read at exactly the moment it matters.
      ctx.globalAlpha = Math.min(1, t * 3);
      ctx.font = `700 ${Math.round(9 * p.scale * layout.uiScale)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.lineWidth = Math.max(2, 2 * layout.uiScale);
      ctx.strokeStyle = 'rgba(4,6,10,.9)';
      ctx.strokeText(p.text, sx(p.x), sy(p.y));
      ctx.fillStyle = p.colour;
      ctx.fillText(p.text, sx(p.x), sy(p.y));
    }

    ctx.restore();
  }
}
