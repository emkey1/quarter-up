import { describe, it, expect } from 'vitest';
import {
  COUNTER_NAMES,
  ITEM_SPECS,
  THRESHOLDS,
  tierFor,
  type CounterName,
  type ItemKind,
} from '@/data/items';
import { emptyCounters, readCounters, walkThresholds } from '@/game/counters';
import { fruitValue } from '@/game/item';
import { T, ROOM_W } from '@/data/tuning';
import { World } from '@/game/world';
import { initialScore } from '@/game/score';
import { emptyActions } from '@/game/controls';
import { validateRoom, type RoomData } from '@/game/room';

/** A plain room: floor, walls, one monster far from the player. */
function roomFixture(): RoomData {
  const rows: string[][] = [];
  for (let y = 0; y < T.GRID_H; y++) {
    const r = new Array<string>(T.GRID_W).fill('.');
    r[0] = '#';
    r[T.GRID_W - 1] = '#';
    rows.push(r);
  }
  for (let x = 1; x <= 30; x++) rows[25][x] = '=';

  const r = validateRoom({
    id: 'fixture',
    tiles: rows.map((x) => x.join('')),
    playerStart: { x: 4, y: 24 },
    spawns: [{ kind: 'zenchan', x: 16, y: 24, dir: -1 }],
    timer: 100000,
  });
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.data;
}

/**
 * The hidden counter system — the heart of the game (DESIGN.md §3.9), and the module
 * most likely to be subtly wrong while looking fine, because its whole purpose is to be
 * invisible while you play.
 */

describe('the threshold table', () => {
  it('only references counters that exist', () => {
    for (const t of THRESHOLDS) {
      expect(COUNTER_NAMES, `unknown counter ${t.counter}`).toContain(t.counter);
    }
  });

  it('only awards items that exist', () => {
    for (const t of THRESHOLDS) {
      expect(ITEM_SPECS[t.item], `no spec for ${t.item}`).toBeDefined();
    }
  });

  it('gives every threshold a value for all four difficulty tiers', () => {
    for (const t of THRESHOLDS) {
      expect(t.at.length).toBe(4);
      for (const v of t.at) expect(v).toBeGreaterThan(0);
    }
  });

  /** A run should get steadily stingier, never cheaper. */
  it('never lowers a threshold as the tier rises', () => {
    for (const t of THRESHOLDS) {
      for (let i = 1; i < 4; i++) {
        expect(t.at[i], `${t.item} tier ${i}`).toBeGreaterThanOrEqual(t.at[i - 1]);
      }
    }
  });

  it('steps the tier every 25 rooms and clamps at the top', () => {
    expect(tierFor(1)).toBe(0);
    expect(tierFor(25)).toBe(0);
    expect(tierFor(26)).toBe(1);
    expect(tierFor(51)).toBe(2);
    expect(tierFor(76)).toBe(3);
    expect(tierFor(100)).toBe(3);
  });
});

describe('the walk', () => {
  it('awards nothing when no counter is over', () => {
    const c = emptyCounters();
    expect(walkThresholds(c, 1).item).toBe(null);
  });

  it('awards the item whose counter is over, and resets only that counter', () => {
    const c = emptyCounters();
    c.jumps = 35;
    c.falls = 3;

    const r = walkThresholds(c, 1);
    expect(r.item).toBe('sweetYellow');
    expect(r.counter).toBe('jumps');
    expect(c.jumps).toBe(0);
    expect(c.falls).toBe(3); // untouched
  });

  /**
   * Walk ORDER is the priority rule. When several counters are over at once the table's
   * order decides, which is why it is an explicit array rather than an object whose key
   * order is incidental. If someone reorders it, this fails and they have to mean it.
   */
  it('resolves ties by table order, not by which counter is furthest over', () => {
    const c = emptyCounters();
    c.jumps = 35;
    c.bubblesBlown = 5_000; // wildly over, but lower in the table

    const r = walkThresholds(c, 1);
    expect(r.item).toBe('sweetYellow');
    expect(c.bubblesBlown).toBe(5_000);
  });

  it('awards exactly one item per call however many are due', () => {
    const c = emptyCounters();
    for (const t of THRESHOLDS) c[t.counter] = 10_000;
    const awarded: (ItemKind | null)[] = [];
    for (let i = 0; i < 3; i++) awarded.push(walkThresholds(c, 1).item);
    expect(new Set(awarded).size).toBe(3); // three different items, one at a time
  });

  /**
   * Resetting rather than decrementing is what makes items arrive in earned bursts —
   * a long stretch of jumping buys one sweet, not a stream of them — and stops one
   * runaway counter starving every other item in the table.
   */
  it('resets rather than decrements, so one binge buys one item', () => {
    const c = emptyCounters();
    c.jumps = 500;
    expect(walkThresholds(c, 1).item).toBe('sweetYellow');
    expect(c.jumps).toBe(0);
    expect(walkThresholds(c, 1).item).toBe(null);
  });

  it('demands more at a higher tier', () => {
    const jumpRule = THRESHOLDS.find((t) => t.counter === 'jumps')!;
    const justEnoughAtTier0 = jumpRule.at[0];

    const early = emptyCounters();
    early.jumps = justEnoughAtTier0;
    expect(walkThresholds(early, 1).item).toBe('sweetYellow');

    const late = emptyCounters();
    late.jumps = justEnoughAtTier0;
    // Same behaviour, deep into a run: not yet enough.
    expect(walkThresholds(late, 90).item).toBe(null);
  });

  it('is reachable for every item in the table by its own behaviour alone', () => {
    for (const t of THRESHOLDS) {
      const c = emptyCounters();
      c[t.counter] = t.at[0];
      // Walk until this item comes up; earlier rules sharing a counter may win first.
      let got: ItemKind | null = null;
      for (let i = 0; i < THRESHOLDS.length; i++) {
        const r = walkThresholds(c, 1);
        if (r.item === t.item) {
          got = r.item;
          break;
        }
        if (!r.item) break;
        c[t.counter] = t.at[0];
      }
      expect(got, `${t.item} is unreachable`).toBe(t.item);
    }
  });
});

describe('the debug readout', () => {
  it('reports every threshold with its current value and bar', () => {
    const c = emptyCounters();
    c.jumps = 20;
    const rows = readCounters(c, 1);
    expect(rows.length).toBe(THRESHOLDS.length);

    const jump = rows.find((r) => r.counter === 'jumps')!;
    expect(jump.value).toBe(20);
    expect(jump.next).toBe(THRESHOLDS.find((t) => t.counter === 'jumps')!.at[0]);
    expect(jump.ready).toBe(false);
  });

  it('flags a counter that is ready', () => {
    const c = emptyCounters();
    c.jumps = 9_999;
    expect(readCounters(c, 1).find((r) => r.counter === 'jumps')!.ready).toBe(true);
  });
});

describe('fruit value', () => {
  /** The corpses are half the reward, and climb on the same curve as the chain. */
  it('doubles with the chain that dropped it', () => {
    expect(fruitValue(1)).toBe(T.FRUIT_BASE);
    expect(fruitValue(2)).toBe(T.FRUIT_BASE * 2);
    expect(fruitValue(3)).toBe(T.FRUIT_BASE * 4);
  });

  it('caps rather than running away', () => {
    expect(fruitValue(20)).toBe(T.FRUIT_MAX);
  });

  it('never pays nothing', () => {
    expect(fruitValue(0)).toBe(T.FRUIT_BASE);
  });
});

describe('the awarded item lands somewhere worth walking to', () => {
  /**
   * It used to spawn three tiles above the player's start, fall straight onto them, and
   * be absorbed within a few frames of the room opening. The reward for thirty-five
   * jumps arrived with no moment of noticing it, let alone going to get it — which is
   * the difference between a prize and a rounding error on the score.
   */
  it('does not drop the award into the player on the opening frames', () => {
    const c = emptyCounters();
    c.jumps = 9_999;

    const w = new World(roomFixture(), 1, initialScore(), c);
    expect(w.awarded.item).toBe('sweetYellow');
    expect(w.pickups.length).toBe(1);

    const idle = emptyActions();
    for (let i = 0; i < 45; i++) w.step(idle);

    // Still there, and nowhere near the player who has not moved.
    expect(w.pickups.length).toBe(1);
    expect(Math.abs(w.pickups[0].body.x - w.player.body.x)).toBeGreaterThan(T.TILE * 4);
  });

  it('keeps the award clear of the solid side walls', () => {
    const c = emptyCounters();
    c.jumps = 9_999;
    const w = new World(roomFixture(), 1, initialScore(), c);
    const p = w.pickups[0];
    expect(p.body.x).toBeGreaterThan(T.TILE);
    expect(p.body.x).toBeLessThan(ROOM_W - T.TILE);
  });
});

describe('counter coverage', () => {
  /**
   * A counter nothing ever reads is dead weight, and one nothing ever *increments* is
   * worse: it silently makes an item unreachable, which is invisible in play because
   * the system is supposed to be mysterious anyway.
   */
  it('has a threshold rule for every counter it tracks', () => {
    const used = new Set<CounterName>(THRESHOLDS.map((t) => t.counter));
    for (const name of COUNTER_NAMES) {
      expect(used.has(name), `counter '${name}' feeds no threshold`).toBe(true);
    }
  });
});
