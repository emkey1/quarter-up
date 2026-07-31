import { describe, it, expect } from 'vitest';
import { T } from '@/data/tuning';
import { CAMPAIGN, DUNGEONS, INTRO, LOOP_START } from '@/data/campaign';
import { World } from '@/game/world';
import { Run } from '@/game/flow';
import { Tile } from '@/game/terrain';
import { emptyActions } from '@/engine/actions';
import { analyseLevel } from '@/game/analyse';
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
  it('offers numbered exits on the last intro level', () => {
    const last = INTRO[INTRO.length - 1];
    const skips = last.objects.filter((o) => o.t === 'exit' && typeof o.skipTo === 'number');
    expect(skips.length).toBe(3);
    expect(skips.map((s) => s.skipTo)).toEqual([8, 12, 16]);
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
  it('starts the run at the first dungeon level', () => {
    const r = new Run(CAMPAIGN, 'elf', 1, LOOP_START, undefined, LOOP_START);
    expect(r.depth).toBe(INTRO.length + 1);
    expect(r.levelName).toBe(DUNGEONS[0].name);
    expect(INTRO.map((l) => l.name)).not.toContain(r.levelName);
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

  it('pays a bonus of 50 per treasure taken, on top of the pickups themselves', () => {
    const w = new World(room(), 'elf', 1);
    w.godMode = true;
    // The treasure field starts at row 4; the entrance is at row 2, so walking straight
    // along the top row collects nothing at all.
    const a = emptyActions();
    a.moveX = 1;
    a.moveY = 1;
    for (let i = 0; i < 360; i++) w.step(a);
    const taken = w.treasureTaken;
    expect(taken, 'should have swept up some treasure').toBeGreaterThan(0);

    const before = w.player.score;
    w.treasureTimer = 1;
    w.step(emptyActions());
    expect(w.player.score - before).toBe(taken * T.SCORE.treasureRoomPerTreasure);
  });

  it('pays nothing when you leave empty-handed', () => {
    const w = new World(room(), 'elf', 1);
    const before = w.player.score;
    w.treasureTimer = 1;
    // The bonus is paid when the clock stops, not when the exit sequence finishes —
    // the score must be settled before the animation, or a player who quits during it
    // would lose the payout.
    w.step(emptyActions());
    expect(w.player.score).toBe(before);
    for (let i = 0; i < T.EXIT_SEQUENCE_F + 2; i++) w.step(emptyActions());
    expect(w.exitReached).toBe(true);
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
