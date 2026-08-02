import { T, ROOM_W } from '@/data/tuning';

/**
 * Baron von Blubba — the hurry-up chaser.
 *
 * Invincible. Cannot be bubbled, cannot be killed, and leaves only when the room is
 * cleared or the player dies. It ignores every wall, floor and ceiling in the room and
 * closes on one axis at a time, faster and faster, until something gives.
 *
 * The design intent is anti-camping, and the feel it has to hit is *inexorable* rather
 * than merely dangerous — DESIGN.md §3.7. Nothing about it is a fight; it is a clock
 * that has noticed you.
 *
 * One documented deviation: the original steps at discrete timed intervals, which at
 * 60fps reads as a stutter. This closes continuously along one axis at a time, which
 * preserves what matters — axis-locked, geometry-ignoring, always accelerating — and
 * looks like motion rather than a slideshow.
 */
export interface Baron {
  x: number;
  y: number;
  half: number;
  /** Current closing speed in wu/frame, ramping from BARON_SPEED_START. */
  speed: number;
  /** Which axis it is currently closing on. Re-chosen when it lines up on that axis. */
  axis: 'x' | 'y';
  /** Frames since it entered, for the HUD and for tests. */
  age: number;
}

/**
 * Enter from the nearest side wall, level with the player.
 *
 * From the side rather than above: a Baron that drops onto your head gives no reaction
 * time at all, and the threat is meant to be the closing distance rather than the
 * arrival.
 */
export function spawnBaron(playerX: number, playerY: number): Baron {
  const fromLeft = playerX > ROOM_W / 2;
  return {
    x: fromLeft ? -T.BARON_HALF : ROOM_W + T.BARON_HALF,
    y: playerY,
    half: T.BARON_HALF,
    speed: T.BARON_SPEED_START,
    axis: 'x',
    age: 0,
  };
}

/** Below this the axis counts as lined up and it switches to the other one. */
const ALIGNED = 2;

export function stepBaron(b: Baron, playerX: number, playerY: number): void {
  b.age++;
  b.speed = Math.min(T.BARON_SPEED_MAX, b.speed + T.BARON_ACCEL);

  const dx = playerX - b.x;
  const dy = playerY - b.y;

  // Switch axes once this one is close enough to be pointless, so it never jitters
  // around a target it has already matched.
  if (b.axis === 'x' && Math.abs(dx) < ALIGNED) b.axis = 'y';
  else if (b.axis === 'y' && Math.abs(dy) < ALIGNED) b.axis = 'x';

  if (b.axis === 'x') {
    b.x += Math.sign(dx) * Math.min(b.speed, Math.abs(dx));
  } else {
    b.y += Math.sign(dy) * Math.min(b.speed, Math.abs(dy));
  }
}

export function baronHits(
  b: Baron,
  x: number,
  y: number,
  halfW: number,
  halfH: number,
): boolean {
  return Math.abs(b.x - x) < b.half + halfW && Math.abs(b.y - y) < b.half + halfH;
}
