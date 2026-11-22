import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import type { ColliderDef, ColliderKind, ZombieAgent } from '../src/core/types';
import { emptyInput } from '../src/core/types';
import { createZombie } from '../src/entities/Zombie';
import { updateLeader } from '../src/entities/ZombieLeader';
import { Simulation } from '../src/sim/Simulation';
import { applyHordeCommands, updateHorde } from '../src/systems/HordeSystem';
import { updateNavigation } from '../src/systems/NavigationSystem';
import { CollisionWorld, isCrawlable } from '../src/world/CollisionWorld';
import { buildLegacyDistrictLayout } from '../src/world/legacyDistrictLayout';
import { usePreBeachEconomy } from './support/preBeachEconomy';

usePreBeachEconomy();

const dt = BALANCE.sim.fixedDt;

/** A barrier across the whole district (z∈[-200,200]) at x∈[2,3] (so nobody can walk round it). */
function barrier(kind: ColliderKind, height: number): ColliderDef {
  return { minX: 2, maxX: 3, minZ: -200, maxZ: 200, kind, height, blocksMove: true, blocksSight: true };
}

function fixture(extra: ColliderDef[]): Simulation {
  const layout = buildLegacyDistrictLayout();
  layout.colliders = [...layout.colliders.filter(c => c.kind === 'gate'), ...extra];
  layout.structures = []; layout.spawnZones = []; layout.strongholds = []; layout.guards = [];
  const sim = new Simulation(layout, 7);
  sim.state.zombies = []; sim.state.followerCount = 0; sim.state.guards = [];
  sim.state.leader.pos = { x: -10, z: 0 }; sim.state.leader.prevPos = { x: -10, z: 0 }; sim.state.leader.facing = 0;
  return sim;
}

function follower(sim: Simulation, x: number, z = 0): ZombieAgent {
  const agent = createZombie(sim.ctx.newId(), { x, z }, {
    state: 'follower', variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng,
  });
  Object.assign(agent, { speedScale: 1, followOffset: { x: 0, z: 0 } });
  sim.state.zombies.push(agent); sim.state.followerCount++;
  return agent;
}

/** Walk the Alpha toward +X (camera yaw π/2 looks along +X). Returns the highest elevation reached. */
function walkLeaderEast(sim: Simulation, seconds: number): number {
  const input = { ...emptyInput(), moveForward: 1, cameraYaw: Math.PI / 2 };
  let top = 0;
  for (let i = 0; i < seconds / dt; i++) { updateLeader(sim.ctx, dt, input); top = Math.max(top, sim.state.leader.elevation); }
  return top;
}

describe('climbing over car-height obstacles', () => {
  it('climbable = car-height vehicles, props and walls; never tall walls, buildings, gates, breakables or the edge', () => {
    const c = (kind: ColliderKind, height: number) => new CollisionWorld(
      { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, [barrier(kind, height)]).colliders[0];
    expect(isCrawlable(c('vehicle', 1.7))).toBe(true);
    expect(isCrawlable(c('prop', 1.4))).toBe(true);
    expect(isCrawlable(c('wall', 1.1))).toBe(true);
    expect(isCrawlable(c('wall', BALANCE.horde.crawlMaxHeight))).toBe(true);
    expect(isCrawlable(c('wall', 2.4))).toBe(false);
    expect(isCrawlable(c('vehicle', 3.2))).toBe(false); // bus shell
    for (const kind of ['building', 'gate', 'tower', 'breakable', 'boundary'] as const) expect(isCrawlable(c(kind, 1))).toBe(false);
  });

  it('a lone follower climbs over a short wall to follow the Alpha (no pack needed)', () => {
    const sim = fixture([barrier('wall', 1.1)]);
    sim.state.leader.pos = { x: 12, z: 0 };
    const z = follower(sim, -2);
    let top = 0;
    for (let i = 0; i < 600; i++) {
      applyHordeCommands(sim.ctx, dt, emptyInput()); updateNavigation(sim.ctx, dt, emptyInput()); updateHorde(sim.ctx, dt, emptyInput());
      top = Math.max(top, z.elevation);
    }
    expect(z.pos.x).toBeGreaterThan(5);
    expect(top).toBeGreaterThan(0.8);
    expect(z.elevation).toBe(0); // back down on the far side
  });

  it('a follower cannot climb a compound-height wall', () => {
    const sim = fixture([barrier('wall', 2.4)]);
    sim.state.leader.pos = { x: 12, z: 0 };
    const z = follower(sim, -2);
    for (let i = 0; i < 600; i++) {
      applyHordeCommands(sim.ctx, dt, emptyInput()); updateNavigation(sim.ctx, dt, emptyInput()); updateHorde(sim.ctx, dt, emptyInput());
    }
    expect(z.pos.x).toBeLessThan(2);
    expect(z.elevation).toBe(0);
  });

  it('the Alpha climbs over a parked car and a short wall, and comes back down', () => {
    for (const obstacle of [barrier('vehicle', 1.7), barrier('wall', 1.1)]) {
      const sim = fixture([obstacle]);
      sim.state.leader.pos = { x: 0, z: 0 };
      const top = walkLeaderEast(sim, 3);
      expect(sim.state.leader.pos.x).toBeGreaterThan(5);
      expect(top).toBeCloseTo(obstacle.height, 1);
      expect(sim.state.leader.elevation).toBe(0);
      expect(sim.ctx.collision.isBlocked(sim.state.leader.pos, sim.state.leader.radius)).toBe(false);
    }
  });

  it('the Alpha is stopped by a tall wall', () => {
    const sim = fixture([barrier('wall', 2.4)]);
    sim.state.leader.pos = { x: 0, z: 0 };
    expect(walkLeaderEast(sim, 3)).toBe(0);
    expect(sim.state.leader.pos.x).toBeLessThan(2);
  });
});
