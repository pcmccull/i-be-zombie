import { describe, expect, it, vi } from 'vitest';
import { VISION_EDGE_BAND } from '../src/core/visionMath';
import { BALANCE } from '../src/config/balance';
import type { ColliderDef, GameEvent, GuardAgent, Vec2, VisionTier } from '../src/core/types';
import { createGuard } from '../src/entities/HumanGuard';
import { Simulation } from '../src/sim/Simulation';
import { awarenessOf, canTarget, isIdentified, isSeen, isWorldPositionInSight, updateAwareness, visionProfile } from '../src/systems/AwarenessSystem';
import { CollisionWorld } from '../src/world/CollisionWorld';
import { buildLegacyDistrictLayout } from '../src/world/legacyDistrictLayout';

const period = 1 / BALANCE.vision.updateHz;
const C1 = BALANCE.vision.tiers[0].clearRadius; // tier-1 clear sight radius
function fixture(tier: VisionTier = 1, colliders: ColliderDef[] = []) {
  const sim = new Simulation(buildLegacyDistrictLayout(), 123);
  sim.state.guards = []; sim.state.zombies = []; sim.state.followerCount = 0;
  sim.state.leader.pos = { x: 0, z: 0 }; sim.state.leader.prevPos = { x: 0, z: 0 };
  sim.state.progression.visionTier = tier;
  sim.ctx.collision = new CollisionWorld({ minX: -200, maxX: 200, minZ: -200, maxZ: 200 }, colliders);
  return sim;
}
function human(sim: Simulation, x: number, z = 0, options: Partial<GuardAgent> = {}) {
  const g = createGuard(sim.ctx.newId(), { pos: { x, z }, facing: 0, tower: null, waypoints: [], post: 'street' }, sim.ctx.collision);
  Object.assign(g, options); sim.state.guards.push(g); return g;
}
function tick(sim: Simulation, dt = period, events: readonly GameEvent[] = []) {
  sim.state.time += dt; updateAwareness(sim.ctx, dt, events);
}
function shot(g: GuardAgent, to: Vec2 = { x: 0, z: 0 }): GameEvent {
  return { type: 'shot', guardId: g.id, from: { ...g.pos, y: 1.5 }, to: { ...to, y: 1.1 }, hit: true };
}
const wall: ColliderDef = { minX: 2, maxX: 3, minZ: -10, maxZ: 10, height: 8,
  blocksMove: true, blocksSight: true, kind: 'building', tag: 'test-building' };

describe('vision profiles and queries', () => {
  it.each([1, 2, 3, 4] as const)('maps tier %i exactly to balance', tier => {
    const b = BALANCE.vision.tiers[tier - 1];
    expect(visionProfile(tier)).toEqual({ tier, ...b, detectMovingHumans: b.movingDetectRadius > 0,
      detectDefenses: b.defenseRadius > 0, detectReinforcements: b.reinforcementRadius > 0 });
  });

  it('has no camera input and equal results under fake camera changes', () => {
    const a = fixture(), b = fixture();
    for (const sim of [a, b]) { human(sim, C1 * 2 / 3); human(sim, C1 * 4 / 3); }
    Object.assign(a.state, { camera: { zoom: 1, position: { x: 0, z: 0 } } });
    Object.assign(b.state, { camera: { zoom: 100, position: { x: 900, z: 900 } } });
    tick(a); tick(b);
    expect(updateAwareness.length).toBe(3);
    expect(a.state.vision).toEqual(b.state.vision);
    expect(a.state.vision.identified).toHaveLength(1);
    expect(isWorldPositionInSight(a.state, { x: C1, z: 0 })).toBe(true);
    expect(isWorldPositionInSight(a.state, { x: C1 + 0.01, z: 0 })).toBe(false);
    a.state.leader.pos.x = 20;
    expect(isWorldPositionInSight(a.state, { x: 30, z: 0 })).toBe(true);
  });

  it('grows identification with tier and copies the tier even between scans', () => {
    const sim = fixture();
    for (const x of [10, 25, 40, 59]) human(sim, x);
    for (const tier of [1, 2, 3, 4] as const) {
      sim.state.progression.visionTier = tier; tick(sim);
      expect(sim.state.vision.tier).toBe(tier);
      expect(sim.state.vision.identified).toHaveLength(tier);
    }
    sim.state.progression.visionTier = 1; tick(sim, 0.001);
    expect(sim.state.vision.tier).toBe(1);
  });
});

describe('identification, engagement and silhouettes', () => {
  it('respects walls except inside alwaysRadius, with height-aware LOS', () => {
    const sim = fixture(1, [wall]), close = human(sim, 5), hidden = human(sim, 12);
    const spy = vi.spyOn(sim.ctx.collision, 'segmentBlocked'); tick(sim);
    expect(isIdentified(sim.state, close.id)).toBe(true);
    expect(isIdentified(sim.state, hidden.id)).toBe(false);
    expect(isWorldPositionInSight(sim.state, hidden.pos)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][2]).toMatchObject({ mode: 'sight', fromHeight: BALANCE.vision.eyeHeight, toHeight: 1.5 });
    hidden.tower = 'W'; hidden.elevation = 4; close.pos.x = -100;
    // Move the wall near the elevated endpoint, so the sight ray passes over it.
    sim.ctx.collision = new CollisionWorld(sim.ctx.collision.bounds, [{ ...wall, minX: 7, maxX: 8, height: 2.4 }]);
    tick(sim);
    expect(isIdentified(sim.state, hidden.id)).toBe(true);
  });

  it('ignores a tower occupant own support collider', () => {
    const sim = fixture(1, [{ ...wall, kind: 'tower', tag: 'towerW', minX: 9, maxX: 11, minZ: -1, maxZ: 1 }]);
    const g = human(sim, 10, 0, { tower: 'W', elevation: 4, towerColliderId: sim.ctx.collision.colliders[0].id });
    tick(sim); expect(isIdentified(sim.state, g.id)).toBe(true);
  });

  it('remembers a shooter through cover to twice clearRadius, then expires', () => {
    const sim = fixture(1, [wall]), g = human(sim, 2 * C1 - 1);
    tick(sim, period, [shot(g)]); expect(isIdentified(sim.state, g.id)).toBe(true);
    g.pos.x = 2 * C1 + 0.01; tick(sim); expect(isIdentified(sim.state, g.id)).toBe(false);
    g.pos.x = 2 * C1; tick(sim); expect(isIdentified(sim.state, g.id)).toBe(true);
    tick(sim, BALANCE.vision.engagedMemory); expect(isIdentified(sim.state, g.id)).toBe(false);
  });

  it('recognizes misses near a follower, but ignores shots aimed at ambient zombies', () => {
    const sim = fixture(), g = human(sim, 2 * C1 - 1);
    const followerSim = new Simulation(buildLegacyDistrictLayout(), 42);
    const z = followerSim.state.zombies.find(zombie => zombie.state === 'follower')!;
    z.pos = { x: -40, z: 20 }; sim.state.zombies.push(z); sim.state.followerCount = 1;
    tick(sim, period, [shot(g, { x: -39, z: 20 })]); expect(canTarget(sim.state, g.id)).toBe(true);
    tick(sim, BALANCE.vision.engagedMemory + period);
    z.state = 'ambient'; g.target = { kind: 'zombie', id: z.id };
    tick(sim, period, [shot(g, z.pos)]); expect(canTarget(sim.state, g.id)).toBe(false);
    // Damage events do not contain shooter identity and must not implicate arbitrary guards.
    tick(sim, period, [{ type: 'damage', target: { kind: 'leader' }, amount: 5, pos: sim.state.leader.pos }]);
    expect(canTarget(sim.state, g.id)).toBe(false);
  });

  it('every human inside the rendered vision limit is seen (not targetable); beyond it none, at every tier', () => {
    for (const tier of [1, 2, 3, 4] as VisionTier[]) {
      const limit = BALANCE.vision.tiers[tier - 1].hazeRadius * (1 + VISION_EDGE_BAND);
      const sim = fixture(tier, [wall]);
      const inside = human(sim, -(limit - 1)), occluded = human(sim, 25), outside = human(sim, 0, limit + 1);
      tick(sim);
      expect(awarenessOf(sim.state, inside.id)).toBe('seen'); expect(canTarget(sim.state, inside.id)).toBe(false);
      expect(isSeen(sim.state, occluded.id)).toBe(true); // like a tree behind a wall: the world isn't LOS-gated
      expect(awarenessOf(sim.state, outside.id)).toBe('none');
    }
  });

  it('tier 2 still sees moving humans with LOS out to movingDetectRadius', () => {
    const sim = fixture(2), moving = human(sim, 35, 0, { vel: { x: 1, z: 0 } });
    tick(sim);
    expect(awarenessOf(sim.state, moving.id)).toBe('seen'); expect(canTarget(sim.state, moving.id)).toBe(false);
  });

  it('tier 3 sees defenses without LOS; tier 4 sees only new reinforcement wave humans', () => {
    const sim = fixture(3, [wall]), defender = human(sim, 65, 0, { strongholdId: 'suburb_checkpoint' });
    const oldPatrol = human(sim, 130, 0, { post: 'patrol' }); // past the tier-4 vision limit (~123 m)
    tick(sim); expect(isSeen(sim.state, defender.id)).toBe(true);
    expect(canTarget(sim.state, defender.id)).toBe(false);
    const wave = human(sim, 130, 0, { post: 'patrol' }), street = human(sim, 130);
    const event: GameEvent = { type: 'reinforcements', pos: wave.pos, districtId: 'suburbs', strongholdId: null, count: 1 };
    tick(sim, period, [event]); expect(isSeen(sim.state, wave.id)).toBe(false);
    sim.state.progression.visionTier = 4; tick(sim);
    expect(isSeen(sim.state, wave.id)).toBe(true); expect(isSeen(sim.state, oldPatrol.id)).toBe(false);
    expect(isSeen(sim.state, street.id)).toBe(false);
    wave.pos.x = 141; tick(sim); expect(isSeen(sim.state, wave.id)).toBe(false);
  });

  it.each(['dead', 'respawning'] as const)('%s leader retains only engaged humans and no seen ids', mode => {
    const sim = fixture(3), near = human(sim, 2), engaged = human(sim, 70);
    human(sim, 65, 0, { strongholdId: 'suburb_checkpoint' });
    tick(sim, period, [shot(engaged)]); expect(isIdentified(sim.state, near.id)).toBe(true);
    if (mode === 'dead') sim.state.leader.alive = false; else sim.state.phase = 'respawning';
    tick(sim, 0.001);
    expect(sim.state.vision.identified).toEqual([engaged.id]); expect(sim.state.vision.seen).toEqual([]);
    tick(sim, BALANCE.vision.engagedMemory); expect(sim.state.vision.identified).toEqual([]);
  });

  it('excludes dead/dormant humans and maintains sorted disjoint arrays in place with revisions', () => {
    const sim = fixture(3), a = human(sim, 10), b = human(sim, 20), c = human(sim, 65, 0, { strongholdId: 'suburb_checkpoint' });
    human(sim, 2, 0, { hp: 0 }); human(sim, 2, 0, { state: 'DEAD' }); human(sim, 2, 0, { dormant: true });
    sim.state.guards.reverse(); const identified = sim.state.vision.identified, seen = sim.state.vision.seen;
    tick(sim); expect(identified).toEqual([a.id, b.id]); expect(seen).toEqual([c.id]);
    expect(sim.state.vision.revision).toBe(1); tick(sim); expect(sim.state.vision.revision).toBe(1);
    c.pos.x = 10; tick(sim); expect(sim.state.vision.revision).toBe(2);
    expect(sim.state.vision.identified).toBe(identified); expect(sim.state.vision.seen).toBe(seen);
    expect(awarenessOf(sim.state, c.id)).toBe('identified');
  });
});

describe('bounded perception updates', () => {
  it('updates immediately then at updateHz, with round-robin LOS coverage of 300 humans', () => {
    const sim = fixture();
    for (let i = 0; i < 300; i++) human(sim, 10 + (i % 8) * 0.1, Math.floor(i / 8) * 0.1);
    const spy = vi.spyOn(sim.ctx.collision, 'segmentBlocked');
    tick(sim, 0); expect(spy).toHaveBeenCalledTimes(BALANCE.vision.maxLosChecksPerUpdate);
    expect(sim.state.vision.identified).toHaveLength(BALANCE.vision.maxLosChecksPerUpdate);
    spy.mockClear(); tick(sim, period / 2); expect(spy).not.toHaveBeenCalled();
    tick(sim, period / 2); expect(spy.mock.calls.length).toBeLessThanOrEqual(BALANCE.vision.maxLosChecksPerUpdate);
    for (let i = 0; i < 6; i++) {
      spy.mockClear(); tick(sim); expect(spy.mock.calls.length).toBeLessThanOrEqual(BALANCE.vision.maxLosChecksPerUpdate);
    }
    expect(sim.state.vision.identified).toHaveLength(300);
    expect(new Set(spy.mock.calls.map(call => call[1])).size).toBe(BALANCE.vision.maxLosChecksPerUpdate);
  });

  it('is deterministic and keeps separate state caches across reset', () => {
    const a = fixture(4), b = fixture(4);
    for (const sim of [a, b]) for (let i = 0; i < 80; i++) human(sim, 10 + i);
    for (let i = 0; i < 12; i++) { tick(a); tick(b); expect(a.state.vision).toEqual(b.state.vision); }
    a.reset(123); a.state.guards = []; a.state.leader.pos = { x: 0, z: 0 };
    const g = human(a, 35); tick(a); expect(canTarget(a.state, g.id)).toBe(false);
  });
});
