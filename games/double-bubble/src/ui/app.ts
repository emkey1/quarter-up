import type { LoopHost } from '@/engine/loop';
import type { Display, Layout } from '@/engine/display';
import type { Devices } from '@/engine/devices';
import { emptyActions, sampleActions, type Action, type ActionState } from '@/game/controls';
import type { RoomData } from '@/game/room';
import { World } from '@/game/world';
import { anger } from '@/game/bubble';
import { predictJump } from '@/game/physics';
import { T } from '@/data/tuning';
import { buildTileSet, type TileSet } from '@/render/tiles';
import { themeForRoom, type Theme } from '@/render/theme';
import { drawRoom } from '@/render/room';
import {
  ANGER_STEPS,
  buildBubbleSprites,
  buildMonsterSprites,
  buildPlayerSprites,
  SPRITE_PX,
  type MonsterSprites,
  type PlayerSprites,
} from '@/render/sprites';

/** Frames per walk-cycle frame. */
const RUN_ANIM_PERIOD = 7;
const MONSTER_ANIM_PERIOD = 9;

/**
 * The sprite's feet sit a shade above its bottom edge, so aligning the art box to the
 * body's underside would float it. Measured off the generated frame, in world units.
 */
const FOOT_INSET_WU = 0.75;

/** Sprite boxes are square and sized in world units. */
const SPRITE_WU = SPRITE_PX / T.ART_SCALE;

/**
 * The cabinet shell and the play loop.
 *
 * M2 scope: bubbles — lifecycle, drift, riding, pushing and chain pops — against
 * Zen-Chan. The rest of the roster, the Baron and the hurry-up chase are M3.
 */
export class App implements LoopHost {
  private readonly actions: ActionState = emptyActions();

  private world: World;
  private roomNumber: number;
  private theme: Theme;
  private tiles: TileSet;
  private readonly playerArt: PlayerSprites;
  private readonly monsterArt: MonsterSprites;
  private readonly bubbleArt: HTMLCanvasElement[];

  /** The M1 measurement readout. Toggled with F1. */
  showMeter = false;

  constructor(
    private readonly display: Display,
    private readonly devices: Devices<Action>,
    private room: RoomData,
    roomNumber = 1,
  ) {
    this.roomNumber = roomNumber;
    this.theme = themeForRoom(roomNumber);
    this.tiles = buildTileSet(this.theme);
    this.playerArt = buildPlayerSprites();
    this.monsterArt = buildMonsterSprites();
    this.bubbleArt = buildBubbleSprites();
    this.world = new World(room, roomNumber);
  }

  /** Swap the room in place — the editor's playtest hook, and how M5 will advance. */
  setRoom(room: RoomData, roomNumber: number): void {
    this.room = room;
    this.roomNumber = roomNumber;
    const theme = themeForRoom(roomNumber);
    if (theme !== this.theme) {
      this.theme = theme;
      this.tiles = buildTileSet(theme);
    }
    this.world = new World(room, roomNumber);
  }

  poll(): void {
    this.devices.poll();
  }

  step(stepIndex: number): void {
    const a = sampleActions(this.devices, this.actions, stepIndex);

    if (stepIndex === 0) {
      if (this.devices.keyboard.wasCodePressed('F1')) this.showMeter = !this.showMeter;
      if (this.devices.keyboard.wasCodePressed('KeyR')) this.setRoom(this.room, this.roomNumber);
    }

    this.world.step(a);
  }

  draw(): void {
    const ctx = this.display.ctx;
    const layout = this.display.layout;

    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);

    drawRoom(ctx, layout, this.room, this.tiles, this.theme);

    ctx.save();
    ctx.beginPath();
    ctx.rect(layout.playfield.x, layout.playfield.y, layout.playfield.w, layout.playfield.h);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;

    // Monsters first, then the player, then bubbles over the top — so a captive shows
    // through the rim of the bubble holding it.
    this.drawMonsters(ctx, layout);
    this.drawPlayer(ctx, layout);
    this.drawBubbles(ctx, layout);

    ctx.restore();

    this.drawFrame(ctx, layout);
    this.drawHud(ctx, layout);
    if (this.showMeter) this.drawMeter(ctx, layout);
  }

  /** Blit a square sprite box centred on a world position, bottom-aligned to `footY`. */
  private blit(
    ctx: CanvasRenderingContext2D,
    layout: Layout,
    art: HTMLCanvasElement,
    x: number,
    footY: number,
  ): void {
    const { playfield, pxPerWu } = layout;
    const left = x - SPRITE_WU / 2;
    const top = footY + FOOT_INSET_WU - SPRITE_WU;
    ctx.drawImage(
      art,
      playfield.x + left * pxPerWu,
      playfield.y + top * pxPerWu,
      SPRITE_WU * pxPerWu,
      SPRITE_WU * pxPerWu,
    );
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const p = this.world.player;
    const list = this.playerArt.frames[p.pose];
    const idx = p.pose === 'run' ? Math.floor(p.animFrame / RUN_ANIM_PERIOD) % list.length : 0;
    this.blit(ctx, layout, list[idx][p.facing < 0 ? 0 : 1], p.body.x, p.body.y + p.body.halfH);
  }

  private drawMonsters(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const step = Math.floor(this.world.frame / MONSTER_ANIM_PERIOD) % 2;
    for (const m of this.world.monsters) {
      if (m.state === 'dead') continue;
      const set = this.monsterArt.zenchan[m.angry ? 1 : 0];
      const art = set[step][m.dir < 0 ? 0 : 1];
      this.blit(ctx, layout, art, m.body.x, m.body.y + m.body.halfH);
    }
  }

  private drawBubbles(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const { playfield, pxPerWu } = layout;
    for (const b of this.world.bubbles) {
      const step = Math.min(ANGER_STEPS - 1, Math.round(anger(b) * (ANGER_STEPS - 1)));
      const art = this.bubbleArt[step];
      ctx.drawImage(
        art,
        playfield.x + (b.x - SPRITE_WU / 2) * pxPerWu,
        playfield.y + (b.y - SPRITE_WU / 2) * pxPerWu,
        SPRITE_WU * pxPerWu,
        SPRITE_WU * pxPerWu,
      );
    }
  }

  /** A hairline around the playfield, so the room reads as a screen rather than as art
   *  bleeding into the page background. */
  private drawFrame(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const pf = layout.playfield;
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.lineWidth = Math.max(1, layout.dpr);
    ctx.strokeRect(pf.x - 0.5, pf.y - 0.5, pf.w + 1, pf.h + 1);
  }

  private drawHud(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const pf = layout.playfield;
    const s = layout.uiScale;
    const w = this.world;

    ctx.save();
    ctx.textBaseline = 'top';
    ctx.font = `${Math.round(11 * s)}px ui-sans-serif, system-ui, sans-serif`;

    ctx.fillStyle = '#cfd2d6';
    ctx.fillText(w.score.points.toLocaleString(), pf.x, pf.y - Math.round(18 * s));

    ctx.fillStyle = '#8a9099';
    ctx.textAlign = 'center';
    ctx.fillText(
      `ROOM ${String(this.roomNumber).padStart(3, '0')}   ${w.liveMonsters.length} left   ${'♥'.repeat(Math.max(0, w.score.lives))}`,
      pf.x + pf.w / 2,
      pf.y - Math.round(18 * s),
    );

    ctx.textAlign = 'right';
    const pad = this.devices.gamepad.status;
    ctx.fillText(
      pad.connected ? pad.label : `${this.devices.lastDevice} — no pad`,
      pf.x + pf.w,
      pf.y - Math.round(18 * s),
    );

    ctx.textAlign = 'left';
    ctx.fillStyle = '#5a6068';
    ctx.fillText(
      'M2 — arrows / A D move, Space jump, J blow.   R reset   F1 meter',
      pf.x,
      pf.y + pf.h + Math.round(8 * s),
    );

    if (w.lastChain.monsters > 1) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffb638';
      ctx.fillText(
        `${w.lastChain.monsters}-chain  ${w.lastChain.points.toLocaleString()}` +
          (w.lastChain.letters ? `  +${w.lastChain.letters} EXTEND` : ''),
        pf.x + pf.w,
        pf.y + pf.h + Math.round(8 * s),
      );
    }
    ctx.restore();

    if (w.hurryUp && w.phase === 'playing') this.drawBanner(ctx, layout, 'HURRY UP!', '#ff5b4a');
    if (w.phase === 'cleared') this.drawBanner(ctx, layout, 'ROOM CLEAR', '#6fe3c4');
    if (w.phase === 'dead') this.drawBanner(ctx, layout, 'GAME OVER', '#8a9099');
  }

  private drawBanner(
    ctx: CanvasRenderingContext2D,
    layout: Layout,
    text: string,
    colour: string,
  ): void {
    const pf = layout.playfield;
    const s = layout.uiScale;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(30 * s)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = colour;
    ctx.fillText(text, pf.x + pf.w / 2, pf.y + pf.h * 0.34);
    ctx.restore();
  }

  /**
   * The M1 fidelity readout.
   *
   * Apex in tiles and airborne frames are exactly what a frame-stepped reference clip
   * yields, so this is directly comparable against footage. The predicted column comes
   * from the constants analytically — if measured and predicted ever disagree, the
   * integrator is wrong, not the tuning.
   */
  private drawMeter(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const pf = layout.playfield;
    const s = layout.uiScale;
    const b = this.world.player.body;
    const j = this.world.player.jump;
    const pred = predictJump();

    const lines: [string, string, string][] = [
      ['apex', `${(j.lastApex / T.TILE).toFixed(2)} tiles`, `pred ${(pred.apex / T.TILE).toFixed(2)}`],
      ['airborne', `${j.lastAirtime}f`, `pred ${pred.airborneFrames}f`],
      ['pos', `${b.x.toFixed(1)}, ${b.y.toFixed(1)}`, b.onGround ? 'grounded' : 'airborne'],
      ['bubbles', `${this.world.bubbles.length}`, b.ridingIndex >= 0 ? 'riding' : ''],
    ];

    const pad = Math.round(10 * s);
    const lh = Math.round(15 * s);
    const w = Math.round(215 * s);
    const h = pad * 2 + lh * lines.length;
    const x = pf.x + pf.w - w - pad;
    const y = pf.y + pad;

    ctx.save();
    ctx.fillStyle = 'rgba(4,6,10,.78)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.font = `${Math.round(10 * s)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    lines.forEach(([label, value, note], i) => {
      const ly = y + pad + i * lh;
      ctx.fillStyle = '#6d7480';
      ctx.fillText(label, x + pad, ly);
      ctx.fillStyle = '#cfd2d6';
      ctx.fillText(value, x + pad + Math.round(52 * s), ly);
      ctx.fillStyle = '#5a6068';
      ctx.fillText(note, x + pad + Math.round(130 * s), ly);
    });
    ctx.restore();
  }
}
