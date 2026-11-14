import { BALANCE } from '../config/balance';
import type { SegmentOptions, SimContext } from '../core/contracts';
import type { AnimAction, GameState, SimInput, TargetRef, Vec2, ZombieAgent } from '../core/types';
import { distSq, wrapAngle } from '../utils/math';
import { isTargetAlive, resolveTargetPos } from './CombatSystem';
import { nearestReachableGuard } from './NavigationSystem';

interface Recovery { x: number; z: number; nudgeLeft: number; nx: number; nz: number }
interface Scratch {
  byId: Map<number, ZombieAgent>; neighbors: number[];
  access: Map<number, SegmentOptions>; gateAccess: SegmentOptions; recallGrace: number;
}
const recoveries = new WeakMap<ZombieAgent, Recovery>();
const scratches = new WeakMap<SimContext, Scratch>();
const direction: Vec2 = { x: 0, z: 0 };
const goal: Vec2 = { x: 0, z: 0 };
const targetPos: Vec2 = { x: 0, z: 0 };
const moveAccess: SegmentOptions = { mode: 'move' };

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
function recruitWithReservation(ctx: SimContext, z: ZombieAgent, viaRally: boolean, rising: number): boolean {
  if (z.state !== 'ambient' || z.hp <= 0) return false;
  if (ctx.state.followerCount + rising >= BALANCE.horde.maxFollowers) {
    if (ctx.state.capReachedFlash <= 0) {
      ctx.state.capReachedFlash = 1.5;
      ctx.emit({ type: 'capReached' });
    }
    return false;
  }
  z.state = 'follower'; z.stateTime = 0; z.wanderTarget = null; z.engageTarget = null;
  ctx.state.followerCount++; ctx.state.stats.recruited++;
  ctx.emit({ type: 'recruited', zombieId: z.id, pos: { ...z.pos }, viaRally });
  return true;
}

/** Single death transition shared with P2C; corpses remain until CombatSystem fades them. */
export function killZombie(ctx: SimContext, z: ZombieAgent): void {
  if (z.state === 'dead') return;
  if (z.state === 'follower') { ctx.state.followerCount--; ctx.state.stats.losses++; }
  z.state = 'dead'; z.stateTime = 0; z.hp = 0; z.vel.x = z.vel.z = 0;
  z.engageTarget = null; z.anim = 'dead'; z.animTime = 0;
  ctx.emit({ type: 'zombieDied', zombieId: z.id, pos: { ...z.pos } });
}

function follow(ctx: SimContext): void {
  const old = ctx.state.order.type === 'attack' ? ctx.state.order.target : null;
  const effective = ctx.nav.effectiveTarget;
  ctx.state.order = { type: 'follow' };
  for (const z of ctx.state.zombies) {
    if (z.state === 'follower' && (sameTarget(z.engageTarget, old) || sameTarget(z.engageTarget, effective))) z.engageTarget = null;
  }
  ctx.emit({ type: 'orderChanged', order: ctx.state.order });
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
      (input.attackTarget.kind === 'guard' || input.attackTarget.kind === 'gate') && isTargetAlive(ctx, input.attackTarget)) {
    s.order = { type: 'attack', target: { ...input.attackTarget } };
    ctx.emit({ type: 'orderChanged', order: s.order });
  }
  if (input.rally && a.rallyCooldown <= 1e-9 && s.leader.alive) {
    const rising = countRising(s);
    for (const z of s.zombies) if (distSq(z.pos, s.leader.pos) <= BALANCE.rally.radius ** 2) recruitWithReservation(ctx, z, true, rising);
    ctx.emit({ type: 'rally', pos: { ...s.leader.pos }, radius: BALANCE.rally.radius });
    a.rallyCooldown = BALANCE.rally.cooldown;
  }
  if (input.rush && a.rushCooldown <= 1e-9 && s.leader.alive) {
    a.rushTimeLeft = BALANCE.rush.duration; a.rushCooldown = BALANCE.rush.cooldown;
    ctx.emit({ type: 'rushStart' });
  }
  if (s.order.type === 'attack' && !isTargetAlive(ctx, s.order.target)) {
    const old = s.order.target;
    // Death invalidates resolveTargetPos, but the gate/guard still owns its last position.
    const origin = old.kind === 'gate' ? s.gate.center : old.kind === 'guard'
      ? s.guards.find(g => g.id === old.id)?.pos : undefined;
    const next = origin ? nearestReachableGuard(ctx, origin, 25) : null;
    if (next) {
      s.order = { type: 'attack', target: next };
      ctx.emit({ type: 'orderChanged', order: s.order });
    } else follow(ctx);
  }
}

function animate(z: ZombieAgent, anim: AnimAction): void {
  if ((z.anim === 'attack' || z.anim === 'hit') && z.animTime < 0.35) return;
  if (z.anim !== anim) { z.anim = anim; z.animTime = 0; }
}

function wander(ctx: SimContext, z: ZombieAgent, dt: number): void {
  z.stateTime += dt;
  z.vel.x = z.vel.z = 0;
  const zone = ctx.layout.spawnZones[z.spawnZone];
  if (!zone) { animate(z, 'idle'); return; }
  if (z.wanderTimer > 0) {
    z.wanderTimer = Math.max(0, z.wanderTimer - dt); animate(z, 'idle'); return;
  }
  if (!z.wanderTarget) {
    const rect = zone.rect;
    goal.x = rect.minX + ctx.rng.next() * (rect.maxX - rect.minX);
    goal.z = rect.minZ + ctx.rng.next() * (rect.maxZ - rect.minZ);
    if (ctx.collision.isBlocked(goal, z.radius)) { z.wanderTimer = 1; return; }
    z.wanderTarget = { ...goal };
  }
  const dx = z.wanderTarget.x - z.pos.x, dz = z.wanderTarget.z - z.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.2 || z.stateTime > 15) {
    z.wanderTarget = null; z.wanderTimer = 1 + ctx.rng.next() * 3; z.stateTime = 0;
    animate(z, 'idle'); return;
  }
  const speed = Math.min(BALANCE.walker.ambientSpeed, dt > 0 ? d / dt : 0);
  const x = z.pos.x, pz = z.pos.z;
  ctx.collision.moveCircle(z.pos, dx / d * speed * dt, dz / d * speed * dt, z.radius);
  z.vel.x = dt > 0 ? (z.pos.x - x) / dt : 0; z.vel.z = dt > 0 ? (z.pos.z - pz) / dt : 0;
  z.facing = Math.atan2(dx, dz); animate(z, 'walk');
}

function scratch(ctx: SimContext): Scratch {
  let s = scratches.get(ctx);
  if (!s) {
    s = { byId: new Map(), neighbors: [], access: new Map(),
      gateAccess: { mode: 'move', ignoreIds: [ctx.state.gate.colliderId] }, recallGrace: 0 };
    scratches.set(ctx, s);
    for (const g of ctx.state.guards) s.access.set(g.id,
      g.towerColliderId === null ? moveAccess : { mode: 'move', ignoreIds: [g.towerColliderId] });
  }
  return s;
}

function selectEngagement(ctx: SimContext, z: ZombieAgent, s: Scratch): void {
  if (ctx.state.order.type === 'attack') {
    z.engageTarget = ctx.nav.effectiveTarget;
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

export function updateHorde(ctx: SimContext, dt: number, _input: SimInput): void {
  const state = ctx.state, leader = state.leader, s = scratch(ctx);
  s.byId.clear(); ctx.zombieHash.clear();
  for (const z of state.zombies) if (z.state !== 'dead') {
    ctx.zombieHash.insert(z.id, z.pos.x, z.pos.z); s.byId.set(z.id, z);
  }
  if (leader.alive) {
    const rising = countRising(state);
    s.neighbors.length = 0;
    ctx.zombieHash.query(leader.pos.x, leader.pos.z, BALANCE.leader.recruitRadius, s.neighbors);
    for (const id of s.neighbors) {
      const z = s.byId.get(id)!;
      if (distSq(z.pos, leader.pos) <= BALANCE.leader.recruitRadius ** 2) recruitWithReservation(ctx, z, false, rising);
    }
  }
  const sin = Math.sin(leader.facing), cos = Math.cos(leader.facing);
  for (const z of state.zombies) {
    if (z.state === 'ambient') { wander(ctx, z, dt); continue; }
    if (z.state !== 'follower') continue;
    z.stateTime += dt;
    selectEngagement(ctx, z, s);
    const distanceToLeader = Math.sqrt(distSq(z.pos, leader.pos));
    let speed = BALANCE.walker.speed * z.speedScale * (state.abilities.rushTimeLeft > 0 ? BALANCE.rush.speedMultiplier : 1);
    if (distanceToLeader > BALANCE.walker.catchUpDistance && !z.engageTarget) speed *= BALANCE.walker.catchUpMultiplier;
    const maxSpeed = speed;
    direction.x = direction.z = 0;
    let inRange = false;
    let followLeader = true;
    if (z.engageTarget && resolveTargetPos(ctx, z.engageTarget, targetPos)) {
      followLeader = false;
      goal.x = targetPos.x; goal.z = targetPos.z;
      let reach: number = BALANCE.walker.attackRange;
      let options = moveAccess;
      if (z.engageTarget.kind === 'gate') {
        const approaches = ctx.layout.checkpoint.gateApproachOutside;
        if (approaches.length) {
          const p = approaches[z.id % approaches.length]; goal.x = p.x; goal.z = p.z;
        }
        const r = state.gate.rect;
        targetPos.x = Math.max(r.minX, Math.min(r.maxX, z.pos.x));
        targetPos.z = Math.max(r.minZ, Math.min(r.maxZ, z.pos.z));
        inRange = distSq(z.pos, targetPos) <= reach * reach &&
          !ctx.collision.segmentBlocked(z.pos, targetPos, s.gateAccess);
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
      }
      if (!inRange) {
        const dx = goal.x - z.pos.x, dz = goal.z - z.pos.z, d = Math.hypot(dx, dz);
        if (ctx.navGrid.hasClearWalk(z.pos, goal) || (d < 4 && !ctx.collision.segmentBlocked(z.pos, goal, options))) {
          if (d > 0) { direction.x = dx / d; direction.z = dz / d; }
        } else if (state.order.type === 'attack') {
          followLeader = !ctx.nav.attackField?.sample(z.pos, direction);
        } else followLeader = true;
      }
    }
    if (followLeader) {
      goal.x = leader.pos.x + cos * z.followOffset.x + sin * z.followOffset.z;
      goal.z = leader.pos.z - sin * z.followOffset.x + cos * z.followOffset.z;
      const dx = goal.x - z.pos.x, dz = goal.z - z.pos.z, d = Math.hypot(dx, dz);
      if (d < 25 && ctx.navGrid.hasClearWalk(z.pos, goal)) {
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
    const length = Math.hypot(vx, vz);
    // Personal space can redirect movement but cannot exceed the current speed limit.
    if (length > maxSpeed && length > 0) { vx *= maxSpeed / length; vz *= maxSpeed / length; }
    const dx = vx - z.vel.x, dz = vz - z.vel.z, change = Math.hypot(dx, dz);
    const factor = change > 0 ? Math.min(1, 12 * dt / change) : 0;
    z.vel.x += dx * factor; z.vel.z += dz * factor;
    const x = z.pos.x, pz = z.pos.z;
    ctx.collision.moveCircle(z.pos, z.vel.x * dt, z.vel.z * dt, z.radius);
    z.vel.x = dt > 0 ? (z.pos.x - x) / dt : 0; z.vel.z = dt > 0 ? (z.pos.z - pz) / dt : 0;
    const actualSpeed = Math.hypot(z.vel.x, z.vel.z);
    if (inRange) z.facing = Math.atan2(targetPos.x - z.pos.x, targetPos.z - z.pos.z);
    else if (actualSpeed > 0.05) z.facing = wrapAngle(z.facing + wrapAngle(Math.atan2(z.vel.x, z.vel.z) - z.facing) * Math.min(1, 12 * dt));
    animate(z, actualSpeed > 0.1 ? (state.abilities.rushTimeLeft > 0 ? 'run' : 'walk') : 'idle');
  }
}
