import { describe, it, expect, vi, afterEach } from 'vitest';
import { T } from '@/data/tuning';
import { Field } from '@/game/field';
import { Digger, Dir } from '@/game/digger';
import { FieldView } from '@/render/fieldview';
import { BLOB_COUNT, blobIndex, neighbourMask, reduceMask, NB } from '@/render/autotile';
import type { Layout } from '@cabinet/display';

/**
 * The draw path, exercised headlessly.
 *
 * The browser pane on this machine reports the page as hidden and never runs
 * requestAnimationFrame, so "I looked at it and it rendered" is not available as
 * verification. Rather than trust a build that merely didn't throw, the render path runs
 * here against a recording context: it proves the field draws every cell, picks the
 * right atlas row for each, and puts the digger where the simulation says it is.
 *
 * This is not a substitute for looking at it — colour, readability and whether a tunnel
 * looks like a tunnel are M4 questions and need eyes. It is a guard against the draw
 * path being silently broken.
 */

interface Blit {
  sx: number;
  sy: number;
  dx: number;
  dy: number;
}

/** A 2D context that records drawImage calls and ignores everything else. */
function recordingCtx(): { ctx: CanvasRenderingContext2D; blits: Blit[] } {
  const blits: Blit[] = [];
  const ctx = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    rect: () => {},
    clip: () => {},
    fillRect: () => {},
    fillText: () => {},
    drawImage: (_img: unknown, sx: number, sy: number, _sw: number, _sh: number, dx: number, dy: number) => {
      blits.push({ sx, sy, dx, dy });
    },
    imageSmoothingEnabled: true,
    fillStyle: '',
    font: '',
    textAlign: 'left',
  } as unknown as CanvasRenderingContext2D;
  return { ctx, blits };
}

/** A stub atlas: FieldView only ever asks it for source rectangles. */
function stubAtlas() {
  return {
    canvas: {} as HTMLCanvasElement,
    tilePx: 32,
    src: (row: number, col: number): [number, number, number, number] => [col * 32, row * 32, 32, 32],
  };
}

const layout: Layout = {
  dpr: 1,
  scale: 1,
  pxPerWu: 1,
  uiScale: 1,
  canvasW: T.VIEW_W,
  canvasH: T.VIEW_H,
  playfield: { x: 0, y: 0, w: T.VIEW_W, h: T.VIEW_H },
  leftPanel: null,
  rightPanel: null,
};

afterEach(() => vi.restoreAllMocks());

describe('the field renderer', () => {
  it('draws every cell of the field, plus the digger', () => {
    const view = new FieldView(stubAtlas() as never);
    const f = new Field();
    const d = new Digger(7, 5);
    const { ctx, blits } = recordingCtx();

    view.draw(ctx, f, d, layout);

    expect(blits.length).toBe(T.GRID_W * T.GRID_H + 1);
  });

  it('puts the digger at its world position, not its cell', () => {
    // Motion between cells has to be smooth. Drawing by cell would step a whole tile at
    // a time, which at this cell size is very visible.
    const view = new FieldView(stubAtlas() as never);
    const f = new Field();
    const d = new Digger(7, 5);
    for (let i = 0; i < 10; i++) d.step(f, { dir: Dir.Down }); // mid-cell

    const { ctx, blits } = recordingCtx();
    view.draw(ctx, f, d, layout);

    const digger = blits[blits.length - 1];
    expect(digger.dy).toBe(Math.round(d.y - T.CELL / 2));
    expect(digger.dy % T.CELL, 'digger snapped to a cell boundary').not.toBe(0);
  });

  it('re-autotiles only when the field has actually changed', () => {
    // Terrain changes on nearly every frame the player moves, which is the opposite of
    // Bracer's usage, so the version check earns its keep here rather than being
    // inherited decoration.
    const view = new FieldView(stubAtlas() as never);
    const f = new Field();
    const d = new Digger(7, 5);
    const spy = vi.spyOn(f, 'clearDirty');

    const { ctx } = recordingCtx();
    view.draw(ctx, f, d, layout);
    view.draw(ctx, f, d, layout);
    expect(spy, 'nothing changed; masks should not be rebuilt').toHaveBeenCalledTimes(1);

    f.dig(3, 9);
    view.draw(ctx, f, d, layout);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('autotiling', () => {
  it('reduces 256 neighbour configurations to the 47 a blob set needs', () => {
    expect(BLOB_COUNT).toBe(47);
  });

  it('ignores a diagonal whose cardinals are not both filled', () => {
    // The whole reason 256 collapses to 47: with N or E missing, the NE corner is
    // already an outside corner and the diagonal cannot be seen.
    expect(reduceMask(NB.NE)).toBe(reduceMask(0));
    expect(reduceMask(NB.N | NB.E | NB.NE)).not.toBe(reduceMask(NB.N | NB.E));
  });

  it('gives fully-enclosed earth a different tile from an exposed face', () => {
    const enclosed = blobIndex(0xff);
    const exposedNorth = blobIndex(0xff & ~NB.N);
    expect(enclosed).not.toBe(exposedNorth);
  });

  it('treats the sky as not-earth, so the surface autotiles as a surface', () => {
    // If sky counted as earth, the top row of the field would tile as though it had
    // something solid above it and the earth line would vanish.
    const f = new Field();
    const isEarth = (x: number, y: number) => (!f.inBounds(x, y) ? y >= T.SKY_ROWS : f.at(x, y) === 0);
    const mask = neighbourMask(5, T.SKY_ROWS, isEarth);
    expect(mask & NB.N, 'the cell above the earth line is sky').toBe(0);
    expect(mask & NB.S, 'below it is more earth').not.toBe(0);
  });
});
