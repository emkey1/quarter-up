import { Px, P, ramp, palette } from './pixel';
import { T } from '@/data/tuning';
import { MONSTER_SPECS, type ProjectileKind } from '@/data/roster';
import { ITEM_SPECS, type ItemKind } from '@/data/items';
import type { MonsterKind, SpecialBubble } from '@/game/room';
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

/* ------------------------------------------------------------------ items */

const ITEM_PX = 16;

/**
 * Item art.
 *
 * Silhouette carries the meaning, colour carries the variant: all three sweets are the
 * same shape in different colours, all three umbrellas likewise. That is deliberate —
 * a player who learns "round twist = sweet" can then read the colour as *which* sweet
 * without being taught twice.
 */
const ITEM_SHAPES: Partial<Record<ItemKind, (p: Px, c: number) => void>> = {
  sweetYellow: (p, c) => sweet(p, c),
  sweetBlue: (p, c) => sweet(p, c),
  sweetPurple: (p, c) => sweet(p, c),
  doorSilver: (p, c) => door(p, c),
  doorGold: (p, c) => door(p, c),
  diamond: (p, c) => {
    // A cut stone: flat top, tapering to a point.
    for (let i = 0; i < 5; i++) p.rect(c - 5 + i, c + 1 + i, 11 - i * 2, 1, P.Base);
    p.rect(c - 5, c - 3, 11, 4, P.Light);
    p.rect(c - 3, c - 3, 2, 4, P.Lightest);
  },
  potion: (p, c) => {
    // A flask: narrow neck, round belly, stopper.
    p.ellipse(c, c + 2, 4.6, 4.2, P.Base);
    p.rect(c - 2, c - 5, 4, 5, P.Light);
    p.rect(c - 3, c - 7, 6, 2, P.Dark);
    p.ellipse(c - 1.6, c + 1, 1.4, 1.4, P.Lightest);
  },
  umbrellaOrange: (p, c) => umbrella(p, c),
  umbrellaRed: (p, c) => umbrella(p, c),
  umbrellaPurple: (p, c) => umbrella(p, c),
  ringPurple: (p, c) => ring(p, c),
  ringRed: (p, c) => ring(p, c),
  ringBlue: (p, c) => ring(p, c),

  shoe: (p, c) => {
    p.rect(c - 5, c - 2, 7, 5, P.Base);
    p.rect(c - 5, c + 2, 10, 3, P.Dark);
    p.ellipse(c + 3, c + 1, 3, 2.5, P.Base);
    p.rect(c - 4, c - 3, 4, 2, P.Light);
  },
  clock: (p, c) => {
    p.ellipse(c, c, 6, 6, P.Base);
    p.ellipse(c, c, 4.4, 4.4, P.Lightest);
    p.line(c, c, c, c - 3, P.Outline);
    p.line(c, c, c + 2, c + 1, P.Outline);
    p.rect(c - 1, c - 8, 2, 2, P.Dark);
  },
  heart: (p, c) => {
    p.ellipse(c - 2.6, c - 1.5, 3, 3, P.Base);
    p.ellipse(c + 2.6, c - 1.5, 3, 3, P.Base);
    for (let i = 0; i < 7; i++) p.rect(c - 5 + i, c + 0.5 + i, 11 - i * 2, 1, P.Base);
    p.ellipse(c - 2.5, c - 2.5, 1.2, 1.2, P.Lightest);
  },
  bell: (p, c) => {
    for (let i = 0; i < 7; i++) p.rect(c - 1 - i * 0.7, c - 5 + i, 2 + i * 1.4, 1, P.Base);
    p.rect(c - 6, c + 2, 12, 2, P.Light);
    p.ellipse(c, c + 5, 1.6, 1.6, P.Dark);
    p.rect(c - 1, c - 7, 2, 2, P.Dark);
  },
  fruit: (p, c) => {
    p.ellipse(c, c + 1, 5, 5, P.Base);
    p.ellipse(c - 1.6, c - 0.6, 1.6, 1.6, P.Lightest);
    p.rect(c - 1, c - 6, 2, 3, P.Outline);
    p.ellipse(c + 3, c - 5, 2.6, 1.4, P.Light);
  },
};

function sweet(p: Px, c: number): void {
  p.ellipse(c, c, 4.6, 4.6, P.Base);
  p.ellipse(c - 1.4, c - 1.4, 1.6, 1.6, P.Lightest);
  // Wrapper twists either side — the shape that says "sweet" at 16 pixels.
  p.line(c - 6, c - 3, c - 5, c + 3, P.Light);
  p.line(c + 6, c - 3, c + 5, c + 3, P.Light);
  p.line(c - 5, c, c - 6, c, P.Light);
  p.line(c + 5, c, c + 6, c, P.Light);
}

function umbrella(p: Px, c: number): void {
  for (let i = 0; i < 5; i++) p.rect(c - 6 + i, c - 3 + i, 13 - i * 2, 1, P.Base);
  p.rect(c - 6, c + 2, 13, 1, P.Dark);
  p.rect(c, c + 2, 1, 5, P.Outline);
  p.rect(c - 2, c + 6, 3, 1, P.Outline);
}

/** An arched doorway. It has to read as a way OUT, not as another thing to collect. */
function door(p: Px, c: number): void {
  p.rect(c - 5, c - 2, 10, 8, P.Base);
  for (let i = 0; i < 4; i++) p.rect(c - 5 + i, c - 6 + i, 10 - i * 2, 1, P.Base);
  p.rect(c - 3, c + 1, 6, 5, P.Outline);
  p.ellipse(c + 2, c + 3, 1, 1, P.Lightest);
}

function ring(p: Px, c: number): void {
  p.ellipseOutline(c, c + 1, 4.6, 4.6, P.Base);
  p.ellipseOutline(c, c + 1, 3.4, 3.4, P.Light);
  p.ellipse(c, c - 5, 2, 2, P.Lightest);
}

export function itemFrame(kind: ItemKind): Px {
  const p = new Px(ITEM_PX, ITEM_PX);
  const shape = ITEM_SHAPES[kind];
  if (!shape) {
    // EXTEND letters are drawn as text by the renderer; anything else missing shows as
    // an obvious placeholder rather than as nothing at all.
    p.rect(4, 4, 8, 8, P.Base);
  } else {
    shape(p, ITEM_PX / 2);
  }
  p.outline(P.Outline);
  return p;
}

export function buildItemSprites(): Partial<Record<ItemKind, HTMLCanvasElement>> {
  const out: Partial<Record<ItemKind, HTMLCanvasElement>> = {};
  for (const kind of Object.keys(ITEM_SPECS) as ItemKind[]) {
    if (kind === 'extend') continue; // drawn as text
    out[kind] = itemFrame(kind).toCanvas(palette(ramp(ITEM_SPECS[kind].colour)));
  }
  return out;
}

export function buildProjectileSprites(): Record<ProjectileKind, HTMLCanvasElement> {
  const out = {} as Record<ProjectileKind, HTMLCanvasElement>;
  for (const kind of Object.keys(PROJECTILE_COLOURS) as ProjectileKind[]) {
    out[kind] = projectileFrame(kind).toCanvas(palette(ramp(PROJECTILE_COLOURS[kind])));
  }
  return out;
}

/* ------------------------------------------------------------------ specials */

/** Tints for a special bubble, so what it carries is readable before you commit. */
const SPECIAL_TINTS: Record<SpecialBubble, string> = {
  water: '#4a9cff',
  lightning: '#ffe14a',
  fire: '#ff7a3d',
};

export function buildSpecialBubbleSprites(): Record<SpecialBubble, HTMLCanvasElement> {
  const px = bubbleFrame();
  const out = {} as Record<SpecialBubble, HTMLCanvasElement>;
  for (const kind of Object.keys(SPECIAL_TINTS) as SpecialBubble[]) {
    out[kind] = px.toCanvas(palette(ramp(SPECIAL_TINTS[kind])));
  }
  return out;
}

/**
 * Water, lightning and fire, drawn small and bright.
 *
 * Each is a handful of pixels because there are a lot of them at once — a water burst
 * is ten droplets running along a tier, and anything detailed at that count turns the
 * screen to soup.
 */
export function buildElementSprites(): {
  drop: HTMLCanvasElement;
  bolt: HTMLCanvasElement;
  flame: HTMLCanvasElement;
} {
  const drop = new Px(12, 12);
  drop.ellipse(6, 7, T.WATER_HALF * T.ART_SCALE * 0.5, T.WATER_HALF * T.ART_SCALE * 0.7, P.Base);
  drop.ellipse(5, 6, 1.2, 1.2, P.Lightest);
  drop.outline(P.Outline);

  const bolt = new Px(20, 12);
  // A jagged streak rather than a bar: it should read as a discharge in motion.
  bolt.line(2, 6, 8, 3, P.Base);
  bolt.line(8, 3, 12, 8, P.Base);
  bolt.line(12, 8, 18, 5, P.Base);
  bolt.line(2, 7, 8, 4, P.Lightest);
  bolt.line(8, 4, 12, 9, P.Lightest);
  bolt.line(12, 9, 18, 6, P.Lightest);

  const flame = new Px(16, 16);
  flame.ellipse(8, 11, 5, 4, P.Base);
  flame.ellipse(8, 8, 3.4, 4.4, P.Light);
  flame.ellipse(8, 6, 1.8, 2.8, P.Lightest);
  flame.outline(P.Outline);

  return {
    drop: drop.toCanvas(palette(ramp('#4ab8ff'))),
    bolt: bolt.toCanvas(palette(ramp('#ffe14a'))),
    flame: flame.toCanvas(palette(ramp('#ff8a3d'))),
  };
}

/* ------------------------------------------------------------------ the boss */

/**
 * The thing at the bottom of the cave.
 *
 * Built from the Drunk's silhouette — pointed hat, staff, bottle — but four times the
 * size, so it reads instantly as "that thing from room fifty, except now it is the
 * room". Recognition does more work here than novelty would: the player already knows
 * what a Drunk does, and the fight is about discovering that what worked then does not
 * work now.
 */
export function bossFrame(step: number): Px {
  const n = T.BOSS_HALF * 2 * T.ART_SCALE;
  const p = new Px(n, n);
  const c = Math.round(n / 2);
  const r = Math.round(n * 0.36);

  // Body
  p.ellipse(c, c + r * 0.35, r, r * 0.95, P.Base);
  p.ellipse(c, c + r * 0.7, r * 0.8, r * 0.5, P.Base2);

  // Hat: a tall cone, the Drunk's read at four times the scale.
  // Point at the TOP, brim at the bottom. Running this the other way round draws a
  // funnel rather than a hat, which reads as a completely different creature.
  const hatH = Math.round(r * 1.15);
  for (let i = 0; i < hatH; i++) {
    const w = Math.round((r * 0.95 * i) / hatH);
    if (w > 0) p.rect(c - w, c - r * 0.5 - hatH + i, w * 2, 1, P.Dark);
  }
  p.rect(c - r, Math.round(c - r * 0.55), r * 2, 3, P.Light);

  // Eyes, wide apart and low under the brim.
  const bob = step === 0 ? 0 : 1;
  p.ellipse(c - r * 0.42, c + bob, r * 0.2, r * 0.22, P.Base3);
  p.ellipse(c + r * 0.42, c + bob, r * 0.2, r * 0.22, P.Base3);
  p.ellipse(c - r * 0.38, c + bob, r * 0.09, r * 0.11, P.Outline3);
  p.ellipse(c + r * 0.46, c + bob, r * 0.09, r * 0.11, P.Outline3);

  // Staff along one side.
  p.rect(c + r - 2, Math.round(c - r * 0.9), 3, Math.round(r * 2), P.Dark2);
  p.ellipse(c + r - 1, Math.round(c - r), 3.5, 3.5, P.Light2);

  p.shadePass(P.Outline);
  p.outline(P.Outline);
  return p;
}

export interface BossSprites {
  /** [hurt][step] — hurt frames flash pale so a landed hit is unmistakable. */
  readonly frames: [HTMLCanvasElement, HTMLCanvasElement][];
}

export function buildBossSprites(): BossSprites {
  const calm = palette(ramp('#7ad85a'), ramp('#ffd166'), ramp('#ffffff'));
  const hurt = palette(ramp('#ffffff'), ramp('#ffd166'), ramp('#ffffff'));
  const frames = [bossFrame(0), bossFrame(1)];
  return {
    frames: [calm, hurt].map(
      (pal) => frames.map((f) => f.toCanvas(pal)) as [HTMLCanvasElement, HTMLCanvasElement],
    ),
  };
}
