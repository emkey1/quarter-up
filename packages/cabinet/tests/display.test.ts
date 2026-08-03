import { describe, it, expect, vi, afterEach } from 'vitest';
import { Display } from '../src/display';
import type { DisplayConfig } from '../src/config';

/**
 * The world-to-screen bridge.
 *
 * This file had no test in either game before it was shared, which was uncomfortable
 * for the one piece of code that decides how big everything is — and it became urgent
 * when extraction turned a difference between the two copies into a config flag. The
 * flank policy below is that flag, and both games' answers are pinned here.
 */

/** Enough DOM to construct a Display. Canvas is a bag of properties; nothing draws. */
function stubDom(innerWidth: number, innerHeight: number, dpr = 1) {
  const canvas = {
    width: 0,
    height: 0,
    style: {} as Record<string, string>,
    getContext: () => ({ imageSmoothingEnabled: true }),
  };
  vi.stubGlobal('document', { createElement: () => canvas });
  vi.stubGlobal('window', {
    innerWidth,
    innerHeight,
    devicePixelRatio: dpr,
    addEventListener: () => {},
    removeEventListener: () => {},
    // Display re-fits when the window moves between monitors of different density.
    matchMedia: () => ({ addEventListener: () => {}, removeEventListener: () => {} }),
  });
  return { parent: { appendChild: () => {} } as unknown as HTMLElement };
}

/** Bracer's numbers: a 232x240 viewport at 2px per world unit. */
const BRACER: DisplayConfig = {
  viewW: 232,
  viewH: 240,
  artScale: 2,
  scaleMin: 1,
  scaleMax: 4,
  keepRightPanel: true,
};

const DOUBLE_BUBBLE: DisplayConfig = { ...BRACER, keepRightPanel: false };

afterEach(() => vi.unstubAllGlobals());

describe('display scaling', () => {
  it('picks the largest integer scale that fits, and never a fractional one', () => {
    // 1600x1000 against a 464x480 art size fits 3.44x across but only 2.08x down, and
    // the smaller wins or the playfield is cut off. 2.08 must land on 2: a fractional
    // scale on pixel art means some pixels come out bigger than others.
    const { parent } = stubDom(1600, 1000);
    const d = new Display(parent, BRACER);
    expect(d.layout.scale).toBe(2);
    expect(d.layout.pxPerWu).toBe(4); // artScale 2 * scale 2
  });

  it('clamps to the configured range rather than vanishing or overflowing', () => {
    const tiny = new Display(stubDom(320, 200).parent, BRACER);
    expect(tiny.layout.scale, 'below minimum').toBe(1);
    vi.unstubAllGlobals();

    const huge = new Display(stubDom(8000, 6000).parent, BRACER);
    expect(huge.layout.scale, 'above maximum').toBe(4);
  });

  it('centres the playfield', () => {
    const { parent } = stubDom(1600, 1000);
    const { playfield, canvasW, canvasH } = new Display(parent, BRACER).layout;
    expect(playfield.x).toBe(Math.floor((canvasW - playfield.w) / 2));
    expect(playfield.y).toBe(Math.floor((canvasH - playfield.h) / 2));
  });

  it('accounts for device pixel ratio in the canvas but not the CSS size', () => {
    const { parent } = stubDom(1600, 1000, 2);
    const d = new Display(parent, BRACER);
    expect(d.layout.dpr).toBe(2);
    expect(d.layout.canvasW).toBe(3200);
    expect(d.canvas.style.width).toBe('1600px');
  });

  describe('HUD flanks', () => {
    it('offers both when the window is wide enough to afford them', () => {
      // 2400 wide, scale 2: a 928px playfield with ~736px either side.
      const { parent } = stubDom(2400, 1000);
      const { leftPanel, rightPanel } = new Display(parent, BRACER).layout;
      expect(leftPanel).not.toBeNull();
      expect(rightPanel).not.toBeNull();
      expect(leftPanel!.w).toBeGreaterThanOrEqual(168);
    });

    it('drops the left flank when the window is too narrow, for both games', () => {
      // The left flank is a debug readout in one game and absent in the other; neither
      // has anything that breaks when it goes.
      for (const cfg of [BRACER, DOUBLE_BUBBLE]) {
        const { parent } = stubDom(700, 900);
        expect(new Display(parent, cfg).layout.leftPanel).toBeNull();
        vi.unstubAllGlobals();
      }
    });

    it('keeps a cramped right flank for a game with no fallback, drops it for one with', () => {
      // The whole of `keepRightPanel`. Bracer draws health, score, keys and potions
      // there and has no compact overlay to fall back on, so a narrow window gets a
      // squeezed panel rather than no readout. Double Bubble's HUD sits over the
      // playfield already, so it simply loses the flank.
      const narrow = () => stubDom(700, 900).parent; // 464px playfield, 118px gaps

      const bracer = new Display(narrow(), BRACER).layout;
      expect(bracer.leftPanel, 'left goes either way').toBeNull();
      expect(bracer.rightPanel, 'Bracer would lose its only readout').not.toBeNull();
      vi.unstubAllGlobals();

      expect(new Display(narrow(), DOUBLE_BUBBLE).layout.rightPanel).toBeNull();
    });

    it('never reports a negative-width flank', () => {
      // The cramped branch subtracts the playfield's right edge from the canvas width,
      // which can go negative when the playfield is wider than the window.
      const { parent } = stubDom(400, 900);
      const { rightPanel } = new Display(parent, BRACER).layout;
      expect(rightPanel!.w).toBeGreaterThanOrEqual(0);
    });
  });
});
