/**
 * Mouse and touch, for the menus only.
 *
 * Deliberately not a gameplay input: Gauntlet is a joystick game, and a mouse-driven
 * player would need aiming, which is a different game. But a menu that draws four
 * character cards with a highlight on one of them is *asking* to be clicked, and until
 * now clicking did nothing at all — which reads as the game being broken rather than as
 * the game being keyboard-driven. The cards look like buttons; they should behave like
 * buttons.
 *
 * Coordinates are reported in CANVAS pixels, the same space `Layout` and every draw()
 * work in, so a screen can hit-test against the exact rectangle it just drew.
 */
export class Pointer {
  /** Canvas-space cursor position, or null if the cursor has never been over the canvas. */
  x: number | null = null;
  y: number | null = null;
  /** True for the single frame after a press is released over the canvas. */
  clicked = false;
  /** True while a button is held, for drawing a pressed state. */
  down = false;

  private pendingClick = false;
  private canvas: HTMLCanvasElement | null = null;
  private attached = false;

  attach(canvas: HTMLCanvasElement): void {
    if (this.attached) return;
    this.attached = true;
    this.canvas = canvas;

    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerdown', this.onDown);
    // Release is watched on the window, not the canvas: a press that drags off the
    // canvas before release must not leave `down` stuck on forever.
    window.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointerleave', this.onLeave);
  }

  detach(): void {
    if (!this.attached || !this.canvas) return;
    this.attached = false;
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    this.canvas = null;
  }

  /**
   * Map a client coordinate into canvas pixels.
   *
   * Via getBoundingClientRect rather than the device pixel ratio directly, because the
   * canvas is also letterboxed and CSS-scaled — using dpr alone puts the hit test a few
   * pixels off at some window sizes and completely off at others.
   */
  private toCanvas(e: PointerEvent): void {
    if (!this.canvas) return;
    const r = this.canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    this.x = ((e.clientX - r.left) / r.width) * this.canvas.width;
    this.y = ((e.clientY - r.top) / r.height) * this.canvas.height;
  }

  private onMove = (e: PointerEvent): void => {
    this.toCanvas(e);
  };

  private onDown = (e: PointerEvent): void => {
    this.toCanvas(e);
    this.down = true;
  };

  private onUp = (e: PointerEvent): void => {
    if (this.down) {
      this.toCanvas(e);
      this.pendingClick = true;
    }
    this.down = false;
  };

  private onLeave = (): void => {
    this.x = null;
    this.y = null;
  };

  /** Called once per frame by the shell, before screens read it. */
  poll(): void {
    this.clicked = this.pendingClick;
    this.pendingClick = false;
  }

  /** True if the cursor is inside this canvas-space rectangle. */
  over(x: number, y: number, w: number, h: number): boolean {
    return this.x !== null && this.y !== null && this.x >= x && this.x < x + w && this.y >= y && this.y < y + h;
  }

  /** True if a click landed inside this canvas-space rectangle this frame. */
  hit(x: number, y: number, w: number, h: number): boolean {
    return this.clicked && this.over(x, y, w, h);
  }
}
