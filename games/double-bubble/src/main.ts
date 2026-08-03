import { Display } from '@cabinet/display';
import { Loop } from '@cabinet/loop';
import { readJson } from '@cabinet/storage';
import { createDevices, type Action } from '@/game/controls';
import { App } from '@/ui/app';
import { T } from '@/data/tuning';
import type { Bindings } from '@cabinet/keyboard';
import type { PadProfile } from '@cabinet/gamepad';

// Every room is loaded and validated here, at module load. A bundled room that fails
// validation is a build-time mistake, and finding out forty rooms into a run is the
// worst possible time.
import { ROOM_COUNT, roomFor } from '@/data/rooms';

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
    // A room is one screen and the HUD sits over the playfield, so a too-narrow window
    // simply loses both flanks rather than keeping a cramped one.
    keepRightPanel: false,
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

  const first = roomFor(1);
  const app = new App(display, devices, first, 1);
  const loop = new Loop(app, { stepHz: T.STEP_HZ });
  loop.start();

  document.getElementById('boot')?.remove();

  // Expose for console poking during development.
  Object.assign(window as unknown as Record<string, unknown>, {
    bubble: { display, devices, app, loop, room: first, rooms: ROOM_COUNT },
  });
}

boot();
