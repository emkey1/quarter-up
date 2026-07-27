import { T } from '@/data/tuning';
import type { ClassId, UpgradeId } from '@/data/classes';
import type { LevelData } from './level';
import { World } from './world';
import { DEFAULT_RULES, type Rules } from '@/data/rules';

/**
 * What survives a level transition.
 *
 * Health explicitly carries: the drain never resets, which is what makes a run a single
 * continuous clock rather than a series of independent levels. Only reaching an exit
 * gets you to more food.
 */
export interface RunState {
  classId: ClassId;
  health: number;
  score: number;
  credits: number;
  keys: number;
  potions: number;
  upgrades: UpgradeId[];
  /** Temporary invisibility carries into the next level, per the original. */
  invisibleFrames: number;
  deepestLevel: number;
}

export function newRunState(classId: ClassId): RunState {
  return {
    classId,
    health: T.START_HEALTH,
    score: 0,
    credits: 1,
    keys: 0,
    potions: 0,
    upgrades: [],
    invisibleFrames: 0,
    deepestLevel: 1,
  };
}

/**
 * A run: one credit-chain through the campaign.
 *
 * Levels past the authored set loop forever with a depth multiplier, matching the
 * original's structure — there is no ending, only a score.
 */
export class Run {
  levelIndex = 0;
  world: World;
  state: RunState;
  /** Set for a moment after a transition so the UI can show a level banner. */
  justAdvanced = 0;

  constructor(
    private readonly campaign: readonly LevelData[],
    classId: ClassId,
    private readonly seed: number,
    startIndex = 0,
    public rules: Rules = DEFAULT_RULES,
  ) {
    this.state = newRunState(classId);
    this.levelIndex = startIndex;
    this.world = this.build();
  }

  private build(): World {
    const level = this.campaign[this.levelIndex % this.campaign.length];
    const w = new World(
      level,
      this.state.classId,
      this.seed + this.levelIndex * 7919,
      this.state,
      this.rules,
    );
    w.depth = this.depth;
    return w;
  }

  /** 1-based level number as shown to the player; keeps counting past the loop. */
  get depth(): number {
    return this.levelIndex + 1;
  }

  get levelName(): string {
    return this.campaign[this.levelIndex % this.campaign.length].name;
  }

  /** Called when the world reports the exit was reached. */
  advance(): void {
    this.state = this.world.exportState();
    this.levelIndex++;
    this.state.deepestLevel = Math.max(this.state.deepestLevel, this.depth);
    this.world = this.build();
    this.justAdvanced = 90;
  }

  /** Insert a continue: restore health, keep the level, count the credit. */
  useCredit(): void {
    this.state = this.world.exportState();
    this.state.health = T.CONTINUE_HEALTH;
    this.state.credits++;
    this.world = this.build();
  }

  /** Apply new rules and rebuild the current level under them. */
  applyRules(rules: Rules): void {
    this.rules = rules;
    this.state = this.world.exportState();
    this.world = this.build();
  }

  restart(classId: ClassId = this.state.classId): void {
    this.state = newRunState(classId);
    this.levelIndex = 0;
    this.world = this.build();
  }

  /** The arcade's real scoreboard metric: points per credit spent. */
  get scorePerCredit(): number {
    return Math.floor(this.world.player.score / Math.max(1, this.state.credits));
  }

  step(): void {
    if (this.justAdvanced > 0) this.justAdvanced--;
    if (this.world.exitReached) this.advance();
  }
}
