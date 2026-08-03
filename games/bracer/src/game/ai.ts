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

/* ------------------------------------------------------------------ navigation */

/**
 * A breadth-first distance field over walkable cells, used to actually get somewhere.
 *
 * Deliberately NOT used by ordinary monsters. Their greedy pursuit above is the
 * authentic behaviour — Gauntlet's monsters hug walls and pile up at chokepoints, and
 * that is most of what makes a corridor defensible. Pathfinding would erase it.
 *
 * The Thief is the exception, and the reason this exists. He is not ambient: he is
 * announced by a tone the design calls a warning, there is exactly one of him, and he
 * spawns in a far corner rather than out of a generator beside you. Greedy pursuit meant
 * he walked into the first wall between him and the player and pressed against it until
 * his patience ran out — across the whole campaign he arrived 0 times out of 4, so the
 * warning tone announced an enemy that never came. "Beelines to the player" (§4) is a
 * statement about intent, not about ignoring geometry.
 *
 * Costs one BFS over GRID*GRID cells per recompute, and only while a thief is alive.
 */
export class FlowField {
  /** Steps to the goal, or -1 for unreachable/solid. Indexed like Terrain. */
  private readonly dist: Int32Array;
  private readonly queue: Int32Array;

  constructor(private readonly size: number) {
    this.dist = new Int32Array(size * size);
    this.queue = new Int32Array(size * size);
  }

  /** Rebuild the field with the goal at this cell. */
  recompute(terrain: Terrain, goalCx: number, goalCy: number): void {
    this.dist.fill(-1);
    if (!terrain.inBounds(goalCx, goalCy) || terrain.solidAtCell(goalCx, goalCy)) return;

    const n = this.size;
    let head = 0;
    let tail = 0;
    const start = goalCy * n + goalCx;
    this.dist[start] = 0;
    this.queue[tail++] = start;

    // Four-way, not eight: a diagonal that clips a wall corner is not a step the mover
    // can actually take, and following one puts the thief right back against a wall.
    while (head < tail) {
      const cur = this.queue[head++];
      const cx = cur % n;
      const cy = (cur / n) | 0;
      const d = this.dist[cur] + 1;
      for (let i = 0; i < 4; i++) {
        const nx = cx + (i === 0 ? 1 : i === 1 ? -1 : 0);
        const ny = cy + (i === 2 ? 1 : i === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const ni = ny * n + nx;
        if (this.dist[ni] !== -1) continue;
        if (terrain.solidAtCell(nx, ny)) continue;
        this.dist[ni] = d;
        this.queue[tail++] = ni;
      }
    }
  }

  /** Steps from this cell to the goal, or -1 if it cannot be reached. */
  distanceAt(cx: number, cy: number): number {
    if (cx < 0 || cy < 0 || cx >= this.size || cy >= this.size) return -1;
    return this.dist[cy * this.size + cx];
  }

  /**
   * The neighbouring cell one step closer to the goal, or null if there is no route.
   *
   * Returns a CELL rather than a direction so the caller can aim at its centre. Aiming
   * at the goal itself is what fails: the mover shaves the corner, catches the wall and
   * stops. Aiming at the next cell centre keeps it in the corridor.
   */
  next(cx: number, cy: number): { cx: number; cy: number } | null {
    const here = this.distanceAt(cx, cy);
    if (here <= 0) return null;
    for (let i = 0; i < 4; i++) {
      const nx = cx + (i === 0 ? 1 : i === 1 ? -1 : 0);
      const ny = cy + (i === 2 ? 1 : i === 3 ? -1 : 0);
      const d = this.distanceAt(nx, ny);
      if (d >= 0 && d < here) return { cx: nx, cy: ny };
    }
    return null;
  }
}
