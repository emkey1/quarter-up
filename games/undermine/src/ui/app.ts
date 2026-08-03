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
  private intent: MoveIntent = { dir: Dir.None };
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

    if (this.keyboard.pressed('pause')) this.paused = !this.paused;

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

    this.intent = { dir };
  }

  step(): void {
    if (this.paused) return;
    this.world.step(this.intent);
  }

  draw(): void {
    const { ctx, layout } = this.display;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);

    this.view.draw(ctx, this.world.field, this.world.digger, layout);

    if (this.paused) {
      const pf = layout.playfield;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(pf.x, pf.y, pf.w, pf.h);
      ctx.fillStyle = '#e6e9ef';
      ctx.font = `${Math.round(10 * layout.uiScale)}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', pf.x + pf.w / 2, pf.y + pf.h / 2);
      ctx.textAlign = 'left';
    }
  }

  /** M0 diagnostics, so the dev server shows something checkable without a HUD. */
  get debug(): string {
    const d = this.world.digger;
    return `cell ${d.cellX},${d.cellY}  dug ${this.world.field.tunnelCount()}/${T.GRID_W * T.GRID_H}`;
  }
}
