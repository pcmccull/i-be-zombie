// [pure] City Activity Director: district alert/control, weighted dynamic events, and capped local police response.
// Spec: docs/11_cityupgrade.md §2.3, §2.5, §2.9, §3.
//
// Event lifecycle: spawn (beyond the rendered vision limit, so nothing pops in view) → staggered arrivals (bus
// tourists) → optional escalation (police called to an accident or a disturbed crowd, walking in from off-screen) →
// resolution: `completed` (the horde broke it up: Brains + achievement progress) or `expired` (timed out / left
// behind). Leftover participants are never deleted in view: they become ordinary street humans ("orphans") and are
// only removed once they are out of sight, so populations never leak and nothing visibly vanishes.
import { BALANCE } from '../config/balance';
import { restoreStrength } from './HordeHealthSystem';
import { districtMeta } from '../content/districts';
import { DYNAMIC_EVENT_BY_ID, DYNAMIC_EVENTS } from '../content/events';
import type { SimContext } from '../core/contracts';
import type {
  ActiveDynamicEvent,
  CityEventProp,
  CityEventPropKind,
  ControlState,
  DistrictAlert,
  DistrictId,
  DynamicEventKind,
  EntityId,
  GameEvent,
  GameState,
  GuardAgent,
  Rng,
  Vec2,
} from '../core/types';
import { VISION_EDGE_BAND } from '../core/visionMath';
import { createGuard } from '../entities/HumanGuard';
import { createZombie } from '../entities/Zombie';
import { mulberry32 } from '../utils/rng';
import { getDistrictAt } from '../world/worldQueries';
import { addBrains } from './RewardSystem';

interface DirectorMemory {
  checkTimer: number;
  sweepTimer: number;
  cooldowns: Map<DynamicEventKind, number>;
  /** Recent event spots (no identical event twice in a row at the same place). */
  history: { kind: DynamicEventKind; pos: Vec2 }[];
  lastKind: DynamicEventKind | null;
  policeDispatchAt: number;
  nextEventSeq: number;
  disturbedAt: Map<string, number>;
  /** Released participants, removed once they are out of sight. */
  orphanGuards: Set<EntityId>;
  orphanZombies: Set<EntityId>;
  /** Every human the director spawned that is still in state.guards (alive, fled or corpse): the hard event cap. */
  owned: Set<EntityId>;
  rng: Rng;
}

const memories = new WeakMap<GameState, DirectorMemory>();

function memory(state: GameState): DirectorMemory {
  let m = memories.get(state);
  if (!m) {
    m = {
      checkTimer: 8.0, // let opening settle before first spontaneous incident
      sweepTimer: 0,
      cooldowns: new Map(),
      history: [],
      lastKind: null,
      policeDispatchAt: -Infinity,
      nextEventSeq: 1,
      disturbedAt: new Map(),
      orphanGuards: new Set(),
      orphanZombies: new Set(),
      owned: new Set(),
      rng: mulberry32(BALANCE.sim.seed ^ 0x51f29a3),
    };
    memories.set(state, m);
  }
  return m;
}

/** Director diagnostics for the F3 overlay (cooldowns left per kind, orphans waiting to leave). */
export function cityDirectorDiagnostics(state: GameState): { cooldowns: [DynamicEventKind, number][]; orphans: number; nextCheck: number; humans: number } {
  const m = memories.get(state);
  if (!m) return { cooldowns: [], orphans: 0, nextCheck: 0, humans: 0 };
  const cooldowns: [DynamicEventKind, number][] = [];
  for (const [k, t] of m.cooldowns) if (t > state.time) cooldowns.push([k, t - state.time]);
  return { cooldowns, orphans: m.orphanGuards.size + m.orphanZombies.size, nextCheck: Math.max(0, m.checkTimer), humans: m.owned.size };
}

export function alertFromHeat(heat: number, captured: boolean): DistrictAlert {
  if (captured) return 'overrun';
  const t = BALANCE.city.alertThresholds;
  if (heat >= t.lockdown) return 'lockdown';
  if (heat >= t.panic) return 'panic';
  if (heat >= t.concerned) return 'concerned';
  return 'normal';
}

export function controlFromDistrict(status: string, captured: boolean, infection: number): ControlState {
  if (captured || status === 'infected') return 'zombieControlled';
  if (status === 'contested') return 'contested';
  if (infection >= 0.35) return 'zombieInfluenced';
  return 'humanControlled';
}

export function setDistrictAlert(ctx: SimContext, districtId: DistrictId, alert: DistrictAlert): void {
  const d = ctx.state.districts[districtId];
  const prev = d.alert ?? 'normal';
  const t = BALANCE.city.alertThresholds;
  const heatMap: Record<DistrictAlert, number> = {
    normal: 0,
    concerned: t.concerned + 4,
    panic: t.panic + 6,
    lockdown: t.lockdown + 10,
    overrun: 100,
  };
  d.heat = heatMap[alert];
  d.alert = alert;
  if (prev !== alert) {
    ctx.emit({ type: 'districtAlertChanged', districtId, alert, prev });
  }
}

function addHeat(ctx: SimContext, pos: Vec2, delta: number): void {
  const id = getDistrictAt(ctx.layout, pos);
  const d = ctx.state.districts[id];
  const prev = d.alert ?? 'normal';
  const nextHeat = Math.max(0, Math.min(BALANCE.city.heatMax, (d.heat ?? 0) + delta));
  d.heat = nextHeat;
  const nextAlert = alertFromHeat(nextHeat, d.strongholdCaptured || d.status === 'infected');
  d.alert = nextAlert;
  if (prev !== nextAlert) {
    ctx.emit({ type: 'districtAlertChanged', districtId: id, alert: nextAlert, prev });
  }
}

/** Rendered vision limit around the Alpha (m): nothing past it is drawn, so spawning there never pops in view. */
export function visibleLimit(state: GameState): number {
  const tier = Math.max(1, Math.min(BALANCE.vision.tiers.length, state.progression.visionTier || 1));
  return BALANCE.vision.tiers[tier - 1].hazeRadius * (1 + VISION_EDGE_BAND);
}

function spawnRange(state: GameState): { min: number; max: number; despawn: number } {
  const min = Math.max(BALANCE.city.eventMinSpawnDist, visibleLimit(state) + BALANCE.city.eventSpawnBeyondVision);
  const max = Math.max(BALANCE.city.eventMaxSpawnDist, min + 40);
  return { min, max, despawn: Math.max(BALANCE.city.eventDespawnDist, max + 30) };
}

/** Clearance a kind's dressing needs around its spot (bus / truck / stage footprints). */
const PROP_CLEARANCE: Partial<Record<DynamicEventKind, number>> = {
  tourist_bus: 2.2, food_truck_crowd: 1.8, street_festival: 2.0, car_accident: 1.6, supply_convoy: 1.8,
  beach_volleyball: 1.6, survivor_raid: 1.4,
};

function pickSpawnPoint(ctx: SimContext, districtId: DistrictId, kind: DynamicEventKind, rng: Rng): Vec2 | null {
  const district = ctx.layout.districts.find(d => d.id === districtId);
  if (!district || district.spawnPoints.length === 0) return null;
  const m = memory(ctx.state);
  const lp = ctx.state.leader.pos;
  const range = spawnRange(ctx.state);
  const minD2 = range.min ** 2;
  const maxD2 = range.max ** 2;
  const clearance = PROP_CLEARANCE[kind] ?? 0.8;

  const start = Math.floor(rng.next() * district.spawnPoints.length);
  for (let i = 0; i < district.spawnPoints.length; i++) {
    const p = district.spawnPoints[(start + i) % district.spawnPoints.length];
    const d2 = (p.x - lp.x) ** 2 + (p.z - lp.z) ** 2;
    if (d2 < minD2 || d2 > maxD2 || ctx.collision.isBlocked(p, clearance)) continue;
    // History: the same kind never repeats within 30 m of one of its recent spots.
    if (m.history.some(h => h.kind === kind && (h.pos.x - p.x) ** 2 + (h.pos.z - p.z) ** 2 < 900)) continue;
    return { x: p.x, z: p.z };
  }
  return null;
}

function jitterWalkable(ctx: SimContext, center: Vec2, radius: number, rng: Rng): Vec2 {
  for (let i = 0; i < 6; i++) {
    const ang = rng.next() * Math.PI * 2;
    const dist = 0.8 + rng.next() * radius;
    const p = { x: center.x + Math.cos(ang) * dist, z: center.z + Math.sin(ang) * dist };
    if (!ctx.collision.isBlocked(p, 0.45)) return p;
  }
  return { ...center };
}

function walkableOr(ctx: SimContext, p: Vec2, fallback: Vec2): Vec2 {
  return ctx.collision.isBlocked(p, 0.45) ? { ...fallback } : p;
}

/** Axis facing (0, π/2, π, 3π/2) whose `halfLen` ends are clear: lines a bus/truck up with the street. */
function axisFacing(ctx: SimContext, pos: Vec2, halfLen: number, rng: Rng): number {
  const base = Math.floor(rng.next() * 4);
  for (let i = 0; i < 4; i++) {
    const f = ((base + i) % 4) * (Math.PI / 2);
    const fx = Math.sin(f) * halfLen, fz = Math.cos(f) * halfLen;
    if (!ctx.collision.isBlocked({ x: pos.x + fx, z: pos.z + fz }, 1.0) &&
        !ctx.collision.isBlocked({ x: pos.x - fx, z: pos.z - fz }, 1.0)) return f;
  }
  return base * (Math.PI / 2);
}

/** pos + forward·f + right·r for facing `a` (forward = (sin a, cos a), right = (cos a, −sin a)). */
function offset(pos: Vec2, a: number, f: number, r: number): Vec2 {
  return { x: pos.x + Math.sin(a) * f + Math.cos(a) * r, z: pos.z + Math.cos(a) * f - Math.sin(a) * r };
}

/** Humans the director has in the world right now (live events, released orphans, corpses not yet cleared). */
export function eventHumanCount(state: GameState): number {
  return memories.get(state)?.owned.size ?? 0;
}

function spawnHuman(
  ctx: SimContext, ev: ActiveDynamicEvent, role: 'civilian' | 'police', post: 'street' | 'patrol',
  at: Vec2, waypoints: Vec2[], rng: Rng,
): GuardAgent | null {
  const state = ctx.state;
  if (state.guards.length >= BALANCE.population.maxHumans) return null;
  if (eventHumanCount(state) >= BALANCE.city.eventMaxHumans) return null;
  const p = walkableOr(ctx, at, ev.pos);
  const g = createGuard(ctx.newId(), {
    role,
    post,
    pos: p,
    facing: rng.next() * Math.PI * 2,
    tower: null,
    waypoints: waypoints.length > 0 ? waypoints.map(w => walkableOr(ctx, w, p)) : [p],
    strongholdId: null,
  }, ctx.collision);
  state.guards.push(g);
  ev.participantGuardIds.push(g.id);
  memory(state).owned.add(g.id);
  return g;
}

function spawnAmbient(ctx: SimContext, ev: ActiveDynamicEvent, at: Vec2, rng: Rng): void {
  const state = ctx.state;
  if (state.zombies.length >= BALANCE.population.maxAmbient + BALANCE.openWorld.maxFollowers + 20) return;
  const p = walkableOr(ctx, at, ev.pos);
  const z = createZombie(ctx.newId(), p, {
    state: 'ambient',
    variant: Math.floor(rng.next() * 6),
    spawnZone: -1,
    isConverted: false,
    rng,
  });
  state.zombies.push(z);
  ev.participantZombieIds.push(z.id);
}

function prop(kind: CityEventPropKind, pos: Vec2, facing: number): CityEventProp {
  return { kind, pos: { x: pos.x, z: pos.z }, facing };
}

/** Per-kind staging: dressing, who is there at t=0, who arrives later. */
function stageEvent(ctx: SimContext, ev: ActiveDynamicEvent, rng: Rng): void {
  const pos = ev.pos;
  const civ = (at: Vec2, wps: Vec2[] = []) => spawnHuman(ctx, ev, 'civilian', 'street', at, wps, rng);
  const cop = (at: Vec2, wps: Vec2[] = []) => spawnHuman(ctx, ev, 'police', 'patrol', at, wps, rng);
  switch (ev.kind) {
    case 'tourist_bus': {
      const f = axisFacing(ctx, pos, 4.5, rng);
      ev.props.push(prop('bus', pos, f));
      ev.pendingSpawns = 6; // they step off one by one (tickEvent)
      ev.nextSpawnAt = ctx.state.time + 1.2;
      break;
    }
    case 'beach_volleyball': {
      const f = axisFacing(ctx, pos, 3, rng);
      ev.props.push(prop('volleyNet', pos, f));
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const lat = (i - 1) * 2.2;
          const a = offset(pos, f, side * 3.2, lat), b = offset(pos, f, side * 4.6, lat + 0.8);
          civ(a, [a, b]); // shuffle back and forth on their own side
        }
      }
      break;
    }
    case 'food_truck_crowd': {
      const f = axisFacing(ctx, pos, 3, rng);
      ev.props.push(prop('foodTruck', pos, f));
      for (let i = 0; i < 5; i++) {
        const spot = offset(pos, f, -1.5 + i * 0.95, 2.6 + (i % 2) * 0.3); // a queue along the serving hatch
        civ(spot, [spot]);
      }
      break;
    }
    case 'street_festival': {
      const f = axisFacing(ctx, pos, 2.5, rng);
      ev.props.push(prop('stage', offset(pos, f, 3.5, 0), f + Math.PI), prop('partyLights', pos, f));
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        const at = { x: pos.x + Math.cos(ang) * (2.5 + (i % 3)), z: pos.z + Math.sin(ang) * (2.5 + (i % 3)) };
        civ(at, [at, jitterWalkable(ctx, at, 1.5, rng)]); // dancing in place
      }
      break;
    }
    case 'police_patrol': {
      const loop = [0, 1, 2, 3].map(i => jitterWalkable(ctx, offset(pos, i * Math.PI / 2, 9, 0), 2, rng));
      cop(jitterWalkable(ctx, pos, 2, rng), loop);
      cop(jitterWalkable(ctx, pos, 2, rng), [...loop].reverse());
      break;
    }
    case 'supply_convoy': {
      const f = axisFacing(ctx, pos, 3.5, rng);
      ev.props.push(prop('convoyTruck', pos, f));
      for (let i = 0; i < 3; i++) {
        const at = offset(pos, f, (i - 1) * 3, 2.6);
        cop(at, [at, offset(pos, f, (i - 1) * 3, -2.6)]); // escorts pacing round the truck
      }
      civ(offset(pos, f, 3.6, 0)); // the driver
      break;
    }
    case 'zombie_in_trouble': {
      spawnAmbient(ctx, ev, pos, rng);
      const a = offset(pos, rng.next() * Math.PI * 2, 6, 0);
      cop(a, [a, jitterWalkable(ctx, pos, 3, rng)]);
      const c = jitterWalkable(ctx, pos, 5, rng);
      civ(c, [c]);
      break;
    }
    case 'car_accident': {
      const f = rng.next() * Math.PI * 2;
      ev.props.push(prop('wreck', offset(pos, f, 1.6, 0), f + 0.5), prop('wreck', offset(pos, f, -1.6, 0.6), f + 2.3));
      for (let i = 0; i < 3; i++) {
        const at = jitterWalkable(ctx, pos, 5, rng);
        civ(at, [at]); // gawkers
      }
      break;
    }
    case 'rival_zombie_pack':
      for (let i = 0; i < 5; i++) spawnAmbient(ctx, ev, jitterWalkable(ctx, pos, 4, rng), rng);
      break;
    case 'zombie_block_party': {
      ev.props.push(prop('partyLights', pos, 0));
      for (let i = 0; i < 6; i++) spawnAmbient(ctx, ev, jitterWalkable(ctx, pos, 3.5, rng), rng);
      break;
    }
    case 'survivor_raid': {
      const f = rng.next() * Math.PI * 2;
      ev.props.push(prop('barricade', offset(pos, f, 2.5, 0), f));
      for (let i = 0; i < 3; i++) {
        const at = offset(pos, f, 0.5, (i - 1) * 1.8);
        cop(at, [at, jitterWalkable(ctx, at, 4, rng)]);
      }
      civ(offset(pos, f, -1.5, 0));
      break;
    }
  }
}

export function spawnCityEvent(ctx: SimContext, kind: DynamicEventKind, customPos?: Vec2): ActiveDynamicEvent | null {
  const def = DYNAMIC_EVENT_BY_ID[kind];
  if (!def) return null;
  const m = memory(ctx.state);
  const districtId = customPos ? getDistrictAt(ctx.layout, customPos) : getDistrictAt(ctx.layout, ctx.state.leader.pos);
  const pos = customPos ? { ...customPos } : pickSpawnPoint(ctx, districtId, kind, m.rng);
  if (!pos) return null;

  const ev: ActiveDynamicEvent = {
    id: `evt_${m.nextEventSeq++}_${kind}`,
    kind,
    districtId,
    pos,
    startedAt: ctx.state.time,
    expiresAt: ctx.state.time + def.durationSeconds,
    participantGuardIds: [],
    participantZombieIds: [],
    resolved: false,
    props: [],
    pendingSpawns: 0,
    nextSpawnAt: 0,
    escalated: false,
    disturbed: false,
  };
  stageEvent(ctx, ev, m.rng);
  if (ev.participantGuardIds.length === 0 && ev.participantZombieIds.length === 0 && ev.pendingSpawns === 0) {
    m.nextEventSeq--;
    return null;
  }

  ctx.state.cityEvents.push(ev);
  m.cooldowns.set(kind, ctx.state.time + def.cooldownSeconds);
  m.lastKind = kind;
  m.history.push({ kind, pos: { ...pos } });
  if (m.history.length > 8) m.history.shift();
  ctx.emit({ type: 'cityEventStarted', eventId: ev.id, kind, districtId, pos: { ...pos }, label: def.label });
  return ev;
}

/** Police walk in from `responderArriveDist` away, on the side away from the Alpha when possible. */
function callResponders(ctx: SimContext, ev: ActiveDynamicEvent, count: number, rng: Rng): void {
  if (ev.escalated) return;
  ev.escalated = true;
  const active = ctx.state.guards.filter(g => !g.dormant && g.role === 'police' && g.post === 'patrol' && g.hp > 0).length;
  const n = Math.max(0, Math.min(count, BALANCE.city.policeMaxExtraActive - active));
  if (n === 0) return;
  const lp = ctx.state.leader.pos;
  const away = Math.atan2(ev.pos.x - lp.x, ev.pos.z - lp.z);
  let spawned = 0;
  for (let i = 0; i < 6 && spawned < n; i++) {
    const a = away + (i - 2.5) * 0.5;
    const from = offset(ev.pos, a, BALANCE.city.responderArriveDist, 0);
    if (ctx.collision.isBlocked(from, 0.6)) continue;
    if (spawnHuman(ctx, ev, 'police', 'patrol', from, [jitterWalkable(ctx, ev.pos, 3, rng), jitterWalkable(ctx, ev.pos, 5, rng)], rng)) spawned++;
  }
  if (spawned > 0) {
    ctx.emit({ type: 'cityEventEscalated', eventId: ev.id, kind: ev.kind, pos: { ...ev.pos } });
    addHeat(ctx, ev.pos, 6);
  }
}

function isLiving(g: GuardAgent | undefined): boolean {
  return !!g && g.hp > 0 && g.state !== 'DEAD';
}

/** Arrivals, disturbance detection and responder calls for one live event. */
function tickEvent(ctx: SimContext, ev: ActiveDynamicEvent, guardById: Map<EntityId, GuardAgent>, rng: Rng): void {
  const state = ctx.state;
  // Tourists step off the bus one at a time and drift around the stop.
  if (ev.pendingSpawns > 0 && state.time >= ev.nextSpawnAt) {
    const busProp = ev.props.find(p => p.kind === 'bus');
    const door = busProp ? offset(busProp.pos, busProp.facing, 1.5, 1.9) : ev.pos;
    const g = spawnHuman(ctx, ev, 'civilian', 'street', door, [jitterWalkable(ctx, door, 4, rng), jitterWalkable(ctx, door, 6, rng)], rng);
    ev.pendingSpawns = g ? ev.pendingSpawns - 1 : 0;
    ev.nextSpawnAt = state.time + BALANCE.city.busUnloadInterval;
    if (g) guardById.set(g.id, g);
  }

  if (!ev.disturbed) {
    for (const id of ev.participantGuardIds) {
      const g = guardById.get(id);
      if (!isLiving(g) || g!.state !== 'PATROL') { ev.disturbed = true; break; }
    }
    if (!ev.disturbed) {
      for (const id of ev.participantZombieIds) {
        const z = state.zombies.find(zz => zz.id === id);
        if (!z || z.state !== 'ambient') { ev.disturbed = true; break; }
      }
    }
    if (ev.disturbed) memory(state).disturbedAt.set(ev.id, state.time);
  }

  if (ev.escalated) return;
  if (ev.kind === 'car_accident' && state.time - ev.startedAt >= BALANCE.city.accidentPoliceDelay) {
    callResponders(ctx, ev, 1, rng);
  } else if (ev.disturbed && (ev.kind === 'street_festival' || ev.kind === 'food_truck_crowd' || ev.kind === 'tourist_bus' ||
             ev.kind === 'beach_volleyball')) {
    const at = memory(state).disturbedAt.get(ev.id) ?? state.time;
    if (state.time - at >= BALANCE.city.disturbedPoliceDelay && state.followerCount > 0) {
      callResponders(ctx, ev, ev.kind === 'street_festival' ? 3 : 2, rng);
    }
  }
}

/** Completed when the horde broke it up (most humans down, or the zombies all taken in). */
function isCompleted(ctx: SimContext, ev: ActiveDynamicEvent, guardById: Map<EntityId, GuardAgent>): boolean {
  if (ev.pendingSpawns > 0) return false;
  const zombies = ctx.state.zombies;
  const zState = (id: EntityId) => zombies.find(z => z.id === id);
  if (ev.kind === 'zombie_in_trouble') {
    const trouble = zState(ev.participantZombieIds[0]);
    if (trouble && (trouble.state === 'follower' || trouble.state === 'rising')) return true; // rescued
  }
  const total = ev.participantGuardIds.length;
  if (total > 0) {
    let down = 0;
    for (const id of ev.participantGuardIds) if (!isLiving(guardById.get(id))) down++;
    // Responders count too; breaking up 60 % of everyone there completes it.
    if (down / total >= 0.6) return true;
    return false;
  }
  if (ev.participantZombieIds.length > 0) {
    for (const id of ev.participantZombieIds) {
      const z = zState(id);
      if (z && z.hp > 0 && z.state === 'ambient') return false;
    }
    return true;
  }
  return false;
}

function resolveEvent(ctx: SimContext, ev: ActiveDynamicEvent, outcome: 'completed' | 'expired'): void {
  if (ev.resolved) return;
  ev.resolved = true;
  const m = memory(ctx.state);
  m.disturbedAt.delete(ev.id);
  if (outcome === 'completed') {
    const def = DYNAMIC_EVENT_BY_ID[ev.kind];
    addBrains(ctx, def.brainsReward, `event:${ev.kind}`, ev.pos);
    if (ev.kind === 'supply_convoy') {
      const leader = ctx.state.leader;
      const d2 = (leader.pos.x - ev.pos.x) ** 2 + (leader.pos.z - ev.pos.z) ** 2;
      if (leader.alive && d2 <= 40 * 40 && ctx.state.horde.coreDamage > 0.01) {
        const heal = restoreStrength(ctx, BALANCE.city.convoySupplyHeal * BALANCE.hordeHealth.alphaDamageMultiplier / BALANCE.hordeHealth.unitHp, 'heal');
        ctx.emit({ type: 'suppliesLooted', pos: { ...ev.pos }, heal });
      }
    }
  }
  // Survivors stay in the world as ordinary street people until they are out of sight.
  for (const id of ev.participantGuardIds) m.orphanGuards.add(id);
  for (const id of ev.participantZombieIds) m.orphanZombies.add(id);
  ctx.emit({ type: 'cityEventResolved', eventId: ev.id, kind: ev.kind, outcome, pos: { ...ev.pos } });
}

/** Forget ids no longer in state.guards (converted, corpse cleared, culled elsewhere). */
function pruneOwned(state: GameState, m: DirectorMemory): void {
  if (m.owned.size === 0 && m.orphanGuards.size === 0) return;
  const live = new Set<EntityId>();
  for (const g of state.guards) live.add(g.id);
  for (const id of m.owned) if (!live.has(id)) m.owned.delete(id);
  for (const id of m.orphanGuards) if (!live.has(id)) m.orphanGuards.delete(id);
}

/** Remove released participants once they are out of sight and not fighting (never in view). */
function sweepOrphans(ctx: SimContext, m: DirectorMemory): void {
  if (m.orphanGuards.size === 0 && m.orphanZombies.size === 0) { pruneOwned(ctx.state, m); return; }
  const state = ctx.state;
  const lp = state.leader.pos;
  const far2 = (visibleLimit(state) + 10) ** 2;
  if (m.orphanGuards.size > 0) {
    let write = 0;
    for (const g of state.guards) {
      if (m.orphanGuards.has(g.id)) {
        const d2 = (g.pos.x - lp.x) ** 2 + (g.pos.z - lp.z) ** 2;
        const dead = g.hp <= 0 || g.state === 'DEAD';
        if (dead) { m.orphanGuards.delete(g.id); state.guards[write++] = g; continue; } // corpses follow normal rules
        if (d2 > far2 && g.state !== 'COMBAT') { m.orphanGuards.delete(g.id); continue; }
      }
      state.guards[write++] = g;
    }
    state.guards.length = write;
  }
  pruneOwned(state, m);
  if (m.orphanZombies.size > 0) {
    let write = 0;
    for (const z of state.zombies) {
      if (m.orphanZombies.has(z.id)) {
        if (z.state !== 'ambient') { m.orphanZombies.delete(z.id); state.zombies[write++] = z; continue; }
        const d2 = (z.pos.x - lp.x) ** 2 + (z.pos.z - lp.z) ** 2;
        if (d2 > far2) { m.orphanZombies.delete(z.id); continue; }
      }
      state.zombies[write++] = z;
    }
    state.zombies.length = write;
  }
}

export function updateCityDirector(ctx: SimContext, dt: number, stepEvents: readonly GameEvent[]): void {
  if (ctx.layout.strongholds.length === 0) return;
  const state = ctx.state;
  const m = memory(state);

  // 1. Feed world signals into district heat
  for (const ev of stepEvents) {
    switch (ev.type) {
      case 'shot':
        addHeat(ctx, { x: ev.from.x, z: ev.from.z }, BALANCE.city.heatOnShot);
        break;
      case 'guardDied':
        addHeat(ctx, ev.pos, ev.role === 'civilian' ? 4 : BALANCE.city.heatOnGuardKill);
        break;
      case 'converted':
        addHeat(ctx, ev.pos, BALANCE.city.heatOnConversion);
        break;
      case 'vehicleCrash':
        addHeat(ctx, ev.pos, BALANCE.city.heatOnVehicleCrash);
        break;
      case 'worldInteractable':
        addHeat(ctx, ev.pos, BALANCE.city.heatOnInteractable);
        break;
      case 'strongholdContested': {
        const sh = ctx.layout.strongholds.find(s => s.id === ev.strongholdId);
        if (sh) addHeat(ctx, sh.center, 25);
        break;
      }
      default:
        break;
    }
  }

  // 2. Decay heat & sync alert/control state on every district
  for (const d of Object.values(state.districts)) {
    const captured = d.strongholdCaptured || d.status === 'infected';
    const prev = d.alert ?? 'normal';
    const prevControl = d.control ?? 'humanControlled';
    const nextHeat = captured ? BALANCE.city.heatMax : Math.max(0, (d.heat ?? 0) - BALANCE.city.heatDecayPerSecond * dt);
    d.heat = nextHeat;
    const nextAlert = alertFromHeat(nextHeat, captured);
    d.alert = nextAlert;
    d.control = controlFromDistrict(d.status, d.strongholdCaptured, d.infection);
    if (prev !== nextAlert) {
      ctx.emit({ type: 'districtAlertChanged', districtId: d.id, alert: nextAlert, prev });
    }
    if (prevControl !== d.control && d.control === 'zombieControlled') {
      // Captured: fresh post-conquest pool right away.
      m.cooldowns.delete('zombie_block_party');
    }
  }

  // 3. Update active dynamic events (arrivals / escalation / completion / expiration)
  const lp = state.leader.pos;
  const range = spawnRange(state);
  const despawn2 = range.despawn ** 2;
  const guardById = new Map<EntityId, GuardAgent>();
  if (state.cityEvents.length > 0) for (const g of state.guards) guardById.set(g.id, g);
  for (const ev of state.cityEvents) {
    if (ev.resolved) continue;
    const d2 = (ev.pos.x - lp.x) ** 2 + (ev.pos.z - lp.z) ** 2;
    if (d2 > despawn2 || state.time >= ev.expiresAt) {
      resolveEvent(ctx, ev, 'expired');
      continue;
    }
    tickEvent(ctx, ev, guardById, m.rng);
    if (isCompleted(ctx, ev, guardById)) resolveEvent(ctx, ev, 'completed');
  }
  state.cityEvents = state.cityEvents.filter(e => !e.resolved);
  m.sweepTimer -= dt;
  if (m.sweepTimer <= 0) { m.sweepTimer = 0.5; sweepOrphans(ctx, m); }

  // 4. Periodic scheduling of new events + capped local police response
  if (state.phase !== 'playing') return;
  m.checkTimer -= dt;
  if (m.checkTimer > 0) return;
  m.checkTimer = BALANCE.city.eventCheckInterval;

  const curDistrictId = getDistrictAt(ctx.layout, lp);
  const curDistrict = state.districts[curDistrictId];
  const meta = districtMeta(curDistrictId);

  // Suppress ambient distractions if the player is actively assaulting a contested stronghold nearby
  const inStrongholdCombat = state.strongholds.some(s => {
    if (!s.contested || s.captured) return false;
    const def = ctx.layout.strongholds.find(d => d.id === s.id);
    if (!def) return false;
    const dx = def.center.x - lp.x;
    const dz = def.center.z - lp.z;
    return dx * dx + dz * dz < 48 * 48;
  });
  if (inStrongholdCombat) return;

  // Local police response on panic/lockdown (capped, never endless, and never piles on a solo pre-horde Alpha)
  const alert = curDistrict.alert ?? 'normal';
  const control = curDistrict.control ?? 'humanControlled';
  if (state.followerCount > 0 && (alert === 'panic' || alert === 'lockdown') && state.time - m.policeDispatchAt >= BALANCE.city.policeDispatchCooldown) {
    const activePolice = state.guards.filter(g => !g.dormant && g.role === 'police' && g.post === 'patrol' && g.hp > 0).length;
    if (activePolice < BALANCE.city.policeMaxExtraActive) {
      if (spawnCityEvent(ctx, 'police_patrol')) {
        m.policeDispatchAt = state.time;
      }
    }
  }

  if (state.cityEvents.length >= BALANCE.city.eventMaxConcurrent) return;

  const allowArmedEvents = state.claimedNests.length > 0 || state.followerCount > 0;
  const armed = (k: DynamicEventKind) => k === 'police_patrol' || k === 'supply_convoy' || k === 'car_accident' ||
    k === 'zombie_in_trouble' || k === 'survivor_raid';
  const eligible = DYNAMIC_EVENTS.filter(def => {
    if (!allowArmedEvents && armed(def.id)) return false;
    if (!def.allowedDistrictTags.includes(meta.archetype)) return false;
    if (def.allowedAlertLevels && !def.allowedAlertLevels.includes(alert)) return false;
    if (def.allowedControl && !def.allowedControl.includes(control)) return false;
    const cd = m.cooldowns.get(def.id) ?? -Infinity;
    if (state.time < cd) return false;
    const activeOfKind = state.cityEvents.filter(e => e.kind === def.id).length;
    return activeOfKind < def.maxConcurrent;
  });
  // Never the same kind twice in a row while another kind is available.
  const pool = eligible.length > 1 ? eligible.filter(e => e.id !== m.lastKind) : eligible;
  if (pool.length === 0) return;
  let totalWeight = 0;
  for (const e of pool) totalWeight += e.weight;
  let roll = m.rng.next() * totalWeight;
  for (const e of pool) {
    roll -= e.weight;
    if (roll <= 0) {
      spawnCityEvent(ctx, e.id);
      break;
    }
  }
}
