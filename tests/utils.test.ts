import { describe, expect, it } from 'vitest';
import {
  angleTo, circleAabbOverlap, clamp, copyVec, dist, distSq, expandAabb, len,
  lerp, lerpAngle, normalizeInPlace, pointInAabb, set, wrapAngle,
} from '../src/utils/math';
import { mulberry32, pick, randInt, randRange } from '../src/utils/rng';
import { SpatialHash } from '../src/utils/spatialHash';

describe('math helpers', () => {
  it('clamps and interpolates scalars', () => {
    expect(clamp(-2, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(0.4, 0, 1)).toBe(0.4);
    expect(lerp(2, 6, 0.25)).toBe(3);
  });

  it('wraps multiple turns and interpolates along the shortest arc', () => {
    for (const angle of [-100, -3 * Math.PI, -Math.PI, 0, Math.PI, 100]) {
      expect(wrapAngle(angle)).toBeGreaterThanOrEqual(-Math.PI);
      expect(wrapAngle(angle)).toBeLessThanOrEqual(Math.PI);
      expect(Math.sin(wrapAngle(angle))).toBeCloseTo(Math.sin(angle));
    }
    const result = lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
    expect(Math.abs(result)).toBeCloseTo(Math.PI);
    expect(lerpAngle(-0.2, 0.2, 0.5)).toBeCloseTo(0);
  });

  it('uses +Z forward and +X for a positive quarter turn', () => {
    const origin = { x: 0, z: 0 };
    expect(angleTo(origin, { x: 0, z: 2 })).toBe(0);
    expect(angleTo(origin, { x: 2, z: 0 })).toBe(Math.PI / 2);
    expect(angleTo(origin, { x: -2, z: 0 })).toBe(-Math.PI / 2);
  });

  it('measures and normalizes vectors in place, including zero', () => {
    const a = { x: 3, z: 4 };
    expect(len(a)).toBe(5);
    expect(dist({ x: 0, z: 0 }, a)).toBe(5);
    expect(distSq({ x: 0, z: 0 }, a)).toBe(25);
    expect(normalizeInPlace(a)).toBe(a);
    expect(a.x).toBeCloseTo(0.6);
    expect(a.z).toBeCloseTo(0.8);
    expect(normalizeInPlace({ x: 0, z: 0 })).toEqual({ x: 0, z: 0 });
  });

  it('writes into supplied vectors and boxes without replacing them', () => {
    const out = { x: 0, z: 0 };
    expect(set(out, 1, 2)).toBe(out);
    expect(copyVec(out, { x: -3, z: 4 })).toBe(out);
    expect(out).toEqual({ x: -3, z: 4 });
    const box = { minX: 0, minZ: 0, maxX: 1, maxZ: 2 };
    expect(expandAabb(box, 0.5, box)).toBe(box);
    expect(box).toEqual({ minX: -0.5, minZ: -0.5, maxX: 1.5, maxZ: 2.5 });
  });

  it('tests inclusive points and rounded circle/AABB corners', () => {
    const box = { minX: 0, minZ: 0, maxX: 2, maxZ: 2 };
    expect(pointInAabb({ x: 2, z: 0 }, box)).toBe(true);
    expect(pointInAabb({ x: 2.01, z: 0 }, box)).toBe(false);
    expect(circleAabbOverlap({ x: -1, z: 1 }, 1, box)).toBe(true);
    expect(circleAabbOverlap({ x: -0.8, z: -0.8 }, 1, box)).toBe(false);
    expect(circleAabbOverlap({ x: -0.6, z: -0.6 }, 1, box)).toBe(true);
    expect(expandAabb(box, 1)).toEqual({ minX: -1, minZ: -1, maxX: 3, maxZ: 3 });
  });
});

describe('seeded randomness', () => {
  it('is deterministic for equal seeds and differs for different seeds', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const values = Array.from({ length: 100 }, () => a.next());
    expect(Array.from({ length: 100 }, () => b.next())).toEqual(values);
    expect(Array.from({ length: 100 }, () => c.next())).not.toEqual(values);
    expect(values.every(value => value >= 0 && value < 1)).toBe(true);
  });

  it('matches the mulberry32 reference sequence', () => {
    const rng = mulberry32(1);
    expect(rng.next()).toBe(0.6270739405881613);
    expect(rng.next()).toBe(0.002735721180215478);
    expect(rng.next()).toBe(0.5274470399599522);
  });

  it('keeps ranges, inclusive integers and picks within their bounds', () => {
    const rng = mulberry32(7);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const value = randRange(rng, -4, 6);
      expect(value >= -4 && value < 6).toBe(true);
      const integer = randInt(rng, -2, 2);
      expect(Number.isInteger(integer) && integer >= -2 && integer <= 2).toBe(true);
      seen.add(integer);
      expect(['a', 'b', 'c']).toContain(pick(rng, ['a', 'b', 'c']));
    }
    expect([...seen].sort()).toEqual([-1, -2, 0, 1, 2]);
    expect(randInt({ next: () => 0 }, 2, 5)).toBe(2);
    expect(randInt({ next: () => 1 - Number.EPSILON }, 2, 5)).toBe(5);
    expect(() => pick(rng, [])).toThrow(RangeError);
  });
});

describe('SpatialHash', () => {
  const bounds = { minX: -20, minZ: -20, maxX: 20, maxZ: 20 };

  it('finds nearby candidates across cells and excludes far-away cells', () => {
    const hash = new SpatialHash(2, bounds);
    hash.insert(1234, -0.1, 0);
    hash.insert(7, 0.1, 0.2);
    hash.insert(99, 16, 16);
    const out = [5];
    expect(hash.query(0, 0, 0.5, out)).toBe(out);
    expect(out).toContain(5);
    expect(out).toContain(1234);
    expect(out).toContain(7);
    expect(out).not.toContain(99);
    expect(new Set(out).size).toBe(out.length);
  });

  it('clears touched cells and reuses entries without retaining old ids', () => {
    const hash = new SpatialHash(2, bounds);
    hash.insert(1, 0, 0);
    hash.insert(2, 0, 0);
    hash.clear();
    expect(hash.query(0, 0, 10, [])).toEqual([]);
    hash.insert(3, 1, 1);
    expect(hash.query(0, 0, 10, [])).toEqual([3]);
    hash.clear();
    hash.clear();
    hash.insert(4, 20, 20);
    expect(hash.query(20, 20, 0.1, [])).toEqual([4]);
  });
});
