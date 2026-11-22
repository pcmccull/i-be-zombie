// [pure] Arcade player vehicles: summon, mount, drive, safe dismount, and horde reassembly.
// Spec: docs/11_cityupgrade.md §4.1.C.
import { BALANCE } from '../config/balance';
import type { SimContext } from '../core/contracts';
import type { GameState, PlayerVehicleKind, PlayerVehicleState, SimInput, Vec2 } from '../core/types';
import { clamp, wrapAngle } from '../utils/math';
import { damageGuard } from './CombatSystem';
import { damageVehicle, isVehicleTargetable, vehicleOverlap } from './TrafficSystem';
import { halfLength, halfWidth } from './vehicleModels';

/** Per-run hit cooldowns (state time of the last hit), keyed by the run's GameState so a restart starts clean. */
interface ImpactMemory { guards: Map<number, number>; cars: Map<number, number>; props: Map<number, number> }
const impactMemory = new WeakMap<GameState, ImpactMemory>();
function impacts(state: GameState): ImpactMemory {
  let m = impactMemory.get(state);
  if (!m) { m = { guards: new Map(), cars: new Map(), props: new Map() }; impactMemory.set(state, m); }
  return m;
}
function ready(map: Map<number, number>, id: number, now: number): boolean {
  const last = map.get(id);
  return last === undefined || now - last >= BALANCE.city.playerVehicleImpact.hitCooldown;
}

const local = { f: 0, r: 0 };

/**
 * The Alpha's vehicle against everything that isn't a static collider: humans (run down at speed, shoved aside
 * when slow), traffic cars (solid; a hard hit wears the driver's grip like claws do and can drag them out) and
 * trash cans / hydrants (solid when slow, smashed through at speed — WorldInteractionSystem sets them off).
 * Runs every step, parked or mounted; damage only ever comes from the vehicle's own speed.
 */
export function collidePlayerVehicle(ctx: SimContext, pv: PlayerVehicleState, radius: number): void {
  const state = ctx.state, now = state.time, cfg = BALANCE.city.playerVehicleImpact, mem = impacts(state);
  const fx = Math.sin(pv.facing), fz = Math.cos(pv.facing);

  // Traffic cars: oriented boxes. Push the player vehicle out along the shallower car axis.
  for (const v of state.vehicles) {
    if (!vehicleOverlap(v, pv.pos, radius, local)) continue;
    const vfx = Math.sin(v.facing), vfz = Math.cos(v.facing);
    const penF = halfLength(v) + radius - Math.abs(local.f), penR = halfWidth(v) + radius - Math.abs(local.r);
    let nx: number, nz: number, pen: number; // normal from the car to the player vehicle
    if (penR <= penF) { const s = local.r >= 0 ? 1 : -1; nx = vfz * s; nz = -vfx * s; pen = penR; }
    else { const s = local.f >= 0 ? 1 : -1; nx = vfx * s; nz = vfz * s; pen = penF; }
    const into = (fx * nx + fz * nz) * pv.speed; // < 0: we drive into the car
    const closing = -(into - (vfx * nx + vfz * nz) * v.speed);
    ctx.collision.moveCircle(pv.pos, nx * (pen + 0.01), nz * (pen + 0.01), radius);
    if (closing >= cfg.hitMinSpeed && pv.mounted && ready(mem.cars, v.id, now)) {
      mem.cars.set(v.id, now);
      if (isVehicleTargetable(v)) damageVehicle(ctx, v, closing * cfg.carDamagePerSpeed);
      pv.hp = Math.max(1, pv.hp - closing * cfg.selfDamagePerSpeed);
      if (closing >= BALANCE.traffic.crashMinSpeed) {
        ctx.emit({ type: 'vehicleCrash', vehicleId: v.id, otherId: -1, pos: { x: pv.pos.x - nx * radius, z: pv.pos.z - nz * radius }, speed: closing });
      }
    }
    if (into < 0) pv.speed *= cfg.carBounce;
  }

  // Humans: circles. Fast ⇒ hit (Alpha kill, always converts) and knocked away; slow ⇒ shoved aside.
  for (const g of state.guards) {
    if (g.dormant || g.state === 'DEAD' || g.hp <= 0 || g.elevation > 0.5) continue;
    let dx = g.pos.x - pv.pos.x, dz = g.pos.z - pv.pos.z;
    const reach = radius + g.radius, d2 = dx * dx + dz * dz;
    if (d2 >= reach * reach) continue;
    const d = Math.sqrt(d2);
    if (d > 1e-4) { dx /= d; dz /= d; } else { dx = fx; dz = fz; }
    const impact = (fx * dx + fz * dz) * pv.speed;
    let push = reach - d + 0.01;
    if (impact >= cfg.hitMinSpeed && pv.mounted && ready(mem.guards, g.id, now)) {
      mem.guards.set(g.id, now);
      damageGuard(ctx, g, impact * cfg.humanDamagePerSpeed, 'zombie', true);
      if (g.hp > 0) g.staggerTime = Math.max(g.staggerTime, 0.8);
      push += impact * cfg.humanThrowPerSpeed;
      pv.speed *= 1 - cfg.humanSpeedLoss;
    }
    ctx.collision.moveCircle(g.pos, dx * push, dz * push, g.radius);
  }

  // Props (trash cans, hydrants, ...): circles.
  for (const item of state.interactables) {
    let dx = pv.pos.x - item.pos.x, dz = pv.pos.z - item.pos.z;
    const reach = radius + item.radius, d2 = dx * dx + dz * dz;
    if (d2 >= reach * reach) continue;
    const d = Math.sqrt(d2);
    if (d > 1e-4) { dx /= d; dz /= d; } else { dx = -fx; dz = -fz; }
    const into = -(fx * dx + fz * dz) * pv.speed; // > 0: driving into the prop
    if (pv.mounted && Math.abs(pv.speed) > cfg.propSmashSpeed) {
      if (ready(mem.props, item.id, now)) { mem.props.set(item.id, now); pv.speed *= 1 - cfg.propSpeedLoss; }
      continue; // smashed through
    }
    ctx.collision.moveCircle(pv.pos, dx * (reach - d + 0.01), dz * (reach - d + 0.01), radius);
    if (into > 0) pv.speed *= cfg.propBlockSpeed;
  }
}

function safeDismountPos(ctx: SimContext, center: Vec2, facing: number, radius: number): Vec2 {
  const offsets = [
    { x: -Math.cos(facing) * 2.1, z: Math.sin(facing) * 2.1 },
    { x: Math.cos(facing) * 2.1, z: -Math.sin(facing) * 2.1 },
    { x: -Math.sin(facing) * 2.4, z: -Math.cos(facing) * 2.4 },
    { x: Math.sin(facing) * 2.4, z: Math.cos(facing) * 2.4 },
  ];
  for (const off of offsets) {
    const p = { x: center.x + off.x, z: center.z + off.z };
    if (!ctx.collision.isBlocked(p, radius)) return p;
  }
  return { x: center.x, z: center.z };
}

function reassembleHordeNearLeader(ctx: SimContext): void {
  const lp = ctx.state.leader.pos;
  let idx = 0;
  for (const z of ctx.state.zombies) {
    if (z.state !== 'follower' || z.hp <= 0) continue;
    const dx = z.pos.x - lp.x;
    const dz = z.pos.z - lp.z;
    if (dx * dx + dz * dz <= 22 * 22) continue;
    const angle = (idx++ * 2.39996) % (Math.PI * 2);
    const dist = 2.2 + (idx % 5) * 0.85;
    const candidate = { x: lp.x + Math.cos(angle) * dist, z: lp.z + Math.sin(angle) * dist };
    if (!ctx.collision.isBlocked(candidate, z.radius)) {
      z.pos.x = z.prevPos.x = candidate.x;
      z.pos.z = z.prevPos.z = candidate.z;
    }
  }
}

export function spawnPlayerVehicleNearLeader(ctx: SimContext, kind: PlayerVehicleKind): boolean {
  if (!ctx.state.rewards.unlockedVehicleIds.includes(kind)) return false;
  const spec = BALANCE.city.playerVehicles[kind];
  const lp = ctx.state.leader.pos;
  const f = ctx.state.leader.facing;
  const spawn = safeDismountPos(ctx, lp, f, spec.radius);
  ctx.state.rewards.activeVehicleId = kind;
  ctx.state.playerVehicle = {
    kind,
    pos: spawn,
    facing: f,
    speed: 0,
    mounted: false,
    hp: spec.maxHp,
    maxHp: spec.maxHp,
    honkCooldown: 0,
  };
  return true;
}

/** Returns true when it consumed the interact press (mount / dismount). */
export function updatePlayerVehicle(ctx: SimContext, dt: number, input: SimInput): boolean {
  if (ctx.layout.strongholds.length === 0) return false;
  const state = ctx.state;
  const leader = state.leader;

  if (input.summonVehicle && leader.alive && state.phase === 'playing') {
    spawnPlayerVehicleNearLeader(ctx, input.summonVehicle);
  }

  // Auto-park a starter vehicle if unlocked and none is spawned yet
  if (!state.playerVehicle && state.rewards.activeVehicleId && state.rewards.unlockedVehicleIds.includes(state.rewards.activeVehicleId)) {
    spawnPlayerVehicleNearLeader(ctx, state.rewards.activeVehicleId);
  }

  const pv = state.playerVehicle;
  if (!pv) return false;
  const spec = BALANCE.city.playerVehicles[pv.kind];
  pv.honkCooldown = Math.max(0, pv.honkCooldown - dt);

  // If Alpha died while mounted, dismount cleanly
  if (!leader.alive || state.phase !== 'playing') {
    if (pv.mounted) {
      pv.mounted = false;
      pv.speed = 0;
    }
    return false;
  }

  // Mount / Dismount on interact edge
  if (input.interact) {
    if (pv.mounted) {
      pv.mounted = false;
      pv.speed = 0;
      const exitPos = safeDismountPos(ctx, pv.pos, pv.facing, leader.radius);
      leader.pos.x = exitPos.x;
      leader.pos.z = exitPos.z;
      reassembleHordeNearLeader(ctx);
      ctx.emit({ type: 'vehicleDismounted', vehicleId: pv.kind, pos: { ...pv.pos } });
      return true;
    }
    const dx = pv.pos.x - leader.pos.x;
    const dz = pv.pos.z - leader.pos.z;
    if (dx * dx + dz * dz <= (BALANCE.city.interactRange + 1.5) ** 2) {
      pv.mounted = true;
      ctx.emit({ type: 'vehicleMounted', vehicleId: pv.kind, pos: { ...pv.pos } });
      return true;
    }
  }

  if (!pv.mounted) {
    collidePlayerVehicle(ctx, pv, spec.radius); // a parked vehicle is solid too (cars shove it, people step round it)
    return false;
  }

  // Arcade steering & acceleration
  const throttle = input.moveForward;
  const steer = input.moveRight;
  if (throttle > 0.05) {
    pv.speed = Math.min(spec.maxSpeed, pv.speed + spec.accel * throttle * dt);
  } else if (throttle < -0.05) {
    pv.speed = Math.max(-spec.reverseSpeed, pv.speed + spec.brake * throttle * dt);
  } else {
    const drag = spec.brake * 0.55 * dt;
    pv.speed = Math.abs(pv.speed) <= drag ? 0 : pv.speed - Math.sign(pv.speed) * drag;
  }

  if (Math.abs(pv.speed) > 0.3 && Math.abs(steer) > 0.05) {
    const dir = pv.speed >= 0 ? 1 : -1;
    pv.facing = wrapAngle(pv.facing - steer * spec.turnRate * dir * dt);
  }

  const nextPos = {
    x: pv.pos.x + Math.sin(pv.facing) * pv.speed * dt,
    z: pv.pos.z + Math.cos(pv.facing) * pv.speed * dt,
  };
  const play = ctx.layout.playArea;
  nextPos.x = clamp(nextPos.x, play.minX + spec.radius, play.maxX - spec.radius);
  nextPos.z = clamp(nextPos.z, play.minZ + spec.radius, play.maxZ - spec.radius);
  const collided = ctx.collision.resolveCircle(nextPos, spec.radius);
  if (collided) {
    pv.speed *= 0.4;
  }
  pv.pos.x = nextPos.x;
  pv.pos.z = nextPos.z;
  collidePlayerVehicle(ctx, pv, spec.radius);

  // Keep Alpha synced to the vehicle seat
  leader.pos.x = pv.pos.x;
  leader.pos.z = pv.pos.z;
  leader.elevation = 0;
  leader.facing = pv.facing;
  leader.vel.x = Math.sin(pv.facing) * pv.speed;
  leader.vel.z = Math.cos(pv.facing) * pv.speed;
  return false;
}
