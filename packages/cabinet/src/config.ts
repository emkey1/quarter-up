/**
 * Everything the cabinet needs to know about the game it is running, injected.
 *
 * The engine layer must not import from any game. Both games keep their constants in a
 * `data/tuning.ts`, and the temptation is for the loop to just read `T.STEP_HZ` from it
 * — Bracer's copy did exactly that, from six files. It is a shallow coupling but the
 * wrong direction, and it is precisely what had to be undone to share the code. So it is
 * inverted: the game hands its numbers to the constructor.
 *
 * Nothing in this package may import from a game's data/, game/, render/ or ui/.
 */

export interface DisplayConfig {
  /** Gameplay viewport in world units. */
  viewW: number;
  viewH: number;
  /** Screen px per world unit at scale 1. */
  artScale: number;
  scaleMin: number;
  scaleMax: number;
  /**
   * Keep a right-hand flank even when the window is too narrow for one to be useful.
   *
   * The two games differ here and neither is wrong. Double Bubble drops both flanks and
   * the caller falls back to an overlay. Bracer's status panel — health, score, keys,
   * potions — has no such fallback, so dropping it would leave the player with no
   * readout at all; it would rather draw a cramped one. Left flanks always drop.
   */
  keepRightPanel: boolean;
}

export interface LoopConfig {
  stepHz: number;
}

export interface PadConfig {
  /** Stick magnitude at which a direction engages. */
  deadzone: number;
  /** Release band and angular latch margin, so a resting thumb cannot strobe. */
  hysteresis: number;
  /** Analog button value counted as a press. */
  triggerThreshold: number;
}
