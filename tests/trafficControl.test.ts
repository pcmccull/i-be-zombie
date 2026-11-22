// Traffic control (lights, 4-way stops, no gridlock, wreck swerving, lane-end turns), accidents, vehicle models.
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import type { GameEvent, VehicleAgent, Vec2 } from '../src/core/types';
import { emptyInput } from '../src/core/types';
import { createGuard } from '../src/entities/HumanGuard';
import { Simulation } from '../src/sim/Simulation';
import { buildTrafficNetwork, signalCycle, signalFor, type Junction, type NetworkLane } from '../src/systems/trafficControl';
import { damageVehicle, setTrafficEnabled, trafficLanes } from '../src/systems/TrafficSystem';
import { pickModel, VEHICLE_MODELS } from '../src/systems/vehicleModels';
import { mulberry32 } from '../src/utils/rng';
import { buildDistrictLayout } from '../src/world/districtLayout';
import { ringRoadRects } from '../src/world/layout/ringRoad';

const dt = BALANCE.sim.fixedDt;
const layout = buildDistrictLayout();
const net = buildTrafficNetwork(layout);

function emptyWorld(leaderAt: Vec2): Simulation {
  const sim = new Simulation(layout, 7);
  const s = sim.state;
  s.zombies.length = 0; s.followerCount = 0; s.guards.length = 0;
  setTrafficEnabled(sim.ctx, false);
  s.leader.pos.x = s.leader.prevPos.x = leaderAt.x; s.leader.pos.z = s.leader.prevPos.z = leaderAt.z;
  return sim;
}

const lanesOf = (sim: Simulation) => trafficLanes(sim.ctx) as readonly NetworkLane[];

function laneCar(sim: Simulation, lane: number, along: number, extra: Partial<VehicleAgent> = {}): VehicleAgent {
  const l = lanesOf(sim)[lane];
  const pos = { x: l.from.x + l.dx * along, z: l.from.z + l.dz * along }, facing = Math.atan2(l.dx, l.dz);
  const v: VehicleAgent = { id: sim.ctx.newId(), kind: 'traffic', mode: 'cruise', pos: { ...pos }, prevPos: { ...pos },
    facing, prevFacing: facing, speed: BALANCE.traffic.cruiseSpeed, lane, modeTime: 0, passes: 0, variant: 0,
    hitFlash: 0, stuckTime: 0, hp: BALANCE.traffic.carHp, bogTime: 0, model: 'sedan', ...extra };
  sim.state.vehicles.push(v);
  return v;
}

const alongOf = (l: NetworkLane, p: Vec2) => (p.x - l.from.x) * l.dx + (p.z - l.from.z) * l.dz;

function run(sim: Simulation, seconds: number, events: GameEvent[] = [], each?: () => void): GameEvent[] {
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    sim.step(dt, emptyInput());
    events.push(...sim.drainEvents());
    each?.();
  }
  return events;
}

/** Index of a lane (in the sim's lane list) with the given direction whose line passes through `at`. */
function findLane(sim: Simulation, dx: number, dz: number, at: Vec2): number {
  const lanes = lanesOf(sim);
  const i = lanes.findIndex(l => l.dx === dx && l.dz === dz &&
    Math.abs((at.x - l.from.x) * l.dz - (at.z - l.from.z) * l.dx) < 0.01);
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
}

/** First junction of the given control type that this lane crosses well away from its start. */
function crossingOf(lane: NetworkLane, control: Junction['control']) {
  return lane.crossings.find(c => c.entry > 60 && net.junctions[c.junction].control === control)!;
}

describe('traffic network', () => {
  it('has lit main/core junctions and 4-way stops everywhere else, including the expansion grid', () => {
    const lights = net.junctions.filter(j => j.control === 'light').length;
    const stops = net.junctions.filter(j => j.control === 'stop').length;
    expect(lights).toBeGreaterThanOrEqual(9);
    expect(stops).toBeGreaterThan(10);
    // Split expansion road patches merge into through-lanes (the 800 m east-west avenues are one lane each way).
    expect(net.lanes.some(l => l.axis === 'x' && l.length >= 795)).toBe(true);
  });

  it('a light never shows green/yellow to both roads at once, and cycles through every colour', () => {
    const seen = new Set<string>();
    for (const j of net.junctions.filter(x => x.control === 'light')) {
      for (let t = 0; t < signalCycle() * 2; t += 0.1) {
        const x = signalFor(j, 'x', t), z = signalFor(j, 'z', t);
        expect(x === 'red' || z === 'red').toBe(true);
        seen.add(x);
      }
    }
    expect([...seen].sort()).toEqual(['green', 'red', 'yellow']);
  });

  it('builds a ring road along the north, west and east edges (not touching the world-edge band)', () => {
    const ring = ringRoadRects(layout.playArea);
    const roads = layout.ground.filter(g => g.kind === 'road').map(g => g.rect);
    const within = (a: typeof ring.north, b: typeof ring.north) => a.minX >= b.minX && a.maxX <= b.maxX && a.minZ >= b.minZ && a.maxZ <= b.maxZ;
    for (const band of [ring.north, ring.west, ring.east]) {
      const patches = roads.filter(r => within(r, band));
      const covered = patches.reduce((sum, r) => sum + (r.maxX - r.minX) * (r.maxZ - r.minZ), 0);
      expect(covered / ((band.maxX - band.minX) * (band.maxZ - band.minZ))).toBeGreaterThan(0.85);
    }
    // Abutting, never overlapping, the existing carriageways.
    for (let i = 0; i < roads.length; i++) for (let k = i + 1; k < roads.length; k++) {
      const a = roads[i], b = roads[k];
      const overlap = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 0.01 && Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > 0.01;
      if (overlap) expect([a, b].some(r => [ring.north, ring.west, ring.east].some(band => within(r, band)))).toBe(false);
    }
    expect(ring.north.minZ).toBeGreaterThan(layout.playArea.minZ);
    expect(ring.west.minX).toBeGreaterThan(layout.playArea.minX);
    expect(ring.east.maxX).toBeLessThan(layout.playArea.maxX);
  });
});

describe('traffic control in the sim', () => {
  it('stops at a red light before the stop line and goes on green', () => {
    const sim = emptyWorld({ x: -130, z: 100 });
    const li = findLane(sim, 1, 0, { x: 0, z: 82.5 }), lane = lanesOf(sim)[li];
    const c = lane.crossings.find(x => net.junctions[x.junction].control === 'light' && x.entry > 40)!;
    const j = net.junctions[c.junction];
    let t0 = 0;
    while (!(signalFor(j, 'x', t0) === 'red' && signalFor(j, 'x', t0 + 8) === 'red')) t0 += 0.1;
    sim.state.time = t0;
    const v = laneCar(sim, li, c.entry - 30);
    run(sim, 6);
    expect(alongOf(lane, v.pos) + BALANCE.traffic.carLength / 2).toBeLessThanOrEqual(c.entry);
    expect(v.speed).toBeLessThan(0.3);
    run(sim, signalCycle());
    expect(alongOf(lane, v.pos)).toBeGreaterThan(c.exit);
    expect(v.mode).toBe('cruise');
  });

  it('comes to a full stop at a stop sign, then crosses', () => {
    const sim = emptyWorld({ x: 0, z: 0 });
    const lanes = lanesOf(sim);
    const li = lanes.findIndex(l => crossingOf(l, 'stop'));
    const lane = lanes[li], c = crossingOf(lane, 'stop');
    const j = net.junctions[c.junction];
    sim.state.leader.pos.x = j.center.x + 15; sim.state.leader.pos.z = j.center.z + 15;
    const v = laneCar(sim, li, c.entry - 25);
    let minSpeedNearLine = Infinity;
    run(sim, 12, [], () => {
      const front = alongOf(lane, v.pos) + BALANCE.traffic.carLength / 2;
      if (front > c.entry - 3 && front < c.entry) minSpeedNearLine = Math.min(minSpeedNearLine, v.speed);
    });
    expect(minSpeedNearLine).toBeLessThan(0.4);
    expect(alongOf(lane, v.pos)).toBeGreaterThan(c.exit);
  });

  it('four cars meeting at a 4-way stop all get through (no gridlock, nobody stalls)', () => {
    const sim = emptyWorld({ x: 0, z: 0 });
    const lanes = lanesOf(sim);
    // A stop junction entered by four through-lanes, each from well upstream.
    const j = net.junctions.find(x => x.control === 'stop' &&
      lanes.filter(l => l.crossings.some(c => c.junction === x.id && c.entry > 40 && c.exit < l.length - 40)).length === 4)!;
    expect(j).toBeTruthy();
    sim.state.leader.pos.x = j.center.x + 18; sim.state.leader.pos.z = j.center.z + 18;
    const cars = lanes.flatMap((l, i) => {
      const c = l.crossings.find(x => x.junction === j.id && x.entry > 40 && x.exit < l.length - 40);
      return c ? [{ v: laneCar(sim, i, c.entry - 14), lane: l, c }] : [];
    });
    // Track progress while each car is around (once through, it may drive out of the Alpha's 140 m and despawn).
    const best = cars.map(() => -Infinity);
    const events = run(sim, 30, [], () => cars.forEach(({ v, lane }, i) => {
      if (sim.state.vehicles.includes(v) && v.lane === lanes.indexOf(lane)) best[i] = Math.max(best[i], alongOf(lane, v.pos));
    }));
    cars.forEach(({ v, c }, i) => {
      expect(v.mode).not.toBe('stalled');
      expect(best[i]).toBeGreaterThan(c.exit);
    });
    expect(events.some(e => e.type === 'driverBailed')).toBe(false);
  });

  it('steers around a wreck through the clear oncoming lane', () => {
    const sim = emptyWorld({ x: -50, z: 100 });
    const li = findLane(sim, 1, 0, { x: 0, z: 82.5 }), lane = lanesOf(sim)[li];
    const wreck = laneCar(sim, li, alongOf(lane, { x: -55, z: 82.5 }), { mode: 'stalled', speed: 0, lane: -1, modeTime: -1000 });
    const v = laneCar(sim, li, alongOf(lane, { x: -85, z: 82.5 }));
    run(sim, 12);
    expect(v.mode).toBe('cruise');
    expect(v.pos.x).toBeGreaterThan(wreck.pos.x + 6);
    expect(Math.abs(v.pos.z - 82.5)).toBeLessThan(0.3); // back in its own lane
  });

  it('turns onto the ring road at a world-edge corner instead of vanishing', () => {
    const ring = ringRoadRects(layout.playArea);
    const z = (ring.north.minZ + ring.north.maxZ) / 2 - (ring.north.maxZ - ring.north.minZ) / 4; // westbound lane
    const sim = emptyWorld({ x: -360, z: -440 });
    const li = findLane(sim, -1, 0, { x: 0, z }), lane = lanesOf(sim)[li];
    const v = laneCar(sim, li, lane.length - 25);
    run(sim, 14);
    expect(sim.state.vehicles).toContain(v);
    expect(v.lane).not.toBe(li);
    expect(lanesOf(sim)[v.lane].axis).toBe('z');
  });

  it('U-turns at a dead end on the coast instead of vanishing', () => {
    const sim = emptyWorld({ x: -330, z: 130 });
    // Southbound lane of the x = -310 avenue runs into the shore at z = 160.
    const li = findLane(sim, 0, 1, { x: -312.5, z: 0 }), lane = lanesOf(sim)[li];
    const v = laneCar(sim, li, lane.length - 40);
    run(sim, 16);
    expect(sim.state.vehicles).toContain(v);
    expect(v.mode).toBe('cruise');
    expect(lanesOf(sim)[v.lane].dz).toBe(-1);
  });
});

describe('people in the road', () => {
  it('waits for someone standing in the lane, then turns round rather than waiting forever', () => {
    const sim = emptyWorld({ x: -40, z: 110 });
    const li = findLane(sim, 1, 0, { x: 0, z: 82.5 }), lane = lanesOf(sim)[li];
    const g = createGuard(sim.ctx.newId(), { role: 'civilian', post: 'street', pos: { x: -50, z: 82.5 }, facing: 0, tower: null,
      waypoints: [{ x: -50, z: 82.5 }] }, sim.ctx.collision);
    sim.state.guards.push(g);
    const v = laneCar(sim, li, alongOf(lane, { x: -75, z: 82.5 }));
    let waited = 0;
    run(sim, BALANCE.traffic.pedestrianPatience + 8, [], () => {
      g.pos.x = -50; g.pos.z = 82.5; // stays put
      if (v.speed < 0.5 && v.lane === li) waited += dt;
    });
    expect(waited).toBeGreaterThan(BALANCE.traffic.pedestrianPatience - 1);
    expect(v.mode).toBe('cruise');
    expect(lanesOf(sim)[v.lane].dx).toBe(-1); // heading back west in the oncoming lane
    expect(v.pos.x).toBeLessThan(-50 - 2);
  });
});

describe('accidents', () => {
  it('an out-of-control car that ploughs into traffic wrecks the car it hits (driver bails)', () => {
    const sim = emptyWorld({ x: -40, z: 110 });
    const li = findLane(sim, 1, 0, { x: 0, z: 82.5 }), lane = lanesOf(sim)[li];
    const victim = laneCar(sim, li, alongOf(lane, { x: -60, z: 82.5 }), { speed: 0 });
    const pos = { x: -60, z: 75.5 };
    const wild: VehicleAgent = { ...victim, id: sim.ctx.newId(), kind: 'rammer', mode: 'turn', lane: -1, pos: { ...pos },
      prevPos: { ...pos }, facing: 0, prevFacing: 0, speed: 13 };
    sim.state.vehicles.push(wild);
    const events = run(sim, 1);
    const crash = events.find(e => e.type === 'vehicleCrash');
    expect(crash && crash.type === 'vehicleCrash' && crash.otherId).toBe(victim.id);
    expect(victim.mode).toBe('stalled');
    expect(events.some(e => e.type === 'driverBailed' && e.vehicleId === victim.id)).toBe(true);
  });

  it('a heavy bus is not wrecked by a light car that hits it', () => {
    const sim = emptyWorld({ x: -40, z: 110 });
    const li = findLane(sim, 1, 0, { x: 0, z: 82.5 }), lane = lanesOf(sim)[li];
    const bus = laneCar(sim, li, alongOf(lane, { x: -60, z: 82.5 }), { speed: 0, model: 'bus' });
    const pos = { x: -60, z: 75.5 };
    sim.state.vehicles.push({ ...bus, id: sim.ctx.newId(), kind: 'rammer', mode: 'turn', lane: -1, model: 'hatchback',
      pos: { ...pos }, prevPos: { ...pos }, facing: 0, prevFacing: 0, speed: 7 });
    const events = run(sim, 1);
    expect(events.some(e => e.type === 'vehicleCrash')).toBe(true);
    expect(bus.mode).toBe('cruise');
  });
});

describe('vehicle models', () => {
  it('spawns every body type; rammers never drive buses, vans or police cars', () => {
    const rng = mulberry32(3), seen = new Set<string>();
    for (let i = 0; i < 3000; i++) seen.add(pickModel(rng, false));
    expect([...seen].sort()).toEqual([...VEHICLE_MODELS].sort());
    for (let i = 0; i < 2000; i++) expect(BALANCE.vehicleModels[pickModel(rng, true)].rammer).toBe(true);
  });

  it('a police driver dragged out of the car is armed police', () => {
    const sim = emptyWorld({ x: -40, z: 110 });
    const li = findLane(sim, 1, 0, { x: 0, z: 82.5 }), lane = lanesOf(sim)[li];
    const cop = laneCar(sim, li, alongOf(lane, { x: -60, z: 82.5 }), { speed: 0, model: 'police' });
    damageVehicle(sim.ctx, cop, BALANCE.traffic.carHp);
    const bail = sim.drainEvents().find(e => e.type === 'driverBailed');
    expect(bail && bail.type === 'driverBailed').toBe(true);
    const g = sim.state.guards.find(x => bail && bail.type === 'driverBailed' && x.id === bail.guardId);
    expect(g?.role).toBe('police');
  });
});
