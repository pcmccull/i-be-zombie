import { describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../src/config/balance';
import type { DistrictId } from '../src/core/types';
import { emptyInput } from '../src/core/types';
import { createGuard } from '../src/entities/HumanGuard';
import { createZombie } from '../src/entities/Zombie';
import { Simulation } from '../src/sim/Simulation';
import { damageGuard } from '../src/systems/CombatSystem';
import { updateHumanAI } from '../src/systems/HumanAISystem';
import { updatePopulation } from '../src/systems/PopulationSystem';
import { buildDistrictLayout } from '../src/world/districtLayout';
import { getDistrictAt } from '../src/world/worldQueries';

const delay = BALANCE.population.civilianRespawnDelay;
function fixture(sparse = false) {
  const sim = new Simulation(buildDistrictLayout());
  if (sparse) {
    sim.state.guards = []; sim.state.zombies = []; sim.state.followerCount = 0;
    sim.state.leader.pos = { x: 180, z: -140 };
    for (const d of sim.ctx.layout.districts) { d.civilianBudget = 0; d.ambientBudget = 0; }
  }
  return sim;
}
function advance(sim: Simulation, seconds: number, step = 0.25): void {
  for (let remaining = seconds; remaining > 1e-9;) {
    const dt = Math.min(step, remaining);
    updatePopulation(sim.ctx, dt); sim.state.time += dt; remaining -= dt;
  }
}
function civilians(sim: Simulation, id: DistrictId) {
  return sim.state.guards.filter(g => g.role === 'civilian' && g.hp > 0 && g.state !== 'DEAD' &&
    getDistrictAt(sim.ctx.layout, g.pos) === id);
}

describe('population radius activation', () => {
  it('sets every human/ambient flag from the radius and always wakes followers and rising zombies', () => {
    const sim = fixture();
    const rising = createZombie(sim.ctx.newId(), { x: 180, z: -140 }, { state: 'rising',
      variant: 0, spawnZone: -1, isConverted: true, rng: sim.ctx.rng });
    rising.dormant = true; sim.state.zombies.push(rising);
    updatePopulation(sim.ctx, 0);
    const origin = sim.state.leader.pos;
    for (const g of sim.state.guards) expect(g.dormant).toBe(Math.hypot(g.pos.x - origin.x, g.pos.z - origin.z) > BALANCE.population.activeRadius);
    for (const z of sim.state.zombies) expect(z.dormant).toBe(z.state === 'ambient' &&
      Math.hypot(z.pos.x - origin.x, z.pos.z - origin.z) > BALANCE.population.activeRadius);
    expect(sim.state.guards.some(g => g.dormant)).toBe(true);
    expect(sim.state.guards.some(g => !g.dormant)).toBe(true);
    // Even a zombie recruited between refreshes must wake on the very next call.
    const z = sim.state.zombies.find(z => z.dormant)!; z.state = 'follower';
    updatePopulation(sim.ctx, 0.01); expect(z.dormant).toBe(false);
  });

  it('refreshes at the configured cadence and includes actors exactly on the radius', () => {
    const sim = fixture(); const g = sim.state.guards[0];
    g.pos = { x: sim.state.leader.pos.x + BALANCE.population.activeRadius, z: sim.state.leader.pos.z };
    updatePopulation(sim.ctx, 0); expect(g.dormant).toBe(false);
    sim.state.leader.pos = { x: 180, z: -140 };
    updatePopulation(sim.ctx, 0.1); expect(g.dormant).toBe(false);
    updatePopulation(sim.ctx, 1 / BALANCE.population.dormantRefreshHz - 0.1); expect(g.dormant).toBe(true);
  });

  it('leaves dormant humans completely untouched by AI, including cooldowns and stagger', () => {
    const sim = fixture(); updatePopulation(sim.ctx, 0);
    const guards = sim.state.guards.filter(g => g.dormant);
    for (const g of guards) { g.staggerTime = 1; g.attackCooldown = 0.7; }
    const before = structuredClone(guards);
    updateHumanAI(sim.ctx, 1, emptyInput()); expect(guards).toEqual(before);
    const ids = new Set(guards.map(g => g.id));
    expect(sim.drainEvents().filter(e => e.type === 'shot' && ids.has(e.guardId))).toHaveLength(0);
  });

  it('uses the active captured nest while dead, falling back to the beach start while no nest is active', () => {
    const sim = fixture(); sim.state.phase = 'respawning'; sim.state.leader.alive = false;
    sim.state.leader.pos = { x: 180, z: -140 };
    const nest = sim.ctx.layout.nests.find(n => n.strongholdId === 'police_station')!;
    sim.state.activeNestId = nest.id;
    sim.state.strongholds.find(s => s.id === 'police_station')!.captured = true;
    updatePopulation(sim.ctx, 0);
    for (const g of sim.state.guards) expect(g.dormant).toBe(Math.hypot(g.pos.x - nest.pos.x, g.pos.z - nest.pos.z) > BALANCE.population.activeRadius);
    sim.state.strongholds.find(s => s.id === 'police_station')!.captured = false;
    advance(sim, 0.5); const start = sim.ctx.layout.playerStart; // the walk-in nest by the bus is still unclaimed
    for (const g of sim.state.guards) expect(g.dormant).toBe(Math.hypot(g.pos.x - start.x, g.pos.z - start.z) > BALANCE.population.activeRadius);
  });
});

describe('district respawn budgets', () => {
  it('waits the full deficit delay, then spawns only one civilian and free ambient per district per delay', () => {
    const sim = fixture(true), district = sim.ctx.layout.districts.find(d => d.id === 'suburbs')!;
    district.civilianBudget = district.ambientBudget = 10;
    advance(sim, delay - 0.25); expect(sim.state.guards).toHaveLength(0); expect(sim.state.zombies).toHaveLength(0);
    advance(sim, 0.25); expect(sim.state.guards).toHaveLength(1); expect(sim.state.zombies).toHaveLength(1);
    for (const e of [...sim.state.guards, ...sim.state.zombies]) {
      expect(district.spawnPoints).toContainEqual(e.pos);
      expect(Math.hypot(e.pos.x - sim.state.leader.pos.x, e.pos.z - sim.state.leader.pos.z)).toBeGreaterThanOrEqual(BALANCE.population.minRespawnDistance);
      expect(sim.ctx.collision.segmentBlocked(sim.state.leader.pos, e.pos, { mode: 'sight',
        fromHeight: BALANCE.guard.eyeHeight, toHeight: BALANCE.targetHeights.guardTorso })).toBe(true);
      expect(sim.ctx.collision.isBlocked(e.pos, e.radius)).toBe(false);
      expect(e.dormant).toBe(true);
    }
    expect(sim.state.guards[0].homeArea).toEqual(district.rect);
    const z = sim.state.zombies[0], zone = sim.ctx.layout.spawnZones[z.spawnZone];
    expect(zone.heldBy ?? 0).toBe(0); expect(z.heldBy).toBe(0);
    expect(getDistrictAt(sim.ctx.layout, z.pos)).toBe(district.id);
    advance(sim, delay - 0.25); expect(sim.state.guards).toHaveLength(1);
    advance(sim, 0.25); expect(sim.state.guards).toHaveLength(2); expect(sim.state.zombies).toHaveLength(2);
    expect(new Set([...sim.state.guards, ...sim.state.zombies].map(e => e.id)).size).toBe(4);
  });

  it('does not spawn at visible, too-close, blocked, or missing points and spends no ids on failed attempts', () => {
    const sim = fixture(true), district = sim.ctx.layout.districts[0]; district.civilianBudget = district.ambientBudget = 1;
    const id = sim.state.nextEntityId;
    const sight = vi.spyOn(sim.ctx.collision, 'segmentBlocked').mockReturnValue(false);
    advance(sim, delay * 2); expect(sim.state.nextEntityId).toBe(id);
    sight.mockReturnValue(true);
    const original = district.spawnPoints;
    district.spawnPoints = [{ ...sim.state.leader.pos }];
    advance(sim, delay); expect(sim.state.nextEntityId).toBe(id);
    district.spawnPoints = original;
    const blocked = vi.spyOn(sim.ctx.collision, 'isBlocked').mockReturnValue(true);
    advance(sim, delay); expect(sim.state.nextEntityId).toBe(id);
    blocked.mockRestore(); district.spawnPoints = [];
    advance(sim, delay); expect(sim.state.nextEntityId).toBe(id);
    district.spawnPoints = original;
    advance(sim, 0.25); expect(sim.state.guards).toHaveLength(1); expect(sim.state.zombies).toHaveLength(1);
  });

  it('counts only living district civilians and free ambient against their respective budgets', () => {
    const sim = fixture(true), district = sim.ctx.layout.districts[0];
    district.civilianBudget = district.ambientBudget = 1;
    const p = district.spawnPoints[0];
    sim.state.guards.push(createGuard(sim.ctx.newId(), { role: 'police', post: 'stronghold', strongholdId: 'suburb_checkpoint',
      pos: p, facing: 0, tower: null, waypoints: [] }, sim.ctx.collision));
    sim.state.zombies.push(createZombie(sim.ctx.newId(), p, { state: 'ambient', heldBy: 4,
      variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng }));
    advance(sim, delay);
    expect(civilians(sim, district.id)).toHaveLength(1);
    expect(sim.state.zombies.filter(z => z.state === 'ambient' && !z.heldBy)).toHaveLength(1);
    advance(sim, delay * 2); expect(sim.state.guards).toHaveLength(2); expect(sim.state.zombies).toHaveLength(2);
  });

  it('enforces both global hard caps across all districts, including held ambient', () => {
    const sim = fixture(true), district = sim.ctx.layout.districts[0];
    district.civilianBudget = district.ambientBudget = 1000;
    for (let i = 0; i < BALANCE.population.maxHumans - 1; i++) sim.state.guards.push(createGuard(sim.ctx.newId(), {
      role: 'soldier', pos: sim.state.leader.pos, facing: 0, tower: null, waypoints: [] }, sim.ctx.collision));
    for (let i = 0; i < BALANCE.population.maxAmbient - 1; i++) sim.state.zombies.push(createZombie(sim.ctx.newId(), sim.state.leader.pos, {
      state: 'ambient', heldBy: 1, variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng }));
    advance(sim, delay * 3);
    expect(sim.state.guards).toHaveLength(BALANCE.population.maxHumans);
    expect(sim.state.zombies).toHaveLength(BALANCE.population.maxAmbient);
  });

  it('reduces captured civilian budgets and suppresses all top-ups in infected districts', () => {
    const sim = fixture(true), district = sim.ctx.layout.districts[0];
    district.civilianBudget = 8; sim.state.districts[district.id].strongholdCaptured = true;
    advance(sim, delay * 5);
    expect(civilians(sim, district.id)).toHaveLength(Math.floor(8 * BALANCE.conquest.capturedPatrolFactor));
    sim.state.guards = []; district.ambientBudget = 10;
    sim.state.districts[district.id].status = 'infected'; advance(sim, delay * 3);
    expect(sim.state.guards).toHaveLength(0); expect(sim.state.zombies).toHaveLength(0);
  });

  it('has no respawns for legacy zero-budget layouts and resets private timers on simulation reset', () => {
    const legacy = new Simulation(); legacy.state.guards = []; legacy.state.zombies = []; legacy.state.followerCount = 0;
    advance(legacy, 60); expect(legacy.state.guards).toHaveLength(0); expect(legacy.state.zombies).toHaveLength(0);
    const sim = fixture(true), district = sim.ctx.layout.districts[0]; district.civilianBudget = 1;
    advance(sim, delay - 0.25); sim.reset(); sim.state.guards = []; sim.state.zombies = [];
    sim.state.leader.pos = { x: 180, z: -140 };
    advance(sim, 0.25); expect(sim.state.guards).toHaveLength(0);
    advance(sim, delay - 0.25); expect(sim.state.guards).toHaveLength(1);
  });

  it('produces identical top-ups and rng results from the same seed and movement', () => {
    const a = fixture(true), b = fixture(true);
    for (const sim of [a, b]) {
      sim.ctx.layout.districts[0].civilianBudget = 3; sim.ctx.layout.districts[0].ambientBudget = 3;
      advance(sim, delay * 3);
    }
    expect(a.state.guards).toEqual(b.state.guards); expect(a.state.zombies).toEqual(b.state.zombies);
    expect(a.ctx.rng.next()).toBe(b.ctx.rng.next());
  });

  it('can replenish the complete district budgets even while all replacement actors are dormant', () => {
    const sim = fixture(true), district = sim.ctx.layout.districts[0];
    district.civilianBudget = 16; district.ambientBudget = 30;
    advance(sim, delay * 32, delay);
    expect(civilians(sim, district.id)).toHaveLength(district.civilianBudget);
    expect(sim.state.zombies).toHaveLength(district.ambientBudget);
    expect(sim.state.guards.every(g => g.dormant)).toBe(true);
    expect(sim.state.zombies.every(z => z.dormant)).toBe(true);
  });
});

describe('population lifetime bounds', () => {
  it('prunes human corpses older than thirty seconds, preserving pending conversions', () => {
    const sim = fixture(), [old, pending, recent] = sim.state.guards;
    for (const g of [old, pending, recent]) damageGuard(sim.ctx, g, 1000, 'other');
    sim.state.time = 31; recent.deathTime = 2;
    sim.state.pendingConversions.push({ guardId: pending.id, pos: { ...pending.pos }, facing: 0, resolveAt: 40, willConvert: true });
    updatePopulation(sim.ctx, 0);
    expect(sim.state.guards).not.toContain(old); expect(sim.state.guards).toContain(pending); expect(sim.state.guards).toContain(recent);
    sim.state.pendingConversions = []; advance(sim, 1);
    expect(sim.state.guards).not.toContain(pending); expect(sim.state.guards).toContain(recent);
    advance(sim, 0.5); expect(sim.state.guards).not.toContain(recent);
  });

  it('keeps humans and ambient bounded while walking all districts for three sim-minutes with repeated losses', () => {
    const sim = fixture(), route = sim.ctx.layout.districts.flatMap(d => d.spawnPoints);
    let maxHumans = sim.state.guards.length, maxAmbient = sim.state.zombies.filter(z => z.state === 'ambient').length;
    for (let i = 0; i < 720; i++) {
      const point = route[Math.floor(i / 12) % route.length];
      const leader = sim.state.leader.pos, dx = point.x - leader.x, dz = point.z - leader.z, d = Math.hypot(dx, dz);
      if (d > 0) { const step = Math.min(d, BALANCE.leader.walkSpeed * 0.25); leader.x += dx / d * step; leader.z += dz / d * step; }
      if (i % 40 === 0) {
        const g = sim.state.guards.find(g => g.role === 'civilian' && g.hp > 0);
        if (g) damageGuard(sim.ctx, g, 1000, 'other');
        const z = sim.state.zombies.find(z => z.state === 'ambient' && !z.heldBy);
        if (z) { z.state = 'dead'; z.hp = 0; }
      }
      updatePopulation(sim.ctx, 0.25); sim.state.time += 0.25;
      maxHumans = Math.max(maxHumans, sim.state.guards.length);
      maxAmbient = Math.max(maxAmbient, sim.state.zombies.filter(z => z.state === 'ambient').length);
      expect(sim.state.guards.length).toBeLessThanOrEqual(BALANCE.population.maxHumans);
      expect(maxAmbient).toBeLessThanOrEqual(BALANCE.population.maxAmbient);
    }
    expect(sim.state.time).toBe(180); expect(maxHumans).toBeLessThanOrEqual(BALANCE.population.maxHumans);
  });
});
