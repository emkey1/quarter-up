/**
 * Safe localStorage access.
 *
 * Every call is guarded: storage throws on access in private mode on some browsers, and
 * a settings read is never important enough to take the game down with it. Callers get
 * a fallback and carry on.
 *
 * Generic on purpose — the engine has no idea what this game persists.
 */

export function readJson<T>(key: string, fallback: T): T {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return fallback;
  }
  if (raw === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // quota, private mode, disabled — all equally survivable
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing to do */
  }
}
