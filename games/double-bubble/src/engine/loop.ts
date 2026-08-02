import type { LoopConfig } from './config';

/**
 * Fixed-timestep loop.
 *
 * Hard rules this enforces by shape:
 *   - step() is pure simulation and never touches the canvas.
 *   - draw() reads state and never mutates it.
 *   - Input is polled exactly ONCE per rendered frame; every simulation step in that
 *     frame sees the same snapshot. That is what makes replay determinism well-defined
 *     when the loop catches up on two steps.
 */
export interface LoopHost {
  /** Poll input devices. Called once per rendered frame, before any step. */
  poll(): void;
  /** Advance the simulation by exactly 1/stepHz seconds. `stepIndex` is 0 for the first
   *  step of this frame, which is when input edges are allowed to fire. */
  step(stepIndex: number): void;
  /** Render. Called once per rendered frame, after all steps. */
  draw(): void;
}

const MAX_STEPS_PER_FRAME = 5;
const MAX_ACCUM = 0.25; // clamp after a tab-switch rather than fast-forwarding

export class Loop {
  private raf = 0;
  private acc = 0;
  private prev = 0;
  private running = false;
  private readonly stepSeconds: number;

  /** Rolling diagnostics for the debug overlay. */
  readonly stats = { fps: 0, stepsLastFrame: 0, frameMs: 0, stepMs: 0, drawMs: 0 };
  private fpsAccum = 0;
  private fpsFrames = 0;

  constructor(
    private readonly host: LoopHost,
    cfg: LoopConfig,
  ) {
    this.stepSeconds = 1 / cfg.stepHz;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.prev = performance.now();
    this.acc = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);

    const step = this.stepSeconds;
    const frameStart = now;
    const dt = Math.min((now - this.prev) / 1000, MAX_ACCUM);
    this.prev = now;
    this.acc += dt;

    this.host.poll();

    const stepStart = performance.now();
    let steps = 0;
    while (this.acc >= step && steps < MAX_STEPS_PER_FRAME) {
      this.host.step(steps);
      this.acc -= step;
      steps++;
    }
    // If we hit the cap we are running behind; drop the backlog rather than spiral.
    if (steps === MAX_STEPS_PER_FRAME && this.acc > step) this.acc = 0;
    const stepEnd = performance.now();

    this.host.draw();
    const drawEnd = performance.now();

    this.stats.stepsLastFrame = steps;
    this.stats.stepMs = stepEnd - stepStart;
    this.stats.drawMs = drawEnd - stepEnd;
    this.stats.frameMs = drawEnd - frameStart;

    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.stats.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
  };
}
