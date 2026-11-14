import { BALANCE } from '../config/balance';
import type { ICollisionWorld } from '../core/contracts';
import type { GateState } from '../core/types';

export function createGate(collision: ICollisionWorld): GateState {
  const c = collision.findByTag('gate');
  if (!c) throw new Error('District requires an enabled gate collider');
  return {
    colliderId: c.id, rect: { minX: c.minX, minZ: c.minZ, maxX: c.maxX, maxZ: c.maxZ },
    center: { x: (c.minX + c.maxX) / 2, z: (c.minZ + c.maxZ) / 2 },
    hp: BALANCE.gate.maxHp, maxHp: BALANCE.gate.maxHp, destroyed: false, hitFlash: 0,
  };
}
