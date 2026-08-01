import { describe, it, expect } from 'vitest';
import { T } from '@/data/tuning';
import { World } from '@/game/world';
import { validateLevel, type LevelData } from '@/game/level';
import { emptyActions } from '@/engine/actions';
import type { ClassId } from '@/data/classes';
import { makeMonster } from '@/game/monster';
import { makeShot } from '@/game/projectile';
import { PROVING } from '@/data/proving';

/** The proving ground, padded to the current grid by @/data/proving. */
function level(): LevelData {
  return PROVING;
}

/** A bare arena with nothing but a border, for isolating one system at a time. */
function arena(objects: LevelData['objects'] = [], start: [number, number] = [16, 16]): LevelData {
  const tiles: string[] = [];
  for (let y = 0; y < T.GRID; y++) {
    tiles.push(
      y === 0 || y === T.GRID - 1
        ? 'X'.repeat(T.GRID)
        : 'X' + '.'.repeat(T.GRID - 2) + 'X',
    );
  }
  return { id: 'arena', name: 'Arena', theme: 'stone', type: 'normal', start, tiles, objects };
}

function run(w: World, frames: number, mutate?: (a: ReturnType<typeof emptyActions>) => void): void {
  const a = emptyActions();
  for (let i = 0; i < frames; i++) {
    mutate?.(a);
    w.step(a);
  }
}

describe('generators', () => {
  it('spawn monsters when on screen', () => {
    const w = new World(arena([{ t: 'gen', x: 16, y: 14, kind: 'grunt', lvl: 1 }]), 'elf', 1);
    expect(w.liveMonsters).toBe(0);
    run(w, 400);
    expect(w.liveMonsters).toBeGreaterThan(0);
  });

  it('are inert while off screen — the basis of the snipe-from-outside tactic', () => {
    // Generator in the far corner, player parked at the opposite end of the level.
    const w = new World(arena([{ t: 'gen', x: 29, y: 29, kind: 'grunt', lvl: 3 }], [2, 2]), 'elf', 1);
    expect(w.camera.contains(w.generators[0].x, w.generators[0].y)).toBe(false);
    run(w, 900);
    expect(w.liveMonsters).toBe(0);
  });

  it('spawn the level of monster matching their current level, and degrade when damaged', () => {
    const w = new World(arena([{ t: 'gen', x: 16, y: 14, kind: 'grunt', lvl: 3 }]), 'elf', 1);
    run(w, 400);
    expect(w.monsters.some((m) => m.level === 3)).toBe(true);

    // Chip it down; subsequent spawns must be weaker.
    w.generators[0].level = 1;
    w.monsters.length = 0;
    run(w, 400);
    expect(w.monsters.every((m) => m.level === 1)).toBe(true);
  });

  it('stop spawning once destroyed', () => {
    const w = new World(arena([{ t: 'gen', x: 16, y: 14, kind: 'grunt', lvl: 1 }]), 'elf', 1);
    w.generators[0].alive = false;
    run(w, 600);
    expect(w.liveMonsters).toBe(0);
  });

  it('respect the global monster cap', () => {
    const objects = [];
    for (let i = 0; i < 8; i++) objects.push({ t: 'gen', x: 10 + i, y: 14, kind: 'grunt', lvl: 3 });
    const w = new World(arena(objects), 'elf', 1);
    run(w, 4000);
    expect(w.liveMonsters).toBeLessThanOrEqual(T.MONSTER_CAP_TOTAL);
  });
});

describe('monsters', () => {
  it('close on the player', () => {
    const w = new World(arena([{ t: 'mon', x: 25, y: 16, kind: 'grunt', lvl: 1 }]), 'elf', 1);
    const m = w.monsters[0];
    const before = Math.hypot(m.x - w.player.x, m.y - w.player.y);
    w.godMode = true;
    run(w, 120);
    const after = Math.hypot(m.x - w.player.x, m.y - w.player.y);
    expect(after).toBeLessThan(before);
  });

  it('block each other rather than stacking — this is what makes chokepoints work', () => {
    const objects = [];
    for (let i = 0; i < 10; i++) objects.push({ t: 'mon', x: 22 + (i % 3), y: 12 + i, kind: 'grunt', lvl: 1 });
    const w = new World(arena(objects), 'elf', 1);
    w.godMode = true;
    run(w, 300);

    const live = w.monsters.filter((m) => m.alive);
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i];
        const b = live[j];
        const overlap =
          Math.abs(a.x - b.x) < a.half + b.half - 0.5 && Math.abs(a.y - b.y) < a.half + b.half - 0.5;
        expect(overlap, `monsters ${i} and ${j} overlap`).toBe(false);
      }
    }
  });

  it('never end up inside a wall', () => {
    const w = new World(level(), 'elf', 7);
    w.godMode = true;
    run(w, 600, (a) => {
      a.moveX = 1;
      a.moveY = 0;
    });
    for (const m of w.monsters) {
      if (!m.alive) continue;
      expect(w.terrain.solidAt(m.x, m.y), `monster at ${m.x},${m.y}`).toBe(false);
    }
  });

  it('kamikaze ghosts destroy themselves on contact and grunts do not', () => {
    const w = new World(arena(), 'wizard', 1); // 0% armour, so damage is unambiguous
    const ghost = makeMonster('ghost', 1, w.player.x + 8, w.player.y);
    const grunt = makeMonster('grunt', 1, w.player.x - 8, w.player.y);
    w.monsters.push(ghost, grunt);
    run(w, 4);
    expect(ghost.alive).toBe(false);
    expect(grunt.alive).toBe(true);
  });
});

describe('shooting', () => {
  it('allows only one player shot on screen at a time', () => {
    const w = new World(arena(), 'elf', 1);
    run(w, 30, (a) => {
      a.fire = true;
    });
    expect(w.projectiles.filter((p) => p.alive && p.fromPlayer).length).toBeLessThanOrEqual(1);
  });

  it('kills a level-1 grunt with one Warrior shot but needs three from an Elf', () => {
    const shots = (id: ClassId, level: 1 | 2 | 3) => {
      const w = new World(arena(), id, 1);
      w.godMode = true;
      const m = makeMonster('grunt', level, w.player.x + 60, w.player.y);
      m.alive = true;
      w.monsters.push(m);
      let fired = 0;
      const a = emptyActions();
      for (let i = 0; i < 900 && m.alive; i++) {
        a.fire = true;
        w.step(a);
        // Count the events, not transitions of `shotAlive`. Watching the flag misses any
        // shot that spawns on the same frame the previous one expires, which is exactly
        // what happens once the grunt has closed to point-blank — it reported one shot
        // for every class and made the comparison meaningless.
        fired += w.events.drain().filter((e) => e.t === 'shotFired').length;
      }
      return { dead: !m.alive, fired };
    };
    // Warrior shot is 2HP, Elf 1HP; a level-3 grunt has 3HP.
    const warrior = shots('warrior', 3);
    const elf = shots('elf', 3);
    expect(warrior.dead).toBe(true);
    expect(elf.dead).toBe(true);
    expect(warrior.fired).toBeLessThan(elf.fired);
  });
});

describe('M1 acceptance: cover', () => {
  /**
   * The proving level places a generator at (25,5) so the only straight line to it
   * threads the corner between the diagonally adjacent blocks (24,5) and (25,6).
   * Firing north-east from (22,8), small and medium shots squeeze through; a Large
   * one cannot, and cannot damage it through the corner either.
   */
  const snipe = (id: ClassId) => {
    const w = new World(level(), id, 1);
    w.godMode = true;
    w.player.x = 22 * T.TILE + 8;
    w.player.y = 8 * T.TILE + 8;
    w.player.facing = 7; // north-east
    w.camera.follow(w.player.x, w.player.y);
    const gen = w.generators.find((g) => g.cx === 25 && g.cy === 5)!;
    expect(gen, 'proving level must contain the cover-test generator').toBeTruthy();
    const a = emptyActions();
    a.fire = true;
    for (let i = 0; i < 2000 && gen.alive; i++) w.step(a);
    return gen;
  };

  it('lets the Elf destroy a generator through diagonal cover', () => {
    expect(snipe('elf').alive).toBe(false);
  });

  it('lets the Wizard and Valkyrie do the same', () => {
    expect(snipe('wizard').alive).toBe(false);
    expect(snipe('valkyrie').alive).toBe(false);
  });

  it('leaves the Warrior unable to even scratch it — he has to walk in', () => {
    const gen = snipe('warrior');
    expect(gen.alive).toBe(true);
    expect(gen.level).toBe(3); // not merely alive: undamaged
  });
});

describe('M1 acceptance: magic vs generators', () => {
  const blast = (id: ClassId) => {
    const w = new World(level(), id, 1);
    w.player.x = 24 * T.TILE + 8;
    w.player.y = 24 * T.TILE + 8;
    w.camera.follow(w.player.x, w.player.y);
    w.player.potions = 1;
    const inView = w.generators.filter((g) => g.alive && w.camera.contains(g.x, g.y));
    const before = inView.length;
    const a = emptyActions();
    a.magic = true;
    a.magicPressed = true;
    w.step(a);
    return { before, destroyed: inView.filter((g) => !g.alive).length };
  };

  it('is useless for the Warrior against generators — his defining weakness', () => {
    const r = blast('warrior');
    expect(r.before).toBeGreaterThan(0);
    expect(r.destroyed).toBe(0);
  });

  it('clears the whole nest for the Wizard', () => {
    const r = blast('wizard');
    expect(r.destroyed).toBe(r.before);
  });

  it('lets the Elf clear everything except a level-3 generator', () => {
    const r = blast('elf');
    expect(r.destroyed).toBeGreaterThan(0);
    expect(r.destroyed).toBeLessThan(r.before);
  });

  it('is scoped to the viewport, not the level', () => {
    const w = new World(level(), 'wizard', 1);
    w.player.x = 24 * T.TILE + 8;
    w.player.y = 24 * T.TILE + 8;
    w.camera.follow(w.player.x, w.player.y);
    w.player.potions = 1;
    const offscreen = w.generators.filter((g) => !w.camera.contains(g.x, g.y));
    expect(offscreen.length, 'need an off-screen generator for this test').toBeGreaterThan(0);
    const a = emptyActions();
    a.magic = true;
    a.magicPressed = true;
    w.step(a);
    for (const g of offscreen) expect(g.alive).toBe(true);
  });
});

describe('player death', () => {
  it('stops the simulation when health reaches zero', () => {
    const w = new World(arena(), 'wizard', 1);
    w.player.health = 1;
    w.monsters.push(makeMonster('ghost', 3, w.player.x + 8, w.player.y));
    run(w, 10);
    expect(w.player.dead).toBe(true);
    const frameAt = w.frame;
    run(w, 10);
    expect(w.frame).toBeGreaterThan(frameAt); // clock still runs
    expect(w.player.health).toBe(0); // but nothing further happens to the player
  });
});

describe('determinism with combat', () => {
  it('produces identical runs from the same seed', () => {
    const hash = () => {
      const w = new World(level(), 'elf', 4242);
      const a = emptyActions();
      for (let f = 0; f < 600; f++) {
        a.moveX = f % 120 < 60 ? 1 : -1;
        a.moveY = f % 90 < 45 ? 1 : 0;
        a.fire = f % 20 < 8;
        w.step(a);
      }
      return [
        w.player.x.toFixed(4),
        w.player.y.toFixed(4),
        w.player.health,
        w.player.score,
        w.liveMonsters,
        w.generators.map((g) => g.level).join(','),
      ].join('|');
    };
    expect(hash()).toBe(hash());
  });
});

describe('the one-shot limit is bounded by the screen, not the level', () => {
  /** Fire east; report how long the slot was held and where the shot ended up. */
  const fire = (cls: ClassId, lvl: LevelData) => {
    const w = new World(lvl, cls, 1);
    w.godMode = true;
    const a = emptyActions();
    a.fire = true;
    a.moveX = 1;
    w.step(a);
    const pr = w.projectiles.find((p) => p.fromPlayer)!;
    let held = 0;
    for (let f = 1; f <= 600 && w.player.shotAlive; f++) {
      w.step(emptyActions());
      held = f;
    }
    // How far outside the viewport the shot was when it stopped being the player's problem.
    const beyond = Math.max(
      0,
      pr.x - (w.camera.x + T.VIEW_W),
      w.camera.x - pr.x,
      pr.y - (w.camera.y + T.VIEW_H),
      w.camera.y - pr.y,
    );
    return { held, beyond };
  };

  it('frees the slot at the edge of the screen, not deep into the level', () => {
    // The invariant, stated as distance rather than frames because that is the actual
    // complaint: the slot used to be held while the shot flew hundreds of world units
    // through terrain nobody could see. Measured before the fix on an open level, the
    // shot travelled 478-658wu; the viewport is only 232x240.
    for (const cls of ['warrior', 'elf', 'wizard', 'valkyrie'] as ClassId[]) {
      const { beyond } = fire(cls, arena());
      expect(beyond, `${cls}: shot expired ${beyond.toFixed(0)}wu outside the viewport`).toBeLessThan(T.TILE * 2);
    }
  });

  it('never holds the slot longer on an open level than on a cramped one', () => {
    // A wall may still end a shot EARLY — that is ordinary. What must not happen is open
    // ground making the slot last longer, which is how level size silently leaked into
    // the fire rate when the grid grew from 32 to 48.
    const boxedIn = (() => {
      const l = arena();
      l.tiles = l.tiles.map((row, y) =>
        y >= 10 && y < 24 ? row.slice(0, 20) + 'X' + row.slice(21) : row,
      );
      return l;
    })();
    const open = fire('elf', arena()).held;
    const boxed = fire('elf', boxedIn).held;
    expect(boxed, 'a wall should end the shot no later than the screen edge').toBeLessThanOrEqual(open);
    expect(open, `open-field hold was ${open} frames`).toBeLessThan(90);
  });

  it('still lets a slower shot hold the slot longer', () => {
    // The Warrior's shot crosses the screen more slowly, so it occupies the slot longer.
    // That is a real class difference and should survive the fix.
    expect(fire('warrior', arena()).held).toBeGreaterThan(fire('elf', arena()).held);
  });

  it('does not cull enemy fire that leaves the view', () => {
    // Demons fire through walls and can sit just off screen. Culling their fireballs on
    // the same rule would disarm them from exactly the position that makes them dangerous.
    const w = new World(arena(), 'elf', 1);
    const shot = makeShot(w.player.x + 400, w.player.y, 1, 0, 2.2, 3, T.FIREBALL_DMG, false, 'fireball', null);
    w.projectiles.push(shot);
    expect(w.camera.contains(shot.x, shot.y, 0), 'test setup: should start off screen').toBe(false);
    for (let i = 0; i < 20; i++) w.step(emptyActions());
    expect(shot.alive, 'an off-screen enemy shot was culled').toBe(true);
  });
});
