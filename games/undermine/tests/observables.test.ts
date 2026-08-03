import { describe, it, expect } from 'vitest';
import { T } from '@/data/tuning';
import { Field } from '@/game/field';
import { Digger, Dir } from '@/game/digger';

/**
 * The constants, expressed as things a person can count.
 *
 * This file exists on day one rather than at M6, which is the one clear lesson from
 * Double Bubble: what actually unblocked its physics was not measuring anything, it was
 * making the numbers checkable. `MOVE_SPEED: 1.0` is not a claim anyone can agree or
 * disagree with; "the digger crosses the field in 3.7 seconds" is, and anyone with a
 * recording can settle it without reading a line of code.
 *
 * These are not assertions that the values are RIGHT. They state what the current values
 * MEAN, so that no edit changes how the game feels without changing a number here, and so
 * the fidelity pass in DESIGN.md §12 is a checklist rather than a research project.
 *
 * Undermine should be able to finish that pass, unlike its predecessor: almost everything
 * here is discrete. The continuous list is three items long, and only two of them exist
 * yet.
 */

const SECONDS = (frames: number) => frames / T.STEP_HZ;
const CELLS = (wu: number) => wu / T.CELL;

describe('what the constants mean, in countable units', () => {
  describe('the field', () => {
    it('is 14 cells across and 18 down, of which 16 are earth', () => {
      expect(T.GRID_W).toBe(14);
      expect(T.GRID_H).toBe(18);
      expect(T.EARTH_ROWS).toBe(16);
      expect(T.SKY_ROWS).toBe(2);
    });

    it('divides its earth into four bands of four rows', () => {
      // Depth is money — the score for bursting something reads its band — so a player
      // has to be able to tell at a glance how deep they are. Four equal bands is what
      // makes "one band deeper" a thing you can see rather than count.
      expect(T.BANDS * T.BAND_ROWS).toBe(T.EARTH_ROWS);
      expect(T.BAND_ROWS).toBe(4);
    });

    it('fills the cabinet exactly, with nothing left over', () => {
      expect(T.GRID_W * T.CELL).toBe(T.VIEW_W);
      expect(T.GRID_H * T.CELL).toBe(T.VIEW_H);
    });
  });

  describe('the digger', () => {
    it('crosses the full width of open tunnel in 3.7 seconds', () => {
      // THE number to check first against a recording. Everything about how the game
      // paces — how long a detour costs, whether you can outrun what is chasing you —
      // is downstream of it.
      expect(SECONDS(T.VIEW_W / T.MOVE_SPEED)).toBeCloseTo(3.73, 2);
    });

    it('takes twice as long to cut earth as to run a tunnel', () => {
      // The most load-bearing RELATIONSHIP in the game, as distinct from either number.
      // At 1:1 the network a player digs is scenery; the further apart these are, the
      // more a run is about the routes you cut early.
      expect(T.MOVE_SPEED / T.DIG_SPEED).toBeCloseTo(2, 6);
    });

    it('spends a third of a second cutting each fresh cell', () => {
      // What it costs, once, to open a new square of earth. Countable straight off a
      // recording: watch one cell go.
      expect(SECONDS(T.CELL / T.DIG_SPEED)).toBeCloseTo(0.533, 3);
      expect(SECONDS(T.CELL / T.MOVE_SPEED)).toBeCloseTo(0.267, 3);
    });

    it('digs from the surface to bedrock in about eight and a half seconds', () => {
      // Straight down through virgin earth: 16 rows at the cutting rate. This is the
      // worst case a player can inflict on themselves, and it is why nobody digs
      // straight down without a reason.
      expect(SECONDS((T.EARTH_ROWS * T.CELL) / T.DIG_SPEED)).toBeCloseTo(8.533, 2);
    });

    it('actually moves at those speeds when simulated', () => {
      // The arithmetic above is only worth anything if the integrator agrees with it.
      const FRAMES = 30;
      const row = 8;

      const open = new Field();
      for (let cx = 0; cx < T.GRID_W; cx++) open.dig(cx, row);
      const runner = new Digger(1, row);
      for (let i = 0; i < FRAMES; i++) runner.step(open, { dir: Dir.Right });
      expect(CELLS(runner.x - (1 * T.CELL + T.CELL / 2))).toBeCloseTo(
        (FRAMES * T.MOVE_SPEED) / T.CELL,
        6,
      );

      const solid = new Field();
      solid.dig(1, row);
      const cutter = new Digger(1, row);
      for (let i = 0; i < FRAMES; i++) cutter.step(solid, { dir: Dir.Right });
      expect(CELLS(cutter.x - (1 * T.CELL + T.CELL / 2))).toBeCloseTo(
        (FRAMES * T.DIG_SPEED) / T.CELL,
        6,
      );
    });
  });

  describe('rocks', () => {
    it('warns for half a second before it falls', () => {
      // The fairness window, and the number to check first if the mechanic feels unfair
      // in either direction. Countable off a recording: watch a rock wobble.
      expect(SECONDS(T.ROCK_TEETER_F)).toBeCloseTo(0.5, 2);
    });

    it('falls twice as fast as the digger can run', () => {
      // Once it is coming down, running sideways has to be the answer. If a rock were
      // slower than the digger, you could outrun it downward and the threat would only
      // ever be a nuisance.
      expect(T.ROCK_FALL_SPEED / T.MOVE_SPEED).toBeCloseTo(2, 6);
    });

    it('crosses a cell in a seventh of a second', () => {
      expect(SECONDS(T.CELL / T.ROCK_FALL_SPEED)).toBeCloseTo(0.133, 3);
    });

    it('gives the digger about three cells of escape during the teeter', () => {
      // What the warning is actually WORTH, which is the thing a player experiences.
      // Under two cells and the teeter is decorative; far over three and luring
      // something under a rock stops working.
      const escape = (T.ROCK_TEETER_F * T.MOVE_SPEED) / T.CELL;
      expect(escape).toBeCloseTo(1.875, 3);
      expect(escape, 'not enough room to react').toBeGreaterThan(1);
      expect(escape, 'so much warning that nothing could ever be lured under one').toBeLessThan(4);
    });
  });

  describe('the free constants, tracked', () => {
    it('has only two continuous values so far, and both are named here', () => {
      // DESIGN.md §12 claims the continuous list is short — dig speed, run speed, and
      // later the ghost rate. If that list grows quietly, this game inherits Double
      // Bubble's problem, so the claim is pinned rather than trusted.
      const CONTINUOUS = ['MOVE_SPEED', 'DIG_SPEED'];
      const known = new Set([...CONTINUOUS, 'TURN_SLACK']);
      // PAD_* are cabinet input tuning rather than gameplay: they describe a thumbstick,
      // not this game, and they are shared with the other two cabinets.
      const isInputConfig = (k: string) => k.startsWith('PAD_');

      // Everything else in the tuning table must be an integer count of something —
      // cells, rows, frames, hardware pixels — which is the property that makes it
      // countable from a recording instead of inferred from feel.
      for (const [k, v] of Object.entries(T)) {
        if (known.has(k) || isInputConfig(k) || typeof v !== 'number') continue;
        expect(Number.isInteger(v), `${k} = ${v} is neither an integer nor a tracked constant`).toBe(true);
      }
    });
  });
});
