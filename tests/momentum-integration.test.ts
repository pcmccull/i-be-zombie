import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import { updateLeader } from '../src/entities/ZombieLeader';
import { Simulation } from '../src/sim/Simulation';
import { damageGate, damageGuard } from '../src/systems/CombatSystem';
import { updateConversion } from '../src/systems/ConversionSystem';
import { recruitZombie, updateHorde } from '../src/systems/HordeSystem';
import { addMomentum, speedMultiplier } from '../src/systems/MomentumSystem';
import { updateNavigation } from '../src/systems/NavigationSystem';
import { damageStructure } from '../src/systems/StructureSystem';
import { dt, flatSimulation, pulseStep, zombie } from './r2-fixtures';

describe('momentum event wiring', () => {
  it('awards recruits and cascade recruits once, with nothing for start followers', () => {
    const start = new Simulation(); expect(start.state.momentum.value).toBe(0);
    expect(start.state.stats.recruited).toBe(0); expect(start.drainEvents()).toHaveLength(0);
    const sim = flatSimulation(), a = zombie(sim, 0), b = zombie(sim, 9.8);
    recruitZombie(sim.ctx, a, false); recruitZombie(sim.ctx, a, false);
    pulseStep(sim, 0.4); expect(b.recruitGen).toBe(1);
    pulseStep(sim, 1);
    expect(sim.state.momentum.value).toBe(2 * BALANCE.momentum.gainRecruit);
    expect(sim.drainEvents().filter(e => e.type === 'momentumGain')).toMatchObject([
      { reason: 'recruit', amount: 1 }, { reason: 'recruit', amount: 1 },
    ]);
  });

  it.each(['soldier', 'civilian'] as const)('shares death/conversion for %s, schedules the pulse only after rising, and awards each event once', role => {
    const sim = new Simulation(); sim.state.zombies = []; sim.state.followerCount = 0;
    sim.ctx.rng = { next: () => 0 }; const g = sim.state.guards.find(g => g.role === role)!;
    damageGuard(sim.ctx, g, g.maxHp, 'zombie'); damageGuard(sim.ctx, g, 100, 'zombie');
    expect(sim.state.momentum.value).toBe(role === 'soldier' ? BALANCE.momentum.gainArmedKill : 0);
    sim.state.time = BALANCE.conversion.delay;
    updateConversion(sim.ctx, dt, emptyInput());
    const converted = sim.state.zombies[0];
    expect(converted.state).toBe('rising'); expect(converted.pulseAt).toBe(-1);
    updateHorde(sim.ctx, 0, emptyInput());
    expect(converted.pulseAt).toBe(-1);
    updateConversion(sim.ctx, BALANCE.conversion.riseDuration, emptyInput());
    expect(converted.state).toBe('follower'); expect(converted.recruitGen).toBe(0);
    expect(converted.pulseAt).toBeCloseTo(sim.state.time + BALANCE.recruitPulse.delayMin);
    updateConversion(sim.ctx, 10, emptyInput());
    const events = sim.drainEvents();
    expect(events.filter(e => e.type === 'converted')).toHaveLength(1);
    expect(events.filter(e => e.type === 'momentumGain' && e.reason === 'convert')).toHaveLength(1);
    expect(events.filter(e => e.type === 'momentumGain' && e.reason === 'recruit')).toHaveLength(0);
    expect(events.filter(e => e.type === 'momentumGain' && e.reason === 'armedKill')).toHaveLength(role === 'soldier' ? 1 : 0);
    expect(events.find(e => e.type === 'guardDied')).toMatchObject({ role });
    expect(events.filter(e => e.type === 'guardAlert').every(e => e.role === role)).toBe(true);
  });

  it('awards no kill momentum for other damage, and awards defensive structures and gate once', () => {
    const sim = new Simulation();
    damageGuard(sim.ctx, sim.state.guards[0], 100, 'other');
    expect(sim.state.momentum.value).toBe(0);
    for (const s of sim.state.structures) { damageStructure(sim.ctx, s, 1000); damageStructure(sim.ctx, s, 1000); }
    damageGate(sim.ctx, 1000); damageGate(sim.ctx, 1000);
    const defensive = sim.ctx.layout.structures.filter(d => d.defensive).length + 1;
    expect(sim.state.momentum.value).toBe(defensive * BALANCE.momentum.gainStructure);
    expect(sim.drainEvents().filter(e => e.type === 'momentumGain')).toHaveLength(defensive);
  });

  it.each([false, true])('scales leader speed live (sprint=%s)', sprint => {
    const normal = flatSimulation(), full = flatSimulation();
    for (let i = 0; i < 10; i++) addMomentum(full.ctx, 'structure');
    for (let i = 0; i < 60; i++) for (const sim of [normal, full])
      updateLeader(sim.ctx, dt, { ...emptyInput(), moveForward: 1, sprint });
    expect(full.state.leader.vel.z / normal.state.leader.vel.z).toBeCloseTo(speedMultiplier(full.state), 6);
  });

  it('scales follower speed live, and briefly boosts fresh recruits without changing ambient speed', () => {
    const normal = flatSimulation(), full = flatSimulation();
    for (let i = 0; i < 10; i++) addMomentum(full.ctx, 'structure');
    for (const sim of [normal, full]) {
      zombie(sim, -20, 0, { state: 'follower', speedScale: 1, followOffset: { x: 0, z: 0 } });
      updateNavigation(sim.ctx, dt, emptyInput());
    }
    for (let i = 0; i < 60; i++) for (const sim of [normal, full]) updateHorde(sim.ctx, dt, emptyInput());
    expect(Math.hypot(full.state.zombies[0].vel.x, full.state.zombies[0].vel.z) /
      Math.hypot(normal.state.zombies[0].vel.x, normal.state.zombies[0].vel.z)).toBeCloseTo(1.2, 5);
    const boosted = flatSimulation(), base = flatSimulation();
    for (const sim of [base, boosted]) {
      // Inside catchUpDistance (leader at x -50) so the catch-up floor doesn't mask the boost ratio.
      const a = zombie(sim, -40, 0, { state: 'follower', speedScale: 1, followOffset: { x: 0, z: 0 } });
      a.recruitFlash = sim === boosted ? BALANCE.horde.recruitBoostTime : 0;
      updateNavigation(sim.ctx, dt, emptyInput());
    }
    for (let i = 0; i < 50; i++) for (const sim of [base, boosted]) updateHorde(sim.ctx, dt, emptyInput());
    expect(Math.hypot(boosted.state.zombies[0].vel.x, boosted.state.zombies[0].vel.z) /
      Math.hypot(base.state.zombies[0].vel.x, base.state.zombies[0].vel.z)).toBeCloseTo(BALANCE.horde.recruitBoostMultiplier, 5);
    expect(boosted.state.zombies[0].recruitFlash).toBeCloseTo(BALANCE.horde.recruitBoostTime - 50 * dt);
  });
});
