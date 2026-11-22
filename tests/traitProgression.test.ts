import { beforeEach, describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput, type SimInput } from '../src/core/types';
import { applySave, createSave, parseSave } from '../src/persistence/saveSchema';
import { Simulation } from '../src/sim/Simulation';
import {
  buyTrait, traitAttackRateMultiplier, traitCost, traitSpeedMultiplier, updateProgression,
} from '../src/systems/ProgressionSystem';
import { traitPanelViews } from '../src/ui/uiHelpers';

let sim: Simulation;
beforeEach(() => { sim = new Simulation(); });

function atNest(): void {
  const n = sim.ctx.layout.nests[0].pos;
  sim.state.leader.pos = { x: n.x, z: n.z };
}
function events(type: string) {
  return sim.drainEvents().filter(e => e.type === type);
}

describe('nest traits: running speed + attack speed', () => {
  it('start at level 0 and every level costs more than the last', () => {
    for (const id of ['speed', 'attack'] as const) {
      const costs = BALANCE.traits[id].costs;
      for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeGreaterThan(costs[i - 1]);
      expect(traitCost(sim.state, id)).toBe(costs[0]);
    }
    expect(sim.state.progression.speedLevel).toBe(0);
    expect(sim.state.progression.attackLevel).toBe(0);
    expect(traitSpeedMultiplier(sim.state)).toBe(1);
    expect(traitAttackRateMultiplier(sim.state)).toBe(1);
  });

  it('buys levels at a nest with rising prices until max', () => {
    atNest();
    sim.state.progression.biomass = 10000;
    sim.drainEvents();
    const costs = BALANCE.traits.speed.costs;
    let spent = 0;
    for (let i = 0; i < costs.length; i++) {
      expect(buyTrait(sim.ctx, 'speed')).toBe(true);
      spent += costs[i];
      expect(sim.state.progression.speedLevel).toBe(i + 1);
      expect(sim.state.progression.biomass).toBe(10000 - spent);
    }
    const ups = events('traitUpgraded');
    expect(ups.map(e => e.type === 'traitUpgraded' && e.cost)).toEqual([...costs]);
    expect(traitCost(sim.state, 'speed')).toBeNull();
    expect(buyTrait(sim.ctx, 'speed')).toBe(false);
    expect(events('abilityDenied')).toEqual([{ type: 'abilityDenied', abilityId: null, reason: 'maxTrait' }]);
    expect(sim.state.progression.attackLevel).toBe(0); // independent traits
    expect(traitSpeedMultiplier(sim.state)).toBeCloseTo(1 + costs.length * BALANCE.traits.speed.perLevel);
  });

  it('denies away from the nest, without biomass, and while respawning', () => {
    sim.state.progression.biomass = 500;
    sim.state.leader.pos = { x: 9999, z: 9999 };
    sim.drainEvents();
    expect(buyTrait(sim.ctx, 'attack')).toBe(false);
    expect(events('abilityDenied')[0]).toMatchObject({ reason: 'notAtNest' });
    atNest();
    sim.state.progression.biomass = BALANCE.traits.attack.costs[0] - 1;
    expect(buyTrait(sim.ctx, 'attack')).toBe(false);
    expect(events('abilityDenied')[0]).toMatchObject({ reason: 'biomass' });
    sim.state.progression.biomass = 999;
    sim.state.phase = 'respawning';
    expect(buyTrait(sim.ctx, 'attack')).toBe(false);
    expect(events('abilityDenied')[0]).toMatchObject({ reason: 'locked' });
    expect(sim.state.progression.attackLevel).toBe(0);
    expect(sim.state.progression.biomass).toBe(999);
  });

  it('SimInput.buyTrait goes through updateProgression', () => {
    atNest();
    sim.state.progression.biomass = 100;
    const input: SimInput = { ...emptyInput(), buyTrait: 'attack' };
    updateProgression(sim.ctx, 0, input);
    expect(sim.state.progression.attackLevel).toBe(1);
    expect(traitAttackRateMultiplier(sim.state)).toBeCloseTo(1 + BALANCE.traits.attack.perLevel);
  });

  it('speeds up the Alpha and shortens its attack windup', () => {
    const run = (speedLevel: number): number => {
      const s = new Simulation();
      s.state.progression.speedLevel = speedLevel;
      s.state.leader.pos = { x: 0, z: 0 };
      s.state.leader.stamina = 1e9;
      const input: SimInput = { ...emptyInput(), moveForward: 1 };
      for (let i = 0; i < 60; i++) s.step(1 / 60, input);
      return Math.hypot(s.state.leader.vel.x, s.state.leader.vel.z);
    };
    expect(run(3)).toBeGreaterThan(run(0) * 1.15);

    const windup = (attackLevel: number): number => {
      const s = new Simulation();
      s.state.progression.attackLevel = attackLevel;
      s.step(1 / 60, { ...emptyInput(), attack: true });
      return s.state.leader.attackTimer;
    };
    expect(windup(5)).toBeLessThan(windup(0) * 0.7);
  });

  it('persists levels and clamps bad saves', () => {
    sim.state.progression.speedLevel = 2;
    sim.state.progression.attackLevel = 4;
    const save = parseSave(JSON.parse(JSON.stringify(createSave(sim.state, 1))))!;
    expect(save.player.speedLevel).toBe(2);
    expect(save.player.attackLevel).toBe(4);
    const b = new Simulation();
    applySave(b.ctx, save);
    expect(b.state.progression.speedLevel).toBe(2);
    expect(b.state.progression.attackLevel).toBe(4);

    const raw = JSON.parse(JSON.stringify(save));
    raw.player.speedLevel = 99; raw.player.attackLevel = 'x';
    const bad = parseSave(raw)!;
    expect(bad.player.speedLevel).toBe(BALANCE.traits.speed.costs.length);
    expect(bad.player.attackLevel).toBe(0);
    delete raw.player.speedLevel;
    expect(parseSave(raw)!.player.speedLevel).toBe(0);
  });

  it('panel view shows level, bonus and next price', () => {
    sim.state.progression.biomass = 30;
    sim.state.progression.speedLevel = 1;
    const [speed, attack] = traitPanelViews(sim.state);
    expect(speed).toMatchObject({ id: 'speed', level: 1, nextCost: BALANCE.traits.speed.costs[1], affordable: false });
    expect(speed.bonus).toBe(`+${Math.round(BALANCE.traits.speed.perLevel * 100)}% speed`);
    expect(attack).toMatchObject({ id: 'attack', level: 0, nextCost: BALANCE.traits.attack.costs[0], affordable: true });
  });
});
