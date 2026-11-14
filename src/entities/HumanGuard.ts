import { BALANCE } from '../config/balance';
import type { ICollisionWorld } from '../core/contracts';
import type { GuardAgent, GuardSpawn } from '../core/types';

export function createGuard(id: number, spawn: GuardSpawn, collision: ICollisionWorld): GuardAgent {
  const tower = spawn.tower ? collision.findByTag('tower' + spawn.tower) : undefined;
  const role = spawn.role ?? 'soldier';
  const civilian = role === 'civilian';
  const maxHp = civilian ? BALANCE.civilian.maxHp : role === 'police' ? BALANCE.police.maxHp : BALANCE.guard.maxHp;
  return {
    role, post: spawn.post ?? 'checkpoint', homeArea: spawn.homeArea ? { ...spawn.homeArea } : null,
    shelter: spawn.shelter ?? 0,
    id, pos: { ...spawn.pos }, prevPos: { ...spawn.pos }, vel: { x: 0, z: 0 },
    facing: spawn.facing, prevFacing: spawn.facing, radius: civilian ? BALANCE.civilian.radius : BALANCE.guard.radius,
    hp: maxHp, maxHp, attackCooldown: 0,
    anim: 'idle', animTime: 0, hitFlash: 0, state: 'PATROL', stateTime: 0,
    tower: spawn.tower, towerColliderId: tower?.id ?? null, elevation: spawn.tower ? 4 : 0,
    waypoints: spawn.waypoints.map(p => ({ ...p })),
    // Route patrols (e.g. reinforcements: [spawn point, destination]) set off immediately instead of idling at their own start.
    waypointIndex: spawn.post === 'patrol' && spawn.waypoints.length > 1 &&
      Math.hypot(spawn.waypoints[0].x - spawn.pos.x, spawn.waypoints[0].z - spawn.pos.z) < 0.5 ? 1 : 0, path: [], pathIndex: 0,
    idleTimer: 0, perceptionTimer: 0, target: null, lostTargetTimer: 0,
    lastDamageSource: 'other', deathTime: null,
    strongholdId: spawn.strongholdId ?? null, dormant: false, staggerTime: 0, killedByAlpha: false,
  };
}
