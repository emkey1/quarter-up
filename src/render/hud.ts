import { T } from '@/data/tuning';
import { CLASSES, UPGRADES } from '@/data/classes';
import type { Layout, Rect } from '@/engine/display';
import type { Input } from '@/engine/input';
import { FIRE_MODELS, type FireModel } from '@/engine/input';
import type { World } from '@/game/world';
import type { Run } from '@/game/flow';

export interface HudDebug {
  fps: number;
  steps: number;
  frameMs: number;
  stepMs: number;
  drawMs: number;
}

const FG = '#d7dbe0';

/**
 * M0 HUD. The right flank is the real single-player panel from DESIGN.md §6.2; the
 * left flank is a development readout that goes away at M4.
 */
export class Hud {
  draw(
    ctx: CanvasRenderingContext2D,
    layout: Layout,
    world: World,
    run: Run,
    input: Input,
    fireModel: FireModel,
    dbg: HudDebug,
  ): void {
    if (layout.rightPanel) this.drawStatus(ctx, layout.rightPanel, layout, world, run);
    if (layout.leftPanel)
      this.drawDebug(ctx, layout.leftPanel, layout, world, run, input, fireModel, dbg);
    this.drawToast(ctx, layout, input);
  }

  private drawStatus(
    ctx: CanvasRenderingContext2D,
    r: Rect,
    layout: Layout,
    world: World,
    run: Run,
  ): void {
    const p = world.player;
    const cls = CLASSES[p.classId];
    const s = layout.uiScale;
    const pad = 14 * s;
    let y = r.y + pad + 12 * s;

    const title = (t: string, size: number, colour: string) => {
      ctx.fillStyle = colour;
      ctx.font = `600 ${size * s}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillText(t, r.x + pad, y);
      y += size * s * 1.5;
    };
    const label = (t: string) => {
      y += 4 * s; // breathing room under the previous value's descenders
      ctx.fillStyle = 'rgba(215,219,224,.5)';
      ctx.font = `500 ${9 * s}px ui-sans-serif, system-ui, sans-serif`;
      ctx.letterSpacing = `${1.2 * s}px`;
      ctx.fillText(t.toUpperCase(), r.x + pad, y);
      ctx.letterSpacing = '0px';
      y += 16 * s;
    };
    const value = (t: string, colour = FG) => {
      ctx.fillStyle = colour;
      ctx.font = `700 ${20 * s}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.fillText(t, r.x + pad, y);
      y += 24 * s;
    };

    ctx.textBaseline = 'alphabetic';
    title('BRACER', 15, 'rgba(215,219,224,.35)');
    label(run.levelName);
    value(String(run.depth));
    y += 6 * s;

    title(cls.name.toUpperCase(), 15, cls.colour);
    label('Score');
    value(String(p.score).padStart(6, '0'));

    label('Health');
    const critical = p.health < T.LOW_HEALTH_WARN;
    value(String(Math.max(0, Math.ceil(p.health))), critical ? '#ff6b5e' : FG);

    // health bar, relative to a full credit
    const bw = r.w - pad * 2;
    const bh = 6 * s;
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    ctx.fillRect(r.x + pad, y - 18 * s, bw, bh);
    const frac = Math.max(0, Math.min(1, p.health / T.START_HEALTH));
    ctx.fillStyle = critical ? '#ff6b5e' : cls.colour;
    ctx.fillRect(r.x + pad, y - 18 * s, bw * frac, bh);
    y += 12 * s;

    label(`Inventory ${p.inventoryUsed}/${T.INVENTORY_SLOTS}`);
    this.slots(ctx, r.x + pad, y - 8 * s, bw, s, p.keys, p.potions);
    y += 22 * s;

    label('Upgrades');
    this.upgradeSlots(ctx, r.x + pad, y - 8 * s, s, world);
    y += 24 * s;

    label('Credits');
    value(String(p.credits));
  }

  /** The 12 shared key/potion slots the arcade never showed. */
  private slots(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    s: number,
    keys: number,
    potions: number,
  ): void {
    const n = T.INVENTORY_SLOTS;
    const gap = 3 * s;
    const size = Math.min(14 * s, (w - gap * (n - 1)) / n);
    for (let i = 0; i < n; i++) {
      const bx = x + i * (size + gap);
      const filled = i < keys ? 'key' : i < keys + potions ? 'potion' : null;
      ctx.fillStyle =
        filled === 'key' ? '#e0c060' : filled === 'potion' ? '#6bc8f5' : 'rgba(255,255,255,.08)';
      ctx.fillRect(bx, y, size, size);
    }
  }

  private upgradeSlots(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    s: number,
    world: World,
  ): void {
    const size = 16 * s;
    const gap = 4 * s;
    UPGRADES.forEach((u, i) => {
      const bx = x + i * (size + gap);
      const owned = world.player.upgrades.has(u);
      ctx.fillStyle = owned ? '#b98bf0' : 'rgba(255,255,255,.07)';
      ctx.fillRect(bx, y, size, size);
      ctx.fillStyle = owned ? '#120b1c' : 'rgba(255,255,255,.28)';
      ctx.font = `700 ${9 * s}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(u[0]!.toUpperCase(), bx + size / 2, y + size * 0.72);
      ctx.textAlign = 'left';
    });
  }

  private drawDebug(
    ctx: CanvasRenderingContext2D,
    r: Rect,
    layout: Layout,
    world: World,
    run: Run,
    input: Input,
    fireModel: FireModel,
    dbg: HudDebug,
  ): void {
    const s = layout.uiScale;
    const pad = 12 * s;
    let y = r.y + pad + 10 * s;
    const p = world.player;

    const line = (k: string, v: string, colour = FG) => {
      ctx.font = `500 ${10 * s}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.fillStyle = 'rgba(215,219,224,.42)';
      ctx.fillText(k, r.x + pad, y);
      ctx.fillStyle = colour;
      ctx.textAlign = 'right';
      ctx.fillText(v, r.x + r.w - pad, y);
      ctx.textAlign = 'left';
      y += 14 * s;
    };
    const head = (t: string) => {
      y += 6 * s;
      ctx.font = `600 ${9 * s}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(215,219,224,.3)';
      ctx.letterSpacing = `${1.2 * s}px`;
      ctx.fillText(t.toUpperCase(), r.x + pad, y);
      ctx.letterSpacing = '0px';
      y += 14 * s;
    };

    head('perf');
    line('fps', dbg.fps.toFixed(1), dbg.fps < 55 ? '#ff6b5e' : FG);
    line('steps/frame', String(dbg.steps), dbg.steps > 1 ? '#e8c34a' : FG);
    line('step ms', dbg.stepMs.toFixed(2));
    line('draw ms', dbg.drawMs.toFixed(2));

    head('input');
    line('device', input.lastDevice, input.lastDevice === 'gamepad' ? '#4fbf5f' : FG);
    line(
      'pad',
      input.gamepad.status.connected
        ? input.gamepad.status.standard
          ? 'standard'
          : 'non-standard'
        : 'none',
      input.gamepad.status.connected ? '#4fbf5f' : 'rgba(215,219,224,.4)',
    );
    line('fire model', FIRE_MODELS[fireModel].label);
    line('rollover', String(input.keyboard.concurrentKeys()));

    head('sim');
    line('level', `${run.depth} ${run.levelName}`);
    line('monsters', String(world.liveMonsters));
    line('generators', String(world.generators.filter((g) => g.alive).length));
    line('items', String(world.items.filter((i) => i.alive).length));
    line('doors in', `${Math.max(0, doorSecs(world) - world.engagementFrames / T.STEP_HZ).toFixed(0)}s`);
    line('walls->exit', `${Math.max(0, T.WALLS_BECOME_EXITS_SEC - world.player.stillFrames / T.STEP_HZ).toFixed(0)}s`);
    line('frame', String(world.frame));
    line('elapsed', `${world.elapsed.toFixed(1)}s`);
    line('pos wu', `${p.x.toFixed(1)}, ${p.y.toFixed(1)}`);
    line('cell', `${Math.floor(p.x / T.TILE)}, ${Math.floor(p.y / T.TILE)}`);
    line('speed', `${p.speedWuPerFrame.toFixed(2)} wu/f`);
    line('facing', String(p.facing));
    line('rooted', p.rooted ? 'YES' : 'no', p.rooted ? '#e8c34a' : FG);
    line('corner assist', p.assisted ? 'FIRED' : '-', p.assisted ? '#6bc8f5' : FG);
    line('still', `${(p.stillFrames / T.STEP_HZ).toFixed(1)}s`);

    head('display');
    line('scale', `${layout.scale}x  dpr ${layout.dpr}`);
    line('px/wu', String(layout.pxPerWu));
    line('playfield', `${layout.playfield.w}x${layout.playfield.h}`);

    head('keys');
    ctx.font = `500 ${9 * s}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(215,219,224,.42)';
    for (const t of [
      'move  arrows / WASD / pad',
      'fire  space / A / RT',
      'magic shift / B / LT',
      'O  fire model   G  controller',
      '1-4 class   N next level',
      'T  proving ground   R reset',
    ]) {
      ctx.fillText(t, r.x + pad, y);
      y += 12 * s;
    }
  }

  private drawToast(ctx: CanvasRenderingContext2D, layout: Layout, input: Input): void {
    const t = input.gamepad.statusChangedAt;
    if (t < 0) return;
    const age = (performance.now() - t) / 1000;
    if (age > 3) return;
    const alpha = age > 2.5 ? 1 - (age - 2.5) / 0.5 : 1;
    const s = layout.uiScale;
    const pf = layout.playfield;
    const msg = input.gamepad.status.connected
      ? `Controller connected — ${input.gamepad.status.label}`
      : 'Controller disconnected';

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `600 ${11 * s}px ui-sans-serif, system-ui, sans-serif`;
    const w = ctx.measureText(msg).width + 24 * s;
    const h = 26 * s;
    const x = pf.x + (pf.w - w) / 2;
    const y = pf.y + pf.h - h - 16 * s;
    ctx.fillStyle = 'rgba(12,14,18,.88)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.lineWidth = Math.max(1, s * 0.5);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = FG;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(msg, x + w / 2, y + h / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }
}

/** Seconds before the doors give up, which doubles while holding keys. */
function doorSecs(w: World): number {
  return w.player.keys > 0 ? T.DOOR_AUTO_OPEN_SEC_WITH_KEYS : T.DOOR_AUTO_OPEN_SEC;
}
