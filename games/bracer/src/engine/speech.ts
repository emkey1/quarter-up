/**
 * Speaks the announcer's lines, and always captions them.
 *
 * Captions are not an accessibility afterthought here — they are the primary channel.
 * speechSynthesis voice availability varies wildly by browser and OS, some machines have
 * none installed at all, and plenty of people play muted. The game must be exactly as
 * legible in silence, so the caption is drawn whether or not a voice exists (DESIGN.md §6.5).
 */

export interface Caption {
  text: string;
  /** performance.now() timestamp after which it fades. */
  until: number;
}

const CAPTION_MS = 2600;
/** Hard rate limit. Lines are DROPPED rather than queued — a backlog of stale warnings
 *  is worse than silence, because it describes a crisis you already survived. */
const MIN_GAP_MS = 3500;

export class Speech {
  enabled = true;
  captionsEnabled = true;

  private lastSpokeAt = -1e9;
  private voice: SpeechSynthesisVoice | null = null;
  private probed = false;

  captions: Caption[] = [];

  /** True if the platform gave us any voice at all. */
  get hasVoice(): boolean {
    this.probe();
    return !!this.voice;
  }

  private get synth(): SpeechSynthesis | null {
    return typeof window !== 'undefined' && 'speechSynthesis' in window
      ? window.speechSynthesis
      : null;
  }

  private probe(): void {
    if (this.probed) return;
    const synth = this.synth;
    if (!synth) {
      this.probed = true;
      return;
    }
    const voices = synth.getVoices();
    if (!voices.length) return; // not loaded yet; try again next time
    this.probed = true;
    // Prefer a plain English voice; the robotic register comes from pitch/rate.
    this.voice =
      voices.find((v) => /^en[-_]/i.test(v.lang) && /male|daniel|alex|fred/i.test(v.name)) ??
      voices.find((v) => /^en[-_]/i.test(v.lang)) ??
      voices[0] ??
      null;
  }

  say(text: string, now = performance.now()): boolean {
    if (now - this.lastSpokeAt < MIN_GAP_MS) return false;
    this.lastSpokeAt = now;

    if (this.captionsEnabled) {
      this.captions.push({ text, until: now + CAPTION_MS });
      if (this.captions.length > 3) this.captions.shift();
    }

    if (!this.enabled) return true;
    const synth = this.synth;
    if (!synth) return true; // captioned only; still counts as said
    this.probe();
    try {
      const u = new SpeechSynthesisUtterance(text);
      if (this.voice) u.voice = this.voice;
      u.rate = 0.85;
      u.pitch = 0.6;
      u.volume = 0.9;
      synth.cancel(); // never let warnings pile up behind each other
      synth.speak(u);
    } catch {
      /* captions carry it */
    }
    return true;
  }

  activeCaptions(now = performance.now()): Caption[] {
    this.captions = this.captions.filter((c) => c.until > now);
    return this.captions;
  }

  cancel(): void {
    this.synth?.cancel();
    this.captions.length = 0;
  }
}
