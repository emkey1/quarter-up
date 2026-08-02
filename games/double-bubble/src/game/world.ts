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
import { projectileHits, stepProjectile, type Projectile } from './projectile';
import { baronHits, spawnBaron, stepBaron, type Baron } from './baron';
import { chainScore, extendLetters, initialScore, type ScoreState } from './score';

export type RoomPhase = 'playing' | 'cleared' | 'dead';

/**
 * Things worth showing the player.
 *
 * The simulation announces what happened and knows nothing about how it looks; the
 * renderer drains the list and decides. That keeps effects out of the deterministic
 * step — a replay must not depend on how many sparks were drawn — and means the sim
 * never grows a reference to a particle system.
 *
 * Appended to across every step of a frame and drained once per drawn frame, because
 * the loop may step several times between draws and a burst must not be missed.
 */
export type WorldEvent =
  | { kind: 'bubblePop'; x: number; y: number }
  | { kind: 'monsterPop'; x: number; y: number; colour: string }
  | { kind: 'escape'; x: number; y: number }
  | { kind: 'chain'; x: number; y: number; monsters: number; points: number };

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
  readonly projectiles: Projectile[] = [];
  readonly score: ScoreState;

  /** Invincible, unbubbleable, and only ever closer. Null until the hurry-up. */
  baron: Baron | null = null;

  phase: RoomPhase = 'playing';
  frame = 0;
  /** Counts down to HURRY UP. */
  timer: number;
  hurryUp = false;
  /** Frames since HURRY UP, counting down to the Baron's entrance. */
  private baronDelay = 0;

  private blowCooldown = 0;
  private readonly rng: Rng;

  /** Last chain resolved, for the HUD and for tests. */
  lastChain = { monsters: 0, points: 0, letters: 0 };

  /** Drained by the renderer once per drawn frame. See WorldEvent. */
  readonly events: WorldEvent[] = [];

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

    if (this.timer > 0 && --this.timer === 0) {
      this.hurryUp = true;
      this.baronDelay = T.BARON_DELAY;
    }

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

    const px = this.player.body.x;
    const py = this.player.body.y;
    for (const m of this.monsters) {
      if (m.state !== 'walking') continue;
      const r = stepMonster(this.room, m, px, py, this.rng);
      if (r.threw) this.projectiles.push(r.threw);
    }

    for (const p of this.projectiles) stepProjectile(this.room, p);
    this.stepBaron();

    this.carryCaptives();
    this.checkPlayerHit();
    this.sweep();

    if (this.liveMonsters.length === 0) {
      this.phase = 'cleared';
      this.baron = null;
    }
  }

  /**
   * The hurry-up, and what arrives after it.
   *
   * HURRY UP flashes first and the Baron follows a beat later, rather than both landing
   * together: the warning has to be a warning. A player who reacts to the text should
   * still be able to finish the room.
   */
  private stepBaron(): void {
    if (!this.baron) {
      if (!this.hurryUp) return;
      if (this.baronDelay > 0) {
        this.baronDelay--;
        return;
      }
      this.baron = spawnBaron(this.player.body.x, this.player.body.y);
      return;
    }
    stepBaron(this.baron, this.player.body.x, this.player.body.y);
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
      this.events.push({ kind: 'escape', x: b.x, y: b.y });
    }
  }

  private resolveExpiry(): void {
    for (const b of this.bubbles) {
      if (!b.dead && !b.captive && b.life <= 0) {
        b.dead = true;
        this.events.push({ kind: 'bubblePop', x: b.x, y: b.y });
      }
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
    let sumX = 0;
    let sumY = 0;
    let counted = 0;
    for (const i of chain) {
      const b = this.bubbles[i];
      if (b.dead) continue;
      b.dead = true;
      sumX += b.x;
      sumY += b.y;
      counted++;
      if (b.captive) {
        this.events.push({
          kind: 'monsterPop',
          x: b.x,
          y: b.y,
          colour: b.captive.spec.colour,
        });
        b.captive.state = 'dead';
        b.captive = null;
        monsters++;
      } else {
        this.events.push({ kind: 'bubblePop', x: b.x, y: b.y });
        empties++;
      }
    }

    const points = chainScore(monsters) + empties * T.EMPTY_BUBBLE_POP;
    const letters = extendLetters(monsters);
    this.score.points += points;
    this.lastChain = { monsters, points, letters };
    // EXTEND letters are counted here but do not yet drop as pickups — items are M4.

    if (counted > 0) {
      // The score reads at the middle of what was burst, not at whichever bubble the
      // player happened to touch — a six-chain is one event and should say so in one
      // place.
      this.events.push({
        kind: 'chain',
        x: sumX / counted,
        y: sumY / counted,
        monsters,
        points,
      });
    }
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

    for (const p of this.projectiles) {
      if (p.dead) continue;
      if (projectileHits(p, b0.x, b0.y, b0.halfW, b0.halfH)) {
        p.dead = true;
        this.killPlayer();
        return;
      }
    }

    if (this.baron && baronHits(this.baron, b0.x, b0.y, b0.halfW, b0.halfH)) this.killPlayer();
  }

  private killPlayer(): void {
    this.score.lives--;
    if (this.score.lives <= 0) {
      this.phase = 'dead';
      return;
    }
    this.player.respawn(this.room.playerStart.x, this.room.playerStart.y);

    // The Baron leaves when it takes a life, and the clock starts over. Otherwise a
    // player who dies at speed 3.0 respawns into something already unsurvivable and
    // loses the rest of their lives in a couple of seconds.
    this.baron = null;
    this.hurryUp = false;
    this.timer = this.room.timer;
    this.projectiles.length = 0;
  }

  /** Drop resolved bubbles and spent shots. Done once at the end so indices stay stable
   *  all step — the player's ridingIndex refers into the bubble array. */
  private sweep(): void {
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      if (this.bubbles[i].dead) this.bubbles.splice(i, 1);
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (this.projectiles[i].dead) this.projectiles.splice(i, 1);
    }
  }

  /** Redness of a bubble's captive, for the renderer. */
  angerOf(b: Bubble): number {
    return anger(b);
  }
}
