import { BALANCE } from '../config/balance';
import type { ICollisionWorld, INavigationGrid, SimContext } from '../core/contracts';
import type { Collider, DistrictLayout, LeaderState, SimInput, Vec2 } from '../core/types';
import { climbHeightAt, isCrawlable } from '../world/CollisionWorld';
import { wrapAngle } from '../utils/math';
import { speedMultiplier } from '../systems/MomentumSystem';
import { aimLeaderAttack, resolveLeaderAttack } from '../systems/CombatSystem';
import { lastBrainSpeedMultiplier } from '../systems/HordeHealthSystem';
import { isEquipped, traitAttackRateMultiplier, traitSpeedMultiplier } from '../systems/ProgressionSystem';

export function createLeader(id: number, layout: DistrictLayout): LeaderState {
  return {
    id, pos: { ...layout.playerStart }, prevPos: { ...layout.playerStart }, vel: { x: 0, z: 0 },
    facing: layout.playerStartFacing, prevFacing: layout.playerStartFacing,
    radius: BALANCE.leader.radius,
    attackCooldown: 0, anim: 'idle', animTime: 0, hitFlash: 0,
    alive: true, stamina: BALANCE.leader.staminaMax, exhausted: false, sprinting: false,
    attackPhase: 'ready', attackTimer: 0, comboStep: 0, comboWindow: 0, hitStun: 0, respawnTimer: 0,
    emergeTimer: 0, elevation: 0,
  };
}

/**
 * Where the Alpha climbs out at a nest: `emergeOffset` m beside the mound (first clear, walkable bearing, starting
 * south = toward the default camera), falling back to the nest's nearest walkable point.
 */
export function nestEmergePoint(nest: Vec2, collision: ICollisionWorld, nav: INavigationGrid): Vec2 {
  const r = BALANCE.respawn.emergeOffset;
  for (let i = 0; i < 12; i++) {
    const a = (i % 2 ? -1 : 1) * Math.ceil(i / 2) * (Math.PI / 6);
    const p = { x: nest.x + Math.sin(a) * r, z: nest.z + Math.cos(a) * r };
    if (!collision.isBlocked(p, BALANCE.leader.radius) && nav.isWalkable(p)) return p;
  }
  return nav.nearestWalkable(nest);
}

/** The Alpha climbs up out of the ground where it stands (start at the last nest / respawn): control locks for emergeTime. */
export function beginLeaderEmerge(ctx: SimContext): void {
  const l = ctx.state.leader;
  if (!l.alive) return;
  l.emergeTimer = BALANCE.respawn.emergeTime;
  l.vel.x = l.vel.z = 0; l.sprinting = false;
  l.attackPhase = 'ready'; l.attackTimer = 0;
  l.anim = 'rise'; l.animTime = 0;
  ctx.emit({ type: 'leaderEmerge', pos: { x: l.pos.x, z: l.pos.z } });
}

export function computeMoveVector(forward: number, right: number, cameraYaw: number, out: Vec2): Vec2 {
  const s = Math.sin(cameraYaw), c = Math.cos(cameraYaw);
  out.x = forward * s - right * c;
  out.z = forward * c + right * s;
  const length = Math.hypot(out.x, out.z);
  if (length > 1) { out.x /= length; out.z /= length; }
  return out;
}

export function updateStamina(leader: LeaderState, wantSprint: boolean, moving: boolean, dt: number): boolean {
  const b = BALANCE.leader;
  if (leader.exhausted && leader.stamina >= b.exhaustedRecoverThreshold) leader.exhausted = false;
  const sprinting = wantSprint && moving && !leader.exhausted && leader.stamina > 0;
  leader.stamina = Math.max(0, Math.min(b.staminaMax,
    leader.stamina + (sprinting ? -b.sprintDrain : b.staminaRecovery) * dt));
  if (leader.stamina <= 1e-9) { leader.stamina = 0; leader.exhausted = true; }
  if (leader.exhausted && leader.stamina >= b.exhaustedRecoverThreshold) leader.exhausted = false;
  leader.sprinting = sprinting;
  return sprinting;
}

const move: Vec2 = { x: 0, z: 0 };
const climbScratch: Collider[] = [];

/** Rise onto / drop off the climbable obstacle under the Alpha (same rates as the horde). */
export function settleLeaderElevation(ctx: SimContext, dt: number): void {
  const l = ctx.state.leader;
  const rest = climbHeightAt(ctx.collision, l.pos, l.radius, climbScratch);
  l.elevation = l.elevation < rest
    ? Math.min(rest, l.elevation + BALANCE.horde.crawlClimbSpeed * dt)
    : Math.max(rest, l.elevation - BALANCE.guard.towerFallSpeed * dt);
}

function advanceAttack(ctx: SimContext, dt: number): void {
  const l = ctx.state.leader;
  let remaining = dt;
  while (l.attackPhase !== 'ready') {
    const elapsed = Math.min(remaining, l.attackTimer);
    l.attackTimer = Math.max(0, l.attackTimer - elapsed); remaining -= elapsed;
    if (l.attackTimer > 1e-9) return;
    if (l.attackPhase === 'windup') resolveLeaderAttack(ctx);
    else {
      l.attackPhase = 'ready'; l.attackTimer = 0;
      l.comboWindow = l.comboStep > 0 ? BALANCE.alpha.comboWindow : 0;
    }
    if (remaining <= 1e-9) return;
  }
  l.comboWindow = Math.max(0, l.comboWindow - remaining);
}

export function updateLeader(ctx: SimContext, dt: number, input: SimInput): void {
  const l = ctx.state.leader;
  if (!l.alive) {
    l.vel.x = l.vel.z = 0; l.sprinting = false;
    if (l.anim !== 'dead') { l.anim = 'dead'; l.animTime = 0; }
    return;
  }
  if (ctx.state.phase !== 'playing') return;
  if (l.emergeTimer > 1e-9) {
    l.emergeTimer = Math.max(0, l.emergeTimer - dt);
    l.vel.x = l.vel.z = 0; l.sprinting = false;
    if (l.emergeTimer <= 1e-9) { l.emergeTimer = 0; l.anim = 'idle'; l.animTime = 0; }
    return;
  }
  if (l.hitStun > 1e-9) {
    l.hitStun = Math.max(0, l.hitStun - dt);
    l.vel.x = l.vel.z = 0; l.sprinting = false;
    return;
  }
  l.hitStun = 0;
  if (input.attack && l.attackPhase === 'ready') {
    l.comboStep = isEquipped(ctx.state, 'alpha_claws') ?
      (l.comboWindow > 1e-9 && l.comboStep > 0 && l.comboStep < 3 ? l.comboStep + 1 : 1) : 0;
    l.comboWindow = 0;
    l.attackPhase = 'windup';
    l.attackTimer = (l.comboStep > 0 ? BALANCE.alpha.clawWindup : BALANCE.alpha.biteWindup) / traitAttackRateMultiplier(ctx.state);
    l.anim = 'attack'; l.animTime = 0;
    aimLeaderAttack(ctx, input.aimPoint);
  }
  const windingUp = l.attackPhase === 'windup';
  computeMoveVector(input.moveForward, input.moveRight, input.cameraYaw, move);
  const sprinting = updateStamina(l, input.sprint, Math.hypot(move.x, move.z) > 0, dt);
  const speed = (sprinting ? BALANCE.leader.sprintSpeed : BALANCE.leader.walkSpeed) * speedMultiplier(ctx.state) *
    traitSpeedMultiplier(ctx.state) * lastBrainSpeedMultiplier(ctx.state) * (windingUp ? 0.4 : 1) *
    // The Alpha climbs over car-height obstacles (cars, barriers, short walls), a little slower while on top.
    (climbHeightAt(ctx.collision, l.pos, l.radius, climbScratch) > 0 ? BALANCE.horde.leaderClimbSpeedMultiplier : 1);
  if (windingUp) {
    const currentSpeed = Math.hypot(l.vel.x, l.vel.z);
    if (currentSpeed > speed) { l.vel.x *= speed / currentSpeed; l.vel.z *= speed / currentSpeed; }
  }
  const dx = move.x * speed - l.vel.x, dz = move.z * speed - l.vel.z;
  const change = Math.hypot(dx, dz), factor = change > 0 ? Math.min(1, BALANCE.leader.accel * dt / change) : 0;
  l.vel.x += dx * factor; l.vel.z += dz * factor;
  const x = l.pos.x, z = l.pos.z;
  ctx.collision.moveCircle(l.pos, l.vel.x * dt, l.vel.z * dt, l.radius, isCrawlable);
  l.vel.x = dt > 0 ? (l.pos.x - x) / dt : 0;
  l.vel.z = dt > 0 ? (l.pos.z - z) / dt : 0;
  settleLeaderElevation(ctx, dt);
  const moving = Math.hypot(l.vel.x, l.vel.z) > 0.05;
  if (moving && l.attackPhase === 'ready') {
    const turn = wrapAngle(Math.atan2(l.vel.x, l.vel.z) - l.facing);
    l.facing = wrapAngle(l.facing + Math.max(-BALANCE.leader.turnRate * dt, Math.min(BALANCE.leader.turnRate * dt, turn)));
  }
  const anim = moving ? (sprinting ? 'run' : 'walk') : 'idle';
  if (l.attackPhase === 'ready' && !((l.anim === 'attack' || l.anim === 'hit') && l.animTime < 0.35) && l.anim !== anim) {
    l.anim = anim; l.animTime = 0;
  }
  advanceAttack(ctx, dt);
}
