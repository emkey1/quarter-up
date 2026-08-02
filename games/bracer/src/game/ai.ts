import { moveBody, boxHitsSolid } from './collision';
import type { Terrain } from './terrain';
import type { Monster } from './monster';
import { facingFrom } from './player';

export interface Blocker {
  x: number;
  y: number;
  half: number;
  alive: boolean;
}

/**
 * Greedy 8-way pursuit.
 *
 * The zig-zag that makes Gauntlet monsters awkward to hit is emergent, not scripted:
 * sign(dx)/sign(dy) flips as the monster overshoots on the minor axis at sub-pixel
 * speeds, so it weaves whenever it is not squared up with the player. Nothing here
 * special-cases it.
 *
 * Falls back to single-axis motion when the diagonal is blocked, which is what makes
 * monsters hug walls and pile up at chokepoints instead of gliding around them.
 */
export function chase(
  terrain: Terrain,
  m: Monster,
  targetX: number,
  targetY: number,
  speed: number,
  others: readonly Blocker[],
  flee = false,
): void {
  const sign = flee ? -1 : 1;
  const dx = (targetX - m.x) * sign;
  const dy = (targetY - m.y) * sign;

  const wantX = dx === 0 ? 0 : Math.sign(dx);
  const wantY = dy === 0 ? 0 : Math.sign(dy);
  if (wantX === 0 && wantY === 0) return;

  const before = { x: m.x, y: m.y };

  // Try the full diagonal, then each axis alone.
  if (!step(terrain, m, wantX * speed, wantY * speed, others)) {
    if (!step(terrain, m, wantX * speed, 0, others)) {
      step(terrain, m, 0, wantY * speed, others);
    }
  }

  if (m.x !== before.x || m.y !== before.y) {
    m.facing = facingFrom(m.x - before.x, m.y - before.y, m.facing);
  }
}

/** Attempt a move; reverts and reports false if it ends up overlapping another body. */
function step(
  terrain: Terrain,
  m: Monster,
  vx: number,
  vy: number,
  others: readonly Blocker[],
): boolean {
  if (vx === 0 && vy === 0) return false;
  const ox = m.x;
  const oy = m.y;

  const r = moveBody(terrain, m, vx, vy);
  if (r.movedX === 0 && r.movedY === 0) {
    m.x = ox;
    m.y = oy;
    return false;
  }

  // Monsters block each other. Without this there are no traffic jams, and the
  // chokepoint tactics the whole game is built around stop working.
  if (overlapsAny(m, others)) {
    m.x = ox;
    m.y = oy;
    return false;
  }
  return true;
}

export function overlapsAny(m: Monster, others: readonly Blocker[]): boolean {
  for (let i = 0; i < others.length; i++) {
    const o = others[i];
    if (o === (m as unknown as Blocker) || !o.alive) continue;
    const r = m.half + o.half;
    if (Math.abs(o.x - m.x) < r && Math.abs(o.y - m.y) < r) return true;
  }
  return false;
}

/** Pick a free tile around a generator for a new monster. Deterministic order with an
 *  rng-chosen starting offset, so spawns fan out rather than always favouring north. */
const RING = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
] as const;

export function findSpawnTile(
  terrain: Terrain,
  cx: number,
  cy: number,
  tile: number,
  half: number,
  offset: number,
  occupied: readonly Blocker[],
): { x: number; y: number } | null {
  for (let i = 0; i < RING.length; i++) {
    const [ox, oy] = RING[(i + offset) % RING.length];
    const nx = cx + ox;
    const ny = cy + oy;
    if (terrain.solidAtCell(nx, ny)) continue;
    const wx = nx * tile + tile / 2;
    const wy = ny * tile + tile / 2;
    if (boxHitsSolid(terrain, wx, wy, half)) continue;
    let blocked = false;
    for (const o of occupied) {
      if (!o.alive) continue;
      const r = half + o.half;
      if (Math.abs(o.x - wx) < r && Math.abs(o.y - wy) < r) {
        blocked = true;
        break;
      }
    }
    if (!blocked) return { x: wx, y: wy };
  }
  return null;
}
