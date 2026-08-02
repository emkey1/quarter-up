import { describe, it, expect } from 'vitest';
import { T, ROOM_H } from '@/data/tuning';
import { isFloor, tileAt, validateRoom, type RoomData } from '@/game/room';
import room001Json from '@/data/rooms/r001.json';
import {
  makeBody,
  stepBody,
  resolveX,
  resolveY,
  predictJump,
  solveJump,
  type Body,
} from '@/game/physics';
import { Player } from '@/game/player';
import { emptyActions, type ActionState } from '@/game/controls';

/* ------------------------------------------------------------------ fixtures */

/** Build a room from segment declarations, the same shape tools/mkrooms.mjs uses. */
function room(spec: {
  platforms?: [number, number, number][];
  solids?: [number, number, number][];
  walls?: boolean;
}): RoomData {
  const rows: string[][] = [];
  for (let y = 0; y < T.GRID_H; y++) {
    const r = new Array<string>(T.GRID_W).fill('.');
    if (spec.walls !== false) {
      r[0] = '#';
      r[T.GRID_W - 1] = '#';
    }
    rows.push(r);
  }
  for (const [y, x0, x1] of spec.solids ?? []) for (let x = x0; x <= x1; x++) rows[y][x] = '#';
  for (const [y, x0, x1] of spec.platforms ?? []) for (let x = x0; x <= x1; x++) rows[y][x] = '=';

  const r = validateRoom({
    id: 'fixture',
    tiles: rows.map((x) => x.join('')),
    playerStart: { x: 5, y: 5 },
    spawns: [{ kind: 'zenchan', x: 5, y: 5, dir: 1 }],
  });
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.data;
}

/** A body the size of the player, centred on a tile column. */
function body(tileX: number, wuY: number): Body {
  return makeBody(tileX * T.TILE + T.TILE / 2, wuY, T.PLAYER_HALF_W, T.PLAYER_HALF_H);
}

const surfaceOf = (tileRow: number): number => tileRow * T.TILE;

/** Does this cell carry something standable? */
const tileAtRow = (r: RoomData, x: number, y: number): boolean => isFloor(tileAt(r, x, y));

/* ------------------------------------------------------------------ gravity */

describe('gravity', () => {
  it('accelerates a falling body and clamps at terminal velocity', () => {
    const r = room({});
    const b = body(5, 20);
    for (let i = 0; i < 200; i++) stepBody(r, b);
    expect(b.vy).toBeLessThanOrEqual(T.FALL_SPEED_MAX);
    expect(b.vy).toBeCloseTo(T.FALL_SPEED_MAX, 5);
  });

  /**
   * The per-axis resolution in physics.ts is only exact while nothing crosses a whole
   * tile in one step. If this ever fails, that file needs a swept test, not a bigger
   * epsilon.
   */
  it('never moves more than half a tile per frame, which is what per-axis resolution assumes', () => {
    // At most half a tile means a body can advance by at most one cell per step, so
    // checking the single destination row/column is exact.
    expect(T.FALL_SPEED_MAX).toBeLessThanOrEqual(T.TILE / 2);
    expect(T.RUN_SPEED_FAST).toBeLessThanOrEqual(T.TILE / 2);
    expect(T.JUMP_VELOCITY).toBeLessThanOrEqual(T.TILE / 2);
  });
});

/* ------------------------------------------------------------------ one-way platforms */

describe('one-way platforms', () => {
  const r = room({ platforms: [[15, 2, 20]] });

  it('lands a falling body on the lip', () => {
    const b = body(5, surfaceOf(15) - 40);
    for (let i = 0; i < 120 && !b.onGround; i++) stepBody(r, b);
    expect(b.onGround).toBe(true);
    expect(b.y + b.halfH).toBeCloseTo(surfaceOf(15), 6);
  });

  /** The rule the whole traversal model rests on. */
  it('lets a rising body pass straight through from below', () => {
    const b = body(5, surfaceOf(15) + 30);
    b.vy = -T.JUMP_VELOCITY;
    const startedBelow = b.y;
    for (let i = 0; i < 12; i++) {
      stepBody(r, b);
      expect(b.onGround).toBe(false);
    }
    expect(b.y).toBeLessThan(startedBelow - T.TILE); // it got above where it began
  });

  it('does not catch a body that was already below the lip when the step began', () => {
    // Body straddling the platform row on the way up: its top is above the surface, its
    // underside below. Catching here is the classic one-way bug — you jump through a
    // platform and get yanked onto it halfway.
    const b = body(5, surfaceOf(15) + 2);
    b.vy = -2;
    stepBody(r, b);
    expect(b.onGround).toBe(false);
  });

  it('does not block horizontal movement', () => {
    const b = body(5, surfaceOf(15) - T.PLAYER_HALF_H);
    b.vx = T.RUN_SPEED;
    const x0 = b.x;
    resolveX(r, b);
    expect(b.x).toBeCloseTo(x0 + T.RUN_SPEED, 6);
  });

  it('keeps a resting body resting rather than sinking or bouncing', () => {
    const b = body(5, surfaceOf(15) - T.PLAYER_HALF_H);
    for (let i = 0; i < 60; i++) stepBody(r, b);
    expect(b.onGround).toBe(true);
    expect(b.y + b.halfH).toBeCloseTo(surfaceOf(15), 6);
  });
});

/* ------------------------------------------------------------------ solid tiles */

describe('solid tiles', () => {
  it('stop a rising body, unlike platforms', () => {
    const r = room({ solids: [[10, 2, 20]] });
    // Head two world units under the block's underside, rising further than that in one
    // step — so the step genuinely crosses into the solid row.
    const b = body(5, surfaceOf(11) + T.PLAYER_HALF_H + 2);
    b.vy = -T.JUMP_VELOCITY;
    resolveY(r, b);
    expect(b.vy).toBe(0);
    expect(b.y - b.halfH).toBeCloseTo(surfaceOf(11), 6);
  });

  it('stop horizontal movement in both directions', () => {
    const r = room({ solids: [[12, 8, 8]] });

    const right = body(6, surfaceOf(12) + 4);
    right.vx = T.RUN_SPEED_FAST;
    for (let i = 0; i < 40; i++) resolveX(r, right);
    expect(right.x + right.halfW).toBeCloseTo(surfaceOf(8), 6);

    const left = body(11, surfaceOf(12) + 4);
    left.vx = -T.RUN_SPEED_FAST;
    for (let i = 0; i < 40; i++) resolveX(r, left);
    expect(left.x - left.halfW).toBeCloseTo(surfaceOf(9), 6);
  });

  it('hold the outer walls', () => {
    const r = room({});
    const b = body(1, 100);
    b.vx = -T.RUN_SPEED_FAST;
    for (let i = 0; i < 40; i++) resolveX(r, b);
    expect(b.x - b.halfW).toBeGreaterThanOrEqual(T.TILE - 1e-6);
  });
});

/* ------------------------------------------------------------------ vertical wrap */

describe('vertical wrap', () => {
  it('returns a body that falls off the bottom to the top', () => {
    const r = room({});
    const b = body(5, ROOM_H - 20);
    let wraps = 0;
    for (let i = 0; i < 400; i++) {
      stepBody(r, b);
      if (b.wrapped) wraps++;
    }
    expect(wraps).toBeGreaterThan(0);
    expect(b.y).toBeLessThan(ROOM_H);
  });

  it('re-enters continuously rather than teleporting to the ceiling', () => {
    const r = room({});
    const b = body(5, ROOM_H - 2);
    b.vy = 3;
    for (let i = 0; i < 60; i++) {
      stepBody(r, b);
      if (b.wrapped) {
        // Its underside should be just at the top edge, not a whole room away.
        expect(b.y + b.halfH).toBeGreaterThanOrEqual(0);
        expect(b.y + b.halfH).toBeLessThan(T.TILE);
        return;
      }
    }
    throw new Error('never wrapped');
  });

  /**
   * The ordering bug called out in DESIGN.md §8.1. Wrapping before resolution would
   * place the body at the top of the room and then test it against geometry it had not
   * reached, so a player dropping out of the bottom would appear already embedded in
   * whatever sits on the top row.
   */
  it('does not tunnel through geometry on the top row', () => {
    // A fully solid top row is a degenerate room — it makes the wrap useless, and no
    // real room will have one. It is the sharpest possible test of the ordering, though:
    // wrapping before resolution would drop the body straight through it.
    const r = room({ solids: [[0, 1, 30]] });
    const b = body(5, ROOM_H - 4);
    b.vy = T.FALL_SPEED_MAX;

    let wrapped = false;
    for (let i = 0; i < 200; i++) {
      stepBody(r, b);
      if (b.wrapped) wrapped = true;
      if (!wrapped) continue;

      // Once re-entered, the body may sit a fraction inside the row on the wrap frame
      // itself — detection happens after the step and it really has travelled that far,
      // and the next resolve lifts it back out. What must never happen is passing
      // through: its underside below the row's own underside.
      expect(b.y + b.halfH).toBeLessThanOrEqual(surfaceOf(1));
    }
    expect(wrapped).toBe(true);
    expect(b.onGround).toBe(true);
  });

  it('lands normally after wrapping in', () => {
    const r = room({ platforms: [[6, 1, 30]] });
    const b = body(5, ROOM_H - 4);
    for (let i = 0; i < 400 && !b.onGround; i++) stepBody(r, b);
    expect(b.onGround).toBe(true);
    expect(b.y + b.halfH).toBeCloseTo(surfaceOf(6), 6);
  });
});

/* ------------------------------------------------------------------ the jump arc */

describe('jump arithmetic', () => {
  /**
   * Guards the mistake this file exists to prevent: the textbook v0^2/(2g) is the
   * continuous apex, and a fixed-step integrator does not reach it. If someone
   * "simplifies" predictJump back to the closed form, this fails.
   */
  it('predicts a lower apex than the continuous formula', () => {
    const continuous = (T.JUMP_VELOCITY * T.JUMP_VELOCITY) / (2 * T.GRAVITY);
    const discrete = predictJump().apex;
    expect(discrete).toBeLessThan(continuous);
    expect(discrete / continuous).toBeGreaterThan(0.9); // ~5% under, not a different order
  });

  it('round-trips through solveJump', () => {
    const { jumpVelocity, gravity } = solveJump(4 * T.TILE, 20);
    const shape = predictJump(jumpVelocity, gravity);
    expect(shape.apex).toBeCloseTo(4 * T.TILE, 6);
    expect(shape.riseFrames).toBe(19); // K-1 frames actually move
  });

  it('is tuned to clear four tiles', () => {
    expect(predictJump().apex / T.TILE).toBeCloseTo(4, 1);
  });

  /** The closed form assumes the descent never clamps. If a future tuning breaks that,
   *  `exact` goes false and the prediction needs a summed fall instead. */
  it('reports its closed form as valid for the shipped constants', () => {
    expect(predictJump().exact).toBe(true);
  });
});

describe('the player jump', () => {
  function jumpOnce(): Player {
    const r = room({ platforms: [[20, 1, 30]] });
    const p = new Player(5, 19);
    const idle = emptyActions();

    // A step to establish contact — onGround is only known after a resolve.
    p.step(r, idle);
    expect(p.body.onGround).toBe(true);

    const jump: ActionState = { ...emptyActions(), jumpPressed: true };
    p.step(r, jump);

    for (let i = 0; i < 200; i++) {
      p.step(r, idle);
      if (p.body.onGround) break;
    }
    return p;
  }

  it('reaches the apex the constants predict', () => {
    const p = jumpOnce();
    const pred = predictJump();
    // Measured apex is sampled after each step, so it can miss the true peak by at most
    // one frame's travel near the top — where velocity is smallest.
    expect(p.jump.lastApex).toBeCloseTo(pred.apex, 0);
  });

  it('stays airborne for exactly the predicted number of frames', () => {
    const p = jumpOnce();
    expect(p.jump.lastAirtime).toBe(predictJump().airborneFrames);
  });

  it('does not jump again in mid-air', () => {
    const r = room({ platforms: [[20, 1, 30]] });
    const p = new Player(5, 19);
    const idle = emptyActions();
    const jump: ActionState = { ...emptyActions(), jumpPressed: true };

    p.step(r, idle);
    p.step(r, jump);
    const afterLaunch = p.body.vy;

    // Mashing jump while rising must do nothing at all.
    p.step(r, jump);
    expect(p.body.vy).toBeGreaterThan(afterLaunch);
    expect(p.body.onGround).toBe(false);
  });

  it('faces the way it is moving and keeps facing there when it stops', () => {
    const r = room({ platforms: [[20, 1, 30]] });
    const p = new Player(5, 19);

    p.step(r, { ...emptyActions(), moveX: -1 });
    expect(p.facing).toBe(-1);
    p.step(r, emptyActions());
    expect(p.facing).toBe(-1);
    p.step(r, { ...emptyActions(), moveX: 1 });
    expect(p.facing).toBe(1);
  });

  it('clears a three-row tier from a standing jump', () => {
    // Room 1's floor is row 25 (surface 200); the tier above is row 22 (surface 176).
    const r = room({ platforms: [[25, 3, 28], [22, 6, 13]] });
    const p = new Player(8, 24);
    const idle = emptyActions();

    p.step(r, idle);
    expect(p.body.y + p.body.halfH).toBeCloseTo(surfaceOf(25), 6);

    p.step(r, { ...idle, jumpPressed: true });
    for (let i = 0; i < 200; i++) {
      p.step(r, idle);
      if (p.body.onGround) break;
    }
    // Passed up through the platform, then caught it coming down.
    expect(p.body.y + p.body.halfH).toBeCloseTo(surfaceOf(22), 6);
  });

  it('crosses a two-column step while climbing a tier', () => {
    const r = room({ platforms: [[22, 6, 13], [19, 15, 22]] });
    const p = new Player(13, 21); // right edge of the lower tier
    const run = { ...emptyActions(), moveX: 1 };

    p.step(r, run);
    p.step(r, { ...run, jumpPressed: true });
    for (let i = 0; i < 200; i++) {
      p.step(r, run);
      if (p.body.onGround) break;
    }
    expect(p.body.y + p.body.halfH).toBeCloseTo(surfaceOf(19), 6);
  });
});

/**
 * A level lint, not a physics test.
 *
 * A tier exactly four rows above another sits precisely at the apex: the feet arrive
 * level with the lip and catching it comes down to float noise, which reads as broken
 * input rather than as a platform you were meant to need a bubble for. Three rows is a
 * comfortable hop; five or more is unmistakably out of reach. Four is the one gap no
 * room may contain.
 */
describe('room 1 tier spacing', () => {
  it('contains no tier gap at exactly the jump limit', () => {
    const r = validateRoom(room001Json);
    if (!r.ok) throw new Error(r.errors.join('\n'));

    const apexTiles = predictJump().apex / T.TILE;
    expect(apexTiles).toBeCloseTo(4, 1);

    // Rows that carry any floor, top to bottom.
    const rows: number[] = [];
    for (let y = 0; y < T.GRID_H; y++) {
      for (let x = 1; x < T.GRID_W - 1; x++) {
        if (tileAtRow(r.data, x, y)) {
          rows.push(y);
          break;
        }
      }
    }

    for (let i = 1; i < rows.length; i++) {
      expect(rows[i] - rows[i - 1]).not.toBe(4);
    }
  });
});

describe('player poses', () => {
  it('reports a pose that matches what the body is doing', () => {
    const r = room({ platforms: [[20, 1, 30]] });
    const p = new Player(5, 19);
    const idle = emptyActions();

    p.step(r, idle);
    expect(p.pose).toBe('idle');

    p.step(r, { ...idle, moveX: 1 });
    expect(p.pose).toBe('run');

    p.step(r, { ...idle, jumpPressed: true });
    expect(p.pose).toBe('rise');

    for (let i = 0; i < 200; i++) {
      p.step(r, idle);
      if (p.pose === 'fall') break;
    }
    expect(p.pose).toBe('fall');
  });
});

/* ------------------------------------------------------------------ riding bubbles */

/**
 * Riding is the primary route to platforms a jump cannot reach (DESIGN.md §3.3), and it
 * was completely broken: the player fell straight through every bubble.
 *
 * The one-way test asks whether the body's underside CROSSED the lip this step. With a
 * static platform the lip's old and new positions are the same, so the distinction never
 * comes up. A bubble RISES — it can climb past the body's previous underside, at which
 * point the test answers "you were already below it" against the lip's new position and
 * waves the body through. Every assertion below is about that.
 */
describe('riding a bubble', () => {
  const ridable = (x: number, y: number) => ({
    x,
    y,
    prevY: y,
    halfW: T.BUBBLE_RADIUS,
    halfH: T.BUBBLE_RADIUS,
  });

  it('lands on a stationary bubble in open air', () => {
    const r = room({ platforms: [[25, 1, 30]] });
    const b = body(15, 60);
    const bubble = ridable(b.x, 110);

    for (let i = 0; i < 80 && b.ridingIndex < 0; i++) stepBody(r, b, [bubble]);
    expect(b.ridingIndex).toBe(0);
    expect(b.onGround).toBe(true);
    expect(b.y + b.halfH).toBeCloseTo(bubble.y - bubble.halfH, 4);
  });

  /** The one that was broken. A rising lip must still catch a falling body. */
  it('lands on a bubble that is rising to meet it', () => {
    const r = room({ platforms: [[25, 1, 30]] });
    const b = body(15, 60);
    const bubble = ridable(b.x, 130);

    for (let i = 0; i < 200 && b.ridingIndex < 0; i++) {
      bubble.prevY = bubble.y;
      bubble.y -= T.BUBBLE_RISE_SPEED;
      stepBody(r, b, [bubble]);
    }
    expect(b.ridingIndex).toBe(0);
    expect(b.y + b.halfH).toBeCloseTo(bubble.y - bubble.halfH, 4);
  });

  it('stays on a rising bubble rather than sinking through or bouncing off', () => {
    const r = room({ platforms: [[25, 1, 30]] });
    const b = body(15, 60);
    const bubble = ridable(b.x, 130);

    for (let i = 0; i < 200 && b.ridingIndex < 0; i++) {
      bubble.prevY = bubble.y;
      bubble.y -= T.BUBBLE_RISE_SPEED;
      stepBody(r, b, [bubble]);
    }
    expect(b.ridingIndex).toBe(0);

    // Now ride it for a while: the player must keep going up with it.
    const startedAt = b.y;
    for (let i = 0; i < 60; i++) {
      bubble.prevY = bubble.y;
      bubble.y -= T.BUBBLE_RISE_SPEED;
      stepBody(r, b, [bubble]);
      expect(b.ridingIndex, `lost the bubble on frame ${i}`).toBe(0);
      expect(b.y + b.halfH).toBeCloseTo(bubble.y - bubble.halfH, 4);
    }
    expect(b.y).toBeLessThan(startedAt - 10); // carried meaningfully upward
  });

  /** Bouncing off a bubble is how you reach the top of a room — a ride that cannot be
   *  jumped from is just a slow lift. */
  it('can be jumped from, and the jump clears more than the bubble alone', () => {
    const r = room({ platforms: [[25, 1, 30]] });
    const p = new Player(15, 24);
    const idle = emptyActions();
    p.step(r, idle);
    expect(p.body.onGround).toBe(true);

    // Hung so the feet clear its lip at the apex. The jump raises the feet 32wu, so a
    // lip more than that above them is unreachable however correct the riding code is.
    const bubble = ridable(p.body.x, p.body.y - 14);
    for (let i = 0; i < 200 && p.body.ridingIndex < 0; i++) {
      p.step(r, i === 0 ? { ...idle, jumpPressed: true } : idle, [bubble]);
    }
    expect(p.body.ridingIndex).toBe(0);

    const fromBubble = p.body.y;
    p.step(r, { ...idle, jumpPressed: true }, [bubble]);
    expect(p.body.vy).toBeLessThan(0); // it launched

    let peak = p.body.y;
    for (let i = 0; i < 40; i++) {
      p.step(r, idle, [bubble]);
      peak = Math.min(peak, p.body.y);
    }
    // Higher than the bubble it launched from, by roughly a jump's worth.
    expect(peak).toBeLessThan(fromBubble - T.TILE * 2);
  });

  it('passes up through a bubble from below, exactly as it does a platform', () => {
    const r = room({ platforms: [[25, 1, 30]] });
    const b = body(15, 120);
    const bubble = ridable(b.x, 100);
    b.vy = -T.JUMP_VELOCITY;

    for (let i = 0; i < 10; i++) {
      stepBody(r, b, [bubble]);
      expect(b.ridingIndex).toBe(-1);
    }
    expect(b.y).toBeLessThan(100);
  });
});
