import { describe, it, expect, beforeEach } from 'vitest';
import { T } from '@/data/tuning';
import { bossHits, finish, spawnBoss, stepBoss, zap } from '@/game/boss';
import { World } from '@/game/world';
import { roomFor } from '@/data/rooms';
import { FINAL_ROOM } from '@/game/campaign';
import { emptyCounters } from '@/game/counters';
import { initialScore } from '@/game/score';
import { emptyActions } from '@/game/controls';
import { spawnBolt, spawnFire, spawnWater } from '@/game/special';
import { spawnBubble, resetBubbleIds } from '@/game/bubble';
import { resetMonsterIds } from '@/game/monster';

const idle = () => emptyActions();
const bossWorld = () => new World(roomFor(FINAL_ROOM), FINAL_ROOM, initialScore(), emptyCounters());

beforeEach(() => {
  resetBubbleIds();
  resetMonsterIds();
});

describe('the boss room', () => {
  it('is room 100, and it carries a boss instead of spawns', () => {
    const room = roomFor(FINAL_ROOM);
    expect(room.boss).toBe(true);
    expect(room.spawns.length).toBe(0);
  });

  /**
   * Only lightning hurts it, so offering water or fire here would be a cruel joke on a
   * player still working out what does.
   */
  it('offers lightning and nothing else', () => {
    expect(roomFor(FINAL_ROOM).specialBubbles).toEqual(['lightning']);
  });

  it('puts a boss in the world', () => {
    const w = bossWorld();
    expect(w.boss).not.toBe(null);
    expect(w.boss!.hp).toBe(T.BOSS_HP);
    expect(w.phase).toBe('playing');
  });
});

describe('the fight', () => {
  it('stays airborne and never comes down to the floor', () => {
    const b = spawnBoss();
    const lowest = T.TILE * T.BOSS_FLOOR_ROW;
    for (let f = 0; f < 3000; f++) {
      stepBoss(b, 120, 190);
      expect(b.y + b.half).toBeLessThanOrEqual(lowest + 0.001);
      expect(b.x - b.half).toBeGreaterThanOrEqual(T.TILE - 0.001);
    }
  });

  it('throws, and throws faster as it weakens', () => {
    const healthy = spawnBoss();
    let earlyThrows = 0;
    for (let f = 0; f < 600; f++) if (stepBoss(healthy, 40, 100).threw) earlyThrows++;

    const hurt = spawnBoss();
    hurt.hp = 1;
    let lateThrows = 0;
    for (let f = 0; f < 600; f++) if (stepBoss(hurt, 40, 100).threw) lateThrows++;

    expect(earlyThrows).toBeGreaterThan(0);
    expect(lateThrows).toBeGreaterThan(earlyThrows);
  });

  /** The fight's whole argument: every verb the player has mastered stops working. */
  it('cannot be caught in an ordinary bubble', () => {
    const w = bossWorld();
    const boss = w.boss!;
    const b = spawnBubble(boss.x, boss.y, 1, 'normal');
    b.phase = 'free';
    b.fireFrames = 0;
    w.bubbles.push(b);

    for (let f = 0; f < 60; f++) w.step(idle());
    expect(b.captive).toBe(null);
    expect(boss.state).not.toBe('dead');
    expect(w.phase).toBe('playing');
  });

  it('is untouched by water and fire', () => {
    const w = bossWorld();
    const boss = w.boss!;
    const hp = boss.hp;
    w.drops.push(...spawnWater(boss.x, boss.y));
    w.flames.push(...spawnFire(boss.x, boss.y - 4));

    for (let f = 0; f < 120; f++) w.step(idle());
    expect(boss.hp).toBe(hp);
    expect(boss.state).toBe('fighting');
  });

  it('takes damage only from lightning', () => {
    const w = bossWorld();
    const boss = w.boss!;
    const hp = boss.hp;
    w.bolts.push(spawnBolt(boss.x - 30, boss.y, 1));

    for (let f = 0; f < 60 && boss.hp === hp; f++) w.step(idle());
    expect(boss.hp).toBeLessThan(hp);
  });

  it('becomes bubbleable once beaten down, rather than simply dying', () => {
    const b = spawnBoss();
    for (let i = 0; i < T.BOSS_HP - 1; i++) {
      expect(zap(b)).toBe(false);
      expect(b.state).toBe('fighting');
    }
    expect(zap(b)).toBe(true);
    expect(b.state).toBe('bubbled');
    expect(finish(b)).toBe(true);
    expect(b.state).toBe('dead');
  });

  /** Miss the window and the fight resumes — which stops the last hit being a formality. */
  it('breaks back out if it is not popped in time', () => {
    const b = spawnBoss();
    b.hp = 1;
    zap(b);
    expect(b.state).toBe('bubbled');

    let brokeFree = false;
    for (let f = 0; f < T.BOSS_BUBBLE_FRAMES + 5; f++) {
      if (stepBoss(b, 100, 100).brokeFree) brokeFree = true;
    }
    expect(brokeFree).toBe(true);
    expect(b.state).toBe('fighting');
  });

  it('cannot be finished while it is still fighting', () => {
    const b = spawnBoss();
    expect(finish(b)).toBe(false);
    expect(b.state).toBe('fighting');
  });

  /** Lethal on contact while fighting; walking into it is how you finish it once held. */
  it('is lethal to touch while fighting and harmless once held', () => {
    const b = spawnBoss();
    expect(bossHits(b, b.x, b.y, 6, 7)).toBe(true);
    b.hp = 1;
    zap(b);
    expect(b.state).toBe('bubbled');
    expect(bossHits(b, b.x, b.y, 6, 7)).toBe(false);
  });

  it('ends the game when it dies, and pays for it', () => {
    const w = bossWorld();
    const boss = w.boss!;
    boss.hp = 1;
    zap(boss);

    // Walk the player into the held boss.
    w.player.body.x = boss.x;
    w.player.body.y = boss.y;
    for (let f = 0; f < 10 && w.phase === 'playing'; f++) w.step(idle());

    expect(boss.state).toBe('dead');
    expect(w.phase).toBe('won');
    expect(w.score.points).toBeGreaterThanOrEqual(T.BOSS_SCORE);
  });

  it('does not end the room merely because there are no ordinary monsters', () => {
    const w = bossWorld();
    expect(w.liveMonsters.length).toBe(0);
    for (let f = 0; f < 120; f++) w.step(idle());
    // A non-boss room would have called itself cleared on frame one.
    expect(w.phase).toBe('playing');
  });
});
