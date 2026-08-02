import { describe, it, expect, beforeEach } from 'vitest';
import { T, ROOM_H, ROOM_W } from '@/data/tuning';
import { validateRoom, type RoomData } from '@/game/room';
import {
  resetSpecialIds,
  spawnBolt,
  spawnFire,
  spawnWater,
  stepBolt,
  stepDrop,
  stepFlame,
} from '@/game/special';
import { World } from '@/game/world';
import { spawnSpecial, resetBubbleIds } from '@/game/bubble';
import { resetMonsterIds } from '@/game/monster';
import { emptyActions } from '@/game/controls';
import { emptyCounters } from '@/game/counters';
import { initialScore } from '@/game/score';

function room(spec: {
  platforms?: [number, number, number][];
  spawns?: { kind: string; x: number; y: number; dir: -1 | 1 }[];
  specials?: string[];
  playerStart?: { x: number; y: number };
} = {}): RoomData {
  const rows: string[][] = [];
  for (let y = 0; y < T.GRID_H; y++) {
    const r = new Array<string>(T.GRID_W).fill('.');
    r[0] = '#';
    r[T.GRID_W - 1] = '#';
    rows.push(r);
  }
  for (const [y, x0, x1] of spec.platforms ?? [[25, 1, 30]]) {
    for (let x = x0; x <= x1; x++) rows[y][x] = '=';
  }
  const r = validateRoom({
    id: 'fixture',
    tiles: rows.map((x) => x.join('')),
    playerStart: spec.playerStart ?? { x: 5, y: 24 },
    spawns: spec.spawns ?? [{ kind: 'zenchan', x: 20, y: 24, dir: -1 }],
    specialBubbles: spec.specials ?? [],
    timer: 100000,
  });
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.data;
}

beforeEach(() => {
  resetSpecialIds();
  resetBubbleIds();
  resetMonsterIds();
});

/* ------------------------------------------------------------------ water */

describe('water', () => {
  /**
   * The behaviour the whole system exists for: water finds the geometry. It falls,
   * spreads along whatever it lands on, and pours off the ends — which is what makes it
   * the element that finds you on your own tier rather than across the room.
   */
  it('falls to a platform and then runs along it', () => {
    const r = room({ platforms: [[20, 4, 26]] });
    const [d] = spawnWater(15 * T.TILE, 10 * T.TILE);
    d.dir = 1;

    for (let i = 0; i < 60 && d.falling; i++) stepDrop(r, d);
    expect(d.falling).toBe(false);
    expect(d.y + T.WATER_HALF).toBeCloseTo(20 * T.TILE, 4);

    const restedAt = d.x;
    for (let i = 0; i < 20; i++) stepDrop(r, d);
    expect(d.x).toBeGreaterThan(restedAt);
    expect(d.falling).toBe(false); // still on the tier
  });

  it('pours off the end of a tier rather than running into thin air', () => {
    const r = room({ platforms: [[20, 4, 12]] });
    const [d] = spawnWater(8 * T.TILE, 10 * T.TILE);
    d.dir = 1;

    for (let i = 0; i < 60 && d.falling; i++) stepDrop(r, d);
    expect(d.falling).toBe(false);

    // Run it to the right-hand edge; it must start falling again, not hover.
    for (let i = 0; i < 200 && !d.falling; i++) stepDrop(r, d);
    expect(d.falling).toBe(true);
    expect(d.x).toBeGreaterThan(12 * T.TILE);
  });

  it('turns back at a wall instead of stopping dead', () => {
    const r = room({ platforms: [[25, 1, 30]] });
    const [d] = spawnWater(2 * T.TILE, 20 * T.TILE);
    d.dir = -1;
    for (let i = 0; i < 200 && d.falling; i++) stepDrop(r, d);
    for (let i = 0; i < 60; i++) stepDrop(r, d);
    expect(d.x).toBeGreaterThan(T.TILE);
  });

  /** Water drains away; unlike a body it does not wrap around to the top. */
  it('drains out of the bottom rather than wrapping', () => {
    const r = room({ platforms: [] });
    const [d] = spawnWater(15 * T.TILE, ROOM_H - 20);
    for (let i = 0; i < 400 && !d.dead; i++) stepDrop(r, d);
    expect(d.dead).toBe(true);
  });

  it('expires so a burst cannot run forever', () => {
    const r = room({ platforms: [[25, 1, 30]] });
    const drops = spawnWater(15 * T.TILE, 20 * T.TILE);
    for (let i = 0; i < T.WATER_LIFETIME + 10; i++) for (const d of drops) stepDrop(r, d);
    expect(drops.every((d) => d.dead)).toBe(true);
  });

  it('splits both ways from the pop, so a burst washes the whole tier', () => {
    const drops = spawnWater(15 * T.TILE, 20 * T.TILE);
    expect(drops.some((d) => d.dir === 1)).toBe(true);
    expect(drops.some((d) => d.dir === -1)).toBe(true);
  });
});

/* ------------------------------------------------------------------ lightning */

describe('lightning', () => {
  /** The aiming mechanic: a bolt travels away from the side the player popped from. */
  it('travels in the direction it was given', () => {
    const r = room();
    const right = spawnBolt(100, 100, 1);
    const left = spawnBolt(100, 100, -1);
    stepBolt(r, right);
    stepBolt(r, left);
    expect(right.x).toBeGreaterThan(100);
    expect(left.x).toBeLessThan(100);
  });

  /** It sweeps a whole tier: platforms do not stop it, only solid walls do. */
  it('passes over platforms but is stopped by solid geometry', () => {
    const overPlatform = room({ platforms: [[12, 1, 30]] });
    const b = spawnBolt(4 * T.TILE, 12 * T.TILE, 1);
    for (let i = 0; i < 6; i++) stepBolt(overPlatform, b);
    expect(b.dead).toBe(false);

    const wall = room();
    const w = spawnBolt(ROOM_W - 3 * T.TILE, 12 * T.TILE, 1);
    for (let i = 0; i < 20 && !w.dead; i++) stepBolt(wall, w);
    expect(w.dead).toBe(true);
  });

  it('expires rather than bouncing around forever', () => {
    const r = room();
    const b = spawnBolt(100, 100, 1);
    for (let i = 0; i < T.LIGHTNING_LIFETIME + 5 && !b.dead; i++) stepBolt(r, b);
    expect(b.dead).toBe(true);
  });
});

/* ------------------------------------------------------------------ fire */

describe('fire', () => {
  it('falls to the tier below and stays there burning', () => {
    const r = room({ platforms: [[20, 1, 30]] });
    const [f] = spawnFire(15 * T.TILE, 10 * T.TILE);
    for (let i = 0; i < 60 && f.falling; i++) stepFlame(r, f);
    expect(f.falling).toBe(false);
    expect(f.y + T.FIRE_HALF).toBeCloseTo(20 * T.TILE, 4);

    const landed = f.y;
    for (let i = 0; i < 60; i++) stepFlame(r, f);
    expect(f.y).toBe(landed); // it denies ground; it does not roam
  });

  it('burns out eventually', () => {
    const r = room({ platforms: [[20, 1, 30]] });
    const [f] = spawnFire(15 * T.TILE, 10 * T.TILE);
    for (let i = 0; i < T.FIRE_LIFETIME + 5 && !f.dead; i++) stepFlame(r, f);
    expect(f.dead).toBe(true);
  });

  it('spreads across a few tiles rather than landing on one point', () => {
    const flames = spawnFire(15 * T.TILE, 10 * T.TILE);
    const xs = flames.map((f) => f.x);
    expect(new Set(xs).size).toBe(flames.length);
  });
});

/* ------------------------------------------------------------------ in play */

describe('special bubbles in play', () => {
  const idle = () => emptyActions();

  function worldWith(kind: string) {
    const w = new World(
      room({ specials: [kind], spawns: [{ kind: 'zenchan', x: 20, y: 24, dir: -1 }] }),
      1,
      initialScore(),
      emptyCounters(),
    );
    return w;
  }

  it('cannot catch a monster — it already carries something', () => {
    const w = worldWith('water');
    const m = w.monsters[0];
    const b = spawnSpecial('water', m.body.x, m.body.y);
    w.bubbles.push(b);
    w.step(idle());
    expect(b.captive).toBe(null);
    expect(m.state).toBe('walking');
  });

  /**
   * What you kill a monster WITH decides what it leaves behind, and the three payouts
   * rise water < lightning < fire. That fact gates the rarest items in the counter
   * table, so a player who never notices it never sees them.
   */
  it('pays more for fire than lightning, and more for lightning than water', () => {
    expect(T.DIAMOND_WATER).toBeLessThan(T.DIAMOND_LIGHTNING);
    expect(T.DIAMOND_LIGHTNING).toBeLessThan(T.DIAMOND_FIRE);
  });

  it('drowns a monster the water reaches and leaves a diamond', () => {
    const w = worldWith('water');
    const m = w.monsters[0];
    w.drops.push(...spawnWater(m.body.x, m.body.y - 4));

    for (let i = 0; i < 60 && m.state === 'walking'; i++) w.step(idle());

    expect(m.state).toBe('dead');
    expect(w.score.points).toBeGreaterThanOrEqual(T.DIAMOND_WATER);
    expect(w.pickups.some((p) => p.kind === 'diamond')).toBe(true);
    expect(w.counters.drownedMonsters).toBe(1);
  });

  it('counts each element separately, because each buys a different item', () => {
    const w = worldWith('water');
    const at = { x: w.player.body.x + 40, y: w.player.body.y };

    for (const kind of ['water', 'lightning', 'fire'] as const) {
      const b = spawnSpecial(kind, at.x, at.y);
      w.bubbles.push(b);
      // Walk into it: the player faces right by default after moving.
      w.step({ ...emptyActions(), moveX: 1 });
      for (let i = 0; i < 90 && !b.dead; i++) w.step({ ...emptyActions(), moveX: 1 });
    }

    expect(w.counters.waterPops + w.counters.lightningPops + w.counters.firePops).toBeGreaterThan(0);
  });

  it('drifts specials in on the room clock, capped so they do not fill the screen', () => {
    const w = worldWith('water');
    for (let i = 0; i < T.SPECIAL_INTERVAL * (T.SPECIAL_MAX + 3); i++) w.step(idle());
    expect(w.bubbles.filter((b) => b.special).length).toBeLessThanOrEqual(T.SPECIAL_MAX);
  });

  it('offers none at all in a room that lists none', () => {
    const w = new World(room({ specials: [] }), 1, initialScore(), emptyCounters());
    for (let i = 0; i < T.SPECIAL_INTERVAL * 3; i++) w.step(idle());
    expect(w.bubbles.some((b) => b.special)).toBe(false);
  });

  /** The elements are indiscriminate; standing in your own fire is a way to die, which
   *  is what stops a special bubble being a free room clear. */
  it('burns the player who stands in their own fire', () => {
    const w = worldWith('fire');
    const lives = w.score.lives;
    w.flames.push(...spawnFire(w.player.body.x, w.player.body.y - 2));
    for (let i = 0; i < 90 && w.score.lives === lives; i++) w.step(idle());
    expect(w.score.lives).toBeLessThan(lives);
  });
});
