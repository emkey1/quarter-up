import type { LoopHost } from '@cabinet/loop';
import type { Display } from '@cabinet/display';
import type { Keyboard } from '@cabinet/keyboard';
import type { GamepadInput } from '@cabinet/gamepad';
import { T } from '@/data/tuning';
import { World } from '@/game/world';
import { Dir, type MoveIntent } from '@/game/digger';
import type { Action } from '@/game/controls';
import { TileAtlas } from '@/render/atlas';
import { FieldView } from '@/render/fieldview';
import { Hud } from '@/render/hud';
import { Audio } from './audio';

/**
 * The cabinet shell.
 *
 * M0's job is narrow: prove the field renders, the digger digs, and the whole thing sits
 * on `@quarter-up/cabinet` without a local engine copy. Screens, HUD and the rest of the
 * shell arrive at M4.
 */
export class App implements LoopHost {
  private readonly world = new World();
  private readonly atlas: TileAtlas;
  private readonly view: FieldView;
  private readonly hud = new Hud();
  readonly audio = new Audio();
  private floaters: { points: number; x: number; y: number; life: number }[] = [];
  private intent: MoveIntent = { dir: Dir.None, pump: false };
  private paused = false;

  constructor(
    private readonly display: Display,
    private readonly keyboard: Keyboard<Action>,
    private readonly pad: GamepadInput<Action>,
  ) {
    this.atlas = new TileAtlas();
    this.view = new FieldView(this.atlas);
  }

  /**
   * Read input, once per frame that will step.
   *
   * Four-way with no diagonals, so opposing inputs have to be resolved rather than
   * summed. Last-pressed would need edge tracking the devices do not expose here; a
   * fixed priority is honest and predictable, and the original's stick could not report
   * a diagonal anyway.
   */
  poll(): void {
    this.keyboard.poll();
    this.pad.poll();

    if (this.keyboard.pressed('pause')) {
      this.paused = !this.paused;
      this.audio.play('button');
    }
    // Browsers refuse to start audio without a gesture, so the first real key press is
    // the one that unlocks it.
    if (this.keyboard.anyActivity()) this.audio.unlock();

    const held = (a: Action): boolean => this.keyboard.held(a) || this.pad.isHeld(a);
    let dir = Dir.None;
    if (held('up')) dir = Dir.Up;
    else if (held('down')) dir = Dir.Down;
    else if (held('left')) dir = Dir.Left;
    else if (held('right')) dir = Dir.Right;

    // The stick, for anyone who does have a pad: whichever axis is pushed further wins,
    // so a slightly-off diagonal still resolves to one clean direction.
    if (dir === Dir.None && (this.pad.moveX !== 0 || this.pad.moveY !== 0)) {
      if (Math.abs(this.pad.moveX) > Math.abs(this.pad.moveY)) {
        dir = this.pad.moveX > 0 ? Dir.Right : Dir.Left;
      } else {
        dir = this.pad.moveY > 0 ? Dir.Down : Dir.Up;
      }
    }

    // Edge-triggered: the pump is jabbed, not held. `pressed` is already a
    // once-per-frame edge from the cabinet's keyboard, and poll() only runs on frames
    // that will step, so a press can neither be lost nor counted twice.
    const pumped = this.keyboard.pressed('pump') || this.pad.isPressed('pump');
    this.intent = { dir, pump: pumped };
  }

  step(): void {
    if (this.paused) return;
    const e = this.world.step(this.intent);
    // Consumed: a press must not survive into a second step on a catch-up frame.
    this.intent = { ...this.intent, pump: false };

    this.playFor(e);
    if (e.scored) this.floaters.push({ ...e.scored, life: 60 });
    this.floaters = this.floaters.filter((f) => --f.life > 0);
  }

  /**
   * Sounds for what just happened.
   *
   * Throttled where an event can repeat every frame — digging is the obvious one, and
   * without a throttle it is a buzzsaw rather than a scrape.
   */
  private playFor(e: ReturnType<World['step']>): void {
    const A = this.audio;
    if (e.dug) A.play('dig', 70);
    if (e.pumped) A.play('pump');
    if (e.burst) A.play('burst');
    if (e.rockStartedFalling) A.play('rockFall');
    if (e.rockLanded) A.play('rockLand');
    if (e.enemyStartedGhosting) A.play('ghost', 200);
    if (e.enemySolidified) A.play('solidify', 200);
    if (e.flameLit) A.play('flame');
    if (e.died) A.play('die');
    if (e.roundClear) A.play('roundClear');
    if (e.gameOver) A.play('die');
  }

  draw(): void {
    const { ctx, layout } = this.display;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);

    this.view.draw(
      ctx,
      this.world.field,
      this.world.digger,
      this.world.rocks,
      this.world.enemies,
      this.world.flame,
      layout,
    );

    this.hud.drawFloaters(ctx, layout, this.floaters);
    this.hud.draw(ctx, layout, {
      score: this.world.score,
      lives: this.world.lives,
      enemiesLeft: this.world.enemiesLeft,
      banner: this.banner(),
    });
  }

  private banner(): string | null {
    if (this.paused) return 'PAUSED';
    if (this.world.over) return 'GAME OVER';
    if (!this.world.playerAlive) return null; // the death animation speaks for itself
    if (this.world.enemiesLeft === 0) return 'ROUND CLEAR';
    return null;
  }

  /** M0 diagnostics, so the dev server shows something checkable without a HUD. */
  get debug(): string {
    const d = this.world.digger;
    return `score ${this.world.score}  left ${this.world.enemiesLeft}  cell ${d.cellX},${d.cellY}`;
  }
}
