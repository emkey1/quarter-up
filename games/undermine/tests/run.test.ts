import { describe, it, expect } from 'vitest';
import { T } from '@/data/tuning';
import { World } from '@/game/world';
import { LAYOUTS } from '@/data/layouts';

/** A world on the first layout, which is the gentlest and the most predictable. */
const world = (level = 1) => new World(LAYOUTS[0], level);
import { Dir } from '@/game/digger';

/** Alive so the round is not instantly clear, but inert and out of the way. */
function park(w: World): void {
  for (const e of w.enemies) {
    e.x = T.CELL / 2;
    e.y = T.CELL / 2;
    e.inflation = Number.MAX_SAFE_INTEGER;
  }
}

describe('the run', () => {
  it('starts with three lives and no score', () => {
    const w = world();
    expect(w.lives).toBe(T.STARTING_LIVES);
    expect(w.score).toBe(0);
    expect(w.over).toBe(false);
  });

  it('holds after a death, then respawns at the start', () => {
    const w = world();
    park(w);
    const rock = w.rocks[0];
    w.field.dig(rock.cx, Math.floor(rock.y / T.CELL) + 1);
    w.digger.x = rock.x;
    w.digger.y = (Math.floor(rock.y / T.CELL) + 1) * T.CELL + T.CELL / 2;

    let died = false;
    for (let f = 0; f < 400 && !died; f++) died = w.step({ dir: Dir.None }).died;
    expect(died).toBe(true);
    expect(w.hold, 'no pause to see what killed you').toBeGreaterThan(0);

    let respawned = false;
    for (let f = 0; f < T.DEATH_HOLD_F + 5 && !respawned; f++) {
      respawned = w.step({ dir: Dir.None }).respawned;
    }
    expect(respawned).toBe(true);
    expect(w.lives).toBe(T.STARTING_LIVES - 1);
    expect(w.playerAlive).toBe(true);
  });

  it('keeps the tunnels the player already cut when they lose a life', () => {
    // The network is the player's work. Confiscating it on death would punish the same
    // mistake twice, and the second punishment is the one that ends runs.
    const w = world();
    park(w);
    for (let f = 0; f < 200; f++) w.step({ dir: Dir.Down });
    const dug = w.field.tunnelCount();

    const rock = w.rocks[0];
    w.field.dig(rock.cx, Math.floor(rock.y / T.CELL) + 1);
    w.digger.x = rock.x;
    w.digger.y = (Math.floor(rock.y / T.CELL) + 1) * T.CELL + T.CELL / 2;
    for (let f = 0; f < 400; f++) w.step({ dir: Dir.None });

    expect(w.field.tunnelCount()).toBeGreaterThanOrEqual(dug);
  });

  it('stops dead once the run is over, rather than eating lives forever', () => {
    // Found by rendering a preview of a long scripted run and reading `lives=-4` off the
    // picture. The death branch re-armed every frame: the player was still not alive, so
    // it set the hold again, the hold expired, another life came off, and it never
    // stopped. No unit test was asking, because nothing was obviously wrong from inside.
    const w = world();
    park(w);
    w.lives = 1;

    const rock = w.rocks[0];
    w.field.dig(rock.cx, Math.floor(rock.y / T.CELL) + 1);
    w.digger.x = rock.x;
    w.digger.y = (Math.floor(rock.y / T.CELL) + 1) * T.CELL + T.CELL / 2;

    for (let f = 0; f < 60 * 60; f++) w.step({ dir: Dir.None });

    expect(w.over).toBe(true);
    expect(w.lives, 'lives went negative').toBeGreaterThanOrEqual(0);
  });

  it('does nothing at all after game over', () => {
    const w = world();
    w.over = true;
    const before = { x: w.digger.x, y: w.digger.y, score: w.score, dug: w.field.tunnelCount() };
    for (let f = 0; f < 300; f++) w.step({ dir: Dir.Right, pump: true });
    expect(w.digger.x).toBe(before.x);
    expect(w.score).toBe(before.score);
    expect(w.field.tunnelCount()).toBe(before.dug);
  });

  it('calls the round clear when the last enemy is gone', () => {
    const w = world();
    w.rocks.length = 0;
    for (const e of w.enemies) e.alive = false;
    let clear = false;
    for (let f = 0; f < 10 && !clear; f++) clear = w.step({ dir: Dir.None }).roundClear;
    expect(clear).toBe(true);
  });
});
