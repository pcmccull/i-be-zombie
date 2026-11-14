import { describe, expect, it } from 'vitest';
import type { ColliderDef } from '../src/core/types';
import { CollisionWorld } from '../src/world/CollisionWorld';

const bounds = { minX: -20, minZ: -20, maxX: 20, maxZ: 20 };
function wall(overrides: Partial<ColliderDef> = {}): ColliderDef {
  return { minX: 0, minZ: -15, maxX: 1, maxZ: 15, kind: 'wall', height: 2.4,
    blocksMove: true, blocksSight: true, ...overrides };
}

describe('CollisionWorld movement', () => {
  it('blocks normal movement at a wall', () => {
    const world = new CollisionWorld(bounds, [wall()]);
    const p = { x: -1, z: 0 };
    world.moveCircle(p, 2, 0, 0.4);
    expect(p.x).toBeCloseTo(-0.4);
    expect(p.z).toBe(0);
    expect(world.isBlocked(p, 0.4)).toBe(false);
  });

  it('preserves more than 70% of tangential movement when sliding diagonally', () => {
    const world = new CollisionWorld(bounds, [wall()]);
    const p = { x: -0.45, z: -4 };
    world.moveCircle(p, 1.5, 2, 0.4);
    expect(p.x).toBeCloseTo(-0.4);
    expect(p.z + 4).toBeGreaterThan(2 * 0.7);
    expect(p.z).toBeCloseTo(-2);
    expect(world.isBlocked(p, 0.4)).toBe(false);
  });

  it('cannot tunnel through a one-meter wall with a two-meter delta from either side', () => {
    const world = new CollisionWorld(bounds, [wall()]);
    const left = { x: -0.41, z: 0 };
    const right = { x: 1.41, z: 0 };
    world.moveCircle(left, 2, 0, 0.4);
    world.moveCircle(right, -2, 0, 0.4);
    expect(left.x).toBeLessThanOrEqual(-0.4);
    expect(right.x).toBeGreaterThanOrEqual(1.4);
  });

  it('keeps the full circle inside all four world edges', () => {
    const world = new CollisionWorld(bounds, []);
    for (const sign of [-1, 1]) {
      const p = { x: sign * 19, z: sign * 19 };
      world.moveCircle(p, sign * 2, sign * 2, 0.4);
      expect(p.x).toBe(sign * 19.6);
      expect(p.z).toBe(sign * 19.6);
      expect(world.isBlocked(p, 0.4)).toBe(false);
    }
    expect(world.isBlocked({ x: 19.8, z: 0 }, 0.4)).toBe(true);
  });

  it('stops blocking immediately when disabled and blocks again when enabled', () => {
    const world = new CollisionWorld(bounds, [wall({ tag: 'gate', kind: 'gate' })]);
    expect(world.colliders[0].id).toBe(0);
    expect(world.colliders[0].enabled).toBe(true);
    expect(world.findByTag('gate')).toBe(world.colliders[0]);
    world.setEnabled(0, false);
    const p = { x: -0.5, z: 0 };
    world.moveCircle(p, 2, 0, 0.4);
    expect(p.x).toBeCloseTo(1.5);
    expect(world.isBlocked({ x: 0.5, z: 0 }, 0.4)).toBe(false);
    expect(world.findByTag('gate')).toBeUndefined();
    world.setEnabled(0, true);
    expect(world.isBlocked({ x: 0.5, z: 0 }, 0.4)).toBe(true);
  });

  it('pushes embedded centers along the least-penetration axis', () => {
    const world = new CollisionWorld(bounds, [wall({ minZ: -2, maxZ: 2 })]);
    const p = { x: 0.8, z: 0 };
    expect(world.resolveCircle(p, 0.4)).toBe(true);
    expect(p.x).toBeCloseTo(1.4);
    expect(p.z).toBe(0);
    expect(world.resolveCircle(p, 0.4)).toBe(false);
    expect(world.isBlocked(p, 0.4)).toBe(false);
  });

  it('resolves rounded corners and intersecting walls without penetration', () => {
    const world = new CollisionWorld(bounds, [wall(), wall({ minX: -15, maxX: 1, minZ: 0, maxZ: 1 })]);
    const p = { x: -1, z: -1 };
    world.moveCircle(p, 2, 2, 0.4);
    expect(p.x).toBeLessThanOrEqual(-0.4);
    expect(p.z).toBeLessThanOrEqual(-0.4);
    expect(world.isBlocked(p, 0.4)).toBe(false);
    const rounded = new CollisionWorld(bounds, [wall({ minZ: 0 })]);
    const q = { x: -0.2, z: -0.2 };
    rounded.resolveCircle(q, 0.4);
    expect(Math.hypot(q.x, q.z)).toBeCloseTo(0.4);
  });

  it('ignores sight-only and wholly nonblocking colliders for movement', () => {
    const world = new CollisionWorld(bounds, [wall({ blocksMove: false })]);
    const p = { x: -0.5, z: 0 };
    world.moveCircle(p, 2, 0, 0.4);
    expect(p.x).toBeCloseTo(1.5);
  });
});

describe('broad phase and sight', () => {
  it('deduplicates large colliders, clears output, and filters disabled/nonblocking entries', () => {
    const world = new CollisionWorld(bounds, [wall({ minX: -12, maxX: 12 }),
      wall({ blocksMove: false, blocksSight: false }), wall({ tag: 'disabled' })]);
    world.setEnabled(2, false);
    const out = [world.colliders[2]];
    expect(world.queryAABB(bounds, out)).toBe(out);
    expect(out.map(c => c.id)).toEqual([0]);
    expect(world.queryAABB({ minX: 15, maxX: 16, minZ: 0, maxZ: 1 }, out)).toEqual([]);
  });

  it('blocks ground sight behind an eight-meter building', () => {
    const world = new CollisionWorld(bounds, [wall({ height: 8, kind: 'building' })]);
    expect(world.segmentBlocked({ x: -4, z: 0 }, { x: 4, z: 0 })).toBe(true);
    expect(world.segmentBlocked({ x: 4, z: 0 }, { x: -4, z: 0 })).toBe(true);
  });

  it('blocks ground sight but allows elevated tower sight over a nearby low wall', () => {
    const world = new CollisionWorld(bounds, [wall()]);
    const a = { x: -1, z: 0 };
    const b = { x: 10, z: 0 };
    expect(world.segmentBlocked(a, b)).toBe(true);
    expect(world.segmentBlocked(a, b, { fromHeight: 5.2, toHeight: 1.2 })).toBe(false);
    expect(world.segmentBlocked(b, a, { fromHeight: 1.2, toHeight: 5.2 })).toBe(false);
    // A descending line becomes occluded if its low end is at the wall.
    expect(world.segmentBlocked({ x: -10, z: 0 }, { x: 1.2, z: 0 }, { fromHeight: 5.2, toHeight: 1.2 })).toBe(true);
  });

  it('uses strict height comparison including the lowest point of the clipped slab', () => {
    const world = new CollisionWorld(bounds, [wall()]);
    const a = { x: -1, z: 0 };
    const b = { x: 2, z: 0 };
    expect(world.segmentBlocked(a, b, { fromHeight: 2.4, toHeight: 2.4 })).toBe(false);
    expect(world.segmentBlocked(a, b, { fromHeight: 3, toHeight: 1 })).toBe(true);
  });

  it('honors blocksSight, ignoreIds, move mode and enabled state', () => {
    const world = new CollisionWorld(bounds, [wall({ blocksSight: false }),
      wall({ minX: 3, maxX: 4, blocksMove: false })]);
    const a = { x: -2, z: 0 };
    const b = { x: 2, z: 0 };
    expect(world.segmentBlocked(a, b)).toBe(false);
    expect(world.segmentBlocked(a, b, { mode: 'move' })).toBe(true);
    expect(world.segmentBlocked(a, b, { mode: 'move', ignoreIds: [0] })).toBe(false);
    expect(world.segmentBlocked(a, { x: 6, z: 0 })).toBe(true);
    expect(world.segmentBlocked(a, { x: 6, z: 0 }, { ignoreIds: [1] })).toBe(false);
    world.setEnabled(1, false);
    expect(world.segmentBlocked(a, { x: 6, z: 0 })).toBe(false);
  });

  it('handles axis-parallel, zero-length, endpoint and nonintersecting segments', () => {
    const world = new CollisionWorld(bounds, [wall()]);
    expect(world.segmentBlocked({ x: -1, z: -10 }, { x: -1, z: 10 })).toBe(false);
    expect(world.segmentBlocked({ x: 0.5, z: -16 }, { x: 0.5, z: 16 })).toBe(true);
    expect(world.segmentBlocked({ x: 0.5, z: 0 }, { x: 0.5, z: 0 })).toBe(true);
    expect(world.segmentBlocked({ x: -1, z: 0 }, { x: -1, z: 0 })).toBe(false);
    expect(world.segmentBlocked({ x: -2, z: 0 }, { x: 0, z: 0 })).toBe(true);
    expect(world.segmentBlocked({ x: -3, z: 0 }, { x: -2, z: 0 })).toBe(false);
    expect(world.segmentBlocked({ x: 2, z: 0 }, { x: 3, z: 0 })).toBe(false);
  });
});
