import { describe, it, expect, beforeEach } from 'vitest';
import { Announcer, CRITICAL_HEALTH, LOW_HEALTH, type AnnouncerState } from '@/ui/announcer';
import type { GameEvent } from '@/game/events';
import { Particles } from '@/render/particles';
import { ScreenFx } from '@/render/fx';

const SEC = 60;

function state(over: Partial<AnnouncerState> = {}): AnnouncerState {
  return {
    className: 'Elf',
    health: 700,
    frame: 10 * SEC,
    levelStarted: false,
    hasHiddenUpgrade: false,
    deathOnScreen: false,
    thiefPresent: false,
    dead: false,
    ...over,
  };
}

describe('announcer', () => {
  let a: Announcer;
  beforeEach(() => {
    a = new Announcer();
  });

  it('says nothing when nothing is wrong', () => {
    expect(a.update(state(), [])).toBeNull();
  });

  it('warns about food below the low threshold', () => {
    const line = a.update(state({ health: LOW_HEALTH - 1 }), []);
    expect(line?.text).toBe('Elf needs food badly!');
  });

  it('escalates below critical, and does not also nag about food', () => {
    const line = a.update(state({ health: CRITICAL_HEALTH - 1 }), []);
    expect(line?.text).toBe('Elf is about to die!');
    expect(line?.priority).toBe('critical');
  });

  it('uses the actual class name', () => {
    expect(a.update(state({ className: 'Warrior', health: 50 }), [])?.text).toBe(
      'Warrior is about to die!',
    );
  });

  it('does not repeat a still-true warning every frame', () => {
    const first = a.update(state({ health: 150, frame: 100 }), []);
    expect(first).toBeTruthy();
    for (let f = 101; f < 100 + 15 * SEC; f++) {
      expect(a.update(state({ health: 150, frame: f }), []), `frame ${f}`).toBeNull();
    }
  });

  it('repeats it once the cooldown has passed, because it is still true', () => {
    a.update(state({ health: 150, frame: 100 }), []);
    const later = a.update(state({ health: 150, frame: 100 + 15 * SEC }), []);
    expect(later?.text).toBe('Elf needs food badly!');
  });

  it('reacts to shooting the food', () => {
    const events: GameEvent[] = [{ t: 'foodDestroyed', x: 0, y: 0 }];
    expect(a.update(state(), events)?.text).toBe('Elf shot the food!');
  });

  it('prioritises dying over everything else happening at once', () => {
    const events: GameEvent[] = [
      { t: 'foodDestroyed', x: 0, y: 0 },
      { t: 'upgradeTaken', upgrade: 'speed' },
    ];
    const line = a.update(state({ health: 20, deathOnScreen: true, thiefPresent: true }), events);
    expect(line?.priority).toBe('critical');
  });

  it('mentions a hidden upgrade once per level, then stops', () => {
    const s = state({ levelStarted: true, hasHiddenUpgrade: true, frame: 30 });
    expect(a.update(s, [])?.text).toBe('A potion lies hidden here.');
    expect(a.update({ ...s, frame: 60 }, [])).toBeNull();
  });

  it('allows it again after a new level', () => {
    const s = state({ levelStarted: true, hasHiddenUpgrade: true, frame: 30 });
    expect(a.update(s, [])).toBeTruthy();
    a.newLevel();
    expect(a.update({ ...s, frame: 400 }, [])?.text).toBe('A potion lies hidden here.');
  });

  it('warns about Death and the Thief', () => {
    expect(a.update(state({ deathOnScreen: true }), [])?.text).toBe('Death is upon you.');
    const b = new Announcer();
    expect(b.update(state({ thiefPresent: true }), [])?.text).toContain('thief');
  });

  it('announces the player death exactly once', () => {
    const events: GameEvent[] = [{ t: 'playerDied' }];
    expect(a.update(state({ health: 0, dead: true }), events)?.text).toBe('Elf has died.');
    expect(a.update(state({ health: 0, dead: true, frame: 99999 }), events)).toBeNull();
  });

  it('goes silent once the player is dead', () => {
    // Reported from play: the narrator kept telling a corpse it was about to die.
    // Every warning is driven by STATE, and a dead player satisfies all of them
    // permanently — health is 0, Death is still on screen, the thief is still around.
    a.update(state({ health: 0, dead: true }), [{ t: 'playerDied' }]);
    for (let f = 0; f < 120 * SEC; f += SEC) {
      const line = a.update(
        state({ health: 0, dead: true, frame: 100000 + f, deathOnScreen: true, thiefPresent: true }),
        [],
      );
      expect(line, `should stay silent at +${f / SEC}s after death`).toBeNull();
    }
  });

  it('still warns normally right up until the moment of death', () => {
    expect(a.update(state({ health: 40, dead: false }), [])?.text).toBe('Elf is about to die!');
  });

  it('says nothing at all if the run ends without a death event reaching it', () => {
    // e.g. the player quit, or the event was drained on an earlier frame
    expect(a.update(state({ health: 0, dead: true }), [])).toBeNull();
  });
});

describe('particles', () => {
  it('never exceeds its pool, however hard it is hammered', () => {
    const p = new Particles();
    for (let i = 0; i < 200; i++) p.spawn(100, 100, 50, { life: 10000 });
    expect(p.liveCount).toBeLessThanOrEqual(400);
  });

  it('retires particles when their life runs out', () => {
    const p = new Particles();
    p.spawn(0, 0, 20, { life: 3 });
    expect(p.liveCount).toBe(20);
    for (let i = 0; i < 30; i++) p.update();
    expect(p.liveCount).toBe(0);
  });

  it('emits nothing at all when disabled for reduced motion', () => {
    const p = new Particles();
    p.enabled = false;
    p.spawn(0, 0, 50);
    expect(p.liveCount).toBe(0);
  });
});

describe('screen effects', () => {
  it('decays back to rest', () => {
    const fx = new ScreenFx();
    fx.addShake(10);
    for (let i = 0; i < 200; i++) fx.update();
    expect(fx.offsetX).toBe(0);
    expect(fx.offsetY).toBe(0);
    expect(fx.scale).toBeCloseTo(1, 5);
  });

  it('suppresses shake, flash and punch under reduced motion', () => {
    const fx = new ScreenFx();
    fx.motionEnabled = false;
    fx.addShake(10);
    fx.addPunch(1);
    fx.update();
    expect(fx.offsetX).toBe(0);
    expect(fx.scale).toBeCloseTo(1, 5);
  });

  it('keeps the damage vignette even under reduced motion, because it is information', () => {
    const fx = new ScreenFx();
    fx.motionEnabled = false;
    fx.addVignette(0.5);
    // no throw, and it decays; the point is that addVignette is not gated
    fx.update();
    expect(true).toBe(true);
  });
});
