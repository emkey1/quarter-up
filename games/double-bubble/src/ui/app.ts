import type { LoopHost } from '@/engine/loop';
import type { Display, Layout } from '@/engine/display';
import type { Devices } from '@/engine/devices';
import {
  emptyActions,
  sampleActions,
  type Action,
  type ActionState,
} from '@/game/controls';
import type { RoomData } from '@/game/room';
import { buildTileSet, type TileSet } from '@/render/tiles';
import { themeForRoom, type Theme } from '@/render/theme';
import { drawRoom, drawStartMarker } from '@/render/room';

/**
 * The cabinet shell.
 *
 * M0 scope: hold a room, draw it, and prove the loop, the input stack and the display
 * scaling all survived the copy from Bracer. There is no simulation yet — `step` counts
 * frames and reads the pad so that both are exercised, and nothing moves until M1 puts
 * physics behind it.
 */
export class App implements LoopHost {
  private readonly actions: ActionState = emptyActions();
  private frame = 0;

  private room: RoomData;
  private roomNumber: number;
  private theme: Theme;
  private tiles: TileSet;

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
  }

  /** Swap the room in place — the editor's playtest hook, and how M1 will advance. */
  setRoom(room: RoomData, roomNumber: number): void {
    this.room = room;
    this.roomNumber = roomNumber;
    const theme = themeForRoom(roomNumber);
    // Rebuilding 32 canvases is only worth it when the palette actually changed.
    if (theme !== this.theme) {
      this.theme = theme;
      this.tiles = buildTileSet(theme);
    }
  }

  poll(): void {
    this.devices.poll();
  }

  step(stepIndex: number): void {
    sampleActions(this.devices, this.actions, stepIndex);
    this.frame++;
  }

  draw(): void {
    const ctx = this.display.ctx;
    const layout = this.display.layout;

    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);

    drawRoom(ctx, layout, this.room, this.tiles, this.theme);
    drawStartMarker(ctx, layout, this.room, this.frame);

    this.drawFrame(ctx, layout);
    this.drawStatus(ctx, layout);
  }

  /** A hairline around the playfield, so the room reads as a screen rather than as
   *  art bleeding into the page background. */
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

    const label = `ROOM ${String(this.roomNumber).padStart(3, '0')} — ${this.theme.name}`;
    ctx.fillText(label, pf.x, pf.y - Math.round(18 * s));

    const pad = this.devices.gamepad.status;
    const right = pad.connected ? pad.label : `${this.devices.lastDevice} — no pad`;
    ctx.textAlign = 'right';
    ctx.fillText(right, pf.x + pf.w, pf.y - Math.round(18 * s));

    ctx.textAlign = 'left';
    ctx.fillStyle = '#5a6068';
    ctx.fillText(
      'M0 — static room. Physics lands in M1.',
      pf.x,
      pf.y + pf.h + Math.round(8 * s),
    );
    ctx.restore();
  }
}
