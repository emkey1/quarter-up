import { T } from '@/data/tuning';
import type { Terrain } from './terrain';

const EPS = 1e-4;

export interface Body {
  x: number;
  y: number;
  /** Half-extent; all bodies are squares in this game. */
  half: number;
}

export interface MoveResult {
  movedX: number;
  movedY: number;
  blockedX: boolean;
  blockedY: boolean;
  /** True when corner assist nudged us around a corner this step — surfaced for the
   *  debug overlay so the feel can be tuned by watching it fire. */
  assisted: boolean;
}

/** Does an axis-aligned box centred at (x,y) overlap any solid cell? */
export function boxHitsSolid(t: Terrain, x: number, y: number, half: number): boolean {
  const minX = x - half;
  const maxX = x + half;
  const minY = y - half;
  const maxY = y + half;
  const c0 = Math.floor(minX / T.TILE);
  const c1 = Math.ceil(maxX / T.TILE) - 1;
  const r0 = Math.floor(minY / T.TILE);
  const r1 = Math.ceil(maxY / T.TILE) - 1;
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      if (t.solidAtCell(cx, cy)) return true;
    }
  }
  return false;
}

/**
 * Move a body with axis-separated resolution, wall slide, and corner assist.
 *
 * Corner assist is what stops Gauntlet-style movement feeling like it's fighting you:
 * when a box clips one corner of a wall while running past it, nudge perpendicular
 * instead of stopping dead. Only fires when the misalignment is within T.CORNER_ASSIST,
 * so it rounds corners without letting you squeeze through walls.
 *
 * Monsters use this too, which is what produces the traffic jams at chokepoints that
 * the original's tactics depend on.
 */
export function moveBody(t: Terrain, b: Body, dx: number, dy: number): MoveResult {
  const res: MoveResult = {
    movedX: 0,
    movedY: 0,
    blockedX: false,
    blockedY: false,
    assisted: false,
  };

  // Insurance against tunnelling if a speed ever exceeds half a tile per step.
  const maxStep = T.TILE / 2;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / maxStep));
  const sx = dx / steps;
  const sy = dy / steps;

  for (let i = 0; i < steps; i++) {
    if (sx !== 0) axis(t, b, sx, true, res);
    if (sy !== 0) axis(t, b, sy, false, res);
  }
  return res;
}

function axis(t: Terrain, b: Body, d: number, horizontal: boolean, res: MoveResult): void {
  const startX = b.x;
  const startY = b.y;
  const nx = horizontal ? b.x + d : b.x;
  const ny = horizontal ? b.y : b.y + d;

  if (!boxHitsSolid(t, nx, ny, b.half)) {
    b.x = nx;
    b.y = ny;
    res.movedX += b.x - startX;
    res.movedY += b.y - startY;
    return;
  }

  // Blocked. Is it a corner clip (one leading corner solid) or a flat wall (both)?
  const lead = horizontal ? (d > 0 ? nx + b.half : nx - b.half) : d > 0 ? ny + b.half : ny - b.half;
  const lo = (horizontal ? b.y : b.x) - b.half + EPS;
  const hi = (horizontal ? b.y : b.x) + b.half - EPS;

  const loSolid = horizontal ? t.solidAt(lead, lo) : t.solidAt(lo, lead);
  const hiSolid = horizontal ? t.solidAt(lead, hi) : t.solidAt(hi, lead);

  if (loSolid !== hiSolid) {
    // Distance we must shift perpendicular to clear the offending tile.
    let need: number;
    let dir: number;
    if (loSolid) {
      const row = Math.floor(lo / T.TILE);
      need = (row + 1) * T.TILE - (lo - EPS);
      dir = 1;
    } else {
      const row = Math.floor(hi / T.TILE);
      need = hi + EPS - row * T.TILE;
      dir = -1;
    }

    if (need <= T.CORNER_ASSIST) {
      const nudge = Math.min(T.CORNER_ASSIST_SPEED, need) * dir;
      const px = horizontal ? b.x : b.x + nudge;
      const py = horizontal ? b.y + nudge : b.y;
      if (!boxHitsSolid(t, px, py, b.half)) {
        b.x = px;
        b.y = py;
        res.assisted = true;
        // Retry the original direction: if the nudge cleared the corner, keep the
        // frame's forward motion rather than trading it for the sidestep.
        const rx = horizontal ? b.x + d : b.x;
        const ry = horizontal ? b.y : b.y + d;
        if (!boxHitsSolid(t, rx, ry, b.half)) {
          b.x = rx;
          b.y = ry;
        } else if (horizontal) res.blockedX = true;
        else res.blockedY = true;
        res.movedX += b.x - startX;
        res.movedY += b.y - startY;
        return;
      }
    }
  }

  // Hard stop: snap flush against the wall so there is never a sub-pixel gap.
  const flush = snapFlush(horizontal ? b.x : b.y, horizontal ? nx : ny, d, b.half);
  if (horizontal) {
    b.x = flush;
    res.blockedX = true;
  } else {
    b.y = flush;
    res.blockedY = true;
  }
  // A snap must never overlap; if the geometry was degenerate, stay put.
  if (boxHitsSolid(t, b.x, b.y, b.half)) {
    b.x = startX;
    b.y = startY;
  }
  res.movedX += b.x - startX;
  res.movedY += b.y - startY;
}

function snapFlush(cur: number, attempted: number, d: number, half: number): number {
  if (d > 0) {
    const col = Math.floor((attempted + half) / T.TILE);
    const edge = col * T.TILE - half - EPS;
    return Math.min(attempted, Math.max(cur, edge));
  }
  const col = Math.floor((attempted - half) / T.TILE);
  const edge = (col + 1) * T.TILE + half + EPS;
  return Math.max(attempted, Math.min(cur, edge));
}
