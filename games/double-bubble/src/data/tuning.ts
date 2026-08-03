/**
 * The single source of truth for every gameplay number.
 *
 * RULE: no other module in src/game/ may contain a magic gameplay constant.
 * RULE: nothing below "world space" may be expressed in screen pixels.
 *
 * Values tagged [i] are *inferred* reconstructions, not sourced facts. No usable
 * disassembly of the arcade original exists — the well-documented reverse engineering is
 * of the Commodore 64 port, which is different programmers reimplementing the game and
 * therefore worthless as a reference for these numbers. Nobody has published frame counts
 * either. So the M1 measurement pass stays open, and [i] stays.
 *
 * But [i] was doing too much work as a single tag: it made a value fixed by the hardware
 * look as uncertain as one picked by feel. The grades below say where each number
 * actually comes from, so the fidelity pass can start with the ones that are actually
 * free rather than re-deriving the ones that are not:
 *
 *   [hw]   Fixed by the original hardware. 8px tiles, a 256x224 playfield, 60Hz. Not
 *          open to revision — changing one makes this a different game.
 *   [der]  Follows arithmetically from a [hw] value or another constant. Check the
 *          derivation, not the number.
 *   [con]  Constrained: a range of values would play fine, but something in the game
 *          fails outside that range, and a test pins the constraint. BUBBLE_LIFETIME is
 *          the worked example — see its note.
 *   [i]    Genuinely free. Chosen by feel, defensible, unverified. THESE are what the
 *          measurement pass is for.
 *
 * What every physics constant means in countable units — tiles, frames, seconds — is in
 * tests/observables.test.ts, expressed the way a frame-stepped clip yields them. That is
 * the file to check footage against; `solveJump()` in game/physics.ts turns a corrected
 * count straight back into JUMP_VELOCITY and GRAVITY.
 */

export const T = {
  // ------------------------------------------------------- world space (wu) [hw]
  // Never change these. They define the simulation's units.
  /** One world unit is one original-hardware pixel. Tiles are 8x8 there, so 8 here. */
  TILE: 8,
  /** Room size in tiles. 32x28 at 8px is the arcade playfield, 256x224. */
  GRID_W: 32,
  GRID_H: 28,

  /** The room IS the viewport — single screen, no scrolling, no camera. */
  VIEW_W: 256, // [der] TILE * GRID_W
  VIEW_H: 224, // [der] TILE * GRID_H

  STEP_HZ: 60, // [hw] the original's refresh; the whole simulation is keyed to it

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

  // ----------------------------------------------------------- movement [i]
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

  // -------------------------------------------------- collision boxes (wu) [i]
  PLAYER_HALF_W: 6,
  PLAYER_HALF_H: 7,
  MONSTER_HALF: 6,
  BUBBLE_RADIUS: 8,
  ITEM_HALF: 6,

  // ------------------------------------------------ bubbles [i], except as noted
  /** Fired horizontally at this speed, decelerating to zero over BUBBLE_FIRE_FRAMES,
   *  after which the bubble rises and joins the room's drift current. */
  BUBBLE_FIRE_SPEED: 3.0,
  BUBBLE_FIRE_FRAMES: 22,
  /** Purple sweet: bubbles travel *further*, not faster — more frames of push, same
   *  speed, so the arc a player has learned to aim still holds. */
  BUBBLE_FIRE_FRAMES_FAR: 32,
  /**
   * How fast a free bubble rises. [i] — and the single most load-bearing free number
   * here, since BUBBLE_LIFETIME is now derived from how long a climb at this speed takes.
   * Measure this one first.
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
  /**
   * Frames an empty bubble survives before popping itself. [con]
   *
   * Not a free number, and not the 600 it was. A bubble has to outlive its own climb:
   * blown from where the player spawns, it rises until something stops it, and only then
   * can a cluster be built around it. Measured against the actual hundred rooms, the
   * climb takes a median 159 frames — but seven rooms take 626–650, and at 600 frames a
   * bubble in those rooms popped before it ever joined a pool. In 7% of the campaign the
   * exponential chain curve, which DESIGN.md §3.8 calls the point of the game, was
   * unreachable from the standard spawn.
   *
   * Derived rather than measured, and the derivation is the worst case plus what you
   * then need to do with it: 650 to settle, 72 to blow a five-cluster (4 * COOLDOWN),
   * ~60 to reposition and pop it = 782, rounded up for margin. tests/observables.test.ts
   * checks all hundred rooms against it, so a room generator change that slows the climb
   * fails the build rather than quietly killing the scoring in a few rooms.
   *
   * The other knob would have been a faster rise. Lifetime is the right one to move:
   * BUBBLE_RISE_SPEED is tuned by eye against riding and the wobble, and this is tuned
   * against nothing else at all.
   */
  BUBBLE_LIFETIME: 840,
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

  // ----------------------------------------------------------- monsters [i]
  // Per-kind speeds, climb rates and projectiles live in data/roster.ts — they are the
  // roster's shape, not loose constants. Only what every monster shares is here.
  /** Multiplier applied to a kind's climb chance once it is angry. */
  ANGRY_CLIMB_MULTIPLIER: 2.5,
  /** Frames a hopper spends grounded between hops. */
  HOP_INTERVAL: 26,
  /** How far a flier drifts vertically per frame while sweeping. */
  FLOAT_AMPLITUDE: 0.35,
  FLOAT_PERIOD: 150,

  // -------------------------------------------------------- projectiles [i]
  PROJECTILE_HALF: 3,
  /** Upward kick on a lobbed bottle, so it clears the thrower's own tier. */
  BOTTLE_LAUNCH_SPEED: 1.9,
  /** A monster will not throw unless the player is roughly on its level — otherwise
   *  flat shots are fired uselessly at the ceiling all room. */
  THROW_ALIGN_WU: 24,

  // --------------------------------------------------------- room clock [i]
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
  /** Super Mode is the same hundred rooms run faster, so one dial rather than a second
   *  tuning table. See DESIGN.md §4. */
  SUPER_MODE_SPEED: 1.35,
  /** How long the between-rooms card is held. Long enough to read, short enough that
   *  a run of forty rooms is not mostly card. */
  INTERLUDE_FRAMES: 90,

  // -------------------------------------------------------------- items [i]
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

  // ---------------------------------------------------- special bubbles [i]
  /** Frames between special bubbles drifting into a room that offers them. */
  SPECIAL_INTERVAL: 540,
  /** Most a room will hold at once, so a long stall does not fill the screen. */
  SPECIAL_MAX: 2,
  /** Specials linger far longer than an ordinary bubble — they are an opportunity, and
   *  one that evaporates before you can set it up is just a tease. */
  SPECIAL_BUBBLE_LIFETIME: 1500,

  WATER_DROPS: 10,
  WATER_HALF: 3,
  WATER_FALL_SPEED: 2.4,
  WATER_FLOW_SPEED: 1.5,
  WATER_LIFETIME: 260,

  LIGHTNING_HALF: 4,
  LIGHTNING_SPEED: 5.5,
  LIGHTNING_LIFETIME: 90,

  FIRE_DROPS: 3,
  FIRE_HALF: 5,
  FIRE_FALL_SPEED: 2.2,
  FIRE_LIFETIME: 300,

  /**
   * What a monster killed by each element is worth.
   *
   * Far above a chain kill, and rising water < lightning < fire, exactly as the original
   * had it. The point is that special bubbles are not a safety net — they are the
   * highest-scoring way to clear a room, so using one well is a skill rather than a
   * mercy.
   */
  DIAMOND_WATER: 7000,
  DIAMOND_LIGHTNING: 8000,
  DIAMOND_FIRE: 9000,

  /** How much fruit a potion rains across the room. */
  POTION_FRUIT_COUNT: 14,
  /** How long a clock holds the monsters still. */
  CLOCK_FREEZE_FRAMES: 480,
  /** Grace period after respawning. Losing a life must never cost you the next one. */
  RESPAWN_INVULN_FRAMES: 120,

  // ---------------------------------------------------------------- the boss [i]
  /** Four tiles across — unmistakably not another monster. */
  BOSS_HALF: 16,
  /**
   * Lightning hits to bring it down.
   *
   * Eight is deliberately a lot when lightning is the rarest special: the fight is an
   * exam on the one mechanic a player is least likely to have practised, so it has to
   * last long enough to actually test it rather than being ended by one lucky bolt.
   */
  BOSS_HP: 8,
  BOSS_SPEED: 0.62,
  BOSS_THROW_COOLDOWN: 96,
  /** Shortest gap between bottles, reached as the health bar empties. */
  BOSS_THROW_MIN: 34,
  BOSS_HIT_FLASH: 22,
  /** How long it stays held once beaten down. Miss the window and the fight resumes —
   *  which is what stops the last hit being a formality. */
  BOSS_BUBBLE_FRAMES: 300,
  /** It never comes below this row, so the player always has ground to work from. */
  BOSS_FLOOR_ROW: 18,
  /** What the cave is worth. Deliberately enormous — it is the last thing you do. */
  BOSS_SCORE: 100000,
  /** How long a heart makes the player untouchable. */
  HEART_INVULN_FRAMES: 600,
  /** Points a ring pays per jump / per bubble popped / per step taken. */
  RING_JUMP_POINTS: 500,
  RING_POP_POINTS: 100,
  RING_STEP_POINTS: 10,
  /** EXTEND letters dropped, indexed by monsters popped in one chain. Index 0 and 1
   *  are unreachable (you cannot chain fewer than one) but keep the table 1:1 with n. */
  EXTEND_LETTERS: [0, 0, 0, 1, 2, 3, 4, 5, 6] as const,
  /** Points for bursting a bubble with nothing in it.
   *
   *  Raised from 10 on a player's recollection of the original. Neither number is
   *  sourced: the design's scoring section documents the exponential monster curve and
   *  the EXTEND table in detail and says nothing about empty bubbles, so 10 was a guess
   *  too. Flagged for the fidelity pass rather than quietly settled. [i] */
  EMPTY_BUBBLE_POP: 50,
} as const;

/** Room dimensions in world units, derived not duplicated. */
export const ROOM_W = T.TILE * T.GRID_W;
export const ROOM_H = T.TILE * T.GRID_H;
