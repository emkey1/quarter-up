import { T } from '@/data/tuning';

/**
 * Fixed-timestep loop. See DESIGN.md §7.3.
 *
 * Hard rules this enforces by shape:
 *   - step() is pure simulation and never touches the canvas.
 *   - draw() reads state and never mutates it.
 *   - The gamepad is polled exactly ONCE per rendered frame; every simulation step in
 *     that frame sees the same snapshot. That is what makes replay determinism
 *     well-defined when the loop catches up on two steps.
 */
export interface LoopHost {
  /** Poll input devices. Called once per rendered frame, before any step. */
  poll(): void;
  /** Advance the simulation by exactly 1/STEP_HZ seconds. `stepIndex` is 0 for the
   *  first step of this frame, which is when input edges are allowed to fire. */
  step(stepIndex: number): void;
  /** Render. Called once per rendered frame, after all steps. */
  draw(): void;
}

const STEP = 1 / T.STEP_HZ;
const MAX_STEPS_PER_FRAME = 5;
const MAX_ACCUM = 0.25; // clamp after a tab-switch rather than fast-forwarding

export class Loop {
  private raf = 0;
  private acc = 0;
  private prev = 0;
  private running = false;

  /** Rolling diagnostics for the debug overlay. */
  readonly stats = { fps: 0, stepsLastFrame: 0, frameMs: 0, stepMs: 0, drawMs: 0 };
  private fpsAccum = 0;
  private fpsFrames = 0;

  constructor(private readonly host: LoopHost) {}

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

    const frameStart = now;
    const dt = Math.min((now - this.prev) / 1000, MAX_ACCUM);
    this.prev = now;
    this.acc += dt;

    /**
     * Poll ONLY on a frame that will step.
     *
     * poll() latches "pressed since last poll" into a frame snapshot and clears the
     * pending set, and only step() reads that snapshot — so polling on a frame that takes
     * no step throws the press away. At 120Hz, which is every recent Mac, about every
     * other frame accumulates less than one step and takes none.
     *
     * Found from Double Bubble, where jump and fire are edge-triggered and it was
     * obvious. Bracer hid it: movement and fire are read as HELD, so only the genuinely
     * edge-triggered actions — pause, the setup and controller keys, menu confirms —
     * were being dropped about half the time.
     */
    if (this.acc >= STEP) this.host.poll();

    const stepStart = performance.now();
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS_PER_FRAME) {
      this.host.step(steps);
      this.acc -= STEP;
      steps++;
    }
    // If we hit the cap we are running behind; drop the backlog rather than spiral.
    if (steps === MAX_STEPS_PER_FRAME && this.acc > STEP) this.acc = 0;
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
