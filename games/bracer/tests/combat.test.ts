import { describe, it, expect } from 'vitest';
import { T } from '@/data/tuning';
import { CLASSES } from '@/data/classes';
import { Terrain, Tile } from '@/game/terrain';
import { makeShot, moveProjectile, projectileHits } from '@/game/projectile';
import { makeMonster, contactDamage } from '@/game/monster';
import { damagePlayer, scoreForKill } from '@/game/combat';
import { EventBus } from '@/game/events';
import { Player } from '@/game/player';

function floorTerrain(): Terrain {
  const t = new Terrain();
  t.tiles.fill(Tile.Floor);
  return t;
}

const SQRT_HALF = Math.SQRT1_2;

/**
 * Fire a diagonal shot at the corner shared by two diagonally adjacent wall blocks and
 * report whether it got through. This is the geometry of Gauntlet's cover mechanic.
 *
 *   . X        walls at (2,1) and (1,2); the free diagonal runs (1,1) -> (2,2)
 *   X .        through the corner at world (32, 32)
 */
function threadsCorner(half: number): boolean {
  const t = floorTerrain();
  t.tiles[t.idx(2, 1)] = Tile.Wall;
  t.tiles[t.idx(1, 2)] = Tile.Wall;

  // Start inside cell (1,1), heading south-east through the corner at (32,32).
  const s = makeShot(24, 24, 1, 1, 3.5, half, 1, true);
  for (let i = 0; i < 40; i++) {
    const r = moveProjectile(t, s);
    if (r.hitWall) return false;
    if (s.x > 40 && s.y > 40) return true; // cleanly out the far side
  }
  return false;
}

describe('diagonal corner rule', () => {
  it('lets a small shot (Elf) thread diagonally adjacent cover', () => {
    expect(threadsCorner(T.SHOT_HALF.small)).toBe(true);
  });

  it('lets a medium shot (Valkyrie, Wizard) thread it', () => {
    expect(threadsCorner(T.SHOT_HALF.medium)).toBe(true);
  });

  it('stops a large shot (Warrior) — the permanent curse of a Large collision box', () => {
    expect(threadsCorner(T.SHOT_HALF.large)).toBe(false);
  });

  it('matches each class to the right outcome', () => {
    const result = (id: keyof typeof CLASSES) =>
      threadsCorner(T.SHOT_HALF[CLASSES[id].shotBox]);
    expect(result('elf')).toBe(true);
    expect(result('wizard')).toBe(true);
    expect(result('valkyrie')).toBe(true);
    expect(result('warrior')).toBe(false);
  });

  it('still blocks every class on a solid wall', () => {
    const t = floorTerrain();
    for (let cy = 0; cy < T.GRID; cy++) t.tiles[t.idx(3, cy)] = Tile.Wall;
    for (const half of [T.SHOT_HALF.small, T.SHOT_HALF.medium, T.SHOT_HALF.large]) {
      const s = makeShot(24, 40, 1, 0, 3.5, half, 1, true);
      let blocked = false;
      for (let i = 0; i < 40 && !blocked; i++) blocked = moveProjectile(t, s).hitWall;
      expect(blocked, `half=${half}`).toBe(true);
      expect(s.x).toBeLessThan(48);
    }
  });

  it('never tunnels a fast shot through a one-cell wall', () => {
    const t = floorTerrain();
    t.tiles[t.idx(3, 2)] = Tile.Wall;
    const s = makeShot(24, 40, 1, 0, 5, T.SHOT_HALF.small, 1, true);
    let blocked = false;
    for (let i = 0; i < 40 && !blocked; i++) blocked = moveProjectile(t, s).hitWall;
    expect(blocked).toBe(true);
  });

  it('normalises diagonal speed so a diagonal shot is not 1.41x faster', () => {
    const s = makeShot(0, 0, 1, 1, 4, 1, 1, true);
    expect(Math.hypot(s.vx, s.vy)).toBeCloseTo(4, 5);
    expect(s.vx).toBeCloseTo(4 * SQRT_HALF, 5);
  });
});

describe('shot hit cone', () => {
  it('gives a larger shot a wider hit box — the one upside of Large', () => {
    const small = makeShot(0, 0, 1, 0, 3, T.SHOT_HALF.small, 1, true);
    const large = makeShot(0, 0, 1, 0, 3, T.SHOT_HALF.large, 1, true);
    // a monster offset just past the small shot's reach
    const off = T.MONSTER_HALF + 3;
    expect(projectileHits(small, 0, off, T.MONSTER_HALF)).toBe(false);
    expect(projectileHits(large, 0, off, T.MONSTER_HALF)).toBe(true);
  });
});

describe('armour', () => {
  const events = new EventBus();

  it('reduces damage by the class percentage', () => {
    const raw = 30;
    const dealt = (id: 'warrior' | 'valkyrie' | 'wizard' | 'elf') => {
      const p = new Player(id);
      damagePlayer(p, raw, events);
      return T.START_HEALTH - p.health;
    };
    expect(dealt('wizard')).toBe(30); // 0% armour
    expect(dealt('elf')).toBe(27); // 10%
    expect(dealt('warrior')).toBe(24); // 20%
    expect(dealt('valkyrie')).toBe(21); // 30%
  });

  it('orders the classes by survivability exactly as the stat table implies', () => {
    const taken = (['wizard', 'elf', 'warrior', 'valkyrie'] as const).map((id) => {
      const p = new Player(id);
      damagePlayer(p, 100, events);
      return T.START_HEALTH - p.health;
    });
    expect(taken).toEqual([...taken].sort((a, b) => b - a));
  });

  it('never rounds a hit down to zero', () => {
    const p = new Player('valkyrie');
    damagePlayer(p, 1, events);
    expect(p.health).toBe(T.START_HEALTH - 1);
  });
});

describe('monster damage', () => {
  it('makes ghosts hurt at least twice as much as grunts, worsening with level', () => {
    // Sourced values: ghost 10/20/30, grunt 5/8/10 — so the ratio is exactly 2x at
    // level 1 and widens to 3x at level 3.
    const ratios = ([1, 2, 3] as const).map(
      (lvl) =>
        contactDamage(makeMonster('ghost', lvl, 0, 0)) /
        contactDamage(makeMonster('grunt', lvl, 0, 0)),
    );
    expect(ratios[0]).toBe(2);
    expect(ratios[2]).toBe(3);
    for (const r of ratios) expect(r).toBeGreaterThanOrEqual(2);
    // and the gap must widen, which is why late-game ghost generators are the threat
    expect(ratios[2]).toBeGreaterThan(ratios[0]);
  });

  it('scales monster hit points with level', () => {
    expect(makeMonster('grunt', 1, 0, 0).hp).toBe(1);
    expect(makeMonster('grunt', 3, 0, 0).hp).toBe(3);
  });
});

describe('scoring', () => {
  it('pays far more for melee than for shooting, as the original does', () => {
    const m = makeMonster('grunt', 1, 0, 0);
    expect(scoreForKill(m, 'melee')).toBe(25);
    expect(scoreForKill(m, 'shot')).toBe(5);
    expect(scoreForKill(m, 'magic')).toBe(10);
  });

  it('pays nothing for a ghost that kills itself on you', () => {
    const g = makeMonster('ghost', 3, 0, 0);
    expect(scoreForKill(g, 'contact')).toBe(0);
    expect(scoreForKill(g, 'shot')).toBe(30);
  });
});
