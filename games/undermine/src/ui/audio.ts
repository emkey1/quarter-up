import { Synth } from '@cabinet/audio';

/**
 * Undermine's voice table.
 *
 * The synthesis machinery — context lifecycle, mute, volume, throttling, and the tone /
 * noise / arp / sweep primitives — is shared with the other two cabinets and lives in
 * `@cabinet/audio`. What is left here is the part that is actually this game.
 *
 * Third game on that base, and the first written against it rather than extracted into
 * it: the file is a list of sounds and nothing else, which is what the split was for.
 *
 * The palette is earth. Almost everything is filtered noise rather than tone, because
 * this is a game about digging through soil and a bright square wave would sound like a
 * different cabinet entirely. The exceptions are the pump and the bursts, which need to
 * cut through — they are the only things the player is doing on purpose.
 */
export type SfxName =
  | 'dig'
  | 'walk'
  | 'pump'
  | 'burst'
  | 'deflate'
  | 'teeter'
  | 'rockFall'
  | 'rockLand'
  | 'crush'
  | 'ghost'
  | 'solidify'
  | 'flame'
  | 'die'
  | 'roundStart'
  | 'roundClear'
  | 'bonus'
  | 'button';

export class Audio extends Synth<SfxName> {
  protected override voice(name: SfxName): void {
    switch (name) {
      // --- moving through the world
      case 'dig':
        // Short, dry, low. Heard constantly, so it has to sit under everything else
        // rather than compete with it — this is the sound the player will hear most.
        this.noise(0.06, 0.1, 1200, 300);
        break;
      case 'walk':
        this.noise(0.04, 0.05, 900, 400);
        break;

      // --- the pump
      case 'pump':
        // A puff of air with a rising body, so a run of presses builds audibly toward
        // the burst rather than repeating flatly.
        this.noise(0.07, 0.12, 700, 2200);
        this.tone('sine', 260, 460, 0.01, 0.08, 0.12);
        break;
      case 'burst':
        this.tone('triangle', 520, 90, 0.005, 0.18, 0.24);
        this.noise(0.14, 0.18, 2600, 400);
        break;
      case 'deflate':
        // The consolation prize: something you were working on has slipped away.
        this.tone('sine', 420, 200, 0.01, 0.16, 0.09);
        break;

      // --- rocks
      case 'teeter':
        // The warning, and it has to be unmistakable — the player has half a second to
        // decide whether they are standing somewhere fatal.
        this.arp([180, 210, 180, 210], 0.05, 'square', 0.14);
        break;
      case 'rockFall':
        this.sweep(140, 60, 0.4, 0.18);
        break;
      case 'rockLand':
        this.noise(0.26, 0.3, 900, 90);
        this.tone('sine', 90, 40, 0.005, 0.24, 0.22);
        break;
      case 'crush':
        // Bigger than a landing: this is the pay-off for setting the whole thing up.
        this.noise(0.34, 0.34, 1400, 80);
        this.arp([320, 420, 560, 740], 0.05, 'square', 0.2);
        break;

      // --- enemies
      case 'ghost':
        // Something has stopped playing by the rules of the tunnel network. Detuned and
        // airy, so it reads as wrong rather than as another impact.
        this.sweep(220, 700, 0.5, 0.1);
        break;
      case 'solidify':
        this.tone('triangle', 700, 240, 0.01, 0.12, 0.1);
        break;
      case 'flame':
        this.noise(0.42, 0.22, 3200, 700);
        this.tone('sawtooth', 180, 120, 0.02, 0.4, 0.08);
        break;

      // --- the run
      case 'die':
        this.arp([440, 350, 260, 180, 120], 0.1, 'triangle', 0.2);
        this.noise(0.5, 0.16, 1600, 120);
        break;
      case 'roundStart':
        this.arp([330, 440, 550, 660], 0.08, 'square', 0.16);
        break;
      case 'roundClear':
        this.arp([440, 550, 660, 880, 660, 880], 0.09, 'square', 0.18);
        break;
      case 'bonus':
        this.arp([660, 880, 1100], 0.06, 'sine', 0.2);
        break;
      case 'button':
        this.tone('square', 660, 660, 0.005, 0.05, 0.12);
        break;
    }
  }
}
