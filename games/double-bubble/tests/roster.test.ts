import { describe, it, expect, beforeEach } from 'vitest';
import { T, ROOM_W } from '@/data/tuning';
import { MONSTER_SPECS, unlockedBy } from '@/data/roster';
import { Rng } from '@/engine/rng';
import { validateRoom, MONSTER_KINDS, type MonsterKind, type RoomData } from '@/game/room';
import { resetMonsterIds, spawnMonster, stepMonster } from '@/game/monster';
import { resetProjectileIds, stepProjectile, projectileHits } from '@/game/projectile';
import { spawnBaron, stepBaron, baronHits } from '@/game/baron';

function room(spec: { platforms?: [number, number, number][] } = {}): RoomData {
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
    playerStart: { x: 5, y: 24 },
    spawns: [{ kind: 'zenchan', x: 20, y: 24, dir: -1 }],
  });
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.data;
}

beforeEach(() => {
  resetMonsterIds();
  resetProjectileIds();
});

/* ------------------------------------------------------------------ the table */

describe('the roster', () => {
  it('covers every monster kind the room format accepts', () => {
    for (const kind of MONSTER_KINDS) {
      expect(MONSTER_SPECS[kind], `missing spec for ${kind}`).toBeDefined();
      expect(MONSTER_SPECS[kind].kind).toBe(kind);
    }
    expect(Object.keys(MONSTER_SPECS).length).toBe(MONSTER_KINDS.length);
  });

  it('makes every monster faster when angry', () => {
    for (const kind of MONSTER_KINDS) {
      const s = MONSTER_SPECS[kind];
      expect(s.angrySpeed, `${kind} must speed up when angry`).toBeGreaterThan(s.speed);
    }
  });

  /** Nothing may cross a whole tile in one step, or the collision tests stop being exact. */
  it('keeps every monster under the per-axis resolution limit', () => {
    for (const kind of MONSTER_KINDS) {
      expect(MONSTER_SPECS[kind].angrySpeed).toBeLessThanOrEqual(T.TILE / 2);
    }
  });

  /** One new idea roughly every ten rooms, each invalidating a habit the last ten taught. */
  it('introduces the roster on the documented schedule', () => {
    const order = MONSTER_KINDS.map((k) => MONSTER_SPECS[k].firstRoom);
    expect(order).toEqual([1, 6, 10, 20, 30, 40, 50, 60]);
  });

  it('unlocks types by room number', () => {
    expect(unlockedBy(1).map((s) => s.kind)).toEqual(['zenchan']);
    expect(unlockedBy(10).map((s) => s.kind)).toEqual(['zenchan', 'mighta', 'monsta']);
    expect(unlockedBy(100).length).toBe(MONSTER_KINDS.length);
  });
});

/* ------------------------------------------------------------------ locomotion */

describe('locomotion', () => {
  const rng = () => new Rng(1);

  it('keeps walkers on their platform rather than tipping them off the edge', () => {
    // A short ledge with open air either side. A walker must patrol it, not fall.
    const r = room({ platforms: [[20, 10, 16]] });
    const m = spawnMonster('zenchan', 13, 19, 1);
    const g = rng();
    for (let i = 0; i < 600; i++) stepMonster(r, m, 0, 400, g);
    expect(m.body.y + m.body.halfH).toBeCloseTo(20 * T.TILE, 4);
    expect(m.body.x).toBeGreaterThan(10 * T.TILE);
    expect(m.body.x).toBeLessThan(17 * T.TILE);
  });

  it('turns a walker around at a wall', () => {
    const r = room();
    const m = spawnMonster('zenchan', 2, 24, -1);
    const g = rng();
    for (let i = 0; i < 300; i++) stepMonster(r, m, 0, 400, g);
    expect(m.dir).toBe(1);
    expect(m.body.x - m.body.halfW).toBeGreaterThanOrEqual(T.TILE - 0.001);
  });

  /**
   * The flier is the monster the level cannot protect you from — it is why "get to a
   * higher tier" stops being a universal answer. If gravity ever touched it, that whole
   * lesson would quietly disappear.
   */
  it('flies a Monsta straight through the space above platforms, ignoring gravity', () => {
    const r = room({ platforms: [[10, 1, 30], [20, 1, 30]] });
    const m = spawnMonster('monsta', 5, 14, 1);
    const startY = m.body.y;
    const g = rng();
    const ys: number[] = [];
    for (let i = 0; i < 200; i++) {
      stepMonster(r, m, 0, 400, g);
      ys.push(m.body.y);
      expect(m.body.onGround).toBe(false);
    }
    // It moves vertically under its own steam, and does not simply sink.
    expect(Math.max(...ys)).toBeGreaterThan(startY - 1);
    expect(ys.some((y) => y < startY)).toBe(true);
  });

  it('bounces a flier off the side walls instead of stopping', () => {
    const r = room({ platforms: [] });
    const m = spawnMonster('monsta', 2, 14, -1);
    const g = rng();
    for (let i = 0; i < 400; i++) stepMonster(r, m, 0, 400, g);
    expect(m.body.x - m.body.halfW).toBeGreaterThanOrEqual(T.TILE - 1);
  });

  it('hops a Banebou rather than walking it', () => {
    const r = room();
    const m = spawnMonster('banebou', 10, 24, 1);
    const g = rng();
    let leftGround = 0;
    for (let i = 0; i < 200; i++) {
      stepMonster(r, m, 0, 400, g);
      if (!m.body.onGround) leftGround++;
    }
    expect(leftGround).toBeGreaterThan(20);
  });

  it('floats a Pulpul horizontally with only a slight rise and fall', () => {
    const r = room();
    const m = spawnMonster('pulpul', 10, 14, 1);
    const y0 = m.body.y;
    const g = rng();
    let drift = 0;
    for (let i = 0; i < 300; i++) {
      stepMonster(r, m, 0, 400, g);
      drift = Math.max(drift, Math.abs(m.body.y - y0));
    }
    expect(m.body.x).toBeGreaterThan(10 * T.TILE); // it travelled
    expect(drift).toBeLessThan(T.TILE * 3); // but stayed roughly on its line
  });
});

/* ------------------------------------------------------------------ projectiles */

describe('projectiles', () => {
  const rng = () => new Rng(1);

  it('is thrown only by the kinds that throw', () => {
    const r = room();
    for (const kind of MONSTER_KINDS) {
      const m = spawnMonster(kind, 10, 24, 1);
      m.throwCooldown = 0;
      const g = rng();
      let threw = false;
      for (let i = 0; i < 400; i++) {
        // A player directly ahead and level, which is the case a thrower acts on.
        if (stepMonster(r, m, m.body.x + 60, m.body.y, g).threw) threw = true;
      }
      expect(threw, `${kind}`).toBe(MONSTER_SPECS[kind].projectile !== null);
    }
  });

  /**
   * Without the alignment gate a room of Mightas fires boulders at a ceiling three tiers
   * below the player all game, which reads as the monsters being broken rather than as
   * the player being safe.
   */
  it('holds a flat shot until the player is roughly on its level', () => {
    const r = room();
    const m = spawnMonster('mighta', 10, 24, 1);
    m.throwCooldown = 0;
    const g = rng();

    let threwAtDistance = false;
    for (let i = 0; i < 400; i++) {
      if (stepMonster(r, m, m.body.x + 60, m.body.y - 120, g).threw) threwAtDistance = true;
    }
    expect(threwAtDistance).toBe(false);
  });

  it('lobs a bottle regardless of height, because an arc is the answer to height', () => {
    const r = room();
    const m = spawnMonster('drunk', 10, 24, 1);
    m.throwCooldown = 0;
    const g = rng();
    let threw = false;
    for (let i = 0; i < 400; i++) {
      if (stepMonster(r, m, m.body.x + 60, m.body.y - 120, g).threw) threw = true;
    }
    expect(threw).toBe(true);
  });

  it('arcs a bottle and flies a fireball flat', () => {
    const r = room();
    const drunk = spawnMonster('drunk', 10, 20, 1);
    const hide = spawnMonster('hidegons', 10, 20, 1);
    drunk.throwCooldown = 0;
    hide.throwCooldown = 0;
    const g = rng();

    const bottle = stepMonster(r, drunk, drunk.body.x + 40, drunk.body.y, g).threw!;
    const fire = stepMonster(r, hide, hide.body.x + 40, hide.body.y, g).threw!;
    expect(bottle).toBeTruthy();
    expect(fire).toBeTruthy();

    const bottleY0 = bottle.y;
    const fireY0 = fire.y;
    for (let i = 0; i < 20; i++) {
      stepProjectile(r, bottle);
      stepProjectile(r, fire);
    }
    expect(fire.y).toBeCloseTo(fireY0, 4); // dead flat
    expect(bottle.y).not.toBeCloseTo(bottleY0, 1); // it went somewhere
  });

  it('expires rather than flying forever', () => {
    const r = room({ platforms: [] });
    const m = spawnMonster('hidegons', 4, 20, 1);
    m.throwCooldown = 0;
    const shot = stepMonster(r, m, m.body.x + 40, m.body.y, rng()).threw!;
    for (let i = 0; i < 600 && !shot.dead; i++) stepProjectile(r, shot);
    expect(shot.dead).toBe(true);
  });

  it('hits a body it overlaps', () => {
    const r = room();
    const m = spawnMonster('hidegons', 10, 20, 1);
    m.throwCooldown = 0;
    const shot = stepMonster(r, m, m.body.x + 40, m.body.y, rng()).threw!;
    expect(projectileHits(shot, shot.x, shot.y, 6, 7)).toBe(true);
    expect(projectileHits(shot, shot.x + 200, shot.y, 6, 7)).toBe(false);
  });
});

/* ------------------------------------------------------------------ the Baron */

describe('Baron von Blubba', () => {
  it('enters from the side, not from overhead', () => {
    const left = spawnBaron(40, 100);
    const right = spawnBaron(ROOM_W - 40, 100);
    expect(right.x).toBeLessThan(0); // player on the right, Baron comes from the left
    expect(left.x).toBeGreaterThan(ROOM_W);
    // Level with the player: the threat is the closing distance, not the arrival.
    expect(left.y).toBe(100);
  });

  it('closes on one axis at a time', () => {
    const b = spawnBaron(100, 100);
    const before = { x: b.x, y: b.y };
    stepBaron(b, 60, 40);
    const movedX = b.x !== before.x;
    const movedY = b.y !== before.y;
    expect(movedX !== movedY).toBe(true);
  });

  it('accelerates without bound until it caps', () => {
    const b = spawnBaron(100, 100);
    const first = b.speed;
    for (let i = 0; i < 200; i++) stepBaron(b, 20, 20);
    const later = b.speed;
    expect(later).toBeGreaterThan(first);
    for (let i = 0; i < 5000; i++) stepBaron(b, 20, 20);
    expect(b.speed).toBeLessThanOrEqual(T.BARON_SPEED_MAX);
  });

  /** It passes through walls, ceilings and floors. Nothing in the room is cover. */
  it('reaches a player walled off behind solid geometry', () => {
    const b = spawnBaron(200, 100);
    for (let i = 0; i < 4000; i++) {
      stepBaron(b, 40, 40);
      if (baronHits(b, 40, 40, 6, 7)) return;
    }
    throw new Error('the Baron never arrived');
  });

  it('catches a player who simply stands still, and fairly quickly', () => {
    const b = spawnBaron(200, 100);
    let frames = 0;
    while (!baronHits(b, 200, 100, 6, 7) && frames < 60 * 60) {
      stepBaron(b, 200, 100);
      frames++;
    }
    expect(frames).toBeLessThan(60 * 30); // under half a minute
  });
});
