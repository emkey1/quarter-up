import { describe, it, expect } from 'vitest';
import { T } from '@/data/tuning';
import { Field } from '@/game/field';
import { FlowField } from '@/game/flow';
import { Dir } from '@/game/digger';
import { makeEnemy, stepEnemy, type EnemyTarget } from '@/game/enemy';
import { pump, burstScore, crushScore } from '@/game/pump';
import { World } from '@/game/world';
import { LAYOUTS } from '@/data/layouts';

/** A world on the first layout, which is the gentlest and the most predictable. */
const world = (level = 1) => new World(LAYOUTS[0], level);

function tunnelRow(f: Field, row: number, from: number, to: number): void {
  for (let cx = from; cx <= to; cx++) f.dig(cx, row);
}

const at = (cx: number, cy: number) => cx * T.CELL + T.CELL / 2;

describe('the pump', () => {
  it('takes four presses to burst something', () => {
    const f = new Field();
    tunnelRow(f, 8, 4, 8);
    const e = makeEnemy('grub', 6, 8);
    const px = at(5, 8);
    const py = at(8, 8);

    for (let i = 1; i < T.PUMP_STAGES; i++) {
      const r = pump(f, [e], px, py, Dir.Right, py);
      expect(r.target, `press ${i} found nothing`).toBe(e);
      expect(r.burst, `burst early on press ${i}`).toBe(false);
      expect(e.alive).toBe(true);
    }
    const last = pump(f, [e], px, py, Dir.Right, py);
    expect(last.burst).toBe(true);
    expect(e.alive).toBe(false);
  });

  it('reaches only a short way, and never through earth', () => {
    // The pump is a reason to be dangerously close, not a gun. A target one cell into
    // the wall is safe, which makes a half-dug tunnel a defensive position too.
    const f = new Field();
    tunnelRow(f, 8, 4, 5); // player's pocket ends at 5
    const far = makeEnemy('grub', 7, 8); // beyond the earth at 6
    const px = at(4, 8);
    const py = at(8, 8);

    expect(pump(f, [far], px, py, Dir.Right, py).target, 'pumped through solid earth').toBeNull();

    // And out of range even down an open tunnel.
    const open = new Field();
    tunnelRow(open, 8, 0, 13);
    const distant = makeEnemy('grub', 4 + T.PUMP_REACH_CELLS + 1, 8);
    expect(pump(open, [distant], px, py, Dir.Right, py).target, 'pumped beyond its reach').toBeNull();
  });

  it('only reaches along the way the digger faces', () => {
    const f = new Field();
    tunnelRow(f, 8, 2, 10);
    const e = makeEnemy('grub', 6, 8);
    const px = at(5, 8);
    const py = at(8, 8);
    expect(pump(f, [e], px, py, Dir.Left, py).target).toBeNull();
    expect(pump(f, [e], px, py, Dir.Right, py).target).toBe(e);
  });
});

describe('inflation', () => {
  it('holds an enemy still while there is any air in it', () => {
    const f = new Field();
    tunnelRow(f, 8, 2, 10);
    const flow = new FlowField();
    flow.recompute(f, 10, 8);
    const e = makeEnemy('grub', 3, 8);
    const player: EnemyTarget = { x: at(10, 8), y: at(8, 8), alive: true };

    e.inflation = 2;
    const before = e.x;
    for (let i = 0; i < T.PUMP_DEFLATE_F - 1; i++) stepEnemy(f, flow, e, player);
    expect(e.x, 'a held enemy moved').toBe(before);
  });

  it('leaks back to nothing, and the enemy resumes', () => {
    // The decay is what stops the pump being a freeze ray. Every stage you do not top up
    // is draining while you deal with something else.
    const f = new Field();
    tunnelRow(f, 8, 2, 10);
    const flow = new FlowField();
    flow.recompute(f, 10, 8);
    const e = makeEnemy('grub', 3, 8);
    const player: EnemyTarget = { x: at(10, 8), y: at(8, 8), alive: true };

    e.inflation = 2;
    const before = e.x;
    for (let i = 0; i < T.PUMP_DEFLATE_F * 2 + 2; i++) {
      flow.recompute(f, 10, 8);
      stepEnemy(f, flow, e, player);
    }
    expect(e.inflation).toBe(0);

    for (let i = 0; i < 60; i++) {
      flow.recompute(f, 10, 8);
      stepEnemy(f, flow, e, player);
    }
    expect(e.x, 'never started moving again').toBeGreaterThan(before);
  });

  it('stops a dragon breathing while it is held', () => {
    // Otherwise the stall tactic is useless against the one enemy it is most needed for.
    const f = new Field();
    tunnelRow(f, 8, 2, 10);
    const flow = new FlowField();
    const e = makeEnemy('emberjaw', 5, 8);
    e.facing = Dir.Right;
    e.flameTimer = 1;
    e.inflation = 2;
    const player: EnemyTarget = { x: at(8, 8), y: at(8, 8), alive: true };

    for (let i = 0; i < T.FLAME_WINDUP_F + 10; i++) {
      const ev = stepEnemy(f, flow, e, player);
      expect(ev.flame.length, 'a pinned dragon breathed fire').toBe(0);
    }
  });

  it('still kills on contact while held', () => {
    // Walking into a held enemy is your mistake, not its win.
    const f = new Field();
    tunnelRow(f, 8, 2, 10);
    const flow = new FlowField();
    const e = makeEnemy('grub', 5, 8);
    e.inflation = 2;
    const player: EnemyTarget = { x: e.x, y: e.y, alive: true };
    expect(stepEnemy(f, flow, e, player).touchedPlayer).toBe(true);
  });
});

describe('scoring', () => {
  it('pays more the deeper something dies', () => {
    // Depth is money, and that is what pulls a player down away from safety.
    const grub = makeEnemy('grub', 5, 8);
    const values = [0, 1, 2, 3].map((band) => burstScore(grub, band, 0));
    expect(values).toEqual([...T.SCORE_BURST]);
    for (let i = 1; i < values.length; i++) {
      expect(values[i], 'deeper must pay more').toBeGreaterThan(values[i - 1]);
    }
  });

  it('doubles a dragon killed from its own fire lane', () => {
    // The dangerous way: you have to stand exactly where it can reach you.
    const dragon = makeEnemy('emberjaw', 5, 8);
    const inLane = burstScore(dragon, 1, dragon.y);
    const fromAbove = burstScore(dragon, 1, dragon.y - T.CELL * 2);
    expect(inLane).toBe(fromAbove * T.SCORE_DRAGON_LANE_MULTIPLIER);
  });

  it('pays a rock fall by how many it caught, steeply', () => {
    const one = crushScore(1);
    const two = crushScore(2);
    const four = crushScore(4);
    expect(two).toBeGreaterThan(one * 2);
    expect(four, 'one rock catching four must beat four separate kills').toBeGreaterThan(one * 4);
    expect(crushScore(0)).toBe(0);
    expect(crushScore(99), 'clamps rather than running off the table').toBe(
      T.SCORE_CRUSH[T.SCORE_CRUSH.length - 1],
    );
  });

  it('scores a crush once per fall, not once per victim', () => {
    // The whole point of the curve. If it paid per victim the escalation would be
    // invisible and setting up a multi-crush would be worth nothing extra.
    expect(crushScore(3)).toBeLessThan(crushScore(1) * 3 + crushScore(2));
  });
});

describe('M3 acceptance: pump-and-stall is viable without being dominant', () => {
  it('two presses buy enough stillness to walk past something', () => {
    // Viable. Freeze the one in the way, go round it, come back — a player who only ever
    // uses the pump to kill is playing it as a slow gun.
    const held = 2 * T.PUMP_DEFLATE_F;
    const cellsCrossed = (held * T.MOVE_SPEED) / T.CELL;
    expect(cellsCrossed, 'not long enough to get anywhere').toBeGreaterThan(3);
  });

  it('cannot park a room full of enemies indefinitely', () => {
    // Not dominant. Topping one up costs a press; the others are draining meanwhile, and
    // the deflate clock does not care what you are busy with.
    const f = new Field();
    tunnelRow(f, 8, 0, 13);
    const flow = new FlowField();
    const player: EnemyTarget = { x: at(7, 8), y: at(8, 8), alive: true };
    const mob = [2, 4, 10, 12].map((cx) => makeEnemy('grub', cx, 8));
    for (const e of mob) e.inflation = T.PUMP_STAGES - 1;

    // The player jabs as fast as the loop allows, but can only reach one target at a
    // time and only two cells away.
    for (let frame = 0; frame < T.PUMP_DEFLATE_F * 3; frame++) {
      pump(f, mob, player.x, player.y, Dir.Right, player.y);
      for (const e of mob) {
        flow.recompute(f, 7, 8);
        stepEnemy(f, flow, e, player);
      }
    }

    const stillHeld = mob.filter((e) => e.alive && e.inflation > 0).length;
    expect(stillHeld, 'the whole room stayed frozen').toBeLessThan(mob.length);
  });

  it('is worth fewer points than luring the same enemies under a rock', () => {
    // The economic half of "not dominant". Stalling and popping things one at a time has
    // to be the safe, cheap option — the elaborate, risky play is what the score curve
    // is there to pay for.
    const fourPops = 4 * T.SCORE_BURST[T.SCORE_BURST.length - 1];
    expect(crushScore(4), 'crushing four should beat popping four').toBeGreaterThan(fourPops);
  });

  it('banks the points on the world when something bursts', () => {
    const w = world();
    w.rocks.length = 0;
    const e = w.enemies[0];
    // Stand the digger next to it, facing it, in open ground.
    w.field.dig(e.x / T.CELL - 1, Math.floor(e.y / T.CELL));
    w.digger.x = e.x - T.CELL;
    w.digger.y = e.y;
    w.digger.facing = Dir.Right;

    for (let i = 0; i < T.PUMP_STAGES; i++) w.step({ dir: Dir.None, pump: true });

    expect(e.alive).toBe(false);
    expect(w.score, 'a burst scored nothing').toBeGreaterThan(0);
  });
});
