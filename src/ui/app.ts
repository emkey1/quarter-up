import type { ClassId } from '@/data/classes';
import { CAMPAIGN, LOOP_START, PROVING } from '@/data/campaign';
import type { LevelData } from '@/game/level';
import { cloneRules, DEFAULT_RULES } from '@/data/rules';
import type { Display } from '@/engine/display';
import type { Input } from '@/engine/input';
import type { Loop, LoopHost } from '@/engine/loop';
import { Audio } from '@/engine/audio';
import { Speech } from '@/engine/speech';
import { loadSettings, saveSettings } from '@/engine/storage';
import { Run } from '@/game/flow';
import { Pointer } from '@/engine/pointer';
import { ScreenFx, prefersReducedMotion } from '@/render/fx';
import { AttractScreen } from './attract';
import { CharSelectScreen } from './charselect';
import { GameOverScreen } from './gameover';
import { LevelIntroScreen } from './levelintro';
import { PadTest } from './padtest';
import { PlayScreen } from './play';
import { SetupScreen } from './setup';
import type { Screen, ScreenId } from './screen';

/**
 * The shell.
 *
 * Owns the services every screen shares, routes between screens, and handles the two
 * overlays (controller setup, rules setup) that must be reachable from anywhere. The
 * loop talks only to this.
 */
export class App implements LoopHost {
  readonly audio = new Audio();
  readonly speech = new Speech();
  readonly fx = new ScreenFx();
  readonly setup: SetupScreen;
  readonly padTest = new PadTest();
  /** Mouse and touch, for the menus. Never a gameplay input — see engine/pointer.ts. */
  readonly pointer = new Pointer();

  private screens: Record<ScreenId, Screen>;
  private current: Screen;
  private play: PlayScreen;
  private charSelect: CharSelectScreen;
  private levelIntro: LevelIntroScreen;
  private gameOver: GameOverScreen;
  private attract: AttractScreen;

  private run: Run;
  /**
   * The level list this shell runs. Normally the shipped campaign; in playtest mode a
   * single level handed over by the editor (tools/editor), so a level under construction
   * is exercised by the real game rather than by an approximation of it.
   */
  private readonly campaign: readonly LevelData[];
  private readonly loopStart: number;
  private readonly playtesting: boolean;
  private classId: ClassId = 'elf';
  private seed = 0x5eed;
  private lastLevelIndex = 0;
  /** Continues allowed per run. Arcade behaviour is unlimited coins; 3 is the default
   *  so a run actually ends and reaches the score table. */
  private continuesLeft = 3;

  loop!: Loop;

  constructor(
    private readonly display: Display,
    private readonly input: Input,
    playtest: LevelData | null = null,
  ) {
    const settings = loadSettings();
    // Spread over the defaults rather than replacing them: a settings blob saved before
    // a rule existed is missing that key, and `undefined` is not a valid difficulty.
    this.setup = new SetupScreen(cloneRules({ ...DEFAULT_RULES, ...(settings.rules ?? {}) }));
    if (prefersReducedMotion()) this.fx.motionEnabled = false;

    this.playtesting = playtest !== null;
    this.campaign = playtest ? [playtest] : CAMPAIGN;
    this.loopStart = playtest ? 0 : LOOP_START;

    const kb = (code: string) => this.input.keyboard.wasCodePressed(code);

    this.run = new Run(this.campaign, this.classId, this.seed, 0, this.setup.rules, this.loopStart);
    this.play = new PlayScreen(display, input, this.audio, this.speech, this.fx, this.setup, () =>
      this.run,
    );
    if (prefersReducedMotion()) this.play.presentation.particles.enabled = false;

    this.attract = new AttractScreen(kb, () => this.go('charselect'), this.pointer);
    this.charSelect = new CharSelectScreen(
      kb,
      (cls, skipTutorial) => this.startRun(cls, skipTutorial),
      () => this.go('attract'),
      this.pointer,
      () => this.display.layout,
    );
    this.charSelect.skipTutorial = settings.skipTutorial ?? false;
    this.levelIntro = new LevelIntroScreen(kb, () => this.go('play'));
    this.gameOver = new GameOverScreen(
      kb,
      () => this.useContinue(),
      // Playtesting has no attract mode to return to — the point is another go at the
      // level you are editing, so bounce straight back to the character select.
      () => this.go(this.playtesting ? 'charselect' : 'attract'),
      () => this.continuesLeft > 0,
    );

    this.screens = {
      attract: this.attract,
      charselect: this.charSelect,
      levelintro: this.levelIntro,
      play: this.play,
      gameover: this.gameOver,
    };
    this.current = this.playtesting ? this.charSelect : this.attract;
    this.current.enter?.();
  }

  private go(id: ScreenId): void {
    if (this.current.id === id) return;
    this.current.exit?.();
    this.current = this.screens[id];
    this.current.enter?.();
  }

  private startRun(cls: ClassId, skipTutorial = false): void {
    this.classId = cls;
    this.continuesLeft = 3;

    // Skipping starts at the first dungeon level, which is exactly where the last intro
    // level's first numbered exit lands you — the two routes agree by construction.
    // Playtesting a single level has no intro to skip, hence the campaign-length guard.
    const start = skipTutorial ? Math.min(this.loopStart, this.campaign.length - 1) : 0;
    saveSettings({ rules: this.setup.rules, skipTutorial });

    this.run = new Run(this.campaign, cls, this.seed, start, cloneRules(this.setup.rules), this.loopStart);
    this.run.world.fireModel = this.play.fireModel;
    this.lastLevelIndex = this.run.levelIndex;
    this.play.onRunChanged();
    this.showIntro();
  }

  private showIntro(): void {
    this.levelIntro.show(
      this.run.depth,
      this.run.levelName,
      this.run.world.hasHiddenUpgrade,
      this.run.rules.difficulty,
    );
    this.go('levelintro');
  }

  private useContinue(): void {
    this.continuesLeft--;
    this.run.useCredit();
    this.run.world.fireModel = this.play.fireModel;
    this.play.onRunChanged();
    this.go('play');
  }

  private endRun(): void {
    this.gameOver.setResult({
      cls: this.run.state.classId,
      score: this.run.world.player.score,
      credits: this.run.world.player.credits,
      deepestLevel: Math.max(this.run.state.deepestLevel, this.run.depth),
      rules: this.run.rules,
    });
    this.go('gameover');
  }

  /* ------------------------------------------------------------------ loop host */

  poll(): void {
    this.pointer.attach(this.display.canvas);
    this.pointer.poll();
    this.input.poll();
    if (this.input.keyboard.anyActivity() || this.input.gamepad.anyActivity()) this.audio.unlock();
  }

  step(stepIndex: number): void {
    const a = this.input.sample(stepIndex);

    if (stepIndex === 0) {
      const kb = this.input.keyboard;

      // --- global overlays, reachable from any screen
      if (kb.wasCodePressed('KeyG') || kb.wasCodePressed('F1')) this.padTest.toggle();
      if (this.padTest.open) {
        this.padTest.update(this.input);
        return;
      }
      if (kb.wasCodePressed('Tab')) this.setup.toggle();
      if (this.setup.open) {
        this.setup.update(this.input);
        return;
      }
      if (this.setup.dirty) {
        this.setup.dirty = false;
        // Rules changed: rebuild under them. A disabled monster must actually stop
        // existing, which means rebuilding the level.
        this.run.applyRules(cloneRules(this.setup.rules));
        this.run.world.fireModel = this.play.fireModel;
        this.play.onRunChanged();
      }

      // --- global hotkeys
      if (kb.wasCodePressed('KeyM')) {
        this.audio.setMuted(!this.audio.muted);
        saveSettings({ rules: this.setup.rules });
      }
      if (kb.wasCodePressed('BracketRight')) this.display.cycleScale(1);
      if (kb.wasCodePressed('BracketLeft')) this.display.cycleScale(-1);
      if (kb.wasCodePressed('KeyF')) {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => {});
      }
    } else if (this.padTest.open || this.setup.open) {
      return;
    }

    // The menus play over a live dungeon, so the cabinet is never a static poster.
    // Stepped HERE rather than in draw(), so the simulation stays inside the fixed
    // timestep and draw() keeps its promise never to mutate.
    if (this.current === this.attract || this.current === this.charSelect) {
      this.play.stepBackdrop();
    }

    this.current.step(a, stepIndex);

    // --- run lifecycle, driven from whatever the play screen did
    if (this.current === this.play) {
      if (this.run.levelIndex !== this.lastLevelIndex) {
        this.lastLevelIndex = this.run.levelIndex;
        this.play.onNewLevel();
        this.showIntro();
      } else if (this.run.world.player.dead && this.play.deathSettled) {
        this.endRun();
      }
    }
  }

  draw(): void {
    const { ctx, layout } = this.display;

    // The attract screen runs a live game behind it, so the cabinet is never a poster.
    if (this.current === this.attract || this.current === this.charSelect) {
      this.play.drawBackdrop(ctx, layout);
    } else if (this.current === this.gameOver) {
      this.play.draw(ctx, layout);
    }

    this.current.draw(ctx, layout);

    this.setup.draw(ctx, layout);
    this.padTest.draw(ctx, layout, this.input);
  }
}
