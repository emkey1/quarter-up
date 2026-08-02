import { describe, it, expect } from 'vitest';
import { T } from '@/data/tuning';
import { World } from '@/game/world';
import { Run } from '@/game/flow';
import { CAMPAIGN } from '@/data/campaign';
import { emptyActions, type ActionState } from '@/engine/actions';
import { makeMonster } from '@/game/monster';
import { makeDeath, deathPotionValue, shootDeath, chooseTheft } from '@/game/special';
import { makeRock } from '@/game/projectile';
import { DEFAULT_RULES, PRESETS, RULE_META, tierOf, cloneRules } from '@/data/rules';
import type { LevelData, LevelObject } from '@/game/level';

function arena(objects: LevelObject[] = [], tweak?: (rows: string[][]) => void): LevelData {
  const rows: string[][] = [];
  for (let y = 0; y < T.GRID; y++) {
    const row: string[] = [];
    for (let x = 0; x < T.GRID; x++) {
      row.push(y === 0 || y === T.GRID - 1 || x === 0 || x === T.GRID - 1 ? 'X' : '.');
    }
    rows.push(row);
  }
  tweak?.(rows);
  return {
    id: 'arena',
    name: 'Arena',
    theme: 'stone',
    type: 'normal',
    start: [16, 16],
    tiles: rows.map((r) => r.join('')),
    objects,
  };
}

function run(w: World, frames: number, a: ActionState = emptyActions()): void {
  for (let i = 0; i < frames; i++) w.step(a);
}

const cell = (n: number) => n * T.TILE + T.TILE / 2;

/* ------------------------------------------------------------------ lobber */

describe('lobbers', () => {
  it('arcs rocks OVER a wall it could never shoot through', () => {
    // Lobber west of a full-height wall, player east of it. A rock must still land.
    const lvl = arena([{ t: 'mon', x: 6, y: 16, kind: 'lobber', lvl: 1 }], (rows) => {
      for (let y = 1; y < T.GRID - 1; y++) rows[y][12] = 'X';
    });
    const w = new World(lvl, 'wizard', 1);
    w.player.x = cell(20);
    w.player.y = cell(16);
    w.camera.follow(w.player.x, w.player.y);

    let sawRockEastOfWall = false;
    for (let i = 0; i < 600 && !sawRockEastOfWall; i++) {
      w.step(emptyActions());
      sawRockEastOfWall = w.projectiles.some(
        (p) => p.alive && p.kind === 'rock' && p.x > 13 * T.TILE,
      );
    }
    expect(sawRockEastOfWall, 'a rock should clear the wall').toBe(true);
  });

  it('flees when the player closes inside three blocks', () => {
    const w = new World(arena([{ t: 'mon', x: 20, y: 16, kind: 'lobber', lvl: 1 }]), 'elf', 1);
    w.godMode = true;
    const m = w.monsters[0];
    w.player.x = m.x - T.TILE * 1.5; // well inside the flee radius
    w.player.y = m.y;
    const before = m.x - w.player.x;
    run(w, 60);
    expect(m.x - w.player.x, 'lobber should back away').toBeGreaterThan(before);
  });

  it('leads its throw ahead of a moving player', () => {
    const w = new World(arena([{ t: 'mon', x: 8, y: 16, kind: 'lobber', lvl: 1 }]), 'elf', 1);
    w.godMode = true;
    w.player.x = cell(20);
    w.player.y = cell(16);
    w.camera.follow(w.player.x, w.player.y);
    const a = emptyActions();
    a.moveY = 1; // running south, across the lobber's line

    let rock = null;
    let atThrow = 0;
    for (let i = 0; i < 600 && !rock; i++) {
      w.step(a);
      rock = w.projectiles.find((p) => p.alive && p.kind === 'rock') ?? null;
      if (rock) atThrow = w.player.y;
    }
    expect(rock, 'lobber should have thrown').toBeTruthy();
    // Landing point, extrapolated from the rock's own velocity and remaining flight.
    const landY = rock!.y + rock!.vy * rock!.flight;
    expect(landY, 'must aim where the player is going, not where they were').toBeGreaterThan(
      atThrow + T.TILE,
    );
  });

  it('ACCEPTANCE: a rock landing on a bone generator destroys it outright', () => {
    // The mechanism, isolated from the AI: bones shatter whatever their level, blocks
    // only crack. Training the rock there is player skill (tested above via the lead);
    // this pins the rule the skill relies on.
    const bone = new World(arena([{ t: 'gen', x: 13, y: 16, kind: 'ghost', lvl: 3 }]), 'wizard', 1);
    bone.godMode = true;
    bone.player.x = cell(24);
    bone.player.y = cell(24);
    const g = bone.generators[0];
    bone.projectiles.push(makeRock(cell(9), cell(16), g.x, g.y, 0, 0, T.ROCK_DMG));
    for (let i = 0; i < 200 && g.alive; i++) bone.step(emptyActions());
    expect(g.alive, 'a bone generator should shatter').toBe(false);

    const block = new World(arena([{ t: 'gen', x: 13, y: 16, kind: 'grunt', lvl: 3 }]), 'wizard', 1);
    block.godMode = true;
    block.player.x = cell(24);
    block.player.y = cell(24);
    const g2 = block.generators[0];
    block.projectiles.push(makeRock(cell(9), cell(16), g2.x, g2.y, 0, 0, T.ROCK_DMG));
    for (let i = 0; i < 200 && g2.level === 3; i++) block.step(emptyActions());
    expect(g2.alive, 'a block generator should survive').toBe(true);
    expect(g2.level, 'but be weakened').toBe(2);
  });
});

/* ------------------------------------------------------------------ demon */

describe('demons', () => {
  it('ACCEPTANCE: a demon lined up behind a generator damages it', () => {
    // demon — generator — player, all on one row. The demon fires at the player and
    // hits what is in between, because it never checks line of sight.
    // Demons only fire inside DEMON_RANGE_WU, so all three must sit within it.
    const lvl = arena([
      { t: 'mon', x: 10, y: 16, kind: 'demon', lvl: 1 },
      { t: 'gen', x: 14, y: 16, kind: 'grunt', lvl: 3 },
    ]);
    const w = new World(lvl, 'wizard', 1);
    w.godMode = true;
    w.player.x = cell(18);
    w.player.y = cell(16);
    w.camera.follow(w.player.x, w.player.y);
    const gen = w.generators[0];
    const start = gen.level;

    for (let i = 0; i < 2000 && gen.level === start; i++) w.step(emptyActions());
    expect(gen.level, 'demon fire should have chipped the generator').toBeLessThan(start);
  });

  it('fires without line of sight — that is the point', () => {
    const lvl = arena([{ t: 'mon', x: 10, y: 16, kind: 'demon', lvl: 1 }], (rows) => {
      for (let y = 1; y < T.GRID - 1; y++) rows[y][14] = 'X';
    });
    const w = new World(lvl, 'wizard', 1);
    w.godMode = true;
    w.player.x = cell(18);
    w.player.y = cell(16);
    w.camera.follow(w.player.x, w.player.y);
    let fired = false;
    for (let i = 0; i < 400 && !fired; i++) {
      w.step(emptyActions());
      fired = w.projectiles.some((p) => p.kind === 'fireball');
    }
    expect(fired).toBe(true);
  });
});

/* ------------------------------------------------------------------ sorcerer */

describe('sorcerers', () => {
  it('phases out, and shots pass through while it does', () => {
    const w = new World(arena([{ t: 'mon', x: 22, y: 16, kind: 'sorcerer', lvl: 3 }]), 'warrior', 1);
    w.godMode = true;
    const m = w.monsters[0];
    m.visible = false;
    m.phaseCd = 999;
    const hpBefore = m.hp;

    w.player.facing = 0;
    const a = emptyActions();
    a.fire = true;
    run(w, 120, a);
    expect(m.hp, 'shots must not damage a phased-out sorcerer').toBe(hpBefore);

    m.visible = true;
    run(w, 240, a);
    expect(m.hp).toBeLessThan(hpBefore);
  });

  it('cycles visibility on its own', () => {
    const w = new World(arena([{ t: 'mon', x: 22, y: 16, kind: 'sorcerer', lvl: 1 }]), 'elf', 1);
    w.godMode = true;
    const m = w.monsters[0];
    const seen = new Set<boolean>();
    for (let i = 0; i < (T.SORCERER_VISIBLE_F + T.SORCERER_INVISIBLE_F) * 2; i++) {
      w.step(emptyActions());
      seen.add(m.visible);
    }
    expect(seen.size).toBe(2);
  });
});

/* ------------------------------------------------------------------ Death */

describe('Death', () => {
  it('cannot be killed by shots and drains through armour', () => {
    const w = new World(arena([{ t: 'death', x: 18, y: 16 }]), 'valkyrie', 1); // best armour
    const d = w.deaths[0];
    const before = w.player.health;
    w.player.x = d.x - 4;
    run(w, 30);
    const taken = before - w.player.health;
    expect(d.alive).toBe(true);
    // Armour is ignored entirely: 30 frames at 4/frame, minus the 1/sec drain.
    expect(taken).toBeGreaterThan(30 * T.DEATH_DRAIN_PER_FRAME * 0.8);
  });

  it('vanishes after draining exactly its cap', () => {
    const w = new World(arena([{ t: 'death', x: 18, y: 16 }]), 'wizard', 1);
    const d = w.deaths[0];
    w.player.health = 5000;
    w.player.x = d.x - 4;
    for (let i = 0; i < 600 && d.alive; i++) w.step(emptyActions());
    expect(d.alive).toBe(false);
    expect(d.drained).toBe(T.DEATH_TOTAL_DRAIN);
  });

  it('ACCEPTANCE: shot six times then potioned scores 8000', () => {
    const d = makeDeath(0, 0);
    expect(deathPotionValue(d)).toBe(1000); // default
    for (let i = 0; i < 6; i++) shootDeath(d);
    expect(deathPotionValue(d)).toBe(8000);
    // and the full documented cycle, in order
    const d2 = makeDeath(0, 0);
    const seen = [deathPotionValue(d2)];
    for (let i = 0; i < 6; i++) {
      shootDeath(d2);
      seen.push(deathPotionValue(d2));
    }
    expect(seen).toEqual([1000, 2000, 1000, 4000, 2000, 6000, 8000]);
  });

  it('dies to any potion at all, even the Warrior’s, and pays the cycled value', () => {
    const w = new World(arena([{ t: 'death', x: 18, y: 16 }]), 'warrior', 1);
    w.godMode = true;
    const d = w.deaths[0];
    for (let i = 0; i < 6; i++) shootDeath(d);
    w.player.potions = 1;
    const before = w.player.score;
    const a = emptyActions();
    a.magic = true;
    a.magicPressed = true;
    w.step(a);
    expect(d.alive).toBe(false);
    expect(w.player.score - before).toBe(8000);
  });
});

/* ------------------------------------------------------------------ Thief */

describe('the Thief', () => {
  it('takes an upgrade before anything else', () => {
    expect(chooseTheft({ upgrades: ['speed'], potions: 3, keys: 3, score: 100 }).kind).toBe(
      'upgrade',
    );
    expect(chooseTheft({ upgrades: [], potions: 3, keys: 3, score: 100 }).kind).toBe('potion');
    expect(chooseTheft({ upgrades: [], potions: 0, keys: 3, score: 100 }).kind).toBe('key');
    expect(chooseTheft({ upgrades: [], potions: 0, keys: 0, score: 100 }).kind).toBe('score');
    expect(chooseTheft({ upgrades: [], potions: 0, keys: 0, score: 0 }).kind).toBe('nothing');
  });

  it('ACCEPTANCE: steals an upgrade, and killing him returns it only as a plain potion', () => {
    const w = new World(arena([{ t: 'thief', x: 19, y: 16 }]), 'elf', 1);
    w.godMode = true;
    w.player.upgrades.add('speed');
    const t = w.thieves[0];

    for (let i = 0; i < 400 && !t.fleeing; i++) w.step(emptyActions());
    expect(t.fleeing, 'thief should have robbed the player').toBe(true);
    expect(w.player.upgrades.has('speed'), 'upgrade is gone').toBe(false);
    expect(t.carrying?.kind).toBe('upgrade');

    const potionsBefore = w.player.potions;
    // shoot him
    w.player.x = t.x - 20;
    w.player.y = t.y;
    w.player.facing = 0;
    const a = emptyActions();
    a.fire = true;
    for (let i = 0; i < 600 && t.alive; i++) w.step(a);

    expect(t.alive).toBe(false);
    // The permanent boost does not come back — only an ordinary potion does.
    expect(w.player.upgrades.has('speed')).toBe(false);
    expect(w.player.potions).toBe(potionsBefore + 1);
    expect(w.items.some((i) => i.alive && i.kind === 'treasure')).toBe(true);
  });
});

/* ------------------------------------------------------------------ rules */

describe('feature toggles', () => {
  it('reports Arcade for defaults and Ineligible once a monster is disabled', () => {
    expect(tierOf(DEFAULT_RULES)).toBe('arcade');
    expect(tierOf({ ...DEFAULT_RULES, lobbers: false })).toBe('ineligible');
    expect(tierOf({ ...DEFAULT_RULES, healthDrain: false })).toBe('ineligible');
    expect(tierOf({ ...DEFAULT_RULES, cornerAssist: false })).toBe('tagged');
    expect(tierOf(PRESETS.Sandbox())).toBe('ineligible');
  });

  it('removes the generators of a disabled family', () => {
    const objects: LevelObject[] = [
      { t: 'gen', x: 10, y: 10, kind: 'ghost', lvl: 2 },
      { t: 'gen', x: 20, y: 10, kind: 'grunt', lvl: 2 },
      { t: 'mon', x: 12, y: 12, kind: 'ghost', lvl: 1 },
    ];
    const on = new World(arena(objects), 'elf', 1);
    expect(on.generators.length).toBe(2);
    expect(on.monsters.length).toBe(1);

    const off = new World(arena(objects), 'elf', 1, undefined, {
      ...DEFAULT_RULES,
      ghosts: false,
    });
    expect(off.generators.length, 'ghost generator should be gone').toBe(1);
    expect(off.monsters.length, 'placed ghost should be gone').toBe(0);
  });

  it('keeps Death and the Thief out entirely when disabled', () => {
    const objects: LevelObject[] = [
      { t: 'death', x: 10, y: 10 },
      { t: 'thief', x: 20, y: 20 },
    ];
    const on = new World(arena(objects), 'elf', 1);
    expect(on.deaths.length).toBe(1);
    expect(on.thieves.length).toBe(1);

    const off = new World(arena(objects), 'elf', 1, undefined, {
      ...DEFAULT_RULES,
      death: false,
      thief: false,
    });
    expect(off.deaths.length).toBe(0);
    expect(off.thieves.length).toBe(0);
  });

  it('actually stops the health drain when switched off', () => {
    const drain = new World(arena(), 'elf', 1);
    run(drain, 300);
    expect(drain.player.health).toBeLessThan(T.START_HEALTH);

    const noDrain = new World(arena(), 'elf', 1, undefined, {
      ...DEFAULT_RULES,
      healthDrain: false,
    });
    run(noDrain, 300);
    expect(noDrain.player.health).toBe(T.START_HEALTH);
  });

  it('actually stops the rank curve when switched off', () => {
    const objects: LevelObject[] = [];
    for (let i = 0; i < 12; i++) objects.push({ t: 'food', x: 4 + i, y: 20 });
    const state = {
      classId: 'elf' as const,
      health: 700,
      score: 290_000,
      credits: 1,
      keys: 0,
      potions: 0,
      upgrades: [],
      invisibleFrames: 0,
      deepestLevel: 1,
    };
    const culled = new World(arena(objects), 'elf', 1, state);
    const kept = new World(arena(objects), 'elf', 1, state, {
      ...DEFAULT_RULES,
      rankCurve: false,
    });
    expect(culled.items.filter((i) => i.alive).length).toBeLessThan(12);
    expect(kept.items.filter((i) => i.alive).length).toBe(12);
  });

  it('makes generators spawn even off-screen when the gating is switched off', () => {
    const far: LevelObject[] = [{ t: 'gen', x: 29, y: 29, kind: 'grunt', lvl: 3 }];
    const gated = new World(arena(far, (r) => r), 'elf', 1);
    gated.player.x = cell(2);
    gated.player.y = cell(2);
    gated.camera.follow(gated.player.x, gated.player.y);
    run(gated, 900);
    expect(gated.liveMonsters).toBe(0);

    const ungated = new World(arena(far), 'elf', 1, undefined, {
      ...DEFAULT_RULES,
      offscreenGenerators: false,
    });
    ungated.player.x = cell(2);
    ungated.player.y = cell(2);
    ungated.camera.follow(ungated.player.x, ungated.player.y);
    run(ungated, 900);
    expect(ungated.liveMonsters).toBeGreaterThan(0);
  });

  it('carries rules through a level transition', () => {
    const rules = cloneRules({ ...DEFAULT_RULES, ghosts: false });
    const r = new Run(CAMPAIGN, 'elf', 1, 0, rules);
    r.world.exitReached = true;
    r.step();
    expect(r.world.rules.ghosts).toBe(false);
    expect(r.world.generators.every((g) => g.kind !== 'ghost')).toBe(true);
  });

  it('has metadata for every toggle, so none can be invisible in the UI', () => {
    // Difficulty is deliberately excluded: it is a ladder, not a switch, and the setup
    // screen gives it its own row rather than an ON/OFF. The point of this test is that
    // nothing is invisible, so the exclusion is named here rather than being a silent
    // filter — if a second non-boolean rule ever appears, this test must be revisited.
    const toggles = Object.entries(DEFAULT_RULES)
      .filter(([, v]) => typeof v === 'boolean')
      .map(([k]) => k)
      .sort();
    const nonToggles = Object.entries(DEFAULT_RULES)
      .filter(([, v]) => typeof v !== 'boolean')
      .map(([k]) => k);

    expect(nonToggles).toEqual(['difficulty']);
    expect(RULE_META.map((m) => m.key).sort()).toEqual(toggles);
  });
});
