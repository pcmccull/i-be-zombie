import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import { createZombie } from '../src/entities/Zombie';
import { Simulation } from '../src/sim/Simulation';
import { damageGuard } from '../src/systems/CombatSystem';
import { updateConversion } from '../src/systems/ConversionSystem';
import { countFollowers, recruitZombie } from '../src/systems/HordeSystem';

const input = emptyInput(), dt = BALANCE.sim.fixedDt;
function fixture(value = 0.69) {
  const sim = new Simulation(); sim.state.zombies = []; sim.ctx.rng = { next: () => value }; return sim;
}

describe('conversion: design §15.10–11', () => {
  it.each([0.69, 0.70])('rolls the strict 70%% boundary once at zombie-caused death (rng=%s)', value => {
    const sim = fixture(value), g = sim.state.guards[5];
    damageGuard(sim.ctx, g, 50, 'zombie'); damageGuard(sim.ctx, g, 50, 'zombie');
    expect(sim.state.pendingConversions).toHaveLength(1);
    expect(sim.state.pendingConversions[0].willConvert).toBe(value < 0.7);
    sim.state.time = 3; updateConversion(sim.ctx, dt, input);
    expect(sim.state.pendingConversions).toHaveLength(0);
    expect(sim.state.zombies).toHaveLength(value < 0.7 ? 1 : 0);
    updateConversion(sim.ctx, dt, input); expect(sim.state.zombies).toHaveLength(value < 0.7 ? 1 : 0);
    expect(g.state).toBe('DEAD'); expect(sim.state.stats.conversions).toBe(0);
  });

  it('does not convert other-caused deaths, even after an earlier zombie hit', () => {
    const sim = fixture(); const g = sim.state.guards[5];
    damageGuard(sim.ctx, g, 1, 'zombie'); damageGuard(sim.ctx, g, 49, 'other');
    expect(sim.state.pendingConversions).toHaveLength(0);
    sim.state.time = 10; updateConversion(sim.ctx, 10, input); expect(sim.state.zombies).toHaveLength(0);
  });

  it('waits three seconds, then rises for the full duration and counts only when joining', () => {
    const sim = fixture(), g = sim.state.guards[5], pos = { ...g.pos };
    damageGuard(sim.ctx, g, 50, 'zombie'); sim.drainEvents();
    sim.state.time = 3 - dt; updateConversion(sim.ctx, dt, input);
    expect(sim.state.zombies).toHaveLength(0); expect(sim.state.pendingConversions).toHaveLength(1);
    sim.state.time = 3; updateConversion(sim.ctx, dt, input);
    const z = sim.state.zombies[0];
    expect(z.state).toBe('rising'); expect(z.anim).toBe('rise'); expect(z.stateTime).toBe(0);
    expect(z.pos).toEqual(pos); expect(z.pos).not.toBe(g.pos); expect(z.facing).toBe(g.facing);
    expect(z.isConverted).toBe(true); expect(z.id).not.toBe(g.id);
    expect(sim.drainEvents()).toEqual([{ type: 'conversionStart', guardId: g.id, zombieId: z.id, pos }]);
    for (let i = 0; i < 71; i++) updateConversion(sim.ctx, dt, input);
    expect(z.state).toBe('rising'); expect(sim.state.followerCount).toBe(0); expect(sim.state.stats.conversions).toBe(0);
    updateConversion(sim.ctx, dt, input);
    expect(z.state).toBe('follower'); expect(z.stateTime).toBe(0); expect(z.anim).toBe('idle');
    expect(sim.state.followerCount).toBe(1); expect(countFollowers(sim.state)).toBe(1); expect(sim.state.stats.conversions).toBe(1);
    expect(sim.drainEvents()).toEqual([{ type: 'converted', guardId: g.id, zombieId: z.id, pos }]);
    updateConversion(sim.ctx, 5, input); expect(sim.state.stats.conversions).toBe(1);
  });

  it('caps followers plus rising zombies, reserving the last slot across simultaneous pending deaths', () => {
    const sim = fixture();
    for (let i = 0; i < 100; i++) {
      const z = createZombie(sim.ctx.newId(), sim.state.leader.pos, { state: 'ambient', variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng });
      sim.state.zombies.push(z); recruitZombie(sim.ctx, z, false);
    }
    damageGuard(sim.ctx, sim.state.guards[5], 50, 'zombie'); sim.state.time = 3;
    updateConversion(sim.ctx, dt, input); expect(sim.state.zombies).toHaveLength(100);
    expect(sim.state.pendingConversions).toHaveLength(0); expect(sim.state.followerCount).toBe(100);
    const other = fixture();
    for (let i = 0; i < 99; i++) {
      const z = createZombie(other.ctx.newId(), other.state.leader.pos, { state: 'rising', variant: 0, spawnZone: -1, isConverted: true, rng: other.ctx.rng });
      other.state.zombies.push(z);
    }
    for (const g of other.state.guards.slice(5)) damageGuard(other.ctx, g, 50, 'zombie');
    other.state.time = 3; updateConversion(other.ctx, dt, input);
    expect(other.state.zombies).toHaveLength(100); expect(other.state.followerCount).toBe(0);
    expect(other.state.pendingConversions).toHaveLength(0);
  });

  it('is deterministic across repeated seeded runs and does not advance after game over', () => {
    const a = new Simulation(), b = new Simulation();
    for (const sim of [a, b]) {
      damageGuard(sim.ctx, sim.state.guards[5], 50, 'zombie');
      sim.state.time = 3; updateConversion(sim.ctx, dt, input);
    }
    expect(a.state).toEqual(b.state); expect(a.drainEvents()).toEqual(b.drainEvents());
    a.state.phase = 'defeat'; const before = JSON.stringify(a.state);
    updateConversion(a.ctx, 10, input); expect(JSON.stringify(a.state)).toBe(before);
  });
});
