import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import type { GuardAgent, Vec2 } from '../src/core/types';
import { emptyInput } from '../src/core/types';
import { createZombie } from '../src/entities/Zombie';
import { Simulation } from '../src/sim/Simulation';
import { canMelee, damageGate, damageGuard, updateCombat } from '../src/systems/CombatSystem';
import { applyHordeCommands, recruitZombie, updateHorde } from '../src/systems/HordeSystem';
import { updateNavigation } from '../src/systems/NavigationSystem';

const dt = BALANCE.sim.fixedDt;
const input = emptyInput();
const ref = (g: GuardAgent) => ({ kind: 'guard' as const, id: g.id });
function fixture() {
  const sim = new Simulation(); sim.state.zombies = [];
  for (const g of sim.state.guards) { g.state = 'DEAD'; g.hp = 0; }
  sim.state.leader.pos = { x: 64, z: -12 };
  return sim;
}
function living(sim: Simulation, index: number, pos?: Vec2) {
  const g = sim.state.guards[index]; g.state = 'COMBAT'; g.hp = g.maxHp;
  if (pos) g.pos = { ...pos };
  return g;
}
function add(sim: Simulation, pos: Vec2) {
  const z = createZombie(sim.ctx.newId(), pos, { state: 'ambient', variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng });
  sim.state.zombies.push(z); recruitZombie(sim.ctx, z, false); return z;
}
function commands(sim: Simulation) { applyHordeCommands(sim.ctx, dt, input); }
function changes(sim: Simulation) { return sim.drainEvents().filter(e => e.type === 'orderChanged'); }

describe('B1 horde engagement', () => {
  it('succeeds a destroyed gate with the nearest reachable living guard and emits once', () => {
    const sim = fixture(); add(sim, { x: 83, z: -50 });
    const near = living(sim, 6), far = living(sim, 5);
    sim.state.order = { type: 'attack', target: { kind: 'gate' } };
    damageGate(sim.ctx, 250); sim.drainEvents(); commands(sim);
    expect(sim.state.order).toEqual({ type: 'attack', target: ref(near) });
    expect(changes(sim)).toEqual([{ type: 'orderChanged', order: sim.state.order }]);
    commands(sim); expect(changes(sim)).toEqual([]);
    expect(far.state).not.toBe('DEAD');
  });

  it('falls back to follow once when no living guard is within 25 meters', () => {
    const sim = fixture(); add(sim, { x: 83, z: -50 });
    living(sim, 5, { x: 83, z: -26 });
    sim.state.order = { type: 'attack', target: { kind: 'gate' } };
    damageGate(sim.ctx, 250); sim.drainEvents(); commands(sim); commands(sim);
    expect(sim.state.order).toEqual({ type: 'follow' });
    expect(changes(sim)).toEqual([{ type: 'orderChanged', order: { type: 'follow' } }]);
  });

  it('skips a closer guard behind the intact gate and succeeds a killed guard', () => {
    const sim = fixture(); add(sim, { x: 83, z: -49 });
    const old = living(sim, 5, { x: 83, z: -50 });
    living(sim, 2, { x: 83, z: -55 });
    const next = living(sim, 7, { x: 93, z: -47 });
    sim.state.order = { type: 'attack', target: ref(old) };
    damageGuard(sim.ctx, old, 50, 'other'); sim.drainEvents(); commands(sim);
    expect(sim.state.order).toEqual({ type: 'attack', target: ref(next) });
    expect(changes(sim)).toEqual([{ type: 'orderChanged', order: sim.state.order }]);
    updateNavigation(sim.ctx, dt, input); updateHorde(sim.ctx, dt, input);
    expect(sim.state.zombies[0].engageTarget).toEqual(ref(next));
  });

  it('returns to follow when the only nearby living guard is unreachable', () => {
    const sim = fixture(); add(sim, { x: 83, z: -49 });
    const old = living(sim, 5, { x: 83, z: -50 }); living(sim, 2);
    sim.state.order = { type: 'attack', target: ref(old) };
    damageGuard(sim.ctx, old, 50, 'other'); sim.drainEvents(); commands(sim);
    expect(sim.state.order).toEqual({ type: 'follow' });
    expect(changes(sim)).toHaveLength(1);
  });

  it('accepts the 25 meter boundary, excludes zero-HP guards, and repeats deterministically after reset', () => {
    const sim = fixture();
    function assault() {
      sim.state.zombies = [];
      for (const g of sim.state.guards) { g.state = 'DEAD'; g.hp = 0; }
      add(sim, { x: 83, z: -50 });
      const zeroHp = living(sim, 6); zeroHp.hp = 0;
      const edge = living(sim, 5, { x: sim.state.gate.center.x, z: sim.state.gate.center.z + 25 });
      sim.state.order = { type: 'attack', target: { kind: 'gate' } };
      damageGate(sim.ctx, 250); sim.drainEvents(); commands(sim);
      expect(sim.state.order).toEqual({ type: 'attack', target: ref(edge) });
      return changes(sim);
    }
    const first = assault(); sim.reset(); expect(assault()).toEqual(first);
  });

  it('includes reachable tower attack proxies after the breach', () => {
    const sim = fixture(); add(sim, { x: 83, z: -50 }); const tower = living(sim, 0);
    sim.state.order = { type: 'attack', target: { kind: 'gate' } };
    damageGate(sim.ctx, 250); commands(sim); updateNavigation(sim.ctx, dt, input);
    expect(sim.state.order).toEqual({ type: 'attack', target: ref(tower) });
    expect(sim.ctx.nav.attackField!.distanceAt(sim.state.zombies[0].pos)).toBeLessThan(Infinity);
  });

  it('defends against an adjacent guard without changing the gate order or steering target', () => {
    const sim = fixture(); const z = add(sim, { x: 83, z: -46 });
    const g = living(sim, 6, { x: 84, z: -46 });
    sim.state.order = { type: 'attack', target: { kind: 'gate' } };
    updateNavigation(sim.ctx, dt, input); updateHorde(sim.ctx, dt, input);
    expect(canMelee(sim.ctx, z.pos, BALANCE.walker.attackRange, { kind: 'gate' })).toBe(false);
    updateCombat(sim.ctx, dt, input);
    expect(g.hp).toBe(g.maxHp - BALANCE.walker.attackDamage);
    expect(sim.state.gate.hp).toBe(250);
    expect(sim.state.order).toEqual({ type: 'attack', target: { kind: 'gate' } });
    expect(z.engageTarget).toEqual({ kind: 'gate' });
    expect(changes(sim)).toEqual([]);
  });

  it('prioritizes the gate when both the gate and another guard are in melee reach', () => {
    const sim = fixture(); const z = add(sim, { x: 83, z: -50.5 });
    const g = living(sim, 6, { x: 84, z: -50.5 });
    sim.state.order = { type: 'attack', target: { kind: 'gate' } };
    updateNavigation(sim.ctx, dt, input); updateHorde(sim.ctx, dt, input);
    expect(canMelee(sim.ctx, z.pos, BALANCE.walker.attackRange, { kind: 'gate' })).toBe(true);
    updateCombat(sim.ctx, dt, input);
    expect(sim.state.gate.hp).toBe(250 - BALANCE.walker.attackDamage); expect(g.hp).toBe(g.maxHp);
  });

  it('defends on a guard order while preserving its route and rejects melee across the gate', () => {
    const sim = fixture(); const z = add(sim, { x: 83, z: -51 });
    const ordered = living(sim, 5, { x: 74, z: -47 });
    const blocked = living(sim, 2, { x: 83, z: -53 });
    const adjacent = living(sim, 6, { x: 84.5, z: -51 });
    sim.state.order = { type: 'attack', target: ref(ordered) };
    updateNavigation(sim.ctx, dt, input); updateHorde(sim.ctx, dt, input);
    expect(canMelee(sim.ctx, z.pos, BALANCE.walker.attackRange, ref(blocked))).toBe(false);
    updateCombat(sim.ctx, dt, input);
    expect(adjacent.hp).toBe(adjacent.maxHp - BALANCE.walker.attackDamage);
    expect(blocked.hp).toBe(blocked.maxHp); expect(ordered.hp).toBe(ordered.maxHp);
    expect(z.engageTarget).toEqual(ref(ordered));
    expect(sim.state.order).toEqual({ type: 'attack', target: ref(ordered) });
  });

  it.each([false, true])('recall wins during or after succession and stays follow (succeeded=%s)', succeeded => {
    const sim = fixture(); const z = add(sim, { x: 83, z: -50 }); const g = living(sim, 6);
    sim.state.order = { type: 'attack', target: { kind: 'gate' } };
    damageGate(sim.ctx, 250);
    if (succeeded) commands(sim);
    sim.drainEvents();
    applyHordeCommands(sim.ctx, dt, { ...input, recall: true, attackTarget: ref(g) });
    expect(changes(sim)).toEqual([{ type: 'orderChanged', order: { type: 'follow' } }]);
    for (let i = 0; i < 120; i++) {
      commands(sim); updateNavigation(sim.ctx, dt, input); updateHorde(sim.ctx, dt, input);
      expect(sim.state.order).toEqual({ type: 'follow' }); expect(z.engageTarget).toBeNull();
    }
    expect(changes(sim)).toEqual([]);
  });
});
