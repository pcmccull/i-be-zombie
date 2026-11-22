/**
 * [pure] Reusable zombie animation controller (horde followers, ambient walkers, brutes and the Alpha).
 *
 * One call per rendered frame: `animateZombie(state, profile, input, outPose)` advances the zombie's persistent
 * animation state and writes a full skeletal pose. Layers, in order:
 *   1. Locomotion  — distance-driven gait cycle (feet stay planted), asymmetric limp/drag, sway, hip twist,
 *                    idle stance blended in by smoothed speed (never a hard switch).
 *   2. Secondary   — damped springs: torso inertia on accel/decel, torso + head lag in turns, hit impulses.
 *   3. Personality — scheduled lurches/stumbles while walking, idle twitches (head, jaw, shoulder, slump...).
 *   4. Overlays    — attack key poses (anticipation → strike at the gameplay hit → follow-through → recover),
 *                    stun, climb, death fall (3 styles), rise.
 *   5. Grounding   — pelvis height from leg FK so the lowest foot (or knee) sits on the ground.
 *
 * Gameplay is untouched: the root position/facing always come from the simulation, so input stays responsive.
 * Followers' melee damage lands the step `attackCooldown` reaches 0, so the strike key pose is timed to that
 * moment from the cooldown countdown; the Alpha uses its own windup/recovery phases (hit at windup end).
 */
import { ATTACK_STYLE, hashId, type GaitProfile, type ZombieProfile } from './zombieProfiles';
import { copyPose, createPose, groundedHipY, RIG, type PoseField, type ZombiePose } from './zombieRig';
import {
  applyClip,
  applyClipAuthored,
  BITE_SNAP_T,
  CLIPS,
  clipDuration,
  hitSign,
} from '../graphics/characters/characterClips';

const TWO_PI = Math.PI * 2;

export type ZombieAnimMode = 'ambient' | 'follow' | 'attack';

/** Discrete states the controller blends between (exposed for debugging / tests). */
export type ZombieAnimStateName =
  | 'idle'
  | 'walk'
  | 'fastWalk'
  | 'turn'
  | 'attack'
  | 'bite'
  | 'hit'
  | 'celebrate'
  | 'stunned'
  | 'climb'
  | 'dead'
  | 'rise';

export interface ZombieAnimInput {
  /** Real frame delta (s). 0 = frozen (paused). */
  dt: number;
  /** Ground speed (m/s). */
  speed: number;
  /** World facing (rad), as rendered (interpolated). */
  facing: number;
  /** Sim anim tag + seconds since it changed. */
  anim: 'idle' | 'walk' | 'run' | 'attack' | 'hit' | 'dead' | 'rise' | 'climb';
  animTime: number;
  mode: ZombieAnimMode;
  /** Has a melee target (followers) / is in combat. */
  engaged: boolean;
  /** Seconds until the next melee swing is allowed (followers). */
  cooldown: number;
  /** Rush / sprint / Frenzy: aggressive stagger. */
  fast: boolean;
  /** Leader-style explicit attack phases (overrides the cooldown path when phase !== 'none'). */
  attackPhase: 'none' | 'windup' | 'recovery';
  /** 0..1 progress through the current windup / recovery. */
  attackT: number;
  /** Explicit attack style for attackPhase (ATTACK_STYLE), or -1 = auto. */
  attackStyle: number;
  /** True on the frame the zombie took damage (rising edge of its hit flash). */
  hitImpulse: boolean;
  /** Direction the hit came FROM, in character space (x = left, z = forward); (0,0) = unknown. */
  hitFromX: number;
  hitFromZ: number;
  /** 0..1 stun strength (Alpha hit stun). */
  stun: number;
  /** Seconds since death (anim 'dead'). */
  deadTime: number;
  /** 0..1 progress of a rise (conversion / respawn). */
  riseT: number;
  /** With anim 'rise': climb up out of the ground (Alpha at a nest) instead of getting up off it. */
  emerge: boolean;
  /** 0..1 progress of a nest-teleport dive (leap up, plunge head first into the hole); < 0 = not diving. */
  dive: number;
  /** Seconds since a victory celebration was triggered (looping flail); < 0 / undefined = none. Optional. */
  celebrate?: number;
  /** Yaw (character space) toward something worth looking at (leader, target), or NaN. */
  lookYaw: number;
  /** 0 near camera (full secondary motion), 1 medium, 2 far (no twitches / lurches). */
  detail: 0 | 1 | 2;
}

export function createAnimInput(): ZombieAnimInput {
  return {
    dt: 1 / 60,
    speed: 0,
    facing: 0,
    anim: 'idle',
    animTime: 0,
    mode: 'follow',
    engaged: false,
    cooldown: 0,
    fast: false,
    attackPhase: 'none',
    attackT: 0,
    attackStyle: -1,
    hitImpulse: false,
    hitFromX: 0,
    hitFromZ: 0,
    stun: 0,
    deadTime: 0,
    riseT: 0,
    emerge: false,
    dive: -1,
    lookYaw: NaN,
    detail: 0,
  };
}

/** Persistent per-zombie animation state (renderer side-table; never part of GameState). */
export interface ZombieAnimState {
  init: boolean;
  rng: number;
  /** Personal clock (profile playback rate). */
  clock: number;
  gait: number;
  speed: number;
  accel: number;
  facing: number;
  turn: number;
  // Damped springs: value + velocity.
  lean: number;
  leanV: number;
  roll: number;
  rollV: number;
  torsoYaw: number;
  torsoYawV: number;
  headYaw: number;
  headYawV: number;
  headPitch: number;
  headPitchV: number;
  // Idle twitches.
  twitchKind: number;
  twitchT: number;
  twitchDur: number;
  twitchSign: number;
  twitchNext: number;
  twitchCount: number;
  // Lurch / stumble.
  lurchT: number;
  lurchDur: number;
  lurchAmp: number;
  lurchSide: number;
  lurchStumble: boolean;
  lurchNext: number;
  lurchCount: number;
  // Attacks.
  aggro: number;
  atkW: number;
  atkPhase: 0 | 1 | 2;
  atkT: number;
  atkStyleShown: number;
  nextStyle: number;
  curStyle: number;
  attackCount: number;
  cdTotal: number;
  lastAnim: string;
  lastAnimTime: number;
  // Hits / stun.
  hitAge: number;
  stun: number;
  // Overlays.
  climbW: number;
  deathW: number;
  /** Low-passed pelvis height (rig units; <= 0 = uninitialised). */
  hipH: number;
  /** Last discrete state name (debug). */
  stateName: ZombieAnimStateName;
  // Clip overlays (characterClips): per-id variation, one-shot timers (-1 = idle).
  clipVar: number;
  clipPlays: number;
  celW: number;
  celT: number;
  hitClipT: number;
  hitClipSign: 1 | -1;
  hitClipVar: number;
  turnClipT: number;
  turnClipDir: number;
  turnClipVar: number;
  turnCool: number;
  idleT: number;
  idleLookT: number;
  idleLookNext: number;
  idleLookCount: number;
  idleLookVar: number;
  lungeT: number;
  lungeCool: number;
  lungeVar: number;
  flourishT: number;
  flourishVar: number;
  wasRising: boolean;
}

export function createAnimState(): ZombieAnimState {
  return {
    init: false,
    rng: 1,
    clock: 0,
    gait: 0,
    speed: 0,
    accel: 0,
    facing: 0,
    turn: 0,
    lean: 0,
    leanV: 0,
    roll: 0,
    rollV: 0,
    torsoYaw: 0,
    torsoYawV: 0,
    headYaw: 0,
    headYawV: 0,
    headPitch: 0,
    headPitchV: 0,
    twitchKind: -1,
    twitchT: 0,
    twitchDur: 1,
    twitchSign: 1,
    twitchNext: 1,
    twitchCount: 0,
    lurchT: -1,
    lurchDur: 0.8,
    lurchAmp: 0,
    lurchSide: 1,
    lurchStumble: false,
    lurchNext: 3,
    lurchCount: 0,
    aggro: 0,
    atkW: 0,
    atkPhase: 0,
    atkT: 0,
    atkStyleShown: 0,
    nextStyle: 0,
    curStyle: 0,
    attackCount: 0,
    cdTotal: 1.2,
    lastAnim: 'idle',
    lastAnimTime: 0,
    hitAge: 99,
    stun: 0,
    climbW: 0,
    deathW: 0,
    hipH: 0,
    stateName: 'idle',
    clipVar: 0,
    clipPlays: 0,
    celW: 0,
    celT: 0,
    hitClipT: -1,
    hitClipSign: 1,
    hitClipVar: 0,
    turnClipT: -1,
    turnClipDir: 1,
    turnClipVar: 0,
    turnCool: 0,
    idleT: 0,
    idleLookT: -1,
    idleLookNext: 8,
    idleLookCount: 0,
    idleLookVar: 0,
    lungeT: -1,
    lungeCool: 0,
    lungeVar: 0,
    flourishT: -1,
    flourishVar: 0,
    wasRising: false,
  };
}

// ---------------------------------------------------------------------------
// Tuning (all animation constants in one place)
// ---------------------------------------------------------------------------

export const ANIM_TUNING = {
  speedSmoothing: 9,
  accelSmoothing: 6,
  turnSmoothing: 9,
  /** Speed below which the idle stance dominates / above which the gait is fully on (m/s). */
  moveStart: 0.08,
  moveFull: 0.75,
  /** Fast-walk blend range (m/s): past ~2 m/s the shuffle turns into an aggressive forward stagger. */
  fastStart: 2.0,
  fastFull: 5.2,
  leanSpring: { k: 55, zeta: 0.42 },
  rollSpring: { k: 60, zeta: 0.45 },
  torsoYawSpring: { k: 80, zeta: 0.55 },
  headYawSpring: { k: 34, zeta: 0.5 },
  headPitchSpring: { k: 45, zeta: 0.45 },
  /** Inertial lean per m/s² of (smoothed) acceleration, opposite to the acceleration. */
  inertiaLean: 0.032,
  /** Torso / head yaw lag per rad/s of turn rate. */
  torsoTurnLag: 0.075,
  headTurnLag: 0.13,
  /** Attack windup / recovery as a fraction of the follower cooldown (and absolute caps, seconds). */
  windupFrac: 0.42,
  windupMax: 0.42,
  recoveryFrac: 0.45,
  recoveryMax: 0.6,
  /** Attack overlay blend rate (1/s) when an attack is interrupted (target lost). */
  attackFade: 4.5,
  deathFall: 0.62,
  stunSmoothing: 14,
  /** Clip overlays: turn trigger (rad/s, smoothed) / max speed, idle-look spacing (s), lunge trigger speed + cooldown. */
  turnClipRate: 1.3,
  turnClipMaxSpeed: 0.7,
  turnClipCooldown: 0.35,
  idleLookMin: 7,
  idleLookSpread: 9,
  lungeMinSpeed: 1.4,
  lungeCooldown: 5,
  /** Celebrate weight smoothing (1/s) and the Alpha's cockier amplitude. */
  celebrateRate: 9,
  alphaCelebrateGain: 1.3,
  twitchIntervalMin: 2.2,
  twitchIntervalMax: 6.5,
  lurchDuration: 0.85,
} as const;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeIn(t: number): number {
  return t * t;
}

function wrapAngle(a: number): number {
  a = (a + Math.PI) % TWO_PI;
  if (a < 0) a += TWO_PI;
  return a - Math.PI;
}

/** Deterministic xorshift on the anim state (never Math.random). */
function rand(s: ZombieAnimState): number {
  let x = s.rng | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.rng = x | 0;
  return ((x >>> 0) % 1000003) / 1000003;
}

/** Velocity written by the last springStep (scratch; overwritten before every use). */
let springV = 0;

/** Semi-implicit damped spring step toward `target`: returns the new value, the new velocity is in `springV`. */
function springStep(x: number, v: number, target: number, k: number, zeta: number, dt: number): number {
  const c = 2 * zeta * Math.sqrt(k);
  // Two half-steps keep it stable for dt up to 0.1 s.
  const h = dt * 0.5;
  for (let i = 0; i < 2; i++) {
    v += (-(x - target) * k - v * c) * h;
    x += v * h;
  }
  springV = v;
  return x;
}

/** Envelope: quick rise over `attack` seconds, smooth decay to 0 at `dur`. */
function envelope(t: number, dur: number, attack: number): number {
  if (t <= 0 || t >= dur) return 0;
  if (t < attack) return easeInOut(t / attack);
  return 1 - easeInOut((t - attack) / Math.max(1e-3, dur - attack));
}

// ---------------------------------------------------------------------------
// Attack key poses
// ---------------------------------------------------------------------------

/**
 * Key pose: absolute targets for arms/jaw (NaN = leave the base pose), additive offsets for the body.
 * Index order: ANTICIPATE (pulled back, telegraph), STRIKE (contact — equals the gameplay hit), FOLLOW
 * (over-extended, losing balance).
 */
type Key = Partial<Record<PoseField, number>>;

const ABS_FIELDS: readonly PoseField[] = [
  'armLPitch', 'armLYaw', 'armLRoll', 'elbowL',
  'armRPitch', 'armRYaw', 'armRRoll', 'elbowR',
  'jaw',
];
const ADD_FIELDS: readonly PoseField[] = [
  'spinePitch', 'spineYaw', 'spineRoll', 'neckPitch', 'neckYaw', 'neckRoll', 'hipZ', 'hipPitch', 'hipYaw',
  'kneeL', 'kneeR', 'thighLPitch', 'thighRPitch', 'shrugL', 'shrugR',
];

function mirrorKey(k: Key): Key {
  const m: Key = {};
  const sw: Record<string, PoseField> = {
    armLPitch: 'armRPitch', armRPitch: 'armLPitch',
    armLYaw: 'armRYaw', armRYaw: 'armLYaw',
    armLRoll: 'armRRoll', armRRoll: 'armLRoll',
    elbowL: 'elbowR', elbowR: 'elbowL',
    kneeL: 'kneeR', kneeR: 'kneeL',
    thighLPitch: 'thighRPitch', thighRPitch: 'thighLPitch',
    shrugL: 'shrugR', shrugR: 'shrugL',
  };
  const negate = new Set<string>(['armLYaw', 'armRYaw', 'armLRoll', 'armRRoll', 'spineYaw', 'spineRoll', 'neckYaw', 'neckRoll', 'hipYaw']);
  for (const f of Object.keys(k) as PoseField[]) {
    const dst = sw[f] ?? f;
    const v = k[f] as number;
    m[dst] = negate.has(f) ? -v : v;
  }
  return m;
}

const SWIPE_R: [Key, Key, Key] = [
  // Anticipate: right shoulder drawn back and up, torso twisted away, rears up.
  { armRPitch: -2.15, armRRoll: -0.95, armRYaw: -0.2, elbowR: 1.05, armLPitch: -0.9, elbowL: 0.5,
    spineYaw: -0.38, spinePitch: -0.08, spineRoll: 0.06, neckPitch: -0.12, neckYaw: 0.25, hipZ: -0.04, shrugR: 0.04 },
  // Strike: whips across the body.
  { armRPitch: -1.35, armRRoll: 0.42, armRYaw: 0.32, elbowR: 0.12, armLPitch: -0.55, elbowL: 0.6,
    spineYaw: 0.4, spinePitch: 0.3, spineRoll: -0.04, neckPitch: 0.1, hipZ: 0.14 },
  // Follow-through: over-swung, staggering forward on the left side.
  { armRPitch: -0.55, armRRoll: 0.75, armRYaw: 0.45, elbowR: 0.55, armLPitch: -0.3, elbowL: 0.4,
    spineYaw: 0.5, spinePitch: 0.42, spineRoll: -0.13, neckPitch: 0.22, neckYaw: -0.15, hipZ: 0.17, kneeL: 0.18 },
];
const SWIPE_L: [Key, Key, Key] = [mirrorKey(SWIPE_R[0]), mirrorKey(SWIPE_R[1]), mirrorKey(SWIPE_R[2])];

const GRAB: [Key, Key, Key] = [
  { armLPitch: -1.95, armRPitch: -1.9, armLRoll: 0.5, armRRoll: -0.5, elbowL: 0.7, elbowR: 0.65,
    spinePitch: -0.07, neckPitch: -0.15, jaw: 0.35, hipZ: -0.03 },
  { armLPitch: -1.45, armRPitch: -1.42, armLRoll: -0.08, armRRoll: 0.08, elbowL: 0.1, elbowR: 0.12,
    spinePitch: 0.36, neckPitch: 0.05, jaw: 0.5, hipZ: 0.18 },
  { armLPitch: -1.05, armRPitch: -1.1, armLRoll: -0.22, armRRoll: 0.24, elbowL: 1.05, elbowR: 0.95,
    spinePitch: 0.46, neckPitch: 0.25, jaw: 0.45, hipZ: 0.15, spineRoll: 0.06, kneeR: 0.15 },
];

const BITE: [Key, Key, Key] = [
  { armLPitch: -1.55, armRPitch: -1.5, armLRoll: 0.3, armRRoll: -0.3, elbowL: 0.55, elbowR: 0.5,
    spinePitch: -0.14, neckPitch: -0.5, jaw: 0.65, hipZ: -0.05 },
  { armLPitch: -1.2, armRPitch: -1.15, armLRoll: -0.12, armRRoll: 0.12, elbowL: 0.35, elbowR: 0.4,
    spinePitch: 0.42, neckPitch: 0.38, jaw: 0.04, hipZ: 0.22 },
  { armLPitch: -0.95, armRPitch: -0.9, armLRoll: -0.18, armRRoll: 0.2, elbowL: 0.9, elbowR: 0.85,
    spinePitch: 0.5, neckPitch: 0.28, neckYaw: 0.18, jaw: 0.2, hipZ: 0.14, kneeL: 0.12 },
];

const OVERHEAD: [Key, Key, Key] = [
  { armLPitch: -2.95, armRPitch: -2.9, armLRoll: 0.22, armRRoll: -0.22, elbowL: 0.75, elbowR: 0.7,
    spinePitch: -0.22, neckPitch: -0.22, hipZ: -0.06, shrugL: 0.04, shrugR: 0.04 },
  { armLPitch: -1.0, armRPitch: -0.95, armLRoll: 0.1, armRRoll: -0.1, elbowL: 0.1, elbowR: 0.12,
    spinePitch: 0.48, neckPitch: 0.15, hipZ: 0.15, kneeL: 0.12, kneeR: 0.12 },
  { armLPitch: -0.45, armRPitch: -0.4, armLRoll: 0.16, armRRoll: -0.16, elbowL: 0.35, elbowR: 0.3,
    spinePitch: 0.58, neckPitch: 0.3, hipZ: 0.13, kneeL: 0.25, kneeR: 0.22 },
];

const ATTACK_KEYS: readonly [Key, Key, Key][] = [SWIPE_R, SWIPE_L, GRAB, BITE, OVERHEAD];

/** Blend between keys a → b (null = the base pose) at u, applied with weight w onto `out` (which holds the base). */
function applyKeys(out: ZombiePose, a: Key | null, b: Key | null, u: number, w: number): void {
  if (w <= 0) return;
  for (let i = 0; i < ABS_FIELDS.length; i++) {
    const f = ABS_FIELDS[i];
    const cur = out[f];
    const va = a && a[f] !== undefined ? (a[f] as number) : cur;
    const vb = b && b[f] !== undefined ? (b[f] as number) : cur;
    out[f] = mix(cur, mix(va, vb, u), w);
  }
  for (let i = 0; i < ADD_FIELDS.length; i++) {
    const f = ADD_FIELDS[i];
    const va = a && a[f] !== undefined ? (a[f] as number) : 0;
    const vb = b && b[f] !== undefined ? (b[f] as number) : 0;
    out[f] += mix(va, vb, u) * w;
  }
}

/**
 * Attack timeline. phase 1 (windup, t 0..1): base → ANTICIPATE (0..0.6), ANTICIPATE → STRIKE (0.6..1, accelerating):
 * contact exactly at t = 1, the moment gameplay applies damage. phase 2 (recovery): STRIKE → FOLLOW (0..0.35,
 * decelerating), FOLLOW → base (0.35..1).
 */
export function applyAttackPose(out: ZombiePose, style: number, phase: 1 | 2, t: number, w: number): void {
  const keys = ATTACK_KEYS[clamp(style | 0, 0, ATTACK_KEYS.length - 1)];
  if (phase === 1) {
    if (t < 0.6) applyKeys(out, null, keys[0], easeInOut(t / 0.6), w);
    else applyKeys(out, keys[0], keys[1], ((t - 0.6) / 0.4) ** 1.6, w);
  } else {
    if (t < 0.35) applyKeys(out, keys[1], keys[2], easeOut(t / 0.35), w);
    else applyKeys(out, keys[2], null, easeInOut((t - 0.35) / 0.65), w);
  }
}

/** Key pose values (exposed for tests: strike contact must equal the gameplay hit frame). */
export function attackKey(style: number, which: 0 | 1 | 2): Readonly<Key> {
  return ATTACK_KEYS[clamp(style | 0, 0, ATTACK_KEYS.length - 1)][which];
}

// ---------------------------------------------------------------------------
// The controller
// ---------------------------------------------------------------------------

function scheduleTwitch(s: ZombieAnimState, g: GaitProfile): void {
  s.twitchNext = mix(ANIM_TUNING.twitchIntervalMin, ANIM_TUNING.twitchIntervalMax, rand(s)) / Math.max(0.2, g.twitchiness);
}

function scheduleLurch(s: ZombieAnimState, g: GaitProfile): void {
  // Exponential-ish spacing around 1 / lurchRate, never too close together.
  const mean = 1 / Math.max(0.01, g.lurchRate);
  s.lurchNext = 1.8 + mean * (0.4 + 1.2 * rand(s));
}

function pickStyle(s: ZombieAnimState, g: GaitProfile): number {
  const list = g.attackStyles;
  if (list.length === 0) return ATTACK_STYLE.grab;
  return list[Math.floor(rand(s) * list.length) % list.length];
}

function unitHash(seed: number, salt: number): number {
  return hashId(seed, salt) / 4294967296;
}

/** Variation for the next play of a clip: per-id base, decorrelated per play (never touches the rng stream). */
function playVar(s: ZombieAnimState): number {
  const v = s.clipVar + 0.381966 * s.clipPlays++;
  return v - Math.floor(v);
}

function initState(s: ZombieAnimState, p: ZombieProfile, inp: ZombieAnimInput): void {
  s.init = true;
  s.clipVar = unitHash(p.seed, 91);
  s.idleLookNext = ANIM_TUNING.idleLookMin + ANIM_TUNING.idleLookSpread * unitHash(p.seed, 119);
  s.rng = (p.seed | 0) || 0x1234567;
  s.clock = (p.seed % 997) * 0.13;
  s.gait = p.gait.phase0;
  s.speed = inp.speed;
  s.facing = inp.facing;
  s.lastAnim = inp.anim;
  s.lastAnimTime = inp.animTime;
  s.cdTotal = 1.2;
  scheduleTwitch(s, p.gait);
  s.twitchNext *= rand(s); // desync the first twitches across a freshly spawned crowd
  scheduleLurch(s, p.gait);
  s.lurchNext *= 0.3 + rand(s);
  s.nextStyle = pickStyle(s, p.gait);
  s.curStyle = s.nextStyle;
  if (inp.anim === 'dead') s.deathW = 1;
}

const _foot = { z: 0, y: 0, swing: 0 };
const _leg = { a: 0, k: 0 };

/**
 * Foot target for cycle fraction q (rig units, relative to the ground point): stance q ∈ [0, σ) slides back
 * linearly by exactly the distance the body covers; swing eases forward with a lift arc. Blends to a rest
 * stance (restZ) as `move` → 0 so a stopping zombie settles its feet.
 */
function planFoot(q: number, sigma: number, stride: number, lift: number, restZ: number, move: number): void {
  let z: number;
  let y = 0;
  let swing = 0;
  if (q < sigma) {
    z = stride * sigma * (0.5 - q / sigma);
  } else {
    const u = (q - sigma) / (1 - sigma);
    z = stride * sigma * (-0.5 + easeInOut(u));
    swing = Math.sin(Math.PI * u);
    y = lift * swing * Math.sqrt(swing);
  }
  _foot.z = mix(restZ, z, move);
  _foot.y = y;
  _foot.swing = swing * move;
}

/**
 * Hip height a planted leg allows (straight-ish leg of length `len` over a foot at forward offset z). Legs that
 * are swinging, or just landing / lifting off, contribute progressively higher values (soft weighting).
 */
function stanceHeight(q: number, sigma: number, z: number, len: number, move: number): number {
  const h = Math.sqrt(Math.max(0.04, len * len - z * z));
  if (move <= 0) return h;
  let wgt = 0;
  if (q < sigma) {
    const u = q / sigma;
    wgt = smoothstep(0, 0.25, u) * (1 - smoothstep(0.75, 1, u));
  }
  return h + (1 - wgt) * 0.35 * move;
}

/** Two-bone leg IK: ankle at forward offset `reach` and `drop` below the hip → absolute thigh angle + knee flex. */
function solveLeg(reach: number, drop: number): void {
  const t = RIG.thigh;
  const sh = RIG.shin;
  let d = Math.hypot(reach, drop);
  // Soft IK: approach full extension asymptotically so the knee never snaps straight (the foot may fall a few
  // mm short; final grounding lowers the pelvis to compensate).
  const dMax = (t + sh) * 0.995;
  const dSoft = (t + sh) * 0.93;
  if (d > dSoft) d = dSoft + (dMax - dSoft) * (1 - Math.exp(-(d - dSoft) / (dMax - dSoft)));
  d = Math.max(d, Math.abs(t - sh) + 0.02);
  const cosK = clamp((d * d - t * t - sh * sh) / (2 * t * sh), -1, 1);
  const k = Math.acos(cosK);
  const phi = Math.atan2(-reach, drop);
  const beta = Math.atan2(sh * Math.sin(k), t + sh * Math.cos(k));
  _leg.a = phi - beta;
  _leg.k = k;
}

const _base = createPose();
const RESET_FIELDS: readonly PoseField[] = ['rootY', 'rootPitch', 'rootRoll', 'hipX', 'hipZ', 'hipYaw', 'hipRoll', 'spineYaw',
  'neckYaw', 'jaw', 'armLYaw', 'armRYaw', 'thighLRoll', 'thighRRoll', 'ankleL', 'ankleR'];
const TWITCH_DURATIONS: readonly number[] = [0.5, 1.4, 0.55, 1.8, 1.6, 0.6, 2.2, 1.5];

/**
 * Advance `s` by `inp.dt` and write the pose. Allocation-free in steady state.
 */
export function animateZombie(
  s: ZombieAnimState,
  p: ZombieProfile,
  inp: ZombieAnimInput,
  out: ZombiePose,
): ZombiePose {
  const g = p.gait;
  if (!s.init) initState(s, p, inp);
  const dt = clamp(inp.dt, 0, 0.1);
  const T = ANIM_TUNING;
  const detail = inp.detail;

  s.clock += dt * g.playback;
  const tc = s.clock;

  // --- Smoothed kinematics ---------------------------------------------------
  const prevSpeed = s.speed;
  s.speed += (inp.speed - s.speed) * (1 - Math.exp(-T.speedSmoothing * dt));
  if (dt > 0) {
    const a = (s.speed - prevSpeed) / dt;
    s.accel += (clamp(a, -40, 40) - s.accel) * (1 - Math.exp(-T.accelSmoothing * dt));
    const dF = wrapAngle(inp.facing - s.facing);
    const tr = clamp(dF / dt, -10, 10);
    s.turn += (tr - s.turn) * (1 - Math.exp(-T.turnSmoothing * dt));
  }
  s.facing = inp.facing;

  const dead = inp.anim === 'dead';
  const rising = inp.anim === 'rise';
  const climbing = inp.anim === 'climb';
  const active = !dead && !rising;

  // Smoothed speed (not the sim tag) drives the blend, so death / rise start from a continuous pose.
  const move = smoothstep(T.moveStart, T.moveFull, s.speed);
  let fast = smoothstep(T.fastStart, T.fastFull, s.speed);
  if (inp.fast && active) fast = Math.max(fast, 0.55 * move);
  fast *= 1 - 0.4 * g.heavy;
  const idle = 1 - move;

  // --- New sim events (attack start, hit) -----------------------------------
  const animRestarted = inp.anim !== s.lastAnim || inp.animTime + 1e-6 < s.lastAnimTime;
  if (inp.anim === 'attack' && animRestarted && inp.attackPhase === 'none') {
    // A follower swing just landed: keep the style its windup showed, roll the next one.
    s.curStyle = s.nextStyle;
    s.nextStyle = pickStyle(s, g);
    s.cdTotal = clamp(inp.cooldown, 0.25, 3);
    s.attackCount++;
  }
  if (inp.hitImpulse && active) {
    s.hitAge = 0;
    // Push away from the source: lean back if hit from the front, roll away sideways.
    let hx = inp.hitFromX;
    let hz = inp.hitFromZ;
    const hl = Math.hypot(hx, hz);
    if (hl < 1e-4) { hx = 0; hz = 1; } else { hx /= hl; hz /= hl; }
    const strength = 1 - 0.5 * g.heavy;
    s.leanV += -hz * 4.2 * strength;
    s.rollV += hx * 3.4 * strength;
    s.headPitchV += -hz * 7 * strength;
    s.headYawV += -hx * 6 * strength;
    s.hitClipT = 0;
    s.hitClipSign = hitSign(inp.hitFromX, inp.hitFromZ);
    s.hitClipVar = playVar(s);
  }
  s.hitAge += dt;
  s.lastAnim = inp.anim;
  s.lastAnimTime = inp.animTime;

  // --- Gait phase (distance driven: one cycle per `stride` of ground covered) ----
  // The cadence jitter stretches the stride (not the clock), so planted feet stay planted.
  const scale = p.scale;
  const jitter = 1 + g.cadenceJitter * (0.6 * Math.sin(tc * 1.37 + p.seed) + 0.4 * Math.sin(tc * 3.1 + p.seed * 0.7));
  // Stride grows with speed (rig units per cycle), capped by what a ~0.7 m leg can reach for the stance fraction.
  const sigmaBase = mix(0.62, 0.4, fast);
  const speedRig = s.speed / scale;
  const strideRig = Math.min(
    g.stride * (0.7 + 0.3 * move) * (1 + 0.22 * clamp(speedRig - 1, 0, 6)) * (1 - 0.12 * g.heavy),
    0.9 / sigmaBase,
  ) * jitter;
  let rate = s.speed / Math.max(0.2, strideRig * scale); // cycles / s
  // Lurch: the corrective step comes quicker (a little scuffing of the feet is fine — it is a stumble).
  let lurchEnv = 0;
  let lurchRecover = 0;
  if (s.lurchT >= 0) {
    const u = s.lurchT / s.lurchDur;
    lurchEnv = u < 0.55 ? Math.sin((u / 0.55) * Math.PI * 0.5) ** 2 : 1 - easeInOut((u - 0.55) / 0.45);
    lurchRecover = u > 0.3 && u < 0.75 ? Math.sin(((u - 0.3) / 0.45) * Math.PI) : 0;
    rate *= 1 + 0.45 * lurchRecover;
  }
  s.gait = (s.gait + TWO_PI * rate * dt) % TWO_PI;
  const q = s.gait / TWO_PI;
  const w = s.gait;

  // Limp: the injured leg's stance is cut short and its step comes early → an uneven, hitching rhythm.
  const limpL = g.limpLeg === 1 ? g.limp : 0;
  const limpR = g.limpLeg === -1 ? g.limp : 0;
  const sigmaL = sigmaBase - 0.1 * limpL;
  const sigmaR = sigmaBase - 0.1 * limpR;
  const qL = q;
  const qR = (q + 0.5 + 0.07 * (limpL - limpR)) % 1;
  const pL = w;
  const pR = w + Math.PI;

  // --- 1. Locomotion ---------------------------------------------------------
  const b = _base;
  for (let i = 0; i < RESET_FIELDS.length; i++) b[RESET_FIELDS[i]] = 0;
  b.hipY = RIG.hipY;
  b.hipPitch = 0.04 + 0.07 * fast + 0.03 * g.heavy;

  // Feet: linear stance slide (exactly matching the ground speed), eased swing arc; IK solves thigh + knee.
  const liftBase = (0.07 + 0.1 * fast) * move;
  const restZL = 0.05 + 0.03 * g.heavy;
  const restZR = -0.06 - 0.02 * g.heavy;
  // Pelvis height: an inverted-pendulum arc over the planted foot (soft-min over the stance legs, weights ramp
  // at heel strike / toe-off so the height never jumps), 60 % of the arc kept as bob, the knee absorbs the rest.
  const legLen = (0.975 - 0.06 * g.kneeBend - 0.03 * g.heavy) * (RIG.thigh + RIG.shin);
  const hipTop = RIG.ankleH + legLen;
  planFoot(qL, sigmaL, strideRig, 0, restZL, move);
  const arcL = stanceHeight(qL, sigmaL, _foot.z, legLen, move);
  planFoot(qR, sigmaR, strideRig, 0, restZR, move);
  const arcR = stanceHeight(qR, sigmaR, _foot.z, legLen, move);
  const hipArc = RIG.ankleH + Math.min(arcL, arcR);
  const hipTarget = hipTop - (0.6 + 0.25 * g.heavy) * (hipTop - hipArc);
  // Low-pass the pelvis height: the knee is very sensitive near full extension, so a raw arc would flick it.
  if (s.hipH <= 0) s.hipH = hipTarget;
  s.hipH += (hipTarget - s.hipH) * (1 - Math.exp(-16 * dt));
  const hipH = s.hipH;

  planFoot(qL, sigmaL, strideRig, liftBase * (1 - 0.75 * limpL), restZL, move);
  solveLeg(_foot.z, hipH - RIG.ankleH - _foot.y);
  b.thighLPitch = _leg.a - b.hipPitch;
  b.kneeL = _leg.k;
  b.ankleL = -(_leg.a + _leg.k) + (0.2 + 0.55 * limpL) * _foot.swing;
  const swingL = _foot.swing;
  planFoot(qR, sigmaR, strideRig, liftBase * (1 - 0.75 * limpR), restZR, move);
  solveLeg(_foot.z, hipH - RIG.ankleH - _foot.y);
  b.thighRPitch = _leg.a - b.hipPitch;
  b.kneeR = _leg.k;
  b.ankleR = -(_leg.a + _leg.k) + (0.2 + 0.55 * limpR) * _foot.swing;
  const swingR = _foot.swing;
  // Injured leg swings outward (circumduction); heavy bodies stand wide.
  b.thighLRoll = 0.03 + 0.2 * limpL * swingL * move + 0.03 * g.heavy;
  b.thighRRoll = -0.03 - 0.2 * limpR * swingR * move - 0.03 * g.heavy;

  // Pelvis: sways over the stance foot, drops on the swing side, twists with the stride.
  const swayAmp = g.sway * (1 + 0.8 * g.heavy) * (1 + 0.5 * fast);
  b.hipX = -swayAmp * Math.cos(w) * move;
  b.hipRoll = -(0.05 + 0.05 * g.heavy + 0.06 * g.limp) * Math.cos(w) * move;
  b.hipYaw = g.hipTwist * Math.sin(w) * move;

  // Spine: forward lean + inertial bob after each footfall + counter-twist.
  const leanBase = g.lean + 0.15 * fast + 0.05 * move - 0.05 * g.fresh * move;
  b.spinePitch = leanBase + (0.035 + 0.03 * g.heavy) * Math.sin(2 * w - 0.7) * move;
  b.spineYaw = -0.65 * b.hipYaw;
  b.spineRoll = (0.07 + 0.08 * g.heavy) * Math.cos(w - 0.45) * move + g.shoulderTilt * 1.6;

  // Head hangs, bobs late, tilts.
  b.neckPitch = g.headDroop - 0.3 * b.spinePitch + 0.06 * Math.sin(2 * w - 1.3) * move;
  b.neckRoll = g.headTilt + 0.06 * Math.sin(w - 0.9) * move;
  b.jaw = g.jawSlack + Math.max(0, 0.06 * Math.sin(tc * 0.83 + p.seed));
  b.shrugL = Math.max(0, g.shoulderTilt) + 0.012 * Math.sin(2 * w) * move;
  b.shrugR = Math.max(0, -g.shoulderTilt) + 0.012 * Math.sin(2 * w + 1) * move;

  // Arms: asymmetric reach, swing opposite to the same-side leg with lag; forearms lag further.
  const swing = g.armSwing * (1 + 0.6 * fast) * move;
  b.armLPitch = g.armReachL + swing * Math.sin(pL - 0.55) - 0.25 * fast;
  b.armRPitch = g.armReachR + swing * Math.sin(pR - 0.55) - 0.25 * fast;
  b.armLRoll = g.armOut + 0.05 * Math.cos(w) * move + 0.22 * fast;
  b.armRRoll = -g.armOut + 0.05 * Math.cos(w) * move - 0.22 * fast;
  b.elbowL = g.elbowL + 0.22 * Math.sin(pL - 1.1) * move;
  b.elbowR = g.elbowR + 0.22 * Math.sin(pR - 1.1) * move;
  // Fast stagger: arms flail loosely.
  if (fast > 0) {
    b.armLPitch += 0.25 * fast * Math.sin(tc * 6.3 + 1.2);
    b.armRPitch += 0.25 * fast * Math.sin(tc * 5.7 + 2.9);
  }

  // Idle stance: breathing, slow weight shifts, dangling arm pendulum, uneven knees.
  if (idle > 0) {
    const breath = Math.sin(tc * 1.55 + p.seed);
    const shift = Math.sin(tc * 0.42 + p.seed * 0.3);
    b.spinePitch += idle * (0.03 * breath + 0.05 * g.heavy);
    b.shrugL += idle * 0.01 * breath;
    b.shrugR += idle * 0.01 * breath;
    b.hipX += idle * 0.03 * shift;
    b.hipRoll += idle * 0.03 * shift;
    b.spineRoll += idle * 0.045 * Math.sin(tc * 0.33 + p.seed);
    b.kneeL += idle * (0.06 + 0.1 * Math.max(0, -shift));
    b.kneeR += idle * (0.06 + 0.1 * Math.max(0, shift));
    b.thighLPitch += idle * -0.04 * Math.max(0, -shift);
    b.thighRPitch += idle * -0.04 * Math.max(0, shift);
    b.armLPitch += idle * 0.07 * Math.sin(tc * 1.1 + 0.4);
    b.armRPitch += idle * 0.07 * Math.sin(tc * 0.95 + 2.1);
    b.neckYaw += idle * 0.28 * Math.sin(tc * 0.27 + p.seed);
    b.ankleL = mix(b.ankleL, -(b.hipPitch + b.thighLPitch + b.kneeL), idle);
    b.ankleR = mix(b.ankleR, -(b.hipPitch + b.thighRPitch + b.kneeR), idle);
  }

  // Stiff arm overrides its side.
  if (g.stiffArm !== 0) {
    const left = g.stiffArm === 1;
    let pitch: number;
    let roll: number;
    let elbow: number;
    if (g.stiffMode === 'forward') { pitch = -1.45 + 0.03 * Math.sin(tc * 2.3); roll = left ? 0.06 : -0.06; elbow = 0.04; }
    else if (g.stiffMode === 'bent') { pitch = -0.35; roll = left ? -0.32 : 0.32; elbow = 1.95; }
    else { pitch = 0.14 + 0.12 * Math.sin((left ? pL : pR) - 1.6) * move; roll = left ? 0.12 : -0.12; elbow = 0.08; }
    if (left) { b.armLPitch = pitch; b.armLRoll = roll; b.elbowL = elbow; b.shrugL += 0.03; }
    else { b.armRPitch = pitch; b.armRRoll = roll; b.elbowR = elbow; b.shrugR += 0.03; }
  }

  // Horde attack posture: arms come up, torso leans in, faster clawing hands.
  s.aggro += ((inp.engaged && active ? 1 : 0) - s.aggro) * (1 - Math.exp(-3.5 * dt));
  if (s.aggro > 0.001) {
    const a = s.aggro;
    b.spinePitch += 0.09 * a;
    b.neckPitch -= 0.12 * a;
    b.jaw += 0.18 * a * (0.6 + 0.4 * Math.sin(tc * 5.1));
    if (g.stiffArm !== 1) {
      b.armLPitch = mix(b.armLPitch, -1.4 + 0.12 * Math.sin(tc * 6.8), 0.7 * a);
      b.elbowL = mix(b.elbowL, 0.35 + 0.25 * Math.sin(tc * 7.4), 0.7 * a);
    }
    if (g.stiffArm !== -1) {
      b.armRPitch = mix(b.armRPitch, -1.3 + 0.12 * Math.sin(tc * 6.1 + 1), 0.7 * a);
      b.elbowR = mix(b.elbowR, 0.35 + 0.25 * Math.sin(tc * 6.9 + 2), 0.7 * a);
    }
  }

  // Mode flavour: ambient walkers are droopier; followers keep a loose eye on the leader.
  if (inp.mode === 'ambient') {
    b.neckPitch += 0.08;
    b.spinePitch += 0.03;
  }

  // Alpha swagger: chest out, a cockier pelvis roll — upright where the horde slouches.
  if (p.bodyShape === 'alpha') {
    b.spinePitch -= 0.06;
    b.neckPitch -= 0.05;
    b.hipYaw *= 1.3;
    b.hipRoll *= 1.25;
    b.hipX *= 1.2;
    b.shrugL += 0.012;
    b.shrugR += 0.012;
  }

  copyPose(b, out);

  // --- 2. Secondary motion (springs) ------------------------------------------
  if (dt > 0) {
    const leanTarget = clamp(-s.accel * T.inertiaLean * (1 + 0.6 * g.heavy), -0.22, 0.3);
    s.lean = springStep(s.lean, s.leanV, leanTarget, T.leanSpring.k * (1 - 0.3 * g.heavy), T.leanSpring.zeta, dt);
    s.leanV = springV;
    const turnLean = clamp(s.turn * s.speed * 0.012, -0.14, 0.14);
    s.roll = springStep(s.roll, s.rollV, -turnLean, T.rollSpring.k, T.rollSpring.zeta, dt);
    s.rollV = springV;
    const torsoTarget = clamp(-s.turn * T.torsoTurnLag, -0.45, 0.45);
    s.torsoYaw = springStep(s.torsoYaw, s.torsoYawV, torsoTarget, T.torsoYawSpring.k, T.torsoYawSpring.zeta, dt);
    s.torsoYawV = springV;
    let look = 0;
    if (!Number.isNaN(inp.lookYaw) && active) {
      look = clamp(inp.lookYaw, -1.0, 1.0) * (inp.engaged ? 0.6 : 0.25 + 0.45 * idle);
    }
    const headTarget = clamp(-s.turn * T.headTurnLag, -0.7, 0.7) + look;
    s.headYaw = springStep(s.headYaw, s.headYawV, headTarget, T.headYawSpring.k, T.headYawSpring.zeta, dt);
    s.headYawV = springV;
    s.headPitch = springStep(s.headPitch, s.headPitchV, -s.lean * 0.6, T.headPitchSpring.k, T.headPitchSpring.zeta, dt);
    s.headPitchV = springV;
  }
  out.spinePitch += s.lean;
  out.hipPitch += s.lean * 0.25;
  out.spineRoll += s.roll;
  out.hipRoll += s.roll * 0.4;
  out.spineYaw += s.torsoYaw;
  out.neckYaw += s.headYaw - s.torsoYaw * 0.3;
  out.neckPitch += s.headPitch;
  // Hit reaction: arms fling, head snaps (spring impulses above carry the body).
  if (s.hitAge < 0.45 && active) {
    const e = envelope(s.hitAge, 0.45, 0.06);
    out.armLRoll += 0.45 * e;
    out.armRRoll -= 0.45 * e;
    out.armLPitch = mix(out.armLPitch, -0.6, 0.4 * e);
    out.armRPitch = mix(out.armRPitch, -0.55, 0.4 * e);
    out.jaw += 0.2 * e;
  }
  // Keep the legs' absolute angles when the pelvis tilts (inertial lean, hits, clips): planted feet stay planted.
  const dHip = out.hipPitch - b.hipPitch;
  out.thighLPitch -= dHip;
  out.thighRPitch -= dHip;

  // --- 3. Personality: lurches & twitches ------------------------------------
  if (active && !climbing) {
    // Lurch / stumble while walking.
    if (s.lurchT >= 0) {
      s.lurchT += dt;
      if (s.lurchT >= s.lurchDur) { s.lurchT = -1; scheduleLurch(s, g); }
    } else if (move > 0.5 && detail < 2) {
      s.lurchNext -= dt;
      if (s.lurchNext <= 0) {
        s.lurchT = 0;
        s.lurchDur = T.lurchDuration * (0.85 + 0.3 * rand(s));
        s.lurchStumble = rand(s) < g.stumble;
        s.lurchAmp = (s.lurchStumble ? 0.26 : 0.15) + 0.08 * rand(s);
        s.lurchSide = rand(s) < 0.5 ? -1 : 1;
        s.lurchCount++;
      }
    }
    if (lurchEnv > 0) {
      const e = lurchEnv * s.lurchAmp * Math.max(move, 0.3);
      out.spinePitch += e;
      out.neckPitch -= e * 0.7; // head lags the lurch, then catches up
      out.armLPitch -= e * 1.1;
      out.armRPitch -= e * 0.9;
      out.hipZ += e * 0.2;
      if (s.lurchStumble) {
        out.spineRoll += s.lurchSide * e * 0.8;
        out.hipX += s.lurchSide * e * 0.18;
        out.armLRoll += e * 1.2;
        out.armRRoll -= e * 1.2;
      }
    }

    // Twitches (also while walking, smaller).
    if (s.twitchKind >= 0) {
      s.twitchT += dt;
      if (s.twitchT >= s.twitchDur) { s.twitchKind = -1; scheduleTwitch(s, g); }
    } else if (detail < 2) {
      s.twitchNext -= dt * (move > 0.5 ? 0.6 : 1);
      if (s.twitchNext <= 0) {
        s.twitchKind = Math.floor(rand(s) * 8) % 8;
        s.twitchT = 0;
        s.twitchSign = rand(s) < 0.5 ? -1 : 1;
        s.twitchDur = TWITCH_DURATIONS[s.twitchKind] * (0.8 + 0.4 * rand(s));
        s.twitchCount++;
      }
    }
    if (s.twitchKind >= 0) {
      const k = s.twitchKind;
      const sg = s.twitchSign;
      const mag = 1 - 0.55 * move;
      const t = s.twitchT;
      const jerk = Math.sin(t * 28) * Math.exp(-t * 9); // damped tremor after the jolt
      switch (k) {
        case 0: { // head twitch
          const e = envelope(t, s.twitchDur, 0.07) * mag;
          out.neckYaw += sg * (0.42 * e + 0.08 * jerk);
          out.neckRoll += sg * 0.2 * e;
          break;
        }
        case 1: { // jaw opens and hangs
          const e = envelope(t, s.twitchDur, 0.3) * mag;
          out.jaw += 0.5 * e + 0.05 * jerk;
          out.neckPitch -= 0.12 * e;
          break;
        }
        case 2: { // shoulder spasm
          const e = envelope(t, s.twitchDur, 0.06) * mag;
          if (sg > 0) { out.shrugL += 0.06 * e; out.armLRoll += 0.35 * e + 0.1 * jerk; }
          else { out.shrugR += 0.06 * e; out.armRRoll -= 0.35 * e + 0.1 * jerk; }
          out.spineRoll += -sg * 0.08 * e;
          break;
        }
        case 3: { // unsteady weight shift
          const e = envelope(t, s.twitchDur, 0.7) * mag;
          out.hipX += sg * 0.06 * e;
          out.hipRoll += sg * 0.05 * e;
          if (sg > 0) out.kneeR += 0.22 * e; else out.kneeL += 0.22 * e;
          break;
        }
        case 4: { // brief forward slump
          const e = envelope(t, s.twitchDur, 0.35) * mag;
          out.spinePitch += 0.24 * e;
          out.neckPitch += 0.32 * e;
          out.armLPitch = mix(out.armLPitch, 0.05, 0.5 * e);
          out.armRPitch = mix(out.armRPitch, 0.05, 0.5 * e);
          out.kneeL += 0.12 * e;
          out.kneeR += 0.12 * e;
          break;
        }
        case 5: { // arm twitch
          const e = envelope(t, s.twitchDur, 0.05) * mag;
          if (sg > 0) { out.armLPitch -= 0.55 * e; out.elbowL += 0.4 * e + 0.15 * jerk; }
          else { out.armRPitch -= 0.55 * e; out.elbowR += 0.4 * e + 0.15 * jerk; }
          break;
        }
        case 6: { // slow head roll
          const e = envelope(t, s.twitchDur, 1.0) * mag;
          out.neckRoll += sg * 0.42 * e;
          out.neckYaw += sg * 0.3 * e;
          break;
        }
        case 7: { // backward sway, then a forward catch
          const u = t / s.twitchDur;
          const back = u < 0.55 ? Math.sin((u / 0.55) * Math.PI) : 0;
          const catchUp = u >= 0.45 ? Math.sin(clamp01((u - 0.45) / 0.55) * Math.PI) : 0;
          out.spinePitch += (-0.17 * back + 0.1 * catchUp) * mag;
          out.hipZ += (-0.03 * back + 0.02 * catchUp) * mag;
          out.armLRoll += 0.2 * back * mag;
          out.armRRoll -= 0.2 * back * mag;
          break;
        }
      }
    }
  }

  // --- 3b. Clip overlays (characterClips): additive flourishes on top of locomotion / IK ----------
  if (s.wasRising && !rising && !dead) { s.flourishT = 0; s.flourishVar = playVar(s); }
  s.wasRising = rising;
  s.turnCool -= dt;
  s.lungeCool -= dt;
  const clipsOn = active && !climbing;

  // Celebrate (input-driven, loops while the trigger clock runs, fades in / out smoothly).
  const celOn = clipsOn && inp.celebrate !== undefined && inp.celebrate >= 0;
  if (celOn) s.celT = inp.celebrate as number; else s.celT += dt;
  s.celW += ((celOn ? 1 : 0) - s.celW) * (1 - Math.exp(-T.celebrateRate * dt));
  if (s.celW > 0.001 && clipsOn) {
    const gain = p.bodyShape === 'alpha' ? T.alphaCelebrateGain : 1;
    applyClip(out, CLIPS.celebrate, s.celT, easeInOut(s.celW) * gain, s.clipVar);
  }

  // Idle look-around after a long stand-still.
  if (s.idleLookT >= 0) {
    s.idleLookT += dt;
    if (!clipsOn || s.idleLookT >= clipDuration('idleLook', s.idleLookVar)) {
      s.idleLookT = -1;
      s.idleT = 0;
      s.idleLookCount++;
      s.idleLookNext = T.idleLookMin + T.idleLookSpread * unitHash(p.seed, 120 + s.idleLookCount);
    }
  } else if (clipsOn && idle > 0.95 && !inp.engaged && detail < 2 && s.hitClipT < 0 && s.turnClipT < 0) {
    s.idleT += dt;
    if (s.idleT >= s.idleLookNext) { s.idleLookT = 0; s.idleLookVar = playVar(s); }
  } else {
    s.idleT = 0;
  }
  if (s.idleLookT >= 0) applyClip(out, CLIPS.idleLook, s.idleLookT, 1, s.idleLookVar);

  // Turn on the spot: the head leads, then chest, then hips.
  if (s.turnClipT >= 0) {
    s.turnClipT += dt;
    if (!clipsOn || s.turnClipT >= clipDuration('turnL', s.turnClipVar)) { s.turnClipT = -1; s.turnCool = T.turnClipCooldown; }
  } else if (clipsOn && detail < 2 && s.turnCool <= 0 && s.speed < T.turnClipMaxSpeed && Math.abs(s.turn) > T.turnClipRate) {
    s.turnClipT = 0;
    s.turnClipDir = s.turn > 0 ? 1 : -1;
    s.turnClipVar = playVar(s);
  }
  if (s.turnClipT >= 0) applyClip(out, s.turnClipDir > 0 ? CLIPS.turnL : CLIPS.turnR, s.turnClipT, 1, s.turnClipVar);

  // Hit stagger (direction-signed).
  if (s.hitClipT >= 0) {
    s.hitClipT += dt;
    if (!clipsOn || s.hitClipT >= clipDuration('hitReact', s.hitClipVar)) s.hitClipT = -1;
    else applyClip(out, CLIPS.hitReact, s.hitClipT, 1 - 0.3 * g.heavy, s.hitClipVar, s.hitClipSign < 0);
  }

  // Lunge: a charging, freshly engaged zombie winds its arms back and throws them forward.
  if (s.lungeT >= 0) {
    s.lungeT += dt;
    if (!clipsOn || s.lungeT >= clipDuration('lunge', s.lungeVar)) { s.lungeT = -1; s.lungeCool = T.lungeCooldown; }
  } else if (clipsOn && detail < 2 && inp.engaged && inp.attackPhase === 'none' && s.speed > T.lungeMinSpeed && s.lungeCool <= 0 && s.aggro < 0.5) {
    s.lungeT = 0;
    s.lungeVar = playVar(s);
  }
  if (s.lungeT >= 0) {
    const d = clipDuration('lunge', s.lungeVar);
    applyClip(out, CLIPS.lunge, s.lungeT, easeInOut(clamp01(s.lungeT / 0.12)) * (1 - easeInOut(clamp01((s.lungeT - (d - 0.2)) / 0.2))), s.lungeVar);
  }

  // Rise flourish: shake it off once back on its feet.
  if (s.flourishT >= 0) {
    s.flourishT += dt;
    const d = clipDuration('riseFlourish', s.flourishVar);
    if (!clipsOn || s.flourishT >= d) s.flourishT = -1;
    else applyClip(out, CLIPS.riseFlourish, s.flourishT, easeInOut(clamp01(s.flourishT / 0.12)) * (1 - easeInOut(clamp01((s.flourishT - (d - 0.25)) / 0.25))), s.flourishVar);
  }

  // --- 4. Overlays -----------------------------------------------------------
  // Attack.
  let phase: 0 | 1 | 2 = 0;
  let at = 0;
  let style = s.atkStyleShown;
  if (active && !climbing) {
    if (inp.attackPhase !== 'none') {
      phase = inp.attackPhase === 'windup' ? 1 : 2;
      at = clamp01(inp.attackT);
      style = inp.attackStyle >= 0 ? inp.attackStyle : s.nextStyle;
    } else {
      const windup = Math.min(T.windupMax, s.cdTotal * T.windupFrac);
      const recovery = Math.min(T.recoveryMax, s.cdTotal * T.recoveryFrac);
      if (inp.anim === 'attack' && inp.animTime < recovery) {
        phase = 2;
        at = inp.animTime / recovery;
        style = s.curStyle;
      } else if (inp.engaged && inp.cooldown > 1e-4 && inp.cooldown < windup) {
        phase = 1;
        at = 1 - inp.cooldown / windup;
        style = s.nextStyle;
      }
    }
  }
  if (phase !== 0) {
    s.atkPhase = phase;
    s.atkT = at;
    s.atkStyleShown = style;
    s.atkW = 1;
  } else if (s.atkW > 0) {
    // Interrupted (target died / out of reach): fade out of the last shown key instead of snapping.
    s.atkW = Math.max(0, s.atkW - dt * T.attackFade);
  }
  if (s.atkW > 0 && s.atkPhase !== 0) {
    applyAttackPose(out, s.atkStyleShown, s.atkPhase, s.atkT, easeInOut(s.atkW));
    if (s.atkStyleShown === ATTACK_STYLE.bite) {
      // Time-warped so the jaw snap (BITE_SNAP_T) lands exactly at the strike key (windup end = gameplay hit).
      const u = s.atkPhase === 1 ? s.atkT * BITE_SNAP_T : BITE_SNAP_T + s.atkT * (CLIPS.bite.duration - BITE_SNAP_T);
      applyClipAuthored(out, CLIPS.bite, u, easeInOut(s.atkW), s.clipVar);
      if (out.jaw < 0) out.jaw = 0;
    }
  }

  // Stun (Alpha hit stun): unsteady, arms out, knees soft.
  s.stun += ((active ? inp.stun : 0) - s.stun) * (1 - Math.exp(-T.stunSmoothing * dt));
  if (s.stun > 0.001) {
    const f = s.stun;
    const wob = Math.sin(tc * 9.5);
    out.spinePitch += -0.32 * f;
    out.neckPitch += -0.3 * f + 0.1 * f * Math.sin(tc * 13);
    out.spineRoll += 0.14 * f * wob;
    out.hipX += 0.04 * f * wob;
    out.armLPitch = mix(out.armLPitch, -0.4, f);
    out.armRPitch = mix(out.armRPitch, -0.35, f);
    out.armLRoll = mix(out.armLRoll, 0.85, f);
    out.armRRoll = mix(out.armRRoll, -0.85, f);
    out.kneeL += 0.25 * f;
    out.kneeR += 0.2 * f;
    out.hipZ += -0.08 * f;
  }

  // Climb (watchtower): alternating overhead reaches, knees pulling up.
  s.climbW += ((climbing ? 1 : 0) - s.climbW) * (1 - Math.exp(-10 * dt));
  if (s.climbW > 0.001) {
    const c = tc * 7.5 + p.seed;
    const sn = Math.sin(c);
    const cw = s.climbW;
    out.spinePitch = mix(out.spinePitch, -0.1, cw);
    out.neckPitch = mix(out.neckPitch, -0.4, cw);
    out.armLPitch = mix(out.armLPitch, -2.6 + sn * 0.45, cw);
    out.armRPitch = mix(out.armRPitch, -2.6 - sn * 0.45, cw);
    out.elbowL = mix(out.elbowL, 0.5 + 0.3 * sn, cw);
    out.elbowR = mix(out.elbowR, 0.5 - 0.3 * sn, cw);
    out.thighLPitch = mix(out.thighLPitch, -0.7 - sn * 0.45, cw);
    out.thighRPitch = mix(out.thighRPitch, -0.7 + sn * 0.45, cw);
    out.kneeL = mix(out.kneeL, 1.1 + 0.3 * sn, cw);
    out.kneeR = mix(out.kneeR, 1.1 - 0.3 * sn, cw);
  }

  // Death (3 styles) and rise.
  if (dead) applyDeath(out, p, inp.deadTime, s);
  else s.deathW = 0;
  if (rising) {
    if (inp.emerge) applyEmerge(out, p, clamp01(inp.riseT), tc);
    else applyRise(out, p, clamp01(inp.riseT), tc);
  }
  if (inp.dive >= 0 && !dead) applyDive(out, clamp01(inp.dive));

  // --- 5. Grounding ------------------------------------------------------------
  // Celebrate hops lift the pelvis above the grounded height (the only intentional foot lift).
  const hop = dead || rising ? 0 : Math.max(0, out.hipY - RIG.hipY);
  out.hipY = groundedHipY(out) + hop;

  s.stateName = dead ? 'dead'
    : rising ? 'rise'
    : climbing ? 'climb'
    : s.stun > 0.3 ? 'stunned'
    : s.celW > 0.3 ? 'celebrate'
    : phase !== 0 ? (style === ATTACK_STYLE.bite ? 'bite' : 'attack')
    : s.hitAge < 0.35 ? 'hit'
    : s.turnClipT >= 0 || Math.abs(s.turn) > 2.2 ? 'turn'
    : fast > 0.5 ? 'fastWalk'
    : move > 0.5 ? 'walk'
    : 'idle';
  return out;
}

/**
 * Death: knees buckle, the body topples with gravity (ease-in), bounces once, limbs settle.
 * Style 0 forward crumple, 1 twisting side fall, 2 backward collapse. Blends in from the live pose.
 */
function applyDeath(out: ZombiePose, p: ZombieProfile, t: number, s: ZombieAnimState): void {
  const style = p.deathStyle;
  const w = s.deathW >= 1 ? 1 : smoothstep(0, 0.3, t);
  s.deathW = Math.max(s.deathW, w);
  const W = s.deathW;
  const fall = ANIM_TUNING.deathFall;
  const buckle = easeOut(clamp01(t / 0.3));
  const topple = easeIn(clamp01((t - 0.16) / fall)); // accelerating, like gravity
  const bounceT = (t - 0.16 - fall) / 0.28;
  const bounce = bounceT > 0 && bounceT < 1 ? Math.sin(bounceT * Math.PI) * (1 - bounceT) : 0;
  const settled = clamp01((t - 0.16 - fall) / 0.5);
  const sideSign = p.seed & 1 ? 1 : -1;

  const set = (f: PoseField, v: number): void => { out[f] = mix(out[f], v, W); };

  // Legs fold first, then straighten out as the body lands.
  const kneeFold = 1.1 * buckle * (1 - 0.65 * settled);
  set('kneeL', kneeFold + 0.15);
  set('kneeR', kneeFold * 0.8 + 0.25);
  set('thighLPitch', -0.55 * buckle * (1 - 0.6 * settled));
  set('thighRPitch', -0.3 * buckle * (1 - 0.5 * settled));
  set('thighLRoll', 0.08 + 0.12 * settled);
  set('thighRRoll', -0.06 - 0.1 * settled);
  set('ankleL', 0.4 * settled);
  set('ankleR', 0.3 * settled);
  set('hipX', 0);
  set('hipZ', 0);
  set('jaw', 0.35 * settled);
  set('shrugL', 0);
  set('shrugR', 0);

  if (style === 0) {
    set('rootPitch', 1.42 * topple - 0.07 * bounce);
    set('rootRoll', 0.12 * sideSign * topple);
    set('spinePitch', 0.35 * buckle * (1 - 0.7 * settled));
    set('spineYaw', 0.1 * sideSign);
    set('spineRoll', 0);
    set('neckPitch', -0.3 * settled);
    set('neckYaw', 0.8 * sideSign * settled);
    set('neckRoll', 0);
    set('armLPitch', mix(-1.2, -2.7, topple));
    set('armRPitch', mix(-1.0, -0.4, topple));
    set('armLRoll', 0.5 * topple);
    set('armRRoll', -0.25);
    set('elbowL', 0.4);
    set('elbowR', 1.2 * settled);
  } else if (style === 1) {
    set('rootPitch', 0.35 * topple);
    set('rootRoll', 1.38 * sideSign * topple - 0.06 * sideSign * bounce);
    set('spinePitch', 0.2 * buckle);
    set('spineYaw', 0.55 * sideSign * buckle);
    set('spineRoll', -0.2 * sideSign * topple);
    set('neckPitch', 0.1);
    set('neckYaw', -0.4 * sideSign * settled);
    set('neckRoll', 0.35 * sideSign * settled);
    set('armLPitch', mix(-0.8, sideSign > 0 ? -2.2 : 0.2, topple));
    set('armRPitch', mix(-0.7, sideSign > 0 ? 0.25 : -2.1, topple));
    set('armLRoll', 0.9 * topple);
    set('armRRoll', -0.9 * topple);
    set('elbowL', 0.7);
    set('elbowR', 0.5);
  } else {
    set('rootPitch', -1.38 * topple + 0.07 * bounce);
    set('rootRoll', -0.1 * sideSign * topple);
    set('spinePitch', -0.15 * buckle + 0.15 * settled);
    set('spineYaw', -0.15 * sideSign);
    set('spineRoll', 0.05);
    set('neckPitch', -0.45 * topple + 0.2 * settled);
    set('neckYaw', 0.6 * sideSign * settled);
    set('neckRoll', 0);
    set('armLPitch', mix(-0.9, -1.9, topple));
    set('armRPitch', mix(-0.8, -1.7, topple));
    set('armLRoll', 1.3 * topple);
    set('armRRoll', -1.3 * topple);
    set('elbowL', 0.3);
    set('elbowR', 0.6);
  }
  // Lying bodies rest on their front/back, not on the pivot line.
  const lying = Math.abs(Math.sin(out.rootPitch)) + Math.abs(Math.sin(out.rootRoll)) * 0.9;
  out.rootY = mix(out.rootY, 0.13 * Math.min(1, lying), W);
}

/**
 * Nest-teleport dive: crouch, spring up with both arms thrown overhead, tip head first and plunge into the hole
 * until the whole body is below the ground (EMERGE_BURIED_Y). Starts from the current pose, ends fully buried.
 */
function applyDive(out: ZombiePose, u: number): void {
  const crouch = smoothstep(0, 0.22, u) * (1 - smoothstep(0.22, 0.36, u));
  const reach = smoothstep(0.18, 0.42, u); // arms swing up overhead
  const tip = smoothstep(0.34, 0.7, u); // body pitches head down
  const W = smoothstep(0, 0.12, u); // blend in from the run
  const air = Math.sin(Math.PI * smoothstep(0.22, 0.62, u)) * (1 - smoothstep(0.5, 0.62, u));
  const plunge = smoothstep(0.52, 1, u);
  const depth = -0.3 * crouch + 0.75 * air + (EMERGE_BURIED_Y - 0.4) * plunge * plunge;
  const set = (f: PoseField, v: number): void => { out[f] = mix(out[f], v, W); };
  out.rootY = mix(out.rootY, depth, W);
  set('rootPitch', 1.35 * tip);
  set('rootRoll', 0);
  set('spinePitch', 0.35 * crouch + 0.25 * tip);
  set('neckPitch', -0.3 * reach);
  set('armRPitch', mix(0.5 * crouch, -3.05, reach));
  set('armLPitch', mix(0.5 * crouch, -3.0, reach));
  set('armRRoll', -0.12 * reach);
  set('armLRoll', 0.12 * reach);
  set('elbowR', 0.15);
  set('elbowL', 0.15);
  set('thighLPitch', -0.9 * crouch + 0.35 * tip);
  set('thighRPitch', -0.9 * crouch + 0.3 * tip);
  set('kneeL', 1.5 * crouch + 0.2 * tip);
  set('kneeR', 1.5 * crouch + 0.25 * tip);
  set('jaw', 0.5 * reach);
}

/** Root depth (rig units) of a fully buried body: the raised hand's fingertips are just below the ground. */
export const EMERGE_BURIED_Y = -2.15;

/**
 * Emerge (Alpha at a nest): buried → one claw bursts up through the soil, the second follows, the head and
 * shoulders push out, both hands plant on the ground and haul the body up, one knee hooks over the rim and it
 * staggers upright. The rig root sinks below Y = 0 (the ground hides what is still buried). Ends at zero offsets.
 */
function applyEmerge(out: ZombiePose, p: ZombieProfile, u: number, tc: number): void {
  const jerk = Math.sin(tc * 21 + p.seed) * (1 - smoothstep(0.7, 0.95, u));
  const reachR = smoothstep(0.08, 0.24, u); // first claw punches up
  const reachL = smoothstep(0.2, 0.36, u); // second claw follows
  const plant = smoothstep(0.38, 0.52, u) * (1 - smoothstep(0.7, 0.86, u)); // hands on the rim, haul
  const step = smoothstep(0.58, 0.72, u) * (1 - smoothstep(0.78, 0.92, u)); // knee hooks over the rim
  const stand = smoothstep(0.78, 0.98, u);
  const wobble = Math.sin(tc * 7 + p.seed) * stand * (1 - stand) * 4;
  const W = 1 - smoothstep(0.93, 1, u);
  // Depth: hidden → hand out (-1.75) → head + shoulders (-0.95) → hips at the rim (-0.3) → on the ground.
  const depth = EMERGE_BURIED_Y
    + (EMERGE_BURIED_Y * -1 - 1.75) * smoothstep(0.04, 0.24, u)
    + 0.8 * smoothstep(0.26, 0.48, u)
    + 0.65 * smoothstep(0.5, 0.74, u)
    + 0.3 * smoothstep(0.74, 0.9, u);

  const set = (f: PoseField, v: number): void => { out[f] = mix(out[f], v, W); };
  out.rootY = mix(out.rootY, depth, W); // depth reaches 0 at the end, so the blend never pops
  set('rootPitch', 0.06 * jerk * (1 - stand) + 0.32 * plant + 0.12 * step);
  set('rootRoll', 0.05 * jerk + 0.06 * wobble);
  // Arms: straight up (≈ -3) while clawing through, then forward-down onto the rim, then back to the stance.
  const upR = mix(-0.4, -3.0, reachR), upL = mix(-0.4, -2.85, reachL);
  set('armRPitch', mix(mix(upR, -1.35, plant), out.armRPitch, stand) + 0.22 * jerk);
  set('armLPitch', mix(mix(upL, -1.45, plant), out.armLPitch, stand) - 0.22 * jerk);
  set('armRRoll', mix(out.armRRoll - 0.15 * reachR, -0.35, plant));
  set('armLRoll', mix(out.armLRoll + 0.15 * reachL, 0.35, plant));
  set('elbowR', mix(mix(0.15 + 0.35 * Math.max(0, jerk), 0.9, plant), out.elbowR, stand));
  set('elbowL', mix(mix(0.2 + 0.35 * Math.max(0, -jerk), 0.95, plant), out.elbowL, stand));
  // Torso strains forward over the rim while hauling, head tips back at the sky as it breaks the surface.
  set('spinePitch', out.spinePitch + 0.55 * plant + 0.25 * step + 0.1 * jerk + 0.15 * wobble);
  set('spineRoll', out.spineRoll + 0.1 * jerk + 0.08 * wobble);
  set('neckPitch', out.neckPitch - 0.45 * (reachL - plant) * (1 - stand) + 0.15 * jerk);
  set('neckYaw', out.neckYaw + 0.3 * jerk);
  // Legs: one knee hooks up over the edge, the other pushes from below.
  set('thighLPitch', -1.35 * step - 0.25 * plant);
  set('thighRPitch', 0.25 * step + 0.1 * plant);
  set('kneeL', 1.85 * step + 0.4 * plant + 0.1);
  set('kneeR', 0.45 * step + 0.3 * plant + 0.1);
  set('ankleL', 0.35 * step);
  set('jaw', out.jaw + 0.45 * (1 - stand));
}

/**
 * Rise (conversion / respawn): twitching on the ground, push up onto the knees, stagger upright with a wobble.
 * Ends at (almost) zero offsets so it hands over to the idle stance without a pop.
 */
function applyRise(out: ZombiePose, p: ZombieProfile, u: number, tc: number): void {
  const jerk = Math.sin(tc * 23 + p.seed) * (1 - smoothstep(0.55, 0.9, u));
  const ground = 1 - smoothstep(0.22, 0.62, u); // lying → kneeling
  const kneel = smoothstep(0.22, 0.6, u) * (1 - smoothstep(0.62, 0.95, u));
  const stand = smoothstep(0.62, 0.98, u);
  const wobble = Math.sin(tc * 7.5 + p.seed) * stand * (1 - stand) * 4;
  const W = 1 - smoothstep(0.92, 1, u);

  const set = (f: PoseField, v: number): void => { out[f] = mix(out[f], v, W); };
  set('rootPitch', 1.42 * ground + 0.1 * jerk * ground);
  set('rootRoll', 0.12 * ground + 0.05 * jerk);
  set('rootY', 0.13 * ground);
  set('thighLPitch', -1.15 * kneel - 0.3 * ground);
  set('thighRPitch', -0.2 * kneel - 0.2 * ground);
  set('kneeL', 1.7 * kneel + 0.5 * ground + 0.15);
  set('kneeR', 1.9 * kneel + 0.4 * ground + 0.15);
  set('ankleL', 0.2 * kneel);
  set('ankleR', 0.9 * kneel);
  set('spinePitch', out.spinePitch + 0.45 * kneel + 0.12 * jerk + 0.18 * wobble);
  set('spineRoll', out.spineRoll + 0.12 * jerk + 0.08 * wobble);
  set('neckPitch', out.neckPitch - 0.35 * ground + 0.2 * kneel + 0.15 * jerk);
  set('neckYaw', out.neckYaw + 0.35 * jerk);
  set('armLPitch', mix(mix(-2.6, -0.35, kneel), out.armLPitch, stand) + 0.25 * jerk);
  set('armRPitch', mix(mix(-0.5, -0.2, kneel), out.armRPitch, stand) - 0.25 * jerk);
  set('armLRoll', out.armLRoll + 0.3 * kneel);
  set('armRRoll', out.armRRoll - 0.3 * kneel);
  set('elbowL', mix(0.5, out.elbowL, stand));
  set('elbowR', mix(0.3, out.elbowR, stand));
  set('jaw', out.jaw + 0.35 * (1 - stand));
}
