/**
 * All sound, synthesised. See DESIGN.md §6.5.
 *
 * Nothing is sampled — partly because the original's audio is copyrighted (§2), and
 * partly because a synth is the right tool for a game whose sounds are all short,
 * percussive and pitched. Every voice below is a few oscillators and an envelope.
 *
 * The AudioContext is created lazily and resumed on the first real input, because
 * browsers refuse to start audio without a user gesture.
 */

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

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastPlayed = new Map<SfxName, number>();

  muted = false;
  volume = 0.5;

  /** Browsers block audio until a gesture; call this from the first real keypress. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
      } catch {
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get ready(): boolean {
    return !!this.ctx && !!this.master && this.ctx.state === 'running';
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && !this.muted) this.master.gain.value = this.volume;
  }

  /* ------------------------------------------------------------------ voices */

  private env(
    node: AudioNode,
    attack: number,
    decay: number,
    peak = 1,
  ): GainNode | null {
    if (!this.ctx || !this.master) return null;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g);
    g.connect(this.master);
    return g;
  }

  private tone(
    type: OscillatorType,
    from: number,
    to: number,
    attack: number,
    decay: number,
    peak = 0.3,
  ): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + attack + decay);
    this.env(o, attack, decay, peak);
    o.start(t);
    o.stop(t + attack + decay + 0.02);
  }

  private noise(decay: number, peak = 0.3, filterFrom = 4000, filterTo = 200): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * (decay + 0.02)));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Deterministic-ish noise; the exact samples do not matter, only that it hisses.
    let seed = 22222;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (seed / 0x3fffffff - 1) * 0.9;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(filterFrom, t);
    filt.frequency.exponentialRampToValueAtTime(Math.max(40, filterTo), t + decay);
    src.connect(filt);
    this.env(filt, 0.005, decay, peak);
    src.start(t);
    src.stop(t + decay + 0.02);
  }

  private arp(notes: number[], step: number, type: OscillatorType = 'square', peak = 0.22): void {
    if (!this.ctx) return;
    notes.forEach((f, i) => {
      const t = this.ctx!.currentTime + i * step;
      const o = this.ctx!.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + step * 1.4);
      o.connect(g);
      g.connect(this.master!);
      o.start(t);
      o.stop(t + step * 1.6);
    });
  }

  /* ------------------------------------------------------------------ playback */

  /**
   * A rising sweep — the "something is happening to you" voice.
   *
   * The cabinet's exit was a long, unmistakable event rather than a blip, and that is
   * most of why people remember it. A single arpeggio cannot carry that, so this stacks
   * three things that a chip could not do at once: a glide up in pitch, a resonant filter
   * opening over noise, and a sub-bass swell underneath.
   */
  private sweep(from: number, to: number, dur: number, peak = 0.2): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;

    // The voice: two detuned saws gliding up an octave and a fifth.
    for (const detune of [-7, 7]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.setValueAtTime(detune, t);
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.Q.setValueAtTime(9, t);
      filt.frequency.setValueAtTime(from * 2, t);
      filt.frequency.exponentialRampToValueAtTime(Math.max(200, to * 4), t + dur);
      o.connect(filt);
      this.env(filt, dur * 0.55, dur * 0.45, peak * 0.5);
      o.start(t);
      o.stop(t + dur + 0.05);
    }

    // The floor: a sub that swells and drops away, so it lands in the chest.
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(from / 2, t);
    sub.frequency.exponentialRampToValueAtTime(Math.max(20, from / 3), t + dur);
    this.env(sub, dur * 0.5, dur * 0.5, peak * 0.85);
    sub.start(t);
    sub.stop(t + dur + 0.05);
  }

  /** `throttle` in ms stops a stream of identical events becoming a buzzsaw. */
  play(name: SfxName, throttle = 0): void {
    if (!this.ready || this.muted) return;
    if (throttle > 0) {
      const now = performance.now();
      const last = this.lastPlayed.get(name) ?? -1e9;
      if (now - last < throttle) return;
      this.lastPlayed.set(name, now);
    }

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
