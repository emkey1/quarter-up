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
