import { describe, it, expect, beforeEach } from 'vitest';
import { T } from '@/data/tuning';
import { validateRoom, type RoomData } from '@/game/room';
import { World } from '@/game/world';
import { emptyActions, type ActionState } from '@/game/controls';
import { capture, spawnBubble, resetBubbleIds } from '@/game/bubble';
import { resetMonsterIds } from '@/game/monster';
import room001Json from '@/data/rooms/r001.json';

function room(spec: {
  platforms?: [number, number, number][];
  spawns?: { kind: string; x: number; y: number; dir: -1 | 1 }[];
  playerStart?: { x: number; y: number };
  escapeFrames?: number;
  timer?: number;
}): RoomData {
  const rows: string[][] = [];
  for (let y = 0; y < T.GRID_H; y++) {
    const r = new Array<string>(T.GRID_W).fill('.');
    r[0] = '#';
    r[T.GRID_W - 1] = '#';
    rows.push(r);
  }
  for (const [y, x0, x1] of spec.platforms ?? [[25, 1, 30]]) {
    for (let x = x0; x <= x1; x++) rows[y][x] = '=';
  }

  const r = validateRoom({
    id: 'fixture',
    tiles: rows.map((x) => x.join('')),
    playerStart: spec.playerStart ?? { x: 5, y: 24 },
    spawns: spec.spawns ?? [{ kind: 'zenchan', x: 20, y: 24, dir: -1 }],
    escapeFrames: spec.escapeFrames,
    timer: spec.timer,
  });
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.data;
}

const idle = (): ActionState => emptyActions();
const blow = (): ActionState => ({ ...emptyActions(), blowPressed: true, blow: true });

beforeEach(() => {
  resetBubbleIds();
  resetMonsterIds();
});

describe('firing', () => {
  it('blows a bubble in the direction the player faces', () => {
    const w = new World(room({}));
    w.step({ ...emptyActions(), moveX: 1 });
    w.step(blow());
    expect(w.bubbles.length).toBe(1);
    expect(w.bubbles[0].dir).toBe(1);
    expect(w.bubbles[0].x).toBeGreaterThan(w.player.body.x);
  });

  it('rate-limits, so holding the button is not a stream', () => {
    const w = new World(room({}));
    for (let i = 0; i < 10; i++) w.step(blow());
    expect(w.bubbles.length).toBe(1);

    for (let i = 0; i < T.BUBBLE_COOLDOWN; i++) w.step(idle());
    w.step(blow());
    expect(w.bubbles.length).toBe(2);
  });
});

describe('capture and escape', () => {
  it('traps a monster the bubble reaches', () => {
    const w = new World(room({ spawns: [{ kind: 'zenchan', x: 9, y: 24, dir: -1 }] }));
    w.step({ ...emptyActions(), moveX: 1 });
    w.step(blow());

    for (let i = 0; i < 40; i++) {
      w.step(idle());
      if (w.monsters[0].state === 'bubbled') break;
    }
    expect(w.monsters[0].state).toBe('bubbled');
    expect(w.bubbles[0].captive).toBe(w.monsters[0]);
  });

  /**
   * A timed-out catch pays nothing. If it did, ignoring your bubbles would be a viable
   * strategy, and the escape clock would stop being a threat.
   */
  it('releases an angry monster and scores nothing when the clock runs out', () => {
    const w = new World(room({ escapeFrames: 5 }));
    const m = w.monsters[0];
    const b = spawnBubble(m.body.x, m.body.y, 1, 'normal');
    w.bubbles.push(b);
    capture(b, m, 5);

    for (let i = 0; i < 8; i++) w.step(idle());

    expect(m.state).toBe('walking');
    expect(m.angry).toBe(true);
    expect(w.score.points).toBe(0);
    expect(w.bubbles.length).toBe(0);
  });

  it('makes an escaped monster faster than it was', () => {
    const w = new World(room({}));
    const m = w.monsters[0];
    const calm = Math.abs(m.body.vx);
    m.angry = true;
    w.step(idle());
    expect(Math.abs(m.body.vx)).toBeGreaterThan(calm);
  });
});

describe('popping', () => {
  /** Put n monsters into n touching bubbles, all loaded, ready to burst as one. */
  function loadedCluster(n: number): World {
    const spawns = Array.from({ length: n }, (_, i) => ({
      kind: 'zenchan',
      x: 12 + i,
      y: 24,
      dir: 1 as const,
    }));
    const w = new World(room({ spawns }));
    const px = w.player.body.x;
    const py = w.player.body.y;
    w.monsters.forEach((m, i) => {
      // Cluster them just in front of the player, each within chaining distance.
      const b = spawnBubble(px + 20 + i * 14, py, 1, 'normal');
      b.phase = 'free';
      b.fireFrames = 0;
      w.bubbles.push(b);
      capture(b, m, 600);
    });
    return w;
  }

  it('scores a three-chain as 4,000, not 3,000', () => {
    const w = loadedCluster(3);
    w.popChain(0);
    expect(w.lastChain.monsters).toBe(3);
    expect(w.score.points).toBe(4_000);
  });

  it('resolves the whole cluster as one event', () => {
    const w = loadedCluster(5);
    w.popChain(2); // burst from the middle
    expect(w.lastChain.monsters).toBe(5);
    expect(w.score.points).toBe(16_000);
    expect(w.monsters.every((m) => m.state === 'dead')).toBe(true);
  });

  it('drops EXTEND letters on the documented curve', () => {
    const lettersFor = (n: number): number => {
      const w = loadedCluster(n);
      w.popChain(0);
      return w.lastChain.letters;
    };
    expect(lettersFor(2)).toBe(0);
    expect(lettersFor(3)).toBe(1);
    expect(lettersFor(4)).toBe(2);
  });

  it('pays a flat rate for empty bubbles', () => {
    const w = new World(room({}));
    for (let i = 0; i < 3; i++) {
      const b = spawnBubble(100 + i * 14, 100, 1, 'normal');
      b.phase = 'free';
      w.bubbles.push(b);
    }
    w.popChain(0);
    expect(w.score.points).toBe(3 * T.EMPTY_BUBBLE_POP);
    expect(w.lastChain.monsters).toBe(0);
  });
});

describe('riding, pushing and popping', () => {
  /** Place a bubble under the player's feet and let it fall onto it. */
  it('stands on a bubble as if it were floor', () => {
    const w = new World(room({ playerStart: { x: 5, y: 10 } }));
    const p = w.player.body;
    const b = spawnBubble(p.x, p.y + p.halfH + T.BUBBLE_RADIUS + 4, 1, 'normal');
    b.phase = 'free';
    b.fireFrames = 0;
    b.life = 100_000;
    w.bubbles.push(b);

    for (let i = 0; i < 20; i++) {
      w.step(idle());
      if (p.ridingIndex >= 0) break;
    }
    expect(p.ridingIndex).toBeGreaterThanOrEqual(0);
    expect(p.onGround).toBe(true);
  });

  /**
   * The skill ceiling of the whole game. Walking into a bubble front-first shoves it —
   * that is how a solo player assembles the cluster the exponential curve pays for.
   */
  it('pushes a bubble the player walks into front-first', () => {
    const w = new World(room({}));
    const p = w.player.body;
    const b = spawnBubble(p.x + T.BUBBLE_RADIUS + p.halfW - 2, p.y, 1, 'normal');
    b.phase = 'free';
    b.fireFrames = 0;
    b.life = 100_000;
    w.bubbles.push(b);

    const x0 = b.x;
    w.step({ ...emptyActions(), moveX: 1 });
    expect(w.bubbles.length).toBe(1); // not popped
    for (let i = 0; i < 5; i++) w.step({ ...emptyActions(), moveX: 1 });
    expect(b.x).toBeGreaterThan(x0);
  });

  /** The spines are on its back, so backing into a bubble bursts it. */
  it('pops a bubble that touches the player from behind', () => {
    const w = new World(room({}));
    const p = w.player.body;
    w.step({ ...emptyActions(), moveX: 1 }); // face right
    expect(w.player.facing).toBe(1);

    const b = spawnBubble(p.x - (T.BUBBLE_RADIUS + p.halfW - 2), p.y, 1, 'normal');
    b.phase = 'free';
    b.fireFrames = 0;
    w.bubbles.push(b);

    w.step({ ...emptyActions(), moveX: 1 });
    expect(w.bubbles.length).toBe(0);
    expect(w.score.points).toBe(T.EMPTY_BUBBLE_POP);
  });
});

describe('the room', () => {
  it('is cleared when the last monster dies', () => {
    const w = new World(room({}));
    expect(w.phase).toBe('playing');
    w.monsters[0].state = 'dead';
    w.step(idle());
    expect(w.phase).toBe('cleared');
  });

  it('costs a life when a monster touches the player', () => {
    const w = new World(room({ spawns: [{ kind: 'zenchan', x: 5, y: 24, dir: 1 }] }));
    const lives = w.score.lives;
    w.step(idle());
    expect(w.score.lives).toBe(lives - 1);
  });

  it('ends the game when the last life goes', () => {
    const w = new World(room({ spawns: [{ kind: 'zenchan', x: 5, y: 24, dir: 1 }] }));
    w.score.lives = 1;
    w.step(idle());
    expect(w.phase).toBe('dead');
  });

  it('raises HURRY UP when the timer expires', () => {
    const w = new World(room({ timer: 3 }));
    expect(w.hurryUp).toBe(false);
    for (let i = 0; i < 3; i++) w.step(idle());
    expect(w.hurryUp).toBe(true);
  });

  it('runs room 1 for a while without throwing or losing its monsters', () => {
    const r = validateRoom(room001Json);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    const w = new World(r.data, 7);
    for (let i = 0; i < 600; i++) w.step(idle());
    // The player is stationary at the start point; nothing should have vanished except
    // through a real interaction.
    expect(w.monsters.length).toBe(2);
    expect(Number.isFinite(w.player.body.x)).toBe(true);
    expect(Number.isFinite(w.player.body.y)).toBe(true);
  });
});
