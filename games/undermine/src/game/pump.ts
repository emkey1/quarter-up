import { T } from '@/data/tuning';
import { Field } from './field';
import { Dir, DIR_DX, DIR_DY } from './digger';
import { enemyCellX, enemyCellY, type Enemy } from './enemy';

export interface PumpResult {
  /** The enemy that took a stage this press, if any. */
  target: Enemy | null;
  /** It reached the top stage and came apart. */
  burst: boolean;
  /** Points, already banded and multiplied. Zero unless it burst. */
  score: number;
  /** Band it died in, for the floating number. -1 if nothing burst. */
  band: number;
}

/**
 * One press of the pump.
 *
 * Short range, along the facing axis only, and it stops at earth — so using it means
 * standing in the tunnel with the thing you are attacking, close enough for it to reach
 * you back. That is the trade the whole weapon is built on.
 *
 * Edge-triggered rather than held. Holding a button while a bar fills is a different
 * game with a different feel; the original wants you jabbing the button, and the jabbing
 * is what makes an interrupted inflation a real decision — every stage you do not top up
 * is leaking away while you deal with something else.
 */
export function pump(
  field: Field,
  enemies: readonly Enemy[],
  px: number,
  py: number,
  facing: Dir,
  playerY: number,
): PumpResult {
  const none: PumpResult = { target: null, burst: false, score: 0, band: -1 };
  if (facing === Dir.None) return none;

  const dx = DIR_DX[facing];
  const dy = DIR_DY[facing];
  const startCx = Math.floor(px / T.CELL);
  const startCy = Math.floor(py / T.CELL);

  for (let i = 1; i <= T.PUMP_REACH_CELLS; i++) {
    const cx = startCx + dx * i;
    const cy = startCy + dy * i;

    // The nozzle cannot go through earth. A target one cell into the wall is safe, which
    // is why a half-dug tunnel is a defensive position as well as an offensive one.
    if (!field.isOpen(cx, cy)) return none;

    for (const e of enemies) {
      if (!e.alive) continue;
      if (enemyCellX(e) !== cx || enemyCellY(e) !== cy) continue;

      e.inflation++;
      e.deflateTimer = 0;

      if (e.inflation >= T.PUMP_STAGES) {
        e.alive = false;
        const band = Math.max(0, Math.min(T.BANDS - 1, bandOfWorldY(e.y)));
        return { target: e, burst: true, score: burstScore(e, band, playerY), band };
      }
      return { target: e, burst: false, score: 0, band: -1 };
    }
  }

  return none;
}

function bandOfWorldY(y: number): number {
  const cy = Math.floor(y / T.CELL);
  return Math.floor((cy - T.SKY_ROWS) / T.BAND_ROWS);
}

/**
 * What a burst is worth.
 *
 * Depth is money — the deep bands pay more, which pulls the player down and away from
 * the surface for no reason except greed. And a dragon burst from its own fire lane pays
 * double, because that is the dangerous way to kill one: you have to stand in the exact
 * place it can reach you.
 *
 * Every number here is `[i]`. Sources agree on the shape and differ on the values.
 */
export function burstScore(e: Enemy, band: number, playerY: number): number {
  const base = T.SCORE_BURST[Math.max(0, Math.min(T.SCORE_BURST.length - 1, band))];
  if (e.kind !== 'emberjaw') return base;
  const inLane = Math.abs(playerY - e.y) <= T.FLAME_ALIGN_WU;
  return inLane ? base * T.SCORE_DRAGON_LANE_MULTIPLIER : base;
}

/**
 * What a rock fall is worth, by how many it caught at once.
 *
 * Steep on purpose. Crushing is the only way to kill several things at once, and the
 * curve is what makes setting one up worth more than the four separate pumps it replaces.
 */
export function crushScore(count: number): number {
  if (count <= 0) return 0;
  const table = T.SCORE_CRUSH;
  return table[Math.min(count, table.length) - 1];
}
