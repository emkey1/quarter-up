/**
 * The single source of truth for every gameplay number.
 *
 * RULE: no other module in src/game/ may contain a magic gameplay constant.
 * RULE: nothing below "world space" may be expressed in screen pixels.
 *
 * Values tagged [i] are *inferred* reconstructions, not sourced facts. No usable
 * disassembly of the original exists, so every physics constant here is a placeholder
 * awaiting the M1 measurement pass — see DESIGN.md §12. They are internally consistent
 * (the jump numbers solve to the stated apex) but they are not yet *right*.
 */

export const T = {
  // ---------------------------------------------------------------- world space (wu)
  // Never change these. They define the simulation's units.
  /** One world unit is one original-hardware pixel. Tiles are 8x8 there, so 8 here. */
  TILE: 8,
  /** Room size in tiles. 32x28 at 8px is the arcade playfield, 256x224. */
  GRID_W: 32,
  GRID_H: 28,

  /** The room IS the viewport — single screen, no scrolling, no camera. */
  VIEW_W: 256, // TILE * GRID_W
  VIEW_H: 224, // TILE * GRID_H

  STEP_HZ: 60,

  // ---------------------------------------------------------------- presentation only
  /** Screen px per world unit at S=1. Art is authored at TILE * ART_SCALE = 16px per
   *  tile — twice the original's detail, matching Bracer's modernised presentation
   *  rather than reproducing 8x8 cells exactly. */
  ART_SCALE: 2,
  SCREEN_SCALE_MIN: 1,
  SCREEN_SCALE_MAX: 3,

  // ---------------------------------------------------------------- input
  PAD_DEADZONE: 0.35,
  PAD_HYSTERESIS: 0.1,
  PAD_TRIGGER_THRESHOLD: 0.5,

  // ---------------------------------------------------------------- movement [i]
  /** wu/frame. The red shoe raises this to RUN_SPEED_FAST. */
  RUN_SPEED: 1.0,
  RUN_SPEED_FAST: 1.5,

  /**
   * Jump is FIXED height — no hold-to-jump-higher. This is not a simplification; a
   * variable jump changes bubble-riding fundamentally, because the whole point of the
   * floaty fixed arc is that you can predict where you will land on a drifting bubble
   * before you commit. See DESIGN.md §3.2.
   *
   * Solved for a 4-tile (32wu) apex reached in K=20 frames — but NOT with the textbook
   * h = v0^2/(2g). That is the continuous solution, and this is a fixed-step integrator
   * that applies gravity *before* the position update, so the first frame of a jump
   * moves (v0 - g) rather than v0. Summing the real series gives
   *
   *     apex = g*K*(K-1)/2        with K = v0/g
   *
   * which for a given v0 and g lands about 5% short of v0^2/(2g) — enough to look
   * correct on paper and still fail a frame-by-frame comparison against footage.
   * Inverting it for apex 32wu over K=20:
   *
   *     g  = 2*32 / (20*19) = 0.1684…      v0 = g*K = 3.368…
   *
   * predictJump() and solveJump() in game/physics.ts do this both ways; use solveJump
   * to convert measured footage numbers into constants during the M1 fidelity pass.
   */
  JUMP_VELOCITY: 3.368,
  GRAVITY: 0.1684,
  /** Terminal velocity. Without a cap, a fall through the vertical wrap accelerates
   *  forever and the player tunnels through platforms on re-entry. */
  FALL_SPEED_MAX: 4.0,

  // ---------------------------------------------------------------- collision boxes (wu)
  PLAYER_HALF_W: 6,
  PLAYER_HALF_H: 7,
  MONSTER_HALF: 6,
  BUBBLE_RADIUS: 8,
  ITEM_HALF: 6,

  // ---------------------------------------------------------------- bubbles [i]
  /** Fired horizontally at this speed, decelerating to zero over BUBBLE_FIRE_FRAMES,
   *  after which the bubble rises and joins the room's drift current. */
  BUBBLE_FIRE_SPEED: 3.0,
  BUBBLE_FIRE_FRAMES: 22,
  /** Purple sweet: bubbles travel *further*, not faster — more frames of push, same
   *  speed, so the arc a player has learned to aim still holds. */
  BUBBLE_FIRE_FRAMES_FAR: 32,
  /**
   * How fast a free bubble rises. [i]
   *
   * 0.35 climbed away too fast; 0.22 read as static. The second note was really about
   * the wobble below being absent rather than about this number — with lateral motion
   * restored, the rise can sit nearer where it started.
   */
  BUBBLE_RISE_SPEED: 0.3,

  /**
   * A free bubble is never perfectly still.
   *
   * The room's drift field is sparse by nature — over most of a room it is empty — so
   * without an intrinsic wobble a bubble had vx of exactly zero, rose in a straight
   * line and stopped dead. Amplitudes are comparable to the rise speed on purpose: the
   * motion has to be visible at a glance, not a shimmer.
   */
  BUBBLE_WOBBLE_X: 0.26,
  BUBBLE_WOBBLE_Y: 0.1,
  BUBBLE_WOBBLE_PERIOD: 96,
  /** Frames a shove keeps acting, so a push coasts instead of stopping the instant
   *  contact breaks. Too short and herding a cluster is impossible; too long and
   *  bubbles feel magnetic. */
  BUBBLE_PUSH_FRAMES: 10,
  /** Frames between shots. The yellow sweet drops this to _RAPID. */
  BUBBLE_COOLDOWN: 18,
  BUBBLE_COOLDOWN_RAPID: 7,
  /** Frames an empty bubble survives before popping itself. */
  BUBBLE_LIFETIME: 600,
  /** Default frames a trapped monster stays caught. Rooms override this — the original
   *  varies it per stage, and more sharply than any other per-stage value, which is
   *  what makes some rooms feel frantic. See DESIGN.md §3.3.2. */
  ESCAPE_FRAMES: 480,
  /** Fraction of ESCAPE_FRAMES remaining when the bubble starts reddening. The warning
   *  must be generous: an escape should always feel like something you were told about. */
  ESCAPE_WARN_AT: 0.35,
  /**
   * Gap between two bubble rims that still chains, in wu.
   *
   * Slack rather than exact contact, and deliberately generous. The exponential scoring
   * curve means the difference between a 3-chain and a 4-chain is 4,000 points, so a
   * cluster that *looks* touching and doesn't chain reads as the game cheating. See
   * DESIGN.md §3.8.
   */
  BUBBLE_CHAIN_SLACK: 3,
  /** How fast a bubble slides when the player walks into it front-first. */
  BUBBLE_PUSH_SPEED: 0.9,
  /**
   * Extra gap between the player's edge and a newly blown bubble, in wu.
   *
   * Without it a bubble spawns at exactly PLAYER_HALF_W + BUBBLE_RADIUS, which is
   * precisely the overlap threshold — so the mildest nudge from separation tips it into
   * contact and the player bursts their own bubble on the frame after blowing it. That
   * makes accumulating a cluster impossible, which quietly removes the entire reason the
   * chain curve exists.
   */
  BUBBLE_SPAWN_CLEARANCE: 4,

  // ---------------------------------------------------------------- monsters [i]
  // Per-kind speeds, climb rates and projectiles live in data/roster.ts — they are the
  // roster's shape, not loose constants. Only what every monster shares is here.
  /** Multiplier applied to a kind's climb chance once it is angry. */
  ANGRY_CLIMB_MULTIPLIER: 2.5,
  /** Frames a hopper spends grounded between hops. */
  HOP_INTERVAL: 26,
  /** How far a flier drifts vertically per frame while sweeping. */
  FLOAT_AMPLITUDE: 0.35,
  FLOAT_PERIOD: 150,

  // ---------------------------------------------------------------- projectiles [i]
  PROJECTILE_HALF: 3,
  /** Upward kick on a lobbed bottle, so it clears the thrower's own tier. */
  BOTTLE_LAUNCH_SPEED: 1.9,
  /** A monster will not throw unless the player is roughly on its level — otherwise
   *  flat shots are fired uselessly at the ceiling all room. */
  THROW_ALIGN_WU: 24,

  // ---------------------------------------------------------------- room clock [i]
  /** Frames before HURRY UP flashes. */
  ROOM_TIMER: 1800,
  /** Frames between HURRY UP and the Baron entering. */
  BARON_DELAY: 600,
  /**
   * The Baron closes at BARON_SPEED_START and gains BARON_ACCEL every frame until it
   * caps. Tuned so a competent player has roughly 20–30 seconds before it becomes
   * genuinely unsurvivable — long enough to finish a room you were nearly done with,
   * short enough that camping is never the answer. DESIGN.md §8.4.
   */
  BARON_HALF: 7,
  BARON_SPEED_START: 0.35,
  BARON_SPEED_MAX: 3.2,
  BARON_ACCEL: 0.0022,

  // ---------------------------------------------------------------- scoring
  /** Chain pops are exponential: 2^(n-1) * BASE. This single curve is why the game is
   *  really about herding — see DESIGN.md §3.8. */
  CHAIN_BASE: 1000,
  STARTING_LIVES: 3,

  // ---------------------------------------------------------------- items [i]
  /** Frames a dropped pickup survives before fading. Long enough to chase one down
   *  through the vertical wrap, short enough that a room does not silt up. */
  PICKUP_LIFETIME: 600,
  PICKUP_FRICTION: 0.82,
  /** Fruit value climbs on the same curve as the chain that dropped it — the corpses
   *  are half the reward, and a player who never chains never sees the expensive ones. */
  FRUIT_BASE: 500,
  FRUIT_MAX: 6000,
  /** Sideways kick on fruit as it drops, so a chain scatters rather than stacking. */
  FRUIT_SCATTER: 0.9,

  /** How much fruit a potion rains across the room. */
  POTION_FRUIT_COUNT: 14,
  /** How long a clock holds the monsters still. */
  CLOCK_FREEZE_FRAMES: 480,
  /** How long a heart makes the player untouchable. */
  HEART_INVULN_FRAMES: 600,
  /** Points a ring pays per jump / per bubble popped / per step taken. */
  RING_JUMP_POINTS: 500,
  RING_POP_POINTS: 100,
  RING_STEP_POINTS: 10,
  /** EXTEND letters dropped, indexed by monsters popped in one chain. Index 0 and 1
   *  are unreachable (you cannot chain fewer than one) but keep the table 1:1 with n. */
  EXTEND_LETTERS: [0, 0, 0, 1, 2, 3, 4, 5, 6] as const,
  EMPTY_BUBBLE_POP: 10,
} as const;

/** Room dimensions in world units, derived not duplicated. */
export const ROOM_W = T.TILE * T.GRID_W;
export const ROOM_H = T.TILE * T.GRID_H;
