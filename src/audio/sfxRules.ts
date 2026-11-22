// [pure] Sample-SFX selection and rate limiting (docs/7_soundeffects.md). No Web Audio / DOM here so it runs under Vitest.
// AudioSystem asks these rules *which* clip to play and *whether* it may play now; SampleBank does the playing.

export type SfxId =
  | 'zombie_collected'
  | 'zombie_groan1' | 'zombie_groan2' | 'zombie_groan3' | 'zombie_groan4'
  | 'zombie_hitting_barracade'
  | 'barracade_colapses'
  | 'police_pistol' | 'police_sniper' | 'police_machinegun'
  | 'stronghold_captured'
  | 'death'
  | 'car_targettingzombie' | 'car_hitszombie'
  | 'brains_collected1' | 'brains_collected2' | 'brains_collected3' | 'brains_collected4' | 'brains_collected5'
  | 'attack_1' | 'attack_2'
  | 'player_attack1'
  | 'zombie_upgradetobrute'
  | 'human_scream1' | 'human_scream2' | 'human_scream3' | 'human_scream4';

/** Chance that a brains gain plays one of BRAINS_IDS (it would get repetitive on every pickup). */
export const BRAINS_SFX_CHANCE = 0.3;
export const BRAINS_IDS: readonly SfxId[] = ['brains_collected1', 'brains_collected2', 'brains_collected3', 'brains_collected4', 'brains_collected5'];

export const GROAN_IDS: readonly SfxId[] = ['zombie_groan1', 'zombie_groan2', 'zombie_groan3', 'zombie_groan4'];
export const SCREAM_IDS: readonly SfxId[] = ['human_scream1', 'human_scream2', 'human_scream3', 'human_scream4'];
export const ZOMBIE_ATTACK_IDS: readonly SfxId[] = ['attack_1', 'attack_2'];
export const RECOVERY_SFX_ID: SfxId = 'zombie_upgradetobrute';

export interface SfxSpec {
  /** Linear gain at the source (before distance attenuation and master gain). */
  gain: number;
  /** Minimum seconds between two starts of this clip. */
  minInterval: number;
  /** Maximum simultaneously playing instances of this clip (oldest is NOT cut; new starts are dropped). */
  maxVoices: number;
  /** Optional cap on how long one instance plays (s); it is faded out at the end. 0 = whole clip. */
  maxDuration: number;
  /** Random playback-rate spread (± fraction) so repeats don't sound identical. */
  rateJitter: number;
}

const S = (gain: number, minInterval: number, maxVoices: number, maxDuration = 0, rateJitter = 0.06): SfxSpec =>
  ({ gain, minInterval, maxVoices, maxDuration, rateJitter });

export const SFX: Record<SfxId, SfxSpec> = {
  zombie_collected: S(0.7, 0.07, 4),
  zombie_groan1: S(0.22, 0, 2, 0, 0.08),
  zombie_groan2: S(0.22, 0, 2, 0, 0.08),
  zombie_groan3: S(0.22, 0, 2, 0, 0.08),
  zombie_groan4: S(0.22, 0, 2, 0, 0.08),
  zombie_hitting_barracade: S(0.55, 0.35, 2, 1.6),
  barracade_colapses: S(0.95, 0.2, 2, 0, 0.03),
  police_pistol: S(0.5, 0.09, 4, 0, 0.05),
  police_sniper: S(0.6, 0.3, 2, 0, 0.03),
  police_machinegun: S(0.45, 0.45, 2, 1.4, 0.04),
  stronghold_captured: S(0.9, 1, 1, 0, 0),
  death: S(0.9, 1, 1, 0, 0), // Alpha death (leaderDied / legacy defeat)
  car_targettingzombie: S(0.75, 0.6, 2, 0, 0.04), // vehicleRam: a car starts charging the horde
  car_hitszombie: S(0.7, 0.08, 3, 0, 0.06), // vehicleHit: a car impacts a zombie / the Alpha
  // Very quiet, one random variant on some pickups (BRAINS_SFX_CHANCE).
  brains_collected1: S(0.12, 0.12, 2, 0, 0.05),
  brains_collected2: S(0.12, 0.12, 2, 0, 0.05),
  brains_collected3: S(0.12, 0.12, 2, 0, 0.05),
  brains_collected4: S(0.12, 0.12, 2, 0, 0.05),
  brains_collected5: S(0.12, 0.12, 2, 0, 0.05),
  attack_1: S(0.45, 0.11, 3, 1.2),
  attack_2: S(0.45, 0.11, 3, 1.2),
  player_attack1: S(0.65, 0.08, 2, 1.2),
  zombie_upgradetobrute: S(0.85, 0.3, 2, 0, 0.03),
  human_scream1: S(0.5, 0, 1, 0, 0.05),
  human_scream2: S(0.5, 0, 1, 0, 0.05),
  human_scream3: S(0.5, 0, 1, 0, 0.05),
  human_scream4: S(0.5, 0, 1, 0, 0.05),
};

export const SFX_IDS = Object.keys(SFX) as SfxId[];

/** Tunables for scheduled / world-positioned sample playback. */
export const SFX_TUNING = {
  /** Background groans: one every U(min,max) seconds while playing. */
  groanIntervalMin: 5,
  groanIntervalMax: 11,
  /** Human screams on flight: global gap U(min,max) seconds and at most once per human. */
  screamGapMin: 4,
  screamGapMax: 8,
  /** World sounds are full volume within `nearDist` of the leader and silent beyond `farDist` (m). */
  nearDist: 10,
  farDist: 60,
  /** Stereo pan width for world sounds (0..1). */
  panWidth: 0.7,
  /** Last Brain Standing heartbeat interval bounds (s): tightens from max to min as timeLeft falls. */
  heartbeatIntervalMax: 0.75,
  heartbeatIntervalMin: 0.28,
  /** Minimum cooldown (s) between Alpha critical-horde groans. */
  criticalGroanCooldown: 20,
  /** Minimum cooldown (s) between soft recruit strength cues. */
  recruitStrengthCooldown: 0.6,
  /** Gain multiplier applied to zombie_collected on hordeStrengthChanged recruit cues. */
  recruitStrengthGain: 0.35,
};

/** Which shot clip a human's weapon uses: police carry pistols; soldiers snipe from towers, otherwise machine-gun. */
export function shotSfxFor(role: 'soldier' | 'police' | 'civilian', inTower: boolean): SfxId {
  // todos #12: armed citizens (pistols / shotguns) use the sidearm clip, never the rifle.
  if (role === 'police' || role === 'civilian') return 'police_pistol';
  return inTower ? 'police_sniper' : 'police_machinegun';
}

/** Pick an element using a uniform random number r ∈ [0,1). */
export function pick<T>(items: readonly T[], r: number): T {
  return items[Math.min(items.length - 1, Math.max(0, Math.floor(r * items.length)))];
}

/** Distance attenuation (1 near → 0 far, smoothstep falloff). */
export function distanceGain(dist: number, near = SFX_TUNING.nearDist, far = SFX_TUNING.farDist): number {
  if (dist <= near) return 1;
  if (dist >= far) return 0;
  const t = 1 - (dist - near) / (far - near);
  return t * t * (3 - 2 * t);
}

/**
 * Per-clip limiter: enforces SfxSpec.minInterval and maxVoices.
 * `tryStart(id, now, duration)` returns true (and books the voice) when the clip may start.
 */
export class SfxLimiter {
  private readonly lastStart = new Map<SfxId, number>();
  private readonly voiceEnds = new Map<SfxId, number[]>();

  tryStart(id: SfxId, now: number, duration: number): boolean {
    const spec = SFX[id];
    const last = this.lastStart.get(id);
    if (last !== undefined && now - last < spec.minInterval) return false;
    let ends = this.voiceEnds.get(id);
    if (!ends) { ends = []; this.voiceEnds.set(id, ends); }
    for (let i = ends.length - 1; i >= 0; i--) if (ends[i] <= now) ends.splice(i, 1);
    if (ends.length >= spec.maxVoices) return false;
    ends.push(now + Math.max(0, duration));
    this.lastStart.set(id, now);
    return true;
  }

  reset(): void {
    this.lastStart.clear();
    this.voiceEnds.clear();
  }
}

/** Background groan timer: returns true when a groan is due and schedules the next one. */
export class GroanScheduler {
  private nextAt = -1;

  update(now: number, rand: () => number): boolean {
    if (this.nextAt < 0) { this.schedule(now, rand); return false; }
    if (now < this.nextAt) return false;
    this.schedule(now, rand);
    return true;
  }

  reset(): void { this.nextAt = -1; }

  private schedule(now: number, rand: () => number): void {
    const { groanIntervalMin: a, groanIntervalMax: b } = SFX_TUNING;
    this.nextAt = now + a + (b - a) * rand();
  }
}

/**
 * Scream gate for fleeing humans: a human screams at most once per flight (re-armed when it stops fleeing),
 * and screams are globally spaced by U(screamGapMin, screamGapMax) seconds so a routed crowd doesn't shriek in unison.
 */
export class ScreamGate {
  private readonly fleeing = new Set<number>();
  private readonly seen = new Set<number>();
  private nextAllowed = -1;

  /**
   * Feed every human's current flight flag once per frame (call begin() first, end() after).
   * Returns true when this human just started fleeing AND a scream is allowed now.
   */
  observe(id: number, isFleeing: boolean, now: number, rand: () => number): boolean {
    this.seen.add(id);
    if (!isFleeing) { this.fleeing.delete(id); return false; }
    if (this.fleeing.has(id)) return false;
    this.fleeing.add(id);
    return this.tryScream(now, rand);
  }

  /** Direct trigger (e.g. a civilian alert event); obeys the same global gap. */
  tryScream(now: number, rand: () => number): boolean {
    if (this.nextAllowed >= 0 && now < this.nextAllowed) return false;
    const { screamGapMin: a, screamGapMax: b } = SFX_TUNING;
    this.nextAllowed = now + a + (b - a) * rand();
    return true;
  }

  begin(): void { this.seen.clear(); }

  /** Forget humans that disappeared this frame so ids can be reused cleanly. */
  end(): void {
    for (const id of this.fleeing) if (!this.seen.has(id)) this.fleeing.delete(id);
  }

  reset(): void {
    this.fleeing.clear();
    this.seen.clear();
    this.nextAllowed = -1;
  }
}

/** Last Brain Standing heartbeat scheduler: tightens interval as timeLeft approaches 0. */
export class HeartbeatScheduler {
  private nextAt = -1;

  update(now: number, timeLeft: number, duration: number): boolean {
    if (this.nextAt < 0) this.nextAt = now;
    if (now < this.nextAt) return false;
    const frac = duration > 0 ? Math.max(0, Math.min(1, timeLeft / duration)) : 0;
    const { heartbeatIntervalMin: min, heartbeatIntervalMax: max } = SFX_TUNING;
    this.nextAt = now + min + (max - min) * frac;
    return true;
  }

  reset(): void {
    this.nextAt = -1;
  }
}

/** Cooldown gate for Alpha groans on hordeCritical (at least 20 s). */
export class CriticalGroanGate {
  private nextAllowed = -1;

  tryGroan(now: number): boolean {
    if (this.nextAllowed >= 0 && now < this.nextAllowed) return false;
    this.nextAllowed = now + SFX_TUNING.criticalGroanCooldown;
    return true;
  }

  reset(): void {
    this.nextAllowed = -1;
  }
}

/** Throttle gate for soft recruit cues on hordeStrengthChanged. */
export class RecruitCueGate {
  private nextAllowed = -1;

  tryPlay(now: number): boolean {
    if (this.nextAllowed >= 0 && now < this.nextAllowed) return false;
    this.nextAllowed = now + SFX_TUNING.recruitStrengthCooldown;
    return true;
  }

  reset(): void {
    this.nextAllowed = -1;
  }
}
