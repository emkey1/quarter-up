import { Display } from '@/engine/display';
import { Input } from '@/engine/input';
import { Loop } from '@/engine/loop';
import { loadSettings } from '@/engine/storage';
import { validateLevel, type LevelData } from '@/game/level';
import { App } from '@/ui/app';
import { PLAYTEST_KEY } from '@/playtest';

/**
 * A level handed over by the editor, if we were opened as a playtest.
 *
 * Storage rather than a query string, because a 32x32 maze plus its objects is far too
 * big for a URL. The `?playtest` marker is what actually decides: without it the key is
 * ignored entirely, so a stale one can never hijack an ordinary game. Reloading the
 * playtest tab re-runs the same level, which is exactly what you want while iterating.
 *
 * The level still goes through validateLevel — the editor is a tool, not a trusted
 * source, and a malformed level should say so rather than crash the game.
 */
function playtestLevel(): LevelData | null {
  if (!new URLSearchParams(location.search).has('playtest')) return null;

  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PLAYTEST_KEY);
  } catch {
    return null; // storage disabled; not a playtest
  }
  if (!raw) {
    console.error('playtest requested but no level was handed over');
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('playtest level is not valid JSON');
    return null;
  }
  const r = validateLevel(parsed);
  if (!r.ok) {
    console.error('playtest level failed validation:\n  ' + r.errors.join('\n  '));
    return null;
  }
  return r.data;
}

function boot(): void {
  const stage = document.getElementById('stage');
  if (!stage) throw new Error('#stage missing');

  const display = new Display(stage);
  const input = new Input();
  input.attach();

  const settings = loadSettings();
  if (settings.padProfiles) input.gamepad.profiles = settings.padProfiles;
  if (settings.keyBindings) input.keyboard.deserialise(settings.keyBindings);
  if (settings.analogMovement !== undefined) input.gamepad.analogMovement = settings.analogMovement;
  if (settings.rumble !== undefined) input.gamepad.rumbleEnabled = settings.rumble;

  // Browsers only expose gamepads after a button press on a focused page; a click
  // gives the document user activation, which some engines also require first.
  window.addEventListener('gamepadconnected', () => input.poll(), { once: false });

  const app = new App(display, input, playtestLevel());
  const loop = new Loop(app);
  app.loop = loop;
  loop.start();

  document.getElementById('boot')?.remove();

  // Expose for console poking during development. padReport() prints the persisted
  // controller history as copyable text — canvas text cannot be selected.
  Object.assign(window as unknown as Record<string, unknown>, {
    bracer: {
      display,
      input,
      app,
      loop,
      padReport: () => {
        const txt = input.gamepad.log.report();
        console.log(txt);
        return txt;
      },
      padReset: () => input.gamepad.log.clear(),
    },
  });
}

boot();
