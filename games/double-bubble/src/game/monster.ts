import { T } from '@/data/tuning';
import { MONSTER_SPECS, type MonsterSpec } from '@/data/roster';
import type { Rng } from '@cabinet/rng';
import { isBlocking, isFloor, tileAt, type MonsterKind, type RoomData } from './room';
import { makeBody, stepBody, wrapVertical, type Body, type Ridable } from './physics';
import { spawnProjectile, type Projectile } from './projectile';

/**
 * Monsters.
 *
 * One step function driven by the roster table (data/roster.ts) rather than eight
 * behaviours, because the eight types genuinely are variations on a few axes. What
 * differs between them is which axis is dialled, not what kind of thing they are.
 */

export type MonsterState = 'walking' | 'bubbled' | 'dead';

export interface Monster {
  id: number;
  kind: MonsterKind;
  spec: MonsterSpec;
  body: Body;
  dir: -1 | 1;
  /**
   * Angry monsters move faster and climb more readily.
   *
   * Set when one breaks out of a bubble, and never cleared — escaping is meant to cost
   * you for the rest of the room. See DESIGN.md §3.6.
   */
  angry: boolean;
  state: MonsterState;
  age: number;
  /** Frames until it can throw again. */
  throwCooldown: number;
  /** Phase for the floaters' sweep, kept per monster so they don't move in lockstep. */
  phase: number;
}

let nextId = 1;

/** Reset the id counter. Tests only — ids must be stable within a run. */
export function resetMonsterIds(): void {
  nextId = 1;
}

export function spawnMonster(kind: MonsterKind, tileX: number, tileY: number, dir: -1 | 1): Monster {
  const spec = MONSTER_SPECS[kind];
  return {
    id: nextId++,
    kind,
    spec,
    body: makeBody(
      tileX * T.TILE + T.TILE / 2,
      (tileY + 1) * T.TILE - T.MONSTER_HALF,
      T.MONSTER_HALF,
      T.MONSTER_HALF,
    ),
    dir,
    angry: false,
    state: 'walking',
    age: 0,
    // Stagger the first throw so a room full of throwers doesn't volley in unison.
    throwCooldown: spec.projectile ? spec.projectile.cooldown / 2 + (nextId % 40) : 0,
    phase: (nextId * 37) % T.FLOAT_PERIOD,
  };
}

export function monsterSpeed(m: Monster): number {
  return m.angry ? m.spec.angrySpeed : m.spec.speed;
}

/** Is there floor under the tile the monster is about to step onto? */
function groundAhead(room: RoomData, m: Monster): boolean {
  const lead = m.body.x + m.dir * (m.body.halfW + 1);
  const tx = Math.floor(lead / T.TILE);
  const ty = Math.floor((m.body.y + m.body.halfH + 1) / T.TILE);
  return isFloor(tileAt(room, tx, ty));
}

/** Is something solid directly in front at head height? */
function wallAhead(room: RoomData, m: Monster): boolean {
  const lead = m.body.x + m.dir * (m.body.halfW + 1);
  const tx = Math.floor(lead / T.TILE);
  const ty = Math.floor(m.body.y / T.TILE);
  return isBlocking(tileAt(room, tx, ty));
}

const turn = (m: Monster): void => {
  m.dir = m.dir === 1 ? -1 : 1;
};

export interface MonsterStepResult {
  /** A projectile the monster threw this step, if any. */
  threw: Projectile | null;
}

export function stepMonster(
  room: RoomData,
  m: Monster,
  playerX: number,
  playerY: number,
  rng: Rng,
  ridables: readonly Ridable[] = [],
): MonsterStepResult {
  if (m.state !== 'walking') return { threw: null };
  m.age++;

  const speed = monsterSpeed(m);

  switch (m.spec.locomotion) {
    case 'walk':
      stepWalker(room, m, playerY, speed, rng, ridables);
      break;
    case 'hop':
      stepHopper(room, m, speed, rng, ridables);
      break;
    case 'fly':
      stepFlier(room, m, speed);
      break;
    case 'float':
      stepFloater(room, m, speed);
      break;
  }

  return { threw: maybeThrow(m, playerX, playerY) };
}

/** Patrols a platform, turning at ledges and walls, and climbs for a player above. */
function stepWalker(
  room: RoomData,
  m: Monster,
  playerY: number,
  speed: number,
  rng: Rng,
  ridables: readonly Ridable[],
): void {
  const b = m.body;

  if (b.onGround) {
    // Turning at ledges rather than walking off them is what makes it *patrol*. A
    // monster that tips off every edge ends in a heap on the floor and the room stops
    // having layers.
    if (wallAhead(room, m) || (!m.spec.clearsGaps && !groundAhead(room, m))) turn(m);

    const playerIsAbove = playerY < b.y - T.TILE * 2;
    const chance = m.spec.climbChance * (m.angry ? T.ANGRY_CLIMB_MULTIPLIER : 1);
    if (m.spec.climbs && playerIsAbove && rng.chance(chance)) b.vy = -T.JUMP_VELOCITY;
  }

  b.vx = m.dir * speed;
  stepBody(room, b, ridables);

  // Walls stop the body but do not turn it; without this a monster grinds into a wall
  // forever with its legs going.
  if (b.vx === 0 && b.onGround) turn(m);
}

/** Hops rather than walks, so its position is hard to read. Clears gaps. */
function stepHopper(
  room: RoomData,
  m: Monster,
  speed: number,
  rng: Rng,
  ridables: readonly Ridable[],
): void {
  const b = m.body;

  if (b.onGround) {
    if (wallAhead(room, m)) turn(m);
    if (m.age % T.HOP_INTERVAL === 0) b.vy = -T.JUMP_VELOCITY;
    void rng;
  }

  b.vx = m.dir * speed;
  stepBody(room, b, ridables);
  if (b.vx === 0 && b.onGround) turn(m);
}

/**
 * Travels a fixed diagonal and bounces off geometry, ignoring platforms entirely.
 *
 * No gravity and no ground contact: this is the monster the room cannot protect you
 * from, and the first time the player's mental model of "get to a higher tier" fails.
 */
function stepFlier(room: RoomData, m: Monster, speed: number): void {
  const b = m.body;
  if (b.vy === 0) b.vy = speed; // set the diagonal on the first step

  const nx = b.x + m.dir * speed;
  const ny = b.y + Math.sign(b.vy) * speed;

  if (blockedAt(room, nx, b.y, b.halfW, b.halfH)) turn(m);
  else b.x = nx;

  if (blockedAt(room, b.x, ny, b.halfW, b.halfH)) b.vy = -b.vy;
  else b.y = ny;

  b.onGround = false;
  wrapVertical(b);
}

/** Long sweeping horizontal arcs with very little vertical movement. */
function stepFloater(room: RoomData, m: Monster, speed: number): void {
  const b = m.body;
  const nx = b.x + m.dir * speed;
  if (blockedAt(room, nx, b.y, b.halfW, b.halfH)) turn(m);
  else b.x = nx;

  const t = ((m.age + m.phase) % T.FLOAT_PERIOD) / T.FLOAT_PERIOD;
  b.y += Math.sin(t * Math.PI * 2) * T.FLOAT_AMPLITUDE;
  b.onGround = false;
  wrapVertical(b);
}

/** Would a body of this size at this position overlap solid geometry? */
function blockedAt(room: RoomData, x: number, y: number, halfW: number, halfH: number): boolean {
  const x0 = Math.floor((x - halfW) / T.TILE);
  const x1 = Math.floor((x + halfW - 0.001) / T.TILE);
  const y0 = Math.floor((y - halfH) / T.TILE);
  const y1 = Math.floor((y + halfH - 0.001) / T.TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) if (isBlocking(tileAt(room, tx, ty))) return true;
  }
  return false;
}

/**
 * Throw, if this kind throws and the player is worth throwing at.
 *
 * The alignment gate matters: without it a room of Mightas spends the whole time firing
 * boulders at a ceiling three tiers below the player, which reads as the monsters being
 * broken rather than as the player being safe.
 */
function maybeThrow(m: Monster, playerX: number, playerY: number): Projectile | null {
  const spec = m.spec.projectile;
  if (!spec) return null;
  if (m.throwCooldown > 0) {
    m.throwCooldown--;
    return null;
  }

  const facingPlayer = Math.sign(playerX - m.body.x) === m.dir;
  const aligned = spec.arcs || Math.abs(playerY - m.body.y) < T.THROW_ALIGN_WU;
  if (!facingPlayer || !aligned) return null;

  m.throwCooldown = spec.cooldown;
  return spawnProjectile(spec, m.body.x + m.dir * (m.body.halfW + 2), m.body.y, m.dir);
}
