import { describe, it, expect } from 'vitest';
import { CharSelectScreen } from '@/ui/charselect';
import { Pointer } from '@/engine/pointer';
import { CLASS_ORDER, type ClassId } from '@/data/classes';
import { emptyActions } from '@/engine/actions';
import type { Layout } from '@/engine/display';

/** A layout shaped like a real 1600x900 window at dpr 1. */
function layout(): Layout {
  return {
    dpr: 1,
    scale: 2,
    uiScale: 2,
    pxPerWu: 4,
    canvasW: 1600,
    canvasH: 900,
    playfield: { x: 300, y: 100, w: 928, h: 960 },
  } as Layout;
}

function harness() {
  const keys = new Set<string>();
  const pointer = new Pointer();
  let chosen: { cls: ClassId; skip: boolean } | null = null;
  let backed = false;
  const cs = new CharSelectScreen(
    (c) => keys.has(c),
    (cls, skip) => {
      chosen = { cls, skip };
    },
    () => {
      backed = true;
    },
    pointer,
    layout,
  );
  cs.enter();

  const frame = () => {
    pointer.poll();
    cs.step(emptyActions(), 0);
    pointer.clicked = false;
  };
  /** Put the cursor somewhere in canvas space and optionally click. */
  const at = (x: number, y: number, click = false) => {
    pointer.x = x;
    pointer.y = y;
    if (click) (pointer as unknown as { pendingClick: boolean }).pendingClick = true;
    frame();
  };
  const key = (code: string) => {
    keys.add(code);
    frame();
    keys.clear();
  };
  return {
    cs,
    at,
    key,
    frame,
    get chosen() {
      return chosen;
    },
    get backed() {
      return backed;
    },
  };
}

/** The card rectangles, recomputed the same way the screen does. */
function cardCentres(): { x: number; y: number }[] {
  const l = layout();
  const s = l.uiScale;
  const n = CLASS_ORDER.length;
  const gap = 12 * s;
  const cardW = Math.min(200 * s, (l.canvasW - 60 * s - (n - 1) * gap) / n);
  const totalW = n * cardW + (n - 1) * gap;
  const x0 = (l.canvasW - totalW) / 2;
  const top = 112 * s;
  const cardH = Math.min(268 * s, l.canvasH - top - 210 * s);
  return CLASS_ORDER.map((_, i) => ({ x: x0 + i * (cardW + gap) + cardW / 2, y: top + cardH / 2 }));
}

describe('character select — keyboard', () => {
  it('moves along the row with left and right', () => {
    // The regression that started all this: up/down were repurposed for the start-point
    // option, so left/right became the ONLY way to change character.
    const h = harness();
    expect(h.cs.selected).toBe('elf');
    h.key('ArrowLeft');
    expect(h.cs.selected).toBe('wizard');
    h.key('ArrowLeft');
    expect(h.cs.selected).toBe('valkyrie');
    h.key('ArrowRight');
    expect(h.cs.selected).toBe('wizard');
  });

  it('can reach every class', () => {
    const h = harness();
    const seen = new Set<ClassId>([h.cs.selected]);
    for (let i = 0; i < CLASS_ORDER.length; i++) {
      h.key('ArrowRight');
      seen.add(h.cs.selected);
    }
    expect([...seen].sort()).toEqual([...CLASS_ORDER].sort());
  });

  it('leaves the class alone when up or down works the start option', () => {
    const h = harness();
    const before = h.cs.selected;
    h.key('ArrowUp');
    expect(h.cs.skipTutorial).toBe(true);
    expect(h.cs.selected, 'changing the start point moved the character too').toBe(before);
  });
});

describe('character select — mouse', () => {
  it('selects the card that was clicked', () => {
    // The reported bug: the cards look like buttons and clicking them did nothing at all,
    // so Elf — the default — was the only character anyone could actually play.
    const centres = cardCentres();
    for (let i = 0; i < CLASS_ORDER.length; i++) {
      const h = harness();
      h.at(centres[i].x, centres[i].y, true);
      expect(h.cs.selected, `clicking card ${i}`).toBe(CLASS_ORDER[i]);
    }
  });

  it('starts the run when the selected card is clicked again', () => {
    const centres = cardCentres();
    const h = harness();
    h.at(centres[0].x, centres[0].y, true);
    expect(h.cs.selected).toBe(CLASS_ORDER[0]);
    expect(h.chosen).toBeNull();
    h.at(centres[0].x, centres[0].y, true);
    expect(h.chosen).toEqual({ cls: CLASS_ORDER[0], skip: false });
  });

  it('does not start the run on the first click of a different card', () => {
    // A click must never be an irreversible commitment made by accident.
    const centres = cardCentres();
    const h = harness();
    h.at(centres[1].x, centres[1].y, true);
    expect(h.chosen).toBeNull();
  });

  it('ignores a click that lands outside every control', () => {
    const h = harness();
    h.at(5, 5, true);
    expect(h.cs.selected).toBe('elf');
    expect(h.chosen).toBeNull();
  });

  it('hovering does not change the selection', () => {
    // Otherwise a mouse resting on the screen fights the arrow keys.
    const centres = cardCentres();
    const h = harness();
    h.at(centres[0].x, centres[0].y);
    expect(h.cs.selected).toBe('elf');
  });

  it('toggles the start point from its row', () => {
    const l = layout();
    const s = l.uiScale;
    const h = harness();
    h.at(l.canvasW / 2, l.canvasH - 76 * s + 16 * s, true);
    expect(h.cs.skipTutorial).toBe(true);
  });

  it('begins from the begin button', () => {
    const l = layout();
    const s = l.uiScale;
    const h = harness();
    h.at(l.canvasW / 2, l.canvasH - 42 * s + 15 * s, true);
    expect(h.chosen).toEqual({ cls: 'elf', skip: false });
  });
});

describe('the pointer', () => {
  it('reports a click for exactly one frame', () => {
    const p = new Pointer();
    (p as unknown as { pendingClick: boolean }).pendingClick = true;
    p.poll();
    expect(p.clicked).toBe(true);
    p.poll();
    expect(p.clicked, 'a single click fired on two frames').toBe(false);
  });

  it('hit-tests in canvas space', () => {
    const p = new Pointer();
    p.x = 50;
    p.y = 50;
    expect(p.over(0, 0, 100, 100)).toBe(true);
    expect(p.over(60, 0, 100, 100)).toBe(false);
    expect(p.hit(0, 0, 100, 100), 'hit without a click').toBe(false);
  });

  it('is not over anything before the cursor has been seen', () => {
    const p = new Pointer();
    expect(p.over(0, 0, 10_000, 10_000)).toBe(false);
  });
});
