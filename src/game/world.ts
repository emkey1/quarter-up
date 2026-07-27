import { T } from '@/data/tuning';
import type { ClassId } from '@/data/classes';
import type { ActionState } from '@/engine/actions';
import type { FireModel } from '@/engine/input';
import { Rng } from '@/engine/rng';
import { SpatialGrid } from '@/engine/spatial';
import { chase, findSpawnTile, type Blocker } from './ai';
import { Camera } from './camera';
import { damageGenerator, damageMonster, damagePlayer } from './combat';
import { EventBus } from './events';
import { generatorLevel, makeGenerator, spawnPeriod, type Generator } from './generator';
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
import { FACE_DX, FACE_DY, Player } from './player';
import {
  makeShot,
  moveProjectile,
  projectileCanReach,
  projectileHits,
  type Projectile,
} from './projectile';
import { roll } from './stats';
import type { Terrain } from './terrain';

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

  frame = 0;
  depth = 1;
  fireModel: FireModel = 'feathered';
  /** Dev switch: skip all incoming damage, for isolating other systems. */
  godMode = false;

  private grid = new SpatialGrid<Monster>();
  private scratch: Monster[] = [];

  constructor(level: LevelData, classId: ClassId, seed: number) {
    this.level = level;
    this.terrain = buildTerrain(level);
    this.rng = new Rng(seed);
    this.player = new Player(classId);
    const [sx, sy] = cellCentre(level.start[0], level.start[1]);
    this.player.x = sx;
    this.player.y = sy;
    this.camera.follow(this.player.x, this.player.y);
    this.spawnFromLevel();
  }

  private spawnFromLevel(): void {
    for (const o of this.level.objects) {
      if (o.t === 'gen') {
        this.generators.push(
          makeGenerator((o.kind ?? 'grunt') as MonsterKind, o.lvl ?? 1, o.x, o.y),
        );
      } else if (o.t === 'mon') {
        const [x, y] = cellCentre(o.x, o.y);
        this.monsters.push(
          makeMonster((o.kind ?? 'grunt') as MonsterKind, (o.lvl ?? 1) as MonsterLevel, x, y),
        );
      }
    }
  }

  get liveMonsters(): number {
    let n = 0;
    for (const m of this.monsters) if (m.alive) n++;
    return n;
  }

  /**
   * One fixed step. The order is documented because it is observable:
   *   1 player intent  2 movement  3 fire/melee  4 projectiles  5 monsters
   *   6 generators     7 terrain timers          8 pickups      9 damage
   *  10 health drain  11 score/rank/exit        12 fx
   *
   * M1 implements 1-6, 9, 10. Items, doors and the rest arrive in M2-M3.
   */
  step(a: Readonly<ActionState>): void {
    if (this.player.dead) {
      this.frame++;
      return;
    }

    this.player.step(this.terrain, a, this.fireModel);
    this.grid.rebuild(this.monsters, (m) => m.alive);

    this.fire(a);
    this.melee(a);
    this.stepProjectiles();
    this.stepMonsters();
    this.stepGenerators();

    this.camera.follow(this.player.x, this.player.y);
    this.compact();
    this.frame++;
  }

  /** Guards against a blocked shot damaging something through the corner that stopped
   *  it — see projectileCanReach. */
  private reachable(pr: Projectile, tx: number, ty: number): boolean {
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
      detonate(p, 'used', this.monsters, this.generators, this.camera, this.events, this.addScore);
    }

    if (!a.fire || p.shotAlive) return;

    // One shot on screen at a time — the rate limit that makes a missed shot cost you
    // real time, and the reason inching toward a generator is the core skill.
    const st = p.stats;
    const dir =
      this.fireModel === 'twinstick' && (a.aimX !== 0 || a.aimY !== 0)
        ? { x: a.aimX, y: a.aimY }
        : { x: FACE_DX[p.facing], y: FACE_DY[p.facing] };

    const half = T.SHOT_HALF[p.cls.shotBox];
    const shot = makeShot(
      p.x,
      p.y,
      dir.x,
      dir.y,
      st.shotSpeed * T.SHOT_SPEED_UNIT,
      half,
      roll(st.shotStrength, this.rng),
      true,
    );
    this.projectiles.push(shot);
    p.shotAlive = true;
    this.events.emit({ t: 'shotFired' });
  }

  private stepProjectiles(): void {
    for (const pr of this.projectiles) {
      if (!pr.alive) continue;
      const res = moveProjectile(this.terrain, pr);

      if (pr.fromPlayer) {
        for (const m of this.monsters) {
          if (!m.alive) continue;
          if (!projectileHits(pr, m.x, m.y, m.half)) continue;
          if (!this.reachable(pr, m.x, m.y)) continue;
          damageMonster(m, pr.damage, 'shot', this.events, this.addScore);
          pr.alive = false;
          break;
        }
        if (pr.alive) {
          for (const g of this.generators) {
            if (!g.alive) continue;
            if (!projectileHits(pr, g.x, g.y, T.TILE / 2)) continue;
            if (!this.reachable(pr, g.x, g.y)) continue;
            damageGenerator(g, pr.damage, this.events, this.addScore);
            pr.alive = false;
            break;
          }
        }
      } else if (projectileHits(pr, this.player.x, this.player.y, this.player.half)) {
        if (!this.godMode) damagePlayer(this.player, pr.damage, this.events);
        pr.alive = false;
      }

      if (pr.alive && res.hitWall) {
        pr.alive = false;
        this.events.emit({ t: 'shotHitWall', x: res.x, y: res.y });
      }
    }
  }

  /* ------------------------------------------------------------------ melee */

  /**
   * Melee is not a button: walking into a monster attacks it. Wider arc than a shot,
   * which is why it is the escape tool when surrounded — but it cannot touch ghosts,
   * because they destroy themselves on contact before a swing lands.
   */
  private melee(a: Readonly<ActionState>): void {
    const p = this.player;
    if (p.meleeCd > 0) return;

    // Melee is triggered by *walking into* something, not by standing next to it.
    // Without this gate a stationary player silently kills anything that wanders
    // adjacent — which trivialises the game and, in testing, quietly ate every
    // monster a generator produced.
    if (a.moveX === 0 && a.moveY === 0) return;
    if (p.rooted) return; // firing roots you; you cannot also be shouldering forward

    const fx = FACE_DX[p.facing];
    const fy = FACE_DY[p.facing];
    const reach = T.MELEE_BOX[0] / 2;
    const cx = p.x + fx * reach * 0.6;
    const cy = p.y + fy * reach * 0.6;

    let hit = false;
    for (const m of this.monsters) {
      if (!m.alive || m.kind === 'ghost') continue;
      const r = reach + m.half;
      if (Math.abs(m.x - cx) > r || Math.abs(m.y - cy) > r) continue;
      damageMonster(m, roll(p.stats.meleeVsMonsters, this.rng), 'melee', this.events, this.addScore);
      hit = true;
      break;
    }

    if (!hit) {
      // Generators take a flat 1, with a per-class miss chance — Wizard and Elf
      // essentially cannot punch a generator down at all.
      for (const g of this.generators) {
        if (!g.alive) continue;
        const r = reach + T.TILE / 2;
        if (Math.abs(g.x - cx) > r || Math.abs(g.y - cy) > r) continue;
        if (this.rng.chance(p.stats.meleeGenMissChance)) break;
        damageGenerator(g, 1, this.events, this.addScore);
        hit = true;
        break;
      }
    }

    if (hit) {
      p.meleeCd = T.MELEE_PERIOD;
      this.events.emit({ t: 'melee', hit: true });
    }
  }

  /* ------------------------------------------------------------------ monsters */

  private stepMonsters(): void {
    const p = this.player;
    for (const m of this.monsters) {
      if (!m.alive) continue;
      m.age++;
      if (m.hurtFlash > 0) m.hurtFlash--;
      if (m.attackCd > 0) m.attackCd--;

      const neighbours = this.grid.query(m.x, m.y, T.TILE * 1.5, this.scratch);
      chase(this.terrain, m, p.x, p.y, monsterSpeed(m), neighbours as Blocker[]);

      // contact
      const r = m.half + p.half;
      if (Math.abs(m.x - p.x) < r && Math.abs(m.y - p.y) < r) {
        if (m.kind === 'ghost') {
          // Kamikaze: destroys itself, which is exactly what makes a ghost stream so
          // punishing — the next one is on you immediately, with no attack animation.
          if (!this.godMode) damagePlayer(p, contactDamage(m), this.events);
          m.alive = false;
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
        }
      }
    }
  }

  /* ------------------------------------------------------------------ generators */

  private stepGenerators(): void {
    const live = this.liveMonsters;
    for (const g of this.generators) {
      if (!g.alive) continue;
      if (g.hurtFlash > 0) g.hurtFlash--;

      // Off-screen generators are inert. This is the mechanic the whole "snipe it from
      // outside the viewport" tactic rests on, so the margin stays tight.
      if (!this.camera.contains(g.x, g.y, T.GEN_OFFSCREEN_MARGIN)) {
        g.charge = 0;
        continue;
      }
      if (live >= T.MONSTER_CAP_TOTAL) continue;

      const period = spawnPeriod(g.level, this.depth);
      g.timer--;
      g.charge = 1 - Math.max(0, g.timer) / period;
      if (g.timer > 0) continue;

      const nearby = this.grid.query(g.x, g.y, T.TILE * 3, this.scratch);
      let localCount = 0;
      for (const n of nearby) if (n.alive) localCount++;
      if (localCount >= T.MONSTER_CAP_LOCAL) {
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

  /* ------------------------------------------------------------------ upkeep */

  private compact(): void {
    if (this.projectiles.length) {
      let alive = false;
      this.projectiles = this.projectiles.filter((p) => p.alive);
      for (const p of this.projectiles) if (p.fromPlayer) alive = true;
      this.player.shotAlive = alive;
    }
    // Monsters are compacted less often; the array churn is not worth it every frame.
    if ((this.frame & 31) === 0 && this.monsters.length > 64) {
      this.monsters = this.monsters.filter((m) => m.alive);
    }
  }

  /** Seconds elapsed in simulation time — never wall-clock, so replays match. */
  get elapsed(): number {
    return this.frame / T.STEP_HZ;
  }
}
