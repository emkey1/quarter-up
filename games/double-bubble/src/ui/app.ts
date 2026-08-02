import type { LoopHost } from '@/engine/loop';
import type { Display, Layout } from '@/engine/display';
import type { Devices } from '@/engine/devices';
import { emptyActions, sampleActions, type Action, type ActionState } from '@/game/controls';
import type { RoomData } from '@/game/room';
import { Player } from '@/game/player';
import { predictJump } from '@/game/physics';
import { T } from '@/data/tuning';
import { buildTileSet, type TileSet } from '@/render/tiles';
import { themeForRoom, type Theme } from '@/render/theme';
import { drawRoom } from '@/render/room';
import { buildPlayerSprites, SPRITE_PX, type PlayerSprites } from '@/render/sprites';

/** Frames per walk-cycle frame. */
const RUN_ANIM_PERIOD = 7;

/**
 * The sprite's feet sit a shade above its bottom edge, so aligning the art box to the
 * body's underside would float it. Measured off the generated frame, in world units.
 */
const FOOT_INSET_WU = 0.75;

/**
 * The cabinet shell and the play loop.
 *
 * M1 scope: a player under gravity, in a room, with one-way platforms and the vertical
 * wrap. No bubbles, no monsters — those are M2 and M3.
 */
export class App implements LoopHost {
  private readonly actions: ActionState = emptyActions();
  private frame = 0;

  private room: RoomData;
  private roomNumber: number;
  private theme: Theme;
  private tiles: TileSet;
  private readonly sprites: PlayerSprites;
  private player: Player;

  /** The M1 measurement readout. Toggled with F1. */
  showMeter = true;

  constructor(
    private readonly display: Display,
    private readonly devices: Devices<Action>,
    room: RoomData,
    roomNumber = 1,
  ) {
    this.room = room;
    this.roomNumber = roomNumber;
    this.theme = themeForRoom(roomNumber);
    this.tiles = buildTileSet(this.theme);
    this.sprites = buildPlayerSprites();
    this.player = new Player(room.playerStart.x, room.playerStart.y);
  }

  /** Swap the room in place — the editor's playtest hook, and how M5 will advance. */
  setRoom(room: RoomData, roomNumber: number): void {
    this.room = room;
    this.roomNumber = roomNumber;
    const theme = themeForRoom(roomNumber);
    // Rebuilding 32 canvases is only worth it when the palette actually changed.
    if (theme !== this.theme) {
      this.theme = theme;
      this.tiles = buildTileSet(theme);
    }
    this.player = new Player(room.playerStart.x, room.playerStart.y);
  }

  poll(): void {
    this.devices.poll();
  }

  step(stepIndex: number): void {
    const a = sampleActions(this.devices, this.actions, stepIndex);

    if (stepIndex === 0 && this.devices.keyboard.wasCodePressed('F1')) {
      this.showMeter = !this.showMeter;
    }
    if (stepIndex === 0 && this.devices.keyboard.wasCodePressed('KeyR')) {
      this.player = new Player(this.room.playerStart.x, this.room.playerStart.y);
    }

    this.player.step(this.room, a);
    this.frame++;
  }

  draw(): void {
    const ctx = this.display.ctx;
    const layout = this.display.layout;

    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);

    drawRoom(ctx, layout, this.room, this.tiles, this.theme);
    this.drawPlayer(ctx, layout);

    this.drawFrame(ctx, layout);
    this.drawStatus(ctx, layout);
    if (this.showMeter) this.drawMeter(ctx, layout);
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const { playfield, pxPerWu } = layout;
    const p = this.player;
    const b = p.body;

    const list = this.sprites.frames[p.pose];
    const idx = p.pose === 'run' ? Math.floor(p.animFrame / RUN_ANIM_PERIOD) % list.length : 0;
    const art = list[idx][p.facing < 0 ? 0 : 1];

    const sizeWu = SPRITE_PX / T.ART_SCALE;
    const left = b.x - sizeWu / 2;
    const top = b.y + b.halfH + FOOT_INSET_WU - sizeWu;

    ctx.save();
    ctx.beginPath();
    ctx.rect(playfield.x, playfield.y, playfield.w, playfield.h);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      art,
      playfield.x + left * pxPerWu,
      playfield.y + top * pxPerWu,
      sizeWu * pxPerWu,
      sizeWu * pxPerWu,
    );
    ctx.restore();
  }

  /** A hairline around the playfield, so the room reads as a screen rather than as art
   *  bleeding into the page background. */
  private drawFrame(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const pf = layout.playfield;
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.lineWidth = Math.max(1, layout.dpr);
    ctx.strokeRect(pf.x - 0.5, pf.y - 0.5, pf.w + 1, pf.h + 1);
  }

  private drawStatus(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const pf = layout.playfield;
    const s = layout.uiScale;

    ctx.save();
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#8a9099';
    ctx.font = `${Math.round(11 * s)}px ui-sans-serif, system-ui, sans-serif`;

    ctx.fillText(
      `ROOM ${String(this.roomNumber).padStart(3, '0')} — ${this.theme.name}`,
      pf.x,
      pf.y - Math.round(18 * s),
    );

    const pad = this.devices.gamepad.status;
    ctx.textAlign = 'right';
    ctx.fillText(
      pad.connected ? pad.label : `${this.devices.lastDevice} — no pad`,
      pf.x + pf.w,
      pf.y - Math.round(18 * s),
    );

    ctx.textAlign = 'left';
    ctx.fillStyle = '#5a6068';
    ctx.fillText(
      'M1 — arrows / A D to move, Space to jump.   R reset   F1 meter',
      pf.x,
      pf.y + pf.h + Math.round(8 * s),
    );
    ctx.restore();
  }

  /**
   * The M1 fidelity readout.
   *
   * Apex in tiles and airtime in frames are exactly what a frame-stepped reference clip
   * yields, so this is directly comparable against footage rather than needing to be
   * converted first. The predicted column comes from the constants analytically — if
   * measured and predicted ever disagree, the integrator is wrong, not the tuning.
   */
  private drawMeter(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const pf = layout.playfield;
    const s = layout.uiScale;
    const b = this.player.body;
    const j = this.player.jump;

    const pred = predictJump();

    const lines: [string, string, string][] = [
      ['apex', `${(j.lastApex / T.TILE).toFixed(2)} tiles`, `pred ${(pred.apex / T.TILE).toFixed(2)}`],
      ['airborne', `${j.lastAirtime}f`, `pred ${pred.airborneFrames}f`],
      ['pos', `${b.x.toFixed(1)}, ${b.y.toFixed(1)}`, b.onGround ? 'grounded' : 'airborne'],
      ['vel', `${b.vx.toFixed(2)}, ${b.vy.toFixed(2)}`, ''],
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
