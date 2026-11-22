import { describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../src/config/balance';
import type { ColliderDef, HordeCommand, StrongholdDef, Vec2, ZombieAgent } from '../src/core/types';
import { emptyInput } from '../src/core/types';
import { createZombie, evolveToBrute } from '../src/entities/Zombie';
import { createGuard } from '../src/entities/HumanGuard';
import { Simulation } from '../src/sim/Simulation';
import { applyHordeCommands, countFollowers, killZombie, recruitZombie, updateHorde } from '../src/systems/HordeSystem';
import { canTarget } from '../src/systems/AwarenessSystem';
import { updateNavigation } from '../src/systems/NavigationSystem';
import { activateAbility, unlockAbility, updateProgression } from '../src/systems/ProgressionSystem';
import { buildLegacyDistrictLayout } from '../src/world/legacyDistrictLayout';
import { usePreBeachEconomy } from './support/preBeachEconomy';

usePreBeachEconomy();

const dt = BALANCE.sim.fixedDt;
const stronghold: StrongholdDef = {
  id: 'suburb_checkpoint', districtId: 'suburbs', name: 'Test pen',
  bounds: { minX: 30, maxX: 50, minZ: -8, maxZ: 8 }, center: { x: 40, z: 0 },
  defenseTier: 1, unlock: null, biomassReward: 15, objectives: [], nestId: 'nest_test', reinforcementPoints: [],
};

function fixture(extra: ColliderDef[] = [], open = false, wide = false): Simulation {
  const layout = buildLegacyDistrictLayout();
  if (wide) layout.bounds = { minX: -200, maxX: 200, minZ: -160, maxZ: 160 };
  layout.colliders = [...layout.colliders.filter(c => c.kind === 'gate'), ...extra];
  layout.structures = []; layout.spawnZones = [];
  layout.strongholds = open ? [stronghold] : [];
  layout.guards = [{ pos: { x: 70, z: 0 }, facing: 0, tower: null, waypoints: [], role: 'police' },
    { pos: { x: 70, z: 15 }, facing: 0, tower: null, waypoints: [], role: 'civilian' }];
  const sim = new Simulation(layout, 71);
  sim.state.zombies = []; sim.state.followerCount = 0; sim.state.guards = [];
  sim.state.leader.pos = { x: -50, z: 0 }; sim.state.leader.facing = 0;
  return sim;
}

function add(sim: Simulation, x: number, z = 0, opts: Partial<ZombieAgent> = {}): ZombieAgent {
  const agent = createZombie(sim.ctx.newId(), { x, z }, {
    state: 'follower', variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng,
  });
  Object.assign(agent, { speedScale: 1, followOffset: { x: 0, z: 0 } }, opts);
  sim.state.zombies.push(agent);
  if (agent.state === 'follower') sim.state.followerCount++;
  return agent;
}

function human(sim: Simulation, x: number, z = 0, civilian = false) {
  const guard = createGuard(sim.ctx.newId(), { ...sim.ctx.layout.guards[civilian ? 1 : 0], pos: { x, z } }, sim.ctx.collision);
  sim.state.guards.push(guard); return guard;
}

function command(sim: Simulation, hordeCommand: HordeCommand): void {
  applyHordeCommands(sim.ctx, dt, { ...emptyInput(), hordeCommand });
}

function tick(sim: Simulation, steps = 1): void {
  for (let i = 0; i < steps; i++) {
    applyHordeCommands(sim.ctx, dt, emptyInput());
    updateNavigation(sim.ctx, dt, emptyInput()); updateHorde(sim.ctx, dt, emptyInput());
    sim.state.time += dt;
  }
}

function frenzy(sim: Simulation): void {
  unlockAbility(sim.ctx, 'horde_frenzy'); sim.state.progression.biomass = 100;
  expect(activateAbility(sim.ctx, 'horde_frenzy')).toBe(true);
}

const speed = (z: ZombieAgent) => Math.hypot(z.vel.x, z.vel.z);
const ref = (id: number) => ({ kind: 'guard' as const, id });

describe('open-world horde commands', () => {
  it('paths a move around cover, spreads the pack, snapshots its marker, and reverts at 80% arrival', () => {
    const wall: ColliderDef = { minX: 14, maxX: 16, minZ: -8, maxZ: 8,
      height: 3, blocksMove: true, blocksSight: false, kind: 'wall' };
    const sim = fixture([wall]);
    const pack = Array.from({ length: 5 }, (_, i) => add(sim, 0, i * 1.5 - 3,
      { followOffset: { x: i - 2, z: -i } }));
    const point = { x: 40, z: 0 };
    command(sim, { type: 'move', point });
    expect(sim.state.order).toEqual({ type: 'move', point, expiresAt: BALANCE.horde.moveOrderTime });
    const events = sim.drainEvents();
    expect(events.map(e => e.type)).toEqual(['orderChanged', 'moveOrder']);
    point.x = 100;
    expect(events.find(e => e.type === 'moveOrder')).toMatchObject({ point: { x: 40, z: 0 } });
    let detoured = false;
    for (let i = 0; i < 1100 && sim.state.order.type === 'move'; i++) {
      tick(sim);
      for (const z of pack) {
        expect(sim.ctx.collision.isBlocked(z.pos, z.radius)).toBe(false);
        if (Math.abs(z.pos.z) > 8) detoured = true;
      }
    }
    expect(detoured).toBe(true); expect(sim.state.time).toBeLessThan(BALANCE.horde.moveOrderTime);
    expect(sim.state.order).toEqual({ type: 'follow' });
    expect(pack.filter(z => Math.hypot(z.pos.x - 40, z.pos.z) <= 6.2).length).toBeGreaterThanOrEqual(4);
    expect(new Set(pack.map(z => Math.round(z.pos.z))).size).toBeGreaterThan(1);
  });

  it('builds bounded move fields once per order, reuses them while moving, and invalidates on a nav rebuild', () => {
    const sim = fixture(); add(sim, -10);
    const build = vi.spyOn(sim.ctx.crawlNavGrid, 'buildFlowField');
    command(sim, { type: 'move', point: { x: 60, z: 0 } }); tick(sim, 60);
    const calls = () => build.mock.calls.filter(([goals]) => goals[0]?.x === 60);
    expect(calls()).toHaveLength(1); expect(calls()[0][2]).toBeGreaterThanOrEqual(BALANCE.nav.flowFieldMaxDistance);
    sim.ctx.crawlNavGrid.rebuild(); tick(sim); expect(calls()).toHaveLength(2);
    command(sim, { type: 'move', point: { x: 60, z: 0 } }); tick(sim);
    expect(calls()).toHaveLength(3);
    sim.state.time = sim.state.order.type === 'move' ? sim.state.order.expiresAt : -1;
    applyHordeCommands(sim.ctx, dt, emptyInput());
    expect(sim.state.order).toEqual({ type: 'follow' }); expect(sim.state.squads).toHaveLength(0);
  });

  it('requires four out of five arrivals and expires an empty group instead of vacuously arriving', () => {
    const sim = fixture(); const pack = Array.from({ length: 5 }, (_, i) => add(sim, i, i * 2));
    command(sim, { type: 'move', point: { x: 40, z: 0 } });
    for (const z of pack.slice(0, 3)) z.pos = { x: 40, z: 0 };
    applyHordeCommands(sim.ctx, dt, emptyInput()); expect(sim.state.order.type).toBe('move');
    pack[3].pos = { x: 40, z: 6 };
    applyHordeCommands(sim.ctx, dt, emptyInput()); expect(sim.state.order.type).toBe('follow');
    sim.state.zombies = []; sim.state.followerCount = 0;
    command(sim, { type: 'move', point: { x: 20, z: 0 } }); expect(sim.state.order.type).toBe('move');
    sim.state.time += BALANCE.horde.moveOrderTime;
    applyHordeCommands(sim.ctx, dt, emptyInput()); expect(sim.state.order.type).toBe('follow');
  });

  it('auto-engages nearby living humans on a move far from the leader, then resumes its destination', () => {
    const sim = fixture(); const z = add(sim, 0), g = human(sim, 4);
    const dormant = human(sim, 1); dormant.dormant = true;
    command(sim, { type: 'move', point: { x: 45, z: 0 } }); tick(sim);
    expect(z.engageTarget).toEqual(ref(g.id)); expect(sim.state.order.type).toBe('move');
    g.hp = 0; g.state = 'DEAD'; tick(sim, 60);
    expect(z.engageTarget).toBeNull(); expect(z.pos.x).toBeGreaterThan(2);
    expect(sim.state.order.type).toBe('move');
  });

  it('replaces selections on ordinary attack and toggles/splits only with additive attack', () => {
    const sim = fixture(), a = human(sim, 20), b = human(sim, 30, 10);
    for (let i = 0; i < 6; i++) add(sim, i, i);
    command(sim, { type: 'attack', target: ref(a.id), additive: false });
    command(sim, { type: 'attack', target: ref(b.id), additive: true });
    expect(sim.state.squads.map(s => s.target)).toEqual([ref(b.id)]);
    expect(sim.state.zombies.filter(z => z.squad === 0)).toHaveLength(3);
    command(sim, { type: 'attack', target: ref(b.id), additive: false });
    expect(sim.state.order).toEqual({ type: 'attack', target: ref(b.id) });
    expect(sim.state.squads).toHaveLength(0); expect(sim.state.zombies.every(z => z.squad === 0)).toBe(true);
    applyHordeCommands(sim.ctx, dt, { ...emptyInput(), attackTarget: ref(b.id),
      hordeCommand: { type: 'attack', target: ref(b.id), additive: false } });
    expect(sim.state.order.type).toBe('attack');
    command(sim, { type: 'attack', target: ref(b.id), additive: true }); expect(sim.state.order.type).toBe('follow');
    command(sim, { type: 'move', point: { x: 50, z: 0 } });
    command(sim, { type: 'attack', target: ref(a.id), additive: true });
    expect(sim.state.order).toEqual({ type: 'attack', target: ref(a.id) }); expect(sim.state.squads).toHaveLength(0);
  });

  it('regroup (legacy) and follow both just recall the horde; neither rallies', () => {
    const sim = fixture(); const g = human(sim, 20), z = add(sim, 0);
    const ambient = add(sim, -36, 0, { state: 'ambient' });
    command(sim, { type: 'attack', target: ref(g.id), additive: false }); tick(sim);
    command(sim, { type: 'regroup' });
    expect(sim.state.order).toEqual({ type: 'follow' }); expect(z.engageTarget).toBeNull();
    expect(ambient.state).toBe('ambient');
    expect(sim.drainEvents().some(e => e.type === 'rally')).toBe(false);
    const unrecruited = add(sim, -36, 3, { state: 'ambient' });
    command(sim, { type: 'attack', target: ref(g.id), additive: false });
    command(sim, { type: 'follow' });
    expect(sim.state.order).toEqual({ type: 'follow' }); expect(unrecruited.state).toBe('ambient');
    expect(sim.drainEvents().some(e => e.type === 'rally')).toBe(false);
  });
});

describe('Frenzy, population limits, and dormancy', () => {
  it('uses the activation origin before leader movement and multiplies the full catch-up speed', () => {
    const sim = fixture(); sim.state.leader.pos = { x: 0, z: 0 };
    const z = add(sim, BALANCE.frenzy.radius);
    unlockAbility(sim.ctx, 'horde_frenzy'); sim.state.progression.biomass = 100;
    applyHordeCommands(sim.ctx, dt, emptyInput());
    updateProgression(sim.ctx, dt, { ...emptyInput(), abilitySlot: 0 });
    sim.state.leader.pos.x = -1;
    updateNavigation(sim.ctx, dt, emptyInput()); updateHorde(sim.ctx, dt, emptyInput());
    tick(sim, 50);
    const catchUpSpeed = Math.max(BALANCE.walker.speed * BALANCE.walker.catchUpMultiplier,
      BALANCE.leader.walkSpeed * BALANCE.walker.catchUpLeaderMargin);
    expect(speed(z)).toBeCloseTo(catchUpSpeed * BALANCE.frenzy.speedMultiplier, 5);
  });

  it('buffs only the activation cohort, retaining membership after moving and excluding later followers', () => {
    const sim = fixture(); sim.state.leader.pos = { x: 0, z: 0 };
    const inside = add(sim, BALANCE.frenzy.radius), outside = add(sim, BALANCE.frenzy.radius + 1, 10);
    command(sim, { type: 'move', point: { x: 100, z: 0 } }); frenzy(sim);
    updateHorde(sim.ctx, 0, emptyInput());
    inside.pos = { x: 60, z: -10 }; outside.pos = { x: 10, z: 10 };
    const later = add(sim, 20, -15);
    tick(sim, 45);
    expect(speed(inside)).toBeCloseTo(BALANCE.walker.speed * BALANCE.frenzy.speedMultiplier, 5);
    expect(speed(outside)).toBeCloseTo(BALANCE.walker.speed, 5); expect(speed(later)).toBeCloseTo(BALANCE.walker.speed, 5);
    updateProgression(sim.ctx, BALANCE.frenzy.duration, emptyInput()); tick(sim, 20);
    expect(speed(inside)).toBeCloseTo(BALANCE.walker.speed, 5);
    sim.state.progression.cooldowns.horde_frenzy = 0;
    sim.state.leader.pos = { ...outside.pos }; frenzy(sim); tick(sim, 40);
    expect(speed(outside)).toBeCloseTo(BALANCE.walker.speed * BALANCE.frenzy.speedMultiplier, 5);
    expect(speed(inside)).toBeCloseTo(BALANCE.walker.speed, 5);
  });

  it('applies the Rush civilian chase exception only to Frenzy-buffed followers and still stacks legacy Rush', () => {
    const sim = fixture(); sim.state.leader.pos = { x: 0, z: 0 };
    const buffed = add(sim, 10), plain = add(sim, 25, 10), civilian = human(sim, 70, 0, true);
    civilian.state = 'RETREAT'; sim.state.momentum.value = 100;
    command(sim, { type: 'attack', target: ref(civilian.id), additive: false }); frenzy(sim); tick(sim, 45);
    expect(speed(buffed)).toBeGreaterThanOrEqual(BALANCE.civilian.fleeSpeed * BALANCE.civilian.rushChaseFactor - 1e-6);
    expect(speed(plain)).toBeLessThanOrEqual(BALANCE.civilian.fleeSpeed * BALANCE.civilian.chaseSpeedFactor + 1e-6);
    command(sim, { type: 'move', point: { x: 100, z: -20 } });
    applyHordeCommands(sim.ctx, dt, { ...emptyInput(), rush: true }); tick(sim, 60);
    expect(speed(buffed)).toBeCloseTo(BALANCE.walker.speed * 1.2 * BALANCE.frenzy.speedMultiplier * BALANCE.rush.speedMultiplier, 5);
    expect(speed(plain)).toBeCloseTo(BALANCE.walker.speed * 1.2 * BALANCE.rush.speedMultiplier, 5);
  });

  it.each([true, false])('reserves rising slots at the open-world/legacy cap (open=%s)', open => {
    const sim = fixture([], open), cap = open ? BALANCE.openWorld.maxFollowers : BALANCE.horde.maxFollowers;
    for (let i = 0; i < cap - 1; i++) add(sim, i % 10, Math.floor(i / 10));
    const rising = add(sim, 0, 0, { state: 'rising' }), extra = add(sim, 0, 0, { state: 'ambient' });
    expect(recruitZombie(sim.ctx, extra, false)).toBe(false);
    expect(sim.drainEvents().filter(e => e.type === 'capReached')).toHaveLength(1);
    killZombie(sim.ctx, rising); expect(recruitZombie(sim.ctx, extra, false)).toBe(true);
    expect(sim.state.followerCount).toBe(cap); expect(countFollowers(sim.state)).toBe(cap);
    expect(recruitZombie(sim.ctx, add(sim, 0, 0, { state: 'ambient' }), true)).toBe(false);
  });

  it('shares the open-world cap across passive, rally, and cascading recruitment', () => {
    const sim = fixture([], true); sim.state.leader.pos = { x: 0, z: 0 };
    for (let i = 0; i < 39; i++) add(sim, -10, -10);
    const pulser = sim.state.zombies[0]; pulser.pulseAt = 0; pulser.recruitGen = 0;
    const passive = add(sim, 1, 0, { state: 'ambient' });
    const cascade = add(sim, -10, -9, { state: 'ambient' });
    updateHorde(sim.ctx, 0, emptyInput());
    expect(passive.state).toBe('follower'); expect(cascade.state).toBe('ambient');
    command(sim, { type: 'regroup' }); expect(cascade.state).toBe('ambient');
    expect(sim.state.followerCount).toBe(40); expect(countFollowers(sim.state)).toBe(40);
  });

  it('leaves dormant ambient state and RNG untouched, excludes it from the hash and every recruit path, and wakes followers', () => {
    const sim = fixture(); sim.state.leader.pos = { x: 0, z: 0 };
    const dormant = add(sim, 1, 0, { state: 'ambient', dormant: true, pulseAt: 4, wanderTimer: 0 });
    const pulser = add(sim, 0, 0, { dormant: true, pulseAt: 0, recruitGen: 0 });
    const before = structuredClone(dormant); const rng = vi.spyOn(sim.ctx.rng, 'next');
    updateHorde(sim.ctx, dt, emptyInput());
    expect(dormant).toEqual(before); expect(rng).not.toHaveBeenCalled(); expect(pulser.dormant).toBe(false);
    const ids: number[] = []; sim.ctx.zombieHash.query(0, 0, 10, ids); expect(ids).not.toContain(dormant.id);
    expect(recruitZombie(sim.ctx, dormant, false)).toBe(false);
    command(sim, { type: 'regroup' }); expect(dormant).toEqual(before);
  });
});

describe('bounded navigation and brute steering', () => {
  it('catches up beyond the follow-field bound without teleporting a visible follower and caches its path', () => {
    const sim = fixture([], false, true); sim.state.leader.pos = { x: 60, z: 0 };
    const z = add(sim, -170); const path = vi.spyOn(sim.ctx.crawlNavGrid, 'findPath');
    updateNavigation(sim.ctx, dt, emptyInput()); expect(sim.ctx.nav.followField!.distanceAt(z.pos)).toBe(Infinity);
    tick(sim, 50); expect(z.pos.x).toBeGreaterThan(-167); expect(z.pos.x).toBeLessThan(-160);
    expect(path).toHaveBeenCalledTimes(1); tick(sim, 20); expect(path).toHaveBeenCalledTimes(2);
    expect(sim.drainEvents()).toHaveLength(0);
  });

  it('uses a bounded A* budget and also recovers a nearby blocked follower outside the path-cost bound', () => {
    const wall: ColliderDef = { minX: 0, maxX: 1, minZ: -80, maxZ: 80,
      height: 5, blocksMove: true, blocksSight: true, kind: 'wall' };
    const sim = fixture([wall]); sim.state.leader.pos = { x: 6, z: 0 };
    const pack = Array.from({ length: 5 }, (_, i) => add(sim, -5, i * 2));
    const path = vi.spyOn(sim.ctx.crawlNavGrid, 'findPath');
    updateNavigation(sim.ctx, dt, emptyInput());
    expect(sim.ctx.nav.followField!.distanceAt(pack[0].pos)).toBe(Infinity);
    tick(sim); expect(path).toHaveBeenCalledTimes(2);
    tick(sim); expect(path).toHaveBeenCalledTimes(4);
    tick(sim, 45); expect(path).toHaveBeenCalledTimes(5);
    expect(pack.every(z => Math.abs(z.pos.z) > 1)).toBe(true);
    expect(pack.every(z => !sim.ctx.collision.isBlocked(z.pos, z.radius))).toBe(true);
  });

  it('teleports hidden disengaged stragglers deterministically behind the leader, outside strongholds, without events', () => {
    const wall: ColliderDef = { minX: -1, maxX: 1, minZ: -90, maxZ: 90,
      height: 5, blocksMove: true, blocksSight: true, kind: 'wall' };
    const results: Vec2[] = [];
    for (let run = 0; run < 2; run++) {
      const sim = fixture([wall], true); sim.state.leader.pos = { x: 70, z: 0 }; sim.state.leader.facing = Math.PI / 2;
      const z = add(sim, -100); updateHorde(sim.ctx, 0, emptyInput());
      expect(z.pos.x).toBeGreaterThan(1); expect(z.pos.x).toBeLessThan(70);
      expect(Math.hypot(z.pos.x - 70, z.pos.z)).toBeCloseTo(BALANCE.nav.farCatchUpOffscreen, 4);
      const r = stronghold.bounds;
      expect(z.pos.x >= r.minX && z.pos.x <= r.maxX && z.pos.z >= r.minZ && z.pos.z <= r.maxZ).toBe(false);
      expect(sim.ctx.collision.isBlocked(z.pos, z.radius)).toBe(false); expect(z.prevPos).toEqual(z.pos);
      expect(sim.drainEvents()).toHaveLength(0); results.push({ ...z.pos });
    }
    expect(results[0]).toEqual(results[1]);
  });

  it('keeps engaged followers and commanded movers at their location despite hidden distance', () => {
    const wall: ColliderDef = { minX: -1, maxX: 1, minZ: -90, maxZ: 90,
      height: 5, blocksMove: true, blocksSight: true, kind: 'wall' };
    const sim = fixture([wall]); sim.state.leader.pos = { x: 70, z: 0 };
    const z = add(sim, -100), g = human(sim, -97);
    command(sim, { type: 'attack', target: ref(g.id), additive: false }); tick(sim);
    expect(z.engageTarget).toEqual(ref(g.id)); expect(z.pos.x).toBeLessThan(-99);
    command(sim, { type: 'move', point: { x: -70, z: 0 } }); tick(sim);
    expect(z.pos.x).toBeLessThan(-99); expect(sim.state.order.type).toBe('move');
  });

  it('keeps walking when every catch-up destination would enter a stronghold', () => {
    const wall: ColliderDef = { minX: -1, maxX: 1, minZ: -90, maxZ: 90,
      height: 5, blocksMove: true, blocksSight: true, kind: 'wall' };
    const sim = fixture([wall], true); sim.state.leader.pos = { x: 70, z: 0 }; sim.state.leader.facing = Math.PI / 2;
    sim.ctx.layout.strongholds = [{ ...stronghold, bounds: { minX: 20, maxX: 60, minZ: -50, maxZ: 50 } }];
    const z = add(sim, -100); tick(sim, 10);
    expect(z.pos.x).toBeLessThan(-99); expect(speed(z)).toBeGreaterThan(0);
    expect(sim.drainEvents()).toHaveLength(0);
  });

  it('prefers a selected gate over a human for brutes, regardless of their assigned split', () => {
    const sim = fixture(), g = human(sim, 10), z = add(sim, 8); evolveToBrute(z);
    for (let i = 0; i < 5; i++) add(sim, 60 + i, -30);
    command(sim, { type: 'attack', target: ref(g.id), additive: false });
    command(sim, { type: 'attack', target: { kind: 'gate' }, additive: true }); tick(sim);
    expect(z.squad).toBe(0); expect(z.engageTarget).toEqual({ kind: 'gate' });
  });

  it('routes brutes around a crawlable car using their own radius while the pack crawls across it', () => {
    const car: ColliderDef = { minX: 2, maxX: 5, minZ: -3, maxZ: 3,
      height: 1.7, blocksMove: true, blocksSight: true, kind: 'vehicle' };
    const sim = fixture([car]); sim.state.leader.pos = { x: 12, z: 0 };
    const brute = add(sim, 0); evolveToBrute(brute);
    const pack = Array.from({ length: 8 }, (_, i) => add(sim, -0.2 - (i % 3) * 0.7, (Math.floor(i / 3) - 1) * 0.7));
    let roof = 0, detour = false;
    for (let i = 0; i < 600; i++) {
      tick(sim); expect(brute.elevation).toBe(0); expect(sim.ctx.collision.isBlocked(brute.pos, brute.radius)).toBe(false);
      roof = Math.max(roof, ...pack.map(z => z.elevation)); if (Math.abs(brute.pos.z) > 3) detour = true;
    }
    expect(roof).toBeGreaterThan(0.5); expect(detour).toBe(true); expect(brute.pos.x).toBeGreaterThan(5);
    expect(brute.radius).toBe(BALANCE.brute.radius);
    expect(brute.speedScale).toBe(BALANCE.brute.speedMultiplier);
  });
});

describe('EW vision order gate (open world only)', () => {
  const identify = (sim: Simulation, id: number): void => { sim.state.vision.identified.push(id); sim.state.vision.identified.sort((a, b) => a - b); };

  it('turns an attack on an unidentified human into a move to its position', () => {
    const sim = fixture([], true);
    const g = human(sim, 70, 0);
    expect(canTarget(sim.state, g.id)).toBe(false);
    command(sim, { type: 'attack', target: ref(g.id), additive: false });
    expect(sim.state.order.type).toBe('move');
    if (sim.state.order.type === 'move') expect(Math.hypot(sim.state.order.point.x - 70, sim.state.order.point.z)).toBeLessThan(3);
    expect(sim.state.squads).toHaveLength(0);
  });

  it('attacks an identified human, and split-target adds follow the same rule', () => {
    const sim = fixture([], true);
    const a = human(sim, 70, 0), b = human(sim, 70, 15);
    identify(sim, a.id);
    command(sim, { type: 'attack', target: ref(a.id), additive: false });
    expect(sim.state.order).toEqual({ type: 'attack', target: ref(a.id) });
    command(sim, { type: 'attack', target: ref(b.id), additive: true }); // unidentified: becomes a move, no squad added
    expect(sim.state.squads).toHaveLength(0);
    expect(sim.state.order.type).toBe('move');
    identify(sim, a.id);
    command(sim, { type: 'attack', target: ref(a.id), additive: false });
    identify(sim, b.id);
    command(sim, { type: 'attack', target: ref(b.id), additive: true });
    expect(sim.state.squads.length + (sim.state.order.type === 'attack' ? 1 : 0)).toBe(2);
  });

  it('never auto-picks an unidentified human as the successor when the ordered target dies', () => {
    const sim = fixture([], true);
    add(sim, 60, 0);
    const a = human(sim, 70, 0), b = human(sim, 74, 0);
    identify(sim, a.id);
    command(sim, { type: 'attack', target: ref(a.id), additive: false });
    a.hp = 0; a.state = 'DEAD';
    applyHordeCommands(sim.ctx, dt, emptyInput());
    expect(sim.state.order).not.toEqual({ type: 'attack', target: ref(b.id) });
    expect(sim.state.order.type).toBe('follow');
    // Once identified, the same successor is allowed.
    const c = human(sim, 78, 0); identify(sim, c.id);
    const d = human(sim, 82, 0); identify(sim, d.id);
    command(sim, { type: 'attack', target: ref(c.id), additive: false });
    c.hp = 0; c.state = 'DEAD';
    applyHordeCommands(sim.ctx, dt, emptyInput());
    expect(sim.state.order).toEqual({ type: 'attack', target: ref(d.id) });
  });

  it('gates the left-click toggle path too', () => {
    const sim = fixture([], true);
    const g = human(sim, 70, 0);
    applyHordeCommands(sim.ctx, dt, { ...emptyInput(), attackTarget: ref(g.id) });
    expect(sim.state.order.type).toBe('move');
  });

  it('leaves the legacy layout unchanged', () => {
    const sim = fixture([], false);
    const g = human(sim, 70, 0);
    command(sim, { type: 'attack', target: ref(g.id), additive: false });
    expect(sim.state.order).toEqual({ type: 'attack', target: ref(g.id) });
  });
});
