import { BALANCE } from '../config/balance';
import type { IFlowField, SimContext } from '../core/contracts';
import type { GuardAgent, SimInput, TargetRef, Vec2 } from '../core/types';
import { distSq } from '../utils/math';
import { resolveTargetPos } from './CombatSystem';

interface Planning {
  elapsed: number; followAt: number; followPos: Vec2;
  attackAt: number; attackPos: Vec2; orderKey: string;
  version: number; guardField: IFlowField | null;
}
const planning = new WeakMap<SimContext, Planning>();
const targetPos: Vec2 = { x: 0, z: 0 };

function key(target: TargetRef | null): string {
  return target ? target.kind + ('id' in target ? target.id : '') : '';
}

function guardGoals(ctx: SimContext, g: GuardAgent): Vec2[] {
  const points: Vec2[] = [];
  const tower = g.towerColliderId === null ? undefined : ctx.collision.colliders[g.towerColliderId];
  const access = { mode: 'move' as const, ignoreIds: tower ? [tower.id] : [] };
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const rx = tower ? (tower.maxX - tower.minX) / 2 + 1 : g.radius + BALANCE.walker.radius + 0.3;
    const rz = tower ? (tower.maxZ - tower.minZ) / 2 + 1 : rx;
    const p = { x: g.pos.x + Math.sin(a) * rx, z: g.pos.z + Math.cos(a) * rz };
    // Tower corners need to lie outside its rectangular footprint too.
    if (tower && i % 2) {
      p.x = g.pos.x + Math.sign(Math.sin(a)) * rx;
      p.z = g.pos.z + Math.sign(Math.cos(a)) * rz;
    }
    const snapped = ctx.navGrid.nearestWalkable(p);
    // Snapping a point beside a perimeter wall can put it on the other side.
    // Only actual melee access points belong in this target's goal set.
    const reach = BALANCE.walker.attackRange + g.radius + (tower ? BALANCE.guard.towerMeleeReachBonus : 0);
    if (distSq(snapped, g.pos) <= reach * reach &&
        !ctx.collision.segmentBlocked(snapped, g.pos, access)) points.push(snapped);
  }
  return points;
}

export function updateNavigation(ctx: SimContext, dt: number, _input: SimInput): void {
  let p = planning.get(ctx);
  if (!p) {
    p = { elapsed: 0, followAt: -Infinity, followPos: { x: Infinity, z: Infinity },
      attackAt: -Infinity, attackPos: { x: Infinity, z: Infinity }, orderKey: '',
      version: -1, guardField: null };
    planning.set(ctx, p);
  }
  p.elapsed += dt;
  const interval = 1 / BALANCE.sim.navReplanHz;
  const versionChanged = p.version !== ctx.navGrid.version;
  if (!ctx.nav.followField || versionChanged ||
      (distSq(ctx.state.leader.pos, p.followPos) > 4 && p.elapsed - p.followAt >= interval - 1e-9)) {
    ctx.nav.followField = ctx.navGrid.buildFlowField([ctx.state.leader.pos], ctx.nav.followField ?? undefined);
    p.followPos.x = ctx.state.leader.pos.x; p.followPos.z = ctx.state.leader.pos.z; p.followAt = p.elapsed;
  }
  const order = ctx.state.order;
  if (order.type === 'follow' || !resolveTargetPos(ctx, order.target, targetPos)) {
    ctx.nav.effectiveTarget = null; ctx.nav.attackField = null;
    p.orderKey = ''; p.version = ctx.navGrid.version;
    return;
  }
  const orderKey = key(order.target);
  const changed = p.orderKey !== orderKey;
  if (changed || versionChanged || !ctx.nav.attackField ||
      (distSq(targetPos, p.attackPos) > 1.5 * 1.5 && p.elapsed - p.attackAt >= interval - 1e-9)) {
    let effective: TargetRef = order.target;
    let field: IFlowField;
    if (order.target.kind === 'guard') {
      const id = order.target.id;
      const guard = ctx.state.guards.find(g => g.id === id)!;
      p.guardField = ctx.navGrid.buildFlowField(guardGoals(ctx, guard), p.guardField ?? undefined);
      field = p.guardField;
      if (!ctx.state.gate.destroyed && field.distanceAt(ctx.state.leader.pos) === Infinity) {
        // Both sides must connect to their respective gate approaches: an unrelated
        // inaccessible enclosure must never redirect an order to the gate.
        const outsideReachable = ctx.layout.checkpoint.gateApproachOutside.some(g =>
          ctx.nav.followField!.distanceAt(g) < Infinity);
        const insideReachable = ctx.layout.checkpoint.gateApproachInside.some(g => field.distanceAt(g) < Infinity);
        if (outsideReachable && insideReachable) effective = { kind: 'gate' };
      }
    } else {
      field = ctx.nav.attackField!;
    }
    if (effective.kind === 'gate') {
      // Never reuse the guard's reachability field as gate storage.
      const reuse = ctx.nav.attackField === p.guardField ? undefined : ctx.nav.attackField ?? undefined;
      field = ctx.navGrid.buildFlowField(ctx.layout.checkpoint.gateApproachOutside, reuse);
    }
    ctx.nav.effectiveTarget = effective; ctx.nav.attackField = field;
    p.orderKey = orderKey;
    p.attackPos.x = targetPos.x; p.attackPos.z = targetPos.z; p.attackAt = p.elapsed;
  }
  p.version = ctx.navGrid.version;
}
