import type { GameEvent, GameState, MomentumTier, StructureKind } from '../core/types';

const MASTER_GAIN = 0.35;

const TIER_RANK: Record<MomentumTier, number> = {
  dormant: 0,
  growing: 1,
  full: 2,
};

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private isMuted = false;

  // Throttle timestamps (in seconds) so bursty events don't clip
  private lastShotTime = -1;
  private lastMeleeTime = -1;
  private lastRecruitTime = -1;
  private lastPulseTime = -1;
  private lastGateHitTime = -1;
  private lastStructureHitTime = -1;
  private lastDeathTime = -1;
  private lastAlertTime = -1;
  private lastScreamTime = -1;
  private lastSwingTime = -1;
  private lastDeniedTime = -1;
  private lastDiscoverTime = -1;

  // Previous momentum tier so the tier-up drum plays only on increase
  private prevMomentumTier: MomentumTier = 'dormant';
  private lastSimTime = -1;

  reset(): void {
    this.prevMomentumTier = 'dormant';
    this.lastSimTime = -1;
  }

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

  consume(events: readonly GameEvent[], state?: GameState): void {
    if (state) {
      if (this.lastSimTime >= 0 && state.time < this.lastSimTime) {
        this.prevMomentumTier = 'dormant';
      }
      this.lastSimTime = state.time;
    }

    const canPlay =
      !this.isMuted && !!this.ctx && !!this.masterGain && this.ctx.state === 'running';

    try {
      const now = this.ctx ? this.ctx.currentTime : 0;
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (ev.type === 'momentumTier') {
          const prevRank = TIER_RANK[this.prevMomentumTier] ?? 0;
          const nextRank = TIER_RANK[ev.tier] ?? 0;
          this.prevMomentumTier = ev.tier;
          if (canPlay && nextRank > prevRank) {
            this.playMomentumTierUp(now, nextRank);
          }
          continue;
        }

        if (!canPlay) continue;

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
          case 'recruitPulse': {
            if (now - this.lastPulseTime >= 0.07) {
              this.lastPulseTime = now;
              this.playRecruitPulse(now, ev.generation ?? 0);
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
          case 'structureDamaged': {
            if (now - this.lastStructureHitTime >= 0.09) {
              this.lastStructureHitTime = now;
              this.playStructureDamaged(now, ev.kind);
            }
            break;
          }
          case 'structureDestroyed': {
            this.playStructureDestroyed(now, ev.kind);
            break;
          }
          case 'released': {
            if ((ev.count ?? 0) > 0) {
              this.playReleasedMoan(now, ev.count);
            }
            break;
          }
          case 'damage': {
            if (ev.target.kind === 'gate' && now - this.lastGateHitTime >= 0.09) {
              this.lastGateHitTime = now;
              this.playGateHit(now);
            } else if (ev.target.kind === 'leader') {
              this.playLeaderHit(now);
            } else if (
              ev.target.kind === 'structure' &&
              !events.some((e) => e.type === 'structureDamaged') &&
              now - this.lastStructureHitTime >= 0.09
            ) {
              const structId = ev.target.id;
              const s = state?.structures?.find((st) => st.id === structId);
              if (s) {
                this.lastStructureHitTime = now;
                this.playStructureDamaged(now, s.kind);
              }
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
            if (ev.role === 'civilian') {
              if (now - this.lastScreamTime >= 0.22) {
                this.lastScreamTime = now;
                this.playCivilianScream(now);
              }
            } else if (now - this.lastAlertTime >= 0.18) {
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
          case 'attackSwing': {
            if (now - this.lastSwingTime >= 0.08) {
              this.lastSwingTime = now;
              this.playAttackSwing(now, ev.combo ?? 0, ev.hit);
            }
            break;
          }
          case 'abilityUsed': {
            this.playAbilityUsed(now, ev.abilityId);
            break;
          }
          case 'abilityDenied': {
            if (now - this.lastDeniedTime >= 0.15) {
              this.lastDeniedTime = now;
              this.playDeniedBlip(now);
            }
            break;
          }
          case 'abilityUnlocked': {
            this.playAbilityUnlocked(now);
            break;
          }
          case 'strongholdCaptured': {
            this.playStrongholdSting(now);
            break;
          }
          case 'objectiveComplete': {
            this.playObjectiveDing(now);
            break;
          }
          case 'districtDiscovered': {
            if (now - this.lastDiscoverTime >= 0.5) {
              this.lastDiscoverTime = now;
              this.playDiscoveryChime(now);
            }
            break;
          }
          case 'reinforcements': {
            this.playSiren(now);
            break;
          }
          case 'leaderRespawned': {
            this.playRespawnRise(now);
            break;
          }
          case 'nestActivated': {
            this.playNestActivated(now);
            break;
          }
          case 'bruteEvolved': {
            this.playTone('sawtooth', 70, 42, now, 0.4, 0.34);
            this.playNoiseBurst(now, 0.25, 'lowpass', 500, 90, 0.3);
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

  private playRecruitPulse(t: number, generation: number): void {
    const gen = Math.max(0, Math.min(4, generation));
    const pitchMul = Math.pow(1.18, gen);
    this.playNoiseBurst(t, 0.24, 'bandpass', 190 * pitchMul, 540 * pitchMul, 0.22);
    this.playTone('sawtooth', 110 * pitchMul, 195 * pitchMul, t, 0.22, 0.18);
    this.playTone('triangle', 165 * pitchMul, 290 * pitchMul, t + 0.03, 0.2, 0.16);
  }

  private playStructureDamaged(t: number, kind: StructureKind): void {
    switch (kind) {
      case 'busDoor':
        // Hollow sheet metal + glass rattle
        this.playTone('triangle', 360, 140, t, 0.1, 0.3);
        this.playTone('square', 620, 240, t, 0.06, 0.14);
        this.playNoiseBurst(t, 0.075, 'bandpass', 1100, 400, 0.2);
        break;
      case 'alleyGate':
        // Wood plank thud + chain clink
        this.playTone('triangle', 175, 65, t, 0.11, 0.32);
        this.playNoiseBurst(t, 0.07, 'highpass', 2200, 880, 0.18);
        break;
      case 'storeDoor':
        // Taut storefront glass tap/crack
        this.playTone('sine', 980, 420, t, 0.08, 0.24);
        this.playTone('triangle', 1480, 680, t, 0.06, 0.18);
        this.playNoiseBurst(t, 0.055, 'highpass', 2600, 1200, 0.18);
        break;
      case 'penGate':
      default:
        // Heavy steel riot gate clang
        this.playTone('square', 460, 170, t, 0.11, 0.26);
        this.playTone('triangle', 720, 260, t, 0.08, 0.22);
        this.playNoiseBurst(t, 0.08, 'bandpass', 1350, 460, 0.22);
        break;
    }
  }

  private playStructureDestroyed(t: number, kind: StructureKind): void {
    switch (kind) {
      case 'busDoor':
        this.playNoiseBurst(t, 0.55, 'bandpass', 1500, 180, 0.52);
        this.playTone('sawtooth', 95, 34, t, 0.5, 0.42);
        this.playTone('triangle', 420, 110, t + 0.04, 0.35, 0.32);
        break;
      case 'alleyGate':
        this.playNoiseBurst(t, 0.6, 'lowpass', 1200, 150, 0.54);
        this.playTone('sawtooth', 82, 30, t, 0.52, 0.44);
        this.playTone('square', 310, 85, t + 0.05, 0.36, 0.26);
        break;
      case 'storeDoor':
        this.playNoiseBurst(t, 0.48, 'highpass', 3200, 850, 0.5);
        this.playTone('sine', 1850, 720, t, 0.22, 0.28);
        this.playTone('triangle', 2400, 960, t + 0.05, 0.24, 0.24);
        this.playTone('sine', 1360, 510, t + 0.11, 0.28, 0.22);
        break;
      case 'penGate':
      default:
        this.playNoiseBurst(t, 0.6, 'bandpass', 1800, 200, 0.55);
        this.playTone('square', 520, 115, t, 0.42, 0.34);
        this.playTone('sawtooth', 90, 32, t + 0.04, 0.52, 0.44);
        break;
    }
  }

  private playReleasedMoan(t: number, count: number): void {
    const scale = Math.min(1.25, 0.85 + count * 0.02);
    this.playNoiseBurst(t, 0.65, 'bandpass', 320, 680, 0.32 * scale);
    this.playTone('sawtooth', 98, 138, t, 0.58, 0.24 * scale);
    this.playTone('triangle', 124, 166, t + 0.06, 0.55, 0.22 * scale);
    this.playTone('sawtooth', 148, 108, t + 0.14, 0.52, 0.2 * scale);
  }

  private playMomentumTierUp(t: number, rank: number): void {
    const pitchBoost = rank >= 2 ? 1.18 : 1.0;
    this.playTone('sine', 118 * pitchBoost, 36, t, 0.38, 0.48);
    this.playTone('triangle', 176 * pitchBoost, 54, t + 0.02, 0.32, 0.32);
    this.playNoiseBurst(t, 0.22, 'lowpass', 340, 80, 0.34);
  }

  private playCivilianScream(t: number): void {
    this.playTone('triangle', 580, 880, t, 0.11, 0.24);
    this.playTone('sine', 880, 490, t + 0.09, 0.16, 0.22);
    this.playNoiseBurst(t, 0.18, 'bandpass', 1400, 720, 0.16);
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
  private playAttackSwing(t: number, combo: number, hit: boolean): void {
    if (combo <= 0) {
      // Bite: short wet snap
      this.playNoiseBurst(t, 0.09, 'bandpass', 900, 380, 0.22);
      this.playTone('sawtooth', 190, 90, t, 0.1, 0.2);
    } else {
      // Claw: rising swish, heavier on the combo finisher
      this.playNoiseBurst(t, 0.16, 'highpass', 500, 2600, 0.26);
      this.playTone('triangle', 420, 240, t, 0.12, 0.14);
      if (combo >= 3) this.playTone('sawtooth', 120, 55, t + 0.04, 0.22, 0.3);
    }
    if (hit) this.playTone('square', 160, 70, t + 0.03, 0.07, 0.14);
  }

  private playAbilityUsed(t: number, id: string): void {
    if (id === 'horde_frenzy') {
      this.playRushRoar(t);
      this.playTone('sawtooth', 70, 160, t, 0.5, 0.26);
    } else if (id === 'brute_evolution') {
      this.playTone('sawtooth', 62, 38, t, 0.55, 0.38);
      this.playTone('triangle', 96, 44, t + 0.05, 0.45, 0.3);
      this.playNoiseBurst(t, 0.4, 'lowpass', 420, 80, 0.32);
    } else {
      this.playTone('triangle', 330, 520, t, 0.12, 0.2);
    }
  }

  private playDeniedBlip(t: number): void {
    this.playTone('sine', 240, 170, t, 0.11, 0.16);
  }

  private playAbilityUnlocked(t: number): void {
    const notes = [392.0, 493.88, 587.33, 783.99];
    for (let i = 0; i < notes.length; i++) {
      this.playTone('triangle', notes[i], notes[i] * 1.005, t + 0.4 + i * 0.09, 0.3, 0.24);
    }
  }

  private playStrongholdSting(t: number): void {
    const notes = [196.0, 261.63, 329.63, 392.0, 523.25];
    for (let i = 0; i < notes.length; i++) {
      this.playTone('triangle', notes[i], notes[i] * 1.01, t + i * 0.11, 0.5, 0.3);
      this.playTone('sawtooth', notes[i] / 2, notes[i] / 2, t + i * 0.11, 0.4, 0.1);
    }
    this.playNoiseBurst(t, 0.5, 'lowpass', 1200, 150, 0.3);
  }

  private playObjectiveDing(t: number): void {
    this.playTone('sine', 660, 662, t, 0.22, 0.26);
    this.playTone('sine', 990, 992, t + 0.1, 0.3, 0.24);
  }

  private playDiscoveryChime(t: number): void {
    this.playTone('sine', 523.25, 524, t, 0.5, 0.14);
    this.playTone('sine', 783.99, 785, t + 0.12, 0.6, 0.12);
  }

  private playSiren(t: number): void {
    for (let i = 0; i < 4; i++) {
      this.playTone('square', 620, 880, t + i * 0.36, 0.34, 0.12);
    }
  }

  private playRespawnRise(t: number): void {
    this.playTone('sine', 80, 320, t, 0.7, 0.34);
    this.playTone('triangle', 160, 640, t + 0.05, 0.6, 0.2);
    this.playNoiseBurst(t, 0.6, 'bandpass', 200, 1400, 0.3);
  }

  private playNestActivated(t: number): void {
    this.playTone('sine', 110, 150, t, 0.6, 0.36);
    this.playTone('triangle', 330, 332, t + 0.15, 0.4, 0.2);
    this.playTone('triangle', 495, 497, t + 0.3, 0.5, 0.2);
  }
}
