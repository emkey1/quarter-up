import { CLASSES, CLASS_ORDER, type ClassId } from '@/data/classes';
import type { MonsterKind } from '@/game/monster';
import { Px, palette, ramp, type Ramp } from './pixel';

/**
 * Procedural sprite generation at true native resolution.
 *
 * Design rules being followed here, which is most of why this reads differently from
 * the earlier vector-shape art:
 *
 *   1. SILHOUETTE FIRST. At 32 pixels, detail is invisible and outline is everything.
 *      Every monster is shaped so you can identify it from its shadow: ghost = domed
 *      top with a ragged hem, grunt = wide and squat, demon = horns, sorcerer = tall
 *      pointed hood, lobber = hunched with one arm raised.
 *   2. HARD 1px OUTLINE on everything, so sprites survive a busy floor.
 *   3. ONE LIGHT DIRECTION (top-left), applied as a pass over whole ramps rather than
 *      painted in, so recolouring cannot break the shading.
 *   4. FIVE SHADE STEPS. Enough to model a form, few enough to stay readable in motion.
 *
 * Facings: only E, SE, S, NE and N are drawn. W, SW and NW are mirrors. That is
 * standard practice and halves the work.
 */

export const SPRITE = 32;

/** Ramp slot bases, matching the palette order used by every generator here. */
const A = { o: 1, dk: 2, d: 3, b: 4, l: 5, ll: 6 }; // primary  (cloth / body)
const B = { o: 7, dk: 8, d: 9, b: 10, l: 11, ll: 12 }; // secondary (skin / trim)
const C = { o: 13, dk: 14, d: 15, b: 16, l: 17, ll: 18 }; // tertiary (metal / detail)

export type FrameKey = string;
export interface Atlas {
  canvas: HTMLCanvasElement;
  frames: Map<FrameKey, { x: number; y: number; w: number; h: number }>;
}

interface Entry {
  key: FrameKey;
  px: Px;
  pal: readonly string[];
}

/* ------------------------------------------------------------------ humanoids */

interface HumanOpts {
  cloth: Ramp;
  skin: Ramp;
  metal: Ramp;
  weapon: 'axe' | 'sword' | 'staff' | 'bow';
  hood: boolean;
}

/**
 * One humanoid frame.
 *
 * `facing` is 0=E, 2=S, 6=N, 7=NE, 1=SE (the five drawn cases). `frame` drives the
 * walk cycle: legs alternate and the whole body bobs a pixel, which is enough motion
 * at this size — more would just blur.
 */
function humanoid(o: HumanOpts, facing: number, frame: number): Px {
  const p = new Px(SPRITE, SPRITE);
  const bob = frame === 1 ? -1 : frame === 3 ? 0 : 0;
  const stride = frame === 1 ? 1 : frame === 3 ? -1 : 0;

  const side = facing === 0; // pure profile
  const back = facing === 6;
  const diagN = facing === 7;
  const diagS = facing === 1;

  const cx = 16 + (side ? 1 : diagN || diagS ? 1 : 0);
  const feetY = 28 + bob;

  // --- legs. Offset in opposite directions so the walk reads at a glance.
  const legY = feetY - 5;
  p.rect(cx - 4 + stride, legY, 3, 6, A.d);
  p.rect(cx + 1 - stride, legY, 3, 6, A.d);
  // boots
  p.rect(cx - 4 + stride, feetY, 3, 2, C.d);
  p.rect(cx + 1 - stride, feetY, 3, 2, C.d);

  // --- torso: narrower in profile, which is what sells the turn
  const halfW = side ? 4 : 5;
  p.rect(cx - halfW, feetY - 12, halfW * 2, 8, A.b);
  // belt
  p.rect(cx - halfW, feetY - 5, halfW * 2, 1, C.b);

  // --- arms
  const armY = feetY - 11;
  if (!side) {
    p.rect(cx - halfW - 2, armY, 2, 6, A.dk);
    p.rect(cx + halfW, armY, 2, 6, A.dk);
  } else {
    p.rect(cx + halfW - 1, armY, 2, 6, A.dk);
  }

  // --- head
  const headY = feetY - 16;
  p.ellipse(cx, headY, 4, 4, B.b);
  if (o.hood) {
    // a tall pointed hood: the sorcerer/wizard silhouette
    p.ellipse(cx, headY - 1, 5, 5, A.b);
    p.rect(cx - 1, headY - 8, 3, 4, A.b);
    if (!back) p.rect(cx - 3, headY, 6, 3, A.dk); // face shadow inside the hood
  } else {
    // helm / hair cap
    p.ellipse(cx, headY - 2, 5, 3, C.b);
    p.rect(cx - 5, headY - 2, 10, 2, C.b);
  }

  // --- face, only when we can actually see it
  if (!back && !o.hood) {
    const eyeY = headY;
    if (side) {
      p.set(cx + 2, eyeY, A.o);
    } else if (diagN) {
      p.set(cx + 1, eyeY, A.o);
      p.set(cx + 3, eyeY, A.o);
    } else {
      p.set(cx - 2, eyeY, A.o);
      p.set(cx + 2, eyeY, A.o);
    }
  }

  // --- weapon, held on the leading side
  const wx = side || diagN || diagS ? cx + halfW + 2 : cx + halfW + 1;
  const wy = feetY - 12;
  switch (o.weapon) {
    case 'axe':
      p.rect(wx, wy - 4, 1, 12, C.d); // haft
      p.ellipse(wx + 2, wy - 3, 3, 4, C.l); // head
      p.rect(wx - 1, wy - 6, 3, 2, C.ll);
      break;
    case 'sword':
      p.rect(wx, wy - 8, 1, 14, C.ll);
      p.rect(wx - 1, wy + 5, 3, 1, C.d); // guard
      break;
    case 'staff':
      p.rect(wx, wy - 7, 1, 16, C.d);
      p.ellipse(wx, wy - 9, 2, 2, B.ll); // orb
      break;
    case 'bow':
      for (let i = -6; i <= 6; i++) {
        const bulge = Math.round(Math.sqrt(Math.max(0, 36 - i * i)) * 0.35);
        p.set(wx + bulge, wy + i + 2, C.d);
      }
      p.line(wx, wy - 4, wx, wy + 8, C.ll); // string
      break;
  }

  p.outline(A.o);
  p.shadePass(0); // cloth ramp
  p.shadePass(6); // skin ramp
  return p;
}

/* ------------------------------------------------------------------ monsters */

function ghost(frame: number): Px {
  const p = new Px(SPRITE, SPRITE);
  const bob = frame % 2 === 0 ? 0 : -1;
  const cy = 15 + bob;
  // domed top, ragged hem — unmistakable from the silhouette alone
  p.ellipse(16, cy, 8, 8, A.b);
  p.rect(8, cy, 17, 8, A.b);
  for (let i = 0; i < 17; i++) {
    const wave = (i + frame) % 4 < 2 ? 0 : 2;
    p.rect(8 + i, cy + 8, 1, 3 - wave, A.b);
  }
  // hollow eyes
  p.rect(12, cy - 2, 3, 4, A.o);
  p.rect(18, cy - 2, 3, 4, A.o);
  p.outline(A.o);
  p.shadePass(0);
  return p;
}

function grunt(frame: number): Px {
  const p = new Px(SPRITE, SPRITE);
  const stride = frame % 2 === 0 ? 1 : -1;
  // wide and squat: the "there are forty of these" shape
  p.rect(10 + stride, 24, 4, 5, A.d);
  p.rect(18 - stride, 24, 4, 5, A.d);
  p.rect(9, 14, 14, 11, A.b);
  p.ellipse(16, 11, 5, 5, B.b);
  p.rect(7, 15, 3, 7, A.dk);
  p.rect(22, 15, 3, 7, A.dk);
  p.set(14, 11, A.o);
  p.set(18, 11, A.o);
  // club
  p.rect(25, 12, 2, 9, C.d);
  p.ellipse(26, 11, 3, 3, C.b);
  p.outline(A.o);
  p.shadePass(0);
  p.shadePass(6);
  return p;
}

function demon(frame: number): Px {
  const p = new Px(SPRITE, SPRITE);
  const stride = frame % 2 === 0 ? 1 : -1;
  p.rect(11 + stride, 25, 4, 4, A.d);
  p.rect(17 - stride, 25, 4, 4, A.d);
  p.rect(10, 14, 12, 12, A.b);
  p.ellipse(16, 10, 5, 5, A.l);
  // horns: the whole point of the silhouette
  p.line(11, 7, 9, 2, C.ll);
  p.line(21, 7, 23, 2, C.ll);
  // wing hints
  p.line(9, 15, 4, 12, A.dk);
  p.line(23, 15, 28, 12, A.dk);
  p.set(14, 10, C.ll);
  p.set(18, 10, C.ll);
  p.rect(14, 13, 5, 1, A.o); // maw
  p.outline(A.o);
  p.shadePass(0);
  return p;
}

function sorcerer(frame: number): Px {
  const p = new Px(SPRITE, SPRITE);
  const bob = frame % 2 === 0 ? 0 : -1;
  const y = bob;
  // tall pointed hood, no legs: reads as "not quite here"
  p.rect(11, 18 + y, 11, 11, A.b);
  p.ellipse(16, 15 + y, 6, 6, A.b);
  p.line(16, 9 + y, 16, 3 + y, A.b);
  p.rect(14, 4 + y, 5, 5, A.b);
  p.rect(12, 14 + y, 9, 4, A.o); // face void
  p.set(14, 15 + y, C.ll);
  p.set(18, 15 + y, C.ll);
  for (let i = 0; i < 11; i++) p.rect(11 + i, 29 + y, 1, i % 2 === 0 ? 1 : 2, A.dk);
  p.outline(A.o);
  p.shadePass(0);
  return p;
}

function lobber(frame: number): Px {
  const p = new Px(SPRITE, SPRITE);
  const wind = frame % 2 === 0;
  // hunched, one arm up: you can see the throw coming
  p.rect(11, 25, 4, 4, A.d);
  p.rect(17, 25, 4, 4, A.d);
  p.rect(10, 16, 12, 10, A.b);
  p.ellipse(15, 13, 5, 4, B.b);
  p.set(13, 13, A.o);
  p.set(17, 13, A.o);
  if (wind) {
    p.rect(21, 9, 3, 8, A.dk);
    p.ellipse(23, 7, 3, 3, C.b); // rock, cocked back
  } else {
    p.rect(21, 15, 3, 7, A.dk);
    p.ellipse(24, 15, 3, 3, C.b);
  }
  p.outline(A.o);
  p.shadePass(0);
  p.shadePass(6);
  return p;
}

function deathSprite(frame: number): Px {
  const p = new Px(SPRITE, SPRITE);
  const bob = frame % 2 === 0 ? 0 : -1;
  const y = bob;
  // A robe with nothing inside. Deliberately unlike every monster: mistaking it is fatal.
  p.rect(10, 14 + y, 13, 16, A.b);
  p.ellipse(16, 11 + y, 7, 7, A.b);
  p.ellipse(16, 12 + y, 5, 5, A.o); // the void where a face is not
  p.ellipse(13, 11 + y, 1, 2, C.ll);
  p.ellipse(19, 11 + y, 1, 2, C.ll);
  for (let i = 0; i < 13; i++) p.rect(10 + i, 30 + y, 1, i % 3 === 0 ? 0 : 2, A.dk);
  p.outline(A.o);
  p.shadePass(0);
  return p;
}

function thiefSprite(frame: number, carrying: boolean): Px {
  const p = new Px(SPRITE, SPRITE);
  const stride = frame % 2 === 0 ? 2 : -2;
  p.rect(12 + stride, 25, 3, 4, A.d);
  p.rect(17 - stride, 25, 3, 4, A.d);
  p.rect(11, 15, 10, 11, A.b);
  p.ellipse(16, 12, 4, 4, A.l);
  p.rect(12, 11, 9, 2, A.dk); // mask band
  p.set(14, 12, C.ll);
  p.set(18, 12, C.ll);
  if (carrying) {
    p.ellipse(24, 18, 4, 4, C.b);
    p.rect(23, 14, 3, 2, C.d);
  }
  p.outline(A.o);
  p.shadePass(0);
  return p;
}

/* ------------------------------------------------------------------ generators */

function boneGen(level: number): Px {
  const p = new Px(SPRITE, SPRITE);
  p.ellipse(16, 20, 12, 7, A.dk); // pile
  p.ellipse(16, 14, 7, 7, A.l); // skull
  p.rect(11, 16, 11, 5, A.l);
  p.rect(12, 13, 3, 4, A.o); // sockets
  p.rect(18, 13, 3, 4, A.o);
  p.rect(14, 19, 5, 1, A.o);
  for (let i = 0; i < level; i++) p.rect(9 + i * 5, 25, 4, 2, C.ll);
  p.outline(A.o);
  p.shadePass(0);
  return p;
}

function blockGen(level: number): Px {
  const p = new Px(SPRITE, SPRITE);
  p.rect(4, 4, 24, 24, A.b);
  p.rect(4, 4, 24, 2, A.l); // lit top
  p.rect(4, 4, 2, 24, A.l);
  p.rect(4, 26, 24, 2, A.dk);
  p.rect(26, 4, 2, 24, A.dk);
  p.rect(9, 9, 14, 14, A.o); // recess
  p.rect(11, 11, 10, 10, C.d);
  p.rect(13, 13, 6, 6, C.ll); // the eye that spits monsters out
  p.dither(11, 11, 10, 10, C.d, C.b, 0);
  for (let i = 0; i < level; i++) p.rect(7 + i * 7, 29, 5, 2, C.ll);
  p.outline(A.o);
  return p;
}

/* ------------------------------------------------------------------ items */

function foodSprite(breakable: boolean): Px {
  const p = new Px(SPRITE, SPRITE);
  if (breakable) {
    // a jug — and the double-cross that means "shooting this is a mistake"
    p.ellipse(16, 20, 7, 7, A.b);
    p.rect(13, 10, 6, 5, A.b);
    p.rect(12, 9, 8, 2, A.l);
    p.line(12, 17, 15, 20, A.o);
    p.line(15, 17, 12, 20, A.o);
    p.line(18, 17, 21, 20, A.o);
    p.line(21, 17, 18, 20, A.o);
  } else {
    p.ellipse(16, 21, 9, 5, C.b); // plate
    p.ellipse(16, 18, 7, 5, A.b); // meat
    p.ellipse(14, 17, 2, 2, A.ll);
  }
  p.outline(A.o);
  p.shadePass(0);
  return p;
}

function keySprite(): Px {
  const p = new Px(SPRITE, SPRITE);
  p.ellipse(11, 16, 5, 5, C.b);
  p.ellipse(11, 16, 2, 2, 0);
  p.rect(15, 15, 10, 3, C.b);
  p.rect(21, 18, 2, 3, C.b);
  p.rect(24, 18, 2, 3, C.b);
  p.outline(C.o);
  p.shadePass(12);
  return p;
}

function potionSprite(orange: boolean): Px {
  const p = new Px(SPRITE, SPRITE);
  p.ellipse(16, 20, 7, 7, orange ? C.b : A.b);
  p.rect(14, 11, 5, 5, orange ? C.d : A.d);
  p.rect(13, 9, 7, 2, C.ll);
  p.ellipse(13, 18, 2, 3, orange ? C.ll : A.ll); // glint
  p.outline(A.o);
  p.shadePass(orange ? 12 : 0);
  return p;
}

function treasureSprite(): Px {
  const p = new Px(SPRITE, SPRITE);
  p.rect(7, 15, 18, 10, A.b);
  p.rect(7, 12, 18, 4, A.l);
  p.rect(7, 15, 18, 1, A.o);
  p.rect(14, 16, 4, 6, C.b); // clasp
  p.rect(15, 18, 2, 2, C.ll);
  p.outline(A.o);
  p.shadePass(0);
  return p;
}

function upgradeSprite(): Px {
  const p = new Px(SPRITE, SPRITE);
  p.ellipse(16, 19, 8, 8, A.b);
  p.rect(14, 9, 5, 5, A.d);
  p.rect(12, 7, 9, 2, C.ll);
  // inner star, so it never reads as an ordinary potion
  p.line(16, 13, 16, 25, C.ll);
  p.line(10, 19, 22, 19, C.ll);
  p.line(12, 15, 20, 23, C.l);
  p.line(20, 15, 12, 23, C.l);
  p.outline(A.o);
  p.shadePass(0);
  return p;
}

/* ------------------------------------------------------------------ atlas */

const CLOTH: Record<ClassId, string> = {
  warrior: '#c8352f',
  valkyrie: '#3f7fc8',
  wizard: '#d8c33c',
  elf: '#3fa855',
};
const WEAPON: Record<ClassId, HumanOpts['weapon']> = {
  warrior: 'axe',
  valkyrie: 'sword',
  wizard: 'staff',
  elf: 'bow',
};

const MONSTER_TINT: Record<MonsterKind, [string, string, string]> = {
  ghost: ['#d8bce0', '#e07ec8', '#f0486f'],
  grunt: ['#84b86b', '#4f9d4f', '#2f7d3f'],
  demon: ['#e08a55', '#e05030', '#bd2222'],
  sorcerer: ['#9a86d6', '#7050c0', '#4f2fa5'],
  lobber: ['#c8b478', '#a89040', '#8a6a1e'],
};

const SKIN = ramp('#e0b088');
const METAL = ramp('#c8ccd4');
const GOLD = ramp('#e8b83c');

/** The five drawn facings; the other three are mirrors of these. */
const DRAWN_FACINGS = [0, 1, 2, 6, 7] as const;
const MIRROR_OF: Record<number, number> = { 4: 0, 3: 1, 5: 7 };
export const WALK_FRAMES = 4;

export function buildSpriteAtlas(): Atlas {
  const entries: Entry[] = [];

  // --- players
  for (const id of CLASS_ORDER) {
    const cloth = ramp(CLOTH[id]);
    const pal = palette(cloth, SKIN, METAL);
    const opts: HumanOpts = {
      cloth,
      skin: SKIN,
      metal: METAL,
      weapon: WEAPON[id],
      hood: id === 'wizard',
    };
    for (const f of DRAWN_FACINGS) {
      for (let frame = 0; frame < WALK_FRAMES; frame++) {
        const px = humanoid(opts, f, frame);
        entries.push({ key: `p:${id}:${f}:${frame}`, px, pal });
        const mirrored = Object.entries(MIRROR_OF).find(([, src]) => src === f);
        if (mirrored) {
          entries.push({ key: `p:${id}:${mirrored[0]}:${frame}`, px: px.mirrorX(), pal });
        }
      }
    }
  }

  // --- monsters: one drawing per kind, three palettes for the three levels
  const makers: Record<MonsterKind, (f: number) => Px> = {
    ghost,
    grunt,
    demon,
    sorcerer,
    lobber,
  };
  for (const kind of Object.keys(makers) as MonsterKind[]) {
    for (let lvl = 1; lvl <= 3; lvl++) {
      const pal = palette(ramp(MONSTER_TINT[kind][lvl - 1]), SKIN, METAL);
      for (let frame = 0; frame < 2; frame++) {
        entries.push({ key: `m:${kind}:${lvl}:${frame}`, px: makers[kind](frame), pal });
      }
    }
  }

  // --- specials
  const deathPal = palette(ramp('#2a1740'), SKIN, ramp('#d24bff'));
  const thiefPal = palette(ramp('#4a4470'), SKIN, GOLD);
  for (let frame = 0; frame < 2; frame++) {
    entries.push({ key: `death:${frame}`, px: deathSprite(frame), pal: deathPal });
    entries.push({ key: `thief:0:${frame}`, px: thiefSprite(frame, false), pal: thiefPal });
    entries.push({ key: `thief:1:${frame}`, px: thiefSprite(frame, true), pal: thiefPal });
  }

  // --- generators
  for (let lvl = 1; lvl <= 3; lvl++) {
    entries.push({
      key: `gen:bone:${lvl}`,
      px: boneGen(lvl),
      pal: palette(ramp('#d8d0c0'), SKIN, GOLD),
    });
    entries.push({
      key: `gen:block:${lvl}`,
      px: blockGen(lvl),
      pal: palette(ramp('#6a5a7c'), SKIN, ramp('#ff8b3c')),
    });
  }

  // --- items
  entries.push({ key: 'it:food:0', px: foodSprite(false), pal: palette(ramp('#c8603c'), SKIN, ramp('#d8dce4')) });
  entries.push({ key: 'it:food:1', px: foodSprite(true), pal: palette(ramp('#d8b048'), SKIN, METAL) });
  entries.push({ key: 'it:key:0', px: keySprite(), pal: palette(ramp('#8a7a3a'), SKIN, GOLD) });
  entries.push({ key: 'it:potion:0', px: potionSprite(false), pal: palette(ramp('#4fb8f0'), SKIN, METAL) });
  entries.push({ key: 'it:potion:1', px: potionSprite(true), pal: palette(ramp('#4fb8f0'), SKIN, ramp('#f5a03c')) });
  entries.push({ key: 'it:treasure:0', px: treasureSprite(), pal: palette(ramp('#a8762c'), SKIN, GOLD) });
  entries.push({ key: 'it:upgrade:0', px: upgradeSprite(), pal: palette(ramp('#a95cf0'), SKIN, ramp('#ffe9a0')) });

  return pack(entries);
}

function pack(entries: Entry[]): Atlas {
  const cols = 16;
  const rows = Math.ceil(entries.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * SPRITE;
  canvas.height = Math.max(1, rows) * SPRITE;
  const ctx = canvas.getContext('2d');
  const frames = new Map<FrameKey, { x: number; y: number; w: number; h: number }>();
  if (!ctx) return { canvas, frames };

  entries.forEach((e, i) => {
    const x = (i % cols) * SPRITE;
    const y = Math.floor(i / cols) * SPRITE;
    e.px.blitTo(ctx, x, y, e.pal);
    frames.set(e.key, { x, y, w: SPRITE, h: SPRITE });
  });
  return { canvas, frames };
}
