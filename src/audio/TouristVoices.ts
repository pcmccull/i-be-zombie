// Plays assets/funnytalking/tourist_* lines when the Alpha approaches a tourist (trigger rules: touristChatter.ts).
// Clips are <audio> elements routed through the shared Web Audio graph so the master mute applies.
// Every failure path is silent: missing/blocked audio never affects the game.
import refundUrl from '../../assets/funnytalking/tourist_iwantarefund.mp3';
import brochureUrl from '../../assets/funnytalking/tourist_notinbrochure.mp3';
import dayOffUrl from '../../assets/funnytalking/tourist_notondayoff.mp3';
import { createChatterState, updateChatter, type ChatterHuman, type ChatterState } from './touristChatter';

const CLIP_URLS = [refundUrl, brochureUrl, dayOffUrl];
const VOICE_LEVEL = 0.9;

interface Clip { el: HTMLAudioElement; gain: GainNode | null; failed: boolean }

export class TouristVoices {
  private clips: Clip[] = [];
  private ctx: AudioContext | null = null;
  private out: AudioNode | null = null;
  private state: ChatterState = createChatterState();
  private playing: Clip | null = null;
  private lastNow = 0;

  preload(): void {
    if (this.clips.length || typeof Audio === 'undefined') return;
    for (const url of CLIP_URLS) {
      try {
        const el = new Audio();
        el.preload = 'auto';
        el.src = url;
        const clip: Clip = { el, gain: null, failed: false };
        el.addEventListener('error', () => { clip.failed = true; }, { once: true });
        el.addEventListener('ended', () => { if (this.playing === clip) this.playing = null; });
        el.load();
        this.clips.push(clip);
      } catch { /* clip stays absent */ }
    }
    this.attach();
  }

  bind(ctx: AudioContext | null, out: AudioNode | null): void {
    if (!ctx || !out || this.ctx) return;
    this.ctx = ctx;
    this.out = out;
    this.preload();
    this.attach();
  }

  /** Forget who already spoke (new world / restart). */
  reset(now = 0): void {
    this.stop();
    this.state = createChatterState(now);
  }

  update(now: number, leader: { x: number; z: number }, humans: readonly ChatterHuman[]): void {
    // Sim time went backwards => a fresh/reloaded world reused the human ids: start over.
    if (now + 1 < this.lastNow) this.reset(now);
    this.lastNow = now;
    if (!this.ctx || this.clips.length === 0) return;
    // Wait until a line finishes before even considering the next approach.
    const hit = this.playing ? null : updateChatter(this.state, now, leader, humans, this.clips.length, Math.random);
    if (!hit) return;
    const clip = this.clips[hit.clip];
    if (!clip || clip.failed || !clip.gain) return;
    try {
      clip.el.currentTime = 0;
      const p = clip.el.play();
      this.playing = clip;
      if (p && typeof p.catch === 'function') p.catch(() => { if (this.playing === clip) this.playing = null; });
    } catch { this.playing = null; }
  }

  stop(): void {
    const c = this.playing;
    this.playing = null;
    if (c) try { c.el.pause(); c.el.currentTime = 0; } catch { /* ignore */ }
  }

  pause(): void { try { this.playing?.el.pause(); } catch { /* ignore */ } }
  resume(): void {
    const c = this.playing;
    if (c && c.el.paused && !c.el.ended) try { void c.el.play().catch(() => { /* ignore */ }); } catch { /* ignore */ }
  }

  dispose(): void {
    this.stop();
    for (const c of this.clips) {
      try { c.gain?.disconnect(); } catch { /* ignore */ }
      c.el.removeAttribute('src');
      try { c.el.load(); } catch { /* ignore */ }
    }
    this.clips = [];
  }

  private attach(): void {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    for (const c of this.clips) {
      if (c.gain || c.failed) continue;
      try {
        const src = ctx.createMediaElementSource(c.el);
        c.gain = ctx.createGain();
        c.gain.gain.value = VOICE_LEVEL;
        src.connect(c.gain).connect(this.out);
      } catch { c.failed = true; }
    }
  }
}
