import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import type { GuardAgent, SimInput, Vec2, ZombieAgent } from '../src/core/types';
import { emptyInput } from '../src/core/types';
import { createZombie } from '../src/entities/Zombie';
import { Simulation } from '../src/sim/Simulation';
import { damageGate, damageGuard } from '../src/systems/CombatSystem';
import { applyHordeCommands, killZombie, recruitZombie } from '../src/systems/HordeSystem';
import { isCrawlable } from '../src/world/CollisionWorld';

const dt = BALANCE.sim.fixedDt;
const ref = (g: GuardAgent) => ({ kind: 'guard' as const, id: g.id });
const click = (g: GuardAgent | 'gate'): SimInput =>
  ({ ...emptyInput(), attackTarget: g === 'gate' ? { kind: 'gate' } : ref(g) });

function fixture() {
  const sim = new Simulation(); sim.state.zombies = [];
  for (const g of sim.state.guards) { g.state = 'DEAD'; g.hp = 0; }
  return sim;
}
function living(sim: Simulation, index: number) {
  const g = sim.state.guards[index]; g.state = 'COMBAT'; g.hp = g.maxHp;
  // Keep guards from shooting so tests measure horde behaviour only.
  g.attackCooldown = 1e9; g.perceptionTimer = 1e9;
  return g;
}
function add(sim: Simulation, pos: Vec2): ZombieAgent {
  const z = createZombie(sim.ctx.newId(), pos, { state: 'ambient', variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng });
  sim.state.zombies.push(z); recruitZombie(sim.ctx, z, false); return z;
}
function sizes(sim: Simulation): Map<number, number> {
  const out = new Map<number, number>();
  for (const z of sim.state.zombies) if (z.state === 'follower') out.set(z.squad, (out.get(z.squad) ?? 0) + 1);
  return out;
}

describe('todo 2: toggle-select targets, horde splits evenly', () => {
  it('adds, splits evenly across, and removes selected targets', () => {
    const sim = fixture();
    const a = living(sim, 2), b = living(sim, 3), c = living(sim, 4);
    for (let i = 0; i < 10; i++) add(sim, { x: 60 + (i % 5), z: -10 - Math.floor(i / 5) });
    applyHordeCommands(sim.ctx, dt, click(a));
    expect(sim.state.order).toEqual({ type: 'attack', target: ref(a) });
    expect(sim.state.squads).toHaveLength(0);
    expect([...sizes(sim).values()]).toEqual([10]);

    applyHordeCommands(sim.ctx, dt, click(b));
    expect(sim.state.squads.map(s => s.target)).toEqual([ref(b)]);
    expect([...sizes(sim).values()].sort()).toEqual([5, 5]);

    applyHordeCommands(sim.ctx, dt, click(c));
    const three = [...sizes(sim).values()].sort();
    expect(three).toEqual([3, 3, 4]);

    // Clicking a selected target unselects it; its zombies rejoin the others evenly.
    applyHordeCommands(sim.ctx, dt, click(b));
    expect(sim.state.squads.map(s => s.target)).toEqual([ref(c)]);
    expect([...sizes(sim).values()].sort()).toEqual([5, 5]);

    // Unselecting the primary promotes the next target.
    applyHordeCommands(sim.ctx, dt, click(a));
    expect(sim.state.order).toEqual({ type: 'attack', target: ref(c) });
    expect(sim.state.squads).toHaveLength(0);
    expect([...sizes(sim).entries()]).toEqual([[0, 10]]);

    applyHordeCommands(sim.ctx, dt, click(c));
    expect(sim.state.order).toEqual({ type: 'follow' });
  });

  it('engages each follower with its own group target', () => {
    const sim = fixture();
    const a = living(sim, 2), b = living(sim, 3);
    sim.state.leader.pos = { x: 64, z: -12 };
    for (let i = 0; i < 8; i++) add(sim, { x: 60 + i, z: -10 });
    sim.step(dt, click(a)); sim.step(dt, click(b));
    for (const z of sim.state.zombies) {
      const expected = z.squad === 0 ? ref(a) : ref(b);
      expect(sim.ctx.nav.squads.size).toBe(1);
      expect(z.engageTarget?.kind === 'gate' || JSON.stringify(z.engageTarget) === JSON.stringify(expected)).toBe(true);
    }
  });

  it('redistributes when a selected target dies, and keeps groups balanced as followers die or join', () => {
    const sim = fixture();
    const a = living(sim, 2), b = living(sim, 3);
    for (let i = 0; i < 10; i++) add(sim, { x: 60 + i, z: -10 });
    applyHordeCommands(sim.ctx, dt, click(a));
    applyHordeCommands(sim.ctx, dt, click(b));
    // Kill four of group 0: upkeep moves one zombie per step until within one of each other.
    let killed = 0;
    for (const z of sim.state.zombies) if (z.squad === 0 && killed < 4) { killZombie(sim.ctx, z); killed++; }
    for (let i = 0; i < 4; i++) applyHordeCommands(sim.ctx, dt, emptyInput());
    const counts = [...sizes(sim).values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    // A new recruit joins the smaller group.
    add(sim, { x: 60, z: -11 }); applyHordeCommands(sim.ctx, dt, emptyInput());
    expect([...sizes(sim).values()].sort()).toEqual([3, 4]);

    damageGuard(sim.ctx, a, 1000, 'other'); sim.drainEvents();
    applyHordeCommands(sim.ctx, dt, emptyInput());
    expect(sim.state.order).toEqual({ type: 'attack', target: ref(b) });
    expect(sim.state.squads).toHaveLength(0);
    expect([...sizes(sim).entries()]).toEqual([[0, 7]]);
    expect(sim.drainEvents().filter(e => e.type === 'orderChanged')).toHaveLength(1);
  });

  it('recall (right-click) clears every selected target', () => {
    const sim = fixture();
    const a = living(sim, 2), b = living(sim, 3);
    for (let i = 0; i < 4; i++) add(sim, { x: 60 + i, z: -10 });
    applyHordeCommands(sim.ctx, dt, click(a)); applyHordeCommands(sim.ctx, dt, click(b));
    applyHordeCommands(sim.ctx, dt, { ...emptyInput(), recall: true });
    expect(sim.state.order).toEqual({ type: 'follow' });
    expect(sim.state.squads).toHaveLength(0);
    expect(sim.state.zombies.every(z => z.squad === 0)).toBe(true);
  });
});

describe('todo 3: zombies climb watchtowers', () => {
  /** Breached compound with only the west tower occupant alive; leader inside. */
  function towerFixture() {
    const sim = fixture();
    damageGate(sim.ctx, BALANCE.gate.maxHp); sim.drainEvents();
    const tower = living(sim, 0);
    sim.state.leader.pos = { x: 69, z: -60 };
    return { sim, tower };
  }
  it('climbs to the platform before it can hurt the occupant', () => {
    const { sim, tower } = towerFixture();
    const z = add(sim, { x: tower.pos.x + 5.5, z: tower.pos.z });
    sim.step(dt, click(tower));
    let firstHitElevation = -1;
    for (let i = 0; i < 600 && firstHitElevation < 0; i++) {
      sim.step(dt, emptyInput());
      if (tower.hp < tower.maxHp) firstHitElevation = z.elevation;
      if (z.elevation > 0.05 && z.elevation < tower.elevation - 0.25) expect(tower.hp).toBe(tower.maxHp);
    }
    expect(firstHitElevation).toBeGreaterThanOrEqual(tower.elevation - 0.25);
    const climbTime = tower.elevation / BALANCE.guard.towerClimbSpeed;
    expect(sim.state.time).toBeGreaterThanOrEqual(climbTime);
  });

  it('limits how many zombies climb one tower at once', () => {
    const { sim, tower } = towerFixture();
    const pack = Array.from({ length: 10 }, (_, i) =>
      add(sim, { x: tower.pos.x + 4 + (i % 3) * 0.8, z: tower.pos.z - 1 + Math.floor(i / 3) * 0.8 }));
    sim.step(dt, click(tower));
    for (let i = 0; i < 360; i++) {
      sim.step(dt, emptyInput());
      expect(pack.filter(z => z.state === 'follower' && z.elevation > 0.05).length)
        .toBeLessThanOrEqual(BALANCE.guard.towerMaxClimbers);
    }
    expect(pack.some(z => z.elevation > 0.05)).toBe(true);
  });

  it('the leader cannot claw a tower occupant from the ground', () => {
    const { sim, tower } = towerFixture();
    sim.state.leader.pos = { x: tower.pos.x + 2.1, z: tower.pos.z };
    for (let i = 0; i < 300; i++) sim.step(dt, emptyInput());
    expect(tower.hp).toBe(tower.maxHp);
  });
});

describe('todo 4: packed zombies crawl over cars', () => {
  function carScenario(count: number) {
    const sim = fixture();
    const car = sim.ctx.collision.colliders.find(c => c.kind === 'vehicle' && isCrawlable(c) &&
      // Open ground on both long sides so the test only measures the crawl.
      !sim.ctx.collision.isBlocked({ x: c.minX - 3, z: (c.minZ + c.maxZ) / 2 }, 1.5) &&
      !sim.ctx.collision.isBlocked({ x: c.maxX + 3, z: (c.minZ + c.maxZ) / 2 }, 1.5))!;
    expect(car).toBeDefined();
    const cz = (car.minZ + car.maxZ) / 2;
    sim.state.leader.pos = { x: car.maxX + 3, z: cz };
    const zs = Array.from({ length: count }, (_, i) =>
      add(sim, { x: car.minX - 1 - (i % 3) * 0.7, z: cz - 0.7 + Math.floor(i / 3) * 0.7 }));
    for (const z of zs) z.followOffset = { x: 0, z: 0 };
    return { sim, car, zs };
  }

  it('a packed horde goes straight over a car, standing on its roof on the way', () => {
    const { sim, car, zs } = carScenario(9);
    let maxElevation = 0;
    for (let i = 0; i < 240; i++) {
      sim.step(dt, emptyInput());
      for (const z of zs) {
        maxElevation = Math.max(maxElevation, z.elevation);
        expect(sim.ctx.collision.isBlocked(z.pos, z.radius, isCrawlable)).toBe(false);
      }
    }
    expect(maxElevation).toBeGreaterThan(0.5);
    expect(maxElevation).toBeLessThanOrEqual(car.height);
    expect(zs.filter(z => z.pos.x > car.maxX).length).toBeGreaterThanOrEqual(6);
  });

  it('a lone zombie cannot crawl over a car', () => {
    const { sim, zs } = carScenario(1);
    for (let i = 0; i < 240; i++) {
      sim.step(dt, emptyInput());
      expect(zs[0].elevation).toBe(0);
      expect(sim.ctx.collision.isBlocked(zs[0].pos, zs[0].radius)).toBe(false);
    }
  });
});
