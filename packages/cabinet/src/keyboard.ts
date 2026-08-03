/**
 * Physical-key codes throughout (event.code), so keyboard layout never matters.
 *
 * Generic over the action set: the engine has no opinion about what actions exist,
 * which is what lets this file move to packages/ unchanged. The game supplies both the
 * action list and the default bindings — see game/controls.ts.
 */
export type Bindings<A extends string> = Record<A, string[]>;

/**
 * Keys whose browser default is suppressed while the game has focus.
 *
 * Anything a game binds has to be here, or the browser acts on it too: arrows scroll,
 * Space scrolls and re-activates the focused button, Tab moves focus out of the canvas,
 * Backspace used to navigate back. Modifiers are the subtle ones — Alt alone focuses
 * Chrome's menu bar on Windows, so a player using it as an action key kept losing the
 * keyboard mid-run.
 */
export const SWALLOW = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'Tab',
  'Backspace',
  'Slash',
  // Enter activates whatever the browser thinks is focused — which, after a click on a
  // menu button, is that button. Left alone it re-fires the last thing the player
  // pressed every time they use Enter in play.
  'Enter',
  'NumpadEnter',
  'AltLeft',
  'AltRight',
]);

export class Keyboard<A extends string> {
  private readonly down = new Set<string>();
  /** Codes that saw a keydown since the last poll. Latched so a press+release that
   *  falls entirely between two frames is still observed exactly once. */
  private readonly pressedSincePoll = new Set<string>();
  /** Snapshot handed to the current frame. */
  private framePressed = new Set<string>();

  bindings: Bindings<A>;

  /** Set while the Options rebinding UI is capturing; suppresses gameplay reads. */
  capture: ((code: string) => void) | null = null;

  private attached = false;

  constructor(
    private readonly actions: readonly A[],
    private readonly defaults: Bindings<A>,
  ) {
    this.bindings = { ...defaults };
  }

  attach(target: Window = window): void {
    if (this.attached) return;
    this.attached = true;
    target.addEventListener('keydown', this.onKeyDown, { passive: false });
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.clear);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  detach(target: Window = window): void {
    if (!this.attached) return;
    this.attached = false;
    target.removeEventListener('keydown', this.onKeyDown);
    target.removeEventListener('keyup', this.onKeyUp);
    target.removeEventListener('blur', this.clear);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private onVisibility = (): void => {
    if (document.hidden) this.clear();
  };

  /** Alt-tabbing with keys held would otherwise leave them stuck down forever. */
  clear = (): void => {
    this.down.clear();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (SWALLOW.has(e.code)) e.preventDefault();
    if (e.repeat) return;

    if (this.capture) {
      e.preventDefault();
      const fn = this.capture;
      this.capture = null;
      fn(e.code);
      return;
    }

    this.down.add(e.code);
    this.pressedSincePoll.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  poll(): void {
    this.framePressed = new Set(this.pressedSincePoll);
    this.pressedSincePoll.clear();
  }

  held(action: A): boolean {
    for (const c of this.bindings[action]) if (this.down.has(c)) return true;
    return false;
  }

  pressed(action: A): boolean {
    for (const c of this.bindings[action]) if (this.framePressed.has(c)) return true;
    return false;
  }

  /** Raw code queries, for dev hotkeys and menu shortcuts that aren't bindable actions. */
  isCodeDown(code: string): boolean {
    return this.down.has(code);
  }

  wasCodePressed(code: string): boolean {
    return this.framePressed.has(code);
  }

  /** True if any key is currently down — used to pick the active device. */
  anyActivity(): boolean {
    return this.down.size > 0 || this.framePressed.size > 0;
  }

  /**
   * How many keys are registering at once, for the Options rollover tester.
   * Cheap keyboards silently drop the third simultaneous key (ghosting); if this never
   * exceeds 2, recommend a gamepad.
   */
  concurrentKeys(): number {
    return this.down.size;
  }

  resetBindings(): void {
    this.bindings = { ...this.defaults };
  }

  bind(action: A, codes: string[]): void {
    this.bindings[action] = codes;
  }

  serialise(): Bindings<A> {
    return { ...this.bindings };
  }

  deserialise(b: Partial<Bindings<A>> | undefined): void {
    if (!b) return;
    for (const a of this.actions) {
      const v = b[a];
      if (Array.isArray(v)) this.bindings[a] = v.slice();
    }
  }
}
