import type { GameEvent } from '../core/types';

const MASTER_GAIN = 0.35;

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private isMuted = false;

  // Throttle timestamps (in seconds) so bursty events don't clip
  private lastShotTime = -1;
  private lastMeleeTime = -1;
  private lastRecruitTime = -1;
  private lastGateHitTime = -1;
  private lastDeathTime = -1;
  private lastAlertTime = -1;

  unlock(): void {
    try {
      if (typeof window === 'undefined') return;
      if (!this.ctx) {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.isMuted ? 0 : MASTER_GAIN;
        this.masterGain.connect(this.ctx.destination);
        this.noiseBuffer = this.createNoiseBuffer(this.ctx);
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {
          // Ignore autoplay restriction errors until next user gesture
        });
      }
    } catch {
      // Fail gracefully if Web Audio is unavailable or blocked
    }
  }

  setMuted(m: boolean): void {
    this.isMuted = m;
    try {
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setValueAtTime(m ? 0 : MASTER_GAIN, this.ctx.currentTime);
      }
    } catch {
      // No-op
    }
  }

  get muted(): boolean {
    return this.isMuted;
  }

  consume(events: readonly GameEvent[]): void {
    if (this.isMuted || !this.ctx || !this.masterGain || this.ctx.state !== 'running') {
      return;
    }

    try {
      const now = this.ctx.currentTime;
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        switch (ev.type) {
          case 'shot': {
            if (now - this.lastShotTime >= 0.082) {
              this.lastShotTime = now;
              this.playGunshot(now);
            }
            break;
          }
          case 'melee': {
            if (now - this.lastMeleeTime >= 0.07) {
              this.lastMeleeTime = now;
              this.playMeleeThud(now);
            }
            break;
          }
          case 'recruited': {
            if (now - this.lastRecruitTime >= 0.065) {
              this.lastRecruitTime = now;
              this.playRecruitChime(now);
            }
            break;
          }
          case 'rally': {
            this.playRallyWhoosh(now);
            break;
          }
          case 'rushStart': {
            this.playRushRoar(now);
            break;
          }
          case 'damage': {
            if (ev.target.kind === 'gate' && now - this.lastGateHitTime >= 0.09) {
              this.lastGateHitTime = now;
              this.playGateHit(now);
            } else if (ev.target.kind === 'leader') {
              this.playLeaderHit(now);
            }
            break;
          }
          case 'gateDestroyed': {
            this.playGateDestroyed(now);
            break;
          }
          case 'zombieDied': {
            if (now - this.lastDeathTime >= 0.1) {
              this.lastDeathTime = now;
              this.playZombieDeath(now);
            }
            break;
          }
          case 'guardDied': {
            this.playGuardDeath(now);
            break;
          }
          case 'conversionStart': {
            this.playConversionDrone(now);
            break;
          }
          case 'converted': {
            this.playConvertedSting(now);
            break;
          }
          case 'guardAlert': {
            if (now - this.lastAlertTime >= 0.18) {
              this.lastAlertTime = now;
              this.playAlertBeep(now);
            }
            break;
          }
          case 'capReached': {
            this.playCapBuzz(now);
            break;
          }
          case 'victory': {
            this.playVictorySting(now);
            break;
          }
          case 'defeat':
          case 'leaderDied': {
            this.playDefeatSting(now);
            break;
          }
          default:
            break;
        }
      }
    } catch {
      // Fail gracefully
    }
  }

  dispose(): void {
    try {
      if (this.ctx) {
        void this.ctx.close().catch(() => {});
      }
    } catch {
      // Ignore
    }
    this.ctx = null;
    this.masterGain = null;
    this.noiseBuffer = null;
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const length = sampleRate; // 1.0 s reusable white noise buffer
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 0x2468ace1;
    for (let i = 0; i < length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = ((seed & 0xffff) / 0x7fff) - 1.0;
    }
    return buffer;
  }

  private playTone(
    type: OscillatorType,
    startFreq: number,
    endFreq: number,
    startTime: number,
    duration: number,
    gainPeak: number,
  ): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), startTime + duration);

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(gainPeak, startTime + Math.min(0.015, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0008, startTime + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }

  private playNoiseBurst(
    startTime: number,
    duration: number,
    filterType: BiquadFilterType,
    startCutoff: number,
    endCutoff: number,
    gainPeak: number,
  ): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(startCutoff, startTime);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, endCutoff), startTime + duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(gainPeak, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0008, startTime + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(startTime);
    src.stop(startTime + duration + 0.01);
  }

  private playGunshot(t: number): void {
    this.playNoiseBurst(t, 0.09, 'bandpass', 1800, 420, 0.45);
    this.playTone('sine', 165, 42, t, 0.085, 0.42);
  }

  private playMeleeThud(t: number): void {
    this.playTone('triangle', 115, 38, t, 0.09, 0.34);
    this.playNoiseBurst(t, 0.06, 'lowpass', 620, 180, 0.22);
  }

  private playRecruitChime(t: number): void {
    this.playTone('triangle', 330, 495, t, 0.14, 0.24);
    this.playTone('sine', 495, 660, t + 0.06, 0.16, 0.22);
  }

  private playRallyWhoosh(t: number): void {
    this.playNoiseBurst(t, 0.45, 'bandpass', 240, 1250, 0.38);
    this.playTone('sine', 190, 440, t, 0.42, 0.32);
    this.playTone('triangle', 285, 570, t + 0.05, 0.38, 0.24);
  }

  private playRushRoar(t: number): void {
    this.playNoiseBurst(t, 0.55, 'bandpass', 680, 220, 0.5);
    this.playTone('sawtooth', 95, 145, t, 0.22, 0.32);
    this.playTone('sawtooth', 145, 68, t + 0.18, 0.42, 0.35);
  }

  private playGateHit(t: number): void {
    this.playTone('triangle', 520, 180, t, 0.11, 0.32);
    this.playTone('square', 780, 290, t, 0.07, 0.16);
    this.playNoiseBurst(t, 0.08, 'highpass', 900, 350, 0.22);
  }

  private playLeaderHit(t: number): void {
    this.playTone('sawtooth', 110, 48, t, 0.14, 0.38);
    this.playNoiseBurst(t, 0.09, 'lowpass', 750, 200, 0.28);
  }

  private playGateDestroyed(t: number): void {
    this.playNoiseBurst(t, 0.85, 'lowpass', 1400, 140, 0.65);
    this.playTone('sawtooth', 85, 28, t, 0.75, 0.52);
    this.playTone('triangle', 380, 95, t + 0.06, 0.45, 0.38);
    this.playTone('square', 540, 120, t + 0.15, 0.35, 0.25);
  }

  private playZombieDeath(t: number): void {
    this.playTone('sawtooth', 135, 62, t, 0.26, 0.24);
  }

  private playGuardDeath(t: number): void {
    this.playTone('triangle', 250, 92, t, 0.28, 0.32);
    this.playNoiseBurst(t, 0.14, 'lowpass', 540, 160, 0.24);
  }

  private playConversionDrone(t: number): void {
    this.playTone('sine', 160, 225, t, 0.45, 0.2);
  }

  private playConvertedSting(t: number): void {
    this.playTone('triangle', 220, 440, t, 0.25, 0.32);
    this.playTone('sine', 330, 660, t + 0.08, 0.3, 0.28);
  }

  private playAlertBeep(t: number): void {
    this.playTone('square', 780, 820, t, 0.065, 0.2);
    this.playTone('square', 1040, 1080, t + 0.075, 0.08, 0.22);
  }

  private playCapBuzz(t: number): void {
    this.playTone('sawtooth', 110, 98, t, 0.12, 0.25);
    this.playTone('sawtooth', 98, 86, t + 0.14, 0.14, 0.25);
  }

  private playVictorySting(t: number): void {
    const notes = [261.63, 329.63, 392.0, 523.25];
    for (let i = 0; i < notes.length; i++) {
      this.playTone('triangle', notes[i], notes[i] * 1.01, t + i * 0.13, 0.45, 0.32);
    }
  }

  private playDefeatSting(t: number): void {
    const notes = [220.0, 196.0, 174.61, 130.81];
    for (let i = 0; i < notes.length; i++) {
      this.playTone('sawtooth', notes[i], notes[i] * 0.96, t + i * 0.18, 0.48, 0.28);
    }
  }
}
