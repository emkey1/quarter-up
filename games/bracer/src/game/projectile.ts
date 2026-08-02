import { T } from '@/data/tuning';
import type { Terrain } from './terrain';

export type ProjectileKind = 'shot' | 'fireball' | 'rock';

export interface Projectile {
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Half-extent. Drives both wall behaviour and how wide the hit cone is. */
  half: number;
  damage: number;
  fromPlayer: boolean;
  alive: boolean;
  life: number;
  /**
   * Rocks only: frames of flight remaining. While this is above zero the rock is in the
   * air and terrain is ignored entirely — that is the whole point of a lobber, and the
   * reason they can shell you from behind a wall you cannot shoot through.
   */
  flight: number;
  /** Render-only arc height, 0..1. Never read by the simulation. */
  z: number;
  /** Flight length at launch, for the arc shape. */
  launchFlight: number;
  /**
   * Who fired this. A projectile spawns inside its own shooter, so without an owner to
   * skip, a demon's fireball hits the demon on frame one and never reaches anything.
   */
  owner: object | null;
}

export interface ShotMoveResult {
  hitWall: boolean;
  /** Where it stopped, for the impact effect. */
  x: number;
  y: number;
}

/**
 * Move a projectile and resolve it against walls.
 *
 * This is where Gauntlet's signature cover mechanic lives. Two diagonally adjacent wall
 * blocks leave a corner that a *diagonal* shot can thread — small and medium shots pass,
 * large ones do not, and monsters (12wu boxes moving by AABB) never can. That asymmetry
 * is what makes the Elf and Wizard able to snipe generators from safety while the
 * Warrior has to walk into the room.
 *
 * Note this only works for diagonal travel. An orthogonal shot running along a grid seam
 * is always stopped by one of the two blocks regardless of size — which is why shots
 * here are 8-directional, matching the 8-way facing.
 *
 * Wall tests use the projectile's *centre* cell rather than its full box, so size
 * affects corner-threading through CORNER_SQUEEZE_MAX rather than through raw overlap.
 */
export function moveProjectile(terrain: Terrain, p: Projectile): ShotMoveResult {
  // A rock in flight is above the maze; it lands where it lands.
  if (p.flight > 0) {
    p.x += p.vx;
    p.y += p.vy;
    p.flight--;
    const t = p.flight / Math.max(1, p.launchFlight);
    p.z = 4 * t * (1 - t); // parabola peaking mid-flight
    if (p.flight <= 0) {
      p.z = 0;
      return { hitWall: true, x: p.x, y: p.y }; // "hitWall" here means "landed"
    }
    return { hitWall: false, x: p.x, y: p.y };
  }

  const dist = Math.hypot(p.vx, p.vy);
  const steps = Math.max(1, Math.ceil(dist / 2)); // never skip a cell
  const sx = p.vx / steps;
  const sy = p.vy / steps;

  for (let i = 0; i < steps; i++) {
    const px = p.x;
    const py = p.y;
    const pcx = Math.floor(px / T.TILE);
    const pcy = Math.floor(py / T.TILE);

    p.x += sx;
    p.y += sy;

    const cx = Math.floor(p.x / T.TILE);
    const cy = Math.floor(p.y / T.TILE);
    if (cx === pcx && cy === pcy) continue;

    if (terrain.shotBlockedAtCell(cx, cy)) {
      p.x = px;
      p.y = py;
      return { hitWall: true, x: px, y: py };
    }

    if (cx !== pcx && cy !== pcy) {
      // Diagonal cell transition: we are cutting the corner between two cells.
      const a = terrain.shotBlockedAtCell(cx, pcy);
      const b = terrain.shotBlockedAtCell(pcx, cy);
      if (a && b && p.half > T.CORNER_SQUEEZE_MAX) {
        // Both flanks solid and the shot is too fat to squeeze through the gap.
        p.x = px;
        p.y = py;
        return { hitWall: true, x: px, y: py };
      }
    }
  }

  p.life--;
  if (p.life <= 0) return { hitWall: true, x: p.x, y: p.y };
  return { hitWall: false, x: p.x, y: p.y };
}

/** AABB overlap between a projectile and a body. Larger shots get a wider hit cone —
 *  the one compensation the Warrior's Large shot receives. */
export function projectileHits(p: Projectile, x: number, y: number, half: number): boolean {
  const r = p.half + half;
  return Math.abs(p.x - x) < r && Math.abs(p.y - y) < r;
}

/**
 * Can a projectile at (px,py) legitimately damage a target at (tx,ty)?
 *
 * Overlap alone is not enough. A shot stopped against a wall still sits within its own
 * hit radius of a target in the diagonally adjacent cell — so a fat shot would damage a
 * generator straight through the corner it was just blocked by, silently erasing the
 * cover mechanic. Reachability has to follow the same corner rule that movement does.
 *
 * Only adjacent-diagonal cases are considered, which is sufficient: anything further
 * away was already stopped during travel.
 */
export function projectileCanReach(
  terrain: { shotBlockedAtCell(cx: number, cy: number): boolean },
  p: Projectile,
  tx: number,
  ty: number,
  tile: number,
  squeezeMax: number,
): boolean {
  const fcx = Math.floor(p.x / tile);
  const fcy = Math.floor(p.y / tile);
  const tcx = Math.floor(tx / tile);
  const tcy = Math.floor(ty / tile);
  if (fcx === tcx || fcy === tcy) return true; // same row or column: nothing to squeeze past

  const a = terrain.shotBlockedAtCell(tcx, fcy);
  const b = terrain.shotBlockedAtCell(fcx, tcy);
  if (a && b) return p.half <= squeezeMax;
  return true;
}

export function makeShot(
  x: number,
  y: number,
  dx: number,
  dy: number,
  speed: number,
  half: number,
  damage: number,
  fromPlayer: boolean,
  kind: ProjectileKind = 'shot',
  owner: object | null = null,
): Projectile {
  // Normalise so a diagonal shot is not 1.41x faster than an orthogonal one.
  const len = Math.hypot(dx, dy) || 1;
  return {
    kind,
    x,
    y,
    vx: (dx / len) * speed,
    vy: (dy / len) * speed,
    half,
    damage,
    fromPlayer,
    alive: true,
    life: T.SHOT_LIFETIME_F,
    flight: 0,
    launchFlight: 0,
    z: 0,
    owner,
  };
}

/**
 * A lobbed rock.
 *
 * Aimed at where the target *will be* if it keeps going straight — the lead prediction
 * that makes lobbers feel like they are reading you, and that skilled players exploit by
 * moving erratically, or by walking a straight line that ends at a generator so the rock
 * lands on it instead.
 */
export function makeRock(
  x: number,
  y: number,
  targetX: number,
  targetY: number,
  targetVX: number,
  targetVY: number,
  damage: number,
  owner: object | null = null,
): Projectile {
  const dist = Math.hypot(targetX - x, targetY - y);
  const flight = Math.max(T.LOBBER_FLIGHT_MIN_F, Math.round(dist * T.LOBBER_FLIGHT_PER_WU));
  const leadX = targetX + targetVX * flight;
  const leadY = targetY + targetVY * flight;
  return {
    kind: 'rock',
    x,
    y,
    vx: (leadX - x) / flight,
    vy: (leadY - y) / flight,
    half: 5,
    damage,
    fromPlayer: false,
    alive: true,
    life: T.SHOT_LIFETIME_F,
    flight,
    launchFlight: flight,
    z: 0,
    owner,
  };
}
