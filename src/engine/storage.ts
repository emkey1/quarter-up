import type { PadProfile } from './gamepad';
import type { KeyBindings } from './keyboard';
import type { FireModel } from './input';
import type { Rules } from '@/data/rules';

const KEY = 'bracer.settings.v1';

export interface Settings {
  keyBindings?: Partial<KeyBindings>;
  padProfiles?: Record<string, PadProfile>;
  fireModel?: FireModel;
  analogMovement?: boolean;
  rumble?: boolean;
  scaleOverride?: number | null;
  rules?: Rules;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Settings) : {};
  } catch {
    return {}; // private browsing, quota, corrupt JSON — never block the game on this
  }
}

export function saveSettings(patch: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadSettings(), ...patch }));
  } catch {
    /* ignore */
  }
}
