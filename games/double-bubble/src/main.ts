import { Display } from '@/engine/display';
import { Loop } from '@/engine/loop';
import { readJson } from '@/engine/storage';
import { createDevices, type Action } from '@/game/controls';
import { validateRoom } from '@/game/room';
import { App } from '@/ui/app';
import { T } from '@/data/tuning';
import type { Bindings } from '@/engine/keyboard';
import type { PadProfile } from '@/engine/gamepad';

import room001 from '@/data/rooms/r001.json';

const SETTINGS_KEY = 'double-bubble.settings.v1';

interface Settings {
  keyBindings?: Partial<Bindings<Action>>;
  padProfiles?: Record<string, PadProfile<Action>>;
  scale?: number | null;
  rumble?: boolean;
}

function boot(): void {
  const stage = document.getElementById('stage');
  if (!stage) throw new Error('#stage missing');

  const display = new Display(stage, {
    viewW: T.VIEW_W,
    viewH: T.VIEW_H,
    artScale: T.ART_SCALE,
    scaleMin: T.SCREEN_SCALE_MIN,
    scaleMax: T.SCREEN_SCALE_MAX,
  });

  const devices = createDevices();
  devices.attach();

  const settings = readJson<Settings>(SETTINGS_KEY, {});
  if (settings.keyBindings) devices.keyboard.deserialise(settings.keyBindings);
  if (settings.padProfiles) devices.gamepad.profiles = settings.padProfiles;
  if (settings.rumble !== undefined) devices.gamepad.rumbleEnabled = settings.rumble;
  if (settings.scale !== undefined) display.setScale(settings.scale);

  // Browsers only expose gamepads after a button press on a focused page.
  window.addEventListener('gamepadconnected', () => devices.poll());

  const parsed = validateRoom(room001);
  if (!parsed.ok) {
    // A bundled room failing validation is a build-time mistake, not a runtime
    // condition. Say exactly what is wrong rather than rendering an empty screen.
    throw new Error(`r001 failed validation:\n  ${parsed.errors.join('\n  ')}`);
  }

  const app = new App(display, devices, parsed.data, 1);
  const loop = new Loop(app, { stepHz: T.STEP_HZ });
  loop.start();

  document.getElementById('boot')?.remove();

  // Expose for console poking during development.
  Object.assign(window as unknown as Record<string, unknown>, {
    bubble: { display, devices, app, loop, room: parsed.data },
  });
}

boot();
