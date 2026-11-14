import type { Vec3 } from './types';

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
