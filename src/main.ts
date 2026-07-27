import { Display } from '@/engine/display';
import { Input } from '@/engine/input';
import { Loop } from '@/engine/loop';
import { loadSettings } from '@/engine/storage';
import { validateLevel } from '@/game/level';
import { PlayScreen } from '@/ui/play';
import provingJson from '@/data/levels/proving.json';

function boot(): void {
  const stage = document.getElementById('stage');
  if (!stage) throw new Error('#stage missing');

  const result = validateLevel(provingJson);
  if (!result.ok) {
    document.body.innerHTML = `<pre style="padding:24px;color:#ff6b5e;white-space:pre-wrap">Level failed validation:\n\n${result.errors.join('\n')}</pre>`;
    return;
  }

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

  const screen = new PlayScreen(display, input, result.data, 'elf');
  const loop = new Loop(screen);
  screen.loop = loop;
  loop.start();

  document.getElementById('boot')?.remove();

  // Expose for console poking during development. padReport() prints the persisted
  // controller history as copyable text — canvas text cannot be selected.
  Object.assign(window as unknown as Record<string, unknown>, {
    bracer: {
      display,
      input,
      screen,
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
