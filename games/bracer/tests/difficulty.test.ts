import { describe, it, expect } from 'vitest';
import { T } from '@/data/tuning';
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  difficultyOf,
  difficultyRank,
  stepDifficulty,
} from '@/data/difficulty';
import { DEFAULT_RULES, cloneRules, tierOf } from '@/data/rules';
import { CAMPAIGN, DUNGEONS } from '@/data/campaign';
import { World } from '@/game/world';
import { spawnPeriod } from '@/game/generator';
import { emptyActions } from '@/engine/actions';
import { Announcer } from '@/ui/announcer';
import { analyseLevel } from '@/game/analyse';

const level = () => DUNGEONS.find((l) => l.type === 'normal' && l.objects.some((o) => o.t === 'gen'))!;

describe('difficulty ladder', () => {
  it('is monotonic in every direction that matters', () => {
    // A ladder that is not monotonic is not a ladder — a player moving one rung up must
    // never get an easier game in any dimension.
    for (let i = 1; i < DIFFICULTIES.length; i++) {
      const prev = DIFFICULTIES[i - 1];
      const cur = DIFFICULTIES[i];
      expect(cur.maxHealth, `${cur.id} health`).toBeLessThan(prev.maxHealth);
      expect(cur.warmupSec, `${cur.id} warm-up`).toBeLessThan(prev.warmupSec);
      expect(cur.periodScale, `${cur.id} spawn period`).toBeLessThan(prev.periodScale);
      expect(cur.capScale, `${cur.id} crowd cap`).toBeGreaterThan(prev.capScale);
    }
  });

  it('caps health at 1500 by default', () => {
    expect(difficultyOf(DEFAULT_DIFFICULTY).maxHealth).toBe(1500);
    expect(new World(level(), 'elf', 1).maxHealth).toBe(1500);
  });

  it('clamps to the ends rather than wrapping when stepped', () => {
    expect(stepDifficulty(DIFFICULTIES[0].id, -1)).toBe(DIFFICULTIES[0].id);
    const last = DIFFICULTIES[DIFFICULTIES.length - 1].id;
    expect(stepDifficulty(last, 1)).toBe(last);
  });

  it('survives an unknown id instead of throwing', () => {
    // Settings are read from localStorage, which is user-editable and can be stale.
    expect(difficultyOf('bogus' as never).id).toBe(DEFAULT_DIFFICULTY);
  });
});

describe('the health cap', () => {
  it('discards overheal rather than refusing the food', () => {
    // Refusing it would make food an obstacle to walk around at full health, which is a
    // worse outcome than wasting it.
    const w = new World(level(), 'elf', 1);
    w.player.health = w.maxHealth - 10;
    const before = w.items.filter((i) => i.kind === 'food' && i.alive).length;
    expect(before).toBeGreaterThan(0);

    const food = w.items.find((i) => i.kind === 'food' && i.alive)!;
    w.player.x = food.x;
    w.player.y = food.y;
    w.step(emptyActions());

    expect(w.player.health).toBe(w.maxHealth);
    expect(w.items.filter((i) => i.kind === 'food' && i.alive).length).toBe(before - 1);
  });

  it('clamps health carried in from a level played on an easier setting', () => {
    const easy = cloneRules({ ...DEFAULT_RULES, difficulty: 'apprentice' });
    const banked = new World(level(), 'elf', 1, undefined, easy);
    banked.player.health = 2400;

    const hard = cloneRules({ ...DEFAULT_RULES, difficulty: 'nightmare' });
    const next = new World(level(), 'elf', 1, banked.exportState(), hard);
    expect(next.player.health).toBe(difficultyOf('nightmare').maxHealth);
  });
});

describe('generator pressure', () => {
  it('scales the spawn period with difficulty, and floors it', () => {
    expect(spawnPeriod(1, 1, 0.5)).toBeLessThan(spawnPeriod(1, 1, 1));
    expect(spawnPeriod(3, 500, 0.4)).toBeGreaterThanOrEqual(12);
  });

  it('spends the warm-up once, not on every sighting', () => {
    // A per-sighting timer would make peeking in and out of a doorway a free reset.
    const rules = cloneRules({ ...DEFAULT_RULES, difficulty: 'apprentice' });
    const w = new World(level(), 'elf', 1, undefined, rules);
    const g = w.generators[0];

    // Drag the generator into view and let the warm-up be applied.
    w.camera.follow(g.x, g.y);
    w.step(emptyActions());
    expect(g.seen).toBe(true);
    const afterFirst = g.timer;

    g.timer = 5;
    w.camera.follow(g.x, g.y);
    w.step(emptyActions());
    expect(g.timer, 'a second sighting must not re-arm the warm-up').toBeLessThan(afterFirst);
  });

  it('gives Nightmare no warm-up at all', () => {
    expect(difficultyOf('nightmare').warmupSec).toBe(0);
  });

  it('actually produces more monsters at a higher setting', () => {
    // The whole point of the ladder. Every knob above is individually monotonic, but
    // what matters is the number of monsters that end up in the room, so measure that
    // on the real level with everything interacting.
    const spawned = (id: 'apprentice' | 'veteran' | 'nightmare'): number => {
      const w = new World(level(), 'elf', 1, undefined, cloneRules({ ...DEFAULT_RULES, difficulty: id }));
      w.godMode = true; // the player must survive long enough to be a witness
      const g = w.generators[0];
      let n = 0;
      for (let i = 0; i < 60 * T.STEP_HZ; i++) {
        w.camera.follow(g.x, g.y);
        w.step(emptyActions());
        n += w.events.drain().filter((e) => e.t === 'spawned').length;
      }
      return n;
    };

    const easy = spawned('apprentice');
    const mid = spawned('veteran');
    const hard = spawned('nightmare');
    expect(mid, `veteran ${mid} vs apprentice ${easy}`).toBeGreaterThan(easy);
    expect(hard, `nightmare ${hard} vs veteran ${mid}`).toBeGreaterThan(mid);
  });
});

describe('eligibility', () => {
  it('leaves a harder-than-default run fully eligible', () => {
    // Playing above the default is not a way to get an easier score, so marking it would
    // punish exactly the players doing the hard thing.
    for (const id of ['champion', 'nightmare'] as const) {
      expect(tierOf(cloneRules({ ...DEFAULT_RULES, difficulty: id })), id).toBe('arcade');
    }
  });

  it('marks an easier-than-default run', () => {
    for (const id of ['apprentice', 'squire'] as const) {
      expect(tierOf(cloneRules({ ...DEFAULT_RULES, difficulty: id })), id).toBe('tagged');
    }
  });
});

describe('doors', () => {
  it('waits long enough that exploring does not open them', () => {
    // The clock counts frames since the player last FOUGHT, and exploring a maze for the
    // key does none of those things. At the old 18s a player simply looking for the key
    // watched every locked door swing open unprompted.
    expect(T.DOOR_AUTO_OPEN_SEC).toBeGreaterThanOrEqual(60);
    expect(T.DOOR_AUTO_OPEN_SEC_WITH_KEYS).toBe(T.DOOR_AUTO_OPEN_SEC * 2);
  });

  it('does not give up before the full stalemate window has passed', () => {
    const withDoor = CAMPAIGN.find((l) => l.tiles.some((r) => r.includes('D')))!;
    const w = new World(withDoor, 'elf', 1);
    w.rules.thief = false;

    const ranFor = (seconds: number): boolean => {
      let fired = false;
      for (let i = 0; i < seconds * T.STEP_HZ; i++) {
        w.step(emptyActions());
        if (w.events.drain().some((e) => e.t === 'doorsOpened' && e.all)) fired = true;
      }
      return fired;
    };

    // A minute of no fighting is not a stalemate; it is a player reading the map.
    expect(ranFor(60), 'doors opened after only 60s').toBe(false);
    expect(ranFor(35), 'doors never gave up at all').toBe(true);
  });
});

describe('the narrator', () => {
  it('says "do not shoot the food" once per run, not once per level', () => {
    const ann = new Announcer();
    const state = {
      className: 'Elf',
      health: 700,
      frame: 10,
      levelStarted: true,
      hasHiddenUpgrade: false,
      deathOnScreen: false,
      thiefPresent: false,
      dead: false,
    };
    expect(ann.update(state, [])?.tag).toBe('dontShoot');

    for (let level = 0; level < 6; level++) {
      ann.newLevel();
      expect(ann.update(state, [])?.tag, `level ${level + 2}`).not.toBe('dontShoot');
    }

    // A brand new run may be told again — it could be somebody else at the cabinet.
    ann.reset();
    expect(ann.update(state, [])?.tag).toBe('dontShoot');
  });
});

describe('hidden upgrade potions', () => {
  it('puts them a long walk from the start, not two tiles away', () => {
    // "A potion lies hidden here" was being announced about something already on screen
    // on the first frame, which is funny exactly once.
    for (const lvl of CAMPAIGN) {
      const up = lvl.objects.filter((o) => o.t === 'upgrade');
      if (!up.length) continue;
      const { reachable } = analyseLevel(lvl);
      for (const o of up) {
        expect(reachable.has(`${o.x},${o.y}`), `${lvl.id}: upgrade unreachable`).toBe(true);
        const walk = Math.abs(o.x - lvl.start[0]) + Math.abs(o.y - lvl.start[1]);
        expect(walk, `${lvl.id}: upgrade only ${walk} tiles from the start`).toBeGreaterThan(20);
      }
    }
  });
});
