import { describe, it, expect } from 'vitest';
import { LEVEL_TYPES, generateLevel } from '../tools/levelgen.mjs';
import { validateLevel } from '@/game/level';
import { analyseLevel } from '@/game/analyse';
import { World } from '@/game/world';
import { T } from '@/data/tuning';

const SEEDS = [1, 2, 7, 42, 123, 999];
const DEPTHS = [1, 10, 25, 40];

describe('random level generation', () => {
  it('offers six types, each with a label and a description', () => {
    expect(LEVEL_TYPES.length).toBe(6);
    for (const t of LEVEL_TYPES) {
      expect(t.id, 'a type has no id').toBeTruthy();
      expect(t.label, `${t.id} has no label`).toBeTruthy();
      expect(t.blurb.length, `${t.id} has no description`).toBeGreaterThan(20);
    }
    expect(new Set(LEVEL_TYPES.map((t) => t.id)).size, 'duplicate type id').toBe(6);
  });

  it('produces a structurally valid level every time', () => {
    for (const t of LEVEL_TYPES) {
      for (const seed of SEEDS) {
        for (const depth of DEPTHS) {
          const r = validateLevel(generateLevel({ type: t.id, depth, seed }));
          expect(r.ok, `${t.id} seed ${seed} depth ${depth}: ${r.ok ? '' : r.errors.join('; ')}`).toBe(true);
        }
      }
    }
  });

  it('produces a PLAYABLE level every time', () => {
    // The generator carries a safety net — it re-checks reachability and carves a
    // corridor if anything ended up walled in. This is the assertion that the net works,
    // across every type, seed and depth. A generator that can emit an unplayable level is
    // one you cannot trust, and "usually fine" is not a property worth having.
    for (const t of LEVEL_TYPES) {
      for (const seed of SEEDS) {
        for (const depth of DEPTHS) {
          const a = analyseLevel(generateLevel({ type: t.id, depth, seed }));
          expect(a.errors, `${t.id} seed ${seed} depth ${depth}`).toEqual([]);
        }
      }
    }
  });

  it('is deterministic — same type, depth and seed, same level', () => {
    // What makes a seed worth showing the user: find one you like, note the number, get
    // it back.
    for (const t of LEVEL_TYPES) {
      const a = generateLevel({ type: t.id, depth: 12, seed: 5150 });
      const b = generateLevel({ type: t.id, depth: 12, seed: 5150 });
      expect(JSON.stringify(a), `${t.id} is not reproducible`).toBe(JSON.stringify(b));
    }
  });

  it('actually varies with the seed', () => {
    // Determinism is worthless if every seed gives the same room.
    for (const t of LEVEL_TYPES) {
      const shapes = new Set(
        SEEDS.map((seed) => generateLevel({ type: t.id, depth: 12, seed }).tiles.join('')),
      );
      expect(shapes.size, `${t.id} ignores its seed`).toBeGreaterThan(1);
    }
  });

  it('gives each type a recognisably different shape', () => {
    // The types have to be types. If two of them produce the same terrain there are not
    // six choices, there are fewer and a longer menu.
    const shapes = LEVEL_TYPES.map((t) => generateLevel({ type: t.id, depth: 12, seed: 77 }).tiles.join(''));
    expect(new Set(shapes).size, 'two types generate identical terrain').toBe(LEVEL_TYPES.length);
  });

  it('meets the same density floors as the shipped campaign', () => {
    const tilesPerScreen = (T.VIEW_W / T.TILE) * (T.VIEW_H / T.TILE);
    for (const t of LEVEL_TYPES) {
      for (const depth of DEPTHS) {
        const lvl = generateLevel({ type: t.id, depth, seed: 31 });
        const screens = analyseLevel(lvl).reachable.size / tilesPerScreen;
        const perScreen = lvl.objects.filter((o) => o.t === 'gen').length / screens;
        expect(perScreen, `${t.id} depth ${depth}: ${perScreen.toFixed(2)} generators/screen`).toBeGreaterThan(1.8);
        expect(lvl.objects.filter((o) => o.t === 'food').length, `${t.id} depth ${depth} has no food`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('ramps with depth rather than ignoring it', () => {
    for (const t of LEVEL_TYPES) {
      const shallow = generateLevel({ type: t.id, depth: 1, seed: 9 });
      const deep = generateLevel({ type: t.id, depth: 40, seed: 9 });
      const gens = (l: typeof shallow) => l.objects.filter((o) => o.t === 'gen').length;
      expect(gens(deep), `${t.id} is no busier at depth 40 than at depth 1`).toBeGreaterThan(gens(shallow));
    }
  });

  it('loads into the real game', () => {
    // Structural validity is not the same as the simulation accepting it.
    for (const t of LEVEL_TYPES) {
      const lvl = generateLevel({ type: t.id, depth: 15, seed: 3 });
      const w = new World(lvl, 'elf', 1);
      expect(w.terrain.solidAt(w.player.x, w.player.y), `${t.id}: spawned in a wall`).toBe(false);
      expect(w.generators.length, `${t.id}: no generators survived loading`).toBeGreaterThan(0);
      // And it runs without throwing.
      for (let i = 0; i < 120; i++) w.step({ moveX: 1, moveY: 0, fire: false, magic: false, faceLock: false, pause: false, pausePressed: false, confirm: false, cancel: false } as never);
      expect(w.frame).toBe(120);
    }
  });

  it('falls back rather than throwing on an unknown type', () => {
    const lvl = generateLevel({ type: 'nonsense', depth: 5, seed: 1 });
    expect(analyseLevel(lvl).errors).toEqual([]);
  });
});
