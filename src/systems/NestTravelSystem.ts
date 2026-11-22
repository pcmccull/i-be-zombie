// [pure] Nest teleport: at an active nest, V opens the nest map (`nestTravelMenu`); picking another active nest
// (`SimInput.nestTeleport`) sends the Alpha and the whole horde running into the hole. Each zombie stops at the
// hole and dives in (rendered from its distance to `from`); when the timer runs out everyone crawls out of the
// destination nest (the existing nest emerge: Alpha `beginLeaderEmerge`, followers staggered `emergeTimer`).
import { BALANCE } from '../config/balance';
import type { SimContext } from '../core/contracts';
import type { GameState, NestTravel, SimInput, Vec2 } from '../core/types';
import { beginLeaderEmerge, nestEmergePoint } from '../entities/ZombieLeader';
import { revealAround } from './ConquestSystem';
import { isNestActiveIn, nestTeleportSource } from './nests';

const step: Vec2 = { x: 0, z: 0 };

/** True while the party is diving into a nest: the Alpha takes no input and followers neither steer nor fight. */
export function isNestTraveling(state: GameState): boolean {
  return state.nestTravel !== null;
}

/** Start a teleport from the nest the Alpha stands at to `toNestId`. Returns false when not allowed right now. */
export function startNestTravel(ctx: SimContext, toNestId: string): boolean {
  const state = ctx.state;
  const from = nestTeleportSource(state, ctx.layout);
  if (!from || from.id === toNestId) return false;
  const to = ctx.layout.nests.find(n => n.id === toNestId);
  if (!to || !isNestActiveIn(state, to)) return false;
  const l = state.leader;
  l.attackPhase = 'ready'; l.attackTimer = 0; l.comboStep = 0; l.comboWindow = 0;
  l.vel.x = l.vel.z = 0; l.sprinting = false;
  state.order = { type: 'follow' };
  state.squads.length = 0;
  let count = 0;
  for (const z of state.zombies) {
    if (z.state !== 'follower' || z.hp <= 0) continue;
    z.engageTarget = null; z.squad = 0;
    count++;
  }
  state.nestTravel = {
    fromNestId: from.id, toNestId: to.id,
    from: { x: from.pos.x, z: from.pos.z }, to: { x: to.pos.x, z: to.pos.z },
    timer: BALANCE.nest.teleportTime, duration: BALANCE.nest.teleportTime,
  };
  ctx.emit({ type: 'nestTravelStarted', fromNestId: from.id, toNestId: to.id,
    from: { ...state.nestTravel.from }, to: { ...state.nestTravel.to }, count });
  return true;
}

/** Run `p` toward the hole at `hole`; stops on arrival. Returns the remaining distance. */
function runToHole(ctx: SimContext, p: Vec2, vel: Vec2, radius: number, hole: Vec2, speed: number, dt: number,
  collide: boolean): number {
  const dx = hole.x - p.x, dz = hole.z - p.z;
  const d = Math.hypot(dx, dz);
  const stopAt = BALANCE.nest.teleportHoleRadius * 0.5;
  if (d <= stopAt) { vel.x = vel.z = 0; return d; }
  const move = Math.min(d - stopAt, speed * dt);
  step.x = (dx / d) * move; step.z = (dz / d) * move;
  const x = p.x, z = p.z;
  // Within the hole radius the mound itself is no obstacle: step straight in.
  if (collide && d > BALANCE.nest.teleportHoleRadius) ctx.collision.moveCircle(p, step.x, step.z, radius);
  else { p.x += step.x; p.z += step.z; }
  vel.x = dt > 0 ? (p.x - x) / dt : 0;
  vel.z = dt > 0 ? (p.z - z) / dt : 0;
  return Math.hypot(hole.x - p.x, hole.z - p.z);
}

function facingTo(from: Vec2, to: Vec2, fallback: number): number {
  const dx = to.x - from.x, dz = to.z - from.z;
  return dx * dx + dz * dz > 1e-6 ? Math.atan2(dx, dz) : fallback;
}

/** Everyone crawls out of the destination nest. */
function arrive(ctx: SimContext): void {
  const state = ctx.state;
  const travel = state.nestTravel!;
  state.nestTravel = null;
  const dest = travel.to;
  const l = state.leader;
  const p = nestEmergePoint(dest, ctx.collision, ctx.navGrid);
  l.pos.x = l.prevPos.x = p.x;
  l.pos.z = l.prevPos.z = p.z;
  l.vel.x = l.vel.z = 0;
  l.facing = l.prevFacing = facingTo(dest, p, l.facing);
  beginLeaderEmerge(ctx);

  let count = 0;
  const ringMin = BALANCE.walker.followRingMin, ringMax = BALANCE.walker.followRingMax;
  for (const z of state.zombies) {
    if (z.state !== 'follower' || z.hp <= 0) continue;
    let pos: Vec2 | null = null;
    for (let attempt = 0; attempt < 24 && !pos; attempt++) {
      const a = ctx.rng.next() * Math.PI * 2;
      const r = ringMin + ctx.rng.next() * (ringMax - ringMin);
      const c = { x: dest.x + Math.sin(a) * r, z: dest.z + Math.cos(a) * r };
      if (!ctx.collision.isBlocked(c, z.radius) && ctx.navGrid.isWalkable(c)) pos = c;
    }
    if (!pos) { pos = { x: p.x, z: p.z }; ctx.collision.resolveCircle(pos, z.radius); }
    z.pos.x = z.prevPos.x = pos.x;
    z.pos.z = z.prevPos.z = pos.z;
    z.vel.x = z.vel.z = 0;
    z.facing = z.prevFacing = facingTo(dest, pos, z.facing);
    z.engageTarget = null; z.stuckTimer = 0; z.elevation = 0;
    z.emergeTimer = BALANCE.respawn.emergeTime * (1 + BALANCE.respawn.emergeStagger * ctx.rng.next());
    z.anim = 'rise'; z.animTime = 0;
    count++;
  }
  revealAround(state, ctx.layout, dest, BALANCE.discovery.revealRadius);
  ctx.emit({ type: 'nestTravelArrived', nestId: travel.toNestId, pos: { x: dest.x, z: dest.z }, count });
}

/**
 * Open world, living-city block (after horde/combat, so the run to the hole overrides follower steering).
 * Consumes the interact press (returns true) when it opened the nest map: V priority vehicle > shortcut > nest > prop.
 */
export function updateNestTravel(ctx: SimContext, dt: number, input: SimInput, interactFree: boolean): boolean {
  const state = ctx.state;
  let consumed = false;
  if (!state.nestTravel) {
    if (input.nestTeleport) startNestTravel(ctx, input.nestTeleport);
    else if (interactFree && input.interact) {
      const from = nestTeleportSource(state, ctx.layout);
      if (from) { ctx.emit({ type: 'nestTravelMenu', nestId: from.id }); consumed = true; }
    }
  }
  const travel = state.nestTravel;
  if (!travel) return consumed;
  const l = state.leader;
  if (!l.alive || state.phase !== 'playing') { state.nestTravel = null; return consumed; }

  travel.timer = Math.max(0, travel.timer - dt);
  // Everyone must reach the hole with time left to dive; the Alpha leads at sprint speed.
  const runTime = Math.max(0.15, travel.timer - BALANCE.nest.teleportDiveTime);
  const hole = travel.from;
  const ld = Math.hypot(hole.x - l.pos.x, hole.z - l.pos.z);
  const leaderSpeed = Math.max(BALANCE.leader.sprintSpeed, ld / runTime);
  runToHole(ctx, l.pos, l.vel, l.radius, hole, leaderSpeed, dt, true);
  l.facing = facingTo(l.pos, hole, l.facing);
  l.anim = Math.hypot(l.vel.x, l.vel.z) > 0.1 ? 'run' : 'idle';

  const holeR = BALANCE.nest.teleportHoleRadius;
  let allIn = Math.hypot(hole.x - l.pos.x, hole.z - l.pos.z) <= holeR;
  const baseSpeed = BALANCE.walker.speed * BALANCE.nest.teleportGatherSpeed;
  for (const z of state.zombies) {
    if (z.state !== 'follower' || z.hp <= 0) continue;
    z.engageTarget = null;
    if (z.emergeTimer > 1e-9) continue; // still crawling out here: it goes straight back down at the end
    const d = Math.hypot(hole.x - z.pos.x, hole.z - z.pos.z);
    const speed = Math.max(baseSpeed * z.speedScale, d / runTime);
    if (runToHole(ctx, z.pos, z.vel, z.radius, hole, speed, dt, d < 25) > holeR) allIn = false;
    z.facing = facingTo(z.pos, hole, z.facing);
    z.anim = Math.hypot(z.vel.x, z.vel.z) > 0.1 ? 'walk' : 'idle';
  }
  // Everyone reached the hole: arrive once the last one's dive has played (no idle wait underground).
  if (allIn && travel.timer > BALANCE.nest.teleportDiveTime) travel.timer = BALANCE.nest.teleportDiveTime;
  if (travel.timer <= 1e-9) arrive(ctx);
  return consumed;
}

/**
 * Renderer helper: sim time at which an agent at `pos` starts its dive into `travel.from` — once it reached the
 * hole, or now if the dive must start to finish before arrival; `startedAt` (>= 0) is kept. -1 = still running.
 */
export function diveStartTime(travel: NestTravel, pos: Vec2, startedAt: number, time: number): number {
  if (startedAt >= 0) return startedAt;
  const d = Math.hypot(pos.x - travel.from.x, pos.z - travel.from.z);
  return d <= BALANCE.nest.teleportHoleRadius || travel.timer <= BALANCE.nest.teleportDiveTime + 1e-6 ? time : -1;
}

/** 0..1 dive progress for a dive that started at `startedAt` (-1 = not diving). */
export function diveProgress(startedAt: number, time: number): number {
  return startedAt < 0 ? -1 : Math.min(1, Math.max(0, (time - startedAt) / BALANCE.nest.teleportDiveTime));
}
