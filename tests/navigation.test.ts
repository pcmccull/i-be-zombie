import { describe, expect, it } from 'vitest';
import type { AABB, ColliderDef, Vec2 } from '../src/core/types';
import { dist, expandAabb, pointInAabb } from '../src/utils/math';
import { mulberry32, randRange } from '../src/utils/rng';
import { CollisionWorld } from '../src/world/CollisionWorld';
import { FlowField, NavigationGrid } from '../src/world/NavigationGrid';

const bounds: AABB = { minX: -20, minZ: -20, maxX: 20, maxZ: 20 };
function box(minX: number, minZ: number, maxX: number, maxZ: number, extra: Partial<ColliderDef> = {}): ColliderDef {
  return { minX, minZ, maxX, maxZ, kind: 'building', height: 8, blocksMove: true, blocksSight: true, ...extra };
}
function compound(): CollisionWorld {
  return new CollisionWorld(bounds, [box(-8, -8, -7, 8), box(7, -8, 8, 8), box(-8, -8, 8, -7),
    box(-8, 7, -2.5, 8), box(2.5, 7, 8, 8), box(-2.5, 7, 2.5, 8, { tag: 'gate', kind: 'gate' })]);
}

describe('NavigationGrid', () => {
  it('rasterizes expanded footprints and shrunk world bounds, including partial edge cells', () => {
    const collision = new CollisionWorld({ minX: 0, minZ: 0, maxX: 10.2, maxZ: 10.2 }, [box(4, 4, 6, 6)]);
    const nav = new NavigationGrid(collision, 1, 0.6);
    expect(nav.cols).toBe(11);
    expect(nav.rows).toBe(11);
    expect(nav.version).toBe(1);
    expect(nav.isWalkable({ x: 0.5, z: 2.5 })).toBe(false);
    expect(nav.isWalkable({ x: 3.5, z: 4.5 })).toBe(false);
    expect(nav.isWalkable({ x: 2.5, z: 4.5 })).toBe(true);
    expect(nav.isWalkable({ x: 10.1, z: 2.5 })).toBe(false);
    expect(nav.isWalkable({ x: -0.1, z: 3 })).toBe(false);
  });

  it('preserves walkable points and snaps blocked/outside points to a nearest cell center', () => {
    const nav = new NavigationGrid(new CollisionWorld(bounds, [box(-2, -2, 2, 2)]), 1, 0.4);
    const p = { x: -5.1, z: 3.2 };
    const out = { x: 0, z: 0 };
    expect(nav.nearestWalkable(p, out)).toBe(out);
    expect(out).toEqual(p);
    const snapped = nav.nearestWalkable({ x: 0.1, z: 0.2 });
    expect(nav.isWalkable(snapped)).toBe(true);
    expect(snapped).toEqual({ x: 0.5, z: 2.5 });
    expect(nav.isWalkable(nav.nearestWalkable({ x: 21, z: 0 }))).toBe(true);
  });

  it('returns null when a completely blocked world has no snap candidate', () => {
    const nav = new NavigationGrid(new CollisionWorld(bounds, [box(-20, -20, 20, 20)]));
    expect(nav.findPath({ x: -5, z: 0 }, { x: 5, z: 0 })).toBeNull();
  });

  it('does not rasterize colliders wholly outside the world into unrelated rows', () => {
    const world = new CollisionWorld(bounds, [box(-45, -10, -30, 10), box(30, -10, 45, 10),
      box(-10, -45, 10, -30), box(-10, 30, 10, 45)]);
    const nav = new NavigationGrid(world, 1, 0.4);
    for (let z = -19.5; z < 20; z++) {
      for (let x = -19.5; x < 20; x++) expect(nav.isWalkable({ x, z })).toBe(true);
    }
  });

  it('routes around a city block with clear, collision-safe string-pulled segments', () => {
    const collider = box(-5, -8, 5, 8);
    const collision = new CollisionWorld(bounds, [collider]);
    const nav = new NavigationGrid(collision);
    const start = { x: -12, z: 0 };
    const goal = { x: 12, z: 0 };
    const path = nav.findPath(start, goal);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);
    expect(path!.at(-1)).toEqual(goal);
    let previous = start;
    for (const point of path!) {
      expect(pointInAabb(point, expandAabb(collider, 0.45))).toBe(false);
      expect(nav.hasClearWalk(previous, point)).toBe(true);
      expect(collision.segmentBlocked(previous, point, { mode: 'move' })).toBe(false);
      previous = point;
    }
  });

  it('cannot enter a sealed compound until its gate is disabled and navigation rebuilt', () => {
    const collision = compound();
    const nav = new NavigationGrid(collision);
    const start = { x: 0.2, z: 15.2 };
    const goal = { x: 0.2, z: 0.2 };
    expect(nav.findPath(start, goal)).toBeNull();
    const version = nav.version;
    collision.setEnabled(collision.findByTag('gate')!.id, false);
    expect(nav.findPath(start, goal)).toBeNull();
    nav.rebuild();
    expect(nav.version).toBe(version + 1);
    const path = nav.findPath(start, goal);
    expect(path).not.toBeNull();
    let previous = start;
    for (const point of path!) {
      expect(nav.hasClearWalk(previous, point)).toBe(true);
      expect(collision.segmentBlocked(previous, point, { mode: 'move' })).toBe(false);
      previous = point;
    }
    expect(path!.at(-1)).toEqual(goal);
  });

  it('returns the snapped target even when both endpoints share a cell', () => {
    const nav = new NavigationGrid(new CollisionWorld(bounds, []), 1, 0.4);
    expect(nav.findPath({ x: 1.1, z: 1.1 }, { x: 1.9, z: 1.9 })).toEqual([{ x: 1.9, z: 1.9 }]);
  });

  it('snaps endpoints in obstacles and reuses search buffers cleanly', () => {
    const nav = new NavigationGrid(new CollisionWorld(bounds, [box(-2, -2, 2, 2)]), 1, 0.4);
    for (let i = 0; i < 4; i++) {
      const goal = { x: 0.2, z: 0.1 };
      const path = nav.findPath({ x: -10.2, z: -10.2 }, goal);
      expect(path).not.toBeNull();
      expect(path!.at(-1)).toEqual(nav.nearestWalkable(goal));
      expect(path!.every(p => nav.isWalkable(p))).toBe(true);
    }
  });

  it('uses supercover traversal at diagonal corners and along grid edges in both directions', () => {
    const nav = new NavigationGrid(new CollisionWorld({ minX: 0, minZ: 0, maxX: 10, maxZ: 10 },
      [box(3.1, 4.1, 3.9, 4.9)]), 1, 0);
    const a = { x: 3.5, z: 3.5 };
    const b = { x: 4.5, z: 4.5 };
    expect(nav.hasClearWalk(a, b)).toBe(false);
    expect(nav.hasClearWalk(b, a)).toBe(false);
    expect(nav.hasClearWalk({ x: 4, z: 3.5 }, { x: 4, z: 5.5 })).toBe(false);
    expect(nav.hasClearWalk({ x: 4, z: 5.5 }, { x: 4, z: 3.5 })).toBe(false);
    expect(nav.hasClearWalk({ x: 1.5, z: 2.5 }, { x: 8.5, z: 2.5 })).toBe(true);
  });

  it('does not cut diagonal corners in A* or flow propagation', () => {
    const collision = new CollisionWorld({ minX: 0, minZ: 0, maxX: 3, maxZ: 3 },
      [box(1, 0, 2, 1), box(0, 1, 1, 2)]);
    const nav = new NavigationGrid(collision, 1, 0);
    const start = { x: 0.5, z: 0.5 };
    const goal = { x: 1.5, z: 1.5 };
    expect(nav.findPath(start, goal)).toBeNull();
    expect(nav.buildFlowField([goal]).distanceAt(start)).toBe(Infinity);
  });
});

describe('FlowField', () => {
  const flowBounds = { minX: -30, minZ: -25, maxX: 30, maxZ: 25 };
  const obstacles = [box(-8, -12, -5, 12), box(-8, 9, 8, 12),
    box(10, -25, 16, 7), box(21, -25, 28, 7)];
  const goal = { x: 18.5, z: -18 };

  it.each([{ x: -20, z: -16 }, { x: -18, z: 18 }, { x: 4, z: 18 }])(
    'guides $x,$z around an L-shaped obstacle and through a five-meter alley', start => {
      const collision = new CollisionWorld(flowBounds, obstacles);
      const nav = new NavigationGrid(collision);
      const field = nav.buildFlowField([goal]);
      const pos = { ...start };
      const direction = { x: 0, z: 0 };
      let reached = false;
      for (let step = 0; step < 3000; step++) {
        if (dist(pos, goal) <= 1.5) {
          reached = true;
          break;
        }
        expect(field.sample(pos, direction), `sample at ${pos.x},${pos.z}`).toBe(true);
        expect(Math.hypot(direction.x, direction.z)).toBeCloseTo(1);
        collision.moveCircle(pos, direction.x * 0.1, direction.z * 0.1, 0.4);
        expect(collision.isBlocked(pos, 0.4), `penetration at ${pos.x},${pos.z}`).toBe(false);
        expect(obstacles.some(obstacle => pointInAabb(pos, obstacle))).toBe(false);
      }
      expect(reached, `stopped at ${pos.x},${pos.z}, distance ${dist(pos, goal)}`).toBe(true);
    },
  );

  it('reports sealed interiors as unreachable, then finite after opening the gate', () => {
    const collision = compound();
    const nav = new NavigationGrid(collision);
    const field = nav.buildFlowField([{ x: 0.2, z: 15.2 }]);
    const inside = { x: 0.2, z: 0.2 };
    expect(field.distanceAt(inside)).toBe(Infinity);
    const direction = { x: 9, z: 9 };
    expect(field.sample(inside, direction)).toBe(false);
    expect(direction).toEqual({ x: 0, z: 0 });
    collision.setEnabled(collision.findByTag('gate')!.id, false);
    nav.rebuild();
    expect(field.distanceAt(inside)).toBe(Infinity);
    const rebuilt = nav.buildFlowField([{ x: 0.2, z: 15.2 }], field);
    expect(rebuilt).toBe(field);
    expect(rebuilt.navVersion).toBe(nav.version);
    expect(Number.isFinite(rebuilt.distanceAt(inside))).toBe(true);
  });

  it('recovers from a dilated unwalkable cell adjacent to a wall', () => {
    const collision = new CollisionWorld(bounds, [box(0, -15, 1, 15)]);
    const nav = new NavigationGrid(collision, 1, 0.6);
    const field = nav.buildFlowField([{ x: -5.5, z: 0.5 }]);
    const p = { x: -0.45, z: 0.5 };
    expect(collision.isBlocked(p, 0.4)).toBe(false);
    expect(nav.isWalkable(p)).toBe(false);
    const out = { x: 0, z: 0 };
    expect(field.sample(p, out)).toBe(true);
    expect(out.x).toBeLessThan(0);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(1);
    expect(Number.isFinite(field.distanceAt(p))).toBe(true);
  });

  it('uses octile world distances and multiple sources', () => {
    const nav = new NavigationGrid(new CollisionWorld(bounds, []), 1, 0.4);
    const field = nav.buildFlowField([{ x: -10.5, z: 0.5 }, { x: 10.5, z: 0.5 }]);
    expect(field).toBeInstanceOf(FlowField);
    expect(field.goals).toEqual([{ x: -10.5, z: 0.5 }, { x: 10.5, z: 0.5 }]);
    expect(field.distanceAt({ x: 8.5, z: 0.5 })).toBeCloseTo(2);
    expect(field.distanceAt({ x: 8.5, z: 2.5 })).toBeCloseTo(2 * Math.SQRT2);
    const out = { x: 0, z: 0 };
    field.sample({ x: -8.5, z: 0.5 }, out);
    expect(out.x).toBeLessThan(0);
    field.sample({ x: 8.5, z: 0.5 }, out);
    expect(out.x).toBeGreaterThan(0);
    expect(field.distanceAt({ x: 8.6, z: 0.5 })).toBeCloseTo(2.1);
  });

  it('snaps blocked goals and reuses distance/direction arrays', () => {
    const nav = new NavigationGrid(new CollisionWorld(bounds, [box(-2, -2, 2, 2)]), 1, 0.4);
    const field = nav.buildFlowField([{ x: 0, z: 0 }]);
    expect(nav.isWalkable(field.goals[0])).toBe(true);
    const distance = field.distance;
    const directionX = field.directionX;
    const directionZ = field.directionZ;
    expect(nav.buildFlowField([{ x: 10, z: 10 }], field)).toBe(field);
    expect(field.distance).toBe(distance);
    expect(field.directionX).toBe(directionX);
    expect(field.directionZ).toBe(directionZ);
    const other = new NavigationGrid(new CollisionWorld(bounds, []), 2, 0.4);
    expect(other.buildFlowField([{ x: 10, z: 10 }], field)).not.toBe(field);
  });

  it('includes the exact distance limit, excludes the next step, and handles zero and fractional bounds', () => {
    const nav = new NavigationGrid(new CollisionWorld(bounds, []), 1, 0.4);
    const goal = { x: 0.5, z: 0.5 };
    const field = nav.buildFlowField([goal], undefined, 2);
    const out = { x: 9, z: 9 };
    expect(field.distanceAt({ x: 2.5, z: 0.5 })).toBe(2);
    expect(field.sample({ x: 2.5, z: 0.5 }, out)).toBe(true);
    expect(field.distanceAt({ x: 2.5, z: 1.5 })).toBe(Infinity);
    expect(field.sample({ x: 2.5, z: 1.5 }, out)).toBe(false);
    expect(out).toEqual({ x: 0, z: 0 });
    nav.buildFlowField([goal], field, Math.SQRT2 - 0.01);
    expect(field.distanceAt({ x: 1.5, z: 0.5 })).toBe(1);
    expect(field.distanceAt({ x: 1.5, z: 1.5 })).toBe(Infinity);
    nav.buildFlowField([goal], field, 0);
    expect(field.distanceAt(goal)).toBe(0);
    expect(field.distanceAt({ x: 1.5, z: 0.5 })).toBe(Infinity);
    expect(field.sample(goal, out)).toBe(true);
    expect(out).toEqual({ x: 0, z: 0 });
    expect(() => nav.buildFlowField([goal], field, -1)).toThrow(RangeError);
    expect(() => nav.buildFlowField([goal], field, NaN)).toThrow(RangeError);
  });

  it('bounds path cost around obstacles rather than straight-line distance', () => {
    const nav = new NavigationGrid(new CollisionWorld(bounds, [box(0, -10, 1, 10)]), 1, 0.4);
    const goal = { x: -2.5, z: 0.5 }, acrossWall = { x: 2.5, z: 0.5 };
    const full = nav.buildFlowField([goal]);
    expect(full.distanceAt(acrossWall)).toBeGreaterThan(20);
    const field = nav.buildFlowField([goal], undefined, 10);
    expect(field.distanceAt(acrossWall)).toBe(Infinity);
    expect(field.distanceAt({ x: -5.5, z: 0.5 })).toBe(3);
  });

  it('returns false and zero for empty goals, deep obstacles and points outside the grid', () => {
    const nav = new NavigationGrid(new CollisionWorld(bounds, [box(-8, -8, 8, 8)]));
    const field = nav.buildFlowField([{ x: -15, z: -15 }]);
    const out = { x: 9, z: 9 };
    for (const p of [{ x: 0, z: 0 }, { x: -21, z: 0 }, { x: 21, z: 0 }]) {
      expect(field.sample(p, out)).toBe(false);
      expect(out).toEqual({ x: 0, z: 0 });
      expect(field.distanceAt(p)).toBe(Infinity);
    }
    const empty = nav.buildFlowField([], field);
    expect(empty.sample({ x: -15, z: -15 }, out)).toBe(false);
    expect(empty.distanceAt({ x: -15, z: -15 })).toBe(Infinity);
  });

  it('rejects samples outside real bounds even when the final grid cell is partial', () => {
    const world = new CollisionWorld({ minX: 0, minZ: 0, maxX: 10.9, maxZ: 10.9 }, []);
    const nav = new NavigationGrid(world, 1, 0.1);
    const field = nav.buildFlowField([{ x: 5.5, z: 5.5 }]);
    const out = { x: 0, z: 0 };
    expect(field.sample({ x: 10.7, z: 5.5 }, out)).toBe(true);
    for (const p of [{ x: 10.95, z: 5.5 }, { x: 5.5, z: 10.95 }]) {
      expect(nav.isWalkable(p)).toBe(false);
      expect(field.sample(p, out)).toBe(false);
      expect(field.distanceAt(p)).toBe(Infinity);
    }
  });

  it('blends continuously across cell boundaries and normalizes samples', () => {
    const nav = new NavigationGrid(new CollisionWorld(bounds, []), 1, 0.4);
    const field = nav.buildFlowField([{ x: 10.5, z: 10.5 }]);
    const a = { x: 0, z: 0 };
    const b = { x: 0, z: 0 };
    expect(field.sample({ x: 0.99999, z: 0.7 }, a)).toBe(true);
    expect(field.sample({ x: 1.00001, z: 0.7 }, b)).toBe(true);
    expect(dist(a, b)).toBeLessThan(0.001);
    expect(Math.hypot(a.x, a.z)).toBeCloseTo(1);
  });

  it('builds a district-sized field with sixty deterministic buildings within 30 ms', () => {
    const rng = mulberry32(1337);
    const buildings: ColliderDef[] = [];
    for (let i = 0; i < 60; i++) {
      const x = -113 + (i % 10) * 23 + randRange(rng, -1, 1);
      const z = -82 + Math.floor(i / 10) * 29 + randRange(rng, -1, 1);
      buildings.push(box(x, z, x + randRange(rng, 7, 15), z + randRange(rng, 8, 18)));
    }
    const nav = new NavigationGrid(new CollisionWorld({ minX: -120, minZ: -90, maxX: 120, maxZ: 90 }, buildings));
    expect(nav.cols).toBe(192);
    expect(nav.rows).toBe(144);
    // Warm the JS engine, then measure each of five complete shared-field rebuilds.
    let field = nav.buildFlowField([{ x: 115, z: 85 }]);
    for (let i = 0; i < 3; i++) field = nav.buildFlowField([{ x: 115, z: 85 }], field);
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      field = nav.buildFlowField([{ x: 115, z: 85 }], field);
      times.push(performance.now() - start);
    }
    const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
    expect(median, `flow builds (ms): ${times.join(", ")}`).toBeLessThan(30);
    expect(Number.isFinite(field.distanceAt({ x: -118, z: -88 }))).toBe(true);
    console.info(`Flow field 192x144, 60 buildings (ms): ${times.map(t => t.toFixed(2)).join(', ')}`);
  });
});
