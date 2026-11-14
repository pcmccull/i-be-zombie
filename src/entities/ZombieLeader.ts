import { BALANCE } from '../config/balance';
import type { SimContext } from '../core/contracts';
import type { DistrictLayout, LeaderState, SimInput, Vec2 } from '../core/types';
import { wrapAngle } from '../utils/math';

export function createLeader(id: number, layout: DistrictLayout): LeaderState {
  return {
    id, pos: { ...layout.playerStart }, prevPos: { ...layout.playerStart }, vel: { x: 0, z: 0 },
    facing: layout.playerStartFacing, prevFacing: layout.playerStartFacing,
    radius: BALANCE.leader.radius, hp: BALANCE.leader.maxHp, maxHp: BALANCE.leader.maxHp,
    attackCooldown: 0, anim: 'idle', animTime: 0, hitFlash: 0,
    alive: true, stamina: BALANCE.leader.staminaMax, exhausted: false, sprinting: false,
  };
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
export function updateLeader(ctx: SimContext, dt: number, input: SimInput): void {
  const l = ctx.state.leader;
  if (!l.alive) {
    l.vel.x = l.vel.z = 0; l.sprinting = false;
    if (l.anim !== 'dead') { l.anim = 'dead'; l.animTime = 0; }
    return;
  }
  computeMoveVector(input.moveForward, input.moveRight, input.cameraYaw, move);
  const sprinting = updateStamina(l, input.sprint, Math.hypot(move.x, move.z) > 0, dt);
  const speed = sprinting ? BALANCE.leader.sprintSpeed : BALANCE.leader.walkSpeed;
  const dx = move.x * speed - l.vel.x, dz = move.z * speed - l.vel.z;
  const change = Math.hypot(dx, dz), factor = change > 0 ? Math.min(1, BALANCE.leader.accel * dt / change) : 0;
  l.vel.x += dx * factor; l.vel.z += dz * factor;
  const x = l.pos.x, z = l.pos.z;
  ctx.collision.moveCircle(l.pos, l.vel.x * dt, l.vel.z * dt, l.radius);
  l.vel.x = dt > 0 ? (l.pos.x - x) / dt : 0;
  l.vel.z = dt > 0 ? (l.pos.z - z) / dt : 0;
  const moving = Math.hypot(l.vel.x, l.vel.z) > 0.05;
  if (moving) {
    const turn = wrapAngle(Math.atan2(l.vel.x, l.vel.z) - l.facing);
    l.facing = wrapAngle(l.facing + Math.max(-BALANCE.leader.turnRate * dt, Math.min(BALANCE.leader.turnRate * dt, turn)));
  }
  const anim = moving ? (sprinting ? 'run' : 'walk') : 'idle';
  if (!((l.anim === 'attack' || l.anim === 'hit') && l.animTime < 0.35) && l.anim !== anim) {
    l.anim = anim; l.animTime = 0;
  }
}
