/** Dungeon theme palettes. M4 replaces the procedural drawing with real art; the
 *  palette structure stays, because monster/tile recolouring by ramp is what keeps the
 *  art budget sane (DESIGN.md §6.4). */
export interface Theme {
  id: string;
  floorBase: string;
  floorAlt: string[];
  floorLine: string;
  wallFace: string;
  wallLight: string;
  wallDark: string;
  wallSeam: string;
  breakable: string;
  breakableLight: string;
  door: string;
  doorLight: string;
  exit: string;
  exitGlow: string;
  teleport: string;
  teleportGlow: string;
  trap: string;
  ambient: string;
}

export const THEMES: Record<string, Theme> = {
  stone: {
    id: 'stone',
    floorBase: '#3a2a22',
    floorAlt: ['#3f2e25', '#35261f', '#42312a', '#382a22'],
    floorLine: '#241a15',
    wallFace: '#2f5f8f',
    wallLight: '#4d86bd',
    wallDark: '#1b3a5c',
    wallSeam: '#173049',
    breakable: '#6a5a3a',
    breakableLight: '#9a8552',
    door: '#8a6a2a',
    doorLight: '#c9a45a',
    exit: '#2a7a3a',
    exitGlow: '#6ff08a',
    teleport: '#6a2a8a',
    teleportGlow: '#c46bf5',
    trap: '#5a4a3a',
    ambient: '#0a0a0f',
  },
};

export function theme(id: string): Theme {
  return THEMES[id] ?? THEMES.stone!;
}
