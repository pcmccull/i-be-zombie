// Opening-cinematic audio (docs/4_intro_scene.md §4): narration voice-over (HTMLAudioElement, optional) plus a
// synthesized score — uplifting theme, crescendo into the hero reveal, abrupt cut + awkward crickets, then the
// energetic gameplay loop. Every failure path is silent: the cinematic never waits on or breaks from audio.
// The scheduler is driven from the game's single frame loop (update()), never its own timer.
import narrationUrl from '../../assets/voiceover/intro2.mp3';
import musicUrl from '../../assets/background/music1.mp3';
import windUrl from '../../assets/background/background_wind.mp3';

/** Looping gameplay bed (assets/background): track + level. Played via <audio>, routed through Web Audio for mute/fades. */
interface BedTrack {
  url: string;
  level: number;
  el: HTMLAudioElement | null;
  gain: GainNode | null;
  failed: boolean;
}
const BED_FADE_IN = 2.5;

type MusicMode = 'off' | 'theme' | 'gameplay';

const THEME_BPM = 96;
const GAME_BPM = 124;
const LOOKAHEAD = 0.3;
// D major: I – V – vi – IV (root midi notes).
const THEME_CHORDS = [[50, 54, 57, 62], [45, 49, 52, 57], [47, 50, 54, 59], [43, 47, 50, 55]];
// Gameplay: D minor bounce, bass line + stab riff.
const GAME_BASS = [38, 38, 50, 38, 41, 41, 53, 41, 36, 36, 48, 36, 43, 43, 45, 47];
const GAME_RIFF = [62, -1, 65, -1, 69, 67, -1, 65, 62, -1, 60, -1, 62, 65, 64, -1];

const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

export class IntroAudio {
  private narration: HTMLAudioElement | null = null;
  private narrationFailed = false;
  private narrationReady = false;
  private muted = false;
  private ctx: AudioContext | null = null;
  private out: AudioNode | null = null;
  private musicGain: GainNode | null = null;
  private mode: MusicMode = 'off';
  private nextBeat = 0;
  private beat = 0;
  private building = false;
  private buildStart = 0;
  private buildEnd = 1;
  private crickets: number[] = [];
  private noise: AudioBuffer | null = null;
  private readonly music: BedTrack = { url: musicUrl, level: 0.38, el: null, gain: null, failed: false };
  private readonly wind: BedTrack = { url: windUrl, level: 0.22, el: null, gain: null, failed: false };
  private bedOn = false;

  /** Starts preloading the narration (safe to call before any user gesture). */
  preload(): void {
    this.preloadBed(this.music);
    this.preloadBed(this.wind);
    if (this.narration || this.narrationFailed || typeof Audio === 'undefined') return;
    try {
      const a = new Audio();
      a.preload = 'auto';
      a.src = narrationUrl;
      a.muted = this.muted;
      a.addEventListener('canplaythrough', () => { this.narrationReady = true; }, { once: true });
      a.addEventListener('error', () => { this.narrationFailed = true; }, { once: true });
      a.load();
      this.narration = a;
    } catch {
      this.narrationFailed = true;
    }
  }

  /** Narration is loaded enough to play through, or failed (=> timed subtitles only). */
  get narrationSettled(): boolean { return this.narrationReady || this.narrationFailed || !this.narration; }
  get narrationDuration(): number | null {
    const d = this.narration?.duration;
    return d && Number.isFinite(d) ? d : null;
  }
  get narrationPlaying(): boolean {
    const a = this.narration;
    return !!a && !this.narrationFailed && !a.paused && !a.ended && a.currentTime > 0;
  }
  get narrationTime(): number { return this.narration?.currentTime ?? 0; }

  /** Binds the shared Web Audio graph (AudioSystem's context + master output). */
  bind(ctx: AudioContext | null, out: AudioNode | null): void {
    if (!ctx || !out || this.ctx === ctx) return;
    this.ctx = ctx;
    this.out = out;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.connect(out);
    const len = Math.floor(ctx.sampleRate * 0.5);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let s = 7;
    for (let i = 0; i < len; i++) { s = (s * 16807) % 2147483647; data[i] = (s / 2147483647) * 2 - 1; }
    this.attachBed(this.music);
    this.attachBed(this.wind);
    // Gameplay was requested before audio was unlocked: bring the bed in now.
    if (this.bedOn) this.safe(() => this.startBed());
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.narration) this.narration.muted = m;
  }

  /** Plays the narration from `offset` seconds. Rejections (autoplay, decode) fall back to subtitles. */
  playNarration(offset = 0): void {
    const a = this.narration;
    if (!a || this.narrationFailed) return;
    try {
      a.currentTime = Math.max(0, offset);
      const p = a.play();
      if (p && typeof p.catch === 'function') p.catch(() => { this.narrationFailed = true; });
    } catch {
      this.narrationFailed = true;
    }
  }

  pauseNarration(): void { try { this.narration?.pause(); } catch { /* ignore */ } }
  resumeNarration(): void {
    const a = this.narration;
    if (!a || this.narrationFailed || a.ended || a.currentTime === 0) return;
    try { void a.play().catch(() => { /* keep subtitles */ }); } catch { /* ignore */ }
  }
  stopNarration(): void {
    const a = this.narration;
    if (!a) return;
    try { a.pause(); a.currentTime = 0; } catch { /* ignore */ }
  }

  // --- score ---------------------------------------------------------------------------------

  startTheme(): void { this.safe(() => { this.setMode('theme', 0.5, 2.5); this.building = false; }); }

  /** Crescendo from now over `seconds` (toward the reveal). */
  startBuild(seconds: number): void {
    this.safe(() => {
      if (!this.ctx || this.mode !== 'theme') return;
      const len = Number.isFinite(seconds) ? Math.max(0.5, seconds) : 0.5;
      this.building = true;
      this.buildStart = this.ctx.currentTime;
      this.buildEnd = this.buildStart + len;
      this.musicGain?.gain.setTargetAtTime(0.95, this.ctx.currentTime, len / 2.5);
    });
  }

  /** Abrupt stop on the reveal: record scratch, then awkward crickets. */
  cutForReveal(): void { this.safe(() => this.cut()); }

  private cut(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain || !this.out) { this.mode = 'off'; return; }
    const t = ctx.currentTime;
    this.mode = 'off';
    this.building = false;
    const g = this.musicGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + 0.03);
    this.recordScratch(t + 0.01);
    for (const at of [1.1, 1.45, 2.6, 2.95, 4.0]) this.crickets.push(t + at);
  }

  /** Gameplay music: the looping music1 track + wind ambience; synthesized loop only if the track can't play. */
  startGameplay(): void {
    this.safe(() => {
      this.bedOn = true;
      if (this.music.failed) this.setMode('gameplay', 0.42, 1.2);
      this.startBed();
    });
  }

  /** Silence all music immediately (skip, replay restore, dispose). */
  stopMusic(): void {
    this.mode = 'off';
    this.building = false;
    this.crickets.length = 0;
    this.bedOn = false;
    this.stopBed(this.music);
    this.stopBed(this.wind);
    this.safe(() => {
      if (!this.ctx || !this.musicGain) return;
      const g = this.musicGain.gain;
      g.cancelScheduledValues(this.ctx.currentTime);
      g.setValueAtTime(0, this.ctx.currentTime);
    });
  }

  /** Called once per rendered frame: schedules notes inside the lookahead window. */
  update(): void { this.safe(() => this.schedule()); }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.musicGain) return;
    const now = ctx.currentTime;
    while (this.crickets.length && this.crickets[0] < now + LOOKAHEAD) this.cricket(this.crickets.shift()!);
    if (this.mode === 'off') return;
    const bpm = this.mode === 'theme' ? THEME_BPM : GAME_BPM;
    const step = 60 / bpm / 2; // eighth notes
    if (this.nextBeat < now - 0.5) this.nextBeat = now + 0.05; // resumed after a stall: don't burst
    while (this.nextBeat < now + LOOKAHEAD) {
      if (this.mode === 'theme') this.themeStep(this.nextBeat, this.beat, step);
      else this.gameStep(this.nextBeat, this.beat, step);
      this.nextBeat += step;
      this.beat++;
    }
  }

  dispose(): void {
    this.stopMusic();
    this.stopNarration();
    try { this.musicGain?.disconnect(); } catch { /* ignore */ }
    for (const b of [this.music, this.wind]) {
      try { b.gain?.disconnect(); } catch { /* ignore */ }
      if (b.el) { b.el.removeAttribute('src'); try { b.el.load(); } catch { /* ignore */ } }
      b.el = null;
      b.gain = null;
    }
    if (this.narration) { this.narration.removeAttribute('src'); try { this.narration.load(); } catch { /* ignore */ } }
    this.narration = null;
  }

  // --- gameplay bed (assets/background) ---------------------------------------------------------

  private preloadBed(b: BedTrack): void {
    if (b.el || b.failed || typeof Audio === 'undefined') return;
    try {
      const a = new Audio();
      a.preload = 'auto';
      a.loop = true;
      a.src = b.url;
      a.addEventListener('error', () => this.bedFailed(b), { once: true });
      a.load();
      b.el = a;
      this.attachBed(b);
    } catch {
      b.failed = true;
    }
  }

  /** Routes the element through the shared graph (mute = master gain). Without a context it stays unplayed. */
  private attachBed(b: BedTrack): void {
    const ctx = this.ctx;
    if (!ctx || !this.out || !b.el || b.gain) return;
    try {
      const src = ctx.createMediaElementSource(b.el);
      b.gain = ctx.createGain();
      b.gain.gain.value = 0;
      src.connect(b.gain).connect(this.out);
    } catch {
      b.failed = true;
    }
  }

  private bedFailed(b: BedTrack): void {
    b.failed = true;
    // Music track unavailable during gameplay: fall back to the synthesized loop.
    if (b === this.music && this.bedOn && this.mode === 'off') this.safe(() => this.setMode('gameplay', 0.42, 1.2));
  }

  private startBed(): void {
    const ctx = this.ctx;
    if (!ctx) return; // bind() retries once audio is unlocked
    for (const b of [this.music, this.wind]) {
      if (b.failed || !b.el || !b.gain) continue;
      const g = b.gain.gain;
      g.cancelScheduledValues(ctx.currentTime);
      g.setValueAtTime(Math.max(0.0001, g.value), ctx.currentTime);
      g.setTargetAtTime(b.level, ctx.currentTime, BED_FADE_IN / 3);
      if (b.el.paused) {
        const p = b.el.play();
        if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay: retried on the next startGameplay */ });
      }
    }
  }

  private stopBed(b: BedTrack): void {
    try {
      if (this.ctx && b.gain) {
        b.gain.gain.cancelScheduledValues(this.ctx.currentTime);
        b.gain.gain.setValueAtTime(0, this.ctx.currentTime);
      }
      if (b.el) { b.el.pause(); b.el.currentTime = 0; }
    } catch { /* ignore */ }
  }

  // --- internals -----------------------------------------------------------------------------

  /** Optional audio must never break the cinematic or the frame loop. */
  private safe(fn: () => void): void {
    try { fn(); } catch { this.mode = 'off'; this.building = false; }
  }

  private setMode(mode: MusicMode, level: number, fade: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain) return;
    this.mode = mode;
    this.beat = 0;
    this.nextBeat = ctx.currentTime + 0.05;
    const g = this.musicGain.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(0.0001, ctx.currentTime);
    g.setTargetAtTime(level, ctx.currentTime, fade / 3);
  }

  private buildAmount(t: number): number {
    if (!this.building) return 0;
    return Math.min(1, Math.max(0, (t - this.buildStart) / (this.buildEnd - this.buildStart)));
  }

  private themeStep(t: number, beat: number, step: number): void {
    const bar = Math.floor(beat / 8);
    const chord = THEME_CHORDS[bar % THEME_CHORDS.length];
    const b = this.buildAmount(t);
    if (beat % 8 === 0) {
      const len = step * 8;
      for (const n of chord) this.pad(t, len, midi(n), 0.05 + b * 0.05, 900 + b * 3200);
      this.tone(t, len * 0.9, midi(chord[0] - 12), 'sine', 0.16 + b * 0.1); // bass
      this.timpani(t, 0.2 + b * 0.35);
    }
    // Arpeggio plucks.
    const arp = chord[[0, 1, 2, 3, 2, 1, 2, 3][beat % 8]] + 12;
    this.tone(t, step * 0.9, midi(arp), 'triangle', 0.055 + b * 0.03);
    if (b > 0) {
      // Rising strings and an accelerating snare roll into the reveal.
      if (beat % 2 === 0) this.tone(t, step * 2, midi(chord[3] + 12 + Math.floor(b * 5)), 'sawtooth', 0.02 + b * 0.04, 2200);
      const rolls = b > 0.7 ? 4 : b > 0.35 ? 2 : 1;
      for (let i = 0; i < rolls; i++) this.snare(t + (i * step) / rolls, 0.04 + b * 0.16);
      if (beat % 4 === 0) this.cymbal(t, 0.03 + b * 0.12);
    }
  }

  private gameStep(t: number, beat: number, step: number): void {
    const i = beat % 16;
    this.tone(t, step * 0.8, midi(GAME_BASS[i]), 'square', 0.07, 700);
    const riff = GAME_RIFF[i];
    if (riff > 0 && Math.floor(beat / 16) % 2 === 1) this.tone(t, step * 0.6, midi(riff), 'square', 0.03, 2500);
    if (i % 4 === 0) this.kick(t);
    if (i % 8 === 4) this.snare(t, 0.12);
    this.hat(t, i % 2 === 0 ? 0.035 : 0.02);
  }

  private tone(t: number, len: number, freq: number, type: OscillatorType, vol: number, cutoff = 0): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    let node: AudioNode = o;
    if (cutoff > 0) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      o.connect(f);
      node = f;
    }
    node.connect(g).connect(this.musicGain!);
    o.start(t);
    o.stop(t + len + 0.02);
  }

  private pad(t: number, len: number, freq: number, vol: number, cutoff: number): void {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + len * 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + len * 1.05);
    f.connect(g).connect(this.musicGain!);
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + len * 1.1);
    }
  }

  private noiseHit(t: number, len: number, vol: number, type: BiquadFilterType, freq: number, dest?: AudioNode): void {
    const ctx = this.ctx!;
    if (!this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(f).connect(g).connect(dest ?? this.musicGain!);
    src.start(t);
    src.stop(t + len + 0.02);
  }

  private snare(t: number, vol: number): void { this.noiseHit(t, 0.12, vol, 'highpass', 1800); }
  private hat(t: number, vol: number): void { this.noiseHit(t, 0.04, vol, 'highpass', 7000); }
  private cymbal(t: number, vol: number): void { this.noiseHit(t, 0.9, vol, 'highpass', 5000); }

  private kick(t: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(this.musicGain!);
    o.start(t);
    o.stop(t + 0.2);
  }

  private timpani(t: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(98, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(g).connect(this.musicGain!);
    o.start(t);
    o.stop(t + 0.75);
  }

  /** Needle dragged off the record — routed past the (now silent) music bus. */
  private recordScratch(t: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + 0.32);
    this.noiseHit(t, 0.25, 0.25, 'bandpass', 1400, this.out!);
  }

  private cricket(t: number): void {
    const ctx = this.ctx!;
    for (let i = 0; i < 3; i++) {
      const s = t + i * 0.065;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(4400, s);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.05, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.045);
      o.connect(g).connect(this.out!);
      o.start(s);
      o.stop(s + 0.05);
    }
  }
}
