import { BALANCE } from '../config/balance';
import type { ICollisionWorld } from '../core/contracts';
import type { DistrictLayout, GateState, StructureState } from '../core/types';

export function createStructures(layout: DistrictLayout, collision: ICollisionWorld): StructureState[] {
  return layout.structures.map(def => {
    const collider = collision.findByTag(def.tag);
    if (!collider) throw new Error(`Structure ${def.id} requires an enabled collider tagged ${def.tag}`);
    const maxHp = BALANCE.structures[def.kind].maxHp;
    return {
      id: def.id, kind: def.kind, landmark: def.landmark, colliderId: collider.id,
      rect: { ...def.rect },
      center: { x: (def.rect.minX + def.rect.maxX) / 2, z: (def.rect.minZ + def.rect.maxZ) / 2 },
      hp: maxHp, maxHp, destroyed: false, hitFlash: 0, destroyedAt: null,
    };
  });
}

export function createGate(collision: ICollisionWorld): GateState {
  const c = collision.findByTag('gate');
  if (!c) throw new Error('District requires an enabled gate collider');
  return {
    colliderId: c.id, rect: { minX: c.minX, minZ: c.minZ, maxX: c.maxX, maxZ: c.maxZ },
    center: { x: (c.minX + c.maxX) / 2, z: (c.minZ + c.maxZ) / 2 },
    hp: BALANCE.gate.maxHp, maxHp: BALANCE.gate.maxHp, destroyed: false, hitFlash: 0,
  };
}
