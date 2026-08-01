import { T } from '@/data/tuning';
import type { ClassId, UpgradeId } from '@/data/classes';
import { difficultyOf, type Difficulty } from '@/data/difficulty';
import type { ActionState } from '@/engine/actions';
import type { FireModel } from '@/engine/input';
import { Rng } from '@/engine/rng';
import { SpatialGrid } from '@/engine/spatial';
import { chase, findSpawnTile, type Blocker } from './ai';
import { Camera } from './camera';
import { boxHitsSolid } from './collision';
import { damageGenerator, damageMonster, damagePlayer } from './combat';
import { EventBus } from './events';
import type { RunState } from './flow';
import { generatorLevel, makeGenerator, spawnPeriod, type Generator } from './generator';
import { makeItem, resolvePickup, usesInventorySlot, type Item } from './items';
import { buildTerrain, cellCentre, type LevelData } from './level';
import { detonate } from './magic';
import {
  contactDamage,
  makeMonster,
  monsterSpeed,
  type Monster,
  type MonsterKind,
  type MonsterLevel,
} from './monster';
import { FACE_DX, FACE_DY, facingFrom as facingOf, Player } from './player';
import {
  makeShot,
  moveProjectile,
  projectileCanReach,
  projectileHits,
  type Projectile,
} from './projectile';
import { cullFood } from './rank';
import { roll } from './stats';
import { Terrain, Tile } from './terrain';
import * as MOVE from './collision';
import { DEFAULT_RULES, monsterAllowed, type Rules } from '@/data/rules';
import {
  chooseTheft,
  deathPotionValue,
  makeDeath,
  makeThief,
  shootDeath,
  type Death,
  type Thief,
} from './special';
import { makeRock } from './projectile';
import { targetable } from './monster';

/**
 * The simulation. See DESIGN.md §7.4 for the entity model and the fixed update order.
 *
 * Nothing in this file (or anything it imports from game/) may reference a screen
 * pixel. World units only — enforced by tests/scale.test.ts.
 */
export class World {
  readonly terrain: Terrain;
  readonly player: Player;
  readonly camera = new Camera();
  readonly rng: Rng;
  readonly level: LevelData;
  readonly events = new EventBus();

  monsters: Monster[] = [];
  generators: Generator[] = [];
  projectiles: Projectile[] = [];
  items: Item[] = [];
  deaths: Death[] = [];
  thieves: Thief[] = [];

  /** Feature toggles. Part of the simulation, so replays honour them (DESIGN.md §6.6). */
  rules: Rules = { ...DEFAULT_RULES };

  frame = 0;
  depth = 1;
  fireModel: FireModel = 'feathered';
  godMode = false;

  /** Set when the player steps on an exit; the Run picks it up and advances. */
  exitReached = false;
  /**
   * The exit sequence.
   *
   * Reaching the exit does not end the level on the same frame any more — it starts a
   * short sequence during which the player is drawn into the exit and nothing can touch
   * them. `exitFrames` counts up; `exitReached` only goes true at the end of it, which
   * is what the run flow already watches, so the transition stays where it was.
   *
   * This lives in the simulation rather than in the renderer because it changes what the
   * game DOES: the level is over the instant you touch the exit, and a ghost cannot kill
   * you while the animation plays. A presentation-only version would have to either lie
   * about that or let you die during a victory.
   */
  exitFrames = -1;
  /** Cell centre the player is drawn toward, in world units. */
  exitAt: readonly [number, number] | null = null;
  /** Which exit was used, if it names a destination. Intro levels use this for the
   *  numbered skip exits that let a solo player choose their starting depth. */
  exitSkipTo: number | null = null;

  /**
   * Treasure rooms run on a clock rather than a threat: there is nothing to fight,
   * only a limited time to be greedy in. Frames remaining, or -1 in a normal level.
   */
  treasureTimer = -1;
  treasureTaken = 0;
  /**
   * Score gathered in a treasure room but not yet banked.
   *
   * Held rather than scored on pickup, because reaching the exit is what earns it. See
   * bankTreasureRoom(). Zero outside a treasure room, where treasure scores immediately.
   */
  treasureHeld = 0;
  /** Pieces lost to the clock, for the HUD to report. */
  treasureLost = 0;

  /**
   * Frames since the player last engaged: fired, was hit, dealt damage, or picked
   * something up. Doors give up and open on their own once this passes the threshold —
   * the stalemate escape valve.
   */
  engagementFrames = 0;
  /** Whether the 180s stand-still trick has already fired on this level. */
  wallsAreExits = false;
  private teleportCd = 0;
  private trapsTriggered = new Set<number>();

  private grid = new SpatialGrid<Monster>();
  private scratch: Monster[] = [];

  constructor(
    level: LevelData,
    classId: ClassId,
    seed: number,
    carry?: RunState,
    rules: Rules = DEFAULT_RULES,
  ) {
    this.rules = { ...rules };
    this.level = level;
    this.terrain = buildTerrain(level);
    this.rng = new Rng(seed);
    this.player = new Player(classId);
    const [sx, sy] = cellCentre(level.start[0], level.start[1]);
    this.player.x = sx;
    this.player.y = sy;
    this.camera.follow(this.player.x, this.player.y);
    this.spawnFromLevel();

    if (carry) this.importState(carry);

    // Rank culling runs after the score is known: the richer you are, the less food
    // this level will contain.
    if (this.rules.rankCurve) cullFood(this.items, level.id, this.player.score);

    if (level.type === 'treasure') this.treasureTimer = T.TREASURE_ROOM_SEC * T.STEP_HZ;
  }

  get isTreasureRoom(): boolean {
    return this.level.type === 'treasure';
  }

  /** The difficulty settings this world runs under. Derived from rules, never stored. */
  get difficulty(): Difficulty {
    return difficultyOf(this.rules.difficulty);
  }

  /**
   * Ceiling on health.
   *
   * The original capped it, and the cap does real work: once you cannot bank any more,
   * food you walk past is genuinely wasted and the drain becomes a clock again rather
   * than an accounting detail. Without one, a careful player simply accumulates until
   * nothing on the level can threaten them.
   */
  get maxHealth(): number {
    return this.difficulty.maxHealth;
  }

  /* ------------------------------------------------------------------ run state */

  importState(s: RunState): void {
    const p = this.player;
    // Clamped, because difficulty can change between levels: banking 2400 on Apprentice
    // and then switching to Nightmare must not carry the old ceiling with it.
    p.health = Math.min(this.maxHealth, s.health);
    p.score = s.score;
    p.credits = s.credits;
    p.keys = s.keys;
    p.potions = s.potions;
    p.upgrades = new Set(s.upgrades);
    p.invisibleFrames = s.invisibleFrames;
  }

  exportState(): RunState {
    const p = this.player;
    return {
      classId: p.classId,
      health: p.health,
      score: p.score,
      credits: p.credits,
      keys: p.keys,
      potions: p.potions,
      upgrades: [...p.upgrades],
      invisibleFrames: p.invisibleFrames,
      deepestLevel: this.depth,
    };
  }

  private spawnFromLevel(): void {
    for (const o of this.level.objects) {
      const [wx, wy] = cellCentre(o.x, o.y);
      switch (o.t) {
        case 'gen': {
          // Disabling a monster family removes its generators outright. Substituting
          // another family would silently rewrite the level's intent while appearing to
          // respect it; removal is honest and visible (DESIGN.md §6.6).
          const kind = (o.kind ?? 'grunt') as MonsterKind;
          if (!monsterAllowed(this.rules, kind)) break;
          this.generators.push(makeGenerator(kind, o.lvl ?? 1, o.x, o.y));
          break;
        }
        case 'mon': {
          const kind = (o.kind ?? 'grunt') as MonsterKind;
          if (!monsterAllowed(this.rules, kind)) break;
          this.monsters.push(makeMonster(kind, (o.lvl ?? 1) as MonsterLevel, wx, wy));
          break;
        }
        case 'death':
          if (this.rules.death) this.deaths.push(makeDeath(wx, wy));
          break;
        case 'thief':
          if (this.rules.thief) this.thieves.push(makeThief(wx, wy));
          break;
        case 'food':
          this.items.push(makeItem('food', wx, wy, { breakable: o.breakable ?? false }));
          break;
        case 'key':
          this.items.push(makeItem('key', wx, wy));
          break;
        case 'potion':
          this.items.push(makeItem('potion', wx, wy, { breakable: o.breakable ?? true }));
          break;
        case 'treasure':
          this.items.push(makeItem('treasure', wx, wy));
          break;
        case 'upgrade':
          this.items.push(
            makeItem('upgrade', wx, wy, { upgrade: (o.kind ?? 'speed') as UpgradeId }),
          );
          break;
        default:
          break; // exits, teleporters and traps live in the tile layer / object metadata
      }
    }
  }

  get liveMonsters(): number {
    let n = 0;
    for (const m of this.monsters) if (m.alive) n++;
    return n;
  }

  /** Does this level still contain an upgrade potion? Drives the intro-screen hint. */
  get hasHiddenUpgrade(): boolean {
    return this.items.some((i) => i.alive && i.kind === 'upgrade');
  }

  /**
   * One fixed step. The order is documented because it is observable:
   *   1 player intent  2 movement  3 fire/melee  4 projectiles  5 monsters
   *   6 generators     7 terrain timers          8 pickups      9 damage
   *  10 health drain  11 score/exit             12 fx
   */
  step(a: Readonly<ActionState>): void {
    if (this.player.dead || this.exitReached) {
      this.frame++;
      return;
    }

    // The exit sequence owns the world while it runs. Nothing else steps: no monster
    // moves, no generator spawns, no drain. Leaving the simulation live here would mean
    // a ghost could kill you mid-victory, and a level you had already finished could
    // still end the run.
    if (this.exitFrames >= 0) {
      this.stepExitSequence();
      this.frame++;
      return;
    }

    this.player.step(this.terrain, a, this.fireModel, this.rules);
    this.resolveItemBlocking();
    this.resolveGeneratorBlocking();
    this.grid.rebuild(this.monsters, (m) => m.alive);

    this.fire(a);
    this.melee(a);
    this.stepProjectiles();
    this.stepMonsters();
    this.stepDeaths();
    this.stepThieves();
    this.stepGenerators();
    this.stepTerrain(a);
    this.pickups();
    this.stepTreasureTimer();
    this.checkExit();

    this.camera.follow(this.player.x, this.player.y);
    this.compact();
    this.frame++;
  }

  private engage(): void {
    this.engagementFrames = 0;
  }

  private reachable(pr: Projectile, tx: number, ty: number): boolean {
    if (!this.rules.cornerSqueeze) return true;
    return projectileCanReach(this.terrain, pr, tx, ty, T.TILE, T.CORNER_SQUEEZE_MAX);
  }

  private addScore = (n: number, reason: string): void => {
    if (n <= 0) return;
    this.player.score += n;
    this.events.emit({ t: 'score', amount: n, reason });
  };

  /* ------------------------------------------------------------------ shooting */

  private fire(a: Readonly<ActionState>): void {
    const p = this.player;

    if (a.magicPressed && p.potions > 0) {
      p.potions--;
      this.engage();
      detonate(
        p,
        'used',
        this.monsters,
        this.generators,
        this.camera,
        this.events,
        this.addScore,
        this.deaths,
      );
    }

    if (!a.fire || p.shotAlive) return;
    this.engage();

    const st = p.stats;
    const dir =
      this.fireModel === 'twinstick' && (a.aimX !== 0 || a.aimY !== 0)
        ? { x: a.aimX, y: a.aimY }
        : { x: FACE_DX[p.facing], y: FACE_DY[p.facing] };

    this.projectiles.push(
      makeShot(
        p.x,
        p.y,
        dir.x,
        dir.y,
        st.shotSpeed * T.SHOT_SPEED_UNIT,
        T.SHOT_HALF[p.cls.shotBox],
        roll(st.shotStrength, this.rng),
        true,
      ),
    );
    p.shotAlive = true;
    this.events.emit({ t: 'shotFired' });
  }

  private stepProjectiles(): void {
    for (const pr of this.projectiles) {
      if (!pr.alive) continue;
      const res = moveProjectile(this.terrain, pr);

      if (pr.fromPlayer) {
        if (this.shotHitDeath(pr)) continue;
        if (this.shotHitThief(pr)) continue;
        if (this.shotHitMonster(pr)) continue;
        if (this.shotHitGenerator(pr)) continue;
        if (this.shotHitItem(pr)) continue;
      } else if (this.enemyProjectile(pr, res)) {
        continue;
      }

      if (pr.alive && res.hitWall) {
        pr.alive = false;
        // A shot that stops on a breakable wall takes it down with it.
        const cx = Math.floor((pr.x + Math.sign(pr.vx) * (T.TILE / 2)) / T.TILE);
        const cy = Math.floor((pr.y + Math.sign(pr.vy) * (T.TILE / 2)) / T.TILE);
        if (this.terrain.destroyBreakable(cx, cy)) this.engage();
        this.events.emit({ t: 'shotHitWall', x: res.x, y: res.y });
      }

      /**
       * Your shot ends at the edge of the screen.
       *
       * The one-shot-at-a-time limit is what makes tapping fire beat holding it, but it
       * only works as a rhythm if the slot comes back when the shot stops being YOUR
       * business. Tying it to hitting a wall tied it to level geometry instead: on an open
       * level the shot flew hundreds of world units past the edge of the viewport, and
       * measured on depth 20, the Elf's shot left view at frame 40 and held the slot until
       * frame 189 — two and a half seconds of not being able to fire at something that had
       * not been visible for most of it. Bigger levels made it worse, because "distance to
       * the next wall" grew with them.
       *
       * Only the player's shot. Enemy fire is deliberately NOT culled here: demons shoot
       * through walls and can sit just outside the viewport, so culling their fireballs on
       * the same rule would quietly disarm them from exactly the position that makes them
       * dangerous. SHOT_LIFETIME_F still backstops everything.
       */
      if (pr.alive && pr.fromPlayer && !this.camera.contains(pr.x, pr.y, pr.half)) {
        pr.alive = false;
      }
    }
  }

  /**
   * Enemy fire hurts everything, not just you.
   *
   * Demon fireballs and lobber rocks damage other monsters, generators and breakable
   * items indiscriminately — which is why "train their shots onto the generator" is a
   * real tactic rather than a figure of speech. Rocks are the stronger version: they
   * destroy bone generators outright, where blocks are merely weakened.
   */
  private enemyProjectile(pr: Projectile, res: { hitWall: boolean }): boolean {
    // A rock only interacts on landing; in flight it is over everyone's heads.
    if (pr.flight > 0) return false;
    const landed = pr.kind === 'rock' && res.hitWall;

    if (projectileHits(pr, this.player.x, this.player.y, this.player.half)) {
      if (!this.godMode) damagePlayer(this.player, pr.damage, this.events);
      pr.alive = false;
      return true;
    }

    for (const m of this.monsters) {
      if (m === pr.owner) continue; // never hit your own shooter
      if (!m.alive || !projectileHits(pr, m.x, m.y, m.half)) continue;
      damageMonster(m, pr.damage, 'shot', this.events, () => {}); // no score for their friendly fire
      pr.alive = false;
      return true;
    }

    for (const g of this.generators) {
      if (!g.alive || !projectileHits(pr, g.x, g.y, T.TILE / 2)) continue;
      const bone = g.kind === 'ghost';
      // Bones shatter; blocks only crack.
      damageGenerator(g, bone ? g.level : 1, this.events, this.addScore);
      pr.alive = false;
      return true;
    }

    for (const it of this.items) {
      if (!it.alive || !it.breakable || !projectileHits(pr, it.x, it.y, it.half)) continue;
      it.alive = false;
      pr.alive = false;
      this.events.emit({ t: 'foodDestroyed', x: it.x, y: it.y });
      return true;
    }

    if (landed) {
      pr.alive = false;
      this.events.emit({ t: 'shotHitWall', x: pr.x, y: pr.y });
      return true;
    }
    return false;
  }

  private shotHitMonster(pr: Projectile): boolean {
    for (const m of this.monsters) {
      // A phased-out sorcerer is simply not there as far as your shot is concerned.
      if (!targetable(m) || !projectileHits(pr, m.x, m.y, m.half)) continue;
      if (!this.reachable(pr, m.x, m.y)) continue;
      damageMonster(m, pr.damage, 'shot', this.events, this.addScore);
      pr.alive = false;
      this.engage();
      return true;
    }
    return false;
  }

  private shotHitDeath(pr: Projectile): boolean {
    for (const d of this.deaths) {
      if (!d.alive || !projectileHits(pr, d.x, d.y, d.half)) continue;
      if (!this.reachable(pr, d.x, d.y)) continue;
      this.addScore(shootDeath(d), 'death shot');
      pr.alive = false; // absorbed, not deflected
      return true;
    }
    return false;
  }

  private shotHitThief(pr: Projectile): boolean {
    for (const t of this.thieves) {
      if (!t.alive || !projectileHits(pr, t.x, t.y, t.half)) continue;
      if (!this.reachable(pr, t.x, t.y)) continue;
      this.killThief(t);
      pr.alive = false;
      return true;
    }
    return false;
  }

  private shotHitGenerator(pr: Projectile): boolean {
    for (const g of this.generators) {
      if (!g.alive || !projectileHits(pr, g.x, g.y, T.TILE / 2)) continue;
      if (!this.reachable(pr, g.x, g.y)) continue;
      damageGenerator(g, pr.damage, this.events, this.addScore);
      pr.alive = false;
      this.engage();
      return true;
    }
    return false;
  }

  /**
   * Shots destroy breakable items. This is the "don't shoot the food" rule: a yellow
   * jug is simply gone, and a blue potion detonates weakly instead of being collected —
   * usually a waste, occasionally the only thing that saves you.
   */
  private shotHitItem(pr: Projectile): boolean {
    for (const it of this.items) {
      if (!it.alive || !it.breakable || !projectileHits(pr, it.x, it.y, it.half)) continue;
      if (!this.reachable(pr, it.x, it.y)) continue;
      it.alive = false;
      pr.alive = false;
      if (it.kind === 'potion' || it.kind === 'upgrade') {
        detonate(
          this.player,
          'shot',
          this.monsters,
          this.generators,
          this.camera,
          this.events,
          this.addScore,
          this.deaths,
        );
      } else {
        this.events.emit({ t: 'foodDestroyed', x: it.x, y: it.y });
      }
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ melee */

  private melee(a: Readonly<ActionState>): void {
    const p = this.player;
    if (p.meleeCd > 0) return;
    if (a.moveX === 0 && a.moveY === 0) return;
    if (p.rooted) return;

    const fx = FACE_DX[p.facing];
    const fy = FACE_DY[p.facing];

    let hit = false;
    for (const m of this.monsters) {
      if (!m.alive || m.kind === 'ghost') continue;
      if (!this.meleeConnects(fx, fy, m.x, m.y, m.half)) continue;
      damageMonster(m, roll(p.stats.meleeVsMonsters, this.rng), 'melee', this.events, this.addScore);
      hit = true;
      break;
    }

    if (!hit) {
      for (const g of this.generators) {
        if (!g.alive) continue;
        if (!this.meleeConnects(fx, fy, g.x, g.y, T.TILE / 2)) continue;
        if (this.rng.chance(p.stats.meleeGenMissChance)) break;
        damageGenerator(g, 1, this.events, this.addScore);
        hit = true;
        break;
      }
    }

    if (hit) {
      p.meleeCd = T.MELEE_PERIOD;
      this.engage();
      this.events.emit({ t: 'melee', hit: true });
    }
  }

  /**
   * Can a swing actually land on something at (tx, ty)?
   *
   * Three conditions, and the old code checked none of them properly. It compared each
   * axis separately against a box centred on the PLAYER, which describes a 32wu square —
   * two tiles across — reaching just as far backwards as forwards, with the facing
   * direction contributing a 6wu nudge that made no practical difference. Anything that
   * wandered adjacent died, from any direction, through anything.
   *
   *   1. RANGE, measured properly. Radial distance minus the target's own half, so "close
   *      enough to touch" means the same for a big target as a small one.
   *   2. IN FRONT. You swing where you are facing. A monster behind you is behind you.
   *   3. NOT THROUGH A WALL. The reported case: an Elf diagonally adjacent to a monster
   *      with blocks above him and to his right — the two of them cannot reach each other
   *      through a sealed corner, and the monsters were dying anyway. This is the same
   *      diagonal rule the projectiles use, applied to arms instead of arrows.
   */
  private meleeConnects(fx: number, fy: number, tx: number, ty: number, half: number): boolean {
    const p = this.player;
    const dx = tx - p.x;
    const dy = ty - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist - half > T.MELEE_REACH) return false;
    // Dead-on overlap has no meaningful direction; anything else must be in front.
    if (dist > 0.001 && (dx * fx + dy * fy) / dist < T.MELEE_ARC_COS) return false;
    return this.meleeClear(tx, ty);
  }

  /** Nothing solid between the player and the target — including a sealed diagonal. */
  private meleeClear(tx: number, ty: number): boolean {
    const p = this.player;
    const pcx = Math.floor(p.x / T.TILE);
    const pcy = Math.floor(p.y / T.TILE);
    const tcx = Math.floor(tx / T.TILE);
    const tcy = Math.floor(ty / T.TILE);
    if (pcx === tcx && pcy === tcy) return true;

    // A diagonal step through a corner where both orthogonal neighbours are solid is not
    // a gap you can reach through, however close the two centres are.
    if (pcx !== tcx && pcy !== tcy) {
      if (this.terrain.solidAtCell(tcx, pcy) && this.terrain.solidAtCell(pcx, tcy)) return false;
    }

    // And nothing solid straight between. Four samples is plenty over a 14wu reach.
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      if (this.terrain.solidAt(p.x + (tx - p.x) * t, p.y + (ty - p.y) * t)) return false;
    }
    return true;
  }

  /* ------------------------------------------------------------------ monsters */

  private stepMonsters(): void {
    const p = this.player;
    const invisible = p.invisibleFrames > 0;

    for (const m of this.monsters) {
      if (!m.alive) continue;
      m.age++;
      if (m.hurtFlash > 0) m.hurtFlash--;
      if (m.attackCd > 0) m.attackCd--;

      const neighbours = this.grid.query(m.x, m.y, T.TILE * 1.5, this.scratch);
      const blockers: Blocker[] = (neighbours as Blocker[]).concat(this.nearbyGenerators(m.x, m.y));

      // --- sorcerers phase in and out. While out, shots pass through them, which also
      // leaves their generator less defended and lets your fire reach what is behind.
      if (m.kind === 'sorcerer') {
        if (--m.phaseCd <= 0) {
          m.visible = !m.visible;
          m.phaseCd = m.visible ? T.SORCERER_VISIBLE_F : T.SORCERER_INVISIBLE_F;
        }
      }

      if (m.rangedCd > 0) m.rangedCd--;

      const distX = p.x - m.x;
      const distY = p.y - m.y;
      const dist = Math.hypot(distX, distY);

      if (invisible) {
        // Player invisibility does not freeze them: they carry on in their last
        // direction, which is why walking through a crowd works and standing in one
        // does not.
        const dx = FACE_DX[m.facing];
        const dy = FACE_DY[m.facing];
        chase(this.terrain, m, m.x + dx * 64, m.y + dy * 64, monsterSpeed(m), blockers);
      } else if (m.kind === 'lobber') {
        // Cowards: they shell you from range and run the moment you close.
        const flee = dist < T.LOBBER_FLEE_BLOCKS * T.TILE;
        chase(this.terrain, m, p.x, p.y, monsterSpeed(m), blockers, flee);
        if (!flee && m.rangedCd <= 0) {
          m.rangedCd = T.LOBBER_COOLDOWN_F;
          this.projectiles.push(
            makeRock(m.x, m.y, p.x, p.y, p.lastVX, p.lastVY, T.ROCK_DMG, m),
          );
        }
      } else {
        chase(this.terrain, m, p.x, p.y, monsterSpeed(m), blockers);
        // --- demons fire along an axis whenever roughly lined up, WITHOUT checking
        // what is in the way. That is exactly what makes training their fire onto a
        // generator possible.
        if (m.kind === 'demon' && m.rangedCd <= 0 && dist < T.DEMON_RANGE_WU) {
          let dx = 0;
          let dy = 0;
          if (Math.abs(distY) < T.DEMON_ALIGN_WU) dx = Math.sign(distX);
          else if (Math.abs(distX) < T.DEMON_ALIGN_WU) dy = Math.sign(distY);
          if (dx !== 0 || dy !== 0) {
            m.rangedCd = T.DEMON_FIRE_COOLDOWN_F;
            this.projectiles.push(
              makeShot(m.x, m.y, dx, dy, 2.2, 3, T.FIREBALL_DMG, false, 'fireball', m),
            );
          }
        }
      }

      const r = m.half + p.half;
      if (Math.abs(m.x - p.x) < r && Math.abs(m.y - p.y) < r) {
        if (m.kind === 'ghost') {
          if (!this.godMode) damagePlayer(p, contactDamage(m), this.events);
          m.alive = false;
          this.engage();
          this.events.emit({
            t: 'monsterKilled',
            kind: m.kind,
            level: m.level,
            x: m.x,
            y: m.y,
            by: 'contact',
          });
        } else if (m.attackCd <= 0) {
          if (!this.godMode) damagePlayer(p, contactDamage(m), this.events);
          m.attackCd = T.MONSTER_ATTACK_PERIOD;
          this.engage();
        }
      }
    }
  }

  /* ------------------------------------------------------------------ Death */

  /**
   * Death: never generated, only placed, and immune to everything but a potion.
   *
   * Shooting it does one point and *cycles the value a potion will pay* — which is why
   * the optimal play is the deeply strange one of shooting it exactly six times before
   * throwing a potion, for 8000 instead of 1000.
   *
   * On contact it drains fast and ignores armour entirely, up to a 200 cap, then
   * vanishes. Breaking contact stops the drain, so outrunning it is a real option for
   * anyone who is not the Warrior.
   */
  private stepDeaths(): void {
    const p = this.player;
    for (const d of this.deaths) {
      if (!d.alive) continue;
      if (d.hurtFlash > 0) d.hurtFlash--;

      const dx = p.x - d.x;
      const dy = p.y - d.y;
      const step = T.DEATH_SPEED;
      // Walks the maze like everything else; it is merely unkillable, not incorporeal.
      const body = { x: d.x, y: d.y, half: d.half };
      const { moveBody } = MOVE;
      moveBody(this.terrain, body, Math.sign(dx) * step, 0);
      moveBody(this.terrain, body, 0, Math.sign(dy) * step);
      d.x = body.x;
      d.y = body.y;

      const r = d.half + p.half;
      if (Math.abs(p.x - d.x) < r && Math.abs(p.y - d.y) < r) {
        const remaining = T.DEATH_TOTAL_DRAIN - d.drained;
        const bite = Math.min(T.DEATH_DRAIN_PER_FRAME, remaining);
        // godMode must not let Death spend its 200 on an invulnerable player and
        // politely vanish — nothing should progress while damage is off.
        if (bite > 0 && !this.godMode) {
          d.drained += bite;
          // ignoreArmor: no class is protected from Death.
          damagePlayer(p, bite, this.events, true);
          this.engage();
        }
        if (d.drained >= T.DEATH_TOTAL_DRAIN) {
          d.alive = false;
          this.events.emit({ t: 'deathVanished', x: d.x, y: d.y });
        }
      }
    }
  }

  /* ------------------------------------------------------------------ Thief */

  /**
   * The Thief: fast, fragile, and the only enemy whose damage is measured in progress
   * rather than health. He takes an upgrade if you have one — and even killing him only
   * returns it as an ordinary potion, so the permanent boost is gone either way.
   */
  private stepThieves(): void {
    const p = this.player;
    for (const t of this.thieves) {
      if (!t.alive) continue;
      if (t.hurtFlash > 0) t.hurtFlash--;
      if (--t.patience <= 0) {
        t.alive = false;
        continue;
      }

      const { moveBody } = MOVE;
      const body = { x: t.x, y: t.y, half: t.half };
      let tx = p.x;
      let ty = p.y;
      if (t.fleeing) {
        const exits = this.terrain.cellsOf(Tile.Exit);
        if (exits.length) {
          const [ex, ey] = exits[0];
          tx = ex * T.TILE + T.TILE / 2;
          ty = ey * T.TILE + T.TILE / 2;
        } else {
          tx = t.x - (p.x - t.x);
          ty = t.y - (p.y - t.y);
        }
      }
      const sx = Math.sign(tx - t.x) * T.THIEF_SPEED;
      const sy = Math.sign(ty - t.y) * T.THIEF_SPEED;
      moveBody(this.terrain, body, sx, 0);
      moveBody(this.terrain, body, 0, sy);
      t.x = body.x;
      t.y = body.y;
      t.facing = facingOf(sx, sy, t.facing);

      // Reached the exit while carrying: gone, and so is your property.
      if (t.fleeing && this.terrain.at(Math.floor(t.x / T.TILE), Math.floor(t.y / T.TILE)) === Tile.Exit) {
        t.alive = false;
        this.events.emit({ t: 'thiefEscaped' });
        continue;
      }

      const r = t.half + p.half;
      if (!t.fleeing && Math.abs(p.x - t.x) < r && Math.abs(p.y - t.y) < r) {
        if (!this.godMode) damagePlayer(p, T.THIEF_DMG, this.events);
        const stolen = chooseTheft({
          upgrades: [...p.upgrades],
          potions: p.potions,
          keys: p.keys,
          score: p.score,
        });
        switch (stolen.kind) {
          case 'upgrade':
            p.upgrades.delete(stolen.upgrade!);
            break;
          case 'potion':
            p.potions--;
            break;
          case 'key':
            p.keys--;
            break;
          case 'score':
            p.score = Math.max(0, p.score - (stolen.amount ?? 0));
            break;
          case 'nothing':
            break;
        }
        t.carrying = stolen;
        t.fleeing = true;
        this.engage();
        this.events.emit({ t: 'thiefStole', what: stolen.kind });
      }
    }
  }

  /** Kill a thief: drop a jewel bag and hand back what he took — downgraded. */
  private killThief(t: Thief): void {
    t.alive = false;
    this.addScore(T.SCORE.thiefShot, 'thief');
    this.items.push(makeItem('treasure', t.x, t.y));
    const p = this.player;
    const c = t.carrying;
    if (c) {
      // An upgrade always comes back as a plain potion. Killing him limits the damage;
      // it does not undo it.
      if (c.kind === 'upgrade' || c.kind === 'potion') {
        if (!p.inventoryFull) p.potions++;
      } else if (c.kind === 'key') {
        if (!p.inventoryFull) p.keys++;
      } else if (c.kind === 'score') {
        p.score += c.amount ?? 0;
      }
    }
    this.events.emit({ t: 'thiefKilled', x: t.x, y: t.y });
  }

  /** Live generators near a point, as movement blockers. */
  private nearbyGenerators(x: number, y: number): Blocker[] {
    const out: Blocker[] = [];
    for (const g of this.generators) {
      if (!g.alive) continue;
      if (Math.abs(g.x - x) > T.TILE * 2 || Math.abs(g.y - y) > T.TILE * 2) continue;
      out.push(g);
    }
    return out;
  }

  /* ------------------------------------------------------------------ generators */

  private stepGenerators(): void {
    const live = this.liveMonsters;
    const diff = this.difficulty;
    const capTotal = Math.round(T.MONSTER_CAP_TOTAL * diff.capScale);
    const capLocal = Math.max(2, Math.round(T.MONSTER_CAP_LOCAL * diff.capScale));

    for (const g of this.generators) {
      if (!g.alive) continue;
      if (g.hurtFlash > 0) g.hurtFlash--;

      const onScreen = this.camera.contains(g.x, g.y, T.GEN_OFFSCREEN_MARGIN);

      // The warm-up is spent the first time the player sees this generator, and only
      // then. Scouting a room should be possible at the easier settings; on Nightmare
      // the warm-up is zero, so a nest seen is a nest already spawning.
      if (onScreen && !g.seen) {
        g.seen = true;
        g.timer = Math.round(diff.warmupSec * T.STEP_HZ);
      }

      if (this.rules.offscreenGenerators && !onScreen) {
        g.charge = 0;
        continue;
      }
      if (live >= capTotal) continue;

      const period = spawnPeriod(g.level, this.depth, diff.periodScale);
      g.timer--;
      // Clamped because a warm-up longer than one spawn period would otherwise drive
      // this negative and make the telegraph glow read as "never".
      g.charge = Math.max(0, Math.min(1, 1 - Math.max(0, g.timer) / period));
      if (g.timer > 0) continue;

      const nearby = this.grid.query(g.x, g.y, T.TILE * 3, this.scratch);
      let localCount = 0;
      for (const n of nearby) if (n.alive) localCount++;
      if (localCount >= capLocal) {
        g.timer = Math.round(period / 2);
        continue;
      }

      const spot = findSpawnTile(
        this.terrain,
        g.cx,
        g.cy,
        T.TILE,
        T.MONSTER_HALF,
        g.spawnOffset,
        nearby as Blocker[],
      );
      g.spawnOffset = (g.spawnOffset + 3) % 8;
      g.timer = period;
      if (!spot) continue;

      this.monsters.push(makeMonster(g.kind, generatorLevel(g), spot.x, spot.y));
      this.events.emit({ t: 'spawned', x: spot.x, y: spot.y });
    }
  }

  /* ------------------------------------------------------------------ terrain */

  private stepTerrain(a: Readonly<ActionState>): void {
    const p = this.player;
    if (this.teleportCd > 0) this.teleportCd--;
    if (p.invisibleFrames > 0) p.invisibleFrames--;
    this.engagementFrames++;

    // --- doors give up on their own. Holding keys doubles the wait, so hoarding them
    // costs you time as well as inventory space.
    const limit = (p.keys > 0 ? T.DOOR_AUTO_OPEN_SEC_WITH_KEYS : T.DOOR_AUTO_OPEN_SEC) * T.STEP_HZ;
    if (this.rules.doorAutoOpen && this.engagementFrames >= limit) {
      if (this.terrain.openAllDoors() > 0) this.events.emit({ t: 'doorsOpened', all: true });
      this.engagementFrames = 0;
    }

    // --- the 180s stand-still trick
    if (
      this.rules.wallsBecomeExits &&
      !this.wallsAreExits &&
      p.stillFrames >= T.WALLS_BECOME_EXITS_SEC * T.STEP_HZ
    ) {
      this.wallsAreExits = true;
      this.terrain.convertWallsToExits();
      this.events.emit({ t: 'wallsBecameExits' });
    }

    const cx = Math.floor(p.x / T.TILE);
    const cy = Math.floor(p.y / T.TILE);
    const tile = this.terrain.at(cx, cy);

    // --- doors: walking into one with a key opens the whole connected group
    for (const [dx, dy] of [
      [FACE_DX[p.facing], FACE_DY[p.facing]],
      [0, 0],
    ] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (p.keys > 0 && this.terrain.isDoorClosed(nx, ny)) {
        const near =
          Math.abs(p.x - (nx * T.TILE + T.TILE / 2)) < T.TILE &&
          Math.abs(p.y - (ny * T.TILE + T.TILE / 2)) < T.TILE;
        if (!near) continue;
        p.keys--;
        this.terrain.openDoorGroup(nx, ny);
        this.engage();
        this.events.emit({ t: 'doorsOpened', all: false });
        break;
      }
    }

    // --- trap tiles open walls elsewhere, usually the route to the exit
    if (tile === Tile.Trap) {
      const key = cy * T.GRID + cx;
      if (!this.trapsTriggered.has(key)) {
        this.trapsTriggered.add(key);
        const obj = this.level.objects.find((o) => o.t === 'trap' && o.x === cx && o.y === cy);
        for (const [ox, oy] of obj?.opens ?? []) this.terrain.set(ox, oy, Tile.Floor);
        this.events.emit({ t: 'trapTriggered', x: p.x, y: p.y });
      }
    }

    // --- teleporters
    if (tile === Tile.Teleport && this.teleportCd === 0) this.teleport(cx, cy, a);
  }

  /**
   * Teleport to another pad.
   *
   * With several candidates the original picks by wall-clock seconds modulo the count —
   * a genuinely odd quirk that players learned to read off their own draining health.
   * We use simulation time instead, so it stays deterministic and replayable.
   */
  private teleport(cx: number, cy: number, a: Readonly<ActionState>): void {
    const pads = this.terrain
      .cellsOf(Tile.Teleport)
      .filter(([x, y]) => !(x === cx && y === cy));
    if (!pads.length) return;

    const pick = pads[Math.floor(this.elapsed) % pads.length];
    const [tx, ty] = pick;

    // You steer which of the eight surrounding tiles you land on.
    const p = this.player;
    const dirs: [number, number][] =
      a.moveX !== 0 || a.moveY !== 0
        ? [[Math.sign(a.moveX), Math.sign(a.moveY)]]
        : [[0, 0]];
    for (const [ox, oy] of [...dirs, [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as [
      number,
      number,
    ][]) {
      const nx = tx + ox;
      const ny = ty + oy;
      const [wx, wy] = cellCentre(nx, ny);
      if (this.terrain.solidAtCell(nx, ny) || boxHitsSolid(this.terrain, wx, wy, p.half)) continue;
      p.x = wx;
      p.y = wy;
      this.teleportCd = T.TELEPORT_COOLDOWN_F;
      this.camera.follow(p.x, p.y);
      this.events.emit({ t: 'teleported', x: wx, y: wy });
      return;
    }
  }

  /* ------------------------------------------------------------------ items */

  /** Items you cannot pick up are solid — a full inventory barricades you. */
  private resolveItemBlocking(): void {
    const p = this.player;
    if (!this.rules.inventoryBlocks || !p.inventoryFull) return;
    for (const it of this.items) {
      if (!it.alive || !usesInventorySlot(it.kind)) continue;
      const r = it.half + p.half;
      const dx = p.x - it.x;
      const dy = p.y - it.y;
      if (Math.abs(dx) >= r || Math.abs(dy) >= r) continue;
      // push out along the shallower axis
      if (Math.abs(dx) > Math.abs(dy)) p.x = it.x + Math.sign(dx || 1) * r;
      else p.y = it.y + Math.sign(dy || 1) * r;
    }
  }

  /**
   * Generators are solid. They are blocks and bone piles, not decals — you cannot walk
   * through one, and neither can a monster. Without this a player could stand inside a
   * generator, which trivialises point-blank work and makes lobber rocks unable to land
   * on one while you are next to it.
   */
  private resolveGeneratorBlocking(): void {
    const p = this.player;
    for (const g of this.generators) {
      if (!g.alive) continue;
      const r = g.half + p.half;
      const dx = p.x - g.x;
      const dy = p.y - g.y;
      if (Math.abs(dx) >= r || Math.abs(dy) >= r) continue;
      const pushX = r - Math.abs(dx);
      const pushY = r - Math.abs(dy);
      if (pushX < pushY) p.x = g.x + Math.sign(dx || 1) * r;
      else p.y = g.y + Math.sign(dy || 1) * r;
    }
  }

  private pickups(): void {
    const p = this.player;
    const inv = {
      keys: p.keys,
      potions: p.potions,
      full: p.inventoryFull,
      hasUpgrade: (u: UpgradeId) => p.upgrades.has(u),
    };

    for (const it of this.items) {
      if (!it.alive) continue;
      const r = it.half + p.half;
      if (Math.abs(it.x - p.x) >= r || Math.abs(it.y - p.y) >= r) continue;

      const out = resolvePickup(it, inv);
      switch (out.kind) {
        case 'blocked':
        case 'none':
          continue;
        case 'food':
          // Capped. Overhealing is silently discarded rather than refused, so food never
          // becomes an obstacle you have to walk around at full health.
          p.health = Math.min(this.maxHealth, p.health + out.health);
          this.addScore(out.score, 'food');
          break;
        case 'key':
          p.keys++;
          inv.keys++;
          this.addScore(out.score, 'key');
          break;
        case 'potion':
          p.potions++;
          inv.potions++;
          break;
        case 'treasure':
          // In a treasure room the value is escrowed until you carry it out; anywhere
          // else treasure banks on the spot as usual.
          if (this.isTreasureRoom) this.treasureHeld += out.score;
          else this.addScore(out.score, 'treasure');
          this.treasureTaken++;
          break;
        case 'upgrade':
          p.upgrades.add(out.upgrade);
          this.events.emit({ t: 'upgradeTaken', upgrade: out.upgrade });
          break;
        case 'upgradeDuplicate':
          p.potions++;
          inv.potions++;
          break;
      }
      inv.full = inv.keys + inv.potions >= T.INVENTORY_SLOTS;
      it.alive = false;
      this.engage();
      this.events.emit({ t: 'pickup', kind: it.kind, x: it.x, y: it.y });
    }
  }

  private checkExit(): void {
    const p = this.player;
    const cx = Math.floor(p.x / T.TILE);
    const cy = Math.floor(p.y / T.TILE);
    if (this.terrain.at(cx, cy) !== Tile.Exit) return;

    // An exit may name a destination — that is how the intro levels let you choose
    // how deep to start, which is the arcade's level-select in disguise.
    const named = this.level.objects.find(
      (o) => o.t === 'exit' && o.x === cx && o.y === cy && typeof o.skipTo === 'number',
    );
    this.exitSkipTo = (named?.skipTo as number | undefined) ?? null;

    if (this.isTreasureRoom) this.bankTreasureRoom();
    this.beginExit(cellCentre(cx, cy));
  }

  /**
   * Start the exit sequence.
   *
   * The player is pulled to the exit's centre over the first half of it, so the sprite
   * always ends up dead centre in the portal no matter where on the tile you touched it.
   */
  private beginExit(at: readonly [number, number]): void {
    if (this.exitFrames >= 0 || this.exitReached) return;
    this.exitFrames = 0;
    this.exitAt = at;
    this.events.emit({ t: 'exitReached' });
  }

  /** 0 at the moment of touching the exit, 1 when the next level loads. */
  get exitProgress(): number {
    if (this.exitFrames < 0) return 0;
    return Math.min(1, this.exitFrames / T.EXIT_SEQUENCE_F);
  }

  private stepExitSequence(): void {
    this.exitFrames++;

    // Glide to the centre over the first 40% and hold there for the rest.
    if (this.exitAt) {
      const k = Math.min(1, this.exitProgress / 0.4);
      const p = this.player;
      p.x += (this.exitAt[0] - p.x) * k * 0.25;
      p.y += (this.exitAt[1] - p.y) * k * 0.25;
    }

    this.camera.follow(this.player.x, this.player.y);

    if (this.exitFrames >= T.EXIT_SEQUENCE_F) this.exitReached = true;
  }

  /**
   * Carrying the haul out is what banks it.
   *
   * In a treasure room the pickups do NOT score as you take them: their value is held in
   * `treasureHeld` and paid, with the per-piece bonus on top, only if you reach the exit.
   * Beat the clock and you keep everything; let it run out and you leave with nothing.
   *
   * This is the whole point of the room and it was missing. Paying out on expiry too made
   * the exit decorative: there was no reason to stop hoovering, because greed cost
   * nothing. The tension only exists if the last piece you reach for can be the one that
   * loses you the lot.
   */
  private bankTreasureRoom(): void {
    const bonus = this.treasureTaken * T.SCORE.treasureRoomPerTreasure;
    const total = this.treasureHeld + bonus;
    if (total > 0) this.addScore(total, 'treasure room');
    this.treasureHeld = 0;
  }

  /** The clock running out ends the room — and forfeits everything gathered in it. */
  private stepTreasureTimer(): void {
    if (this.treasureTimer < 0) return;
    if (--this.treasureTimer > 0) return;
    this.treasureTimer = 0;

    const lost = this.treasureHeld + this.treasureTaken * T.SCORE.treasureRoomPerTreasure;
    this.treasureHeld = 0;
    this.treasureLost = this.treasureTaken;
    this.treasureTaken = 0;
    if (lost > 0) this.events.emit({ t: 'treasureForfeited', pieces: this.treasureLost, score: lost });

    // Still the full send-off rather than a cut: being out of time is not the same as
    // being cheated, and the player needs to see what happened.
    this.beginExit([this.player.x, this.player.y]);
  }

  /* ------------------------------------------------------------------ upkeep */

  private compact(): void {
    if (this.projectiles.length) {
      this.projectiles = this.projectiles.filter((pr) => pr.alive);
      let alive = false;
      for (const pr of this.projectiles) if (pr.fromPlayer) alive = true;
      this.player.shotAlive = alive;
    }
    if ((this.frame & 31) === 0 && this.monsters.length > 64) {
      this.monsters = this.monsters.filter((m) => m.alive);
    }
  }

  get elapsed(): number {
    return this.frame / T.STEP_HZ;
  }
}
