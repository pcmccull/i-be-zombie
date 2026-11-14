import type { AABB, Vec2 } from '../core/types';

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function wrapAngle(a: number): number {
  const turn = Math.PI * 2;
  return ((a + Math.PI) % turn + turn) % turn - Math.PI;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return wrapAngle(a + wrapAngle(b - a) * t);
}

export function angleTo(from: Vec2, to: Vec2): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export function distSq(a: Vec2, b: Vec2): number {
  const x = b.x - a.x;
  const z = b.z - a.z;
  return x * x + z * z;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt(distSq(a, b));
}

export function len(v: Vec2): number {
  return Math.hypot(v.x, v.z);
}

export function normalizeInPlace(v: Vec2): Vec2 {
  const length = len(v);
  if (length > 0) {
    v.x /= length;
    v.z /= length;
  }
  return v;
}

export function set(out: Vec2, x: number, z: number): Vec2 {
  out.x = x;
  out.z = z;
  return out;
}

export function copyVec(out: Vec2, src: Vec2): Vec2 {
  return set(out, src.x, src.z);
}

/** Touching is overlap; movement resolution only pushes strict penetrations. */
export function circleAabbOverlap(p: Vec2, r: number, box: AABB): boolean {
  const x = p.x - clamp(p.x, box.minX, box.maxX);
  const z = p.z - clamp(p.z, box.minZ, box.maxZ);
  return x * x + z * z <= r * r;
}

export function expandAabb(box: AABB, r: number, out: AABB = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 }): AABB {
  out.minX = box.minX - r;
  out.minZ = box.minZ - r;
  out.maxX = box.maxX + r;
  out.maxZ = box.maxZ + r;
  return out;
}

export function pointInAabb(p: Vec2, box: AABB): boolean {
  return p.x >= box.minX && p.x <= box.maxX && p.z >= box.minZ && p.z <= box.maxZ;
}
