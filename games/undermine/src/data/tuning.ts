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

  // ---------------------------------------------------------------- rocks
  /**
   * [i] Frames a rock teeters before it falls.
   *
   * Fairness, and the reason this is not just a trap. Dig out the cell under a rock and
   * you are standing in exactly the place it is about to land, so without a warning the
   * only way to learn the mechanic is to die to it. Half a second is enough to react to
   * and short enough that luring something under one still works.
   */
  ROCK_TEETER_F: 30,

  /** [i] How fast a rock falls, wu per frame. Twice the digger's best pace: once it is
   *  coming down, outrunning it sideways has to be the answer rather than outrunning it
   *  downward. */
  ROCK_FALL_SPEED: 2,

  /** [i] Frames the debris lingers after a rock lands, before it stops existing. Long
   *  enough to read as an event rather than a disappearance. */
  ROCK_SHATTER_F: 24,

  // ---------------------------------------------------------------- enemies
  /**
   * [i] How fast an enemy travels an open tunnel, wu per frame.
   *
   * Below the digger's pace on purpose. Enemies that match you turn every encounter into
   * a dead end you cannot leave, and the game stops being about routes. Slower means a
   * player who has cut a good network can always disengage — which is the reward for
   * having cut one.
   */
  ENEMY_SPEED: 0.6,

  /**
   * [i] How fast an enemy moves while passing through solid earth.
   *
   * Much slower than through a tunnel, and that gap is the whole balance of the mechanic.
   * Ghosting has to be the thing that stops you camping, without being the fast way
   * around — if it were quicker than walking, no enemy would ever use a tunnel and the
   * network the player cuts would stop mattering.
   */
  GHOST_SPEED: 0.28,

  /**
   * [i] Frames of making no headway before an enemy gives up on tunnels and ghosts.
   *
   * Progress-based rather than a random timer, which is the reconstruction DESIGN.md
   * §8.3 flags as ours rather than documented. A random trigger punishes everyone
   * equally; this one specifically punishes walling yourself in, because sealing the
   * route is exactly what stops an enemy making progress.
   */
  GHOST_STUCK_F: 90,

  /** [i] An enemy with no tunnel route at all does not wait this out — it ghosts
   *  immediately. Sealing yourself in should fail fast, not after a pause that reads
   *  like it worked. */
  GHOST_NO_ROUTE_F: 12,

  // ---------------------------------------------------------------- the pump
  /**
   * [i] Presses to burst a target.
   *
   * Discrete, and countable straight off a recording — nobody has to measure anything to
   * check this one.
   */
  PUMP_STAGES: 4,

  /** [i] How far the nozzle reaches along the facing axis, in cells. Short: the pump is
   *  a reason to be dangerously close, not a gun. */
  PUMP_REACH_CELLS: 2,

  /**
   * [i] Frames one stage of inflation takes to leak away once you stop pumping.
   *
   * The single most important number in the pump, and the reason it is not simply a slow
   * gun. Two stages hold a target still for about a second and a half, which is enough to
   * walk past it — so the pump doubles as crowd control and a player who only ever uses
   * it to kill is playing it wrong. Long enough to be useful; short enough that you
   * cannot leave a room full of half-inflated enemies parked while you do something else.
   *
   * Expressed as integer frames per stage rather than a rate, which keeps it off the
   * continuous list DESIGN.md §12 tracks. That list stays at four.
   */
  PUMP_DEFLATE_F: 45,

  // ---------------------------------------------------------------- the run
  /** [i] Lives per credit, matching the other two cabinets and the era's convention. */
  STARTING_LIVES: 3,
  /** [i] Frames the death animation holds before the round restarts. Long enough to see
   *  what killed you, which is the difference between learning and being annoyed. */
  DEATH_HOLD_F: 120,
  /** [i] Frames the round-clear card is held. */
  CLEAR_HOLD_F: 100,

  // ---------------------------------------------------------------- the bonus
  /** [i] Rocks that must be dropped before the bonus appears. The game paying you to
   *  play the risky, elaborate way — it is gated on rocks, not on time or kills. */
  BONUS_AFTER_ROCKS: 2,
  /** [i] Frames the bonus stays before it goes. Long enough to reach from most of the
   *  field, short enough that you have to leave what you were doing. */
  BONUS_LIFETIME_F: 600,
  /** [i] Base value; it climbs with level number. */
  BONUS_BASE: 400,
  BONUS_PER_LEVEL: 100,
  BONUS_MAX: 5000,

  // ---------------------------------------------------------------- the last enemy
  /** [i] Speed the last survivor runs for the surface at. Faster than a hunting enemy:
   *  it is fleeing, and catching it should be a decision rather than a formality. */
  ESCAPE_SPEED: 0.9,

  // ---------------------------------------------------------------- difficulty
  /** [i] Enemy speed gained per level, as a fraction of the base. Ten levels in,
   *  everything moves half again as fast. */
  RAMP_PER_LEVEL: 0.05,
  /** [con] Ceiling on the ramp. Enemies faster than the digger make a run unwinnable
   *  rather than hard — there would be no disengaging, ever. Pinned by a test. */
  RAMP_MAX: 1.6,
  /** [der] Layouts repeat from here once the fifteen run out, so the cycle never drops a
   *  hardened player back into the teaching levels. */
  CYCLE_FROM: 11,

  // ---------------------------------------------------------------- scoring
  /** [i] Bursting something, by the band it dies in. Depth is money: the deep bands pull
   *  the player away from the surface and away from safety. Sources agree on the shape
   *  and differ on the numbers — see DESIGN.md §3.8. */
  SCORE_BURST: [200, 300, 400, 500],

  /** [i] A dragon burst while you are standing in its fire lane, i.e. the dangerous way,
   *  is worth double. */
  SCORE_DRAGON_LANE_MULTIPLIER: 2,

  /**
   * [i] A rock fall, by how many it caught at once.
   *
   * Steeply escalating on purpose: this is the only way to kill several things at once,
   * and the curve is what makes setting one up worth more than four separate pumps.
   */
  SCORE_CRUSH: [1000, 2500, 4000, 6000, 8000, 10000, 12000, 15000],

  // ---------------------------------------------------------------- the dragon's flame
  /** [i] Frames of visible wind-up before the flame appears. The only ranged threat in
   *  the game has to be escapable by a player who is watching. */
  FLAME_WINDUP_F: 40,
  /** [i] Frames the flame burns. */
  FLAME_ACTIVE_F: 30,
  /** [i] Frames before it can breathe again. */
  FLAME_COOLDOWN_F: 180,
  /** [i] How many cells the jet reaches down its own tunnel, stopping at earth. */
  FLAME_CELLS: 3,
  /** [i] Vertical tolerance for "in my tunnel", wu. Wider than nothing, because a
   *  player half a pixel off-lane should still be in danger. */
  FLAME_ALIGN_WU: 10,

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
