import { T } from '@/data/tuning';
import { Field } from './field';
import { FlowField } from './flow';
import { Dir, DIR_DX, DIR_DY } from './digger';

export type EnemyKind = 'grub' | 'emberjaw';

export const enum EnemyState {
  /** Walking the tunnel network toward the player. */
  Tunnelling = 0,
  /** Passing straight through the earth, ignoring tunnels entirely. */
  Ghosting = 1,
  Dead = 2,
}

export interface Enemy {
  kind: EnemyKind;
  x: number;
  y: number;
  facing: Dir;
  state: EnemyState;
  alive: boolean;

  /** Frames since this enemy last got closer to the player. Drives ghosting. */
  stuckFor: number;
  /** Last measured tunnel distance to the player, in cells. -1 when unreachable. */
  lastDistance: number;
  /** True once a ghosting enemy has actually entered earth, so it does not re-solidify
   *  on the open cell it started from. */
  enteredEarth: boolean;

  /** Dragon only: counts down the wind-up, the burn, and then the cooldown. */
  flameTimer: number;
  flameState: 'idle' | 'winding' | 'burning';

  /**
   * Pump stages currently in it, 0 to T.PUMP_STAGES.
   *
   * Anything above zero holds it still. That is the pump's second job and the reason it
   * is not a slow gun: two stages buy about a second and a half of stillness, which is
   * enough to walk past something rather than spend four presses killing it.
   */
  inflation: number;
  /** Frames since the last pump press, counting toward losing a stage. */
  deflateTimer: number;

  /**
   * The last survivor, running for the surface.
   *
   * Set by World, and it makes `stepEnemy` stand aside entirely. Without it the escape
   * and the chase fight each other every frame — World nudges the runner toward the
   * corner, then stepEnemy's ghost logic drags it straight back toward the player, and
   * it oscillates in place forever instead of leaving. The round then never ends.
   */
  escaping: boolean;
}

export function makeEnemy(kind: EnemyKind, cx: number, cy: number): Enemy {
  return {
    kind,
    x: cx * T.CELL + T.CELL / 2,
    y: cy * T.CELL + T.CELL / 2,
    facing: Dir.Left,
    state: EnemyState.Tunnelling,
    alive: true,
    stuckFor: 0,
    lastDistance: -1,
    enteredEarth: false,
    flameTimer: T.FLAME_COOLDOWN_F,
    flameState: 'idle',
    inflation: 0,
    deflateTimer: 0,
    escaping: false,
  };
}

export const enemyCellX = (e: Enemy): number => Math.floor(e.x / T.CELL);
export const enemyCellY = (e: Enemy): number => Math.floor(e.y / T.CELL);

export interface EnemyTarget {
  x: number;
  y: number;
  alive: boolean;
}

export interface EnemyEvents {
  startedGhosting: boolean;
  solidified: boolean;
  flameLit: boolean;
  /** Cells the flame currently occupies, for drawing and for killing. */
  flame: { x: number; y: number }[];
  touchedPlayer: boolean;
  /** Lost a stage of inflation this frame. */
  deflated: boolean;
}

/**
 * One enemy, one tick.
 *
 * Two behaviours over one body, and the second is what makes the game work.
 *
 * **Tunnel pursuit** walks the flow field toward the player. Enemies are slower than the
 * digger on purpose, so a player who has cut a good network can always disengage — that
 * is the reward for having cut one.
 *
 * **Ghosting** abandons the network and moves in a straight line through solid earth.
 * Without it the game has a trivial dominant strategy: dig one pocket, sit in it, and
 * nothing can ever reach you. The trigger is *progress-based* rather than a random timer
 * — DESIGN.md §8.3 flags that as our reconstruction rather than a documented rule — and
 * the reason is that a random trigger punishes everyone equally, while this one punishes
 * the specific thing it needs to: sealing yourself in is exactly what stops an enemy
 * making progress, so sealing yourself in is what summons it through the wall.
 *
 * An enemy with no route at all does not wait out the full stuck timer. It ghosts almost
 * at once, so walling yourself in fails fast rather than after a pause long enough to
 * feel like it worked.
 */
export function stepEnemy(
  field: Field,
  flow: FlowField,
  e: Enemy,
  target: EnemyTarget,
  speedScale = 1,
): EnemyEvents {
  const out: EnemyEvents = {
    startedGhosting: false,
    solidified: false,
    flameLit: false,
    flame: [],
    touchedPlayer: false,
    deflated: false,
  };
  if (!e.alive || e.state === EnemyState.Dead) return out;

  // A runner is World's business, not this function's — see Enemy.escaping. Contact is
  // still checked, because catching it by walking into it should not be safe.
  if (e.escaping) {
    if (target.alive && Math.abs(target.x - e.x) < T.CELL * 0.7 && Math.abs(target.y - e.y) < T.CELL * 0.7) {
      out.touchedPlayer = true;
    }
    return out;
  }

  /*
   * Inflated: held still, and leaking.
   *
   * Everything else is skipped — no movement, no pathing, and no breathing fire. A
   * dragon that could still burn while pinned would make the stall tactic useless
   * against exactly the enemy it is most needed against.
   */
  if (e.inflation > 0) {
    if (++e.deflateTimer >= T.PUMP_DEFLATE_F) {
      e.deflateTimer = 0;
      e.inflation--;
      out.deflated = true;
    }
    // Contact still kills. Walking into a held enemy is your mistake, not its win.
    if (target.alive && Math.abs(target.x - e.x) < T.CELL * 0.7 && Math.abs(target.y - e.y) < T.CELL * 0.7) {
      out.touchedPlayer = true;
    }
    return out;
  }

  if (e.state === EnemyState.Ghosting) {
    stepGhost(field, e, target, out, speedScale);
  } else {
    stepTunnel(field, flow, e, target, out, speedScale);
  }

  if (e.kind === 'emberjaw') stepFlame(field, e, target, out);

  // Contact. Checked after moving, so an enemy that walks into the player on the frame
  // it arrives still catches them.
  if (target.alive && Math.abs(target.x - e.x) < T.CELL * 0.7 && Math.abs(target.y - e.y) < T.CELL * 0.7) {
    out.touchedPlayer = true;
  }

  return out;
}

function stepTunnel(
  field: Field,
  flow: FlowField,
  e: Enemy,
  target: EnemyTarget,
  out: EnemyEvents,
  speedScale: number,
): void {
  const cx = enemyCellX(e);
  const cy = enemyCellY(e);
  const dist = flow.distanceAt(cx, cy);

  // No route through tunnels at all: the player has sealed themselves in, or sealed us
  // out. Give that almost no grace.
  if (dist < 0) {
    e.stuckFor++;
    if (e.stuckFor >= T.GHOST_NO_ROUTE_F) beginGhost(e, out);
    return;
  }

  if (e.lastDistance >= 0 && dist >= e.lastDistance) e.stuckFor++;
  else e.stuckFor = 0;
  e.lastDistance = dist;

  if (e.stuckFor >= T.GHOST_STUCK_F) {
    beginGhost(e, out);
    return;
  }

  const step = flow.next(cx, cy);
  if (!step) return; // standing on the player's own cell; contact will resolve it

  const tx = step.cx * T.CELL + T.CELL / 2;
  const ty = step.cy * T.CELL + T.CELL / 2;
  const dx = Math.sign(tx - e.x);
  const dy = Math.sign(ty - e.y);

  // The flow field only ever hands back a 4-neighbour, so exactly one axis moves and
  // the enemy stays lane-locked without needing the digger's turn rule.
  if (dx !== 0) {
    e.x += Math.sign(dx) * Math.min(T.ENEMY_SPEED * speedScale, Math.abs(tx - e.x));
    e.facing = dx > 0 ? Dir.Right : Dir.Left;
  } else if (dy !== 0) {
    e.y += Math.sign(dy) * Math.min(T.ENEMY_SPEED * speedScale, Math.abs(ty - e.y));
    e.facing = dy > 0 ? Dir.Down : Dir.Up;
  }
}

function beginGhost(e: Enemy, out: EnemyEvents): void {
  e.state = EnemyState.Ghosting;
  e.enteredEarth = false;
  e.stuckFor = 0;
  out.startedGhosting = true;
}

function stepGhost(
  field: Field,
  e: Enemy,
  target: EnemyTarget,
  out: EnemyEvents,
  speedScale: number,
): void {
  // Straight at the player, through whatever is in the way. Earth is not disturbed —
  // a ghost passes through it rather than digging, so it leaves no tunnel behind and the
  // player gains nothing from having been visited.
  const dx = target.x - e.x;
  const dy = target.y - e.y;
  const len = Math.hypot(dx, dy) || 1;
  e.x += (dx / len) * T.GHOST_SPEED * speedScale;
  e.y += (dy / len) * T.GHOST_SPEED * speedScale;
  e.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? Dir.Right : Dir.Left) : dy > 0 ? Dir.Down : Dir.Up;

  const cx = enemyCellX(e);
  const cy = enemyCellY(e);
  if (!field.isOpen(cx, cy)) {
    e.enteredEarth = true;
    return;
  }

  // Back in open space, and it has actually been through something. Solidify: it is a
  // tunnel enemy again, and the flow field takes over.
  if (e.enteredEarth) {
    e.state = EnemyState.Tunnelling;
    e.lastDistance = -1;
    e.stuckFor = 0;
    // Snap onto the lane, or a solidified enemy sits between two rows and the flow
    // field's cell-centre targets make it jitter.
    e.x = cx * T.CELL + T.CELL / 2;
    e.y = cy * T.CELL + T.CELL / 2;
    out.solidified = true;
  }
}

/**
 * The dragon's flame: a horizontal jet down its own tunnel.
 *
 * Horizontal only, which is the whole tactical point — approaching one from above or
 * below is the safe line and approaching along its tunnel is the dangerous one, so a
 * dragon changes what a corridor is worth rather than just being a tougher enemy.
 *
 * The wind-up is not decoration. A ranged instant kill with no warning is not a threat
 * a player can play around, it is a dice roll.
 */
function stepFlame(field: Field, e: Enemy, target: EnemyTarget, out: EnemyEvents): void {
  if (e.flameState === 'idle') {
    if (--e.flameTimer > 0) return;
    // Only wind up if the player is actually in the tunnel this thing is facing.
    const aligned = Math.abs(target.y - e.y) <= T.FLAME_ALIGN_WU;
    const ahead = e.facing === Dir.Right ? target.x > e.x : e.facing === Dir.Left ? target.x < e.x : false;
    const inRange = Math.abs(target.x - e.x) <= T.FLAME_CELLS * T.CELL;
    if (!(aligned && ahead && inRange && target.alive)) {
      e.flameTimer = 1; // check again next frame rather than burning the whole cooldown
      return;
    }
    e.flameState = 'winding';
    e.flameTimer = T.FLAME_WINDUP_F;
    return;
  }

  if (e.flameState === 'winding') {
    if (--e.flameTimer > 0) return;
    e.flameState = 'burning';
    e.flameTimer = T.FLAME_ACTIVE_F;
    out.flameLit = true;
    return;
  }

  // Burning. The jet stops at the first cell of earth, so a dragon cannot breathe
  // through a wall — and a player one cell round the corner is safe.
  const dx = e.facing === Dir.Right ? 1 : e.facing === Dir.Left ? -1 : 0;
  if (dx !== 0) {
    const cy = enemyCellY(e);
    for (let i = 1; i <= T.FLAME_CELLS; i++) {
      const cx = enemyCellX(e) + dx * i;
      if (!field.isOpen(cx, cy)) break;
      out.flame.push({ x: cx * T.CELL + T.CELL / 2, y: cy * T.CELL + T.CELL / 2 });
    }
  }

  if (--e.flameTimer <= 0) {
    e.flameState = 'idle';
    e.flameTimer = T.FLAME_COOLDOWN_F;
  }
}

/** Does a flame cell catch this point? */
export function flameHits(flame: readonly { x: number; y: number }[], x: number, y: number): boolean {
  for (const f of flame) {
    if (Math.abs(f.x - x) < T.CELL * 0.6 && Math.abs(f.y - y) < T.CELL * 0.6) return true;
  }
  return false;
}

export { DIR_DX, DIR_DY };
