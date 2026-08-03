import { describe, it, expect, beforeEach } from 'vitest';
import { T } from '@/data/tuning';
import { validateRoom, type RoomData } from '@/game/room';
import {
  anger,
  capture,
  chainFrom,
  resetBubbleIds,
  separate,
  spawnBubble,
  stepBubble,
  type Bubble,
} from '@/game/bubble';
import { resetMonsterIds, spawnMonster } from '@/game/monster';
import { chainScore, extendLetters } from '@/game/score';

function room(spec: {
  platforms?: [number, number, number][];
  drift?: { right?: number[]; left?: number[]; up?: number[]; down?: number[] };
}): RoomData {
  const rows: string[][] = [];
  for (let y = 0; y < T.GRID_H; y++) {
    const r = new Array<string>(T.GRID_W).fill('.');
    r[0] = '#';
    r[T.GRID_W - 1] = '#';
    rows.push(r);
  }
  for (const [y, x0, x1] of spec.platforms ?? []) for (let x = x0; x <= x1; x++) rows[y][x] = '=';

  const driftRows: string[] = [];
  for (let y = 0; y < T.GRID_H; y++) {
    const d = spec.drift ?? {};
    let ch = '.';
    if (d.right?.includes(y)) ch = 'r';
    else if (d.left?.includes(y)) ch = 'l';
    else if (d.up?.includes(y)) ch = 'u';
    else if (d.down?.includes(y)) ch = 'd';
    driftRows.push(ch.repeat(T.GRID_W));
  }

  const r = validateRoom({
    id: 'fixture',
    tiles: rows.map((x) => x.join('')),
    drift: driftRows,
    driftSpeed: 0.4,
    playerStart: { x: 5, y: 5 },
    spawns: [{ kind: 'zenchan', x: 5, y: 5, dir: 1 }],
  });
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.data;
}

beforeEach(() => {
  resetBubbleIds();
  resetMonsterIds();
});

/* ------------------------------------------------------------------ scoring */

describe('chain scoring', () => {
  /**
   * The single most important number in the game. This curve is why it is about herding
   * rather than shooting, and getting it wrong by resolving pops serially turns a
   * six-chain from 32,000 into 6,000.
   */
  it('doubles for every extra monster in the chain', () => {
    expect(chainScore(1)).toBe(1_000);
    expect(chainScore(2)).toBe(2_000);
    expect(chainScore(3)).toBe(4_000);
    expect(chainScore(4)).toBe(8_000);
    expect(chainScore(5)).toBe(16_000);
    expect(chainScore(6)).toBe(32_000);
    expect(chainScore(7)).toBe(64_000);
  });

  /**
   * Two at once is the break-even point — 2,000 either way — and the curve only starts
   * paying from three. That is a real property of the design, not an accident: it means
   * a casual double is worth nothing extra, and the reward begins exactly where setting
   * a cluster up starts requiring actual work.
   */
  it('breaks even at two and beats singles from three up', () => {
    expect(chainScore(2)).toBe(2 * chainScore(1));
    for (let n = 3; n <= 7; n++) {
      expect(chainScore(n)).toBeGreaterThan(n * chainScore(1));
    }
    expect(chainScore(7)).toBe(64 * chainScore(1)); // ...and by a lot
  });

  it('scores nothing for an empty chain', () => {
    expect(chainScore(0)).toBe(0);
    expect(chainScore(-1)).toBe(0);
  });
});

describe('EXTEND letters', () => {
  /** A separate, steeper curve: two at once is worth points but no letters at all. */
  it('follows the documented drop table', () => {
    expect(extendLetters(1)).toBe(0);
    expect(extendLetters(2)).toBe(0);
    expect(extendLetters(3)).toBe(1);
    expect(extendLetters(4)).toBe(2);
    expect(extendLetters(5)).toBe(3);
    expect(extendLetters(6)).toBe(4);
    expect(extendLetters(7)).toBe(5);
    expect(extendLetters(8)).toBe(6);
  });

  it('caps at the whole word however big the chain', () => {
    expect(extendLetters(20)).toBe(6);
  });
});

/* ------------------------------------------------------------------ lifecycle */

describe('bubble lifecycle', () => {
  it('travels horizontally, decelerates, then rises', () => {
    const r = room({});
    const b = spawnBubble(100, 100, 1, 'normal');

    stepBubble(r, b);
    const firstStep = b.vx;
    expect(firstStep).toBeGreaterThan(0);
    expect(b.phase).toBe('fired');

    for (let i = 0; i < 5; i++) stepBubble(r, b);
    expect(b.vx).toBeLessThan(firstStep); // decelerating

    const xBefore = b.x;
    for (let i = 0; i < T.BUBBLE_FIRE_FRAMES; i++) stepBubble(r, b);
    expect(b.phase).toBe('free');
    expect(b.x).toBeGreaterThan(xBefore);

    const yBefore = b.y;
    stepBubble(r, b);
    expect(b.y).toBeLessThan(yBefore); // rising
  });

  it('fires the other way when facing left', () => {
    const r = room({});
    const b = spawnBubble(100, 100, -1, 'normal');
    stepBubble(r, b);
    expect(b.vx).toBeLessThan(0);
  });

  it('travels further with the purple sweet without travelling faster', () => {
    const r = room({});
    const near = spawnBubble(100, 100, 1, 'normal');
    const far = spawnBubble(100, 100, 1, 'far');

    stepBubble(r, near);
    stepBubble(r, far);
    // Same speed on the first frame; the difference is how long the push lasts.
    expect(far.fireFrames).toBeGreaterThan(near.fireFrames);

    for (let i = 0; i < T.BUBBLE_FIRE_FRAMES_FAR + 2; i++) {
      stepBubble(r, near);
      stepBubble(r, far);
    }
    expect(far.x).toBeGreaterThan(near.x);
  });

  it('bursts on its own once its life runs out', () => {
    const r = room({});
    const b = spawnBubble(100, 100, 1, 'normal');
    b.life = 3;
    for (let i = 0; i < 3; i++) stepBubble(r, b);
    expect(b.life).toBe(0);
  });

  /**
   * Tile collision alone gives no ceiling: the rows above the highest tier are open air,
   * so a bubble blown up there used to rise straight out of the playfield and drift off
   * to nowhere. Bubbles are meant to POOL along the ceiling — that pool is where the big
   * clusters come from, and the exponential chain curve assumes you can build one.
   * Losing them over the top quietly removed the best source of chains in every room.
   */
  it('collects against the top of the room instead of leaving the playfield', () => {
    const r = room({}); // nothing overhead at all
    const b = spawnBubble(100, 40, 1, 'normal');
    b.phase = 'free';
    b.fireFrames = 0;
    for (let i = 0; i < 2000; i++) stepBubble(r, b);
    expect(b.y - b.halfH).toBeGreaterThanOrEqual(0);
    expect(b.y - b.halfH).toBeCloseTo(0, 4);
  });

  it('never lets any bubble escape the room, wherever it starts', () => {
    const r = room({ platforms: [[20, 4, 12]] });
    for (let startY = 20; startY < 200; startY += 17) {
      const b = spawnBubble(120, startY, 1, 'normal');
      b.phase = 'free';
      b.fireFrames = 0;
      for (let i = 0; i < 1200; i++) {
        stepBubble(r, b);
        expect(b.y - b.halfH).toBeGreaterThanOrEqual(-0.001);
      }
    }
  });

  /** Unlike a body, a bubble has no one-way behaviour — it collects under a platform. */
  it('rests against the underside of a platform rather than passing through', () => {
    const r = room({ platforms: [[10, 2, 20]] });
    const b = spawnBubble(5 * T.TILE + 4, 14 * T.TILE, 1, 'normal');
    b.phase = 'free';
    b.fireFrames = 0;
    for (let i = 0; i < 400; i++) stepBubble(r, b);
    expect(b.y - b.halfH).toBeCloseTo(11 * T.TILE, 4);
  });
});

describe('drift', () => {
  it('carries a free bubble along the room current', () => {
    const r = room({ drift: { right: [4, 5, 6] } });
    const b = spawnBubble(100, 5 * T.TILE + 4, 1, 'normal');
    b.phase = 'free';
    b.fireFrames = 0;
    const x0 = b.x;
    stepBubble(r, b);
    expect(b.x).toBeGreaterThan(x0);
  });

  /**
   * A free bubble must never be perfectly still.
   *
   * The room's drift field is sparse by nature — room 1 had a current in four rows out
   * of twenty-eight — so with no intrinsic wobble a bubble had vx of exactly zero over
   * most of the room, rose in a dead-straight line and stopped dead on the first thing
   * it met. Every bubble in a column did the identical thing, which reads as a row of
   * paused sprites rather than as anything floating.
   */
  it('wanders sideways even where the room has no current at all', () => {
    const still = room({}); // no drift anywhere
    const b = spawnBubble(120, 150, 1, 'normal');
    b.phase = 'free';
    b.fireFrames = 0;

    const xs: number[] = [];
    for (let i = 0; i < 300; i++) {
      stepBubble(still, b);
      xs.push(b.x);
    }
    const spread = Math.max(...xs) - Math.min(...xs);
    expect(spread).toBeGreaterThan(4); // visibly, not a shimmer
  });

  it('does not leave two neighbouring bubbles moving in lockstep', () => {
    const still = room({});
    const a = spawnBubble(120, 150, 1, 'normal');
    const c = spawnBubble(129, 150, 1, 'normal');
    for (const b of [a, c]) {
      b.phase = 'free';
      b.fireFrames = 0;
    }
    let apart = 0;
    for (let i = 0; i < 300; i++) {
      stepBubble(still, a);
      stepBubble(still, c);
      apart = Math.max(apart, Math.abs(a.x - c.x - 9));
    }
    expect(apart).toBeGreaterThan(1);
  });

  it('keeps wobbling once it has settled against the ceiling', () => {
    const still = room({});
    const b = spawnBubble(120, 40, 1, 'normal');
    b.phase = 'free';
    b.fireFrames = 0;
    for (let i = 0; i < 400; i++) stepBubble(still, b); // climb and settle

    const xs: number[] = [];
    for (let i = 0; i < 200; i++) {
      stepBubble(still, b);
      xs.push(b.x);
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(2);
  });

  /**
   * Drift must be a pure function of position and the room, with no RNG anywhere —
   * DESIGN.md §12 asks for a bubble released at a fixed point to trace the same path
   * every run, and a shifting current would make chain setups unlearnable.
   */
  it('is deterministic: identical starts trace identical paths', () => {
    const r = room({ drift: { right: [2, 3, 4], up: [8, 9] } });
    const path = (): number[] => {
      const b = spawnBubble(120, 200, 1, 'normal');
      const out: number[] = [];
      for (let i = 0; i < 300; i++) {
        stepBubble(r, b);
        out.push(b.x, b.y);
      }
      return out;
    };
    expect(path()).toEqual(path());
  });
});

/* ------------------------------------------------------------------ captives */

describe('captives', () => {
  it('holds a monster and counts down', () => {
    const r = room({});
    const b = spawnBubble(100, 100, 1, 'normal');
    const m = spawnMonster('zenchan', 5, 5, 1);
    capture(b, m, 100);

    expect(m.state).toBe('bubbled');
    expect(b.escape).toBe(100);
    stepBubble(r, b);
    expect(b.escape).toBe(99);
  });

  it('stops counting its own life down while holding one', () => {
    const r = room({});
    const b = spawnBubble(100, 100, 1, 'normal');
    const m = spawnMonster('zenchan', 5, 5, 1);
    const life = b.life;
    capture(b, m, 100);
    for (let i = 0; i < 20; i++) stepBubble(r, b);
    expect(b.life).toBe(life);
  });

  /** The reddening is the entire warning, so it has to start well before the end. */
  it('reddens gradually, reaching full only at the very end', () => {
    const b = spawnBubble(100, 100, 1, 'normal');
    const m = spawnMonster('zenchan', 5, 5, 1);
    capture(b, m, 100);

    expect(anger(b)).toBe(0);

    // Exactly at the threshold it is still calm; the warning band is the last
    // ESCAPE_WARN_AT of the clock.
    b.escape = Math.round(100 * T.ESCAPE_WARN_AT);
    expect(anger(b)).toBe(0);

    b.escape = 10; // well inside the band
    const mid = anger(b);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);

    b.escape = 0;
    expect(anger(b)).toBe(1);
  });

  it('reports no anger for an empty bubble', () => {
    expect(anger(spawnBubble(100, 100, 1, 'normal'))).toBe(0);
  });
});

/* ------------------------------------------------------------------ chains */

describe('separation', () => {
  // Open air, well clear of the floor, so these test separation alone.
  const r = room({});
  const free = (x: number, y: number): Bubble => {
    const b = spawnBubble(x, y, 1, 'normal');
    b.phase = 'free';
    b.fireFrames = 0;
    return b;
  };

  it('pushes overlapping bubbles apart until they only touch', () => {
    const bubbles = [free(100, 100), free(104, 100)];
    for (let i = 0; i < 40; i++) separate(r, bubbles);
    const gap = Math.hypot(bubbles[0].x - bubbles[1].x, bubbles[0].y - bubbles[1].y);
    expect(gap).toBeGreaterThanOrEqual(T.BUBBLE_RADIUS * 2 - 0.01);
  });

  it('separates bubbles blown from exactly the same point', () => {
    const bubbles = [free(100, 100), free(100, 100)];
    for (let i = 0; i < 40; i++) separate(r, bubbles);
    const gap = Math.hypot(bubbles[0].x - bubbles[1].x, bubbles[0].y - bubbles[1].y);
    expect(gap).toBeGreaterThan(0);
    expect(Number.isFinite(gap)).toBe(true);
  });

  it('leaves bubbles that are already clear alone', () => {
    const bubbles = [free(100, 100), free(400, 100)];
    separate(r, bubbles);
    expect(bubbles[0].x).toBe(100);
    expect(bubbles[1].x).toBe(400);
  });

  it('stays deterministic', () => {
    const run = (): number[] => {
      const bubbles = [free(100, 100), free(103, 101), free(107, 99), free(100, 105)];
      for (let i = 0; i < 10; i++) separate(r, bubbles);
      return bubbles.flatMap((b) => [b.x, b.y]);
    };
    expect(run()).toEqual(run());
  });

  it('ignores bubbles already resolved', () => {
    const bubbles = [free(100, 100), free(100, 100)];
    bubbles[1].dead = true;
    separate(r, bubbles);
    expect(bubbles[0].x).toBe(100);
    expect(bubbles[0].y).toBe(100);
  });

  /**
   * Separation moves bubbles without consulting the room, so a crowded cluster can shove
   * one through the floor — where it sticks forever, because a bubble only ever rises
   * and the collision pass has no downward motion to resolve. Seen in play: the first
   * bubble of a volley ended up 3wu below the floor surface and sat there.
   */
  it('lifts a bubble back out of the floor it was pushed into', () => {
    const floored = room({ platforms: [[25, 1, 30]] });
    const surface = 25 * T.TILE;
    // Two bubbles stacked just above the floor: separating them drives the lower one
    // through the surface, which is exactly what happened in play.
    const bubbles = [free(100, surface - 10), free(100, surface - 14)];
    separate(floored, bubbles);
    for (const b of bubbles) expect(b.y + b.halfH).toBeLessThanOrEqual(surface + 0.001);
  });

  /**
   * The ceiling is a room boundary, not a tile, so the tile scan in unstick cannot see
   * it. A crowded pool along the top shoves one member up through it, and nothing
   * corrects that until the next motion step — the invariant has to hold at every point
   * in the frame, not just at the end.
   */
  it('keeps a crowded ceiling pool inside the room', () => {
    const open = room({});
    const bubbles = [free(100, 8), free(100, 10), free(104, 9), free(96, 9)];
    for (let i = 0; i < 20; i++) separate(open, bubbles);
    for (const b of bubbles) expect(b.y - b.halfH).toBeGreaterThanOrEqual(-0.001);
  });

  it('lifts a bubble back out of a wall it was pushed into', () => {
    const walled = room({});
    const inner = T.TILE; // the left wall's inside face
    const bubbles = [free(inner + 12, 100), free(inner + 16, 100)];
    separate(walled, bubbles);
    for (const b of bubbles) expect(b.x - b.halfW).toBeGreaterThanOrEqual(inner - 0.001);
  });
});

describe('chainFrom', () => {
  const at = (x: number, y: number): Bubble => {
    const b = spawnBubble(x, y, 1, 'normal');
    b.phase = 'free';
    return b;
  };

  it('finds a run of touching bubbles', () => {
    const reach = T.BUBBLE_RADIUS * 2 + T.BUBBLE_CHAIN_SLACK;
    const bubbles = [at(100, 100), at(100 + reach - 1, 100), at(100 + 2 * (reach - 1), 100)];
    expect(chainFrom(bubbles, 0).sort()).toEqual([0, 1, 2]);
  });

  it('stops at a gap', () => {
    const reach = T.BUBBLE_RADIUS * 2 + T.BUBBLE_CHAIN_SLACK;
    const bubbles = [at(100, 100), at(100 + reach - 1, 100), at(400, 100)];
    expect(chainFrom(bubbles, 0).sort()).toEqual([0, 1]);
  });

  it('chains diagonally, not just in rows', () => {
    const bubbles = [at(100, 100), at(112, 112)];
    expect(chainFrom(bubbles, 0).sort()).toEqual([0, 1]);
  });

  it('reaches a cluster from any member', () => {
    const bubbles = [at(100, 100), at(115, 100), at(130, 100), at(145, 100)];
    for (let i = 0; i < bubbles.length; i++) {
      expect(chainFrom(bubbles, i).sort()).toEqual([0, 1, 2, 3]);
    }
  });

  it('returns just the one when nothing is near', () => {
    expect(chainFrom([at(100, 100), at(400, 400)], 0)).toEqual([0]);
  });

  it('ignores bubbles already resolved this frame', () => {
    const bubbles = [at(100, 100), at(112, 100)];
    bubbles[1].dead = true;
    expect(chainFrom(bubbles, 0)).toEqual([0]);
  });
});

describe('empty bubbles are worth bursting', () => {
  it('scores a flat amount each, not nothing', () => {
    // Reported from play: an empty pop felt like it paid nothing. It paid 10 — an
    // unsourced guess, as is the 50 that replaced it. The design documents the monster
    // curve and the EXTEND table exactly and is silent on empties, so this is [i] and
    // flagged for the fidelity pass rather than quietly settled.
    expect(T.EMPTY_BUBBLE_POP).toBe(50);
  });

  it('pays more for a bubble with a monster in it than an empty one', () => {
    // The ordering is the part that must hold whatever the constants end up being: a
    // loaded pop is the whole game, an empty pop is tidying up.
    expect(chainScore(1)).toBeGreaterThan(T.EMPTY_BUBBLE_POP);
  });

  it('keeps a chain worth vastly more than the same bubbles popped singly', () => {
    // Herding is the skill the scoring is meant to teach. Four at once must beat four
    // one at a time by a wide margin, or there is no reason to set anything up.
    expect(chainScore(4)).toBeGreaterThan(chainScore(1) * 4);
  });
});

describe('EXTEND is gated by chain size, not by level', () => {
  it('drops nothing until three monsters go at once', () => {
    // Answers "what level does EXTEND start on": none. It is available from room one,
    // but a two-chain pays no letters, so it has to be set up deliberately.
    expect(extendLetters(1)).toBe(0);
    expect(extendLetters(2)).toBe(0);
    expect(extendLetters(3)).toBe(1);
  });

  it('pays all six for a big enough chain', () => {
    expect(extendLetters(8)).toBe(6);
    expect(extendLetters(20)).toBe(6);
  });
});
