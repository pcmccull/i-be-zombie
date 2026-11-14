import { BALANCE } from '../config/balance';
import type { SegmentOptions, SimContext, SquadGuidance } from '../core/contracts';
import type { AABB, AnimAction, Collider, GameState, GuardAgent, SimInput, TargetRef, Vec2, ZombieAgent } from '../core/types';
import { distSq, wrapAngle } from '../utils/math';
import { isCrawlable } from '../world/CollisionWorld';
import { isTargetAlive, resolveTargetPos } from './CombatSystem';
import { hordeGrid, nearestReachableGuard } from './NavigationSystem';
import { addMomentum, recruitRadiusMultiplier, speedMultiplier } from './MomentumSystem';
import { findStructure, isReleaseBurst } from './StructureSystem';

interface Recovery { x: number; z: number; nudgeLeft: number; nx: number; nz: number }
interface Scratch {
  byId: Map<number, ZombieAgent>; neighbors: number[];
  access: Map<number, SegmentOptions>; structureAccess: Map<number, SegmentOptions>; gateAccess: SegmentOptions; recallGrace: number;
  structureGoals: Map<number, Vec2[]>;
  climbers: Map<number, number>; groupCounts: Map<number, number>; colliders: Collider[];
  /** Pulse candidates (eligible + clear line) and their squared distances; reused every pulse. */
  candidates: ZombieAgent[]; candidateDist: number[];
}
interface Group { id: number; target: TargetRef }
const recoveries = new WeakMap<ZombieAgent, Recovery>();
const releasedWalks = new WeakMap<ZombieAgent, { target: Vec2; path: Vec2[]; index: number }>();
const scratches = new WeakMap<SimContext, Scratch>();
const direction: Vec2 = { x: 0, z: 0 };
const goal: Vec2 = { x: 0, z: 0 };
const targetPos: Vec2 = { x: 0, z: 0 };
const groupPos: Vec2 = { x: 0, z: 0 };
const probe: AABB = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
const moveAccess: SegmentOptions = { mode: 'move' };
const mainGuidance: SquadGuidance = { attackField: null, effectiveTarget: null };
const groupsScratch: Group[] = [];

function sameTarget(a: TargetRef | null, b: TargetRef | null): boolean {
  return !!a && !!b && a.kind === b.kind && (!('id' in a) || ('id' in b && a.id === b.id));
}

export function countFollowers(state: GameState): number {
  let count = 0;
  for (const z of state.zombies) if (z.state === 'follower') count++;
  return count;
}

export function recruitZombie(ctx: SimContext, z: ZombieAgent, viaRally: boolean): boolean {
  if (z.state !== 'ambient' || z.hp <= 0) return false;
  return recruitWithReservation(ctx, z, viaRally, countRising(ctx.state));
}

function countRising(state: GameState): number {
  let rising = 0;
  for (const z of state.zombies) if (z.state === 'rising') rising++;
  return rising;
}

/** Reservation count is stable during a recruitment pass; followerCount advances per recruit. */
function recruitWithReservation(ctx: SimContext, z: ZombieAgent, viaRally: boolean, rising: number, gen = 0): boolean {
  if (z.state !== 'ambient' || z.hp <= 0 || z.heldBy !== 0) return false;
  if (ctx.state.followerCount + rising >= BALANCE.horde.maxFollowers) {
    if (ctx.state.capReachedFlash <= 0) {
      ctx.state.capReachedFlash = 1.5;
      ctx.emit({ type: 'capReached' });
    }
    return false;
  }
  z.state = 'follower'; z.stateTime = 0; z.wanderTarget = null; z.engageTarget = null;
  ctx.state.followerCount++; ctx.state.stats.recruited++;
  scheduleRecruitPulse(ctx, z, gen);
  if (gen >= 1) ctx.state.stats.cascadeRecruits++;
  ctx.emit({ type: 'recruited', zombieId: z.id, pos: { ...z.pos }, viaRally, generation: gen });
  addMomentum(ctx, 'recruit');
  return true;
}

/** Also used when a converted human finishes rising, never while rising. */
export function scheduleRecruitPulse(ctx: SimContext, z: ZombieAgent, gen = 0): void {
  z.recruitGen = gen; z.recruitFlash = BALANCE.horde.recruitBoostTime;
  z.pulseAt = gen < BALANCE.recruitPulse.maxGeneration
    ? ctx.state.time + BALANCE.recruitPulse.delayMin + ctx.rng.next() *
      (BALANCE.recruitPulse.delayMax - BALANCE.recruitPulse.delayMin) : -1;
}

/** Single death transition shared with P2C; corpses remain until CombatSystem fades them. */
export function killZombie(ctx: SimContext, z: ZombieAgent): void {
  if (z.state === 'dead') return;
  if (z.state === 'follower') { ctx.state.followerCount--; ctx.state.stats.losses++; }
  z.state = 'dead'; z.stateTime = 0; z.hp = 0; z.vel.x = z.vel.z = 0;
  z.engageTarget = null; z.anim = 'dead'; z.animTime = 0;
  z.pulseAt = -1;
  ctx.emit({ type: 'zombieDied', zombieId: z.id, pos: { ...z.pos } });
}

function follow(ctx: SimContext): void {
  const old = ctx.state.order.type === 'attack' ? ctx.state.order.target : null;
  const effective = ctx.nav.effectiveTarget;
  ctx.state.order = { type: 'follow' };
  ctx.state.squads.length = 0;
  for (const z of ctx.state.zombies) {
    if (z.state !== 'follower') continue;
    if (z.squad !== 0 || sameTarget(z.engageTarget, old) || sameTarget(z.engageTarget, effective)) z.engageTarget = null;
    z.squad = 0;
  }
  ctx.emit({ type: 'orderChanged', order: ctx.state.order });
}

/** Selected attack targets: group 0 = `order` target, then each squad. Empty while following. */
function selectedGroups(state: GameState, out: Group[]): Group[] {
  out.length = 0;
  if (state.order.type === 'attack') out.push({ id: 0, target: state.order.target });
  for (const sq of state.squads) out.push(sq);
  return out;
}

/** Attack guidance for the group this follower belongs to, or null while following. */
export function guidanceFor(ctx: SimContext, z: ZombieAgent): SquadGuidance | null {
  if (z.squad === 0) {
    if (ctx.state.order.type !== 'attack') return null;
    mainGuidance.attackField = ctx.nav.attackField; mainGuidance.effectiveTarget = ctx.nav.effectiveTarget;
    return mainGuidance;
  }
  return ctx.nav.squads.get(z.squad) ?? null;
}

function assign(z: ZombieAgent, id: number): void {
  if (z.squad !== id) { z.squad = id; z.engageTarget = null; }
}

/** Full even split: groups take turns claiming their nearest unassigned follower. */
function rebalanceAll(ctx: SimContext): void {
  const groups = selectedGroups(ctx.state, groupsScratch);
  const followers = ctx.state.zombies.filter(z => z.state === 'follower');
  if (groups.length <= 1) { for (const z of followers) assign(z, 0); return; }
  const positions = groups.map(g => {
    const p = { x: ctx.state.leader.pos.x, z: ctx.state.leader.pos.z };
    resolveTargetPos(ctx, g.target, p);
    return p;
  });
  const taken = new Uint8Array(followers.length);
  for (let n = 0, turn = 0; n < followers.length; n++, turn = (turn + 1) % groups.length) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < followers.length; i++) {
      if (taken[i]) continue;
      const d = distSq(followers[i].pos, positions[turn]);
      if (d < bestD) { bestD = d; best = i; }
    }
    taken[best] = 1;
    assign(followers[best], groups[turn].id);
  }
}

/** Per-step upkeep: place new/orphaned followers, and move one zombie when group sizes drift apart. */
function smallestGroup(groups: Group[], counts: Map<number, number>): number {
  let id = groups[0].id, min = Infinity;
  for (const g of groups) { const c = counts.get(g.id)!; if (c < min) { min = c; id = g.id; } }
  return id;
}

function maintainGroups(ctx: SimContext, memory: Scratch): void {
  const state = ctx.state;
  if (!state.squads.length) {
    for (const z of state.zombies) if (z.state === 'follower' && z.squad !== 0) assign(z, 0);
    return;
  }
  const groups = selectedGroups(state, groupsScratch);
  const counts = memory.groupCounts; counts.clear();
  for (const g of groups) counts.set(g.id, 0);
  for (const z of state.zombies) {
    if (z.state !== 'follower') continue;
    const c = counts.get(z.squad);
    if (c !== undefined) counts.set(z.squad, c + 1);
  }
  for (const z of state.zombies) {
    if (z.state !== 'follower' || counts.has(z.squad)) continue;
    const id = smallestGroup(groups, counts);
    assign(z, id); counts.set(id, counts.get(id)! + 1);
  }
  let maxId = groups[0].id, max = -1;
  for (const g of groups) { const c = counts.get(g.id)!; if (c > max) { max = c; maxId = g.id; } }
  const minId = smallestGroup(groups, counts);
  if (max - counts.get(minId)! <= 1) return;
  const target = groups.find(g => g.id === minId)!.target;
  if (!resolveTargetPos(ctx, target, groupPos)) return;
  let move: ZombieAgent | null = null, bestD = Infinity;
  for (const z of state.zombies) {
    if (z.state !== 'follower' || z.squad !== maxId) continue;
    const d = distSq(z.pos, groupPos);
    if (d < bestD) { bestD = d; move = z; }
  }
  if (move) assign(move, minId);
}

/** Promote the first squad into the primary `order` slot (its members become group 0). */
function promoteSquad(ctx: SimContext): boolean {
  const s = ctx.state;
  const next = s.squads.shift();
  if (!next) return false;
  s.order = { type: 'attack', target: next.target };
  for (const z of s.zombies) if (z.state === 'follower') {
    if (z.squad === 0) z.squad = -1; else if (z.squad === next.id) z.squad = 0;
  }
  return true;
}

/** Clicking a target toggles it in/out of the selection; the horde splits evenly across all selected. */
function toggleTarget(ctx: SimContext, target: TargetRef): void {
  const s = ctx.state;
  if (s.order.type === 'attack' && sameTarget(s.order.target, target)) {
    if (!promoteSquad(ctx)) { follow(ctx); return; }
  } else {
    const index = s.squads.findIndex(sq => sameTarget(sq.target, target));
    if (index >= 0) s.squads.splice(index, 1);
    else if (s.order.type === 'follow') s.order = { type: 'attack', target: { ...target } };
    else s.squads.push({ id: ctx.newId(), target: { ...target } });
  }
  rebalanceAll(ctx);
  ctx.emit({ type: 'orderChanged', order: s.order });
}

export function applyHordeCommands(ctx: SimContext, dt: number, input: SimInput): void {
  const s = ctx.state, a = s.abilities;
  const memory = scratch(ctx);
  memory.recallGrace = Math.max(0, memory.recallGrace - dt);
  a.rallyCooldown = Math.max(0, a.rallyCooldown - dt);
  a.rushCooldown = Math.max(0, a.rushCooldown - dt);
  const wasRushing = a.rushTimeLeft > 0;
  a.rushTimeLeft = Math.max(0, a.rushTimeLeft - dt);
  if (a.rushTimeLeft < 1e-9) a.rushTimeLeft = 0;
  if (wasRushing && a.rushTimeLeft === 0) ctx.emit({ type: 'rushEnd' });
  if (input.recall) {
    follow(ctx);
    memory.recallGrace = 2.5;
    for (const z of s.zombies) if (z.state === 'follower') z.engageTarget = null;
  }
  if (!input.recall && s.leader.alive && input.attackTarget &&
      (input.attackTarget.kind === 'guard' || input.attackTarget.kind === 'gate' || input.attackTarget.kind === 'structure') && isTargetAlive(ctx, input.attackTarget)) {
    toggleTarget(ctx, input.attackTarget);
  }
  if (input.rally && a.rallyCooldown <= 1e-9 && s.leader.alive) {
    const rising = countRising(s);
    const radius = BALANCE.rally.radius * recruitRadiusMultiplier(s);
    for (const z of s.zombies) if (z.state === 'ambient' && z.heldBy === 0 &&
        distSq(z.pos, s.leader.pos) <= radius ** 2 && !ctx.collision.segmentBlocked(s.leader.pos, z.pos, moveAccess))
      recruitWithReservation(ctx, z, true, rising);
    ctx.emit({ type: 'rally', pos: { ...s.leader.pos }, radius });
    a.rallyCooldown = BALANCE.rally.cooldown;
  }
  if (input.rush && a.rushCooldown <= 1e-9 && s.leader.alive) {
    a.rushTimeLeft = BALANCE.rush.duration; a.rushCooldown = BALANCE.rush.cooldown;
    ctx.emit({ type: 'rushStart' });
  }
  // Dead targets leave the selection; their zombies are redistributed by maintainGroups.
  let selectionChanged = false;
  for (let i = s.squads.length - 1; i >= 0; i--) {
    const sq = s.squads[i];
    if (!isTargetAlive(ctx, sq.target)) {
      const next = structureSuccessor(ctx, sq.target);
      if (next && !isSelected(s, next)) sq.target = next; else s.squads.splice(i, 1);
      selectionChanged = true;
    }
  }
  if (s.order.type === 'attack' && !isTargetAlive(ctx, s.order.target)) {
    const next = structureSuccessor(ctx, s.order.target);
    // A successor already chased by a squad is left to that squad; promoteSquad below takes over group 0.
    if (next && !isSelected(s, next)) { s.order = { type: 'attack', target: next }; selectionChanged = true; }
  }
  if (s.order.type === 'attack' && !isTargetAlive(ctx, s.order.target) && promoteSquad(ctx)) selectionChanged = true;
  if (selectionChanged) ctx.emit({ type: 'orderChanged', order: s.order });
  if (s.order.type === 'attack' && !isTargetAlive(ctx, s.order.target)) {
    const old = s.order.target;
    // Death invalidates resolveTargetPos, but the target still owns its last position.
    const origin = old.kind === 'gate' ? s.gate.center : old.kind === 'guard'
      ? s.guards.find(g => g.id === old.id)?.pos : undefined;
    const next = origin ? nearestReachableGuard(ctx, origin, 25) : null;
    if (next) {
      s.order = { type: 'attack', target: next };
      ctx.emit({ type: 'orderChanged', order: s.order });
    } else follow(ctx);
  }
  maintainGroups(ctx, memory);
}

function isSelected(state: GameState, target: TargetRef): boolean {
  if (state.order.type === 'attack' && sameTarget(state.order.target, target)) return true;
  for (const sq of state.squads) if (sameTarget(sq.target, target)) return true;
  return false;
}

function structureSuccessor(ctx: SimContext, target: TargetRef): TargetRef | null {
  if (target.kind !== 'structure') return null;
  const s = findStructure(ctx.state, target.id);
  if (!s?.destroyed) return null;
  // Sheltered humans take priority regardless of their distance from the doorway.
  for (let pass = 0; pass < 2; pass++) {
    let best = pass === 0 ? Infinity : (BALANCE.walker.autoEngageRadius * 2) ** 2;
    let next: TargetRef | null = null;
    for (const g of ctx.state.guards) {
      if (g.state === 'DEAD' || g.hp <= 0 || (pass === 0 && g.shelter !== s.id)) continue;
      const d = distSq(g.pos, s.center);
      if (d <= best) { best = d; next = { kind: 'guard', id: g.id }; }
    }
    if (next) return next;
  }
  return null;
}

function animate(z: ZombieAgent, anim: AnimAction): void {
  if ((z.anim === 'attack' || z.anim === 'hit') && z.animTime < 0.35) return;
  if (z.anim !== anim) { z.anim = anim; z.animTime = 0; }
}

function wander(ctx: SimContext, z: ZombieAgent, dt: number): void {
  z.stateTime += dt;
  z.vel.x = z.vel.z = 0;
  const zone = ctx.layout.spawnZones[z.spawnZone];
  if (isReleaseBurst(ctx, z)) return;
  if (!zone && !z.wanderTarget) { animate(z, 'idle'); return; }
  if (z.wanderTimer > 0) {
    z.wanderTimer = Math.max(0, z.wanderTimer - dt); animate(z, 'idle'); return;
  }
  if (!z.wanderTarget) {
    const rect = zone!.rect;
    goal.x = rect.minX + ctx.rng.next() * (rect.maxX - rect.minX);
    goal.z = rect.minZ + ctx.rng.next() * (rect.maxZ - rect.minZ);
    if (ctx.collision.isBlocked(goal, z.radius)) { z.wanderTimer = 1; return; }
    z.wanderTarget = { ...goal };
  }
  if (distSq(z.wanderTarget, z.pos) < 0.2 ** 2 || (zone && z.stateTime > 15)) {
    z.wanderTarget = null; z.wanderTimer = 1 + ctx.rng.next() * 3; z.stateTime = 0;
    releasedWalks.delete(z);
    animate(z, 'idle'); return;
  }
  let toward = z.wanderTarget;
  if (!zone && !ctx.navGrid.hasClearWalk(z.pos, toward)) {
    let walk = releasedWalks.get(z);
    if (!walk || walk.target !== toward) {
      walk = { target: toward, path: ctx.navGrid.findPath(z.pos, toward) ?? [toward], index: 0 };
      releasedWalks.set(z, walk);
    }
    while (walk.index < walk.path.length - 1 && distSq(z.pos, walk.path[walk.index]) < 0.2 ** 2) walk.index++;
    toward = walk.path[walk.index];
  }
  const dx = toward.x - z.pos.x, dz = toward.z - z.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-9) { animate(z, 'idle'); return; }
  const speed = Math.min(BALANCE.walker.ambientSpeed, dt > 0 ? d / dt : 0);
  const x = z.pos.x, pz = z.pos.z;
  ctx.collision.moveCircle(z.pos, dx / d * speed * dt, dz / d * speed * dt, z.radius);
  if (z.heldBy !== 0 && zone) {
    z.pos.x = Math.max(zone.rect.minX, Math.min(zone.rect.maxX, z.pos.x));
    z.pos.z = Math.max(zone.rect.minZ, Math.min(zone.rect.maxZ, z.pos.z));
  }
  z.vel.x = dt > 0 ? (z.pos.x - x) / dt : 0; z.vel.z = dt > 0 ? (z.pos.z - pz) / dt : 0;
  z.facing = Math.atan2(dx, dz); animate(z, 'walk');
}

function scratch(ctx: SimContext): Scratch {
  let s = scratches.get(ctx);
  if (!s) {
    s = { byId: new Map(), neighbors: [], access: new Map(), structureAccess: new Map(), structureGoals: new Map(),
      gateAccess: { mode: 'move', ignoreIds: [ctx.state.gate.colliderId] }, recallGrace: 0,
      climbers: new Map(), groupCounts: new Map(), colliders: [], candidates: [], candidateDist: [] };
    scratches.set(ctx, s);
    for (const g of ctx.state.guards) s.access.set(g.id,
      g.towerColliderId === null ? moveAccess : { mode: 'move', ignoreIds: [g.towerColliderId] });
    for (const structure of ctx.state.structures) s.structureAccess.set(structure.id,
      { mode: 'move', ignoreIds: [structure.colliderId] });
    for (const def of ctx.layout.structures) s.structureGoals.set(def.id, def.approachOutside);
  }
  return s;
}

function selectEngagement(ctx: SimContext, z: ZombieAgent, s: Scratch): void {
  const guidance = guidanceFor(ctx, z);
  if (guidance) {
    z.engageTarget = guidance.effectiveTarget;
    return;
  }
  if (distSq(z.pos, ctx.state.leader.pos) > 20 * 20) { z.engageTarget = null; return; }
  const engageRadius = s.recallGrace > 1e-9 ? 1.8 : BALANCE.walker.autoEngageRadius;
  const retainRadius = s.recallGrace > 1e-9 ? engageRadius : engageRadius * 2;
  if (z.engageTarget && (!resolveTargetPos(ctx, z.engageTarget, targetPos) ||
      distSq(z.pos, targetPos) > retainRadius ** 2 ||
      ctx.collision.segmentBlocked(z.pos, targetPos, z.engageTarget.kind === 'guard'
        ? s.access.get(z.engageTarget.id) ?? moveAccess : moveAccess))) z.engageTarget = null;
  if (z.engageTarget) return;
  let nearest = engageRadius ** 2;
  let id = -1;
  for (const g of ctx.state.guards) {
    if (g.state === 'DEAD' || g.hp <= 0) continue;
    const d = distSq(z.pos, g.pos);
    if (d <= nearest && !ctx.collision.segmentBlocked(z.pos, g.pos, s.access.get(g.id) ?? moveAccess)) {
      nearest = d; id = g.id;
    }
  }
  if (id !== -1) z.engageTarget = { kind: 'guard', id };
}

/** Height of the crawlable obstacle (car roof, barrier) under this zombie's center; 0 on open ground. */
function obstacleHeight(ctx: SimContext, z: ZombieAgent, s: Scratch): number {
  const inset = z.radius * 0.5;
  probe.minX = z.pos.x - inset; probe.maxX = z.pos.x + inset;
  probe.minZ = z.pos.z - inset; probe.maxZ = z.pos.z + inset;
  let height = 0;
  for (const c of ctx.collision.queryAABB(probe, s.colliders)) {
    if (c.blocksMove && isCrawlable(c) && z.pos.x > c.minX - inset && z.pos.x < c.maxX + inset &&
        z.pos.z > c.minZ - inset && z.pos.z < c.maxZ + inset) height = Math.max(height, c.height);
  }
  return height;
}

/** Enough packmates nearby to boost each other over a low obstacle. */
function isGrouped(ctx: SimContext, z: ZombieAgent, s: Scratch): boolean {
  const r = BALANCE.horde.crawlNeighborRadius;
  s.neighbors.length = 0;
  ctx.zombieHash.query(z.pos.x, z.pos.z, r, s.neighbors);
  let count = 0;
  for (const id of s.neighbors) {
    if (id === z.id) continue;
    const other = s.byId.get(id); // byId holds only living zombies
    if (other && distSq(other.pos, z.pos) <= r * r &&
        ++count >= BALANCE.horde.crawlMinNeighbors) return true;
  }
  return false;
}

export function updateHorde(ctx: SimContext, dt: number, _input: SimInput): void {
  const state = ctx.state, leader = state.leader, s = scratch(ctx);
  s.byId.clear(); ctx.zombieHash.clear();
  // Count climbers already on each watchtower (in the same pass) so only a few scale it at once.
  s.climbers.clear();
  for (const z of state.zombies) {
    const st = z.state;
    if (st !== 'follower') z.pulseAt = -1;
    if (st === 'dead') continue;
    ctx.zombieHash.insert(z.id, z.pos.x, z.pos.z); s.byId.set(z.id, z);
    if (st === 'follower' && z.elevation > 0.05 && z.engageTarget?.kind === 'guard') {
      const id = z.engageTarget.id;
      s.climbers.set(id, (s.climbers.get(id) ?? 0) + 1);
    }
  }
  const rising = countRising(state);
  if (leader.alive) {
    const radius = BALANCE.leader.recruitRadius * recruitRadiusMultiplier(state);
    s.neighbors.length = 0;
    ctx.zombieHash.query(leader.pos.x, leader.pos.z, radius, s.neighbors);
    for (const id of s.neighbors) {
      const z = s.byId.get(id)!;
      if (z.state === 'ambient' && z.heldBy === 0 && distSq(z.pos, leader.pos) <= radius ** 2 &&
          !ctx.collision.segmentBlocked(leader.pos, z.pos, moveAccess)) recruitWithReservation(ctx, z, false, rising);
    }
  }
  for (const pulser of state.zombies) {
    if (pulser.pulseAt < 0 || pulser.pulseAt > state.time || pulser.state !== 'follower') continue;
    pulser.pulseAt = -1;
    const radius = BALANCE.recruitPulse.radius * recruitRadiusMultiplier(state);
    s.neighbors.length = 0;
    ctx.zombieHash.query(pulser.pos.x, pulser.pos.z, radius, s.neighbors);
    let recruits = 0;
    // One pass gathers eligible, line-of-sight-clear candidates (segmentBlocked at most once each), then up to
    // maxRecruitsPerPulse selection scans over that short list pick closest-first (ties: lower id). No allocation.
    const cand = s.candidates, dist = s.candidateDist, r2 = radius * radius;
    cand.length = 0; dist.length = 0;
    for (const id of s.neighbors) {
      const z = s.byId.get(id)!;
      if (z.state !== 'ambient' || z.hp <= 0 || z.heldBy !== 0) continue;
      const d = distSq(z.pos, pulser.pos);
      if (d <= r2 && !ctx.collision.segmentBlocked(pulser.pos, z.pos, moveAccess)) { cand.push(z); dist.push(d); }
    }
    while (recruits < BALANCE.recruitPulse.maxRecruitsPerPulse) {
      let best = -1;
      for (let i = 0; i < cand.length; i++) {
        if (dist[i] < 0) continue;
        if (best < 0 || dist[i] < dist[best] || (dist[i] === dist[best] && cand[i].id < cand[best].id)) best = i;
      }
      if (best < 0) break;
      dist[best] = -1; // consumed
      if (!recruitWithReservation(ctx, cand[best], false, rising, pulser.recruitGen + 1)) break;
      recruits++;
    }
    ctx.emit({ type: 'recruitPulse', zombieId: pulser.id, pos: { ...pulser.pos }, radius,
      generation: pulser.recruitGen, recruits });
  }
  const sin = Math.sin(leader.facing), cos = Math.cos(leader.facing);
  const grid = hordeGrid(ctx);
  for (const z of state.zombies) {
    if (z.state === 'ambient') { wander(ctx, z, dt); continue; }
    if (z.state !== 'follower') continue;
    z.stateTime += dt;
    selectEngagement(ctx, z, s);
    const distanceToLeader = Math.sqrt(distSq(z.pos, leader.pos));
    let speed = BALANCE.walker.speed * z.speedScale * speedMultiplier(state) *
      (z.recruitFlash > 0 ? BALANCE.horde.recruitBoostMultiplier : 1) *
      (state.abilities.rushTimeLeft > 0 ? BALANCE.rush.speedMultiplier : 1);
    z.recruitFlash = Math.max(0, z.recruitFlash - dt);
    if (distanceToLeader > BALANCE.walker.catchUpDistance && !z.engageTarget) {
      speed = Math.max(speed * BALANCE.walker.catchUpMultiplier,
        BALANCE.leader.walkSpeed * speedMultiplier(state) * BALANCE.walker.catchUpLeaderMargin);
    }
    // Civilians outrun the horde (whatever momentum/boosts it has) unless it is Rushing (todos #5).
    if (z.engageTarget?.kind === 'guard') {
      const id = z.engageTarget.id;
      let quarry: GuardAgent | undefined;
      for (const g of state.guards) if (g.id === id) { quarry = g; break; }
      if (quarry && quarry.role === 'civilian' && quarry.state === 'RETREAT') {
        const flee = BALANCE.civilian.fleeSpeed;
        speed = state.abilities.rushTimeLeft > 0
          ? Math.max(speed, flee * BALANCE.civilian.rushChaseFactor)
          : Math.min(speed, flee * BALANCE.civilian.chaseSpeedFactor);
      }
    }
    // Crawling: packed followers clamber over cars/barriers (slowly); stragglers path around.
    const onObstacle = obstacleHeight(ctx, z, s) > 0;
    if (onObstacle) speed *= BALANCE.horde.crawlSpeedMultiplier;
    const canCrawl = onObstacle || isGrouped(ctx, z, s);
    const maxSpeed = speed;
    direction.x = direction.z = 0;
    let inRange = false;
    let followLeader = true;
    let climbTop = -1; // platform height while climbing a watchtower
    if (z.engageTarget && resolveTargetPos(ctx, z.engageTarget, targetPos)) {
      followLeader = false;
      goal.x = targetPos.x; goal.z = targetPos.z;
      let reach: number = BALANCE.walker.attackRange;
      let options = moveAccess;
      if (z.engageTarget.kind === 'gate' || z.engageTarget.kind === 'structure') {
        const structure = z.engageTarget.kind === 'structure' ? findStructure(state, z.engageTarget.id)! : null;
        const approaches = structure ? s.structureGoals.get(structure.id)!
          : ctx.layout.checkpoint.gateApproachOutside;
        if (approaches.length) {
          const p = approaches[z.id % approaches.length]; goal.x = p.x; goal.z = p.z;
        }
        const r = structure ? structure.rect : state.gate.rect;
        options = structure ? s.structureAccess.get(structure.id)! : s.gateAccess;
        targetPos.x = Math.max(r.minX, Math.min(r.maxX, z.pos.x));
        targetPos.z = Math.max(r.minZ, Math.min(r.maxZ, z.pos.z));
        inRange = distSq(z.pos, targetPos) <= reach * reach &&
          !ctx.collision.segmentBlocked(z.pos, targetPos, options);
      } else if (z.engageTarget.kind === 'guard') {
        const id = z.engageTarget.id;
        const g = state.guards.find(g => g.id === id)!;
        reach += g.radius + (g.tower ? BALANCE.guard.towerMeleeReachBonus : 0);
        options = s.access.get(g.id) ?? moveAccess;
        if (g.towerColliderId !== null) {
          // An occupant's position is inside its blocking footprint. Steer toward
          // the near edge of the base, including for opportunistic engagements.
          const tower = ctx.collision.colliders[g.towerColliderId];
          goal.x = Math.max(tower.minX - 1, Math.min(tower.maxX + 1, z.pos.x));
          goal.z = Math.max(tower.minZ - 1, Math.min(tower.maxZ + 1, z.pos.z));
        }
        inRange = distSq(z.pos, targetPos) <= reach * reach && !ctx.collision.segmentBlocked(z.pos, targetPos, options);
        if (inRange && g.tower) {
          // At the base: scale the legs. Only zombies on the platform can hit the occupant.
          const climbers = s.climbers.get(g.id) ?? 0;
          if (z.elevation > 0.05 || climbers < BALANCE.guard.towerMaxClimbers) {
            if (z.elevation <= 0.05) s.climbers.set(g.id, climbers + 1);
            climbTop = g.elevation;
            z.elevation = Math.min(g.elevation, z.elevation + BALANCE.guard.towerClimbSpeed * dt);
          }
        }
      }
      if (!inRange) {
        const dx = goal.x - z.pos.x, dz = goal.z - z.pos.z, d = Math.hypot(dx, dz);
        if (grid.hasClearWalk(z.pos, goal) || (d < 4 && !ctx.collision.segmentBlocked(z.pos, goal, options))) {
          if (d > 0) { direction.x = dx / d; direction.z = dz / d; }
        } else {
          const guidance = guidanceFor(ctx, z);
          followLeader = !guidance?.attackField?.sample(z.pos, direction);
        }
      }
    }
    if (followLeader) {
      goal.x = leader.pos.x + cos * z.followOffset.x + sin * z.followOffset.z;
      goal.z = leader.pos.z - sin * z.followOffset.x + cos * z.followOffset.z;
      const dx = goal.x - z.pos.x, dz = goal.z - z.pos.z, d = Math.hypot(dx, dz);
      if (distanceToLeader > BALANCE.horde.regroupDistance && !z.engageTarget) {
        ctx.nav.followField?.sample(z.pos, direction);
      } else if (d < 25 && grid.hasClearWalk(z.pos, goal)) {
        if (d > 0.05) { direction.x = dx / d; direction.z = dz / d; }
        // Continuous arrival avoids an all-or-nothing ring boundary.
        speed *= Math.min(1, Math.max(0, (d - 0.15) / BALANCE.walker.followRingMin));
      } else ctx.nav.followField?.sample(z.pos, direction);
    }
    let vx = direction.x * speed, vz = direction.z * speed;
    const desiredSpeed = Math.hypot(vx, vz);
    s.neighbors.length = 0;
    ctx.zombieHash.query(z.pos.x, z.pos.z, BALANCE.walker.separationRadius, s.neighbors);
    for (const id of s.neighbors) {
      if (id === z.id) continue;
      const other = s.byId.get(id)!;
      let dx = z.pos.x - other.pos.x, dz = z.pos.z - other.pos.z;
      let d = Math.hypot(dx, dz);
      if (d >= BALANCE.walker.separationRadius) continue;
      if (d < 1e-6) {
        // Deterministic opposite impulses also separate exact overlapping spawns.
        dx = z.id < id ? -1 : 1; dz = 0; d = 1e-6;
      } else { dx /= d; dz /= d; }
      const force = BALANCE.walker.separationStrength * (1 - d / BALANCE.walker.separationRadius);
      vx += dx * force; vz += dz * force;
    }
    if (distanceToLeader < BALANCE.walker.separationRadius + leader.radius && distanceToLeader > 1e-6) {
      const force = BALANCE.walker.separationStrength * 0.5 * (1 - distanceToLeader / (BALANCE.walker.separationRadius + leader.radius));
      vx += (z.pos.x - leader.pos.x) / distanceToLeader * force;
      vz += (z.pos.z - leader.pos.z) / distanceToLeader * force;
    }
    let recovery = recoveries.get(z);
    if (!recovery) {
      recovery = { x: z.pos.x, z: z.pos.z, nudgeLeft: 0, nx: 0, nz: 0 }; recoveries.set(z, recovery);
    }
    if (desiredSpeed > 0.5) {
      z.stuckTimer += dt;
      if (z.stuckTimer >= BALANCE.walker.stuckTime) {
        if (Math.hypot(z.pos.x - recovery.x, z.pos.z - recovery.z) < 0.3) {
          const sign = ctx.rng.next() < 0.5 ? -1 : 1;
          recovery.nx = -direction.z * sign; recovery.nz = direction.x * sign; recovery.nudgeLeft = 0.6;
        }
        z.stuckTimer = 0; recovery.x = z.pos.x; recovery.z = z.pos.z;
      }
    } else { z.stuckTimer = 0; recovery.x = z.pos.x; recovery.z = z.pos.z; }
    if (recovery.nudgeLeft > 0) {
      recovery.nudgeLeft -= dt;
      vx = recovery.nx * speed; vz = recovery.nz * speed;
    }
    // Climbers cling to the tower; the crowd below cannot shove them off their handholds.
    if (climbTop >= 0) { vx = vz = 0; recovery.nudgeLeft = 0; z.stuckTimer = 0; }
    const length = Math.hypot(vx, vz);
    // Personal space can redirect movement but cannot exceed the current speed limit.
    if (length > maxSpeed && length > 0) { vx *= maxSpeed / length; vz *= maxSpeed / length; }
    const dx = vx - z.vel.x, dz = vz - z.vel.z, change = Math.hypot(dx, dz);
    const factor = climbTop >= 0 ? 1 : change > 0 ? Math.min(1, 12 * dt / change) : 0;
    z.vel.x += dx * factor; z.vel.z += dz * factor;
    const x = z.pos.x, pz = z.pos.z;
    ctx.collision.moveCircle(z.pos, z.vel.x * dt, z.vel.z * dt, z.radius, canCrawl ? isCrawlable : undefined);
    z.vel.x = dt > 0 ? (z.pos.x - x) / dt : 0; z.vel.z = dt > 0 ? (z.pos.z - pz) / dt : 0;
    if (climbTop < 0) {
      // Off the tower: settle onto whatever low obstacle we're crawling across, or drop to the ground.
      const rest = obstacleHeight(ctx, z, s);
      z.elevation = z.elevation < rest
        ? Math.min(rest, z.elevation + 4 * dt)
        : Math.max(rest, z.elevation - BALANCE.guard.towerFallSpeed * dt);
    }
    const actualSpeed = Math.hypot(z.vel.x, z.vel.z);
    if (inRange) z.facing = Math.atan2(targetPos.x - z.pos.x, targetPos.z - z.pos.z);
    else if (actualSpeed > 0.05) z.facing = wrapAngle(z.facing + wrapAngle(Math.atan2(z.vel.x, z.vel.z) - z.facing) * Math.min(1, 12 * dt));
    if (climbTop >= 0 && z.elevation < climbTop - 1e-6) animate(z, 'climb');
    else animate(z, actualSpeed > 0.1 ? (state.abilities.rushTimeLeft > 0 ? 'run' : 'walk') : 'idle');
  }
}
