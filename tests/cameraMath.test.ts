import { describe, expect, it } from 'vitest';
import { approachAngle, cameraOffset, isClick } from '../src/core/cameraMath';
import { computeMoveVector } from '../src/entities/ZombieLeader';

describe('camera conventions', () => {
  it('places the camera behind +Z and +X headings, reusing the output', () => {
    const out = { x: 0, y: 0, z: 0 };
    expect(cameraOffset(0, 14, 11, out)).toBe(out);
    expect(out).toEqual({ x: -0, y: 11, z: -14 });
    cameraOffset(Math.PI / 2, 14, 11, out);
    expect(out.x).toBeCloseTo(-14);
    expect(out.z).toBeCloseTo(0);
  });

  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.74])('moves forward away from the camera at yaw %s', yaw => {
    const offset = cameraOffset(yaw, 14, 11, { x: 0, y: 0, z: 0 });
    const movement = computeMoveVector(1, 0, yaw, { x: 0, z: 0 });
    expect(offset.x * movement.x + offset.z * movement.z).toBeCloseTo(-14);
    expect(Math.hypot(movement.x - offset.x, movement.z - offset.z)).toBeGreaterThan(14);
  });
});

describe('pointer threshold', () => {
  it('uses total Euclidean displacement, including the six-pixel boundary', () => {
    expect(isClick(10, 20, 10, 20)).toBe(true);
    expect(isClick(10, 20, 16, 20)).toBe(true);
    expect(isClick(10, 20, 14, 24)).toBe(true);
    expect(isClick(10, 20, 15, 25)).toBe(false);
    expect(isClick(10, 20, 16.01, 20)).toBe(false);
    expect(isClick(10, 20, 13, 20, 2)).toBe(false);
  });
});

describe('angle approach', () => {
  it('crosses the wrap in either direction along the shortest arc', () => {
    expect(approachAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.05)).toBeCloseTo(Math.PI - 0.05);
    expect(approachAngle(-Math.PI + 0.1, Math.PI - 0.1, 0.05)).toBeCloseTo(-Math.PI + 0.05);
  });
  it('does not overshoot, and a zero or negative step leaves the angle unchanged', () => {
    expect(approachAngle(0, 0.1, 1)).toBeCloseTo(0.1);
    expect(approachAngle(1, 2, 0)).toBe(1);
    expect(approachAngle(1, 2, -1)).toBe(1);
  });
});
