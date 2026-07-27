import type { MonsterKind } from './monster';

/**
 * One-way channel out of the simulation.
 *
 * The simulation emits; audio, the announcer and the renderer consume. Nothing ever
 * flows back, which is what keeps step() pure and replayable — a dropped or ignored
 * event can never change the outcome of a run.
 */
export type GameEvent =
  | { t: 'shotFired' }
  | { t: 'shotHitWall'; x: number; y: number }
  | { t: 'melee'; hit: boolean }
  | { t: 'monsterHurt'; x: number; y: number }
  | { t: 'monsterKilled'; kind: MonsterKind; level: number; x: number; y: number; by: KillSource }
  | { t: 'generatorHurt'; x: number; y: number; level: number }
  | { t: 'generatorDestroyed'; x: number; y: number; kind: MonsterKind }
  | { t: 'spawned'; x: number; y: number }
  | { t: 'playerHurt'; amount: number; x: number; y: number }
  | { t: 'playerDied' }
  | { t: 'magic'; strength: number }
  | { t: 'score'; amount: number; reason: string }
  | { t: 'pickup'; kind: string; x: number; y: number }
  | { t: 'foodDestroyed'; x: number; y: number }
  | { t: 'upgradeTaken'; upgrade: string }
  | { t: 'doorsOpened'; all: boolean }
  | { t: 'trapTriggered'; x: number; y: number }
  | { t: 'teleported'; x: number; y: number }
  | { t: 'wallsBecameExits' }
  | { t: 'exitReached' };

export type KillSource = 'shot' | 'melee' | 'magic' | 'contact';

export class EventBus {
  private queue: GameEvent[] = [];

  emit(e: GameEvent): void {
    this.queue.push(e);
  }

  /** Presentation drains once per rendered frame. */
  drain(): GameEvent[] {
    if (!this.queue.length) return EMPTY;
    const out = this.queue;
    this.queue = [];
    return out;
  }

  clear(): void {
    this.queue.length = 0;
  }
}

const EMPTY: GameEvent[] = [];
