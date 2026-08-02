import { T } from '@/data/tuning';
import { ITEM_SPECS, type ItemKind } from '@/data/items';
import type { RoomData } from './room';
import { makeBody, stepBody, type Body } from './physics';

/**
 * Pickups lying in the room.
 *
 * Three sources, all ending up as the same entity: the one item per room the counter
 * walk awards, the fruit a dead monster leaves behind, and EXTEND letters shaken loose
 * by a chain.
 */
export interface Pickup {
  id: number;
  kind: ItemKind;
  body: Body;
  /** Which EXTEND letter this is, 0..5. Meaningless for other kinds. */
  letter: number;
  /** Points this one is worth — fruit scales with the chain that dropped it. */
  points: number;
  life: number;
  dead: boolean;
}

let nextId = 1;

/** Reset the id counter. Tests only. */
export function resetPickupIds(): void {
  nextId = 1;
}

export function spawnPickup(
  kind: ItemKind,
  x: number,
  y: number,
  opts: { letter?: number; points?: number; vx?: number; vy?: number } = {},
): Pickup {
  const body = makeBody(x, y, T.ITEM_HALF, T.ITEM_HALF);
  body.vx = opts.vx ?? 0;
  body.vy = opts.vy ?? 0;
  return {
    id: nextId++,
    kind,
    body,
    letter: opts.letter ?? 0,
    points: opts.points ?? ITEM_SPECS[kind].points,
    life: T.PICKUP_LIFETIME,
    dead: false,
  };
}

/**
 * Pickups fall and settle, using the same one-way platform rule as everything else.
 *
 * Which means a fruit dropped over a gap falls through it, wraps at the bottom and
 * comes back in at the top — the same traversal the player has. That is not a quirk to
 * paper over: chasing a dropped item down through the room is a real thing the original
 * asks of you.
 */
export function stepPickup(room: RoomData, p: Pickup): void {
  stepBody(room, p.body);
  // Friction, so a fruit thrown clear of a chain settles rather than sliding forever.
  if (p.body.onGround) p.body.vx *= T.PICKUP_FRICTION;
  if (--p.life <= 0) p.dead = true;
}

export function pickupTouches(
  p: Pickup,
  x: number,
  y: number,
  halfW: number,
  halfH: number,
): boolean {
  return (
    Math.abs(p.body.x - x) < p.body.halfW + halfW &&
    Math.abs(p.body.y - y) < p.body.halfH + halfH
  );
}

/**
 * Fruit value scales with the chain that produced it.
 *
 * The chain score is only half the reward — the other half is what the corpses are
 * worth, and it climbs on the same curve. A player who never chains never sees the
 * expensive fruit and may not realise it exists.
 */
export function fruitValue(chainSize: number): number {
  const n = Math.max(1, chainSize);
  return Math.min(T.FRUIT_MAX, T.FRUIT_BASE * Math.pow(2, n - 1));
}
