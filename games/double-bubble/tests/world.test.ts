import { describe, it, expect, beforeEach } from 'vitest';
import { T } from '@/data/tuning';
import { validateRoom, type RoomData } from '@/game/room';
import { World } from '@/game/world';
import { emptyActions, type ActionState } from '@/game/controls';
import { capture, spawnBubble, resetBubbleIds } from '@/game/bubble';
import { resetMonsterIds } from '@/game/monster';
import { MONSTER_SPECS } from '@/data/roster';
import room001Json from '@/data/rooms/r001.json';
import { predictJump } from '@/game/physics';

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

  /**
   * The regression that made the whole game unplayable without failing a single test.
   *
   * Bubbles spawned at exactly PLAYER_HALF_W + BUBBLE_RADIUS — the overlap threshold —
   * so once a second bubble existed, separation nudged one back into the player and it
   * burst on the frame after being blown. Standing still and firing produced 1, 2, then
   * 0 bubbles. Every unit test passed: each mechanic was individually correct, and the
   * interaction between spawn distance and separation was what broke it.
   *
   * Without a cluster there are no chains, and without chains the exponential curve —
   * the reason the game is about herding at all — is unreachable.
   */
  it('accumulates a cluster when the player stands still and keeps blowing', () => {
    const w = new World(room({ spawns: [{ kind: 'zenchan', x: 28, y: 24, dir: -1 }] }));
    w.step({ ...emptyActions(), moveX: 1 }); // face right, away from the monster's start

    for (let volley = 0; volley < 4; volley++) {
      w.step(blow());
      for (let i = 0; i < T.BUBBLE_COOLDOWN; i++) w.step(idle());
    }

    expect(w.bubbles.length).toBe(4);
    expect(w.score.points).toBe(0); // none of them were burst on the way out
  });

  it('does not let a bubble still in flight interact with the player', () => {
    const w = new World(room({}));
    w.step(blow());
    const b = w.bubbles[0];
    expect(b.phase).toBe('fired');

    // Park it right on top of the player: it must still survive while under impulse.
    b.x = w.player.body.x;
    b.y = w.player.body.y;
    w.step(idle());
    expect(w.bubbles.length).toBe(1);
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

describe('events for the renderer', () => {
  /** Reuses the loaded-cluster helper's shape: n monsters, each in a touching bubble. */
  function loaded(n: number): World {
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
      const b = spawnBubble(px + 24 + i * 14, py, 1, 'normal');
      b.phase = 'free';
      b.fireFrames = 0;
      w.bubbles.push(b);
      capture(b, m, 600);
    });
    w.events.length = 0;
    return w;
  }

  it('announces one pop per bubble and one chain for the whole burst', () => {
    const w = loaded(3);
    w.popChain(0);

    const pops = w.events.filter((e) => e.kind === 'monsterPop');
    const chains = w.events.filter((e) => e.kind === 'chain');
    expect(pops.length).toBe(3);
    expect(chains.length).toBe(1);
    expect(chains[0]).toMatchObject({ monsters: 3, points: 4_000 });
  });

  /** A six-chain is one event and should read at the middle of what was burst, not at
   *  whichever bubble the player happened to touch. */
  it('places the chain readout at the centre of the cluster', () => {
    const w = loaded(3);
    const xs = w.bubbles.map((b) => b.x);
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    w.popChain(0);
    const chain = w.events.find((e) => e.kind === 'chain')!;
    expect(chain.kind === 'chain' && Math.abs(chain.x - mid)).toBeLessThan(2);
  });

  it('carries the monster colour, so a loaded pop can look different from an empty one', () => {
    const w = loaded(1);
    w.popChain(0);
    const pop = w.events.find((e) => e.kind === 'monsterPop')!;
    expect(pop.kind === 'monsterPop' && pop.colour).toBe(MONSTER_SPECS.zenchan.colour);
  });

  it('distinguishes an escape from a kill', () => {
    const w = new World(room({ escapeFrames: 3 }));
    const m = w.monsters[0];
    const b = spawnBubble(m.body.x, m.body.y, 1, 'normal');
    w.bubbles.push(b);
    capture(b, m, 3);
    w.events.length = 0;

    for (let i = 0; i < 6; i++) w.step(idle());

    expect(w.events.some((e) => e.kind === 'escape')).toBe(true);
    expect(w.events.some((e) => e.kind === 'monsterPop')).toBe(false);
    expect(w.events.some((e) => e.kind === 'chain')).toBe(false);
  });

  it('announces a bubble that simply times out', () => {
    const w = new World(room({}));
    w.step(blow());
    const b = w.bubbles[0];
    b.life = 1;
    w.events.length = 0;
    for (let i = 0; i < 3; i++) w.step(idle());
    expect(w.events.some((e) => e.kind === 'bubblePop')).toBe(true);
  });

  /** Events are drained by the renderer, not the sim. If nothing drains them during a
   *  long room they must not grow without bound in a way that hides a leak. */
  it('leaves the list for the renderer to drain rather than clearing it itself', () => {
    const w = loaded(2);
    w.popChain(0);
    const before = w.events.length;
    expect(before).toBeGreaterThan(0);
    w.step(idle());
    expect(w.events.length).toBeGreaterThanOrEqual(before);
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
});

describe('the hurry-up and the Baron', () => {
  /**
   * A room the player can genuinely sit in unmolested, so only the clock is under test.
   *
   * The monster goes on an isolated tier it cannot leave — a walker turns at ledges, and
   * only climbs toward a player *above* it. Sharing a floor with the player is not quiet:
   * it crosses the room in about 350 frames, kills them, and the death resets the very
   * clock these tests are timing.
   */
  const quiet = () =>
    room({
      platforms: [
        [25, 1, 30],
        [8, 10, 16],
      ],
      spawns: [{ kind: 'zenchan', x: 13, y: 7, dir: 1 }],
      playerStart: { x: 5, y: 24 },
      timer: 2,
    });

  /**
   * The warning has to actually be a warning. If the Baron arrived with the text, a
   * player reacting to HURRY UP would already be too late, and the whole point of
   * flashing it would be lost.
   */
  it('gives the player a beat between HURRY UP and the Baron', () => {
    const w = new World(quiet());
    for (let i = 0; i < 3; i++) w.step(idle());
    expect(w.hurryUp).toBe(true);
    expect(w.baron).toBe(null);

    for (let i = 0; i < T.BARON_DELAY - 2; i++) w.step(idle());
    expect(w.baron).toBe(null);

    for (let i = 0; i < 4; i++) w.step(idle());
    expect(w.baron).not.toBe(null);
  });

  it('cannot be bubbled, popped, or killed — it is not an enemy, it is the clock', () => {
    const w = new World(quiet());
    for (let i = 0; i < T.BARON_DELAY + 8; i++) w.step(idle());
    const baron = w.baron!;
    expect(baron).toBeTruthy();

    // Blow bubbles straight at it for a good while; it must still be there.
    for (let i = 0; i < 200; i++) w.step(i % T.BUBBLE_COOLDOWN === 0 ? blow() : idle());
    expect(w.baron).toBe(baron);
  });

  it('eventually kills a player who does nothing', () => {
    const w = new World(quiet());
    const lives = w.score.lives;
    for (let i = 0; i < 60 * 90 && w.score.lives === lives; i++) w.step(idle());
    expect(w.score.lives).toBeLessThan(lives);
  });

  /**
   * Without this a player who dies at full Baron speed respawns into something already
   * unsurvivable and loses their remaining lives in a couple of seconds.
   */
  it('leaves when it takes a life, and resets the clock', () => {
    const w = new World(quiet());
    for (let i = 0; i < 60 * 90 && w.baron === null; i++) w.step(idle());
    expect(w.baron).not.toBe(null);

    const lives = w.score.lives;
    for (let i = 0; i < 60 * 90 && w.score.lives === lives; i++) w.step(idle());

    expect(w.baron).toBe(null);
    expect(w.hurryUp).toBe(false);
    expect(w.timer).toBeGreaterThan(0);
  });

  it('leaves when the room is cleared', () => {
    const w = new World(quiet());
    for (let i = 0; i < 60 * 90 && w.baron === null; i++) w.step(idle());
    expect(w.baron).not.toBe(null);

    for (const m of w.monsters) m.state = 'dead';
    w.step(idle());
    expect(w.phase).toBe('cleared');
    expect(w.baron).toBe(null);
  });
});

describe('projectiles in play', () => {
  it('costs a life when a thrown shot connects', () => {
    const w = new World(
      room({
        spawns: [{ kind: 'hidegons', x: 14, y: 24, dir: -1 }],
        playerStart: { x: 6, y: 24 },
      }),
    );
    const lives = w.score.lives;
    for (let i = 0; i < 60 * 20 && w.score.lives === lives; i++) w.step(idle());
    expect(w.score.lives).toBeLessThan(lives);
  });

  it('clears shots in flight when the player dies, so a respawn is not walked into', () => {
    const w = new World(
      room({
        spawns: [{ kind: 'hidegons', x: 14, y: 24, dir: -1 }],
        playerStart: { x: 6, y: 24 },
      }),
    );
    const lives = w.score.lives;
    for (let i = 0; i < 60 * 20 && w.score.lives === lives; i++) w.step(idle());
    expect(w.projectiles.length).toBe(0);
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

describe('riding a bubble in play', () => {
  /**
   * The physics-level test covers the one-way rule against a rising lip. This covers the
   * wiring: that World actually hands the bubbles to the player as ridables, that the
   * horizontal carry works, and that the rider is not shaken off by the vertical carry
   * being applied twice.
   *
   * Riding is the primary route to platforms a jump cannot reach (DESIGN.md §3.3), so
   * "the player falls through every bubble" is not a cosmetic bug — it removes a whole
   * traversal verb.
   */
  const open = () =>
    room({
      platforms: [[25, 1, 30]], // floor only; everything above is clear air
      spawns: [{ kind: 'zenchan', x: 29, y: 24, dir: 1 }],
      playerStart: { x: 15, y: 24 },
    });

  function bubbleUnder(w: World, x: number, y: number) {
    w.bubbles.length = 0;
    w.step(blow());
    const b = w.bubbles[0];
    b.phase = 'free';
    b.fireFrames = 0;
    b.life = 1_000_000;
    b.x = x;
    b.y = y;
    b.prevY = y;
    return b;
  }

  it('catches a falling player on a rising bubble', () => {
    const w = new World(open());
    const p = w.player.body;
    const b = bubbleUnder(w, 120, 150);
    p.x = 120;
    p.y = 60;
    p.vx = 0;
    p.vy = 0;

    for (let f = 0; f < 300 && p.ridingIndex < 0; f++) w.step(idle());

    expect(p.ridingIndex).toBeGreaterThanOrEqual(0);
    expect(p.onGround).toBe(true);
    expect(p.y + p.halfH).toBeCloseTo(b.y - b.halfH, 3);
  });

  it('carries the rider upward instead of shaking them off', () => {
    const w = new World(open());
    const p = w.player.body;
    const b = bubbleUnder(w, 120, 150);
    p.x = 120;
    p.y = 60;
    p.vx = 0;
    p.vy = 0;

    for (let f = 0; f < 300 && p.ridingIndex < 0; f++) w.step(idle());
    expect(p.ridingIndex).toBeGreaterThanOrEqual(0);

    const startedAt = p.y;
    let ridden = 0;
    for (let f = 0; f < 120; f++) {
      w.step(idle());
      if (p.ridingIndex >= 0) ridden++;
    }
    // Still aboard for most of the ride, and meaningfully higher than it started.
    expect(ridden).toBeGreaterThan(90);
    expect(p.y).toBeLessThan(startedAt - T.TILE);
    void b;
  });

  /**
   * The point of the whole mechanic: a ride goes higher than a jump can.
   *
   * The apex is four tiles, so anything beyond that is bubble-only territory. If a ride
   * cannot beat a jump there is no reason to ever stand on one.
   */
  it('carries the player higher than a jump could reach', () => {
    const w = new World(open());
    const p = w.player.body;
    const floor = 25 * T.TILE;

    // What an ordinary jump from the floor achieves, for comparison.
    const jumpApex = predictJump().apex;

    // The real sequence: a bubble leaves at head height and rises, and you jump on top
    // of it as it goes past. Starting it resting on the floor gives a window where its
    // lip is within a jump of the player's feet — start it higher and it is already
    // out of reach on frame one, however correct the riding code is.
    bubbleUnder(w, 120, floor - 24);
    p.x = 120;
    p.y = 60;
    p.vx = 0;
    p.vy = 0;

    for (let f = 0; f < 400 && p.ridingIndex < 0; f++) w.step(idle());
    expect(p.ridingIndex).toBeGreaterThanOrEqual(0);

    const boardedAt = p.y;
    let highest = p.y;
    for (let f = 0; f < 900; f++) {
      w.step(idle());
      if (p.ridingIndex >= 0) highest = Math.min(highest, p.y);
      if (w.bubbles.length === 0) break;
    }

    // A bubble climbs to the ceiling, so the ride is worth far more than one jump.
    expect(boardedAt - highest).toBeGreaterThan(jumpApex);
  });
});
