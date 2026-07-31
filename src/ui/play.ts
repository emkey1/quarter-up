import { T } from '@/data/tuning';
import { CLASS_ORDER, type ClassId } from '@/data/classes';
import type { Display } from '@/engine/display';
import type { Input } from '@/engine/input';
import { defaultFireModel, type FireModel } from '@/engine/input';
import type { Loop } from '@/engine/loop';
import type { Run } from '@/game/flow';
import { PROVING } from '@/data/campaign';
import type { Screen } from './screen';
import type { ActionState } from '@/engine/actions';
import { sprites } from '@/render/sprites';
import { Hud } from '@/render/hud';
import { TilemapRenderer, viewOrigin } from '@/render/tilemap';
import { theme } from '@/render/theme';
import { PadTest } from './padtest';
import { Audio } from '@/engine/audio';
import { Speech } from '@/engine/speech';
import { Presentation } from './presentation';
import { Lighting } from '@/render/lighting';
import { ScreenFx, prefersReducedMotion } from '@/render/fx';
import { SetupScreen } from './setup';
import { cloneRules, DEFAULT_RULES, tierOf } from '@/data/rules';
import { loadSettings } from '@/engine/storage';

const FIRE_CYCLE: FireModel[] = ['arcade', 'feathered', 'free', 'twinstick'];

export class PlayScreen implements Screen {
  readonly id = 'play' as const;
  private tilemap: TilemapRenderer;
  private hud = new Hud();
  private readonly lighting = new Lighting();

  readonly presentation: Presentation;
  /**
   * Frames since the player died. The run does not end the instant health hits zero —
   * the death sound, the flash and the last particles need a beat to land, and cutting
   * straight to a menu on the frame of death reads as a crash.
   */
  private deathFrames = -1;
  fireModel: FireModel;
  private paused = false;
  /** Render-only animation clock; never read by the simulation. */
  private animFrame = 0;

  loop!: Loop;

  constructor(
    private readonly display: Display,
    private readonly input: Input,
    private readonly audio: Audio,
    private readonly speech: Speech,
    private readonly fx: ScreenFx,
    private readonly setup: SetupScreen,
    private readonly getRun: () => Run,
  ) {
    this.fireModel = defaultFireModel(input.lastDevice);
    this.presentation = new Presentation(this.audio, this.speech, this.fx);
    this.tilemap = new TilemapRenderer(theme('stone'), display.layout.pxPerWu);
    display.onLayoutChange((l) => this.tilemap.onLayoutChange(theme('stone'), l.pxPerWu));
  }

  private get run(): Run {
    return this.getRun();
  }

  /** The run object was replaced (new run, continue, rules change). */
  onRunChanged(): void {
    this.deathFrames = -1;
    this.paused = false;
    this.presentation.particles.clear();
    this.presentation.announcer.reset();
    this.speech.cancel();
    this.fx.reset();
  }

  onNewLevel(): void {
    this.deathFrames = -1;
    this.presentation.onNewLevel(this.world);
  }

  /** Has the death animation had its moment? The app ends the run on this. */
  get deathSettled(): boolean {
    return this.deathFrames >= 90;
  }

  /** The active simulation. Kept as a getter so level transitions are transparent. */
  get world() {
    return this.run.world;
  }

  step(a: Readonly<ActionState>, stepIndex: number): void {
    if (stepIndex === 0) this.devHotkeys();

    if (a.pausePressed) this.paused = !this.paused;
    if (this.paused) return;

    this.world.step(a);
    this.world.fireModel = this.fireModel;
    this.run.step();
    this.presentation.consume(this.world);

    // Once dead, the simulation is frozen but the presentation keeps settling: the
    // flash fades, particles fall, the last sound finishes. Only then does the run end.
    if (this.world.player.dead) this.deathFrames = Math.max(0, this.deathFrames) + 1;
  }

  private devHotkeys(): void {
    const kb = this.input.keyboard;

    if (kb.wasCodePressed('KeyO')) {
      const i = FIRE_CYCLE.indexOf(this.fireModel);
      this.fireModel = FIRE_CYCLE[(i + 1) % FIRE_CYCLE.length]!;
      this.world.fireModel = this.fireModel;
    }
    if (kb.wasCodePressed('KeyN')) this.skipLevel();
  }

  /** Dev: jump straight to the next level without finding the exit. */
  private skipLevel(): void {
    this.run.advance();
    this.run.world.fireModel = this.fireModel;
    this.onRunChanged();
  }

  /**
   * `chrome` draws the HUD, debug panel and hints. The menus pass false: a backdrop is
   * the dungeon, not a screenshot of the game including its status panel. Leaving it on
   * put the developer readout and the health bar straight through the menu text.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    layout: import('@/engine/display').Layout,
    chrome = true,
  ): void {
    this.animFrame++;
    const pf = layout.playfield;

    ctx.fillStyle = '#07070a';
    ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);

    this.tilemap.draw(ctx, this.world.terrain, this.world.camera, layout);

    // entities
    ctx.save();
    ctx.beginPath();
    ctx.rect(pf.x, pf.y, pf.w, pf.h);
    ctx.clip();
    ctx.translate(this.fx.offsetX, this.fx.offsetY);
    const p = this.world.player;
    const px = layout.pxPerWu;
    // Same origin rule as the tilemap, so entities and terrain never disagree.
    const { originX, originY } = viewOrigin(this.world.camera, pf, px);
    const camX = Math.round(originX * px);
    const camY = Math.round(originY * px);
    const toX = (wx: number) => pf.x + Math.round(wx * px) - camX;
    const toY = (wy: number) => pf.y + Math.round(wy * px) - camY;

    for (const it of this.world.items) {
      if (it.alive) sprites.item(ctx, it, toX(it.x), toY(it.y), px, this.animFrame);
    }
    for (const g of this.world.generators) {
      if (g.alive) sprites.generator(ctx, g, toX(g.x), toY(g.y), px);
    }

    // Depth-sort entities by y so overlaps read correctly.
    const sorted = this.world.monsters.filter((m) => m.alive).sort((a, b) => a.y - b.y);
    let drewPlayer = false;
    for (const m of sorted) {
      if (!drewPlayer && m.y > p.y) {
        this.drawHero(ctx, toX(p.x), toY(p.y), px);
        drewPlayer = true;
      }
      sprites.monster(ctx, m, toX(m.x), toY(m.y), px, this.animFrame);
    }
    if (!drewPlayer) this.drawHero(ctx, toX(p.x), toY(p.y), px);
    this.drawExitPortal(ctx, toX, toY, px);

    for (const d of this.world.deaths) {
      if (d.alive) sprites.death(ctx, d, toX(d.x), toY(d.y), px, this.animFrame);
    }
    for (const t of this.world.thieves) {
      if (t.alive) sprites.thief(ctx, t, toX(t.x), toY(t.y), px, this.animFrame);
    }
    for (const pr of this.world.projectiles) {
      if (pr.alive) sprites.projectile(ctx, pr, toX(pr.x), toY(pr.y), px);
    }
    this.presentation.particles.draw(ctx, pf, toX, toY, px);
    ctx.restore();

    this.lighting.draw(ctx, pf, this.presentation.collectLights(this.world, toX, toY, px));
    this.fx.drawOverlays(ctx, layout, pf);
    // Captions are chrome, not scenery. Drawn unconditionally they print the announcer's
    // subtitles across the character select, which is where the backdrop is a backdrop.
    if (chrome) this.drawCaptions(ctx, layout, pf);

    if (p.damageFlash > 0) {
      ctx.save();
      ctx.globalAlpha = (p.damageFlash / 8) * 0.35;
      ctx.fillStyle = '#ff2020';
      ctx.fillRect(pf.x, pf.y, pf.w, pf.h);
      ctx.restore();
    }

    // The iris. Closes on the exit rather than on the middle of the screen, so the last
    // thing visible is where you went — a centred fade would just be a fade.
    if (this.world.exitFrames >= 0 && this.world.exitAt) {
      const t = this.world.exitProgress;
      const close = Math.max(0, (t - 0.45) / 0.55);
      if (close > 0) {
        const ix = toX(this.world.exitAt[0]);
        const iy = toY(this.world.exitAt[1]);
        const full = Math.hypot(pf.w, pf.h);
        const r = full * (1 - close * close);
        ctx.save();
        ctx.beginPath();
        ctx.rect(pf.x, pf.y, pf.w, pf.h);
        ctx.clip();
        const iris = ctx.createRadialGradient(ix, iy, Math.max(0, r * 0.55), ix, iy, Math.max(1, r));
        iris.addColorStop(0, 'rgba(5,6,10,0)');
        iris.addColorStop(1, 'rgba(5,6,10,1)');
        ctx.fillStyle = iris;
        ctx.fillRect(pf.x, pf.y, pf.w, pf.h);
        ctx.restore();
      }
    }

    // playfield border, so the locked gameplay viewport is visible as a deliberate frame
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = Math.max(1, layout.dpr);
    ctx.strokeRect(pf.x + 0.5, pf.y + 0.5, pf.w - 1, pf.h - 1);

    if (!chrome) return;

    this.hud.draw(ctx, layout, this.world, this.run, this.input, this.fireModel, {
      fps: this.loop?.stats.fps ?? 0,
      steps: this.loop?.stats.stepsLastFrame ?? 0,
      frameMs: this.loop?.stats.frameMs ?? 0,
      stepMs: this.loop?.stats.stepMs ?? 0,
      drawMs: this.loop?.stats.drawMs ?? 0,
    });

    if (this.paused) this.drawPaused(ctx, layout.playfield, layout.uiScale);
    this.drawTierBadge(ctx, layout);
    this.drawPadHint(ctx, layout);
  }

  /**
   * The player sprite, wound down into the exit when the level is ending.
   *
   * Scaling about the sprite's own feet rather than its centre: a figure that shrinks
   * toward its middle looks like it is being deleted, one that shrinks toward the ground
   * looks like it is being pulled down into something. Same three lines of maths,
   * completely different read.
   */
  private drawHero(ctx: CanvasRenderingContext2D, sx: number, sy: number, px: number): void {
    const w = this.world;
    const p = w.player;
    if (w.exitFrames < 0) {
      sprites.player(ctx, p, sx, sy, px, this.animFrame);
      return;
    }

    const t = w.exitProgress;
    // Hold full size briefly so the pull to the centre is visible before the descent.
    const k = Math.max(0, (t - 0.25) / 0.6);
    const scale = Math.max(0.001, 1 - k * k);
    const spin = k * k * Math.PI * 3;

    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - k * k * 1.1);
    ctx.translate(sx, sy + px * 6);
    ctx.rotate(spin);
    ctx.scale(scale, scale);
    ctx.translate(0, -px * 6);
    sprites.player(ctx, p, 0, 0, px, this.animFrame);
    ctx.restore();
  }

  /**
   * The portal itself: a ring that opens, a column of light, and sparks drawn inward.
   *
   * Sparks converge rather than explode. An outward burst is a thing being destroyed; the
   * point here is that the dungeon is taking you somewhere.
   */
  private drawExitPortal(
    ctx: CanvasRenderingContext2D,
    toX: (n: number) => number,
    toY: (n: number) => number,
    px: number,
  ): void {
    const w = this.world;
    if (w.exitFrames < 0 || !w.exitAt) return;

    const t = w.exitProgress;
    const cx = toX(w.exitAt[0]);
    const cy = toY(w.exitAt[1]);
    const unit = px * T.TILE;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Ground glow, opening fast and fading at the very end with the wipe.
    const grow = Math.min(1, t / 0.35);
    const fade = t > 0.8 ? Math.max(0, (1 - t) / 0.2) : 1;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, unit * 1.9 * grow);
    glow.addColorStop(0, `rgba(190,240,255,${0.85 * fade})`);
    glow.addColorStop(0.35, `rgba(90,180,255,${0.45 * fade})`);
    glow.addColorStop(1, 'rgba(20,60,140,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, unit * 1.9 * grow, 0, Math.PI * 2);
    ctx.fill();

    // Two expanding rings, offset in time, so the portal reads as pulsing rather than
    // as one shape changing size.
    for (const off of [0, 0.45]) {
      const rt = (t * 1.9 + off) % 1;
      ctx.strokeStyle = `rgba(210,245,255,${(1 - rt) * 0.7 * fade})`;
      ctx.lineWidth = Math.max(1, px * 1.6 * (1 - rt));
      ctx.beginPath();
      ctx.ellipse(cx, cy + px * 3, unit * 1.5 * rt, unit * 0.6 * rt, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Sparks falling inward. Deterministic angles, so it is the same every time and
    // cannot flicker between frames.
    const sparks = 14;
    for (let i = 0; i < sparks; i++) {
      const a = (i / sparks) * Math.PI * 2 + t * 2.2;
      const r = unit * 2.2 * (1 - ((t * 1.6 + i / sparks) % 1));
      const px2 = cx + Math.cos(a) * r;
      const py2 = cy + Math.sin(a) * r * 0.45 - px * 2;
      ctx.fillStyle = `rgba(235,250,255,${0.9 * fade * (1 - r / (unit * 2.2))})`;
      ctx.fillRect(px2 - px * 0.6, py2 - px * 0.6, px * 1.2, px * 1.2);
    }

    // The column, arriving late — the moment of actually going.
    if (t > 0.45) {
      const ct = (t - 0.45) / 0.55;
      const beam = ctx.createLinearGradient(cx, cy - unit * 7, cx, cy + px * 4);
      beam.addColorStop(0, 'rgba(150,220,255,0)');
      beam.addColorStop(1, `rgba(220,248,255,${0.55 * Math.sin(ct * Math.PI) })`);
      ctx.fillStyle = beam;
      const halfW = unit * 0.42 * (1 - ct * 0.45);
      ctx.fillRect(cx - halfW, cy - unit * 7, halfW * 2, unit * 7 + px * 4);
    }
    ctx.restore();
  }

  /**
   * Advance the live level used as a backdrop behind the menus.
   *
   * Deliberately a STEP method, not part of draw(). Ticking the simulation from inside
   * draw() would break the one rule the whole architecture rests on — draw() never
   * mutates — and would tie the backdrop's speed to the frame rate rather than to the
   * fixed timestep.
   */
  stepBackdrop(): void {
    this.world.step(IDLE);
    this.presentation.consume(this.world);
  }

  /**
   * The dungeon only — no HUD, no debug readout, no hints — filling the whole canvas.
   *
   * Widening the drawn area is safe here precisely because nothing is being played: the
   * locked 232x240 gameplay viewport exists to bound generator pressure and potion
   * range, and neither matters in a menu.
   */
  drawBackdrop(ctx: CanvasRenderingContext2D, layout: import('@/engine/display').Layout): void {
    // Zoomed in relative to play: at 1:1 a full-canvas view needs almost the whole
    // 512wu level, so any camera offset would expose the map edge. Doubling the scale
    // needs half the level and looks better besides.
    const px = layout.pxPerWu * 2;
    this.draw(
      ctx,
      {
        ...layout,
        pxPerWu: px,
        playfield: { x: 0, y: 0, w: layout.canvasW, h: layout.canvasH },
      },
      false,
    );
  }

  /** The announcer's line, always drawn. Captions are the primary channel: voice
   *  availability varies wildly, and plenty of people play muted (DESIGN.md §6.5). */
  private drawCaptions(
    ctx: CanvasRenderingContext2D,
    layout: import('@/engine/display').Layout,
    pf: { x: number; y: number; w: number; h: number },
  ): void {
    const caps = this.speech.activeCaptions();
    if (!caps.length) return;
    const s = layout.uiScale;
    ctx.save();
    ctx.textAlign = 'center';
    let y = pf.y + pf.h - 34 * s;
    for (let i = caps.length - 1; i >= 0; i--) {
      const c = caps[i];
      const fade = Math.min(1, (c.until - performance.now()) / 500);
      ctx.globalAlpha = Math.max(0, fade);
      ctx.font = `700 ${13 * s}px ui-sans-serif, system-ui, sans-serif`;
      const w = ctx.measureText(c.text).width + 22 * s;
      ctx.fillStyle = 'rgba(8,8,12,.78)';
      ctx.fillRect(pf.x + (pf.w - w) / 2, y - 15 * s, w, 22 * s);
      ctx.fillStyle = '#ffe9a0';
      ctx.fillText(c.text, pf.x + pf.w / 2, y);
      y -= 26 * s;
    }
    ctx.textAlign = 'left';
    ctx.restore();
  }

  /** An altered run must never be able to look like a real one, so the tier is shown
   *  in-game whenever it is not Arcade. Derived, never stored. */
  private drawTierBadge(
    ctx: CanvasRenderingContext2D,
    layout: import('@/engine/display').Layout,
  ): void {
    const tier = tierOf(this.setup.rules);
    if (tier === 'arcade') return;
    const s = layout.uiScale;
    const pf = layout.playfield;
    const msg = tier === 'tagged' ? 'TAGGED RUN' : 'RULES ALTERED';
    ctx.save();
    ctx.font = `700 ${9 * s}px ui-sans-serif, system-ui, sans-serif`;
    const w = ctx.measureText(msg).width + 16 * s;
    ctx.fillStyle = tier === 'tagged' ? 'rgba(232,195,74,.22)' : 'rgba(255,107,94,.22)';
    ctx.fillRect(pf.x + 8 * s, pf.y + 8 * s, w, 18 * s);
    ctx.fillStyle = tier === 'tagged' ? '#e8c34a' : '#ff6b5e';
    ctx.textBaseline = 'middle';
    ctx.fillText(msg, pf.x + 16 * s, pf.y + 17 * s);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  /** Always-visible hint, because the debug flank disappears on narrow windows and a
   *  silently-absent controller is otherwise indistinguishable from a broken one. */
  private drawPadHint(ctx: CanvasRenderingContext2D, layout: import('@/engine/display').Layout): void {
    const gp = this.input.gamepad;
    const s = layout.uiScale;
    const pf = layout.playfield;
    const msg = gp.anyPadConnected()
      ? gp.status.standard
        ? null
        : 'Non-standard controller — press G to set it up'
      : 'No controller detected — press a button on it, or G for setup';
    if (!msg) return;

    ctx.save();
    ctx.font = `500 ${10 * s}px ui-sans-serif, system-ui, sans-serif`;
    const w = ctx.measureText(msg).width + 20 * s;
    const h = 22 * s;
    const x = pf.x + pf.w - w - 10 * s;
    const y = pf.y + pf.h - h - 10 * s;
    ctx.fillStyle = 'rgba(10,12,16,.8)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(232,195,74,.9)';
    ctx.textBaseline = 'middle';
    ctx.fillText(msg, x + 10 * s, y + h / 2);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  private drawPaused(
    ctx: CanvasRenderingContext2D,
    pf: { x: number; y: number; w: number; h: number },
    s: number,
  ): void {
    ctx.fillStyle = 'rgba(6,7,10,.66)';
    ctx.fillRect(pf.x, pf.y, pf.w, pf.h);
    ctx.fillStyle = '#e8eaee';
    ctx.font = `700 ${22 * s}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('PAUSED', pf.x + pf.w / 2, pf.y + pf.h / 2);
    ctx.font = `500 ${11 * s}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(232,234,238,.6)';
    ctx.fillText('P or Start to resume', pf.x + pf.w / 2, pf.y + pf.h / 2 + 26 * s);
    ctx.textAlign = 'left';
  }
}

/** No input at all — what the attract-mode backdrop is played with. */
const IDLE: Readonly<ActionState> = {
  moveX: 0, moveY: 0, aimX: 0, aimY: 0,
  fire: false, firePressed: false, magic: false, magicPressed: false,
  faceLock: false, pausePressed: false, mutePressed: false,
  confirmPressed: false, cancelPressed: false,
};
