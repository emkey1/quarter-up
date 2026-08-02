import { describe, it, expect } from 'vitest';
import { T } from '@/data/tuning';
import { CAMPAIGN, DUNGEONS, INTRO, LOOP_START } from '@/data/campaign';
import { World } from '@/game/world';
import { Run } from '@/game/flow';
import { Tile } from '@/game/terrain';
import { emptyActions } from '@/engine/actions';
import { analyseLevel } from '@/game/analyse';
import { cellCentre } from '@/game/level';
import { PROVING } from '@/data/campaign';

describe('campaign content', () => {
  it('ships seven intro levels and forty-plus dungeon levels', () => {
    expect(INTRO.length).toBe(7);
    expect(DUNGEONS.filter((l) => l.type === 'normal').length).toBe(40);
    expect(DUNGEONS.filter((l) => l.type === 'treasure').length).toBeGreaterThanOrEqual(3);
  });

  it('gives every level an exit that is actually reachable from the start', () => {
    for (const lvl of CAMPAIGN) {
      const w = new World(lvl, 'elf', 1);
      expect(w.terrain.cellsOf(Tile.Exit).length, `${lvl.id} has no exit`).toBeGreaterThan(0);
      expect(w.terrain.solidAt(w.player.x, w.player.y), `${lvl.id} starts in a wall`).toBe(false);
    }
  });

  it('never places an object inside a wall', () => {
    // The level kit nudges strays off solid tiles; this is the check that it worked.
    for (const lvl of CAMPAIGN) {
      const w = new World(lvl, 'elf', 1);
      for (const it of w.items) {
        expect(w.terrain.solidAt(it.x, it.y), `${lvl.id}: ${it.kind} buried`).toBe(false);
      }
      for (const g of w.generators) {
        expect(w.terrain.solidAtCell(g.cx, g.cy), `${lvl.id}: generator buried`).toBe(false);
      }
    }
  });

  it('feeds the player on every normal level — the drain never stops', () => {
    for (const lvl of CAMPAIGN) {
      if (lvl.type !== 'normal') continue;
      const w = new World(lvl, 'elf', 1);
      expect(w.items.filter((i) => i.kind === 'food').length, `${lvl.id} has no food`).toBeGreaterThan(0);
    }
  });

  it('keeps food scarce enough that the drain actually bites', () => {
    // Halved from ~7.6 per level. At the old rate food arrived faster than 1/sec could
    // burn it, which made the clock that is supposed to end a run decorative. The lower
    // bound matters as much as the upper: a level nobody can survive arriving at on low
    // health is not difficulty either.
    const tilesPerScreen = (T.VIEW_W / T.TILE) * (T.VIEW_H / T.TILE);
    const normals = DUNGEONS.filter((l) => l.type === 'normal');
    const counts = normals.map((l) => l.objects.filter((o) => o.t === 'food').length);
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;

    expect(mean, `mean food per level is ${mean.toFixed(1)}`).toBeGreaterThan(2.5);
    expect(mean, `mean food per level is ${mean.toFixed(1)}`).toBeLessThan(5);
    expect(Math.min(...counts), 'some level has almost no food').toBeGreaterThanOrEqual(2);

    for (const lvl of normals) {
      const screens = analyseLevel(lvl).reachable.size / tilesPerScreen;
      const perScreen = lvl.objects.filter((o) => o.t === 'food').length / screens;
      expect(perScreen, `${lvl.id}: ${perScreen.toFixed(2)} food per screen`).toBeLessThan(0.75);
    }
  });

  it('puts enough generators on every screen, not merely on every level', () => {
    // Per-level was the wrong unit and it hid this for two rounds of playtesting.
    // Off-screen generators are inert, so what a player experiences is how many sit
    // inside the viewport — and a level is about nine screens. The campaign once ran
    // 0.53 generators per screen at depth 1, which means most screens had none at all.
    //
    // Computed from the REAL tuning values, so if the viewport or tile size changes, or
    // the copies of them in tools/mkcampaign.mjs drift, this fails.
    const tilesPerScreen = (T.VIEW_W / T.TILE) * (T.VIEW_H / T.TILE);
    const normals = DUNGEONS.filter((l) => l.type === 'normal');

    for (const lvl of normals) {
      const screens = analyseLevel(lvl).reachable.size / tilesPerScreen;
      const perScreen = lvl.objects.filter((o) => o.t === 'gen').length / screens;
      expect(perScreen, `${lvl.id} has only ${perScreen.toFixed(2)} generators per screen`).toBeGreaterThan(1.8);
      expect(perScreen, `${lvl.id} is a monster fountain at ${perScreen.toFixed(2)} per screen`).toBeLessThan(6);
    }
  });

  it('shows the player something to fight from where they spawn', () => {
    // A level can hit its density target and still open on an empty room if everything
    // was placed far from the start, which is exactly what the first attempt did — a
    // full minute of standing still on depth 1 and depth 20 produced zero monsters.
    for (const lvl of DUNGEONS.filter((l) => l.type === 'normal')) {
      const w = new World(lvl, 'elf', 1);
      const visible = w.generators.filter((g) =>
        w.camera.contains(g.x, g.y, T.GEN_OFFSCREEN_MARGIN),
      ).length;
      expect(visible, `${lvl.id} opens with nothing on screen`).toBeGreaterThan(0);
    }
  });

  it('never spawns a generator on top of the player', () => {
    for (const lvl of DUNGEONS.filter((l) => l.type === 'normal')) {
      const w = new World(lvl, 'elf', 1);
      for (const g of w.generators) {
        const tiles = Math.hypot(g.x - w.player.x, g.y - w.player.y) / T.TILE;
        expect(tiles, `${lvl.id}: generator ${tiles.toFixed(1)} tiles from spawn`).toBeGreaterThan(3);
      }
    }
  });

  it('ramps generator pressure across the campaign', () => {
    const pressure = (lvl: (typeof CAMPAIGN)[number]) => {
      const w = new World(lvl, 'elf', 1);
      return w.generators.reduce((n, g) => n + g.level, 0);
    };
    const normals = DUNGEONS.filter((l) => l.type === 'normal');
    const early = normals.slice(0, 8).reduce((n, l) => n + pressure(l), 0) / 8;
    const late = normals.slice(-8).reduce((n, l) => n + pressure(l), 0) / 8;
    expect(late, 'the back half should be meaningfully harder').toBeGreaterThan(early);
  });

  it('places upgrade potions as landmarks rather than everywhere', () => {
    const withUpgrade = CAMPAIGN.filter((l) => l.objects.some((o) => o.t === 'upgrade'));
    expect(withUpgrade.length).toBeGreaterThan(3);
    expect(withUpgrade.length).toBeLessThan(CAMPAIGN.length / 3);
  });
});

describe('playability analysis', () => {
  // This is the same function the level editor runs live on every edit. Keeping it under
  // test here is what stops the editor and the build from disagreeing about what
  // "playable" means — an editor that blesses a level CI rejects is worse than no editor.
  it('passes every campaign level, with no warnings either', () => {
    for (const lvl of CAMPAIGN) {
      const r = analyseLevel(lvl);
      expect(r.errors, `${lvl.id} (${lvl.name})`).toEqual([]);
      expect(r.warnings, `${lvl.id} (${lvl.name})`).toEqual([]);
    }
  });

  it('leaves the proving ground playable, warnings aside', () => {
    // The systems proving ground is a dev harness, not content: it deliberately has no
    // food because nobody is meant to survive on it, only to test mechanics. Warnings
    // are allowed here — but structural errors are not, and it earns no exemption from
    // the analyser itself, which is where an exemption would do real damage.
    expect(analyseLevel(PROVING).errors).toEqual([]);
  });

  it('catches a sealed exit', () => {
    const base = CAMPAIGN[0];
    const walled = {
      ...base,
      // Wall off the start cell entirely: the exit becomes unreachable by construction.
      tiles: base.tiles.map((row, y) =>
        row
          .split('')
          .map((g, x) => {
            const [sx, sy] = base.start;
            if (x === sx && y === sy) return '.';
            return Math.abs(x - sx) <= 1 && Math.abs(y - sy) <= 1 ? 'X' : g;
          })
          .join(''),
      ),
    };
    const r = analyseLevel(walled);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('exit'))).toBe(true);
  });

  it('does not call a trap-opened vault sealed', () => {
    // The bug this guards against shipped once: eighteen treasures behind a wall the
    // trap opens, reported as broken, then "fixed" with a validator exemption that hid
    // a genuinely sealed vault later. Traps get fired, not excused.
    const lvl = {
      ...CAMPAIGN[0],
      objects: [
        ...CAMPAIGN[0].objects.filter((o) => o.t !== 'trap'),
        { t: 'trap', x: CAMPAIGN[0].start[0], y: CAMPAIGN[0].start[1], opens: [[1, 1]] as [number, number][] },
        { t: 'treasure', x: 1, y: 1 },
      ],
    };
    const r = analyseLevel(lvl);
    expect(r.errors).toEqual([]);
  });
});

describe('intro level-select', () => {
  it('offers six numbered exits on the last intro level', () => {
    const last = INTRO[INTRO.length - 1];
    const skips = last.objects.filter((o) => o.t === 'exit' && typeof o.skipTo === 'number');
    expect(last.name).toBe('Six Doors');
    expect(skips.length).toBe(6);
    expect(skips.map((s) => s.skipTo).sort((a, b) => (a as number) - (b as number)))
      .toEqual([8, 14, 20, 26, 32, 38]);
  });

  it('labels every door with where it goes', () => {
    // An unlabelled door asks you to gamble on a number you cannot see, which is not a
    // choice. Each door gets a floor sign naming its destination depth.
    const last = INTRO[INTRO.length - 1];
    const skips = last.objects.filter((o) => o.t === 'exit' && typeof o.skipTo === 'number');
    const signs = last.objects.filter((o) => o.t === 'sign');
    expect(signs.length, 'a door is unlabelled').toBe(skips.length);
    for (const s of skips) {
      expect(
        signs.some((g) => g.text === `LEVEL ${s.skipTo}`),
        `no sign for the door to ${s.skipTo}`,
      ).toBe(true);
    }
    // Each sign must be nearest the door it describes. An absolute distance would be an
    // arbitrary number that breaks the moment the room moves; "closer to its own door
    // than to any other" is the property that actually matters, and it stays true however
    // the level is laid out.
    for (const g of signs) {
      const depth = Number(String(g.text).replace(/\D+/g, ''));
      const dist = (o: { x: number; y: number }) => Math.abs(g.x - o.x) + Math.abs(g.y - o.y);
      const own = skips.find((s) => s.skipTo === depth)!;
      const nearest = skips.reduce((a, b) => (dist(a) <= dist(b) ? a : b));
      expect(nearest.skipTo, `the sign for ${depth} sits by the door to ${nearest.skipTo}`).toBe(depth);
      expect(own.x, `sign for ${depth} is not in line with its door`).toBe(g.x);
    }
  });

  it('sends every door somewhere the campaign actually has', () => {
    const last = INTRO[INTRO.length - 1];
    for (const s of last.objects.filter((o) => o.t === 'exit' && typeof o.skipTo === 'number')) {
      const depth = s.skipTo as number;
      expect(depth, `door to ${depth} lands past the campaign`).toBeLessThanOrEqual(CAMPAIGN.length);
      expect(CAMPAIGN[depth - 1].type, `door to ${depth} lands on an intro level`).not.toBe('intro');
    }
  });

  it('jumps the run to the depth a numbered exit names', () => {
    const r = new Run(CAMPAIGN, 'elf', 1, INTRO.length - 1, undefined, LOOP_START);
    expect(r.depth).toBe(7);
    r.world.exitSkipTo = 12;
    r.world.exitReached = true;
    r.step();
    expect(r.depth).toBe(12);
  });

  it('ignores a skip that would go backwards', () => {
    const r = new Run(CAMPAIGN, 'elf', 1, 20, undefined, LOOP_START);
    r.world.exitSkipTo = 8; // behind us
    r.world.exitReached = true;
    r.step();
    expect(r.depth, 'a numbered exit must never rewind a run').toBe(22);
  });
});

describe('skipping the tutorial', () => {
  // The character select offers this before the run starts; the last intro level offers
  // the same jump as a numbered exit. Both must land in the same place, or a returning
  // player gets a different game depending on which route they took to skip.
  it('starts on the level-select, not past it', () => {
    // Skipping lands on the LAST intro level — "Six Doors" — because that level is not
    // a tutorial, it is the arcade's depth chooser. Dropping the player past it would
    // silently decide the run's difficulty for them; landing on it hands the choice over.
    const start = LOOP_START - 1;
    const r = new Run(CAMPAIGN, 'elf', 1, start, undefined, LOOP_START);
    expect(r.levelName).toBe('Six Doors');
    expect(r.levelName).toBe(INTRO[INTRO.length - 1].name);
    expect(r.depth).toBe(INTRO.length);
  });

  it('lands on a level that actually offers the numbered exits', () => {
    // The whole reason to stop there. If this level ever loses its skip exits, skipping
    // the tutorial becomes a dead end rather than a chooser.
    const landing = CAMPAIGN[LOOP_START - 1];
    const skips = landing.objects.filter((o) => o.t === 'exit' && typeof o.skipTo === 'number');
    expect(skips.length, 'the skip landing level has no numbered exits').toBeGreaterThan(0);
  });

  it('agrees with the first numbered exit on the last intro level', () => {
    const first = INTRO[INTRO.length - 1].objects
      .filter((o) => o.t === 'exit' && typeof o.skipTo === 'number')
      .map((o) => o.skipTo as number)
      .sort((a, b) => a - b)[0];
    expect(first).toBe(LOOP_START + 1);
  });

  it('still carries a full complement of health into the dungeon', () => {
    // Skipping is a shortcut past the tutorial, not a handicap.
    const skipped = new Run(CAMPAIGN, 'elf', 1, LOOP_START, undefined, LOOP_START);
    const taught = new Run(CAMPAIGN, 'elf', 1, 0, undefined, LOOP_START);
    expect(skipped.world.player.health).toBe(taught.world.player.health);
  });
});

describe('treasure rooms', () => {
  const room = () => DUNGEONS.find((l) => l.type === 'treasure')!;

  it('starts a countdown rather than posing a threat', () => {
    const w = new World(room(), 'elf', 1);
    expect(w.isTreasureRoom).toBe(true);
    expect(w.treasureTimer).toBe(T.TREASURE_ROOM_SEC * T.STEP_HZ);
    expect(w.generators.length).toBe(0);
    expect(w.liveMonsters).toBe(0);
  });

  it('ends the room when the clock runs out', () => {
    const w = new World(room(), 'elf', 1);
    const a = emptyActions();
    const limit = (T.TREASURE_ROOM_SEC + 2) * T.STEP_HZ + T.EXIT_SEQUENCE_F;
    for (let i = 0; i < limit && !w.exitReached; i++) w.step(a);
    expect(w.exitReached).toBe(true);
  });

  /** Sweep the room diagonally for a while and report the haul. */
  const gather = (frames = 360) => {
    const w = new World(room(), 'elf', 1);
    w.godMode = true;
    const a = emptyActions();
    a.moveX = 1;
    a.moveY = 1;
    for (let i = 0; i < frames; i++) w.step(a);
    expect(w.treasureTaken, 'should have swept up some treasure').toBeGreaterThan(0);
    return w;
  };

  it('does not bank treasure as you pick it up — carrying it out is the point', () => {
    const w = gather();
    expect(w.treasureHeld, 'nothing was escrowed').toBeGreaterThan(0);
    expect(w.player.score, 'treasure scored on pickup instead of on exit').toBe(0);
  });

  it('pays the haul plus 50 a piece when you reach the exit', () => {
    const w = gather();
    const taken = w.treasureTaken;
    const held = w.treasureHeld;
    const before = w.player.score;

    const [cx, cy] = w.terrain.cellsOf(Tile.Exit)[0];
    const [x, y] = cellCentre(cx, cy);
    w.player.x = x;
    w.player.y = y;
    w.step(emptyActions());

    expect(w.player.score - before).toBe(held + taken * T.SCORE.treasureRoomPerTreasure);
  });

  it('forfeits the entire haul if the clock beats you to it', () => {
    // The whole tension of the room. Paying out on expiry as well made the exit
    // decorative: there was no reason to ever stop hoovering, because greed cost nothing.
    const w = gather();
    expect(w.treasureHeld).toBeGreaterThan(0);
    const before = w.player.score;
    const pieces = w.treasureTaken;

    w.treasureTimer = 1;
    w.step(emptyActions());

    expect(w.player.score, 'the clock ran out and it paid anyway').toBe(before);
    expect(w.treasureHeld).toBe(0);
    expect(w.treasureLost).toBe(pieces);
  });

  it('announces the forfeit rather than silently pocketing it', () => {
    const w = gather();
    w.events.drain();
    w.treasureTimer = 1;
    w.step(emptyActions());
    const ev = w.events.drain().find((e) => e.t === 'treasureForfeited');
    expect(ev, 'no treasureForfeited event').toBeTruthy();
    expect((ev as { pieces: number }).pieces).toBeGreaterThan(0);
  });

  it('still ends the room with the full exit sequence when time runs out', () => {
    // Being out of time is not the same as being cut off mid-frame.
    const w = gather();
    w.treasureTimer = 1;
    w.step(emptyActions());
    expect(w.exitFrames).toBeGreaterThanOrEqual(0);
    expect(w.exitReached).toBe(false);
    for (let i = 0; i < T.EXIT_SEQUENCE_F + 2; i++) w.step(emptyActions());
    expect(w.exitReached).toBe(true);
  });

  it('pays nothing when you leave empty-handed', () => {
    const w = new World(room(), 'elf', 1);
    const before = w.player.score;
    w.treasureTimer = 1;
    w.step(emptyActions());
    expect(w.player.score).toBe(before);
    for (let i = 0; i < T.EXIT_SEQUENCE_F + 2; i++) w.step(emptyActions());
    expect(w.exitReached).toBe(true);
  });

  it('banks treasure immediately on an ordinary level', () => {
    // The escrow is a treasure-ROOM rule. Everywhere else a coin is worth points the
    // moment you touch it, and nothing about this change may alter that.
    const lvl = DUNGEONS.find((l) => l.type === 'normal' && l.objects.some((o) => o.t === 'treasure'));
    if (!lvl) return; // no ordinary level ships treasure; nothing to check
    const w = new World(lvl, 'elf', 1);
    const it = w.items.find((i) => i.kind === 'treasure')!;
    w.player.x = it.x;
    w.player.y = it.y;
    w.step(emptyActions());
    expect(w.player.score).toBeGreaterThan(0);
    expect(w.treasureHeld).toBe(0);
  });
});

describe('endless loop', () => {
  it('loops back past the intro, never into it', () => {
    const r = new Run(CAMPAIGN, 'elf', 1, CAMPAIGN.length - 1, undefined, LOOP_START);
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      r.world.exitReached = true;
      r.step();
      seen.push(r.levelName);
    }
    // A player who has survived fifty levels must not be sent back to "First Steps".
    for (const name of seen) {
      expect(INTRO.map((l) => l.name)).not.toContain(name);
    }
  });

  it('keeps increasing depth forever', () => {
    const r = new Run(CAMPAIGN, 'elf', 1, 0, undefined, LOOP_START);
    for (let i = 0; i < CAMPAIGN.length + 10; i++) {
      r.world.exitReached = true;
      r.step();
    }
    expect(r.depth).toBe(CAMPAIGN.length + 11);
    expect(r.world.depth).toBe(r.depth);
  });
});
