import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import { createZombie } from '../src/entities/Zombie';
import { Simulation } from '../src/sim/Simulation';
import { countFollowers, killZombie, recruitZombie } from '../src/systems/HordeSystem';
import { buildDistrictLayout } from '../src/world/districtLayout';

const dt = BALANCE.sim.fixedDt;
function isolated(): Simulation {
  const sim = new Simulation(buildDistrictLayout(), 11);
  sim.state.zombies = [];
  return sim;
}
function add(sim: Simulation, x: number, z: number, state: 'ambient' | 'rising' = 'ambient') {
  const zombie = createZombie(sim.ctx.newId(), { x, z }, {
    state, variant: 0, spawnZone: 0, isConverted: false, rng: sim.ctx.rng,
  });
  sim.state.zombies.push(zombie);
  return zombie;
}

describe('recruitment and initial state', () => {
  it('spawns the authored counts at deterministic clear points with independent entity data', () => {
    const sim = new Simulation(buildDistrictLayout(), 91);
    expect(sim.state.zombies).toHaveLength(60);
    expect(sim.state.guards).toHaveLength(8);
    expect(sim.state.guards.filter(g => g.tower)).toHaveLength(2);
    expect(new Set([sim.state.leader.id, ...sim.state.zombies.map(z => z.id), ...sim.state.guards.map(g => g.id)]).size).toBe(69);
    for (const z of sim.state.zombies) {
      expect(sim.ctx.collision.isBlocked(z.pos, 0.45)).toBe(false);
      expect(z.state).toBe('ambient'); expect(z.pos).not.toBe(z.prevPos);
      expect(z.speedScale).toBeGreaterThanOrEqual(0.88); expect(z.speedScale).toBeLessThanOrEqual(1.12);
      expect(Math.hypot(z.followOffset.x, z.followOffset.z)).toBeLessThanOrEqual(6);
    }
    for (const g of sim.state.guards.filter(g => g.tower)) {
      expect(g.elevation).toBe(4); expect(g.towerColliderId).not.toBeNull();
    }
    expect(sim.state.followerCount).toBe(0);
    expect(sim.state).toEqual(new Simulation(buildDistrictLayout(), 91).state);
  });

  it('recruits at 9m, excludes 9.5m, and ignores dead zombies', () => {
    const sim = isolated(), p = sim.state.leader.pos;
    const near = add(sim, p.x + 9, p.z), far = add(sim, p.x + 9.5, p.z), dead = add(sim, p.x, p.z);
    killZombie(sim.ctx, dead);
    sim.step(dt, emptyInput());
    expect(near.state).toBe('follower'); expect(far.state).toBe('ambient'); expect(dead.state).toBe('dead');
    expect(sim.state.followerCount).toBe(1); expect(countFollowers(sim.state)).toBe(1);
    expect(sim.drainEvents().filter(e => e.type === 'recruited')).toHaveLength(1);
  });

  it('rallies at 14m once per 8 seconds and snapshots event positions', () => {
    const sim = isolated(), p = sim.state.leader.pos;
    const first = add(sim, p.x + 14, p.z);
    sim.step(dt, { ...emptyInput(), rally: true });
    expect(first.state).toBe('follower');
    const event = sim.drainEvents().find(e => e.type === 'recruited');
    expect(event?.type === 'recruited' && event.viaRally).toBe(true);
    const second = add(sim, p.x - 14, p.z);
    sim.step(dt, { ...emptyInput(), rally: true });
    expect(second.state).toBe('ambient');
    expect(sim.drainEvents().filter(e => e.type === 'rally')).toHaveLength(0);
    for (let i = 0; i < 479; i++) sim.step(dt, emptyInput());
    // Place it back in range; ambient wander must not affect the cooldown boundary test.
    second.pos.x = p.x - 14; second.pos.z = p.z;
    sim.step(dt, { ...emptyInput(), rally: true });
    expect(second.state).toBe('follower'); expect(sim.state.abilities.rallyCooldown).toBe(8);
    if (event?.type === 'recruited') expect(event.pos).not.toBe(first.pos);
  });

  it('makes overlapping passive/rally/repeated recruitment idempotent', () => {
    const sim = isolated(), p = sim.state.leader.pos;
    const z = add(sim, p.x + 1, p.z);
    expect(recruitZombie(sim.ctx, z, false)).toBe(true);
    expect(recruitZombie(sim.ctx, z, true)).toBe(false);
    sim.step(dt, { ...emptyInput(), rally: true });
    expect(sim.state.followerCount).toBe(1); expect(sim.state.stats.recruited).toBe(1);
    expect(sim.state.followerCount).toBe(countFollowers(sim.state));
    expect(sim.drainEvents().filter(e => e.type === 'recruited')).toHaveLength(1);
  });

  it('reserves rising slots, excludes the leader, throttles cap events, and releases dead slots once', () => {
    const sim = isolated(), p = sim.state.leader.pos;
    for (let i = 0; i < 99; i++) recruitZombie(sim.ctx, add(sim, p.x, p.z), false);
    const rising = add(sim, p.x, p.z, 'rising');
    const extra = add(sim, p.x, p.z);
    expect(recruitZombie(sim.ctx, extra, false)).toBe(false);
    expect(recruitZombie(sim.ctx, extra, true)).toBe(false);
    expect(sim.drainEvents().filter(e => e.type === 'capReached')).toHaveLength(1);
    killZombie(sim.ctx, rising);
    expect(recruitZombie(sim.ctx, extra, false)).toBe(true);
    expect(sim.state.followerCount).toBe(100);
    const overflow = add(sim, p.x, p.z);
    expect(recruitZombie(sim.ctx, overflow, false)).toBe(false); expect(overflow.state).toBe('ambient');
    killZombie(sim.ctx, extra); killZombie(sim.ctx, extra);
    expect(sim.state.followerCount).toBe(99); expect(countFollowers(sim.state)).toBe(99);
    expect(sim.state.stats.losses).toBe(1);
    expect(recruitZombie(sim.ctx, extra, false)).toBe(false);
    expect(recruitZombie(sim.ctx, overflow, false)).toBe(true);
    expect(sim.state.followerCount).toBe(100);
    for (let i = 0; i < 361; i++) sim.step(dt, emptyInput());
    expect(sim.state.zombies.includes(extra)).toBe(false);
    expect(sim.state.zombies.includes(rising)).toBe(false);
  });
});
