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
