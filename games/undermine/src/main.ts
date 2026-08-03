import { Display } from '@cabinet/display';
import { Loop } from '@cabinet/loop';
import { Keyboard } from '@cabinet/keyboard';
import { GamepadInput } from '@cabinet/gamepad';
import { T } from '@/data/tuning';
import { ACTION_NAMES, DEFAULT_KEY_BINDINGS, STANDARD_PROFILE, DPAD, type Action } from '@/game/controls';
import { App } from '@/ui/app';

/**
 * Boot.
 *
 * The first game built directly on `@quarter-up/cabinet` — no local engine copy, no
 * engine/ directory at all so far. If that stays true through M2, the extraction did its
 * job; if this file starts growing an `engine/` beside it, that is a finding worth
 * writing down rather than working around.
 */
function main(): void {
  const stage = document.getElementById('stage');
  if (!stage) throw new Error('#stage missing');

  const display = new Display(stage, {
    viewW: T.VIEW_W,
    viewH: T.VIEW_H,
    artScale: T.ART_SCALE,
    scaleMin: T.SCREEN_SCALE_MIN,
    scaleMax: T.SCREEN_SCALE_MAX,
    // A vertical cabinet leaves wide margins on a landscape monitor, and the HUD will
    // live in them from M4. Until then they are simply empty.
    keepRightPanel: false,
  });

  const keyboard = new Keyboard<Action>(ACTION_NAMES, DEFAULT_KEY_BINDINGS);
  const pad = new GamepadInput<Action>(
    {
      deadzone: T.PAD_DEADZONE,
      hysteresis: T.PAD_HYSTERESIS,
      triggerThreshold: T.PAD_TRIGGER_THRESHOLD,
    },
    STANDARD_PROFILE,
    DPAD,
  );
  keyboard.attach();
  pad.attach();

  const app = new App(display, keyboard, pad);
  new Loop(app, { stepHz: T.STEP_HZ }).start();
}

main();
