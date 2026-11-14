import { beforeEach, describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import { Simulation } from '../src/sim/Simulation';
import { revealAround, updateConquest } from '../src/systems/ConquestSystem';
import { buildDistrictLayout } from '../src/world/districtLayout';

let sim: Simulation;
beforeEach(() => { sim = new Simulation(buildDistrictLayout()); });

describe('discovery independent of conquest', () => {
  it('reveals the exact circle of fog cell centers and maintains an idempotent count', () => {
    const p = { x: -150, z: 110 }, radius = 45, fog = sim.state.discovery;
    const newly = revealAround(sim.state, sim.ctx.layout, p, radius);
    expect(newly).toEqual(['suburbs']);
    let expected = 0;
    for (let row = 0; row < fog.rows; row++) for (let col = 0; col < fog.cols; col++) {
      const x = sim.ctx.layout.bounds.minX + (col + 0.5) * fog.cellSize;
      const z = sim.ctx.layout.bounds.minZ + (row + 0.5) * fog.cellSize;
      const inside = Math.hypot(x - p.x, z - p.z) <= radius;
      expect(fog.bits[row * fog.cols + col]).toBe(inside ? 1 : 0);
      if (inside) expected++;
    }
    expect(fog.revealed).toBe(expected);
    expect(revealAround(sim.state, sim.ctx.layout, p, radius)).toEqual([]);
    expect(fog.revealed).toBe(expected);
    expect(sim.state.districts.suburbs).toMatchObject({ discovered: true, status: 'human', strongholdCaptured: false });
    expect(sim.state.strongholds.every(s => !s.captured && !s.contested)).toBe(true);
  });

  it('reveals neighboring districts across seams without conquering any territory', () => {
    expect(new Set(revealAround(sim.state, sim.ctx.layout, { x: 0, z: 0 }, 45))).toEqual(
      new Set(['suburbs', 'police', 'shopping', 'industrial']));
    expect(Object.values(sim.state.districts).every(d => d.discovered && d.status === 'human' && d.infection === 0)).toBe(true);
    expect(sim.state.progression.biomass).toBe(0);
    expect(sim.state.strongholds.every(s => !s.captured && s.objectivesDone.length === 0)).toBe(true);
  });

  it('keeps contested and infected status when fog first reaches them', () => {
    sim.state.districts.police.status = 'contested';
    sim.state.districts.shopping.status = 'infected';
    sim.state.districts.shopping.strongholdCaptured = true;
    revealAround(sim.state, sim.ctx.layout, { x: 0, z: 0 }, 45);
    expect(sim.state.districts.police.status).toBe('contested');
    expect(sim.state.districts.shopping.status).toBe('infected');
    expect(sim.state.districts.police.discovered).toBe(true);
    expect(sim.state.districts.shopping.discovered).toBe(true);
  });

  it('clamps edge circles to the grid, ignores invalid circles, and reveals monotonically', () => {
    revealAround(sim.state, sim.ctx.layout, { x: -200, z: -160 }, 45);
    expect(sim.state.discovery.revealed).toBeGreaterThan(0);
    const old = sim.state.discovery.bits.slice(), count = sim.state.discovery.revealed;
    for (const radius of [-1, NaN, Infinity]) revealAround(sim.state, sim.ctx.layout, { x: 0, z: 0 }, radius);
    revealAround(sim.state, sim.ctx.layout, { x: 10000, z: 10000 }, 1);
    expect(sim.state.discovery.revealed).toBe(count);
    revealAround(sim.state, sim.ctx.layout, { x: 200, z: 160 }, 45);
    old.forEach((bit, i) => { if (bit) expect(sim.state.discovery.bits[i]).toBe(1); });
    expect(sim.state.discovery.revealed).toBe(sim.state.discovery.bits.reduce((n, bit) => n + bit, 0));
    expect(sim.state.discovery.bits.every(bit => bit === 0 || bit === 1)).toBe(true);
  });

  it('publishes discovery, human territory and autosave once at the configured reveal frequency', () => {
    sim.step(BALANCE.sim.fixedDt, emptyInput());
    updateConquest(sim.ctx, 0);
    const initial = sim.drainEvents();
    expect(initial.filter(e => e.type === 'districtDiscovered')).toEqual([{ type: 'districtDiscovered', districtId: 'suburbs' }]);
    expect(initial.filter(e => e.type === 'districtStatus')).toEqual([
      { type: 'districtStatus', districtId: 'suburbs', prev: 'unknown', status: 'human' },
    ]);
    expect(initial.filter(e => e.type === 'autosave')).toEqual([{ type: 'autosave', reason: 'discover' }]);
    sim.state.leader.pos = { x: 100, z: -100 };
    updateConquest(sim.ctx, 1 / BALANCE.discovery.revealHz - 0.01);
    expect(sim.state.districts.industrial.discovered).toBe(false);
    updateConquest(sim.ctx, 0.01);
    expect(sim.state.districts.industrial).toMatchObject({ discovered: true, status: 'human', strongholdCaptured: false });
    for (let i = 0; i < 20; i++) updateConquest(sim.ctx, 1 / BALANCE.discovery.revealHz);
    const events = sim.drainEvents();
    expect(events.filter(e => e.type === 'districtDiscovered')).toHaveLength(1);
    expect(events.filter(e => e.type === 'autosave' && e.reason === 'discover')).toHaveLength(1);
  });

  it('does not explore from a dead leader and gives reset states fresh reveal timers', () => {
    sim.state.leader.alive = false; sim.state.phase = 'respawning';
    updateConquest(sim.ctx, 10);
    expect(sim.state.discovery.revealed).toBe(0);
    sim.reset(); updateConquest(sim.ctx, 0);
    expect(sim.state.discovery.revealed).toBeGreaterThan(0);
    expect(sim.drainEvents().filter(e => e.type === 'districtDiscovered')).toHaveLength(1);
    sim.state.phase = 'defeat'; sim.state.leader.pos = { x: 100, z: -100 };
    updateConquest(sim.ctx, 10);
    expect(sim.state.districts.industrial.discovered).toBe(false);
  });
});
