import { T, ROOM_H, ROOM_W } from '@/data/tuning';
import { isBlocking, isFloor, tileAt, type RoomData } from './room';

/**
 * What comes out of a special bubble.
 *
 * Three effects, three completely different shapes of threat, and that is the point —
 * each one answers a different way of hiding. Water goes where the geometry goes and
 * finds you on your tier. Lightning goes straight and finds you across the room. Fire
 * stays put and denies you a place to stand.
 */

const tileOf = (wu: number): number => Math.floor(wu / T.TILE);

/* ------------------------------------------------------------------ water */

/**
 * A running droplet.
 *
 * Water is the one genuinely novel system here (DESIGN.md §8.5) and it is modelled as a
 * stream of droplets rather than as a filled volume. A volume needs a flood fill every
 * frame and produces a hard-edged blob; a stream falls, spreads along whatever surface
 * it lands on, pours off the ends, and splits at the edges — which is what water
 * actually looks like on a platform, and it costs a few floats per drop.
 */
export interface Drop {
  id: number;
  x: number;
  y: number;
  dir: -1 | 1;
  falling: boolean;
  life: number;
  dead: boolean;
}

export interface Bolt {
  id: number;
  x: number;
  y: number;
  dir: -1 | 1;
  life: number;
  dead: boolean;
}

export interface Flame {
  id: number;
  x: number;
  y: number;
  falling: boolean;
  life: number;
  dead: boolean;
}

let nextId = 1;

/** Reset the id counter. Tests only. */
export function resetSpecialIds(): void {
  nextId = 1;
}

/**
 * A burst of water spreading from where the bubble popped.
 *
 * Droplets leave in both directions so the stream splits around the pop point rather
 * than all running one way — a pop above a platform should wash the whole tier.
 */
export function spawnWater(x: number, y: number): Drop[] {
  const out: Drop[] = [];
  for (let i = 0; i < T.WATER_DROPS; i++) {
    out.push({
      id: nextId++,
      // Staggered, so the stream arrives as a run of water rather than a single blob.
      x: x + (i % 2 === 0 ? 1 : -1) * (i * 0.9),
      y: y - i * 0.6,
      dir: i % 2 === 0 ? 1 : -1,
      falling: true,
      life: T.WATER_LIFETIME,
      dead: false,
    });
  }
  return out;
}

export function stepDrop(room: RoomData, d: Drop): void {
  if (--d.life <= 0) {
    d.dead = true;
    return;
  }

  if (d.falling) {
    const ny = d.y + T.WATER_FALL_SPEED;
    const ty = tileOf(ny + T.WATER_HALF);
    if (isFloor(tileAt(room, tileOf(d.x), ty))) {
      // Landed: settle onto the surface and start running along it.
      d.y = ty * T.TILE - T.WATER_HALF;
      d.falling = false;
    } else {
      d.y = ny;
    }
  } else {
    const nx = d.x + d.dir * T.WATER_FLOW_SPEED;
    const feetRow = tileOf(d.y + T.WATER_HALF + 1);

    if (isBlocking(tileAt(room, tileOf(nx + d.dir * T.WATER_HALF), tileOf(d.y)))) {
      // A wall: water piles up and turns back rather than stopping dead.
      d.dir = d.dir === 1 ? -1 : 1;
    } else if (!isFloor(tileAt(room, tileOf(nx), feetRow))) {
      // Ran off the end of the tier — pour over the edge.
      d.x = nx;
      d.falling = true;
    } else {
      d.x = nx;
    }
  }

  // Water drains out of the bottom of the room; it does not wrap the way a body does.
  if (d.y > ROOM_H + T.TILE) d.dead = true;
  if (d.x < 0 || d.x > ROOM_W) d.dead = true;
}

/* ------------------------------------------------------------------ lightning */

/**
 * A bolt across the room.
 *
 * Direction is set by which side the player popped the bubble from, which is the whole
 * skill of it: a lightning bubble is a weapon you aim by choosing where to stand.
 */
export function spawnBolt(x: number, y: number, dir: -1 | 1): Bolt {
  return { id: nextId++, x, y, dir, life: T.LIGHTNING_LIFETIME, dead: false };
}

export function stepBolt(room: RoomData, b: Bolt): void {
  if (--b.life <= 0) {
    b.dead = true;
    return;
  }
  b.x += b.dir * T.LIGHTNING_SPEED;
  // Solid geometry stops a bolt; platforms do not, so it sweeps a whole tier.
  if (isBlocking(tileAt(room, tileOf(b.x), tileOf(b.y)))) b.dead = true;
  if (b.x < 0 || b.x > ROOM_W) b.dead = true;
}

/* ------------------------------------------------------------------ fire */

/**
 * Flame that falls to the tier below and burns there.
 *
 * The only one of the three that denies ground rather than sweeping it. A burning
 * platform is a platform you cannot use, which matters far more in a game where the
 * tiers are the whole map.
 */
export function spawnFire(x: number, y: number): Flame[] {
  const out: Flame[] = [];
  for (let i = 0; i < T.FIRE_DROPS; i++) {
    out.push({
      id: nextId++,
      x: x + (i - (T.FIRE_DROPS - 1) / 2) * T.TILE * 0.8,
      y,
      falling: true,
      life: T.FIRE_LIFETIME,
      dead: false,
    });
  }
  return out;
}

export function stepFlame(room: RoomData, f: Flame): void {
  if (--f.life <= 0) {
    f.dead = true;
    return;
  }
  if (!f.falling) return;

  const ny = f.y + T.FIRE_FALL_SPEED;
  const ty = tileOf(ny + T.FIRE_HALF);
  if (isFloor(tileAt(room, tileOf(f.x), ty))) {
    f.y = ty * T.TILE - T.FIRE_HALF;
    f.falling = false;
  } else {
    f.y = ny;
  }
  if (f.y > ROOM_H + T.TILE) f.dead = true;
}

/* ------------------------------------------------------------------ contact */

export function touches(
  ax: number,
  ay: number,
  aHalf: number,
  bx: number,
  by: number,
  bHalfW: number,
  bHalfH: number,
): boolean {
  return Math.abs(ax - bx) < aHalf + bHalfW && Math.abs(ay - by) < aHalf + bHalfH;
}
