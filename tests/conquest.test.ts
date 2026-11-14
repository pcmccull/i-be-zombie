import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../src/config/balance';
import type { StrongholdId, Vec2 } from '../src/core/types';
import { createGuard } from '../src/entities/HumanGuard';
import { createZombie } from '../src/entities/Zombie';
import { Simulation } from '../src/sim/Simulation';
import { damageGate, damageGuard } from '../src/systems/CombatSystem';
import { isNestActive, objectiveStatus, updateConquest } from '../src/systems/ConquestSystem';
import { damageStructure, findStructure } from '../src/systems/StructureSystem';
import { buildDistrictLayout } from '../src/world/districtLayout';
import { getDistrictAt } from '../src/world/worldQueries';

let sim: Simulation;
beforeEach(() => { sim = new Simulation(buildDistrictLayout()); });
function tick(dt: number = BALANCE.sim.fixedDt): void { updateConquest(sim.ctx, dt); sim.state.time += dt; }
function stronghold(id: StrongholdId) { return sim.state.strongholds.find(s => s.id === id)!; }
function definition(id: StrongholdId) { return sim.ctx.layout.strongholds.find(s => s.id === id)!; }
function followersAt(p: Vec2, count: number): void {
  let followers = sim.state.zombies.filter(z => z.state === 'follower');
  while (followers.length < count) {
    const z = createZombie(sim.ctx.newId(), p, { state: 'follower', variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng });
    sim.state.zombies.push(z); followers.push(z); sim.state.followerCount++;
  }
  followers.forEach((z, i) => { z.pos = i < count ? { ...p } : { ...sim.ctx.layout.playerStart }; });
}
function captureHold(id: StrongholdId): void {
  const def = definition(id), hold = def.objectives.find(o => o.kind === 'holdPoint')!;
  for (const g of sim.state.guards) if (g.strongholdId === id) g.pos = { x: hold.point!.x + hold.radius! + 8, z: hold.point!.z };
  for (const obj of def.objectives) {
    if (obj.kind === 'destroyStructure') { const s = findStructure(sim.state, obj.structureId!)!; damageStructure(sim.ctx, s, s.hp); }
    if (obj.kind === 'destroyGate') damageGate(sim.ctx, sim.state.gate.hp);
  }
  followersAt(hold.point!, hold.minZombies!);
  tick(hold.holdTime!);
}

describe('stronghold objectives and capture', () => {
  it('counts only armed defenders of the objective stronghold and completes in actual completion order', () => {
    const id = 'suburb_checkpoint', def = definition(id), s = findStructure(sim.state, def.objectives[0].structureId!)!;
    const civ = createGuard(sim.ctx.newId(), { role: 'civilian', post: 'street', strongholdId: id,
      pos: def.center, facing: 0, tower: null, waypoints: [def.center] }, sim.ctx.collision);
    sim.state.guards.push(civ);
    const defenders = sim.state.guards.filter(g => g.strongholdId === id && g.role !== 'civilian');
    damageGuard(sim.ctx, defenders[0], defenders[0].hp, 'other'); tick();
    expect(objectiveStatus(sim.ctx, id)[1]).toMatchObject({ done: false, progress: 1 / defenders.length });
    for (const g of defenders.slice(1)) damageGuard(sim.ctx, g, g.hp, 'other');
    tick();
    expect(stronghold(id).objectivesDone).toEqual(['defenders']);
    expect(stronghold(id).captured).toBe(false);
    damageStructure(sim.ctx, s, s.hp); tick();
    expect(stronghold(id).objectivesDone).toEqual(['defenders', 'break_pen']);
    expect(stronghold(id).captured).toBe(true);
    expect(civ).toMatchObject({ role: 'civilian', post: 'street', state: 'RETREAT' });
    expect(sim.state.guards.some(g => g.strongholdId === 'police_station' && g.state !== 'DEAD')).toBe(true);
  });

  it('gates hold progress on prerequisites, decays interrupted holds at twice speed, and resets empty holds', () => {
    const id = 'police_station', def = definition(id), obj = def.objectives[1], sh = stronghold(id);
    const defenders = sim.state.guards.filter(g => g.strongholdId === id);
    defenders.forEach(g => { g.pos = { x: obj.point!.x + 20, z: obj.point!.z }; });
    followersAt(obj.point!, obj.minZombies!);
    tick(2); expect(sh.holdProgress).toBe(0);
    damageStructure(sim.ctx, findStructure(sim.state, def.objectives[0].structureId!)!, 10000);
    tick(2); expect(sh.holdProgress).toBe(2);
    expect(objectiveStatus(sim.ctx, id)[1].progress).toBeCloseTo(2 / obj.holdTime!);
    defenders[0].pos = { ...obj.point! }; tick(0.25);
    expect(sh.holdProgress).toBeCloseTo(1.5);
    // Unarmed survivors and unrelated armed humans do not block this objective.
    defenders[0].role = 'civilian';
    sim.state.guards.find(g => g.strongholdId === 'industrial_yard')!.pos = { ...obj.point! };
    tick(0.5); expect(sh.holdProgress).toBeCloseTo(2);
    const group = sim.state.zombies.filter(z => z.state === 'follower');
    group[0].pos = { ...sim.ctx.layout.playerStart }; tick(0.25);
    expect(sh.holdProgress).toBeCloseTo(1.5);
    group.forEach(z => { z.pos = { ...sim.ctx.layout.playerStart }; }); tick(0.01);
    expect(sh.holdProgress).toBe(0);
    expect(sh.captured).toBe(false);
  });

  it.each(['mall_security', 'police_station', 'industrial_yard'] as const)('captures %s once, unlocks once, rewards once, and demobilizes survivors', id => {
    captureHold(id);
    const sh = stronghold(id), def = definition(id), d = sim.state.districts[def.districtId];
    expect(sh).toMatchObject({ captured: true, contested: false, defenderStrength: 0 });
    expect(d).toMatchObject({ status: 'infected', strongholdCaptured: true, infection: 1 });
    expect(sim.state.progression.unlocked).toContain(def.unlock);
    expect(isNestActive(sim.ctx, def.nestId)).toBe(true);
    expect(sim.state.activeNestId).toBe(def.nestId);
    const survivors = sim.state.guards.filter(g => g.strongholdId === id && g.hp > 0);
    expect(survivors.length).toBeGreaterThan(0);
    expect(survivors.every(g => g.role === 'civilian' && g.post === 'street' && g.state === 'RETREAT' && g.target === null)).toBe(true);
    const biomass = sim.state.progression.biomass;
    for (let i = 0; i < 120; i++) tick();
    expect(sim.state.progression.biomass).toBe(biomass);
    const events = sim.drainEvents();
    expect(events.filter(e => e.type === 'strongholdCaptured')).toHaveLength(1);
    expect(events.filter(e => e.type === 'abilityUnlocked')).toHaveLength(1);
    expect(events.filter(e => e.type === 'biomassGain' && e.reason === 'capture')).toEqual([
      { type: 'biomassGain', amount: def.biomassReward, total: biomass, reason: 'capture' },
    ]);
    expect(events.filter(e => e.type === 'objectiveComplete')).toHaveLength(def.objectives.length);
    expect(events.filter(e => e.type === 'nestActivated')).toHaveLength(1);
    expect(events.filter(e => e.type === 'autosave' && e.reason === 'capture')).toHaveLength(1);
    expect(objectiveStatus(sim.ctx, id).every(o => o.done && o.progress === 1)).toBe(true);
  });

  it('allows mall before police and keeps an explicitly changed respawn nest', () => {
    captureHold('mall_security');
    expect(sim.state.progression.unlocked).toContain('horde_frenzy');
    expect(sim.state.progression.unlocked).not.toContain('alpha_claws');
    sim.state.activeNestId = 'nest_start';
    captureHold('police_station');
    expect(sim.state.activeNestId).toBe('nest_start');
    expect(sim.state.progression.unlocked).toEqual(expect.arrayContaining(['horde_frenzy', 'alpha_claws']));
    expect(sim.state.districts.shopping.status).toBe('infected');
    expect(sim.state.districts.police.status).toBe('infected');
    expect(sim.state.progression.biomass).toBe(definition('mall_security').biomassReward +
      definition('police_station').biomassReward + 2 * BALANCE.progression.biomassStructure);
  });

  it('does not mutate objective state through its HUD read model', () => {
    const before = structuredClone(sim.state.strongholds);
    const view = objectiveStatus(sim.ctx, 'mall_security');
    view[0].done = true; view.pop();
    expect(sim.state.strongholds).toEqual(before);
    expect(objectiveStatus(sim.ctx, 'missing' as StrongholdId)).toEqual([]);
  });
});

describe('contested territory and aggression', () => {
  it('reads objective damage from the structure hook, records every hit, and restores human status after 30 quiet seconds', () => {
    const id = 'mall_security', s = findStructure(sim.state, definition(id).objectives[0].structureId!)!;
    damageStructure(sim.ctx, s, 1); damageStructure(sim.ctx, s, 2); tick(0);
    expect(stronghold(id).contested).toBe(true);
    expect(sim.state.districts.shopping.status).toBe('contested');
    expect(sim.state.districts.shopping.alertLevel).toBeCloseTo(2 * BALANCE.conquest.alertPerStructureHit);
    tick(29.9); expect(stronghold(id).contested).toBe(true);
    tick(0.1); expect(stronghold(id).contested).toBe(false);
    expect(sim.state.districts.shopping.status).toBe('human');
    tick(); expect(stronghold(id).contested).toBe(false);
    damageStructure(sim.ctx, s, 1); tick(0);
    expect(stronghold(id).contested).toBe(true);
    expect(sim.drainEvents().filter(e => e.type === 'strongholdContested')).toHaveLength(2);
  });

  it('requires six followers and a fighting defender for coordinated contest, and presence prevents quiet expiry', () => {
    const id = 'police_station', def = definition(id);
    const g = sim.state.guards.find(g => g.strongholdId === id)!;
    followersAt({ x: def.bounds.minX - BALANCE.conquest.contestRadius + 0.1, z: def.center.z }, 5);
    g.state = 'COMBAT'; tick(); expect(stronghold(id).contested).toBe(false);
    followersAt({ x: def.bounds.minX - BALANCE.conquest.contestRadius + 0.1, z: def.center.z }, 6);
    g.state = 'PATROL'; tick(); expect(stronghold(id).contested).toBe(false);
    g.state = 'COMBAT'; tick(); expect(stronghold(id).contested).toBe(true);
    g.state = 'PATROL'; tick(31); expect(stronghold(id).contested).toBe(true);
    followersAt(sim.ctx.layout.playerStart, 6); tick(30);
    expect(stronghold(id).contested).toBe(false);
  });

  it('handles gate damage as objective aggression and stops repeating alerts for unchanged HP', () => {
    damageGate(sim.ctx, 1); tick(0);
    expect(stronghold('industrial_yard').contested).toBe(true);
    expect(sim.state.districts.industrial.alertLevel).toBeCloseTo(BALANCE.conquest.alertPerStructureHit);
    tick(0); expect(sim.state.districts.industrial.alertLevel).toBeCloseTo(BALANCE.conquest.alertPerStructureHit);
  });

  it('tracks kills once, district metrics at 1 Hz, and bounded local alert decay', () => {
    tick(0);
    const g = sim.state.guards.find(g => g.strongholdId === 'police_station')!;
    const districtId = getDistrictAt(sim.ctx.layout, g.pos);
    const initial = sim.ctx.layout.guards.filter(g => getDistrictAt(sim.ctx.layout, g.pos) === districtId);
    const initialArmed = initial.filter(g => g.role !== 'civilian').length;
    damageGuard(sim.ctx, g, g.hp, 'other'); tick(0);
    expect(sim.state.districts[districtId].alertLevel).toBeCloseTo(BALANCE.conquest.alertPerArmedKill);
    expect(sim.state.districts[districtId].humanStrength).toBe(1);
    tick(1);
    expect(sim.state.districts[districtId].humanStrength).toBeCloseTo((initialArmed - 1) / initialArmed);
    expect(sim.state.districts[districtId].infection).toBeCloseTo(1 / initial.length);
    expect(stronghold('police_station').defenderStrength).toBeCloseTo(7 / 8);
    tick(1);
    expect(sim.state.districts[districtId].alertLevel).toBeCloseTo(BALANCE.conquest.alertPerArmedKill - 2 * BALANCE.conquest.alertDecayPerSecond);
    tick(100); expect(sim.state.districts[districtId].alertLevel).toBe(0);
  });

  it('rewards structure destruction once while preserving releases and one rebuild per grid', () => {
    const s = findStructure(sim.state, 4)!, held = sim.state.zombies.filter(z => z.heldBy === s.id);
    const nav = vi.spyOn(sim.ctx.navGrid, 'rebuild'), crawl = vi.spyOn(sim.ctx.crawlNavGrid, 'rebuild');
    for (const amount of [0, -1, NaN, Infinity]) damageStructure(sim.ctx, s, amount);
    expect(sim.drainEvents()).toEqual([]);
    damageStructure(sim.ctx, s, s.hp); damageStructure(sim.ctx, s, 1000); tick(0);
    expect(nav).toHaveBeenCalledTimes(1); expect(crawl).toHaveBeenCalledTimes(1);
    expect(sim.state.progression.biomass).toBe(BALANCE.progression.biomassStructure);
    expect(held.every(z => z.heldBy === 0 && z.state === 'ambient')).toBe(true);
    expect(stronghold('suburb_checkpoint').contested).toBe(true);
    expect(sim.drainEvents().filter(e => e.type === 'biomassGain')).toHaveLength(1);
  });
});

describe('bounded reinforcements and nests', () => {
  it('spawns farthest-point police patrol waves, enforces cooldown and lifetime wave budget', () => {
    const def = definition('police_station'), sh = stronghold(def.id), initial = sim.state.guards.length;
    const farthest = [...def.reinforcementPoints].sort((a, b) =>
      Math.hypot(b.x - sim.state.leader.pos.x, b.z - sim.state.leader.pos.z) -
      Math.hypot(a.x - sim.state.leader.pos.x, a.z - sim.state.leader.pos.z))[0];
    for (let wave = 0; wave < BALANCE.conquest.maxReinforcementWaves + 3; wave++) {
      sim.state.districts.police.alertLevel = 1; tick(0);
      tick(0); sim.state.time += BALANCE.conquest.reinforcementCooldown;
    }
    expect(sh.reinforcementsSpent).toBe(BALANCE.conquest.maxReinforcementWaves);
    const added = sim.state.guards.slice(initial);
    expect(added).toHaveLength(BALANCE.conquest.reinforcementSize * BALANCE.conquest.maxReinforcementWaves);
    expect(added.every(g => g.role === 'police' && g.post === 'patrol' && g.strongholdId === def.id)).toBe(true);
    for (const g of added) expect(g.waypoints).toEqual([farthest, def.center]);
    expect(new Set(sim.state.guards.map(g => g.id)).size).toBe(sim.state.guards.length);
    expect(sim.drainEvents().filter(e => e.type === 'reinforcements')).toHaveLength(BALANCE.conquest.maxReinforcementWaves);
  });

  it('obeys the living-human cap and never spends a wave when no room or spawn point exists', () => {
    const def = definition('mall_security'), sh = stronghold(def.id);
    while (sim.state.guards.length < BALANCE.population.maxHumans) {
      sim.state.guards.push(createGuard(sim.ctx.newId(), { role: 'civilian', post: 'street', pos: sim.state.leader.pos,
        facing: 0, tower: null, waypoints: [sim.state.leader.pos] }, sim.ctx.collision));
    }
    sim.state.districts.shopping.alertLevel = 1; tick(0);
    expect(sh.reinforcementsSpent).toBe(0);
    const g = sim.state.guards.at(-1)!; g.hp = 0; g.state = 'DEAD';
    const points = def.reinforcementPoints; def.reinforcementPoints = []; tick(0);
    expect(sh.reinforcementsSpent).toBe(0);
    def.reinforcementPoints = points; tick(0);
    expect(sh.reinforcementsSpent).toBe(1);
    expect(sim.state.guards.filter(g => g.hp > 0 && g.state !== 'DEAD')).toHaveLength(BALANCE.population.maxHumans);
    expect(sim.drainEvents().filter(e => e.type === 'reinforcements')).toMatchObject([{ count: 1 }]);
  });

  it('suppresses reinforcement waves in captured districts', () => {
    captureHold('mall_security'); sim.drainEvents();
    for (let i = 0; i < 6; i++) {
      sim.state.districts.shopping.alertLevel = 1;
      sim.state.time += BALANCE.conquest.reinforcementCooldown; tick(0);
    }
    expect(stronghold('mall_security').reinforcementsSpent).toBe(0);
    expect(sim.drainEvents().some(e => e.type === 'reinforcements')).toBe(false);
  });

  it('replenishes one free follower per interval to the target without recruitment stats or pulses', () => {
    const initialStats = { ...sim.state.stats }, ids = new Set(sim.state.zombies.map(z => z.id));
    tick(BALANCE.nest.replenishInterval - 0.1); expect(sim.state.followerCount).toBe(5);
    tick(0.1); expect(sim.state.followerCount).toBe(6);
    for (let i = 0; i < 10; i++) tick(BALANCE.nest.replenishInterval);
    expect(sim.state.followerCount).toBe(BALANCE.nest.replenishTarget);
    expect(sim.state.followerCount).toBe(sim.state.zombies.filter(z => z.state === 'follower').length);
    expect(sim.state.stats).toEqual(initialStats);
    for (const z of sim.state.zombies.filter(z => !ids.has(z.id))) {
      expect(z).toMatchObject({ recruitGen: 0, pulseAt: -1, state: 'follower', dormant: false, brute: false });
      expect(sim.ctx.collision.isBlocked(z.pos, z.radius)).toBe(false);
    }
    expect(sim.drainEvents().some(e => e.type === 'recruited' || e.type === 'momentumGain')).toBe(false);
  });

  it('requires a living leader at an active nest and resets partial replenishment on departure', () => {
    expect(isNestActive(sim.ctx, 'missing')).toBe(false);
    expect(isNestActive(sim.ctx, 'nest_start')).toBe(true);
    expect(isNestActive(sim.ctx, definition('mall_security').nestId)).toBe(false);
    tick(3); sim.state.leader.pos = { x: -100, z: 80 }; tick(1);
    sim.state.leader.pos = { ...sim.ctx.layout.playerStart }; tick(1);
    expect(sim.state.followerCount).toBe(5);
    sim.state.leader.alive = false; tick(10);
    expect(sim.state.followerCount).toBe(5);
    sim.state.leader.alive = true;
    sim.state.leader.pos = { ...sim.ctx.layout.nests.find(n => n.strongholdId === 'mall_security')!.pos };
    tick(10); expect(sim.state.followerCount).toBe(5);
  });

  it('reserves follower capacity for rising zombies during nest replenishment', () => {
    for (let i = sim.state.followerCount; i < BALANCE.openWorld.maxFollowers; i++) {
      sim.state.zombies.push(createZombie(sim.ctx.newId(), sim.state.leader.pos, {
        state: 'rising', variant: 0, spawnZone: -1, isConverted: true, rng: sim.ctx.rng,
      }));
    }
    tick(BALANCE.nest.replenishInterval);
    expect(sim.state.followerCount).toBe(5);
  });
});
