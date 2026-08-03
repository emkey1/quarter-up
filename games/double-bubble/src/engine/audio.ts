/**
 * Double Bubble's voice table.
 *
 * The synthesis machinery — context lifecycle, mute, volume, throttling, and the tone /
 * noise / arp / sweep primitives — is shared with Bracer and lives in the cabinet. What
 * is left here is the part that is actually this game: what sounds exist, and what each
 * one is made of.
 *
 * Everything is bubbles and bounce. Nothing is sampled.
 */

import { Synth } from '@cabinet/audio';

export type SfxName =
  | 'blow'
  | 'bubblePop'
  | 'monsterPop'
  | 'chain'
  | 'jump'
  | 'land'
  | 'ride'
  | 'pickup'
  | 'pickupBig'
  | 'extend'
  | 'extendDone'
  | 'die'
  | 'escape'
  | 'button'
  | 'silver'
  | 'door'
  | 'hurryUp'
  | 'roomStart'
  | 'roomClear';

export class Audio extends Synth<SfxName> {
  protected override voice(name: SfxName): void {
    switch (name) {
      // --- bubbles
      case 'blow':
        // Short, breathy, rising: air leaving you rather than a gunshot.
        this.noise(0.09, 0.14, 900, 2600);
        this.tone('sine', 320, 620, 0.01, 0.09, 0.12);
        break;
      case 'bubblePop':
        this.tone('sine', 900, 1500, 0.005, 0.05, 0.16);
        this.noise(0.05, 0.09, 3000, 800);
        break;
      case 'monsterPop':
        // Fatter than an empty pop, so a loaded bubble sounds worth more.
        this.tone('triangle', 500, 1100, 0.005, 0.13, 0.22);
        this.noise(0.1, 0.13, 2400, 500);
        break;
      case 'chain':
        // The reward. Rising arpeggio — the more it climbs the better you did.
        this.arp([523, 659, 784, 1047, 1319, 1568], 0.055, 'square', 0.18);
        break;

      // --- movement
      case 'jump':
        this.tone('square', 300, 560, 0.005, 0.07, 0.1);
        break;
      case 'land':
        this.noise(0.05, 0.08, 700, 200);
        break;
      case 'ride':
        // Standing on a bubble: soft, low, almost a bounce.
        this.tone('sine', 220, 300, 0.01, 0.1, 0.08);
        break;

      // --- items and progression
      case 'pickup':
        this.arp([784, 1047], 0.05, 'triangle', 0.16);
        break;
      case 'pickupBig':
        this.arp([659, 880, 1319], 0.06, 'triangle', 0.2);
        break;
      case 'extend':
        // One letter. Deliberately unresolved — it wants the next one.
        this.tone('square', 880, 1175, 0.01, 0.12, 0.18);
        break;
      case 'extendDone':
        // All six. This one resolves, and then some.
        this.arp([523, 659, 784, 1047, 1319, 1568, 2093], 0.07, 'square', 0.22);
        this.sweep(200, 1200, 0.7, 0.16);
        break;

      // --- threat and structure
      case 'die':
        this.tone('sawtooth', 400, 80, 0.01, 0.5, 0.24);
        this.noise(0.35, 0.16, 1200, 120);
        break;
      case 'escape':
        // A captive breaking out: a warning, not a reward.
        this.tone('sawtooth', 180, 340, 0.01, 0.16, 0.18);
        break;
      case 'button':
        this.tone('square', 660, 660, 0.005, 0.06, 0.16);
        break;
      case 'silver':
        this.arp([1047, 1319, 1568], 0.05, 'square', 0.18);
        break;
      case 'door':
        this.arp([392, 523, 659, 784], 0.09, 'triangle', 0.2);
        break;
      case 'hurryUp':
        // Baron von Blubba is coming. Two falling notes, and it should not be pleasant.
        this.tone('sawtooth', 520, 300, 0.01, 0.22, 0.22);
        this.tone('sawtooth', 260, 150, 0.12, 0.3, 0.18);
        break;
      case 'roomStart':
        this.arp([523, 659, 784], 0.07, 'triangle', 0.16);
        break;
      case 'roomClear':
        this.arp([523, 659, 784, 1047], 0.08, 'square', 0.2);
        this.sweep(300, 900, 0.5, 0.12);
        break;
    }
  }
}
