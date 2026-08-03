import { T } from '@/data/tuning';
import { layoutFor } from '@/data/layouts';
import { World, type WorldEvents } from './world';
import type { MoveIntent } from './digger';

/**
 * A run: one credit, three lives, and however many levels you survive.
 *
 * The World is per-LEVEL and the Run is what carries across them — score, lives, and
 * which level you are on. Keeping them apart is what makes "next level" a matter of
 * constructing a new World rather than resetting a dozen fields on the old one, which is
 * the shape that quietly grows bugs.
 *
 * There is no ending. The layouts cycle and enemies get faster; the only thing that
 * finishes a run is running out of lives.
 */
export class Run {
  level = 1;
  score = 0;
  lives: number = T.STARTING_LIVES;
  over = false;
  world: World;

  constructor(startLevel = 1) {
    this.level = startLevel;
    this.world = this.build();
  }

  private build(): World {
    const w = new World(layoutFor(this.level), this.level);
    w.score = this.score;
    w.lives = this.lives;
    return w;
  }

  step(intent: MoveIntent): WorldEvents {
    if (this.over) return this.world.step(intent);

    const e = this.world.step(intent);
    this.score = this.world.score;
    this.lives = this.world.lives;

    if (this.world.over) {
      this.over = true;
      return e;
    }

    // The round is finished when the hold that follows it has run out, not the instant
    // the last enemy goes — otherwise the clear card never gets shown.
    if (this.world.roundFinished) {
      this.level++;
      this.world = this.build();
      e.levelStarted = true;
    }

    return e;
  }
}
