/**
 * Bracer's voice table.
 *
 * The synthesis machinery — context lifecycle, mute, volume, throttling, and the tone /
 * noise / arp / sweep primitives — is shared with the other cabinets and lives in
 * `@cabinet/audio`. What is left here is the part that is actually this game: what
 * sounds exist, and what each one is made of. See DESIGN.md §6.5.
 *
 * Nothing is sampled — the original's audio is copyrighted (§2), and a synth is the
 * right tool for sounds this short and percussive anyway.
 */

import { Synth } from '@cabinet/audio';

export type SfxName =
  | 'shot'
  | 'shotWall'
  | 'melee'
  | 'monsterDie'
  | 'ghostDie'
  | 'generatorHit'
  | 'generatorDie'
  | 'spawn'
  | 'hurt'
  | 'die'
  | 'potion'
  | 'pickupFood'
  | 'pickupKey'
  | 'pickupTreasure'
  | 'pickupPotion'
  | 'upgrade'
  | 'door'
  | 'teleport'
  | 'thiefTone'
  | 'thiefSteal'
  | 'deathTouch'
  | 'levelStart'
  | 'exit'
  | 'exitOpen';

export class Audio extends Synth<SfxName> {
  protected override voice(name: SfxName): void {
    switch (name) {
      case 'shot':
        this.tone('square', 880, 220, 0.005, 0.07, 0.18);
        break;
      case 'shotWall':
        this.noise(0.05, 0.12, 2500, 400);
        break;
      case 'melee':
        this.noise(0.09, 0.22, 1800, 200);
        this.tone('triangle', 320, 120, 0.005, 0.09, 0.16);
        break;
      case 'monsterDie':
        this.noise(0.16, 0.2, 3000, 300);
        this.tone('triangle', 400, 90, 0.005, 0.16, 0.14);
        break;
      case 'ghostDie':
        this.tone('sine', 900, 180, 0.005, 0.22, 0.16);
        this.noise(0.12, 0.1, 5000, 900);
        break;
      case 'generatorHit':
        this.noise(0.07, 0.16, 2200, 500);
        break;
      case 'generatorDie':
        this.noise(0.5, 0.4, 3500, 90);
        this.tone('sine', 150, 40, 0.01, 0.5, 0.32);
        break;
      case 'spawn':
        this.tone('sawtooth', 180, 420, 0.02, 0.1, 0.07);
        break;
      case 'hurt':
        this.tone('sawtooth', 260, 110, 0.005, 0.13, 0.2);
        break;
      case 'die':
        this.tone('sawtooth', 420, 40, 0.02, 1.1, 0.3);
        this.noise(0.9, 0.22, 2200, 80);
        break;
      case 'potion':
        // white noise swell through a sweeping lowpass — the smart-bomb signature
        this.noise(1.1, 0.45, 400, 6000);
        this.tone('sine', 90, 30, 0.05, 1.0, 0.3);
        break;
      case 'pickupFood':
        this.arp([523, 659, 784], 0.055, 'triangle', 0.2);
        break;
      case 'pickupKey':
        this.arp([784, 1047], 0.05, 'square', 0.16);
        break;
      case 'pickupTreasure':
        this.arp([659, 880, 1175], 0.045, 'square', 0.16);
        break;
      case 'pickupPotion':
        this.arp([440, 587, 880], 0.05, 'sine', 0.2);
        break;
      case 'upgrade':
        this.arp([523, 659, 784, 1047, 1319], 0.07, 'triangle', 0.24);
        break;
      case 'door':
        this.tone('square', 220, 110, 0.01, 0.28, 0.16);
        this.noise(0.3, 0.14, 1200, 150);
        break;
      case 'teleport':
        this.tone('sine', 200, 1600, 0.02, 0.32, 0.2);
        break;
      case 'thiefTone':
        // deliberately piercing and unlike anything else: it is a warning
        this.tone('sine', 1760, 1760, 0.02, 0.55, 0.16);
        break;
      case 'thiefSteal':
        this.arp([880, 622, 440], 0.06, 'square', 0.2);
        break;
      case 'deathTouch':
        this.tone('sawtooth', 70, 55, 0.01, 0.18, 0.26);
        break;
      case 'levelStart':
        this.arp([392, 523, 659, 784, 659, 784], 0.11, 'triangle', 0.2);
        break;
      case 'exit':
        // The full send-off, ~1.2s, matching EXIT_SEQUENCE_F. Layered so it arrives in
        // three stages the way the animation does: the pull, the climb, the arrival.
        this.sweep(180, 1400, 1.05, 0.22);
        this.arp([523, 659, 784, 1047, 1319], 0.11, 'triangle', 0.2);
        this.noise(0.9, 0.1, 600, 7000);
        break;
      /** The short chime, still used when walls give way — not a level ending. */
      case 'exitOpen':
        this.arp([523, 784, 1047], 0.08, 'triangle', 0.22);
        break;
    }
  }
}
