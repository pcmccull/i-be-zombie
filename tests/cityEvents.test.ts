import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { DYNAMIC_EVENTS } from '../src/content/events';
import { SECRETS } from '../src/content/rewards';
import { emptyInput, type DynamicEventKind, type GameEvent, type Vec2 } from '../src/core/types';
import { Simulation } from '../src/sim/Simulation';
import { eventHumanCount, spawnCityEvent, visibleLimit } from '../src/systems/CityActivityDirector';
import { toggleCompanionSlot } from '../src/systems/CompanionSystem';
import { shortcutAt } from '../src/systems/HideoutSystem';
import { grantReward } from '../src/systems/RewardSystem';
import { buildDistrictLayout } from '../src/world/districtLayout';
import { usePreBeachEconomy } from './support/preBeachEconomy';

usePreBeachEconomy();

const layout = buildDistrictLayout();
const dt = BALANCE.sim.fixedDt;
const SPOT: Vec2 = { x: -130, z: 110 };

function place(sim: Simulation, p: Vec2): void {
  sim.state.leader.pos = { ...p };
  sim.state.leader.prevPos = { ...p };
}

function steps(sim: Simulation, seconds: number, events?: GameEvent[]): void {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    sim.step(dt, emptyInput());
    const ev = sim.drainEvents();
    if (events) events.push(...ev);
  }
}

describe('City events (docs/11_cityupgrade.md §2.5, §3)', () => {
  it('every catalog kind stages with participants or dressing', () => {
    for (const def of DYNAMIC_EVENTS) {
      const sim = new Simulation(layout, 7);
      place(sim, { x: SPOT.x + 60, z: SPOT.z });
      const ev = spawnCityEvent(sim.ctx, def.id as DynamicEventKind, SPOT);
      expect(ev, def.id).not.toBeNull();
      const people = ev!.participantGuardIds.length + ev!.participantZombieIds.length + ev!.pendingSpawns;
      expect(people, def.id).toBeGreaterThan(0);
    }
    expect(DYNAMIC_EVENTS.length).toBeGreaterThanOrEqual(11);
  });

  it('crowd kinds look different: bus unloads tourists one by one, food truck queues, festival dances', () => {
    const sim = new Simulation(layout, 7);
    place(sim, { x: SPOT.x + 60, z: SPOT.z });
    const bus = spawnCityEvent(sim.ctx, 'tourist_bus', SPOT)!;
    expect(bus.props.map(p => p.kind)).toEqual(['bus']);
    expect(bus.participantGuardIds).toHaveLength(0);
    steps(sim, 2.5);
    const early = bus.participantGuardIds.length;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(6);
    steps(sim, 6);
    expect(bus.participantGuardIds).toHaveLength(6);

    const truck = spawnCityEvent(sim.ctx, 'food_truck_crowd', { x: SPOT.x + 8, z: SPOT.z - 30 })!;
    expect(truck.props[0].kind).toBe('foodTruck');
    expect(truck.participantGuardIds.length).toBe(5);
  });

  it('a car accident calls the police after a believable delay, once', () => {
    const sim = new Simulation(layout, 7);
    place(sim, { x: SPOT.x + 60, z: SPOT.z });
    const ev = spawnCityEvent(sim.ctx, 'car_accident', SPOT)!;
    expect(ev.props.filter(p => p.kind === 'wreck')).toHaveLength(2);
    const events: GameEvent[] = [];
    steps(sim, BALANCE.city.accidentPoliceDelay - 1, events);
    expect(events.some(e => e.type === 'cityEventEscalated')).toBe(false);
    steps(sim, 2, events);
    expect(events.filter(e => e.type === 'cityEventEscalated')).toHaveLength(1);
    const police = ev.participantGuardIds.map(id => sim.state.guards.find(g => g.id === id)!).filter(g => g?.role === 'police');
    expect(police.length).toBeGreaterThan(0);
    // Responders walk in from off to the side, not on top of the wreck.
    expect(Math.hypot(police[0].pos.x - SPOT.x, police[0].pos.z - SPOT.z)).toBeGreaterThan(10);
  });

  it('spontaneous events spawn past the rendered vision limit (no visible popping)', () => {
    const sim = new Simulation(layout, 11);
    const lp = { x: -110, z: 100 };
    place(sim, lp);
    let spawned = 0;
    for (const kind of ['rival_zombie_pack', 'tourist_bus', 'food_truck_crowd'] as const) {
      const ev = spawnCityEvent(sim.ctx, kind);
      if (!ev) continue;
      spawned++;
      expect(Math.hypot(ev.pos.x - lp.x, ev.pos.z - lp.z)).toBeGreaterThan(visibleLimit(sim.state));
    }
    expect(spawned).toBeGreaterThan(0);
  });

  it('expired participants are never deleted in view, only once out of sight', () => {
    const sim = new Simulation(layout, 7);
    place(sim, { x: SPOT.x + 12, z: SPOT.z }); // well inside the vision limit
    const ev = spawnCityEvent(sim.ctx, 'food_truck_crowd', SPOT)!;
    const ids = [...ev.participantGuardIds];
    ev.expiresAt = sim.state.time + 0.05;
    steps(sim, 1);
    expect(sim.state.cityEvents).toHaveLength(0);
    expect(ids.every(id => sim.state.guards.some(g => g.id === id))).toBe(true);
    place(sim, { x: 250, z: -300 });
    steps(sim, 1);
    expect(ids.some(id => sim.state.guards.some(g => g.id === id))).toBe(false);
  });

  it('rescuing a cornered zombie completes the event and pays Brains', () => {
    const sim = new Simulation(layout, 7);
    place(sim, { x: SPOT.x + 50, z: SPOT.z });
    const ev = spawnCityEvent(sim.ctx, 'zombie_in_trouble', SPOT)!;
    const trouble = sim.state.zombies.find(z => z.id === ev.participantZombieIds[0])!;
    const before = sim.state.rewards.brains;
    place(sim, { x: trouble.pos.x + 1, z: trouble.pos.z });
    const events: GameEvent[] = [];
    steps(sim, 1, events);
    expect(trouble.state === 'follower' || trouble.state === 'rising').toBe(true);
    expect(events.some(e => e.type === 'cityEventResolved' && e.outcome === 'completed' && e.kind === 'zombie_in_trouble')).toBe(true);
    expect(sim.state.rewards.brains).toBeGreaterThan(before);
  });

  it('post-conquest pools only run in zombie-controlled districts', () => {
    const party = DYNAMIC_EVENTS.find(d => d.id === 'zombie_block_party')!;
    const raid = DYNAMIC_EVENTS.find(d => d.id === 'survivor_raid')!;
    expect(party.allowedControl).toContain('zombieControlled');
    expect(party.allowedControl).not.toContain('humanControlled');
    expect(raid.allowedControl).toEqual(['zombieControlled']);
    for (const d of DYNAMIC_EVENTS) if (d.id !== 'zombie_block_party' && d.id !== 'survivor_raid') expect(d.allowedControl).toBeUndefined();
  });

  it('roaming for 3 minutes: events keep coming, never the same kind twice in a row, humans stay capped', () => {
    const sim = new Simulation(layout, 3);
    place(sim, { x: -110, z: 100 });
    const started: DynamicEventKind[] = [];
    let maxEventHumans = 0;
    const n = Math.round(180 / dt);
    for (let i = 0; i < n; i++) {
      const input = emptyInput();
      input.moveForward = i % 1200 < 600 ? -0.4 : 0.4; // pace up and down the street
      sim.step(dt, input);
      for (const e of sim.drainEvents()) if (e.type === 'cityEventStarted' && e.kind !== 'police_patrol') started.push(e.kind);
      maxEventHumans = Math.max(maxEventHumans, eventHumanCount(sim.state));
    }
    expect(started.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < started.length; i++) expect(started[i]).not.toBe(started[i - 1]);
    expect(maxEventHumans).toBeLessThanOrEqual(BALANCE.city.eventMaxHumans);
    expect(sim.state.cityEvents.length).toBeLessThanOrEqual(BALANCE.city.eventMaxConcurrent + 1);
  }, 60_000);
});

describe('Companion perks (§4.1.B)', () => {
  it('Larry whistles stray zombies into the horde; Grandma wallops nearby humans', () => {
    const sim = new Simulation(layout, 7);
    grantReward(sim.ctx, 'comp_larry_lifeguard');
    grantReward(sim.ctx, 'comp_grandma_rot');
    toggleCompanionSlot(sim.ctx, 'larry_lifeguard');
    toggleCompanionSlot(sim.ctx, 'grandma_rot');
    place(sim, { x: -110, z: 100 });
    steps(sim, 0.1);
    const larry = sim.state.zombies.find(z => z.id === sim.state.companions.find(c => c.id === 'larry_lifeguard')!.zombieId)!;
    const grandma = sim.state.zombies.find(z => z.id === sim.state.companions.find(c => c.id === 'grandma_rot')!.zombieId)!;
    expect(larry && grandma).toBeTruthy();

    // A stray beside Larry, a civilian beside Grandma.
    // Beyond the Alpha's own recruit radius, inside Larry's whistle.
    const stray = sim.state.zombies.find(z => z.state === 'ambient' && z.heldBy === 0)!;
    stray.dormant = false;
    const lp = sim.state.leader.pos;
    const away = Math.atan2(larry.pos.x - lp.x, larry.pos.z - lp.z);
    stray.pos = { x: larry.pos.x + Math.sin(away) * 12, z: larry.pos.z + Math.cos(away) * 12 }; stray.prevPos = { ...stray.pos };
    const civ = sim.state.guards.find(g => g.role === 'civilian' && g.hp > 0)!;
    civ.dormant = false;
    civ.pos = { x: grandma.pos.x + 1, z: grandma.pos.z }; civ.prevPos = { ...civ.pos };
    const hp0 = civ.hp;
    for (const c of sim.state.companions) c.abilityCooldown = 0;

    const events: GameEvent[] = [];
    steps(sim, 1.2, events);
    const perks = events.filter(e => e.type === 'companionPerk').map(e => (e as { companionId: string }).companionId);
    expect(perks).toContain('grandma_rot');
    expect(civ.hp).toBeLessThan(hp0);
    expect(perks).toContain('larry_lifeguard');
    expect(stray.state === 'follower' || stray.state === 'rising').toBe(true);
  });
});

describe('Storm-drain shortcut + V priority', () => {
  const drain = SECRETS.find(s => s.shortcutTo)!;

  it('both drain ends are walkable', () => {
    const sim = new Simulation(layout, 7);
    expect(sim.ctx.collision.isBlocked(drain.pos, 0.6)).toBe(false);
    expect(sim.ctx.collision.isBlocked(drain.shortcutTo!, 0.6)).toBe(false);
  });

  it('once discovered, V at either end moves the Alpha and the horde to the other end', () => {
    const sim = new Simulation(layout, 7);
    place(sim, drain.pos);
    steps(sim, 0.1); // discovers the secret
    expect(sim.state.rewards.discoveredSecretIds).toContain(drain.id);
    expect(shortcutAt(sim.state, sim.state.leader.pos)).not.toBeNull();
    const input = emptyInput();
    input.interact = true;
    sim.step(dt, input);
    const ev = sim.drainEvents();
    expect(ev.some(e => e.type === 'shortcutUsed')).toBe(true);
    const to = drain.shortcutTo!;
    expect(Math.hypot(sim.state.leader.pos.x - to.x, sim.state.leader.pos.z - to.z)).toBeLessThan(4);
    for (const z of sim.state.zombies) if (z.state === 'follower') {
      expect(Math.hypot(z.pos.x - to.x, z.pos.z - to.z)).toBeLessThan(10);
    }
  });

  it('V beside a parked cart mounts it without also kicking a nearby trash can', () => {
    const sim = new Simulation(layout, 7);
    const can = sim.state.interactables.find(i => i.kind === 'trashCan')!;
    place(sim, { x: can.pos.x + 0.8, z: can.pos.z });
    grantReward(sim.ctx, 'veh_golf_cart');
    sim.step(dt, emptyInput());
    sim.drainEvents();
    const pv = sim.state.playerVehicle!;
    pv.pos = { x: can.pos.x + 1.5, z: can.pos.z };
    const input = emptyInput();
    input.interact = true;
    sim.step(dt, input);
    const ev = sim.drainEvents();
    expect(sim.state.playerVehicle!.mounted).toBe(true);
    expect(ev.some(e => e.type === 'worldInteractable')).toBe(false);
  });
});
