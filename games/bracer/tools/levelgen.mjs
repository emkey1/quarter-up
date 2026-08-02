/**
 * Random level generation, for the editor.
 *
 * Six archetypes, each a recipe of the §11 design vocabulary with its parameters shaken
 * by a seed. Being straight about what this is, same as the campaign: it is not a maze
 * algorithm and it is not noise. Each type describes a *kind of problem* — a warren of
 * nests, a field of cover, a vault behind a key — and randomness varies where and how
 * much, never what the level is about. A level that could be anything is a level about
 * nothing.
 *
 * Deliberately shares levelkit with tools/mkcampaign.mjs rather than reimplementing the
 * patterns, so a fix to `nest()` reaches the editor and the shipped campaign at once.
 * Pure JS with no Node imports, because this is bundled into the browser editor.
 *
 * Every generated level is finished the same way the campaign's are — density floors,
 * stray relocation, reachability — and then CHECKED, with a corridor carved from start to
 * exit if anything went wrong. A generator that can emit an unplayable level is a
 * generator you cannot trust, and "usually fine" is not a property worth having.
 */
import {
  N, blank, border, box, fill, hline, vline, set, obj, rng, analyse, relocateStrays,
  nest, keyDoorGate, coverLattice, pillarField, lobberGallery, deathCorridor,
  foodGauntlet, treasureVault, serpentine, chamber, corridorCross,
  spreadCells, genFloor, foodFloor, finish,
} from './levelkit.mjs';

/** The six. `id` is what the editor stores; `label` and `blurb` are what it shows. */
export const LEVEL_TYPES = [
  {
    id: 'warren',
    label: 'Warren',
    blurb: 'Several nests off a corridor cross. The bread-and-butter level.',
  },
  {
    id: 'lattice',
    label: 'Cover field',
    blurb: 'A wide diagonal lattice with the nests behind it. Rewards a small shot.',
  },
  {
    id: 'vault',
    label: 'Key vault',
    blurb: 'Treasure and an upgrade sealed behind a door, with the key the long way round.',
  },
  {
    id: 'serpent',
    label: 'Serpentine',
    blurb: 'Switchback corridors with a lobber gallery firing over the walls.',
  },
  {
    id: 'hall',
    label: 'Pillar hall',
    blurb: 'One big room broken by pillars. Nowhere to hide, everywhere to dodge.',
  },
  {
    id: 'gauntlet',
    label: 'Death run',
    blurb: 'A death corridor between you and the food. Bring a potion.',
  },
];

const KINDS = ['grunt', 'ghost', 'demon', 'sorcerer', 'lobber'];

/** Monster kinds available at this depth — the roster opens up as you go deeper. */
function rosterFor(depth, r) {
  const n = Math.max(1, Math.min(KINDS.length, 2 + Math.floor(depth / 8)));
  const pool = KINDS.slice(0, n);
  return [pool[Math.floor(r() * pool.length)], pool[Math.floor(r() * pool.length)]];
}

function lvlFor(depth) {
  return depth < 10 ? 1 : depth < 22 ? 2 : 3;
}

/** Pick one of the four corners, so start and exit are never in the same place twice. */
function corners(r) {
  const pad = 3;
  const far = N - 4;
  const spots = [
    [pad, pad],
    [far, pad],
    [pad, far],
    [far, far],
  ];
  const i = Math.floor(r() * 4);
  return { start: spots[i], exit: spots[(i + 2) % 4] };
}

/* ------------------------------------------------------------------ the six */

const RECIPES = {
  warren(g, depth, r) {
    const { start, exit } = corners(r);
    fill(g, 2, 2, N - 3, N - 3, '.');
    corridorCross(g, { cx: Math.round(N / 2), cy: Math.round(N / 2) });
    const roster = rosterFor(depth, r);
    const count = 2 + Math.floor(r() * 3);
    for (let i = 0; i < count; i++) {
      const w = 9 + Math.floor(r() * 6);
      const h = 9 + Math.floor(r() * 6);
      const x = 4 + Math.floor(r() * (N - 10 - w));
      const y = 4 + Math.floor(r() * (N - 10 - h));
      nest(g, {
        x, y, w, h,
        kinds: roster,
        level: lvlFor(depth),
        count: 3 + Math.floor(r() * 4),
        opening: 'nsew'[Math.floor(r() * 4)],
        r,
      });
    }
    return { start, exit };
  },

  lattice(g, depth, r) {
    const { start, exit } = corners(r);
    fill(g, 2, 2, N - 3, N - 3, '.');
    const x0 = 6 + Math.floor(r() * 4);
    const y0 = 6 + Math.floor(r() * 4);
    coverLattice(g, { x0, y0, x1: N - 8, y1: N - 8, step: 3 + Math.floor(r() * 2) });
    nest(g, {
      x: N - 16, y: 4, w: 11, h: 11,
      kinds: rosterFor(depth, r),
      level: lvlFor(depth),
      count: 4 + Math.floor(r() * 3),
      opening: 's',
      r,
    });
    obj(g, { t: 'potion', x: 4, y: Math.round(N / 2) });
    return { start, exit };
  },

  vault(g, depth, r) {
    const { start, exit } = corners(r);
    fill(g, 2, 2, N - 3, N - 3, '.');
    const vx = 8 + Math.floor(r() * 8);
    const vy = 8 + Math.floor(r() * 8);
    // The key goes on the far side of the level from the door it opens, so fetching it
    // is a decision about exposure rather than a two-step detour.
    keyDoorGate(g, {
      x: vx, y: vy, w: 18, h: 16,
      side: 'w', at: vy + 6,
      keyAt: [N - 1 - vx, N - 1 - vy],
      kinds: rosterFor(depth, r),
      level: lvlFor(depth),
      count: 4 + Math.floor(r() * 3),
      r,
    });
    treasureVault(g, { x0: vx + 3, y0: vy + 3, x1: vx + 14, y1: vy + 12 });
    obj(g, { t: 'upgrade', x: vx + 9, y: vy + 8, kind: 'shotPower' });
    return { start, exit };
  },

  serpent(g, depth, r) {
    const { start, exit } = corners(r);
    fill(g, 2, 2, N - 3, N - 3, '.');
    serpentine(g, { x0: 4, y0: 6, x1: N - 5, y1: N - 10, gap: 4 + Math.floor(r() * 2) });
    lobberGallery(g, {
      x0: 5, y0: N - 8, x1: N - 6, y1: N - 6,
      level: lvlFor(depth),
      count: 2 + Math.floor(r() * 3),
    });
    nest(g, {
      x: 4, y: 3, w: 10, h: 8,
      kinds: rosterFor(depth, r),
      level: lvlFor(depth),
      count: 3 + Math.floor(r() * 3),
      opening: 's',
      r,
    });
    return { start, exit };
  },

  hall(g, depth, r) {
    const { start, exit } = corners(r);
    fill(g, 2, 2, N - 3, N - 3, '.');
    pillarField(g, { x0: 6, y0: 6, x1: N - 7, y1: N - 7, step: 4 + Math.floor(r() * 2) });
    // Loose monsters as well as nests: an open hall is about being surrounded, and a
    // room that only trickles from a corner never surrounds anyone.
    const roster = rosterFor(depth, r);
    for (let i = 0; i < 6 + Math.floor(r() * 6); i++) {
      obj(g, {
        t: 'mon',
        x: 6 + Math.floor(r() * (N - 12)),
        y: 6 + Math.floor(r() * (N - 12)),
        kind: roster[Math.floor(r() * roster.length)],
        lvl: lvlFor(depth),
      });
    }
    chamber(g, { x: Math.round(N / 2) - 6, y: Math.round(N / 2) - 6, w: 12, h: 12, opening: 'n', at: 4 });
    return { start, exit };
  },

  gauntlet(g, depth, r) {
    const { start, exit } = corners(r);
    fill(g, 2, 2, N - 3, N - 3, '.');
    const y = Math.round(N / 2) + Math.floor(r() * 6) - 3;
    hline(g, 3, N - 4, y - 3, 'X');
    hline(g, 3, N - 4, y + 3, 'X');
    for (let i = 0; i < 3; i++) {
      const gapX = 6 + Math.floor(r() * (N - 14));
      vline(g, gapX, y - 3, y - 3, '.');
      vline(g, gapX, y + 3, y + 3, '.');
    }
    deathCorridor(g, { x0: 5, y0: y - 2, x1: N - 6, y1: y + 2, count: 1 + Math.floor(r() * 2) });
    foodGauntlet(g, { x0: 6, y: y + 6, x1: N - 7, count: 3 + Math.floor(r() * 2) });
    nest(g, {
      x: N - 15, y: 4, w: 11, h: 9,
      kinds: rosterFor(depth, r),
      level: lvlFor(depth),
      count: 3 + Math.floor(r() * 3),
      opening: 's',
      r,
    });
    return { start, exit };
  },
};

/* ------------------------------------------------------------------ finishing */

/** Carve a right-angled corridor between two cells. The safety net, not the plan. */
function carve(g, from, to) {
  const [ax, ay] = from;
  const [bx, by] = to;
  for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) set(g, x, ay, '.');
  for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) set(g, bx, y, '.');
}

/**
 * Generate one level.
 *
 * `seed` makes it reproducible: the same type, depth and seed always give the same level,
 * which is what lets you find one you like, note the number, and get it back.
 */
export function generateLevel({ type = 'warren', depth = 10, seed = 1, id = 'gen01', name } = {}) {
  const recipe = RECIPES[type] ?? RECIPES.warren;
  const r = rng(seed * 2654435761);
  const g = blank();
  border(g);

  const out = recipe(g, depth, r);
  let start = out.start;
  const exit = out.exit;

  // The start must not be inside something the recipe drew over it.
  if (g.tiles[start[1]][start[0]] !== '.') {
    fill(g, start[0] - 1, start[1] - 1, start[0] + 1, start[1] + 1, '.');
  }
  set(g, exit[0], exit[1], 'E');
  obj(g, { t: 'exit', x: exit[0], y: exit[1] });

  const asLevel = () => ({
    tiles: g.tiles.map((row) => row.join('')),
    objects: g.objects,
    start,
  });

  // Reachability first, because the density floors are measured against reachable area
  // and a sealed level would report a tiny one and then be topped up to match.
  let a = analyse(asLevel());
  if (!a.exitOk) {
    carve(g, start, exit);
    a = analyse(asLevel());
  }

  const cells = a.reachable.size;
  const taken = () => g.objects.filter((o) => o.t === 'gen' || o.t === 'exit').map((o) => [o.x, o.y]);

  const gensShort = genFloor(depth, cells) - g.objects.filter((o) => o.t === 'gen').length;
  if (gensShort > 0) {
    const roster = rosterFor(depth, r);
    for (const [gx, gy] of spreadCells(g, start, gensShort, 8, taken())) {
      obj(g, { t: 'gen', x: gx, y: gy, kind: roster[Math.floor(r() * roster.length)], lvl: lvlFor(depth) });
    }
  }

  const foodShort = foodFloor(cells) - g.objects.filter((o) => o.t === 'food').length;
  if (foodShort > 0) {
    for (const [fx, fy] of spreadCells(g, start, foodShort, 7, taken())) {
      obj(g, { t: 'food', x: fx, y: fy });
    }
  }

  relocateStrays(g, analyse(asLevel()).reachable);

  // Last word. If anything is still stranded — a nest the recipe walled in, a food
  // dropped behind a lattice — cut a corridor to it rather than shipping a level the
  // editor will immediately paint red.
  const final = analyse(asLevel());
  for (const o of final.stranded) carve(g, start, [o.x, o.y]);

  return finish(g, {
    id,
    name: name ?? `${LEVEL_TYPES.find((t) => t.id === type)?.label ?? type} ${seed}`,
    theme: ['stone', 'crypt', 'iron', 'ember', 'moss', 'bone'][depth % 6],
    type: 'normal',
    start,
  });
}
