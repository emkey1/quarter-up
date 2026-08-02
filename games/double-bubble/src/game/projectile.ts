import { T } from '@/data/tuning';
import type { ProjectileKind, ProjectileSpec } from '@/data/roster';
import { isFloor, tileAt, type RoomData } from './room';

/**
 * Things monsters throw.
 *
 * Three flavours across the roster, differing in speed and whether they arc: Mighta's
 * slow boulder, Hidegons' fast fireball, and the Drunk's lobbed bottle. The arc is the
 * interesting one — a flat shot is answered by standing on a different tier, and a
 * lobbed one takes that answer away.
 */
export interface Projectile {
  id: number;
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  half: number;
  arcs: boolean;
  life: number;
  dead: boolean;
}

let nextId = 1;

/** Reset the id counter. Tests only. */
export function resetProjectileIds(): void {
  nextId = 1;
}

export function spawnProjectile(
  spec: ProjectileSpec,
  x: number,
  y: number,
  dir: -1 | 1,
): Projectile {
  return {
    id: nextId++,
    kind: spec.kind,
    x,
    y,
    vx: spec.speed * dir,
    // A lobbed bottle leaves the hand rising, so it clears the thrower's own tier.
    vy: spec.arcs ? -T.BOTTLE_LAUNCH_SPEED : 0,
    half: T.PROJECTILE_HALF,
    arcs: spec.arcs,
    life: spec.life,
    dead: false,
  };
}

const tileOf = (wu: number): number => Math.floor(wu / T.TILE);

export function stepProjectile(room: RoomData, p: Projectile): void {
  if (p.arcs) p.vy = Math.min(p.vy + T.GRAVITY, T.FALL_SPEED_MAX);

  p.x += p.vx;
  p.y += p.vy;

  if (--p.life <= 0) {
    p.dead = true;
    return;
  }

  // Solid geometry stops everything. Platforms stop only a falling arc — a flat shot
  // passes over a platform's lip the same way it passes through open air, and a bottle
  // shatters on the tier it lands on.
  const tx = tileOf(p.x);
  const ty = tileOf(p.y);
  const t = tileAt(room, tx, ty);
  if (t === 1 /* Solid */) {
    p.dead = true;
    return;
  }
  if (p.arcs && p.vy > 0 && isFloor(t)) {
    p.dead = true;
    return;
  }

  // Off the sides or out of the room entirely.
  if (p.x < 0 || p.x > T.VIEW_W || p.y > T.VIEW_H + T.TILE) p.dead = true;
}

export function projectileHits(
  p: Projectile,
  x: number,
  y: number,
  halfW: number,
  halfH: number,
): boolean {
  return Math.abs(p.x - x) < p.half + halfW && Math.abs(p.y - y) < p.half + halfH;
}
