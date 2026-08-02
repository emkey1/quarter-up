/**
 * Config the engine needs, injected rather than imported.
 *
 * Bracer's engine/ reaches up into `@/data/tuning` from six files. That is a shallow
 * coupling but it is the wrong direction — it pins a generic layer to one game's
 * constants table, and it is exactly what would have to be undone to share this code.
 * So it gets undone here, at copy time, while it costs nothing. See packages/README.md.
 *
 * Nothing in engine/ may import from data/, game/, render/ or ui/.
 */

export interface DisplayConfig {
  /** Gameplay viewport in world units. */
  viewW: number;
  viewH: number;
  /** Screen px per world unit at scale 1. */
  artScale: number;
  scaleMin: number;
  scaleMax: number;
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
