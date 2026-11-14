import { BALANCE } from '../config/balance';
import type { ICollisionWorld } from '../core/contracts';
import type { GuardAgent, GuardSpawn } from '../core/types';

export function createGuard(id: number, spawn: GuardSpawn, collision: ICollisionWorld): GuardAgent {
  const tower = spawn.tower ? collision.findByTag('tower' + spawn.tower) : undefined;
  return {
    id, pos: { ...spawn.pos }, prevPos: { ...spawn.pos }, vel: { x: 0, z: 0 },
    facing: spawn.facing, prevFacing: spawn.facing, radius: BALANCE.guard.radius,
    hp: BALANCE.guard.maxHp, maxHp: BALANCE.guard.maxHp, attackCooldown: 0,
    anim: 'idle', animTime: 0, hitFlash: 0, state: 'PATROL', stateTime: 0,
    tower: spawn.tower, towerColliderId: tower?.id ?? null, elevation: spawn.tower ? 4 : 0,
    waypoints: spawn.waypoints.map(p => ({ ...p })), waypointIndex: 0, path: [], pathIndex: 0,
    idleTimer: 0, perceptionTimer: 0, target: null, lostTargetTimer: 0,
    lastDamageSource: 'other', deathTime: null,
  };
}
