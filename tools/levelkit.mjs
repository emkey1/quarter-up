/**
 * The level construction kit.
 *
 * DESIGN.md §11 lists the design vocabulary the original's mazes are built from. This
 * turns each entry into a composable function, so a level is written as a short recipe
 * of intents rather than a grid of characters:
 *
 *     nest(g, { x: 18, y: 5, w: 12, h: 12, kinds: ['ghost','grunt'], level: 2 })
 *     keyDoorGate(g, { ... })
 *     coverLattice(g, { ... })
 *
 * Composing named patterns is honest about what this is: parameterised hand-design,
 * not forty individually hand-drawn mazes and not pure noise. The patterns carry the
 * intent; the parameters carry the pacing.
 */

export const N = 32;

/* ------------------------------------------------------------------ canvas */

export function blank(fill = '.') {
  return {
    tiles: Array.from({ length: N }, () => Array(N).fill(fill)),
    objects: [],
  };
}

const inb = (x, y) => x >= 0 && y >= 0 && x < N && y < N;

export function set(g, x, y, ch) {
  if (inb(x, y)) g.tiles[y][x] = ch;
}
export function get(g, x, y) {
  return inb(x, y) ? g.tiles[y][x] : 'X';
}
export function hline(g, x0, x1, y, ch) {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) set(g, x, y, ch);
}
export function vline(g, x, y0, y1, ch) {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) set(g, x, y, ch);
}
export function fill(g, x0, y0, x1, y1, ch) {
  for (let y = y0; y <= y1; y++) hline(g, x0, x1, y, ch);
}
export function box(g, x0, y0, x1, y1, ch) {
  hline(g, x0, x1, y0, ch);
  hline(g, x0, x1, y1, ch);
  vline(g, x0, y0, y1, ch);
  vline(g, x1, y0, y1, ch);
}
export function border(g) {
  box(g, 0, 0, N - 1, N - 1, 'X');
}
export function obj(g, o) {
  g.objects.push(o);
}

/** Deterministic per-level randomness, so a level never changes between builds. */
export function rng(seed) {
  let s = (seed | 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 8) & 0xffffff) / 0x1000000;
  };
}

/* ------------------------------------------------------------------ vocabulary */

/**
 * GENERATOR NEST — the level's centrepiece problem.
 *
 * Generators packed into a room, optionally sealed behind a door. The whole point is
 * that you cannot simply walk in: something has to be solved first.
 */
export function nest(g, o) {
  const {
    x, y, w, h, kinds = ['grunt'], level = 1, count = 4, door = null,
    opening = 's', r = rng(1),
  } = o;
  box(g, x, y, x + w, y + h, 'X');
  fill(g, x + 1, y + 1, x + w - 1, y + h - 1, '.');
  if (door) {
    for (let i = 0; i < (door.size ?? 2); i++) {
      if (door.side === 'w') set(g, x, door.at + i, 'D');
      else if (door.side === 'e') set(g, x + w, door.at + i, 'D');
      else if (door.side === 'n') set(g, door.at + i, y, 'D');
      else set(g, door.at + i, y + h, 'D');
    }
  } else {
    // A nest with no door still needs a way in. A sealed box is never the intent —
    // it just silently strands everything inside, which is exactly what the validator
    // kept catching.
    const midX = x + Math.round(w / 2);
    const midY = y + Math.round(h / 2);
    if (opening === 'n') { set(g, midX, y, '.'); set(g, midX + 1, y, '.'); }
    else if (opening === 's') { set(g, midX, y + h, '.'); set(g, midX + 1, y + h, '.'); }
    else if (opening === 'w') { set(g, x, midY, '.'); set(g, x, midY + 1, '.'); }
    else { set(g, x + w, midY, '.'); set(g, x + w, midY + 1, '.'); }
  }
  // Spread the generators to the corners of the room so clearing one does not clear
  // the line of fire to the others.
  const spots = [
    [x + 2, y + 2],
    [x + w - 2, y + 2],
    [x + 2, y + h - 2],
    [x + w - 2, y + h - 2],
    [Math.round(x + w / 2), Math.round(y + h / 2)],
    [Math.round(x + w / 2), y + 2],
  ];
  for (let i = 0; i < Math.min(count, spots.length); i++) {
    const [gx, gy] = spots[i];
    obj(g, {
      t: 'gen',
      x: gx,
      y: gy,
      kind: kinds[Math.floor(r() * kinds.length)],
      lvl: Math.max(1, Math.min(3, level + (r() < 0.3 ? 1 : 0))),
    });
  }
}

/**
 * KEY / DOOR FLOOD CONTROL — a horde penned behind a door so you choose when it comes.
 *
 * The key is placed away from the door, so taking it is a decision rather than a step.
 */
export function keyDoorGate(g, o) {
  const { x, y, w, h, side = 'w', at, keyAt, kinds = ['grunt'], level = 1, count = 3, r = rng(2) } = o;
  nest(g, { x, y, w, h, kinds, level, count, door: { side, at, size: 2 }, r });
  if (keyAt) obj(g, { t: 'key', x: keyAt[0], y: keyAt[1] });
}

/**
 * COVER LATTICE — diagonally offset blocks that small and medium shots can thread and
 * monsters cannot pass. This is the Elf and Wizard's reward, and the Warrior's problem.
 */
export function coverLattice(g, o) {
  const { x0, y0, x1, y1, step = 3 } = o;
  for (let y = y0; y <= y1 - 1; y += step) {
    for (let x = x0; x <= x1 - 1; x += step) {
      set(g, x, y, 'X');
      set(g, x + 1, y + 1, 'X');
    }
  }
}

/** PILLAR FIELD — open ground broken up, so pursuit is a matter of angles. */
export function pillarField(g, o) {
  const { x0, y0, x1, y1, step = 3 } = o;
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) set(g, x, y, 'X');
}

/**
 * LOBBER GALLERY — lobbers behind a wall you cannot shoot through, so the only way to
 * deal with them is to train their own rocks onto something useful.
 */
export function lobberGallery(g, o) {
  const { x0, y0, x1, y1, level = 1, count = 3 } = o;
  hline(g, x0, x1, y1 + 1, 'X');
  for (let i = 0; i < count; i++) {
    const gx = Math.round(x0 + ((x1 - x0) * (i + 0.5)) / count);
    obj(g, { t: 'mon', x: gx, y: Math.round((y0 + y1) / 2), kind: 'lobber', lvl: level });
  }
}

/** DEATH CORRIDOR — a potion tax, or a dodging test, on the only route through. */
export function deathCorridor(g, o) {
  const { x0, y0, x1, y1, count = 1 } = o;
  fill(g, x0, y0, x1, y1, '.');
  for (let i = 0; i < count; i++) {
    obj(g, {
      t: 'death',
      x: Math.round(x0 + ((x1 - x0) * (i + 0.5)) / count),
      y: Math.round((y0 + y1) / 2),
    });
  }
}

/** FOOD GAUNTLET — food placed behind a cost, tuned against the rank curve. */
export function foodGauntlet(g, o) {
  const { x0, y, x1, count = 4, breakableEvery = 3 } = o;
  for (let i = 0; i < count; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / Math.max(1, count - 1));
    obj(g, { t: 'food', x, y, breakable: i % breakableEvery === breakableEvery - 1 });
  }
}

/** TREASURE VAULT — optional greed that raises your rank and thins later food. */
export function treasureVault(g, o) {
  const { x, y, w, h, sealed = true, opensFrom = null, density = 2 } = o;
  box(g, x, y, x + w, y + h, 'X');
  fill(g, x + 1, y + 1, x + w - 1, y + h - 1, '.');
  for (let ty = y + 1; ty <= y + h - 1; ty++) {
    for (let tx = x + 1; tx <= x + w - 1; tx++) {
      if ((tx + ty) % density === 0) obj(g, { t: 'treasure', x: tx, y: ty });
    }
  }
  if (!sealed) {
    set(g, x, y + Math.round(h / 2), 'D');
  } else if (opensFrom) {
    const gap = [
      [x + Math.round(w / 2), y + h],
      [x + Math.round(w / 2) + 1, y + h],
    ];
    obj(g, { t: 'trap', x: opensFrom[0], y: opensFrom[1], opens: gap });
    set(g, opensFrom[0], opensFrom[1], '^');
  }
}

/** SERPENTINE — switchback corridors. Long walks under fire, and corner practice. */
export function serpentine(g, o) {
  const { x0, y0, x1, y1, gap = 2 } = o;
  for (let y = y0, i = 0; y <= y1; y += gap, i++) {
    hline(g, x0, x1, y, 'X');
    if (i % 2 === 0) set(g, x1, y, '.');
    else set(g, x0, y, '.');
  }
}

/** A room with a single opening — the classic "do I really want to go in" shape. */
export function chamber(g, o) {
  const { x, y, w, h, opening = 'n', at } = o;
  box(g, x, y, x + w, y + h, 'X');
  fill(g, x + 1, y + 1, x + w - 1, y + h - 1, '.');
  const a = at ?? Math.round((opening === 'n' || opening === 's' ? w : h) / 2);
  if (opening === 'n') set(g, x + a, y, '.');
  else if (opening === 's') set(g, x + a, y + h, '.');
  else if (opening === 'w') set(g, x, y + a, '.');
  else set(g, x + w, y + a, '.');
}

export function corridorCross(g, o) {
  const { cx = 16, cy = 16, width = 2 } = o;
  for (let i = 0; i < width; i++) {
    vline(g, cx + i, 1, N - 2, '.');
    hline(g, 1, N - 2, cy + i, '.');
  }
}

/* ------------------------------------------------------------------ validation */

/**
 * Trap-aware reachability.
 *
 * Doors and breakable walls count as passable — doors open on the stalemate timer and
 * every class can shoot a breakable down, so neither can permanently strand anyone.
 * Traps are fired when reachable and the flood is repeated, which is what catches a
 * vault sealed by a trap that itself got overwritten.
 */
export function analyse(level) {
  const g = { tiles: level.tiles.map((r) => r.split('')), objects: level.objects };
  const solid = new Set(['X', ' ']);

  const flood = () => {
    const seen = new Set([level.start.join(',')]);
    const q = [level.start];
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        const k = `${nx},${ny}`;
        if (!inb(nx, ny) || seen.has(k) || solid.has(g.tiles[ny][nx])) continue;
        seen.add(k);
        q.push([nx, ny]);
      }
    }
    return seen;
  };

  let seen = flood();
  const fired = new Set();
  for (;;) {
    let changed = false;
    for (const o of level.objects) {
      if (o.t !== 'trap' || fired.has(o) || !seen.has(`${o.x},${o.y}`)) continue;
      if (g.tiles[o.y][o.x] !== '^') continue;
      fired.add(o);
      for (const [ox, oy] of o.opens ?? []) g.tiles[oy][ox] = '.';
      changed = true;
    }
    if (!changed) break;
    seen = flood();
  }

  const exits = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (g.tiles[y][x] === 'E') exits.push([x, y]);

  const mustReach = new Set(['food', 'key', 'potion', 'treasure', 'upgrade', 'gen', 'mon', 'death', 'thief']);
  const stranded = level.objects.filter((o) => mustReach.has(o.t) && !seen.has(`${o.x},${o.y}`));
  const deadTraps = level.objects.filter((o) => o.t === 'trap' && !fired.has(o));

  // A rough pressure score, so the difficulty ramp can be checked rather than assumed.
  const gens = level.objects.filter((o) => o.t === 'gen');
  const pressure =
    gens.reduce((n, o) => n + (o.lvl ?? 1) * (o.kind === 'ghost' ? 1.6 : 1), 0) +
    level.objects.filter((o) => o.t === 'death').length * 3 +
    level.objects.filter((o) => o.t === 'mon').length * 0.4;

  return {
    reachable: seen,
    exits,
    exitOk: exits.some(([x, y]) => seen.has(`${x},${y}`)),
    startSolid: solid.has(g.tiles[level.start[1]][level.start[0]]),
    stranded,
    deadTraps,
    pressure: Math.round(pressure * 10) / 10,
    food: level.objects.filter((o) => o.t === 'food').length,
    generators: gens.length,
  };
}

/**
 * Nudge objects off solid tiles.
 *
 * Patterns are drawn independently and can land a wall on top of a coordinate a recipe
 * chose by eye — a key inside a lattice block, say. Rather than making every recipe
 * responsible for knowing what every other pattern did, this moves stragglers to the
 * nearest open cell and reports how far it had to go, so a recipe that is genuinely
 * sloppy still shows up as a big number rather than being silently patched.
 */
export function relocateStrays(g, reachable) {
  const solid = new Set(['X', ' ']);
  const moved = [];
  for (const o of g.objects) {
    if (o.t === 'exit' || o.t === 'trap' || o.t === 'tele') continue;
    const ok = (x, y) =>
      inb(x, y) && !solid.has(g.tiles[y][x]) && (!reachable || reachable.has(`${x},${y}`));
    if (ok(o.x, o.y)) continue;
    let best = null;
    for (let radius = 1; radius <= 8 && !best; radius++) {
      for (let dy = -radius; dy <= radius && !best; dy++) {
        for (let dx = -radius; dx <= radius && !best; dx++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          if (ok(o.x + dx, o.y + dy)) best = [o.x + dx, o.y + dy, radius];
        }
      }
    }
    if (best) {
      moved.push({ t: o.t, from: [o.x, o.y], to: [best[0], best[1]], dist: best[2] });
      o.x = best[0];
      o.y = best[1];
    }
  }
  return moved;
}

/**
 * The reachable cell furthest from the start, measured in steps rather than in a
 * straight line.
 *
 * For hiding things. Straight-line distance would happily pick a spot on the far side of
 * a wall you walk past in the first ten seconds; step distance picks the place you have
 * to actually go somewhere to reach, which is the whole point of hiding something.
 *
 * `avoid` keeps a second hidden object from landing on the first — two upgrade potions
 * in the same corner is not two secrets.
 */
export function remotestCell(g, start, avoid = []) {
  const solid = new Set(['X', ' ']);
  const dist = new Map([[start.join(','), 0]]);
  const queue = [[start[0], start[1]]];
  let best = [start[0], start[1]];
  let bestD = -1;

  for (let head = 0; head < queue.length; head++) {
    const [x, y] = queue[head];
    const d = dist.get(`${x},${y}`);
    const clear = avoid.every(([ax, ay]) => Math.abs(ax - x) + Math.abs(ay - y) > 6);
    if (d > bestD && clear && g.tiles[y][x] === '.') {
      bestD = d;
      best = [x, y];
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      const k = `${nx},${ny}`;
      if (!inb(nx, ny) || dist.has(k) || solid.has(g.tiles[ny][nx])) continue;
      dist.set(k, d + 1);
      queue.push([nx, ny]);
    }
  }
  return { cell: best, steps: bestD };
}

export function finish(g, meta) {
  return {
    id: meta.id,
    name: meta.name,
    theme: meta.theme,
    type: meta.type ?? 'normal',
    start: meta.start,
    tiles: g.tiles.map((r) => r.join('')),
    objects: g.objects,
  };
}
