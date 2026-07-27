import type { ClassId } from '@/data/classes';
import type { Tier } from '@/data/rules';
import { DEFAULT_DIFFICULTY, type DifficultyId } from '@/data/difficulty';

/**
 * Local high scores.
 *
 * Ranked by **score per credit**, not raw score, because that is what the arcade
 * actually measured — feeding coins divides your result, so a 50,000 on one credit beats
 * a 200,000 on ten. Raw score is kept and shown, but it does not decide the order.
 *
 * The rules tier rides along with every entry, so a run played with Death switched off
 * can never be mistaken for a straight one. Difficulty rides along for the same reason,
 * separately: it is not a rules deviation, and a Nightmare run deserves to be legible as
 * one rather than sorted in among the Apprentice runs with nothing to tell them apart.
 */
export interface ScoreEntry {
  initials: string;
  score: number;
  credits: number;
  scorePerCredit: number;
  deepestLevel: number;
  cls: ClassId;
  tier: Tier;
  /** Optional so entries saved before difficulty existed still load. */
  difficulty?: DifficultyId;
  /** ISO date string; display only. */
  date: string;
}

const KEY = 'bracer.scores.v1';
const MAX_ENTRIES = 10;

export function loadScores(): ScoreEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as ScoreEntry[];
    return Array.isArray(list) ? list.slice(0, MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

export function saveScores(list: ScoreEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch {
    /* private browsing; scores are a nicety, not a requirement */
  }
}

export function rank(list: readonly ScoreEntry[], entry: ScoreEntry): number {
  const sorted = sortScores([...list, entry]);
  return sorted.indexOf(entry);
}

export function sortScores(list: ScoreEntry[]): ScoreEntry[] {
  return [...list].sort(
    (a, b) => b.scorePerCredit - a.scorePerCredit || b.score - a.score || b.deepestLevel - a.deepestLevel,
  );
}

/** Would this result make the table? Drives whether initials are asked for at all. */
export function qualifies(list: readonly ScoreEntry[], scorePerCredit: number): boolean {
  if (scorePerCredit <= 0) return false;
  if (list.length < MAX_ENTRIES) return true;
  return list.some((e) => scorePerCredit > e.scorePerCredit);
}

export function insertScore(list: ScoreEntry[], entry: ScoreEntry): ScoreEntry[] {
  return sortScores([...list, entry]).slice(0, MAX_ENTRIES);
}

export const DEFAULT_INITIALS = 'AAA';
