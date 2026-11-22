import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput, type ColliderDef, type GameEvent } from '../src/core/types';
import { createGuard } from '../src/entities/HumanGuard';
import { canMelee, damageGuard } from '../src/systems/CombatSystem';
import { updateHumanAI } from '../src/systems/HumanAISystem';
import { CollisionWorld } from '../src/world/CollisionWorld';
import { NavigationGrid } from '../src/world/NavigationGrid';
import { buildDistrictLayout } from '../src/world/districtLayout';
import { ORIGINAL_DISTRICTS } from '../src/world/layout/grid';
import type { Simulation } from '../src/sim/Simulation';
import { flatSimulation, zombie } from './r2-fixtures';

const dt = BALANCE.sim.fixedDt, input = emptyInput();

function run(sim: Simulation, seconds: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    sim.ctx.zombieHash.clear();
    for (const z of sim.state.zombies) if (z.state !== 'dead' && z.hp > 0) sim.ctx.zombieHash.insert(z.id, z.pos.x, z.pos.z);
    updateHumanAI(sim.ctx, dt, input); sim.state.time += dt;
    for (const g of sim.state.guards) g.animTime += dt;
    events.push(...sim.drainEvents());
  }
  return events;
}

/** Flat test world, optionally with a tank hull collider at the origin (hull long side along z). */
function arena(withHull = false): Simulation {
  const sim = flatSimulation();
  if (withHull) {
    const t = BALANCE.heavy.tank;
    const hull: ColliderDef = { minX: -t.hullWidth / 2, maxX: t.hullWidth / 2, minZ: -t.hullLength / 2, maxZ: t.hullLength / 2,
      tag: 'hull-test', kind: 'vehicle', height: t.hullHeight, blocksMove: true, blocksSight: true };
    sim.ctx.layout = { ...sim.ctx.layout, colliders: [hull] };
    sim.ctx.collision = new CollisionWorld(sim.ctx.layout.bounds, [hull]);
    sim.ctx.navGrid = new NavigationGrid(sim.ctx.collision);
    sim.ctx.crawlNavGrid = new NavigationGrid(sim.ctx.collision);
  }
  sim.state.leader.pos = { x: 55, z: 25 };
  return sim;
}

function heavyGuard(sim: Simulation, heavy: 'mg' | 'tank', facing: number) {
  const g = createGuard(sim.ctx.newId(), { role: 'soldier', post: 'stronghold', pos: { x: 0, z: 0 }, facing, tower: null,
    waypoints: [{ x: 0, z: 0 }], heavy, ...(heavy === 'tank' ? { hullTag: 'hull-test' } : {}) }, sim.ctx.collision);
  sim.state.guards.push(g);
  return g;
}

describe('heavy stronghold weapons', () => {
  it('mounted MG fires fixed-length bursts with a reload gap, and never leaves its emplacement', () => {
    const sim = arena(), g = heavyGuard(sim, 'mg', -Math.PI / 2);
    sim.ctx.rng = { next: () => 0.99 }; // every round misses: the target survives the whole sample
    zombie(sim, -15, 0, { state: 'follower' });
    zombie(sim, -1.2, 0.5, { state: 'follower' }); // right on top of it: an ordinary soldier would back off
    const shots = run(sim, 8).filter((e): e is Extract<GameEvent, { type: 'shot' }> => e.type === 'shot');
    expect(g.maxHp).toBe(BALANCE.heavy.mg.maxHp);
    expect(shots.length).toBeGreaterThanOrEqual(BALANCE.heavy.mg.burstRounds * 2);
    expect(shots.every(s => s.heavy === 'mg')).toBe(true);
    expect(g.pos).toEqual({ x: 0, z: 0 });
    // Shot times from the event order: rounds inside a burst are shotInterval apart, bursts reloadTime apart.
    const times: number[] = [];
    const sim2 = arena(), g2 = heavyGuard(sim2, 'mg', -Math.PI / 2);
    sim2.ctx.rng = { next: () => 0.99 };
    zombie(sim2, -15, 0, { state: 'follower' });
    for (let i = 0; i < Math.round(8 / dt); i++) if (run(sim2, dt).some(e => e.type === 'shot')) times.push(sim2.state.time);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    expect(gaps.filter(d => d >= BALANCE.heavy.mg.reloadTime - 0.02).length).toBeGreaterThanOrEqual(1);
    const firstBurst = gaps.findIndex(d => d >= BALANCE.heavy.mg.reloadTime - 0.02) + 1;
    expect(firstBurst).toBe(BALANCE.heavy.mg.burstRounds);
    expect(gaps.slice(0, firstBurst - 1).every(d => d < BALANCE.heavy.mg.shotInterval + 0.03)).toBe(true);
    expect(g2.pos).toEqual({ x: 0, z: 0 });
  });

  it('tank cannon splashes everyone in the blast radius, falls off with distance and spares those outside', () => {
    const sim = arena(true), g = heavyGuard(sim, 'tank', -Math.PI / 2);
    sim.ctx.rng = { next: () => 0.99 }; // no scatter: the shell lands on the target
    const target = zombie(sim, -25, 0, { state: 'follower' });
    const near = zombie(sim, -25, 1.5, { state: 'follower' });
    const edge = zombie(sim, -25, 3.6, { state: 'follower' });
    const outside = zombie(sim, -25, 6, { state: 'follower' });
    const events = run(sim, BALANCE.heavy.tank.cannonAimDelay + BALANCE.guard.alertToCombatTime + 0.6);
    const blasts = events.filter(e => e.type === 'shellBlast');
    expect(blasts).toHaveLength(1);
    expect(g.maxHp).toBe(BALANCE.heavy.tank.maxHp);
    expect(g.radius).toBe(BALANCE.heavy.tank.radius);
    expect(target.hp).toBeLessThan(near.hp);
    expect(near.hp).toBeLessThan(edge.hp);
    expect(edge.hp).toBeLessThan(BALANCE.walker.maxHp);
    expect(outside.hp).toBe(BALANCE.walker.maxHp);
    expect(g.pos).toEqual({ x: 0, z: 0 });
  });

  it('tank cannot shell attackers hugging the hull, but its coaxial MG keeps firing', () => {
    const sim = arena(true); heavyGuard(sim, 'tank', -Math.PI / 2);
    sim.ctx.rng = { next: () => 0.99 };
    zombie(sim, -4.5, 0, { state: 'follower' });
    const events = run(sim, 4);
    expect(events.filter(e => e.type === 'shellBlast')).toHaveLength(0);
    const coax = events.filter(e => e.type === 'shot' && e.heavy === 'coax');
    expect(coax.length).toBeGreaterThan(5);
  });

  it('zombies touching the hull can claw the crew, and a knocked-out crew climbs out beside the wreck', () => {
    const sim = arena(true), g = heavyGuard(sim, 'tank', 0);
    expect(g.towerColliderId).not.toBeNull();
    const target = { kind: 'guard' as const, id: g.id };
    const t = BALANCE.heavy.tank;
    for (const p of [{ x: t.hullWidth / 2 + 0.45, z: 0 }, { x: 0, z: t.hullLength / 2 + 0.45 }, { x: -t.hullWidth / 2 - 0.45, z: 1.5 }]) {
      expect(canMelee(sim.ctx, p, BALANCE.walker.attackRange, target), JSON.stringify(p)).toBe(true);
    }
    expect(canMelee(sim.ctx, { x: 6, z: 0 }, BALANCE.walker.attackRange, target)).toBe(false);
    damageGuard(sim.ctx, g, g.maxHp, 'zombie');
    const pending = sim.state.pendingConversions.find(p => p.guardId === g.id)!;
    expect(pending).toBeDefined();
    expect(sim.ctx.collision.isBlocked(pending.pos, BALANCE.walker.radius)).toBe(false);
    // The hull collider stays (the wreck keeps blocking).
    expect(sim.ctx.collision.isBlocked({ x: 0, z: 0 }, 0.4)).toBe(true);
  });
});

describe('unique capture points', () => {
  const world = buildDistrictLayout();
  const expansion = world.strongholds.filter(s => !ORIGINAL_DISTRICTS.has(s.districtId));

  it('gives every expansion stronghold its own floor plan', () => {
    const signature = (s: typeof expansion[number]) => {
      const cx = s.center.x, cz = s.center.z, b = s.bounds;
      const inside = (r: { minX: number; maxX: number; minZ: number; maxZ: number }) =>
        r.minX >= b.minX - 0.5 && r.maxX <= b.maxX + 0.5 && r.minZ >= b.minZ - 0.5 && r.maxZ <= b.maxZ + 0.5;
      return JSON.stringify(world.colliders.filter(inside)
        .map(c => [c.kind, +(c.minX - cx).toFixed(1), +(c.minZ - cz).toFixed(1), +(c.maxX - cx).toFixed(1), +(c.maxZ - cz).toFixed(1)])
        .sort());
    };
    const plans = expansion.map(signature);
    expect(new Set(plans).size).toBe(expansion.length);
    // Every plan is more than a single room: extra walls, fences, buildings or cover beyond the 5 room walls + door.
    for (const [i, s] of expansion.entries()) expect(JSON.parse(plans[i]).length, s.id).toBeGreaterThan(8);
  });

  it('arms the hard capture points with mounted MGs and tanks, each tank in its own hull', () => {
    const collision = new CollisionWorld(world.bounds, world.colliders);
    const heavy = (id: string, kind: 'mg' | 'tank') => world.guards.filter(g => g.strongholdId === id && g.heavy === kind).length;
    for (const s of expansion) {
      if (s.defenseTier <= 2) expect(heavy(s.id, 'mg') + heavy(s.id, 'tank'), s.id).toBe(0);
      if (s.defenseTier >= 3) expect(heavy(s.id, 'mg'), s.id).toBeGreaterThanOrEqual(1);
      if (s.defenseTier === 5) expect(heavy(s.id, 'tank'), s.id).toBeGreaterThanOrEqual(1);
    }
    expect(heavy('military_hq', 'tank')).toBe(2);
    for (const g of world.guards.filter(g => g.heavy === 'tank')) {
      const hull = collision.findByTag(g.hullTag!)!;
      expect(g.pos.x).toBeGreaterThan(hull.minX); expect(g.pos.x).toBeLessThan(hull.maxX);
      expect(g.pos.z).toBeGreaterThan(hull.minZ); expect(g.pos.z).toBeLessThan(hull.maxZ);
    }
    // MG nests are open at the back: the gunner can be reached on foot.
    const nav = new NavigationGrid(collision);
    for (const s of world.structures) collision.setEnabled(collision.findByTag(s.tag)!.id, false);
    nav.rebuild();
    for (const g of world.guards.filter(g => g.heavy === 'mg')) {
      const back = { x: g.pos.x - Math.sin(g.facing) * 1.4, z: g.pos.z - Math.cos(g.facing) * 1.4 };
      expect(nav.findPath(world.playerStart, back), `${g.strongholdId} mg`).not.toBeNull();
    }
  }, 60000);
});
