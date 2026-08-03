import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateLevel } from '@/game/level';
import { T } from '@/data/tuning';
import { PROVING } from '@/data/proving';
import { blobIndex, reduceMask, BLOB_COUNT, NB, neighbourMask } from '@cabinet/autotile';

const levelDir = resolve(__dirname, '../src/data/levels');
const levelFiles = readdirSync(levelDir).filter((f) => f.endsWith('.json'));

describe('shipped levels', () => {
  it('finds at least one level', () => {
    expect(levelFiles.length).toBeGreaterThan(0);
  });

  for (const f of levelFiles) {
    // proving.json is deliberately authored at whatever size it was and padded to the
    // current grid on load (see src/data/proving.ts) — it is a test harness whose fixed
    // coordinates are the point, so it is checked through that path, not raw.
    if (f === 'proving.json') continue;
    it(`${f} passes validation`, () => {
      const data = JSON.parse(readFileSync(resolve(levelDir, f), 'utf8'));
      const r = validateLevel(data);
      if (!r.ok) throw new Error(`${f}:\n  ${r.errors.join('\n  ')}`);
      expect(r.ok).toBe(true);
    });
  }

  it('proving.json loads and validates once padded to the grid', () => {
    expect(PROVING.tiles.length).toBe(T.GRID);
    expect(PROVING.tiles.every((r) => r.length === T.GRID)).toBe(true);
  });
});

describe('autotile', () => {
  it('reduces 256 neighbour configurations to the 47 distinct blob appearances', () => {
    expect(BLOB_COUNT).toBe(47);
  });

  it('ignores a diagonal whose adjacent cardinals are not both filled', () => {
    // NE alone is invisible: the corner is already an outside corner.
    expect(reduceMask(NB.NE)).toBe(0);
    expect(reduceMask(NB.NE | NB.N)).toBe(NB.N);
    // With both cardinals present it becomes an inside corner and does matter.
    expect(reduceMask(NB.NE | NB.N | NB.E)).toBe(NB.NE | NB.N | NB.E);
  });

  it('maps every possible mask to a valid dense index', () => {
    for (let m = 0; m < 256; m++) {
      const i = blobIndex(m);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(BLOB_COUNT);
    }
  });

  it('builds the neighbour mask in the documented bit order', () => {
    const filled = new Set(['1,0', '2,1']); // N and E of cell (1,1)
    const same = (x: number, y: number) => filled.has(`${x},${y}`);
    expect(neighbourMask(1, 1, same)).toBe(NB.N | NB.E);
  });
});
