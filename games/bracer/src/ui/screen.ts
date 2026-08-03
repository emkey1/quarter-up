import type { ActionState } from '@/engine/actions';
import type { Layout } from '@cabinet/display';

export type ScreenId = 'attract' | 'charselect' | 'levelintro' | 'play' | 'gameover';

export interface Screen {
  readonly id: ScreenId;
  enter?(): void;
  exit?(): void;
  /** `stepIndex` is 0 on the first step of a frame — when input edges are valid. */
  step(a: Readonly<ActionState>, stepIndex: number): void;
  draw(ctx: CanvasRenderingContext2D, layout: Layout): void;
}

/**
 * Menu navigation helper.
 *
 * Every screen needs the same thing — move a cursor, confirm, cancel — from either
 * device, and getting the edge handling subtly different on each screen is how menus
 * end up feeling inconsistent.
 */
export class MenuInput {
  up = false;
  down = false;
  left = false;
  right = false;
  confirm = false;
  cancel = false;

  private prev = { x: 0, y: 0 };

  read(a: Readonly<ActionState>, stepIndex: number, kbPressed: (code: string) => boolean): void {
    if (stepIndex !== 0) {
      this.up = this.down = this.left = this.right = this.confirm = this.cancel = false;
      return;
    }
    // Analog/held directions become edges here, so holding a stick does not scroll
    // the menu at 60 rows a second.
    const dx = Math.sign(a.moveX);
    const dy = Math.sign(a.moveY);
    this.up = (dy < 0 && this.prev.y >= 0) || kbPressed('ArrowUp') || kbPressed('KeyW');
    this.down = (dy > 0 && this.prev.y <= 0) || kbPressed('ArrowDown') || kbPressed('KeyS');
    this.left = (dx < 0 && this.prev.x >= 0) || kbPressed('ArrowLeft') || kbPressed('KeyA');
    this.right = (dx > 0 && this.prev.x <= 0) || kbPressed('ArrowRight') || kbPressed('KeyD');
    this.prev = { x: dx, y: dy };

    this.confirm = a.confirmPressed || a.firePressed;
    this.cancel = a.cancelPressed;
  }
}
