import { describe, it, expect } from 'vitest';
import { T } from '@/data/tuning';
import { Field } from '@/game/field';
import { Digger, Dir } from '@/game/digger';
import { World } from '@/game/world';
import { LAYOUTS } from '@/data/layouts';

/** A world on the first layout, which is the gentlest and the most predictable. */
const world = (level = 1) => new World(LAYOUTS[0], level);
import { makeRock, stepRock, rockCell, RockState, type Crushable } from '@/game/rock';

/**
 * Park the cast: alive, so the round does not report itself clear, but inert and out of
 * the way.
 *
 * Needed because these tests are about one mechanic each, and a world with four enemies
 * hunting the player kills it partway through and the measurement becomes about
 * something else. Held rather than deleted, because an empty round is a different code
 * path now.
 */
function park(w: World): void {
  for (const e of w.enemies) {
    e.x = T.CELL / 2;
    e.y = T.CELL / 2;
    e.inflation = Number.MAX_SAFE_INTEGER;
  }
}

/** A field with one column dug out below a given row, so a rock there is unsupported. */
function undermined(rockCx: number, rockCy: number, depth: number): Field {
  const f = new Field();
  for (let i = 1; i <= depth; i++) f.dig(rockCx, rockCy + i);
  return f;
}

function run(f: Field, r: ReturnType<typeof makeRock>, frames: number, targets: Crushable[] = []) {
  const seen = { fell: false, landed: false, crushed: 0 };
  for (let i = 0; i < frames; i++) {
    const e = stepRock(f, r, targets);
    seen.fell ||= e.startedFalling;
    seen.landed ||= e.landed;
    seen.crushed += e.crushed.length;
  }
  return seen;
}

describe('rocks', () => {
  it('sits still while there is earth beneath it', () => {
    const f = new Field();
    const r = makeRock(5, 8);
    run(f, r, 600);
    expect(r.state).toBe(RockState.Embedded);
    expect(rockCell(r)).toBe(8);
  });

  it('teeters first, so digging under one is survivable if you move', () => {
    // Without the warning, the only way to learn this mechanic is to die to it: you dig
    // out the cell beneath a rock and you are standing exactly where it lands.
    const f = undermined(5, 8, 1);
    const r = makeRock(5, 8);

    stepRock(f, r, []);
    expect(r.state).toBe(RockState.Teetering);

    run(f, r, T.ROCK_TEETER_F - 2);
    expect(r.state, 'still teetering, still safe below').toBe(RockState.Teetering);
    expect(rockCell(r), 'has not moved yet').toBe(8);
  });

  it('cannot be un-teetered once the ground has gone', () => {
    // Digging under a rock is a commitment. There is no putting it back, which is what
    // makes it a decision rather than an experiment.
    const f = undermined(5, 8, 3);
    const r = makeRock(5, 8);
    stepRock(f, r, []);
    expect(r.state).toBe(RockState.Teetering);

    // Refill is not even expressible — Field has no such operation — so the closest
    // thing to a reprieve is nothing happening, and it does not save the rock.
    run(f, r, T.ROCK_TEETER_F + 1);
    expect(r.state).toBe(RockState.Falling);
  });

  it('falls only as far as the next solid cell, then shatters', () => {
    const f = undermined(5, 8, 3);
    const r = makeRock(5, 8);
    // Teeter, then three cells at the fall speed, then a few frames' slack. Deliberately
    // NOT a big round number: the rock shatters and is gone within a second of landing,
    // so overshooting hides the state we are actually checking.
    const frames = T.ROCK_TEETER_F + Math.ceil((3 * T.CELL) / T.ROCK_FALL_SPEED) + 4;
    const seen = run(f, r, frames);

    expect(seen.fell).toBe(true);
    expect(seen.landed).toBe(true);
    expect(rockCell(r), 'should rest on the last open cell above earth').toBe(11);
    expect(r.state).toBe(RockState.Shattering);
  });

  it('stops existing once the debris has been seen', () => {
    const f = undermined(5, 8, 2);
    const r = makeRock(5, 8);
    run(f, r, T.ROCK_TEETER_F + Math.ceil((2 * T.CELL) / T.ROCK_FALL_SPEED) + 4);
    expect(r.state).toBe(RockState.Shattering);
    run(f, r, T.ROCK_SHATTER_F + 1);
    expect(r.state).toBe(RockState.Gone);
  });

  it('stops at the floor of the world rather than falling out of it', () => {
    const f = new Field();
    const col = 5;
    for (let cy = 4; cy < T.GRID_H; cy++) f.dig(col, cy);
    const r = makeRock(col, 3);
    run(f, r, 600);
    expect(rockCell(r)).toBe(T.GRID_H - 1);
    expect(r.state).not.toBe(RockState.Falling);
  });

  it('kills what is under it, and only while it is actually falling', () => {
    const f = undermined(5, 8, 4);
    const r = makeRock(5, 8);
    const victim: Crushable = { x: 5 * T.CELL + T.CELL / 2, y: 11 * T.CELL + T.CELL / 2, alive: true };

    // Nothing happens during the teeter — that is the point of the teeter.
    run(f, r, T.ROCK_TEETER_F - 1, [victim]);
    expect(victim.alive, 'killed before it even moved').toBe(true);

    const seen = run(f, r, 200, [victim]);
    expect(victim.alive).toBe(false);
    expect(seen.crushed).toBe(1);
  });

  it('catches something caught mid-stride between two columns', () => {
    // Reported from play: a monster walked under a falling rock and was ignored. The
    // check asked whether the victim's CENTRE sat inside the rock's column, and anything
    // walking is between columns most of the time — measured, an 8wu offset was spared
    // while the rock came down visibly on top of it.
    //
    // Swept across a whole cell of offsets, because the failure was position-dependent
    // and a single sample would have passed.
    for (let off = 0; off <= T.CELL / 2; off++) {
      const f = undermined(5, 8, 4);
      const r = makeRock(5, 8);
      const victim: Crushable = {
        x: 5 * T.CELL + T.CELL / 2 + off,
        y: 11 * T.CELL + T.CELL / 2,
        alive: true,
      };
      run(f, r, 300, [victim]);
      expect(victim.alive, `spared at an offset of ${off}wu — the rock landed on it`).toBe(false);
    }
  });

  it('misses anything in a different column', () => {
    const f = undermined(5, 8, 4);
    const r = makeRock(5, 8);
    // A clear cell away, not merely off-centre: the widened reach must not turn a rock
    // into a two-column weapon.
    const bystander: Crushable = { x: 7 * T.CELL + T.CELL / 2, y: 11 * T.CELL + T.CELL / 2, alive: true };
    run(f, r, 300, [bystander]);
    expect(bystander.alive).toBe(true);
  });

  it('reports every victim of one fall, which is what a multi-crush will score', () => {
    const f = undermined(5, 4, 8);
    const r = makeRock(5, 4);
    const victims: Crushable[] = [9, 10, 11].map((cy) => ({
      x: 5 * T.CELL + T.CELL / 2,
      y: cy * T.CELL + T.CELL / 2,
      alive: true,
    }));
    const seen = run(f, r, 400, victims);
    expect(seen.crushed).toBe(3);
    expect(victims.every((v) => !v.alive)).toBe(true);
  });
});

describe('M1 acceptance: a rock can be dropped on the player', () => {
  /**
   * Rocks only, no cast.
   *
   * The placeholder enemies added at M2 sit close enough to the placeholder rocks that
   * a grub reaches the digger before the rock lands, and the player dies to the wrong
   * thing. That is the game working; it is not what these tests are about.
   */
  const rocksOnly = (): World => {
    const w = world();
    park(w);
    return w;
  };

  it('kills the digger that dug out from under it', () => {
    // The whole milestone in one test. Put the digger under a rock, have it dig straight
    // down, and let it stand there.
    const w = rocksOnly();
    const rock = w.rocks[0];

    // Walk the digger into the rock's column, one row below it, by fiat — pathing there
    // is M0's business and already tested.
    w.digger.x = rock.x;
    w.digger.y = (rockCell(rock) + 1) * T.CELL + T.CELL / 2;
    w.field.dig(rock.cx, rockCell(rock) + 1);

    let died = false;
    for (let f = 0; f < 400 && !died; f++) {
      died = w.step({ dir: Dir.None }).playerCrushed;
    }

    expect(died, 'the digger stood under a falling rock and lived').toBe(true);
    expect(w.playerAlive).toBe(false);
  });

  it('spares a digger that moves out of the way during the teeter', () => {
    // The other half: the warning has to be long enough to actually use. A digger that
    // runs sideways the moment the rock wobbles must get clear.
    const w = rocksOnly();
    const rock = w.rocks[0];
    const under = rockCell(rock) + 1;

    // Open a horizontal escape route along the row beneath the rock.
    for (let cx = 0; cx < T.GRID_W; cx++) w.field.dig(cx, under);
    w.digger.x = rock.x;
    w.digger.y = under * T.CELL + T.CELL / 2;

    for (let f = 0; f < 400; f++) w.step({ dir: Dir.Left });

    expect(w.playerAlive, 'the teeter was not long enough to escape').toBe(true);
    expect(w.digger.x, 'the digger should have run clear').toBeLessThan(rock.x - T.CELL);
  });

  it('stops the digger dead, and costs a life rather than nothing', () => {
    // Written at M1 as "dead stays dead", which stopped being true at M4 when death
    // became a hold, a lost life and a respawn. The claim that still matters is that
    // being crushed is not a free stumble: the digger stops on the spot, cannot be
    // driven during the pause, and comes back at the start rather than where it fell.
    const w = rocksOnly();
    const rock = w.rocks[0];
    w.digger.x = rock.x;
    w.digger.y = (rockCell(rock) + 1) * T.CELL + T.CELL / 2;
    w.field.dig(rock.cx, rockCell(rock) + 1);

    let died = false;
    for (let f = 0; f < 400 && !died; f++) died = w.step({ dir: Dir.None }).died;
    expect(died).toBe(true);

    const whereItFell = { x: w.digger.x, y: w.digger.y };
    for (let f = 0; f < T.DEATH_HOLD_F - 2; f++) w.step({ dir: Dir.Right });
    expect(w.digger.x, 'driving during the death pause').toBe(whereItFell.x);

    for (let f = 0; f < 10; f++) w.step({ dir: Dir.None });
    expect(w.lives, 'being crushed cost nothing').toBe(T.STARTING_LIVES - 1);
    expect(w.digger.x, 'respawned where it died instead of at the start').not.toBe(whereItFell.x);
  });
});
