import { CLASS_ORDER, type ClassId } from '@/data/classes';
import type { Display } from '@/engine/display';
import type { Input } from '@/engine/input';
import { defaultFireModel, type FireModel } from '@/engine/input';
import type { LoopHost } from '@/engine/loop';
import type { Loop } from '@/engine/loop';
import { World } from '@/game/world';
import type { LevelData } from '@/game/level';
import { drawPlayer } from '@/render/entities';
import { Hud } from '@/render/hud';
import { TilemapRenderer } from '@/render/tilemap';
import { theme } from '@/render/theme';
import { PadTest } from './padtest';

const FIRE_CYCLE: FireModel[] = ['arcade', 'feathered', 'free', 'twinstick'];

export class PlayScreen implements LoopHost {
  private world: World;
  private tilemap: TilemapRenderer;
  private hud = new Hud();
  private padTest = new PadTest();
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
    private readonly level: LevelData,
    classId: ClassId = 'elf',
  ) {
    this.classId = classId;
    this.fireModel = defaultFireModel(input.lastDevice);
    this.world = new World(level, classId, this.seed);
    this.world.fireModel = this.fireModel;
    this.tilemap = new TilemapRenderer(theme(level.theme), display.layout.pxPerWu);
    display.onLayoutChange((l) => this.tilemap.onLayoutChange(theme(level.theme), l.pxPerWu));
  }

  poll(): void {
    this.input.poll();
  }

  step(stepIndex: number): void {
    const a = this.input.sample(stepIndex);

    if (stepIndex === 0) {
      if (this.input.keyboard.wasCodePressed('KeyG') && !this.padTest.open) this.padTest.toggle();
      if (this.padTest.update(this.input)) return;
      this.devHotkeys();
    } else if (this.padTest.open) {
      return;
    }

    if (a.pausePressed) this.paused = !this.paused;
    if (this.paused) return;

    this.world.step(a);
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
    if (kb.wasCodePressed('BracketRight')) this.display.cycleScale(1);
    if (kb.wasCodePressed('BracketLeft')) this.display.cycleScale(-1);
    if (kb.wasCodePressed('KeyF')) {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  private reset(): void {
    this.world = new World(this.level, this.classId, this.seed);
    this.world.fireModel = this.fireModel;
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
    drawPlayer(
      ctx,
      p,
      pf.x + Math.round(p.x * px) - camX,
      pf.y + Math.round(p.y * px) - camY,
      px,
      this.animFrame,
    );
    ctx.restore();

    // playfield border, so the locked gameplay viewport is visible as a deliberate frame
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = Math.max(1, layout.dpr);
    ctx.strokeRect(pf.x + 0.5, pf.y + 0.5, pf.w - 1, pf.h - 1);

    this.hud.draw(ctx, layout, this.world, this.input, this.fireModel, {
      fps: this.loop?.stats.fps ?? 0,
      steps: this.loop?.stats.stepsLastFrame ?? 0,
      frameMs: this.loop?.stats.frameMs ?? 0,
      stepMs: this.loop?.stats.stepMs ?? 0,
      drawMs: this.loop?.stats.drawMs ?? 0,
    });

    if (this.paused) this.drawPaused(ctx, layout.playfield, layout.uiScale);
    this.drawPadHint(ctx, layout);
    this.padTest.draw(ctx, layout, this.input);
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
