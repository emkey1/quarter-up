import { T } from '@/data/tuning';
import type { ClassId, UpgradeId } from '@/data/classes';
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
import { FACE_DX, FACE_DY, Player } from './player';
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

  frame = 0;
  depth = 1;
  fireModel: FireModel = 'feathered';
  godMode = false;

  /** Set when the player steps on an exit; the Run picks it up and advances. */
  exitReached = false;

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

  constructor(level: LevelData, classId: ClassId, seed: number, carry?: RunState) {
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
    cullFood(this.items, level.id, this.player.score);
  }

  /* ------------------------------------------------------------------ run state */

  importState(s: RunState): void {
    const p = this.player;
    p.health = s.health;
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
        case 'gen':
          this.generators.push(
            makeGenerator((o.kind ?? 'grunt') as MonsterKind, o.lvl ?? 1, o.x, o.y),
          );
          break;
        case 'mon':
          this.monsters.push(
            makeMonster((o.kind ?? 'grunt') as MonsterKind, (o.lvl ?? 1) as MonsterLevel, wx, wy),
          );
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

    this.player.step(this.terrain, a, this.fireModel);
    this.resolveItemBlocking();
    this.grid.rebuild(this.monsters, (m) => m.alive);

    this.fire(a);
    this.melee(a);
    this.stepProjectiles();
    this.stepMonsters();
    this.stepGenerators();
    this.stepTerrain(a);
    this.pickups();
    this.checkExit();

    this.camera.follow(this.player.x, this.player.y);
    this.compact();
    this.frame++;
  }

  private engage(): void {
    this.engagementFrames = 0;
  }

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
      this.engage();
      detonate(p, 'used', this.monsters, this.generators, this.camera, this.events, this.addScore);
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
        if (this.shotHitMonster(pr)) continue;
        if (this.shotHitGenerator(pr)) continue;
        if (this.shotHitItem(pr)) continue;
      } else if (projectileHits(pr, this.player.x, this.player.y, this.player.half)) {
        if (!this.godMode) damagePlayer(this.player, pr.damage, this.events);
        pr.alive = false;
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
    }
  }

  private shotHitMonster(pr: Projectile): boolean {
    for (const m of this.monsters) {
      if (!m.alive || !projectileHits(pr, m.x, m.y, m.half)) continue;
      if (!this.reachable(pr, m.x, m.y)) continue;
      damageMonster(m, pr.damage, 'shot', this.events, this.addScore);
      pr.alive = false;
      this.engage();
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
      this.engage();
      this.events.emit({ t: 'melee', hit: true });
    }
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
      const blockers: Blocker[] = neighbours as Blocker[];

      if (invisible) {
        // Invisibility does not freeze them: they carry on in their last direction,
        // which is why walking through a crowd still works and standing in one does not.
        const dx = FACE_DX[m.facing];
        const dy = FACE_DY[m.facing];
        chase(this.terrain, m, m.x + dx * 64, m.y + dy * 64, monsterSpeed(m), blockers);
      } else {
        chase(this.terrain, m, p.x, p.y, monsterSpeed(m), blockers);
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

  /* ------------------------------------------------------------------ generators */

  private stepGenerators(): void {
    const live = this.liveMonsters;
    for (const g of this.generators) {
      if (!g.alive) continue;
      if (g.hurtFlash > 0) g.hurtFlash--;

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

  /* ------------------------------------------------------------------ terrain */

  private stepTerrain(a: Readonly<ActionState>): void {
    const p = this.player;
    if (this.teleportCd > 0) this.teleportCd--;
    if (p.invisibleFrames > 0) p.invisibleFrames--;
    this.engagementFrames++;

    // --- doors give up on their own. Holding keys doubles the wait, so hoarding them
    // costs you time as well as inventory space.
    const limit = (p.keys > 0 ? T.DOOR_AUTO_OPEN_SEC_WITH_KEYS : T.DOOR_AUTO_OPEN_SEC) * T.STEP_HZ;
    if (this.engagementFrames >= limit) {
      if (this.terrain.openAllDoors() > 0) this.events.emit({ t: 'doorsOpened', all: true });
      this.engagementFrames = 0;
    }

    // --- the 180s stand-still trick
    if (!this.wallsAreExits && p.stillFrames >= T.WALLS_BECOME_EXITS_SEC * T.STEP_HZ) {
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
    if (!p.inventoryFull) return;
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
          p.health += out.health;
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
          this.addScore(out.score, 'treasure');
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
    if (this.terrain.at(cx, cy) === Tile.Exit) {
      this.exitReached = true;
      this.events.emit({ t: 'exitReached' });
    }
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
