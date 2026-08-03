/**
 * What Bracer persists between sessions.
 *
 * The guarded localStorage access underneath is shared (`@cabinet/storage`); this file
 * is only the shape of the blob and the key it lives under. Everything is optional
 * because any of it may be missing from an older save, and a settings read is never
 * important enough to take the game down with it.
 */

import { readJson, writeJson } from '@cabinet/storage';
import type { PadProfile } from '@cabinet/gamepad';
import type { ActionName } from './actions';
import type { KeyBindings } from './controls';
import type { FireModel } from './input';
import type { Rules } from '@/data/rules';

const KEY = 'bracer.settings.v1';

export interface Settings {
  keyBindings?: Partial<KeyBindings>;
  padProfiles?: Record<string, PadProfile<ActionName>>;
  fireModel?: FireModel;
  analogMovement?: boolean;
  rumble?: boolean;
  scaleOverride?: number | null;
  rules?: Rules;
  /** Whether the last run chose to skip the intro levels. */
  skipTutorial?: boolean;
}

export function loadSettings(): Settings {
  return readJson<Settings>(KEY, {});
}

export function saveSettings(patch: Settings): void {
  writeJson(KEY, { ...loadSettings(), ...patch });
}
