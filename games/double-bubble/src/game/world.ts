import { T } from '@/data/tuning';
import { Rng } from '@/engine/rng';
import type { ActionState } from './controls';
import type { RoomData } from './room';
import { Player } from './player';
import {
  anger,
  capture,
  chainFrom,
  overlaps,
  separate,
  shove,
  spawnBubble,
  stepBubble,
  type Bubble,
} from './bubble';
import { spawnMonster, stepMonster, type Monster } from './monster';
import { chainScore, extendLetters, initialScore, type ScoreState } from './score';

export type RoomPhase = 'playing' | 'cleared' | 'dead';

/**
 * One room in play: the player, its bubbles, its monsters, and the clock.
 *
 * Deliberately a plain object graph stepped in a fixed order rather than an entity
 * system. There are at most a few dozen things on screen and the ordering *is* the
 * design — bubbles must move before the player interacts with them, and captures must
 * resolve before escapes, or a monster can be caught and released on the same frame.
 */
export class World {
  readonly player: Player;
  readonly bubbles: Bubble[] = [];
  readonly monsters: Monster[] = [];
  readonly score: ScoreState;

  phase: RoomPhase = 'playing';
  frame = 0;
  /** Counts down to HURRY UP. The Baron arrives in M3. */
  timer: number;
  hurryUp = false;

  private blowCooldown = 0;
  private readonly rng: Rng;

  /** Last chain resolved, for the HUD and for tests. */
  lastChain = { monsters: 0, points: 0, letters: 0 };

  constructor(
    readonly room: RoomData,
    seed = 1,
    score: ScoreState = initialScore(),
  ) {
    this.player = new Player(room.playerStart.x, room.playerStart.y);
    this.score = score;
    this.rng = new Rng(seed);
    this.timer = room.timer;
    for (const s of room.spawns) this.monsters.push(spawnMonster(s.kind, s.x, s.y, s.dir));
  }

  get liveMonsters(): Monster[] {
    return this.monsters.filter((m) => m.state !== 'dead');
  }

  step(a: ActionState): void {
    if (this.phase !== 'playing') return;
    this.frame++;

    if (this.timer > 0 && --this.timer === 0) this.hurryUp = true;

    // Bubbles move first: the player's ride, push and pop decisions this frame are made
    // against where the bubbles actually are now, not where they were last frame.
    for (const b of this.bubbles) stepBubble(this.room, b);
    separate(this.room, this.bubbles);

    this.stepPlayer(a);
    this.fire(a);
    this.resolveCaptures();
    this.resolveEscapes();
    this.resolveExpiry();
    this.interactWithBubbles();

    for (const m of this.monsters) {
      if (m.state === 'walking') stepMonster(this.room, m, this.player.body.y, this.rng);
    }

    this.carryCaptives();
    this.checkPlayerHit();
    this.sweep();

    if (this.liveMonsters.length === 0) this.phase = 'cleared';
  }

  private stepPlayer(a: ActionState): void {
    this.player.step(this.room, a, this.bubbles);

    // A rider gets carried by whatever it is standing on. Doing it here rather than
    // inside the physics keeps that layer ignorant of bubbles.
    const idx = this.player.body.ridingIndex;
    if (idx >= 0 && idx < this.bubbles.length) {
      const b = this.bubbles[idx];
      this.player.body.x += b.vx;
      this.player.body.y += b.vy;
    }
  }

  private fire(a: ActionState): void {
    if (this.blowCooldown > 0) this.blowCooldown--;
    if (!a.blowPressed || this.blowCooldown > 0) return;

    const p = this.player;
    this.bubbles.push(
      spawnBubble(
        p.body.x + p.facing * (p.body.halfW + T.BUBBLE_RADIUS + T.BUBBLE_SPAWN_CLEARANCE),
        p.body.y,
        p.facing,
        p.bubbleRange,
      ),
    );
    this.blowCooldown = p.blowCooldown;
  }

  /** A travelling bubble that touches a free monster traps it. */
  private resolveCaptures(): void {
    for (const b of this.bubbles) {
      if (b.dead || b.captive) continue;
      for (const m of this.monsters) {
        if (m.state !== 'walking') continue;
        if (!overlaps(b, m.body.x, m.body.y, m.body.halfW, m.body.halfH)) continue;
        capture(b, m, this.room.escapeFrames);
        break;
      }
    }
  }

  /**
   * A captive whose clock ran out breaks free, angry.
   *
   * The bubble bursts with it, and — importantly — no points are scored. Letting a
   * timed-out bubble pay out would make ignoring your catches a viable strategy.
   */
  private resolveEscapes(): void {
    for (const b of this.bubbles) {
      if (b.dead || !b.captive || b.escape > 0) continue;
      const m = b.captive;
      m.body.x = b.x;
      m.body.y = b.y;
      m.body.vx = 0;
      m.body.vy = 0;
      m.state = 'walking';
      m.angry = true;
      b.captive = null;
      b.dead = true;
    }
  }

  private resolveExpiry(): void {
    for (const b of this.bubbles) {
      if (!b.dead && !b.captive && b.life <= 0) b.dead = true;
    }
  }

  /**
   * Ride, push, or pop.
   *
   * The creature's spines are on its back, so what happens depends entirely on which
   * face of it the bubble touches:
   *
   *   - underfoot, landed on   -> ride  (resolved in physics, skipped here)
   *   - above, or behind       -> pop   (the spines)
   *   - ahead, walking into it -> push  (the smooth front)
   *
   * That last one is the skill ceiling of the whole game: pushing is how a solo player
   * assembles the cluster that the exponential chain curve pays for. DESIGN.md §8.2.
   */
  private interactWithBubbles(): void {
    const p = this.player;
    const b0 = p.body;

    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i];
      if (b.dead) continue;
      if (i === b0.ridingIndex) continue;
      // A bubble still under its firing impulse is travelling away from the mouth that
      // blew it. Letting it interact means the player bursts their own bubble on the
      // frame after blowing it, and a cluster can never be built.
      if (b.phase === 'fired') continue;
      if (!overlaps(b, b0.x, b0.y, b0.halfW, b0.halfH)) continue;

      const dx = b.x - b0.x;
      const dy = b.y - b0.y;

      if (Math.abs(dx) > Math.abs(dy)) {
        const side = dx > 0 ? 1 : -1;
        if (side === p.facing) {
          shove(b, side);
          continue;
        }
      }
      this.popChain(i);
      return; // the chain may have killed several; re-scan next frame
    }
  }

  /**
   * Burst a bubble and everything touching it, as ONE event.
   *
   * The multiplier is computed once against the whole chain. Resolving serially and
   * summing would pay n x 1000 instead of 2^(n-1) x 1000 — at a six-chain that is 6,000
   * against 32,000, which is the difference between the game the scoring was designed
   * for and a much poorer one.
   */
  popChain(index: number): void {
    const chain = chainFrom(this.bubbles, index);

    let monsters = 0;
    let empties = 0;
    for (const i of chain) {
      const b = this.bubbles[i];
      if (b.dead) continue;
      b.dead = true;
      if (b.captive) {
        b.captive.state = 'dead';
        b.captive = null;
        monsters++;
      } else {
        empties++;
      }
    }

    const points = chainScore(monsters) + empties * T.EMPTY_BUBBLE_POP;
    const letters = extendLetters(monsters);
    this.score.points += points;
    this.lastChain = { monsters, points, letters };
    // EXTEND letters are counted here but do not yet drop as pickups — items are M4.
  }

  /** A trapped monster rides inside its bubble. */
  private carryCaptives(): void {
    for (const b of this.bubbles) {
      if (b.dead || !b.captive) continue;
      b.captive.body.x = b.x;
      b.captive.body.y = b.y;
      b.captive.body.vx = 0;
      b.captive.body.vy = 0;
    }
  }

  private checkPlayerHit(): void {
    const b0 = this.player.body;
    for (const m of this.monsters) {
      if (m.state !== 'walking') continue;
      if (
        Math.abs(m.body.x - b0.x) < m.body.halfW + b0.halfW &&
        Math.abs(m.body.y - b0.y) < m.body.halfH + b0.halfH
      ) {
        this.killPlayer();
        return;
      }
    }
  }

  private killPlayer(): void {
    this.score.lives--;
    if (this.score.lives <= 0) {
      this.phase = 'dead';
      return;
    }
    this.player.respawn(this.room.playerStart.x, this.room.playerStart.y);
  }

  /** Drop resolved bubbles. Done once at the end so indices stay stable all step. */
  private sweep(): void {
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      if (this.bubbles[i].dead) this.bubbles.splice(i, 1);
    }
  }

  /** Redness of a bubble's captive, for the renderer. */
  angerOf(b: Bubble): number {
    return anger(b);
  }
}
