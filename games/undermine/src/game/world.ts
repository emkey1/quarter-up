import { T } from '@/data/tuning';
import { Field } from './field';
import { Digger, Dir, type MoveIntent } from './digger';
import { makeRock, stepRock, RockState, type Crushable, type Rock } from './rock';
import { FlowField } from './flow';
import {
  makeEnemy,
  stepEnemy,
  flameHits,
  EnemyState,
  enemyCellX,
  enemyCellY,
  type Enemy,
} from './enemy';
import { pump, crushScore } from './pump';
import type { Layout } from './layout';
import { speedScale } from '@/data/layouts';

/** What happened this tick, for the presentation layer to make noise about. */
export interface WorldEvents {
  dug: boolean;
  pumped: boolean;
  burst: boolean;
  /** Points earned this tick, and where, so the HUD can float a number there. */
  scored: { points: number; x: number; y: number } | null;
  rockStartedFalling: boolean;
  rockLanded: boolean;
  playerCrushed: boolean;
  enemyStartedGhosting: boolean;
  enemySolidified: boolean;
  flameLit: boolean;
  playerCaught: boolean;
  playerBurned: boolean;
  bonusAppeared: boolean;
  bonusTaken: boolean;
  lastEnemyFleeing: boolean;
  enemyEscaped: boolean;
  died: boolean;
  respawned: boolean;
  roundClear: boolean;
  gameOver: boolean;
  /** Set by Run when it swaps in the next level's World. */
  levelStarted: boolean;
}

function emptyEvents(): WorldEvents {
  return {
    dug: false,
    pumped: false,
    burst: false,
    scored: null,
    rockStartedFalling: false,
    rockLanded: false,
    playerCrushed: false,
    enemyStartedGhosting: false,
    enemySolidified: false,
    flameLit: false,
    playerCaught: false,
    playerBurned: false,
    bonusAppeared: false,
    bonusTaken: false,
    lastEnemyFleeing: false,
    enemyEscaped: false,
    died: false,
    respawned: false,
    roundClear: false,
    gameOver: false,
    levelStarted: false,
  };
}

/**
 * The simulation.
 *
 * Same contract as the other two cabinets: `step()` advances exactly one fixed tick and
 * never draws; nothing in here may reference a screen pixel; no `Math.random` or `Date`,
 * so a run replays from its seed.
 *
 * M0 was the field and the digger. M1 adds rocks and the first way to die. Enemies (M2)
 * and the pump (M3) attach here next.
 */
export class World {
  readonly field = new Field();
  readonly digger: Digger;
  readonly rocks: Rock[] = [];
  readonly enemies: Enemy[] = [];
  /** Cells the dragons' flames occupy right now, for drawing. */
  flame: { x: number; y: number }[] = [];

  /**
   * Route field to the player, rebuilt when the player changes cell OR the field does.
   *
   * Both triggers matter and the second is the one Bracer never needed: there, terrain
   * changed a handful of times a level. Here the player reshapes the map continuously,
   * and a route computed against earth that has since been cut away sends every enemy
   * the long way round a wall that is no longer there.
   */
  private readonly flow = new FlowField();
  private flowCx = -1;
  private flowCy = -1;
  private flowVersion = -1;

  frame = 0;
  score = 0;
  readonly level: number;
  readonly layout: Layout;
  /** Enemy speed multiplier for this level. */
  readonly speed: number;
  /** Rocks that have finished falling, which is what the bonus is gated on. */
  rocksDropped = 0;
  /** The bonus item, once it has appeared. */
  bonus: { x: number; y: number; life: number; value: number } | null = null;
  private bonusSpawned = false;
  /** True once only one enemy is left and it has given up hunting. */
  fleeing = false;
  lives: number = T.STARTING_LIVES;
  /**
   * Frames left on the death or clear pause, or 0 when play is live.
   *
   * A single timer for both, because they are the same thing structurally: the
   * simulation stops, something is shown, and then the round moves on. Two timers would
   * be two ways to get the same bug.
   */
  hold = 0;
  over = false;
  /** Cleared by death, and the reason `step` stops advancing the digger. */
  playerAlive = true;

  /** The player as something a rock can land on. Enemies are in this list too. */
  private readonly crushable: Crushable;
  private readonly startX: number;
  private readonly startY: number;
  /** A round that never had anything in it was never a round, and must not report
   *  itself clear on frame one. */
  private readonly startedWithEnemies: boolean;

  constructor(layout: Layout, level = 1) {
    this.layout = layout;
    this.level = level;
    this.speed = speedScale(level);
    // Cut the layout's pre-dug network into the field.
    for (let cy = 0; cy < T.GRID_H; cy++) {
      for (let cx = 0; cx < T.GRID_W; cx++) {
        if (layout.rows[cy][cx] === '.') this.field.dig(cx, cy);
      }
    }

    const [startX, startY] = layout.start;
    this.startX = startX;
    this.startY = startY;
    this.digger = new Digger(startX, startY);

    this.crushable = { x: this.digger.x, y: this.digger.y, alive: true };

    for (const [cx, cy] of layout.rocks) this.rocks.push(makeRock(cx, cy));
    for (const e of layout.enemies) this.enemies.push(makeEnemy(e.kind, e.x, e.y));
    this.startedWithEnemies = this.enemies.length > 0;
  }

  step(intent: MoveIntent): WorldEvents {
    this.frame++;

    /*
     * Once the run is over, nothing happens.
     *
     * Without this the death branch below re-arms every frame: the player is still not
     * alive, so it sets the hold again, the hold expires, another life comes off, and
     * `lives` walks off into negative numbers forever. Found by rendering a preview of a
     * long scripted run and reading `lives=-4` off it, which is precisely the sort of
     * thing no unit test was ever going to ask about.
     */
    if (this.over) return emptyEvents();

    if (this.hold > 0) {
      const events = emptyEvents();
      if (--this.hold === 0) this.afterHold(events);
      return events;
    }
    const events = emptyEvents();

    if (this.playerAlive) {
      this.digger.step(this.field, intent);
      events.dug = this.digger.digging;

      if (intent.pump) {
        const r = pump(
          this.field,
          this.enemies,
          this.digger.x,
          this.digger.y,
          this.digger.facing,
          this.digger.y,
        );
        events.pumped = r.target !== null;
        if (r.burst && r.target) {
          events.burst = true;
          this.score += r.score;
          events.scored = { points: r.score, x: r.target.x, y: r.target.y };
        }
      }
    }

    // The crushable view of the player is refreshed from the digger each tick rather
    // than the digger implementing the interface itself. The digger has no business
    // knowing that rocks exist.
    this.crushable.x = this.digger.x;
    this.crushable.y = this.digger.y;
    this.crushable.alive = this.playerAlive;

    // Enemies are crushable too: luring one under a rock is the high-scoring kill, and
    // it only works if a rock treats them exactly as it treats the player.
    const targets: Crushable[] = [this.crushable, ...this.enemies];
    for (const r of this.rocks) {
      if (r.state === RockState.Gone) continue;
      const e = stepRock(this.field, r, targets);
      events.rockStartedFalling ||= e.startedFalling;
      events.rockLanded ||= e.landed;
      if (e.landed) this.rocksDropped++;
      let crushedEnemies = 0;
      for (const victim of e.crushed) {
        if (victim === this.crushable) events.playerCrushed = true;
        else crushedEnemies++;
      }
      // Scored per FALL rather than per victim, which is the whole point of the curve:
      // four separate rocks pay 4,000 and one rock catching four pays 6,000.
      if (crushedEnemies > 0) {
        const points = crushScore(crushedEnemies);
        this.score += points;
        events.scored = { points, x: r.x, y: r.y };
      }
    }
    for (const en of this.enemies) {
      if (!en.alive) en.state = EnemyState.Dead;
    }

    this.stepEnemies(events);

    this.stepBonus(events);
    this.stepEscape(events);

    if (!this.crushable.alive) this.playerAlive = false;
    if (events.playerCaught || events.playerBurned) this.playerAlive = false;

    if (!this.playerAlive && this.hold === 0) {
      events.died = true;
      this.hold = T.DEATH_HOLD_F;
    } else if (this.startedWithEnemies && this.enemiesLeft === 0 && this.hold === 0) {
      events.roundClear = true;
      this.hold = T.CLEAR_HOLD_F;
    }

    return events;
  }

  /**
   * The bonus.
   *
   * Gated on rocks DROPPED, not on time and not on kills. That rule is the game openly
   * paying you to play the elaborate, dangerous way: rocks are the only multi-kill and
   * dropping one means standing under it long enough to undermine it.
   */
  private stepBonus(events: WorldEvents): void {
    if (this.bonus) {
      if (
        this.playerAlive &&
        Math.abs(this.digger.x - this.bonus.x) < T.CELL * 0.7 &&
        Math.abs(this.digger.y - this.bonus.y) < T.CELL * 0.7
      ) {
        this.score += this.bonus.value;
        events.scored = { points: this.bonus.value, x: this.bonus.x, y: this.bonus.y };
        events.bonusTaken = true;
        this.bonus = null;
        return;
      }
      if (--this.bonus.life <= 0) this.bonus = null;
      return;
    }

    if (this.bonusSpawned || this.rocksDropped < T.BONUS_AFTER_ROCKS) return;
    this.bonusSpawned = true;

    // The centre of the field, and it is dug out so the bonus is always reachable — an
    // item that appears inside solid earth is an item that taunts you.
    const cx = Math.floor(T.GRID_W / 2);
    const cy = Math.floor(T.GRID_H / 2);
    this.field.dig(cx, cy);
    this.bonus = {
      x: cx * T.CELL + T.CELL / 2,
      y: cy * T.CELL + T.CELL / 2,
      life: T.BONUS_LIFETIME_F,
      value: Math.min(T.BONUS_MAX, T.BONUS_BASE + (this.level - 1) * T.BONUS_PER_LEVEL),
    };
    events.bonusAppeared = true;
  }

  /**
   * The last one out.
   *
   * When a single enemy is left it stops hunting and runs for the top-left corner, and
   * the round ends when it leaves rather than when it dies. That inverts the ending: the
   * level is not over when you have killed everything, it is over when the survivor
   * gets away — and chasing it down is optional points and a real risk.
   */
  private stepEscape(events: WorldEvents): void {
    const alive = this.enemies.filter((e) => e.alive && e.state !== EnemyState.Dead);
    if (alive.length !== 1) return;

    const last = alive[0];
    if (!this.fleeing) {
      this.fleeing = true;
      last.escaping = true;
      events.lastEnemyFleeing = true;
    }
    if (last.inflation > 0) return; // pinned on the pump: not going anywhere

    // Straight for the surface at the top-left, through earth if it must — it has given
    // up on the tunnel network along with everything else.
    const tx = T.CELL / 2;
    const ty = T.CELL / 2;
    const dx = tx - last.x;
    const dy = ty - last.y;
    const len = Math.hypot(dx, dy) || 1;
    last.x += (dx / len) * T.ESCAPE_SPEED;
    last.y += (dy / len) * T.ESCAPE_SPEED;
    last.state = EnemyState.Ghosting;

    if (len < T.CELL) {
      last.alive = false;
      last.state = EnemyState.Dead;
      events.enemyEscaped = true;
    }
  }

  /** What happens when a death or clear pause runs out. */
  private afterHold(events: WorldEvents): void {
    if (!this.playerAlive) {
      this.lives--;
      if (this.lives <= 0) {
        this.over = true;
        events.gameOver = true;
        return;
      }
      // Respawn where the round began. The field keeps whatever was already cut, which
      // is the fair reading: the tunnels are the player's work and losing a life should
      // not confiscate it.
      this.playerAlive = true;
      this.crushable.alive = true;
      this.digger.x = this.startX * T.CELL + T.CELL / 2;
      this.digger.y = this.startY * T.CELL + T.CELL / 2;
      events.respawned = true;
    }
  }

  private stepEnemies(events: WorldEvents): void {
    const pcx = this.digger.cellX;
    const pcy = this.digger.cellY;
    if (pcx !== this.flowCx || pcy !== this.flowCy || this.field.version !== this.flowVersion) {
      this.flow.recompute(this.field, pcx, pcy);
      this.flowCx = pcx;
      this.flowCy = pcy;
      this.flowVersion = this.field.version;
    }

    const target = { x: this.digger.x, y: this.digger.y, alive: this.playerAlive };
    this.flame = [];

    for (const en of this.enemies) {
      if (!en.alive || en.state === EnemyState.Dead) continue;
      const e = stepEnemy(this.field, this.flow, en, target, this.speed);
      events.enemyStartedGhosting ||= e.startedGhosting;
      events.enemySolidified ||= e.solidified;
      events.flameLit ||= e.flameLit;
      if (e.touchedPlayer) events.playerCaught = true;
      if (e.flame.length) this.flame.push(...e.flame);
    }

    if (this.playerAlive && flameHits(this.flame, this.digger.x, this.digger.y)) {
      events.playerBurned = true;
    }
  }

  /** Enemies still in play. A round ends when this reaches zero, whether the last one
   *  was killed or simply left. */
  get enemiesLeft(): number {
    return this.enemies.filter((e) => e.alive && e.state !== EnemyState.Dead).length;
  }

  /** The round is cleared AND its card has been shown. Run waits for this rather than
   *  for `enemiesLeft`, or the next level starts over the top of the clear. */
  get roundFinished(): boolean {
    return this.startedWithEnemies && this.enemiesLeft === 0 && this.hold === 0 && !this.over;
  }
}

export { Dir, RockState, EnemyState, enemyCellX, enemyCellY };
export type { MoveIntent, Rock, Enemy };
