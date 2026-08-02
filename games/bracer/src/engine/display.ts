import { T } from '@/data/tuning';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  /** devicePixelRatio in force. */
  dpr: number;
  /** Integer screen scale S. */
  scale: number;
  /** Device pixels per world unit = ART_SCALE * scale. The ONLY bridge between
   *  world space and screen space. */
  pxPerWu: number;
  /** Multiplier for HUD text and chrome. Deliberately NOT pxPerWu: UI should stay
   *  roughly constant in CSS pixels as the playfield scales, or labels collide and
   *  panels overflow at scale 3. Grows slightly with scale so it doesn't look lost
   *  next to a large playfield. */
  uiScale: number;
  canvasW: number;
  canvasH: number;
  playfield: Rect;
  /** HUD flanks. Null when the window is too narrow to afford them; the caller
   *  falls back to a compact overlay. */
  leftPanel: Rect | null;
  rightPanel: Rect | null;
}

const MIN_FLANK_PX = 168; // device px below which a flank is not worth having

/**
 * Owns the canvas and resolves world units to device pixels.
 *
 * The gameplay viewport (T.VIEW_W x T.VIEW_H world units) is fixed; only how many
 * device pixels each world unit occupies varies. See DESIGN.md §6.1.
 */
export class Display {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  layout!: Layout;

  /** null = auto-fit. Set by the player in Options. */
  scaleOverride: number | null = null;

  private onResize?: (layout: Layout) => void;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D unavailable');
    this.ctx = ctx;
    parent.appendChild(this.canvas);

    this.resize();
    window.addEventListener('resize', this.resize);
    // dpr can change when a window moves between displays
    window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener?.(
      'change',
      this.resize,
    );
  }

  onLayoutChange(fn: (layout: Layout) => void): void {
    this.onResize = fn;
  }

  setScale(scale: number | null): void {
    this.scaleOverride = scale;
    this.resize();
  }

  /** Cycle 1..MAX then back to auto. */
  cycleScale(dir: 1 | -1): void {
    const cur = this.scaleOverride ?? this.layout.scale;
    let next = cur + dir;
    if (next > T.SCREEN_SCALE_MAX || next < T.SCREEN_SCALE_MIN) this.scaleOverride = null;
    else this.scaleOverride = next;
    this.resize();
  }

  private resize = (): void => {
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    const canvasW = Math.max(1, Math.round(cssW * dpr));
    const canvasH = Math.max(1, Math.round(cssH * dpr));

    const artW = T.VIEW_W * T.ART_SCALE;
    const artH = T.VIEW_H * T.ART_SCALE;

    const fit = Math.floor(Math.min(canvasW / artW, canvasH / artH));
    const auto = Math.max(T.SCREEN_SCALE_MIN, Math.min(T.SCREEN_SCALE_MAX, fit || 1));
    const scale = this.scaleOverride ?? auto;

    const pfW = artW * scale;
    const pfH = artH * scale;
    const pfX = Math.floor((canvasW - pfW) / 2);
    const pfY = Math.floor((canvasH - pfH) / 2);

    const flank = pfX;
    const hasFlanks = flank >= MIN_FLANK_PX;

    this.canvas.width = canvasW;
    this.canvas.height = canvasH;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.ctx.imageSmoothingEnabled = false;

    this.layout = {
      dpr,
      scale,
      pxPerWu: T.ART_SCALE * scale,
      uiScale: dpr * (1 + (scale - 1) * 0.12),
      canvasW,
      canvasH,
      playfield: { x: pfX, y: pfY, w: pfW, h: pfH },
      leftPanel: hasFlanks ? { x: 0, y: pfY, w: flank, h: pfH } : null,
      rightPanel: hasFlanks
        ? { x: pfX + pfW, y: pfY, w: canvasW - (pfX + pfW), h: pfH }
        : { x: pfX + pfW, y: pfY, w: Math.max(0, canvasW - (pfX + pfW)), h: pfH },
    };

    this.onResize?.(this.layout);
  };
}
