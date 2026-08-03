import { T, ROOM_W } from '@/data/tuning';
import { Rng } from '@cabinet/rng';
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
  spawnSpecial,
  stepBubble,
  type Bubble,
} from './bubble';
import { spawnMonster, stepMonster, type Monster } from './monster';
import { ITEM_SPECS, type CounterName, type ItemKind } from '@/data/items';
import {
  loadCounters,
  saveCounters,
  walkThresholds,
  type Counters,
} from './counters';
import { fruitValue, pickupTouches, spawnPickup, stepPickup, type Pickup } from './item';
import {
  spawnBolt,
  spawnFire,
  spawnWater,
  stepBolt,
  stepDrop,
  stepFlame,
  touches,
  type Bolt,
  type Drop,
  type Flame,
} from './special';
import { projectileHits, stepProjectile, type Projectile } from './projectile';
import { baronHits, spawnBaron, stepBaron, type Baron } from './baron';
import { bossHits, finish, spawnBoss, stepBoss, zap, type Boss } from './boss';
import {
  chainScore,
  collectLetter,
  extendLetters,
  hasLetter,
  initialScore,
  type ScoreState,
} from './score';

export type RoomPhase = 'playing' | 'cleared' | 'dead' | 'won';

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
  | { kind: 'chain'; x: number; y: number; monsters: number; points: number }
  | { kind: 'pickup'; x: number; y: number; item: ItemKind; note: string; points: number };

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
  readonly pickups: Pickup[] = [];
  readonly drops: Drop[] = [];
  readonly bolts: Bolt[] = [];
  readonly flames: Flame[] = [];
  readonly score: ScoreState;

  /** Frames until the next special bubble drifts in, if this room offers any. */
  private specialTimer = T.SPECIAL_INTERVAL;

  /** The behaviour counters. Persist across sessions — see counters.ts. */
  readonly counters: Counters;
  /** What the counter walk awarded on entering this room, for the debug overlay. */
  readonly awarded: { item: ItemKind | null; counter: CounterName | null };

  /** Frames the monsters are held still by a clock. */
  freezeFrames = 0;
  /** Rooms to skip, set by an umbrella. The caller advances and clears it. */
  warpRooms = 0;
  /** Set when the player walks into a secret door. The caller decides where it leads. */
  doorTaken: 'silver' | 'gold' | null = null;
  /** Distance walked since the last screen crossing was counted. */
  private walked = 0;

  /** Invincible, unbubbleable, and only ever closer. Null until the hurry-up. */
  baron: Baron | null = null;
  /** Room 100 only. */
  boss: Boss | null = null;

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
    readonly roomNumber = 1,
    score: ScoreState = initialScore(),
    counters: Counters = loadCounters(),
  ) {
    this.player = new Player(room.playerStart.x, room.playerStart.y);
    this.score = score;
    this.rng = new Rng(roomNumber);
    this.timer = room.timer;
    this.counters = counters;
    for (const s of room.spawns) this.monsters.push(spawnMonster(s.kind, s.x, s.y, s.dir));
    if (room.boss) this.boss = spawnBoss();

    this.awarded = walkThresholds(this.counters, roomNumber);
    if (this.awarded.item) {
      const at = this.itemSpawnPoint();
      this.pickups.push(spawnPickup(this.awarded.item, at.x, at.y));
    }
    saveCounters(this.counters);
  }

  /**
   * Where the room's award lands.
   *
   * Mirrored across the room from the player's start, and dropped from near the ceiling
   * so it falls through the tiers on its way down. Spawning it above the player's head
   * meant it fell straight onto them and was absorbed within a few frames of the room
   * opening — the reward for thirty-five jumps arrived with no moment of noticing it,
   * let alone going to get it. An item you have to cross the room for is the whole
   * difference between a prize and a rounding error on the score.
   */
  private itemSpawnPoint(): { x: number; y: number } {
    const startX = this.room.playerStart.x * T.TILE + T.TILE / 2;
    const mirrored = ROOM_W - startX;
    // Keep it off the walls, which are solid and would trap it.
    const x = Math.max(T.TILE * 2, Math.min(ROOM_W - T.TILE * 2, mirrored));
    return { x, y: T.TILE * 2 };
  }

  bump(name: CounterName, n = 1): void {
    this.counters[name] += n;
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
      this.bump('hurryUps');
    }

    if (this.freezeFrames > 0) this.freezeFrames--;
    if (this.player.invulnFrames > 0) this.player.invulnFrames--;

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
    if (this.freezeFrames === 0) {
      for (const m of this.monsters) {
        if (m.state !== 'walking') continue;
        const r = stepMonster(this.room, m, px, py, this.rng);
        if (r.threw) this.projectiles.push(r.threw);
      }
    }

    for (const p of this.projectiles) stepProjectile(this.room, p);
    for (const p of this.pickups) stepPickup(this.room, p);
    this.collectPickups();
    this.stepSpecials();
    this.stepBossFight();
    this.stepBaron();

    this.carryCaptives();
    this.checkPlayerHit();
    this.sweep();

    // A boss room ends when the boss does, not when the room empties.
    if (this.boss) {
      if (this.boss.state === 'dead') {
        this.phase = 'won';
        this.baron = null;
      }
    } else if (this.liveMonsters.length === 0) {
      this.phase = 'cleared';
      this.baron = null;
    }
  }

  /**
   * The boss fight.
   *
   * Only lightning touches it, which is the point: every tool the player spent
   * ninety-nine rooms mastering stops working, and the fight is an exam on the one
   * special bubble they were least likely to have practised with. Beaten down, it
   * becomes bubbleable — the ordinary verb works again, and popping it ends the game.
   */
  private stepBossFight(): void {
    const boss = this.boss;
    if (!boss || boss.state === 'dead') return;

    const r = stepBoss(boss, this.player.body.x, this.player.body.y);
    if (r.threw) this.projectiles.push(r.threw);
    if (r.brokeFree) {
      this.events.push({ kind: 'escape', x: boss.x, y: boss.y });
    }

    // Lightning is the only thing that hurts it.
    for (const bolt of this.bolts) {
      if (bolt.dead) continue;
      if (!touches(bolt.x, bolt.y, T.LIGHTNING_HALF, boss.x, boss.y, boss.half, boss.half)) {
        continue;
      }
      bolt.dead = true;
      const beaten = zap(boss);
      this.events.push({ kind: 'monsterPop', x: boss.x, y: boss.y, colour: '#7ad85a' });
      if (beaten) this.events.push({ kind: 'chain', x: boss.x, y: boss.y, monsters: 0, points: 0 });
      break;
    }

    // Held: now an ordinary pop finishes it.
    if (boss.state === 'bubbled') {
      const b0 = this.player.body;
      const reach = boss.half + b0.halfW;
      if (Math.abs(boss.x - b0.x) < reach && Math.abs(boss.y - b0.y) < boss.half + b0.halfH) {
        if (finish(boss)) {
          this.score.points += T.BOSS_SCORE;
          this.events.push({ kind: 'monsterPop', x: boss.x, y: boss.y, colour: '#ffd166' });
          this.events.push({
            kind: 'chain',
            x: boss.x,
            y: boss.y,
            monsters: 8,
            points: T.BOSS_SCORE,
          });
        }
      }
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
    const wasOnGround = this.player.body.onGround;
    const beforeX = this.player.body.x;

    this.player.step(this.room, a, this.bubbles);

    const p = this.player;

    // --- behaviour tracking. Every one of these is a counter someone can learn to farm,
    // which is the point: the reward system is discoverable by experiment alone.
    if (a.jumpPressed && wasOnGround) {
      this.bump('jumps');
      if (p.rings.jump) this.score.points += T.RING_JUMP_POINTS;
    }
    if (p.body.wrapped) this.bump('falls');

    // A "screen crossing" is cumulative distance rather than a literal wall-to-wall
    // trip: pacing back and forth is the same behaviour and should count the same.
    const moved = Math.abs(p.body.x - beforeX);
    this.walked += moved;
    if (p.rings.step) this.score.points += Math.round(moved) * T.RING_STEP_POINTS;
    while (this.walked >= ROOM_W) {
      this.walked -= ROOM_W;
      this.bump('screenCrossings');
    }

    /*
     * A rider gets carried sideways by whatever it is standing on. Doing it here rather
     * than inside the physics keeps that layer ignorant of bubbles.
     *
     * HORIZONTALLY ONLY. resolveY has already snapped the rider onto the lip at its
     * current height, so the vertical carry is baked in; adding it again moves the
     * player a second time, lifting them clear of the bubble every frame and dropping
     * them back next frame. The ride is meant to be a lift, not a vibration.
     */
    const idx = this.player.body.ridingIndex;
    if (idx >= 0 && idx < this.bubbles.length) {
      this.player.body.x += this.bubbles[idx].vx;
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
    this.bump('bubblesBlown');
  }

  /**
   * Collect anything the player is standing in.
   *
   * Eating is a tracked behaviour too — the heart is bought with fruit, and the rings
   * are bought with sweets, so the item system feeds itself.
   */
  private collectPickups(): void {
    const b0 = this.player.body;
    for (const p of this.pickups) {
      if (p.dead) continue;
      if (!pickupTouches(p, b0.x, b0.y, b0.halfW, b0.halfH)) continue;

      p.dead = true;
      this.score.points += p.points;
      // Fruit and diamonds are spoils; everything else is a special item, and taking
      // them is itself what buys the blue cross.
      if (p.kind !== 'fruit' && p.kind !== 'diamond' && p.kind !== 'extend') {
        this.bump('specialItemsTaken');
      }
      this.applyItem(p.kind, p.letter);

      this.events.push({
        kind: 'pickup',
        x: p.body.x,
        y: p.body.y,
        item: p.kind,
        note: ITEM_SPECS[p.kind].note,
        points: p.points,
      });
    }
  }

  /** What an item does. See data/items.ts for what each one is for. */
  private applyItem(kind: ItemKind, letter: number): void {
    const p = this.player;
    switch (kind) {
      case 'sweetYellow':
        p.blowCooldown = T.BUBBLE_COOLDOWN_RAPID;
        this.bump('sweetsYellow');
        break;
      case 'sweetBlue':
        p.fastBubbles = true;
        this.bump('sweetsBlue');
        break;
      case 'sweetPurple':
        p.bubbleRange = 'far';
        this.bump('sweetsPurple');
        break;
      case 'shoe':
        p.speed = T.RUN_SPEED_FAST;
        break;
      case 'clock':
        this.freezeFrames = T.CLOCK_FREEZE_FRAMES;
        break;
      case 'heart':
        p.invulnFrames = T.HEART_INVULN_FRAMES;
        break;
      case 'ringPurple':
        p.rings.jump = true;
        break;
      case 'ringRed':
        p.rings.pop = true;
        break;
      case 'ringBlue':
        p.rings.step = true;
        break;
      case 'umbrellaOrange':
        this.warpRooms = 3;
        this.phase = 'cleared';
        break;
      case 'umbrellaRed':
        this.warpRooms = 5;
        this.phase = 'cleared';
        break;
      case 'umbrellaPurple':
        this.warpRooms = 7;
        this.phase = 'cleared';
        break;
      case 'potion':
        this.showerFruit();
        break;
      case 'bomb':
        // Everything on screen burns where it stands.
        for (const m of this.liveMonsters) {
          this.flames.push(...spawnFire(m.body.x, m.body.y));
        }
        break;
      case 'crossRed':
        for (const m of this.liveMonsters) this.elementalKill(m, T.DIAMOND_FIRE);
        break;
      case 'crossBlue':
        // The room floods: water from the ceiling, right across the width.
        for (let i = 0; i < 5; i++) {
          this.drops.push(...spawnWater(((i + 0.5) / 5) * ROOM_W, T.TILE * 2));
        }
        break;
      case 'diamond':
        break;
      case 'doorSilver':
      case 'doorGold':
        // A door is a way out of the room, not a reward taken inside it. The campaign
        // decides where it leads; the room's job is only to end.
        this.doorTaken = kind === 'doorGold' ? 'gold' : 'silver';
        this.phase = 'cleared';
        break;
      case 'fruit':
        this.bump('fruitEaten');
        break;
      case 'extend':
        // Completing the word grants a life AND ends the room — that is what makes the
        // letters worth arranging a chain for rather than a bonus you drift into.
        if (collectLetter(this.score, letter)) this.phase = 'cleared';
        break;
      case 'bell':
        // Cosmetic: it chimes before a special appears. The event carries the note.
        break;
    }
  }

  /** A travelling bubble that touches a free monster traps it. */
  private resolveCaptures(): void {
    for (const b of this.bubbles) {
      // A special already carries something; it cannot also catch a monster.
      if (b.dead || b.captive || b.special) continue;
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
      const side: -1 | 1 = dx > 0 ? 1 : -1;

      if (Math.abs(dx) > Math.abs(dy) && side === p.facing && !b.special) {
        shove(b, side);
        continue;
      }

      // A special is its own payload: it releases rather than chaining, and the side
      // the player touched it from is what aims a bolt.
      if (b.special) {
        this.release(b, side);
        b.dead = true;
        this.events.push({ kind: 'bubblePop', x: b.x, y: b.y });
        continue;
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
        this.bump('emptyPops');
        if (this.player.rings.pop) this.score.points += T.RING_POP_POINTS;
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

    this.dropSpoils(chain, monsters, letters);
  }

  /**
   * Fruit and EXTEND letters from a chain.
   *
   * Both scale with the chain, and both are scattered rather than stacked — a pile of
   * pickups on one pixel reads as a single item and robs the player of the moment the
   * chain was for. The fruit is half the reward the curve pays out; a player who never
   * chains never sees the expensive kind and may not know it exists.
   */
  private dropSpoils(chain: readonly number[], monsters: number, letters: number): void {
    if (monsters <= 0) return;
    const value = fruitValue(monsters);

    let dropped = 0;
    for (const i of chain) {
      const b = this.bubbles[i];
      if (dropped >= monsters) break;
      // Alternate the kick left and right so a big chain fans out.
      const kick = (dropped % 2 === 0 ? 1 : -1) * T.FRUIT_SCATTER;
      this.pickups.push(
        spawnPickup('fruit', b.x, b.y, { points: value, vx: kick, vy: -0.8 }),
      );
      dropped++;
    }

    for (let i = 0; i < letters; i++) {
      const slot = this.nextMissingLetter(i);
      if (slot < 0) break;
      const b = this.bubbles[chain[i % chain.length]];
      this.pickups.push(
        spawnPickup('extend', b.x, b.y, {
          letter: slot,
          vx: (i % 2 === 0 ? -1 : 1) * T.FRUIT_SCATTER * 1.4,
          vy: -1.4,
        }),
      );
    }
  }

  /** Letters the player still needs, skipping `skip` of them so one chain can drop
   *  several distinct letters rather than several copies of the same one. */
  private nextMissingLetter(skip: number): number {
    let seen = 0;
    for (let i = 0; i < 6; i++) {
      if (hasLetter(this.score, i)) continue;
      if (this.pickups.some((p) => !p.dead && p.kind === 'extend' && p.letter === i)) continue;
      if (seen++ === skip) return i;
    }
    return -1;
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
    // A heart makes the player untouchable outright — not merely harder to hit.
    if (this.player.invulnFrames > 0) return;
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

    if (this.baron && baronHits(this.baron, b0.x, b0.y, b0.halfW, b0.halfH)) {
      this.killPlayer();
      return;
    }
    // Touching the boss is fatal only while it is still fighting — once it is held,
    // walking into it is exactly how you finish it.
    if (this.boss && bossHits(this.boss, b0.x, b0.y, b0.halfW, b0.halfH)) this.killPlayer();
  }

  /**
   * Offer a secret door.
   *
   * Placed by the campaign, which is the only thing that knows whether the run is still
   * clean. It goes on the far side of the room: a door you fall into by accident is not
   * a reward for a deathless run, it is a coin toss.
   */
  offerDoor(kind: 'silver' | 'gold'): void {
    const startX = this.room.playerStart.x * T.TILE + T.TILE / 2;
    const x = Math.max(T.TILE * 2, Math.min(ROOM_W - T.TILE * 2, ROOM_W - startX));
    this.pickups.push(spawnPickup(kind === 'gold' ? 'doorGold' : 'doorSilver', x, T.TILE * 2));
  }

  /** True while the player has lost no lives in this room. The campaign tracks the run. */
  livesLostHere = 0;

  private killPlayer(): void {
    this.score.lives--;
    this.livesLostHere++;
    if (this.score.lives <= 0) {
      this.phase = 'dead';
      return;
    }
    this.player.respawn(this.room.playerStart.x, this.room.playerStart.y);

    /*
     * A moment of grace on respawn.
     *
     * The generator now keeps monsters clear of the start point, but monsters MOVE — one
     * can be standing there by the time you come back, and without this you die on the
     * frame you reappear, respawn onto it again, and lose every remaining life in about
     * a second with no input possible. Losing a life must never cost you the next one.
     */
    this.player.invulnFrames = T.RESPAWN_INVULN_FRAMES;

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
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      if (this.pickups[i].dead) this.pickups.splice(i, 1);
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      if (this.drops[i].dead) this.drops.splice(i, 1);
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      if (this.bolts[i].dead) this.bolts.splice(i, 1);
    }
    for (let i = this.flames.length - 1; i >= 0; i--) {
      if (this.flames[i].dead) this.flames.splice(i, 1);
    }
  }

  /* ---------------------------------------------------------------- specials */

  /**
   * Drift a special bubble in, and run whatever has already been released.
   *
   * Specials enter from the side on the room's own schedule rather than being earned —
   * they are weather, not a reward. Finding one is luck; using it well is not.
   */
  private stepSpecials(): void {
    const offered = this.room.specialBubbles;
    if (offered.length > 0 && --this.specialTimer <= 0) {
      this.specialTimer = T.SPECIAL_INTERVAL;
      const alive = this.bubbles.filter((b) => b.special).length;
      if (alive < T.SPECIAL_MAX) {
        const kind = offered[this.frame % offered.length];
        // Enter opposite the player, so it has to be gone to rather than walked into.
        const fromLeft = this.player.body.x > ROOM_W / 2;
        this.bubbles.push(
          spawnSpecial(
            kind,
            fromLeft ? T.TILE * 2 : ROOM_W - T.TILE * 2,
            T.TILE * (4 + (this.frame % 5)),
          ),
        );
      }
    }

    for (const d of this.drops) stepDrop(this.room, d);
    for (const b of this.bolts) stepBolt(this.room, b);
    for (const f of this.flames) stepFlame(this.room, f);

    this.resolveElementalKills();
  }

  /**
   * Release a special bubble's payload.
   *
   * `fromSide` is which side of the bubble the player touched, and it is the entire
   * aiming mechanic for lightning: a bolt travels away from the player, so where you
   * stand when you pop it decides what it sweeps.
   */
  private release(b: Bubble, fromSide: -1 | 1): void {
    switch (b.special) {
      case 'water':
        this.drops.push(...spawnWater(b.x, b.y));
        this.bump('waterPops');
        break;
      case 'lightning':
        this.bolts.push(spawnBolt(b.x, b.y, fromSide));
        this.bump('lightningPops');
        break;
      case 'fire':
        this.flames.push(...spawnFire(b.x, b.y));
        this.bump('firePops');
        break;
    }
  }

  /**
   * What the elements do to whatever they touch.
   *
   * Each kills for a different payout — water < lightning < fire — so what you kill a
   * monster WITH decides what it leaves behind. That is the fact the rarest items in
   * the counter table are gated on, and a player who never notices it never sees them.
   */
  private resolveElementalKills(): void {
    const b0 = this.player.body;

    for (const m of this.monsters) {
      if (m.state !== 'walking') continue;
      const { x, y, halfW, halfH } = m.body;

      for (const d of this.drops) {
        if (d.dead || !touches(d.x, d.y, T.WATER_HALF, x, y, halfW, halfH)) continue;
        this.elementalKill(m, T.DIAMOND_WATER);
        this.bump('drownedMonsters');
        break;
      }
      if (m.state !== 'walking') continue;

      for (const bolt of this.bolts) {
        if (bolt.dead || !touches(bolt.x, bolt.y, T.LIGHTNING_HALF, x, y, halfW, halfH)) continue;
        this.elementalKill(m, T.DIAMOND_LIGHTNING);
        break;
      }
      if (m.state !== 'walking') continue;

      for (const f of this.flames) {
        if (f.dead || !touches(f.x, f.y, T.FIRE_HALF, x, y, halfW, halfH)) continue;
        this.elementalKill(m, T.DIAMOND_FIRE);
        break;
      }
    }

    // The elements are indiscriminate. Standing in your own fire is a way to die, which
    // is what stops a special bubble being a free room clear.
    if (this.player.invulnFrames > 0) return;
    for (const f of this.flames) {
      if (!f.dead && touches(f.x, f.y, T.FIRE_HALF, b0.x, b0.y, b0.halfW, b0.halfH)) {
        this.killPlayer();
        return;
      }
    }
    for (const bolt of this.bolts) {
      if (!bolt.dead && touches(bolt.x, bolt.y, T.LIGHTNING_HALF, b0.x, b0.y, b0.halfW, b0.halfH)) {
        this.killPlayer();
        return;
      }
    }
  }

  private elementalKill(m: Monster, value: number): void {
    m.state = 'dead';
    this.score.points += value;
    this.events.push({ kind: 'monsterPop', x: m.body.x, y: m.body.y, colour: m.spec.colour });
    this.pickups.push(
      spawnPickup('diamond', m.body.x, m.body.y, { points: value, vy: -1.1 }),
    );
  }

  /**
   * A potion's payout: fruit rains across the whole room.
   *
   * Deliberately spread across the full width rather than dropped on the player. The
   * reward is not the points, it is the thirty seconds of sprinting around collecting
   * them — and it also quietly feeds the fruit counter that buys the heart.
   */
  private showerFruit(): void {
    const n = T.POTION_FRUIT_COUNT;
    for (let i = 0; i < n; i++) {
      // Evenly spaced with a fixed stagger: repeatable, and never a single stack.
      const x = ((i + 0.5) / n) * ROOM_W;
      const y = ((i * 5) % 7) * T.TILE + T.TILE;
      this.pickups.push(spawnPickup('fruit', x, y, { points: T.FRUIT_BASE }));
    }
  }

  /** Persist the counters. Called when a room ends, so a session that is closed
   *  mid-room does not lose the behaviour that earned the next item. */
  persist(): void {
    saveCounters(this.counters);
  }

  /** Redness of a bubble's captive, for the renderer. */
  angerOf(b: Bubble): number {
    return anger(b);
  }
}
