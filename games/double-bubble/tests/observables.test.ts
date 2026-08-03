import { describe, it, expect } from 'vitest';
import { T } from '@/data/tuning';
import { roomFor } from '@/data/rooms';
import { predictJump, solveJump, makeBody, stepBody } from '@/game/physics';
import { spawnBubble, stepBubble } from '@/game/bubble';
import { Tile, type RoomData } from '@/game/room';

/**
 * The physics constants, expressed as things a person can count.
 *
 * The problem this file exists to solve: `tuning.ts` holds eleven numbers marked `[i]`,
 * meaning inferred rather than sourced. They cannot be checked by reading them —
 * `GRAVITY: 0.1684` is not a claim anyone can agree or disagree with. Nobody has ever
 * counted a frame of the original, and no disassembly of the arcade ROM publishes these
 * values, so the M1 fidelity pass has stayed open through five milestones.
 *
 * What follows converts every constant into the units a frame-stepped reference clip
 * actually yields — tiles, frames, seconds, tiles per second. Those ARE checkable. Anyone
 * with footage can now settle a constant by counting one number and comparing it to a
 * line below, and `solveJump()` turns a corrected count straight back into constants.
 *
 * So these assertions are not claims that the values are RIGHT. They are a statement of
 * what the current values MEAN, pinned so that
 *   - no edit changes the feel of the game without changing a number in this file, and
 *   - the fidelity pass becomes a checklist rather than a research project.
 *
 * Where a number is disputed later, change the constant and update the line here. The
 * diff on this file is the record of what the game used to feel like.
 */

const SECONDS = (frames: number) => frames / T.STEP_HZ;
const TILES = (wu: number) => wu / T.TILE;

/** A single solid floor near the bottom, nothing else — a lab bench for the jump arc. */
function flatRoom(): RoomData {
  const tiles = new Uint8Array(T.GRID_W * T.GRID_H);
  for (let tx = 0; tx < T.GRID_W; tx++) tiles[(T.GRID_H - 2) * T.GRID_W + tx] = Tile.Solid;
  return {
    id: 'bench',
    tiles,
    drift: new Uint8Array(T.GRID_W * T.GRID_H),
    driftSpeed: 0,
    spawns: [],
    playerStart: { x: 15, y: T.GRID_H - 3 },
  } as unknown as RoomData;
}

describe('what the physics constants mean, in countable units', () => {
  describe('the jump', () => {
    it('rises exactly four tiles', () => {
      // THE number to check first against footage: stand Bub on a floor, jump, count how
      // many tiles the top of the arc clears. Four is a choice, not a measurement — but
      // it is a choice the level generator depends on, since a tier the player cannot
      // reach makes a room unplayable.
      expect(TILES(predictJump().apex)).toBeCloseTo(4, 2);
    });

    it('takes 19 frames up and 38 airborne — just over six tenths of a second', () => {
      const j = predictJump();
      expect(j.riseFrames).toBe(19);
      expect(j.airborneFrames).toBe(38);
      expect(SECONDS(j.airborneFrames)).toBeCloseTo(0.633, 3);
    });

    it('produces in the integrator exactly what the closed form predicts', () => {
      // The closed form is derived independently of the integrator precisely so it can
      // disagree with it. If these ever diverge, one of the two has a bug — and the
      // whole point of predictJump is that it is the one you can check by hand.
      const room = flatRoom();
      const floorY = (T.GRID_H - 2) * T.TILE;
      const b = makeBody(128, floorY - T.PLAYER_HALF_H, T.PLAYER_HALF_W, T.PLAYER_HALF_H);
      stepBody(room, b);

      const startY = b.y;
      b.vy = -T.JUMP_VELOCITY;
      let peak = startY;
      let airborne = 0;
      for (let f = 0; f < 300; f++) {
        stepBody(room, b);
        if (b.y < peak) peak = b.y;
        if (!b.onGround) airborne++;
        else break;
      }

      const j = predictJump();
      expect(startY - peak, 'simulated apex').toBeCloseTo(j.apex, 6);
      expect(airborne, 'simulated airborne frames').toBe(j.airborneFrames);
    });

    it('never reaches terminal velocity within a jump, so the arc stays symmetric', () => {
      // predictJump's frame counts assume the descent mirrors the ascent. Terminal
      // velocity would break that silently, and the arc would come out short.
      expect(predictJump().exact).toBe(true);
    });

    it('round-trips through solveJump, which is how footage becomes constants', () => {
      // The fidelity pass in one line: count an apex and a rise from a clip, feed them
      // in, paste the results into tuning.ts.
      const j = predictJump();
      const solved = solveJump(j.apex, j.riseFrames + 1);
      expect(solved.gravity).toBeCloseTo(T.GRAVITY, 4);
      expect(solved.jumpVelocity).toBeCloseTo(T.JUMP_VELOCITY, 3);
    });

    it('carries the player 4.75 tiles walking, 7.1 running', () => {
      // Jump distance is not a constant anywhere — it falls out of airtime times run
      // speed, which is exactly why it is worth stating. It is also the number a level
      // generator implicitly bets on when it decides two platforms are connected.
      const air = predictJump().airborneFrames;
      expect(TILES(T.RUN_SPEED * air)).toBeCloseTo(4.75, 2);
      expect(TILES(T.RUN_SPEED_FAST * air)).toBeCloseTo(7.13, 2);
    });
  });

  describe('running', () => {
    it('covers 7.5 tiles a second, crossing the room in 4.3', () => {
      expect(TILES(T.RUN_SPEED) * T.STEP_HZ).toBeCloseTo(7.5, 2);
      expect(T.VIEW_W / T.RUN_SPEED / T.STEP_HZ).toBeCloseTo(4.27, 2);
    });

    it('makes the red shoe a half again as fast, not a different game', () => {
      expect(T.RUN_SPEED_FAST / T.RUN_SPEED).toBeCloseTo(1.5, 6);
    });
  });

  describe('bubbles', () => {
    /** Distance a fired bubble covers while decelerating to rest over n frames. */
    const fireReach = (frames: number) => (T.BUBBLE_FIRE_SPEED * (frames + 1)) / 2;

    it('fly 4.3 tiles normally and 6.2 with the purple sweet', () => {
      // The sweet buys reach, not speed — same arc, held longer. A player who has
      // learned to lead a target does not have to relearn it.
      expect(TILES(fireReach(T.BUBBLE_FIRE_FRAMES))).toBeCloseTo(4.31, 2);
      expect(TILES(fireReach(T.BUBBLE_FIRE_FRAMES_FAR))).toBeCloseTo(6.19, 2);
      expect(T.BUBBLE_FIRE_SPEED, 'speed must not change with range').toBe(3.0);
    });

    it('rise 2.25 tiles a second', () => {
      expect(TILES(T.BUBBLE_RISE_SPEED) * T.STEP_HZ).toBeCloseTo(2.25, 2);
    });

    it('live fourteen seconds, and a trapped monster gets eight to be popped', () => {
      expect(SECONDS(T.BUBBLE_LIFETIME)).toBeCloseTo(14, 1);
      expect(SECONDS(T.ESCAPE_FRAMES)).toBeCloseTo(8, 1);
      // A special must still read as a rarer, longer-lived thing than an ordinary bubble.
      expect(T.SPECIAL_BUBBLE_LIFETIME).toBeGreaterThan(T.BUBBLE_LIFETIME * 1.5);
    });

    it('settle into a poolable cluster well within their lifetime, in every room', () => {
      // The exponential chain curve assumes you can build a cluster and then pop it, so
      // a bubble must stop rising with useful life left. Checked against the actual
      // hundred rooms rather than against an idealised empty one, because what a bubble
      // meets on the way up is room geometry.
      //
      // This is a TAIL check, and the tail is thin: the median bubble settles in about
      // 2.6s with 7.3s to spare, but the slowest rooms leave under 2s. If a future
      // tuning makes this fail, the fix is a longer lifetime rather than a faster rise —
      // rise speed is tuned against riding and wobble, and lifetime is tuned against
      // nothing else at all.
      const settleFrames: number[] = [];

      for (let n = 1; n <= 100; n++) {
        const room = roomFor(n);
        const b = spawnBubble(
          room.playerStart.x * T.TILE + T.TILE / 2,
          (room.playerStart.y + 1) * T.TILE - T.PLAYER_HALF_H,
          1,
          'normal',
        );
        let still = 0;
        let settled = -1;
        for (let f = 0; f < 2000; f++) {
          b.life = Number.MAX_SAFE_INTEGER; // measuring the climb, not the expiry
          const before = b.y;
          stepBubble(room, b);
          if (before - b.y < 0.05) {
            if (++still >= 30) {
              settled = f - 29;
              break;
            }
          } else still = 0;
        }
        expect(settled, `room ${n}: bubble never stopped rising`).toBeGreaterThanOrEqual(0);
        settleFrames.push(settled);
      }

      settleFrames.sort((a, b) => a - b);
      const median = settleFrames[50];
      expect(SECONDS(median), 'median time to join a pool').toBeLessThan(4);

      // Every room must leave enough life to blow a five-cluster after the first bubble
      // has parked, or the chain curve is decorative in that room.
      const clusterFrames = 4 * T.BUBBLE_COOLDOWN;
      const worst = settleFrames[settleFrames.length - 1];
      expect(worst + clusterFrames, 'slowest room leaves no time to build a cluster').toBeLessThan(
        T.BUBBLE_LIFETIME,
      );
    });
  });

  describe('the sanity rails the rest of the physics rests on', () => {
    it('never moves a body more than a tile in a frame, so per-axis resolution is exact', () => {
      // physics.ts resolves collisions by checking the single cell a body moves into. That
      // is only correct while nothing can skip a cell. The fastest thing in the game is a
      // body at terminal velocity.
      const fastest = Math.max(T.FALL_SPEED_MAX, T.RUN_SPEED_FAST, T.BUBBLE_FIRE_SPEED, T.BARON_SPEED_MAX);
      expect(fastest, 'something now outruns the collision resolver — it needs a sweep').toBeLessThanOrEqual(T.TILE);
    });

    it('takes 24 frames of falling to reach terminal velocity', () => {
      expect(Math.ceil(T.FALL_SPEED_MAX / T.GRAVITY)).toBe(24);
    });

    it('gives the player about half a minute before the Baron, and 20s after', () => {
      expect(SECONDS(T.ROOM_TIMER)).toBeCloseTo(30, 1);
      expect(SECONDS(T.BARON_DELAY)).toBeCloseTo(10, 1);
      // How long the Baron takes to go from its entry speed to its cap.
      expect(SECONDS((T.BARON_SPEED_MAX - T.BARON_SPEED_START) / T.BARON_ACCEL)).toBeCloseTo(21.6, 1);
    });
  });
});
