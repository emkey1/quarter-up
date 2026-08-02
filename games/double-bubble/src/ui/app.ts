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
import { Fx } from '@/render/fx';
import {
  ANGER_STEPS,
  buildBaronSprites,
  buildBubbleSprites,
  buildMonsterSprites,
  buildPlayerSprites,
  buildProjectileSprites,
  SPRITE_PX,
  type MonsterSprites,
  type PlayerSprites,
} from '@/render/sprites';
import type { ProjectileKind } from '@/data/roster';

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

/** Above this many lives the HUD counts rather than drawing one glyph each. */
const HEART_CAP = 5;

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
  private readonly baronArt: HTMLCanvasElement[];
  private readonly shotArt: Record<ProjectileKind, HTMLCanvasElement>;
  private readonly fx = new Fx();

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
    this.baronArt = buildBaronSprites();
    this.shotArt = buildProjectileSprites();
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
    this.fx.clear();
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
    // Drained every step rather than every frame, so a burst is never missed when the
    // loop catches up on a backlog and steps twice between draws.
    this.fx.consume(this.world.events);
    this.fx.step();
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
    this.drawShots(ctx, layout);
    this.drawBubbles(ctx, layout);
    this.drawBaron(ctx, layout);
    // Over everything in the room, but still inside the clip — a burst at the edge
    // must not spray across the HUD.
    this.fx.draw(ctx, layout);

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
      const set = this.monsterArt.byKind[m.kind][m.angry ? 1 : 0];
      const art = set[step][m.dir < 0 ? 0 : 1];
      this.blit(ctx, layout, art, m.body.x, m.body.y + m.body.halfH);
    }
  }

  private drawShots(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const { playfield, pxPerWu } = layout;
    for (const p of this.world.projectiles) {
      const art = this.shotArt[p.kind];
      const wu = art.width / T.ART_SCALE;
      ctx.drawImage(
        art,
        playfield.x + (p.x - wu / 2) * pxPerWu,
        playfield.y + (p.y - wu / 2) * pxPerWu,
        wu * pxPerWu,
        wu * pxPerWu,
      );
    }
  }

  private drawBaron(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const b = this.world.baron;
    if (!b) return;
    const { playfield, pxPerWu } = layout;
    const step = Math.floor(this.world.frame / 6) % 2;
    ctx.drawImage(
      this.baronArt[step],
      playfield.x + (b.x - SPRITE_WU / 2) * pxPerWu,
      playfield.y + (b.y - SPRITE_WU / 2) * pxPerWu,
      SPRITE_WU * pxPerWu,
      SPRITE_WU * pxPerWu,
    );
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

    const top = pf.y - Math.round(18 * s);
    const score = w.score.points.toLocaleString();
    // Hearts stop being countable past a handful, and repeating a glyph unbounded lets
    // an extra-life run push a 99-character string through a width test that then hides
    // the rest of the HUD. Past the cap, say the number.
    const lives = Math.max(0, w.score.lives);
    const hearts = lives <= HEART_CAP ? '♥'.repeat(lives) : `♥ x${lives}`;
    const centre = `ROOM ${String(this.roomNumber).padStart(3, '0')}   ${w.liveMonsters.length} left   ${hearts}`;
    const pad = this.devices.gamepad.status;
    const device = pad.connected ? pad.label : `${this.devices.lastDevice} — no pad`;

    // Three labels on one line collide as soon as the playfield narrows — the device
    // label is the least important, so it goes first, and the centre block after it.
    //
    // The test has to be against ANCHORED positions, not packed widths. These are
    // left-, centre- and right-aligned, so the centre block sits at the midpoint however
    // short the score is; summing the three widths says they fit while the centred
    // string still runs into the right-aligned one. With a score of "0" that is a 50px
    // overlap on a 512px playfield that the packed sum passes comfortably.
    const gap = Math.round(12 * s);
    const wScore = ctx.measureText(score).width;
    const wCentre = ctx.measureText(centre).width;
    const wDevice = ctx.measureText(device).width;

    const centreLeft = pf.w / 2 - wCentre / 2;
    const centreRight = pf.w / 2 + wCentre / 2;
    const showCentre = wScore + gap <= centreLeft;
    const showDevice = showCentre && centreRight + gap <= pf.w - wDevice;

    ctx.fillStyle = '#cfd2d6';
    ctx.textAlign = 'left';
    ctx.fillText(score, pf.x, top);

    ctx.fillStyle = '#8a9099';
    if (showCentre) {
      ctx.textAlign = 'center';
      ctx.fillText(centre, pf.x + pf.w / 2, top);
    }
    if (showDevice) {
      ctx.textAlign = 'right';
      ctx.fillText(device, pf.x + pf.w, top);
    }

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
