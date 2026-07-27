import { CLASS_ORDER, type ClassId } from '@/data/classes';
import type { Display } from '@/engine/display';
import type { Input } from '@/engine/input';
import { defaultFireModel, type FireModel } from '@/engine/input';
import type { LoopHost } from '@/engine/loop';
import type { Loop } from '@/engine/loop';
import { Run } from '@/game/flow';
import type { LevelData } from '@/game/level';
import { CAMPAIGN, PROVING } from '@/data/campaign';
import {
  drawPlayer,
  drawMonster,
  drawGenerator,
  drawProjectile,
  drawItem,
  drawDeath,
  drawThief,
} from '@/render/entities';
import { Hud } from '@/render/hud';
import { TilemapRenderer } from '@/render/tilemap';
import { theme } from '@/render/theme';
import { PadTest } from './padtest';
import { SetupScreen } from './setup';
import { cloneRules, DEFAULT_RULES, tierOf } from '@/data/rules';
import { loadSettings } from '@/engine/storage';

const FIRE_CYCLE: FireModel[] = ['arcade', 'feathered', 'free', 'twinstick'];

export class PlayScreen implements LoopHost {
  private run: Run;
  private campaign: readonly LevelData[];
  private tilemap: TilemapRenderer;
  private hud = new Hud();
  private padTest = new PadTest();
  private setup: SetupScreen;
  private fireModel: FireModel;
  private classId: ClassId;
  private seed = 0x5eed;
  private paused = false;
  /** Render-only animation clock; never read by the simulation. */
  private animFrame = 0;

  loop!: Loop;

  constructor(
    private readonly display: Display,
    private readonly input: Input,
    classId: ClassId = 'elf',
  ) {
    this.classId = classId;
    this.campaign = CAMPAIGN;
    this.fireModel = defaultFireModel(input.lastDevice);
    this.setup = new SetupScreen(cloneRules(loadSettings().rules ?? DEFAULT_RULES));
    this.run = new Run(this.campaign, classId, this.seed, 0, this.setup.rules);
    this.run.world.fireModel = this.fireModel;
    this.tilemap = new TilemapRenderer(theme('stone'), display.layout.pxPerWu);
    display.onLayoutChange((l) => this.tilemap.onLayoutChange(theme('stone'), l.pxPerWu));
  }

  /** The active simulation. Kept as a getter so level transitions are transparent. */
  get world() {
    return this.run.world;
  }

  poll(): void {
    this.input.poll();
  }

  step(stepIndex: number): void {
    const a = this.input.sample(stepIndex);

    if (stepIndex === 0) {
      // The toggle key is owned HERE and nowhere else. Handling it in both the caller
      // and PadTest.update() meant a single press opened and closed the overlay within
      // one frame, so it appeared completely dead.
      const kb = this.input.keyboard;
      if (kb.wasCodePressed('KeyG') || kb.wasCodePressed('F1')) this.padTest.toggle();
      if (this.padTest.open) {
        this.padTest.update(this.input);
        return;
      }
      if (kb.wasCodePressed('Tab')) this.setup.toggle();
      if (this.setup.open) {
        this.setup.update(this.input);
        return;
      }
      // Rules changed while the screen was open: rebuild the level under them, because
      // a disabled monster family has to actually stop existing.
      if (this.setup.dirty) {
        this.setup.dirty = false;
        this.run.applyRules(cloneRules(this.setup.rules));
        this.run.world.fireModel = this.fireModel;
      }
      this.devHotkeys();
    } else if (this.padTest.open || this.setup.open) {
      return;
    }

    if (a.pausePressed) this.paused = !this.paused;
    if (this.paused) return;

    this.world.step(a);
    this.world.fireModel = this.fireModel;
    this.run.step();
  }

  private devHotkeys(): void {
    const kb = this.input.keyboard;

    if (kb.wasCodePressed('KeyO')) {
      const i = FIRE_CYCLE.indexOf(this.fireModel);
      this.fireModel = FIRE_CYCLE[(i + 1) % FIRE_CYCLE.length]!;
      this.world.fireModel = this.fireModel;
    }
    for (let i = 0; i < CLASS_ORDER.length; i++) {
      if (kb.wasCodePressed(`Digit${i + 1}`)) {
        this.classId = CLASS_ORDER[i]!;
        this.reset();
      }
    }
    if (kb.wasCodePressed('KeyR')) this.reset();
    if (kb.wasCodePressed('KeyN')) this.skipLevel();
    if (kb.wasCodePressed('KeyT')) this.toggleProving();
    if (kb.wasCodePressed('BracketRight')) this.display.cycleScale(1);
    if (kb.wasCodePressed('BracketLeft')) this.display.cycleScale(-1);
    if (kb.wasCodePressed('KeyF')) {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  private reset(): void {
    this.run = new Run(this.campaign, this.classId, this.seed, 0, this.setup.rules);
    this.run.world.fireModel = this.fireModel;
  }

  /** Dev: jump straight to the next level without finding the exit. */
  private skipLevel(): void {
    this.run.advance();
    this.run.world.fireModel = this.fireModel;
  }

  /** Dev: swap to the systems-testing proving ground and back. */
  private toggleProving(): void {
    this.campaign = this.campaign === CAMPAIGN ? [PROVING] : CAMPAIGN;
    this.reset();
  }

  draw(): void {
    this.animFrame++;
    const { ctx, layout } = this.display;
    const pf = layout.playfield;

    ctx.fillStyle = '#07070a';
    ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);

    this.tilemap.draw(ctx, this.world.terrain, this.world.camera, layout);

    // entities
    ctx.save();
    ctx.beginPath();
    ctx.rect(pf.x, pf.y, pf.w, pf.h);
    ctx.clip();
    const p = this.world.player;
    const px = layout.pxPerWu;
    const camX = Math.round(this.world.camera.x * px);
    const camY = Math.round(this.world.camera.y * px);
    const toX = (wx: number) => pf.x + Math.round(wx * px) - camX;
    const toY = (wy: number) => pf.y + Math.round(wy * px) - camY;

    for (const it of this.world.items) {
      if (it.alive) drawItem(ctx, it, toX(it.x), toY(it.y), px, this.animFrame);
    }
    for (const g of this.world.generators) {
      if (g.alive) drawGenerator(ctx, g, toX(g.x), toY(g.y), px, this.animFrame);
    }

    // Depth-sort entities by y so overlaps read correctly.
    const sorted = this.world.monsters.filter((m) => m.alive).sort((a, b) => a.y - b.y);
    let drewPlayer = false;
    for (const m of sorted) {
      if (!drewPlayer && m.y > p.y) {
        drawPlayer(ctx, p, toX(p.x), toY(p.y), px, this.animFrame);
        drewPlayer = true;
      }
      drawMonster(ctx, m, toX(m.x), toY(m.y), px, this.animFrame);
    }
    if (!drewPlayer) drawPlayer(ctx, p, toX(p.x), toY(p.y), px, this.animFrame);

    for (const d of this.world.deaths) {
      if (d.alive) drawDeath(ctx, d, toX(d.x), toY(d.y), px, this.animFrame);
    }
    for (const t of this.world.thieves) {
      if (t.alive) drawThief(ctx, t, toX(t.x), toY(t.y), px, this.animFrame);
    }
    for (const pr of this.world.projectiles) {
      if (pr.alive) drawProjectile(ctx, pr, toX(pr.x), toY(pr.y), px);
    }
    ctx.restore();

    if (p.damageFlash > 0) {
      ctx.save();
      ctx.globalAlpha = (p.damageFlash / 8) * 0.35;
      ctx.fillStyle = '#ff2020';
      ctx.fillRect(pf.x, pf.y, pf.w, pf.h);
      ctx.restore();
    }

    // playfield border, so the locked gameplay viewport is visible as a deliberate frame
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = Math.max(1, layout.dpr);
    ctx.strokeRect(pf.x + 0.5, pf.y + 0.5, pf.w - 1, pf.h - 1);

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
    this.padTest.draw(ctx, layout, this.input);
    this.setup.draw(ctx, layout);
  }

  /** An altered run must never be able to look like a real one, so the tier is shown
   *  in-game whenever it is not Arcade. Derived, never stored. */
  private drawTierBadge(
    ctx: CanvasRenderingContext2D,
    layout: import('@/engine/display').Layout,
  ): void {
    if (this.setup.open || this.padTest.open) return;
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
    if (this.padTest.open) return;
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
