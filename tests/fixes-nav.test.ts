import { describe, expect, it } from 'vitest';
import type { ColliderDef } from '../src/core/types';
import { dist } from '../src/utils/math';
import { CollisionWorld } from '../src/world/CollisionWorld';
import { NavigationGrid } from '../src/world/NavigationGrid';

function box(minX: number, minZ: number, maxX: number, maxZ: number): ColliderDef {
  return { minX, minZ, maxX, maxZ, kind: 'wall', height: 3, blocksMove: true, blocksSight: true };
}

describe('navigation review regressions', () => {
  it('recovers on the accessible side of a thin wall and reaches the goal around its end', () => {
    const collision = new CollisionWorld({ minX: -30, minZ: -30, maxX: 30, maxZ: 30 }, [box(0, -15, 0.2, 15)]);
    const nav = new NavigationGrid(collision);
    const goal = { x: -5, z: 0 }, p = { x: 0.7, z: 0 }, direction = { x: 0, z: 0 };
    const field = nav.buildFlowField([goal]);
    expect(nav.isWalkable(p)).toBe(false);
    expect(field.distanceAt(p)).toBeGreaterThan(30);
    expect(field.sample(p, direction)).toBe(true);
    expect(direction.x).toBeGreaterThan(0);
    for (let i = 0; i < 2000 && dist(p, goal) > 0.1; i++) {
      expect(field.sample(p, direction)).toBe(true);
      collision.moveCircle(p, direction.x * 3.7 / 60, direction.z * 3.7 / 60, 0.4);
    }
    expect(dist(p, goal)).toBeLessThan(0.1);
  });

  it('rejects recovery neighbors across a wall even when they are the only reachable cells', () => {
    const collision = new CollisionWorld({ minX: -5, minZ: -5, maxX: 1.25, maxZ: 5 }, [box(0, -5, 0.2, 5)]);
    const field = new NavigationGrid(collision).buildFlowField([{ x: -3, z: 0 }]);
    const p = { x: 0.7, z: 0 }, direction = { x: 9, z: 9 };
    expect(field.sample(p, direction)).toBe(false);
    expect(direction).toEqual({ x: 0, z: 0 });
    expect(field.distanceAt(p)).toBe(Infinity);
  });

  it('samples toward the actual nearest goal within a goal cell and reports exact goal distance', () => {
    const nav = new NavigationGrid(new CollisionWorld({ minX: 0, minZ: 0, maxX: 10, maxZ: 10 }, []), 1, 0.45);
    const goal = { x: 0.7, z: 0.5 };
    const field = nav.buildFlowField([goal, { x: 0.95, z: 0.8 }]);
    const out = { x: 0, z: 0 };
    expect(field.sample({ x: 0.9, z: 0.5 }, out)).toBe(true);
    expect(out.x).toBeCloseTo(-1); expect(out.z).toBeCloseTo(0);
    expect(field.distanceAt(goal)).toBeCloseTo(0);
    expect(field.distanceAt({ x: 0.9, z: 0.5 })).toBeCloseTo(0.2);
    expect(field.sample({ x: 0.72, z: 0.5 }, out)).toBe(true);
    expect(out).toEqual({ x: 0, z: 0 });
    expect(field.sample({ x: 0.9, z: 0.75 }, out)).toBe(true);
    expect(out.x).toBeCloseTo(Math.SQRT1_2); expect(out.z).toBeCloseTo(Math.SQRT1_2);
    expect(field.distanceAt({ x: 0.9, z: 0.75 })).toBeCloseTo(Math.hypot(0.05, 0.05));
  });

  it('requires swept circle clearance for direct walks beside a collider', () => {
    const collision = new CollisionWorld({ minX: 0, minZ: 0, maxX: 10, maxZ: 10 }, [box(4, 4, 6, 6)]);
    const nav = new NavigationGrid(collision, 1, 0.45);
    const a = { x: 3.74, z: 3 }, b = { x: 3.74, z: 7 };
    expect(collision.segmentBlocked(a, b, { mode: 'move' })).toBe(false);
    expect(nav.hasClearWalk(a, b)).toBe(false);
    expect(nav.hasClearWalk(b, a)).toBe(false);
    expect(nav.hasClearWalk({ x: 3.5, z: 3 }, { x: 3.5, z: 7 })).toBe(true);
  });

  it('snaps from the center of an eighty meter building to a nearest clear edge', () => {
    const collision = new CollisionWorld({ minX: -60, minZ: -60, maxX: 60, maxZ: 60 }, [box(-40, -40, 40, 40)]);
    const nav = new NavigationGrid(collision, 1, 0.45);
    const p = { x: 0.1, z: 0.2 }, snapped = nav.nearestWalkable(p);
    expect(nav.isWalkable(snapped)).toBe(true);
    expect(collision.isBlocked(snapped, 0.45)).toBe(false);
    expect(snapped).toEqual({ x: 0.5, z: 40.5 });
  });
});
