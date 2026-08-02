import { T } from '@/data/tuning';
import type { Rng } from '@/engine/rng';
import { isBlocking, isFloor, tileAt, type MonsterKind, type RoomData } from './room';
import { makeBody, stepBody, type Body, type Ridable } from './physics';

/**
 * Monsters.
 *
 * M2 ships Zen-Chan only — the clockwork walker, the baseline every other monster is a
 * variation on. The rest of the roster arrives in M3 (DESIGN.md §3.5).
 */

export type MonsterState = 'walking' | 'bubbled' | 'dead';

export interface Monster {
  id: number;
  kind: MonsterKind;
  body: Body;
  dir: -1 | 1;
  /**
   * Angry monsters move faster and are harder to corner.
   *
   * Set when one breaks out of a bubble, and never cleared — escaping is meant to cost
   * you something for the rest of the room. See DESIGN.md §3.6.
   */
  angry: boolean;
  state: MonsterState;
  /** Frames since spawning, so a monster can't act on its very first frame. */
  age: number;
}

let nextId = 1;

/** Reset the id counter. Tests only — ids must be stable within a run. */
export function resetMonsterIds(): void {
  nextId = 1;
}

export function spawnMonster(kind: MonsterKind, tileX: number, tileY: number, dir: -1 | 1): Monster {
  return {
    id: nextId++,
    kind,
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
  };
}

export function monsterSpeed(m: Monster): number {
  return m.angry ? T.MONSTER_SPEED_ANGRY : T.MONSTER_SPEED;
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

/**
 * Zen-Chan: march back and forth, and jump for a higher tier when the player is above.
 *
 * Turning at ledges rather than walking off them is what makes it *patrol* — a monster
 * that tips off every edge ends up in a heap on the floor, and the room stops having
 * layers. The jump is deliberately occasional rather than reactive: a walker that
 * beelines for you the instant you climb is a different, meaner game.
 */
export function stepMonster(
  room: RoomData,
  m: Monster,
  playerY: number,
  rng: Rng,
  ridables: readonly Ridable[] = [],
): void {
  if (m.state !== 'walking') return;
  m.age++;

  const b = m.body;

  if (b.onGround) {
    if (wallAhead(room, m) || !groundAhead(room, m)) m.dir = m.dir === 1 ? -1 : 1;

    const playerIsAbove = playerY < b.y - T.TILE * 2;
    const chance = m.angry ? T.MONSTER_JUMP_CHANCE_ANGRY : T.MONSTER_JUMP_CHANCE;
    if (playerIsAbove && rng.chance(chance)) b.vy = -T.JUMP_VELOCITY;
  }

  b.vx = m.dir * monsterSpeed(m);
  stepBody(room, b, ridables);

  // Walls stop the body but don't turn it; without this a monster grinds into a wall
  // forever with its legs going.
  if (b.vx === 0 && b.onGround) m.dir = m.dir === 1 ? -1 : 1;
}
