import { describe, it, expect } from 'vitest';
import { T, bandOf } from '@/data/tuning';
import { Cell, Field } from '@/game/field';
import { Digger, Dir } from '@/game/digger';
import { World } from '@/game/world';
import { LAYOUTS } from '@/data/layouts';

/** A world on the first layout, which is the gentlest and the most predictable. */
const world = (level = 1) => new World(LAYOUTS[0], level);

/**
 * Park the cast: alive, so the round does not report itself clear, but inert and out of
 * the way.
 *
 * Needed because these tests are about one mechanic each, and a world with four enemies
 * hunting the player kills it partway through and the measurement becomes about
 * something else. Held rather than deleted, because an empty round is a different code
 * path now.
 */
function park(w: World): void {
  for (const e of w.enemies) {
    e.x = T.CELL / 2;
    e.y = T.CELL / 2;
    e.inflation = Number.MAX_SAFE_INTEGER;
  }
}

/** Run the digger in one direction for N frames. */
function drive(w: World, dir: Dir, frames: number): void {
  for (let i = 0; i < frames; i++) w.step({ dir });
}

describe('the field', () => {
  it('is sky above and solid earth below, with nothing pre-dug', () => {
    const f = new Field();
    for (let cx = 0; cx < T.GRID_W; cx++) {
      expect(f.at(cx, 0)).toBe(Cell.Sky);
      expect(f.at(cx, T.SKY_ROWS - 1)).toBe(Cell.Sky);
      expect(f.at(cx, T.SKY_ROWS)).toBe(Cell.Earth);
      expect(f.at(cx, T.GRID_H - 1)).toBe(Cell.Earth);
    }
  });

  it('divides the earth into four equal bands', () => {
    expect(bandOf(0), 'sky is not a band').toBe(-1);
    expect(bandOf(T.SKY_ROWS)).toBe(0);
    expect(bandOf(T.GRID_H - 1)).toBe(T.BANDS - 1);

    const counts = new Map<number, number>();
    for (let cy = T.SKY_ROWS; cy < T.GRID_H; cy++) {
      counts.set(bandOf(cy), (counts.get(bandOf(cy)) ?? 0) + 1);
    }
    expect([...counts.values()], 'bands must be equal or depth scoring is unfair').toEqual(
      Array.from({ length: T.BANDS }, () => T.BAND_ROWS),
    );
  });

  it('reads out of bounds as earth, so nothing walks off the world', () => {
    const f = new Field();
    expect(f.at(-1, 5)).toBe(Cell.Earth);
    expect(f.at(T.GRID_W, 5)).toBe(Cell.Earth);
    expect(f.isOpen(-1, 5)).toBe(false);
  });

  it('never converts sky into tunnel', () => {
    // Sky is already open. Digging it would make the escape strip autotile as though it
    // had been cut, which it has not.
    const f = new Field();
    expect(f.dig(3, 0)).toBe(false);
    expect(f.at(3, 0)).toBe(Cell.Sky);
  });

  it('reports a change only the first time a cell is cut', () => {
    const f = new Field();
    expect(f.dig(3, 10)).toBe(true);
    expect(f.dig(3, 10), 'already open').toBe(false);
  });
});

describe('digging', () => {
  it('starts in a short pre-cut tunnel with a way up to the sky', () => {
    // A digger that begins entombed cannot demonstrate that running a tunnel is faster
    // than cutting one, which is the first thing the game has to teach.
    const w = world();
    park(w);
    const { cellX, cellY } = w.digger;
    expect(w.field.at(cellX, cellY)).toBe(Cell.Tunnel);
    expect(w.field.at(cellX - 1, cellY)).toBe(Cell.Tunnel);
    expect(w.field.at(cellX + 1, cellY)).toBe(Cell.Tunnel);
    expect(w.field.isOpen(cellX, cellY - 1), 'no route to the surface').toBe(true);
  });

  it('carves earth by moving into it', () => {
    // Driven far enough to run out of the layout's pre-cut shaft and into virgin ground.
    // The first version stopped one cell down, which on this layout is already open —
    // it was measuring the pre-dug network rather than any digging.
    const w = world();
    park(w);
    const col = w.digger.cellX;

    let firstEarth = w.digger.cellY + 1;
    while (firstEarth < T.GRID_H && w.field.at(col, firstEarth) !== Cell.Earth) firstEarth++;
    expect(firstEarth, 'this layout has no earth below the start at all').toBeLessThan(T.GRID_H);

    drive(w, Dir.Down, 60 * 10);
    expect(w.field.at(col, firstEarth)).toBe(Cell.Tunnel);
  });

  it('cuts a tunnel exactly one cell wide', () => {
    // The point of lane-locking. Without it the digger drifts off the row centre,
    // straddles two rows and carves a two-cell trench that looks nothing like a tunnel.
    const w = world();
    park(w);
    const row = w.digger.cellY;
    const startCol = w.digger.cellX;
    drive(w, Dir.Right, 300);

    for (let cx = startCol + 2; cx < T.GRID_W; cx++) {
      // From startCol + 2 rightward: the start column has a deliberate shaft up to the
      // sky, and the pre-cut tunnel spans startCol +/- 1. Everything beyond that was cut
      // by this run and nothing else.
      if (w.field.at(cx, row) !== Cell.Tunnel) continue;
      expect(w.field.at(cx, row - 1), `row above ${cx} was cut too`).not.toBe(Cell.Tunnel);
      expect(w.field.at(cx, row + 1), `row below ${cx} was cut too`).not.toBe(Cell.Tunnel);
    }
  });

  it('leaves no plug of earth behind in a finished tunnel', () => {
    // Cells have to be cleared as the body passes through them, not merely as it stops
    // in them, or a fast pass leaves an uncut cell in the middle of an open run.
    const w = world();
    park(w);
    const row = w.digger.cellY;
    const from = w.digger.cellX;
    drive(w, Dir.Right, 300);
    const to = w.digger.cellX;

    for (let cx = from; cx <= to; cx++) {
      expect(w.field.at(cx, row), `cell ${cx} was skipped`).toBe(Cell.Tunnel);
    }
  });

  it('runs an existing tunnel faster than it cuts fresh earth', () => {
    // The single most load-bearing relationship in the game: if these were equal, the
    // network the player digs would be scenery rather than infrastructure.
    // Measured on two identical fields, one with the row already open and one solid, over
    // a short enough run that neither can reach the end of what it is measuring. Driving
    // one digger out and back does NOT work: the return leg runs out of tunnel partway
    // and starts cutting again, which quietly averages the two speeds together.
    const FRAMES = 20;
    const row = 8;
    const col = 2;

    const open = new Field();
    for (let cx = 0; cx < T.GRID_W; cx++) open.dig(cx, row);
    const runner = new Digger(col, row);
    for (let i = 0; i < FRAMES; i++) runner.step(open, { dir: Dir.Right });
    const ran = runner.x - (col * T.CELL + T.CELL / 2);

    const solid = new Field();
    solid.dig(col, row); // somewhere to stand; everything ahead is earth
    const cutter = new Digger(col, row);
    for (let i = 0; i < FRAMES; i++) cutter.step(solid, { dir: Dir.Right });
    const cut = cutter.x - (col * T.CELL + T.CELL / 2);

    expect(ran, 'running a tunnel should outpace cutting').toBeGreaterThan(cut);
    expect(ran).toBeCloseTo(FRAMES * T.MOVE_SPEED, 5);
    expect(cut).toBeCloseTo(FRAMES * T.DIG_SPEED, 5);
  });

  it('never ends a turn inside earth it did not remove', () => {
    // Four-way movement on a grid needs a rule for when a turn is legal. Too loose and
    // the digger corner-cuts, ending up embedded in a cell it never cut.
    const w = world();
    park(w);
    const dirs = [Dir.Down, Dir.Right, Dir.Up, Dir.Left, Dir.Down, Dir.Left];
    for (const dir of dirs) {
      drive(w, dir, 37); // deliberately not a whole number of cells
      expect(
        w.field.at(w.digger.cellX, w.digger.cellY),
        `digger is inside earth at ${w.digger.cellX},${w.digger.cellY}`,
      ).not.toBe(Cell.Earth);
    }
  });

  it('stops at the edge of the world rather than leaving it', () => {
    const w = world();
    park(w);
    drive(w, Dir.Left, 2000);
    expect(w.digger.x).toBeGreaterThanOrEqual(0);
    expect(w.digger.cellX).toBe(0);
  });

  it('stands still when asked for nothing', () => {
    const w = world();
    park(w);
    const { x, y } = w.digger;
    drive(w, Dir.None, 60);
    expect(w.digger.x).toBe(x);
    expect(w.digger.y).toBe(y);
  });
});

describe('the digger on its own', () => {
  it('places itself at the centre of the cell it is given', () => {
    const d = new Digger(3, 5);
    expect(d.x).toBe(3 * T.CELL + T.CELL / 2);
    expect(d.y).toBe(5 * T.CELL + T.CELL / 2);
    expect(d.cellX).toBe(3);
    expect(d.cellY).toBe(5);
  });

  it('reports digging on the frame a cell actually opens, not on contact with it', () => {
    // A cell opens when the CENTRE arrives in it, which takes a full cell of travel at
    // the slow rate — so `digging` is a rare, meaningful frame rather than every frame
    // spent pressed against earth. The dig sound hangs off this.
    const f = new Field();
    f.dig(5, 10);
    const d = new Digger(5, 10);

    const frames: boolean[] = [];
    const toCross = Math.ceil(T.CELL / T.DIG_SPEED);
    for (let i = 0; i < toCross + 2; i++) {
      d.step(f, { dir: Dir.Down });
      frames.push(d.digging);
    }
    expect(frames.filter(Boolean).length, 'exactly one cell should have opened').toBe(1);
    expect(frames[0], 'not on the first frame — nothing has been reached yet').toBe(false);

    // Over ground already cut, it never reports digging at all.
    const open = new Field();
    for (let cy = 10; cy < 16; cy++) open.dig(5, cy);
    const d2 = new Digger(5, 10);
    for (let i = 0; i < 40; i++) {
      d2.step(open, { dir: Dir.Down });
      expect(d2.digging, 'nothing to dig here').toBe(false);
    }
  });
});
