import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import { applyHordeCommands, killZombie, recruitZombie, updateHorde } from '../src/systems/HordeSystem';
import { addMomentum } from '../src/systems/MomentumSystem';
import { Simulation } from '../src/sim/Simulation';
import { CollisionWorld } from '../src/world/CollisionWorld';
import { updateNavigation } from '../src/systems/NavigationSystem';
import { dt, flatSimulation, pulseStep, zombie } from './r2-fixtures';

describe('cascading recruitment', () => {
  it('regroups distant disengaged followers with the follow field instead of their personal offset', () => {
    const sim = flatSimulation();
    // This offset points away from the leader, beyond the follower's current position.
    const z = zombie(sim, -20, 0, { state: 'follower', followOffset: { x: 35, z: 0 }, speedScale: 1 });
    sim.state.leader.facing = 0;
    updateNavigation(sim.ctx, dt, emptyInput());
    for (let i = 0; i < 60; i++) updateHorde(sim.ctx, dt, emptyInput());
    // Steering toward the offset would move +x; the follow field moves -x at catch-up speed. Velocity ramps at
    // 12 m/s^2, so 1 s covers v - v^2/24 meters.
    // Catch-up speed: personal speed x catchUpMultiplier, floored at leader walk x catchUpLeaderMargin (momentum 0).
    const v = Math.max(BALANCE.walker.speed * BALANCE.walker.catchUpMultiplier,
      BALANCE.leader.walkSpeed * BALANCE.walker.catchUpLeaderMargin);
    expect(z.pos.x).toBeLessThan(-20 - (v - v * v / 24) + 0.1);
    expect(Math.hypot(z.vel.x, z.vel.z)).toBeCloseTo(v);
  });

  it('keeps held wandering inside its zone and independent of leader position', () => {
    const sim = flatSimulation();
    const rect = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };
    sim.ctx.layout.spawnZones = [{ name: 'held', rect, count: 1, heldBy: 1 }];
    const z = zombie(sim, 0, 0, { spawnZone: 0, heldBy: 1 });
    for (let i = 0; i < 1200; i++) {
      sim.state.leader.pos.x = i % 2 === 0 ? -1 : 1;
      updateHorde(sim.ctx, dt, emptyInput());
      expect(z.state).toBe('ambient');
      expect(z.pos.x >= rect.minX && z.pos.x <= rect.maxX && z.pos.z >= rect.minZ && z.pos.z <= rect.maxZ).toBe(true);
    }
  });
  it('recruits generations 0 through 3, staggers once, and never loops or pulses beyond the depth limit', () => {
    const sim = flatSimulation(); sim.ctx.rng = { next: () => 0.5 };
    const chain = [0, 9.8, 19.6, 29.4, 39.2].map(x => zombie(sim, x));
    sim.state.leader.pos = { x: -8, z: 0 };
    updateHorde(sim.ctx, 0, emptyInput());
    expect(chain[0].recruitGen).toBe(0);
    expect(chain[0].pulseAt).toBeGreaterThanOrEqual(BALANCE.recruitPulse.delayMin);
    expect(chain[0].pulseAt).toBeLessThanOrEqual(BALANCE.recruitPulse.delayMax);
    sim.state.leader.pos.x = -50;
    for (let i = 0; i < 180; i++) pulseStep(sim);
    expect(chain.map(z => z.recruitGen)).toEqual([0, 1, 2, 3, -1]);
    expect(chain.map(z => z.pulseAt)).toEqual([-1, -1, -1, -1, -1]);
    const pulses = sim.drainEvents().filter(e => e.type === 'recruitPulse');
    expect(pulses.map(e => e.zombieId)).toEqual(chain.slice(0, 3).map(z => z.id));
    expect(sim.state.stats.recruited).toBe(4); expect(sim.state.stats.cascadeRecruits).toBe(3);
    for (let i = 0; i < 600; i++) pulseStep(sim);
    expect(sim.drainEvents().filter(e => e.type === 'recruitPulse')).toHaveLength(0);
  });

  it('uses the full configured stagger interval and fires all simultaneous due pulses even when empty', () => {
    for (const roll of [0, 0.999999]) {
      const sim = flatSimulation(); const a = zombie(sim, 0), b = zombie(sim, 25);
      sim.ctx.rng = { next: () => roll }; recruitZombie(sim.ctx, a, false); recruitZombie(sim.ctx, b, false);
      const due = BALANCE.recruitPulse.delayMin + roll * (BALANCE.recruitPulse.delayMax - BALANCE.recruitPulse.delayMin);
      expect(a.pulseAt).toBeCloseTo(due);
      sim.state.time = due - 0.00001; updateHorde(sim.ctx, 0, emptyInput());
      expect(sim.drainEvents().filter(e => e.type === 'recruitPulse')).toHaveLength(0);
      pulseStep(sim, 0.00002);
      expect(sim.drainEvents().filter(e => e.type === 'recruitPulse')).toMatchObject([{ recruits: 0 }, { recruits: 0 }]);
    }
  });

  it('recruits closest first, bounds each pulse, and reserves rising capacity during a large cascade', () => {
    const sim = flatSimulation(); const a = zombie(sim, 0); recruitZombie(sim.ctx, a, false);
    const nearby = Array.from({ length: 20 }, (_, i) => zombie(sim, 8 - i * 0.3));
    sim.state.time = a.pulseAt; updateHorde(sim.ctx, 0, emptyInput());
    expect(nearby.slice(-8).every(z => z.state === 'follower')).toBe(true);
    expect(nearby.slice(0, -8).every(z => z.state === 'ambient')).toBe(true);
    expect(sim.drainEvents().filter(e => e.type === 'recruitPulse')).toMatchObject([{ recruits: 8 }]);
    for (let i = 0; i < 88; i++) zombie(sim, -20, i * 0.01, { state: 'rising' });
    for (let i = 0; i < 300; i++) {
      pulseStep(sim);
      expect(sim.state.followerCount + 88).toBeLessThanOrEqual(BALANCE.horde.maxFollowers);
    }
    expect(sim.state.followerCount).toBe(12);
    expect(sim.drainEvents().filter(e => e.type === 'capReached')).toHaveLength(1);
  });

  it('blocks recruitment through walls for proximity, rally and pulses, and excludes held zombies', () => {
    const sim = flatSimulation();
    sim.ctx.collision = new CollisionWorld(sim.ctx.layout.bounds, [{
      kind: 'wall', minX: 2, maxX: 3, minZ: -20, maxZ: 20, height: 5, blocksMove: true, blocksSight: true,
    }]);
    sim.state.leader.pos = { x: 0, z: 0 };
    const a = zombie(sim, 0), held = zombie(sim, 1, 0, { heldBy: 1 }), blocked = zombie(sim, 4);
    updateHorde(sim.ctx, 0, emptyInput());
    applyHordeCommands(sim.ctx, dt, { ...emptyInput(), rally: true });
    sim.state.time = a.pulseAt; updateHorde(sim.ctx, 0, emptyInput());
    expect(held.state).toBe('ambient'); expect(blocked.state).toBe('ambient');
    expect(recruitZombie(sim.ctx, held, false)).toBe(false);
    expect(sim.state.followerCount).toBe(1);
  });

  it('does not pulse start followers or non-followers, cancels dead pulses, and widens pulse radius with momentum', () => {
    const start = new Simulation();
    const followers = start.state.zombies.filter(z => z.state === 'follower');
    for (let i = 0; i < 120; i++) start.step(dt, emptyInput());
    expect(followers.every(z => z.pulseAt === -1)).toBe(true);
    expect(start.drainEvents().filter(e => e.type === 'recruitPulse' && followers.some(z => z.id === e.zombieId))).toHaveLength(0);
    const sim = flatSimulation(); const a = zombie(sim, 0), b = zombie(sim, 14);
    recruitZombie(sim.ctx, a, false);
    for (let i = 0; i < 10; i++) addMomentum(sim.ctx, 'structure');
    pulseStep(sim, 0.4); expect(b.recruitGen).toBe(1);
    const dead = zombie(sim, 0); recruitZombie(sim.ctx, dead, false); killZombie(sim.ctx, dead);
    const rising = zombie(sim, 0, 0, { state: 'rising', pulseAt: 0 });
    pulseStep(sim, 1); expect(dead.pulseAt).toBe(-1); expect(rising.pulseAt).toBe(-1);
    expect(sim.drainEvents().filter(e => e.type === 'recruitPulse' && e.zombieId === dead.id)).toHaveLength(0);
  });
});
