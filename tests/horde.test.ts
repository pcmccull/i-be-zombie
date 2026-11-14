import { describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import type { SimInput, Vec2 } from '../src/core/types';
import { createZombie } from '../src/entities/Zombie';
import { Simulation } from '../src/sim/Simulation';
import { applyHordeCommands, countFollowers, killZombie, recruitZombie, updateHorde } from '../src/systems/HordeSystem';
import { isTargetAlive, resolveTargetPos } from '../src/systems/CombatSystem';
import { updateNavigation } from '../src/systems/NavigationSystem';
import { checkVictory } from '../src/systems/VictorySystem';
import { dist } from '../src/utils/math';
import { buildDistrictLayout } from '../src/world/districtLayout';
import { isCrawlable } from '../src/world/CollisionWorld';

const dt = BALANCE.sim.fixedDt;
function add(sim: Simulation, pos: Vec2, follower = true) {
  const z = createZombie(sim.ctx.newId(), pos, { state: 'ambient', variant: 0, spawnZone: 0, isConverted: false, rng: sim.ctx.rng });
  sim.state.zombies.push(z);
  if (follower) recruitZombie(sim.ctx, z, false);
  return z;
}
function run(sim: Simulation, steps: number, input = emptyInput()) {
  for (let i = 0; i < steps; i++) sim.step(dt, input);
}

describe('horde commands and guidance', () => {
  it('transitions attack/recall, ignores invalid targets, and clears dead orders', () => {
    const sim = new Simulation();
    const guard = sim.state.guards[5];
    const z = sim.state.zombies[0]; recruitZombie(sim.ctx, z, false);
    sim.step(dt, { ...emptyInput(), attackTarget: { kind: 'guard', id: guard.id } });
    expect(sim.state.order).toEqual({ type: 'attack', target: { kind: 'guard', id: guard.id } });
    expect(z.engageTarget).toEqual({ kind: 'guard', id: guard.id });
    sim.step(dt, { ...emptyInput(), recall: true });
    expect(sim.state.order.type).toBe('follow'); expect(z.engageTarget).toBeNull();
    expect(sim.ctx.nav.attackField).toBeNull(); expect(sim.ctx.nav.effectiveTarget).toBeNull();
    sim.step(dt, { ...emptyInput(), attackTarget: { kind: 'leader' } });
    expect(sim.state.order.type).toBe('follow');
    sim.step(dt, { ...emptyInput(), attackTarget: { kind: 'guard', id: guard.id } });
    guard.state = 'DEAD'; guard.hp = 0;
    sim.step(dt, emptyInput());
    // §15.15 (+ B1 succession): the dead target is never kept; a successor must be a different living guard.
    const succ = sim.state.order;
    if (succ.type === 'attack') {
      expect(succ.target.kind).toBe('guard');
      const next = sim.state.guards.find(g => succ.target.kind === 'guard' && g.id === succ.target.id)!;
      expect(next.id).not.toBe(guard.id); expect(next.state).not.toBe('DEAD');
    }
    expect(z.engageTarget).not.toEqual({ kind: 'guard', id: guard.id });
    sim.step(dt, { ...emptyInput(), attackTarget: { kind: 'gate' } });
    sim.state.gate.destroyed = true; sim.state.gate.hp = 0;
    sim.step(dt, emptyInput());
    const afterGate = sim.state.order;
    expect(afterGate.type === 'follow' || (afterGate.type === 'attack' && afterGate.target.kind === 'guard')).toBe(true);
    expect(sim.drainEvents().filter(e => e.type === 'orderChanged').length).toBeGreaterThanOrEqual(6);
  });

  it('redirects an enclosed guard to gate approaches, then routes through the open gate', () => {
    const sim = new Simulation();
    const g = sim.state.guards[2];
    sim.step(dt, { ...emptyInput(), attackTarget: { kind: 'guard', id: g.id } });
    expect(sim.ctx.nav.effectiveTarget).toEqual({ kind: 'gate' });
    expect(sim.ctx.nav.attackField!.goals.length).toBeGreaterThan(1);
    for (const goal of sim.ctx.nav.attackField!.goals) expect(goal.z).toBeGreaterThan(sim.state.gate.rect.maxZ);
    sim.state.gate.destroyed = true; sim.state.gate.hp = 0;
    sim.ctx.collision.setEnabled(sim.state.gate.colliderId, false); sim.ctx.navGrid.rebuild();
    sim.step(dt, emptyInput());
    expect(sim.ctx.nav.effectiveTarget).toEqual({ kind: 'guard', id: g.id });
    expect(sim.ctx.nav.attackField!.distanceAt(sim.state.leader.pos)).toBeLessThan(Infinity);
    expect(sim.ctx.nav.attackField!.navVersion).toBe(sim.ctx.navGrid.version);
  });

  it('builds reachable tower base goals and rejects an unrelated enclosure as a gate blocker', () => {
    for (const index of [0, 1]) {
      const intact = new Simulation();
      intact.step(dt, { ...emptyInput(), attackTarget: { kind: 'guard', id: intact.state.guards[index].id } });
      expect(intact.ctx.nav.effectiveTarget).toEqual({ kind: 'gate' });
    }
    const layout = buildDistrictLayout();
    layout.colliders.push({ minX: -100, maxX: -70, minZ: 45, maxZ: 46, height: 3, blocksMove: true, blocksSight: true, kind: 'wall' },
      { minX: -100, maxX: -70, minZ: 77, maxZ: 78, height: 3, blocksMove: true, blocksSight: true, kind: 'wall' },
      { minX: -100, maxX: -99, minZ: 45, maxZ: 78, height: 3, blocksMove: true, blocksSight: true, kind: 'wall' },
      { minX: -71, maxX: -70, minZ: 45, maxZ: 78, height: 3, blocksMove: true, blocksSight: true, kind: 'wall' });
    const sim = new Simulation(layout);
    sim.step(dt, { ...emptyInput(), attackTarget: { kind: 'guard', id: sim.state.guards[5].id } });
    expect(sim.ctx.nav.effectiveTarget?.kind).toBe('guard');
    const open = new Simulation();
    open.state.gate.destroyed = true; open.state.gate.hp = 0;
    open.ctx.collision.setEnabled(open.state.gate.colliderId, false); open.ctx.navGrid.rebuild();
    open.step(dt, { ...emptyInput(), attackTarget: { kind: 'guard', id: open.state.guards[0].id } });
    expect(open.ctx.nav.effectiveTarget?.kind).toBe('guard');
    for (const p of open.ctx.nav.attackField!.goals) expect(open.ctx.collision.isBlocked(p, 0.4)).toBe(false);
    expect(open.ctx.nav.attackField!.distanceAt(open.state.leader.pos)).toBeLessThan(Infinity);
  });

  it('throttles moving-goal replans and immediately responds to orders and grid changes', () => {
    const sim = new Simulation();
    const spy = vi.spyOn(sim.ctx.navGrid, 'buildFlowField');
    updateNavigation(sim.ctx, dt, emptyInput()); expect(spy).toHaveBeenCalledTimes(1);
    sim.state.leader.pos.x += 3;
    for (let i = 0; i < 10; i++) updateNavigation(sim.ctx, dt, emptyInput());
    expect(spy).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) updateNavigation(sim.ctx, dt, emptyInput());
    expect(spy).toHaveBeenCalledTimes(2);
    sim.state.order = { type: 'attack', target: { kind: 'guard', id: sim.state.guards[5].id } };
    updateNavigation(sim.ctx, dt, emptyInput()); expect(spy).toHaveBeenCalledTimes(3);
    sim.ctx.navGrid.rebuild(); updateNavigation(sim.ctx, dt, emptyInput());
    expect(spy).toHaveBeenCalledTimes(5);
  });

  it('auto-engages only reachable living guards, disengages far away, and stops in melee range', () => {
    const sim = new Simulation(); sim.state.zombies = []; sim.state.followerCount = 0;
    const g = sim.state.guards[5];
    // Isolate horde steering: live guard AI otherwise backs away and shoots this follower dead.
    for (const guard of sim.state.guards) {
      guard.attackCooldown = 1e9; guard.perceptionTimer = 1e9; guard.idleTimer = 1e9;
      if (guard !== g) guard.pos = { x: 110, z: -75 };
    }
    sim.state.leader.pos = { x: g.pos.x, z: g.pos.z + 6 };
    const z = add(sim, { x: g.pos.x, z: g.pos.z + 1.8 });
    run(sim, 60); expect(z.engageTarget).toEqual({ kind: 'guard', id: g.id });
    expect(Math.hypot(z.vel.x, z.vel.z)).toBeLessThan(0.1);
    sim.state.leader.pos = { x: -85, z: 62 };
    sim.step(dt, emptyInput()); expect(z.engageTarget).toBeNull();
    sim.state.leader.pos = { x: 83, z: -47 };
    z.pos = { x: 83, z: -50.5 }; g.pos = { x: 83, z: -55.5 };
    // The gate blocks auto-engagement even though horizontal distance is short.
    for (const other of sim.state.guards) if (other !== g) { other.state = 'DEAD'; other.hp = 0; }
    sim.step(dt, emptyInput()); expect(z.engageTarget).toBeNull();
    g.state = 'DEAD'; g.hp = 0; expect(isTargetAlive(sim.ctx, { kind: 'guard', id: g.id })).toBe(false);
  });

  it('rush lasts four seconds, has a fifteen second cooldown, and preserves order and ambient speed', () => {
    const normal = new Simulation(), rushed = new Simulation();
    for (const sim of [normal, rushed]) {
      sim.state.zombies = []; sim.state.followerCount = 0;
      const z = add(sim, { x: -85, z: 50 }); z.speedScale = 1; z.followOffset = { x: 0, z: 0 };
      add(sim, { x: -60, z: 48 }, false);
    }
    applyHordeCommands(rushed.ctx, dt, { ...emptyInput(), rush: true });
    expect(rushed.state.order.type).toBe('follow'); expect(rushed.state.abilities.rushCooldown).toBe(15);
    for (let i = 0; i < 40; i++) {
      for (const sim of [normal, rushed]) { updateNavigation(sim.ctx, dt, emptyInput()); updateHorde(sim.ctx, dt, emptyInput()); }
    }
    expect(Math.hypot(rushed.state.zombies[0].vel.x, rushed.state.zombies[0].vel.z) /
      Math.hypot(normal.state.zombies[0].vel.x, normal.state.zombies[0].vel.z)).toBeCloseTo(1.45, 6);
    expect(rushed.state.zombies[1].pos).toEqual(normal.state.zombies[1].pos);
    for (let i = 0; i < 239; i++) applyHordeCommands(rushed.ctx, dt, emptyInput());
    expect(rushed.state.abilities.rushTimeLeft).toBeGreaterThan(0);
    applyHordeCommands(rushed.ctx, dt, emptyInput()); expect(rushed.state.abilities.rushTimeLeft).toBe(0);
    expect(rushed.drainEvents().filter(e => e.type === 'rushEnd')).toHaveLength(1);
    applyHordeCommands(rushed.ctx, dt, { ...emptyInput(), rush: true });
    expect(rushed.state.abilities.rushTimeLeft).toBe(0);
    for (let i = 0; i < 660; i++) applyHordeCommands(rushed.ctx, dt, emptyInput());
    applyHordeCommands(rushed.ctx, dt, { ...emptyInput(), rush: true });
    expect(rushed.state.abilities.rushTimeLeft).toBe(4);
    rushed.state.order = { type: 'attack', target: { kind: 'gate' } };
    rushed.state.abilities.rushCooldown = 0;
    applyHordeCommands(rushed.ctx, dt, { ...emptyInput(), rush: true }); expect(rushed.state.order.type).toBe('attack');
  });

  it('reaches a tower occupant from outside auto-melee range without walking into its collider', () => {
    const sim = new Simulation(); sim.state.zombies = []; sim.state.followerCount = 0;
    sim.state.gate.destroyed = true; sim.state.gate.hp = 0;
    sim.ctx.collision.setEnabled(sim.state.gate.colliderId, false); sim.ctx.navGrid.rebuild();
    const g = sim.state.guards[0];
    for (const other of sim.state.guards) if (other !== g) { other.state = 'DEAD'; other.hp = 0; }
    sim.state.leader.pos = { x: 69, z: -60 };
    const z = add(sim, { x: g.pos.x + 5.5, z: g.pos.z });
    run(sim, 180);
    expect(z.engageTarget).toEqual({ kind: 'guard', id: g.id });
    expect(dist(z.pos, g.pos)).toBeLessThanOrEqual(BALANCE.walker.attackRange + g.radius + BALANCE.guard.towerMeleeReachBonus);
    expect(sim.ctx.collision.isBlocked(z.pos, z.radius)).toBe(false);
  });

  it('spreads exact-overlap recruits and preserves hit animations until their clip finishes', () => {
    const sim = new Simulation(); sim.state.zombies = []; sim.state.followerCount = 0;
    const a = add(sim, { ...sim.state.leader.pos }), b = add(sim, { ...sim.state.leader.pos });
    a.followOffset = { x: 0, z: 0 }; b.followOffset = { x: 0, z: 0 };
    a.anim = 'hit'; a.animTime = 0.1;
    sim.step(dt, emptyInput()); expect(a.anim).toBe('hit');
    run(sim, 180);
    expect(dist(a.pos, b.pos)).toBeGreaterThanOrEqual(0.6);
    expect(a.state).toBe('follower'); expect(b.state).toBe('follower');
    expect(a.anim).not.toBe('hit');
  });
});

describe('horde integration', () => {
  it('leads forty recruits around blocks and through the north alley into a broad separated pack', () => {
    const sim = new Simulation(buildDistrictLayout(), 24);
    sim.state.guards = sim.state.guards.filter(g => g.post === 'checkpoint');
    // This route measures following and separation without combat interference.
    for (const guard of sim.state.guards) {
      guard.attackCooldown = 1e9; guard.perceptionTimer = 1e9; guard.idleTimer = 1e9;
      guard.pos = { x: 110, z: -75 };
    }
    sim.state.zombies = sim.state.zombies.slice(0, 40);
    sim.state.followerCount = 0;
    for (const z of sim.state.zombies) z.heldBy = 0;
    sim.state.zombies.forEach((z, i) => {
      z.pos.x = -89 + (i % 8) * 1.1; z.pos.z = 59 + Math.floor(i / 8) * 1.1;
      z.prevPos = { ...z.pos };
    });
    sim.step(dt, emptyInput()); expect(sim.state.followerCount).toBe(40);
    // The route goes around the commercial block and crosses the entire service alley.
    const stops = [{ x: -45, z: 30 }, { x: -45, z: -30 }, { x: -45, z: -60 },
      { x: 32, z: -60 }, { x: 35, z: -40 }, { x: 62, z: -30 }, { x: 62, z: -12 }];
    for (const stop of stops) {
      const path = sim.ctx.navGrid.findPath(sim.state.leader.pos, stop);
      expect(path, `path ${JSON.stringify(sim.state.leader.pos)} -> ${JSON.stringify(stop)}`).not.toBeNull();
      for (const point of path!) {
        let steps = 0;
        while (dist(sim.state.leader.pos, point) > 0.4 && steps++ < 2000) {
          const dx = point.x - sim.state.leader.pos.x, dz = point.z - sim.state.leader.pos.z;
          const d = Math.hypot(dx, dz);
          sim.step(dt, { ...emptyInput(), moveForward: dz / d, moveRight: -dx / d });
          // Packed followers may crawl over cars/barriers, but never through walls or buildings.
          for (const z of sim.state.zombies) expect(sim.ctx.collision.isBlocked(z.pos, z.radius, isCrawlable)).toBe(false);
        }
        expect(steps).toBeLessThan(2000);
      }
    }
    run(sim, 600);
    const followers = sim.state.zombies.filter(z => z.state === 'follower');
    expect(followers).toHaveLength(40); expect(sim.state.followerCount).toBe(countFollowers(sim.state));
    expect(followers.filter(z => dist(z.pos, sim.state.leader.pos) <= 25).length).toBeGreaterThanOrEqual(34);
    const pack = followers.filter(z => dist(z.pos, sim.state.leader.pos) < 15);
    expect(pack.length).toBeGreaterThanOrEqual(34);
    const nearest = pack.map(z => Math.min(...pack.filter(o => o !== z).map(o => dist(z.pos, o.pos))));
    expect(nearest.reduce((sum, d) => sum + d, 0) / nearest.length).toBeGreaterThanOrEqual(0.6);
    // Project the pack onto its covariance eigenvectors, rather than world axes.
    const mx = pack.reduce((s, z) => s + z.pos.x, 0) / pack.length;
    const mz = pack.reduce((s, z) => s + z.pos.z, 0) / pack.length;
    let xx = 0, xz = 0, zz = 0;
    for (const z of pack) { const x = z.pos.x - mx, pz = z.pos.z - mz; xx += x * x; xz += x * pz; zz += pz * pz; }
    const a = Math.atan2(2 * xz, xx - zz) / 2;
    for (const angle of [a, a + Math.PI / 2]) {
      const projections = pack.map(z => z.pos.x * Math.cos(angle) + z.pos.z * Math.sin(angle));
      expect(Math.max(...projections) - Math.min(...projections)).toBeGreaterThan(2.5);
    }
    for (const z of followers) expect(sim.ctx.collision.isBlocked(z.pos, z.radius)).toBe(false);
    console.log(`City route: ${pack.length}/40 within 15m; mean nearest neighbor ${(nearest.reduce((s, d) => s + d, 0) / nearest.length).toFixed(2)}m`);
  }, 30000);

  it('is deterministic for 600 scripted steps and reset restores every state and blocker', () => {
    const a = new Simulation(buildDistrictLayout(), 81), b = new Simulation(buildDistrictLayout(), 81);
    for (let i = 0; i < 600; i++) {
      const input: SimInput = { ...emptyInput(), moveForward: Math.sin(i / 90), moveRight: Math.cos(i / 90),
        cameraYaw: i / 300, sprint: i % 120 < 40, rally: i === 1, rush: i === 200 };
      a.step(dt, input); b.step(dt, input);
    }
    expect(a.state).toEqual(b.state); expect(a.drainEvents()).toEqual(b.drainEvents());
    a.state.gate.destroyed = true; a.ctx.collision.setEnabled(a.state.gate.colliderId, false); a.ctx.navGrid.rebuild();
    a.reset();
    const fresh = new Simulation(buildDistrictLayout(), 81);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(fresh.state));
    expect(a.ctx.collision.findByTag('gate')?.enabled).toBe(true);
    expect(a.ctx.nav).toEqual(fresh.ctx.nav); expect(a.ctx.navGrid.version).toBe(fresh.ctx.navGrid.version);
    expect(a.drainEvents()).toEqual([]);
    run(a, 60, { ...emptyInput(), moveRight: -1 }); run(fresh, 60, { ...emptyInput(), moveRight: -1 });
    expect(a.state).toEqual(fresh.state);
    a.reset(82); expect(a.state).toEqual(new Simulation(buildDistrictLayout(), 82).state);
  });

  it('simulates one hundred followers for 600 moving-leader steps in under three seconds', () => {
    const sim = new Simulation(); sim.state.zombies = []; sim.state.followerCount = 0;
    // Measure steering with the same absence of nearby combat as the original checkpoint-only opening.
    sim.state.guards = sim.state.guards.filter(g => g.post === 'checkpoint');
    for (let i = 0; i < 100; i++) add(sim, { x: -95 + i % 10 * 1.1, z: 59 + Math.floor(i / 10) * 1.1 });
    const start = performance.now();
    run(sim, 600, { ...emptyInput(), moveRight: -1 });
    const elapsed = performance.now() - start;
    console.log(`100 followers, 600 steps: ${elapsed.toFixed(1)}ms (${(elapsed / 600).toFixed(3)}ms/step)`);
    expect(sim.state.followerCount).toBe(100); expect(elapsed).toBeLessThan(3000);
  });
});

describe('target and phase lifecycle', () => {
  it('validates every target kind and refuses dead, destroyed, and missing targets', () => {
    const sim = new Simulation(), out = { x: 0, z: 0 };
    expect(resolveTargetPos(sim.ctx, { kind: 'leader' }, out)).toBe(true); expect(out).toEqual(sim.state.leader.pos);
    expect(isTargetAlive(sim.ctx, { kind: 'gate' })).toBe(true);
    expect(isTargetAlive(sim.ctx, { kind: 'guard', id: -1 })).toBe(false);
    expect(isTargetAlive(sim.ctx, { kind: 'zombie', id: -1 })).toBe(false);
    const z = sim.state.zombies[0]; expect(isTargetAlive(sim.ctx, { kind: 'zombie', id: z.id })).toBe(true);
    killZombie(sim.ctx, z); expect(isTargetAlive(sim.ctx, { kind: 'zombie', id: z.id })).toBe(false);
    sim.state.leader.alive = false; expect(isTargetAlive(sim.ctx, { kind: 'leader' })).toBe(false);
    sim.state.gate.destroyed = true; expect(isTargetAlive(sim.ctx, { kind: 'gate' })).toBe(false);
  });

  it('requires both victory objectives, gives defeat priority, and emits phase transitions once', () => {
    const sim = new Simulation();
    for (const g of sim.state.guards) g.state = 'DEAD';
    checkVictory(sim.ctx); expect(sim.state.phase).toBe('playing');
    sim.state.gate.destroyed = true; checkVictory(sim.ctx); checkVictory(sim.ctx);
    expect(sim.state.phase).toBe('victory'); expect(sim.drainEvents()).toEqual([{ type: 'victory' }]);
    sim.reset(); sim.state.gate.destroyed = true; checkVictory(sim.ctx); expect(sim.state.phase).toBe('playing');
    for (const g of sim.state.guards) g.state = 'DEAD';
    sim.state.leader.alive = false; checkVictory(sim.ctx); checkVictory(sim.ctx);
    expect(sim.state.phase).toBe('defeat'); expect(sim.drainEvents()).toEqual([{ type: 'defeat' }]);
  });

  it('copies interpolation state first and freezes gameplay after game over while corpses fade', () => {
    const sim = new Simulation(); const z = sim.state.zombies[0];
    killZombie(sim.ctx, z); sim.state.leader.alive = false;
    sim.step(dt, emptyInput()); const time = sim.state.time;
    const pos = { ...sim.state.leader.pos };
    sim.state.abilities.rushCooldown = 10;
    run(sim, 361, { ...emptyInput(), moveForward: 1, rally: true, rush: true });
    expect(sim.state.time).toBe(time); expect(sim.state.leader.pos).toEqual(pos);
    expect(sim.state.leader.prevPos).toEqual(pos); expect(sim.state.abilities.rushCooldown).toBe(10);
    expect(sim.state.zombies.includes(z)).toBe(false);
    const events = sim.drainEvents(); expect(events.filter(e => e.type === 'defeat')).toHaveLength(1);
    expect(sim.drainEvents()).toEqual([]);
  });
});
