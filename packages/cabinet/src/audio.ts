/**
 * All sound, synthesised.
 *
 * Nothing is sampled — partly because the originals' audio is copyrighted, and partly
 * because a synth is the right tool for games whose sounds are all short, percussive and
 * pitched. Every voice is a few oscillators and an envelope.
 *
 * The AudioContext is created lazily and resumed on the first real input, because
 * browsers refuse to start audio without a user gesture.
 *
 * The split here is the one the diff found. Both games' copies of this file had byte-
 * identical machinery — context lifecycle, mute, volume, throttling, and the four
 * synthesis primitives — and differed only in their list of sound names and the bodies
 * that play them. So the machinery is the base class and the voice table is abstract.
 * A game subclasses this, names its own sounds, and implements one method.
 */

export abstract class Synth<N extends string> {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastPlayed = new Map<N, number>();

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

  /* -------------------------------------------------- synthesis primitives */

  protected env(
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

  protected tone(
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

  protected noise(decay: number, peak = 0.3, filterFrom = 4000, filterTo = 200): void {
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

  protected arp(notes: number[], step: number, type: OscillatorType = 'square', peak = 0.22): void {
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

  /**
   * A rising sweep — the "something is happening to you" voice.
   *
   * The cabinet's exit was a long, unmistakable event rather than a blip, and that is
   * most of why people remember it. A single arpeggio cannot carry that, so this stacks
   * three things that a chip could not do at once: a glide up in pitch, a resonant filter
   * opening over noise, and a sub-bass swell underneath.
   */
  protected sweep(from: number, to: number, dur: number, peak = 0.2): void {
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

  /* ------------------------------------------------------------------ playback */

  /**
   * Play a named sound. `throttle` in ms stops a stream of identical events becoming a
   * buzzsaw — a dozen monsters dying on the same frame should be one death sound.
   *
   * Throttling, muting and the readiness check live here rather than in the subclass so
   * that a game implementing `voice` cannot forget them.
   */
  play(name: N, throttle = 0): void {
    if (!this.ready || this.muted) return;
    if (throttle > 0) {
      const now = performance.now();
      const last = this.lastPlayed.get(name) ?? -1e9;
      if (now - last < throttle) return;
      this.lastPlayed.set(name, now);
    }
    this.voice(name);
  }

  /**
   * Render one sound, using the primitives above. Called only when the context is live
   * and unmuted, so implementations need no guards of their own.
   */
  protected abstract voice(name: N): void;
}
