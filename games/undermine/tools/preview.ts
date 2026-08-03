import { it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { T, bandOf } from '@/data/tuning';
import { Cell, Field } from '@/game/field';
import { Digger, Dir } from '@/game/digger';
import { World } from '@/game/world';
import { LAYOUTS } from '@/data/layouts';
import { RockState } from '@/game/rock';
import { EnemyState } from '@/game/enemy';
import { PALETTE, TILE_PX, earthTile, tunnelTile, skyTile, diggerSprite, rockSprite, enemySprite, flameSprite } from '@/render/tilegen';
import { neighbourMask } from '@/render/autotile';
import type { Px } from '@/render/pixel';

/**
 * Renders the actual game to a PNG, headlessly.
 *
 * This exists because the browser preview on this machine reports every page as hidden
 * and never runs requestAnimationFrame, so there has been no way to LOOK at any of this.
 * Tests can prove the draw path issues the right calls; they cannot tell anyone whether
 * a tunnel reads as a tunnel, and DESIGN.md §8.1 has an open question — whether
 * cell-aligned digging is too chunky — that can only be settled by eye.
 *
 * It draws through the same tile generators and the same autotiler the game uses, so
 * what comes out is the real art rather than an impression of it. Only the blitting is
 * reimplemented, because there is no canvas here.
 *
 * Run with `npm run preview -w games/undermine`.
 */

/* ------------------------------------------------------------------ PNG */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode RGBA pixels as a PNG. Filter type 0 on every row; zlib does the rest. */
function encodePng(w: number, h: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ blitting */

function parseColour(css: string): [number, number, number, number] {
  if (css.startsWith('rgba')) return [0, 0, 0, 0];
  const n = parseInt(css.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

class Canvas {
  readonly rgba: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.rgba = new Uint8Array(w * h * 4);
  }

  /** Blit a Px through the palette, skipping transparent entries. */
  blit(px: Px, ox: number, oy: number, pal: readonly string[]): void {
    for (let y = 0; y < px.h; y++) {
      for (let x = 0; x < px.w; x++) {
        const idx = px.at(x, y);
        if (idx === 0) continue;
        const [r, g, b, a] = parseColour(pal[idx] ?? '#ff00ff');
        if (a === 0) continue;
        const dx = ox + x;
        const dy = oy + y;
        if (dx < 0 || dy < 0 || dx >= this.w || dy >= this.h) continue;
        const o = (dy * this.w + dx) * 4;
        this.rgba[o] = r;
        this.rgba[o + 1] = g;
        this.rgba[o + 2] = b;
        this.rgba[o + 3] = 255;
      }
    }
  }
}

/* ------------------------------------------------------------------ the scene */

function renderWorld(w: World): Buffer {
  const canvas = new Canvas(T.GRID_W * TILE_PX, T.GRID_H * TILE_PX);
  const f = w.field;
  const isEarth = (x: number, y: number) =>
    !f.inBounds(x, y) ? y >= T.SKY_ROWS : f.at(x, y) === Cell.Earth;

  for (let cy = 0; cy < T.GRID_H; cy++) {
    for (let cx = 0; cx < T.GRID_W; cx++) {
      const band = Math.max(0, bandOf(cy));
      const cell = f.at(cx, cy);
      const px =
        cell === Cell.Sky
          ? skyTile()
          : cell === Cell.Tunnel
            ? tunnelTile(band)
            : earthTile(band, maskFor(cx, cy, isEarth));
      canvas.blit(px, cx * TILE_PX, cy * TILE_PX, PALETTE);
    }
  }

  for (const c of w.flame) {
    canvas.blit(flameSprite(), (c.x - T.CELL / 2) * 2, (c.y - T.CELL / 2) * 2, PALETTE);
  }

  for (const r of w.rocks) {
    if (r.state === RockState.Gone) continue;
    const variant = r.state === RockState.Shattering ? 'shatter' : r.state === RockState.Teetering ? 'teeter' : 'rest';
    canvas.blit(rockSprite(variant), (r.x - T.CELL / 2) * 2, (r.y - T.CELL / 2) * 2, PALETTE);
  }

  for (const e of w.enemies) {
    if (!e.alive || e.state === EnemyState.Dead) continue;
    canvas.blit(
      enemySprite(e.kind, e.state === EnemyState.Ghosting),
      (e.x - T.CELL / 2) * 2,
      (e.y - T.CELL / 2) * 2,
      PALETTE,
    );
  }

  canvas.blit(
    diggerSprite(Math.max(0, w.digger.facing)),
    (w.digger.x - T.CELL / 2) * 2,
    (w.digger.y - T.CELL / 2) * 2,
    PALETTE,
  );

  return encodePng(canvas.w, canvas.h, canvas.rgba);
}

/**
 * The autotile mask for a cell.
 *
 * The raw neighbour mask, not the dense blob index: `earthTile` reduces internally, and
 * the game reaches the same tile by using the index to look up a pre-rendered one. Same
 * appearance, one fewer indirection to get wrong here.
 */
function maskFor(cx: number, cy: number, isEarth: (x: number, y: number) => boolean): number {
  return neighbourMask(cx, cy, isEarth);
}

it('writes a preview PNG of a played-in field', () => {
  const w = new World(LAYOUTS[8]); // 'The Cistern' — one big room, good for a portrait

  /*
   * A POSED shot, not a played one.
   *
   * The first version of this simply ran a long input script, and by the end the player
   * had died four times over and the picture was of a game-over state with everything
   * clustered in one corner. Useful — it is how the runaway lives bug got found — but
   * useless as a look at the game.
   *
   * So: dig a real network with real input, then place the things that only exist for a
   * moment. A rock mid-teeter and an enemy mid-earth are states a screenshot would
   * almost never catch by chance, and they are exactly the two worth looking at.
   */
  const script: [Dir, number][] = [
    [Dir.Down, 200],
    [Dir.Right, 150],
    [Dir.Down, 150],
    [Dir.Left, 220],
  ];
  for (const [dir, frames] of script) {
    for (let i = 0; i < frames; i++) w.step({ dir });
  }

  // One rock about to go, and the ground under it removed so the pose is honest.
  const teeterer = w.rocks[2];
  w.field.dig(teeterer.cx, Math.floor(teeterer.y / T.CELL) + 1);
  w.step({ dir: Dir.None });

  // One enemy caught halfway through the earth, and one held on the pump.
  const ghost = w.enemies[1];
  ghost.state = EnemyState.Ghosting;
  ghost.enteredEarth = true;
  ghost.x = 5 * T.CELL + T.CELL / 2;
  ghost.y = 9 * T.CELL + T.CELL / 2;
  w.enemies[0].inflation = 2;

  const out = new URL('../preview.png', import.meta.url);
  writeFileSync(out, renderWorld(w));
  console.log(`wrote ${out.pathname}`);
});
