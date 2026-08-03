import { T } from '@/data/tuning';
import { hash32 } from '@cabinet/rng';
import type { Item } from './items';

/**
 * The ranking system — the real difficulty curve.
 *
 * The more points you have, the less food spawns. By ~300,000 points most of it is
 * gone, which is why a high-scoring run eventually starves rather than being killed.
 * It also makes treasure a genuine decision: 100 points now costs you food later.
 *
 * Deterministic by construction. Which food survives is chosen by a stable hash of
 * (level, cell), not by the RNG stream, so culling cannot desynchronise a replay and
 * the same level at the same score always looks the same.
 */
export function foodKeepRatio(score: number): number {
  const raw = 1 - score / T.RANK_ZERO_FOOD_SCORE;
  return Math.max(T.RANK_MIN_FOOD_RATIO, Math.min(1, raw));
}

export function cullFood(items: Item[], levelId: string, score: number): number {
  const ratio = foodKeepRatio(score);
  if (ratio >= 1) return 0;

  const food = items.filter((i) => i.kind === 'food');
  if (!food.length) return 0;

  // The ratio sets the shape of the curve; the floor sets its bottom. Without the floor
  // the two independent knobs multiply — halving the campaign's food also halved what a
  // rich run is left with, and a level holding one piece of food is not a difficulty
  // curve, it is a coin flip on whether you walk past it. Never keeps more than exists.
  const keep = Math.max(
    Math.min(food.length, T.RANK_MIN_FOOD_ITEMS),
    Math.ceil(food.length * ratio),
  );
  if (keep >= food.length) return 0;

  // Stable ordering: the same level at the same score always keeps the same pieces.
  const ranked = food
    .map((f) => ({ f, h: hash32(levelId, Math.round(f.x), Math.round(f.y)) }))
    .sort((a, b) => a.h - b.h);

  let removed = 0;
  for (let i = keep; i < ranked.length; i++) {
    ranked[i].f.alive = false;
    removed++;
  }
  return removed;
}
