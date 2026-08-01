/**
 * The single source of truth for every gameplay number.
 *
 * RULE: no other module in src/game/ may contain a magic gameplay constant.
 * RULE: nothing in this file below "world space" may be expressed in screen pixels.
 *
 * Values tagged [i] are *inferred* reconstructions, not sourced facts. See DESIGN.md §13
 * for the measurement pass that is meant to replace them.
 */

export const T = {
  // ---------------------------------------------------------------- world space (wu)
  // Never change these. They define the simulation's units.
  TILE: 16,
  /** Level size in tiles.
   *
   *  Raised from 32 after playtesting: at 32 a level is barely two screens across, which
   *  is not a dungeon, it is a room. At 48 it is a bit over three screens each way, so
   *  the maze has somewhere to hide things and a generator on the far side is a genuine
   *  second front rather than something you can already see. */
  GRID: 48,
  WORLD: 768, // TILE * GRID

  /** Gameplay viewport in world units. LOCKED — see DESIGN.md §6.1.
   *  Off-screen generators are inert and potions are viewport-scoped, so this is a
   *  gameplay constant that merely looks like a presentation one. */
  VIEW_W: 232,
  VIEW_H: 240,

  STEP_HZ: 60,

  // ---------------------------------------------------------------- presentation only
  // Safe to change. Guarded by the ART_SCALE-invariance test (tests/scale.test.ts).
  ART_SCALE: 2, // screen px per world unit at S=1 (32px art per 16wu block)
  SCREEN_SCALE_MIN: 1,
  SCREEN_SCALE_MAX: 3,

  // ---------------------------------------------------------------- input
  FIRE_FEATHER_FRAMES: 6, // Feathered fire model grace window
  PAD_DEADZONE: 0.35,
  PAD_HYSTERESIS: 0.1,
  PAD_TRIGGER_THRESHOLD: 0.5,

  // ---------------------------------------------------------------- movement
  SPEED_UNIT: 0.5, // [i] wu/frame per point of the 1..5 speed stat
  /** [i] false = full speed on each axis (diagonals are ~1.41x faster), which is what the
   *  simplest 68010-era implementation does and what most arcade games of the period did.
   *  Flagged for the fidelity pass — it materially changes optimal movement. */
  DIAGONAL_NORMALISE: false,

  CORNER_ASSIST: 5, // [i] wu — max misalignment that still rounds a corner
  CORNER_ASSIST_SPEED: 0.5, // [i] wu/frame of perpendicular nudge

  // ---------------------------------------------------------------- collision boxes (wu)
  PLAYER_HALF: 6, // 12x12
  MONSTER_HALF: 6,
  DEATH_HALF: 7,
  ITEM_HALF: 8,
  SHOT_HALF: { small: 1, medium: 3, large: 6 }, // [i]
  /** Largest shot half-size that can thread the corner where two diagonally adjacent
   *  wall blocks meet. Small (Elf) and Medium (Valkyrie, Wizard) pass; Large (Warrior)
   *  does not — the signature "attack from behind cover" asymmetry. [i] */
  CORNER_SQUEEZE_MAX: 3,
  /** Shots live at most this long, so one that escapes down a corridor still frees the
   *  one-shot-on-screen slot. [i] */
  SHOT_LIFETIME_F: 240,

  // ---------------------------------------------------------------- health
  START_HEALTH: 700,
  CONTINUE_HEALTH: 700,
  HEALTH_DRAIN_PER_SEC: 1,
  FOOD_HEALTH: 100,
  LOW_HEALTH_WARN: 200,
  CRITICAL_HEALTH: 100,

  INVENTORY_SLOTS: 12,

  // ---------------------------------------------------------------- combat  (M1+)
  SHOT_SPEED_UNIT: 1.0, // [i] wu/frame per point of the 1..5 shot-speed stat
  MELEE_PERIOD: 8, // [i] frames
  /** How far past your own edge a swing lands, in wu.
   *
   *  This replaces a [20, 12] box that was centred on the PLAYER and tested per-axis,
   *  which made melee a 32wu square reaching equally far behind and to the sides — two
   *  full tiles wide, facing ignored. Anything that wandered adjacent died, including
   *  through a sealed diagonal corner. 14 reaches something you are touching or one tile
   *  directly ahead, and not a diagonal two steps away. [i] */
  MELEE_REACH: 14,
  /** Minimum cos(angle) between facing and the target for a swing to connect.
   *  0.35 is about ±69°, so the facing octant and its two neighbours. [i] */
  MELEE_ARC_COS: 0.35,
  MONSTER_ATTACK_PERIOD: 20, // [i] frames

  GHOST_DMG: [10, 20, 30] as const,
  MELEE_DMG: [5, 8, 10] as const,
  FIREBALL_DMG: 10,
  ROCK_DMG: 3,
  THIEF_DMG: 10,
  DEATH_TOTAL_DRAIN: 200,
  DEATH_DRAIN_PER_FRAME: 4, // [i]

  MONSTER_HP_BY_LEVEL: [1, 2, 3] as const, // [i]
  GEN_HP_BY_LEVEL: [1, 2, 3] as const,

  MONSTER_CAP_TOTAL: 90, // [i]
  MONSTER_CAP_LOCAL: 6, // [i]
  GEN_OFFSCREEN_MARGIN: 8, // [i] wu
  GEN_PERIOD_BASE: [150, 110, 75] as const, // [i] frames by generator level
  GEN_PERIOD_DEPTH_SCALE: 0.995, // [i]

  // ---------------------------------------------------------------- terrain timers (sec)
  /** Doors give up only on a genuine stalemate.
   *
   *  The clock counts frames since the player last *engaged* — fired, was hit, dealt
   *  damage, took something. Exploring does none of those, so at the old 18s a player
   *  simply hunting for the key watched every locked door swing open on its own, which
   *  reads as the mechanic being broken rather than merciful. 90 seconds without firing
   *  a shot or touching anything is a real stalemate; 18 was just walking. [i] */
  DOOR_AUTO_OPEN_SEC: 90,
  DOOR_AUTO_OPEN_SEC_WITH_KEYS: 180,
  WALLS_BECOME_EXITS_SEC: 180,
  INVISIBILITY_SEC: 20,

  /** Frames the exit sequence runs before the next level loads.
   *
   *  Long enough to read as an event rather than a cut, short enough that a good player
   *  clearing forty levels does not spend a minute of the run watching it. It is part of
   *  the SIMULATION, not the presentation: the level is over the moment you touch the
   *  exit, and nothing may hurt you during it. */
  EXIT_SEQUENCE_F: 78,

  SORCERER_VISIBLE_F: 90, // [i]
  SORCERER_INVISIBLE_F: 60, // [i]
  LOBBER_FLEE_BLOCKS: 3, // [i]
  LOBBER_COOLDOWN_F: 90, // [i]
  DEMON_FIRE_COOLDOWN_F: 75, // [i]
  DEMON_RANGE_WU: 160, // [i]
  /** How closely a demon must be lined up on an axis before it fires. It ignores walls
   *  entirely, which is what lets you train its fire onto a generator. [i] */
  DEMON_ALIGN_WU: 10,
  /** Rocks arc: flight time scales with distance, and they ignore walls until they land. */
  LOBBER_FLIGHT_MIN_F: 24, // [i]
  LOBBER_FLIGHT_PER_WU: 0.18, // [i]
  THIEF_SPEED: 2.2, // [i] wu/frame — must outrun every class but an upgraded Elf
  THIEF_PATIENCE_F: 60 * 45, // [i]
  THIEF_SCORE_THEFT: 1000, // [i]
  DEATH_SPEED: 0.55, // [i] slow but relentless
  TELEPORT_COOLDOWN_F: 30,
  /** Treasure rooms are on a clock: grab what you can and get out. [i] */
  TREASURE_ROOM_SEC: 30,

  // ---------------------------------------------------------------- scoring
  SCORE: {
    ghostPerLevel: 10,
    monsterPerLevel: 5,
    meleeKill: 25,
    magicKill: 10,
    generatorPerLevel: 50, // [i]
    food: 100,
    key: 100,
    treasure: 100,
    jewelBag: 500,
    thiefShot: 500,
    deathShot: 1,
    deathPotionCycle: [1000, 2000, 1000, 4000, 2000, 6000, 8000] as const,
    treasureRoomPerTreasure: 50,
  },

  RANK_ZERO_FOOD_SCORE: 300_000,
  RANK_MIN_FOOD_RATIO: 0.15,
  /**
   * Absolute floor on food pieces per level, whatever the rank curve says.
   *
   * The ratio alone is a proportion of what the level holds, so halving the campaign's
   * food halved the late-game floor with it: a rich run on a level with four pieces kept
   * ceil(4 x 0.15) = 1. One piece of food on a level is not a difficulty curve, it is a
   * coin flip on whether you happen to walk past it. This is the "some food, always"
   * guarantee — the ratio decides the shape, this decides the bottom. [i]
   */
  RANK_MIN_FOOD_ITEMS: 2,
} as const;

/** Convenience: the camera's clamp range, derived not duplicated. */
export const CAM_MAX_X = T.WORLD - T.VIEW_W;
export const CAM_MAX_Y = T.WORLD - T.VIEW_H;
