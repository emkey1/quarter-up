import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { T } from '@/data/tuning';
import { World } from '@/game/world';
import { validateLevel } from '@/game/level';
import { emptyActions } from '@/engine/actions';
import proving from '@/data/levels/proving.json';

/**
 * The guard that keeps the graphics upgrade from quietly becoming a gameplay change
 * (DESIGN.md §6.1, §13). Two proofs, structural and behavioural.
 */

function replayHash(): string {
  const r = validateLevel(proving);
  if (!r.ok) throw new Error(r.errors.join('; '));
  const w = new World(r.data, 'elf', 12345);
  const a = emptyActions();

  // A scripted run that exercises movement, walls, corners and the fire models.
  for (let f = 0; f < 900; f++) {
    a.moveX = f % 240 < 60 ? 1 : f % 240 < 120 ? 0 : f % 240 < 180 ? -1 : 0;
    a.moveY = f % 240 < 60 ? 0 : f % 240 < 120 ? 1 : f % 240 < 180 ? 0 : -1;
    a.fire = f % 37 < 9;
    w.step(a);
  }
  const p = w.player;
  return [
    p.x.toFixed(6),
    p.y.toFixed(6),
    p.facing,
    p.health.toFixed(6),
    p.stillFrames,
    w.camera.x.toFixed(6),
    w.camera.y.toFixed(6),
    w.frame,
  ].join('|');
}

describe('ART_SCALE invariance', () => {
  it('produces a bit-identical simulation at every art scale', () => {
    const mutable = T as unknown as { ART_SCALE: number };
    const original = mutable.ART_SCALE;
    try {
      mutable.ART_SCALE = 1;
      const a = replayHash();
      mutable.ART_SCALE = 2;
      const b = replayHash();
      mutable.ART_SCALE = 3;
      const c = replayHash();
      expect(b).toBe(a);
      expect(c).toBe(a);
    } finally {
      mutable.ART_SCALE = original;
    }
  });

  it('is deterministic across runs with the same seed', () => {
    expect(replayHash()).toBe(replayHash());
  });
});

describe('simulation/presentation separation', () => {
  const gameDir = resolve(__dirname, '../src/game');

  it('no module in src/game imports the renderer or the display', () => {
    const offenders: string[] = [];
    for (const f of readdirSync(gameDir)) {
      if (!f.endsWith('.ts')) continue;
      const src = readFileSync(resolve(gameDir, f), 'utf8');
      for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1]!;
        if (/render|display|canvas/i.test(spec)) offenders.push(`${f} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no module in src/game mentions device pixels or the DOM', () => {
    const offenders: string[] = [];
    const banned = /devicePixelRatio|document\.|window\.|CanvasRenderingContext|HTMLCanvas/;
    for (const f of readdirSync(gameDir)) {
      if (!f.endsWith('.ts')) continue;
      const src = readFileSync(resolve(gameDir, f), 'utf8');
      const hit = src.match(banned);
      if (hit) offenders.push(`${f}: ${hit[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});
