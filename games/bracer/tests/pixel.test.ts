import { describe, it, expect } from 'vitest';
import { Px, palette, ramp, TRANSPARENT } from '@cabinet/pixel';
import { wallTile, floorTile, TILE_PX } from '@/render/tilegen';
import { NB } from '@cabinet/autotile';

describe('pixel buffer', () => {
  it('leaves everything transparent until drawn', () => {
    const p = new Px(8, 8);
    expect(p.at(0, 0)).toBe(TRANSPARENT);
    expect([...p.data].every((v) => v === TRANSPARENT)).toBe(true);
  });

  it('clips writes outside its bounds instead of corrupting neighbours', () => {
    const p = new Px(4, 4);
    p.set(-1, 0, 5);
    p.set(0, -1, 5);
    p.set(4, 0, 5);
    p.rect(-2, -2, 3, 3, 6);
    expect(p.at(0, 0)).toBe(6);
    expect(p.data.length).toBe(16);
  });

  it('wraps a silhouette in a 1px outline without touching the interior', () => {
    const p = new Px(8, 8);
    p.rect(3, 3, 2, 2, 4);
    p.outline(1);
    expect(p.at(3, 3), 'interior untouched').toBe(4);
    expect(p.at(2, 3), 'left edge outlined').toBe(1);
    expect(p.at(5, 3)).toBe(1);
    expect(p.at(3, 2)).toBe(1);
    expect(p.at(2, 2), 'diagonal outlined too').toBe(1);
    expect(p.at(0, 0), 'far away stays clear').toBe(TRANSPARENT);
  });

  it('mirrors exactly, so a facing and its mirror are the same drawing', () => {
    const p = new Px(4, 2);
    p.set(0, 0, 3);
    p.set(3, 1, 5);
    const m = p.mirrorX();
    expect(m.at(3, 0)).toBe(3);
    expect(m.at(0, 1)).toBe(5);
  });

  it('shades toward the light without leaving the ramp', () => {
    const p = new Px(8, 8);
    p.ellipse(4, 4, 3, 3, 4); // ramp slot "base"
    p.shadePass(0);
    for (const v of p.data) {
      if (v === TRANSPARENT) continue;
      expect(v, 'must stay within the 5-step ramp').toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  it('dithers between two indices in a checkerboard', () => {
    const p = new Px(4, 4);
    p.rect(0, 0, 4, 4, 4);
    p.dither(0, 0, 4, 4, 2, 6);
    expect(p.at(0, 0)).toBe(2);
    expect(p.at(1, 0)).toBe(6);
    expect(p.at(0, 1)).toBe(6);
    expect(p.at(1, 1)).toBe(2);
  });

  it('builds a palette with a transparent slot 0 and six entries per ramp', () => {
    const pal = palette(ramp('#808080'), ramp('#404040'));
    expect(pal.length).toBe(13);
    expect(pal[0]).toContain('rgba');
  });

  it('produces a ramp that actually runs dark to light', () => {
    const r = ramp('#808080');
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16);
    expect(lum(r.darkest)).toBeLessThan(lum(r.dark));
    expect(lum(r.dark)).toBeLessThan(lum(r.base));
    expect(lum(r.base)).toBeLessThan(lum(r.light));
    expect(lum(r.light)).toBeLessThan(lum(r.lightest));
  });
});

describe('tile generation', () => {
  it('fills every pixel of a wall tile — no holes in the maze', () => {
    const p = wallTile(0, 1);
    expect(p.w).toBe(TILE_PX);
    expect([...p.data].every((v) => v !== TRANSPARENT)).toBe(true);
  });

  it('gives an isolated block a lit top edge and a shadowed bottom', () => {
    const p = wallTile(0, 1); // no neighbours at all
    const top = p.at(16, 0);
    const bottom = p.at(16, TILE_PX - 1);
    expect(top, 'top should be the lightest step').toBeGreaterThan(bottom);
  });

  it('seams the top edge instead of lighting it when the wall continues north', () => {
    const lit = wallTile(0, 1).at(16, 0);
    const seamed = wallTile(NB.N, 1).at(16, 0);
    expect(seamed).not.toBe(lit);
    expect(seamed, 'a continuing edge is mortar, not highlight').toBeLessThan(lit);
  });

  it('varies floor tiles so a big room is not one stamp repeated', () => {
    const a = floorTile(0);
    const b = floorTile(1);
    let diff = 0;
    for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) diff++;
    expect(diff).toBeGreaterThan(50);
  });

  it('is deterministic — the same tile always looks the same, so the maze cannot shimmer', () => {
    const a = wallTile(NB.N | NB.E, 3);
    const b = wallTile(NB.N | NB.E, 3);
    expect([...a.data]).toEqual([...b.data]);
  });
});
