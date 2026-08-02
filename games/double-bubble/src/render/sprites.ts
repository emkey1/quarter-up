import { Px, P, ramp, palette } from './pixel';
import { T } from '@/data/tuning';
import { MONSTER_SPECS, type ProjectileKind } from '@/data/roster';
import type { MonsterKind } from '@/game/room';
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

/**
 * Every monster is drawn in the same box at the same size, so the roster reads as a
 * family and the differences carry meaning. What varies is the silhouette — and it has
 * to vary enough to tell them apart in a crowded room at speed, because knowing which
 * one is the flier decides whether the tier you are standing on is safety.
 */
function eyes(p: Px, cx: number, cy: number, spacing = 4): void {
  p.ellipse(cx + 1, cy, 2.6, 2.8, P.Base3);
  p.ellipse(cx + 1 + spacing, cy, 2.6, 2.8, P.Base3);
  p.ellipse(cx + 2, cy, 1.2, 1.5, P.Outline3);
  p.ellipse(cx + 2 + spacing, cy, 1.2, 1.5, P.Outline3);
}

type ShapeFn = (p: Px, cx: number, cy: number, half: number, step: number) => void;

const SHAPES: Record<MonsterKind, ShapeFn> = {
  /** Boxy on purpose — the plainest silhouette, so the rest can deviate from it. */
  zenchan: (p, cx, cy, half, step) => {
    p.rect(cx - half, cy - half, half * 2, half * 2, P.Base);
    p.rect(cx - half + 2, cy - half + 2, half * 2 - 4, 3, P.Light);
    p.rect(cx - half - 3, cy - 3, 3, 6, P.Base2); // wind-up key on the back
    eyes(p, cx, cy - 2);
    const lift = step === 0 ? 1 : -1;
    p.rect(cx - half + 1, cy + half - lift, 4, 3, P.Dark);
    p.rect(cx + half - 5, cy + half + lift, 4, 3, P.Dark);
  },

  /** A robe: narrow at the shoulders, flared at the hem, and no legs showing. */
  mighta: (p, cx, cy, half, step) => {
    for (let i = 0; i < half * 2; i++) {
      const w = 5 + (i / (half * 2)) * (half - 1);
      p.rect(cx - w, cy - half + i, w * 2, 1, P.Base);
    }
    p.ellipse(cx, cy - half + 3, 6, 5, P.Base);
    eyes(p, cx, cy - half + 3);
    p.rect(cx - half + (step === 0 ? 0 : 2), cy + half - 1, half * 2 - 2, 2, P.Dark);
  },

  /** A finned blob. No feet at all — the read has to be "this does not walk". */
  monsta: (p, cx, cy, half, step) => {
    p.ellipse(cx, cy, half + 2, half - 1, P.Base);
    const flap = step === 0 ? 2 : -2;
    p.ellipse(cx - half - 1, cy + flap, 4, 2.5, P.Base2);
    p.ellipse(cx + half + 1, cy - flap, 4, 2.5, P.Base2);
    p.ellipse(cx, cy + half - 3, half - 2, 2.5, P.Light);
    eyes(p, cx, cy - 2);
  },

  /** Round and soft with heavy lobes; drifts rather than travels. */
  pulpul: (p, cx, cy, half, step) => {
    p.ellipse(cx, cy, half, half, P.Base);
    const bob = step === 0 ? 1 : -1;
    p.ellipse(cx - half + 1, cy + 2 + bob, 3.5, 4, P.Base2);
    p.ellipse(cx + half - 1, cy + 2 - bob, 3.5, 4, P.Base2);
    p.ellipse(cx, cy + half - 4, half - 3, 3, P.Light);
    eyes(p, cx, cy - 3);
  },

  /** A coil. Reads as "stored energy", which is exactly what it is. */
  banebou: (p, cx, cy, half, step) => {
    const squash = step === 0 ? 1 : -1;
    p.ellipse(cx, cy - 2, half, half - 2 + squash, P.Base);
    for (let i = 0; i < 3; i++) {
      const y = cy + half - 5 + i * 2 + squash;
      p.rect(cx - half + 2 + (i % 2), y, half * 2 - 4, 1, P.Base2);
    }
    eyes(p, cx, cy - 4);
  },

  /** Spined and lean — the first monster whose shots you cannot outrun. */
  hidegons: (p, cx, cy, half, step) => {
    p.ellipse(cx, cy, half, half - 1, P.Base);
    for (let i = 0; i < 4; i++) {
      const sx = cx - half + 1 + i * 3;
      p.line(sx, cy - half + 2, sx - 2, cy - half - 2, P.Base2);
    }
    p.ellipse(cx + half - 3, cy + 1, 4, 3, P.Light);
    eyes(p, cx, cy - 3);
    const lift = step === 0 ? 1 : -1;
    p.rect(cx - 4, cy + half - 1 - lift, 3, 3, P.Dark);
    p.rect(cx + 2, cy + half - 1 + lift, 3, 3, P.Dark);
  },

  /** Pointed hat and a staff. Height stops being safety when this one appears. */
  drunk: (p, cx, cy, half, step) => {
    p.ellipse(cx, cy + 1, half - 1, half - 1, P.Base);
    for (let i = 0; i < 7; i++) {
      const w = half - 1 - i * 1.4;
      if (w > 0) p.rect(cx - w, cy - half - 2 + i, w * 2, 1, P.Base2);
    }
    p.rect(cx + half - 1, cy - half + 2, 2, half * 2 - 2, P.Dark2); // staff
    eyes(p, cx - 1, cy);
    const lift = step === 0 ? 1 : -1;
    p.rect(cx - 4, cy + half - 1 - lift, 3, 3, P.Dark);
    p.rect(cx + 1, cy + half - 1 + lift, 3, 3, P.Dark);
  },

  /** Blocky and symmetrical, with legs that alternate. An obvious late arrival. */
  invader: (p, cx, cy, half, step) => {
    p.rect(cx - half, cy - half + 2, half * 2, half + 2, P.Base);
    p.rect(cx - half + 2, cy - half, half * 2 - 4, 3, P.Base);
    p.rect(cx - half - 2, cy - 2, 2, 5, P.Base2);
    p.rect(cx + half, cy - 2, 2, 5, P.Base2);
    eyes(p, cx, cy - 2);
    const legs = step === 0 ? 0 : 2;
    p.rect(cx - half + legs, cy + half, 3, 3, P.Dark);
    p.rect(cx + half - 3 - legs, cy + half, 3, 3, P.Dark);
  },
};

function monsterFrame(kind: MonsterKind, step: number): Px {
  const n = SPRITE_PX;
  const p = new Px(n, n);
  const cx = Math.round(n / 2);
  const cy = Math.round(n * 0.56);
  SHAPES[kind](p, cx, cy, T.MONSTER_HALF * T.ART_SCALE, step);
  p.shadePass(P.Outline);
  p.outline(P.Outline);
  return p;
}

/** Angry monsters shift toward red, so the state is readable across the room. */
function monsterPalette(kind: MonsterKind, angry: boolean): string[] {
  const base = MONSTER_SPECS[kind].colour;
  return palette(
    ramp(angry ? lerpHex(base, '#ff3020', 0.72) : base),
    ramp('#ffd166'),
    ramp('#ffffff'),
  );
}

export interface MonsterSprites {
  /** [kind][angry][step][facing] — facing 0 = left, 1 = right. */
  readonly byKind: Record<MonsterKind, [HTMLCanvasElement, HTMLCanvasElement][][]>;
}

/** Raw buffers, measurable without a DOM. */
export function buildMonsterFrames(kind: MonsterKind = 'zenchan'): Px[] {
  return [monsterFrame(kind, 0), monsterFrame(kind, 1)];
}

export function buildMonsterSprites(): MonsterSprites {
  const byKind = {} as MonsterSprites['byKind'];
  for (const kind of Object.keys(MONSTER_SPECS) as MonsterKind[]) {
    const frames = buildMonsterFrames(kind);
    byKind[kind] = [false, true].map((angry) => {
      const pal = monsterPalette(kind, angry);
      return frames.map((px) => {
        const right = px.toCanvas(pal);
        const left = px.mirrorX().toCanvas(pal);
        return [left, right] as [HTMLCanvasElement, HTMLCanvasElement];
      });
    });
  }
  return { byKind };
}

/* ------------------------------------------------------------------ the Baron */

/**
 * Baron von Blubba: a bleached Monsta with nothing behind the eyes.
 *
 * Deliberately built from the flier's silhouette. It should read as something that used
 * to be a monster — familiar shape, wrong colour, hollow — rather than as a new enemy,
 * because it is not an enemy. It is the clock.
 */
export function baronFrame(step: number): Px {
  const n = SPRITE_PX;
  const p = new Px(n, n);
  const cx = Math.round(n / 2);
  const cy = Math.round(n * 0.56);
  const half = T.BARON_HALF * T.ART_SCALE;

  p.ellipse(cx, cy, half + 2, half - 1, P.Base);
  const flap = step === 0 ? 2 : -2;
  p.ellipse(cx - half - 1, cy + flap, 4, 2.5, P.Base);
  p.ellipse(cx + half + 1, cy - flap, 4, 2.5, P.Base);

  // Hollow sockets rather than eyes.
  p.ellipse(cx - 4, cy - 2, 3, 3.4, P.Outline);
  p.ellipse(cx + 4, cy - 2, 3, 3.4, P.Outline);
  // Ribs.
  for (let i = 0; i < 3; i++) p.rect(cx - half + 3, cy + 3 + i * 2, half * 2 - 6, 1, P.Darkest);

  p.shadePass(P.Outline);
  p.outline(P.Outline);
  return p;
}

export function buildBaronSprites(): HTMLCanvasElement[] {
  const pal = palette(ramp('#e8ecf0'));
  return [baronFrame(0).toCanvas(pal), baronFrame(1).toCanvas(pal)];
}

/* ------------------------------------------------------------------ projectiles */

const PROJECTILE_COLOURS: Record<ProjectileKind, string> = {
  boulder: '#9a9384',
  fireball: '#ff8a3d',
  bottle: '#7ad85a',
};

export function projectileFrame(kind: ProjectileKind): Px {
  const n = 16;
  const p = new Px(n, n);
  const c = n / 2;
  const r = T.PROJECTILE_HALF * T.ART_SCALE;

  if (kind === 'bottle') {
    p.rect(c - 2, c - r, 4, r * 2, P.Base);
    p.rect(c - 1, c - r - 2, 2, 3, P.Dark);
  } else {
    p.ellipse(c, c, r, r, P.Base);
    if (kind === 'fireball') p.ellipse(c - 1, c - 1, r - 1.5, r - 1.5, P.Lightest);
    else p.ellipse(c + 1, c + 1, r - 2, r - 2, P.Dark);
  }
  p.outline(P.Outline);
  return p;
}

export function buildProjectileSprites(): Record<ProjectileKind, HTMLCanvasElement> {
  const out = {} as Record<ProjectileKind, HTMLCanvasElement>;
  for (const kind of Object.keys(PROJECTILE_COLOURS) as ProjectileKind[]) {
    out[kind] = projectileFrame(kind).toCanvas(palette(ramp(PROJECTILE_COLOURS[kind])));
  }
  return out;
}
