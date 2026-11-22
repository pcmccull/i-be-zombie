import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import type { GameEvent, VehicleAgent } from '../src/core/types';
import { emptyInput } from '../src/core/types';
import { Simulation } from '../src/sim/Simulation';
import { collidePlayerVehicle } from '../src/systems/PlayerVehicleSystem';
import { grantReward } from '../src/systems/RewardSystem';
import { buildDistrictLayout } from '../src/world/districtLayout';
import { usePreBeachEconomy } from './support/preBeachEconomy';

usePreBeachEconomy();

const layout = buildDistrictLayout();
const dt = BALANCE.sim.fixedDt;
const R = BALANCE.city.playerVehicles.golf_cart.radius;

/** A sim with the golf cart mounted, facing +Z at speed, nothing else nearby that could interfere. */
function setup(speed: number) {
  const sim = new Simulation(layout, 7);
  grantReward(sim.ctx, 'veh_golf_cart');
  sim.step(dt, emptyInput());
  const pv = sim.state.playerVehicle!;
  pv.mounted = true;
  pv.facing = 0;
  pv.speed = speed;
  sim.state.vehicles.length = 0;
  sim.state.interactables.length = 0;
  for (const g of sim.state.guards) g.dormant = true;
  const events: GameEvent[] = [];
  sim.ctx.emit = (e: GameEvent) => { events.push(e); };
  return { sim, pv, events };
}

function car(sim: Simulation, x: number, z: number, facing: number, speed = 0): VehicleAgent {
  const v: VehicleAgent = {
    id: sim.ctx.newId(), kind: 'traffic', mode: 'cruise', pos: { x, z }, prevPos: { x, z }, facing, prevFacing: facing,
    speed, lane: -1, modeTime: 0, passes: 0, variant: 0, hitFlash: 0, stuckTime: 0, hp: BALANCE.traffic.carHp, bogTime: 0,
  };
  sim.state.vehicles.push(v);
  return v;
}

describe("Alpha's vehicle collisions", () => {
  it('runs down a human at speed: damage, knockback, stagger, speed loss', () => {
    const { sim, pv } = setup(10);
    const g = sim.state.guards.find(h => h.elevation === 0)!;
    g.dormant = false; g.state = 'PATROL'; g.hp = 1000;
    g.pos = { x: pv.pos.x, z: pv.pos.z + R };
    collidePlayerVehicle(sim.ctx, pv, R);
    expect(g.hp).toBeLessThan(1000);
    expect(g.staggerTime).toBeGreaterThan(0);
    expect(Math.hypot(g.pos.x - pv.pos.x, g.pos.z - pv.pos.z)).toBeGreaterThan(R + g.radius);
    expect(pv.speed).toBeLessThan(10);
    // Cooldown: overlapping again right away does not hit twice.
    const hp = g.hp;
    g.pos = { x: pv.pos.x, z: pv.pos.z + R };
    collidePlayerVehicle(sim.ctx, pv, R);
    expect(g.hp).toBe(hp);
  });

  it('a fast hit kills a weak human as an Alpha kill (always converts)', () => {
    const { sim, pv, events } = setup(12);
    const g = sim.state.guards.find(h => h.elevation === 0)!;
    g.dormant = false; g.state = 'PATROL'; g.hp = 5;
    g.pos = { x: pv.pos.x, z: pv.pos.z + R };
    collidePlayerVehicle(sim.ctx, pv, R);
    expect(g.state).toBe('DEAD');
    expect(g.killedByAlpha).toBe(true);
    expect(events.some(e => e.type === 'guardDied')).toBe(true);
  });

  it('only shoves a human aside when slow', () => {
    const { sim, pv } = setup(1);
    const g = sim.state.guards.find(h => h.elevation === 0)!;
    g.dormant = false; g.state = 'PATROL'; g.hp = 50;
    g.pos = { x: pv.pos.x + 0.3, z: pv.pos.z + R };
    collidePlayerVehicle(sim.ctx, pv, R);
    expect(g.hp).toBe(50);
    expect(Math.hypot(g.pos.x - pv.pos.x, g.pos.z - pv.pos.z)).toBeGreaterThanOrEqual(R + g.radius);
  });

  it('cannot drive through a traffic car; a hard hit wears the driver and crashes', () => {
    const { sim, pv, events } = setup(10);
    const v = car(sim, pv.pos.x, pv.pos.z + 2, Math.PI / 2); // broadside across our path
    collidePlayerVehicle(sim.ctx, pv, R);
    expect(v.hp).toBeLessThan(BALANCE.traffic.carHp);
    expect(pv.speed).toBeLessThan(10 * BALANCE.city.playerVehicleImpact.carBounce + 1e-9);
    expect(events.some(e => e.type === 'vehicleCrash' && e.vehicleId === v.id && e.otherId === -1)).toBe(true);
    // Pushed clear of the car's footprint.
    const lf = Math.abs(pv.pos.z - v.pos.z);
    expect(lf).toBeGreaterThanOrEqual(1 + R - 1e-6);
  });

  it('a parked cart is shoved out of a car without damage', () => {
    const { sim, pv, events } = setup(0);
    pv.mounted = false;
    const v = car(sim, pv.pos.x, pv.pos.z + 1.5, 0, 6);
    collidePlayerVehicle(sim.ctx, pv, R);
    expect(v.hp).toBe(BALANCE.traffic.carHp);
    expect(events.length).toBe(0);
    expect(Math.abs(pv.pos.z - v.pos.z)).toBeGreaterThan(1.5);
  });

  it('bumps a prop when slow, smashes through it when fast', () => {
    const slow = setup(2);
    slow.sim.state.interactables.push({ id: 1, kind: 'trashCan', pos: { x: slow.pv.pos.x, z: slow.pv.pos.z + R }, radius: 0.5,
      cooldown: 12, lastTriggeredAt: -99, triggerCount: 0 });
    const z0 = slow.pv.pos.z;
    collidePlayerVehicle(slow.sim.ctx, slow.pv, R);
    expect(slow.pv.pos.z).toBeLessThan(z0);
    expect(slow.pv.speed).toBeLessThan(2);

    const fast = setup(10);
    fast.sim.state.interactables.push({ id: 1, kind: 'trashCan', pos: { x: fast.pv.pos.x, z: fast.pv.pos.z + R }, radius: 0.5,
      cooldown: 12, lastTriggeredAt: -99, triggerCount: 0 });
    const z1 = fast.pv.pos.z;
    collidePlayerVehicle(fast.sim.ctx, fast.pv, R);
    expect(fast.pv.pos.z).toBe(z1);
    expect(fast.pv.speed).toBeCloseTo(10 * (1 - BALANCE.city.playerVehicleImpact.propSpeedLoss));
  });

  it('driving into a human through the sim step hits them', () => {
    const { sim, pv } = setup(10);
    const g = sim.state.guards.find(h => h.elevation === 0)!;
    g.dormant = false; g.hp = 1000;
    const input = emptyInput();
    input.moveForward = 1;
    let hit = false;
    for (let i = 0; i < 30 && !hit; i++) {
      g.pos = { x: pv.pos.x + Math.sin(pv.facing) * (R + 0.2), z: pv.pos.z + Math.cos(pv.facing) * (R + 0.2) };
      g.prevPos = { ...g.pos };
      sim.step(dt, input);
      hit = g.hp < 1000;
    }
    expect(hit).toBe(true);
  });
});
