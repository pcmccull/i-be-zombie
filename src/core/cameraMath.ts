import type { GamePhase, Vec3 } from './types';

export interface ScreenTarget<Id> { x: number; y: number; id: Id }

export const MIN_CAMERA_PITCH = (20 * Math.PI) / 180;
export const MAX_CAMERA_PITCH = (78 * Math.PI) / 180;
/** Camera mouse-look / drag orbit sensitivity (radians per pixel). */
export const MOUSE_LOOK_SENSITIVITY = 0.005;
/** Threshold (px) for ignoring the first large mousemove jump right after pointer lock (Chrome quirk). */
export const POINTER_LOCK_SPIKE_PX = 300;

export interface OrbitDelta {
  yawDelta: number;
  pitchDelta: number;
}

export interface CameraAngles {
  yaw: number;
  pitch: number;
}

export interface PointerLockDecisionState {
  isLocked: boolean;
  phase: GamePhase;
  helpVisible: boolean;
  button?: number;
  supported?: boolean;
}

/** Coordinates and radius are CSS pixels. Equal distances retain input order. */
export function pickNearestScreenTarget<Id>(
  points: readonly ScreenTarget<Id>[], px: number, py: number, radius: number,
): Id | null {
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(radius) || radius < 0) return null;
  let nearest: Id | null = null;
  let bestDistanceSq = radius * radius;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const dx = point.x - px;
    const dy = point.y - py;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq <= bestDistanceSq && (nearest === null || distanceSq < bestDistanceSq)) {
      nearest = point.id;
      bestDistanceSq = distanceSq;
    }
  }
  return nearest;
}

/** Reach <=35% within 0.15s, then restore more slowly without frame-rate dependence. */
export function approachOccluderOpacity(current: number, occluded: boolean, dt: number): number {
  const target = occluded ? 0.3 : 1;
  const next = target + (current - target) * Math.exp(-(occluded ? 24 : 6) * Math.max(0, dt));
  return Math.abs(next - target) < 0.002 ? target : next;
}

/** Contract the boom immediately; only the return to the requested zoom is eased. */
export function approachCameraDistance(current: number, desired: number, hitDistance: number | null, dt: number): number {
  const allowed = Math.max(4, hitDistance === null ? desired : Math.min(desired, hitDistance - 0.65));
  return Math.max(4, allowed < current ? allowed : current + (allowed - current) * (1 - Math.exp(-5 * Math.max(0, dt))));
}

/** Camera yaw and movement yaw share the +Z-forward convention. */
export function cameraOffset(yaw: number, horizontalDist: number, height: number, out: Vec3): Vec3 {
  out.x = -Math.sin(yaw) * horizontalDist;
  out.y = height;
  out.z = -Math.cos(yaw) * horizontalDist;
  return out;
}

export function isClick(downX: number, downY: number, upX: number, upY: number, thresholdPx = 6): boolean {
  return Math.hypot(upX - downX, upY - downY) <= thresholdPx;
}

export function approachAngle(current: number, target: number, maxStep: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  const step = Math.max(0, maxStep);
  return current + Math.max(-step, Math.min(step, delta));
}

export function clampCameraPitch(pitch: number): number {
  return Math.max(MIN_CAMERA_PITCH, Math.min(MAX_CAMERA_PITCH, pitch));
}

/**
 * Maps pointer movement (in pixels) and sensitivity (rad/px) to camera yaw/pitch deltas.
 * Sign convention matches drag-to-orbit: moving right (+dx) orbits right (-yaw),
 * moving down (+dy) tilts higher (+pitch).
 */
export function computeOrbitDelta(
  movementX: number,
  movementY: number,
  sensitivity: number = MOUSE_LOOK_SENSITIVITY,
  out: OrbitDelta = { yawDelta: 0, pitchDelta: 0 },
): OrbitDelta {
  if (!Number.isFinite(movementX) || !Number.isFinite(movementY) || !Number.isFinite(sensitivity)) {
    out.yawDelta = 0;
    out.pitchDelta = 0;
    return out;
  }
  out.yawDelta = -movementX * sensitivity;
  out.pitchDelta = movementY * sensitivity;
  return out;
}

/**
 * Applies pointer movement deltas to current (yaw, pitch) and clamps pitch to [MIN_CAMERA_PITCH, MAX_CAMERA_PITCH].
 */
export function applyOrbitDelta(
  yaw: number,
  pitch: number,
  movementX: number,
  movementY: number,
  sensitivity: number = MOUSE_LOOK_SENSITIVITY,
  out: CameraAngles = { yaw: 0, pitch: 0 },
): CameraAngles {
  const yawDelta = Number.isFinite(movementX) && Number.isFinite(sensitivity) ? -movementX * sensitivity : 0;
  const pitchDelta = Number.isFinite(movementY) && Number.isFinite(sensitivity) ? movementY * sensitivity : 0;
  out.yaw = yaw + yawDelta;
  out.pitch = clampCameraPitch(pitch + pitchDelta);
  return out;
}

/** True when a canvas click should request pointer lock instead of picking/pinging a target. */
export function shouldRequestLock(state: PointerLockDecisionState): boolean {
  if (state.supported === false) return false;
  if (state.button !== undefined && state.button !== 0) return false;
  return !state.isLocked && state.phase === 'playing' && !state.helpVisible;
}

/** True when active pointer lock must be released programmatically (help open or game over). */
export function shouldReleaseLock(
  state: Pick<PointerLockDecisionState, 'isLocked' | 'phase' | 'helpVisible'>,
): boolean {
  return state.isLocked && (state.phase !== 'playing' || state.helpVisible);
}

/** Filters the initial large movement spike some browsers (Chrome) emit on the first mousemove after lock. */
export function isInitialLockJump(
  movementX: number,
  movementY: number,
  isFirstMoveAfterLock: boolean,
  thresholdPx: number = POINTER_LOCK_SPIKE_PX,
): boolean {
  if (!isFirstMoveAfterLock) return false;
  return Math.abs(movementX) > thresholdPx || Math.abs(movementY) > thresholdPx;
}
