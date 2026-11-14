import { describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../src/config/balance';
import type { ColliderDef } from '../src/core/types';
import { emptyInput } from '../src/core/types';
import { Simulation } from '../src/sim/Simulation';
import { updateNavigation } from '../src/systems/NavigationSystem';
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

function worldSimulation(colliders: ColliderDef[] = []) {
  const sim = new Simulation();
  const bounds = { minX: -200, minZ: -160, maxX: 200, maxZ: 160 };
  sim.ctx.layout = { ...sim.ctx.layout, bounds, colliders };
  sim.ctx.collision = new CollisionWorld(bounds, colliders);
  sim.ctx.navGrid = new NavigationGrid(sim.ctx.collision);
  sim.ctx.crawlNavGrid = new NavigationGrid(sim.ctx.collision);
  sim.state.leader.pos = { x: -150.625, z: -0.625 };
  sim.state.gate.destroyed = true;
  const guard = sim.state.guards[5];
  guard.pos = { x: 150.625, z: -0.625 };
  guard.shelter = 0; guard.towerColliderId = null;
  return { sim, guard };
}

describe('bounded navigation planning regressions', () => {
  it('bounds follow guidance but reaches distant main and squad guard orders', () => {
    const { sim, guard } = worldSimulation();
    const target = { kind: 'guard' as const, id: guard.id };
    sim.state.order = { type: 'attack', target };
    sim.state.squads = [{ id: 1, target }];
    const build = vi.spyOn(sim.ctx.navGrid, 'buildFlowField');
    updateNavigation(sim.ctx, BALANCE.sim.fixedDt, emptyInput());
    const bound = Math.hypot(guard.pos.x - sim.state.leader.pos.x, guard.pos.z - sim.state.leader.pos.z) + 60;
    expect(build.mock.calls.map(args => args[2])).toEqual([BALANCE.nav.flowFieldMaxDistance, bound, bound]);
    expect(sim.ctx.nav.followField!.distanceAt(guard.pos)).toBe(Infinity);
    expect(Number.isFinite(sim.ctx.nav.attackField!.distanceAt(sim.state.leader.pos))).toBe(true);
    expect(Number.isFinite(sim.ctx.nav.squads.get(1)!.attackField!.distanceAt(sim.state.leader.pos))).toBe(true);
    expect(sim.ctx.nav.effectiveTarget).toEqual(target);
  });

  it('bounds structure orders and keeps the configured minimum for close targets', () => {
    const { sim, guard } = worldSimulation();
    const structure = sim.state.structures[0];
    const def = sim.ctx.layout.structures.find(d => d.id === structure.id)!;
    structure.center = { x: 150.625, z: -0.625 };
    def.approachOutside = [{ x: 148.125, z: -0.625 }];
    const build = vi.spyOn(sim.ctx.navGrid, 'buildFlowField');
    sim.state.order = { type: 'attack', target: { kind: 'structure', id: structure.id } };
    updateNavigation(sim.ctx, BALANCE.sim.fixedDt, emptyInput());
    expect(build.mock.calls.at(-1)![2]).toBe(361.25);
    expect(Number.isFinite(sim.ctx.nav.attackField!.distanceAt(sim.state.leader.pos))).toBe(true);
    guard.pos = { x: -140.625, z: -0.625 };
    sim.state.order = { type: 'attack', target: { kind: 'guard', id: guard.id } };
    updateNavigation(sim.ctx, BALANCE.sim.fixedDt, emptyInput());
    expect(build.mock.calls.at(-1)![2]).toBe(BALANCE.nav.flowFieldMaxDistance);
  });

  it('redirects a distant enclosed guard to the gate beyond the follow-field bound', () => {
    const gate = { ...box(140, -2, 141, 2), kind: 'gate' as const, tag: 'gate' };
    const { sim, guard } = worldSimulation([box(140, -10, 160, -9), box(140, 9, 160, 10),
      box(159, -10, 160, 10), box(140, -10, 141, -2), box(140, 2, 141, 10), gate]);
    const cp = sim.ctx.layout.checkpoint;
    cp.gate = { rect: gate, facing: -Math.PI / 2, tag: 'gate' };
    cp.gateApproachOutside = [{ x: 138.125, z: -0.625 }];
    cp.gateApproachInside = [{ x: 143.125, z: -0.625 }];
    sim.state.gate.destroyed = false;
    sim.state.gate.center = { x: 140.5, z: 0 };
    sim.state.order = { type: 'attack', target: { kind: 'guard', id: guard.id } };
    const build = vi.spyOn(sim.ctx.navGrid, 'buildFlowField');
    updateNavigation(sim.ctx, BALANCE.sim.fixedDt, emptyInput());
    expect(sim.ctx.nav.followField!.distanceAt(cp.gateApproachOutside[0])).toBe(Infinity);
    expect(sim.ctx.nav.effectiveTarget).toEqual({ kind: 'gate' });
    expect(Number.isFinite(sim.ctx.nav.attackField!.distanceAt(sim.state.leader.pos))).toBe(true);
    expect(build).toHaveBeenCalledTimes(3); // Follow, guard, then the retained gate field.
    sim.state.order = { type: 'attack', target: { kind: 'gate' } };
    updateNavigation(sim.ctx, BALANCE.sim.fixedDt, emptyInput());
    expect(build.mock.calls.at(-1)![2]).toBe(Math.hypot(291.125, 0.625) + 60);
  });
});
