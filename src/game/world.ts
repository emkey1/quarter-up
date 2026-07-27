import { T } from '@/data/tuning';
import type { ClassId } from '@/data/classes';
import type { ActionState } from '@/engine/actions';
import type { FireModel } from '@/engine/input';
import { Rng } from '@/engine/rng';
import { Camera } from './camera';
import { buildTerrain, cellCentre, type LevelData } from './level';
import { Player } from './player';
import type { Terrain } from './terrain';

/**
 * The simulation. See DESIGN.md §7.4 for the entity model and the fixed update order.
 *
 * Nothing in this file (or anything it imports from game/) may reference a screen
 * pixel. World units only — that separation is what lets ART_SCALE change freely, and
 * it is enforced by tests/scale.test.ts.
 */
export class World {
  readonly terrain: Terrain;
  readonly player: Player;
  readonly camera = new Camera();
  readonly rng: Rng;
  readonly level: LevelData;

  frame = 0;
  fireModel: FireModel = 'feathered';

  constructor(level: LevelData, classId: ClassId, seed: number) {
    this.level = level;
    this.terrain = buildTerrain(level);
    this.rng = new Rng(seed);
    this.player = new Player(classId);
    const [sx, sy] = cellCentre(level.start[0], level.start[1]);
    this.player.x = sx;
    this.player.y = sy;
    this.camera.follow(this.player.x, this.player.y);
  }

  /**
   * One fixed step. Update order is documented because it is observable:
   *   1 player intent   2 movement   3 fire/melee   4 projectiles   5 monsters
   *   6 generators      7 terrain timers            8 pickups       9 damage
   *  10 health drain   11 score/rank/exit          12 fx
   *
   * M0 implements 1, 2, 10 and the camera. The rest arrive in M1–M3.
   */
  step(a: Readonly<ActionState>): void {
    this.player.step(this.terrain, a, this.fireModel);
    this.camera.follow(this.player.x, this.player.y);
    this.frame++;
  }

  /** Seconds elapsed in simulation time — never wall-clock, so replays match. */
  get elapsed(): number {
    return this.frame / T.STEP_HZ;
  }
}
