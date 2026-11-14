import { describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import { updateLeader } from '../src/entities/ZombieLeader';
import { Simulation } from '../src/sim/Simulation';
import { canMelee, updateCombat } from '../src/systems/CombatSystem';
import { applyHordeCommands, recruitZombie, updateHorde } from '../src/systems/HordeSystem';
import { updateNavigation } from '../src/systems/NavigationSystem';
import { damageStructure, findStructure, updateStructures } from '../src/systems/StructureSystem';
import { dt, zombie } from './r2-fixtures';

describe('landmark structures', () => {
  it.each([1, 2, 4])('opens enclosure %i once, releases only its occupants, and they reach outside without drifting back', id => {
    const sim = new Simulation(); const s = findStructure(sim.state, id)!;
    const def = sim.ctx.layout.structures.find(d => d.id === id)!;
    const held = sim.state.zombies.filter(z => z.heldBy === id);
    const other = sim.state.zombies.filter(z => z.heldBy !== 0 && z.heldBy !== id);
    const outside = def.approachOutside[1];
    expect(sim.ctx.navGrid.findPath(outside, held[0].pos)).toBeNull();
    const version = sim.ctx.navGrid.version, crawlVersion = sim.ctx.crawlNavGrid.version;
    const rebuild = vi.spyOn(sim.ctx.navGrid, 'rebuild');
    damageStructure(sim.ctx, s, s.hp); damageStructure(sim.ctx, s, 100);
    expect(s.destroyedAt).toBe(0); expect(s.hp).toBe(0);
    expect(sim.ctx.collision.colliders[s.colliderId].enabled).toBe(false);
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(sim.ctx.navGrid.version).toBe(version + 1); expect(sim.ctx.crawlNavGrid.version).toBe(crawlVersion + 1);
    expect(held.every(z => z.heldBy === 0 && z.spawnZone === -1 && z.wanderTarget !== null)).toBe(true);
    expect(other.every(z => z.heldBy !== 0)).toBe(true);
    const events = sim.drainEvents();
    expect(events.filter(e => e.type === 'structureDestroyed')).toHaveLength(1);
    expect(events.filter(e => e.type === 'released')).toMatchObject([{ count: held.length, structureId: id }]);
    expect(events.find(e => e.type === 'structureDamaged')).toMatchObject({ kind: s.kind, hp: 0 });
    expect(sim.state.stats.structuresDestroyed).toBe(1);
    for (const z of held) expect(sim.ctx.navGrid.findPath(z.pos, outside)).not.toBeNull();
    // Isolate release movement from recruitment/combat, including after the burst expires.
    sim.state.zombies = held; sim.state.followerCount = 0; sim.state.leader.pos = { x: -110, z: 20 };
    for (let i = 0; i < 2400; i++) {
      updateHorde(sim.ctx, dt, emptyInput()); updateStructures(sim.ctx, dt); sim.state.time += dt;
      for (const z of held) expect(sim.ctx.collision.isBlocked(z.pos, z.radius)).toBe(false);
    }
    for (const z of held) {
      expect((z.pos.x - outside.x) * Math.sin(def.facing) +
        (z.pos.z - outside.z) * Math.cos(def.facing)).toBeGreaterThan(1);
      expect(recruitZombie(sim.ctx, z, false)).toBe(true);
    }
  });

  it('redirects a sheltered civilian order to the store, then attacks its occupants after breach', () => {
    const sim = new Simulation(); const civilian = sim.state.guards.find(g => g.shelter !== 0)!;
    const door = findStructure(sim.state, civilian.shelter)!;
    applyHordeCommands(sim.ctx, dt, { ...emptyInput(), attackTarget: { kind: 'guard', id: civilian.id } });
    updateNavigation(sim.ctx, dt, emptyInput());
    expect(sim.ctx.nav.effectiveTarget).toEqual({ kind: 'structure', id: door.id });
    expect(sim.ctx.nav.attackField!.goals.length).toBeGreaterThan(0);
    damageStructure(sim.ctx, door, door.hp);
    updateNavigation(sim.ctx, dt, emptyInput());
    expect(sim.ctx.nav.effectiveTarget).toEqual({ kind: 'guard', id: civilian.id });
    expect(sim.drainEvents().filter(e => e.type === 'released')).toHaveLength(0);
  });

  it('succeeds primary and squad structure orders to sheltered humans or nearby humans, otherwise follows', () => {
    const sim = new Simulation();
    applyHordeCommands(sim.ctx, dt, { ...emptyInput(), attackTarget: { kind: 'structure', id: 1 } });
    applyHordeCommands(sim.ctx, dt, { ...emptyInput(), attackTarget: { kind: 'structure', id: 3 } });
    damageStructure(sim.ctx, findStructure(sim.state, 3)!, 1000);
    applyHordeCommands(sim.ctx, dt, emptyInput());
    expect(sim.state.squads[0].target.kind).toBe('guard');
    const sq = sim.state.squads[0].target;
    expect(sim.state.guards.find(g => sq.kind === 'guard' && g.id === sq.id)!.shelter).toBe(3);
    damageStructure(sim.ctx, findStructure(sim.state, 1)!, 1000);
    applyHordeCommands(sim.ctx, dt, emptyInput());
    expect(sim.state.order.type).toBe('attack');
    const lone = new Simulation(); lone.state.guards = [];
    applyHordeCommands(lone.ctx, dt, { ...emptyInput(), attackTarget: { kind: 'structure', id: 1 } });
    damageStructure(lone.ctx, findStructure(lone.state, 1)!, 1000);
    applyHordeCommands(lone.ctx, dt, emptyInput()); expect(lone.state.order.type).toBe('follow');
  });

  it('allows explicit leader attacks and follower melee at the nearest face, with cover still blocking access', () => {
    const sim = new Simulation(); sim.state.zombies = []; sim.state.followerCount = 0;
    const bus = findStructure(sim.state, 1)!; const target = { kind: 'structure' as const, id: 1 };
    sim.state.leader.pos = { x: -65.75, z: 34.2 }; sim.state.leader.facing = Math.PI;
    expect(canMelee(sim.ctx, sim.state.leader.pos, 1.5, target)).toBe(true);
    updateLeader(sim.ctx, 0, { ...emptyInput(), attack: true });
    updateLeader(sim.ctx, BALANCE.alpha.biteWindup, emptyInput());
    expect(bus.hp).toBe(bus.maxHp - BALANCE.alpha.biteDamage);
    expect(canMelee(sim.ctx, { x: -70, z: 34 }, 10, target)).toBe(false);
    const follower = zombie(sim, -65.75, 34.2, { state: 'follower' });
    sim.state.leader.pos = { x: -85, z: 62 };
    applyHordeCommands(sim.ctx, dt, { ...emptyInput(), attackTarget: target });
    updateNavigation(sim.ctx, dt, emptyInput()); updateHorde(sim.ctx, 0, emptyInput());
    expect(follower.engageTarget).toEqual(target);
    updateCombat(sim.ctx, dt, emptyInput()); expect(bus.hp).toBe(bus.maxHp - BALANCE.alpha.biteDamage - 8);
  });
});
