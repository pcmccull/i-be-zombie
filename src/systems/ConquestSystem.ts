// [pure] Strongholds, territory, local response, nests and fog. OWNER: T009.
import { BALANCE } from '../config/balance';
import type { SimContext } from '../core/contracts';
import type {
  AABB, DistrictId, DistrictLayout, GameState, GuardAgent, ObjectiveDef, StrongholdDef,
  StrongholdId, StrongholdState, TerritoryStatus, Vec2,
} from '../core/types';
import { createGuard } from '../entities/HumanGuard';
import { createZombie } from '../entities/Zombie';
import { getDistrictAt } from '../world/worldQueries';
import { followerCap } from './HordeSystem';
import { addBiomass, unlockAbility } from './ProgressionSystem';
import { findStructure, takeStructureHits } from './StructureSystem';

export interface ObjectiveStatus { id: string; label: string; done: boolean; progress: number }

interface DistrictMetrics { initialHumans: number; initialArmed: number; killed: number }
interface Runtime {
  revealTimer: number;
  metricsTimer: number;
  replenishTimer: number;
  replenishNest: string | null;
  autoNest: string;
  nestChosen: boolean;
  gateHp: number;
  structureHp: Map<number, number>;
  guardHp: Map<number, number>;
  dead: WeakSet<GuardAgent>;
  metrics: Map<DistrictId, DistrictMetrics>;
  quiet: Map<StrongholdId, number>;
}
// Key by state rather than ctx: reset replaces state even if a caller reuses ctx.
const runtimes = new WeakMap<GameState, Runtime>();

function runtime(ctx: SimContext): Runtime {
  let r = runtimes.get(ctx.state);
  if (r) return r;
  const metrics = new Map<DistrictId, DistrictMetrics>();
  for (const d of ctx.layout.districts) metrics.set(d.id, { initialHumans: 0, initialArmed: 0, killed: 0 });
  for (const g of ctx.layout.guards) {
    const m = metrics.get(getDistrictAt(ctx.layout, g.pos))!;
    m.initialHumans++;
    if (g.role !== 'civilian') m.initialArmed++;
  }
  for (const [id, m] of metrics) m.killed = ctx.state.districts[id].infection * m.initialHumans;
  r = {
    revealTimer: 0, metricsTimer: 0, replenishTimer: 0, replenishNest: null,
    autoNest: ctx.state.activeNestId || (ctx.layout.nests.find(n => n.strongholdId === null)?.id ?? ''), nestChosen: false,
    // A first-frame hit differs from a gate restored destroyed from a save.
    gateHp: ctx.state.gate.hitFlash > 0 ? ctx.state.gate.maxHp : ctx.state.gate.hp,
    structureHp: new Map(ctx.state.structures.map(s => [s.id, s.hp])),
    guardHp: new Map(ctx.state.guards.map(g => [g.id, g.hitFlash > 0 ? g.maxHp : g.hp])),
    dead: new WeakSet(), metrics, quiet: new Map(),
  };
  runtimes.set(ctx.state, r);
  return r;
}

function distanceSq(a: Vec2, b: Vec2): number { return (a.x - b.x) ** 2 + (a.z - b.z) ** 2; }
function boundsDistanceSq(p: Vec2, b: AABB): number {
  return Math.max(b.minX - p.x, 0, p.x - b.maxX) ** 2 + Math.max(b.minZ - p.z, 0, p.z - b.maxZ) ** 2;
}
function living(g: GuardAgent): boolean { return g.state !== 'DEAD' && g.hp > 0; }
function setStatus(ctx: SimContext, id: DistrictId, status: TerritoryStatus): void {
  const d = ctx.state.districts[id], prev = d.status;
  if (prev === status) return;
  d.status = status;
  ctx.emit({ type: 'districtStatus', districtId: id, status, prev });
}

export function isNestActive(ctx: SimContext, nestId: string): boolean {
  const nest = ctx.layout.nests.find(n => n.id === nestId);
  return !!nest && (nest.strongholdId === null ||
    ctx.state.strongholds.some(s => s.id === nest.strongholdId && s.captured));
}

/** Reveal cell centers in a circle. Discovering only promotes unknown to human. */
export function revealAround(state: GameState, layout: DistrictLayout, p: Vec2, radius: number): DistrictId[] {
  const newly: DistrictId[] = [], fog = state.discovery, size = fog.cellSize;
  if (!(radius >= 0) || !Number.isFinite(radius) || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return newly;
  const minCol = Math.max(0, Math.ceil((p.x - radius - layout.bounds.minX) / size - 0.5));
  const maxCol = Math.min(fog.cols - 1, Math.floor((p.x + radius - layout.bounds.minX) / size - 0.5));
  const minRow = Math.max(0, Math.ceil((p.z - radius - layout.bounds.minZ) / size - 0.5));
  const maxRow = Math.min(fog.rows - 1, Math.floor((p.z + radius - layout.bounds.minZ) / size - 0.5));
  const cell = { x: 0, z: 0 };
  for (let row = minRow; row <= maxRow; row++) for (let col = minCol; col <= maxCol; col++) {
    cell.x = layout.bounds.minX + (col + 0.5) * size;
    cell.z = layout.bounds.minZ + (row + 0.5) * size;
    if (distanceSq(cell, p) > radius * radius) continue;
    const index = row * fog.cols + col;
    if (!fog.bits[index]) { fog.bits[index] = 1; fog.revealed++; }
    const id = getDistrictAt(layout, cell), d = state.districts[id];
    if (d.discovered) continue;
    d.discovered = true;
    if (d.status === 'unknown') d.status = 'human';
    newly.push(id);
  }
  return newly;
}

function updateDiscovery(ctx: SimContext, r: Runtime, dt: number): void {
  r.revealTimer -= dt;
  if (r.revealTimer > 1e-9 || !ctx.state.leader.alive) return;
  r.revealTimer = 1 / BALANCE.discovery.revealHz;
  const wasUnknown = new Set(ctx.layout.districts.filter(d => ctx.state.districts[d.id].status === 'unknown').map(d => d.id));
  for (const id of revealAround(ctx.state, ctx.layout, ctx.state.leader.pos, BALANCE.discovery.revealRadius)) {
    ctx.emit({ type: 'districtDiscovered', districtId: id });
    if (wasUnknown.has(id)) ctx.emit({ type: 'districtStatus', districtId: id, prev: 'unknown', status: 'human' });
    ctx.emit({ type: 'autosave', reason: 'discover' });
  }
}

function objectiveProgress(ctx: SimContext, sh: StrongholdState, obj: ObjectiveDef): number {
  if (sh.objectivesDone.includes(obj.id)) return 1;
  if (obj.requires?.some(id => !sh.objectivesDone.includes(id))) return 0;
  switch (obj.kind) {
    case 'destroyStructure': {
      const s = findStructure(ctx.state, obj.structureId!);
      return s ? s.destroyed ? 1 : Math.max(0, 1 - s.hp / s.maxHp) : 0;
    }
    case 'destroyGate': return ctx.state.gate.destroyed ? 1 : Math.max(0, 1 - ctx.state.gate.hp / ctx.state.gate.maxHp);
    case 'killDefenders': {
      let total = 0, dead = 0;
      for (const g of ctx.state.guards) if (g.strongholdId === sh.id && g.role !== 'civilian') {
        total++; if (!living(g)) dead++;
      }
      return total === 0 ? 1 : dead / total;
    }
    case 'holdPoint': return Math.min(1, sh.holdProgress / (obj.holdTime ?? 1));
  }
}

export function objectiveStatus(ctx: SimContext, id: StrongholdId): ObjectiveStatus[] {
  const def = ctx.layout.strongholds.find(s => s.id === id), sh = ctx.state.strongholds.find(s => s.id === id);
  return def && sh ? def.objectives.map(obj => ({
    id: obj.id, label: obj.label, done: sh.objectivesDone.includes(obj.id), progress: objectiveProgress(ctx, sh, obj),
  })) : [];
}

function holdPoint(ctx: SimContext, sh: StrongholdState, obj: ObjectiveDef, dt: number): boolean {
  if (!obj.point) { sh.holdProgress = 0; return false; }
  const radiusSq = (obj.radius ?? 0) ** 2;
  let followers = 0;
  for (const z of ctx.state.zombies) if (z.state === 'follower' && z.hp > 0 && !z.dormant &&
    distanceSq(z.pos, obj.point) <= radiusSq) followers++;
  if (followers === 0) { sh.holdProgress = 0; return false; }
  const blocked = ctx.state.guards.some(g => g.strongholdId === sh.id && g.role !== 'civilian' &&
    living(g) && !g.dormant && distanceSq(g.pos, obj.point!) <= radiusSq);
  if (followers >= (obj.minZombies ?? 1) && !blocked) sh.holdProgress += dt;
  else sh.holdProgress = Math.max(0, sh.holdProgress - dt * 2);
  return sh.holdProgress + 1e-9 >= (obj.holdTime ?? 1);
}

function capture(ctx: SimContext, def: StrongholdDef, sh: StrongholdState, r: Runtime): void {
  sh.captured = true; sh.contested = false; sh.holdProgress = 0;
  if (def.unlock) unlockAbility(ctx, def.unlock);
  addBiomass(ctx, def.biomassReward, 'capture');
  const nest = ctx.layout.nests.find(n => n.id === def.nestId);
  if (nest) {
    ctx.emit({ type: 'nestActivated', nestId: nest.id, pos: { ...nest.pos } });
    if (!r.nestChosen) { ctx.state.activeNestId = nest.id; r.autoNest = nest.id; }
  }
  const d = ctx.state.districts[def.districtId];
  d.strongholdCaptured = true; d.infection = 1;
  for (const g of ctx.state.guards) if (g.strongholdId === sh.id && living(g)) {
    g.role = 'civilian'; g.post = 'street'; g.state = 'RETREAT'; g.stateTime = 0;
    g.target = null; g.shelter = 0; g.path.length = 0; g.pathIndex = 0;
    g.attackCooldown = 0; g.staggerTime = 0;
    // Tower occupants climb down: a street civilian must not float on the platform.
    g.tower = null; g.towerColliderId = null; g.elevation = 0;
    // Keep strongholdId so PopulationSystem can exclude these from respawns.
  }
  sh.defenderStrength = 0;
  ctx.emit({ type: 'strongholdCaptured', strongholdId: sh.id, districtId: def.districtId, unlock: def.unlock, biomass: def.biomassReward });
  setStatus(ctx, def.districtId, 'infected');
  ctx.emit({ type: 'autosave', reason: 'capture' });
}

function updateStronghold(ctx: SimContext, def: StrongholdDef, sh: StrongholdState, r: Runtime,
  hitStructures: ReadonlyMap<number, number>, gateHit: boolean, damagedDefenders: ReadonlySet<StrongholdId>, dt: number): void {
  if (sh.captured) return;
  let activity = def.objectives.some(obj => obj.kind === 'destroyGate' ? gateHit :
    obj.kind === 'destroyStructure' ? (hitStructures.get(obj.structureId!) ?? 0) > 0 :
    obj.kind === 'killDefenders' && damagedDefenders.has(sh.id));
  for (const obj of def.objectives) {
    if (sh.objectivesDone.includes(obj.id) || obj.requires?.some(id => !sh.objectivesDone.includes(id))) continue;
    const before = sh.holdProgress;
    const done = obj.kind === 'holdPoint' ? holdPoint(ctx, sh, obj, dt) : objectiveProgress(ctx, sh, obj) === 1;
    if (sh.holdProgress > before) activity = true;
    if (!done) continue;
    sh.objectivesDone.push(obj.id); activity = true;
    if (obj.kind === 'holdPoint') sh.holdProgress = 0;
    ctx.emit({ type: 'objectiveComplete', strongholdId: sh.id, objectiveId: obj.id, label: obj.label });
  }
  let nearby = 0;
  for (const z of ctx.state.zombies) if (z.state === 'follower' && z.hp > 0 && !z.dormant &&
    boundsDistanceSq(z.pos, def.bounds) <= BALANCE.conquest.contestRadius ** 2) nearby++;
  const fighting = ctx.state.guards.some(g => g.strongholdId === sh.id && g.role !== 'civilian' &&
    living(g) && !g.dormant && g.state === 'COMBAT');
  if (activity || nearby >= 6 && fighting) {
    if (!sh.contested) {
      sh.contested = true;
      ctx.emit({ type: 'strongholdContested', strongholdId: sh.id, districtId: def.districtId });
      setStatus(ctx, def.districtId, 'contested');
    }
  }
  // Permanent completed objectives don't keep refreshing the quiet timer.
  const quiet = nearby > 0 || activity ? 0 : (r.quiet.get(sh.id) ?? 0) + dt;
  r.quiet.set(sh.id, quiet);
  if (sh.contested && quiet >= 30) { sh.contested = false; setStatus(ctx, def.districtId, 'human'); }
  if (def.objectives.length > 0 && def.objectives.every(obj => sh.objectivesDone.includes(obj.id))) capture(ctx, def, sh, r);
}

function updateMetrics(ctx: SimContext, r: Runtime): void {
  for (const def of ctx.layout.districts) {
    const d = ctx.state.districts[def.id], m = r.metrics.get(def.id)!;
    let armed = 0;
    for (const g of ctx.state.guards) if (living(g) && g.role !== 'civilian' && getDistrictAt(ctx.layout, g.pos) === def.id) armed++;
    d.humanStrength = m.initialArmed > 0 ? Math.min(1, armed / m.initialArmed) : 0;
    d.infection = d.strongholdCaptured ? 1 : Math.min(1, m.killed / Math.max(1, m.initialHumans));
  }
  for (const sh of ctx.state.strongholds) {
    const initial = ctx.layout.guards.filter(g => g.strongholdId === sh.id && g.role !== 'civilian').length;
    const remaining = ctx.state.guards.filter(g => g.strongholdId === sh.id && g.role !== 'civilian' && living(g)).length;
    sh.defenderStrength = sh.captured || initial === 0 ? 0 : Math.min(1, remaining / initial);
  }
}

function reinforce(ctx: SimContext, def: StrongholdDef, sh: StrongholdState): void {
  const d = ctx.state.districts[def.districtId];
  if (sh.captured || d.strongholdCaptured || d.status === 'infected' || d.alertLevel < BALANCE.conquest.reinforcementAlert ||
    sh.reinforcementsSpent >= BALANCE.conquest.maxReinforcementWaves ||
    ctx.state.time - sh.lastReinforcementAt < BALANCE.conquest.reinforcementCooldown) return;
  let point: Vec2 | undefined, farthest = -1;
  for (const p of def.reinforcementPoints) {
    const dist = distanceSq(p, ctx.state.leader.pos);
    if (dist > farthest && !ctx.collision.isBlocked(p, BALANCE.guard.radius)) { point = p; farthest = dist; }
  }
  if (!point) return;
  const livingHumans = ctx.state.guards.reduce((n, g) => n + (living(g) ? 1 : 0), 0);
  const count = Math.min(BALANCE.conquest.reinforcementSize, BALANCE.population.maxHumans - livingHumans);
  if (count <= 0) return;
  for (let i = 0; i < count; i++) {
    const g = createGuard(ctx.newId(), {
      role: 'police', post: 'patrol', strongholdId: sh.id, pos: point, facing: Math.atan2(def.center.x - point.x, def.center.z - point.z),
      tower: null, waypoints: [point, def.center],
    }, ctx.collision);
    g.dormant = distanceSq(point, ctx.state.leader.pos) > BALANCE.population.activeRadius ** 2;
    ctx.state.guards.push(g);
  }
  sh.reinforcementsSpent++; sh.lastReinforcementAt = ctx.state.time;
  ctx.emit({ type: 'reinforcements', strongholdId: sh.id, districtId: def.districtId, count, pos: { ...point } });
}

/** Free followers use the normal factory, without recruitment rewards or pulses. */
export function spawnNestFollowers(ctx: SimContext, point: Vec2, requested: number): number {
  const s = ctx.state;
  const cap = followerCap(ctx);
  let occupied = s.followerCount;
  for (const z of s.zombies) if (z.state === 'rising') occupied++;
  const count = Math.max(0, Math.min(requested, cap - occupied));
  let spawned = 0;
  for (let i = 0; i < count; i++) {
    let pos: Vec2 | undefined;
    for (let attempt = 0; attempt < 32; attempt++) {
      const angle = ctx.rng.next() * Math.PI * 2;
      const radius = BALANCE.walker.followRingMin + ctx.rng.next() * (BALANCE.walker.followRingMax - BALANCE.walker.followRingMin);
      const p = { x: point.x + Math.sin(angle) * radius, z: point.z + Math.cos(angle) * radius };
      if (ctx.collision.isBlocked(p, BALANCE.walker.radius)) continue;
      if (s.zombies.some(z => z.state === 'follower' && z.hp > 0 && distanceSq(z.pos, p) < (z.radius + BALANCE.walker.radius) ** 2)) continue;
      pos = p; break;
    }
    if (!pos) break;
    const id = ctx.newId();
    s.zombies.push(createZombie(id, pos, { state: 'follower', variant: id % 6, spawnZone: -1, isConverted: false, rng: ctx.rng }));
    s.followerCount++; spawned++;
  }
  return spawned;
}

function replenish(ctx: SimContext, r: Runtime, dt: number): void {
  const s = ctx.state, leader = s.leader;
  const nest = leader.alive && leader.hp > 0 && s.phase === 'playing' && s.followerCount < BALANCE.nest.replenishTarget ?
    ctx.layout.nests.find(n => isNestActive(ctx, n.id) && distanceSq(leader.pos, n.pos) <= BALANCE.nest.replenishRadius ** 2) : undefined;
  if (!nest) { r.replenishTimer = 0; r.replenishNest = null; return; }
  if (r.replenishNest !== nest.id) { r.replenishTimer = 0; r.replenishNest = nest.id; }
  r.replenishTimer += dt;
  if (r.replenishTimer + 1e-9 < BALANCE.nest.replenishInterval) return;
  r.replenishTimer = 0;
  spawnNestFollowers(ctx, nest.pos, 1);
}

export function updateConquest(ctx: SimContext, dt: number): void {
  const s = ctx.state;
  if (s.phase !== 'playing' && s.phase !== 'respawning') return;
  const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0, r = runtime(ctx);
  if (s.activeNestId !== r.autoNest) r.nestChosen = true;
  updateDiscovery(ctx, r, elapsed);
  for (const def of ctx.layout.districts) {
    const d = s.districts[def.id];
    d.alertLevel = Math.max(0, d.alertLevel - elapsed * BALANCE.conquest.alertDecayPerSecond);
  }
  const damagedDefenders = new Set<StrongholdId>();
  for (const g of s.guards) {
    if (g.strongholdId && g.role !== 'civilian' && g.hp < (r.guardHp.get(g.id) ?? g.hp)) damagedDefenders.add(g.strongholdId);
    r.guardHp.set(g.id, g.hp);
    if (living(g) || r.dead.has(g)) continue;
    r.dead.add(g);
    const id = getDistrictAt(ctx.layout, g.pos);
    r.metrics.get(id)!.killed++;
    if (g.role !== 'civilian') {
      if (g.strongholdId) damagedDefenders.add(g.strongholdId);
      s.districts[id].alertLevel = Math.min(1, s.districts[id].alertLevel + BALANCE.conquest.alertPerArmedKill);
    }
  }
  const hits = takeStructureHits(s);
  // The hook retains exact hit counts, including multiple strikes in one step.
  const changed = new Map(hits);
  for (const structure of s.structures) {
    if (structure.hp < (r.structureHp.get(structure.id) ?? structure.hp) && !changed.has(structure.id)) changed.set(structure.id, 1);
    r.structureHp.set(structure.id, structure.hp);
    const count = changed.get(structure.id) ?? 0;
    if (count > 0) {
      const d = s.districts[getDistrictAt(ctx.layout, structure.center)];
      d.alertLevel = Math.min(1, d.alertLevel + count * BALANCE.conquest.alertPerStructureHit);
    }
  }
  const gateHit = s.gate.hp < r.gateHp;
  r.gateHp = s.gate.hp;
  if (gateHit) {
    const d = s.districts[getDistrictAt(ctx.layout, s.gate.center)];
    d.alertLevel = Math.min(1, d.alertLevel + BALANCE.conquest.alertPerStructureHit);
  }
  for (const def of ctx.layout.strongholds) {
    const sh = s.strongholds.find(sh => sh.id === def.id);
    if (sh) updateStronghold(ctx, def, sh, r, changed, gateHit, damagedDefenders, elapsed);
  }
  r.metricsTimer -= elapsed;
  if (r.metricsTimer <= 1e-9) { updateMetrics(ctx, r); r.metricsTimer = 1; }
  for (const def of ctx.layout.strongholds) {
    const sh = s.strongholds.find(sh => sh.id === def.id);
    if (sh) reinforce(ctx, def, sh);
  }
  replenish(ctx, r, elapsed);
}
