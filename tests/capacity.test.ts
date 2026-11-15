import { describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../src/config/balance';
import type { ZombieAgent } from '../src/core/types';
import { emptyInput } from '../src/core/types';
import { createZombie } from '../src/entities/Zombie';
import { Simulation } from '../src/sim/Simulation';
import { applyHordeCommands, killZombie, updateHorde } from '../src/systems/HordeSystem';
import { updateNavigation } from '../src/systems/NavigationSystem';
import { buildLegacyDistrictLayout } from '../src/world/legacyDistrictLayout';

const dt = BALANCE.sim.fixedDt;
const CAP = BALANCE.horde.maxFollowers;

function fixture(): Simulation {
  const layout = buildLegacyDistrictLayout();
  layout.colliders = layout.colliders.filter(c => c.kind === 'gate');
  layout.structures = []; layout.spawnZones = []; layout.strongholds = []; layout.guards = [];
  const sim = new Simulation(layout, 5);
  sim.state.zombies = []; sim.state.followerCount = 0; sim.state.guards = [];
  sim.state.leader.pos = { x: 0, z: 0 }; sim.state.leader.facing = 0;
  return sim;
}

function add(sim: Simulation, x: number, z: number, state: 'follower' | 'ambient'): ZombieAgent {
  const a = createZombie(sim.ctx.newId(), { x, z }, {
    state, variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng,
  });
  Object.assign(a, { speedScale: 1, followOffset: { x: 0, z: 0 }, pulseAt: -1, wanderTimer: 1e9 });
  sim.state.zombies.push(a);
  if (state === 'follower') sim.state.followerCount++;
  return a;
}

function fill(sim: Simulation, n: number): void { for (let i = 0; i < n; i++) add(sim, (i % 10) * 0.2, -1 - Math.floor(i / 10) * 0.2, 'follower'); }
function ambients(sim: Simulation, n: number): ZombieAgent[] {
  const out: ZombieAgent[] = [];
  for (let i = 0; i < n; i++) out.push(add(sim, 2 + (i % 5) * 0.3, 2 + Math.floor(i / 5) * 0.3, 'ambient'));
  return out;
}
function tick(sim: Simulation, steps = 1): void {
  for (let i = 0; i < steps; i++) {
    applyHordeCommands(sim.ctx, dt, emptyInput());
    updateNavigation(sim.ctx, dt, emptyInput()); updateHorde(sim.ctx, dt, emptyInput());
    sim.state.time += dt;
  }
}
const caps = (sim: Simulation) => sim.drainEvents().filter(e => e.type === 'capReached').length;

/** Drop followers to `n` (kill extras), keeping ambients untouched. */
function trimTo(sim: Simulation, n: number): ZombieAgent[] {
  const killed: ZombieAgent[] = [];
  for (const z of sim.state.zombies) if (z.state === 'follower' && sim.state.followerCount > n) { killZombie(sim.ctx, z); killed.push(z); }
  return killed;
}

describe('capacity notice latch', () => {
  it('emits capReached exactly once while held at cap for 60 s', async () => {
    const sim = fixture(); fill(sim, CAP); ambients(sim, 8);
    let total = 0;
    for (let i = 0; i < 3600; i++) {
      tick(sim); sim.state.capReachedFlash = Math.max(0, sim.state.capReachedFlash - dt);
      if (i % 200 === 0) { total += caps(sim); await new Promise(r => setTimeout(r, 0)); }
    }
    total += caps(sim);
    expect(total).toBe(1); expect(sim.state.atCapacity).toBe(true);
  }, 60000);

  it('does not re-emit after a short dip, and re-arms after a long one', () => {
    const sim = fixture(); fill(sim, CAP); const amb = ambients(sim, 3);
    tick(sim); expect(caps(sim)).toBe(1);
    // Short dip: one slot free for < rearm, then it is refilled and a refused attempt happens.
    const short = trimTo(sim, CAP - 1);
    expect(short.length).toBe(1);
    tick(sim, Math.round((BALANCE.horde.capNoticeRearm - 1) / dt));
    expect(sim.state.atCapacity).toBe(true);
    // Passive recruit refills the free slot during the dip, then remaining ambients are refused.
    tick(sim, 5); expect(sim.state.followerCount).toBe(CAP);
    expect(caps(sim)).toBe(0);
    // Long dip: free two slots for > rearm; kill the lingering ambients out of reach first.
    for (const z of amb) if (z.state === 'ambient') z.pos = { x: 100, z: 100 };
    trimTo(sim, CAP - 2);
    tick(sim, Math.round((BALANCE.horde.capNoticeRearm + 0.5) / dt));
    expect(sim.state.atCapacity).toBe(false);
    ambients(sim, 5);
    tick(sim, 10);
    expect(sim.state.followerCount).toBe(CAP);
    tick(sim, 5); expect(caps(sim)).toBe(1);
  });

  it('skips recruitment LOS scans at cap and still consumes due pulses', () => {
    const sim = fixture(); fill(sim, CAP); ambients(sim, 40);
    const spy = vi.spyOn(sim.ctx.collision, 'segmentBlocked');
    updateHorde(sim.ctx, dt, emptyInput());
    expect(spy).not.toHaveBeenCalled();
    expect(caps(sim)).toBe(1);
    const pulser = sim.state.zombies.find(z => z.state === 'follower')!;
    pulser.pulseAt = 0; pulser.recruitGen = 0; sim.state.time = 1;
    updateHorde(sim.ctx, dt, emptyInput());
    expect(pulser.pulseAt).toBe(-1); expect(spy).not.toHaveBeenCalled();
    expect(sim.state.followerCount).toBe(CAP);
    // Contrast: below cap the same crowd does trigger LOS checks.
    const below = fixture(); fill(below, CAP - 20); ambients(below, 40);
    const spy2 = vi.spyOn(below.ctx.collision, 'segmentBlocked');
    updateHorde(below.ctx, dt, emptyInput());
    expect(spy2.mock.calls.length).toBeGreaterThan(0);
  });
});
