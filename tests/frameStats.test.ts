import { describe, expect, it } from 'vitest';
import { FrameStats } from '../src/graphics/performance/frameStats';
import { BENCHMARKS, parseBenchmarkParam, spawnBenchmark } from '../src/graphics/performance/benchmark';
import { Simulation } from '../src/sim/Simulation';
import { buildDistrictLayout } from '../src/world/districtLayout';
import { mulberry32 } from '../src/utils/rng';
import { emptyInput } from '../src/core/types';

describe('FrameStats (VP-4 #6)', () => {
  it('computes median / p95 / mean on a known window', () => {
    const f = new FrameStats(100);
    for (let i = 1; i <= 100; i++) f.push(i);
    expect(f.median()).toBe(50);
    expect(f.p95()).toBe(95);
    expect(f.mean()).toBeCloseTo(50.5);
  });

  it('is bounded and drops the oldest samples', () => {
    const f = new FrameStats(10);
    for (let i = 0; i < 25; i++) f.push(i < 15 ? 1000 : 16);
    expect(f.size).toBe(10);
    expect(f.p95()).toBe(16);
    f.push(Number.NaN);
    f.push(-3);
    expect(f.size).toBe(10);
    f.reset();
    expect(f.median()).toBe(0);
  });
});

describe('benchmark scene', () => {
  it('parses ?bench=', () => {
    expect(parseBenchmarkParam('?bench=1')).toBe(1);
    expect(parseBenchmarkParam('?x=2&bench=2')).toBe(2);
    expect(parseBenchmarkParam('?bench=7')).toBe(0);
    expect(parseBenchmarkParam('')).toBe(0);
  });

  it('spawns the population, keeps followerCount honest and the sim stepping', () => {
    const sim = new Simulation(buildDistrictLayout(), 7);
    const z0 = sim.state.zombies.length;
    const g0 = sim.state.guards.length;
    const added = spawnBenchmark(sim.state, sim.ctx.collision, mulberry32(3), 1);
    expect(added).toEqual({ zombies: BENCHMARKS[1].zombies, humans: BENCHMARKS[1].humans });
    expect(sim.state.zombies.length).toBe(z0 + 100);
    expect(sim.state.guards.length).toBe(g0 + 100);
    const ids = new Set([...sim.state.zombies.map(z => z.id), ...sim.state.guards.map(g => g.id)]);
    expect(ids.size).toBe(sim.state.zombies.length + sim.state.guards.length);
    for (let i = 0; i < 120; i++) sim.step(1 / 60, emptyInput());
    const followers = sim.state.zombies.filter(z => z.state === 'follower').length;
    expect(sim.state.followerCount).toBe(followers);
    expect(followers).toBeLessThanOrEqual(40); // open-world horde cap respected
  }, 30000);
});
