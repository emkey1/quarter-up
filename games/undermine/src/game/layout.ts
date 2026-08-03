import { T } from '@/data/tuning';
import type { EnemyKind } from './enemy';

export interface LayoutEnemy {
  kind: EnemyKind;
  x: number;
  y: number;
}

export interface Layout {
  id: string;
  name: string;
  /** Player start, in cells. */
  start: [number, number];
  /** GRID_H rows of GRID_W characters: '#' earth, '.' pre-cut, ' ' sky. */
  rows: string[];
  rocks: [number, number][];
  enemies: LayoutEnemy[];
}

export type ValidationResult =
  | { ok: true; data: Layout }
  | { ok: false; errors: string[] };

/**
 * Check a layout at load, not only when it was generated.
 *
 * The generator validates before it writes, which catches authoring mistakes. This
 * catches the other kind: a file edited by hand despite the sign, a schema that moved
 * under a file that did not, or a grid constant changed without regenerating. Bracer
 * learned this one the expensive way when the grid went from 32 to 48 and three
 * fixtures quietly became wrong.
 */
export function validateLayout(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const o = raw as Record<string, unknown>;

  if (typeof o?.id !== 'string') errors.push('id: missing');
  if (typeof o?.name !== 'string') errors.push('name: missing');

  const rows = o?.rows;
  if (!Array.isArray(rows) || rows.length !== T.GRID_H) {
    errors.push(`rows: expected ${T.GRID_H}, got ${Array.isArray(rows) ? rows.length : 'none'}`);
    return { ok: false, errors };
  }
  rows.forEach((r, y) => {
    if (typeof r !== 'string' || r.length !== T.GRID_W) {
      errors.push(`rows[${y}]: expected ${T.GRID_W} characters`);
    }
  });

  const at = (x: number, y: number): string =>
    x < 0 || y < 0 || x >= T.GRID_W || y >= T.GRID_H ? '#' : (rows[y] as string)[x];
  const open = (x: number, y: number): boolean => at(x, y) === '.' || at(x, y) === ' ';

  const start = o?.start as [number, number] | undefined;
  if (!Array.isArray(start) || start.length !== 2) errors.push('start: missing');
  else if (!open(start[0], start[1])) errors.push('start: the player begins inside earth');

  const rocks = (o?.rocks ?? []) as [number, number][];
  if (!Array.isArray(rocks)) errors.push('rocks: not an array');
  else {
    if (rocks.length < T.BONUS_AFTER_ROCKS) {
      errors.push(`rocks: ${rocks.length} is fewer than the ${T.BONUS_AFTER_ROCKS} the bonus needs`);
    }
    for (const [x, y] of rocks) {
      if (open(x, y)) errors.push(`rock ${x},${y}: sits in open air`);
      if (open(x, y + 1)) errors.push(`rock ${x},${y}: unsupported, falls on frame one`);
    }
  }

  const enemies = (o?.enemies ?? []) as LayoutEnemy[];
  if (!Array.isArray(enemies) || enemies.length === 0) errors.push('enemies: none');
  else {
    for (const e of enemies) {
      if (e.kind !== 'grub' && e.kind !== 'emberjaw') errors.push(`enemy: unknown kind ${e.kind}`);
      if (!open(e.x, e.y)) errors.push(`enemy ${e.x},${e.y}: starts entombed`);
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, data: raw as Layout };
}
