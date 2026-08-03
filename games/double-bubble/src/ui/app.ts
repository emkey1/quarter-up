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
  buildElementSprites,
  buildItemSprites,
  buildProjectileSprites,
  buildBossSprites,
  buildSpecialBubbleSprites,
  SPRITE_PX,
  type BossSprites,
  type MonsterSprites,
  type PlayerSprites,
} from '@/render/sprites';
import type { ProjectileKind } from '@/data/roster';
import type { SpecialBubble } from '@/game/room';
import { tierFor, type ItemKind } from '@/data/items';
import { readCounters } from '@/game/counters';
import { EXTEND_WORD, hasLetter } from '@/game/score';
import { Audio } from '@/engine/audio';
import {
  advance,
  doorFor,
  SILVER_DOOR_ROOMS,
  newCampaign,
  persist,
  recordDeath,
  secretRoomFor,
  type CampaignState,
} from '@/game/campaign';
import { roomFor, secretRoom } from '@/data/rooms';

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
  private readonly itemArt: Partial<Record<ItemKind, HTMLCanvasElement>>;
  private readonly specialArt: Record<SpecialBubble, HTMLCanvasElement>;
  private readonly elementArt: ReturnType<typeof buildElementSprites>;
  private readonly bossArt: BossSprites;
  private readonly fx = new Fx();

  /** The counter readout. Toggled with F2. Without it the hidden system is untestable
   *  by hand — you cannot tell whether jumping is counted except by jumping 35 times. */
  showCounters = false;

  /** The M1 measurement readout. Toggled with F1. */
  showMeter = false;

  /** The run. Owns the room number, the score, the counters and the deathless flags. */
  private readonly campaign: CampaignState = newCampaign();
  /** Frames the between-rooms card is held before the next room loads. */
  private interlude = 0;
  private interludeText = '';
  /** The secret room being visited, if any — the campaign returns here afterwards. */
  private inSecret: number | null = null;
  /** Set when the cave was beaten the hard way. See §4 on why this replaces the
   *  original's two-player gate. */
  private trueEnding = false;

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
    this.itemArt = buildItemSprites();
    this.specialArt = buildSpecialBubbleSprites();
    this.elementArt = buildElementSprites();
    this.bossArt = buildBossSprites();
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
    this.audio.play('roomStart');
  }

  readonly audio = new Audio();
  /**
   * Last-seen values of the two counters that correspond to a player action.
   *
   * The world does not emit an event for jumping or blowing — they are not things that
   * happen TO the world, they are things the player did — but the counter system already
   * records both. Watching those for a change gives the sound the same truth the item
   * thresholds use, without adding events to the simulation for the renderer's benefit.
   */
  private lastJumps = 0;
  private lastBlown = 0;

  poll(): void {
    this.devices.poll();
    // Browsers refuse to start an AudioContext until the page has been interacted with,
    // so unlocking is driven by the player touching a control rather than by load.
    if (this.devices.keyboard.anyActivity() || this.devices.gamepad.anyActivity()) {
      this.audio.unlock();
    }
  }

  /**
   * Turn what happened into sound.
   *
   * Driven off the same WorldEvent queue the particles use, so audio and visuals can
   * never disagree about what occurred — and a burst that is skipped because the loop
   * caught up on a backlog stays silent too.
   */
  private playFor(events: readonly { kind: string; monsters?: number }[]): void {
    for (const e of events) {
      switch (e.kind) {
        case 'bubblePop':
          this.audio.play('bubblePop', 25);
          break;
        case 'monsterPop':
          this.audio.play('monsterPop', 20);
          break;
        case 'chain':
          // Only for a chain worth the name; a one-monster "chain" already popped.
          if ((e.monsters ?? 0) >= 2) this.audio.play('chain');
          break;
        case 'pickup':
          this.audio.play('pickup', 30);
          break;
        case 'escape':
          this.audio.play('escape', 60);
          break;
        case 'button':
          this.audio.play('button', 40);
          break;
        case 'silver':
          this.audio.play('silver');
          break;
        default:
          break;
      }
    }
  }

  step(stepIndex: number): void {
    const a = sampleActions(this.devices, this.actions, stepIndex);

    if (stepIndex === 0) {
      if (this.devices.keyboard.wasCodePressed('F1')) this.showMeter = !this.showMeter;
      if (this.devices.keyboard.wasCodePressed('F2')) this.showCounters = !this.showCounters;
      if (this.devices.keyboard.wasCodePressed('KeyR')) this.setRoom(this.room, this.roomNumber);
      if (a.mutePressed) this.audio.setMuted(!this.audio.muted);
    }

    if (this.interlude > 0) {
      if (--this.interlude === 0) this.loadNextRoom();
      this.fx.step();
      return;
    }

    this.world.step(a);
    // Drained every step rather than every frame, so a burst is never missed when the
    // loop catches up on a backlog and steps twice between draws.
    const c = this.world.counters;
    if (c.jumps > this.lastJumps) this.audio.play('jump', 40);
    if (c.bubblesBlown > this.lastBlown) this.audio.play('blow', 30);
    this.lastJumps = c.jumps;
    this.lastBlown = c.bubblesBlown;

    this.playFor(this.world.events);
    this.fx.consume(this.world.events);
    this.fx.step();

    if (this.world.phase !== 'playing') this.endRoom();
  }

  /**
   * The room is over, one way or another.
   *
   * A death is recorded against the RUN, not the room, because that is what the secret
   * doors are gated on — one life lost anywhere closes every door for the rest of the
   * run, and the tracking has to survive the room that lost it.
   */
  private endRoom(): void {
    const w = this.world;
    if (w.livesLostHere > 0) {
      for (let i = 0; i < w.livesLostHere; i++) recordDeath(this.campaign);
      w.livesLostHere = 0;
    }

    if (w.phase === 'dead') {
      this.interludeText = 'GAME OVER';
      this.interlude = T.INTERLUDE_FRAMES * 2;
      return;
    }

    /*
     * The cave is beaten.
     *
     * The original gates its true ending behind a second player joining mid-boss, which
     * is simply unreachable alone. §4 replaces that gate with a mastery one of the same
     * spirit — you must have done it the hard way, not merely done it — by requiring
     * Super Mode AND all three secret rooms. Both demand a deathless run to reach, so
     * the true ending still means "you truly know this game"; it just no longer means
     * "you had a friend".
     */
    if (w.phase === 'won') {
      const foundEverySecret = SILVER_DOOR_ROOMS.every((g) => this.campaign.doorsTaken.includes(g));
      this.trueEnding = this.campaign.superMode && foundEverySecret;
      this.interludeText = this.trueEnding ? 'THE CAVE OPENS' : 'THE CAVE IS QUIET';
      this.interlude = T.INTERLUDE_FRAMES * 3;
      advance(this.campaign); // rolls past 100 into Super Mode
      persist(this.campaign);
      return;
    }

    if (w.doorTaken) {
      const secret = secretRoomFor(this.campaign.room);
      if (w.doorTaken === 'silver' && secret) {
        this.inSecret = this.campaign.room;
        advance(this.campaign, { door: 'silver' });
        this.interludeText = 'A DOOR OPENS';
      } else {
        advance(this.campaign, { door: 'gold' });
        this.interludeText = 'A LONG WAY THROUGH';
      }
    } else if (this.inSecret !== null) {
      // Coming back out of a secret room resumes the run where it paused.
      this.inSecret = null;
      advance(this.campaign);
      this.interludeText = 'ROOM CLEAR';
    } else {
      advance(this.campaign, { warp: w.warpRooms || 1 });
      this.interludeText = w.warpRooms > 1 ? `SKIP ${w.warpRooms}` : 'ROOM CLEAR';
    }

    persist(this.campaign);
    this.interlude = T.INTERLUDE_FRAMES;
  }

  private loadNextRoom(): void {
    if (this.world.phase === 'dead') {
      // Start over, but the counters survive — they belong to the player, not the run.
      const counters = this.campaign.counters;
      Object.assign(this.campaign, newCampaign(counters));
    }

    const secret = this.inSecret !== null ? secretRoom(this.inSecret) : null;
    const next = secret ?? roomFor(this.campaign.room);
    this.roomNumber = this.campaign.room;
    this.room = next;

    const theme = themeForRoom(this.roomNumber);
    if (theme !== this.theme) {
      this.theme = theme;
      this.tiles = buildTileSet(theme);
    }

    this.world = new World(next, this.roomNumber, this.campaign.score, this.campaign.counters);
    this.fx.clear();

    // Only offer a door in a real room — a secret room does not lead to another one.
    if (!secret) {
      const door = doorFor(this.campaign);
      if (door) this.world.offerDoor(door);
    }
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
    this.drawPickups(ctx, layout);
    this.drawShots(ctx, layout);
    this.drawElements(ctx, layout);
    this.drawBubbles(ctx, layout);
    this.drawBoss(ctx, layout);
    this.drawBaron(ctx, layout);
    // Over everything in the room, but still inside the clip — a burst at the edge
    // must not spray across the HUD.
    this.fx.draw(ctx, layout);

    ctx.restore();

    this.drawFrame(ctx, layout);
    this.drawHud(ctx, layout);
    if (this.showMeter) this.drawMeter(ctx, layout);
    if (this.showCounters) this.drawCounters(ctx, layout);
  }

  /**
   * The counter readout.
   *
   * The hidden system is the heart of the game and completely invisible by design —
   * which also makes it impossible to develop against. This shows every counter, its
   * threshold at the current tier, and which item it is buying, so cause and effect can
   * be checked in seconds rather than by jumping thirty-five times and hoping.
   */
  private drawCounters(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const pf = layout.playfield;
    // Debug text tracks device pixels rather than uiScale: at a narrow window uiScale
    // grows enough that this panel swallowed the entire playfield, which makes a tool
    // for watching the game unusable for watching the game.
    const s = Math.max(1, layout.dpr * 0.85);
    const rows = readCounters(this.world.counters, this.roomNumber);

    const pad = Math.round(9 * s);
    const lh = Math.round(13 * s);
    const w = Math.round(250 * s);
    const h = pad * 2 + lh * (rows.length + 2);
    const x = pf.x + pad;
    const y = pf.y + pad;

    ctx.save();
    ctx.fillStyle = 'rgba(4,6,10,.85)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.font = `${Math.round(9 * s)}px ui-monospace, SFMono-Regular, Menlo, monospace`;

    ctx.fillStyle = '#8a9099';
    ctx.fillText(`COUNTERS   tier ${tierFor(this.roomNumber)}`, x + pad, y + pad);
    const award = this.world.awarded;
    ctx.fillStyle = award.item ? '#ffd166' : '#5a6068';
    ctx.fillText(
      award.item ? `awarded ${award.item} (${award.counter})` : 'awarded nothing this room',
      x + pad,
      y + pad + lh,
    );

    rows.forEach((r, i) => {
      const ly = y + pad + lh * (i + 2);
      ctx.fillStyle = r.ready ? '#6fe3c4' : '#6d7480';
      ctx.fillText(r.counter, x + pad, ly);
      ctx.fillStyle = r.ready ? '#6fe3c4' : '#cfd2d6';
      ctx.fillText(`${r.value}/${r.next}`, x + pad + Math.round(112 * s), ly);
      ctx.fillStyle = '#5a6068';
      ctx.fillText(r.item, x + pad + Math.round(165 * s), ly);
    });
    ctx.restore();
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

  private drawPickups(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const { playfield, pxPerWu } = layout;
    for (const p of this.world.pickups) {
      const x = playfield.x + p.body.x * pxPerWu;
      const y = playfield.y + p.body.y * pxPerWu;

      // A pickup blinks out as its life ends, so a player chasing one knows it is going.
      if (p.life < 90 && Math.floor(p.life / 6) % 2 === 0) continue;

      if (p.kind === 'extend') {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `700 ${Math.round(11 * layout.uiScale)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.lineWidth = Math.max(2, 2 * layout.uiScale);
        ctx.strokeStyle = 'rgba(4,6,10,.9)';
        ctx.strokeText(EXTEND_WORD[p.letter], x, y);
        ctx.fillStyle = hasLetter(this.world.score, p.letter) ? '#6d7480' : '#ffd166';
        ctx.fillText(EXTEND_WORD[p.letter], x, y);
        ctx.restore();
        continue;
      }

      const art = this.itemArt[p.kind];
      if (!art) continue;
      const wu = art.width / T.ART_SCALE;
      ctx.drawImage(art, x - (wu / 2) * pxPerWu, y - (wu / 2) * pxPerWu, wu * pxPerWu, wu * pxPerWu);
    }
  }

  /**
   * The boss, and the bar that tells you whether lightning is working.
   *
   * The health bar matters more than it looks. Every other tool in the game does
   * nothing to this thing, so without visible feedback a player who tries water and
   * fire and then finally lands a bolt has no way to know the bolt was the answer.
   */
  private drawBoss(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const b = this.world.boss;
    if (!b || b.state === 'dead') return;
    const { playfield, pxPerWu } = layout;

    const art = this.bossArt.frames[b.hitFlash > 0 ? 1 : 0][
      Math.floor(this.world.frame / 14) % 2
    ];
    const wu = art.width / T.ART_SCALE;

    ctx.save();
    // Held in a bubble: draw it wobbling and translucent, so "you did it, now pop it"
    // needs no words.
    if (b.state === 'bubbled') ctx.globalAlpha = 0.75;
    ctx.drawImage(
      art,
      playfield.x + (b.x - wu / 2) * pxPerWu,
      playfield.y + (b.y - wu / 2) * pxPerWu,
      wu * pxPerWu,
      wu * pxPerWu,
    );
    ctx.restore();

    if (b.state === 'bubbled') {
      ctx.save();
      ctx.strokeStyle = '#7fe9ff';
      ctx.lineWidth = Math.max(2, pxPerWu);
      ctx.beginPath();
      ctx.arc(
        playfield.x + b.x * pxPerWu,
        playfield.y + b.y * pxPerWu,
        (b.half + 4) * pxPerWu,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      ctx.restore();
    }

    const barW = playfield.w * 0.5;
    const barH = Math.max(4, 5 * layout.dpr);
    const bx = playfield.x + (playfield.w - barW) / 2;
    const by = playfield.y + Math.round(8 * layout.dpr);
    ctx.save();
    ctx.fillStyle = 'rgba(4,6,10,.7)';
    ctx.fillRect(bx, by, barW, barH);
    ctx.fillStyle = b.state === 'bubbled' ? '#7fe9ff' : '#7ad85a';
    ctx.fillRect(bx, by, barW * (b.hp / b.maxHp), barH);
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, barW - 1, barH - 1);
    ctx.restore();
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

  /**
   * The released elements.
   *
   * Drawn under the bubbles but over everything else: water running along a tier has to
   * be visible through whatever is standing in it, because standing in it is fatal.
   */
  private drawElements(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const { playfield, pxPerWu } = layout;
    const blit = (art: HTMLCanvasElement, x: number, y: number): void => {
      const w = art.width / T.ART_SCALE;
      const h = art.height / T.ART_SCALE;
      ctx.drawImage(
        art,
        playfield.x + (x - w / 2) * pxPerWu,
        playfield.y + (y - h / 2) * pxPerWu,
        w * pxPerWu,
        h * pxPerWu,
      );
    };

    for (const d of this.world.drops) blit(this.elementArt.drop, d.x, d.y);
    for (const f of this.world.flames) blit(this.elementArt.flame, f.x, f.y);
    for (const b of this.world.bolts) blit(this.elementArt.bolt, b.x, b.y);
  }

  private drawBubbles(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const { playfield, pxPerWu } = layout;
    for (const b of this.world.bubbles) {
      // A special is tinted by what it carries, so the player can decide whether it is
      // worth crossing the room for before they commit to crossing the room.
      const art = b.special
        ? this.specialArt[b.special]
        : this.bubbleArt[Math.min(ANGER_STEPS - 1, Math.round(anger(b) * (ANGER_STEPS - 1)))];
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

    if (this.interlude > 0) {
      this.drawBanner(
        ctx,
        layout,
        this.interludeText,
        this.interludeText === 'GAME OVER'
          ? '#8a9099'
          : this.trueEnding
            ? '#ffd166'
            : '#6fe3c4',
      );
    } else if (w.hurryUp) {
      this.drawBanner(ctx, layout, 'HURRY UP!', '#ff5b4a');
    }

    // A secret room's whole point is the message on the wall. Show it in cipher — a
    // player who wants the gems can take them and leave, and one who wants the lore has
    // something to chew on. DESIGN.md §3.10.
    if (this.room.secret) this.drawCryptogram(ctx, layout, this.room.secret.cipher);
  }

  /** The encoded message carved into a secret room. */
  private drawCryptogram(ctx: CanvasRenderingContext2D, layout: Layout, cipher: string): void {
    const pf = layout.playfield;
    const s = layout.uiScale;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(10 * s)}px ui-monospace, SFMono-Regular, Menlo, monospace`;

    // Wrap by words so it never runs off the playfield at a narrow window.
    const words = cipher.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > pf.w * 0.8 && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);

    const lh = Math.round(15 * s);
    const top = pf.y + pf.h * 0.16;
    ctx.fillStyle = 'rgba(255,255,255,.34)';
    lines.forEach((l, i) => ctx.fillText(l, pf.x + pf.w / 2, top + i * lh));
    ctx.restore();
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
