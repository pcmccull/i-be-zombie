import type { GamePhase, HordeCommand, TargetRef, Vec2, Vec3 } from './types';

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
  /** Pause menu or world map open: never capture the mouse. */
  modalOpen?: boolean;
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
  return !state.isLocked && (state.phase === 'playing' || state.phase === 'respawning')
    && !state.helpVisible && !state.modalOpen;
}

/** True when active pointer lock must be released programmatically (help open or game over). */
export function shouldReleaseLock(
  state: Pick<PointerLockDecisionState, 'isLocked' | 'phase' | 'helpVisible' | 'modalOpen'>,
): boolean {
  return state.isLocked
    && (state.phase === 'victory' || state.phase === 'defeat' || state.helpVisible || state.modalOpen === true);
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

// ---------------------------------------------------------------------------
// Camera zoom (open world: wide enough to frame a 40-zombie horde)
// ---------------------------------------------------------------------------

export const ZOOM_MIN = 8;
export const ZOOM_MAX = 64;
export const ZOOM_DEFAULT = 17;

/** Multiplicative wheel zoom (about 10% per 100 px notch), clamped to [ZOOM_MIN, ZOOM_MAX]. */
export function zoomTarget(current: number, wheelDeltaY: number): number {
  if (!Number.isFinite(wheelDeltaY)) return current;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, current * Math.exp(wheelDeltaY * 0.001)));
}

// ---------------------------------------------------------------------------
// Input model mapping (ARCHITECTURE.md section 4). Pure so it is testable without a DOM.
// ---------------------------------------------------------------------------

export type KeyAction = 'recenter' | 'help' | 'debug' | 'mute' | 'map' | 'pause' | 'regroup' | 'follow';

/** Keys that always work, even while the pause menu or world map is open. */
const SYSTEM_KEYS: ReadonlySet<string> = new Set(['Escape', 'KeyM', 'KeyN', 'F3', 'Tab']);

export function isSystemKey(code: string): boolean { return SYSTEM_KEYS.has(code); }

/** Q E R F -> ability slot 0..3, anything else null. */
export function abilitySlotForKey(code: string): number | null {
  switch (code) {
    case 'KeyQ': return 0;
    case 'KeyE': return 1;
    case 'KeyR': return 2;
    case 'KeyF': return 3;
    default: return null;
  }
}

/** One-shot key actions (not held movement keys, not ability keys). */
export function keyActionFor(code: string): KeyAction | null {
  switch (code) {
    case 'KeyC': return 'recenter';
    case 'Tab': return 'help';
    case 'F3': return 'debug';
    case 'KeyN': return 'mute';
    case 'KeyM': return 'map';
    case 'Escape': return 'pause';
    case 'Space': return 'regroup';
    case 'KeyG': return 'follow';
    default: return null;
  }
}

/** Whether a key press may act while a modal (pause / map) is open. */
export function keyAllowedWhileModal(code: string, modalOpen: boolean): boolean {
  return !modalOpen || isSystemKey(code);
}

export interface RightClickInfo {
  target: TargetRef | null;
  /** Ground point under the pointer, or null when the ray misses / is blocked by a building. */
  ground: Vec2 | null;
  shift: boolean;
  ctrl: boolean;
}

/**
 * RMB: Shift = regroup; target (human/gate/structure) = attack order (Ctrl = additive split target);
 * ground = move order; nothing = no command.
 */
export function hordeCommandForRightClick(info: RightClickInfo): HordeCommand | null {
  if (info.shift) return { type: 'regroup' };
  if (info.target) return { type: 'attack', target: info.target, additive: info.ctrl };
  if (info.ground) return { type: 'move', point: { x: info.ground.x, z: info.ground.z } };
  return null;
}

// ---------------------------------------------------------------------------
// Touch gestures (todos #7). Pure decisions; InputController owns the pointer bookkeeping.
// ---------------------------------------------------------------------------

export type TouchGestureMode = 'none' | 'orbit' | 'pinch';

/** Number of active canvas fingers -> gesture: 1 orbits, 2+ pinch-zooms, 0 idle. */
export function touchGestureMode(activeFingers: number): TouchGestureMode {
  if (activeFingers >= 2) return 'pinch';
  return activeFingers === 1 ? 'orbit' : 'none';
}

/**
 * A lifted finger issues a horde order only when it was the sole finger for the whole gesture (multiTouched false),
 * barely moved and was quick.
 */
export function touchTapAllowed(
  multiTouched: boolean, dxPx: number, dyPx: number, ms: number, maxMovePx: number, maxMs: number,
  moved = false,
): boolean {
  return !multiTouched && !moved && Math.hypot(dxPx, dyPx) <= maxMovePx && ms >= 0 && ms <= maxMs;
}

/** True when a solid hit at `blockedDist` sits in front of the ground point at `groundDist` (by more than `margin` m). */
export function tapGroundBlocked(blockedDist: number, groundDist: number, margin = 0.75): boolean {
  return blockedDist < groundDist - margin;
}
