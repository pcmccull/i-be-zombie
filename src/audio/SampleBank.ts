// Decoded sample SFX from assets/soundeffects (docs/7_soundeffects.md), played as AudioBufferSources through the
// shared master gain so mute applies. Loading is lazy (on bind) and every failure is silent: a clip that fails to
// load or decode simply reports `has(id) === false` and stays silent.
import { SFX, SFX_IDS, SfxLimiter, type SfxId } from './sfxRules';

const URLS = import.meta.glob('../../assets/soundeffects/*.mp3', { eager: true, query: '?url', import: 'default' }) as
  Record<string, string>;

/** Map file basenames to SfxIds (the spec calls it zombie_collect; the file is zombie_collected.mp3). */
function urlFor(id: SfxId): string | null {
  for (const path in URLS) {
    const base = path.slice(path.lastIndexOf('/') + 1).replace(/\.mp3$/, '');
    if (base === id) return URLS[path];
  }
  return null;
}

export interface PlayOpts {
  /** Extra gain multiplier (distance attenuation etc.). */
  gain?: number;
  /** Stereo pan -1..1. */
  pan?: number;
  /** Delay in seconds from now. */
  delay?: number;
  /** Uniform random number used for the playback-rate jitter. */
  rand?: number;
}

export class SampleBank {
  private ctx: AudioContext | null = null;
  private out: AudioNode | null = null;
  private readonly buffers = new Map<SfxId, AudioBuffer>();
  private readonly limiter = new SfxLimiter();
  private loading = false;

  bind(ctx: AudioContext | null, out: AudioNode | null): void {
    if (!ctx || !out || this.ctx) return;
    this.ctx = ctx;
    this.out = out;
    this.load();
  }

  has(id: SfxId): boolean {
    return this.buffers.has(id);
  }

  /** Clip length in seconds (0 when not loaded). */
  duration(id: SfxId): number {
    return this.buffers.get(id)?.duration ?? 0;
  }

  /** Play a clip if loaded and its limiter allows it. Returns true when it started. */
  play(id: SfxId, opts: PlayOpts = {}): boolean {
    const ctx = this.ctx;
    const out = this.out;
    const buf = this.buffers.get(id);
    if (!ctx || !out || !buf || ctx.state !== 'running') return false;
    const spec = SFX[id];
    const g = spec.gain * (opts.gain ?? 1);
    if (g <= 0.005) return false;
    const rate = 1 + spec.rateJitter * ((opts.rand ?? 0.5) * 2 - 1);
    const full = buf.duration / rate;
    const len = spec.maxDuration > 0 ? Math.min(full, spec.maxDuration) : full;
    const t = ctx.currentTime + Math.max(0, opts.delay ?? 0);
    if (!this.limiter.tryStart(id, t, len)) return false;
    try {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(g, t);
      if (len < full) {
        const fade = Math.min(0.25, len * 0.3);
        gain.gain.setValueAtTime(g, t + len - fade);
        gain.gain.linearRampToValueAtTime(0.0001, t + len);
      }
      src.connect(gain);
      let tail: AudioNode = gain;
      if (opts.pan && typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
        gain.connect(panner);
        tail = panner;
      }
      tail.connect(out);
      src.onended = () => {
        try { src.disconnect(); gain.disconnect(); if (tail !== gain) tail.disconnect(); } catch { /* ignore */ }
      };
      src.start(t);
      if (len < full) src.stop(t + len + 0.02);
      return true;
    } catch {
      return false;
    }
  }

  resetLimits(): void {
    this.limiter.reset();
  }

  dispose(): void {
    this.buffers.clear();
    this.limiter.reset();
    this.ctx = null;
    this.out = null;
  }

  private load(): void {
    if (this.loading || typeof fetch === 'undefined') return;
    this.loading = true;
    for (const id of SFX_IDS) {
      const url = urlFor(id);
      if (!url) continue;
      void fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((data) => {
          const ctx = this.ctx;
          if (!ctx) return null;
          return new Promise<AudioBuffer>((resolve, reject) => ctx.decodeAudioData(data, resolve, reject));
        })
        .then((buf) => { if (buf && this.ctx) this.buffers.set(id, buf); })
        .catch(() => { /* clip stays absent -> synth fallback */ });
    }
  }
}
