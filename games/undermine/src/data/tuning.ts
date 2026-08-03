/**
 * The single source of truth for every gameplay number.
 *
 * RULE: no other module in src/game/ may contain a magic gameplay constant.
 * RULE: nothing below "world space" may be expressed in screen pixels.
 *
 * Every value carries its provenance, from the day it is written rather than audited
 * into place later. Double Bubble spent five milestones with a single `[i]` tag on
 * everything, which made a hardware fact look as uncertain as a guess:
 *
 *   [hw]   Fixed by the original hardware. Not open to revision — changing one makes
 *          this a different game.
 *   [der]  Follows arithmetically from a [hw] value or another constant. Check the
 *          derivation, not the number.
 *   [con]  Constrained: a range would play fine, but something breaks outside it and a
 *          test pins the constraint.
 *   [i]    Genuinely free. Chosen by feel, defensible, unverified. These are what the
 *          fidelity pass is for, and DESIGN.md §12 says there should be very few —
 *          almost everything in this game is discrete and countable from a recording.
 */

export const T = {
  // ---------------------------------------------------------------- world space (wu)
  /** [hw] The cabinet is a vertical 224x288. One world unit is one hardware pixel. */
  VIEW_W: 224,
  VIEW_H: 288,

  /**
   * [i] Side of one field cell.
   *
   * Two hardware character cells. The original's tunnels look continuous rather than
   * grid-stepped, and DESIGN.md §8.1 commits to a grid anyway because pathing, rock
   * support and autotiling all get much harder without one. 16 is the coarsest value
   * that still reads as a tunnel rather than a corridor; if it looks chunky at M4 this
   * is the number to argue with, not the model.
   */
  CELL: 16,

  /** [der] Field size in cells. VIEW / CELL. */
  GRID_W: 14, // 224 / 16
  GRID_H: 18, // 288 / 16

  /** [i] Rows of open sky above the earth, where the HUD and the escape route live. */
  SKY_ROWS: 2,

  /** [der] Earth occupies everything below the sky: 16 rows, four bands of four. */
  EARTH_ROWS: 16, // GRID_H - SKY_ROWS
  BAND_ROWS: 4, // EARTH_ROWS / BANDS
  BANDS: 4,

  /** [hw] The original's refresh. The whole simulation is keyed to it. */
  STEP_HZ: 60,

  // ---------------------------------------------------------------- presentation only
  /** Screen px per world unit at S=1. Art is authored at CELL * ART_SCALE = 32px per
   *  cell — twice the original's detail, matching the other two cabinets rather than
   *  reproducing hardware cells exactly. */
  ART_SCALE: 2,
  SCREEN_SCALE_MIN: 1,
  SCREEN_SCALE_MAX: 3,

  // ---------------------------------------------------------------- input
  PAD_DEADZONE: 0.35,
  PAD_HYSTERESIS: 0.1,
  PAD_TRIGGER_THRESHOLD: 0.5,

  // ---------------------------------------------------------------- the digger
  /**
   * [i] Speed through open tunnel, in wu per frame.
   *
   * One of only three continuous constants in the game (DESIGN.md §12), so it is worth
   * measuring properly rather than settling. 1.0 crosses the field in a shade over 3
   * seconds — see tests/observables.test.ts, which states this in seconds so it can be
   * checked against a recording without anyone reading this file.
   */
  MOVE_SPEED: 1.0,

  /**
   * [i] Speed while cutting fresh earth.
   *
   * Deliberately a headline constant rather than a detail. The difference between these
   * two numbers is most of why tunnel layout matters at all: if cutting is as fast as
   * running, the network you dug is just scenery and there is no reason to plan it.
   * Half speed makes a detour through existing tunnel genuinely worth taking.
   */
  DIG_SPEED: 0.5,

  /**
   * [con] How close to a cell's centre line the digger must be before it may turn onto
   * the other axis, in wu.
   *
   * Four-way movement on a grid needs a rule for when a turn is allowed, and this is it.
   * Too tight and inputs feel dropped; too loose and the digger corner-cuts through
   * earth it never removed. Pinned by a test that turning never leaves solid earth
   * inside the digger's own box.
   */
  TURN_SLACK: 3,
} as const;

/** [der] Cell coordinates to the world position of that cell's centre. */
export const cellCentre = (cx: number, cy: number): [number, number] => [
  cx * T.CELL + T.CELL / 2,
  cy * T.CELL + T.CELL / 2,
];

/** [der] Which of the four bands a row sits in, 0 (shallow) to 3 (deep). Sky is -1. */
export const bandOf = (cy: number): number =>
  cy < T.SKY_ROWS ? -1 : Math.min(T.BANDS - 1, Math.floor((cy - T.SKY_ROWS) / T.BAND_ROWS));
