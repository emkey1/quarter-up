import { Px, P, ramp, palette } from './pixel';
import { T } from '@/data/tuning';
import type { PlayerPose } from '@/game/player';

/**
 * Procedural player art.
 *
 * The creature is our own — not a green dragon (see DESIGN.md §2). What it does have to
 * carry, because the mechanics depend on reading it, is a visible ridge of spines along
 * its back: that is the part that pops a bubble, and "which way am I facing" is the
 * difference between popping a bubble and pushing it.
 */

/** Art is authored at ART_SCALE px per world unit; the sprite covers 16x16 wu. */
export const SPRITE_PX = 16 * T.ART_SCALE;

const PLAYER_PALETTE = palette(
  ramp('#3fbfa8'), // body — teal
  ramp('#f4e3bd'), // belly
  ramp('#ffffff'), // eye and detail
);

/**
 * Body drawn facing RIGHT; the left-facing frames are mirrored from these.
 *
 * `stretch` is positive for taller-and-narrower. Getting this sign backwards draws a
 * rising body as a pancake, which reads as a landing rather than a launch.
 */
function creature(opts: { legLift: number; stretch: number; mouth: 'flat' | 'open' }): Px {
  const n = SPRITE_PX;
  const p = new Px(n, n);

  const cx = n / 2;
  const cy = n * 0.58;
  const rx = 11 - opts.stretch;
  const ry = 10 + opts.stretch;

  // --- back spines, behind the body so they read as a ridge rather than fins
  for (let i = 0; i < 3; i++) {
    const sx = cx - rx + 2 + i * 3;
    const sy = cy - ry + 3 + i * 3;
    p.line(sx, sy, sx - 4, sy - 2, P.Dark);
    p.line(sx, sy + 1, sx - 4, sy - 1, P.Darkest);
  }

  // --- body
  p.ellipse(cx, cy, rx, ry, P.Base);
  // Belly sits low and forward, which is what gives the silhouette a direction.
  p.ellipse(cx + 2, cy + 3, rx - 4, ry - 4, P.Base2);

  // --- feet
  const lift = opts.legLift;
  p.ellipse(cx - 4, cy + ry - 1 - lift, 3, 2, P.Dark);
  p.ellipse(cx + 4, cy + ry - 1 + lift, 3, 2, P.Dark);

  // --- eye
  p.ellipse(cx + 3, cy - 4, 3.2, 3.6, P.Base3);
  p.ellipse(cx + 4, cy - 4, 1.6, 2, P.Outline3);

  // --- mouth: the bubble comes out of here, so it opens when blowing
  if (opts.mouth === 'open') {
    p.ellipse(cx + 8, cy + 1, 2.2, 2.2, P.Outline2);
  } else {
    p.line(cx + 7, cy + 1, cx + 9, cy + 1, P.Outline2);
  }

  p.shadePass(P.Outline);
  p.outline(P.Outline);
  return p;
}

export interface PlayerSprites {
  /** [facing][pose] → canvas. facing 0 = left, 1 = right. */
  readonly frames: Record<PlayerPose, [HTMLCanvasElement, HTMLCanvasElement][]>;
}

/**
 * The raw pixel buffers, before any canvas exists.
 *
 * Split out from buildPlayerSprites so the art can be measured without a DOM — the
 * stretch sign is invisible in a type check and easy to invert while editing, and a
 * test that reads the silhouette catches it where a screenshot only would otherwise.
 */
export function buildPlayerFrames(): Record<PlayerPose, Px[]> {
  return {
    idle: [creature({ legLift: 0, stretch: 0, mouth: 'flat' })],
    run: [
      creature({ legLift: 1, stretch: 0, mouth: 'flat' }),
      creature({ legLift: -1, stretch: 0, mouth: 'flat' }),
    ],
    // Stretched going up, flattened coming down — the cheapest possible read on which
    // half of the arc you are in, and it matters when you are aiming at a bubble.
    rise: [creature({ legLift: -2, stretch: 1.5, mouth: 'flat' })],
    fall: [creature({ legLift: 1, stretch: -1, mouth: 'open' })],
  };
}

/**
 * Build every player frame once at boot.
 *
 * Two run frames is enough at this size — the original's walk cycle is a bob, not an
 * articulated stride, and more frames read as noise at 32px.
 */
export function buildPlayerSprites(): PlayerSprites {
  const poses = buildPlayerFrames();

  const frames = {} as PlayerSprites['frames'];
  for (const [pose, list] of Object.entries(poses) as [PlayerPose, Px[]][]) {
    frames[pose] = list.map((px) => {
      const right = px.toCanvas(PLAYER_PALETTE);
      const left = px.mirrorX().toCanvas(PLAYER_PALETTE);
      return [left, right] as [HTMLCanvasElement, HTMLCanvasElement];
    });
  }
  return { frames };
}

/* ------------------------------------------------------------------ bubbles */

/** Anger is continuous; the art is quantised to this many steps. */
export const ANGER_STEPS = 6;

/**
 * A bubble: a rim, a highlight, and nothing in the middle.
 *
 * It has to stay see-through — a bubble with a filled body hides the monster inside it,
 * and reading whether a bubble is loaded is how you decide what to pop.
 */
export function bubbleFrame(): Px {
  const n = SPRITE_PX;
  const p = new Px(n, n);
  const c = n / 2;
  const r = T.BUBBLE_RADIUS * T.ART_SCALE - 1;

  p.ellipseOutline(c, c, r, r, P.Base);
  p.ellipseOutline(c, c, r - 1, r - 1, P.Light);

  // Specular highlight, up and to the left, matching the shading everywhere else.
  p.ellipse(c - r * 0.42, c - r * 0.44, 2.4, 1.8, P.Lightest);
  return p;
}

function lerpHex(a: string, b: string, t: number): string {
  const na = parseInt(a.slice(1), 16);
  const nb = parseInt(b.slice(1), 16);
  const mix = (sh: number) => {
    const x = (na >> sh) & 255;
    const y = (nb >> sh) & 255;
    return Math.round(x + (y - x) * t) & 255;
  };
  const v = (mix(16) << 16) | (mix(8) << 8) | mix(0);
  return `#${v.toString(16).padStart(6, '0')}`;
}

/**
 * One canvas per anger step, calm through furious.
 *
 * The reddening is the entire warning that a captive is about to break out. DESIGN.md
 * §3.3 calls for it to be generous — an escape should always feel like something you
 * were told about, never a surprise — so the tint starts shifting well before the clock
 * runs out and the last steps are unmistakable.
 */
export function buildBubbleSprites(): HTMLCanvasElement[] {
  const px = bubbleFrame();
  const out: HTMLCanvasElement[] = [];
  for (let i = 0; i < ANGER_STEPS; i++) {
    const t = i / (ANGER_STEPS - 1);
    out.push(px.toCanvas(palette(ramp(lerpHex('#7fe9ff', '#ff3b3b', t)))));
  }
  return out;
}

/* ------------------------------------------------------------------ monsters */

const ZEN_CALM = palette(ramp('#4a7de8'), ramp('#ffd166'), ramp('#ffffff'));
const ZEN_ANGRY = palette(ramp('#e8564a'), ramp('#ffd166'), ramp('#ffffff'));

/**
 * Zen-Chan: a box-shaped clockwork walker.
 *
 * Boxy on purpose. It is the first thing the player ever sees and it has to read as
 * "mechanical, predictable, patrols" at 24 pixels — every later monster is a deviation
 * from this silhouette, so this one needs to be the plainest.
 */
function zenChan(step: number): Px {
  const n = SPRITE_PX;
  const p = new Px(n, n);
  const cx = n / 2;
  const cy = Math.round(n * 0.56);
  const half = T.MONSTER_HALF * T.ART_SCALE;

  p.rect(cx - half, cy - half, half * 2, half * 2, P.Base);
  p.rect(cx - half + 2, cy - half + 2, half * 2 - 4, 3, P.Light);

  // Wind-up key on the back, so facing is legible even when it is standing still.
  p.rect(cx - half - 3, cy - 3, 3, 6, P.Base2);
  p.set(cx - half - 4, cy - 1, P.Dark2);

  // Eyes
  p.ellipse(cx + 1, cy - 2, 2.6, 2.8, P.Base3);
  p.ellipse(cx + 5, cy - 2, 2.6, 2.8, P.Base3);
  p.ellipse(cx + 2, cy - 2, 1.2, 1.5, P.Outline3);
  p.ellipse(cx + 6, cy - 2, 1.2, 1.5, P.Outline3);

  // Feet alternate so the walk cycle is visible at this size.
  const lift = step === 0 ? 1 : -1;
  p.rect(cx - half + 1, cy + half - lift, 4, 3, P.Dark);
  p.rect(cx + half - 5, cy + half + lift, 4, 3, P.Dark);

  p.shadePass(P.Outline);
  p.outline(P.Outline);
  return p;
}

export interface MonsterSprites {
  /** [angry][step][facing] — facing 0 = left, 1 = right. */
  readonly zenchan: [HTMLCanvasElement, HTMLCanvasElement][][];
}

export function buildMonsterFrames(): Px[] {
  return [zenChan(0), zenChan(1)];
}

export function buildMonsterSprites(): MonsterSprites {
  const frames = buildMonsterFrames();
  const forPalette = (pal: string[]) =>
    frames.map((px) => {
      const right = px.toCanvas(pal);
      const left = px.mirrorX().toCanvas(pal);
      return [left, right] as [HTMLCanvasElement, HTMLCanvasElement];
    });
  return { zenchan: [forPalette(ZEN_CALM), forPalette(ZEN_ANGRY)] };
}
