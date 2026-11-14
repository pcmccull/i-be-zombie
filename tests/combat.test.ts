import { describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import type { TargetRef, Vec2 } from '../src/core/types';
import { createZombie } from '../src/entities/Zombie';
import { Simulation } from '../src/sim/Simulation';
import { canMelee, damageGate, damageGuard, damageLeader, damageZombie, updateCombat } from '../src/systems/CombatSystem';
import { countFollowers, recruitZombie } from '../src/systems/HordeSystem';

const dt = BALANCE.sim.fixedDt;
const input = emptyInput();
function add(sim: Simulation, pos: Vec2) {
  const z = createZombie(sim.ctx.newId(), pos, { state: 'ambient', variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng });
  sim.state.zombies.push(z); recruitZombie(sim.ctx, z, false); return z;
}
function fixture() {
  const sim = new Simulation(); sim.state.zombies = []; sim.state.followerCount = 0;
  const g = sim.state.guards[5]; g.pos = { x: -80, z: 60 };
  return { sim, g, target: { kind: 'guard', id: g.id } as TargetRef };
}

describe('combat: design §15.7–8', () => {
  it('enforces range, living state, cooldown and Rush cadence without ticking guard cooldowns', () => {
    const { sim, g, target } = fixture();
    const z = add(sim, { x: g.pos.x + BALANCE.walker.attackRange + g.radius + 0.01, z: g.pos.z });
    z.engageTarget = target; g.attackCooldown = 4;
    updateCombat(sim.ctx, dt, input); expect(g.hp).toBe(50); expect(g.attackCooldown).toBe(4);
    z.pos.x -= 0.02;
    updateCombat(sim.ctx, dt, input); expect(g.hp).toBe(42); expect(z.anim).toBe('attack');
    for (let i = 0; i < 71; i++) updateCombat(sim.ctx, dt, input);
    expect(g.hp).toBe(42);
    updateCombat(sim.ctx, dt, input); expect(g.hp).toBe(34);
    z.attackCooldown = 0; sim.state.abilities.rushTimeLeft = 4;
    updateCombat(sim.ctx, dt, input);
    expect(z.attackCooldown).toBeCloseTo(1.2 / 1.25);
    for (let i = 0; i < 57; i++) updateCombat(sim.ctx, dt, input);
    expect(g.hp).toBe(26);
    updateCombat(sim.ctx, dt, input); expect(g.hp).toBe(18);
  });

  it('filters friendly targets, ambient/rising attackers, corpses and a dead leader', () => {
    const { sim, g, target } = fixture();
    const z = add(sim, { x: -79, z: 60 }), friend = add(sim, { x: -79, z: 61 });
    for (const friendly of [{ kind: 'leader' }, { kind: 'zombie', id: friend.id }] as TargetRef[]) {
      z.engageTarget = friendly; updateCombat(sim.ctx, dt, input);
      expect(canMelee(sim.ctx, z.pos, 10, friendly)).toBe(false);
    }
    expect(friend.hp).toBe(40); expect(sim.state.leader.hp).toBe(100);
    z.engageTarget = target; damageZombie(sim.ctx, z, 40); damageZombie(sim.ctx, z, 10);
    damageLeader(sim.ctx, 100); damageLeader(sim.ctx, 100);
    sim.state.leader.pos = { ...g.pos };
    updateCombat(sim.ctx, dt, input); expect(g.hp).toBe(50);
    expect(countFollowers(sim.state)).toBe(sim.state.followerCount);
    expect(sim.state.stats.losses).toBe(1);
    const events = sim.drainEvents();
    expect(events.filter(e => e.type === 'zombieDied')).toHaveLength(1);
    expect(events.filter(e => e.type === 'leaderDied')).toHaveLength(1);
    friend.engageTarget = target; damageGuard(sim.ctx, g, 50, 'other');
    updateCombat(sim.ctx, dt, input);
    expect(canMelee(sim.ctx, friend.pos, 10, target)).toBe(false);
    expect(sim.drainEvents().filter(e => e.type === 'melee')).toHaveLength(0);
    for (const state of ['ambient', 'rising'] as const) {
      const other = createZombie(sim.ctx.newId(), { x: 83, z: -50.5 }, { state, variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng });
      other.engageTarget = { kind: 'gate' }; sim.state.zombies.push(other);
    }
    updateCombat(sim.ctx, dt, input); expect(sim.state.gate.hp).toBe(BALANCE.gate.maxHp);
  });

  it('leader prefers ordered targets, falls back to nearest guard, and cannot melee while sprinting', () => {
    const { sim, g } = fixture(); const l = sim.state.leader;
    l.pos = { x: -79, z: 60 }; l.sprinting = true;
    updateCombat(sim.ctx, dt, input); expect(g.hp).toBe(50);
    l.sprinting = false; updateCombat(sim.ctx, dt, input);
    expect(g.hp).toBe(40); expect(l.attackCooldown).toBe(1.1);
    for (let i = 0; i < 65; i++) updateCombat(sim.ctx, dt, input);
    expect(g.hp).toBe(40); updateCombat(sim.ctx, dt, input); expect(g.hp).toBe(30);
    l.pos = { x: 83, z: -50.5 }; l.attackCooldown = 0;
    g.pos = { x: 83, z: -49.5 }; sim.state.order = { type: 'attack', target: { kind: 'gate' } };
    updateCombat(sim.ctx, dt, input); expect(sim.state.gate.hp).toBe(BALANCE.gate.maxHp - 10); expect(g.hp).toBe(30);
  });

  it('rejects melee across walls, vehicles and buildings, including at a tower through the perimeter', () => {
    const sim = new Simulation(), g = sim.state.guards[2];
    g.pos = { x: 83, z: -53.5 };
    expect(canMelee(sim.ctx, { x: 83, z: -51.5 }, 3, { kind: 'guard', id: g.id })).toBe(false);
    for (const kind of ['building', 'vehicle'] as const) {
      const c = sim.ctx.collision.colliders.find(c => c.kind === kind)!;
      g.pos = { x: c.maxX + 0.5, z: (c.minZ + c.maxZ) / 2 };
      expect(canMelee(sim.ctx, { x: c.minX - 0.5, z: g.pos.z }, 100, { kind: 'guard', id: g.id })).toBe(false);
    }
    const tower = sim.state.guards[0], ref: TargetRef = { kind: 'guard', id: tower.id };
    const top = tower.elevation;
    expect(canMelee(sim.ctx, { x: 65.5, z: -51.5 }, 1.5, ref, top)).toBe(false);
    // From the ground the occupant is out of reach: attackers must climb to the platform first.
    expect(canMelee(sim.ctx, { x: 68.5, z: -55.5 }, 1.5, ref)).toBe(false);
    expect(canMelee(sim.ctx, { x: 68.5, z: -55.5 }, 1.5, ref, top - 1)).toBe(false);
    expect(canMelee(sim.ctx, { x: 68.5, z: -55.5 }, 1.5, ref, top)).toBe(true);
    expect(canMelee(sim.ctx, { x: 70, z: -55.5 }, 1.5, ref, top)).toBe(false);
  });

  it('damages the gate face with epsilon, opens its blocker and rebuilds navigation exactly once', () => {
    const sim = new Simulation(), version = sim.ctx.navGrid.version;
    const outside = { x: 83, z: -48 }, inside = { x: 83, z: -59 };
    expect(sim.ctx.navGrid.findPath(outside, inside)).toBeNull();
    expect(canMelee(sim.ctx, { x: 83, z: -50.4 }, 1.5, { kind: 'gate' })).toBe(true);
    expect(canMelee(sim.ctx, { x: 83, z: -50.39 }, 1.5, { kind: 'gate' })).toBe(false);
    const rebuild = vi.spyOn(sim.ctx.navGrid, 'rebuild');
    damageGate(sim.ctx, 249); expect(sim.state.gate.destroyed).toBe(false);
    damageGate(sim.ctx, 2); damageGate(sim.ctx, 1000);
    expect(sim.state.gate.hp).toBe(0); expect(rebuild).toHaveBeenCalledTimes(1);
    expect(sim.ctx.navGrid.version).toBe(version + 1);
    expect(sim.ctx.collision.colliders[sim.state.gate.colliderId].enabled).toBe(false);
    expect(sim.ctx.navGrid.findPath(outside, inside)).not.toBeNull();
    expect(sim.drainEvents().filter(e => e.type === 'gateDestroyed')).toHaveLength(1);
  });

  it('alerts on damage, snapshots events and death metadata, and fades zombie corpses', () => {
    const { sim, g } = fixture(); sim.ctx.rng = { next: () => 0.69 };
    damageGuard(sim.ctx, g, 1, 'other'); expect(g.state).toBe('ALERT'); expect(g.hitFlash).toBe(0.15);
    sim.state.time = 7; g.vel.x = 2; damageGuard(sim.ctx, g, 100, 'zombie'); damageGuard(sim.ctx, g, 10, 'zombie');
    expect(g.state).toBe('DEAD'); expect(g.deathTime).toBe(7); expect(g.vel).toEqual({ x: 0, z: 0 });
    expect(sim.state.stats.guardsKilled).toBe(1); expect(sim.state.pendingConversions).toHaveLength(1);
    expect(sim.state.pendingConversions[0]).toMatchObject({ guardId: g.id, resolveAt: 10, willConvert: true });
    const pos = { ...g.pos }; g.pos.x++;
    expect(sim.state.pendingConversions[0].pos).toEqual(pos);
    const z = add(sim, { x: -78, z: 60 }); z.anim = 'attack';
    damageZombie(sim.ctx, z, 1); expect(z.anim).toBe('attack'); expect(z.hitFlash).toBe(0.15);
    damageZombie(sim.ctx, z, 100); updateCombat(sim.ctx, 6.01, input);
    expect(sim.state.zombies).not.toContain(z);
    damageLeader(sim.ctx, 10); expect(sim.state.leader.hitFlash).toBe(0.2);
  });

  it('followers reach and kill a tower occupant through its base attack proxy', () => {
    const sim = new Simulation(); sim.state.zombies = []; sim.state.followerCount = 0;
    const tower = sim.state.guards[0];
    for (const other of sim.state.guards) if (other !== tower) damageGuard(sim.ctx, other, 50, 'other');
    damageGate(sim.ctx, BALANCE.gate.maxHp);
    for (let i = 0; i < 12; i++) add(sim, { x: 80 + i % 4, z: -49 + Math.floor(i / 4) });
    sim.step(dt, { ...input, attackTarget: { kind: 'guard', id: tower.id }, rush: true });
    for (let i = 0; i < 1800 && tower.state !== 'DEAD'; i++) { sim.step(dt, input); sim.drainEvents(); }
    expect(tower.state).toBe('DEAD');
    for (const z of sim.state.zombies.filter(z => z.state === 'follower')) expect(sim.ctx.collision.isBlocked(z.pos, z.radius)).toBe(false);
  });
});

describe('full assault balance', () => {
  it.each([20, 40, 60])('runs a player-like assault with a parked leader and N=%i', n => {
    const sim = new Simulation(); sim.state.zombies = []; sim.state.followerCount = 0;
    // This assault fixture retains the original eight checkpoint defenders as its objective.
    sim.state.guards = sim.state.guards.filter(g => g.post === 'checkpoint');
    const area = sim.ctx.layout.checkpoint.stagingArea;
    const parked = { x: (area.minX + area.maxX) / 2, z: (area.minZ + area.maxZ) / 2 };
    sim.state.leader.pos = { ...parked };
    for (let i = 0; i < n; i++) add(sim, { x: parked.x - 5 + i % 10 * 1.1, z: parked.z - 5 + Math.floor(i / 10) * 1.1 });
    for (let step = 0; step < 300 / dt && sim.state.phase === 'playing'; step++) {
      let target: TargetRef | null = step === 0 ? { kind: 'gate' } : null;
      if (step > 0 && sim.state.order.type === 'follow') {
        let nearest = Infinity;
        for (const g of sim.state.guards) {
          const d = (g.pos.x - sim.state.gate.center.x) ** 2 + (g.pos.z - sim.state.gate.center.z) ** 2;
          if (g.state !== 'DEAD' && g.hp > 0 && d < nearest) { nearest = d; target = { kind: 'guard', id: g.id }; }
        }
      }
      sim.step(dt, { ...input, attackTarget: target, rush: sim.state.abilities.rushCooldown <= dt });
      sim.drainEvents();
      if (!sim.state.followerCount && !sim.state.zombies.some(z => z.state === 'rising') && !sim.state.pendingConversions.length) break;
    }
    const outcome = !sim.state.followerCount && sim.state.phase === 'playing' ? 'horde exhausted' : sim.state.phase;
    console.log(`Player-like assault N=${n}: ${outcome}, time=${sim.state.time.toFixed(2)}s, losses=${sim.state.stats.losses}, survivors=${sim.state.followerCount}, guards=${sim.state.stats.guardsKilled}/8, gateHP=${sim.state.gate.hp}, conversions=${sim.state.stats.conversions}`);
    if (n === 60) {
      expect(sim.state.phase).toBe('victory'); expect(sim.state.time).toBeLessThanOrEqual(300);
      expect(sim.state.stats.losses).toBeLessThan(50); expect(sim.state.leader.pos).toEqual(parked);
      expect(sim.state.followerCount).toBe(countFollowers(sim.state));
    }
  }, 15000);

  it.each([12, 40, 60])('runs a complete real-district assault with N=%i', n => {
    const sim = new Simulation(); sim.state.zombies = []; sim.state.followerCount = 0;
    sim.state.guards = sim.state.guards.filter(g => g.post === 'checkpoint');
    const area = sim.ctx.layout.checkpoint.stagingArea;
    sim.state.leader.pos = { x: (area.minX + area.maxX) / 2, z: (area.minZ + area.maxZ) / 2 };
    for (let i = 0; i < n; i++) add(sim, { x: 59 + i % 10 * 1.1, z: -17 + Math.floor(i / 10) * 1.1 });
    const start = performance.now();
    for (let step = 0; step < 300 / dt && sim.state.phase === 'playing'; step++) {
      let target: TargetRef | null = null;
      if (sim.state.order.type === 'follow') {
        if (!sim.state.gate.destroyed) target = { kind: 'gate' };
        else {
          const living = sim.state.guards.filter(g => g.state !== 'DEAD');
          // Distance to the active pack selects the next nearest defender after each kill.
          const pack = sim.state.zombies.filter(z => z.state === 'follower');
          const anchor = pack.length ? {
            x: pack.reduce((sum, z) => sum + z.pos.x, 0) / pack.length,
            z: pack.reduce((sum, z) => sum + z.pos.z, 0) / pack.length,
          } : sim.state.leader.pos;
          living.sort((a, b) => Math.hypot(a.pos.x - anchor.x, a.pos.z - anchor.z) - Math.hypot(b.pos.x - anchor.x, b.pos.z - anchor.z));
          if (living[0]) target = { kind: 'guard', id: living[0].id };
        }
      }
      sim.step(dt, { ...input, attackTarget: target, rush: sim.state.abilities.rushCooldown <= dt });
      sim.drainEvents();
      // Losing the entire pack cannot improve without movement/recruitment in this script.
      if (!sim.state.followerCount && !sim.state.zombies.some(z => z.state === 'rising') && !sim.state.pendingConversions.length) break;
    }
    const elapsed = performance.now() - start;
    const outcome = !sim.state.followerCount && sim.state.phase === 'playing' ? 'horde exhausted' : sim.state.phase;
    console.log(`Assault N=${n}: ${outcome}, time=${sim.state.time.toFixed(2)}s, losses=${sim.state.stats.losses}, survivors=${sim.state.followerCount}, guards=${sim.state.stats.guardsKilled}/8, gateHP=${sim.state.gate.hp}, conversions=${sim.state.stats.conversions}, wall=${elapsed.toFixed(0)}ms`);
    expect(elapsed).toBeLessThan(10000);
    expect(sim.state.followerCount).toBe(countFollowers(sim.state));
    if (n === 60) { expect(sim.state.phase).toBe('victory'); expect(sim.state.time).toBeLessThanOrEqual(300); }
  }, 15000);
});
