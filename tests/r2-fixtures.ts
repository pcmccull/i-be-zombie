import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import type { Vec2, ZombieAgent } from '../src/core/types';
import { createZombie } from '../src/entities/Zombie';
import { Simulation } from '../src/sim/Simulation';
import { countFollowers, updateHorde } from '../src/systems/HordeSystem';
import { CollisionWorld } from '../src/world/CollisionWorld';
import { NavigationGrid } from '../src/world/NavigationGrid';

export const dt = BALANCE.sim.fixedDt;
export function flatSimulation(): Simulation {
  const sim = new Simulation();
  sim.state.zombies = []; sim.state.followerCount = 0; sim.state.guards = []; sim.state.structures = [];
  const bounds = { minX: -60, minZ: -30, maxX: 60, maxZ: 30 };
  sim.ctx.layout = { ...sim.ctx.layout, bounds, colliders: [], spawnZones: [], structures: [] };
  sim.ctx.collision = new CollisionWorld(bounds, []);
  sim.ctx.navGrid = new NavigationGrid(sim.ctx.collision);
  sim.ctx.crawlNavGrid = new NavigationGrid(sim.ctx.collision);
  sim.state.leader.pos = { x: -50, z: 0 };
  return sim;
}
export function zombie(sim: Simulation, x: number, z = 0, opts: Partial<ZombieAgent> = {}): ZombieAgent {
  const agent = createZombie(sim.ctx.newId(), { x, z }, {
    state: 'ambient', variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng,
  });
  Object.assign(agent, opts); sim.state.zombies.push(agent);
  if (agent.state === 'follower') sim.state.followerCount++;
  return agent;
}
export function pulseStep(sim: Simulation, seconds = dt): void {
  // Zero movement isolates recruitment geometry, but time advances at the normal fixed rate.
  sim.state.time += seconds; updateHorde(sim.ctx, 0, emptyInput());
  if (sim.state.followerCount !== countFollowers(sim.state)) throw new Error('Follower count drift');
}
export function distance(a: Vec2, b: Vec2): number { return Math.hypot(a.x - b.x, a.z - b.z); }
