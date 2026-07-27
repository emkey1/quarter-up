/**
 * The editor-to-game handoff.
 *
 * Its own module, tiny as it is, because the editor must not import main.ts — that file
 * boots the game as a side effect of being imported, which inside the editor page would
 * mean two games fighting over the same input.
 */
export const PLAYTEST_KEY = 'bracer.playtest';
