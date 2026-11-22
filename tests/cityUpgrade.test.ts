import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { DYNAMIC_EVENTS } from '../src/content/events';
import { ACHIEVEMENTS, COMPANIONS, HIDEOUTS, SECRETS } from '../src/content/rewards';
import { emptyInput } from '../src/core/types';
import { createSave, parseSave, SAVE_VERSION } from '../src/persistence/saveSchema';
import { Simulation } from '../src/sim/Simulation';
import { setDistrictAlert, spawnCityEvent } from '../src/systems/CityActivityDirector';
import { addBrains, buyReward, equipCosmetic, grantReward, recordAchievementProgress } from '../src/systems/RewardSystem';
import { buildDistrictLayout } from '../src/world/districtLayout';
import { usePreBeachEconomy } from './support/preBeachEconomy';

usePreBeachEconomy();

const layout = buildDistrictLayout();
const dt = BALANCE.sim.fixedDt;

describe('Living City & Expanded Rewards (docs/11_cityupgrade.md)', () => {
  it('starts the Alpha with no cosmetics equipped and grants unique rewards idempotently', () => {
    const sim = new Simulation(layout, 42);
    expect(sim.state.rewards.equippedCosmeticIdsBySlot).toEqual({
      hat: null, glasses: null, back: null, hand: null,
    });

    expect(grantReward(sim.ctx, 'cos_traffic_cone')).toBe(true);
    expect(grantReward(sim.ctx, 'cos_traffic_cone')).toBe(false);
    expect(sim.state.rewards.unlockedRewardIds.filter(id => id === 'cos_traffic_cone')).toHaveLength(1);

    expect(equipCosmetic(sim.ctx, 'hat', 'cos_traffic_cone')).toBe(true);
    expect(sim.state.rewards.equippedCosmeticIdsBySlot.hat).toBe('cos_traffic_cone');
    expect(equipCosmetic(sim.ctx, 'hat', 'cos_chef_hat')).toBe(false); // not owned yet
  });

  it('handles Brains purchases transactionally without double-charging or insufficient-fund grants', () => {
    const sim = new Simulation(layout, 42);
    expect(buyReward(sim.ctx, 'cos_beach_visor')).toBe(false);
    expect(sim.state.rewards.unlockedRewardIds).not.toContain('cos_beach_visor');

    addBrains(sim.ctx, 25, 'test');
    expect(buyReward(sim.ctx, 'cos_beach_visor')).toBe(true); // costs 20
    expect(sim.state.rewards.brains).toBe(5);
    expect(buyReward(sim.ctx, 'cos_beach_visor')).toBe(false); // already owned
    expect(sim.state.rewards.brains).toBe(5);
  });

  it('tracks event-driven achievements and grants threshold rewards exactly once', () => {
    const sim = new Simulation(layout, 42);
    const ach = ACHIEVEMENTS.find(a => a.id === 'ach_road_rage')!;
    recordAchievementProgress(sim.ctx, ach.statKey, ach.threshold - 1, 'add');
    expect(sim.state.rewards.unlockedRewardIds).not.toContain(ach.rewardId);

    recordAchievementProgress(sim.ctx, ach.statKey, 1, 'add');
    expect(sim.state.rewards.unlockedRewardIds).toContain(ach.rewardId);
    const brainsAfter = sim.state.rewards.brains;

    recordAchievementProgress(sim.ctx, ach.statKey, 5, 'add');
    expect(sim.state.rewards.brains).toBe(brainsAfter);
  });

  it('escalates local district alert on heat without escalating unrelated districts', () => {
    const sim = new Simulation(layout, 42);
    setDistrictAlert(sim.ctx, 'suburbs', 'panic');
    expect(sim.state.districts.suburbs.alert).toBe('panic');
    expect(sim.state.districts.shopping.alert).toBe('normal');

    const ev = sim.drainEvents();
    expect(ev.some(e => e.type === 'districtAlertChanged' && e.districtId === 'suburbs' && e.alert === 'panic')).toBe(true);
  });

  it('spawns diverse dynamic events from the catalog and cleans up distant expired events', () => {
    const sim = new Simulation(layout, 42);
    expect(DYNAMIC_EVENTS.length).toBeGreaterThanOrEqual(6);

    const e1 = spawnCityEvent(sim.ctx, 'tourist_bus', { x: -130, z: 110 });
    const e2 = spawnCityEvent(sim.ctx, 'zombie_in_trouble', { x: -115, z: 110 });
    expect(e1).not.toBeNull();
    expect(e2).not.toBeNull();
    expect(sim.state.cityEvents.length).toBe(2);

    // Move leader far away so events expire and clean up
    sim.state.leader.pos = { x: 250, z: -300 };
    sim.state.leader.prevPos = { ...sim.state.leader.pos };
    sim.step(dt, emptyInput());
    expect(sim.state.cityEvents.length).toBe(0);
  });

  it('triggers environmental interactables on attack/interact with cooldown', () => {
    const sim = new Simulation(layout, 42);
    expect(sim.state.interactables.length).toBeGreaterThan(0);
    const item = sim.state.interactables[0];
    sim.state.leader.pos = { x: item.pos.x + 0.5, z: item.pos.z };
    sim.state.leader.prevPos = { ...sim.state.leader.pos };

    const input = emptyInput();
    input.interact = true;
    sim.step(dt, input);
    const ev = sim.drainEvents();
    expect(ev.some(e => e.type === 'worldInteractable' && e.id === item.id)).toBe(true);
    expect(sim.state.rewards.brains).toBeGreaterThan(0);

    // Cooldown prevents immediate re-trigger
    sim.step(dt, input);
    expect(sim.drainEvents().some(e => e.type === 'worldInteractable' && e.id === item.id)).toBe(false);
  });

  it('discovers named companions, deploys them, and recovers them after defeat', () => {
    const sim = new Simulation(layout, 42);
    const larry = COMPANIONS[0];
    sim.state.leader.pos = { ...larry.unlockPos };
    sim.state.leader.prevPos = { ...larry.unlockPos };
    sim.step(dt, emptyInput());

    expect(sim.state.rewards.unlockedCompanionIds).toContain(larry.id);
    expect(sim.state.rewards.activeCompanionIds).toContain(larry.id);
    const entry = sim.state.companions.find(c => c.id === larry.id);
    expect(entry?.zombieId).not.toBeNull();

    // Simulate companion death -> should recover after companionRecoverTime
    const cz = sim.state.zombies.find(z => z.id === entry!.zombieId)!;
    cz.hp = 0;
    cz.state = 'dead';
    sim.step(dt, emptyInput());
    expect(entry!.zombieId).toBeNull();

    sim.state.time += BALANCE.city.companionRecoverTime + 1;
    sim.step(dt, emptyInput());
    expect(entry!.zombieId).not.toBeNull();
  });

  it('supports unlocking, mounting, driving, and safely dismounting an arcade vehicle', () => {
    const sim = new Simulation(layout, 42);
    grantReward(sim.ctx, 'veh_golf_cart');
    sim.step(dt, emptyInput());
    expect(sim.state.playerVehicle?.kind).toBe('golf_cart');
    expect(sim.state.playerVehicle?.mounted).toBe(false);

    // Move to vehicle & mount
    sim.state.leader.pos = { ...sim.state.playerVehicle!.pos };
    sim.state.leader.prevPos = { ...sim.state.leader.pos };
    const mountIn = emptyInput();
    mountIn.interact = true;
    sim.step(dt, mountIn);
    expect(sim.state.playerVehicle?.mounted).toBe(true);

    // Drive forward
    const startX = sim.state.leader.pos.x;
    const startZ = sim.state.leader.pos.z;
    const driveIn = emptyInput();
    driveIn.moveForward = 1;
    for (let i = 0; i < 30; i++) sim.step(dt, driveIn);
    expect(Math.hypot(sim.state.leader.pos.x - startX, sim.state.leader.pos.z - startZ)).toBeGreaterThan(1.5);

    // Dismount safely
    const dismountIn = emptyInput();
    dismountIn.interact = true;
    sim.step(dt, dismountIn);
    expect(sim.state.playerVehicle?.mounted).toBe(false);
  });

  it('discovers secrets and fast-travels between unlocked hideouts', () => {
    const sim = new Simulation(layout, 42);
    const sec = SECRETS[0];
    sim.state.leader.pos = { ...sec.pos };
    sim.state.leader.prevPos = { ...sec.pos };
    sim.step(dt, emptyInput());
    expect(sim.state.rewards.discoveredSecretIds).toContain(sec.id);

    const hideout = HIDEOUTS[1];
    grantReward(sim.ctx, hideout.rewardId);
    const ftIn = emptyInput();
    ftIn.fastTravelHideout = hideout.id;
    sim.step(dt, ftIn);
    expect(Math.hypot(sim.state.leader.pos.x - hideout.pos.x, sim.state.leader.pos.z - hideout.pos.z)).toBeLessThan(3);
  });

  it('persists living-city rewards through save v4 round-trip and migrates v3 saves', () => {
    const sim = new Simulation(layout, 42);
    addBrains(sim.ctx, 45, 'test');
    grantReward(sim.ctx, 'cos_traffic_cone');
    equipCosmetic(sim.ctx, 'hat', 'cos_traffic_cone');
    grantReward(sim.ctx, 'veh_golf_cart');

    const save = createSave(sim.state, 42, 1000);
    expect(save.version).toBe(SAVE_VERSION);
    const parsed = parseSave(JSON.parse(JSON.stringify(save)));
    expect(parsed).not.toBeNull();

    const restored = new Simulation(layout, 42, parsed);
    expect(restored.state.rewards.brains).toBe(45);
    expect(restored.state.rewards.equippedCosmeticIdsBySlot.hat).toBe('cos_traffic_cone');
    expect(restored.state.rewards.unlockedVehicleIds).toContain('golf_cart');

    // v3 -> v4 migration
    const v3Save = JSON.parse(JSON.stringify(save));
    v3Save.version = 3;
    delete v3Save.player.rewards;
    const migrated = parseSave(v3Save);
    expect(migrated?.version).toBe(4);
    expect(migrated?.player.rewards?.brains).toBe(0);
  });
});
