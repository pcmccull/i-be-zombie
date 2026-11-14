import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import { Simulation } from '../src/sim/Simulation';
import { damageGate, damageGuard, damageLeader } from '../src/systems/CombatSystem';
import { recruitZombie } from '../src/systems/HordeSystem';
import { checkVictory } from '../src/systems/VictorySystem';

const dt = BALANCE.sim.fixedDt;
describe('victory, defeat and restart: design §15.12–13,15', () => {
  it('requires both objectives, gives defeat priority, and emits phase events exactly once', () => {
    const sim = new Simulation(); damageGate(sim.ctx, BALANCE.gate.maxHp); checkVictory(sim.ctx);
    expect(sim.state.phase).toBe('playing'); sim.reset();
    for (const g of sim.state.guards) damageGuard(sim.ctx, g, 50, 'other');
    checkVictory(sim.ctx); expect(sim.state.phase).toBe('playing');
    damageGate(sim.ctx, BALANCE.gate.maxHp); sim.drainEvents(); checkVictory(sim.ctx); checkVictory(sim.ctx);
    expect(sim.state.phase).toBe('victory'); expect(sim.drainEvents()).toEqual([{ type: 'victory' }]);
    sim.reset(); damageGate(sim.ctx, BALANCE.gate.maxHp);
    for (const g of sim.state.guards) damageGuard(sim.ctx, g, 50, 'other');
    damageLeader(sim.ctx, 100); sim.drainEvents(); checkVictory(sim.ctx); checkVictory(sim.ctx);
    expect(sim.state.phase).toBe('defeat'); expect(sim.drainEvents()).toEqual([{ type: 'defeat' }]);
  });

  it.each(['victory', 'defeat'] as const)('freezes all gameplay after %s, then reset restores all state and navigation', phase => {
    const sim = new Simulation(); recruitZombie(sim.ctx, sim.state.zombies[0], false);
    sim.step(dt, { ...emptyInput(), rush: true, rally: true, attackTarget: { kind: 'gate' } });
    damageGuard(sim.ctx, sim.state.guards[5], 50, 'zombie'); damageGate(sim.ctx, BALANCE.gate.maxHp);
    if (phase === 'victory') for (const g of sim.state.guards) damageGuard(sim.ctx, g, 50, 'other');
    else damageLeader(sim.ctx, 100);
    checkVictory(sim.ctx); expect(sim.state.phase).toBe(phase); sim.drainEvents();
    const time = sim.state.time, pos = { ...sim.state.leader.pos }, cooldown = sim.state.abilities.rushCooldown;
    const pending = JSON.stringify(sim.state.pendingConversions), stats = { ...sim.state.stats };
    for (let i = 0; i < 300; i++) sim.step(dt, { ...emptyInput(), moveForward: 1, rush: true, recall: true });
    expect(sim.state.time).toBe(time); expect(sim.state.phase).toBe(phase); expect(sim.state.leader.pos).toEqual(pos);
    expect(sim.state.abilities.rushCooldown).toBe(cooldown); expect(JSON.stringify(sim.state.pendingConversions)).toBe(pending);
    expect(sim.state.stats).toEqual(stats); expect(sim.drainEvents()).toEqual([]);
    sim.reset(); const fresh = new Simulation();
    expect(sim.state).toEqual(fresh.state); expect(sim.state.phase).toBe('playing');
    expect(sim.state.zombies).toHaveLength(60); expect(sim.state.followerCount).toBe(0);
    expect(sim.state.guards.every(g => g.state === 'PATROL' && g.attackCooldown === 0 && g.hp === 50)).toBe(true);
    expect(sim.state.abilities).toEqual({ rallyCooldown: 0, rushCooldown: 0, rushTimeLeft: 0 });
    expect(sim.state.pendingConversions).toEqual([]);
    expect(sim.ctx.collision.colliders[sim.state.gate.colliderId].enabled).toBe(true);
    expect(sim.ctx.navGrid.findPath({ x: 83, z: -48 }, { x: 83, z: -59 })).toBeNull();
    expect(sim.ctx.navGrid.version).toBe(fresh.ctx.navGrid.version);
    for (let i = 0; i < 100; i++) { sim.step(dt, emptyInput()); fresh.step(dt, emptyInput()); }
    expect(sim.state).toEqual(fresh.state); expect(sim.drainEvents()).toEqual(fresh.drainEvents());
  });

  it('transitions Attack → Recall → Attack → destroyed target cleared to Follow', () => {
    const sim = new Simulation(), g = sim.state.guards[5];
    sim.step(dt, { ...emptyInput(), attackTarget: { kind: 'guard', id: g.id } });
    expect(sim.state.order).toEqual({ type: 'attack', target: { kind: 'guard', id: g.id } });
    sim.step(dt, { ...emptyInput(), recall: true }); expect(sim.state.order.type).toBe('follow');
    sim.step(dt, { ...emptyInput(), attackTarget: { kind: 'guard', id: g.id } });
    damageGuard(sim.ctx, g, 50, 'other'); sim.step(dt, emptyInput());
    expect(sim.state.order.type).toBe('follow');
    sim.step(dt, { ...emptyInput(), attackTarget: { kind: 'gate' } });
    damageGate(sim.ctx, BALANCE.gate.maxHp); sim.step(dt, emptyInput()); expect(sim.state.order.type).toBe('follow');
    expect(sim.ctx.nav.effectiveTarget).toBeNull();
  });
});
