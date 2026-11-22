import { BALANCE } from '../config/balance';
import type { CompanionId, DynamicEventKind, GameEvent, GameState, InteractableKind, MomentumTier, SenseKind, Vec2 } from '../core/types';
import { BRAIN_FLY_S } from '../visuals/brainPickupMath';
import { cueScreenAngle } from '../ui/uiHelpers';
import { SampleBank } from './SampleBank';
import {
  BRAINS_IDS, BRAINS_SFX_CHANCE, CriticalGroanGate, GROAN_IDS, GroanScheduler, HeartbeatScheduler,
  RECOVERY_SFX_ID, RecruitCueGate, SCREAM_IDS, SFX_TUNING, ScreamGate, ZOMBIE_ATTACK_IDS,
  distanceGain, pick, shotSfxFor, type SfxId,
} from './sfxRules';

const MASTER_GAIN = 0.35;
/** Living City world cues (docs/11_cityupgrade.md §6) are silent beyond this distance from the Alpha (m). */
const CITY_CUE_RANGE = 90;
/** Full volume within 10 m, easing to a 0.1 floor at CITY_CUE_RANGE (city sounds carry further than combat ones). */
function cityCueGain(dist: number): number {
  return Math.max(0.1, Math.min(1, 1 - (dist - 10) / 80));
}

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
  /** Recorded SFX (assets/soundeffects, docs/7_soundeffects.md); a clip that is missing or still loading is silent. */
  private readonly samples = new SampleBank();
  private readonly groans = new GroanScheduler();
  private readonly screams = new ScreamGate();
  private readonly heartbeat = new HeartbeatScheduler();
  private readonly criticalGroan = new CriticalGroanGate();
  private readonly recruitCue = new RecruitCueGate();
  /** Last time (s) each Living City cue key played; keys throttle repeats (per kind, per interactable kind...). */
  private readonly cityCueTime = new Map<string, number>();
  private listener: Vec2 = { x: 0, z: 0 };
  private listenerYaw = 0;

  // Throttle timestamps (in seconds) so bursty events don't clip
  private lastPulseTime = -1;
  /** Heavy guns: last burst clip per shooter (rounds are far faster than the clip). */
  private readonly lastHeavyShot = new Map<number, number>();
  private lastDeathTime = -1;
  private lastAlertTime = -1;
  private lastDeniedTime = -1;
  private lastDiscoverTime = -1;
  private readonly lastSenseCueTime: Record<SenseKind, number> = {
    gunshot: -1,
    scream: -1,
    siren: -1,
    crowd: -1,
  };

  // Previous momentum tier so the tier-up drum plays only on increase
  private prevMomentumTier: MomentumTier = 'dormant';
  private lastSimTime = -1;

  reset(): void {
    this.prevMomentumTier = 'dormant';
    this.groans.reset();
    this.screams.reset();
    this.heartbeat.reset();
    this.criticalGroan.reset();
    this.recruitCue.reset();
    this.samples.resetLimits();
    this.lastSimTime = -1;
    this.lastSenseCueTime.gunshot = -1;
    this.lastSenseCueTime.scream = -1;
    this.lastSenseCueTime.siren = -1;
    this.lastSenseCueTime.crowd = -1;
    this.cityCueTime.clear();
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
        this.samples.bind(this.ctx, this.masterGain);
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

  /** Shared Web Audio context (null until unlock()); music/intro audio routes through `output` so mute applies. */
  get context(): AudioContext | null {
    return this.ctx;
  }

  get output(): AudioNode | null {
    return this.masterGain;
  }

  /**
   * @param ambient true while the player is in control (PLAYING, not suspended): enables background groans and
   *   flight screams, which are driven by state rather than events.
   */
  consume(events: readonly GameEvent[], state?: GameState, cameraYaw = 0, ambient = false): void {
    if (state) {
      if (this.lastSimTime >= 0 && state.time < this.lastSimTime) {
        this.prevMomentumTier = 'dormant';
        this.groans.reset();
        this.screams.reset();
        this.heartbeat.reset();
        this.criticalGroan.reset();
        this.recruitCue.reset();
      }
      this.lastSimTime = state.time;
      this.listener = state.leader.pos;
    }
    this.listenerYaw = cameraYaw;

    const canPlay =
      !this.isMuted && !!this.ctx && !!this.masterGain && this.ctx.state === 'running';
    if (canPlay && ambient && state && state.phase !== 'respawning') {
      try { this.updateAmbient(state); } catch { /* ignore */ }
    }
    if (canPlay && ambient && state && state.phase === 'playing' && state.leader.alive && state.horde.lastBrain.active) {
      try {
        const hbNow = this.ctx ? this.ctx.currentTime : 0;
        if (this.heartbeat.update(hbNow, state.horde.lastBrain.timeLeft, BALANCE.hordeHealth.lastBrain.duration)) {
          this.playHeartbeat(hbNow, state.horde.lastBrain.timeLeft, BALANCE.hordeHealth.lastBrain.duration);
        }
      } catch { /* ignore */ }
    } else {
      this.heartbeat.reset();
    }

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
            if (ev.heavy) {
              // Mounted MG / coax: one burst clip per gun every 0.9 s (rounds fire every ~0.1 s). Cannon: the heavy crack.
              if (ev.heavy === 'cannon') { this.playAt('police_sniper', { x: ev.from.x, z: ev.from.z }, 0.9); break; }
              const last = this.lastHeavyShot.get(ev.guardId) ?? -Infinity;
              if (now - last < 0.9) break;
              this.lastHeavyShot.set(ev.guardId, now);
              this.playAt('police_machinegun', { x: ev.from.x, z: ev.from.z }, ev.heavy === 'mg' ? 0.55 : 0.35);
              break;
            }
            const shooter = state?.guards.find((g) => g.id === ev.guardId);
            const shotId = shooter ? shotSfxFor(shooter.role, shooter.tower !== null || shooter.elevation > 0.5) : null;
            if (shotId) this.playAt(shotId, { x: ev.from.x, z: ev.from.z }, 0.35);
            break;
          }
          case 'melee': {
            // Leader strikes are voiced by 'attackSwing' (player_attack1).
            if (ev.attacker === 'zombie') {
              this.playAt(pick(ZOMBIE_ATTACK_IDS, Math.random()), ev.pos, 0.25);
              if (ev.target.kind === 'gate' || ev.target.kind === 'structure' || ev.target.kind === 'vehicle') {
                this.playAt('zombie_hitting_barracade', ev.pos, 0.6);
              }
            }
            break;
          }
          case 'recruited': {
            this.playAt('zombie_collected', ev.pos, 0.5);
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
            this.playAt('zombie_hitting_barracade', ev.pos, 0.6);
            break;
          }
          case 'structureDestroyed': {
            this.playAt('barracade_colapses', ev.pos, 0.85);
            break;
          }
          // todos #12: car impacts and bat swings land with the heavy thud
          case 'vehicleRam': {
            this.playAt('car_targettingzombie', ev.pos, 0.8);
            break;
          }
          case 'vehicleHit': {
            this.playAt('car_hitszombie', ev.pos, ev.target === 'leader' ? 0.9 : 0.6);
            break;
          }
          // Car-on-car accident: the heavy crash (barricade collapse) scaled by closing speed.
          case 'shellBlast': {
            this.playAt('barracade_colapses', ev.pos, 1);
            break;
          }
          case 'vehicleCrash': {
            this.playAt('barracade_colapses', ev.pos, Math.min(1, 0.45 + ev.speed / 25));
            break;
          }
          case 'humanMelee': {
            this.playAt('zombie_hitting_barracade', ev.pos, 0.4);
            break;
          }
          case 'released': {
            if ((ev.count ?? 0) > 0) {
              this.playReleasedMoan(now, ev.count);
            }
            break;
          }
          case 'damage': {
            if (ev.target.kind === 'gate') {
              this.playAt('zombie_hitting_barracade', ev.pos, 0.6);
            } else if (ev.target.kind === 'leader') {
              this.playLeaderHit(now);
            }
            break;
          }
          case 'gateDestroyed': {
            this.playAt('barracade_colapses', ev.pos, 0.85);
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
            // Civilian screams come from updateAmbient when they flee (rate-limited by ScreamGate).
            if (ev.role !== 'civilian' && now - this.lastAlertTime >= 0.18) {
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
            this.samples.play('death');
            break;
          }
          case 'attackSwing': {
            this.samples.play('player_attack1', { rand: Math.random() });
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
            this.samples.play('stronghold_captured');
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
          case 'leaderEmerge': {
            this.playEmergeDig(now);
            break;
          }
          case 'nestTravelStarted': {
            this.playEmergeDig(now);
            break;
          }
          case 'nestActivated': {
            this.playNestActivated(now);
            break;
          }
          case 'bruteEvolved': {
            this.playAt('zombie_upgradetobrute', ev.pos, 0.6);
            break;
          }
          case 'biomassGain': {
            // Lands with the first brain flying into the Alpha (visuals/BrainPickups); no source ⇒ right away.
            if (ev.amount > 0 && Math.random() < BRAINS_SFX_CHANCE) this.samples.play(pick(BRAINS_IDS, Math.random()), { rand: Math.random(), delay: ev.pos ? BRAIN_FLY_S : 0 });
            break;
          }
          case 'visionUpgraded':
          case 'traitUpgraded': {
            this.playAbilityUnlocked(now);
            break;
          }
          case 'senseCue': {
            if (ev.fresh && state) {
              const cue = state.vision.cues.find((c) => c.id === ev.cueId);
              if (cue) {
                const angle = cueScreenAngle(state.leader.pos, cue.pos, cameraYaw);
                const pan = Math.sin(angle);
                const gain = Math.max(0.08, Math.min(1, cue.intensity));
                this.playSenseCue(ev.kind, pan, gain);
              }
            }
            break;
          }
          // --- Living City (docs/11_cityupgrade.md §2.3, §2.5-2.6, §6): positional, throttled, mute-safe ---
          case 'cityEventStarted': {
            const bus = this.cueBus(`event:${ev.kind}`, 1.5, now, ev.pos);
            if (bus) this.playCityEventStart(now, bus, ev.kind);
            break;
          }
          case 'cityEventEscalated': {
            const bus = this.cueBus('escalate', 2.5, now, ev.pos, 0.9);
            if (bus) this.playSirenWhoop(now, bus);
            break;
          }
          case 'worldInteractable': {
            this.playInteractable(now, ev.kind, ev.pos);
            break;
          }
          case 'companionPerk': {
            const bus = this.cueBus(`perk:${ev.companionId}`, 1.2, now, ev.pos);
            if (bus) this.playCompanionPerk(now, bus, ev.companionId);
            break;
          }
          case 'rewardGranted': {
            const bus = this.cueBus('reward', 0.6, now);
            if (bus) this.playRewardChime(now, bus);
            break;
          }
          case 'secretDiscovered':
          case 'companionRecruited':
          case 'hideoutUnlocked': {
            const bus = this.cueBus('reward', 0.6, now, ev.pos);
            if (bus) this.playRewardChime(now, bus);
            break;
          }
          case 'shortcutUsed': {
            const bus = this.cueBus('shortcut', 1.0, now, ev.from);
            if (bus) this.playSewerSlosh(now, bus);
            break;
          }
          case 'vehicleMounted': {
            const bus = this.cueBus('vehicle', 0.8, now, ev.pos);
            if (bus) this.playEnginePutter(now, bus);
            break;
          }
          case 'suppliesLooted': {
            const bus = this.cueBus('supplies', 0.8, now, ev.pos);
            if (bus) this.playCrateOpen(now, bus);
            break;
          }
          case 'districtAlertChanged': {
            // Subtle, once per escalation into panic/lockdown (§2.3); not positional.
            if ((ev.alert === 'panic' || ev.alert === 'lockdown') && ev.prev !== ev.alert) {
              const bus = this.cueBus('alarm', 6, now, undefined, 0.7);
              if (bus) this.playLowAlarm(now, bus);
            }
            break;
          }
          case 'lastBrainEnd': {
            this.heartbeat.reset();
            if (ev.outcome === 'recovered') {
              this.samples.play(RECOVERY_SFX_ID, { gain: 0.75, rand: Math.random() });
            }
            break;
          }
          case 'hordeCritical': {
            if (this.criticalGroan.tryGroan(now)) {
              this.samples.play(pick(GROAN_IDS, Math.random()), { rand: Math.random() });
            }
            break;
          }
          case 'hordeStrengthChanged': {
            if (ev.cause === 'recruit' && ev.delta > 0 && this.recruitCue.tryPlay(now)) {
              this.samples.play('zombie_collected', { gain: SFX_TUNING.recruitStrengthGain, rand: Math.random() });
            }
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
    this.samples.dispose();
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

  /**
   * Play a recorded clip at a world position relative to the leader: distance falloff + stereo pan.
   * `minGain` keeps gameplay-critical sounds audible at range. Returns false if the clip is not loaded.
   */
  private playAt(id: SfxId, pos: Vec2, minGain = 0): boolean {
    if (!this.samples.has(id)) return false;
    const dx = pos.x - this.listener.x;
    const dz = pos.z - this.listener.z;
    const dist = Math.hypot(dx, dz);
    const gain = Math.max(minGain, distanceGain(dist));
    const pan = dist > 0.5 ? Math.sin(cueScreenAngle(this.listener, pos, this.listenerYaw)) * SFX_TUNING.panWidth : 0;
    this.samples.play(id, { gain, pan, rand: Math.random() });
    return true;
  }

  /** State-driven samples: quiet background groans and (rate-limited) screams from humans running away. */
  private updateAmbient(state: GameState): void {
    const t = state.time;
    if (state.followerCount > 0 && this.groans.update(t, Math.random)) {
      // Pick a random follower as the source so the groan pans with the horde.
      const zs = state.zombies;
      let src: Vec2 | null = null;
      for (let tries = 0; tries < 6 && zs.length > 0; tries++) {
        const z = zs[Math.floor(Math.random() * zs.length)];
        if (z.state === 'follower') { src = z.pos; break; }
      }
      const id = pick(GROAN_IDS, Math.random());
      if (src) this.playAt(id, src, 0.55);
      else this.samples.play(id, { rand: Math.random() });
    }
    if (!this.samples.has('human_scream1')) return;
    const gate = this.screams;
    gate.begin();
    for (const g of state.guards) {
      if (g.state === 'DEAD' || g.dormant) continue;
      const dist = Math.hypot(g.pos.x - this.listener.x, g.pos.z - this.listener.z);
      const fleeing = g.state === 'RETREAT' && dist < SFX_TUNING.farDist * 0.75;
      if (gate.observe(g.id, fleeing, t, Math.random)) this.playAt(pick(SCREAM_IDS, Math.random()), g.pos, 0.2);
    }
    gate.end();
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




  private playRecruitPulse(t: number, generation: number): void {
    const gen = Math.max(0, Math.min(4, generation));
    const pitchMul = Math.pow(1.18, gen);
    this.playNoiseBurst(t, 0.24, 'bandpass', 190 * pitchMul, 540 * pitchMul, 0.22);
    this.playTone('sawtooth', 110 * pitchMul, 195 * pitchMul, t, 0.22, 0.18);
    this.playTone('triangle', 165 * pitchMul, 290 * pitchMul, t + 0.03, 0.2, 0.16);
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


  private playLeaderHit(t: number): void {
    this.playTone('sawtooth', 110, 48, t, 0.14, 0.38);
    this.playNoiseBurst(t, 0.09, 'lowpass', 750, 200, 0.28);
  }

  private playHeartbeat(t: number, timeLeft: number, duration: number): void {
    const urgency = duration > 0 ? 1 - Math.max(0, Math.min(1, timeLeft / duration)) : 1;
    const gain = 0.22 + 0.14 * urgency;
    this.playTone('sine', 78 + 14 * urgency, 42, t, 0.09, gain);
    this.playTone('sine', 64 + 10 * urgency, 38, t + 0.11, 0.08, gain * 0.72);
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

  /** Soil cracking and scraping as the Alpha claws up out of the ground. */
  private playEmergeDig(t: number): void {
    this.playTone('sine', 55, 38, t, 1.4, 0.32);
    this.playNoiseBurst(t, 0.5, 'lowpass', 600, 180, 0.32);
    this.playNoiseBurst(t + 0.45, 0.35, 'bandpass', 900, 400, 0.22);
    this.playNoiseBurst(t + 1.05, 0.45, 'bandpass', 700, 300, 0.2);
  }

  private playNestActivated(t: number): void {
    this.playTone('sine', 110, 150, t, 0.6, 0.36);
    this.playTone('triangle', 330, 332, t + 0.15, 0.4, 0.2);
    this.playTone('triangle', 495, 497, t + 0.3, 0.5, 0.2);
  }

  /**
   * Output bus for a Living City cue: positional (distance gain + stereo pan, silent beyond CITY_CUE_RANGE) when `pos` is
   * given, centred otherwise. Returns null when throttled by `key` (cooldown in s) or out of range. A played cue starts
   * its cooldown. Synth voices route into the returned bus; the bus is never reused, so Web Audio can collect it.
   */
  private cueBus(key: string, cooldown: number, now: number, pos?: Vec2, level = 1): AudioNode | null {
    if (!this.ctx || !this.masterGain) return null;
    const last = this.cityCueTime.get(key);
    if (last !== undefined && now - last < cooldown) return null;
    let gain = level;
    let pan = 0;
    if (pos) {
      const dist = Math.hypot(pos.x - this.listener.x, pos.z - this.listener.z);
      if (dist > CITY_CUE_RANGE) return null;
      gain *= cityCueGain(dist);
      if (dist > 0.5) pan = Math.sin(cueScreenAngle(this.listener, pos, this.listenerYaw)) * SFX_TUNING.panWidth;
    }
    this.cityCueTime.set(key, now);
    const bus = this.ctx.createGain();
    bus.gain.setValueAtTime(gain, now);
    if (typeof this.ctx.createStereoPanner === 'function') {
      const panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime(pan, now);
      bus.connect(panner);
      panner.connect(this.masterGain);
    } else {
      bus.connect(this.masterGain);
    }
    return bus;
  }

  /** Per-kind start cue: air-brake hiss + horn (bus, convoy), party bass (festival, block party), crowd blip, crunch (accident). */
  private playCityEventStart(t: number, dest: AudioNode, kind: DynamicEventKind): void {
    switch (kind) {
      case 'tourist_bus':
      case 'supply_convoy':
        this.playNoiseBurstTo(dest, t, 0.7, 'bandpass', 2400, 900, 0.28);
        this.playHorn(t + 0.45, dest);
        break;
      case 'street_festival':
      case 'zombie_block_party':
        this.playPartyLoop(t, dest);
        break;
      case 'beach_volleyball':
      case 'food_truck_crowd':
        this.playNoiseBurstTo(dest, t, 0.35, 'bandpass', 420, 760, 0.16);
        break;
      case 'car_accident':
        this.playNoiseBurstTo(dest, t, 0.28, 'lowpass', 900, 120, 0.42);
        this.playToneTo(dest, 'sawtooth', 140, 70, t, 0.2, 0.2);
        this.playHorn(t + 0.15, dest);
        break;
      default:
        this.playToneTo(dest, 'sine', 660, 880, t, 0.12, 0.14);
    }
  }

  private playHorn(t: number, dest: AudioNode): void {
    this.playToneTo(dest, 'sawtooth', 233, 220, t, 0.55, 0.16);
    this.playToneTo(dest, 'sawtooth', 277, 262, t, 0.55, 0.14);
  }

  /** Two-second muffled party loop: four soft kicks over a low bass note with a hat tick on the off-beats. */
  private playPartyLoop(t: number, dest: AudioNode): void {
    for (let i = 0; i < 4; i++) this.playToneTo(dest, 'sine', 110, 50, t + i * 0.5, 0.22, 0.3);
    this.playToneTo(dest, 'triangle', 55, 55.5, t, 1.9, 0.12);
    this.playNoiseBurstTo(dest, t + 0.25, 0.08, 'lowpass', 900, 500, 0.06);
    this.playNoiseBurstTo(dest, t + 0.75, 0.08, 'lowpass', 900, 500, 0.06);
  }

  /** Rising then falling whoop (escalation responders, siren posts). */
  private playSirenWhoop(t: number, dest: AudioNode): void {
    this.playToneTo(dest, 'triangle', 520, 980, t, 0.55, 0.2);
    this.playToneTo(dest, 'triangle', 980, 520, t + 0.55, 0.55, 0.2);
  }

  private playInteractable(now: number, kind: InteractableKind, pos: Vec2): void {
    const cooldown = kind === 'carAlarm' ? 3 : kind === 'sirenPost' ? 2 : 0.35;
    const bus = this.cueBus(`interact:${kind}`, cooldown, now, pos);
    if (!bus) return;
    switch (kind) {
      case 'trashCan':
        // Metal lid clang.
        this.playToneTo(bus, 'triangle', 880, 620, now, 0.2, 0.22);
        this.playToneTo(bus, 'triangle', 1320, 1180, now + 0.02, 0.16, 0.1);
        break;
      case 'carAlarm':
        // Two-second wail: square-wave pair alternating every 0.25 s.
        for (let i = 0; i < 8; i++) {
          const f = i % 2 === 0 ? 960 : 760;
          this.playToneTo(bus, 'square', f, f, now + i * 0.25, 0.24, 0.1);
        }
        break;
      case 'fireHydrant':
        this.playNoiseBurstTo(bus, now, 1.2, 'highpass', 2800, 1800, 0.2);
        break;
      case 'sirenPost':
        this.playSirenWhoop(now, bus);
        break;
      case 'constructionBarrier':
        for (let i = 0; i < 3; i++) this.playNoiseBurstTo(bus, now + i * 0.11, 0.07, 'bandpass', 1600, 900, 0.25);
        this.playToneTo(bus, 'square', 240, 190, now, 0.09, 0.06);
        break;
      case 'shopWindow':
        // Glass tinkle: three quick high sines and a faint hiss.
        for (let i = 0; i < 3; i++) {
          const f = [2093, 2637, 3136][i];
          this.playToneTo(bus, 'sine', f, f * 1.002, now + i * 0.06, 0.5, 0.1);
        }
        this.playNoiseBurstTo(bus, now, 0.04, 'highpass', 6000, 6000, 0.04);
        break;
    }
  }

  /** Companion comic perks: whistle tweets (Larry), pan clang (Chef), handbag thwack (Grandma). */
  private playCompanionPerk(t: number, dest: AudioNode, id: CompanionId): void {
    switch (id) {
      case 'larry_lifeguard':
        this.playToneTo(dest, 'sine', 2300, 3000, t, 0.14, 0.2);
        this.playToneTo(dest, 'sine', 2600, 3300, t + 0.18, 0.14, 0.2);
        break;
      case 'chef_brainsley':
        this.playToneTo(dest, 'triangle', 1900, 1500, t, 0.35, 0.22);
        this.playToneTo(dest, 'sine', 2850, 2400, t, 0.3, 0.1);
        break;
      case 'grandma_rot':
        this.playNoiseBurstTo(dest, t, 0.1, 'lowpass', 500, 140, 0.36);
        this.playToneTo(dest, 'sine', 150, 70, t, 0.14, 0.26);
        break;
    }
  }

  /** Reward chime: a bright three-note rising arpeggio with a glint (distinct from the four-note ability unlock). */
  private playRewardChime(t: number, dest: AudioNode): void {
    const notes = [1046.5, 1318.5, 1568.0];
    for (let i = 0; i < notes.length; i++) {
      const at = t + i * 0.075;
      this.playToneTo(dest, 'sine', notes[i], notes[i] * 1.004, at, 0.42, 0.22);
      this.playToneTo(dest, 'triangle', notes[i] * 2, notes[i] * 2.004, at, 0.3, 0.05);
    }
    this.playNoiseBurstTo(dest, t, 0.12, 'highpass', 4000, 8000, 0.05);
  }

  /** Sewer slosh: a wet bandpassed rush and a low wobble. */
  private playSewerSlosh(t: number, dest: AudioNode): void {
    this.playNoiseBurstTo(dest, t, 0.9, 'bandpass', 420, 180, 0.26);
    this.playToneTo(dest, 'sine', 90, 140, t + 0.2, 0.35, 0.12);
  }

  /** Engine putter: six short sawtooth pulses sagging in pitch. */
  private playEnginePutter(t: number, dest: AudioNode): void {
    for (let i = 0; i < 6; i++) this.playToneTo(dest, 'sawtooth', 70 + i * 2, 58, t + i * 0.09, 0.08, 0.14);
  }

  /** Supply crate: wood creak, lid pop, then a small two-note chime. */
  private playCrateOpen(t: number, dest: AudioNode): void {
    this.playNoiseBurstTo(dest, t, 0.3, 'bandpass', 1200, 650, 0.2);
    this.playToneTo(dest, 'triangle', 220, 330, t, 0.22, 0.16);
    this.playToneTo(dest, 'sine', 880, 880, t + 0.3, 0.3, 0.14);
    this.playToneTo(dest, 'sine', 1320, 1320, t + 0.38, 0.35, 0.12);
  }

  /** One soft low tone when a district tips into panic or lockdown. */
  private playLowAlarm(t: number, dest: AudioNode): void {
    this.playToneTo(dest, 'sine', 196, 196, t, 0.9, 0.1);
  }

  /**
   * Play a stereo-panned, distance-attenuated sensory cue sound.
   * Mute-safe and cooldown-gated per SenseKind.
   */
  playSenseCue(kind: SenseKind, pan: number, gain: number): void {
    if (this.isMuted || !this.ctx || !this.masterGain || this.ctx.state !== 'running') return;
    const g = Math.max(0, Math.min(1, gain));
    if (g <= 0.01) return;
    const p = Math.max(-1, Math.min(1, pan));
    const cooldown =
      kind === 'gunshot' ? 0.25 : kind === 'scream' ? 0.45 : kind === 'siren' ? 1.2 : 1.5;

    try {
      const now = this.ctx.currentTime;
      if (this.lastSenseCueTime[kind] >= 0 && now - this.lastSenseCueTime[kind] < cooldown) return;
      this.lastSenseCueTime[kind] = now;

      const cueGain = this.ctx.createGain();
      cueGain.gain.setValueAtTime(g * 0.55, now);

      let dest: AudioNode = this.masterGain;
      if (typeof this.ctx.createStereoPanner === 'function') {
        const panner = this.ctx.createStereoPanner();
        panner.pan.setValueAtTime(p, now);
        panner.connect(this.masterGain);
        dest = panner;
      }
      cueGain.connect(dest);

      if (kind === 'gunshot') {
        this.playNoiseBurstTo(cueGain, now, 0.08, 'bandpass', 1100, 300, 0.38);
        this.playToneTo(cueGain, 'sine', 120, 42, now, 0.08, 0.3);
      } else if (kind === 'scream') {
        this.playToneTo(cueGain, 'triangle', 560, 820, now, 0.12, 0.22);
        this.playToneTo(cueGain, 'sine', 820, 460, now + 0.1, 0.16, 0.2);
      } else if (kind === 'siren') {
        this.playToneTo(cueGain, 'triangle', 520, 740, now, 0.24, 0.18);
        this.playToneTo(cueGain, 'triangle', 740, 520, now + 0.24, 0.24, 0.16);
      } else {
        this.playNoiseBurstTo(cueGain, now, 0.28, 'bandpass', 240, 420, 0.22);
        this.playToneTo(cueGain, 'sine', 95, 72, now, 0.26, 0.18);
      }
    } catch {
      // Fail gracefully
    }
  }

  private playToneTo(
    dest: AudioNode,
    type: OscillatorType,
    startFreq: number,
    endFreq: number,
    startTime: number,
    duration: number,
    gainPeak: number,
  ): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), startTime + duration);
    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(gainPeak, startTime + Math.min(0.015, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0008, startTime + duration);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }

  private playNoiseBurstTo(
    dest: AudioNode,
    startTime: number,
    duration: number,
    filterType: BiquadFilterType,
    startCutoff: number,
    endCutoff: number,
    gainPeak: number,
  ): void {
    if (!this.ctx || !this.noiseBuffer) return;
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
    gain.connect(dest);
    src.start(startTime);
    src.stop(startTime + duration + 0.01);
  }
}
