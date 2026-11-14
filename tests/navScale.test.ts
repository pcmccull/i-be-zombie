import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import type { AABB, Collider, ColliderDef, Vec2 } from '../src/core/types';
import { CollisionWorld } from '../src/world/CollisionWorld';
import { NavigationGrid } from '../src/world/NavigationGrid';

const bounds: AABB = { minX: -200, minZ: -160, maxX: 200, maxZ: 160 };
const goal: Vec2 = { x: -0.625, z: -0.625 };

/** 32 x 32 blocks with continuous streets; independent of the in-progress world layout. */
function city(withExtraProps = false): ColliderDef[] {
  const defs: ColliderDef[] = [];
  for (let row = 0; row < 32; row++) {
    for (let col = 0; col < 32; col++) {
      const x = bounds.minX + col * 12.5, z = bounds.minZ + row * 10;
      defs.push({ minX: x + 3.125, maxX: x + 9.375, minZ: z + 2.5, maxZ: z + 7.5,
        kind: (row + col) % 4 === 0 ? 'prop' : 'building', height: 8, blocksMove: true, blocksSight: true });
      if (withExtraProps && col % 2 === 0) {
        defs.push({ minX: x + 10.5, maxX: x + 11.5, minZ: z + 4, maxZ: z + 6,
          kind: 'prop', height: 1, blocksMove: true, blocksSight: false });
      }
    }
  }
  return defs;
}

describe('world-scale navigation', () => {
  it('matches the full field within the bound and exposes no cells past the bound', () => {
    const nav = new NavigationGrid(new CollisionWorld(bounds, city()));
    expect([nav.cols, nav.rows]).toEqual([320, 256]);
    const full = nav.buildFlowField([goal]);
    const bounded = nav.buildFlowField([goal], undefined, BALANCE.nav.flowFieldMaxDistance);
    const a = { x: 0, z: 0 }, b = { x: 0, z: 0 };
    let inside = 0, outside = 0, mismatches = 0;
    for (let row = 0; row < nav.rows; row++) {
      for (let col = 0; col < nav.cols; col++) {
        const p = { x: bounds.minX + (col + 0.5) * nav.cellSize, z: bounds.minZ + (row + 0.5) * nav.cellSize };
        if (!nav.isWalkable(p)) continue;
        const distance = full.distanceAt(p);
        if (distance <= BALANCE.nav.flowFieldMaxDistance) {
          inside++;
          if (bounded.distanceAt(p) !== distance || !bounded.sample(p, a) || !full.sample(p, b) ||
              Math.hypot(a.x - b.x, a.z - b.z) > 1e-6) mismatches++;
        } else {
          outside++;
          a.x = 9; a.z = 9;
          if (bounded.distanceAt(p) !== Infinity || bounded.sample(p, a) || a.x !== 0 || a.z !== 0) mismatches++;
        }
      }
    }
    expect(inside).toBeGreaterThan(10000);
    expect(outside).toBeGreaterThan(10000);
    expect(mismatches).toBe(0);
  });

  it('clears distances, directions and goal indices when reusing a larger field', () => {
    const nav = new NavigationGrid(new CollisionWorld(bounds, city()));
    const oldGoal = { x: 185.625, z: 149.375 };
    const field = nav.buildFlowField([oldGoal]);
    const distance = field.distance, directionX = field.directionX, directionZ = field.directionZ;
    const fullReachable = field.distance.reduce((count, value) => count + +Number.isFinite(value), 0);
    expect(nav.buildFlowField([goal], field, 20)).toBe(field);
    expect(field.distance).toBe(distance);
    expect(field.directionX).toBe(directionX);
    expect(field.directionZ).toBe(directionZ);
    expect(field.distanceAt(oldGoal)).toBe(Infinity);
    let reachable = 0, stale = 0;
    for (let i = 0; i < field.distance.length; i++) {
      if (Number.isFinite(field.distance[i])) { reachable++; continue; }
      if (field.directionX[i] !== 0 || field.directionZ[i] !== 0 || field.goalIndex[i] !== -1) stale++;
    }
    expect(reachable).toBeGreaterThan(0);
    expect(reachable).toBeLessThan(fullReachable / 10);
    expect(stale).toBe(0);
    const out = { x: 9, z: 9 };
    expect(field.sample(oldGoal, out)).toBe(false);
    expect(out).toEqual({ x: 0, z: 0 });
    nav.buildFlowField([], field, 20);
    expect(field.distance.every(value => value === Infinity)).toBe(true);
    nav.buildFlowField([oldGoal], field);
    expect(Number.isFinite(field.distanceAt(goal))).toBe(true);
  });

  it('rebuilds bounded follow fields within the world-scale budget over twenty builds', () => {
    const nav = new NavigationGrid(new CollisionWorld(bounds, city()));
    let field = nav.buildFlowField([goal], undefined, BALANCE.nav.flowFieldMaxDistance);
    for (let i = 0; i < 5; i++) field = nav.buildFlowField([goal], field, BALANCE.nav.flowFieldMaxDistance);
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const target = { x: goal.x + (i - 10) * nav.cellSize, z: goal.z };
      const start = performance.now();
      field = nav.buildFlowField([target], field, BALANCE.nav.flowFieldMaxDistance);
      times.push(performance.now() - start);
    }
    const average = times.reduce((sum, time) => sum + time, 0) / times.length;
    console.info(`Bounded flow 320x256, 1024 colliders, 20 builds: average ${average.toFixed(2)} ms (target < 6 ms)`);
    expect(average, `average ${average.toFixed(2)} ms; builds: ${times.map(t => t.toFixed(2)).join(', ')}`).toBeLessThan(25);
    expect(Number.isFinite(field.distanceAt(goal))).toBe(true);
  });

  it('finds a collision-safe path across the synthetic world', () => {
    const collision = new CollisionWorld(bounds, city());
    const nav = new NavigationGrid(collision);
    const start = { x: -198.125, z: -158.125 }, end = { x: 198.125, z: 158.125 };
    const path = nav.findPath(start, end);
    expect(path).not.toBeNull();
    expect(path!.at(-1)).toEqual(end);
    let previous = start;
    for (const point of path!) {
      expect(nav.hasClearWalk(previous, point)).toBe(true);
      expect(collision.segmentBlocked(previous, point, { mode: 'move' })).toBe(false);
      previous = point;
    }
  });

  it('keeps reusable local broad-phase queries correct with 1536 colliders', () => {
    const collision = new CollisionWorld(bounds, city(true));
    expect(collision.colliders).toHaveLength(1536);
    const out: Collider[] = [];
    const queries: AABB[] = [];
    for (let i = 0; i < 1000; i++) {
      const x = bounds.minX + (i * 37 % 400), z = bounds.minZ + (i * 53 % 320);
      queries.push({ minX: x - 2, minZ: z - 2, maxX: x + 2, maxZ: z + 2 });
    }
    for (const query of queries.slice(0, 20)) {
      expect(collision.queryAABB(query, out)).toBe(out);
      const expected = collision.colliders.filter(c => c.minX <= query.maxX && c.maxX >= query.minX &&
        c.minZ <= query.maxZ && c.maxZ >= query.minZ).map(c => c.id).sort((a, b) => a - b);
      expect(out.map(c => c.id).sort((a, b) => a - b)).toEqual(expected);
    }
    // Measure just the existing reusable query API, excluding assertions/fixtures.
    let totalCandidates = 0;
    const start = performance.now();
    for (let repeat = 0; repeat < 20; repeat++) {
      for (const query of queries) totalCandidates += collision.queryAABB(query, out).length;
    }
    const elapsed = performance.now() - start;
    console.info(`Collision broad phase, 1536 colliders: 20000 local queries in ${elapsed.toFixed(2)} ms; ` +
      `${(totalCandidates / 20000).toFixed(2)} results/query`);
    expect(totalCandidates).toBeGreaterThan(0);
  });
});
