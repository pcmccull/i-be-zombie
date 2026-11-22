/**
 * [pure] Authored pose clips (VP2-T008). Keyframe data sampled into `ZombiePose` overlays by
 * `visuals/zombieAnimation.ts` (the only motion source) and, later, converted to THREE.AnimationClips for the Alpha.
 *
 * Conventions (see visuals/zombieRig.ts): arm pitch < 0 reaches forward / up, spine + neck pitch > 0 tips forward,
 * yaw > 0 turns toward the character's left (+X), jaw > 0 opens, hipY / hipZ are metre-ish rig units.
 *
 * - Additive clips store DELTAS: they add `weight * delta` and are implicitly 0 at t = 0 and t = duration for every
 *   field they do not key there (so a one-shot starts and ends on the base pose without a pop).
 * - Non-additive clips store ABSOLUTE targets for the fields they key; the pose blends toward them by `weight`
 *   (fields never keyed are left alone; a field missing from some keys holds its nearest keyed value).
 * - Loop clips wrap `t`; author the first and last key of every field identically (or leave both implicit = 0).
 * - `variation` in [0, 1) is per-zombie / per-play: timing ±12 %, amplitude ±15 %, and a left/right asymmetry.
 */
import { POSE_FIELDS, type PoseField, type ZombiePose } from '../../visuals/zombieRig';
import { CLIP_NAMES, type ClipName } from './characterTypes';

export type ClipEase = 'linear' | 'smooth' | 'back';

export interface PoseClipKey {
  /** Authored time, seconds (0..duration). */
  t: number;
  pose: Partial<ZombiePose>;
  /** Easing of the segment that STARTS at this key (default 'smooth'). */
  ease?: ClipEase;
}

export interface PoseClip {
  name: ClipName;
  duration: number;
  loop: boolean;
  additive: boolean;
  keys: readonly PoseClipKey[];
}

/** Time (authored seconds) at which the jaw snaps shut inside the `bite` clip: lines up with the gameplay strike. */
export const BITE_SNAP_T = 0.3;

const k = (t: number, pose: Partial<ZombiePose>, ease?: ClipEase): PoseClipKey => ({ t, pose, ease });

// ---------------------------------------------------------------------------
// Mirroring (left <-> right)
// ---------------------------------------------------------------------------

const MIRROR_PAIRS: readonly [PoseField, PoseField, 1 | -1][] = [
  ['armLPitch', 'armRPitch', 1], ['armLYaw', 'armRYaw', -1], ['armLRoll', 'armRRoll', -1],
  ['elbowL', 'elbowR', 1], ['shrugL', 'shrugR', 1],
  ['thighLPitch', 'thighRPitch', 1], ['thighLRoll', 'thighRRoll', -1], ['kneeL', 'kneeR', 1], ['ankleL', 'ankleR', 1],
];
const MIRROR_NEGATE: readonly PoseField[] = ['hipX', 'hipYaw', 'hipRoll', 'spineYaw', 'spineRoll', 'neckYaw', 'neckRoll', 'rootRoll'];

const MIRROR: Record<PoseField, { to: PoseField; sign: 1 | -1 }> = (() => {
  const m = {} as Record<PoseField, { to: PoseField; sign: 1 | -1 }>;
  for (const f of POSE_FIELDS) m[f] = { to: f, sign: 1 };
  for (const [a, b, sg] of MIRROR_PAIRS) { m[a] = { to: b, sign: sg }; m[b] = { to: a, sign: sg }; }
  for (const f of MIRROR_NEGATE) m[f] = { to: f, sign: -1 };
  return m;
})();

const LEFT_FIELDS = new Set<PoseField>(['armLPitch', 'armLYaw', 'armLRoll', 'elbowL', 'shrugL', 'thighLPitch', 'thighLRoll', 'kneeL', 'ankleL']);
const RIGHT_FIELDS = new Set<PoseField>(['armRPitch', 'armRYaw', 'armRRoll', 'elbowR', 'shrugR', 'thighRPitch', 'thighRRoll', 'kneeR', 'ankleR']);

function mirrorPose(p: Partial<ZombiePose>): Partial<ZombiePose> {
  const o: Partial<ZombiePose> = {};
  for (const f of POSE_FIELDS) {
    const v = p[f];
    if (v !== undefined) o[MIRROR[f].to] = v * MIRROR[f].sign;
  }
  return o;
}

function mirrorClip(src: PoseClip, name: ClipName): PoseClip {
  return { ...src, name, keys: src.keys.map((key) => ({ t: key.t, ease: key.ease, pose: mirrorPose(key.pose) })) };
}

// ---------------------------------------------------------------------------
// The clips
// ---------------------------------------------------------------------------

/** Funny victory flail: arms thrown up and flapping out of phase, two hops, bobbing head, mouth wide open. Loops. */
const CELEBRATE: PoseClip = {
  name: 'celebrate', duration: 1.6, loop: true, additive: true,
  keys: [
    k(0, { armLPitch: -2.3, armRPitch: -1.9, armLRoll: 0.55, armRRoll: -0.7, elbowL: 0.5, elbowR: 0.9, neckPitch: -0.25, neckRoll: 0.12, neckYaw: 0, jaw: 0.6, spinePitch: -0.12, spineRoll: 0.05, hipY: 0, hipRoll: 0.03, shrugL: 0.03, shrugR: 0.02 }),
    // Crouch for the hop: arms drop (anticipation), torso folds a little.
    k(0.2, { armLPitch: -1.6, armRPitch: -1.3, armLRoll: 0.3, armRRoll: -0.4, elbowL: 0.8, elbowR: 1.1, neckPitch: 0.05, neckRoll: -0.1, jaw: 0.35, spinePitch: 0.08, spineRoll: -0.04, hipY: 0, hipRoll: -0.03, shrugL: 0, shrugR: 0 }, 'smooth'),
    // Apex: arms flung up, head thrown back, mouth gaping (overshoot).
    k(0.5, { armLPitch: -2.9, armRPitch: -2.55, armLRoll: 0.95, armRRoll: -0.8, elbowL: 0.2, elbowR: 0.45, neckPitch: -0.38, neckRoll: 0.2, jaw: 0.8, spinePitch: -0.2, spineRoll: 0.08, hipY: 0.075, hipRoll: 0.05, shrugL: 0.05, shrugR: 0.04 }, 'back'),
    // Landing: arms flap down-out, head nods.
    k(0.8, { armLPitch: -2.0, armRPitch: -2.25, armLRoll: 0.6, armRRoll: -1.0, elbowL: 0.7, elbowR: 0.35, neckPitch: 0.06, neckRoll: -0.22, jaw: 0.4, spinePitch: 0.05, spineRoll: -0.07, hipY: 0, hipRoll: -0.04, shrugL: 0.01, shrugR: 0.03 }, 'smooth'),
    // Second hop, smaller and lopsided.
    k(1.1, { armLPitch: -2.7, armRPitch: -2.1, armLRoll: 0.85, armRRoll: -0.55, elbowL: 0.35, elbowR: 0.7, neckPitch: -0.3, neckRoll: 0.26, neckYaw: 0.1, jaw: 0.7, spinePitch: -0.16, spineRoll: 0.06, hipY: 0.058, hipRoll: 0.04, shrugL: 0.04, shrugR: 0.01 }, 'back'),
    k(1.4, { armLPitch: -2.1, armRPitch: -1.8, armLRoll: 0.5, armRRoll: -0.65, elbowL: 0.6, elbowR: 0.85, neckPitch: -0.1, neckRoll: -0.05, neckYaw: -0.05, jaw: 0.5, spinePitch: -0.02, spineRoll: 0.02, hipY: 0, hipRoll: -0.01, shrugL: 0.02, shrugR: 0.02 }, 'smooth'),
    k(1.6, { armLPitch: -2.3, armRPitch: -1.9, armLRoll: 0.55, armRRoll: -0.7, elbowL: 0.5, elbowR: 0.9, neckPitch: -0.25, neckRoll: 0.12, neckYaw: 0, jaw: 0.6, spinePitch: -0.12, spineRoll: 0.05, hipY: 0, hipRoll: 0.03, shrugL: 0.03, shrugR: 0.02 }),
  ],
};

/** Bite: wind the head back with the mouth open (anticipation), lunge in and snap shut at BITE_SNAP_T, recoil. */
const BITE: PoseClip = {
  name: 'bite', duration: 0.6, loop: false, additive: true,
  keys: [
    k(0, {}),
    k(0.15, { spinePitch: -0.12, neckPitch: -0.28, jaw: 0.3, hipZ: -0.012, armLPitch: -0.12, armRPitch: -0.1 }, 'smooth'),
    k(BITE_SNAP_T, { spinePitch: 0.12, neckPitch: 0.18, jaw: -0.35, hipZ: 0.02, armLPitch: 0.05, armRPitch: 0.04 }, 'linear'),
    k(0.42, { spinePitch: -0.04, neckPitch: -0.12, neckRoll: 0.08, jaw: 0.12, hipZ: 0.005 }, 'back'),
    k(0.6, {}),
  ],
};

/** Stagger, authored for a hit from the character's left (+X): head and spine whip away, arms flail, small step. */
const HIT_REACT: PoseClip = {
  name: 'hitReact', duration: 0.7, loop: false, additive: true,
  keys: [
    k(0, {}),
    k(0.06, { spineRoll: -0.22, spineYaw: -0.18, spinePitch: -0.12, neckRoll: -0.4, neckYaw: 0.3, neckPitch: -0.28, armLRoll: 0.6, armRRoll: -0.2, armLPitch: -0.5, armRPitch: 0.35, elbowL: 0.5, jaw: 0.3, hipZ: 0.006, shrugL: 0.03 }, 'linear'),
    // Rebound the other way (follow-through), arms swing across.
    k(0.2, { spineRoll: 0.1, spineYaw: 0.1, spinePitch: 0.08, neckRoll: 0.18, neckYaw: -0.15, neckPitch: 0.1, armLRoll: 0.15, armRRoll: -0.5, armLPitch: -0.1, armRPitch: -0.4, elbowR: 0.4, jaw: 0.1, hipZ: -0.004, shrugL: 0 }, 'back'),
    k(0.4, { spineRoll: -0.04, spineYaw: -0.03, neckRoll: -0.06, neckYaw: 0.04, armRRoll: -0.12, armRPitch: -0.1, elbowR: 0.1, jaw: 0.03 }, 'smooth'),
    k(0.7, {}),
  ],
};

/** Turn on the spot toward +yaw: the head leads, then the chest, then the hips; arms counterweight. */
const TURN_L: PoseClip = {
  name: 'turnL', duration: 0.8, loop: false, additive: true,
  keys: [
    k(0, {}),
    k(0.1, { neckYaw: 0.5, neckRoll: -0.05, spineYaw: 0.04, hipYaw: 0, armRRoll: -0.04 }, 'smooth'),
    k(0.28, { neckYaw: 0.35, spineYaw: 0.28, hipYaw: 0.05, armLRoll: 0.1, armRRoll: -0.12, spineRoll: -0.03 }, 'smooth'),
    k(0.46, { neckYaw: 0.12, spineYaw: 0.22, hipYaw: 0.16, armLRoll: 0.05, armRRoll: -0.06 }, 'back'),
    k(0.8, {}),
  ],
};
const TURN_R: PoseClip = mirrorClip(TURN_L, 'turnR');

/** Lunge: arms cock back (wind-up) then reach forward past the target, then hang there. Absolute arm targets. */
const LUNGE: PoseClip = {
  name: 'lunge', duration: 0.55, loop: false, additive: false,
  keys: [
    k(0, { armLPitch: -0.5, armRPitch: -0.5, armLRoll: 0.2, armRRoll: -0.2, elbowL: 0.5, elbowR: 0.5 }, 'smooth'),
    k(0.17, { armLPitch: 0.7, armRPitch: 0.55, armLRoll: 0.4, armRRoll: -0.32, elbowL: 0.9, elbowR: 0.8 }, 'smooth'),
    k(0.32, { armLPitch: -1.7, armRPitch: -1.6, armLRoll: 0.05, armRRoll: -0.05, elbowL: 0.2, elbowR: 0.18 }, 'back'),
    k(0.55, { armLPitch: -1.2, armRPitch: -1.15, armLRoll: 0.1, armRRoll: -0.1, elbowL: 0.35, elbowR: 0.3 }),
  ],
};

/** Idle look-around: head scans one way then the other with a small settle, then a shrug. Seamless loop. */
const IDLE_LOOK: PoseClip = {
  name: 'idleLook', duration: 3.2, loop: true, additive: true,
  keys: [
    k(0.5, { neckYaw: -0.55, neckPitch: -0.05, spineYaw: -0.08, neckRoll: 0.05 }, 'smooth'),
    k(1.2, { neckYaw: -0.5, neckPitch: -0.04, spineYaw: -0.07, neckRoll: 0.08 }, 'smooth'),
    k(1.7, { neckYaw: 0.6, neckPitch: 0, spineYaw: 0.1, neckRoll: -0.06 }, 'back'),
    k(2.2, { neckYaw: 0.58, neckPitch: 0.08, spineYaw: 0.09, shrugL: 0.035, shrugR: 0.035, armLRoll: 0.06, armRRoll: -0.06 }, 'smooth'),
    k(2.7, { neckYaw: 0.15, neckPitch: 0.04, spineYaw: 0.02, shrugL: 0.02, shrugR: 0.02, armLRoll: 0.02, armRRoll: -0.02 }, 'smooth'),
  ],
};

/** After rising from the ground: shake it off, arms thrown out, head whipping side to side. Absolute targets. */
const RISE_FLOURISH: PoseClip = {
  name: 'riseFlourish', duration: 1.0, loop: false, additive: false,
  keys: [
    k(0, { armLRoll: 0.5, armRRoll: -0.5, armLPitch: -0.3, armRPitch: -0.3, elbowL: 0.4, elbowR: 0.4, neckYaw: 0, jaw: 0.3, spineYaw: 0, shrugL: 0, shrugR: 0 }, 'smooth'),
    k(0.15, { armLRoll: 1.1, armRRoll: -1.1, armLPitch: -0.2, armRPitch: -0.2, elbowL: 0.25, elbowR: 0.25, neckYaw: 0.5, jaw: 0.6, spineYaw: 0.15, shrugL: 0.04, shrugR: 0.04 }, 'back'),
    k(0.3, { armLRoll: 1.0, armRRoll: -1.15, armLPitch: -0.3, armRPitch: -0.1, elbowL: 0.35, elbowR: 0.2, neckYaw: -0.5, jaw: 0.55, spineYaw: -0.15, shrugL: 0.03, shrugR: 0.04 }, 'smooth'),
    k(0.45, { armLRoll: 1.05, armRRoll: -0.95, armLPitch: -0.15, armRPitch: -0.25, elbowL: 0.3, elbowR: 0.3, neckYaw: 0.35, jaw: 0.4, spineYaw: 0.1, shrugL: 0.04, shrugR: 0.02 }, 'smooth'),
    k(0.65, { armLRoll: 0.8, armRRoll: -0.8, armLPitch: -0.3, armRPitch: -0.3, elbowL: 0.4, elbowR: 0.4, neckYaw: -0.15, jaw: 0.2, spineYaw: -0.05, shrugL: 0.02, shrugR: 0.02 }, 'smooth'),
    k(1.0, { armLRoll: 0.4, armRRoll: -0.4, armLPitch: -0.4, armRPitch: -0.4, elbowL: 0.5, elbowR: 0.5, neckYaw: 0, jaw: 0.1, spineYaw: 0, shrugL: 0, shrugR: 0 }),
  ],
};

export const CLIPS: Readonly<Record<ClipName, PoseClip>> = {
  celebrate: CELEBRATE,
  bite: BITE,
  hitReact: HIT_REACT,
  turnL: TURN_L,
  turnR: TURN_R,
  lunge: LUNGE,
  idleLook: IDLE_LOOK,
  riseFlourish: RISE_FLOURISH,
};

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function frac(v: number): number {
  return v - Math.floor(v);
}

function ease(kind: ClipEase, u: number): number {
  if (kind === 'linear') return u;
  if (kind === 'back') {
    const c1 = 1.0; // gentle overshoot (~7 %)
    const c3 = c1 + 1;
    const x = u - 1;
    return 1 + c3 * x * x * x + c1 * x * x;
  }
  return u * u * (3 - 2 * u);
}

/** Playback speed factor for a variation (0.88..1.12). */
function speedOf(variation: number): number {
  return 0.88 + 0.24 * clamp01(variation);
}

/** Clip length in seconds for a variation (±12 % speed). */
export function clipDuration(name: ClipName, variation: number): number {
  return CLIPS[name].duration / speedOf(variation);
}

/** +1 when the hit came from the character's left (+X), -1 from the right; frontal / rear hits pick a stable side. */
export function hitSign(fromX: number, fromZ = 0): 1 | -1 {
  if (fromX > 0.02) return 1;
  if (fromX < -0.02) return -1;
  return fromZ >= 0 ? 1 : -1;
}

const fieldCache = new Map<PoseClip, readonly PoseField[]>();

function clipFields(clip: PoseClip): readonly PoseField[] {
  let list = fieldCache.get(clip);
  if (!list) {
    const seen = new Set<PoseField>();
    for (const key of clip.keys) for (const f of POSE_FIELDS) if (key.pose[f] !== undefined) seen.add(f);
    list = POSE_FIELDS.filter((f) => seen.has(f));
    fieldCache.set(clip, list);
  }
  return list;
}

function sampleField(clip: PoseClip, f: PoseField, ts: number): number {
  let pt = 0;
  let pv = clip.additive ? 0 : NaN;
  let pe: ClipEase = 'smooth';
  let nt = clip.duration;
  let nv = clip.additive ? 0 : NaN;
  const keys = clip.keys;
  for (let i = 0; i < keys.length; i++) {
    const v = keys[i].pose[f];
    if (v === undefined) continue;
    if (keys[i].t <= ts) { pt = keys[i].t; pv = v; pe = keys[i].ease ?? 'smooth'; }
    else { nt = keys[i].t; nv = v; break; }
  }
  if (Number.isNaN(pv)) return nv;
  if (Number.isNaN(nv)) return pv;
  const span = nt - pt;
  if (span <= 1e-6) return pv;
  return pv + (nv - pv) * ease(pe, clamp01((ts - pt) / span));
}

/**
 * Sample `clip` at authored time `ts` (seconds, no speed scaling) and apply it to `out` with `weight`.
 * Allocation-free after the first call per clip. `mirror` flips left/right (authored-for-left clips).
 */
export function applyClipAuthored(out: ZombiePose, clip: PoseClip, ts: number, weight: number, variation: number, mirror = false): void {
  if (!(weight !== 0)) return; // also rejects NaN
  const dur = clip.duration;
  if (clip.loop) { ts %= dur; if (ts < 0) ts += dur; } else ts = ts < 0 ? 0 : ts > dur ? dur : ts;
  const v = clamp01(variation);
  const amp = 0.85 + 0.3 * frac(v * 5.173 + 0.31);
  const asym = (frac(v * 11.77 + 0.57) - 0.5) * 0.3;
  const fields = clipFields(clip);
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const side = LEFT_FIELDS.has(f) ? 1 + asym : RIGHT_FIELDS.has(f) ? 1 - asym : 1;
    let val = sampleField(clip, f, ts) * amp * side;
    let dest = f;
    if (mirror) { dest = MIRROR[f].to; val *= MIRROR[f].sign; }
    if (clip.additive) out[dest] += val * weight;
    else out[dest] += (val - out[dest]) * (weight > 1 ? 1 : weight);
  }
}

/** Apply `clip` at real elapsed time `t` (seconds since it started); the variation sets its speed (±12 %). */
export function applyClip(out: ZombiePose, clip: PoseClip, t: number, weight: number, variation: number, mirror = false): void {
  applyClipAuthored(out, clip, t * speedOf(variation), weight, variation, mirror);
}

export { CLIP_NAMES };
