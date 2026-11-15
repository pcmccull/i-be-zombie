// [pure] Spline + easing + timeline math for scripted camera moves (docs/4_intro_scene.md §3). No three import.
import type { Vec3 } from './types';

export type EaseKind = 'linear' | 'in' | 'out' | 'inOut';

/** One camera keyframe: world position, look-at target, vertical FOV, at script time `t` (seconds). */
export interface CameraKey {
  t: number;
  pos: Vec3;
  look: Vec3;
  fov: number;
  /** Easing of the segment that ENDS at this key (default 'linear' — keeps motion continuous through keys). */
  ease?: EaseKind;
}

export interface CameraPose { pos: Vec3; look: Vec3; fov: number }

export function createPose(): CameraPose {
  return { pos: { x: 0, y: 0, z: 0 }, look: { x: 0, y: 0, z: 0 }, fov: 55 };
}

export function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** Cinematic easing curves (smootherstep for in-out: zero velocity and acceleration at both ends). */
export function ease(kind: EaseKind | undefined, u: number): number {
  const x = clamp01(u);
  switch (kind) {
    case 'in': return x * x * x;
    case 'out': { const k = 1 - x; return 1 - k * k * k; }
    case 'inOut': return x * x * x * (x * (x * 6 - 15) + 10);
    default: return x;
  }
}

/** Uniform Catmull-Rom on one axis. Passes through p1 (u=0) and p2 (u=1). */
export function catmullRom1(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

export function catmullRom3(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number, out: Vec3): Vec3 {
  out.x = catmullRom1(p0.x, p1.x, p2.x, p3.x, u);
  out.y = catmullRom1(p0.y, p1.y, p2.y, p3.y, u);
  out.z = catmullRom1(p0.z, p1.z, p2.z, p3.z, u);
  return out;
}

const phantomA: Vec3 = { x: 0, y: 0, z: 0 };
const phantomB: Vec3 = { x: 0, y: 0, z: 0 };

function sameVec(a: Vec3, b: Vec3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/**
 * Samples a keyframed camera path at script time `t`. Positions and look targets follow Catmull-Rom splines
 * through the keys (end tangents mirrored); consecutive identical keys hold still (no spline overshoot).
 * Keys must be sorted by `t`. Before the first / after the last key the end pose is held.
 */
export function sampleCameraPath(keys: readonly CameraKey[], t: number, out: CameraPose): CameraPose {
  const n = keys.length;
  if (n === 0) return out;
  if (n === 1 || t <= keys[0].t) return copyKey(keys[0], out);
  if (t >= keys[n - 1].t) return copyKey(keys[n - 1], out);
  let i = 0;
  while (i < n - 2 && t >= keys[i + 1].t) i++;
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const span = k2.t - k1.t;
  const u = ease(k2.ease, span > 1e-9 ? (t - k1.t) / span : 1);
  const k0 = keys[i - 1];
  const k3 = keys[i + 2];
  splineAxis(k0?.pos, k1.pos, k2.pos, k3?.pos, u, out.pos);
  splineAxis(k0?.look, k1.look, k2.look, k3?.look, u, out.look);
  out.fov = k1.fov + (k2.fov - k1.fov) * ease('inOut', u);
  return out;
}

function splineAxis(p0: Vec3 | undefined, p1: Vec3, p2: Vec3, p3: Vec3 | undefined, u: number, out: Vec3): void {
  if (sameVec(p1, p2)) { out.x = p1.x; out.y = p1.y; out.z = p1.z; return; }
  // Mirror missing / held neighbours so a spline never overshoots out of (or into) a hold.
  let a = p0;
  if (!a || sameVec(a, p1)) { a = phantomA; a.x = 2 * p1.x - p2.x; a.y = 2 * p1.y - p2.y; a.z = 2 * p1.z - p2.z; }
  let b = p3;
  if (!b || sameVec(b, p2)) { b = phantomB; b.x = 2 * p2.x - p1.x; b.y = 2 * p2.y - p1.y; b.z = 2 * p2.z - p1.z; }
  catmullRom3(a, p1, p2, b, u, out);
}

function copyKey(k: CameraKey, out: CameraPose): CameraPose {
  out.pos.x = k.pos.x; out.pos.y = k.pos.y; out.pos.z = k.pos.z;
  out.look.x = k.look.x; out.look.y = k.look.y; out.look.z = k.look.z;
  out.fov = k.fov;
  return out;
}

/** Linear blend between two poses (used for skip / exit blends). */
export function blendPose(a: CameraPose, b: CameraPose, u: number, out: CameraPose): CameraPose {
  const lerp = (x: number, y: number): number => x + (y - x) * u;
  out.pos.x = lerp(a.pos.x, b.pos.x); out.pos.y = lerp(a.pos.y, b.pos.y); out.pos.z = lerp(a.pos.z, b.pos.z);
  out.look.x = lerp(a.look.x, b.look.x); out.look.y = lerp(a.look.y, b.look.y); out.look.z = lerp(a.look.z, b.look.z);
  out.fov = lerp(a.fov, b.fov);
  return out;
}

// --- narration timeline --------------------------------------------------------------------------

/** A subtitle cue in script seconds. */
export interface SubtitleCue { start: number; end: number; text: string }

/** Returns the cue on screen at script time `t`, or null. */
export function activeCue(cues: readonly SubtitleCue[], t: number): SubtitleCue | null {
  for (const c of cues) if (t >= c.start && t < c.end) return c;
  return null;
}

/**
 * Factor that maps narration-audio seconds onto authored script seconds so the camera timing adapts to the
 * actual voice-over length (a re-recorded or different file). Unknown / absurd durations fall back to 1.
 */
export function narrationTimeScale(authoredDuration: number, actualDuration: number | null | undefined): number {
  if (!actualDuration || !Number.isFinite(actualDuration) || actualDuration <= 0 || authoredDuration <= 0) return 1;
  const s = actualDuration / authoredDuration;
  return s < 0.6 || s > 1.6 ? 1 : s;
}

/**
 * Advances the script clock. Without audio it is plain dt accumulation; while narration plays, the clock follows
 * the audio position (`narrationStart + audioTime / scale`) and corrects drift smoothly, snapping on big jumps.
 */
export function advanceScriptClock(
  clock: number, dt: number,
  audio: { playing: boolean; time: number; narrationStart: number; scale: number } | null,
): number {
  const next = clock + Math.max(0, dt);
  if (!audio || !audio.playing) return next;
  const target = audio.narrationStart + audio.time / audio.scale;
  const drift = target - next;
  if (Math.abs(drift) > 0.5) return target;
  return next + drift * Math.min(1, dt * 4);
}
