import { BALANCE } from '../config/balance';
import type { SimContext } from '../core/contracts';
import type { GameState, StructureState, Vec2, ZombieAgent } from '../core/types';
import { addMomentum } from './MomentumSystem';
import { addBiomass } from './ProgressionSystem';

interface Release { at: number; path: Vec2[]; index: number }
const releases = new WeakMap<ZombieAgent, Release>();
// Conquest owns territory/alert; retain every hit until its next update (including
// multiple hits in one combat step), without consuming the visual event queue.
const conquestHits = new WeakMap<GameState, Map<number, number>>();

export function takeStructureHits(state: GameState): ReadonlyMap<number, number> | undefined {
  const hits = conquestHits.get(state);
  conquestHits.delete(state);
  return hits;
}

export function findStructure(state: GameState, id: number): StructureState | undefined {
  for (const s of state.structures) if (s.id === id) return s;
  return undefined;
}

/** Horde wandering yields to the burst; followers always use normal horde steering. */
export function isReleaseBurst(ctx: SimContext, z: ZombieAgent): boolean {
  const release = releases.get(z);
  return z.state === 'ambient' && !!release && ctx.state.time - release.at < BALANCE.structures.releaseDuration;
}

export function damageStructure(ctx: SimContext, s: StructureState, amount: number): void {
  if (s.destroyed || !(amount > 0) || !Number.isFinite(amount)) return;
  let hits = conquestHits.get(ctx.state);
  if (!hits) { hits = new Map(); conquestHits.set(ctx.state, hits); }
  hits.set(s.id, (hits.get(s.id) ?? 0) + 1);
  s.hp = Math.max(0, s.hp - amount); s.hitFlash = 0.15;
  ctx.emit({ type: 'damage', target: { kind: 'structure', id: s.id }, amount, pos: { ...s.center } });
  ctx.emit({ type: 'structureDamaged', id: s.id, kind: s.kind, hp: s.hp, maxHp: s.maxHp, pos: { ...s.center } });
  if (s.hp > 0) return;
  s.destroyed = true; s.destroyedAt = ctx.state.time;
  ctx.collision.setEnabled(s.colliderId, false);
  ctx.navGrid.rebuild(); ctx.crawlNavGrid.rebuild();
  const def = ctx.layout.structures.find(d => d.id === s.id)!;
  let count = 0;
  for (const z of ctx.state.zombies) {
    if (z.heldBy !== s.id) continue;
    z.heldBy = 0; z.spawnZone = -1; z.stateTime = 0; z.wanderTimer = 0;
    if (z.state !== 'ambient' || z.hp <= 0) continue;
    const outside = def.approachOutside[z.id % def.approachOutside.length];
    const exit = ctx.navGrid.nearestWalkable({
      x: outside.x + Math.sin(def.facing) * BALANCE.structures.releaseScatter,
      z: outside.z + Math.cos(def.facing) * BALANCE.structures.releaseScatter,
    });
    z.wanderTarget = exit; z.anim = 'run'; z.animTime = 0;
    let path: Vec2[];
    if (ctx.navGrid.hasClearWalk(z.pos, exit)) path = [exit];
    else {
      const inside = def.approachInside[z.id % def.approachInside.length];
      // Plan once to the inside approach, then cross the door before scattering outside.
      path = ctx.navGrid.findPath(z.pos, inside) ?? [inside];
      path.push(outside, exit);
    }
    releases.set(z, { at: ctx.state.time, path, index: 0 });
    count++;
  }
  ctx.state.stats.structuresDestroyed++;
  addBiomass(ctx, BALANCE.progression.biomassStructure, 'structure', s.center);
  ctx.emit({ type: 'structureDestroyed', id: s.id, kind: s.kind, landmark: s.landmark, pos: { ...s.center } });
  if (count > 0) ctx.emit({ type: 'released', structureId: s.id, count, pos: { ...s.center } });
  if (def.defensive) addMomentum(ctx, 'structure');
}

export function updateStructures(ctx: SimContext, dt: number): void {
  for (const s of ctx.state.structures) s.hitFlash = Math.max(0, s.hitFlash - dt);
  for (const z of ctx.state.zombies) {
    const release = releases.get(z);
    if (!release) continue;
    if (!isReleaseBurst(ctx, z)) { releases.delete(z); continue; }
    const x = z.pos.x, pz = z.pos.z;
    let remaining = BALANCE.structures.releaseSpeed * dt;
    while (remaining > 0 && release.index < release.path.length) {
      const p = release.path[release.index], dx = p.x - z.pos.x, dz = p.z - z.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.15) { release.index++; continue; }
      const step = Math.min(remaining, d);
      ctx.collision.moveCircle(z.pos, dx / d * step, dz / d * step, z.radius);
      z.facing = Math.atan2(dx, dz); remaining -= step;
      if (step < d) break;
      release.index++;
    }
    z.vel.x = dt > 0 ? (z.pos.x - x) / dt : 0;
    z.vel.z = dt > 0 ? (z.pos.z - pz) / dt : 0;
    z.anim = Math.hypot(z.vel.x, z.vel.z) > 0.05 ? 'run' : 'idle';
  }
}
