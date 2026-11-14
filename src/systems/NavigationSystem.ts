import { BALANCE } from '../config/balance';
import type { IFlowField, INavigationGrid, SimContext, SquadGuidance } from '../core/contracts';
import type { GuardAgent, SimInput, TargetRef, Vec2 } from '../core/types';
import { distSq } from '../utils/math';
import { resolveTargetPos } from './CombatSystem';
import { findStructure } from './StructureSystem';

/** Re-plannable attack guidance for the main horde or one squad. */
interface AttackPlan extends SquadGuidance {
  attackAt: number; attackPos: Vec2; orderKey: string; guardField: IFlowField | null;
}
interface Planning {
  elapsed: number; followAt: number; followPos: Vec2;
  version: number; grid: INavigationGrid | null;
  main: AttackPlan; squads: Map<number, AttackPlan>;
}
const planning = new WeakMap<SimContext, Planning>();
const successionFields = new WeakMap<SimContext, IFlowField>();
const targetPos: Vec2 = { x: 0, z: 0 };

function newPlan(): AttackPlan {
  return { attackField: null, effectiveTarget: null, attackAt: -Infinity,
    attackPos: { x: Infinity, z: Infinity }, orderKey: '', guardField: null };
}

/**
 * Grid the horde steers on: once the pack is big enough it treats low obstacles (cars,
 * barriers) as passable and crawls over them; small groups path around.
 */
export function hordeGrid(ctx: SimContext): INavigationGrid {
  return ctx.state.followerCount >= BALANCE.horde.crawlNavMinFollowers ? ctx.crawlNavGrid : ctx.navGrid;
}

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

/** Only called when an ordered target dies: one shared reachability pass for the pack. */
export function nearestReachableGuard(ctx: SimContext, origin: Vec2, radius: number): TargetRef | null {
  const starts: Vec2[] = [];
  for (const z of ctx.state.zombies) if (z.state === 'follower' && z.hp > 0) starts.push(z.pos);
  if (!starts.length) return null;
  const field = ctx.navGrid.buildFlowField(starts, successionFields.get(ctx));
  successionFields.set(ctx, field);
  let nearest = radius * radius;
  let target: TargetRef | null = null;
  for (const g of ctx.state.guards) {
    if (g.state === 'DEAD' || g.hp <= 0) continue;
    const d = distSq(origin, g.pos);
    if (d > nearest || (d === nearest && target)) continue;
    // Use the same validated melee approaches as attack navigation, including towers.
    if (!guardGoals(ctx, g).some(p => field.distanceAt(p) < Infinity)) continue;
    nearest = d; target = { kind: 'guard', id: g.id };
  }
  return target;
}

export function updateNavigation(ctx: SimContext, dt: number, _input: SimInput): void {
  let p = planning.get(ctx);
  if (!p) {
    p = { elapsed: 0, followAt: -Infinity, followPos: { x: Infinity, z: Infinity },
      version: -1, grid: null, main: newPlan(), squads: new Map() };
    planning.set(ctx, p);
  }
  p.elapsed += dt;
  const interval = 1 / BALANCE.sim.navReplanHz;
  const grid = hordeGrid(ctx);
  const versionChanged = p.version !== ctx.navGrid.version || p.grid !== grid;
  if (!ctx.nav.followField || versionChanged ||
      (distSq(ctx.state.leader.pos, p.followPos) > 4 && p.elapsed - p.followAt >= interval - 1e-9)) {
    ctx.nav.followField = grid.buildFlowField([ctx.state.leader.pos], ctx.nav.followField ?? undefined,
      BALANCE.nav.flowFieldMaxDistance);
    p.followPos.x = ctx.state.leader.pos.x; p.followPos.z = ctx.state.leader.pos.z; p.followAt = p.elapsed;
  }
  const order = ctx.state.order;
  planAttack(ctx, p, p.main, order.type === 'attack' ? order.target : null, grid, versionChanged, interval);
  ctx.nav.attackField = p.main.attackField; ctx.nav.effectiveTarget = p.main.effectiveTarget;

  // Squads: drop plans for disbanded squads, then plan each live one.
  for (const id of p.squads.keys()) {
    if (!ctx.state.squads.some(sq => sq.id === id)) { p.squads.delete(id); ctx.nav.squads.delete(id); }
  }
  for (const squad of ctx.state.squads) {
    let plan = p.squads.get(squad.id);
    if (!plan) { plan = newPlan(); p.squads.set(squad.id, plan); }
    planAttack(ctx, p, plan, squad.target, grid, versionChanged, interval);
    let guidance = ctx.nav.squads.get(squad.id);
    if (!guidance) { guidance = { attackField: null, effectiveTarget: null }; ctx.nav.squads.set(squad.id, guidance); }
    guidance.attackField = plan.attackField; guidance.effectiveTarget = plan.effectiveTarget;
  }
  p.version = ctx.navGrid.version; p.grid = grid;
}

function planAttack(ctx: SimContext, p: Planning, plan: AttackPlan, target: TargetRef | null,
    grid: INavigationGrid, versionChanged: boolean, interval: number): void {
  if (!target || !resolveTargetPos(ctx, target, targetPos)) {
    plan.effectiveTarget = null; plan.attackField = null; plan.orderKey = '';
    return;
  }
  const orderKey = key(target);
  const changed = plan.orderKey !== orderKey;
  // A structure never moves: while the effective target is one (e.g. a door sheltering a fleeing civilian), only an
  // order change or nav rebuild (door destroyed) replans — target drift alone must not rebuild the field.
  const drift = plan.effectiveTarget?.kind !== 'structure' &&
    distSq(targetPos, plan.attackPos) > 1.5 * 1.5 && p.elapsed - plan.attackAt >= interval - 1e-9;
  if (!(changed || versionChanged || !plan.attackField || drift)) return;
  let effective: TargetRef = target;
  let field: IFlowField | null = plan.attackField;
  let gatePlanned = false;
  const maxDistance = Math.max(BALANCE.nav.flowFieldMaxDistance,
    Math.sqrt(distSq(ctx.state.leader.pos, targetPos)) + 60);
  if (target.kind === 'guard') {
    const id = target.id;
    const guard = ctx.state.guards.find(g => g.id === id)!;
    const shelter = findStructure(ctx.state, guard.shelter);
    if (shelter && !shelter.destroyed) {
      effective = { kind: 'structure', id: shelter.id };
    } else {
      plan.guardField = grid.buildFlowField(guardGoals(ctx, guard), plan.guardField ?? undefined, maxDistance);
      field = plan.guardField;
      if (!ctx.state.gate.destroyed && field.distanceAt(ctx.state.leader.pos) === Infinity) {
        // Both sides must connect to their respective gate approaches: an unrelated
        // inaccessible enclosure must never redirect an order to the gate.
        const guardField = field;
        const insideReachable = ctx.layout.checkpoint.gateApproachInside.some(g => guardField.distanceAt(g) < Infinity);
        if (insideReachable) {
          // The short follow field may not reach a distant gate. Test access using
          // the explicit order's larger bound, retaining the field if redirected.
          const reuse = plan.attackField === plan.guardField ? undefined : plan.attackField ?? undefined;
          const gateField = grid.buildFlowField(ctx.layout.checkpoint.gateApproachOutside, reuse, maxDistance);
          if (gateField.distanceAt(ctx.state.leader.pos) < Infinity) {
            effective = { kind: 'gate' };
            field = gateField;
            gatePlanned = true;
          }
        }
      }
    }
  }
  if (effective.kind === 'structure') {
    const id = effective.id;
    const def = ctx.layout.structures.find(d => d.id === id)!;
    field = grid.buildFlowField(def.approachOutside,
      plan.attackField === plan.guardField ? undefined : plan.attackField ?? undefined, maxDistance);
  }
  if (effective.kind === 'gate' && !gatePlanned && (target.kind !== 'gate' || changed || versionChanged || !field)) {
    // Never reuse the guard's reachability field as gate storage.
    const reuse = plan.attackField === plan.guardField ? undefined : plan.attackField ?? undefined;
    field = grid.buildFlowField(ctx.layout.checkpoint.gateApproachOutside, reuse, maxDistance);
  }
  plan.effectiveTarget = effective; plan.attackField = field;
  plan.orderKey = orderKey;
  plan.attackPos.x = targetPos.x; plan.attackPos.z = targetPos.z; plan.attackAt = p.elapsed;
}
