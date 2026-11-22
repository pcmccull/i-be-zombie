// [pure] todos #11/#12: simulated traffic. Cars drive the road lanes around the Alpha, brake for humans (not for
// zombies), and throw + hurt zombies and the Alpha they run into. Stopped cars still shove bodies aside, so nothing
// walks through a car. From resistance level BALANCE.rammer.fromLevel some drivers are hostile: once they see the
// Alpha they leave the lane and ram the horde (a few passes), then flee. A car stopped for good (blocked or swarmed)
// stalls: its driver bails out as a civilian and the wreck fades. Every body a car hits bogs it down (speed loss +
// no acceleration for a moment), so the horde and the Alpha can claw at it (TargetRef 'vehicle'); when the driver's
// grip (hp) runs out it is dragged out dazed. Any driver who gets clawed panics: it reverses out of the mob and runs the
// horde down (rammer passes at the zombies around it), then flees; a big enough mob still pins it (bog). Only this system writes state.vehicles.
// Traffic control (trafficControl.ts): lane cars keep a following gap, obey traffic lights and 4-way stop signs, never
// block a junction box, and steer around wrecks through the oncoming lane, so traffic keeps moving. Drivers who are
// attacked (panicking), rammers and fleeing cars drive off-lane and ignore all of it; when they plough into another
// vehicle it is an accident (vehicleCrash): the lighter / hit vehicle is wrecked, the wild one too at high speed.
// Body types (vehicleModels.ts): sedans, hatchbacks, pickups, vans, box trucks, buses and police cars differ in
// footprint, speed, acceleration and crash mass; police drivers bail out as armed police.
import { BALANCE } from '../config/balance';
import type { SegmentOptions, SimContext } from '../core/contracts';
import type { Collider, LeaderState, VehicleAgent, Vec2, ZombieAgent } from '../core/types';
import { createGuard } from '../entities/HumanGuard';
import type { TrafficLane } from '../world/tropicalLayout';
import { buildTrafficNetwork, signalFor, stopSpeed, stoppingDistance, type Junction, type LaneCrossing,
  type NetworkLane } from './trafficControl';
import { halfLength, halfWidth, modelSpec, pickModel } from './vehicleModels';
import { getDistrictAt } from '../world/worldQueries';
import { damageLeader, damageZombie } from './CombatSystem';

interface Knock { vx: number; vz: number; t: number; apex: number }
type Lane = NetworkLane;
/** Per-car lane-driving state (side-table). */
interface Drive {
  /** Sideways shift toward the oncoming lane (m), while passing a wreck. */
  offset: number;
  swerve: boolean;
  /** Junction the car came to a full stop at (stop sign) and when; -1 = none. */
  arrivedJ: number;
  arrivedAt: number;
  /** Junction the car was given the right of way into; -1 = none. */
  granted: number;
  /** Seconds held at a junction by traffic (not by a red light). */
  wait: number;
  /** Seconds stopped for people standing in the road (long enough and the driver turns round). */
  humanWait: number;
  /** Turning onto another lane at the end of this one (corner / T-junction / U-turn at a dead end); -1 = not. */
  turnLane: number;
  turnX: number;
  turnZ: number;
  turnRate: number;
  turnTime: number;
}
interface TrafficMemory {
  lanes: Lane[];
  junctions: Junction[];
  /** Per junction, which axes have a live car in the box this step: 1 = east-west, 2 = north-south. */
  occupancy: Uint8Array;
  drive: WeakMap<VehicleAgent, Drive>;
  lastCrash: WeakMap<VehicleAgent, number>;
  enabled: boolean;
  spawnTimer: number;
  knocks: Map<ZombieAgent | LeaderState, Knock>;
  /** Last car to hit an agent and when: agent -> (vehicle id, sim time). */
  lastHit: WeakMap<object, { vehicle: number; at: number }>;
  candidates: number[];
  colliders: Collider[];
  zombies: Map<number, ZombieAgent>;
  sightTimer: WeakMap<VehicleAgent, number>;
  /** Drivers clawed by zombies panic: back out of the mob, then run the horde down (any car, any resistance level). */
  panic: WeakMap<VehicleAgent, Panic>;
}
interface Panic { backupLeft: number; aim: Vec2; aimTimer: number }
const memories = new WeakMap<SimContext, TrafficMemory>();
const sight: SegmentOptions = { mode: 'sight', fromHeight: 1.2, toHeight: 1.1 };
const box = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };

function memory(ctx: SimContext): TrafficMemory {
  let m = memories.get(ctx);
  if (!m) {
    const net = ctx.layout.strongholds.length === 0 ? { lanes: [], junctions: [] } : buildTrafficNetwork(ctx.layout);
    const lanes = net.lanes.filter(l => l.length > 40);
    m = { lanes, junctions: net.junctions, occupancy: new Uint8Array(net.junctions.length), drive: new WeakMap(),
      lastCrash: new WeakMap(), enabled: true, spawnTimer: 1, knocks: new Map(), lastHit: new WeakMap(), candidates: [], colliders: [],
      zombies: new Map(), sightTimer: new WeakMap(), panic: new WeakMap() };
    memories.set(ctx, m);
  }
  return m;
}

/** Game turns traffic off during the opening cinematic (and back on when the player takes over). */
export function setTrafficEnabled(ctx: SimContext, enabled: boolean): void {
  const m = memory(ctx);
  m.enabled = enabled;
  if (!enabled) { ctx.state.vehicles.length = 0; m.knocks.clear(); }
}

export function trafficLanes(ctx: SimContext): readonly TrafficLane[] { return memory(ctx).lanes; }

/** Is a circle (p, r) overlapping the car's footprint? Writes the car-local (forward, right) offset into out. */
export function vehicleOverlap(v: VehicleAgent, p: Vec2, r: number, out?: { f: number; r: number }): boolean {
  const fx = Math.sin(v.facing), fz = Math.cos(v.facing);
  const dx = p.x - v.pos.x, dz = p.z - v.pos.z;
  const lf = dx * fx + dz * fz, lr = dx * fz - dz * fx;
  if (out) { out.f = lf; out.r = lr; }
  return Math.abs(lf) < halfLength(v) + r && Math.abs(lr) < halfWidth(v) + r;
}

/** Visual height of a thrown body (0 when not airborne). */
export function knockHeight(ctx: SimContext, agent: ZombieAgent | LeaderState): number {
  const k = memory(ctx).knocks.get(agent);
  if (!k) return 0;
  const u = Math.min(1, k.t / BALANCE.traffic.throwTime);
  return 4 * k.apex * u * (1 - u);
}

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function makeVehicle(ctx: SimContext, kind: VehicleAgent['kind'], lane: number, pos: Vec2, facing: number): VehicleAgent {
  const model = pickModel(ctx.rng, kind === 'rammer');
  return {
    id: ctx.newId(), kind, mode: 'cruise', pos: { ...pos }, prevPos: { ...pos }, facing, prevFacing: facing,
    speed: BALANCE.traffic.cruiseSpeed * modelSpec(model).speed, lane, modeTime: 0, passes: 0, variant: Math.floor(ctx.rng.next() * 6),
    hitFlash: 0, stuckTime: 0, hp: BALANCE.traffic.carHp, bogTime: 0, model,
  };
}

function trySpawn(ctx: SimContext, m: TrafficMemory, origin: Vec2): void {
  const t = BALANCE.traffic, state = ctx.state;
  if (!m.lanes.length) return;
  // Lanes passing near the Alpha (most of the 840 m world's lanes are far away).
  m.candidates.length = 0;
  for (let i = 0; i < m.lanes.length; i++) {
    const lane = m.lanes[i];
    const lateral = Math.abs((origin.x - lane.from.x) * lane.dz - (origin.z - lane.from.z) * lane.dx);
    if (lateral <= t.spawnMax * 0.7) m.candidates.push(i);
  }
  if (!m.candidates.length) return;
  for (let attempt = 0; attempt < 4; attempt++) {
    const index = m.candidates[Math.floor(ctx.rng.next() * m.candidates.length)];
    const lane = m.lanes[index];
    const proj = (origin.x - lane.from.x) * lane.dx + (origin.z - lane.from.z) * lane.dz;
    const lateral = Math.abs((origin.x - lane.from.x) * lane.dz - (origin.z - lane.from.z) * lane.dx);
    const back = t.spawnMin + ctx.rng.next() * (t.spawnMax - t.spawnMin);
    const along = proj - Math.sqrt(Math.max(0, back * back - lateral * lateral));
    if (along < 2 || along > lane.length - 10) continue;
    const margin = BALANCE.traffic.carLength + 2;
    if (lane.crossings.some(c => along > c.entry - margin && along < c.exit + margin)) continue;
    const pos = { x: lane.from.x + lane.dx * along, z: lane.from.z + lane.dz * along };
    if (state.districts[getDistrictAt(ctx.layout, pos)].status === 'infected') continue;
    if (ctx.collision.isBlocked(pos, t.collisionRadius)) continue;
    if (state.vehicles.some(v => (v.pos.x - pos.x) ** 2 + (v.pos.z - pos.z) ** 2 < 14 * 14)) continue;
    const level = state.resistance.level;
    const hostile = level >= BALANCE.rammer.fromLevel && ctx.rng.next() < (BALANCE.rammer.chance[level] ?? 0);
    state.vehicles.push(makeVehicle(ctx, hostile ? 'rammer' : 'traffic', index, pos, Math.atan2(lane.dx, lane.dz)));
    return;
  }
}

/** Anything solid (or a human / another car) in the car's path within `reach` meters of its nose? */
function pathBlocked(ctx: SimContext, m: TrafficMemory, v: VehicleAgent, reach: number, humans: boolean, cars = true,
  solids = true): boolean {
  const t = BALANCE.traffic;
  const fx = Math.sin(v.facing), fz = Math.cos(v.facing);
  const hl = halfLength(v), ax = v.pos.x + fx * hl, az = v.pos.z + fz * hl;
  const bx = ax + fx * reach, bz = az + fz * reach, hw = halfWidth(v);
  box.minX = Math.min(ax, bx) - hw; box.maxX = Math.max(ax, bx) + hw;
  box.minZ = Math.min(az, bz) - hw; box.maxZ = Math.max(az, bz) + hw;
  if (solids) for (const c of ctx.collision.queryAABB(box, m.colliders)) if (c.blocksMove) return true;
  if (cars) for (const other of ctx.state.vehicles) {
    if (other === v) continue;
    const dx = other.pos.x - v.pos.x, dz = other.pos.z - v.pos.z, ahead = dx * fx + dz * fz;
    if (ahead > 0 && ahead < reach + hl + halfLength(other) && Math.abs(dx * fz - dz * fx) < hw + halfWidth(other)) return true;
  }
  if (humans) for (const g of ctx.state.guards) {
    if (g.dormant || g.hp <= 0 || g.state === 'DEAD') continue;
    const dx = g.pos.x - v.pos.x, dz = g.pos.z - v.pos.z, ahead = dx * fx + dz * fz;
    if (ahead > 0 && ahead < reach + hl && Math.abs(dx * fz - dz * fx) < hw + g.radius + 0.4) return true;
  }
  return false;
}

function approach(v: VehicleAgent, target: number, dt: number, floorIt = false): void {
  const t = BALANCE.traffic;
  // Speeding up (forward or in reverse) vs braking toward the target speed.
  const speeding = target > v.speed ? v.speed >= 0 : v.speed <= 0;
  let rate = speeding ? t.accel * modelSpec(v.model).accel : t.brake;
  // Bogged down (just hit bodies / zombies clinging on): no acceleration, braking still works. A panicking driver
  // floors it anyway, but only gets a fraction of the pull, so a big mob still pins the car.
  if (v.bogTime > 0 && speeding) {
    if (!floorIt) return;
    rate *= BALANCE.rammer.panicBogAccel;
  }
  v.speed = v.speed < target ? Math.min(target, v.speed + rate * dt) : Math.max(target, v.speed - rate * dt);
}

function steerToward(v: VehicleAgent, p: Vec2, dt: number): void {
  const want = Math.atan2(p.x - v.pos.x, p.z - v.pos.z);
  const turn = wrap(want - v.facing), max = BALANCE.rammer.turnRate * dt;
  v.facing = wrap(v.facing + Math.max(-max, Math.min(max, turn)));
}

/** Off-lane driving: slide against buildings like a big circle; a hard stop counts toward stalling. */
function driveFree(ctx: SimContext, v: VehicleAgent, dt: number): void {
  const want = v.speed * dt;
  const x = v.pos.x, z = v.pos.z;
  ctx.collision.moveCircle(v.pos, Math.sin(v.facing) * want, Math.cos(v.facing) * want, BALANCE.traffic.collisionRadius);
  const moved = Math.hypot(v.pos.x - x, v.pos.z - z);
  if (want <= 0.02) return;
  if (moved < want * 0.4) { v.speed *= 0.5; v.stuckTime += dt; }
  else v.stuckTime = Math.max(0, v.stuckTime - dt * 0.25);
}

function setMode(v: VehicleAgent, mode: VehicleAgent['mode']): void { v.mode = mode; v.modeTime = 0; }

function stall(ctx: SimContext, v: VehicleAgent, pulled = false): void {
  setMode(v, 'stalled'); v.lane = -1;
  const state = ctx.state;
  let alive = 0;
  for (const g of state.guards) if (g.hp > 0 && g.state !== 'DEAD') alive++;
  // A driver the horde drags out always appears (the player earned it); a bail-out respects the human cap.
  if (!pulled && alive >= BALANCE.population.maxHumans) return;
  const l = state.leader, rx = Math.cos(v.facing), rz = -Math.sin(v.facing);
  const away = (l.pos.x - v.pos.x) * rx + (l.pos.z - v.pos.z) * rz > 0 ? -1 : 1;
  const off = halfWidth(v) + 0.9;
  for (const side of [away, -away]) {
    const p = { x: v.pos.x + rx * off * side, z: v.pos.z + rz * off * side };
    if (ctx.collision.isBlocked(p, BALANCE.civilian.radius)) continue;
    const district = ctx.layout.districts.find(d => d.id === getDistrictAt(ctx.layout, p));
    // A police driver gets out armed (police role: aims, then shoots); everyone else is a civilian.
    const g = createGuard(ctx.newId(), { role: v.model === 'police' ? 'police' : 'civilian', post: 'street', pos: p, facing: v.facing + side * Math.PI / 2,
      tower: null, homeArea: district?.rect, waypoints: [p] }, ctx.collision);
    if (pulled) {
      g.hp = Math.max(1, g.hp * BALANCE.traffic.pulledDriverHp);
      g.staggerTime = BALANCE.traffic.pulledDriverStagger;
    }
    state.guards.push(g);
    // The driver is an ordinary civilian: its weapon comes from the same per-id roll (ResistanceSystem).
    ctx.emit({ type: 'driverBailed', vehicleId: v.id, guardId: g.id, pos: { ...p }, pulled });
    return;
  }
}

export function findVehicle(state: { vehicles: VehicleAgent[] }, id: number): VehicleAgent | undefined {
  for (const v of state.vehicles) if (v.id === id) return v;
  return undefined;
}

/** A live car can be clawed at: anything but a stalled wreck (its driver is already out). */
export function isVehicleTargetable(v: VehicleAgent | undefined): v is VehicleAgent {
  return !!v && v.mode !== 'stalled' && v.hp > 0;
}

/** Claws on a car: slow it, bog it down, wear the driver's grip; at 0 the driver is dragged out. */
export function damageVehicle(ctx: SimContext, v: VehicleAgent, amount: number): void {
  if (!isVehicleTargetable(v) || amount <= 0) return;
  const t = BALANCE.traffic;
  v.hp -= amount;
  v.speed *= 1 - t.clawSlow;
  v.bogTime = Math.min(t.bogMax, v.bogTime + t.clawBog);
  v.hitFlash = Math.max(v.hitFlash, 0.12);
  ctx.emit({ type: 'damage', target: { kind: 'vehicle', id: v.id }, amount, pos: { ...v.pos } });
  if (v.hp <= 0) { v.hp = 0; stall(ctx, v, true); return; }
  panicDriver(ctx, v);
}

/** A clawed driver panics: reverse out of the mob, then turn and drive into the horde (rammer passes, then flee). */
function panicDriver(ctx: SimContext, v: VehicleAgent): void {
  const m = memory(ctx);
  const p = m.panic.get(v);
  if (p && v.mode !== 'flee') return; // already fighting back
  if (!p) m.panic.set(v, { backupLeft: BALANCE.rammer.panicBackup, aim: { ...v.pos }, aimTimer: 0 });
  else { p.backupLeft = BALANCE.rammer.panicBackup; p.aimTimer = 0; }
  v.passes = 0; v.lane = -1;
  setMode(v, 'ram');
  ctx.emit({ type: 'vehicleRam', vehicleId: v.id, pos: { ...v.pos } });
}

/** Where a panicking driver aims: the middle of the zombies (and the Alpha) around the car. False if none. */
function hordeAim(ctx: SimContext, m: TrafficMemory, v: VehicleAgent, out: Vec2): boolean {
  const radius = BALANCE.rammer.panicTargetRadius, l = ctx.state.leader;
  let n = 0, x = 0, z = 0;
  m.candidates.length = 0;
  ctx.zombieHash.query(v.pos.x, v.pos.z, radius, m.candidates);
  for (const id of m.candidates) {
    const zb = m.zombies.get(id);
    if (!zb || zb.dormant || zb.state === 'dead' || zb.heldBy !== 0) continue;
    if ((zb.pos.x - v.pos.x) ** 2 + (zb.pos.z - v.pos.z) ** 2 > radius * radius) continue;
    x += zb.pos.x; z += zb.pos.z; n++;
  }
  if (l.alive && (l.pos.x - v.pos.x) ** 2 + (l.pos.z - v.pos.z) ** 2 < radius * radius) {
    x += l.pos.x * 2; z += l.pos.z * 2; n += 2; // the Alpha is the scariest thing on the street
  }
  if (!n) return false;
  out.x = x / n; out.z = z / n;
  return true;
}

/** Is this car's driver panicking (clawed by zombies)? Visual/audio hooks and tests. */
export function isPanicking(ctx: SimContext, v: VehicleAgent): boolean {
  return memory(ctx).panic.has(v) && v.mode !== 'stalled';
}

function canHit(m: TrafficMemory, agent: object, v: VehicleAgent, now: number): boolean {
  const last = m.lastHit.get(agent);
  return !last || last.vehicle !== v.id || now - last.at >= BALANCE.traffic.hitCooldown;
}

function throwAgent(m: TrafficMemory, agent: ZombieAgent | LeaderState, v: VehicleAgent, side: number, speed: number, scale: number): void {
  const t = BALANCE.traffic;
  const fx = Math.sin(v.facing), fz = Math.cos(v.facing), rx = fz, rz = -fx;
  let dx = fx * 0.75 + rx * side * 0.65, dz = fz * 0.75 + rz * side * 0.65;
  const d = Math.hypot(dx, dz); dx /= d; dz /= d;
  const s = t.throwSpeedFactor * speed * scale;
  m.knocks.set(agent, { vx: dx * s, vz: dz * s, t: 0, apex: t.throwHeightPerSpeed * speed * scale });
}

const local = { f: 0, r: 0 };

/** Hit (fast) or shove (slow) everything overlapping one car. */
function collide(ctx: SimContext, m: TrafficMemory, v: VehicleAgent, dt: number): void {
  const t = BALANCE.traffic, state = ctx.state;
  const speed = Math.abs(v.speed);
  const hostile = (v.kind === 'rammer' || m.panic.has(v)) && (v.mode === 'ram' || v.mode === 'turn');
  const fx = Math.sin(v.facing), fz = Math.cos(v.facing);
  let touching = 0;
  const handle = (agent: ZombieAgent | LeaderState, radius: number, isLeader: boolean): void => {
    if (!vehicleOverlap(v, agent.pos, radius, local)) return;
    touching++;
    const hl = halfLength(v), hw = halfWidth(v);
    const front = local.f > -hl / 2;
    if (speed >= t.hitMinSpeed && front && canHit(m, agent, v, state.time)) {
      m.lastHit.set(agent, { vehicle: v.id, at: state.time });
      const brute = !isLeader && (agent as ZombieAgent).brute;
      let damage = t.damagePerSpeed * speed * (hostile ? BALANCE.rammer.damageFactor : 1);
      if (isLeader) damage *= t.leaderDamageFactor;
      if (brute) damage *= t.bruteDamageFactor;
      throwAgent(m, agent, v, local.r >= 0 ? 1 : -1, speed, brute ? 0.5 : 1);
      if (isLeader) {
        damageLeader(ctx, damage, 'vehicle');
        const l = agent as LeaderState;
        if (l.alive) { l.hitStun = Math.max(l.hitStun, 0.4); l.vel.x = l.vel.z = 0; }
      } else damageZombie(ctx, agent as ZombieAgent, damage);
      v.speed *= isLeader ? 1 - t.leaderSpeedLoss : 1 - Math.min(0.9, t.speedLossPerHit * (brute ? 3 : 1));
      v.bogTime = Math.min(t.bogMax, v.bogTime + t.bogPerHit * (isLeader || brute ? 2 : 1));
      v.hitFlash = 0.25;
      const killed = isLeader ? !(agent as LeaderState).alive : (agent as ZombieAgent).state === 'dead';
      ctx.emit({ type: 'vehicleHit', vehicleId: v.id, pos: { ...agent.pos }, target: isLeader ? 'leader' : 'zombie', speed, killed });
      return;
    }
    // Shove out along the shallower car axis (a parked/slow car is solid).
    const penF = hl + radius - Math.abs(local.f), penR = hw + radius - Math.abs(local.r);
    const rx = fz, rz = -fx;
    if (penR <= penF) {
      const s = (local.r >= 0 ? 1 : -1) * (penR + 0.01);
      ctx.collision.moveCircle(agent.pos, rx * s, rz * s, radius);
    } else {
      const s = (local.f >= 0 ? 1 : -1) * (penF + 0.01);
      ctx.collision.moveCircle(agent.pos, fx * s, fz * s, radius);
    }
  };
  const reach = halfLength(v) + 1;
  m.candidates.length = 0;
  ctx.zombieHash.query(v.pos.x, v.pos.z, reach, m.candidates);
  for (const id of m.candidates) {
    const z = m.zombies.get(id);
    if (!z || z.dormant || z.heldBy !== 0 || z.state === 'dead' || z.elevation > 1.2 && !m.knocks.has(z)) continue;
    handle(z, z.radius, false);
  }
  const l = state.leader;
  if (l.alive) handle(l, l.radius, true);
  for (const g of state.guards) {
    if (g.dormant || g.hp <= 0 || g.state === 'DEAD' || g.elevation > 0.5) continue;
    if ((g.pos.x - v.pos.x) ** 2 + (g.pos.z - v.pos.z) ** 2 > reach * reach) continue;
    if (!vehicleOverlap(v, g.pos, g.radius, local)) continue;
    const penR = halfWidth(v) + g.radius - Math.abs(local.r), s = (local.r >= 0 ? 1 : -1) * (penR + 0.01);
    ctx.collision.moveCircle(g.pos, fz * s, -fx * s, g.radius);
  }
  if (touching >= 3 && speed < 2) v.stuckTime += dt;
}

function applyKnocks(ctx: SimContext, m: TrafficMemory, dt: number): void {
  const t = BALANCE.traffic;
  for (const [agent, k] of m.knocks) {
    k.t += dt;
    const isZombie = 'state' in agent;
    if (k.t >= t.throwTime || (isZombie && (agent as ZombieAgent).state === 'dead' && k.t > t.throwTime)) {
      if (isZombie) (agent as ZombieAgent).elevation = 0;
      m.knocks.delete(agent);
      continue;
    }
    ctx.collision.moveCircle(agent.pos, k.vx * dt, k.vz * dt, agent.radius);
    const decay = Math.exp(-2.5 * dt);
    k.vx *= decay; k.vz *= decay;
    if (isZombie) (agent as ZombieAgent).elevation = knockHeight(ctx, agent);
  }
}

export function updateTraffic(ctx: SimContext, dt: number): void {
  const state = ctx.state;
  if (state.phase !== 'playing' && state.phase !== 'respawning') return;
  const m = memory(ctx);
  for (const v of state.vehicles) {
    v.prevPos.x = v.pos.x; v.prevPos.z = v.pos.z; v.prevFacing = v.facing;
    v.hitFlash = Math.max(0, v.hitFlash - dt);
    // Bogged down: bodies under the wheels / zombies hanging on drag the car toward a stop.
    if (v.bogTime > 0) v.speed *= Math.exp(-BALANCE.traffic.bogDrag * dt);
    v.bogTime = Math.max(0, v.bogTime - dt);
  }
  applyKnocks(ctx, m, dt);
  if (!m.lanes.length && !state.vehicles.length) return;
  const t = BALANCE.traffic, r = BALANCE.rammer;
  updateOccupancy(m, state.vehicles);
  const l = state.leader, origin = l.pos;
  m.spawnTimer -= dt;
  if (m.enabled && m.spawnTimer <= 0 && state.vehicles.length < t.maxCars && l.alive) {
    m.spawnTimer = t.spawnInterval;
    trySpawn(ctx, m, origin);
  }
  m.zombies.clear();
  for (const z of state.zombies) m.zombies.set(z.id, z);
  let write = 0;
  for (const v of state.vehicles) {
    v.modeTime += dt;
    let keep = (v.pos.x - origin.x) ** 2 + (v.pos.z - origin.z) ** 2 < t.despawnDistance ** 2;
    switch (v.mode) {
      case 'cruise': {
        const lane = v.lane >= 0 ? m.lanes[v.lane] : null;
        if (lane) {
          if (!driveLane(ctx, m, v, lane, dt)) keep = false;
        } else {
          const reach = t.brakeDistance + v.speed * 0.4;
          const solid = pathBlocked(ctx, m, v, reach, false);
          const blocked = solid || pathBlocked(ctx, m, v, reach, true);
          approach(v, blocked ? 0 : t.cruiseSpeed * modelSpec(v.model).speed, dt);
          driveFree(ctx, v, dt);
          // Waiting for a pedestrian is fine; standing at a wall, a road end or a dead car is not.
          v.stuckTime = solid && v.speed < 0.5 ? v.stuckTime + dt : Math.max(0, v.stuckTime - dt);
        }
        if (v.kind === 'rammer' && l.alive) {
          const timer = (m.sightTimer.get(v) ?? 0) - dt;
          m.sightTimer.set(v, timer <= 0 ? 0.2 : timer);
          if (timer <= 0 && (l.pos.x - v.pos.x) ** 2 + (l.pos.z - v.pos.z) ** 2 < r.detectRadius ** 2 &&
              !ctx.collision.segmentBlocked(v.pos, l.pos, sight)) {
            setMode(v, 'ram'); v.lane = -1;
            ctx.emit({ type: 'vehicleRam', vehicleId: v.id, pos: { ...v.pos } });
          }
        }
        break;
      }
      case 'ram': {
        const panic = m.panic.get(v);
        let aim: Vec2 = l.pos;
        if (panic) {
          panic.aimTimer -= dt;
          if (panic.aimTimer <= 0) {
            panic.aimTimer = 0.2;
            if (!hordeAim(ctx, m, v, panic.aim)) { setMode(v, 'flee'); break; }
          }
          aim = panic.aim;
          steerToward(v, aim, dt);
          if (panic.backupLeft > 0) {
            // Reverse out of the mob first (the nose swings toward the horde meanwhile).
            panic.backupLeft -= dt;
            approach(v, -r.reverseSpeed, dt, true);
            driveFree(ctx, v, dt);
            break;
          }
          approach(v, r.speed, dt, true);
        } else {
          if (!l.alive) { setMode(v, 'flee'); break; }
          steerToward(v, l.pos, dt);
          approach(v, r.speed, dt);
        }
        driveFree(ctx, v, dt);
        const dx = aim.x - v.pos.x, dz = aim.z - v.pos.z, d = Math.hypot(dx, dz);
        const ahead = dx * Math.sin(v.facing) + dz * Math.cos(v.facing);
        if (d < 2.5 || (ahead < 0 && d < 10)) { v.passes++; setMode(v, 'turn'); }
        else if (d > r.detectRadius * 2) setMode(v, 'flee');
        break;
      }
      case 'turn': {
        approach(v, r.speed, dt, m.panic.has(v));
        driveFree(ctx, v, dt);
        if (v.modeTime >= r.overshoot) setMode(v, v.passes >= r.maxPasses || (!l.alive && !m.panic.has(v)) ? 'flee' : 'ram');
        break;
      }
      case 'flee': {
        const away = { x: v.pos.x * 2 - origin.x, z: v.pos.z * 2 - origin.z };
        steerToward(v, away, dt);
        approach(v, r.speed, dt);
        driveFree(ctx, v, dt);
        break;
      }
      case 'stalled': {
        approach(v, 0, dt);
        if (Math.abs(v.speed) > 0.05) driveFree(ctx, v, dt);
        if (v.modeTime >= t.fadeTime) keep = false;
        break;
      }
    }
    if (v.mode !== 'stalled' && v.stuckTime >= t.stallTime) {
      // Out of the Alpha's sight a jammed car just leaves; close by, it stalls and the driver bails out.
      if ((v.pos.x - origin.x) ** 2 + (v.pos.z - origin.z) ** 2 > t.quietDespawnDistance ** 2) keep = false;
      else stall(ctx, v);
    }
    collide(ctx, m, v, dt);
    if (keep) state.vehicles[write++] = v;
  }
  state.vehicles.length = write;
  crashes(ctx, m);
}

// ---------------------------------------------------------------------------
// Lane driving under traffic control
// ---------------------------------------------------------------------------

function driveOf(m: TrafficMemory, v: VehicleAgent): Drive {
  let d = m.drive.get(v);
  if (!d) {
    d = { offset: 0, swerve: false, arrivedJ: -1, arrivedAt: 0, granted: -1, wait: 0, humanWait: 0, turnLane: -1, turnX: 0, turnZ: 0,
      turnRate: 0, turnTime: 0 };
    m.drive.set(v, d);
  }
  return d;
}

const axisBit = (lane: Lane): number => lane.axis === 'x' ? 1 : 2;

function updateOccupancy(m: TrafficMemory, vehicles: VehicleAgent[]): void {
  m.occupancy.fill(0);
  if (!m.junctions.length) return;
  for (const v of vehicles) {
    if (v.mode === 'stalled') continue; // wrecks are driven around, they do not hold the junction
    const bit = v.lane >= 0 ? axisBit(m.lanes[v.lane]) : 3;
    const pad = halfLength(v) * 0.8;
    for (const j of m.junctions) {
      const r = j.rect;
      if (v.pos.x > r.minX - pad && v.pos.x < r.maxX + pad && v.pos.z > r.minZ - pad && v.pos.z < r.maxZ + pad) m.occupancy[j.id] |= bit;
    }
  }
}

/** A live vehicle standing just past the junction on this lane: entering now would block the box. */
function exitBlocked(ctx: SimContext, v: VehicleAgent, lane: Lane, c: LaneCrossing): boolean {
  const t = BALANCE.traffic, need = 2 * halfLength(v) + t.followGap;
  for (const o of ctx.state.vehicles) {
    if (o === v || o.mode === 'stalled' || Math.abs(o.speed) > 2) continue;
    const rx = o.pos.x - lane.from.x, rz = o.pos.z - lane.from.z;
    const along = rx * lane.dx + rz * lane.dz, lat = rx * lane.dz - rz * lane.dx;
    if (Math.abs(lat) < t.carWidth && along - halfLength(o) < c.exit + need && along + halfLength(o) > c.exit - 0.5) return true;
  }
  return false;
}

/** May the car enter junction `j` now? `dist` = meters from its nose to the stop line. */
function mayEnter(ctx: SimContext, m: TrafficMemory, v: VehicleAgent, lane: Lane, c: LaneCrossing, j: Junction,
  dist: number, d: Drive, dt: number): boolean {
  const t = BALANCE.traffic, state = ctx.state;
  const other = axisBit(lane) === 1 ? 2 : 1;
  const patient = d.wait > t.junctionPatience;
  const heldByTraffic = (): false => { d.wait += dt; return false; };
  if (j.control === 'light') {
    const color = signalFor(j, lane.axis, state.time);
    // Yellow / red: only a car that can no longer stop goes through.
    if (color !== 'green') return dist < stoppingDistance(v.speed);
    if (!patient && ((m.occupancy[j.id] & other) || exitBlocked(ctx, v, lane, c))) return heldByTraffic();
    return true;
  }
  // 4-way stop: full stop at the line first.
  if (d.granted === j.id) return true;
  if (d.arrivedJ !== j.id) {
    if (dist < 1.2 && Math.abs(v.speed) < 0.4) { d.arrivedJ = j.id; d.arrivedAt = state.time; d.wait = 0; }
    return false;
  }
  if (state.time - d.arrivedAt < t.stopHold) return false;
  if (!patient) {
    if ((m.occupancy[j.id] & other) || exitBlocked(ctx, v, lane, c)) return heldByTraffic();
    // First come, first served against cars waiting on the crossing road (the same road goes together).
    for (const o of state.vehicles) {
      if (o === v || o.lane < 0 || o.mode !== 'cruise') continue;
      const od = m.drive.get(o);
      if (!od || m.lanes[o.lane].axis === lane.axis) continue;
      // A crossing car already given the junction holds it until it has driven through.
      if (od.granted === j.id) return heldByTraffic();
      if (od.arrivedJ !== j.id) continue;
      if (od.arrivedAt < d.arrivedAt || (od.arrivedAt === d.arrivedAt && o.id < v.id)) return heldByTraffic();
    }
  }
  d.granted = j.id;
  return true;
}

const LOOKAHEAD = 40;

/** One step of an ambient vehicle on its lane. False once it has driven off the end of the lane. */
function driveLane(ctx: SimContext, m: TrafficMemory, v: VehicleAgent, lane: Lane, dt: number): boolean {
  const t = BALANCE.traffic, state = ctx.state, d = driveOf(m, v);
  if (d.turnLane >= 0) { driveTurn(ctx, m, v, d, dt); return true; }
  const hl = halfLength(v), hw = halfWidth(v);
  const leftX = lane.dz, leftZ = -lane.dx;
  const along = (v.pos.x - lane.from.x) * lane.dx + (v.pos.z - lane.from.z) * lane.dz;
  const front = along + hl, rear = along - hl;
  let target = t.cruiseSpeed * modelSpec(v.model).speed;

  // --- junction control
  let c: LaneCrossing | undefined;
  for (const x of lane.crossings) if (x.exit > rear) { c = x; break; }
  // Near the end of the lane (past its last stop line): turn onto a crossing road, or U-turn at a dead end.
  if (lane.length - front < 12 && (!c || front > c.entry) && d.offset < 0.1 && startTurn(ctx, m, v, lane, along, d)) {
    driveTurn(ctx, m, v, d, dt);
    return true;
  }
  if (!c || (d.arrivedJ >= 0 && c.junction !== d.arrivedJ) || (d.granted >= 0 && c.junction !== d.granted)) {
    d.arrivedJ = -1; d.granted = -1; d.wait = 0;
  }
  if (c && front <= c.entry + 0.05) {
    const dist = c.entry - t.stopLineGap - front;
    if (dist < stoppingDistance(v.speed) + 14) {
      if (!mayEnter(ctx, m, v, lane, c, m.junctions[c.junction], dist, d, dt)) target = Math.min(target, stopSpeed(dist));
      else d.wait = 0;
    }
  }

  // --- the vehicle ahead (following gap) and wrecks (swerve round them)
  let gap = Infinity, wreckGap = Infinity, wreckNear = false;
  for (const o of state.vehicles) {
    if (o === v) continue;
    const ox = o.pos.x - v.pos.x, oz = o.pos.z - v.pos.z;
    const ahead = ox * lane.dx + oz * lane.dz;
    if (ahead < -hl - halfLength(o) - 2 || ahead > LOOKAHEAD) continue;
    const aligned = Math.abs(Math.sin(o.facing) * lane.dx + Math.cos(o.facing) * lane.dz) > 0.7;
    const halfAcross = aligned ? halfWidth(o) : halfLength(o), halfAlong = aligned ? halfLength(o) : halfWidth(o);
    // lat: sideways from this car; line: sideways from this car's lane line (the car may be swerved left of it).
    const lat = ox * leftX + oz * leftZ, line = lat + d.offset;
    if (o.mode === 'stalled' && Math.abs(line) < hw + halfAcross - 0.2) {
      // A wreck on our lane line: plan to pass it until we are clear of it.
      if (ahead > -hl - halfAlong - 1.5 && ahead < hl + halfAlong + 12) wreckNear = true;
      if (ahead > 0) wreckGap = Math.min(wreckGap, ahead - hl - halfAlong);
    }
    if (ahead <= 0) continue;
    if (Math.abs(lat) >= hw + halfAcross - 0.2) continue;
    if (o.mode === 'stalled' && d.swerve) continue; // passing it
    gap = Math.min(gap, ahead - hl - halfAlong);
  }
  if (wreckNear && !d.swerve) {
    // Pull out only when the oncoming lane is clear for a while.
    let clear = true;
    for (const o of state.vehicles) {
      if (o === v || o.mode === 'stalled') continue;
      const ox = o.pos.x - v.pos.x, oz = o.pos.z - v.pos.z;
      const ahead = ox * lane.dx + oz * lane.dz, lat = ox * leftX + oz * leftZ + d.offset;
      if (Math.abs(lat - lane.spacing) < t.carWidth * 1.5 && ahead > -hl * 4 && ahead < 30 + hl) { clear = false; break; }
    }
    if (clear) d.swerve = true;
  } else if (!wreckNear && d.swerve) d.swerve = false;
  if (d.swerve || d.offset > 0.1) target = Math.min(target, t.swerveSpeed);
  if (d.swerve && d.offset < 2 * hw) target = Math.min(target, stopSpeed(wreckGap - 0.4));
  target = Math.min(target, stopSpeed(gap - t.followGap));

  // --- people and walls in the way
  const reach = t.brakeDistance + v.speed * 0.4;
  const solid = pathBlocked(ctx, m, v, reach, false, false);
  const people = !solid && pathBlocked(ctx, m, v, reach, true, false);
  if (solid || people) target = 0;
  // People who stay in the road (a patrol, a crowd): after a while the driver turns round instead of waiting forever.
  d.humanWait = people && v.speed < 0.5 ? d.humanWait + dt : 0;
  if (d.humanWait > BALANCE.traffic.pedestrianPatience && d.offset < 0.1 && startTurn(ctx, m, v, lane, along, d, true)) {
    d.humanWait = 0;
    driveTurn(ctx, m, v, d, dt);
    return true;
  }
  approach(v, Math.max(0, target), dt);
  if (v.speed < 0) v.speed = 0;
  // Waiting at a light, a stop sign, a pedestrian or in a queue is fine; standing at a wall is not.
  v.stuckTime = solid && v.speed < 0.5 ? v.stuckTime + dt : Math.max(0, v.stuckTime - dt);

  // --- move along the lane (plus the sideways swerve)
  const wantOffset = d.swerve ? lane.spacing : 0;
  const step = t.swerveRate * dt, before = d.offset;
  d.offset = d.offset < wantOffset ? Math.min(wantOffset, d.offset + step) : Math.max(wantOffset, d.offset - step);
  const latVel = (d.offset - before) / dt;
  const next = along + v.speed * dt;
  v.pos.x = lane.from.x + lane.dx * next + leftX * d.offset;
  v.pos.z = lane.from.z + lane.dz * next + leftZ * d.offset;
  const yaw = Math.max(-0.6, Math.min(0.6, Math.atan2(latVel, Math.max(1.5, v.speed))));
  v.facing = wrap(Math.atan2(lane.dx, lane.dz) + yaw);
  return next <= lane.length;
}

/**
 * Pick where to go at the end of a lane: a crossing road ahead (left or right, at random), else a U-turn into the
 * oncoming lane (dead end at the coast). False = nowhere to go (the car drives off the end as before).
 */
function startTurn(ctx: SimContext, m: TrafficMemory, v: VehicleAgent, lane: Lane, along: number, d: Drive,
  uturnOnly = false): boolean {
  const choices: { lane: number; x: number; z: number }[] = [];
  let uturn = -1, uturnAlong = 0;
  for (let i = 0; i < m.lanes.length; i++) {
    const o = m.lanes[i];
    if (o === lane) continue;
    const dot = o.dx * lane.dx + o.dz * lane.dz;
    if (Math.abs(dot) < 0.2 && !uturnOnly) {
      // Where my lane line meets its line, and how far along each.
      const mine = lane.axis === 'x' ? (o.from.x - lane.from.x) * lane.dx : (o.from.z - lane.from.z) * lane.dz;
      const px = lane.from.x + lane.dx * mine, pz = lane.from.z + lane.dz * mine;
      const theirs = (px - o.from.x) * o.dx + (pz - o.from.z) * o.dz;
      // (A lane may start just past the crossing, e.g. the side of the ring road below the corner.)
      if (mine < along + 1 || mine > lane.length + 4 || theirs < -12 || theirs > o.length - 12) continue;
      const at = Math.max(theirs, 0) + 7;
      choices.push({ lane: i, x: o.from.x + o.dx * at, z: o.from.z + o.dz * at });
    } else if (dot < -0.95) {
      // The oncoming lane of the same road: its line one lane spacing to my left.
      const lat = (o.from.x - lane.from.x) * lane.dz - (o.from.z - lane.from.z) * lane.dx;
      if (Math.abs(lat - lane.spacing) > 0.6) continue;
      const theirs = (v.pos.x - o.from.x) * o.dx + (v.pos.z - o.from.z) * o.dz;
      if (theirs < 0 || theirs > o.length - 12) continue;
      uturn = i; uturnAlong = theirs;
    }
  }
  if (choices.length) {
    const pick = choices[Math.floor(ctx.rng.next() * choices.length) % choices.length];
    d.turnLane = pick.lane; d.turnX = pick.x; d.turnZ = pick.z; d.turnRate = BALANCE.rammer.turnRate * 1.3;
  } else if (uturn >= 0) {
    const o = m.lanes[uturn], back = Math.max(0, uturnAlong + 2);
    d.turnLane = uturn; d.turnX = o.from.x + o.dx * back; d.turnZ = o.from.z + o.dz * back;
    // Tight enough to swing round inside the road: radius = half the lane spacing.
    d.turnRate = Math.max(BALANCE.rammer.turnRate, 4.5 / Math.max(1.5, lane.spacing / 2));
  } else return false;
  d.turnTime = 0; d.arrivedJ = -1; d.granted = -1; d.wait = 0;
  return true;
}

/** Drive the turn arc toward the new lane; latch on once lined up with it. */
function driveTurn(ctx: SimContext, m: TrafficMemory, v: VehicleAgent, d: Drive, dt: number): void {
  const t = BALANCE.traffic, o = m.lanes[d.turnLane];
  d.turnTime += dt;
  const reach = t.brakeDistance * 0.6;
  // On the road: only people and other cars stop a turning car (a long truck's arc may sweep a kerb-side wall).
  approach(v, pathBlocked(ctx, m, v, reach, true, true, false) ? 0 : 4.5, dt);
  if (v.speed < 0) v.speed = 0;
  const want = Math.atan2(d.turnX - v.pos.x, d.turnZ - v.pos.z);
  const turn = wrap(want - v.facing), max = d.turnRate * dt * Math.min(1, v.speed / 2 + 0.2);
  v.facing = wrap(v.facing + Math.max(-max, Math.min(max, turn)));
  v.pos.x += Math.sin(v.facing) * v.speed * dt;
  v.pos.z += Math.cos(v.facing) * v.speed * dt;
  const lat = (v.pos.x - o.from.x) * o.dz - (v.pos.z - o.from.z) * o.dx;
  const heading = Math.abs(wrap(v.facing - Math.atan2(o.dx, o.dz)));
  if ((Math.abs(lat) < 0.7 && heading < 0.35) || d.turnTime > 6) {
    // Lined up (or taking too long): settle onto the new lane.
    const along = Math.max(0, (v.pos.x - o.from.x) * o.dx + (v.pos.z - o.from.z) * o.dz);
    v.pos.x = o.from.x + o.dx * along; v.pos.z = o.from.z + o.dz * along;
    v.facing = Math.atan2(o.dx, o.dz);
    v.lane = d.turnLane;
    d.turnLane = -1; d.offset = 0; d.swerve = false;
  }
}

// ---------------------------------------------------------------------------
// Accidents: out-of-control vehicles (panicking, ramming, fleeing) hitting other vehicles
// ---------------------------------------------------------------------------

const wild = (v: VehicleAgent): boolean => v.mode === 'ram' || v.mode === 'turn' || v.mode === 'flee';
const normal = { x: 0, z: 0 };
const axes = [0, 0, 0, 0, 0, 0, 0, 0];

/** Oriented-box overlap of two vehicle footprints: penetration depth (0 = apart); `out` = normal from a to b. */
export function carOverlap(a: VehicleAgent, b: VehicleAgent, out: { x: number; z: number } = normal): number {
  const ahl = halfLength(a), ahw = halfWidth(a), bhl = halfLength(b), bhw = halfWidth(b);
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
  if (dx * dx + dz * dz > (ahl + bhl) ** 2) return 0;
  const afx = Math.sin(a.facing), afz = Math.cos(a.facing), bfx = Math.sin(b.facing), bfz = Math.cos(b.facing);
  axes[0] = afx; axes[1] = afz; axes[2] = afz; axes[3] = -afx; axes[4] = bfx; axes[5] = bfz; axes[6] = bfz; axes[7] = -bfx;
  let best = Infinity;
  for (let i = 0; i < 8; i += 2) {
    const ux = axes[i], uz = axes[i + 1];
    const ra = ahl * Math.abs(afx * ux + afz * uz) + ahw * Math.abs(afz * ux - afx * uz);
    const rb = bhl * Math.abs(bfx * ux + bfz * uz) + bhw * Math.abs(bfz * ux - bfx * uz);
    const proj = dx * ux + dz * uz, pen = ra + rb - Math.abs(proj);
    if (pen <= 0) return 0;
    if (pen < best) { best = pen; const s = proj >= 0 ? 1 : -1; out.x = ux * s; out.z = uz * s; }
  }
  return best;
}

function crashes(ctx: SimContext, m: TrafficMemory): void {
  const t = BALANCE.traffic, cars = ctx.state.vehicles, now = ctx.state.time;
  for (let i = 0; i < cars.length; i++) for (let k = i + 1; k < cars.length; k++) {
    let a = cars[i], b = cars[k];
    if (!wild(a) && !wild(b)) continue;
    if (a.mode === 'stalled' && b.mode === 'stalled') continue;
    if (!wild(a)) { const s = a; a = b; b = s; } // a = the out-of-control vehicle
    const pen = carOverlap(a, b);
    if (pen <= 0) continue;
    const nx = normal.x, nz = normal.z;
    const closing = (a.speed * Math.sin(a.facing) - b.speed * Math.sin(b.facing)) * nx +
      (a.speed * Math.cos(a.facing) - b.speed * Math.cos(b.facing)) * nz;
    // Push apart: the wild vehicle takes the push unless both are wild (then by mass).
    const ma = modelSpec(a.model).mass, mb = modelSpec(b.model).mass, bothWild = wild(b);
    const sa = bothWild ? mb / (ma + mb) : 1;
    ctx.collision.moveCircle(a.pos, -nx * (pen + 0.02) * sa, -nz * (pen + 0.02) * sa, t.collisionRadius);
    if (bothWild) ctx.collision.moveCircle(b.pos, nx * (pen + 0.02) * (1 - sa), nz * (pen + 0.02) * (1 - sa), t.collisionRadius);
    if (closing < t.crashMinSpeed) { a.speed *= 0.5; continue; }
    const last = m.lastCrash.get(a);
    if (last !== undefined && now - last < 1) continue;
    m.lastCrash.set(a, now); m.lastCrash.set(b, now);
    ctx.emit({ type: 'vehicleCrash', vehicleId: a.id, otherId: b.id,
      pos: { x: (a.pos.x + b.pos.x) / 2, z: (a.pos.z + b.pos.z) / 2 }, speed: closing });
    for (const v of [a, b]) { v.hitFlash = 0.35; v.bogTime = t.bogMax; }
    // The heavier vehicle wins: impact felt by each side scales with the other's mass.
    const onB = closing * ma / mb, onA = closing * mb / ma;
    a.speed *= Math.max(0.1, 1 - mb / (ma + mb) * 1.6);
    if (b.mode !== 'stalled' && onB >= t.crashMinSpeed) {
      // The vehicle that was hit is knocked off its lane and wrecked; its driver gets out.
      b.speed = 0;
      if (!bothWild) {
        const shove = Math.min(1.2, onB * 0.08);
        b.pos.x += nx * shove; b.pos.z += nz * shove;
      }
      if (!bothWild || onB >= t.crashWreckSpeed) stall(ctx, b);
    }
    if (onA >= t.crashWreckSpeed && a.mode !== 'stalled') stall(ctx, a);
  }
}
