import { describe, it, expect } from 'vitest';
import { T } from '@/data/tuning';
import { World } from '@/game/world';
import { Run } from '@/game/flow';
import { CAMPAIGN } from '@/data/campaign';
import { emptyActions, type ActionState } from '@/engine/actions';
import { Tile } from '@/game/terrain';
import { makeItem } from '@/game/items';
import { foodKeepRatio, cullFood } from '@/game/rank';
import type { LevelData, LevelObject } from '@/game/level';

function arena(objects: LevelObject[] = [], tweak?: (rows: string[][]) => void): LevelData {
  const rows: string[][] = [];
  for (let y = 0; y < T.GRID; y++) {
    const row: string[] = [];
    for (let x = 0; x < T.GRID; x++) {
      row.push(y === 0 || y === T.GRID - 1 || x === 0 || x === T.GRID - 1 ? 'X' : '.');
    }
    rows.push(row);
  }
  tweak?.(rows);
  return {
    id: 'arena',
    name: 'Arena',
    theme: 'stone',
    type: 'normal',
    start: [16, 16],
    tiles: rows.map((r) => r.join('')),
    objects,
  };
}

function run(w: World, frames: number, a: ActionState = emptyActions()): void {
  for (let i = 0; i < frames; i++) w.step(a);
}

const SEC = T.STEP_HZ;

/* ------------------------------------------------------------------ inventory */

describe('inventory', () => {
  it('shares twelve slots between keys and potions', () => {
    const objects: LevelObject[] = [];
    for (let i = 0; i < 8; i++) objects.push({ t: 'key', x: 10 + i, y: 16 });
    for (let i = 0; i < 8; i++) objects.push({ t: 'potion', x: 10 + i, y: 18 });
    const w = new World(arena(objects), 'elf', 1);
    w.godMode = true;
    const a = emptyActions();
    a.moveX = 1;
    // sweep both rows
    run(w, 400, a);
    w.player.y = 18 * T.TILE + 8;
    w.player.x = 9 * T.TILE;
    run(w, 400, a);
    expect(w.player.inventoryUsed).toBeLessThanOrEqual(T.INVENTORY_SLOTS);
  });

  it('makes an uncollectable key solid — a full inventory barricades you', () => {
    const w = new World(arena([{ t: 'key', x: 18, y: 16 }]), 'elf', 1);
    w.godMode = true;
    w.player.keys = T.INVENTORY_SLOTS; // completely full
    const a = emptyActions();
    a.moveX = 1;
    run(w, 200, a);
    const key = w.items[0];
    expect(key.alive).toBe(true); // could not be picked up
    expect(w.player.x).toBeLessThan(key.x); // and could not be walked through
  });

  it('lets the same key through once a slot frees up', () => {
    const w = new World(arena([{ t: 'key', x: 18, y: 16 }]), 'elf', 1);
    w.godMode = true;
    w.player.keys = T.INVENTORY_SLOTS;
    const a = emptyActions();
    a.moveX = 1;
    run(w, 120, a);
    expect(w.items[0].alive).toBe(true);
    w.player.keys = 0; // spent them on doors
    run(w, 120, a);
    expect(w.items[0].alive).toBe(false);
    expect(w.player.keys).toBe(1);
  });

  it('degrades a duplicate upgrade to an ordinary potion', () => {
    const w = new World(arena([{ t: 'upgrade', x: 18, y: 16, kind: 'speed' }]), 'elf', 1);
    w.godMode = true;
    w.player.upgrades.add('speed');
    const a = emptyActions();
    a.moveX = 1;
    run(w, 200, a);
    expect(w.player.upgrades.size).toBe(1);
    expect(w.player.potions).toBe(1);
  });

  it('grants a new upgrade and changes the stat it governs', () => {
    const w = new World(arena([{ t: 'upgrade', x: 18, y: 16, kind: 'speed' }]), 'elf', 1);
    w.godMode = true;
    const before = w.player.speedWuPerFrame;
    const a = emptyActions();
    a.moveX = 1;
    run(w, 200, a);
    expect(w.player.upgrades.has('speed')).toBe(true);
    expect(w.player.speedWuPerFrame).toBeGreaterThan(before);
  });

  it('feeds and scores from food', () => {
    const w = new World(arena([{ t: 'food', x: 18, y: 16 }]), 'elf', 1);
    w.godMode = true;
    w.player.health = 100;
    const a = emptyActions();
    a.moveX = 1;
    run(w, 200, a);
    expect(w.player.health).toBeGreaterThan(100 + T.FOOD_HEALTH - 20);
    expect(w.player.score).toBe(T.SCORE.food);
  });
});

/* ------------------------------------------------------------------ timers */

describe('terrain timers (stopwatch)', () => {
  const doorLevel = (objects: LevelObject[] = []) =>
    arena(objects, (rows) => {
      for (let y = 1; y < T.GRID - 1; y++) rows[y][20] = 'D';
    });

  it('opens all doors after exactly 18 seconds of no engagement', () => {
    const w = new World(doorLevel(), 'elf', 1);
    w.godMode = true;
    run(w, T.DOOR_AUTO_OPEN_SEC * SEC - 2);
    expect(w.terrain.isDoorClosed(20, 16), 'still shut just before 18s').toBe(true);
    run(w, 3);
    expect(w.terrain.isDoorClosed(20, 16), 'open at 18s').toBe(false);
  });

  it('doubles that wait to 36 seconds while carrying keys', () => {
    const w = new World(doorLevel(), 'elf', 1);
    w.godMode = true;
    w.player.keys = 1;
    run(w, T.DOOR_AUTO_OPEN_SEC * SEC + 60);
    expect(w.terrain.isDoorClosed(20, 16), 'holding a key must NOT open at 18s').toBe(true);
    run(w, (T.DOOR_AUTO_OPEN_SEC_WITH_KEYS - T.DOOR_AUTO_OPEN_SEC) * SEC);
    expect(w.terrain.isDoorClosed(20, 16), 'open by 36s').toBe(false);
  });

  it('resets the door timer whenever the player engages', () => {
    const w = new World(doorLevel(), 'elf', 1);
    w.godMode = true;
    const fire = emptyActions();
    fire.fire = true;
    // fire once every 5s for 40s: the timer should never reach 18s
    for (let i = 0; i < 40; i++) {
      run(w, 5 * SEC - 1);
      w.step(fire);
    }
    expect(w.terrain.isDoorClosed(20, 16)).toBe(true);
  });

  it('spends one key to open a whole connected door group', () => {
    const w = new World(doorLevel(), 'elf', 1);
    w.godMode = true;
    w.player.keys = 3;
    w.player.x = 19 * T.TILE + 12;
    w.player.y = 16 * T.TILE + 8;
    const a = emptyActions();
    a.moveX = 1;
    run(w, 10, a);
    expect(w.player.keys).toBe(2); // exactly one spent
    // the entire column opened, not just the tile touched
    for (let y = 1; y < T.GRID - 1; y++) expect(w.terrain.isDoorClosed(20, y)).toBe(false);
  });

  it('turns every wall into an exit after 180 seconds of standing still', () => {
    const w = new World(arena(), 'elf', 1);
    w.godMode = true;
    run(w, T.WALLS_BECOME_EXITS_SEC * SEC - 2);
    expect(w.wallsAreExits).toBe(false);
    run(w, 3);
    expect(w.wallsAreExits).toBe(true);
    expect(w.terrain.at(0, 0)).toBe(Tile.Exit);
  });

  it('resets the stand-still timer on any movement input, but not on firing', () => {
    const w = new World(arena(), 'elf', 1);
    w.godMode = true;
    const fire = emptyActions();
    fire.fire = true;
    run(w, 60 * SEC, fire);
    expect(w.player.stillFrames).toBeGreaterThan(59 * SEC); // firing does not reset it

    const move = emptyActions();
    move.moveX = 1;
    w.step(move);
    expect(w.player.stillFrames).toBe(0);
  });
});

/* ------------------------------------------------------------------ terrain */

describe('terrain interaction', () => {
  it('destroys a breakable wall with a shot but leaves solid wall alone', () => {
    const lvl = arena([], (rows) => {
      rows[16][20] = 'x';
      rows[16][24] = 'X';
    });
    const w = new World(lvl, 'warrior', 1);
    w.godMode = true;
    w.player.facing = 0; // east
    const a = emptyActions();
    a.fire = true;
    run(w, 300, a);
    expect(w.terrain.at(20, 16)).toBe(Tile.Floor);
    expect(w.terrain.at(24, 16)).toBe(Tile.Wall);
  });

  it('opens the walls a trap tile names when stepped on', () => {
    const lvl = arena([{ t: 'trap', x: 18, y: 16, opens: [[24, 16], [25, 16]] }], (rows) => {
      rows[16][18] = '^';
      rows[16][24] = 'X';
      rows[16][25] = 'X';
    });
    const w = new World(lvl, 'elf', 1);
    w.godMode = true;
    expect(w.terrain.at(24, 16)).toBe(Tile.Wall);
    const a = emptyActions();
    a.moveX = 1;
    run(w, 200, a);
    expect(w.terrain.at(24, 16)).toBe(Tile.Floor);
    expect(w.terrain.at(25, 16)).toBe(Tile.Floor);
  });

  it('teleports between pads and lands somewhere solid-free', () => {
    const lvl = arena([], (rows) => {
      rows[16][18] = '@';
      rows[28][4] = '@';
    });
    const w = new World(lvl, 'elf', 1);
    w.godMode = true;
    const a = emptyActions();
    a.moveX = 1;
    // Stop as soon as it fires; continuing to walk east afterwards just carries the
    // player away from the destination and tells us nothing.
    let teleported = false;
    for (let i = 0; i < 200 && !teleported; i++) {
      w.step(a);
      teleported = Math.floor(w.player.y / T.TILE) === 28;
    }
    expect(teleported, 'should have arrived on the far pad row').toBe(true);
    expect(Math.floor(w.player.x / T.TILE)).toBeLessThan(8);
    expect(w.terrain.solidAt(w.player.x, w.player.y)).toBe(false);
  });

  it('reaches the exit and reports it', () => {
    const lvl = arena([], (rows) => {
      rows[16][20] = 'E';
    });
    const w = new World(lvl, 'elf', 1);
    w.godMode = true;
    const a = emptyActions();
    a.moveX = 1;
    run(w, 200, a);
    expect(w.exitReached).toBe(true);
  });
});

/* ------------------------------------------------------------------ rank */

describe('rank curve', () => {
  it('keeps all food at zero score and bottoms out at the floor', () => {
    expect(foodKeepRatio(0)).toBe(1);
    expect(foodKeepRatio(T.RANK_ZERO_FOOD_SCORE)).toBe(T.RANK_MIN_FOOD_RATIO);
    expect(foodKeepRatio(T.RANK_ZERO_FOOD_SCORE * 10)).toBe(T.RANK_MIN_FOOD_RATIO);
  });

  it('thins food as the score climbs', () => {
    const make = () =>
      Array.from({ length: 20 }, (_, i) => makeItem('food', i * 16 + 8, 100));
    const at = (score: number) => {
      const items = make();
      cullFood(items, 'lvl', score);
      return items.filter((i) => i.alive).length;
    };
    expect(at(0)).toBe(20);
    const mid = at(150_000);
    expect(mid).toBeLessThan(20);
    expect(mid).toBeGreaterThan(at(290_000));
  });

  it('is deterministic — the same level and score keep the same pieces', () => {
    const survivors = (score: number) => {
      const items = Array.from({ length: 20 }, (_, i) => makeItem('food', i * 16 + 8, 100));
      cullFood(items, 'lvl', score);
      return items.map((i) => i.alive).join('');
    };
    expect(survivors(150_000)).toBe(survivors(150_000));
  });

  it('always leaves some food on the level, however rich you get', () => {
    // The ratio is a proportion, so it and the campaign's food count multiply: halving
    // the campaign also halved what a late run is left with. On a level holding four
    // pieces, ceil(4 x 0.15) is one — which is not a difficulty curve, it is a coin flip
    // on whether you walk past it.
    for (const total of [3, 4, 6, 10]) {
      const items = Array.from({ length: total }, (_, i) => makeItem('food', i * 16 + 8, 100));
      cullFood(items, 'lvl', 10_000_000);
      const left = items.filter((i) => i.alive).length;
      expect(left, `${total} pieces culled to ${left}`).toBeGreaterThanOrEqual(
        Math.min(total, T.RANK_MIN_FOOD_ITEMS),
      );
    }
  });

  it('cannot conjure food that the level never had', () => {
    // The floor is a minimum to KEEP, not a minimum to create.
    const items = [makeItem('food', 10, 10)];
    cullFood(items, 'lvl', 10_000_000);
    expect(items.filter((i) => i.alive).length).toBe(1);
    expect(cullFood([], 'lvl', 10_000_000)).toBe(0);
  });

  it('never touches anything that is not food', () => {
    const items = [
      makeItem('food', 10, 10),
      makeItem('key', 30, 10),
      makeItem('treasure', 50, 10),
      makeItem('potion', 70, 10),
    ];
    cullFood(items, 'lvl', 999_999);
    expect(items.filter((i) => i.kind !== 'food').every((i) => i.alive)).toBe(true);
  });
});

/* ------------------------------------------------------------------ level flow */

describe('level flow', () => {
  it('carries health, score, inventory and upgrades across a transition', () => {
    const r = new Run(miniCampaign(), 'elf', 1);
    r.world.godMode = true;
    r.world.player.health = 412;
    r.world.player.score = 1234;
    r.world.player.keys = 2;
    r.world.player.potions = 3;
    r.world.player.upgrades.add('speed');

    r.world.exitReached = true;
    r.step();

    expect(r.depth).toBe(2);
    expect(r.world.player.health).toBe(412);
    expect(r.world.player.score).toBe(1234);
    expect(r.world.player.keys).toBe(2);
    expect(r.world.player.potions).toBe(3);
    expect(r.world.player.upgrades.has('speed')).toBe(true);
  });

  it('does NOT refill health between levels — the drain is one continuous clock', () => {
    const r = new Run(miniCampaign(), 'elf', 1);
    r.world.player.health = 200;
    r.world.exitReached = true;
    r.step();
    expect(r.world.player.health).toBe(200);
  });

  it('loops past the authored campaign with increasing depth', () => {
    const campaign = miniCampaign(4);
    const r = new Run(campaign, 'elf', 1);
    for (let i = 0; i < campaign.length + 2; i++) {
      r.world.exitReached = true;
      r.step();
    }
    expect(r.depth).toBe(campaign.length + 3);
    expect(r.world).toBeTruthy(); // still a valid level after wrapping
  });

  it('counts a credit and restores health on continue', () => {
    const r = new Run(miniCampaign(), 'elf', 1);
    r.world.player.health = 0;
    r.world.player.score = 5000;
    r.useCredit();
    expect(r.world.player.health).toBe(T.CONTINUE_HEALTH);
    expect(r.world.player.credits).toBe(2);
    expect(r.scorePerCredit).toBe(2500);
  });

  it('applies depth to generator pressure', () => {
    const r = new Run(miniCampaign(), 'elf', 1);
    expect(r.world.depth).toBe(1);
    r.world.exitReached = true;
    r.step();
    expect(r.world.depth).toBe(2);
  });
});

/* ------------------------------------------------------------------ acceptance */

/**
 * A purpose-built mini campaign.
 *
 * These tests are about the TRANSITION CHAIN, not about shipped content. Running them
 * against the real campaign made them fragile in a way that hid nothing useful: intro
 * level 7 has numbered skip exits, so walking north jumps you to depth 12 and a test
 * asserting "depth increased by one" fails on entirely correct behaviour.
 */
function miniCampaign(n = 5): LevelData[] {
  return Array.from({ length: n }, (_, i) => ({
    ...arena(
      // A few things to pick up, so "collects as it goes" is actually testable.
      //
      // Placed RELATIVE to the arena start rather than at absolute coordinates. The
      // sweep below is a crude bot, not a pathfinder, and at fixed coordinates it only
      // happened to cross them at one particular grid size — growing the world left it
      // wandering an empty quadrant and collecting nothing, which looked like a game bug
      // and was a fixture bug.
      [
        { t: 'food', x: 16, y: 18 },
        { t: 'treasure', x: 18, y: 16 },
        { t: 'key', x: 18, y: 18 },
      ],
      (rows) => {
        rows[16][24] = 'E';
      },
    ),
    id: `mini${i}`,
    name: `Mini ${i + 1}`,
  }));
}

describe('M2 acceptance: a full run is playable', () => {
  it('clears all five levels via the walls-become-exits route', () => {
    // Not a pathfinding bot. It finishes each level the way the 180-second trick lets
    // you finish ANY level, which exercises the whole transition chain: conversion,
    // exit detection, state carry-over, and building the next world.
    //
    // The 180s wait itself has its own stopwatch test above, so here the stillness
    // counter is fast-forwarded rather than burning 900 seconds of simulation.
    const campaign = miniCampaign();
    const r = new Run(campaign, 'elf', 99);
    const idle = emptyActions();

    for (let level = 0; level < campaign.length; level++) {
      const start = r.depth;
      r.world.godMode = true;

      r.world.player.stillFrames = T.WALLS_BECOME_EXITS_SEC * SEC - 1;
      r.world.step(idle);
      expect(r.world.wallsAreExits, `level ${start} walls should have converted`).toBe(true);

      // Now walk into one. Walls surround every level, so any direction finds one.
      let guard = 0;
      const walk = emptyActions();
      walk.moveY = -1;
      while (r.depth === start && guard++ < 60 * SEC) {
        r.world.step(walk);
        r.step();
      }
      expect(r.depth, `level ${start} should have been left`).toBe(start + 1);
    }

    expect(r.depth).toBe(campaign.length + 1);
    expect(r.world.player.dead).toBe(false);
  });

  it('carries a real run through five levels collecting as it goes', () => {
    // A cruder check that the whole loop survives ordinary play: sweep back and forth
    // through each level picking things up, then leave via the same route.
    const campaign = miniCampaign(3);
    const r = new Run(campaign, 'elf', 7);
    const a = emptyActions();
    let picked = 0;

    for (let level = 0; level < campaign.length; level++) {
      r.world.godMode = true;
      const before = r.world.items.filter((i) => i.alive).length;
      for (let f = 0; f < 20 * SEC; f++) {
        a.moveX = f % 240 < 120 ? 1 : -1;
        a.moveY = f % 480 < 240 ? 1 : -1;
        a.fire = f % 30 < 10;
        r.world.step(a);
        r.step();
        if (r.depth !== level + 1) break; // stumbled onto a real exit; fine
      }
      picked += before - r.world.items.filter((i) => i.alive).length;
      if (r.depth === level + 1) {
        r.world.player.stillFrames = T.WALLS_BECOME_EXITS_SEC * SEC - 1;
        r.world.step(emptyActions());
        const walk = emptyActions();
        walk.moveY = -1;
        let guard = 0;
        while (r.depth === level + 1 && guard++ < 60 * SEC) {
          r.world.step(walk);
          r.step();
        }
      }
    }

    expect(r.depth).toBeGreaterThan(campaign.length);
    expect(picked, 'should have collected something along the way').toBeGreaterThan(0);
    expect(r.world.player.score).toBeGreaterThan(0);
  });

  it('every campaign level has an exit and a validated layout', () => {
    for (const lvl of CAMPAIGN) {
      const w = new World(lvl, 'elf', 1);
      const exits = w.terrain.cellsOf(Tile.Exit);
      expect(exits.length, `${lvl.id} has no exit`).toBeGreaterThan(0);
      expect(w.terrain.solidAt(w.player.x, w.player.y), `${lvl.id} starts in a wall`).toBe(false);
    }
  });
});
