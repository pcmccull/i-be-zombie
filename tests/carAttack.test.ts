// Zombies claw at cars to drag the driver out; cars lose momentum when they plough into bodies (pure, no WebGL).
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import type { GameEvent, VehicleAgent, Vec2, ZombieAgent } from '../src/core/types';
import { emptyInput } from '../src/core/types';
import { createZombie } from '../src/entities/Zombie';
import { Simulation } from '../src/sim/Simulation';
import { aimLeaderAttack, canMelee, isTargetAlive } from '../src/systems/CombatSystem';
import { damageVehicle, isPanicking, setTrafficEnabled } from '../src/systems/TrafficSystem';
import { buildDistrictLayout } from '../src/world/districtLayout';

const dt = BALANCE.sim.fixedDt;
const layout = buildDistrictLayout();
const LANE_Z = 82.5; // eastbound lane of the z = 80 avenue

function emptyWorld(leaderAt: Vec2): Simulation {
  const sim = new Simulation(layout, 7);
  const s = sim.state;
  s.zombies.length = 0; s.followerCount = 0; s.guards.length = 0;
  setTrafficEnabled(sim.ctx, false);
  const l = s.leader;
  l.pos.x = l.prevPos.x = leaderAt.x; l.pos.z = l.prevPos.z = leaderAt.z;
  return sim;
}

function car(sim: Simulation, pos: Vec2, facing: number, extra: Partial<VehicleAgent> = {}): VehicleAgent {
  const v: VehicleAgent = { id: sim.ctx.newId(), kind: 'traffic', mode: 'cruise', pos: { ...pos }, prevPos: { ...pos },
    facing, prevFacing: facing, speed: BALANCE.traffic.cruiseSpeed, lane: -1, modeTime: 0, passes: 0, variant: 0,
    hitFlash: 0, stuckTime: 0, hp: BALANCE.traffic.carHp, bogTime: 0, ...extra };
  sim.state.vehicles.push(v);
  return v;
}

function zombie(sim: Simulation, pos: Vec2, state: 'follower' | 'ambient' = 'follower'): ZombieAgent {
  const z = createZombie(sim.ctx.newId(), { ...pos }, { state, variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng });
  sim.state.zombies.push(z);
  if (state === 'follower') sim.state.followerCount++;
  return z;
}

function run(sim: Simulation, seconds: number, events: GameEvent[] = []): GameEvent[] {
  for (let i = 0; i < Math.round(seconds / dt); i++) { sim.step(dt, emptyInput()); events.push(...sim.drainEvents()); }
  return events;
}

describe('cars lose momentum when they hit bodies', () => {
  it('hitting the Alpha nearly stops the car and it cannot speed up again right away', () => {
    const sim = emptyWorld({ x: 40, z: LANE_Z });
    const v = car(sim, { x: 30, z: LANE_Z }, Math.PI / 2);
    const events: GameEvent[] = [];
    let speedAtHit = -1;
    for (let i = 0; i < 120 && speedAtHit < 0; i++) {
      const before = v.speed;
      run(sim, dt, events);
      if (events.some(e => e.type === 'vehicleHit' && e.target === 'leader')) speedAtHit = before;
    }
    expect(speedAtHit).toBeGreaterThan(BALANCE.traffic.hitMinSpeed);
    expect(v.speed).toBeLessThanOrEqual(speedAtHit * (1 - BALANCE.traffic.leaderSpeedLoss) + 1e-6);
    expect(v.bogTime).toBeGreaterThan(0);
    const slowed = v.speed;
    run(sim, 0.3);
    expect(v.speed).toBeLessThanOrEqual(slowed + 1e-6); // bogged: no acceleration
    expect(v.speed).toBeLessThan(slowed * 0.75); // and it rolls toward a stop beside the Alpha
  });

  it('each zombie hit costs speed and adds bog time', () => {
    const sim = emptyWorld({ x: 40, z: 110 });
    const v = car(sim, { x: 22, z: LANE_Z }, Math.PI / 2);
    zombie(sim, { x: 30, z: LANE_Z }, 'ambient');
    const events: GameEvent[] = [];
    for (let i = 0; i < 120 && !events.some(e => e.type === 'vehicleHit'); i++) run(sim, dt, events);
    expect(events.some(e => e.type === 'vehicleHit')).toBe(true);
    expect(v.speed).toBeLessThan(BALANCE.traffic.cruiseSpeed * (1 - BALANCE.traffic.speedLossPerHit) + 1e-6);
    expect(v.bogTime).toBeGreaterThan(0);
  });
});

describe('zombies attack cars to pull the driver out', () => {
  it('a car is a valid target in claw reach of its footprint; a stalled wreck is not', () => {
    const sim = emptyWorld({ x: 40, z: 110 });
    const v = car(sim, { x: 40, z: LANE_Z }, Math.PI / 2, { speed: 0 });
    const target = { kind: 'vehicle' as const, id: v.id };
    const reach = BALANCE.walker.attackRange;
    expect(isTargetAlive(sim.ctx, target)).toBe(true);
    // Beside the car: half width (1 m) + attack range.
    expect(canMelee(sim.ctx, { x: 41.5, z: LANE_Z + 1 + reach * 0.9 }, reach, target)).toBe(true);
    expect(canMelee(sim.ctx, { x: 40, z: LANE_Z + 1 + reach + 1 }, reach, target)).toBe(false);
    v.mode = 'stalled';
    expect(isTargetAlive(sim.ctx, target)).toBe(false);
  });

  it('wearing the grip down drags the driver out dazed and hurt; the car stalls', () => {
    const sim = emptyWorld({ x: 40, z: 110 });
    const v = car(sim, { x: 40, z: LANE_Z }, Math.PI / 2, { speed: 4 });
    damageVehicle(sim.ctx, v, 10);
    expect(v.speed).toBeLessThan(4);
    expect(v.bogTime).toBeGreaterThan(0);
    expect(v.mode).toBe('ram'); // the driver panics (see below)
    damageVehicle(sim.ctx, v, BALANCE.traffic.carHp);
    expect(v.mode).toBe('stalled');
    const pulled = sim.drainEvents().find(e => e.type === 'driverBailed');
    expect(pulled?.type === 'driverBailed' && pulled.pulled).toBe(true);
    const driver = sim.state.guards.find(g => pulled?.type === 'driverBailed' && g.id === pulled.guardId)!;
    expect(driver.role).toBe('civilian');
    expect(driver.hp).toBeLessThan(driver.maxHp);
    expect(driver.staggerTime).toBeGreaterThan(0);
  });

  it('followers mob a car next to them on their own and pull the driver out', () => {
    const sim = emptyWorld({ x: 40, z: 90 });
    const v = car(sim, { x: 40, z: LANE_Z }, Math.PI / 2, { speed: 0, bogTime: 30 });
    for (let i = 0; i < 6; i++) zombie(sim, { x: 38 + i * 0.8, z: LANE_Z + 2.4 });
    const events = run(sim, 8);
    expect(events.some(e => e.type === 'melee' && e.target.kind === 'vehicle' && e.target.id === v.id)).toBe(true);
    expect(v.mode).toBe('stalled');
    expect(events.some(e => e.type === 'driverBailed' && e.pulled)).toBe(true);
  });

  it('the Alpha aims its swing at a car in front of it', () => {
    const sim = emptyWorld({ x: 40, z: LANE_Z + 2.3 });
    const v = car(sim, { x: 40, z: LANE_Z }, Math.PI / 2, { speed: 0, bogTime: 30 });
    const hp = v.hp;
    const l = sim.state.leader;
    aimLeaderAttack(sim.ctx, { x: 40, z: LANE_Z });
    l.attackPhase = 'windup'; l.attackTimer = 0; l.comboStep = 1;
    const events = run(sim, dt);
    expect(events.some(e => e.type === 'melee' && e.attacker === 'leader' && e.target.kind === 'vehicle')).toBe(true);
    expect(v.hp).toBeLessThan(hp);
  });

  it('an attack order on a car is accepted and sends the horde at it', () => {
    const sim = emptyWorld({ x: 40, z: 95 });
    const v = car(sim, { x: 40, z: LANE_Z }, Math.PI / 2, { speed: 0, bogTime: 30 });
    for (let i = 0; i < 4; i++) zombie(sim, { x: 38 + i, z: 94 });
    const input = emptyInput();
    input.hordeCommand = { type: 'attack', target: { kind: 'vehicle', id: v.id }, additive: false };
    sim.step(dt, input);
    expect(sim.state.order.type === 'attack' && sim.state.order.target.kind).toBe('vehicle');
    const events = run(sim, 8);
    expect(events.some(e => e.type === 'melee' && e.target.kind === 'vehicle')).toBe(true);
  });
});

describe('a clawed driver panics and tries to run the zombies over', () => {
  it('backs out of the mob, then turns and drives into the zombies', () => {
    const sim = emptyWorld({ x: 40, z: 125 });
    // Car parked in the lane facing east; a pack of zombies beside it (north side) claws once.
    const v = car(sim, { x: 40, z: LANE_Z }, Math.PI / 2, { speed: 0 });
    for (let i = 0; i < 3; i++) zombie(sim, { x: 39 + i, z: LANE_Z - 2.6 }, 'ambient');
    damageVehicle(sim.ctx, v, 5);
    const events = sim.drainEvents();
    expect(events.some(e => e.type === 'vehicleRam' && e.vehicleId === v.id)).toBe(true);
    expect(isPanicking(sim.ctx, v)).toBe(true);
    expect(v.mode).toBe('ram');
    run(sim, 0.5);
    expect(v.speed).toBeLessThan(0); // reversing out first
    const later = run(sim, 6);
    expect(later.some(e => e.type === 'vehicleHit' && e.vehicleId === v.id && e.target === 'zombie')).toBe(true);
  });

  it('an ordinary (non-rammer) driver hits harder while panicking', () => {
    const sim = emptyWorld({ x: 40, z: 125 });
    const calm = car(sim, { x: 10, z: LANE_Z }, Math.PI / 2);
    const z1 = zombie(sim, { x: 18, z: LANE_Z }, 'ambient');
    const ev1 = run(sim, 2).find(e => e.type === 'vehicleHit');
    expect(ev1).toBeDefined();
    const calmLoss = z1.maxHp - z1.hp;
    expect(isPanicking(sim.ctx, calm)).toBe(false);
    const sim2 = emptyWorld({ x: 40, z: 125 });
    const angry = car(sim2, { x: 10, z: LANE_Z }, Math.PI / 2);
    damageVehicle(sim2.ctx, angry, 1);
    angry.mode = 'turn'; angry.speed = BALANCE.traffic.cruiseSpeed; angry.bogTime = 0; angry.facing = Math.PI / 2;
    const z2 = zombie(sim2, { x: 18, z: LANE_Z }, 'ambient');
    run(sim2, 1.2);
    expect(z2.maxHp - z2.hp).toBeGreaterThan(calmLoss);
  });
});
