import { T } from '@/data/tuning';
import {
  DRIFT_DX,
  DRIFT_DY,
  driftAt,
  isFloor,
  tileAt,
  type RoomData,
  type SpecialBubble,
} from './room';
import type { Monster } from './monster';

/**
 * Bubbles — the whole game.
 *
 * A bubble is fired horizontally, decelerates, then rises and joins the room's drift
 * current. It may be stood on, pushed, or popped, and if it caught a monster on the way
 * it holds it until a clock runs out. See DESIGN.md §3.3.
 */

export type BubblePhase = 'fired' | 'free';

export interface Bubble {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Bubbles are round; both halves are the radius. Named to match Ridable. */
  halfW: number;
  halfH: number;
  phase: BubblePhase;
  dir: -1 | 1;
  /** Frames of the initial horizontal push still to run. */
  fireFrames: number;
  /** Frames before an empty bubble bursts on its own. */
  life: number;
  /**
   * What this bubble is carrying instead of a monster.
   *
   * A special bubble drifts in on its own and cannot catch anything — it IS the payload.
   * Popping it is how the player uses it, and which side they pop it from decides where
   * a lightning bolt goes.
   */
  special: SpecialBubble | null;
  captive: Monster | null;
  /** Frames before the captive breaks out. Counts down only while holding one. */
  escape: number;
  escapeTotal: number;
  /** Set by the world when this bubble has been resolved and should be removed. */
  dead: boolean;
  /** Frames of push still being applied, so a shove coasts rather than stopping dead. */
  pushFrames: number;
  pushDir: -1 | 1;
  /** Frames spent floating, driving the wobble. */
  age: number;
  /** Wobble offset, derived from the spawn position so identical starts stay identical
   *  while neighbours visibly do not move in lockstep. */
  wobblePhase: number;
}

let nextId = 1;

/** Reset the id counter. Tests only. */
export function resetBubbleIds(): void {
  nextId = 1;
}

export function spawnBubble(x: number, y: number, dir: -1 | 1, range: 'normal' | 'far'): Bubble {
  return {
    id: nextId++,
    x,
    y,
    vx: 0,
    vy: 0,
    halfW: T.BUBBLE_RADIUS,
    halfH: T.BUBBLE_RADIUS,
    phase: 'fired',
    dir,
    fireFrames: range === 'far' ? T.BUBBLE_FIRE_FRAMES_FAR : T.BUBBLE_FIRE_FRAMES,
    life: T.BUBBLE_LIFETIME,
    special: null,
    captive: null,
    escape: 0,
    escapeTotal: 0,
    dead: false,
    pushFrames: 0,
    pushDir: 1,
    age: 0,
    // Position, not an id or a counter: identical starts must trace identical paths.
    wobblePhase:
      (Math.round(x * 7 + y * 13) % T.BUBBLE_WOBBLE_PERIOD) + T.BUBBLE_WOBBLE_PERIOD,
  };
}

/** How close to bursting the captive is, 0 (just caught) to 1 (about to escape). */
export function anger(b: Bubble): number {
  if (!b.captive || b.escapeTotal <= 0) return 0;
  const used = 1 - b.escape / b.escapeTotal;
  const warnFrom = 1 - T.ESCAPE_WARN_AT;
  if (used < warnFrom) return 0;
  return Math.min(1, (used - warnFrom) / T.ESCAPE_WARN_AT);
}

const tileOf = (wu: number): number => Math.floor(wu / T.TILE);

/**
 * Bubbles are stopped by any geometry, platforms included.
 *
 * Unlike a body, a bubble has no one-way behaviour: it collects *under* a platform
 * rather than passing through it. That is what makes the undersides of tiers fill up
 * with bubbles, which is where the big chains come from.
 */
function collide(room: RoomData, b: Bubble): void {
  if (b.vx !== 0) {
    const nx = b.x + b.vx;
    const tx = tileOf(nx + Math.sign(b.vx) * b.halfW);
    const ty0 = tileOf(b.y - b.halfH + 1);
    const ty1 = tileOf(b.y + b.halfH - 1);
    let blocked = false;
    for (let ty = ty0; ty <= ty1; ty++) if (isFloor(tileAt(room, tx, ty))) blocked = true;
    if (blocked) {
      b.x = b.vx > 0 ? tx * T.TILE - b.halfW : (tx + 1) * T.TILE + b.halfW;
      b.vx = 0;
      b.pushFrames = 0;
    } else {
      b.x = nx;
    }
  }

  if (b.vy !== 0) {
    const ny = b.y + b.vy;
    const ty = tileOf(ny + Math.sign(b.vy) * b.halfH);
    const tx0 = tileOf(b.x - b.halfW + 1);
    const tx1 = tileOf(b.x + b.halfW - 1);
    let blocked = false;
    for (let tx = tx0; tx <= tx1; tx++) if (isFloor(tileAt(room, tx, ty))) blocked = true;
    if (blocked) {
      b.y = b.vy > 0 ? ty * T.TILE - b.halfH : (ty + 1) * T.TILE + b.halfH;
      b.vy = 0;
    } else {
      b.y = ny;
    }
  }

  /*
   * The top of the room is a ceiling.
   *
   * Tile collision alone does not provide one: the rows above the highest tier are open
   * air, so a bubble blown up there kept rising straight out of the playfield and drifted
   * off to nowhere while its life ran down. Bubbles are supposed to *collect* along the
   * ceiling — that pool is where the big clusters come from, and the exponential chain
   * curve assumes you can build one. Losing them over the top quietly removed the best
   * source of chains in every room.
   *
   * A room boundary rather than level data, because every room needs it and no room
   * should have to remember to draw one.
   */
  if (b.y - b.halfH < 0) {
    b.y = b.halfH;
    b.vy = 0;
  }
}

/**
 * One step of motion and clocks.
 *
 * Does not resolve escapes or deaths — it only lets the counters reach zero. The world
 * decides what that means, because releasing a captive has to put a monster back into
 * the room and this module has no business doing that.
 */
export function stepBubble(room: RoomData, b: Bubble): void {
  if (b.phase === 'fired') {
    b.fireFrames--;
    const total = T.BUBBLE_FIRE_FRAMES;
    // Linear decay to zero, so the bubble drifts to a stop rather than stopping dead.
    const t = Math.max(0, b.fireFrames / total);
    b.vx = b.dir * T.BUBBLE_FIRE_SPEED * t;
    b.vy = 0;
    if (b.fireFrames <= 0) b.phase = 'free';
  } else {
    const d = driftAt(room, tileOf(b.x), tileOf(b.y));
    b.vx = DRIFT_DX[d] * room.driftSpeed;
    b.vy = -T.BUBBLE_RISE_SPEED + DRIFT_DY[d] * room.driftSpeed;

    /*
     * Wobble: a free bubble is never perfectly still.
     *
     * Without this the only lateral force in the game is the room's drift field, and a
     * field is sparse by nature — over most of a room a bubble had vx of exactly zero,
     * rose in a dead-straight line, met a platform and stopped dead with vy zero too.
     * Every bubble in a column did the identical thing, which reads as a row of paused
     * sprites rather than as anything floating.
     *
     * The phase comes from the spawn POSITION rather than an id or a counter: two
     * bubbles released at the same spot must trace the same path (DESIGN.md §12), or
     * chain setups stop being learnable, but two released a few units apart should
     * visibly not move in lockstep.
     */
    b.age++;
    const t = ((b.age + b.wobblePhase) / T.BUBBLE_WOBBLE_PERIOD) * Math.PI * 2;
    b.vx += Math.sin(t) * T.BUBBLE_WOBBLE_X;
    b.vy += Math.cos(t * 0.7) * T.BUBBLE_WOBBLE_Y;

    if (b.pushFrames > 0) {
      b.pushFrames--;
      b.vx += b.pushDir * T.BUBBLE_PUSH_SPEED;
    }
  }

  collide(room, b);

  if (b.captive) {
    if (b.escape > 0) b.escape--;
  } else if (b.life > 0) {
    b.life--;
  }
}

/**
 * A special bubble, drifting in from the side of the room.
 *
 * Enters already free rather than fired: it was not blown by anyone, it wandered in on
 * the room's current, which is what makes one appearing feel like an opportunity rather
 * than something the player did.
 */
export function spawnSpecial(kind: SpecialBubble, x: number, y: number): Bubble {
  const b = spawnBubble(x, y, 1, 'normal');
  b.special = kind;
  b.phase = 'free';
  b.fireFrames = 0;
  b.vx = 0;
  // Specials wait to be used rather than timing out on their own.
  b.life = T.SPECIAL_BUBBLE_LIFETIME;
  return b;
}

/** Trap a monster. The caller is responsible for taking it out of the walking set. */
export function capture(b: Bubble, m: Monster, escapeFrames: number): void {
  b.captive = m;
  b.escape = escapeFrames;
  b.escapeTotal = escapeFrames;
  b.phase = 'free';
  b.fireFrames = 0;
  b.vx = 0;
  m.state = 'bubbled';
}

export function shove(b: Bubble, dir: -1 | 1): void {
  b.pushFrames = T.BUBBLE_PUSH_FRAMES;
  b.pushDir = dir;
}

export function overlaps(
  b: Bubble,
  x: number,
  y: number,
  halfW: number,
  halfH: number,
): boolean {
  return (
    Math.abs(b.x - x) < b.halfW + halfW && Math.abs(b.y - y) < b.halfH + halfH
  );
}

/**
 * Push overlapping bubbles apart.
 *
 * Without this they interpenetrate and a repeated volley stacks into one blob at a
 * single point — which looks wrong and, worse, makes a huge chain trivial to assemble
 * by standing still and mashing. Bubbles have to *pack*: crowding into a cluster where
 * each one takes up room is what makes a six-chain something you arrange rather than
 * something you accumulate.
 *
 * Symmetric, order-independent within a pass, and free of RNG, so the drift determinism
 * the chain setups depend on survives.
 */
export function separate(room: RoomData, bubbles: readonly Bubble[]): void {
  for (let i = 0; i < bubbles.length; i++) {
    const a = bubbles[i];
    if (a.dead) continue;
    for (let j = i + 1; j < bubbles.length; j++) {
      const b = bubbles[j];
      if (b.dead) continue;

      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const min = a.halfW + b.halfW;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;

      let d = Math.sqrt(d2);
      if (d < 1e-4) {
        // Exactly coincident — two bubbles blown from the same spot on the same frame.
        // Any direction is as good as another; pick a fixed one so it stays repeatable.
        dx = 0;
        dy = -1;
        d = 1;
      }
      const push = (min - d) / 2;
      const nx = (dx / d) * push;
      const ny = (dy / d) * push;
      a.x -= nx;
      a.y -= ny;
      b.x += nx;
      b.y += ny;
    }
  }

  // Separation moves bubbles without consulting the room, so a crowded cluster can
  // shove one into a wall or through the floor — where it sticks, because a bubble only
  // rises and the collision pass has no downward motion to resolve. Push them back out.
  for (const b of bubbles) if (!b.dead) unstick(room, b);
}

/**
 * Lift a bubble out of any geometry it has been pushed into.
 *
 * Resolves along whichever axis needs the least movement, rather than testing faces in
 * a fixed order — order-based resolution picks a direction by which face it happens to
 * check first, so a bubble pushed well inside a tile gets shoved further in instead of
 * out.
 */
function unstick(room: RoomData, b: Bubble): void {
  // The ceiling is a room boundary rather than a tile, so the tile scan below cannot
  // see it. Separation happens after the motion pass, which means a crowded pool along
  // the top can shove one member up through the ceiling, where it sits until the next
  // step's clamp catches it. Clamp here too, so the invariant holds at every point in
  // the frame rather than only at the end of it.
  if (b.y - b.halfH < 0) b.y = b.halfH;

  const x0 = tileOf(b.x - b.halfW);
  const x1 = tileOf(b.x + b.halfW - 0.001);
  const y0 = tileOf(b.y - b.halfH);
  const y1 = tileOf(b.y + b.halfH - 0.001);

  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!isFloor(tileAt(room, tx, ty))) continue;

      const left = tx * T.TILE;
      const top = ty * T.TILE;
      const outUp = b.y + b.halfH - top;
      const outDown = top + T.TILE - (b.y - b.halfH);
      const outLeft = b.x + b.halfW - left;
      const outRight = left + T.TILE - (b.x - b.halfW);

      const least = Math.min(outUp, outDown, outLeft, outRight);
      if (least === outUp) b.y -= outUp;
      else if (least === outDown) b.y += outDown;
      else if (least === outLeft) b.x -= outLeft;
      else b.x += outRight;
      return;
    }
  }
}

/**
 * Every bubble reachable from `start` through touching neighbours.
 *
 * A flood fill built fresh each pop rather than a maintained graph — clusters change
 * every frame as bubbles drift, and a stale adjacency list is a wrong score.
 *
 * The whole chain must resolve in ONE call so the multiplier is computed once against
 * the total. Popping serially and summing gives n x 1000 instead of 2^(n-1) x 1000,
 * which at a 6-chain is 6,000 against 32,000 — the difference between the game the
 * scoring was designed for and a much poorer one. See DESIGN.md §3.8.
 */
export function chainFrom(bubbles: readonly Bubble[], start: number): number[] {
  const found = [start];
  const seen = new Set<number>([start]);

  for (let head = 0; head < found.length; head++) {
    const a = bubbles[found[head]];
    for (let i = 0; i < bubbles.length; i++) {
      if (seen.has(i) || bubbles[i].dead) continue;
      const c = bubbles[i];
      const dx = a.x - c.x;
      const dy = a.y - c.y;
      const reach = a.halfW + c.halfW + T.BUBBLE_CHAIN_SLACK;
      if (dx * dx + dy * dy <= reach * reach) {
        seen.add(i);
        found.push(i);
      }
    }
  }

  return found;
}
