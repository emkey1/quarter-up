import { describe, it, expect } from 'vitest';
import { T } from '@/data/tuning';
import { Field } from '@/game/field';
import { FlowField } from '@/game/flow';
import { World } from '@/game/world';
import { Dir } from '@/game/digger';
import {
  makeEnemy,
  stepEnemy,
  EnemyState,
  enemyCellX,
  enemyCellY,
  type EnemyTarget,
} from '@/game/enemy';

/** Open a horizontal run of cells. */
function tunnelRow(f: Field, row: number, from: number, to: number): void {
  for (let cx = from; cx <= to; cx++) f.dig(cx, row);
}

function targetAt(cx: number, cy: number): EnemyTarget {
  return { x: cx * T.CELL + T.CELL / 2, y: cy * T.CELL + T.CELL / 2, alive: true };
}

describe('the flow field', () => {
  it('finds a route along a tunnel and none through earth', () => {
    const f = new Field();
    tunnelRow(f, 8, 2, 10);
    const flow = new FlowField();
    flow.recompute(f, 10, 8);

    expect(flow.distanceAt(2, 8), 'eight cells along an open row').toBe(8);
    expect(flow.distanceAt(2, 9), 'solid earth').toBe(-1);
  });

  it('routes around a wall rather than through it', () => {
    // A U-shaped tunnel: the two ends are adjacent but the route is the long way.
    const f = new Field();
    tunnelRow(f, 6, 2, 8);
    tunnelRow(f, 10, 2, 8);
    for (let cy = 6; cy <= 10; cy++) f.dig(8, cy);

    const flow = new FlowField();
    flow.recompute(f, 2, 6);
    expect(flow.distanceAt(2, 10), 'must go the long way round').toBe(6 + 4 + 6);
  });

  it('hands back a neighbouring cell, never the destination', () => {
    // Steering at the goal is what makes a mover shave a corner and catch the earth
    // beside it. The Thief in Bracer had exactly that bug.
    const f = new Field();
    tunnelRow(f, 8, 2, 10);
    const flow = new FlowField();
    flow.recompute(f, 10, 8);
    const step = flow.next(2, 8);
    expect(step).toEqual({ cx: 3, cy: 8 });
  });
});

describe('enemies in tunnels', () => {
  it('walks the tunnel toward the player', () => {
    const f = new Field();
    tunnelRow(f, 8, 2, 10);
    const flow = new FlowField();
    const e = makeEnemy('grub', 2, 8);
    const player = targetAt(10, 8);

    for (let i = 0; i < 200; i++) {
      flow.recompute(f, 10, 8);
      stepEnemy(f, flow, e, player);
    }
    expect(e.x).toBeGreaterThan(2 * T.CELL);
    expect(enemyCellY(e), 'should not have left the row').toBe(8);
  });

  it('is slower than the digger, so a good tunnel network lets you disengage', () => {
    // If enemies matched the player, every encounter would be a dead end you cannot
    // leave, and the routes a player cuts would stop meaning anything.
    expect(T.ENEMY_SPEED).toBeLessThan(T.MOVE_SPEED);
  });

  it('catches the player on contact', () => {
    const f = new Field();
    tunnelRow(f, 8, 2, 10);
    const flow = new FlowField();
    flow.recompute(f, 4, 8);
    const e = makeEnemy('grub', 3, 8);
    const player = targetAt(4, 8);

    let caught = false;
    for (let i = 0; i < 120 && !caught; i++) {
      flow.recompute(f, 4, 8);
      caught = stepEnemy(f, flow, e, player).touchedPlayer;
    }
    expect(caught).toBe(true);
  });
});

describe('ghosting', () => {
  it('starts almost at once when there is no tunnel route at all', () => {
    // Sealing yourself in has to fail FAST. A long pause first would read as though the
    // wall had worked, which teaches precisely the wrong lesson.
    const f = new Field();
    f.dig(3, 8); // the enemy's pocket
    f.dig(10, 8); // the player's, sealed off from it
    const flow = new FlowField();
    flow.recompute(f, 10, 8);
    const e = makeEnemy('grub', 3, 8);
    const player = targetAt(10, 8);

    let ghostedAt = -1;
    for (let i = 0; i < 200; i++) {
      if (stepEnemy(f, flow, e, player).startedGhosting) {
        ghostedAt = i;
        break;
      }
    }
    expect(ghostedAt, 'never ghosted; the player is safe forever').toBeGreaterThanOrEqual(0);
    expect(ghostedAt, 'took too long to give up on tunnels').toBeLessThan(T.GHOST_STUCK_F);
  });

  it('passes through earth without disturbing it', () => {
    // A ghost is not a second digger. If it cut its way through, the player would be
    // handed a free tunnel every time one visited.
    const f = new Field();
    f.dig(3, 8);
    f.dig(10, 8);
    const flow = new FlowField();
    flow.recompute(f, 10, 8);
    const e = makeEnemy('grub', 3, 8);
    const player = targetAt(10, 8);
    const before = f.tunnelCount();

    // Checked every frame rather than at the end: over a long enough run the ghost
    // arrives and solidifies, so a single check at the finish would be asserting about
    // an enemy that had stopped ghosting some time ago.
    let everGhosted = false;
    for (let i = 0; i < 400; i++) {
      stepEnemy(f, flow, e, player);
      everGhosted ||= e.state === EnemyState.Ghosting;
      expect(f.tunnelCount(), `a ghost dug its way through on frame ${i}`).toBe(before);
    }
    expect(everGhosted).toBe(true);
  });

  it('is slower through earth than through a tunnel', () => {
    // Ghosting must be the thing that stops you camping, not the fast way around. If it
    // beat walking, no enemy would ever use a tunnel and the network would stop
    // mattering at all.
    expect(T.GHOST_SPEED).toBeLessThan(T.ENEMY_SPEED);
  });

  it('solidifies on reaching open ground, and not before', () => {
    const f = new Field();
    f.dig(3, 8);
    tunnelRow(f, 8, 9, 12);
    const flow = new FlowField();
    flow.recompute(f, 11, 8);
    const e = makeEnemy('grub', 3, 8);
    const player = targetAt(11, 8);

    let solidified = false;
    for (let i = 0; i < 2000 && !solidified; i++) {
      solidified = stepEnemy(f, flow, e, player).solidified;
    }
    expect(solidified, 'ghosted forever instead of coming back').toBe(true);
    expect(e.state).toBe(EnemyState.Tunnelling);
    expect(f.isOpen(enemyCellX(e), enemyCellY(e)), 'solidified inside earth').toBe(true);
  });

  it('does not solidify on the open cell it started from', () => {
    const f = new Field();
    f.dig(3, 8);
    f.dig(10, 8);
    const flow = new FlowField();
    flow.recompute(f, 10, 8);
    const e = makeEnemy('grub', 3, 8);
    const player = targetAt(10, 8);

    // Ghost, then step a handful of frames while still in its own pocket.
    for (let i = 0; i < T.GHOST_NO_ROUTE_F + 3; i++) stepEnemy(f, flow, e, player);
    expect(e.state, 'popped straight back to solid without going anywhere').toBe(EnemyState.Ghosting);
  });
});

describe("the dragon's flame", () => {
  it('burns horizontally down its own tunnel and nowhere else', () => {
    const f = new Field();
    tunnelRow(f, 8, 2, 10);
    const flow = new FlowField();
    const e = makeEnemy('emberjaw', 5, 8);
    e.facing = Dir.Right;
    e.flameTimer = 1;
    const player = targetAt(8, 8);

    let flame: { x: number; y: number }[] = [];
    for (let i = 0; i < T.FLAME_WINDUP_F + 5; i++) {
      const ev = stepEnemy(f, flow, e, player);
      if (ev.flame.length) flame = ev.flame;
    }
    expect(flame.length, 'never lit').toBeGreaterThan(0);
    for (const c of flame) {
      expect(c.y, 'flame left its own row').toBe(e.y);
      expect(c.x, 'flame went backwards').toBeGreaterThan(e.x);
    }
  });

  it('warns before it burns', () => {
    // A ranged instant kill with no wind-up is not a threat you can play around, it is
    // a dice roll.
    const f = new Field();
    tunnelRow(f, 8, 2, 10);
    const flow = new FlowField();
    const e = makeEnemy('emberjaw', 5, 8);
    e.facing = Dir.Right;
    e.flameTimer = 1;
    const player = targetAt(8, 8);

    stepEnemy(f, flow, e, player);
    expect(e.flameState).toBe('winding');
    for (let i = 0; i < T.FLAME_WINDUP_F - 2; i++) {
      const ev = stepEnemy(f, flow, e, player);
      expect(ev.flame.length, 'burned during the wind-up').toBe(0);
    }
  });

  it('cannot breathe through earth', () => {
    // One cell round the corner is safe, which is what makes a dragon a question about
    // geometry rather than a bigger number.
    const f = new Field();
    tunnelRow(f, 8, 4, 6); // dragon's pocket ends at 6; earth beyond
    const flow = new FlowField();
    const e = makeEnemy('emberjaw', 5, 8);
    e.facing = Dir.Right;
    e.flameTimer = 1;
    const player = targetAt(6, 8);

    let flame: { x: number; y: number }[] = [];
    for (let i = 0; i < T.FLAME_WINDUP_F + 5; i++) {
      const ev = stepEnemy(f, flow, e, player);
      if (ev.flame.length) flame = ev.flame;
    }
    expect(flame.length, 'the jet should stop at the earth').toBe(1);
  });

  it('does not wind up at a player who is not in its tunnel', () => {
    const f = new Field();
    tunnelRow(f, 8, 2, 10);
    const flow = new FlowField();
    const e = makeEnemy('emberjaw', 5, 8);
    e.facing = Dir.Right;
    e.flameTimer = 1;
    const player = targetAt(8, 12); // four rows below

    for (let i = 0; i < 200; i++) stepEnemy(f, flow, e, player);
    expect(e.flameState).toBe('idle');
  });
});

describe('M2 acceptance: neither camping nor open ground is safe', () => {
  it('reaches a player who has walled themselves into a pocket', () => {
    // The dominant strategy this mechanic exists to kill: dig one hole, sit in it,
    // survive forever. The player here does nothing at all in a sealed pocket.
    const w = new World();
    w.rocks.length = 0; // rocks are M1's business

    // Seal the digger into a one-cell pocket far from everything.
    const cx = 1;
    const cy = T.GRID_H - 2;
    w.field.dig(cx, cy);
    w.digger.x = cx * T.CELL + T.CELL / 2;
    w.digger.y = cy * T.CELL + T.CELL / 2;

    let caught = false;
    for (let f = 0; f < 60 * 60 && !caught; f++) {
      caught = w.step({ dir: Dir.None }).playerCaught;
    }
    expect(caught, 'a sealed pocket was a permanent safe spot').toBe(true);
  });

  it('catches a player standing still in open tunnel', () => {
    const w = new World();
    w.rocks.length = 0;
    let caught = false;
    for (let f = 0; f < 60 * 60 && !caught; f++) {
      caught = w.step({ dir: Dir.None }).playerCaught;
    }
    expect(caught).toBe(true);
  });

  it('lets a player who keeps moving survive a good while', () => {
    // The other half of the claim: if nothing can be escaped, the mechanic is not
    // tension, it is a timer. A player running a loop should outlast a stationary one
    // by a wide margin.
    const w = new World();
    w.rocks.length = 0;

    // Cut a long horizontal corridor for the digger to run, then pace it.
    const row = w.digger.cellY;
    for (let cx = 0; cx < T.GRID_W; cx++) w.field.dig(cx, row);

    let frames = 0;
    let dir = Dir.Left;
    for (; frames < 60 * 60; frames++) {
      if (w.digger.cellX <= 1) dir = Dir.Right;
      if (w.digger.cellX >= T.GRID_W - 2) dir = Dir.Left;
      if (w.step({ dir }).playerCaught) break;
    }
    expect(frames, 'running was no better than standing still').toBeGreaterThan(120);
  });
});
