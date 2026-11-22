// [pure] todos #10b: break into a corner shop, drink to heal. Drinks exist only inside shops whose door is down
// (state.pickups); the Alpha drinks one by walking over it while hurt. An emptied shop restocks after
// BALANCE.shops.restockTime. Only this system writes state.pickups.
import { BALANCE } from '../config/balance';
import type { SimContext } from '../core/contracts';
import type { StructureDef } from '../core/types';
import { restoreStrength } from './HordeHealthSystem';
import { shopDrinkSpots } from '../world/layout/shops';

interface ShopMemory {
  /** Shop id -> sim time the shelf refills (absent = stocked or still locked). */
  restockAt: Map<number, number>;
  /** Shops whose break-in has been handled (first stock placed). */
  opened: Set<number>;
  defs: StructureDef[];
}
const memories = new WeakMap<SimContext, ShopMemory>();

function memory(ctx: SimContext): ShopMemory {
  let m = memories.get(ctx);
  if (!m) {
    m = { restockAt: new Map(), opened: new Set(), defs: ctx.layout.structures.filter(s => s.kind === 'shopDoor') };
    memories.set(ctx, m);
  }
  return m;
}

function stock(ctx: SimContext, def: StructureDef): number {
  const spots = shopDrinkSpots(def, BALANCE.shops.drinks);
  for (const pos of spots) ctx.state.pickups.push({ id: ctx.newId(), kind: 'drink', shopId: def.id, pos });
  return spots.length;
}

export function updateShops(ctx: SimContext): void {
  const state = ctx.state;
  if (state.phase !== 'playing' && state.phase !== 'respawning') return;
  const m = memory(ctx);
  if (!m.defs.length) return;
  for (const def of m.defs) {
    const door = state.structures.find(s => s.id === def.id);
    if (!door?.destroyed) continue;
    if (!m.opened.has(def.id)) {
      m.opened.add(def.id);
      const drinks = stock(ctx, def);
      ctx.emit({ type: 'shopLooted', shopId: def.id, pos: { ...door.center }, drinks });
      continue;
    }
    const at = m.restockAt.get(def.id);
    if (at !== undefined && state.time >= at) { m.restockAt.delete(def.id); stock(ctx, def); }
  }
  const l = state.leader;
  if (!l.alive || state.horde.coreDamage <= 0.01 || state.phase !== 'playing') return;
  const r2 = BALANCE.shops.pickupRadius ** 2;
  for (let i = 0; i < state.pickups.length; i++) {
    const p = state.pickups[i];
    if ((p.pos.x - l.pos.x) ** 2 + (p.pos.z - l.pos.z) ** 2 > r2) continue;
    const heal = restoreStrength(ctx, BALANCE.shops.drinkHeal * BALANCE.hordeHealth.alphaDamageMultiplier / BALANCE.hordeHealth.unitHp, 'heal');
    state.pickups.splice(i, 1);
    ctx.emit({ type: 'pickup', kind: 'drink', pos: { ...p.pos }, heal, hp: state.horde.strength });
    if (!state.pickups.some(q => q.shopId === p.shopId)) m.restockAt.set(p.shopId, state.time + BALANCE.shops.restockTime);
    return; // one drink per step
  }
}
