import type { Vec3 } from './types';

export interface ScreenTarget<Id> { x: number; y: number; id: Id }

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
