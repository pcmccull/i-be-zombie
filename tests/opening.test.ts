import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import type { Vec2 } from '../src/core/types';
import { Simulation } from '../src/sim/Simulation';
import { countFollowers, killZombie } from '../src/systems/HordeSystem';
import { buildLegacyDistrictLayout as buildDistrictLayout } from '../src/world/legacyDistrictLayout';
import { isCrawlable } from '../src/world/CollisionWorld';
import { distance, dt, zombie } from './r2-fixtures';

describe('opening recruitment pacing', () => {
  it('starts with five, reaches a human within ten walking seconds, and builds at least thirty followers by 60 seconds', () => {
    const sim = new Simulation(buildDistrictLayout(), 1337);
    expect(sim.state.followerCount).toBe(5);
    const humanPaths = sim.state.guards.map(g => sim.ctx.navGrid.findPath(sim.state.leader.pos, g.pos))
      .filter((path): path is Vec2[] => path !== null);
    const firstDistance = Math.min(...humanPaths.map(path => {
      let length = 0, previous = sim.state.leader.pos;
      for (const p of path) { length += distance(previous, p); previous = p; }
      return length;
    }));
    expect(firstDistance / BALANCE.leader.walkSpeed).toBeLessThanOrEqual(10);

    // Fixed destinations, normal controls and one click per door; no scripted damage/recruitment.
    const route = [
      { pos: { x: -65.75, z: 34.2 }, wait: 6, structure: 1 },
      { pos: { x: -5, z: 64 }, wait: 2, structure: 0 },
      { pos: { x: 6.8, z: 35.2 }, wait: 6, structure: 4 },
      // The police barricade is high risk: a reasonable player orders the horde onto its two soldiers.
      { pos: { x: 12, z: 30 }, wait: 8, structure: 0, post: 'barricade' as const },
      { pos: { x: 70, z: 19.2 }, wait: 6, structure: 2 },
      { pos: { x: 52.5, z: 40.8 }, wait: 10, structure: 3 },
    ];
    let stop = 0, path: Vec2[] = [], point = 0, waiting = 0, clicked = false, arrived = false;
    const clickedGuards = new Set<number>();
    const counts: number[] = [], momentum: number[] = []; let reachedThirtyAt = Infinity;
    const start = performance.now();
    for (let step = 1; step <= 90 * 60; step++) {
      const input = emptyInput(), destination = route[Math.min(stop, route.length - 1)];
      if (!path.length && !arrived) {
        path = sim.ctx.navGrid.findPath(sim.state.leader.pos, destination.pos)!; point = 0;
        expect(path).not.toBeNull();
      }
      while (point < path.length && distance(sim.state.leader.pos, path[point]) < 0.35) point++;
      if (point < path.length && !arrived) {
        const p = path[point]; input.cameraYaw = Math.atan2(p.x - sim.state.leader.pos.x, p.z - sim.state.leader.pos.z);
        input.moveForward = Math.min(1, distance(p, sim.state.leader.pos) / (BALANCE.leader.walkSpeed * dt));
      } else { arrived = true; waiting += dt; }
      if (destination.structure && !clicked && distance(sim.state.leader.pos, destination.pos) < 12) {
        input.attackTarget = { kind: 'structure', id: destination.structure }; clicked = true;
      }
      if ('post' in destination && !input.attackTarget && distance(sim.state.leader.pos, destination.pos) < 16) {
        const g = sim.state.guards.find(h => h.post === destination.post && h.state !== 'DEAD' && !clickedGuards.has(h.id));
        if (g) { input.attackTarget = { kind: 'guard', id: g.id }; clickedGuards.add(g.id); }
      }
      const cleared = !('post' in destination) ||
        sim.state.guards.every(h => h.post !== destination.post || h.state === 'DEAD');
      if (arrived && (waiting >= destination.wait || (cleared && 'post' in destination)) && stop < route.length - 1) {
        stop++; path = []; point = 0; waiting = 0; clicked = false; arrived = false; input.recall = true;
      }
      input.rally = sim.state.abilities.rallyCooldown <= 0;
      sim.step(dt, input); sim.drainEvents();
      if (sim.state.followerCount !== countFollowers(sim.state) || sim.state.followerCount > BALANCE.horde.maxFollowers)
        throw new Error(`Follower invariant failed at opening step ${step}`);
      if (sim.state.followerCount >= 30) reachedThirtyAt = Math.min(reachedThirtyAt, step * dt);
      if (step % 1800 === 0) counts.push(sim.state.followerCount);
      if (step % 600 === 0) momentum.push(Math.round(sim.state.momentum.value));
    }
    console.log(`Opening autopilot 30/60/90s: ${counts.join('/')}; momentum@10s: ${momentum.join(',')}; first 30 at ${reachedThirtyAt.toFixed(2)}s; runtime ${(performance.now() - start).toFixed(1)}ms; phase=${sim.state.phase}; stop=${stop}; structures=${sim.state.structures.map(s => `${s.kind}:${s.hp}`).join(',')}`);
    // The route opens every landmark with normal orders (bus, pen, alley, store), not just the bus.
    expect(sim.state.structures.every(s => s.destroyed)).toBe(true);
    expect(reachedThirtyAt).toBeLessThanOrEqual(60);
    expect(counts[1]).toBeGreaterThanOrEqual(30);
    expect(counts[1]).toBeLessThanOrEqual(60); // spec: ~30-50 by 60 s for reasonably effective play (autopilot is near-optimal)
    expect(sim.state.phase).toBe('playing');
  }, 30000); // 5400 full-world steps: ~4 s alone, slower under parallel suite load; not a perf test

  it('bounds a forty-zombie cascade into a hundred-follower crowd for 600 steps under three seconds', () => {
    const sim = new Simulation(); sim.state.zombies = []; sim.state.followerCount = 0;
    sim.state.guards = sim.state.guards.filter(g => g.post === 'checkpoint');
    for (let i = 0; i < 100; i++) zombie(sim, -95 + i % 10 * 1.1, 59 + Math.floor(i / 10) * 1.1,
      { state: 'follower', recruitGen: 0, pulseAt: i < 6 ? 0 : -1 });
    for (let i = 0; i < 40; i++) zombie(sim, -93 + i % 8 * 0.6, 58 + Math.floor(i / 8) * 0.6);
    const input = { ...emptyInput(), moveRight: -1 };
    const start = performance.now(); let recruited = 0;
    for (let step = 0; step < 600; step++) {
      // A full crowd initially refuses the cascade. Forty casualties then open forty slots.
      if (step === 1) {
        for (const z of sim.state.zombies.slice(60, 100)) killZombie(sim.ctx, z);
        for (const z of sim.state.zombies.slice(0, 6)) z.pulseAt = sim.state.time;
        sim.state.leader.pos.x = -110; // keep this a pulse test, outside passive recruitment range
        input.moveRight = 0;
      }
      sim.step(dt, input);
      const events = sim.drainEvents();
      if (step === 1) recruited = events.filter(e => e.type === 'recruited' && e.generation === 1).length;
      if (sim.state.followerCount !== countFollowers(sim.state) || sim.state.followerCount > BALANCE.horde.maxFollowers)
        throw new Error(`Follower invariant failed at stress step ${step}`);
      for (const z of sim.state.zombies) {
        if (!Number.isFinite(z.pos.x) || !Number.isFinite(z.pos.z) || Math.hypot(z.vel.x, z.vel.z) >= 20 ||
            sim.ctx.collision.isBlocked(z.pos, z.radius, isCrawlable))
          throw new Error(`Invalid crowd motion for zombie ${z.id} at stress step ${step}`);
      }
    }
    const elapsed = performance.now() - start;
    console.log(`R2 stress: 100 followers + 40 cascade candidates, 600 steps: ${elapsed.toFixed(1)}ms; same-step cascade=${recruited}`);
    expect(recruited).toBe(40); expect(sim.state.followerCount).toBe(100); expect(elapsed).toBeLessThan(3000);
  });
});
