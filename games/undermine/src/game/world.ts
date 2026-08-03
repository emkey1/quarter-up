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
  died: boolean;
  respawned: boolean;
  roundClear: boolean;
  gameOver: boolean;
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
    died: false,
    respawned: false,
    roundClear: false,
    gameOver: false,
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

  constructor() {
    // Start in the middle of the top earth band, in a short pre-cut tunnel — the
    // original opens the same way, and a digger that begins entombed cannot demonstrate
    // that moving through tunnel is faster than cutting.
    const startX = Math.floor(T.GRID_W / 2);
    const startY = T.SKY_ROWS + 1;
    this.startX = startX;
    this.startY = startY;
    this.digger = new Digger(startX, startY);

    for (let cx = startX - 1; cx <= startX + 1; cx++) this.field.dig(cx, startY);
    this.field.dig(startX, startY - 1); // a way up to the sky

    this.crushable = { x: this.digger.x, y: this.digger.y, alive: true };

    // A placeholder scatter until layouts arrive at M5. Deliberately not under the start
    // tunnel: the first thing a new player does is move, and being killed by geometry
    // they never touched teaches nothing.
    for (const [cx, cy] of [
      [2, 6],
      [11, 6],
      [4, 11],
      [9, 14],
    ] as const) {
      this.rocks.push(makeRock(cx, cy));
    }

    // A placeholder cast until layouts arrive at M5. Each starts in its own small pocket
    // — an enemy entombed in solid earth with no tunnel at all would ghost immediately
    // and permanently, which is the mechanic working correctly and reads as broken.
    for (const [kind, cx, cy] of [
      ['grub', 3, 7],
      ['grub', 10, 9],
      ['emberjaw', 6, 13],
      ['grub', 11, 15],
    ] as const) {
      this.field.dig(cx, cy);
      this.enemies.push(makeEnemy(kind, cx, cy));
    }
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
      const e = stepEnemy(this.field, this.flow, en, target);
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

  /** Enemies still in play. The level ends when this reaches zero — or, from M5, when
   *  the last one escapes instead. */
  get enemiesLeft(): number {
    return this.enemies.filter((e) => e.alive && e.state !== EnemyState.Dead).length;
  }
}

export { Dir, RockState, EnemyState, enemyCellX, enemyCellY };
export type { MoveIntent, Rock, Enemy };
