import { describe, it, expect } from 'vitest';
import { T } from '@/data/tuning';
import { LAYOUTS, layoutFor, speedScale } from '@/data/layouts';
import { validateLayout } from '@/game/layout';
import { World } from '@/game/world';
import { Run } from '@/game/run';
import { Dir } from '@/game/digger';
import { EnemyState } from '@/game/enemy';

describe('the layouts', () => {
  it('ships fifteen, and every one validates', () => {
    expect(LAYOUTS.length).toBe(15);
    for (const l of LAYOUTS) {
      const r = validateLayout(l);
      expect(r.ok, `${l.id}: ${r.ok ? '' : r.errors.join('; ')}`).toBe(true);
    }
  });

  it('starts every layout with the player somewhere open and a way up', () => {
    for (const l of LAYOUTS) {
      const [sx, sy] = l.start;
      expect(l.rows[sy][sx], `${l.id}: start is inside earth`).not.toBe('#');
      expect(l.rows[sy - 1][sx], `${l.id}: no route to the surface`).not.toBe('#');
    }
  });

  it('never places a rock that falls before the player has moved', () => {
    // The whole point of the teeter is that being crushed is something you did. A rock
    // unsupported at spawn kills people who have not touched anything.
    for (const l of LAYOUTS) {
      for (const [x, y] of l.rocks) {
        expect(l.rows[y + 1]?.[x], `${l.id}: rock at ${x},${y} is unsupported`).not.toBe('.');
      }
    }
  });

  it('gives every layout enough rocks for the bonus to be reachable', () => {
    for (const l of LAYOUTS) {
      expect(l.rocks.length, `${l.id}: the bonus can never appear`).toBeGreaterThanOrEqual(
        T.BONUS_AFTER_ROCKS,
      );
    }
  });

  it('gets harder, roughly, rather than monotonically', () => {
    // Not a strict ordering — a level that is briefly easier is pacing, not a bug. What
    // must hold is that the back half is meaningfully denser than the front half.
    const enemies = LAYOUTS.map((l) => l.enemies.length);
    const early = enemies.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const late = enemies.slice(-5).reduce((a, b) => a + b, 0) / 5;
    expect(late).toBeGreaterThan(early);
  });

  it('cycles the late layouts rather than restarting at the teaching ones', () => {
    // A player who has reached level 16 has demonstrated they do not need 'First Cut'.
    expect(layoutFor(1)).toBe(LAYOUTS[0]);
    expect(layoutFor(15)).toBe(LAYOUTS[14]);
    for (let level = 16; level < 60; level++) {
      const idx = LAYOUTS.indexOf(layoutFor(level));
      expect(idx, `level ${level} dropped back to a teaching layout`).toBeGreaterThanOrEqual(
        T.CYCLE_FROM - 1,
      );
    }
  });
});

describe('the difficulty ramp', () => {
  it('speeds enemies up with the level number', () => {
    expect(speedScale(1)).toBe(1);
    expect(speedScale(10)).toBeGreaterThan(speedScale(1));
  });

  it('never lets an enemy outrun the digger', () => {
    // The cap is not polish. An enemy faster than the player cannot be disengaged from,
    // so the game would stop being about the routes you cut and start being about luck.
    const fastest = T.ENEMY_SPEED * speedScale(9999);
    expect(fastest, 'enemies can outrun the player at high levels').toBeLessThan(T.MOVE_SPEED);
  });
});

describe('the bonus', () => {
  it('appears only after two rocks have landed, and is worth taking', () => {
    const w = new World(LAYOUTS[0]);
    for (const e of w.enemies) e.inflation = Number.MAX_SAFE_INTEGER;
    expect(w.bonus).toBeNull();

    // Undermine both of this layout's rocks.
    for (const r of w.rocks) w.field.dig(r.cx, Math.floor(r.y / T.CELL) + 1);

    let appeared = false;
    for (let f = 0; f < 600 && !appeared; f++) appeared = w.step({ dir: Dir.None }).bonusAppeared;
    expect(appeared, 'two rocks fell and no bonus came').toBe(true);
    expect(w.bonus!.value).toBeGreaterThan(T.SCORE_BURST[0]);
  });

  it('appears somewhere the player can actually reach', () => {
    // An item that spawns inside solid earth is an item that taunts you.
    const w = new World(LAYOUTS[0]);
    for (const e of w.enemies) e.inflation = Number.MAX_SAFE_INTEGER;
    for (const r of w.rocks) w.field.dig(r.cx, Math.floor(r.y / T.CELL) + 1);
    for (let f = 0; f < 600 && !w.bonus; f++) w.step({ dir: Dir.None });
    expect(w.bonus).not.toBeNull();
    expect(
      w.field.isOpen(Math.floor(w.bonus!.x / T.CELL), Math.floor(w.bonus!.y / T.CELL)),
      'the bonus is buried',
    ).toBe(true);
  });

  it('goes away on its own', () => {
    const w = new World(LAYOUTS[0]);
    for (const e of w.enemies) e.inflation = Number.MAX_SAFE_INTEGER;
    for (const r of w.rocks) w.field.dig(r.cx, Math.floor(r.y / T.CELL) + 1);
    for (let f = 0; f < 600 && !w.bonus; f++) w.step({ dir: Dir.None });
    for (let f = 0; f < T.BONUS_LIFETIME_F + 5; f++) w.step({ dir: Dir.None });
    expect(w.bonus).toBeNull();
  });
});

describe('the last enemy', () => {
  it('stops hunting and runs for the surface', () => {
    const w = new World(LAYOUTS[0]);
    for (let i = 1; i < w.enemies.length; i++) w.enemies[i].alive = false;
    const last = w.enemies[0];
    const startDist = Math.hypot(last.x, last.y);

    let fleeing = false;
    for (let f = 0; f < 60 && !fleeing; f++) fleeing = w.step({ dir: Dir.None }).lastEnemyFleeing;
    expect(fleeing).toBe(true);

    for (let f = 0; f < 200; f++) w.step({ dir: Dir.None });
    expect(Math.hypot(last.x, last.y), 'it should be heading for the corner').toBeLessThan(startDist);
  });

  it('ends the round by leaving, not only by dying', () => {
    // The inversion that makes the ending interesting: the level is not over when you
    // have killed everything, it is over when the survivor gets away.
    const w = new World(LAYOUTS[0]);
    for (let i = 1; i < w.enemies.length; i++) w.enemies[i].alive = false;

    let escaped = false;
    for (let f = 0; f < 60 * 30 && !escaped; f++) escaped = w.step({ dir: Dir.None }).enemyEscaped;
    expect(escaped, 'the last enemy never got away').toBe(true);
    expect(w.enemiesLeft).toBe(0);
  });

  it('cannot escape while it is pinned on the pump', () => {
    // Catching the runner is meant to be a decision with a cost, and the pump is how you
    // make it. If a held enemy still drifted away, there would be no decision.
    const w = new World(LAYOUTS[0]);
    for (let i = 1; i < w.enemies.length; i++) w.enemies[i].alive = false;
    const last = w.enemies[0];
    last.inflation = 2;
    const before = { x: last.x, y: last.y };
    for (let f = 0; f < T.PUMP_DEFLATE_F - 2; f++) w.step({ dir: Dir.None });
    expect(last.x).toBe(before.x);
    expect(last.y).toBe(before.y);
  });
});

describe('M5 acceptance: a full run, start to finish', () => {
  it('plays twenty levels through, carrying everything forward', () => {
    /*
     * Levels are cleared outright rather than played, because a bot good enough to
     * actually clear one is a different project. What this proves is the thing the
     * milestone is about: the run is a RUN. Twenty levels advance in order, past the
     * fifteen authored ones and into the cycle, with score and lives carried, the
     * layouts changing, and the difficulty climbing.
     */
    const run = new Run();
    const seen: string[] = [run.world.layout.id];
    const speeds: number[] = [run.world.speed];

    for (let level = 1; level < 20; level++) {
      run.world.score += 100;
      for (const e of run.world.enemies) e.alive = false;

      let advanced = false;
      for (let f = 0; f < T.CLEAR_HOLD_F + 30 && !advanced; f++) {
        advanced = run.step({ dir: Dir.None }).levelStarted;
      }
      expect(advanced, `level ${level} never finished`).toBe(true);
      seen.push(run.world.layout.id);
      speeds.push(run.world.speed);
    }

    expect(run.level).toBe(20);
    expect(run.score, 'score did not survive twenty level changes').toBe(1900);
    expect(run.lives, 'lives were lost to nothing').toBe(T.STARTING_LIVES);
    expect(new Set(seen).size, 'the same layout came up every time').toBeGreaterThan(5);
    expect(speeds[19]).toBeGreaterThan(speeds[0]);
  });

  it('ends a run by running out of lives, not by hanging', () => {
    // The crudest possible bot: walks a fixed cycle and jabs the pump. It is not meant
    // to be good — only to prove that a run left to itself terminates.
    const run = new Run();
    const pattern = [Dir.Down, Dir.Right, Dir.Up, Dir.Left];
    let frames = 0;

    for (; frames < 60 * 60 * 10 && !run.over; frames++) {
      run.step({ dir: pattern[Math.floor(frames / 47) % pattern.length], pump: frames % 5 === 0 });
    }

    expect(run.over, 'the run never finished').toBe(true);
    expect(run.lives).toBe(0);
    expect(frames, 'it ended suspiciously fast').toBeGreaterThan(60);
  });

  it('carries score and lives across a level change', () => {
    const run = new Run();
    // Set it on the World: Run mirrors the World it is currently running, rather than
    // the other way round, so writing to Run directly would just be overwritten.
    run.world.score = 1234;
    run.world.lives = 2;
    // Clear the level outright.
    for (const e of run.world.enemies) e.alive = false;
    for (let f = 0; f < T.CLEAR_HOLD_F + 10 && run.level === 1; f++) run.step({ dir: Dir.None });

    expect(run.level, 'the level never advanced').toBe(2);
    expect(run.world.score, 'score was reset by the new level').toBe(1234);
    expect(run.world.lives).toBe(2);
  });

  it('gets a harder world each level', () => {
    expect(new World(layoutFor(1), 1).speed).toBeLessThan(new World(layoutFor(9), 9).speed);
  });
});
