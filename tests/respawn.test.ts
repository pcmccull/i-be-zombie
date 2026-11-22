import { beforeEach, describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { createZombie } from '../src/entities/Zombie';
import { Simulation } from '../src/sim/Simulation';
import { followerCap } from '../src/systems/HordeSystem';
import { damageLeader, killLeader } from '../src/systems/CombatSystem';
import { updateConquest } from '../src/systems/ConquestSystem';
import { unlockAbility } from '../src/systems/ProgressionSystem';
import { updateHordeHealth } from '../src/systems/HordeHealthSystem';
import { updateRespawn } from '../src/systems/RespawnSystem';
import { damageStructure, findStructure } from '../src/systems/StructureSystem';
import { buildDistrictLayout } from '../src/world/districtLayout';
import { usePreBeachEconomy } from './support/preBeachEconomy';

usePreBeachEconomy();

let sim: Simulation;
beforeEach(() => { sim = new Simulation(buildDistrictLayout()); });
function die(): void { killLeader(sim.ctx); updateRespawn(sim.ctx, BALANCE.sim.fixedDt); }
/** The Alpha climbs out beside the mound: emergeOffset m from the nest centre. */
function expectBesideNest(pos: { x: number; z: number }, nest: { x: number; z: number }): void {
  expect(Math.hypot(pos.x - nest.x, pos.z - nest.z)).toBeLessThanOrEqual(BALANCE.respawn.emergeOffset + 1e-6);
}
function finish(): void { updateRespawn(sim.ctx, BALANCE.respawn.delay); }

describe('leader recovery at nests', () => {
  it('enters respawning once, recalls squads, waits the full delay and keeps survivors', () => {
    const survivors = sim.state.zombies.filter(z => z.state === 'follower');
    const originalCount = sim.state.followerCount;
    sim.state.order = { type: 'attack', target: { kind: 'gate' } };
    sim.state.squads = [{ id: 5, target: { kind: 'gate' } }];
    survivors.forEach(z => { z.squad = 5; z.engageTarget = { kind: 'gate' }; });
    sim.ctx.nav.effectiveTarget = { kind: 'gate' };
    sim.ctx.nav.squads.set(5, { attackField: null, effectiveTarget: { kind: 'gate' } });
    die();
    expect(sim.state).toMatchObject({ phase: 'respawning', deaths: 1, order: { type: 'follow' }, squads: [] });
    expect(sim.state.leader.respawnTimer).toBe(BALANCE.respawn.delay);
    expect(survivors.every(z => z.state === 'follower' && z.squad === 0 && z.engageTarget === null)).toBe(true);
    expect(sim.ctx.nav.effectiveTarget).toBeNull(); expect(sim.ctx.nav.squads.size).toBe(0);
    updateRespawn(sim.ctx, BALANCE.respawn.delay - 0.1);
    expect(sim.state.phase).toBe('respawning'); expect(sim.state.deaths).toBe(1);
    updateRespawn(sim.ctx, 0.1);
    expect(sim.state.phase).toBe('playing');
    expect(sim.state.followerCount).toBe(originalCount + BALANCE.respawn.followers);
    expect(survivors.every(z => sim.state.zombies.includes(z) && z.state === 'follower')).toBe(true);
    expect(sim.state.followerCount).toBe(sim.state.zombies.filter(z => z.state === 'follower').length);
    const events = sim.drainEvents();
    expect(events.filter(e => e.type === 'leaderRespawned')).toHaveLength(1);
    expect(events.filter(e => e.type === 'autosave' && e.reason === 'respawn')).toHaveLength(1);
    expect(events.some(e => e.type === 'defeat' || e.type === 'victory')).toBe(false);
    updateRespawn(sim.ctx, 20);
    expect(sim.drainEvents()).toEqual([]);
    expect(sim.state.deaths).toBe(1);
  });

  it('restores full combat/movement state and leaves progression, territory, discovery and stats untouched', () => {
    unlockAbility(sim.ctx, 'alpha_claws'); sim.state.progression.biomass = 57;
    sim.state.progression.cooldowns.alpha_claws = 3;
    updateConquest(sim.ctx, 0);
    const progression = structuredClone(sim.state.progression), districts = structuredClone(sim.state.districts);
    const strongholds = structuredClone(sim.state.strongholds), discovery = structuredClone(sim.state.discovery), stats = { ...sim.state.stats };
    const l = sim.state.leader;
    l.pos = { x: 100, z: -100 }; l.stamina = 0; l.exhausted = true;
    l.sprinting = true; l.attackPhase = 'windup'; l.attackTimer = 9;
    l.comboStep = 3; l.comboWindow = 1; l.hitStun = 2; l.hitFlash = 3;
    die(); finish();
    expect(l).toMatchObject({ alive: true, stamina: BALANCE.leader.staminaMax,
      exhausted: false, sprinting: false, vel: { x: 0, z: 0 }, attackPhase: 'ready', attackTimer: 0,
      comboStep: 0, comboWindow: 0, hitStun: 0, hitFlash: 0, anim: 'rise', animTime: 0, respawnTimer: 0, emergeTimer: BALANCE.respawn.emergeTime, attackCooldown: 0 });
    expectBesideNest(l.pos, sim.ctx.layout.nests[0].pos); expect(l.prevPos).toEqual(l.pos);
    expect(l.prevFacing).toBe(l.facing);
    expect(sim.state.progression).toEqual(progression); expect(sim.state.districts).toEqual(districts);
    expect(sim.state.strongholds).toEqual(strongholds); expect(sim.state.discovery).toEqual(discovery);
    expect(sim.state.stats).toEqual(stats);
  });

  it('respawns at a newly captured mall nest and retains the capture reward', () => {
    const def = sim.ctx.layout.strongholds.find(s => s.id === 'mall_security')!, hold = def.objectives[1];
    damageStructure(sim.ctx, findStructure(sim.state, def.objectives[0].structureId!)!, 10000);
    sim.state.zombies.filter(z => z.state === 'follower').forEach(z => { z.pos = { ...hold.point! }; });
    sim.state.guards.filter(g => g.strongholdId === def.id).forEach(g => { g.pos = { x: 190, z: 145 }; });
    updateConquest(sim.ctx, hold.holdTime!);
    expect(sim.state.activeNestId).toBe(def.nestId);
    const biomass = sim.state.progression.biomass;
    die(); finish();
    expectBesideNest(sim.state.leader.pos, sim.ctx.layout.nests.find(n => n.id === def.nestId)!.pos);
    expect(sim.state.progression.unlocked).toContain('horde_frenzy');
    expect(sim.state.progression.biomass).toBe(biomass);
    expect(sim.state.districts.shopping.status).toBe('infected');
    expect(sim.drainEvents().filter(e => e.type === 'leaderRespawned')).toMatchObject([{ nestId: def.nestId }]);
  });

  it('honors a selected active nest even when another is closer to death', () => {
    sim.state.strongholds.find(s => s.id === 'police_station')!.captured = true;
    sim.state.activeNestId = 'nest_start';
    sim.state.leader.pos = { ...sim.ctx.layout.nests.find(n => n.strongholdId === 'police_station')!.pos };
    die(); finish();
    expect(sim.state.activeNestId).toBe('nest_start');
    expectBesideNest(sim.state.leader.pos, sim.ctx.layout.nests.find(n => n.id === 'nest_start')!.pos);
  });

  it.each(['missing', 'nest_industrial_yard'])('falls back from inactive selection %s to the nearest active nest', selected => {
    const nest = sim.ctx.layout.nests.find(n => n.strongholdId === 'police_station')!;
    sim.state.strongholds.find(s => s.id === 'police_station')!.captured = true;
    sim.state.activeNestId = selected; sim.state.leader.pos = { x: nest.pos.x + 2, z: nest.pos.z };
    die(); finish();
    expect(sim.state.activeNestId).toBe(nest.id);
    expectBesideNest(sim.state.leader.pos, nest.pos);
  });

  it.each([0, 1])('respects the follower cap with %i reserved rising slots', rising => {
    while (sim.state.followerCount < followerCap(sim.ctx) - 1) {
      sim.state.zombies.push(createZombie(sim.ctx.newId(), { x: -100, z: 80 }, {
        state: 'follower', variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng,
      })); sim.state.followerCount++;
    }
    if (rising) sim.state.zombies.push(createZombie(sim.ctx.newId(), { x: -100, z: 80 }, {
      state: 'rising', variant: 0, spawnZone: -1, isConverted: true, rng: sim.ctx.rng,
    }));
    const before = sim.state.followerCount;
    die(); finish();
    expect(sim.state.followerCount).toBe(before + 1 - rising);
    expect(sim.state.followerCount).toBe(sim.state.zombies.filter(z => z.state === 'follower').length);
    expect(new Set(sim.state.zombies.map(z => z.id)).size).toBe(sim.state.zombies.length);
  });

  it('creates healthy collision-free gen-zero followers without recruitment rewards or pulses', () => {
    const nextId = sim.state.nextEntityId, stats = { ...sim.state.stats }, momentum = { ...sim.state.momentum };
    die(); finish();
    const added = sim.state.zombies.filter(z => z.id >= nextId);
    expect(added).toHaveLength(BALANCE.respawn.followers);
    for (const z of added) {
      expect(z).toMatchObject({ state: 'follower', recruitGen: 0, pulseAt: -1, heldBy: 0, dormant: false, brute: false, hp: z.maxHp });
      expect(z.prevPos).toEqual(z.pos);
      expect(sim.ctx.collision.isBlocked(z.pos, z.radius)).toBe(false);
    }
    expect(sim.state.stats).toEqual(stats); expect(sim.state.momentum).toEqual(momentum);
  });

  it('leaves legacy victory/defeat phases alone and resets cleanly between deaths', () => {
    for (const phase of ['victory', 'defeat'] as const) {
      sim.state.phase = phase; sim.state.leader.alive = false;
      updateRespawn(sim.ctx, 10); expect(sim.state.phase).toBe(phase); expect(sim.state.deaths).toBe(0);
    }
    sim.reset(); die(); finish(); die(); finish();
    expect(sim.state.deaths).toBe(2);
    sim.reset(); updateRespawn(sim.ctx, 20);
    expect(sim.state.deaths).toBe(0); expect(sim.state.followerCount).toBe(BALANCE.horde.startFollowers);
  });

  it('real depletion: core + followers drained -> Last Brain -> finishing hit after the entry grace kills the Alpha, respawn refills the core', () => {
    const lb = BALANCE.hordeHealth.lastBrain;
    damageLeader(sim.ctx, 1e6); updateHordeHealth(sim.ctx, 0);
    expect(sim.state.horde.lastBrain.active).toBe(true); expect(sim.state.leader.alive).toBe(true);
    damageLeader(sim.ctx, 50); // inside the entry grace: shielded
    expect(sim.state.leader.alive).toBe(true);
    updateHordeHealth(sim.ctx, lb.entryGrace + 0.01);
    damageLeader(sim.ctx, 1);
    expect(sim.state.leader.alive).toBe(false);
    expect(sim.drainEvents().filter(e => e.type === 'leaderDied')).toHaveLength(1);
    updateRespawn(sim.ctx, BALANCE.sim.fixedDt); finish();
    expect(sim.state.leader.alive).toBe(true); expect(sim.state.horde.coreDamage).toBe(0);
  });

  it('real depletion: Last Brain expires after its duration without a finishing hit', () => {
    damageLeader(sim.ctx, 1e6); updateHordeHealth(sim.ctx, 0);
    expect(sim.state.horde.lastBrain.active).toBe(true);
    updateHordeHealth(sim.ctx, BALANCE.hordeHealth.lastBrain.duration + 0.1);
    expect(sim.state.leader.alive).toBe(false);
  });
});
