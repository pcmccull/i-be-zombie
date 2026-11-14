import { describe, expect, it } from 'vitest';
import { approachCameraDistance, approachOccluderOpacity, pickNearestScreenTarget } from '../src/core/cameraMath';

describe('screen-space target tolerance', () => {
  it('selects the nearest center within 28 CSS pixels regardless of input order', () => {
    const points = [{ x: 125, y: 200, id: 'gate' }, { x: 103, y: 204, id: 'guard' }];
    expect(pickNearestScreenTarget(points, 100, 200, 28)).toBe('guard');
    expect(pickNearestScreenTarget([...points].reverse(), 100, 200, 28)).toBe('guard');
  });

  it('includes the radius boundary and rejects a center just outside it', () => {
    expect(pickNearestScreenTarget([{ x: 28, y: 0, id: 0 }], 0, 0, 28)).toBe(0);
    expect(pickNearestScreenTarget([{ x: 28.001, y: 0, id: 1 }], 0, 0, 28)).toBeNull();
    expect(pickNearestScreenTarget([{ x: 20, y: 20, id: 1 }], 0, 0, 28)).toBeNull();
  });

  it('keeps input order on ties, including overlapping centers', () => {
    expect(pickNearestScreenTarget([{ x: -5, y: 0, id: 'first' }, { x: 5, y: 0, id: 'second' }], 0, 0, 28)).toBe('first');
    expect(pickNearestScreenTarget([{ x: 0, y: 0, id: 0 }, { x: 0, y: 0, id: 1 }], 0, 0, 0)).toBe(0);
  });

  it('handles empty lists, offsets, invalid coordinates and invalid radii', () => {
    expect(pickNearestScreenTarget([], 0, 0, 28)).toBeNull();
    expect(pickNearestScreenTarget([{ x: 413, y: 327, id: 7 }], 400, 310, 28)).toBe(7);
    const points = [{ x: NaN, y: 0, id: 1 }, { x: Infinity, y: 0, id: 2 }];
    expect(pickNearestScreenTarget(points, 0, 0, 28)).toBeNull();
    for (const radius of [-1, NaN, Infinity]) {
      expect(pickNearestScreenTarget([{ x: 0, y: 0, id: 1 }], 0, 0, radius)).toBeNull();
    }
    expect(pickNearestScreenTarget([{ x: 0, y: 0, id: 1 }], NaN, 0, 28)).toBeNull();
  });

  it('does not mutate the candidate list', () => {
    const points = Object.freeze([Object.freeze({ x: 1, y: 2, id: 'guard' })]);
    expect(pickNearestScreenTarget(points, 0, 0, 28)).toBe('guard');
  });
});

describe('camera obstruction response', () => {
  it('fades below 35% within 0.15 seconds at different frame rates', () => {
    for (const frames of [1, 3, 9, 18]) {
      let opacity = 1;
      for (let i = 0; i < frames; i++) opacity = approachOccluderOpacity(opacity, true, 0.15 / frames);
      expect(opacity).toBeLessThanOrEqual(0.35);
      expect(opacity).toBeGreaterThanOrEqual(0.3);
      expect(opacity).toBeCloseTo(approachOccluderOpacity(1, true, 0.15), 10);
    }
  });

  it('restores smoothly, reaches opaque again, and does not advance on paused frames', () => {
    const partial = approachOccluderOpacity(0.3, false, 1 / 60);
    expect(partial).toBeGreaterThan(0.3);
    expect(partial).toBeLessThan(1);
    expect(approachOccluderOpacity(partial, true, 0)).toBe(partial);
    expect(approachOccluderOpacity(partial, false, -1)).toBe(partial);
    expect(approachOccluderOpacity(0.3, false, 2)).toBe(1);
  });

  it('pulls in immediately with clearance and never goes below four meters', () => {
    expect(approachCameraDistance(18, 18, 10, 1 / 60)).toBeCloseTo(9.35);
    expect(approachCameraDistance(18, 18, 1, 1 / 60)).toBe(4);
    expect(approachCameraDistance(18, 18, 0, 0)).toBe(4);
  });

  it('eases outward without overshoot, independent of frame subdivision', () => {
    const next = approachCameraDistance(4, 18, null, 1 / 60);
    expect(next).toBeGreaterThan(4);
    expect(next).toBeLessThan(18);
    let distance = 4;
    for (let i = 0; i < 60; i++) distance = approachCameraDistance(distance, 18, null, 1 / 60);
    expect(distance).toBeCloseTo(approachCameraDistance(4, 18, null, 1), 10);
    expect(approachCameraDistance(4, 18, null, 0)).toBe(4);
    expect(approachCameraDistance(18, 18, 30, 1 / 60)).toBe(18);
  });
});
