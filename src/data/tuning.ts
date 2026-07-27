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
  GRID: 32,
  WORLD: 512, // TILE * GRID

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
  MELEE_BOX: [20, 12] as const, // [i] wu
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
  DOOR_AUTO_OPEN_SEC: 18,
  DOOR_AUTO_OPEN_SEC_WITH_KEYS: 36,
  WALLS_BECOME_EXITS_SEC: 180,
  INVISIBILITY_SEC: 20,

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
} as const;

/** Convenience: the camera's clamp range, derived not duplicated. */
export const CAM_MAX_X = T.WORLD - T.VIEW_W;
export const CAM_MAX_Y = T.WORLD - T.VIEW_H;
