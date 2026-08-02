import { describe, it, expect } from 'vitest';
import { insertScore, qualifies, sortScores, type ScoreEntry } from '@/ui/highscores';
import { classBars, CLASSES, CLASS_ORDER } from '@/data/classes';

function entry(over: Partial<ScoreEntry> = {}): ScoreEntry {
  return {
    initials: 'AAA',
    score: 1000,
    credits: 1,
    scorePerCredit: 1000,
    deepestLevel: 1,
    cls: 'elf',
    tier: 'arcade',
    date: '2026-01-01',
    ...over,
  };
}

describe('high scores', () => {
  it('ranks on score per credit, not raw score', () => {
    // The arcade's actual metric: feeding coins divides your result, so a smaller
    // total on one credit beats a huge total on ten.
    const lean = entry({ initials: 'ONE', score: 50_000, credits: 1, scorePerCredit: 50_000 });
    const fed = entry({ initials: 'TEN', score: 200_000, credits: 10, scorePerCredit: 20_000 });
    const sorted = sortScores([fed, lean]);
    expect(sorted[0].initials).toBe('ONE');
    expect(sorted[0].score).toBeLessThan(sorted[1].score); // and it has the LOWER raw score
  });

  it('breaks ties on raw score, then on depth', () => {
    const a = entry({ initials: 'AAA', scorePerCredit: 100, score: 100, deepestLevel: 5 });
    const b = entry({ initials: 'BBB', scorePerCredit: 100, score: 200, deepestLevel: 1 });
    expect(sortScores([a, b])[0].initials).toBe('BBB');

    const c = entry({ initials: 'CCC', scorePerCredit: 100, score: 100, deepestLevel: 9 });
    expect(sortScores([a, c])[0].initials).toBe('CCC');
  });

  it('keeps only ten entries', () => {
    let list: ScoreEntry[] = [];
    for (let i = 0; i < 25; i++) {
      list = insertScore(list, entry({ scorePerCredit: i * 10, initials: `X${i}` }));
    }
    expect(list.length).toBe(10);
    expect(list[0].scorePerCredit).toBe(240); // the best survived
  });

  it('only asks for initials when the result would actually place', () => {
    const full: ScoreEntry[] = Array.from({ length: 10 }, (_, i) =>
      entry({ scorePerCredit: 1000 + i }),
    );
    expect(qualifies(full, 5000)).toBe(true);
    expect(qualifies(full, 10)).toBe(false);
    expect(qualifies([], 100)).toBe(true);
    expect(qualifies([], 0), 'a zero score never places').toBe(false);
  });

  it('carries the rules tier, so an altered run cannot be mistaken for a straight one', () => {
    const list = insertScore([], entry({ tier: 'ineligible', initials: 'MOD' }));
    expect(list[0].tier).toBe('ineligible');
  });
});

describe('character select data', () => {
  it('gives every class six bars', () => {
    for (const id of CLASS_ORDER) {
      expect(classBars(CLASSES[id]).length, id).toBe(6);
    }
  });

  it('leads with magic vs generators, the stat that decides a run', () => {
    expect(classBars(CLASSES.elf)[0].label).toBe('Magic vs generators');
  });

  it('shows the Warrior as zero and the Wizard as maximum on that bar', () => {
    const warrior = classBars(CLASSES.warrior)[0];
    const wizard = classBars(CLASSES.wizard)[0];
    expect(warrior.base).toBe(0);
    expect(wizard.base).toBe(3);
    // and the Warrior's upgrade barely helps, which is the whole point
    expect(warrior.extra).toBeLessThan(wizard.base);
  });

  it('never produces a bar that overflows its own maximum', () => {
    for (const id of CLASS_ORDER) {
      for (const b of classBars(CLASSES[id])) {
        expect(b.base, `${id} ${b.label}`).toBeLessThanOrEqual(b.max);
        expect(b.extra, `${id} ${b.label} extra`).toBeLessThanOrEqual(b.max);
      }
    }
  });

  it('never shows an upgrade as a downgrade', () => {
    for (const id of CLASS_ORDER) {
      for (const b of classBars(CLASSES[id])) {
        expect(b.extra, `${id} ${b.label}`).toBeGreaterThanOrEqual(b.base);
      }
    }
  });
});
